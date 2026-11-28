/**
 * T-063 #19 — rolling-window frame-time statistics for the HUD and bench hook.
 *
 * A plain average hides the long tail, so the summary reports median, p95, p99
 * and the 1% low (mean of the slowest 1% of frames) over the collected sample
 * window. Pure: no DOM, no React imports.
 */

/** Quantile of an already-sorted sample array; 0..1. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx];
}

export interface FrameSummary {
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  /** mean of the slowest 1% of frames (1% low, not the p99) */
  onePercentLowMs: number;
  frames: number;
}

/** Summarize a raw per-frame ms sample window. */
export function summarizeFrames(samples: readonly number[]): FrameSummary {
  if (samples.length === 0) {
    return { medianMs: 0, p95Ms: 0, p99Ms: 0, onePercentLowMs: 0, frames: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const medianMs = quantile(sorted, 0.5);
  const p95Ms = quantile(sorted, 0.95);
  const p99Ms = quantile(sorted, 0.99);
  const worstCount = Math.max(1, Math.ceil(sorted.length * 0.01));
  let worstSum = 0;
  for (let i = sorted.length - worstCount; i < sorted.length; i++) worstSum += sorted[i];
  const onePercentLowMs = worstSum / worstCount;
  return { medianMs, p95Ms, p99Ms, onePercentLowMs, frames: sorted.length };
}
