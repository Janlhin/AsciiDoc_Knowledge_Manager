/**
 * T-063 GPU graph view — camera transforms (pure math, no DOM).
 *
 * Coordinate spaces (see `types.ts`):
 *  - world: layout output, unitless; 1 world unit ≈ 1 CSS px at k = 1;
 *  - screen: CSS px inside the canvas, top-left origin, y down.
 *
 * A `CameraState` records the world point (x, y) sitting at the viewport centre,
 * plus `k` = screen px per world unit.
 */
import type { CameraState, WorldBounds } from "./types";

/** zoom clamp, matching the ordinary GraphView range. */
const MIN_K = 0.15;
const MAX_K = 6;

function clampK(k: number): number {
  return Math.min(MAX_K, Math.max(MIN_K, k));
}

/** world → screen. */
export function worldToScreen(
  cam: CameraState,
  vp: { width: number; height: number },
  wx: number,
  wy: number,
): { x: number; y: number } {
  return {
    x: (wx - cam.x) * cam.k + vp.width / 2,
    y: (wy - cam.y) * cam.k + vp.height / 2,
  };
}

/** screen → world. */
export function screenToWorld(
  cam: CameraState,
  vp: { width: number; height: number },
  sx: number,
  sy: number,
): { x: number; y: number } {
  return {
    x: cam.x + (sx - vp.width / 2) / cam.k,
    y: cam.y + (sy - vp.height / 2) / cam.k,
  };
}

/**
 * Zoom so that the world point under the cursor stays under the cursor
 * (anchor invariant): pick the anchor world point first, rescale `k`, then
 * re-centre the camera so the same world point lands back at (sx, sy).
 */
export function zoomAtCursor(
  cam: CameraState,
  factor: number,
  sx: number,
  sy: number,
  vp: { width: number; height: number },
): CameraState {
  const anchor = screenToWorld(cam, vp, sx, sy);
  const k2 = clampK(cam.k * factor);
  return {
    k: k2,
    x: anchor.x - (sx - vp.width / 2) / k2,
    y: anchor.y - (sy - vp.height / 2) / k2,
  };
}

/** Fit the given bounds into the viewport with padding; camera centres on bounds. */
export function fitBounds(
  b: WorldBounds,
  vp: { width: number; height: number },
  padding = 40,
): CameraState {
  const bw = Math.max(b.maxX - b.minX, 1e-6);
  const bh = Math.max(b.maxY - b.minY, 1e-6);
  const availW = Math.max(vp.width - padding * 2, 1e-6);
  const availH = Math.max(vp.height - padding * 2, 1e-6);
  const k = clampK(Math.min(availW / bw, availH / bh));
  return {
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
    k,
  };
}

/** Pan by a screen-space delta; world translation is divided by the current zoom. */
export function panBy(cam: CameraState, dxScreen: number, dyScreen: number): CameraState {
  return {
    k: cam.k,
    x: cam.x - dxScreen / cam.k,
    y: cam.y - dyScreen / cam.k,
  };
}
