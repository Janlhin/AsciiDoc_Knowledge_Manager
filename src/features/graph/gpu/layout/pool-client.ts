/**
 * T-063 (#20) — shard pool coordinator (main thread).
 *
 * Owns the canonical layout state and drives one worker per shard. Workers are
 * force proposers: they post force slices back, the coordinator sums them and
 * runs the integration pass, so positions and velocity have a single source of
 * truth. Sync transport follows the tier decision:
 *
 *  - SAB: snapshot positions live in `SharedArrayBuffer`s shared with workers;
 *    completion still arrives via postMessage (the main thread never calls
 *    `Atomics.wait`).
 *  - transferable: the snapshot clones out with each `step`; worker force
 *    slices come back as messages.
 *
 * Freeze / local relayout (#19 route A): `freeze()` stops the tick loop;
 * `wake(indices)` coalesces into one local neighbourhood set (1 hop,
 * configurable constant below) and a single local tick integrates only that
 * set. Every other node keeps its target position untouched.
 */
import { LAYOUT_DEFAULTS } from "../types";
import type { GpuGraph, LayoutOptions, LayoutState } from "../types";
import type {
  AsyncLayoutHandle,
  LayoutClientOptions,
  LayoutMode,
  LayoutStats,
  LayoutTargets,
} from "../layout-api";
import { estimatePerWorkerBytes, type TierDecision } from "./tier";
import {
  buildAdjacency,
  buildShardPlan,
  localNeighborhood,
  shardSummaries,
  type Adjacency,
  type ShardPlan,
  type ShardSummary,
} from "./shard";
import type { PoolInMessage, PoolOutMessage, PoolTickMessage } from "./protocol";
import { MainLayoutHandle } from "./main-handle";

/** neighbourhood hops for `wake()`; 2 hops are more natural but cost more. */
const WAKE_HOPS = 1;
/** frame cadence driving the pool tick loop. */
const FRAME_MS = 16;
/** rolling sample window for tick timing statistics. */
const SAMPLE_WINDOW = 64;
/** alpha floor; below it the layout is settled. */
const ALPHA_MIN = 1e-3;
const DAMPING = 0.9;

/** Worker constructor seam for unit tests; defaults to the real `Worker`. */
export type WorkerFactory = (url: URL) => Worker;

class TargetsHolder implements LayoutTargets {
  readonly count: number;
  x: Float32Array;
  y: Float32Array;
  version = 0;

  constructor(x: Float32Array, y: Float32Array) {
    this.count = x.length;
    this.x = x;
    this.y = y;
  }

  bump(): void {
    this.version += 1;
  }
}

/** xorshift32 for the seeded disk spread; mirrors the single-thread kernel. */
function seededPositions(n: number, opts: LayoutOptions): { x: Float32Array; y: Float32Array } {
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  let s = (opts.seed >>> 0) || LAYOUT_DEFAULTS.seed >>> 0;
  const next = (): number => {
    s ^= (s << 13) >>> 0;
    s ^= s >>> 17;
    s ^= (s << 5) >>> 0;
    s >>>= 0;
    return s / 4294967296;
  };
  const spread = opts.linkDistance * Math.sqrt(Math.max(n, 1)) * 0.5;
  const TAU = Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const angle = next() * TAU;
    const radius = spread * Math.sqrt(next());
    x[i] = Math.cos(angle) * radius;
    y[i] = Math.sin(angle) * radius;
  }
  return { x, y };
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}

interface StageAccum {
  buildGridMs: number;
  repulsionMs: number;
  springsMs: number;
}

export class PoolLayoutHandle implements AsyncLayoutHandle {
  get mode(): LayoutMode {
    if (this.delegate) return "main";
    return this.workers.length <= 1 ? "single" : "pool";
  }
  /** lightweight positions holder; the pool keeps no force kernel on the main thread. */
  readonly layout: LayoutState;
  readonly targets: TargetsHolder;

  private readonly graph: GpuGraph;
  private readonly opts?: Partial<LayoutOptions>;
  private readonly client?: LayoutClientOptions;
  private decision: TierDecision;
  private readonly plan: ShardPlan;
  private readonly adj: Adjacency;
  private readonly mass: Float32Array;
  private readonly es: Int32Array;
  private readonly et: Int32Array;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly ax: Float32Array;
  private readonly ay: Float32Array;

