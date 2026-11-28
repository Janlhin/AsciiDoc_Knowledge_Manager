/**
 * T-063 GPU graph view — async layout client.
 *
 * The heavy force-directed tick runs in a dedicated worker so the main thread
 * never blocks on it. The main thread keeps a {@link LayoutState} holder whose
 * `x`/`y` are overwritten from every worker `tick` message; the holder is what
 * the renderer / picking / LOD read on the main thread.
 *
 * Degradation: if `Worker` is unavailable, the constructor throws, or the worker
 * errors at runtime, the handle silently switches to `mode: "main"`: ticks run
 * on the main thread on a frame timer, at most one tick per frame, and a tick
 * that overruns the 8ms budget defers the next frame. A warning is logged once.
 *
 * Determinism is unchanged: the worker runs the same kernel and seed; the sync
 * path stays covered by the layout unit tests, and the main fallback reuses it.
 */
import { createLayout } from "./layout";
import type { WorkerEdgeInit, WorkerInMessage, WorkerNodeInit, WorkerOutMessage } from "./layout-worker";
import type { GpuGraph, LayoutOptions, LayoutState } from "./types";

export interface AsyncLayoutHandle {
  readonly mode: "worker" | "main";
  /** main-thread holder; `x`/`y` are refreshed from each tick message. */
  readonly layout: LayoutState;
  start(): void;
  stop(): void;
  pin(index: number, x: number, y: number): void;
  unpin(index: number): void;
  /** subscribe to tick completion; returns an unsubscribe function. */
  onTick(cb: () => void): () => void;
  settled(): boolean;
  /** idempotent: stops the loop and terminates the worker. */
  destroy(): void;
}

/** main-thread tick budget; an over-budget tick defers the next frame. */
const MAIN_BUDGET_MS = 8;
/** frame cadence when driving the main fallback from a timer (rAF stands in for rAF). */
const FRAME_MS = 16;

let warnedFallback = false;

function warnFallback(): void {
  if (warnedFallback) return;
  warnedFallback = true;
  console.warn("[gpu-graph] Worker unavailable; layout falls back to throttled main-thread ticks.");
}

function serializeGraph(graph: GpuGraph): { nodes: WorkerNodeInit[]; edges: WorkerEdgeInit[] } {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      resolved: n.resolved,
      degree: n.degree,
      groupColor: n.groupColor,
    })),
    edges: graph.edges.map((e) => ({
      source: e.source,
      target: e.target,
      broken: e.broken,
    })),
  };
}

/** Main-thread fallback: one throttled tick per frame, 8ms budget. */
class MainLayoutHandle implements AsyncLayoutHandle {
  readonly mode = "main" as const;
  readonly layout: LayoutState;
  private readonly graph: GpuGraph;
  private readonly opts?: Partial<LayoutOptions>;
  private readonly callbacks = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private settledFlag = false;
  private destroyed = false;

  constructor(graph: GpuGraph, opts?: Partial<LayoutOptions>) {
    this.graph = graph;
    this.opts = opts;
    this.layout = createLayout(graph, opts);
  }

  start(): void {
    if (this.running || this.destroyed) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
  }

  pin(index: number, x: number, y: number): void {
    this.layout.x[index] = x;
    this.layout.y[index] = y;
    this.layout.vx[index] = 0;
    this.layout.vy[index] = 0;
  }

  unpin(_index: number): void {
    // main fallback keeps no pinned record; releasing just lets future ticks move it.
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
      // over budget: skip the next frame so the thread can paint / handle input
      this.timer = setTimeout(() => this.schedule(), elapsed > MAIN_BUDGET_MS ? FRAME_MS : 0);
    }, 0);
  }

  private notify(): void {
    for (const cb of this.callbacks) cb();
  }
}

/** Worker-backed handle; transparently delegates to the main fallback on runtime failure. */
class WorkerLayoutHandle implements AsyncLayoutHandle {
  private delegate: MainLayoutHandle | null = null;
  private readonly worker: Worker;
  readonly layout: LayoutState;
  private readonly graph: GpuGraph;
  private readonly opts?: Partial<LayoutOptions>;
  private readonly callbacks = new Set<() => void>();
  private readonly delegateSubs = new Map<() => void, () => void>();
  private settledFlag = false;
  private destroyed = false;

  constructor(graph: GpuGraph, opts: Partial<LayoutOptions> | undefined, worker: Worker) {
    this.graph = graph;
    this.opts = opts;
    this.worker = worker;
    this.layout = createLayout(graph, opts);

    this.worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      if (this.delegate) return;
      const msg = event.data;
      if (msg.type === "tick") {
        this.layout.x.set(msg.x);
        this.layout.y.set(msg.y);
        this.notify();
      } else if (msg.type === "settled") {
        this.settledFlag = true;
      }
    };
    this.worker.onerror = () => this.goMain();

    const { nodes, edges } = serializeGraph(graph);
    const init: WorkerInMessage = { type: "init", nodes, edges, opts: opts ?? {} };
    this.worker.postMessage(init);
  }

  get mode(): "worker" | "main" {
    return this.delegate ? "main" : "worker";
  }

  start(): void {
    if (this.delegate) this.delegate.start();
    else this.post({ type: "start" });
  }

  stop(): void {
    if (this.delegate) this.delegate.stop();
    else this.post({ type: "stop" });
  }

  pin(index: number, x: number, y: number): void {
    if (this.delegate) this.delegate.pin(index, x, y);
    else this.post({ type: "pin", index, x, y });
  }

  unpin(index: number): void {
    if (this.delegate) this.delegate.unpin(index);
    else this.post({ type: "unpin", index });
  }

  onTick(cb: () => void): () => void {
    this.callbacks.add(cb);
    if (this.delegate) this.delegateSubs.set(cb, this.delegate.onTick(cb));
    return () => {
      this.callbacks.delete(cb);
      const unsub = this.delegateSubs.get(cb);
      if (unsub) {
        unsub();
        this.delegateSubs.delete(cb);
      }
    };
  }

  settled(): boolean {
    if (this.delegate) return this.delegate.settled();
    return this.settledFlag || this.layout.settled();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.callbacks.clear();
    if (this.delegate) {
      this.delegate.destroy();
    } else {
      try {
        this.worker.terminate();
      } catch {
        // already gone
      }
    }
  }

  private post(msg: WorkerInMessage): void {
    this.worker.postMessage(msg);
  }

  private notify(): void {
    for (const cb of this.callbacks) cb();
  }

  private goMain(): void {
    if (this.delegate || this.destroyed) return;
    warnFallback();
    try {
      this.worker.terminate();
    } catch {
      // already gone
    }
    this.delegate = new MainLayoutHandle(this.graph, this.opts);
    for (const cb of this.callbacks) {
      this.delegateSubs.set(cb, this.delegate.onTick(cb));
    }
    this.delegate.start();
  }
}

/**
 * Build an async layout: worker-backed when available, throttled main-thread
 * fallback otherwise. The returned handle owns no DOM objects.
 */
export function createAsyncLayout(
  graph: GpuGraph,
  opts?: Partial<LayoutOptions>,
): AsyncLayoutHandle {
  if (typeof Worker === "undefined") {
    warnFallback();
    return new MainLayoutHandle(graph, opts);
  }
  try {
    const worker = new Worker(new URL("./layout-worker.ts", import.meta.url), { type: "module" });
    return new WorkerLayoutHandle(graph, opts, worker);
  } catch {
    warnFallback();
    return new MainLayoutHandle(graph, opts);
  }
}
