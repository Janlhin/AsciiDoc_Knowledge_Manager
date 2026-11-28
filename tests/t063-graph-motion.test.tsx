// @vitest-environment jsdom
/**
 * T-063 #19 — motion / viewport / picking-motion layer tests.
 *
 * Pure modules (motion clock, block-grid culling, frame summary) run directly
 * in jsdom without GL. The React shell cases stub the layout client, renderer,
 * camera and pick index the same way `gpu-graph-view.test.tsx` does; what they
 * cover is the view contract:
 *
 *  - drag wakes only the dragged node's neighbourhood request;
 *  - the HUD exposes worker / core / SAB / WASM labels;
 *  - the CPU pick index is built from display positions, so a node that has
 *    not finished sliding is hit where it is seen, not where its target sits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";

import { MotionController, type MotionTargets } from "../src/features/graph/gpu/motion";
import {
  buildBlockLayout,
  visibleBlocks,
  visibleNodeCount,
} from "../src/features/graph/gpu/culling";
import { summarizeFrames } from "../src/features/graph/gpu/frameStats";
import { createPickIndex } from "../src/features/graph/gpu/picking";
import type { GpuGraph, GpuNode } from "../src/features/graph/gpu/types";

/* ------------------------------------------------------------------ pure */

function makeTargets(x: number[], y: number[], version = 0): MotionTargets {
  return {
    count: x.length,
    x: Float32Array.from(x),
    y: Float32Array.from(y),
    version,
  };
}

function makeGraph(n: number): GpuGraph {
  const nodes: GpuNode[] = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    label: `n${i}`,
    resolved: true,
    degree: 2,
  }));
  return { nodes, edges: [] };
}

describe("motion controller — convergence", () => {
  it("starts at the scattered intro position and converges to the targets", () => {
    const targets = makeTargets([100], [200], 0);
    const m = new MotionController(1, targets, 0, { interpolationMs: 160, introMs: 240 });

    expect(m.t(0)).toBe(0);
    // intro scatter pulls the start position toward the origin
    expect(m.displayX(0, 0)).toBeLessThan(100);

    // after the convergence window the display lands on the targets
    expect(m.t(300)).toBe(1);
    expect(m.displayX(0, 300)).toBeCloseTo(100, 5);
    expect(m.displayY(0, 300)).toBeCloseTo(200, 5);
    expect(m.introAlpha(300)).toBe(1);
  });

  it("rewinds from the current display state, so an early tick does not jump", () => {
    const first = makeTargets([0, 50], [0, 50], 0);
    const m = new MotionController(2, first, 0, { interpolationMs: 160 });
    m.t(40); // partial progress toward the first targets

    const next = makeTargets([100, 150], [0, 50], 1);
    m.syncTargets(next, 40);

    // right after the rewind the node must sit between its old display spot and
    // the new target — never teleported straight to 100
    const after = m.displayX(0, 41);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(100);
  });

  it("pinDisplay overrides one node's both ends (drag follow)", () => {
    const targets = makeTargets([100], [200], 0);
    const m = new MotionController(1, targets, 0, { interpolationMs: 160 });
    m.pinDisplay(0, 33, 44);
    expect(m.displayX(0, 1000)).toBe(33);
    expect(m.displayY(0, 1000)).toBe(44);
  });
});

describe("motion controller — reduced motion", () => {
  it("jumps straight to targets with no interpolation or intro fade", () => {
    const targets = makeTargets([100], [200], 0);
    const m = new MotionController(1, targets, 0, { reducedMotion: true });

    expect(m.t(0)).toBe(1);
    expect(m.displayX(0, 0)).toBeCloseTo(100, 5);
    expect(m.displayY(0, 0)).toBeCloseTo(200, 5);
    expect(m.introAlpha(0)).toBe(1);
  });

  it("syncTargets snaps instead of rewinding under reduced motion", () => {
    const first = makeTargets([0], [0], 0);
    const m = new MotionController(1, first, 0, { reducedMotion: true });
    const next = makeTargets([120], [-40], 1);
    m.syncTargets(next, 10);
    expect(m.displayX(0, 10)).toBeCloseTo(120, 5);
    expect(m.displayY(0, 10)).toBeCloseTo(-40, 5);
  });
});

describe("block-grid culling", () => {
  it("keeps blocks inside the camera rectangle and drops offscreen ones", () => {
    const graph = makeGraph(4);
    const x = Float32Array.from([0, 10, 500, 510]);
    const y = Float32Array.from([0, 0, 0, 0]);
    const layout = buildBlockLayout(x, y, graph, 1);

    // viewport 100×100 at k=1, centred on the origin: ±50 world units
    const visible = visibleBlocks(layout, { x: 0, y: 0, k: 1 }, { width: 100, height: 100 }, 8);
    expect(visibleNodeCount(visible)).toBe(2);
  });

  it("an empty graph yields no blocks", () => {
    const layout = buildBlockLayout(new Float32Array(0), new Float32Array(0), makeGraph(0), 1);
    expect(visibleBlocks(layout, { x: 0, y: 0, k: 1 }, { width: 100, height: 100 }, 8)).toEqual([]);
  });
});

