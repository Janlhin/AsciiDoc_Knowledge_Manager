/**
 * T-063 — layout handle contract.
 *
 * This file is the frozen boundary between the layout engine and the view
 * layer. Both sides import from here; neither side redefines these types:
 *
 *  - the engine (`layout-client.ts`, the worker pool in #20) produces
 *    {@link LayoutTargets} and {@link LayoutStats};
 *  - the view (`GpuGraphView.tsx`, renderer, picking, HUD in #19) consumes them.
 *
 * Invariants the engine must hold:
 *
 *  1. `targets.count` equals the node count of the graph handed to
 *     `createAsyncLayout()` and never changes for the lifetime of one handle.
 *  2. `targets.x` / `targets.y` are read-only views, `count` elements each.
 *     With SharedArrayBuffer they are shared memory: read them inside one
 *     synchronous block and never retain them across ticks.
 *  3. `targets.version` increases by exactly one per applied tick, so the view
 *     can tell "new target positions arrived" from "nothing moved".
 *  4. `targets` is a stable object: the engine may swap the arrays it points at
 *     (ping-pong buffers) but must not replace the object itself.
 *  5. `layout` (the kernel holder) remains available for compatibility; new
 *     view code reads target positions through `targets` and keeps its own
 *     display buffers.
 */
import type { LayoutState } from "./types";

/** CPU capability tier; see #20 for the decision table. */
export type CpuTier = "S" | "A" | "B" | "C";

/**
 * Where the tick loop runs:
 *  - `pool`   — one or more workers behind a shard pool (#20);
 *  - `single` — exactly one worker (legacy, or forced by options);
 *  - `main`   — throttled main-thread fallback (tier C).
 */
export type LayoutMode = "pool" | "single" | "main";

/** Target positions produced by the engine; the view interpolates toward them. */
export interface LayoutTargets {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly version: number;
}

/**
 * Everything the HUD / diagnostics need. `tierReason` is a short, user-visible
 * explanation of a downgrade ("" when the machine runs its nominal tier).
 */
export interface LayoutStats {
  readonly workers: number;
  readonly cores: number;
  readonly tier: CpuTier;
  readonly tierReason: string;
  readonly sab: boolean;
  readonly wasm: boolean;
  readonly frozen: boolean;
  /** rolling per-tick wall time, engine side; 0 until the first tick lands. */
  readonly tickMedianMs: number;
  readonly tickP95Ms: number;
  readonly tickCount: number;
  /** queued work items (local relayout requests, shard sync) still pending. */
  readonly queueDepth: number;
  /** ticks skipped because an in-flight tick overran its budget. */
  readonly droppedTicks: number;

  // --- optional pool diagnostics (#20); absent on legacy single/main handles ---

  /** shard count the pool split the graph into; undefined when not pooled. */
  readonly shardCount?: number;
  /** owned buffer footprint per worker, bytes (best-effort estimate). */
  readonly workerBytes?: readonly number[];
  /** last-tick kernel phase wall time, ms; undefined until the first tick lands. */
  readonly stageMs?: {
    buildGridMs: number;
    buildQuadtreeMs: number;
    repulsionMs: number;
    springsMs: number;
    integrateMs: number;
    totalMs: number;
    /** coordinator-side barrier merge of worker slices (pool path only). */
    mergeMs?: number;
    /** coordinator-side shard summary recomputation (pool path only). */
    summaryMs?: number;
  };
}

/** Per-handle overrides; benchmark runs use these to sweep the hardware matrix. */
export interface LayoutClientOptions {
  /** force a worker count (clamped to [1, 8]); 0 / undefined = choose from cores. */
  forceWorkers?: number;
  /** force a CPU tier; undefined = decide from the machine. */
  forceTier?: CpuTier;
  /** false = pretend SAB is unavailable and use transferables. */
  sab?: boolean;
  /** false = skip the WASM kernel even when it exists. */
  wasm?: boolean;
  /** tier C refuses a full tick above this node count and stays frozen. */
  mainTickNodeLimit?: number;
}

export interface AsyncLayoutHandle {
  readonly mode: LayoutMode;
  /** stable object; arrays may be swapped between ticks (see invariants). */
  readonly targets: LayoutTargets;
  /** kernel holder kept for compatibility. */
  readonly layout: LayoutState;
  start(): void;
  stop(): void;
  /** stop iterating and keep the current targets (route A in #19). */
  freeze(): void;
  /** resume a frozen handle. */
  thaw(): void;
  /**
   * Relayout only the given nodes and their 1–2 hop neighbourhood; everything
   * else keeps its target position. Requests coalesce; see `queueDepth`.
   */
  wake(indices: readonly number[]): void;
  pin(index: number, x: number, y: number): void;
  unpin(index: number): void;
  /** subscribe to applied ticks; returns an unsubscribe function. */
  onTick(cb: () => void): () => void;
  settled(): boolean;
  /** snapshot of engine state for the HUD / benchmark JSON. */
  stats(): LayoutStats;
  /** idempotent: interrupts an in-flight tick and terminates every worker. */
  destroy(): void;
}
