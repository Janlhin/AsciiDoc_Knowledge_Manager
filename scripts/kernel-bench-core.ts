#!/usr/bin/env node
/**
 * T-063 / Issue #19 #20 — Node-side layout kernel microbenchmark.
 *
 * This is the only performance check that can run in CI: it exercises the pure
 * TS layout kernel (`src/features/graph/gpu/layout.ts`) in-process, with no
 * DOM, WebGL, Worker or GPU. The browser render/soak benches need a real GPU
 * and stay out of the PR gate (see `docs/t063-bench.adoc` §CI 门禁).
 *
 * What it measures: single-tick wall time on a deterministic synthetic graph
 * (xorshift32, fixed seed), after a short warmup. It does NOT measure Worker
 * offload, SAB/WASM paths or render frames — those belong to the CDP bench.
 *
 * Gate posture: WARN ONLY. The script exits 0 in warn mode; a breached warn
 * band is recorded as `status: "warn"` in the JSON and printed as a `[warn]`
 * line. Hard `fail` thresholds are disabled until the post-merge baseline sets
 * them from real data (upgrade path in the doc). The one absolute sanity
 * guard mirrors the existing vitest informational test: a median tick over
 * 1000 ms is recorded as `status: "error"` (still non-zero-exit here).
 *
 * Usage (entry is the .mjs bootstrap; core is this file):
 *   node scripts/kernel-bench.mjs
 *   node scripts/kernel-bench.mjs --sizes=100000,200000 --ticks=20 --json
 *
 * Exit codes: 0 ok (warn/error are reported, not fatal); 2 bad arguments;
 * 1 runtime failure.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createLayout } from "../src/features/graph/gpu/layout.ts";
import type { GpuEdge, GpuGraph, GpuNode } from "../src/features/graph/gpu/types.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(HERE);
const TOOLS_DIR = process.env.ADKM_TOOLS_DIR || "D:\\Projects\\ADKM-1127-wt\\t063-tools";

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

function getArgv(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
function intArg(name: string, fallback: number): number {
  const raw = getArgv(name);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
const sizes = (getArgv("sizes") || "100000,200000")
  .split(",")
  .map((v) => Number(v.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const TICKS = intArg("ticks", 20);
const WARMUP = intArg("warmup", 5);
const SEED = intArg("seed", 20261128);
const JSON_OUT = process.argv.includes("--json");
const OUT_DIR = getArgv("out-dir") || path.join(TOOLS_DIR, "p063-bench");

if (sizes.length === 0 || TICKS <= 0 || WARMUP < 0) {
  console.error("参数错误：--sizes 需为正整数列表，--ticks 为正整数，--warmup 非负");
  process.exit(2);
}

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
    nodes.push({ id: `k:node-${i}`, label: `k ${i}`, resolved: true, degree: 0 });
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
/* statistics (same definitions as scripts/bench-stats.mjs)             */
/* ------------------------------------------------------------------ */

interface TickSummary {
  count: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  low1Ms: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
}

