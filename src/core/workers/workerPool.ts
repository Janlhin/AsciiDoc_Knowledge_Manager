/**
 * Singleton WorkerPool (T-063 / Issue #21) for ADKM.
 *
 * What this pool owns:
 *  - a bounded number of reusable lanes (one worker per lane, sticky by kind);
 *  - a priority queue (`input` > `visible` > `background`, FIFO within a class);
 *  - optional same-key dedupe of pending tasks;
 *  - abortable tasks with no orphan message listeners left behind;
 *  - four-segment timings per task (queue / transfer / compute / return);
 *  - 30 s idle reclamation and full teardown on app exit.
 *
 * What it deliberately does NOT own: DOM, React, CodeMirror input, iframe
 * layout. Workers return plain serialisable data only; large binary inputs go
 * through transferables where the caller can guarantee ownership.
 *
 * `src/core` stays framework-free: callers supply the worker module URL built
 * against their own `import.meta.url`, so Vite bundles each worker entry.
 */
import {
  classifyTier,
  downgrade,
  readProbe,
  type Tier,
  type TierDecision,
  type TierProbe,
} from "./tier";
import {
  PRIORITY_RANK,
  type PoolStats,
  type TaskPriority,
  type TaskRecord,
  type TaskTimings,
  type WorkerSpec,
} from "./types";

const IDLE_TIMEOUT_MS = 30_000;
const HISTORY_LIMIT = 50;

/** Thrown when the pool cannot run off-thread (tier C / broken). Callers fall
 *  back to their in-page path, exactly like the pre-pool Worker fallback. */
export class PoolUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoolUnavailableError";
  }
}

export class TaskCanceledError extends Error {
  constructor() {
    super("worker task canceled");
    this.name = "AbortError";
  }
}

export interface SubmitOptions<T> {
  spec: WorkerSpec;
  /** message body sent to the worker; the pool adds `id`. */
  payload: Record<string, unknown>;
  /** transferable list handed to `postMessage`. */
  transfer?: Transferable[];
  priority: TaskPriority;
  /** identical pending tasks with this key merge onto the same promise. */
  dedupeKey?: string;
  signal?: AbortSignal;
  /** extract the result from the worker reply; throws on a malformed reply. */
  decode: (reply: Record<string, unknown>) => T;
}

interface PendingTask {
  id: number;
  spec: WorkerSpec;
  priority: TaskPriority;
  dedupeKey: string | null;
  payload: Record<string, unknown>;
  transfer: Transferable[];
  decode: (reply: Record<string, unknown>) => unknown;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  record: TaskRecord;
  resultPromise: Promise<unknown>;
}

interface Lane {
  id: number;
  kind: string | null;
  worker: Worker | null;
  busy: boolean;
  lastActiveAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  current: PendingTask | null;
}

export interface PoolHooks {
  now: () => number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  createWorker: (spec: WorkerSpec) => Worker;
  probe: () => TierProbe;
}

const defaultHooks: PoolHooks = {
  now: () => performance.now(),
  setTimeout,
  clearTimeout,
  createWorker: (spec) => spec.create(),
  probe: () =>
    readProbe({
      hardwareConcurrency: navigator.hardwareConcurrency,
      workerAvailable: typeof Worker !== "undefined",
      sabAvailable: typeof globalThis.SharedArrayBuffer !== "undefined",
    }),
};

function emptyTimings(): TaskTimings {
  return { queueMs: 0, transferMs: 0, computeMs: 0, returnMs: 0, totalMs: 0 };
}

class WorkerPool {
  private readonly hooks: PoolHooks;
  private decision: TierDecision | null = null;
  private forceTier: Tier | null = null;
  private lanes: Lane[] = [];
  private queue: PendingTask[] = [];
  private byId = new Map<number, PendingTask>();
  private nextId = 1;
  private history: TaskRecord[] = [];
  private broken = false;
  private disposed = false;

  constructor(hooks: Partial<PoolHooks> = {}) {
    this.hooks = { ...defaultHooks, ...hooks };
  }

  /* ------------------------------- tier ------------------------------- */

  private ensureDecision(): TierDecision {
    if (this.decision === null) {
      this.decision = classifyTier(this.hooks.probe(), this.forceTier);
    }
    return this.decision;
  }

