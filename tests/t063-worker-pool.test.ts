/**
 * T-063 / Issue #21 — WorkerPool unit coverage.
 *
 * Lane scheduling, priority order, same-key dedupe, abort, transferable
 * passthrough, 30 s idle reclamation (fake timers), tier classification and
 * downgrade reasons, and the three-preview concurrency case. Real browser
 * Workers are not exercised here; a fake worker stub stands in for the lane.
 */
import { describe, expect, it } from "vitest";
import {
  createPool,
  PoolUnavailableError,
  TaskCanceledError,
  type PoolHooks,
} from "@core/workers/workerPool";
import { classifyTier } from "@core/workers/tier";
import type { WorkerSpec } from "@core/workers/types";

/* ------------------------------ fake worker ----------------------------- */

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: Array<{ message: Record<string, unknown>; transfer: Transferable[] }> = [];
  terminated = false;
  constructor(public spec: WorkerSpec) {
    FakeWorker.instances.push(this);
  }
  postMessage(message: Record<string, unknown>, transfer?: Transferable[]): void {
    this.posted.push({ message, transfer: transfer ?? [] });
  }
  reply(payload: Record<string, unknown>): void {
    this.onmessage?.({ data: payload } as MessageEvent);
  }
  terminate(): void {
    this.terminated = true;
  }
}

interface TimerEntry {
  fn: () => void;
  at: number;
}

function makeHooks(cores: number): { hooks: PoolHooks; advance: (ms: number) => void } {
  let now = 0;
  const timers = new Map<number, TimerEntry>();
  let timerId = 1;
  const hooks: PoolHooks = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = timerId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    createWorker: (spec) => new FakeWorker(spec),
    probe: () => ({
      cores,
      workerAvailable: true,
      sabAvailable: false,
    }),
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, entry] of [...timers]) {
      if (entry.at <= now) {
        timers.delete(id);
        entry.fn();
      }
    }
  };
  return { hooks, advance };
}

const spec = (kind: string): WorkerSpec => ({
  kind,
  url: new URL(`./${kind}.worker.ts`, "http://localhost/"),
  create: () => {
    throw new Error("tests inject a fake worker factory via hooks");
  },
});

function decodeEcho<T>(reply: Record<string, unknown>): T {
  if (typeof reply.error === "string" && reply.error !== "") throw new Error(reply.error);
  return reply.echo as T;
}

/* ------------------------------- tier rules ----------------------------- */

describe("tier classification", () => {
  it("maps core counts to the S/A/B/C lane policy with a reason", () => {
    expect(classifyTier({ cores: 16, workerAvailable: true, sabAvailable: false }).tier).toBe("S");
    expect(classifyTier({ cores: 8, workerAvailable: true, sabAvailable: false }).lanes).toBe(7);
    expect(classifyTier({ cores: 6, workerAvailable: true, sabAvailable: false }).tier).toBe("A");
    expect(classifyTier({ cores: 4, workerAvailable: true, sabAvailable: false }).lanes).toBe(3);
    expect(classifyTier({ cores: 3, workerAvailable: true, sabAvailable: false }).tier).toBe("B");
    expect(classifyTier({ cores: 2, workerAvailable: true, sabAvailable: false }).lanes).toBe(1);
    expect(classifyTier({ cores: 1, workerAvailable: true, sabAvailable: false }).tier).toBe("C");
    expect(classifyTier({ cores: 1, workerAvailable: true, sabAvailable: false }).lanes).toBe(0);
  });

  it("falls back to C with a visible reason when Workers are unavailable", () => {
    const d = classifyTier({ cores: 8, workerAvailable: false, sabAvailable: false });
    expect(d.tier).toBe("C");
    expect(d.lanes).toBe(0);
    expect(d.tierReason).toBe("worker-unavailable");
  });

  it("forceTier overrides the hardware rule and records the override", () => {
    const d = classifyTier({ cores: 16, workerAvailable: true, sabAvailable: false }, "B");
    expect(d.tier).toBe("B");
    expect(d.lanes).toBe(1);
    expect(d.tierReason).toBe("forced-B");
  });
});

/* ----------------------------- pool behaviour --------------------------- */

