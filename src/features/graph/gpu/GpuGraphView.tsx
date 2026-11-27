/**
 * T-063 (C): standalone GPU graph view.
 *
 * Owns the React shell: toolbar/HUD, pointer + wheel interaction, the rAF render
 * loop, label overlay, capability probe and the visible degradation path. The
 * layout kernel (behind the async client), picking index, camera math, LOD and
 * WebGL renderer come from the frozen modules in this directory; this file never
 * reimplements them.
 *
 * Layout runs through `createAsyncLayout`: the handle ticks (worker when possible,
 * main thread otherwise) and pushes positions to `handle.layout`; the render loop
 * only renders, it never steps the simulation on the main thread.
 *
 * Degradation contract: if the renderer cannot be created, reports a non-empty
 * `capability.reason`, or loses its context, a visible banner explains why and
 * the same tab falls back to the plain Canvas2D `GraphView`. No blank screen,
 * no silent failure.
 *
 * Dev/E2E only: when `location.search` carries `gpu-bench=1`, a `window.__adkmGpuBench`
 * hook is attached for synthetic-graph frame timing. It is not attached in the
 * ordinary production path.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@app/AppContext";
import { useI18n, type I18nKey } from "@core/i18n";
import { useStore } from "@core/store";
import { excludedRaw } from "@core/excludedFiles";
import { loadPrefs, savePrefs, type GraphPrefs } from "../graphPrefs";
import { GraphView } from "../GraphView";
import { buildGpuGraph, countsOf, isNoteNodeId } from "./model";
import { createAsyncLayout, type AsyncLayoutHandle } from "./layout-client";
import { createPickIndex } from "./picking";
import {
  fitBounds,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAtCursor,
} from "./camera";
import { selectLabels } from "./lod";
import { GpuGraphRenderer } from "./renderer";
import type {
  CameraState,
  GpuCapability,
  GpuEdge,
  GpuGraph,
  GpuNode,
  GraphPalette,
  LodInput,
  PickIndex,
  RenderSelection,
} from "./types";
import "./gpu-graph.scss";

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 6;
const FIT_PADDING = 40;
const CLICK_SLOP = 4;
const MAX_LABELS = 64;
/** rebuild the CPU picking index on this many layout ticks, whichever comes first. */
const PICK_REBUILD_EVERY = 30;
/** sampling stride when checking whether positions drifted past the pick radius. */
const PICK_SAMPLE = 12;
/** a sampled node moving more than this many world units triggers an index rebuild. */
const PICK_MOVE_PX = 1.5;

const FALLBACK_PALETTE: GraphPalette = {
  bg: "#262626",
  node: "#8b7cf6",
  nodeHover: "#9d90f8",
  nodeSelected: "#8b7cf6",
  link: "#444444",
  broken: "#e06c75",
  unresolved: "#8b7cf680",
  tag: "#3aa655",
  attachment: "#e0b341",
  label: "#dadada",
};

const REASON_KEYS: Record<NonNullable<GpuCapability["reason"]>, I18nKey> = {
  "no-webgl2": "app.gpuReasonNoWebgl2",
  "no-float-texture": "app.gpuReasonNoFloatTexture",
  memory: "app.gpuReasonMemory",
  "program-link": "app.gpuReasonProgramLink",
  "context-lost": "app.gpuReasonContextLost",
};

function readPalette(el: HTMLElement | null): GraphPalette {
  if (!el) return FALLBACK_PALETTE;
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--bg-app", FALLBACK_PALETTE.bg),
    node: v("--accent", FALLBACK_PALETTE.node),
    nodeHover: v("--accent-hover", FALLBACK_PALETTE.nodeHover),
    nodeSelected: v("--accent", FALLBACK_PALETTE.nodeSelected),
    link: v("--border-strong", FALLBACK_PALETTE.link),
    broken: v("--danger", FALLBACK_PALETTE.broken),
    unresolved: v("--link-unresolved", FALLBACK_PALETTE.unresolved),
    tag: v("--graph-tag", FALLBACK_PALETTE.tag),
    attachment: v("--graph-attachment", FALLBACK_PALETTE.attachment),
    label: v("--text-normal", FALLBACK_PALETTE.label),
  };
}

/* ---------- dev/E2E benchmark hook types (not part of the production path) ---------- */

