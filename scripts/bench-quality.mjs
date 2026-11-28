/**
 * T-063 / Issue #19 — pure-JS layout-quality statistics, shared by the
 * browser-side quality snapshot driver.
 *
 * This mirrors the metric definitions in `layout-quality-core.ts`; keep the
 * two in sync:
 *  - edge lengths: mean / population variance / stddev / median / min / max;
 *  - approximate crossings: K×K grid bucketing, source-endpoint bucket,
 *    endpoint bbox expanded by one cell, orientation cross-product proper
 *    intersection, shared endpoints excluded; comparison pair cap 50,000,000.
 *
 * No DOM / Worker / GPU dependency.
 */

const round4 = (v) => Math.round(v * 10000) / 10000;

/** Edge-length summary over an array of Euclidean lengths. */
export function lengthStats(lengths) {
  const n = lengths.length;
  if (n === 0) {
    return { count: 0, mean: 0, variance: 0, stddev: 0, median: 0, min: 0, max: 0 };
  }
  const mean = lengths.reduce((s, v) => s + v, 0) / n;
  const variance = lengths.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const sorted = [...lengths].sort((a, b) => a - b);
  const medianIdx = Math.min(n - 1, Math.max(0, Math.round((n - 1) * 0.5)));
  return {
    count: n,
    mean: round4(mean),
    variance: round4(variance),
    stddev: round4(Math.sqrt(variance)),
    median: round4(sorted[medianIdx]),
    min: round4(sorted[0]),
    max: round4(sorted[n - 1]),
  };
}

function cross(ox, oy, ax, ay, bx, by) {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

/** Proper intersection: both segments straddle each other; touching endpoints do not count. */
function properIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  const s1 = (d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0);
  const s2 = (d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0);
  return s1 && s2;
}

/** Hard ceiling on pairwise comparisons; beyond it the count is marked truncated. */
export const MAX_COMPARED_PAIRS = 50_000_000;

/**
 * Approximate crossing count over dumped target positions.
 * @param {Float32Array|number[]} x node x positions
 * @param {Float32Array|number[]} y node y positions
 * @param {Array<{source:number,target:number}>} edges
 * @param {number} K grid cells per side (default 32)
 */
export function countCrossings(x, y, edges, K = 32) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < x.length; i += 1) {
    minX = Math.min(minX, x[i]);
    minY = Math.min(minY, y[i]);
    maxX = Math.max(maxX, x[i]);
    maxY = Math.max(maxY, y[i]);
  }
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const cellOf = (px, py) => {
    const col = Math.min(K - 1, Math.max(0, Math.floor(((px - minX) / w) * K)));
    const row = Math.min(K - 1, Math.max(0, Math.floor(((py - minY) / h) * K)));
    return row * K + col;
  };

  const buckets = new Map();
  const edgeCells = [];
  for (let e = 0; e < edges.length; e += 1) {
    const ca = cellOf(x[edges[e].source], y[edges[e].source]);
    const cb = cellOf(x[edges[e].target], y[edges[e].target]);
    edgeCells.push([ca, cb]);
    const list = buckets.get(ca);
    if (list) list.push(e);
    else buckets.set(ca, [e]);
  }

  let crossings = 0;
  let compared = 0;
  let truncated = false;
  for (let e = 0; e < edges.length; e += 1) {
    if (compared >= MAX_COMPARED_PAIRS) {
      truncated = true;
      break;
    }
    const [ca, cb] = edgeCells[e];
    const rowA = Math.floor(ca / K);
    const colA = ca % K;
    const rowB = Math.floor(cb / K);
    const colB = cb % K;
    const rowLo = Math.max(0, Math.min(rowA, rowB) - 1);
    const rowHi = Math.min(K - 1, Math.max(rowA, rowB) + 1);
    const colLo = Math.max(0, Math.min(colA, colB) - 1);
    const colHi = Math.min(K - 1, Math.max(colA, colB) + 1);

    const seen = new Set();
    for (let row = rowLo; row <= rowHi; row += 1) {
      for (let col = colLo; col <= colHi; col += 1) {
        const list = buckets.get(row * K + col);
        if (!list) continue;
        for (const f of list) {
          if (f <= e || seen.has(f)) continue;
          seen.add(f);
          compared += 1;
          const es = edges[e].source;
          const et = edges[e].target;
          const fs = edges[f].source;
          const ft = edges[f].target;
          if (es === fs || es === ft || et === fs || et === ft) continue;
          if (
            properIntersect(
              x[es], y[es], x[et], y[et],
              x[fs], y[fs], x[ft], y[ft],
            )
          ) {
            crossings += 1;
          }
        }
      }
    }
  }

  return {
    approxCount: crossings,
    comparedPairs: compared,
    cells: K,
    truncated,
    method: "grid-bucketed orientation-test (K×K buckets; source-endpoint bucket; endpoint-bbox rectangle +1 cell)",
    caveats: truncated
      ? `Comparison pair count hit the ${MAX_COMPARED_PAIRS} cap; crossing count is partial and must not be compared against untruncated reports.`
      : "Approximation, not an exact sweep-line count. Edges in unrelated cells are never compared; expect the count to undercount tangled long edges. Compare two fixtures measured with the same --cells.",
  };
}
