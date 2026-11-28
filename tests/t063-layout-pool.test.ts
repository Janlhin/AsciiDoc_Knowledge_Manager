/**
 * T-063 (#19/#20) — shard pool, tier decision, freeze / local relayout and
 * cleanup coverage. Real `Worker` is unavailable in this environment, so the
 * pool coordinator is exercised through a fake worker factory; the tier and
 * shard pure functions are tested directly.
 *
 * Determinism boundary: the single-thread JS kernel keeps its bit-exact
 * fingerprint tests in `gpu-graph-layout.test.ts`. The pool sums forces in
 * worker-id / shard order, which differs from the single-thread accumulation
 * order, so multi-worker output is *not* bit-identical to single-worker output;
 * these tests assert finiteness, contract shape and neighbourhood scoping only.
 */
import { describe, expect, it, vi } from "vitest";
import { createAsyncLayout } from "../src/features/graph/gpu/layout-client";
import { PoolLayoutHandle } from "../src/features/graph/gpu/layout/pool-client";
import { decideTier, probeEnvironment, type ProbeInput } from "../src/features/graph/gpu/layout/tier";
import {
  buildAdjacency,
  buildShardPlan,
  localNeighborhood,
  shardSummaries,
} from "../src/features/graph/gpu/layout/shard";
import type { PoolInMessage, PoolOutMessage } from "../src/features/graph/gpu/layout/protocol";
import type { GpuEdge, GpuGraph, GpuNode } from "../src/features/graph/gpu/types";

function ring(count: number): GpuGraph {
  const nodes: GpuNode[] = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    label: `n${i}`,
    resolved: true,
    degree: 2,
  }));
  const edges: GpuEdge[] = Array.from({ length: count }, (_, i) => ({
    source: i,
    target: (i + 1) % count,
    broken: false,
  }));
  return { nodes, edges };
}

