#!/usr/bin/env node
/**
 * 把真实工作区的 AsciiDoc 注入 Geode 的内存 vault，
 * 用于在不编译 Rust 的前提下验证「adoc 能否进入索引与图谱」。
 *
 * 用法：node scripts/gen-blueprint-seed.ts [工作区路径]
 * 产物：src/core/blueprint-seed.ts
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.argv[2] ?? "C:/Users/Janlhin/Desktop/Blueprint";
const OUT = "src/core/blueprint-seed.ts";
const SKIP = new Set([".git", "node_modules", ".obsidian", "dist", "build"]);
const MAX_BYTES = 400 * 1024;

interface SeedFile {
  /** 相对 ROOT 的 POSIX 路径，作为 seed 的键 */
  path: string;
  /** 绝对路径，用于读取内容 */
  abs: string;
  /** 字节数，用于汇总统计 */
  size: number;
}

const files: SeedFile[] = [];

function walk(dir: string): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      walk(join(dir, e.name));
    } else if (e.name.toLowerCase().endsWith(".adoc")) {
      const abs = join(dir, e.name);
      const size = statSync(abs).size;
      if (size > MAX_BYTES) continue;
      files.push({ path: relative(ROOT, abs).split("\\").join("/"), abs, size });
    }
  }
}

walk(ROOT);
files.sort((a, b) => a.path.localeCompare(b.path));

const entries = files.map((f) => {
  const content = readFileSync(f.abs, "utf8");
  return `  ${JSON.stringify(f.path)}: ${JSON.stringify(content)},`;
});

const totalBytes = files.reduce((s, f) => s + f.size, 0);
const banner = [
  "// 本文件由 scripts/gen-blueprint-seed.ts 自动生成，请勿手工编辑。",
  `// 来源工作区：${ROOT}`,
  `// 文件数：${files.length}（仅 .adoc，单文件上限 ${MAX_BYTES / 1024} KB）`,
  `// 原始体积：${(totalBytes / 1048576).toFixed(2)} MB`,
  `// 生成时间：${new Date().toISOString()}`,
  "",
  "/** 路径 → 内容，作为 MemoryVaultAdapter 的初始数据 */",
  "export const BLUEPRINT_SEED: Record<string, string> = {",
].join("\n");

writeFileSync(OUT, `${banner}\n${entries.join("\n")}\n};\n`, "utf8");

const outSize = statSync(OUT).size;
console.log(`已生成 ${OUT}`);
console.log(`  文件数：${files.length}`);
console.log(`  原始体积：${(totalBytes / 1048576).toFixed(2)} MB`);
console.log(`  产物体积：${(outSize / 1048576).toFixed(2)} MB`);