  private workers: { id: number; worker: Worker }[] = [];
  private readonly workerFactory?: WorkerFactory;
  private readonly callbacks = new Set<() => void>();
  private delegate: MainLayoutHandle | null = null;
  private readonly delegateSubs = new Map<() => void, () => void>();

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private frozenFlag = false;
  private refreeze = false;
  private destroyed = false;
  private settledFlag = false;
  private inFlight = false;
  private epoch = 0;
  private replies = 0;
  private stepStart = 0;
  private readyCount = 0;

  private pendingWake: number[] = [];
  private lastWakeSet: Int32Array | null = null;
  private tickCount = 0;
  private droppedTicks = 0;
  private queueDepth = 0;
  private readonly samples: number[] = [];
  private alphaVal = 1;
  private lastStage: StageAccum = { buildGridMs: 0, repulsionMs: 0, springsMs: 0 };
  private summaries: ShardSummary;
  private pinnedIndex = -1;
  private pinnedX = 0;
  private pinnedY = 0;

  constructor(
    graph: GpuGraph,
    opts: Partial<LayoutOptions> | undefined,
    decision: TierDecision,
    client?: LayoutClientOptions,
    deps?: { workerFactory?: WorkerFactory },
  ) {
    this.graph = graph;
    this.opts = opts;
    this.client = client;
    this.decision = decision;
    this.workerFactory = deps?.workerFactory;

    const options: LayoutOptions = { ...LAYOUT_DEFAULTS, ...(opts ?? {}) };
    const n = graph.nodes.length;
    const initial = seededPositions(n, options);

    this.plan = buildShardPlan(graph, Math.max(1, decision.workers), initial);
    this.adj = buildAdjacency(graph);
    this.mass = new Float32Array(n);
    for (let i = 0; i < n; i++) this.mass[i] = graph.nodes[i].degree + 1;
    this.es = new Int32Array(graph.edges.map((e) => e.source));
    this.et = new Int32Array(graph.edges.map((e) => e.target));

    this.x = initial.x;
    this.y = initial.y;
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.ax = new Float32Array(n);
    this.ay = new Float32Array(n);
    this.summaries = shardSummaries(this.plan, this.x, this.y, this.mass);

    this.targets = new TargetsHolder(this.x, this.y);
    this.layout = { count: n, x: this.x, y: this.y } as unknown as LayoutState;

    this.spawnWorkers(options);
  }

  /* ---------------------------------------------------------- lifecycle -- */

  start(): void {
    if (this.destroyed) return;
    this.frozenFlag = false;
    if (this.delegate) {
      this.delegate.start();
      return;
    }
    if (this.running) return;
    this.running = true;
    // Do not dispatch the first step until every worker has acknowledged init;
    // a still-initializing worker would drop the epoch and hang finalizeTick.
    if (this.readyCount === this.workers.length) this.schedule();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    if (this.delegate) this.delegate.stop();
  }

  freeze(): void {
    this.frozenFlag = true;
    this.stop();
  }

  thaw(): void {
    this.start();
  }

  wake(indices: readonly number[]): void {
    if (this.destroyed) return;
    if (this.delegate) {
      this.delegate.wake(indices);
      return;
    }
    const neigh = localNeighborhood(this.adj, indices, WAKE_HOPS);
    const merged = new Set(this.pendingWake);
    for (const i of neigh) merged.add(i);
    this.pendingWake = [...merged].sort((a, b) => a - b);
    this.queueDepth = this.pendingWake.length;

    if (this.frozenFlag) {
      // local tick only: run one narrowed pass, then freeze again (#19 route A)
      this.refreeze = true;
      this.frozenFlag = false;
      this.running = true;
    }
    this.schedule();
  }

  pin(index: number, x: number, y: number): void {
    this.pinnedIndex = index;
    this.pinnedX = x;
    this.pinnedY = y;
    this.x[index] = x;
    this.y[index] = y;
    this.vx[index] = 0;
    this.vy[index] = 0;
    if (this.delegate) this.delegate.pin(index, x, y);
  }

  unpin(index: number): void {
    if (this.pinnedIndex === index) this.pinnedIndex = -1;
    if (this.delegate) this.delegate.unpin(index);
  }

  onTick(cb: () => void): () => void {
    this.callbacks.add(cb);
    if (this.delegate) {
      this.delegateSubs.set(cb, this.delegate.onTick(cb));
    }
    return () => {
      this.callbacks.delete(cb);
      const sub = this.delegateSubs.get(cb);
      if (sub) {
        sub();
        this.delegateSubs.delete(cb);
      }
    };
  }

  settled(): boolean {
    if (this.delegate) return this.delegate.settled();
    return this.settledFlag || this.alphaVal <= ALPHA_MIN;
  }

