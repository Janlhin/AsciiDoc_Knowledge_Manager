// @vitest-environment jsdom
/**
 * T-063 (C): GPU graph view degradation shell test.
 *
 * The kernel/renderer modules are stubbed here; what this covers is the React
 * shell's contract: when the renderer reports itself unavailable, a visible
 * banner appears, the same tab falls back to the plain GraphView, the root
 * carries the E2E data attributes, and mount/unmount leaves no rAF timer
 * behind. Real WebGL probing lives in the renderer's own test (agent B).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";

function makeStore<T>(value: T) {
  return {
    get: () => value,
    set: () => undefined,
    subscribe: () => () => undefined,
  };
}

const rendererSpy = { ctor: vi.fn(), destroy: vi.fn() };
const handleSpy = { destroy: vi.fn(), start: vi.fn(), stop: vi.fn(), pin: vi.fn(), unpin: vi.fn() };

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
    mode: "main" as const,
    layout: stubLayout(),
    start: handleSpy.start,
    stop: handleSpy.stop,
    pin: handleSpy.pin,
    unpin: handleSpy.unpin,
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
let pendingRaf = new Set<number>();
let rafCounter = 0;
const originalRaf = globalThis.requestAnimationFrame;
const originalCancel = globalThis.cancelAnimationFrame;

beforeEach(async () => {
  vi.resetModules();
  rendererSpy.ctor.mockClear();
  rendererSpy.destroy.mockClear();
  handleSpy.destroy.mockClear();
  handleSpy.start.mockClear();
  handleSpy.stop.mockClear();
  handleSpy.pin.mockClear();
  handleSpy.unpin.mockClear();
  pendingRaf = new Set<number>();

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
      available = false;
      capability = { webgl2: false, maxTexture: 0, budgetBytes: 0, reason: "no-webgl2" as const };
      constructor(canvas: HTMLCanvasElement) {
        rendererSpy.ctor(canvas);
      }
      setGraph() {}
      setLayout() {}
      setCamera() {}
      setSelection() {}
      setPalette() {}
      resize() {}
      render() {
        return { nodes: 0, edges: 0, drawCalls: 0, frameMs: 0, gpu: "fake" };
      }
      pick() {
        return -1;
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
  // every started layout handle is destroyed: no timer / worker leaks after unmount
  expect(handleSpy.destroy).toHaveBeenCalledTimes(handleSpy.start.mock.calls.length);
});

describe("gpu-graph view degradation", () => {
  it("shows the fallback banner and renders the plain GraphView in the same tab", () => {
    const rootEl = host.querySelector('[data-gpu-graph-view="fallback"]');
    expect(rootEl).not.toBeNull();
    expect(host.querySelector('[data-testid="gpu-fallback-banner"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="fallback-graph-view"]')).not.toBeNull();
  });

  it("exposes the node count data attribute for E2E assertions", () => {
    const rootEl = host.querySelector("[data-gpu-graph-nodes]");
    expect(rootEl?.getAttribute("data-gpu-graph-nodes")).toBe("0");
  });

  it("creates the renderer once and destroys it on the way out", () => {
    expect(rendererSpy.ctor).toHaveBeenCalledTimes(1);
    expect(rendererSpy.destroy).toHaveBeenCalledTimes(1);
  });

  it("starts the async layout handle on mount", () => {
    expect(handleSpy.start).toHaveBeenCalled();
  });

  it("does not attach the bench hook when gpu-bench=1 is absent", () => {
    expect(window.__adkmGpuBench).toBeUndefined();
  });
});