/** Frame-timing summary produced by the benchmark hook. */
export interface BenchResult {
  nodes: number;
  edges: number;
  frames: number;
  /** raw per-frame intervals, ms, in sample order */
  samples: number[];
  medianMs: number;
  p95Ms: number;
  fps: number;
  gpu: string;
  dpr: number;
  width: number;
  height: number;
  mode: "worker" | "main";
}

/** Synthetic-graph benchmark API attached only when `gpu-bench=1` is set. */
export interface GpuBench {
  /** build a seeded synthetic graph and route it through the real layout + renderer path. */
  load(nodes: number, edges: number, seed?: number): Promise<void>;
  /** warm up, then sample `frames` rAF intervals and resolve the timing summary. */
  run(frames?: number): Promise<BenchResult>;
  /** stop the benchmark layout without tearing it down. */
  stop(): void;
}

declare global {
  interface Window {
    __adkmGpuBench?: GpuBench;
  }
}

/** xorshift32 RNG for synthetic bench graphs; never touches `Math.random`. */
function benchRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= (s << 13) >>> 0;
    s ^= s >>> 17;
    s ^= (s << 5) >>> 0;
    s >>>= 0;
    return s / 4294967296;
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx];
}

type Status = "checking" | "ready" | "fallback";

type DragState =
  | { kind: "node"; index: number; moved: boolean; startSX: number; startSY: number }
  | { kind: "pan"; moved: boolean; startSX: number; startSY: number; origin: CameraState }
  | { kind: "box"; startSX: number; startSY: number };

