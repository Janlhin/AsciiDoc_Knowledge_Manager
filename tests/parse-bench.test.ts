/**
 * Startup parse cost baseline (T-039 measurement, not a CI test).
 *
 * Measures what the in-memory `MetadataIndex` pays at every launch: read every
 * indexable file and parse it. That is the number the persistent index must
 * beat once boot hydration lands — without it, "启动快多了" is an impression
 * rather than a measurement.
 *
 * Skipped unless GEODE_BENCH_VAULT points at a vault:
 *
 *   GEODE_BENCH_VAULT="C:/Users/me/Desktop/Blueprint" npx vitest run tests/parse-bench.test.ts
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "@core/metadata";

const VAULT = process.env.GEODE_BENCH_VAULT;
const INDEXABLE = new Set([".md", ".adoc"]);
const MAX_FILES = Number(process.env.GEODE_BENCH_MAX ?? 2000);

async function collect(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // .obsidian / .git hold no notes and can be large
      if (entry.name.startsWith(".")) continue;
      await collect(full, out);
    } else if (INDEXABLE.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      out.push(full);
      if (out.length >= MAX_FILES) return out;
    }
  }
  return out;
}

describe.skipIf(!VAULT)("startup parse cost", () => {
  it("reports read + parse time over the whole vault", async () => {
    const files = await collect(VAULT as string);
    expect(files.length).toBeGreaterThan(0);

    let bytes = 0;
    const readMs: number[] = [];
    const parseMs: number[] = [];

    // warm start = skip this entirely for unchanged files (that is the win)
    for (const file of files) {
      const t0 = performance.now();
      const content = await readFile(file, "utf8");
      const t1 = performance.now();
      bytes += content.length;
      const rel = relative(VAULT as string, file).replace(/\\/g, "/");
      parseDocument(rel, content);
      const t2 = performance.now();
      readMs.push(t1 - t0);
      parseMs.push(t2 - t1);
    }

    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const pct = (xs: number[], p: number) => {
      const sorted = [...xs].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    };

    const read = sum(readMs);
    const parse = sum(parseMs);
    // Sequential on purpose: the app uses a pool of 8, so this is an upper bound.
    console.log(
      [
        `vault files      : ${files.length}`,
        `content          : ${(bytes / 1024 / 1024).toFixed(1)} MB`,
        `read             : ${read.toFixed(0)} ms (p95 ${pct(readMs, 0.95).toFixed(2)} ms/file)`,
        `parse            : ${parse.toFixed(0)} ms (p95 ${pct(parseMs, 0.95).toFixed(2)} ms/file)`,
        `total (serial)   : ${(read + parse).toFixed(0)} ms`,
        `per file         : ${((read + parse) / files.length).toFixed(2)} ms`,
      ].join("\n"),
    );

    // A sanity assertion, not a perf gate: the harness must actually parse.
    expect(parse).toBeGreaterThan(0);
  }, 120_000);
});
