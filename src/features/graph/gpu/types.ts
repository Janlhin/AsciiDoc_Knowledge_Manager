/**
 * T-063 — contract for the standalone GPU graph view.
 *
 * Everything under `src/features/graph/gpu/` talks through these types so the
 * pieces (layout kernel, camera, LOD, picking, renderer, React view) can be
 * built and tested independently. Pure data only: no DOM, no WebGL, no React
 * imports here, so `tests/gpu-graph-*.test.ts` can exercise it in jsdom/node.
 *
 * Coordinate spaces
 * - world: layout output, unitless. 1 world unit ≈ 1 CSS px at camera k = 1.
 * - screen: CSS px inside the canvas element (top-left origin, y down).
 */

/** One graph node after the adapter has normalised `GraphData`. */
export interface GpuNode {
  /** stable id: file path, or `unresolved:<name>`, or `tag:` / `attachment:` */
  id: string;
  label: string;
  /** false = linked but missing (rendered translucent, like GraphView) */
  resolved: boolean;
  /** connection count, drives radius */
  degree: number;
  /** optional colour group override (`#rrggbb`), resolved by the adapter */
  groupColor?: string;
}

/** One edge addressed by node indices so the renderer never touches strings. */
export interface GpuEdge {
  source: number;
  target: number;
  /** T-070 broken edge: points at a missing / unresolved target */
  broken: boolean;
}

/** What the renderer consumes. */
export interface GpuGraph {
  nodes: GpuNode[];
  edges: GpuEdge[];
}

/** Camera: `k` screen px per world unit, world point (x, y) at the viewport centre. */
export interface CameraState {
  x: number;
  y: number;
  k: number;
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Tunables of the deterministic layout. All defaults come from `LAYOUT_DEFAULTS`. */
export interface LayoutOptions {
  /** fixed seed; identical input + seed ⇒ bit-identical positions */
  seed: number;
  /** preferred edge length, world units */
  linkDistance: number;
  /** repulsion strength (positive number, applied as repulsion) */
  charge: number;
  /** pull toward the origin */
  gravity: number;
  /** cells per axis at the initial spread; the grid is rebuilt every tick */
  gridTarget: number;
  /** Barnes–Hut opening angle */
  theta: number;
  /** hard tick cap used by `stepUntil` */
  maxTicks: number;
  /** alpha decay per tick */
  alphaDecay: number;
}

export const LAYOUT_DEFAULTS: LayoutOptions = Object.freeze({
  seed: 0x9e3779b9,
  linkDistance: 40,
  charge: 12,
  gravity: 0.02,
  gridTarget: 96,
  theta: 1.15,
  maxTicks: 300,
  alphaDecay: 0.03,
});

/** Mutable layout state. Positions live in typed arrays indexed like `GpuGraph.nodes`. */
export interface LayoutState {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly options: LayoutOptions;
  /** 1 → 0 as the simulation settles */
  alpha(): number;
  /** true once alpha <= 1/alphaDecay-ish floor; callers stop ticking */
  settled(): boolean;
  /** one deterministic tick */
  step(): void;
  /** run `ticks` steps (capped by `maxTicks`) */
  stepUntil(ticks: number): void;
  bounds(): WorldBounds;
  /** fingerprint of positions rounded to 1e-3 — used by tests to prove determinism */
  fingerprint(): string;
}

/** Spatial index used for hover / click / box select. Rebuildable in O(n). */
export interface PickIndex {
  readonly count: number;
  /** index of the node under (wx, wy) within `radius`, or -1 */
  pickAt(wx: number, wy: number, radius: number): number;
  /** indices whose world position falls inside the box */
  boxSelect(minX: number, minY: number, maxX: number, maxY: number): number[];
  /** world-space radius of node `i` at camera k (screen radius is k-independent cap) */
  radiusOf(i: number): number;
}

/** Label LOD decision input, kept pure for tests. */
export interface LodInput {
  camera: CameraState;
  viewport: { width: number; height: number };
  /** node indices currently hovered / selected / anchor */
  hovered: number | null;
  selected: number | null;
  anchor: number | null;
  /** nodes with the largest degree, pre-sorted by the caller */
  ranked: readonly number[];
  /** hard cap on labels drawn per frame */
  maxLabels: number;
  /** zoom at which labels start appearing */
  threshold: number;
}

export interface RenderSelection {
  hovered: number | null;
  selected: number | null;
  anchor: number | null;
  /** indices inside the active box selection */
  boxed: readonly number[];
}

export interface RendererStats {
  nodes: number;
  edges: number;
  drawCalls: number;
  /** CPU-side frame time measured by the caller, ms */
  frameMs: number;
  /** GPU renderer string, `unknown` when unavailable */
  gpu: string;
}

/** Palette pulled from the app's CSS custom properties (same names GraphView uses). */
export interface GraphPalette {
  bg: string;
  node: string;
  nodeHover: string;
  nodeSelected: string;
  link: string;
  broken: string;
  unresolved: string;
  tag: string;
  attachment: string;
  label: string;
}

/** Capability probe result shown in the degradation banner. */
export interface GpuCapability {
  webgl2: boolean;
  /** max texture edge reported by the driver; 0 when unknown */
  maxTexture: number;
  /** approximate device memory guard (bytes) used before allocating VBOs */
  budgetBytes: number;
  reason?: "no-webgl2" | "no-float-texture" | "memory" | "program-link" | "context-lost";
  renderer?: string;
}
