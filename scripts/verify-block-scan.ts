#!/usr/bin/env node
/**
 * Equivalence check: the pruned block-marker scan must produce EXACTLY the
 * same blocks as the original per-line scan, on every real file in the vault.
 *
 * The old algorithm is re-implemented here verbatim from the pre-change
 * source; the new one is exercised through the real parseNote().
 *
 * Usage: node scripts/verify-block-scan.ts <dir>
 * Exit code: 0 = identical, 1 = mismatch found, 2 = bad arguments.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const vaultDir = process.argv[2];
if (!vaultDir) {
  console.error("用法: node scripts/verify-block-scan.ts <目录>");
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

/* ---- the ORIGINAL algorithm, verbatim ---- */
const BLOCK_MARKER_RE = /\s\^([A-Za-z0-9-]+)\s*$/;
const CODE_FENCE_RE = /```[\s\S]*?(```|$)/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;

function maskCodeRegions(s: string): string {
  return s
    .replace(CODE_FENCE_RE, (m) => " ".repeat(m.length))
    .replace(INLINE_CODE_RE, (m) => " ".repeat(m.length));
}

function parseFrontmatterSpan(content: string): { to: number } | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;
  return { to: end + 4 };
}

function oldBlocks(content: string): { id: string; from: number; to: number }[] {
  const fm = parseFrontmatterSpan(content);
  const withoutFm = fm ? " ".repeat(fm.to) + content.slice(fm.to) : content;
  const masked = maskCodeRegions(withoutFm);
  const blocks: { id: string; from: number; to: number }[] = [];
  const blockIndexById = new Map<string, number>();
  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  const lineCount = lineStarts.length;
  const lineEndAt = (li: number): number => {
    let end = li + 1 < lineCount ? lineStarts[li + 1] - 1 : content.length;
    if (end > lineStarts[li] && content.charCodeAt(end - 1) === 13) end--;
    return end;
  };
  const isBlank = (li: number): boolean =>
    withoutFm.slice(lineStarts[li], lineEndAt(li)).trim() === "";
  for (let li = 0; li < lineCount; li++) {
    const m = BLOCK_MARKER_RE.exec(masked.slice(lineStarts[li], lineEndAt(li)));
    if (!m) continue;
    let start = li;
    while (start > 0 && !isBlank(start - 1)) start--;
    let end = li;
    while (end + 1 < lineCount && !isBlank(end + 1)) end++;
    const ref = { id: m[1], from: lineStarts[start], to: lineEndAt(end) };
    const existing = blockIndexById.get(m[1].toLowerCase());
    if (existing !== undefined) blocks[existing] = ref;
    else {
      blockIndexById.set(m[1].toLowerCase(), blocks.length);
      blocks.push(ref);
    }
  }
  return blocks;
}

/* ---- load the real parser ---- */
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
  const M = await server.ssrLoadModule("/src/core/metadata.ts");

  const files = walk(root).filter((f) => /\.(md|adoc)$/i.test(f));
  let checked = 0;
  let mismatches = 0;
  let totalBlocks = 0;

  for (const f of files) {
    let content: string;
    try {
      content = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const expected = oldBlocks(content);
    const actual = M.parseNote("x.md", content).blocks as {
      id: string;
      from: number;
      to: number;
    }[];
    checked++;
    totalBlocks += expected.length;
    const same =
      expected.length === actual.length &&
      expected.every(
        (e, i) =>
          e.id === actual[i].id && e.from === actual[i].from && e.to === actual[i].to,
      );
    if (!same) {
      mismatches++;
      console.log("MISMATCH:", relative(root, f));
      console.log("  expected:", JSON.stringify(expected.slice(0, 3)));
      console.log("  actual  :", JSON.stringify(actual.slice(0, 3)));
    }
  }

  console.log();
  console.log("files checked : %d", checked);
  console.log("blocks found  : %d", totalBlocks);
  console.log("mismatches    : %d", mismatches);
  if (mismatches === 0) {
    console.log("RESULT: PASS - the pruned scan is byte-identical to the original.");
  } else {
    console.log("RESULT: FAIL");
    process.exitCode = 1;
  }
} finally {
  await server.close();
}