  stats(): LayoutStats {
    if (this.delegate) return this.delegate.stats();
    const sorted = [...this.samples].sort((a, b) => a - b);
    const perWorker = estimatePerWorkerBytes({
      nodes: this.graph.nodes.length,
      edges: this.graph.edges.length,
    });
    return {
      workers: this.workers.length,
      cores: Math.max(1, Math.floor(typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 1 : 1)),
      tier: this.decision.tier,
      tierReason: this.decision.tierReason,
      sab: this.decision.sab,
      wasm: this.decision.wasm,
      frozen: this.frozenFlag,
      tickMedianMs: quantile(sorted, 0.5),
      tickP95Ms: quantile(sorted, 0.95),
      tickCount: this.tickCount,
      queueDepth: this.queueDepth,
      droppedTicks: this.droppedTicks,
      shardCount: this.plan.shardCount,
      workerBytes: this.workers.map(() => perWorker),
      stageMs: {
        buildGridMs: this.lastStage.buildGridMs,
        buildQuadtreeMs: 0,
        repulsionMs: this.lastStage.repulsionMs,
        springsMs: this.lastStage.springsMs,
        integrateMs: 0,
        totalMs: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
      },
    };
  }

  /** internal coordinator state for benchmark diagnostics; not part of the frozen contract. */
  get debugState(): { ready: number; replies: number; inFlight: boolean; workers: number; epoch: number } {
    return { ready: this.readyCount, replies: this.replies, inFlight: this.inFlight, workers: this.workers.length, epoch: this.epoch };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    this.callbacks.clear();
    for (const entry of this.workers) {
      try {
        entry.worker.terminate();
      } catch {
        // already gone
      }
    }
    this.workers = [];
    if (this.delegate) this.delegate.destroy();
  }

  /* --------------------------------------------------------- internals -- */

  private spawnWorkers(options: LayoutOptions): void {
    const url = new URL("./pool-worker.ts", import.meta.url);
    const n = this.graph.nodes.length;
    const sab = this.decision.sab;
    let sabX: ArrayBuffer | undefined;
    let sabY: ArrayBuffer | undefined;
    if (sab) {
      sabX = new ArrayBuffer(n * 4);
      sabY = new ArrayBuffer(n * 4);
      new Float32Array(sabX).set(this.x);
      new Float32Array(sabY).set(this.y);
    }

    for (let wid = 0; wid < this.decision.workers; wid++) {
      const worker = this.workerFactory
        ? this.workerFactory(url)
        : new Worker(url, { type: "module" });
      this.attachWorker(worker, wid);
      this.workers.push({ id: wid, worker });
      const init: PoolInMessage = {
        type: "init",
        workerId: wid,
        shardCount: this.plan.shardCount,
        shardOf: this.plan.shardOf,
        shardStart: this.plan.shardStart,
        shardNodes: this.plan.shardNodes,
        edgeStart: this.plan.edgeStart,
        edgeByShard: this.plan.edgeByShard,
        es: this.es,
        et: this.et,
        mass: this.mass,
        opts: this.opts ?? {},
        hops: WAKE_HOPS,
        x: this.x,
        y: this.y,
        sab,
        sabX,
        sabY,
      };
      worker.postMessage(init);
    }
  }

  private attachWorker(worker: Worker, wid: number): void {
    worker.onmessage = (event: MessageEvent<PoolOutMessage>) => {
      if (this.delegate || this.destroyed) return;
      const msg = event.data;
      if (msg.type === "ready") {
        this.readyCount += 1;
        if (this.readyCount === this.workers.length && this.running) this.schedule();
      } else if (msg.type === "tick") {
        this.onTickMessage(wid, msg);
      } else if (msg.type === "error") {
        this.onWorkerError(wid, msg.message);
      }
    };
    worker.onerror = () => this.onWorkerError(wid, "worker error event");
  }

  private onTickMessage(wid: number, msg: PoolTickMessage): void {
    if (msg.epoch !== this.epoch || this.inFlight === false) return;

    const start = this.plan.shardStart[wid];
    const end = this.plan.shardStart[wid + 1];
    for (let k = start; k < end; k++) {
      const node = this.plan.shardNodes[k];
      const slot = k - start;
      this.ax[node] += msg.fx[slot];
      this.ay[node] += msg.fy[slot];
    }
    for (const r of msg.remote) {
      this.ax[r.index] += r.fx;
      this.ay[r.index] += r.fy;
    }

    this.lastStage.buildGridMs = Math.max(this.lastStage.buildGridMs, msg.stageMs.buildGridMs);
    this.lastStage.repulsionMs = Math.max(this.lastStage.repulsionMs, msg.stageMs.repulsionMs);
    this.lastStage.springsMs = Math.max(this.lastStage.springsMs, msg.stageMs.springsMs);

    this.replies += 1;
    if (this.replies === this.workers.length) this.finalizeTick();
  }