  /** Override the hardware tier (tests / diagnostics). Null restores the
   *  probed decision. A shrink reclaims excess free lanes immediately. */
  setForceTier(tier: Tier | null): void {
    this.forceTier = tier;
    this.decision = classifyTier(this.hooks.probe(), tier);
    this.broken = false;
    this.reclaimExcessLanes();
  }

  /** Whether off-thread work is permitted right now. */
  isWorkerEnabled(): boolean {
    const d = this.ensureDecision();
    return d.lanes > 0 && !this.broken && !this.disposed;
  }

  /** True once a lane for this kind has actually been spawned. */
  hasActiveKind(kind: string): boolean {
    return this.lanes.some((lane) => lane.worker !== null && lane.kind === kind);
  }

  /* ----------------------------- submission ---------------------------- */

  submit<T>(options: SubmitOptions<T>): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new PoolUnavailableError("pool disposed"));
    }
    const decision = this.ensureDecision();
    if (decision.lanes === 0 || this.broken) {
      return Promise.reject(
        new PoolUnavailableError(`pool tier ${decision.tier}: ${decision.tierReason}`),
      );
    }

    // Dedupe: an already queued/running task with the same key answers both.
    if (options.dedupeKey !== undefined) {
      const existing = this.queue.find((t) => t.dedupeKey === options.dedupeKey);
      if (existing) return existing.resultPromise as Promise<T>;
      const running = [...this.byId.values()].find(
        (t) => t.dedupeKey === options.dedupeKey && t.record.status === "running",
      );
      if (running) return running.resultPromise as Promise<T>;
    }

    const id = this.nextId;
    this.nextId += 1;
    const record: TaskRecord = {
      id,
      kind: options.spec.kind,
      priority: options.priority,
      dedupeKey: options.dedupeKey ?? null,
      status: "queued",
      queuedAt: this.hooks.now(),
      startedAt: null,
      finishedAt: null,
      timings: emptyTimings(),
    };

    let resolve!: (value: unknown) => void;
    let reject!: (err: Error) => void;
    const resultPromise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const task: PendingTask = {
      id,
      spec: options.spec,
      priority: options.priority,
      dedupeKey: options.dedupeKey ?? null,
      payload: options.payload,
      transfer: options.transfer ?? [],
      decode: options.decode,
      resolve,
      reject,
      record,
      resultPromise,
    };

    if (options.signal) {
      if (options.signal.aborted) {
        this.cancelTask(task);
        return task.resultPromise as Promise<T>;
      }
      options.signal.addEventListener(
        "abort",
        () => this.cancelTask(task),
        { once: true },
      );
    }

    this.queue.push(task);
    this.byId.set(id, task);
    this.dispatch();
    return task.resultPromise as Promise<T>;
  }

  private cancelTask(task: PendingTask): void {
    if (task.record.status === "ok" || task.record.status === "error") return;
    if (task.record.status === "canceled") return;
    this.queue = this.queue.filter((t) => t !== task);
    if (task.record.status === "running") {
      // The worker keeps computing, but its late reply is ignored; the lane
      // frees itself when that reply arrives. No listener is retained.
      task.record.status = "canceled";
    } else {
      task.record.status = "canceled";
    }
    this.finishRecord(task);
    this.byId.delete(task.id);
    task.reject(new TaskCanceledError());
  }

  /* ----------------------------- scheduling ---------------------------- */

  private dispatch(): void {
    if (this.disposed) return;
    while (this.queue.length > 0) {
      const task = this.nextTask();
      if (task === null) break;
      const lane = this.acquireLane(task);
      if (lane === null) {
        // No lane available: put the task back at the head and wait.
        this.queue.unshift(task);
        break;
      }
      this.assign(lane, task);
    }
  }

  /**
   * Pick a lane for a task: reuse a free lane of the same kind first; open a
   * fresh lane while capacity remains; only recreate a different-kind worker
   * when at capacity. Same-kind reuse keeps the warmed-up module in the lane.
   */
  private acquireLane(task: PendingTask): Lane | null {
    const free = this.lanes.filter((lane) => !lane.busy);
    const sameKind = free.find((lane) => lane.kind === task.spec.kind);
    if (sameKind) return sameKind;
    if (this.lanes.length < this.ensureDecision().lanes) return this.openLane();
    return free[0] ?? null;
  }

  private nextTask(): PendingTask | null {
    if (this.queue.length === 0) return null;
    this.queue.sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.record.queuedAt - b.record.queuedAt,
    );
    return this.queue.shift() ?? null;
  }

  private openLane(): Lane | null {
    if (this.lanes.length >= this.ensureDecision().lanes) return null;
    const lane: Lane = {
      id: this.nextId++,
      kind: null,
      worker: null,
      busy: false,
      lastActiveAt: this.hooks.now(),
      idleTimer: null,
      current: null,
    };
    this.lanes.push(lane);
    return lane;
  }

  private assign(lane: Lane, task: PendingTask): void {
    this.queue = this.queue.filter((t) => t !== task);
    const startedAt = this.hooks.now();
    task.record.startedAt = startedAt;
    task.record.timings.queueMs = startedAt - task.record.queuedAt;
    task.record.status = "running";

    if (lane.worker !== null && lane.kind !== task.spec.kind) {
      this.teardownWorker(lane);
    }
    if (lane.worker === null) {
      try {
        lane.worker = this.hooks.createWorker(task.spec);
      } catch (err) {
        this.handleSpawnFailure(lane, task, err);
        return;
      }
      lane.kind = task.spec.kind;
      lane.worker.onmessage = (event: MessageEvent) => this.handleReply(lane, event);
      lane.worker.onerror = () => this.handleLaneError(lane);
    }

    lane.busy = true;
    lane.current = task;
    lane.lastActiveAt = startedAt;
    if (lane.idleTimer !== null) {
      this.hooks.clearTimeout(lane.idleTimer);
      lane.idleTimer = null;
    }

    const message: Record<string, unknown> = { id: task.id, ...task.payload };
    const t0 = this.hooks.now();
    try {
      lane.worker.postMessage(message, task.transfer);
    } catch (err) {
      this.settle(task, "error", undefined, err instanceof Error ? err : new Error(String(err)));
      this.releaseLane(lane);
      this.dispatch();
      return;
    }
    task.record.timings.transferMs = this.hooks.now() - t0;
  }

  private handleReply(lane: Lane, event: MessageEvent): void {
    const reply = event.data as Record<string, unknown>;
    const task = lane.current;
    if (task === null || reply.id !== task.id) {
      // Stale reply for a canceled/finished task: ignore, no listener retained.
      return;
    }
    const replyAt = this.hooks.now();
    const rawError = reply.error;
    if (typeof rawError === "string" && rawError !== "") {
      this.settle(task, "error", undefined, new Error(rawError));
      this.releaseLane(lane);
      this.dispatch();
      return;
    }
    let value: unknown;
    const t0 = this.hooks.now();
    try {
      value = task.decode(reply);
    } catch (err) {
      this.settle(task, "error", undefined, err instanceof Error ? err : new Error(String(err)));
      this.releaseLane(lane);
      this.dispatch();
      return;
    }
    task.record.timings.returnMs = this.hooks.now() - t0;
    const reportedCompute = reply.computeMs;
    task.record.timings.computeMs =
      typeof reportedCompute === "number" && Number.isFinite(reportedCompute)
        ? reportedCompute
        : replyAt - (task.record.startedAt ?? replyAt);
    this.settle(task, "ok", value);
    this.releaseLane(lane);
    this.dispatch();
  }

  private handleLaneError(lane: Lane): void {
    const task = lane.current;
    this.teardownWorker(lane);
    if (task !== null) {
      this.settle(task, "error", undefined, new Error("worker failed"));
      this.releaseLane(lane);
    }
    // A dead lane means the environment or module is hostile; mark the pool
    // broken so subsequent submits fail fast and callers fall back in-page.
    this.broken = true;
    this.decision = downgrade(this.ensureDecision(), "worker-error");
    this.dispatch();
  }

  private handleSpawnFailure(lane: Lane, task: PendingTask, err: unknown): void {
    this.teardownWorker(lane);
    this.lanes = this.lanes.filter((l) => l !== lane);
    this.broken = true;
    this.decision = downgrade(this.ensureDecision(), "worker-spawn-failed");
    this.settle(
      task,
      "error",
      undefined,
      err instanceof Error ? err : new PoolUnavailableError(String(err)),
    );
    this.releaseLane(lane);
    this.dispatch();
  }

  private settle(
    task: PendingTask,
    status: TaskRecord["status"],
    result: unknown,
    error?: Error,
  ): void {
    if (task.record.status === "canceled") {
      // Already aborted; do not overwrite with the late outcome.
      return;
    }
    task.record.status = status;
    task.record.finishedAt = this.hooks.now();
    task.record.timings.totalMs = task.record.finishedAt - task.record.queuedAt;
    this.byId.delete(task.id);
    this.finishRecord(task);
    if (status === "ok") task.resolve(result);
    else task.reject(error ?? new Error("task failed"));
  }

  private releaseLane(lane: Lane): void {
    lane.busy = false;
    lane.current = null;
    lane.lastActiveAt = this.hooks.now();
    this.scheduleIdle(lane);
  }

  private scheduleIdle(lane: Lane): void {
    if (lane.worker === null || this.disposed) return;
    if (lane.idleTimer !== null) this.hooks.clearTimeout(lane.idleTimer);
    lane.idleTimer = this.hooks.setTimeout(() => {
      lane.idleTimer = null;
      if (!lane.busy) this.reclaimLane(lane);
    }, IDLE_TIMEOUT_MS);
  }

  private reclaimLane(lane: Lane): void {
    if (lane.busy) return;
    this.teardownWorker(lane);
  }

  private reclaimExcessLanes(): void {
    const capacity = this.ensureDecision().lanes;
    let freeKept = 0;
    for (const lane of this.lanes) {
      if (lane.busy) continue;
      freeKept += 1;
      if (freeKept > capacity) this.teardownWorker(lane);
    }
    this.lanes = this.lanes.filter((lane) => lane.worker !== null || lane.busy);
  }

  private teardownWorker(lane: Lane): void {
    if (lane.idleTimer !== null) {
      this.hooks.clearTimeout(lane.idleTimer);
      lane.idleTimer = null;
    }
    if (lane.worker !== null) {
      try {
        lane.worker.terminate();
      } catch {
        /* already gone */
      }
      lane.worker = null;
    }
    lane.kind = null;
  }

  private finishRecord(task: PendingTask): void {
    this.history.push(task.record);
    if (this.history.length > HISTORY_LIMIT) {
      this.history.splice(0, this.history.length - HISTORY_LIMIT);
    }
  }

  /* ------------------------------ teardown ----------------------------- */

  /** App exit / view dispose: reject everything queued and terminate workers. */
  terminateAll(): void {
    this.disposed = true;
    for (const task of this.queue) {
      task.record.status = "canceled";
      this.byId.delete(task.id);
      task.reject(new TaskCanceledError());
    }
    this.queue = [];
    for (const lane of this.lanes) {
      if (lane.current !== null) {
        lane.current.record.status = "canceled";
        this.byId.delete(lane.current.id);
        lane.current.reject(new TaskCanceledError());
      }
      this.teardownWorker(lane);
    }
    this.lanes = [];
  }

  /** Test-only: drop singleton state between cases. */
  resetForTests(): void {
    this.terminateAll();
    this.decision = null;
    this.forceTier = null;
    this.broken = false;
    this.disposed = false;
    this.history = [];
    this.nextId = 1;
  }

  /* ------------------------------- stats ------------------------------- */

  getPoolStats(): PoolStats {
    const decision = this.ensureDecision();
    const now = this.hooks.now();
    const queueByPriority: Record<TaskPriority, number> = {
      input: 0,
      visible: 0,
      background: 0,
    };
    for (const task of this.queue) queueByPriority[task.priority] += 1;
    return {
      tier: decision.tier,
      tierReason: decision.tierReason,
      laneCapacity: decision.lanes,
      activeWorkers: this.lanes.map((lane) => ({
        kind: lane.kind,
        busy: lane.busy,
        idleForMs: lane.worker === null ? 0 : now - lane.lastActiveAt,
      })),
      queueDepth: this.queue.length,
      queueByPriority,
      tasks: [...this.history],
      degraded: this.broken || decision.lanes === 0,
    };
  }
}

/** Process-wide singleton. */
export const workerPool = new WorkerPool();

/** Test-only factory: an isolated pool with injected hooks. */
export function createPool(hooks: Partial<PoolHooks> = {}): WorkerPool {
  return new WorkerPool(hooks);
}
