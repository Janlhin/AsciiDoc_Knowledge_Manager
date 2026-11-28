/**
 * T-063 (C): standalone GPU graph view.
 *
 * Owns the React shell: toolbar/HUD, pointer + wheel interaction, the rAF render
 * loop, label overlay, capability probe and the visible degradation path. The
 * layout kernel (behind the async client), picking index, camera math, LOD and
 * WebGL renderer come from the frozen modules in this directory; this file never
 * reimplements them.
 *
 * Motion layer (#19): layout ticks and render frames are decoupled. The
 * {@link MotionController} owns the interpolation clock; per frame the view
 * hands the renderer one scalar (`u_t`) and the GPU mixes `from` → `to`. CPU
 * work per frame is O(1) plus a coarse block-grid visibility walk — no per-node
 * JS interpolation, no springs. Picking and labels read display positions, so
 * "where you see it is where you can click it".
 *
 * Layout runs through `createAsyncLayout`: the handle ticks (worker when
 * possible, main thread otherwise) and pushes positions to `handle.targets`;
 * the render loop only renders, it never steps the simulation on the main
 * thread. Layout tick time is excluded from frame-time stats.
 *
 * Degradation contract: if the renderer cannot be created, reports a non-empty
 * `capability.reason`, or loses its context, a visible banner explains why and
 * the same tab falls back to the plain Canvas2D `GraphView`. No blank screen,
 * no silent failure.
 *
 * Dev/E2E only: when `location.search` carries `gpu-bench=1`, a `window.__adkmGpuBench`
 * hook is attached for synthetic-graph frame timing. It is not attached in the
 * ordinary production path. Bench overrides (`benchWorkerCount`, `benchTier`,
 * `benchSab=off`) are parsed into `LayoutClientOptions` and passed to the layout
 * client; production without those params is unchanged.
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
import type {
  LayoutClientOptions,
  LayoutMode,
  LayoutStats,
} from "./layout-api";
import { createPickIndex, type PositionSource } from "./picking";
import {
  fitBounds,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAtCursor,
} from "./camera";
import { selectLabels } from "./lod";
import { GpuGraphRenderer } from "./renderer";
import { MotionController, prefersReducedMotion } from "./motion";
import {
  buildBlockLayout,
  maxNodeRadius,
  visibleBlocks,
  visibleNodeCount,
  type BlockLayout,
} from "./culling";
import { summarizeFrames } from "./frameStats";
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
/** rolling frame-time window for the HUD (frames). */
const FRAME_WINDOW = 120;
/** HUD refresh cadence (ms); frame samples keep accumulating between refreshes. */
const HUD_REFRESH_MS = 500;

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
  p99Ms: number;
  onePercentLowMs: number;
  fps: number;
  gpu: string;
  dpr: number;
  width: number;
  height: number;
  mode: LayoutMode;
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

/**
 * Parse bench-only layout overrides from the URL. Returns `undefined` unless
 * `gpu-bench=1` is set, so the production path passes no client options at all.
 */
function readBenchOptions(): LayoutClientOptions | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  if (params.get("gpu-bench") !== "1") return undefined;
  const opts: LayoutClientOptions = {};
  const workers = Number(params.get("benchWorkerCount"));
  if (Number.isFinite(workers) && workers > 0) {
    opts.forceWorkers = Math.min(8, Math.max(1, Math.round(workers)));
  }
  const tier = params.get("benchTier");
  if (tier === "S" || tier === "A" || tier === "B" || tier === "C") {
    opts.forceTier = tier;
  }
  if (params.get("benchSab") === "off") opts.sab = false;
  return opts;
}

/** HUD snapshot refreshed on the HUD cadence, not per frame. */
interface HudInfo {
  workers: number;
  cores: number;
  sab: boolean;
  wasm: boolean;
  tier: string;
  tierReason: string;
  frozen: boolean;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  onePercentLowMs: number;
  visible: number;
  total: number;
}

const EMPTY_HUD: HudInfo = {
  workers: 0,
  cores: 0,
  sab: false,
  wasm: false,
  tier: "C",
  tierReason: "",
  frozen: false,
  medianMs: 0,
  p95Ms: 0,
  p99Ms: 0,
  onePercentLowMs: 0,
  visible: 0,
  total: 0,
};

type Status = "checking" | "ready" | "fallback";

type DragState =
  | { kind: "node"; index: number; moved: boolean; woke: boolean; startSX: number; startSY: number }
  | { kind: "pan"; moved: boolean; startSX: number; startSY: number; origin: CameraState }
  | { kind: "box"; startSX: number; startSY: number };