  private onWorkerError(wid: number, message: string): void {
    if (this.destroyed || this.delegate) return;
    const entry = this.workers.find((w) => w.id === wid);
    if (entry) {
      try {
        entry.worker.terminate();
      } catch {
        // already gone
      }
    }
    this.workers = this.workers.filter((w) => w.id !== wid);
    if (this.workers.length === 0) {
      this.goMain();
      return;
    }
    this.decision = {
      ...this.decision,
      tierReason: `worker-${wid} failed (${message}); ${this.workers.length} remaining`,
    };
  }

  private goMain(): void {
    if (this.delegate) return;
    for (const entry of this.workers) {
      try {
        entry.worker.terminate();
      } catch {
        // already gone
      }
    }
    this.workers = [];
    this.delegate = new MainLayoutHandle(this.graph, this.opts, this.client, "worker-pool-failed");
    for (const cb of this.callbacks) {
      this.delegateSubs.set(cb, this.delegate.onTick(cb));
    }
    if (this.running) this.delegate.start();
  }

  private schedule(): void {
    if (this.destroyed || this.frozenFlag || !this.running) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.step(), FRAME_MS);
  }

  private step(): void {
    if (this.destroyed || this.frozenFlag || this.delegate) return;
    if (this.readyCount < this.workers.length) {
      this.schedule();
      return;
    }
    if (this.inFlight) {
      this.droppedTicks += 1;
      this.schedule();
      return;
    }
    this.inFlight = true;
    this.epoch += 1;
    this.replies = 0;
    this.stepStart = performance.now();
    this.ax.fill(0);
    this.ay.fill(0);

    this.lastWakeSet = this.pendingWake.length > 0 ? Int32Array.from(this.pendingWake) : null;
    this.pendingWake = [];
    this.queueDepth = 0;
    this.summaries = shardSummaries(this.plan, this.x, this.y, this.mass);

    const summaries = {
      comX: this.summaries.comX,
      comY: this.summaries.comY,
      mass: this.summaries.mass,
    };
    for (const entry of this.workers) {
      const msg: PoolInMessage = {
        type: "step",
        epoch: this.epoch,
        wakeSet: this.lastWakeSet ?? undefined,
        summaries,
        snapshotX: this.x,
        snapshotY: this.y,
      };
      entry.worker.postMessage(msg);
    }
  }

  private finalizeTick(): void {
    this.inFlight = false;
    const elapsed = performance.now() - this.stepStart;
    this.samples.push(elapsed);
    if (this.samples.length > SAMPLE_WINDOW) this.samples.shift();

    const options = { ...LAYOUT_DEFAULTS, ...(this.opts ?? {}) };
    this.alphaVal = Math.max(this.alphaVal * (1 - options.alphaDecay), ALPHA_MIN);
    if (this.alphaVal <= ALPHA_MIN) this.settledFlag = true;

    const active = this.lastWakeSet;
    const integrateNode = (i: number): void => {
      this.ax[i] -= options.gravity * this.x[i];
      this.ay[i] -= options.gravity * this.y[i];
      const nvx = this.vx[i] * DAMPING + this.ax[i] * this.alphaVal;
      const nvy = this.vy[i] * DAMPING + this.ay[i] * this.alphaVal;
      this.vx[i] = nvx;
      this.vy[i] = nvy;
      this.x[i] += nvx;
      this.y[i] += nvy;
    };

    if (active) {
      for (let k = 0; k < active.length; k++) integrateNode(active[k]);
    } else {
      for (let i = 0; i < this.x.length; i++) integrateNode(i);
    }

    if (this.pinnedIndex >= 0) {
      this.x[this.pinnedIndex] = this.pinnedX;
      this.y[this.pinnedIndex] = this.pinnedY;
      this.vx[this.pinnedIndex] = 0;
      this.vy[this.pinnedIndex] = 0;
    }

    this.summaries = shardSummaries(this.plan, this.x, this.y, this.mass);
    this.targets.bump();
    this.tickCount += 1;
    for (const cb of this.callbacks) cb();

    if (this.refreeze) {
      this.refreeze = false;
      this.frozenFlag = true;
      this.running = false;
      return;
    }
    if (this.settledFlag) {
      this.running = false;
      return;
    }
    this.schedule();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
