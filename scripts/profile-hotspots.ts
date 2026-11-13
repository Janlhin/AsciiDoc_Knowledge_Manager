#!/usr/bin/env node
/**
 * Front-end hot-spot profiler (Node-side, real source via Vite SSR).
 *
 * Uses the SAME Vault / MetadataIndex / parseDocument the app runs, so the
 * numbers are the app's numbers — not a re-implementation.
 *
 * Usage: node scripts/profile-hotspots.ts <dir>
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const vaultDir = process.argv[2];
if (!vaultDir) {
  console.error("用法: node scripts/profile-hotspots.ts <目录>");
  process.exit(2);
}
const root = resolve(vaultDir);

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const { createServer } = await import("vite");
const viteConfig = {
  configFile: false,
  root: resolve(import.meta.dirname, ".."),
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
} as unknown as Parameters<typeof createServer>[0];
const server = await createServer(viteConfig);

try {
  const { Vault, MemoryVaultAdapter } = await server.ssrLoadModule("/src/core/vault.ts");
  const { MetadataIndex } = await server.ssrLoadModule("/src/core/metadata.ts");
  const { EventBus } = await server.ssrLoadModule("/src/core/events.ts");

  // Seed the in-memory vault with every readable text file.
  const seed: Record<string, string> = {};
  for (const f of walk(root)) {
    const rel = relative(root, f).split("\\").join("/");
    try {
      seed[rel] = readFileSync(f, "utf8");
    } catch {
      /* binary — skip */
    }
  }
  console.log("seeded files:", Object.keys(seed).length);

  const events = new EventBus();
  const vault = new Vault(new MemoryVaultAdapter(seed), events);
  await vault.load();

  const index = new MetadataIndex(vault, events);

  const t0 = performance.now();
  await index.rebuildAll();
  const total = performance.now() - t0;
  const all = index.getAll();
  console.log();
  console.log("=== index build (rebuildAll) ===");
  console.log("  total      : %s ms", total.toFixed(1));
  console.log("  indexed    : %d files", all.length);

  // --- pure parse cost per file (the synchronous main-thread part) ---
  const { parseDocument } = await server.ssrLoadModule("/src/core/metadata.ts");
  const perFile: { path: string; ms: number; size: number }[] = [];
  let parseTotal = 0;
  for (const meta of all) {
    const content = seed[meta.path] ?? "";
    const t = performance.now();
    parseDocument(meta.path, content);
    const ms = performance.now() - t;
    parseTotal += ms;
    perFile.push({ path: meta.path, ms, size: content.length });
  }
  perFile.sort((a, b) => b.ms - a.ms);

  console.log();
  console.log("=== parseDocument cost (synchronous, main-thread) ===");
  console.log("  sum  : %s ms over %d files", parseTotal.toFixed(1), perFile.length);
  console.log("  mean : %s ms", (parseTotal / perFile.length).toFixed(3));
  console.log("  max  : %s ms", perFile[0]?.ms.toFixed(2));
  const over16 = perFile.filter((p) => p.ms > 16).length;
  console.log("  files whose own parse exceeds one frame (16.7ms): %d", over16);

  console.log();
  console.log("=== 15 slowest files to parse ===");
  for (const p of perFile.slice(0, 15)) {
    console.log(
      "  %8s ms  %9s B  %s",
      p.ms.toFixed(2),
      String(p.size).padStart(9),
      p.path.slice(0, 64),
    );
  }

  // --- name-map rebuild ---
  const stripDocExtension = (p: string) => {
    const i = p.lastIndexOf(".");
    return /\.(md|adoc)$/i.test(p) ? p.slice(0, i) : p;
  };
  const rebuildNameMap = () => {
    const nameToPaths = new Map<string, Set<string>>();
    const lowerPathToPath = new Map<string, string>();
    for (const meta of all) lowerPathToPath.set(meta.path.toLowerCase(), meta.path);
    const add = (name: string, path: string) => {
      const key = name.toLowerCase();
      if (!key) return;
      let set = nameToPaths.get(key);
      if (!set) nameToPaths.set(key, (set = new Set()));
      set.add(path);
    };
    for (const meta of all) {
      add(stripDocExtension(meta.path.split("/").pop() ?? meta.path), meta.path);
      for (const alias of meta.aliases) add(alias, meta.path);
    }
    return { nameToPaths, lowerPathToPath };
  };
  for (let i = 0; i < 5; i++) rebuildNameMap();
  const nm: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t = performance.now();
    rebuildNameMap();
    nm.push(performance.now() - t);
  }
  nm.sort((a, b) => a - b);
  console.log();
  console.log("=== rebuildNameMap (full name-map rebuild) ===");
  console.log("  p50 %s ms   p95 %s ms   worst %s ms", nm[15].toFixed(3), nm[28].toFixed(3), nm[29].toFixed(3));

  // --- graph build ---
  const t2 = performance.now();
  const graph = index.getGraph();
  const gMs = performance.now() - t2;
  console.log();
  console.log("=== graph build ===");
  console.log("  getGraph() : %s ms", gMs.toFixed(1));
  console.log("  nodes: %d   edges: %d", graph.nodes.length, graph.edges.length);

  // --- what a full reindex of a SINGLE file costs (the per-keystroke path) ---
  const biggest = perFile[0];
  if (biggest) {
    const t3 = performance.now();
    for (let i = 0; i < 100; i++) parseDocument(biggest.path, seed[biggest.path] ?? "");
    const per = (performance.now() - t3) / 100;
    console.log();
    console.log("=== single-file reparse (the per-edit path) ===");
    console.log("  slowest file (%s): %s ms/parse", biggest.path.slice(0, 48), per.toFixed(3));
  }
} finally {
  await server.close();
}