function summarizeTicks(samples: number[]): TickSummary {
  const n = samples.length;
  if (n === 0) {
    return { count: 0, medianMs: 0, p95Ms: 0, p99Ms: 0, low1Ms: 0, meanMs: 0, minMs: 0, maxMs: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const q = (p: number): number =>
    sorted[Math.min(n - 1, Math.max(0, Math.round((n - 1) * p)))];
  const k = Math.max(1, Math.ceil(n / 100));
  const worst = sorted.slice(n - k);
  const low1Ms = worst.reduce((sum, v) => sum + v, 0) / k;
  const mean = sorted.reduce((sum, v) => sum + v, 0) / n;
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  return {
    count: n,
    medianMs: r2(q(0.5)),
    p95Ms: r2(q(0.95)),
    p99Ms: r2(q(0.99)),
    low1Ms: r2(low1Ms),
    meanMs: r2(mean),
    minMs: r2(sorted[0]),
    maxMs: r2(sorted[n - 1]),
  };
}

/**
 * Provisional warn bands, derived from the 2026-11-28 local baseline kernel run
 * (≈1.5× baseline median): 100k 205.55 ms → 300 ms; 200k 451.46 ms → 680 ms.
 * NOT hard gates: fail thresholds stay disabled until the post-merge baseline
 * re-derives them on the integrated build. The 1000 ms sanity guard mirrors
 * the existing vitest informational test.
 */
const PROVISIONAL_WARN_MEDIAN_MS: Record<number, number> = {
  100000: 300,
  200000: 680,
};
const SANITY_MEDIAN_MS = 1000;

function gitHead(): { commit: string; subject: string } {
  try {
    const head = spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" });
    const subject = spawnSync("git", ["-C", REPO_ROOT, "log", "-1", "--format=%s"], { encoding: "utf8" });
    return { commit: (head.stdout || "").trim() || "unknown", subject: (subject.stdout || "").trim() };
  } catch {
    return { commit: "unknown", subject: "" };
  }
}

interface SizeResult {
  nodes: number;
  edges: number;
  seed: number;
  warmup: number;
  ticks: number;
  summary: TickSummary;
  gate: {
    mode: "warn";
    failEnabled: boolean;
    status: "ok" | "warn" | "error";
    checks: string[];
  };
}

function benchSize(nodes: number): SizeResult {
  const edges = nodes * 2;
  const graph = makeGraph(nodes, edges, SEED);
  const layout = createLayout(graph);

  for (let i = 0; i < WARMUP; i += 1) layout.step();

  const samples: number[] = [];
  for (let i = 0; i < TICKS; i += 1) {
    const t0 = performance.now();
    layout.step();
    samples.push(performance.now() - t0);
  }

  const summary = summarizeTicks(samples);
  const checks: string[] = [];
  let status: SizeResult["gate"]["status"] = "ok";

  if (summary.medianMs >= SANITY_MEDIAN_MS) {
    status = "error";
    checks.push(`median ${summary.medianMs}ms ≥ sanity guard ${SANITY_MEDIAN_MS}ms`);
  } else {
    const warnMedian = PROVISIONAL_WARN_MEDIAN_MS[nodes];
    if (warnMedian != null && summary.medianMs > warnMedian) {
      status = "warn";
      checks.push(`median ${summary.medianMs}ms > provisional warn band ${warnMedian}ms`);
    }
  }

  return {
    nodes,
    edges,
    seed: SEED,
    warmup: WARMUP,
    ticks: TICKS,
    summary,
    gate: { mode: "warn", failEnabled: false, status, checks },
  };
}

function main(): void {
  const results = sizes.map(benchSize);

  const report = {
    schema: "t063-kernel-bench/v1",
    timestamp: new Date().toISOString(),
    commandLine: process.argv.join(" "),
    repo: { root: REPO_ROOT, git: gitHead() },
    machine: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      logicalCores: os.cpus().length,
      cpuModel: os.cpus()[0]?.model ?? "unknown",
    },
    results,
  };

  if (JSON_OUT) {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const r of results) {
      const file = path.join(OUT_DIR, `kernel-${r.nodes}.json`);
      writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
      console.log(`kernel report: ${file}`);
    }
  }

  console.log("kernel-bench (Node, pure TS kernel; warn-only)");
  for (const r of results) {
    const s = r.summary;
    console.log(
      `nodes=${r.nodes} edges=${r.edges} ticks=${r.ticks} ` +
        `median=${s.medianMs}ms p95=${s.p95Ms}ms p99=${s.p99Ms}ms low1=${s.low1Ms}ms ` +
        `min=${s.minMs} max=${s.maxMs} [${r.gate.status}]`,
    );
    for (const check of r.gate.checks) console.log(`  [warn] ${check}`);
  }
}

main();
