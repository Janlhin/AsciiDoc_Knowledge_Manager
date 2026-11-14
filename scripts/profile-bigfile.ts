#!/usr/bin/env node
/**
 * Narrow down WHICH part of parseDocument is slow on a huge file.
 * Usage: node scripts/profile-bigfile.ts <file>
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = process.argv[2];
if (!file) {
  console.error("用法: node scripts/profile-bigfile.ts <文件>");
  process.exit(2);
}const content = readFileSync(resolve(file), "utf8");
console.log("file: %s", file);
console.log("size: %s chars, %s lines", content.length.toLocaleString(), content.split("\n").length.toLocaleString());

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
  const meta = await server.ssrLoadModule("/src/core/metadata.ts");

  // Time the individual exported helpers the parser is built from.
  const candidates = [
    "parseDocument",
    "parseNote",
    "maskCodeRegions",
    "stripHeadingText",
    "parseFrontmatter",
    "getCssClasses",
    "extractFootnoteDefs",
    "parseFootnoteDefinitions",
  ];

  console.log();
  console.log("=== per-function timing on this file ===");
  for (const name of candidates) {
    const fn = (meta as Record<string, unknown>)[name];
    if (typeof fn !== "function") {
      console.log("  %-26s (not exported)", name);
      continue;
    }
    let ms = 0;
    let err = "";
    try {
      const t = performance.now();
      if (name === "parseDocument" || name === "parseNote") {
        (fn as (p: string, c: string) => unknown)("probe.md", content);
      } else if (name === "maskCodeRegions" || name === "stripHeadingText") {
        (fn as (s: string) => unknown)(content);
      } else if (name === "parseFrontmatter") {
        (fn as (c: string) => unknown)(content);
      } else if (name === "getCssClasses") {
        (fn as (c: string) => unknown)(content);
      } else if (name === "extractFootnoteDefs") {
        (fn as (c: string, m: string) => unknown)(content, content);
      } else if (name === "parseFootnoteDefinitions") {
        (fn as (c: string) => unknown)(content);
      }
      ms = performance.now() - t;
    } catch (e) {
      err = " ERR:" + (e as Error).message.slice(0, 40);
    }
    console.log("  %-26s %9s ms%s", name, ms.toFixed(2), err);
  }

  // Now the real thing, twice, to see the steady-state cost.
  console.log();
  console.log("=== parseDocument repeated ===");
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    meta.parseDocument("probe.md", content);
    console.log("  run %d: %s ms", i + 1, (performance.now() - t).toFixed(1));
  }

  // Hypothesis check: is it the regexes in the markdown scanner?
  console.log();
  console.log("=== scale test: same content truncated to N chars ===");
  for (const frac of [0.1, 0.25, 0.5, 1.0]) {
    const sub = content.slice(0, Math.floor(content.length * frac));
    const t = performance.now();
    meta.parseDocument("probe.md", sub);
    console.log(
      "  %s MB (%s%%): %s ms",
      (sub.length / 1048576).toFixed(1),
      (frac * 100).toFixed(0),
      (performance.now() - t).toFixed(1),
    );
  }

  // Quadratic check: is time super-linear in size?
  console.log();
  console.log("=== linearity check (time per MB) ===");
  for (const frac of [0.25, 0.5, 0.75, 1.0]) {
    const sub = content.slice(0, Math.floor(content.length * frac));
    const t = performance.now();
    meta.parseDocument("probe.md", sub);
    const ms = performance.now() - t;
    console.log(
      "  %s MB -> %s ms  (=%s ms/MB)",
      (sub.length / 1048576).toFixed(1),
      ms.toFixed(1),
      (ms / (sub.length / 1048576)).toFixed(1),
    );
  }
} finally {
  await server.close();
}