function makeProbe(over: Partial<ProbeInput>): ProbeInput {
  return {
    cores: 4,
    sab: true,
    wasm: false,
    deviceMemoryBytes: 0,
    workerAvailable: true,
    ...over,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------- tier decision -- */

describe("t063 pool — tier decision", () => {
  it("maps cores / SAB / WASM to the S/A/B/C table", () => {
    const size = { nodes: 100_000, edges: 200_000 };
    // S needs cores ≥8 + SAB + WASM; WASM is off this round, so ≥8 lands A.
    const s = decideTier(makeProbe({ cores: 16, sab: true, wasm: true }), size, undefined);
    expect(s.tier).toBe("S");
    expect(s.workers).toBe(4);

    const noWasm = decideTier(makeProbe({ cores: 16, sab: true, wasm: false }), size, undefined);
    expect(noWasm.tier).toBe("A");
    expect(noWasm.tierReason).toContain("no-wasm");

    const noSab = decideTier(makeProbe({ cores: 16, sab: false }), size, undefined);
    expect(noSab.tier).toBe("B");
    expect(noSab.tierReason).toContain("no-sab");

    const twoCores = decideTier(makeProbe({ cores: 2 }), size, undefined);
    expect(twoCores.tier).toBe("B");
    expect(twoCores.workers).toBeGreaterThanOrEqual(1);

    const oneCore = decideTier(makeProbe({ cores: 1 }), size, undefined);
    expect(oneCore.tier).toBe("C");
    expect(oneCore.mode).toBe("main");
    expect(oneCore.workers).toBe(0);
  });

  it("drops to main when the Worker constructor is unavailable", () => {
    const d = decideTier(makeProbe({ workerAvailable: false }), { nodes: 100, edges: 100 }, undefined);
    expect(d.tier).toBe("C");
    expect(d.mode).toBe("main");
    expect(d.tierReason).toContain("worker-unavailable");
  });

  it("honours forceWorkers / forceTier / sab=false overrides", () => {
    const size = { nodes: 10_000, edges: 20_000 };
    const forced = decideTier(makeProbe({ cores: 16 }), size, { forceWorkers: 3 });
    expect(forced.workers).toBe(3);

    const forcedTier = decideTier(makeProbe({ cores: 2 }), size, { forceTier: "A" });
    expect(forcedTier.tier).toBe("A");

    const sabOff = decideTier(makeProbe({ cores: 16, sab: true }), size, { sab: false });
    expect(sabOff.sab).toBe(false);
  });

  it("caps workers under the memory budget and refuses an oversized replica", () => {
    // 128 MiB device memory → 32 MiB budget; the million-node replica does not fit.
    const probe = makeProbe({ deviceMemoryBytes: 128 * 1024 * 1024 });
    const d = decideTier(probe, { nodes: 1_000_000, edges: 2_000_000 }, undefined);
    expect(d.tier).toBe("C");
    expect(d.mode).toBe("main");
    expect(d.tierReason).toContain("memory");
  });

  it("probeEnvironment disables SAB when not cross-origin isolated", () => {
    const env = probeEnvironment({ sab: true });
    // Node / non-isolated test context: crossOriginIsolated is falsy.
    expect(env.sab).toBe(false);
  });
});

/* ----------------------------------------------------------- shard plan -- */

describe("t063 pool — shard plan", () => {
  it("balances nodes across shards and accounts for every edge", () => {
    const graph = ring(120);
    const plan = buildShardPlan(graph, 4);
    expect(plan.shardCount).toBe(4);
    for (let s = 0; s < 4; s++) {
      const count = plan.shardStart[s + 1] - plan.shardStart[s];
      expect(count).toBeGreaterThanOrEqual(28);
      expect(count).toBeLessThanOrEqual(32);
    }
    expect(plan.intraEdgeCount + plan.crossEdgeCount).toBe(graph.edges.length);
  });

  it("localNeighborhood returns the 1-hop ring (seed + neighbours)", () => {
    const adj = buildAdjacency(ring(12));
    const oneHop = localNeighborhood(adj, [0], 1);
    expect([...oneHop].sort((a, b) => a - b)).toEqual([0, 1, 11]);
    const twoHop = localNeighborhood(adj, [0], 2);
    expect(twoHop).toContain(2);
    expect(twoHop).toContain(10);
  });

  it("summaries aggregate mass and finite centroids per shard", () => {
    const graph = ring(40);
    const plan = buildShardPlan(graph, 4);
    const x = new Float32Array(40).map((_, i) => i);
    const y = new Float32Array(40).map((_, i) => i * 2);
    const mass = new Float32Array(40).fill(1);
    const sum = shardSummaries(plan, x, y, mass);
    const totalMass = sum.mass.reduce((a, b) => a + b, 0);
    expect(totalMass).toBe(40);
    for (let s = 0; s < 4; s++) {
      expect(Number.isFinite(sum.comX[s])).toBe(true);
      expect(Number.isFinite(sum.comY[s])).toBe(true);
    }
  });
});

/* ----------------------------------------------------- fake worker seam -- */

class FakeWorker {
  onmessage: ((event: MessageEvent<PoolOutMessage>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly posted: PoolInMessage[] = [];
  terminated = false;

  constructor(public readonly url: URL) {}

  postMessage(msg: PoolInMessage): void {
    this.posted.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(msg: PoolOutMessage): void {
    this.onmessage?.({ data: msg } as MessageEvent<PoolOutMessage>);
  }
}

function makePool(workers: number, graph: GpuGraph): {
  handle: PoolLayoutHandle;
  fakes: FakeWorker[];
} {
  const fakes: FakeWorker[] = [];
  const factory = (url: URL): Worker => {
    const fake = new FakeWorker(url);
    fakes.push(fake);
    return fake as unknown as Worker;
  };
  const probe = makeProbe({ cores: workers + 1 });
  const decision = decideTier(probe, { nodes: graph.nodes.length, edges: graph.edges.length }, {
    forceWorkers: workers,
  });
  const handle = new PoolLayoutHandle(graph, undefined, decision, undefined, { workerFactory: factory });
  // Real workers acknowledge init with a `ready` message before the first step.
  for (const fake of fakes) {
    const init = fake.posted.find((m) => m.type === "init");
    if (init && init.type === "init") fake.reply({ type: "ready", workerId: init.workerId });
  }
  return { handle, fakes };
}

function stepMessage(fake: FakeWorker): Extract<PoolInMessage, { type: "step" }> {
  const msg = fake.posted.find((m) => m.type === "step");
  if (!msg || msg.type !== "step") throw new Error("no step message recorded");
  return msg;
}

function replyZeroForce(handle: PoolLayoutHandle, fakes: FakeWorker[]): void {
  for (const fake of fakes) {
    const step = stepMessage(fake);
    const init = fake.posted.find((m) => m.type === "init");
    if (!init || init.type !== "init") throw new Error("no init message");
    const start = init.shardStart[init.workerId];
    const end = init.shardStart[init.workerId + 1];
    fake.reply({
      type: "tick",
      workerId: init.workerId,
      epoch: step.epoch,
      fx: new Float32Array(end - start),
      fy: new Float32Array(end - start),
      remoteIndex: new Uint32Array(0),
      remoteFx: new Float32Array(0),
      remoteFy: new Float32Array(0),
      stageMs: { buildGridMs: 0, repulsionMs: 0, springsMs: 0 },
    });
  }
}

describe("t063 pool — coordinator behaviour", () => {
  it("broadcasts a step, merges force slices and advances targets once per tick", async () => {
    const graph = ring(12);
    const { handle, fakes } = makePool(2, graph);
    const ticks: number[] = [];
    handle.onTick(() => ticks.push(handle.targets.version));

    handle.start();
    await sleep(30);
    expect(fakes.every((f) => f.posted.some((m) => m.type === "step"))).toBe(true);

    replyZeroForce(handle, fakes);
    expect(handle.targets.version).toBe(1);
    expect(ticks).toEqual([1]);
    expect(handle.stats().tickCount).toBe(1);
    handle.destroy();
  });

  it("freeze() stops the tick loop without leaving a scheduled step", async () => {
    const { handle, fakes } = makePool(2, ring(12));
    handle.start();
    await sleep(30);
    const afterFirst = fakes[0].posted.filter((m) => m.type === "step").length;
    handle.freeze();
    await sleep(30);
    const afterFreeze = fakes[0].posted.filter((m) => m.type === "step").length;
    expect(afterFreeze).toBe(afterFirst);
    expect(handle.stats().frozen).toBe(true);
    handle.destroy();
  });

  it("wake() coalesces into a neighbourhood set and leaves other nodes untouched", async () => {
    const { handle, fakes } = makePool(2, ring(12));
    handle.wake([0]);
    handle.start();
    await sleep(30);

    const step = stepMessage(fakes[0]);
    const wakeSet = step.wakeSet ? Array.from(step.wakeSet) : [];
    expect([...wakeSet].sort((a, b) => a - b)).toEqual([0, 1, 11]);
    expect(handle.stats().queueDepth).toBe(0);

    const before = { x: handle.targets.x.slice(), y: handle.targets.y.slice() };
    replyZeroForce(handle, fakes);
    // nodes outside the 1-hop set keep their target position exactly.
    for (const i of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(handle.targets.x[i]).toBe(before.x[i]);
      expect(handle.targets.y[i]).toBe(before.y[i]);
    }
    handle.destroy();
  });

  it("destroy() terminates every fake worker and stays idempotent", async () => {
    const { handle, fakes } = makePool(2, ring(12));
    handle.start();
    await sleep(20);
    handle.destroy();
    handle.destroy();
    expect(fakes.every((f) => f.terminated)).toBe(true);
    expect(handle.stats().workers).toBe(0);
  });

  it("drops a failed worker and degrades to main when the pool dies", async () => {
    const graph = ring(12);
    const fakes: FakeWorker[] = [];
    const factory = (url: URL): Worker => {
      const fake = new FakeWorker(url);
      fakes.push(fake);
      return fake as unknown as Worker;
    };
    const probe = makeProbe({ cores: 3 });
    const decision = decideTier(probe, { nodes: graph.nodes.length, edges: graph.edges.length }, {
      forceWorkers: 2,
    });
    const handle = new PoolLayoutHandle(graph, undefined, decision, undefined, { workerFactory: factory });

    fakes[0].onerror?.();
    expect(handle.stats().workers).toBe(1);
    fakes[1].onerror?.();
    expect(handle.mode).toBe("main");
    handle.destroy();
  });

  it("reports every contract stats field plus optional pool diagnostics", () => {
    const { handle } = makePool(2, ring(12));
    const stats = handle.stats();
    for (const key of [
      "workers",
      "cores",
      "tier",
      "tierReason",
      "sab",
      "wasm",
      "frozen",
      "tickMedianMs",
      "tickP95Ms",
      "tickCount",
      "queueDepth",
      "droppedTicks",
    ]) {
      expect(stats).toHaveProperty(key);
    }
    expect(stats.shardCount).toBe(2);
    expect(stats.workerBytes?.length).toBe(2);
    expect(stats.stageMs).toBeDefined();
    handle.destroy();
  });
});

/* ----------------------------------------------------- main fallback gate -- */

describe("t063 pool — tier-C main fallback", () => {
  it("refuses a full tick above the node limit and surfaces the reason", async () => {
    const graph = ring(100);
    const handle = createAsyncLayout(graph, undefined, { mainTickNodeLimit: 50 });
    expect(handle.mode).toBe("main");
    expect(handle.stats().tierReason).toContain("over-main-limit");
    handle.start();
    await sleep(60);
    expect(handle.stats().tickCount).toBe(0);
    handle.destroy();
  });

  it("runs throttled ticks under the limit and keeps the fingerprint kernel", async () => {
    const graph = ring(40);
    const handle = createAsyncLayout(graph, { seed: 1234 });
    handle.start();
    await sleep(80);
    expect(handle.stats().tickCount).toBeGreaterThan(0);
    expect(handle.stats().tier).toBe("C");
    handle.destroy();
  });
});
