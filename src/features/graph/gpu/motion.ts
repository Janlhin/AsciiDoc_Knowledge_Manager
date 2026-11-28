/**
 * T-063 #19 — motion state machine: display positions vs layout targets.
 *
 * The layout ticks at a much lower cadence than the render loop (a few Hz vs
 * 60fps). Instead of springing every node on the main thread each frame, this
 * controller owns the interpolation clock only:
 *
 *  - on every applied tick the current display position becomes the new `from`,
 *    the fresh `targets` arrays become `to`, and the clock restarts at `t = 0`;
 *  * the per-frame work is one scalar (`t`) handed to the GPU; the vertex shader
 *    does `mix(a_from, a_to, u_t)` — no per-node JS interpolation, no springs;
 *  - the CPU mirror (`snapshotDisplay` / `displayX`) exists only for the low-
 *    frequency CPU pick index, labels and hover math. It is never walked per
 *    frame in a hot loop.
 *
 * `prefers-reduced-motion: reduce` collapses every transition to a hard jump:
 * `t = 1`, intro alpha = 1, no scatter. The flag is injected through the
 * constructor so tests can drive it with a stubbed `matchMedia`.
 *
 * This module is pure: no DOM, no WebGL, no React imports.
 */

/** Interpolation convergence window, ms. Tunable in the 120–200ms band. */
export const INTERPOLATION_MS = 160;
/** First-open intro fade / scatter window, ms (hard cap 300ms). */
export const INTRO_MS = 240;
/**
 * Intro scatter factor: initial `from` position = target × this factor toward
 * the origin, so the cloud blooms out of the centre instead of popping in.
 */
const INTRO_SCATTER = 0.35;

/** Target snapshot as published by the frozen layout handle contract. */
export interface MotionTargets {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly version: number;
}

export interface MotionOptions {
  /** collapse transitions to instant jumps; mirrors `prefers-reduced-motion`. */
  reducedMotion?: boolean;
  /** override the 120–200ms convergence window (tests / bench only). */
  interpolationMs?: number;
  /** override the ≤300ms intro window (tests only). */
  introMs?: number;
}

