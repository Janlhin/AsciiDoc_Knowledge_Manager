/**
 * T-063 GPU graph view — label level-of-detail selection (pure, testable).
 *
 * Priority order:
 *  1. hovered / selected / anchor are always kept, regardless of zoom;
 *  2. the rest come from `ranked` (caller-sorted, degree descending), but only
 *     once the camera zoom `k` reaches `threshold`;
 *  3. the returned list is hard-capped at `maxLabels`.
 *
 * Indices are de-duplicated; priority nodes come first, then ranked order.
 */
import type { GpuGraph, LayoutState, LodInput } from "./types";

export function selectLabels(
  input: LodInput,
  layout: LayoutState,
  _graph: GpuGraph,
): number[] {
  const out: number[] = [];
  const seen = new Uint8Array(layout.count);

  const mustKeep: ReadonlyArray<number | null> = [input.hovered, input.selected, input.anchor];
  for (const m of mustKeep) {
    if (m === null || m < 0 || m >= layout.count || seen[m] === 1) continue;
    seen[m] = 1;
    out.push(m);
  }

  if (input.camera.k >= input.threshold) {
    for (const i of input.ranked) {
      if (out.length >= input.maxLabels) break;
      if (i < 0 || i >= layout.count || seen[i] === 1) continue;
      seen[i] = 1;
      out.push(i);
    }
  }

  return out;
}
