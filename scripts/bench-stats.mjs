/**
 * T-063 / Issue #19 #20 — shared statistics + environment helpers for the
 * layout / render benchmark scripts.
 *
 * No new dependencies: only node:os / node:child_process / node:path. The browser
 * CDP drivers (`layout-bench.mjs`, `layout-soak.mjs`) and the pure-Node kernel
 * bench (`kernel-bench.ts`) share the percentile definitions here so the
 * "median / p95 / p99 / 1% low" numbers mean the same thing in every report.
 *
 * Statistics definitions (see `docs/t063-bench.adoc` §统计口径):
 *
 *  - Samples are frame intervals (ms) or layout-tick intervals (ms), always in
 *    sample order before sorting. Layout tick time is NEVER folded into a
 *    render frame sample.
 *  - median / p95 / p99 use nearest-rank on the ascending copy, matching the
 *    in-page `quantile()` in `GpuGraphView.tsx`:
 *      idx = clamp(round((n - 1) * q), 0, n - 1)
 *  - 1% low = arithmetic mean of the worst ceil(n / 100) samples (slowest 1%
 *    frame times); `low1Fps = round(1000 / low1Ms)`. The alternative "p99
 *    frame time reported as a low-fps number" is NOT used; the raw p99 stays
 *    in its own field.
 */
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.dirname(HERE);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Nearest-rank quantile over an already ascending array. */
export function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx];
}

const round2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/** Full frame/tick summary from a raw sample array (ms). */
export function summarize(samples) {
  const n = (samples || []).length;
  if (n === 0) {
    return {
      count: 0,
      medianMs: null,
      p95Ms: null,
      p99Ms: null,
      low1Ms: null,
      low1Fps: null,
      meanMs: null,
      minMs: null,
      maxMs: null,
      fpsFromMedian: null,
    };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);
  const p99 = quantile(sorted, 0.99);
  const k = Math.max(1, Math.ceil(n / 100));
  const worst = sorted.slice(n - k);
  const low1Ms = worst.reduce((sum, v) => sum + v, 0) / worst.length;
  const mean = sorted.reduce((sum, v) => sum + v, 0) / n;
  return {
    count: n,
    medianMs: round2(median),
    p95Ms: round2(p95),
    p99Ms: round2(p99),
    low1Ms: round2(low1Ms),
    low1Fps: low1Ms > 0 ? Math.round(1000 / low1Ms) : null,
    meanMs: round2(mean),
    minMs: round2(sorted[0]),
    maxMs: round2(sorted[n - 1]),
    fpsFromMedian: median > 0 ? Math.round(1000 / median) : null,
  };
}

/** Machine facts the JSON must record; never estimated for a different box. */
export function machineInfo() {
  const cpus = os.cpus();
  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    node: process.version,
    cpuModel: cpus[0]?.model ?? "unknown",
    logicalCores: cpus.length,
    totalMemBytes: os.totalmem(),
  };
}

/** HEAD commit + subject + dirty flag for reproducibility. */
export function gitHead(repoRoot = REPO_ROOT) {
  try {
    const head = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
    const subject = spawnSync("git", ["-C", repoRoot, "log", "-1", "--format=%s"], { encoding: "utf8" });
    const status = spawnSync("git", ["-C", repoRoot, "status", "--porcelain"], { encoding: "utf8" });
    return {
      commit: (head.stdout || "").trim() || "unknown",
      subject: (subject.stdout || "").trim(),
      dirty: (status.stdout || "").trim().length > 0,
    };
  } catch (e) {
    return { commit: "unknown", subject: "", dirty: null, error: String(e) };
  }
}

/* ------------------------------------------------------------------ */
/* minimal CLI flag parsing                                            */
/* ------------------------------------------------------------------ */

/** Parse `--flag=value`, `--flag value`, bare `--flag` and positional args. */
export function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (const token of argv) {
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq >= 0) flags[token.slice(2, eq)] = token.slice(eq + 1);
      else flags[token.slice(2)] = true;
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

export function flagInt(flags, name, fallback) {
  const raw = flags[name];
  if (raw == null || raw === true) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Comma-separated numeric list, e.g. `--nodes=100000,200000`. */
export function flagNumList(flags, name, fallback) {
  const raw = flags[name];
  if (raw == null || raw === true) return fallback;
  return String(raw)
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Percent difference between two measured values; null when either side is missing. */
export function pctDiff(current, prior) {
  if (current == null || prior == null || prior === 0) return null;
  return Math.round(((current - prior) / prior) * 10000) / 100;
}