describe("frame summary", () => {
  it("reports median, p95, p99 and the 1% low over the sample window", () => {
    const samples = [5, 5, 5, 5, 20];
    const s = summarizeFrames(samples);
    expect(s.frames).toBe(5);
    expect(s.medianMs).toBe(5);
    expect(s.p95Ms).toBe(20);
    expect(s.p99Ms).toBe(20);
    expect(s.onePercentLowMs).toBe(20);
  });

  it("returns zeros for an empty window", () => {
    const s = summarizeFrames([]);
    expect(s.medianMs).toBe(0);
    expect(s.p95Ms).toBe(0);
    expect(s.p99Ms).toBe(0);
    expect(s.onePercentLowMs).toBe(0);
  });
});

describe("picking uses display positions", () => {
  it("hits the node where it is seen, not where its target sits", () => {
    const graph = makeGraph(1);
    // initial target at (100, 100)
    const first = makeTargets([100], [100], 0);
    const m = new MotionController(1, first, 0, { interpolationMs: 160 });

    // a tick moves the target to (200, 100); the node has barely started sliding
    const next = makeTargets([200], [100], 1);
    m.syncTargets(next, 0);

    const snapX = new Float32Array(1);
    const snapY = new Float32Array(1);
    m.snapshotDisplay(5, snapX, snapY);
    const index = createPickIndex({ count: 1, x: snapX, y: snapY }, graph);

    // display position ≈ still near 100: hitting there works...
    expect(index.pickAt(snapX[0], snapY[0], 6)).toBe(0);
    // ...the target position (200) must not hit while the node is still sliding
    expect(index.pickAt(200, 100, 6)).toBe(-1);

    // after convergence the snapshot follows the target
    m.snapshotDisplay(300, snapX, snapY);
    const settled = createPickIndex({ count: 1, x: snapX, y: snapY }, graph);
    expect(settled.pickAt(200, 100, 6)).toBe(0);
  });
});

/* ------------------------------------------------------------ React shell */

function makeStore<T>(value: T) {
  return {
    get: () => value,
    set: () => undefined,
    subscribe: () => () => undefined,
  };
}

const handleSpy = {
  destroy: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  pin: vi.fn(),
  unpin: vi.fn(),
  wake: vi.fn(),
};
const rendererSpy = { ctor: vi.fn(), destroy: vi.fn() };

function stubLayout() {
  return {
    count: 0,
    x: new Float32Array(0),
    y: new Float32Array(0),
    vx: new Float32Array(0),
    vy: new Float32Array(0),
    options: {
      seed: 0,
      linkDistance: 40,
      charge: 12,
      gravity: 0.02,
      gridTarget: 96,
      theta: 0.9,
      maxTicks: 300,
      alphaDecay: 0.03,
    },
    alpha: () => 0,
    settled: () => true,
    step: () => undefined,
    stepUntil: () => undefined,
    bounds: () => ({ minX: 0, minY: 0, maxX: 1, maxY: 1 }),
    fingerprint: () => "",
  };
}

function stubHandle() {
  return {
    mode: "single" as const,
    layout: stubLayout(),
    targets: { count: 0, x: new Float32Array(0), y: new Float32Array(0), version: 0 },
    stats: () => ({
      workers: 2,
      cores: 8,
      tier: "A" as const,
      tierReason: "",
      sab: true,
      wasm: false,
      frozen: false,
      tickMedianMs: 0,
      tickP95Ms: 0,
      tickCount: 0,
      queueDepth: 0,
      droppedTicks: 0,
    }),
    start: handleSpy.start,
    stop: handleSpy.stop,
    pin: handleSpy.pin,
    unpin: handleSpy.unpin,
    wake: handleSpy.wake,
    onTick: () => () => undefined,
    settled: () => true,
    destroy: handleSpy.destroy,
  };
}

const fakeApp = {
  metadata: {
    revision: makeStore(0),
    getGraph: () => ({ nodes: [], edges: [] }),
    getTagMap: () => new Map(),
    getAttachmentMap: () => new Map(),
  },
  workspace: {
    lastActiveFile: makeStore<string | null>(null),
    openFile: vi.fn(),
    openGpuGraph: vi.fn(),
  },
  events: { on: () => () => undefined },
};

let root: Root;
let host: HTMLDivElement;
let act: typeof import("react").act;
let createElement: typeof import("react").createElement;
const pendingRaf = new Set<number>();
let rafCounter = 0;
const originalRaf = globalThis.requestAnimationFrame;
const originalCancel = globalThis.cancelAnimationFrame;