export function GpuGraphView() {
  const app = useApp();
  const t = useI18n();
  const revision = useStore(app.metadata.revision);
  const lastActiveFile = useStore(app.workspace.lastActiveFile);
  useStore(excludedRaw);

  const [prefs, setPrefs] = useState<GraphPrefs>(loadPrefs);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("checking");
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [boxed, setBoxed] = useState<number[]>([]);
  const [hudFps, setHudFps] = useState(0);
  const [retryTick, setRetryTick] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelRef = useRef<HTMLCanvasElement | null>(null);

  const rendererRef = useRef<GpuGraphRenderer | null>(null);
  const handleRef = useRef<AsyncLayoutHandle | null>(null);
  const pickRef = useRef<PickIndex | null>(null);
  const cameraRef = useRef<CameraState>({ x: 0, y: 0, k: 1 });
  const sizeRef = useRef({ width: 1, height: 1, dpr: 1 });
  const selectionRef = useRef<RenderSelection>({
    hovered: null,
    selected: null,
    anchor: null,
    boxed: [],
  });
  const dragRef = useRef<DragState | null>(null);
  const hoverRef = useRef<number | null>(null);
  const rankedRef = useRef<number[]>([]);
  const settledRef = useRef(false);
  const interactedRef = useRef(false);
  const firstBuildRef = useRef(true);
  const rafRef = useRef(0);
  const fpsRef = useRef({ frames: 0, windowStart: 0, fps: 0 });

  const pickTickRef = useRef(0);
  const pickSnapRef = useRef<{ x: Float32Array; y: Float32Array } | null>(null);
  const benchRef = useRef<{ graph: GpuGraph | null; handle: AsyncLayoutHandle | null }>({
    graph: null,
    handle: null,
  });

  const [graph, setGraph] = useState<GpuGraph>({ nodes: [], edges: [] });
  const displayGraphRef = useRef<GpuGraph>({ nodes: [], edges: [] });
  const prefsRef = useRef(prefs);
  const paletteRef = useRef<GraphPalette>(FALLBACK_PALETTE);
  prefsRef.current = prefs;

  useEffect(() => savePrefs(prefs), [prefs]);

  /* ---------- rebuild the real-data graph on index / prefs / anchor change ---------- */

  useEffect(() => {
    const built = buildGpuGraph({
      graph: app.metadata.getGraph(),
      tagMap: app.metadata.getTagMap(),
      attachmentMap: app.metadata.getAttachmentMap(),
      prefs,
      anchorId: prefs.mode === "local" ? lastActiveFile : null,
    });
    setGraph(built);
  }, [app, revision, lastActiveFile, prefs]);

  /* ---------- client-side search filter on top of the built graph ---------- */

  const displayGraph = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return graph;
    const remap = new Map<number, number>();
    graph.nodes.forEach((n, i) => {
      if (n.label.toLowerCase().includes(q)) remap.set(i, remap.size);
    });
    const nodes = graph.nodes.filter((_, i) => remap.has(i));
    const edges = graph.edges
      .filter((e) => remap.has(e.source) && remap.has(e.target))
      .map((e) => ({
        source: remap.get(e.source) ?? 0,
        target: remap.get(e.target) ?? 0,
        broken: e.broken,
      }));
    return { nodes, edges };
  }, [graph, query]);
  displayGraphRef.current = displayGraph;

  /* ---------- picking index helpers ---------- */

  const rebuildPick = useCallback((handle: AsyncLayoutHandle, graphData: GpuGraph) => {
    pickRef.current = createPickIndex(handle.layout, graphData);
    pickSnapRef.current = {
      x: handle.layout.x.slice(),
      y: handle.layout.y.slice(),
    };
  }, []);

  /* ---------- async layout + pick index follow the displayed graph ---------- */

  useEffect(() => {
    const handle = createAsyncLayout(displayGraph);
    handleRef.current = handle;
    pickTickRef.current = 0;
    rebuildPick(handle, displayGraph);
    settledRef.current = false;

    const offTick = handle.onTick(() => {
      pickTickRef.current += 1;
      rendererRef.current?.syncPositions();
      if (pickTickRef.current % PICK_REBUILD_EVERY === 0) {
        rebuildPick(handle, displayGraphRef.current);
        return;
      }
      const snap = pickSnapRef.current;
      const layout = handle.layout;
      if (snap && layout.count > 0) {
        const stride = Math.max(1, Math.floor(layout.count / PICK_SAMPLE));
        let drifted = false;
        for (let i = 0; i < layout.count; i += stride) {
          if (
            Math.abs(layout.x[i] - snap.x[i]) > PICK_MOVE_PX ||
            Math.abs(layout.y[i] - snap.y[i]) > PICK_MOVE_PX
          ) {
            drifted = true;
            break;
          }
        }
        if (drifted) rebuildPick(handle, displayGraphRef.current);
      }
    });

    handle.start();
    rankedRef.current = displayGraph.nodes
      .map((n, i) => [i, n.degree] as const)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([i]) => i);
    rendererRef.current?.setGraph(displayGraph);
    rendererRef.current?.setLayout(handle.layout);
    if (firstBuildRef.current) {
      cameraRef.current = { x: 0, y: 0, k: 1 };
      firstBuildRef.current = false;
    }

    return () => {
      offTick();
      handle.destroy();
      handleRef.current = null;
      pickRef.current = null;
      pickSnapRef.current = null;
    };
  }, [displayGraph, rebuildPick]);

  /* ---------- fallback bookkeeping ---------- */

  const enterFallback = useCallback((reason: GpuCapability["reason"] | string) => {
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.destroy();
      rendererRef.current = null;
    }
    setFallbackReason(typeof reason === "string" ? reason : "no-webgl2");
    setStatus("fallback");
  }, []);

  /* ---------- renderer creation (once per mount; re-runnable via retry) ---------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: GpuGraphRenderer | null = null;
    try {
      renderer = new GpuGraphRenderer(canvas, {
        onContextLost: () => enterFallback("context-lost"),
        onContextRestored: () => setRetryTick((n) => n + 1),
      });
    } catch {
      enterFallback("no-webgl2");
      return;
    }
    if (!renderer.available || renderer.capability.reason) {
      const reason = renderer.capability.reason ?? "no-webgl2";
      renderer.destroy();
      renderer = null;
      enterFallback(reason);
      return;
    }
    rendererRef.current = renderer;
    paletteRef.current = readPalette(containerRef.current ?? canvas);
    renderer.setPalette(paletteRef.current);
    renderer.setGraph(displayGraphRef.current);
    if (handleRef.current) renderer.setLayout(handleRef.current.layout);
    renderer.setCamera(cameraRef.current);
    renderer.setSelection(selectionRef.current);
    setStatus("ready");
    return () => {
      renderer?.destroy();
      rendererRef.current = null;
    };
    // retry bumps the effect to probe a fresh renderer after a context loss
  }, [retryTick, enterFallback]);

  /* ---------- pointer / wheel helpers ---------- */

  const localPoint = (e: PointerEvent | WheelEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return { sx: e.clientX - left, sy: e.clientY - top };
  };

  const pickAt = (sx: number, sy: number): number => {
    const renderer = rendererRef.current;
    let hit = renderer?.pick(sx, sy) ?? -1;
    if (hit >= 0) return hit;
    const world = screenToWorld(cameraRef.current, sizeRef.current, sx, sy);
    return pickRef.current?.pickAt(world.x, world.y, 6) ?? -1;
  };

  const openNode = (index: number) => {
    const node = displayGraphRef.current.nodes[index];
    if (!node || !node.resolved || !isNoteNodeId(node.id)) return;
    app.workspace.openFile(node.id);
  };

  const fitView = useCallback(() => {
    const layout = handleRef.current?.layout ?? null;
    if (!layout) return;
    cameraRef.current = fitBounds(layout.bounds(), sizeRef.current, FIT_PADDING);
    interactedRef.current = true;
  }, []);

  /* ---------- interaction listeners ---------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { sx, sy } = localPoint(e);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      if (e.shiftKey) {
        dragRef.current = { kind: "box", startSX: sx, startSY: sy };
        return;
      }
      const hit = pickAt(sx, sy);
      if (hit >= 0) {
        dragRef.current = { kind: "node", index: hit, moved: false, startSX: sx, startSY: sy };
        selectionRef.current.selected = hit;
      } else {
        dragRef.current = {
          kind: "pan",
          moved: false,
          startSX: sx,
          startSY: sy,
          origin: { ...cameraRef.current },
        };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const { sx, sy } = localPoint(e);
      const d = dragRef.current;
      if (d) {
        const dx = sx - d.startSX;
        const dy = sy - d.startSY;
        if (d.kind === "node") {
          if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) d.moved = true;
          const world = screenToWorld(cameraRef.current, sizeRef.current, sx, sy);
          handleRef.current?.pin(d.index, world.x, world.y);
          rendererRef.current?.syncPositions();
        } else if (d.kind === "pan") {
          if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) d.moved = true;
          cameraRef.current = panBy(d.origin, dx, dy);
          interactedRef.current = true;
        } else {
          const w0 = screenToWorld(cameraRef.current, sizeRef.current, d.startSX, d.startSY);
          const w1 = screenToWorld(cameraRef.current, sizeRef.current, sx, sy);
          const box =
            pickRef.current?.boxSelect(
              Math.min(w0.x, w1.x),
              Math.min(w0.y, w1.y),
              Math.max(w0.x, w1.x),
              Math.max(w0.y, w1.y),
            ) ?? [];
          selectionRef.current.boxed = box;
          setBoxed(box);
        }
        return;
      }
      const hit = pickAt(sx, sy);
      hoverRef.current = hit >= 0 ? hit : null;
      selectionRef.current.hovered = hoverRef.current;
    };

    const onPointerUp = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* fine */
      }
      if (d?.kind === "node") {
        handleRef.current?.unpin(d.index);
        if (d.moved) {
          const handle = handleRef.current;
          if (handle) rebuildPick(handle, displayGraphRef.current);
        } else {
          openNode(d.index);
        }
      }
    };

    const onPointerLeave = () => {
      if (dragRef.current) return;
      hoverRef.current = null;
      selectionRef.current.hovered = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { sx, sy } = localPoint(e);
      const factor = Math.exp(-e.deltaY * 0.0015);
      const next = zoomAtCursor(cameraRef.current, factor, sx, sy, sizeRef.current);
      next.k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next.k));
      cameraRef.current = next;
      interactedRef.current = true;
    };

    const onDblClick = () => fitView();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        selectionRef.current.boxed = [];
        setBoxed([]);
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDblClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDblClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fitView, rebuildPick]);

  /* ---------- resize (dpr-aligned canvases) ---------- */

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const measure = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { width: w, height: h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      if (labelRef.current) {
        labelRef.current.width = Math.round(w * dpr);
        labelRef.current.height = Math.round(h * dpr);
      }
      rendererRef.current?.resize(w, h, dpr);
    };
    measure();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(container);
    }
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [status]);

  /* ---------- theme changes re-read CSS vars ---------- */

  useEffect(() => {
    const off = app.events.on("theme:changed", () => {
      paletteRef.current = readPalette(containerRef.current);
      rendererRef.current?.setPalette(paletteRef.current);
    });
    return off;
  }, [app]);

  /* ---------- label overlay ---------- */

  const drawLabels = () => {
    const labelCanvas = labelRef.current;
    const layout = handleRef.current?.layout ?? null;
    if (!labelCanvas || !layout) return;
    const ctx = labelCanvas.getContext("2d");
    if (!ctx) return;
    const { width, height, dpr } = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const lodInput: LodInput = {
      camera: cameraRef.current,
      viewport: { width, height },
      hovered: hoverRef.current,
      selected: selectionRef.current.selected,
      anchor: null,
      ranked: rankedRef.current,
      maxLabels: MAX_LABELS,
      threshold: prefsRef.current.display.labelThreshold,
    };
    const ids = selectLabels(lodInput, layout, displayGraphRef.current);
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = paletteRef.current.label;
    for (const i of ids) {
      const node = displayGraphRef.current.nodes[i];
      if (!node) continue;
      const pt = worldToScreen(cameraRef.current, sizeRef.current, layout.x[i], layout.y[i]);
      ctx.fillText(node.label, pt.x + 6, pt.y + 4);
    }
  };

  /* ---------- rAF loop: render only; the async handle owns the simulation ---------- */

  useEffect(() => {
    let cancelled = false;
    const loop = () => {
      if (cancelled) return;
      const renderer = rendererRef.current;
      const handle = handleRef.current;
      if (renderer && handle) {
        if (!settledRef.current && handle.settled()) {
          settledRef.current = true;
          handle.stop();
        }
        renderer.setLayout(handle.layout);
        renderer.setCamera(cameraRef.current);
        renderer.setSelection(selectionRef.current);
        renderer.render();
      }
      drawLabels();
      const now = performance.now();
      const fps = fpsRef.current;
      fps.frames += 1;
      if (fps.windowStart === 0) fps.windowStart = now;
      if (now - fps.windowStart >= 1000) {
        fps.fps = Math.round((fps.frames * 1000) / (now - fps.windowStart));
        fps.frames = 0;
        fps.windowStart = now;
        setHudFps(fps.fps);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /* ---------- dev/E2E benchmark hook (gated behind `gpu-bench=1`) ---------- */

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("gpu-bench") !== "1") return;

    const nextFrame = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

    const load = async (nodeCount: number, edgeCount: number, seed = 1): Promise<void> => {
      const rng = benchRng(seed);
      const safeNodes = Math.max(0, Math.floor(nodeCount));
      const nodes: GpuNode[] = [];
      const degree = new Array<number>(safeNodes).fill(0);
      for (let i = 0; i < safeNodes; i++) {
        nodes.push({ id: `bench:node-${i}`, label: `bench ${i}`, resolved: true, degree: 0 });
      }
      const edges: GpuEdge[] = [];
      const safeEdges = Math.max(0, Math.floor(edgeCount));
      for (let e = 0; e < safeEdges; e++) {
        if (safeNodes === 0) break;
        const a = Math.floor(rng() * safeNodes);
        let b = Math.floor(rng() * safeNodes);
        if (b === a) b = (b + 1) % safeNodes;
        edges.push({ source: a, target: b, broken: false });
        degree[a] += 1;
        degree[b] += 1;
      }
      nodes.forEach((n, i) => {
        n.degree = degree[i];
      });
      const benchGraph: GpuGraph = { nodes, edges };

      benchRef.current.handle?.destroy();
      const benchHandle = createAsyncLayout(benchGraph);
      benchRef.current = { graph: benchGraph, handle: benchHandle };
      benchHandle.start();
      rendererRef.current?.setGraph(benchGraph);
      rendererRef.current?.setLayout(benchHandle.layout);
    };

    const run = async (frames = 300): Promise<BenchResult> => {
      const { graph: benchGraph, handle: benchHandle } = benchRef.current;
      if (!benchGraph || !benchHandle) throw new Error("bench: call load() before run()");
      const renderer = rendererRef.current;

      for (let i = 0; i < 30; i++) await nextFrame();

      const samples: number[] = [];
      let prev = performance.now();
      const sampleCount = Math.max(1, Math.floor(frames));
      for (let i = 0; i < sampleCount; i++) {
        await nextFrame();
        const now = performance.now();
        samples.push(now - prev);
        prev = now;
      }
      const sorted = [...samples].sort((a, b) => a - b);
      const medianMs = quantile(sorted, 0.5);
      const p95Ms = quantile(sorted, 0.95);
      const gpu = renderer?.capability.renderer ?? "unknown";
      const { width, height, dpr } = sizeRef.current;
      return {
        nodes: benchGraph.nodes.length,
        edges: benchGraph.edges.length,
        frames: samples.length,
        samples,
        medianMs,
        p95Ms,
        fps: medianMs > 0 ? Math.round(1000 / medianMs) : 0,
        gpu,
        dpr,
        width,
        height,
        mode: benchHandle.mode,
      };
    };

    const stop = (): void => {
      benchRef.current.handle?.stop();
    };

    const api: GpuBench = { load, run, stop };
    window.__adkmGpuBench = api;

    return () => {
      delete window.__adkmGpuBench;
      benchRef.current.handle?.destroy();
      benchRef.current = { graph: null, handle: null };
    };
  }, []);

  /* ---------- render ---------- */

  const counts = countsOf(displayGraph);
  const reasonText = fallbackReason
    ? t(REASON_KEYS[fallbackReason as NonNullable<GpuCapability["reason"]>] ?? "app.gpuReasonUnknown")
    : t("app.gpuReasonUnknown");

  const onRetry = () => {
    setFallbackReason(null);
    setStatus("checking");
    setRetryTick((n) => n + 1);
  };

  return (
    <div
      className="gpu-graph-view"
      data-gpu-graph-view={status === "fallback" ? "fallback" : "ready"}
      data-gpu-graph-nodes={counts.nodes}
    >
      {status === "fallback" && (
        <div className="gpu-fallback-banner" role="alert" data-testid="gpu-fallback-banner">
          <span className="gpu-fallback-title">{t("app.gpuFallbackTitle")}</span>
          <span className="gpu-fallback-reason">{reasonText}</span>
          <button type="button" data-testid="gpu-retry" onClick={onRetry}>
            {t("app.gpuRetry")}
          </button>
        </div>
      )}
      {status !== "fallback" && (
        <div ref={containerRef} className="gpu-stage">
          <div className="gpu-toolbar" data-testid="gpu-toolbar">
            <div className="gpu-mode-toggle">
              <button
                type="button"
                className={prefs.mode === "global" ? "is-active" : ""}
                data-testid="gpu-mode-global"
                onClick={() => setPrefs((p) => ({ ...p, mode: "global" }))}
              >
                {t("graph.global")}
              </button>
              <button
                type="button"
                className={prefs.mode === "local" ? "is-active" : ""}
                data-testid="gpu-mode-local"
                onClick={() => setPrefs((p) => ({ ...p, mode: "local" }))}
              >
                {t("graph.local")}
              </button>
            </div>
            <input
              className="gpu-search"
              data-testid="gpu-search"
              placeholder={t("app.gpuSearch")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="gpu-toggle">
              <input
                type="checkbox"
                data-testid="gpu-tags"
                checked={prefs.display.tags}
                onChange={(e) => setPrefs((p) => ({ ...p, display: { ...p.display, tags: e.target.checked } }))}
              />
              <span>{t("graph.showTags")}</span>
            </label>
            <label className="gpu-toggle">
              <input
                type="checkbox"
                data-testid="gpu-attachments"
                checked={prefs.display.attachments}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, display: { ...p.display, attachments: e.target.checked } }))
                }
              />
              <span>{t("graph.showAttachments")}</span>
            </label>
            <button
              type="button"
              className="gpu-fit-btn"
              data-testid="gpu-fit"
              onClick={fitView}
              title={t("app.gpuResetView")}
            >
              {t("app.gpuResetView")}
            </button>
            <div className="gpu-hud" data-testid="gpu-hud">
              <span>
                {t("app.gpuNodes")}: {counts.nodes}
              </span>
              <span>
                {t("app.gpuEdges")}: {counts.edges}
              </span>
              <span>
                {t("app.gpuFps")}: {hudFps}
              </span>
              {boxed.length > 0 && (
                <span>{t("app.gpuBoxCount", { n: String(boxed.length) })}</span>
              )}
            </div>
          </div>
          <canvas ref={canvasRef} className="gpu-canvas" data-testid="gpu-canvas" />
          <canvas ref={labelRef} className="gpu-label-layer" data-testid="gpu-labels" />
        </div>
      )}
      {status === "fallback" && <GraphView />}
    </div>
  );
}