/** ease-out cubic: fast start, soft settle — reads as critical damping. */
export function easeOutCubic(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - u, 3);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export class MotionController {
  readonly count: number;
  private readonly fromX: Float32Array;
  private readonly fromY: Float32Array;
  private toX: Float32Array;
  private toY: Float32Array;
  /** CPU mirror of the last sampled display position (low-frequency consumers). */
  private readonly curX: Float32Array;
  private readonly curY: Float32Array;

  private readonly interpolationMs: number;
  private readonly introMs: number;
  private reducedMotion: boolean;

  private start: number;
  private introStart: number;
  private lastVersion = -1;
  private lastT = 0;

  constructor(count: number, targets: MotionTargets, now: number, opts?: MotionOptions) {
    this.count = Math.max(0, count);
    this.interpolationMs = opts?.interpolationMs ?? INTERPOLATION_MS;
    this.introMs = opts?.introMs ?? INTRO_MS;
    this.reducedMotion = opts?.reducedMotion ?? false;

    this.fromX = new Float32Array(this.count);
    this.fromY = new Float32Array(this.count);
    this.curX = new Float32Array(this.count);
    this.curY = new Float32Array(this.count);
    this.toX = targets.x;
    this.toY = targets.y;

    for (let i = 0; i < this.count; i++) {
      const tx = targets.x[i] ?? 0;
      const ty = targets.y[i] ?? 0;
      // reduced motion: land on the targets immediately, no intro scatter.
      const fx = this.reducedMotion ? tx : tx * INTRO_SCATTER;
      const fy = this.reducedMotion ? ty : ty * INTRO_SCATTER;
      this.fromX[i] = fx;
      this.fromY[i] = fy;
      this.curX[i] = fx;
      this.curY[i] = fy;
    }
    this.start = now;
    this.introStart = now;
    this.lastVersion = targets.version;
  }

  /** True when the transition that just landed should be treated as instant. */
  get instant(): boolean {
    return this.reducedMotion;
  }

  /**
   * Apply a fresh layout tick. A new `targets.version` rewinds the interpolation:
   * current display becomes `from`, the new arrays become `to`, clock restarts.
   * Called from the tick subscriber (layout cadence), never per render frame.
   */
  syncTargets(targets: MotionTargets, now: number): void {
    if (targets.version === this.lastVersion) return;
    this.lastVersion = targets.version;
    // capture the previous target arrays before rebinding: the rewind mixes the
    // current display toward the OLD target, not the new one.
    const oldToX = this.toX;
    const oldToY = this.toY;
    this.toX = targets.x;
    this.toY = targets.y;

    if (this.reducedMotion) {
      for (let i = 0; i < this.count; i++) {
        const tx = targets.x[i] ?? 0;
        const ty = targets.y[i] ?? 0;
        this.fromX[i] = tx;
        this.fromY[i] = ty;
        this.curX[i] = tx;
        this.curY[i] = ty;
      }
      this.lastT = 1;
      this.start = now;
      return;
    }

    // rewind from the current mixed display position (no jump on an early tick)
    const t = this.lastT;
    for (let i = 0; i < this.count; i++) {
      const fx = this.fromX[i];
      const fy = this.fromY[i];
      this.fromX[i] = fx + (oldToX[i] - fx) * t;
      this.fromY[i] = fy + (oldToY[i] - fy) * t;
    }
    this.start = now;
  }

  /** Interpolation factor for the frame at `now`, eased into 0..1. */
  t(now: number): number {
    if (this.reducedMotion) {
      this.lastT = 1;
      return 1;
    }
    const raw = clamp01((now - this.start) / this.interpolationMs);
    this.lastT = easeOutCubic(raw);
    return this.lastT;
  }

  /** First-open intro alpha, 0 → 1 over `introMs`; 1 under reduced motion. */
  introAlpha(now: number): number {
    if (this.reducedMotion) return 1;
    return clamp01((now - this.introStart) / this.introMs);
  }

  /** True once the interpolation and intro have both reached their end state. */
  settled(now: number): boolean {
    return this.t(now) >= 1 && this.introAlpha(now) >= 1;
  }

  /** Mixed display coordinate of one node (labels / hover; per-node, O(1)). */
  displayX(index: number, now: number): number {
    const t = this.t(now);
    return this.fromX[index] + (this.toX[index] - this.fromX[index]) * t;
  }

  /** Mixed display coordinate of one node (labels / hover; per-node, O(1)). */
  displayY(index: number, now: number): number {
    const t = this.t(now);
    return this.fromY[index] + (this.toY[index] - this.fromY[index]) * t;
  }

  /**
   * Copy the current mixed display positions into `outX` / `outY` (O(n)).
   * Low-frequency only: pick-index rebuilds, drag-end resync, bench snapshots.
   */
  snapshotDisplay(now: number, outX: Float32Array, outY: Float32Array): void {
    const t = this.t(now);
    for (let i = 0; i < this.count; i++) {
      const x = this.fromX[i] + (this.toX[i] - this.fromX[i]) * t;
      const y = this.fromY[i] + (this.toY[i] - this.fromY[i]) * t;
      outX[i] = x;
      outY[i] = y;
      this.curX[i] = x;
      this.curY[i] = y;
    }
  }

  /**
   * Copy the current `from` / `to` ends into caller-supplied original-order
   * arrays so the renderer can rewind its two position buffers. O(n), called
   * from the tick subscriber only.
   */
  fillRewind(
    outFromX: Float32Array,
    outFromY: Float32Array,
    outToX: Float32Array,
    outToY: Float32Array,
  ): void {
    outFromX.set(this.fromX);
    outFromY.set(this.fromY);
    outToX.set(this.toX);
    outToY.set(this.toY);
  }

  /**
   * Pin one node's display position to the pointer while dragging. Both ends of
   * the interpolation are overwritten so the follow does not lag behind the
   * cursor; the layout handle keeps its own pinned target separately.
   */
  pinDisplay(index: number, x: number, y: number): void {
    if (index < 0 || index >= this.count) return;
    this.fromX[index] = x;
    this.fromY[index] = y;
    this.toX[index] = x;
    this.toY[index] = y;
    this.curX[index] = x;
    this.curY[index] = y;
  }

  /** React to a `prefers-reduced-motion` change; turning it on snaps to targets. */
  setReducedMotion(reduced: boolean, now: number): void {
    if (reduced && !this.reducedMotion) {
      for (let i = 0; i < this.count; i++) {
        this.fromX[i] = this.toX[i];
        this.fromY[i] = this.toY[i];
        this.curX[i] = this.toX[i];
        this.curY[i] = this.toY[i];
      }
      this.lastT = 1;
    }
    this.reducedMotion = reduced;
    this.start = now;
    this.introStart = now;
  }
}

/** Read the reduced-motion preference from the platform (stubbable in tests). */
export function prefersReducedMotion(matchMedia: unknown): boolean {
  if (typeof matchMedia !== "function") return false;
  try {
    const mql = (matchMedia as (query: string) => { matches: boolean })(
      "(prefers-reduced-motion: reduce)",
    );
    return mql?.matches ?? false;
  } catch {
    return false;
  }
}
