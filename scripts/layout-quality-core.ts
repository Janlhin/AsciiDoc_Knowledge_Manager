#!/usr/bin/env node
/**
 * T-063 / Issue #19 — layout quality comparison (same-seed fixture).
 *
 * A fast layout tick is not proof of a good layout: this script measures the
 * geometry of the settled kernel positions so a before/after comparison can
 * show "ticks got faster" without "edges got tangled".
 *
 * Measured on the pure Node kernel (no DOM / WebGL), deterministic: same
 * fixture seed + same tick count ⇒ bit-identical positions (verified by the
 * kernel's own `fingerprint()`). When the browser pool/motion lanes expose the
 * layout handle, the same metrics can be re-measured in-page; this file keeps
 * the metric definitions in one place.
 *
 * Metrics
 *  - edge length: mean / population variance / stddev / median / min / max.
 *    High variance means a few stretched springs alongside a dense core.
 *  - approximate crossings: grid-bucketed segment-intersection count. This is
 *    an APPROXIMATION, not an exact sweep-line count:
 *      1. map world bounds onto a K×K grid (K = --cells, default 32);
 *      2. bucket edges by the cell of their source endpoint;
 *      3. for each edge, compare it only against edges bucketed in the cell
 *         rectangle spanned by its two endpoints (expanded by one cell);
 *      4. proper segment intersection via orientation cross products, shared
 *         endpoints excluded.
 *    Edges whose endpoints land in unrelated cells are never compared, so the
 *    count is a lower-bound-ish approximation; `comparedPairs` shows how much
 *    work the bucketing allowed. Exact O(E²) crossing count is intentionally
 *    not run at 100k/200k scale.
 *
 * Usage (entry is the .mjs bootstrap; core is this file):
 *   node scripts/layout-quality.mjs --nodes=100000 --edges=200000 --seed=1 --ticks=300
 *   node scripts/layout-quality.mjs --json --out-dir=<dir>
 *
 * Exit codes: 0 ok; 2 bad arguments; 1 runtime failure.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createLayout } from "../src/features/graph/gpu/layout.ts";
import type { GpuEdge, GpuGraph, GpuNode } from "../src/features/graph/gpu/types.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(HERE);
const TOOLS_DIR = process.env.ADKM_TOOLS_DIR || "D:\\Projects\\ADKM-1127-wt\\t063-tools";

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

interface Flags {
  nodes: number;
  edges: number;
  seed: number;
  ticks: number;
  cells: number;
  json: boolean;
  outDir: string;
}

function parseArgv(argv: string[]): Flags {
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const int = (name: string, fallback: number): number => {
    const raw = get(name);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  };
  return {
    nodes: int("nodes", 100000),
    edges: int("edges", 0),
    seed: int("seed", 1),
    ticks: int("ticks", 300),
    cells: int("cells", 32),
    json: argv.includes("--json"),
    outDir: get("out-dir") || path.join(TOOLS_DIR, "p063-bench"),
  };
}

const flags = parseArgv(process.argv.slice(2));
if (flags.nodes <= 0 || flags.ticks <= 0 || flags.cells <= 0) {
  console.error("参数错误：--nodes / --ticks / --cells 必须为正整数");
  process.exit(2);
}
const edgeCount = flags.edges > 0 ? flags.edges : flags.nodes * 2;

/* ------------------------------------------------------------------ */
/* deterministic fixture (same xorshift32 family as the bench hook)     */
/* ------------------------------------------------------------------ */

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
  for (let i = 0; i < n; i += 1) {
    nodes.push({ id: `q:node-${i}`, label: `q ${i}`, resolved: true, degree: 0 });
  }
  const edges: GpuEdge[] = [];
  for (let e = 0; e < edgeCount; e += 1) {
    const a = Math.floor(rnd() * n);
    let b = Math.floor(rnd() * n);
    if (b === a) b = (b + 1) % n;
    edges.push({ source: a, target: b, broken: false });
    degree[a] += 1;
    degree[b] += 1;
  }
  for (let i = 0; i < n; i += 1) nodes[i].degree = degree[i];
  return { nodes, edges };
}

/* ------------------------------------------------------------------ */
/* statistics                                                           */
/* ------------------------------------------------------------------ */

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx];
}

interface LengthStats {
  count: number;
  mean: number;
  variance: number;
  stddev: number;
  median: number;
  min: number;
  max: number;
}

