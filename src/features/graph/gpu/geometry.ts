/**
 * T-063 — pure geometry / encoding helpers for the GPU graph renderer.
 *
 * This module has no DOM and no WebGL imports, so every function here can be
 * exercised directly under Node / vitest without a browser stub.
 */

import type {
  GpuEdge,
  GpuGraph,
  GpuNode,
  GraphPalette,
  RenderSelection,
  WorldBounds,
} from "./types";

/** Floats per node in the position buffer: x, y. */
export const POS_STRIDE = 2;
/**
 * Floats per node in the meta buffer:
 *   [0] radius, [1..4] RGBA, [5] 1-based pick id.
 */
export const META_STRIDE = 6;

/**
 * 24-bit colour-id encoding. Id 0 is the reserved backdrop / miss value;
 * real node ids are stored 1-based (see the renderer).
 */
export function encodePickColor(id: number): { r: number; g: number; b: number } {
  const v = id >>> 0;
  return {
    r: v & 255,
    g: (v >>> 8) & 255,
    b: (v >>> 16) & 255,
  };
}

/** Reverse of {@link encodePickColor}; inputs are 0..255 byte values. */
export function decodePickColor(r: number, g: number, b: number): number {
  return (r & 255) | ((g & 255) << 8) | ((b & 255) << 16);
}

/**
 * Node radius in world units, mirroring the Canvas2D `nodeRadius` formula in
 * GraphView: `min(14, 4 + sqrt(degree) * 2) * nodeSize`.
 * Monotonic non-decreasing in `degree`.
 */
export function nodeRadius(degree: number, nodeSize: number): number {
  const d = Math.max(0, degree);
  const scale = Number.isFinite(nodeSize) && nodeSize > 0 ? nodeSize : 1;
  return Math.min(14, 4 + Math.sqrt(d) * 2) * scale;
}

/** Parse `#rgb` / `#rrggbb` / `#rrggbbaa` into 0..1 RGBA; invalid input falls back. */
export function hexToRgba(
  hex: string,
  fallback: readonly [number, number, number, number] = [0.545, 0.486, 0.965, 1],
): [number, number, number, number] {
  const raw = hex.trim().replace(/^#/, "");
  let r: number;
  let g: number;
  let b: number;
  let a = 1;
  if (raw.length === 3) {
    r = parseInt(raw[0] + raw[0], 16);
    g = parseInt(raw[1] + raw[1], 16);
    b = parseInt(raw[2] + raw[2], 16);
  } else if (raw.length === 6) {
    r = parseInt(raw.slice(0, 2), 16);
    g = parseInt(raw.slice(2, 4), 16);
    b = parseInt(raw.slice(4, 6), 16);
  } else if (raw.length === 8) {
    r = parseInt(raw.slice(0, 2), 16);
    g = parseInt(raw.slice(2, 4), 16);
    b = parseInt(raw.slice(4, 6), 16);
    a = parseInt(raw.slice(6, 8), 16) / 255;
  } else {
    return [...fallback] as [number, number, number, number];
  }
  if ([r, g, b].some((v) => Number.isNaN(v))) {
    return [...fallback] as [number, number, number, number];
  }
  return [r / 255, g / 255, b / 255, Number.isFinite(a) ? a : 1];
}

/** World-space colour for one node, resolved from palette + current selection. */
export function resolveNodeColor(
  node: GpuNode,
  index: number,
  palette: GraphPalette,
  selection: RenderSelection,
): [number, number, number, number] {
  const hex = selection.selected === index || selection.anchor === index
    ? palette.nodeSelected
    : selection.hovered === index
      ? palette.nodeHover
      : !node.resolved
        ? palette.unresolved
        : node.groupColor !== undefined
          ? node.groupColor
          : palette.node;
  return hexToRgba(hex);
}

/** Packed instance data uploaded to the GPU. Positions start zeroed; the layout fills them. */
export interface NodePack {
  nodeCount: number;
  edgeCount: number;
  /** n × {@link POS_STRIDE} world positions, refreshed per tick via `bufferSubData`. */
  positions: Float32Array;
  /** n × {@link META_STRIDE}: radius, RGBA, 1-based pick id. */
  meta: Float32Array;
  /** normal edges: `2 × count` node indices for `drawElements(LINES)`. */
  normalEdges: Uint32Array;
  /** broken edges, drawn in a separate call with the broken palette colour. */
  brokenEdges: Uint32Array;
}

/** Packing options: an optional original→packed permutation remaps edge ends. */
export interface PackOptions {
  perm?: Int32Array;
}

/**
 * Build the static instance / index arrays for a graph. Edges referencing an
 * out-of-range node index are dropped rather than uploading garbage. When a
 * {@link PackOptions.perm} block permutation is supplied, edge ends are mapped
 * into packed order so edges follow the culling block layout.
 */
export function packNodeInstances(graph: GpuGraph, opts?: PackOptions): NodePack {
  const nodeCount = graph.nodes.length;
  const positions = new Float32Array(nodeCount * POS_STRIDE);
  const meta = new Float32Array(nodeCount * META_STRIDE);

  const perm = opts?.perm;
  const remap = (index: number): number => {
    if (index < 0 || index >= nodeCount) return -1;
    return perm ? perm[index] : index;
  };

  const normal: number[] = [];
  const broken: number[] = [];
  const pushEdge = (edge: GpuEdge, bucket: number[]) => {
    const s = remap(edge.source);
    const t = remap(edge.target);
    if (s < 0 || t < 0) return;
    bucket.push(s, t);
  };

  for (const edge of graph.edges) {
    pushEdge(edge, edge.broken ? broken : normal);
  }

  for (let i = 0; i < nodeCount; i++) {
    const metaOffset = i * META_STRIDE;
    meta[metaOffset + 5] = i + 1; // 1-based; 0 stays the backdrop miss
  }

  return {
    nodeCount,
    edgeCount: graph.edges.length,
    positions,
    meta,
    normalEdges: new Uint32Array(normal),
    brokenEdges: new Uint32Array(broken),
  };
}

/** Axis-aligned bounds of two position arrays; empty input collapses to the origin. */
export function boundsOf(x: Float32Array, y: Float32Array): WorldBounds {
  if (x.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    if (xi < minX) minX = xi;
    if (yi < minY) minY = yi;
    if (xi > maxX) maxX = xi;
    if (yi > maxY) maxY = yi;
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return { minX, minY, maxX, maxY };
}

/** Rough GPU memory estimate (bytes) for a packed graph, used by the budget guard. */
export function estimateBytes(pack: NodePack): number {
  const pos = pack.positions.byteLength;
  const meta = pack.meta.byteLength;
  const edges = pack.normalEdges.byteLength + pack.brokenEdges.byteLength;
  const overhead = 64 * 1024; // VAOs, quad, pick FBO texture headroom
  return pos + meta + edges + overhead;
}
