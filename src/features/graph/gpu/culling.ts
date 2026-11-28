/**
 * T-063 #19 — viewport culling: coarse block grid over the node positions.
 *
 * Per-frame O(n) work is the hotspot we must avoid at 100k nodes. Nodes are
 * bucketed once into coarse world-space cells; each occupied cell becomes a
 * {@link CullBlock} holding a contiguous packed index range plus its bounding
 * box. The per-frame pass only walks the blocks (orders of magnitude fewer
 * than nodes) and tests block bounds against the camera's world rectangle.
 *
 * The packed order also lets the renderer submit one instanced draw per visible
 * block via `drawElementsInstancedBaseInstance`, so offscreen nodes are never
 * sent to the GPU. Edges keep their own two passes for now (line segments are
 * cheap; see docs/t063-graph-motion.adoc).
 *
 * Pure: no DOM, no WebGL, no React imports.
 */
import type { CameraState, GpuGraph } from "./types";
import { nodeRadius } from "./geometry";

/** One coarse cell: a contiguous packed range + its world bounding box. */
export interface CullBlock {
  /** first packed instance index. */
  base: number;
  /** packed instance count in this block. */
  count: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Packing produced at graph build; renderer + pick mapping both read it. */
export interface BlockLayout {
  /** original node index → packed instance index. */
  perm: Int32Array;
  /** packed instance index → original node index. */
  invPerm: Int32Array;
  blocks: CullBlock[];
}

const MIN_CELL = 1;

/** Largest node radius (world units) across the graph, used as cull padding. */
export function maxNodeRadius(graph: GpuGraph, nodeSize: number): number {
  let max = 0;
  for (const node of graph.nodes) {
    const r = nodeRadius(node.degree, nodeSize);
    if (r > max) max = r;
  }
  return max;
}

/**
 * Bucket nodes into row-major coarse cells and pack them block by block.
 * Positions are read from the supplied display/target arrays; the layout they
 * came from does not matter to the culler.
 */
export function buildBlockLayout(
  x: Float32Array,
  y: Float32Array,
  graph: GpuGraph,
  nodeSize = 1,
): BlockLayout {
  const n = graph.nodes.length;
  const perm = new Int32Array(n);
  const invPerm = new Int32Array(n);
  const blocks: CullBlock[] = [];

  if (n === 0) return { perm, invPerm, blocks };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const xi = x[i] ?? 0;
    const yi = y[i] ?? 0;
    if (xi < minX) minX = xi;
    if (xi > maxX) maxX = xi;
    if (yi < minY) minY = yi;
    if (yi > maxY) maxY = yi;
  }
  if (!Number.isFinite(minX)) {
    minX = minY = maxX = maxY = 0;
  }

  const pad = maxNodeRadius(graph, nodeSize);
  const cellSize = Math.max(MIN_CELL, pad * 2);
  const cols = Math.max(1, Math.ceil((maxX - minX) / cellSize));
  const rows = Math.max(1, Math.ceil((maxY - minY) / cellSize));

  const head = new Int32Array(cols * rows).fill(-1);
  const next = new Int32Array(n).fill(-1);
  const cellOf = (xi: number, yi: number): number => {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((xi - minX) / cellSize)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor((yi - minY) / cellSize)));
    return cx + cy * cols;
  };
  for (let i = 0; i < n; i++) {
    const cell = cellOf(x[i] ?? 0, y[i] ?? 0);
    next[i] = head[cell];
    head[cell] = i;
  }

  let packed = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const headIdx = head[cx + cy * cols];
      if (headIdx < 0) continue;
      let minBx = Infinity;
      let minBy = Infinity;
      let maxBx = -Infinity;
      let maxBy = -Infinity;
      let count = 0;
      for (let j = headIdx; j >= 0; j = next[j]) {
        perm[j] = packed;
        invPerm[packed] = j;
        packed++;
        count++;
        const xi = x[j] ?? 0;
        const yi = y[j] ?? 0;
        if (xi < minBx) minBx = xi;
        if (xi > maxBx) maxBx = xi;
        if (yi < minBy) minBy = yi;
        if (yi > maxBy) maxBy = yi;
      }
      blocks.push({
        base: packed - count,
        count,
        minX: minBx,
        minY: minBy,
        maxX: maxBx,
        maxY: maxBy,
      });
    }
  }
  return { perm, invPerm, blocks };
}

/**
 * Blocks whose bounding box (expanded by `pad`) intersects the camera's world
 * rectangle. O(blocks), never O(n).
 */
export function visibleBlocks(
  layout: BlockLayout,
  cam: CameraState,
  viewport: { width: number; height: number },
  pad: number,
): CullBlock[] {
  if (layout.blocks.length === 0) return [];
  const halfW = viewport.width / 2 / Math.max(cam.k, 1e-6);
  const halfH = viewport.height / 2 / Math.max(cam.k, 1e-6);
  const loX = cam.x - halfW - pad;
  const hiX = cam.x + halfW + pad;
  const loY = cam.y - halfH - pad;
  const hiY = cam.y + halfH + pad;

  const out: CullBlock[] = [];
  for (const block of layout.blocks) {
    if (block.maxX < loX || block.minX > hiX || block.maxY < loY || block.minY > hiY) {
      continue;
    }
    out.push(block);
  }
  return out;
}

/** Count of nodes inside the visible block set (for the HUD / bench hit rate). */
export function visibleNodeCount(blocks: readonly CullBlock[]): number {
  let total = 0;
  for (const block of blocks) total += block.count;
  return total;
}