function lengthStats(lengths: number[]): LengthStats {
  const n = lengths.length;
  if (n === 0) {
    return { count: 0, mean: 0, variance: 0, stddev: 0, median: 0, min: 0, max: 0 };
  }
  const mean = lengths.reduce((s, v) => s + v, 0) / n;
  const variance = lengths.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const sorted = [...lengths].sort((a, b) => a - b);
  const round2 = (v: number) => Math.round(v * 10000) / 10000;
  return {
    count: n,
    mean: round2(mean),
    variance: round2(variance),
    stddev: round2(Math.sqrt(variance)),
    median: round2(quantileSorted(sorted, 0.5)),
    min: round2(sorted[0]),
    max: round2(sorted[n - 1]),
  };
}

/* ------------------------------------------------------------------ */
/* approximate crossings                                                */
/* ------------------------------------------------------------------ */

function cross(
  ox: number, oy: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

/** Proper intersection: both segments straddle each other; touching endpoints do not count. */
function properIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  const s1 = (d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0);
  const s2 = (d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0);
  return s1 && s2;
}

interface CrossingResult {
  approxCount: number;
  comparedPairs: number;
  cells: number;
  truncated: boolean;
  method: string;
  caveats: string;
}

/** Hard ceiling on pairwise comparisons; beyond it the count is marked truncated. */
const MAX_COMPARED_PAIRS = 50_000_000;

function countCrossings(
  x: Float32Array, y: Float32Array, edges: GpuEdge[], K: number,
): CrossingResult {
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
  const cellOf = (px: number, py: number): number => {
    const col = Math.min(K - 1, Math.max(0, Math.floor(((px - minX) / w) * K)));
    const row = Math.min(K - 1, Math.max(0, Math.floor(((py - minY) / h) * K)));
    return row * K + col;
  };

  const buckets = new Map<number, number[]>();
  const edgeCells: Array<[number, number]> = [];
  for (let e = 0; e < edges.length; e += 1) {
    const a = edges[e].source;
    const b = edges[e].target;
    const ca = cellOf(x[a], y[a]);
    const cb = cellOf(x[b], y[b]);
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

    const seen = new Set<number>();
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

/* ------------------------------------------------------------------ */
/* main                                                                 */
/* ------------------------------------------------------------------ */

function gitHead(): { commit: string; subject: string } {
  try {
    const head = spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" });
    const subject = spawnSync("git", ["-C", REPO_ROOT, "log", "-1", "--format=%s"], { encoding: "utf8" });
    return { commit: (head.stdout || "").trim() || "unknown", subject: (subject.stdout || "").trim() };
  } catch {
    return { commit: "unknown", subject: "" };
  }
}

function main(): void {
  const graph = makeGraph(flags.nodes, edgeCount, flags.seed);
  const layout = createLayout(graph);
  layout.stepUntil(flags.ticks);

  const lengths: number[] = [];
  for (const e of graph.edges) {
    const dx = layout.x[e.source] - layout.x[e.target];
    const dy = layout.y[e.source] - layout.y[e.target];
    lengths.push(Math.sqrt(dx * dx + dy * dy));
  }

  const bounds = layout.bounds();
  const report = {
    schema: "t063-layout-quality/v1",
    timestamp: new Date().toISOString(),
    commandLine: process.argv.join(" "),
    repo: { root: REPO_ROOT, git: gitHead() },
    fixture: { nodes: flags.nodes, edges: edgeCount, seed: flags.seed, ticks: flags.ticks, rng: "xorshift32" },
    positions: {
      fingerprint: layout.fingerprint(),
      settled: layout.settled(),
      alpha: Math.round(layout.alpha() * 10000) / 10000,
      bounds,
    },
    edgeLengths: lengthStats(lengths),
    crossings: countCrossings(layout.x, layout.y, graph.edges, flags.cells),
    screenshot: {
      available: false,
      reason: "Node kernel mode has no canvas. Browser screenshots are captured by the CDP bench/e2e flow once the layout handle is exposed.",
    },
  };

  if (flags.json) {
    mkdirSync(flags.outDir, { recursive: true });
    const file = path.join(flags.outDir, `quality-${flags.nodes}-seed${flags.seed}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
    console.log(`quality report: ${file}`);
  }

  const el = report.edgeLengths;
  const cr = report.crossings;
  console.log(
    `nodes=${flags.nodes} edges=${edgeCount} seed=${flags.seed} ticks=${flags.ticks} ` +
      `len mean=${el.mean} var=${el.variance} std=${el.stddev} median=${el.median} ` +
      `crossings≈${cr.approxCount} (compared=${cr.comparedPairs}, K=${cr.cells}) fingerprint=${report.positions.fingerprint}`,
  );
}

main();
