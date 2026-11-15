/**
 * Guard the command registry against "fake completion" (gap audit §11):
 * a command must have a real id, a resolvable name, a callback, and no duplicate
 * registration. Pure text scan — no app boot, no DOM, no new dependency.
 *
 *   node scripts/verify-command-registry.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const I18N_DIR = join(SRC, "core", "i18n");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const isI18n = (p: string) => p.replace(/\\/g, "/").includes("/core/i18n/");
const sources = files.filter((p) => !isI18n(p));

// ---- 1) command ids -------------------------------------------------------
const idAt: Array<{ id: string; file: string; line: number }> = [];
for (const file of sources) {
  const lines = readFileSync(file, "utf-8").split("\n");
  lines.forEach((line, i) => {
    const m = /id:\s*"([a-z][a-z0-9-]*:[a-zA-Z0-9:_-]+)"/.exec(line);
    if (m) idAt.push({ id: m[1], file: relative(ROOT, file), line: i + 1 });
  });
}
const byId = new Map<string, typeof idAt>();
for (const row of idAt) byId.set(row.id, [...(byId.get(row.id) ?? []), row]);
const duplicates = [...byId].filter(([, rows]) => rows.length > 1);

// ---- 2) i18n keys used by commands ---------------------------------------
const i18nText = files
  .filter(isI18n)
  .map((p) => readFileSync(p, "utf-8"))
  .join("\n");
const defined = new Set(
  [...i18nText.matchAll(/"([A-Za-z][A-Za-z0-9_.-]*\.[A-Za-z0-9_.-]+)":/g)].map(
    (m) => m[1],
  ),
);
const used = new Set<string>();
for (const file of sources) {
  const text = readFileSync(file, "utf-8");
  for (const m of text.matchAll(/nameKey:\s*"([^"]+)"/g)) used.add(m[1]);
  for (const m of text.matchAll(/name:\s*\(\)\s*=>\s*t\("([^"]+)"\)/g)) used.add(m[1]);
}
const missingI18n = [...used].filter((k) => !defined.has(k));

// ---- 3) registered commands must carry a callback -------------------------
// Direct registrations are checked by looking at the following ~25 lines.
const noCallback: string[] = [];
for (const file of sources) {
  const text = readFileSync(file, "utf-8");
  for (const m of text.matchAll(/commands\.register\(\{/g)) {
    const chunk = text.slice(m.index, m.index + 1400);
    const id = /id:\s*"([^"]+)"/.exec(chunk)?.[1] ?? "(unknown)";
    if (!/callback:/.test(chunk)) noCallback.push(id);
  }
}

// ---- report ---------------------------------------------------------------
const problems: string[] = [];
for (const [id, rows] of duplicates) {
  problems.push(
    `duplicate id ${id}: ${rows.map((r) => `${r.file}:${r.line}`).join(", ")}`,
  );
}
for (const key of missingI18n.sort()) problems.push(`missing i18n key ${key}`);
for (const id of noCallback) problems.push(`no callback for ${id}`);

console.log(
  `command ids: ${byId.size} unique / ${idAt.length} literals | i18n keys used: ${used.size}`,
);
if (problems.length > 0) {
  for (const p of problems) console.error("  FAIL", p);
  process.exit(1);
}
console.log("OK: no duplicate ids, all command names resolve, every registration has a callback");
