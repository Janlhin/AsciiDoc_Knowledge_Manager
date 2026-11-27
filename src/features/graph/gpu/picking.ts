/**
 * T-063 GPU graph view — CPU-side spatial index for hover / click / box select.
 *
 * A uniform grid buckets nodes by world position. The grid is built from the
 * layout positions captured at construction; after the layout advances, callers
 * rebuild the index (cheap, O(n)) before picking again. This index is also the
 * documented fallback when GPU colour-id read-back is unavailable.
 *
 * Node radius follows the ordinary GraphView degree mapping (4–18 px at k = 1):
 * `4 + 2·sqrt(degree)`, clamped to that band and scaled by `nodeSize`.
 */
import type { GpuGraph, LayoutState, PickIndex } from "./types";

const MIN_RADIUS = 4;
const MAX_RADIUS = 18;

function degreeRadius(degree: number, nodeSize: number): number {
  const base = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, 4 + 2 * Math.sqrt(degree)));
  return base * nodeSize;
}

class PickIndexImpl implements PickIndex {
  readonly count: number;
  private readonly layout: LayoutState;
  private readonly graph: GpuGraph;
  private readonly nodeSize: number;

  private cols = 1;
  private rows = 1;
  private cellSize = 1;
  private minX = 0;
  private minY = 0;
  private readonly head: Int32Array;
  private readonly next: Int32Array;

  constructor(layout: LayoutState, graph: GpuGraph, nodeSize = 1) {
    this.layout = layout;
    this.graph = graph;
    this.nodeSize = nodeSize;
    this.count = layout.count;

    if (this.count === 0) {
      this.head = new Int32Array(1);
      this.next = new Int32Array(0);
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxRadius = MIN_RADIUS * nodeSize;
    for (let i = 0; i < this.count; i++) {
      const xi = layout.x[i];
      const yi = layout.y[i];
      if (xi < minX) minX = xi;
      if (xi > maxX) maxX = xi;
      if (yi < minY) minY = yi;
      if (yi > maxY) maxY = yi;
      const r = degreeRadius(graph.nodes[i].degree, nodeSize);
      if (r > maxRadius) maxRadius = r;
    }
    this.minX = minX;
    this.minY = minY;

    // cell side = diameter of the largest node: a radius query only touches the
    // own cell plus its 8 neighbours.
    const cs = Math.max(maxRadius * 2, 1);
    this.cellSize = cs;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cs));
    this.rows = Math.max(1, Math.ceil((maxY - minY) / cs));

    this.head = new Int32Array(this.cols * this.rows).fill(-1);
    this.next = new Int32Array(this.count).fill(-1);
    for (let i = 0; i < this.count; i++) {
      const cell = this.cellOf(layout.x[i], layout.y[i]);
      this.next[i] = this.head[cell];
      this.head[cell] = i;
    }
  }

  radiusOf(i: number): number {
    return degreeRadius(this.graph.nodes[i].degree, this.nodeSize);
  }

  pickAt(wx: number, wy: number, radius: number): number {
    if (this.count === 0 || radius <= 0) return -1;
    const cs = this.cellSize;
    const x0 = Math.max(0, Math.floor((wx - radius - this.minX) / cs));
    const x1 = Math.min(this.cols - 1, Math.floor((wx + radius - this.minX) / cs));
    const y0 = Math.max(0, Math.floor((wy - radius - this.minY) / cs));
    const y1 = Math.min(this.rows - 1, Math.floor((wy + radius - this.minY) / cs));
    const r2 = radius * radius;

    let best = -1;
    let bestD2 = Infinity;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let j = this.head[cx + cy * this.cols]; j >= 0; j = this.next[j]) {
          const dx = this.layout.x[j] - wx;
          const dy = this.layout.y[j] - wy;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          if (d2 < bestD2 || (d2 === bestD2 && j < best)) {
            best = j;
            bestD2 = d2;
          }
        }
      }
    }
    return best;
  }

  boxSelect(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const out: number[] = [];
    if (this.count === 0) return out;
    const cs = this.cellSize;
    const x0 = Math.max(0, Math.floor((minX - this.minX) / cs));
    const x1 = Math.min(this.cols - 1, Math.floor((maxX - this.minX) / cs));
    const y0 = Math.max(0, Math.floor((minY - this.minY) / cs));
    const y1 = Math.min(this.rows - 1, Math.floor((maxY - this.minY) / cs));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let j = this.head[cx + cy * this.cols]; j >= 0; j = this.next[j]) {
          const xi = this.layout.x[j];
          const yi = this.layout.y[j];
          if (xi >= minX && xi <= maxX && yi >= minY && yi <= maxY) {
            out.push(j);
          }
        }
      }
    }
    return out;
  }

  private cellOf(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cellSize)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.minY) / this.cellSize)));
    return cx + cy * this.cols;
  }
}

/** Build the spatial index for the current layout positions. */
export function createPickIndex(
  layout: LayoutState,
  graph: GpuGraph,
  nodeSize?: number,
): PickIndex {
  return new PickIndexImpl(layout, graph, nodeSize ?? 1);
}
