/**
 * T-063 GPU graph view — camera transform tests: world/screen roundtrip,
 * cursor-anchored zoom invariant, zoom clamp, bounds fit and pan.
 */
import { describe, expect, it } from "vitest";
import {
  fitBounds,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAtCursor,
} from "@features/graph/gpu/camera";

const vp = { width: 800, height: 600 };

describe("gpu graph camera — coordinate transforms", () => {
  it("roundtrips world → screen → world", () => {
    const cam = { x: 12, y: -7, k: 1.5 };
    const s = worldToScreen(cam, vp, 3, 4);
    const w = screenToWorld(cam, vp, s.x, s.y);
    expect(w.x).toBeCloseTo(3, 10);
    expect(w.y).toBeCloseTo(4, 10);
  });

  it("screen centre maps to the camera world point", () => {
    const cam = { x: -5, y: 9, k: 2 };
    const s = worldToScreen(cam, vp, cam.x, cam.y);
    expect(s.x).toBeCloseTo(vp.width / 2, 10);
    expect(s.y).toBeCloseTo(vp.height / 2, 10);
  });

  it("zoom keeps the world point under the cursor fixed", () => {
    const cam = { x: 0, y: 0, k: 1 };
    const sx = 300;
    const sy = 200;
    const anchor = screenToWorld(cam, vp, sx, sy);

    const zoomed = zoomAtCursor(cam, 2, sx, sy, vp);
    expect(zoomed.k).toBeCloseTo(2, 10);
    const back = screenToWorld(zoomed, vp, sx, sy);
    expect(back.x).toBeCloseTo(anchor.x, 10);
    expect(back.y).toBeCloseTo(anchor.y, 10);
  });

  it("zoom clamps into the [0.15, 6] band", () => {
    const cam = { x: 0, y: 0, k: 1 };
    expect(zoomAtCursor(cam, 100, vp.width / 2, vp.height / 2, vp).k).toBe(6);
    expect(
      zoomAtCursor(cam, 0.001, vp.width / 2, vp.height / 2, vp).k,
    ).toBeCloseTo(0.15, 10);
  });

  it("fitBounds centres on the bounds and picks the limiting scale", () => {
    const b = { minX: -100, minY: -50, maxX: 100, maxY: 50 };
    const c = fitBounds(b, vp, 40);
    expect(c.x).toBeCloseTo(0, 10);
    expect(c.y).toBeCloseTo(0, 10);
    // available 720×520 over 200×100 ⇒ limiting scale 720/200 = 3.6
    expect(c.k).toBeCloseTo(3.6, 10);
  });

  it("panBy shifts the world centre by delta / k", () => {
    const cam = { x: 10, y: 20, k: 2 };
    const p = panBy(cam, -40, 20);
    expect(p.k).toBe(2);
    expect(p.x).toBeCloseTo(10 - -40 / 2, 10);
    expect(p.y).toBeCloseTo(20 - 20 / 2, 10);
  });
});