/** Read the platform reduced-motion preference (stubbable via `window.matchMedia`). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    prefersReducedMotion(typeof window !== "undefined" ? window.matchMedia : undefined),
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function GpuGraphView() {
  const app = useApp();
  const t = useI18n();
  const revision = useStore(app.metadata.revision);
  const lastActiveFile = useStore(app.workspace.lastActiveFile);
  useStore(excludedRaw);

  const reducedMotion = usePrefersReducedMotion();

  const [prefs, setPrefs] = useState<GraphPrefs>(loadPrefs);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("checking");
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [boxed, setBoxed] = useState<number[]>([]);
  const [hudFps, setHudFps] = useState(0);
  const [hud, setHud] = useState<HudInfo>(EMPTY_HUD);
  const [retryTick, setRetryTick] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelRef = useRef<HTMLCanvasElement | null>(null);

  const rendererRef = useRef<GpuGraphRenderer | null>(null);
  const handleRef = useRef<AsyncLayoutHandle | null>(null);
  const pickRef = useRef<PickIndex | null>(null);
  const motionRef = useRef<MotionController | null>(null);
  const blockLayoutRef = useRef<BlockLayout | null>(null);
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
  /** rewind scratch arrays (original order), reused per tick to avoid allocation. */
  const rewindRef = useRef<{
    fromX: Float32Array;
    fromY: Float32Array;
    toX: Float32Array;
    toY: Float32Array;
  } | null>(null);
  const frameTimesRef = useRef<number[]>([]);
  const hudClockRef = useRef(0);
  const benchOptsRef = useRef<LayoutClientOptions | undefined>(readBenchOptions());
  const benchRef = useRef<{ graph: GpuGraph | null; handle: AsyncLayoutHandle | null }>({
    graph: null,
    handle: null,
  });
  /** detach handle subscription installed by the bench hook. */
  const benchOffTickRef = useRef<(() => void) | null>(null);
  /**
   * Bench-owned motion / culling / rewind state, kept apart from the shared
   * refs so the production layout effect's cleanup (which nulls the shared
   * refs when the real graph rebuilds) cannot wipe a running bench session.
   */
  const benchMotionRef = useRef<MotionController | null>(null);
  const benchBlockLayoutRef = useRef<BlockLayout | null>(null);
  const benchRewindRef = useRef<{
    fromX: Float32Array;
    fromY: Float32Array;
    toX: Float32Array;
    toY: Float32Array;
  } | null>(null);
  /** mirror of the reduced-motion flag for the mount-once bench effect. */
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

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

  /* ---------- picking index helpers (built from display positions) ---------- */

  const rebuildPick = useCallback((handle: AsyncLayoutHandle, graphData: GpuGraph) => {
    const count = graphData.nodes.length;
    const snapX = new Float32Array(count);
    const snapY = new Float32Array(count);
    const motion = motionRef.current;
    const now = performance.now();
    if (motion && motion.count === count) {
      motion.snapshotDisplay(now, snapX, snapY);
    } else if (handle.targets.count === count) {
      snapX.set(handle.targets.x);
      snapY.set(handle.targets.y);
    }
    const source: PositionSource = { count, x: snapX, y: snapY };
    pickRef.current = createPickIndex(source, graphData, prefsRef.current.display.nodeSize);
    pickSnapRef.current = { x: snapX, y: snapY };
  }, []);

  /* ---------- async layout + pick index follow the displayed graph ---------- */

  useEffect(() => {
    const handle = createAsyncLayout(displayGraph, undefined, benchOptsRef.current);
    handleRef.current = handle;
    pickTickRef.current = 0;
    settledRef.current = false;

    const count = displayGraph.nodes.length;
    const targets = handle.targets ?? {
      count,
      x: new Float32Array(count),
      y: new Float32Array(count),
      version: 0,
    };
    const motion = new MotionController(
      count,
      targets,
      performance.now(),
      { reducedMotion },
    );
    motionRef.current = motion;

    blockLayoutRef.current = buildBlockLayout(
      targets.x,
      targets.y,
      displayGraph,
      prefsRef.current.display.nodeSize,
    );

    rewindRef.current = {
      fromX: new Float32Array(count),
      fromY: new Float32Array(count),
      toX: new Float32Array(count),
      toY: new Float32Array(count),
    };
    rebuildPick(handle, displayGraph);

    const offTick = handle.onTick(() => {
      pickTickRef.current += 1;
      const now = performance.now();
      const rewind = rewindRef.current;
      if (rewind) {
        motion.syncTargets(targets, now);
        motion.fillRewind(rewind.fromX, rewind.fromY, rewind.toX, rewind.toY);
        rendererRef.current?.rewind?.(rewind.fromX, rewind.fromY, rewind.toX, rewind.toY);
      }
      if (pickTickRef.current % PICK_REBUILD_EVERY === 0) {
        rebuildPick(handle, displayGraphRef.current);
        return;
      }
      const snap = pickSnapRef.current;
      if (snap && count > 0) {
        const stride = Math.max(1, Math.floor(count / PICK_SAMPLE));
        let drifted = false;
        for (let i = 0; i < count; i += stride) {
          const dx = motion.displayX(i, now) - snap.x[i];
          const dy = motion.displayY(i, now) - snap.y[i];
          if (Math.abs(dx) > PICK_MOVE_PX || Math.abs(dy) > PICK_MOVE_PX) {
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
    rendererRef.current?.setBlockLayout?.(blockLayoutRef.current);
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
      motionRef.current = null;
      blockLayoutRef.current = null;
      rewindRef.current = null;
    };
  }, [displayGraph, rebuildPick, reducedMotion]);

  /* ---------- reduced-motion live switch ---------- */

  useEffect(() => {
    motionRef.current?.setReducedMotion(reducedMotion, performance.now());
  }, [reducedMotion]);

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
    renderer.setBlockLayout?.(blockLayoutRef.current);
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
        dragRef.current = { kind: "node", index: hit, moved: false, woke: false, startSX: sx, startSY: sy };
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
          // request a 1–2 hop neighbourhood relayout once per drag (#20 pool).
          if (d.moved && !d.woke) {
            d.woke = true;
            handleRef.current?.wake([d.index]);
          }
          const world = screenToWorld(cameraRef.current, sizeRef.current, sx, sy);
          handleRef.current?.pin(d.index, world.x, world.y);
          motionRef.current?.pinDisplay(d.index, world.x, world.y);
          rendererRef.current?.pinDisplay?.(d.index, world.x, world.y);
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

  /* ---------- label overlay (display positions, not targets) ---------- */

  const drawLabels = () => {
    const labelCanvas = labelRef.current;
    const handle = handleRef.current;
    if (!labelCanvas || !handle) return;
    const ctx = labelCanvas.getContext("2d");
    if (!ctx) return;
    const { width, height, dpr } = sizeRef.current;
    const now = performance.now();
    const motion = motionRef.current;
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
    const ids = selectLabels(lodInput, handle.layout, displayGraphRef.current);
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = paletteRef.current.label;
    for (const i of ids) {
      const node = displayGraphRef.current.nodes[i];
      if (!node) continue;
      const dx = motion ? motion.displayX(i, now) : handle.layout.x[i];
      const dy = motion ? motion.displayY(i, now) : handle.layout.y[i];
      const pt = worldToScreen(cameraRef.current, sizeRef.current, dx, dy);
      ctx.fillText(node.label, pt.x + 6, pt.y + 4);
    }
  };

  /* ---------- rAF loop: render only; the async handle owns the simulation ---------- */

  useEffect(() => {
    let cancelled = false;
    let prev = performance.now();

    const loop = () => {
      if (cancelled) return;
      const renderer = rendererRef.current;
      const bench = benchRef.current;
      const handle = bench.handle ?? handleRef.current;
      const now = performance.now();

      if (renderer && handle) {
        if (!settledRef.current && handle.settled()) {
          settledRef.current = true;
          handle.stop();
        }

        const motion = benchMotionRef.current ?? motionRef.current;
        const t = motion ? motion.t(now) : 1;
        const intro = motion ? motion.introAlpha(now) : 1;
        renderer.setMotion?.(t, intro);

        // coarse block-grid cull: O(blocks) per frame, never O(n).
        const blockLayout = benchBlockLayoutRef.current ?? blockLayoutRef.current;
        const graphData = bench.graph ?? displayGraphRef.current;
        const pad = maxNodeRadius(graphData, prefsRef.current.display.nodeSize);
        const visible = blockLayout
          ? visibleBlocks(blockLayout, cameraRef.current, sizeRef.current, pad)
          : null;
        renderer.setVisibleBlocks?.(visible);
        renderer.setCamera(cameraRef.current);
        renderer.setSelection(selectionRef.current);
        renderer.render();

        // HUD: rolling frame-time window + engine stats, refreshed on a cadence.
        const dt = now - prev;
        if (dt > 0 && dt < 1000) {
          frameTimesRef.current.push(dt);
          if (frameTimesRef.current.length > FRAME_WINDOW) {
            frameTimesRef.current.shift();
          }
        }
        hudClockRef.current += dt;
        if (hudClockRef.current >= HUD_REFRESH_MS) {
          hudClockRef.current = 0;
          const summary = summarizeFrames(frameTimesRef.current);
          const rawStats = typeof handle.stats === "function" ? handle.stats() : null;
          const stats: LayoutStats = rawStats ?? {
            workers: 0,
            cores: 0,
            sab: false,
            wasm: false,
            tier: "C",
            tierReason: "",
            frozen: false,
            tickMedianMs: 0,
            tickP95Ms: 0,
            tickCount: 0,
            queueDepth: 0,
            droppedTicks: 0,
          };
          const visibleCount = visible ? visibleNodeCount(visible) : graphData.nodes.length;
          setHud({
            workers: stats.workers,
            cores: stats.cores,
            sab: stats.sab,
            wasm: stats.wasm,
            tier: stats.tier,
            tierReason: stats.tierReason,
            frozen: stats.frozen,
            medianMs: summary.medianMs,
            p95Ms: summary.p95Ms,
            p99Ms: summary.p99Ms,
            onePercentLowMs: summary.onePercentLowMs,
            visible: visibleCount,
            total: graphData.nodes.length,
          });
        }
      }
      prev = now;

      drawLabels();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const benchHandle = createAsyncLayout(benchGraph, undefined, benchOptsRef.current);
      benchRef.current = { graph: benchGraph, handle: benchHandle };
      benchHandle.start();
      wireBench(benchGraph, benchHandle);
    };

    /**
     * Wire the synthetic bench graph through the same motion / culling / pick
     * path the production layout uses, so HUD visible/total and the block-grid
     * cull ratio are measured on the rendered graph rather than an empty one.
     */
    const wireBench = (benchGraph: GpuGraph, benchHandle: AsyncLayoutHandle): void => {
      const count = benchGraph.nodes.length;
      const targets = benchHandle.targets ?? {
        count,
        x: new Float32Array(count),
        y: new Float32Array(count),
        version: 0,
      };
      const motion = new MotionController(
        count,
        targets,
        performance.now(),
        { reducedMotion: reducedMotionRef.current },
      );
      motionRef.current = motion;
      benchMotionRef.current = motion;
      const blockLayout = buildBlockLayout(
        targets.x,
        targets.y,
        benchGraph,
        prefsRef.current.display.nodeSize,
      );
      blockLayoutRef.current = blockLayout;
      benchBlockLayoutRef.current = blockLayout;
      const rewind = {
        fromX: new Float32Array(count),
        fromY: new Float32Array(count),
        toX: new Float32Array(count),
        toY: new Float32Array(count),
      };
      rewindRef.current = rewind;
      benchRewindRef.current = rewind;
      handleRef.current = benchHandle;
      displayGraphRef.current = benchGraph;
      rebuildPick(benchHandle, benchGraph);
      rankedRef.current = benchGraph.nodes
        .map((n, i) => [i, n.degree] as const)
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .map(([i]) => i);

      if (benchOffTickRef.current) {
        benchOffTickRef.current();
        benchOffTickRef.current = null;
      }
      const offTick = benchHandle.onTick(() => {
        const now = performance.now();
        const rewind = benchRewindRef.current;
        if (rewind) {
          motion.syncTargets(targets, now);
          motion.fillRewind(rewind.fromX, rewind.fromY, rewind.toX, rewind.toY);
          rendererRef.current?.rewind?.(rewind.fromX, rewind.fromY, rewind.toX, rewind.toY);
        }
        // Bench does not hover/pick: skip the per-tick CPU index rebuild that
        // the production path throttles to every PICK_REBUILD_EVERY ticks.
      });
      benchOffTickRef.current = offTick;

      rendererRef.current?.setBlockLayout?.(blockLayout);
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
      const summary = summarizeFrames(samples);
      const gpu = renderer?.capability.renderer ?? "unknown";
      const { width, height, dpr } = sizeRef.current;
      return {
        nodes: benchGraph.nodes.length,
        edges: benchGraph.edges.length,
        frames: samples.length,
        samples,
        medianMs: summary.medianMs,
        p95Ms: summary.p95Ms,
        p99Ms: summary.p99Ms,
        onePercentLowMs: summary.onePercentLowMs,
        fps: summary.medianMs > 0 ? Math.round(1000 / summary.medianMs) : 0,
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
      if (benchOffTickRef.current) {
        benchOffTickRef.current();
        benchOffTickRef.current = null;
      }
      benchRef.current.handle?.destroy();
      benchRef.current = { graph: null, handle: null };
      benchMotionRef.current = null;
      benchBlockLayoutRef.current = null;
      benchRewindRef.current = null;
    };
  }, [rebuildPick]);

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

  const sabText = hud.sab ? "on" : "off";
  const wasmText = hud.wasm ? "on" : "off";

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
              <span data-testid="gpu-hud-layout">
                workers {hud.workers} · 核 {hud.cores} · SAB {sabText} · WASM {wasmText} ·{" "}
                {hud.tier}
                {hud.tierReason ? ` (${hud.tierReason})` : ""}
              </span>
              <span data-testid="gpu-hud-frametime">
                med {hud.medianMs.toFixed(1)} / p95 {hud.p95Ms.toFixed(1)} / p99{" "}
                {hud.p99Ms.toFixed(1)} / 1% {hud.onePercentLowMs.toFixed(1)} ms · visible{" "}
                {hud.visible}/{hud.total}
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
