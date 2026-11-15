#!/usr/bin/env node
/**
 * 样式规范检查：本项目强制使用 SCSS。
 * 只要 web/ 下（排除构建产物）出现 .css 文件即失败。
 */
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..", "web");
const IGNORE = new Set(["dist", "node_modules"]);
const offenders = [];

function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (IGNORE.has(e.name)) continue;
      walk(join(dir, e.name));
    } else if (e.name.toLowerCase().endsWith(".css")) {
      offenders.push(relative(join(ROOT, ".."), join(dir, e.name)));
    }
  }
}

walk(ROOT);

if (offenders.length > 0) {
  console.error("样式规范检查失败：发现 .css 文件，本项目强制使用 SCSS。");
  for (const f of offenders) console.error(`  ${f}`);
  console.error("\n请改写为 .scss 后删除原文件。");
  process.exit(1);
}

console.log("样式规范检查通过：未发现游离的 .css 文件。");
