/**
 * T-063 GPU graph view — CPU spatial index tests: `pickAt` matches brute-force
 * nearest neighbour, `boxSelect` matches a linear scan, radii stay in band.
 */
import { describe, expect, it } from "vitest";
import { createLayout } from "@features/graph/gpu/layout";
import { createPickIndex } from "@features/graph/gpu/picking";
import type { GpuEdge, GpuGraph, GpuNode } from "@features/graph/gpu/types";

function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= (s << 13) >>> 0;
    s ^= s >>> 17;
    s ^= (s << 5) >>> 0;
    s >>>= 0;
    return s / 4294967296;
  };
}

function makeGraph(n: number, edgeCount: number, seed: number): GpuGraph {
  const rnd = makeRng(seed);
  const degree = new Array<number>(n).fill(0);
  const nodes: GpuNode[] = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ id: `n${i}`, label: `n${i}`, resolved: true, degree: 0 });
  }
  const edges: GpuEdge[] = [];
  for (let e = 0; e < edgeCount; e++) {
    const a = Math.floor(rnd() * n);
    const b = Math.floor(rnd() * n);
    if (a === b) continue;
    edges.push({ source: a, target: b, broken: false });
    degree[a]++;
    degree[b]++;
  }
  for (let i = 0; i < n; i++) nodes[i].degree = degree[i];
  return { nodes, edges };
}

function brutePick(layout: ReturnType<typeof createLayout>, wx: number, wy: number, radius: number): number {
  let best = -1;
  let bestD2 = Infinity;
  const r2 = radius * radius;
  for (let i = 0; i < layout.count; i++) {
    const dx = layout.x[i] - wx;
    const dy = layout.y[i] - wy;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    if (d2 < bestD2 || (d2 === bestD2 && i < best)) {
      best = i;
      bestD2 = d2;
    }
  }
  return best;
}

function bruteBox(
  layout: ReturnType<typeof createLayout>,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < layout.count; i++) {
    if (layout.x[i] >= minX && layout.x[i] <= maxX && layout.y[i] >= minY && layout.y[i] <= maxY) {
      out.push(i);
    }
  }
  return out.sort((a, b) => a - b);
}

describe("gpu graph picking — spatial index", () => {
  const graph = makeGraph(500, 1_000, 5);
  const layout = createLayout(graph, { seed: 777 });
  layout.stepUntil(60);
  const index = createPickIndex(layout, graph);

  it("pickAt agrees with brute-force nearest neighbour on 200 random queries", () => {
    const rnd = makeRng(123);
    const b = layout.bounds();
    for (let q = 0; q < 200; q++) {
      const wx = b.minX + rnd() * (b.maxX - b.minX);
      const wy = b.minY + rnd() * (b.maxY - b.minY);
      const radius = 6 + rnd() * 10;
      expect(index.pickAt(wx, wy, radius)).toBe(brutePick(layout, wx, wy, radius));
    }
  });

  it("boxSelect agrees with a linear scan on 200 random boxes", () => {
    const rnd = makeRng(456);
    const b = layout.bounds();
    for (let q = 0; q < 200; q++) {
      const x1 = b.minX + rnd() * (b.maxX - b.minX);
      const x2 = b.minX + rnd() * (b.maxX - b.minX);
      const y1 = b.minY + rnd() * (b.maxY - b.minY);
      const y2 = b.minY + rnd() * (b.maxY - b.minY);
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      const got = index.boxSelect(minX, minY, maxX, maxY).sort((a, b) => a - b);
      expect(got).toEqual(bruteBox(layout, minX, minY, maxX, maxY));
    }
  });

  it("radiusOf stays in the 4–18 world-unit band", () => {
    for (let i = 0; i < layout.count; i++) {
      const r = index.radiusOf(i);
      expect(r).toBeGreaterThanOrEqual(4);
      expect(r).toBeLessThanOrEqual(18);
    }
  });

  it("pickAt returns -1 outside reachable radius", () => {
    expect(index.pickAt(1e6, 1e6, 1)).toBe(-1);
  });
});