describe("WorkerPool", () => {
  it("caps concurrent running tasks at the lane count and queues the rest", async () => {
    FakeWorker.instances = [];
    const { hooks } = makeHooks(4); // A tier → 3 lanes
    const pool = createPool(hooks);

    const tasks = [1, 2, 3, 4].map((n) =>
      pool.submit<number>({
        spec: spec("test"),
        payload: { n },
        priority: "visible",
        decode: decodeEcho<number>,
      }),
    );

    expect(FakeWorker.instances).toHaveLength(3);
    expect(pool.getPoolStats().queueDepth).toBe(1);

    // drain: reply to whatever the three lanes are running
    for (const worker of FakeWorker.instances) {
      const msg = worker.posted[0].message;
      worker.reply({ id: msg.id, echo: Number(msg.n) * 10 });
    }
    await Promise.all(tasks.slice(0, 3));
    // the queued fourth task now reuses a free lane; find its second message
    const reused = FakeWorker.instances.find((w) => w.posted.length > 1);
    expect(reused).toBeDefined();
    const msg = reused!.posted[1].message;
    reused!.reply({ id: msg.id, echo: Number(msg.n) * 10 });
    await tasks[3];

    expect(await tasks[0]).toBe(10);
    expect(await tasks[3]).toBe(40);
    pool.terminateAll();
  });

  it("orders by priority ahead of FIFO: input before visible before background", async () => {
    FakeWorker.instances = [];
    const { hooks } = makeHooks(2); // B tier → 1 lane
    const pool = createPool(hooks);

    const order: string[] = [];
    const run = (tag: string, priority: "input" | "visible" | "background") =>
      pool.submit<string>({
        spec: spec("test"),
        payload: { tag },
        priority,
        decode: (reply) => {
          order.push(String(reply.tag));
          return String(reply.tag);
        },
      });

    // The background task grabs the single lane first; the other two queue.
    const background = run("bg", "background");
    const visible = run("vi", "visible");
    const input = run("in", "input");

    const lane = FakeWorker.instances[0];
    // release the running background task; the queued input must then jump
    // ahead of the earlier-queued visible task (non-preemptive, queue-priority).
    const first = lane.posted[0].message;
    lane.reply({ id: first.id, tag: "bg" });
    await background;

    const second = lane.posted[1].message;
    lane.reply({ id: second.id, tag: "in" });
    await input;

    const third = lane.posted[2].message;
    lane.reply({ id: third.id, tag: "vi" });
    await visible;

    expect(order).toEqual(["bg", "in", "vi"]);
    pool.terminateAll();
  });

  it("merges same-key pending tasks onto one worker message", async () => {
    FakeWorker.instances = [];
    const { hooks } = makeHooks(8);
    const pool = createPool(hooks);

    const first = pool.submit<string>({
      spec: spec("adoc"),
      payload: { source: "= Hello" },
      priority: "visible",
      dedupeKey: "adoc:= Hello",
      decode: decodeEcho<string>,
    });
    const second = pool.submit<string>({
      spec: spec("adoc"),
      payload: { source: "= Hello" },
      priority: "visible",
      dedupeKey: "adoc:= Hello",
      decode: decodeEcho<string>,
    });

    const worker = FakeWorker.instances[0];
    expect(worker.posted).toHaveLength(1);
    const msg = worker.posted[0].message;
    worker.reply({ id: msg.id, echo: "same-html" });

    expect(await first).toBe("same-html");
    expect(await second).toBe("same-html");
    pool.terminateAll();
  });

  it("rejects a queued task on abort and never creates a worker for it", async () => {
    FakeWorker.instances = [];
    const { hooks } = makeHooks(8);
    const pool = createPool(hooks);
    const controller = new AbortController();
    controller.abort(); // aborted before submit: never enters the queue

    const task = pool.submit<string>({
      spec: spec("docx"),
      payload: {},
      priority: "visible",
      signal: controller.signal,
      decode: decodeEcho<string>,
    });

    await expect(task).rejects.toBeInstanceOf(TaskCanceledError);
    expect(FakeWorker.instances).toHaveLength(0);
    expect(pool.getPoolStats().queueDepth).toBe(0);
    pool.terminateAll();
  });

  it("ignores the late reply of a canceled running task and frees the lane", async () => {
    FakeWorker.instances = [];
    const { hooks } = makeHooks(8);
    const pool = createPool(hooks);
    const controller = new AbortController();

    const task = pool.submit<string>({
      spec: spec("xlsx"),
      payload: {},
      priority: "visible",
      signal: controller.signal,
      decode: decodeEcho<string>,
    });
    const worker = FakeWorker.instances[0];
    controller.abort();
    await expect(task).rejects.toBeInstanceOf(TaskCanceledError);

    // late worker reply must not resolve anything or leave a pending entry
    const msg = worker.posted[0].message;
    worker.reply({ id: msg.id, echo: "late" });
    await Promise.resolve();

    const stats = pool.getPoolStats();
    expect(stats.activeWorkers[0].busy).toBe(false);
    expect(stats.queueDepth).toBe(0);
    pool.terminateAll();
  });

  it("passes transferables through to postMessage", async () => {
    FakeWorker.instances = [];
    const { hooks } = makeHooks(8);
    const pool = createPool(hooks);
    const buffer = new ArrayBuffer(256);

    const task = pool.submit<number>({
      spec: spec("docx"),
      payload: { arrayBuffer: buffer },
      transfer: [buffer],
      priority: "visible",
      decode: decodeEcho<number>,
    });

    const worker = FakeWorker.instances[0];
    expect(worker.posted[0].transfer).toEqual([buffer]);
    const msg = worker.posted[0].message;
    worker.reply({ id: msg.id, echo: 1 });
    await task;
    pool.terminateAll();
  });

  it("reclaims an idle lane 30 s after its last task finishes", () => {
    FakeWorker.instances = [];
    const { hooks, advance } = makeHooks(8);
    const pool = createPool(hooks);

    void pool.submit<string>({
      spec: spec("adoc"),
      payload: {},
      priority: "visible",
      decode: decodeEcho<string>,
    });
    const worker = FakeWorker.instances[0];
    const msg = worker.posted[0].message;
    worker.reply({ id: msg.id, echo: "x" });

    expect(worker.terminated).toBe(false);
    advance(29_999);
    expect(worker.terminated).toBe(false);
    advance(2);
    expect(worker.terminated).toBe(true);
    pool.terminateAll();
  });

  it("runs the DOCX, XLSX and AsciiDoc previews concurrently without starving", async () => {
    FakeWorker.instances = [];
    const { hooks } = makeHooks(12); // S tier
    const pool = createPool(hooks);

    const kinds = ["docx", "xlsx", "adoc"] as const;
    const tasks = kinds.map((kind) =>
      pool.submit<string>({
        spec: spec(kind),
        payload: {},
        priority: "visible",
        decode: (reply) => String(reply.kind),
      }),
    );

    // all three should land on lanes immediately, none queued behind one worker
    expect(pool.getPoolStats().queueDepth).toBe(0);
    expect(FakeWorker.instances).toHaveLength(3);

    for (const worker of FakeWorker.instances) {
      const msg = worker.posted[0].message;
      worker.reply({ id: msg.id, kind: worker.spec.kind });
    }
    expect(await Promise.all(tasks)).toEqual(["docx", "xlsx", "adoc"]);

    const stats = pool.getPoolStats();
    expect(stats.tier).toBe("S");
    expect(stats.degraded).toBe(false);
    expect(stats.activeWorkers).toHaveLength(3);
    pool.terminateAll();
  });

  it("records the four-segment timings on every settled task", async () => {
    FakeWorker.instances = [];
    const { hooks } = makeHooks(8);
    const pool = createPool(hooks);

    const task = pool.submit<number>({
      spec: spec("docx"),
      payload: {},
      priority: "visible",
      decode: decodeEcho<number>,
    });
    const worker = FakeWorker.instances[0];
    const msg = worker.posted[0].message;
    worker.reply({ id: msg.id, echo: 7, computeMs: 12.5 });
    await task;

    const record = pool.getPoolStats().tasks[0];
    expect(record.status).toBe("ok");
    expect(record.timings.computeMs).toBe(12.5);
    for (const key of ["queueMs", "transferMs", "computeMs", "returnMs", "totalMs"] as const) {
      expect(record.timings[key]).toBeGreaterThanOrEqual(0);
    }
    pool.terminateAll();
  });

  it("rejects fast on tier C and exposes the degraded reason in stats", async () => {
    FakeWorker.instances = [];
    const { hooks } = makeHooks(1);
    const pool = createPool(hooks);

    await expect(
      pool.submit<string>({
        spec: spec("docx"),
        payload: {},
        priority: "visible",
        decode: decodeEcho<string>,
      }),
    ).rejects.toBeInstanceOf(PoolUnavailableError);

    const stats = pool.getPoolStats();
    expect(stats.tier).toBe("C");
    expect(stats.degraded).toBe(true);
    expect(stats.tierReason).not.toBe("");
    pool.terminateAll();
  });

  it("terminates every lane and rejects in-flight work on terminateAll", async () => {
    FakeWorker.instances = [];
    const { hooks } = makeHooks(8);
    const pool = createPool(hooks);

    const running = pool.submit<string>({
      spec: spec("adoc"),
      payload: {},
      priority: "visible",
      decode: decodeEcho<string>,
    });
    const queued = pool.submit<string>({
      spec: spec("adoc"),
      payload: {},
      priority: "background",
      decode: decodeEcho<string>,
    });

    pool.terminateAll();
    await expect(running).rejects.toBeInstanceOf(TaskCanceledError);
    await expect(queued).rejects.toBeInstanceOf(TaskCanceledError);
    expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
  });

});