beforeEach(async () => {
  vi.resetModules();
  handleSpy.destroy.mockClear();
  handleSpy.start.mockClear();
  handleSpy.stop.mockClear();
  handleSpy.pin.mockClear();
  handleSpy.unpin.mockClear();
  handleSpy.wake.mockClear();
  rendererSpy.ctor.mockClear();
  rendererSpy.destroy.mockClear();
  pendingRaf.clear();
  rafCounter = 0;

  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = ++rafCounter;
    pendingRaf.add(id);
    return id;
  };
  globalThis.cancelAnimationFrame = (id: number) => {
    pendingRaf.delete(id);
  };

  vi.doMock("@app/AppContext", () => ({ useApp: () => fakeApp }));
  vi.doMock("@core/i18n", () => ({ useI18n: () => (key: string) => key }));
  vi.doMock("@features/graph/GraphView", () => ({
    GraphView: () => createElement("div", { "data-testid": "fallback-graph-view" }),
  }));
  vi.doMock("@features/graph/gpu/layout-client", () => ({
    createAsyncLayout: () => stubHandle(),
  }));
  vi.doMock("@features/graph/gpu/picking", () => ({
    createPickIndex: () => ({ count: 0, pickAt: () => -1, boxSelect: () => [], radiusOf: () => 4 }),
  }));
  vi.doMock("@features/graph/gpu/camera", () => ({
    screenToWorld: (_c: unknown, _vp: unknown, sx: number, sy: number) => ({ x: sx, y: sy }),
    worldToScreen: (_c: unknown, _vp: unknown, wx: number, wy: number) => ({ x: wx, y: wy }),
    zoomAtCursor: (c: unknown) => c,
    fitBounds: () => ({ x: 0, y: 0, k: 1 }),
    panBy: (c: unknown) => c,
  }));
  vi.doMock("@features/graph/gpu/lod", () => ({ selectLabels: () => [] }));
  vi.doMock("@features/graph/gpu/renderer", () => ({
    GpuGraphRenderer: class {
      available = true;
      capability = { webgl2: true, maxTexture: 4096, budgetBytes: 0, renderer: "FakeGPU" };
      constructor(canvas: HTMLCanvasElement) {
        rendererSpy.ctor(canvas);
      }
      setGraph() {}
      setLayout() {}
      setCamera() {}
      setSelection() {}
      setPalette() {}
      setBlockLayout() {}
      setMotion() {}
      setVisibleBlocks() {}
      rewind() {}
      pinDisplay() {}
      resize() {}
      render() {
        return { nodes: 0, edges: 0, drawCalls: 0, frameMs: 0, gpu: "fake" };
      }
      pick() {
        return 0;
      }
      syncPositions() {}
      destroy() {
        rendererSpy.destroy();
      }
    },
  }));

  const react = await import("react");
  act = react.act;
  createElement = react.createElement;
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);

  const { GpuGraphView } = await import("@features/graph/gpu/GpuGraphView");
  await act(async () => {
    root.render(react.createElement(GpuGraphView));
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCancel;
  expect(pendingRaf.size).toBe(0);
  expect(handleSpy.destroy).toHaveBeenCalledTimes(handleSpy.start.mock.calls.length);
});

describe("gpu-graph motion shell", () => {
  it("HUD exposes worker / core / SAB / WASM diagnostics", () => {
    const hud = host.querySelector('[data-testid="gpu-hud-layout"]');
    expect(hud).not.toBeNull();
    const text = hud?.textContent ?? "";
    expect(text).toMatch(/workers?/i);
    expect(text).toMatch(/核|cores?/i);
    expect(text).toMatch(/SAB/i);
    expect(text).toMatch(/WASM/i);
  });

  it("drag wakes only the dragged node's neighbourhood request", async () => {
    const canvas = host.querySelector('[data-testid="gpu-canvas"]');
    expect(canvas).not.toBeNull();

    await act(async () => {
      canvas!.dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, clientY: 10, button: 0 }));
    });
    await act(async () => {
      canvas!.dispatchEvent(new PointerEvent("pointermove", { clientX: 30, clientY: 12, button: 0 }));
    });

    expect(handleSpy.wake).toHaveBeenCalledTimes(1);
    expect(handleSpy.wake).toHaveBeenCalledWith([0]);
  });

  it("does not wake the layout until the pointer actually drags", async () => {
    const canvas = host.querySelector('[data-testid="gpu-canvas"]');
    expect(canvas).not.toBeNull();

    await act(async () => {
      canvas!.dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, clientY: 10, button: 0 }));
    });
    expect(handleSpy.wake).not.toHaveBeenCalled();
  });
});
