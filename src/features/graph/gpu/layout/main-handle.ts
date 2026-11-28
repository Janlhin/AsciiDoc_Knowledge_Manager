/**
 * T-063 (#20) — tier-C main-thread fallback handle.
 *
 * Runs the deterministic kernel on the main thread under an 8ms per-tick
 * budget: one tick per timer turn, an over-budget tick defers the next frame
 * so the UI can paint. Graphs above `mainTickNodeLimit` refuse a full tick
 * outright and stay frozen, with the reason visible in `stats().tierReason`.
 *
 * This handle keeps the real {@link LayoutState} kernel (it has to run it), so
 * `handle.layout` stays a full holder here — unlike the pool path, which only
 * keeps a lightweight positions holder on the main thread.
 */
import { createLayout } from "../layout";
import { DEFAULT_MAIN_TICK_NODE_LIMIT } from "./tier";
import type {
  AsyncLayoutHandle,
  LayoutClientOptions,
  LayoutStats,
  LayoutTargets,
} from "../layout-api";
import type { GpuGraph, LayoutOptions, LayoutState } from "../types";

/** main-thread tick budget; an over-budget tick defers the next frame. */
const MAIN_BUDGET_MS = 8;
/** frame cadence when driving the fallback from a timer. */
const FRAME_MS = 16;

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

/** Main-thread fallback: one throttled tick per frame, 8ms budget. */
export class MainLayoutHandle implements AsyncLayoutHandle {
  readonly mode = "main" as const;
  readonly layout: LayoutState;
  readonly targets: TargetsHolder;
  private readonly graph: GpuGraph;
  private readonly opts?: Partial<LayoutOptions>;
  private readonly nodeLimit: number;
  private readonly callbacks = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private frozenFlag = false;
  private settledFlag = false;
  private destroyed = false;
  private tickCount = 0;
  private droppedTicks = 0;
  private tierReason: string;
  private refused = false;

  constructor(
    graph: GpuGraph,
    opts?: Partial<LayoutOptions>,
    client?: LayoutClientOptions,
    reason?: string,
  ) {
    this.graph = graph;
    this.opts = opts;
    this.nodeLimit = client?.mainTickNodeLimit ?? DEFAULT_MAIN_TICK_NODE_LIMIT;
    this.layout = createLayout(graph, opts);
    this.targets = new TargetsHolder(this.layout.x, this.layout.y);

    if (graph.nodes.length > this.nodeLimit) {
      this.refused = true;
      this.tierReason = `over-main-limit: ${graph.nodes.length} > ${this.nodeLimit} nodes; full tick paused`;
    } else {
      this.tierReason = reason ?? "main-fallback";
    }
  }

  start(): void {
    if (this.destroyed || this.refused) return;
    this.frozenFlag = false;
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
  }

  freeze(): void {
    this.frozenFlag = true;
    this.stop();
  }

  thaw(): void {
    this.start();
  }

  /**
   * Local relayout hook. The tier-C kernel runs whole-graph ticks; a narrowed
   * neighbourhood pass is not sharded here (recorded gap). The request is
   * accepted so the contract holds; under the node limit the next throttled
   * tick picks the movement up.
   */
  wake(_indices: readonly number[]): void {
    if (this.refused || this.destroyed) return;
    this.thaw();
  }

  pin(index: number, x: number, y: number): void {
    this.layout.x[index] = x;
    this.layout.y[index] = y;
    this.layout.vx[index] = 0;
    this.layout.vy[index] = 0;
  }

  unpin(_index: number): void {
    // main fallback keeps no pinned record; releasing lets future ticks move it.
  }

  onTick(cb: () => void): () => void {
    this.callbacks.add(cb);
    return () => {
      this.callbacks.delete(cb);
    };
  }

  settled(): boolean {
    return this.settledFlag || this.layout.settled();
  }

  stats(): LayoutStats {
    return {
      workers: 0,
      cores: Math.max(1, Math.floor(typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 1 : 1)),
      tier: "C",
      tierReason: this.tierReason,
      sab: false,
      wasm: false,
      frozen: this.frozenFlag,
      tickMedianMs: 0,
      tickP95Ms: 0,
      tickCount: this.tickCount,
      queueDepth: 0,
      droppedTicks: this.droppedTicks,
      stageMs: this.layout.lastStageMs ? { ...this.layout.lastStageMs } : undefined,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    this.callbacks.clear();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    if (!this.running || this.destroyed) return;
    this.timer = setTimeout(() => {
      if (!this.running) return;
      const t0 = performance.now();
      this.layout.step();
      this.notify();
      if (this.layout.settled()) {
        this.running = false;
        this.settledFlag = true;
        return;
      }
      const elapsed = performance.now() - t0;
      if (elapsed > MAIN_BUDGET_MS) this.droppedTicks += 1;
      // over budget: skip the next frame so the thread can paint / handle input
      this.timer = setTimeout(() => this.schedule(), elapsed > MAIN_BUDGET_MS ? FRAME_MS : 0);
    }, 0);
  }

  private notify(): void {
    this.tickCount += 1;
    this.targets.bump();
    for (const cb of this.callbacks) cb();
  }
}
