#!/usr/bin/env node
/**
 * ADKM: 索引报告 —— 对一个目录跑真实索引，输出可核对的数字。
 *
 * 存在的理由：`docs/plans/L2-asciidoc-indexing.md` 的验收判据必须是「命令 + 退出码」，
 * 而应用内的索引跑在 Tauri 窗口里，无法在 CI 或终端复跑。这个脚本用同一套
 * `MetadataIndex`（不是另写一份解析），所以它给出的数字与应用内一致。
 *
 * 用法:
 *   node scripts/adoc-index-report.ts <目录> [--min-adoc N] [--json]
 *
 * 退出码:
 *   0  报告已产出，且 adoc 文档数 ≥ --min-adoc（默认 1）
 *   1  adoc 文档数低于阈值
 *   2  参数或目录错误
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const vaultDir = positional[0];

function flagValue(name: string, fallback: number): number {
  const hit = argv.find((a) => a.startsWith(`${name}=`));
  if (hit) return Number(hit.slice(name.length + 1));
  const idx = argv.indexOf(name);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("--")) return Number(argv[idx + 1]);
  return fallback;
}

if (!vaultDir) {
  console.error("用法: node scripts/adoc-index-report.ts <目录> [--min-adoc N] [--json]");
  process.exit(2);
}

const root = resolve(vaultDir);
try {
  if (!statSync(root).isDirectory()) throw new Error("不是目录");
} catch (err) {
  console.error(`无法读取目录: ${root} (${(err as Error).message})`);
  process.exit(2);
}

const MIN_ADOC = flagValue("--min-adoc", 1);
const JSON_OUT = flags.has("--json");
const EXT_LIMIT = 200 * 1024;
const SKIP_DIRS = new Set([".git", ".obsidian", "node_modules", ".trash"]);

/** 一条未能解析的 adoc 链接。 */
interface UnresolvedLink {
  from: string;
  target: string;
  syntax: string;
  /** 区分两类：属性没定义 → 扫描器无能为力；目标真的不存在 → 真断链 */
  reason: string;
}

/** 报告的最终结构。 */
interface IndexReport {
  vault: string;
  scanned: { md: number; adoc: number; skippedLarge: number };
  indexed: number;
  elapsedMs: number;
  graph: { nodes: number; edges: number };
  adocLinks: number;
  bySyntax: Record<string, number>;
  unresolved: { total: number; placeholders: number; missing: number };
  unresolvedDetail: UnresolvedLink[];
}

const toPosix = (p: string): string => p.split(sep).join("/");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

// 种子：可索引文档读入内容，其余文件只登记路径。
//
// 附件必须登记，否则 `xref:../Health/Diet.html[]` 会被判成断链——那是脚本的
// 盲点，不是数据的真相。内容留空即可：索引期只查附件路径，不读其字节。
// 超过 EXT_LIMIT 的文档整份跳过（不登记），否则一份 48 MB 的导出笔记会拖死脚本，
// 而且它若以空串参与索引，会变成一条「存在但内容为空」的假记录。
const seed: Record<string, string> = {};
let skippedLarge = 0;
let md = 0;
let adoc = 0;
for (const full of walk(root)) {
  const lower = full.toLowerCase();
  const isMd = lower.endsWith(".md");
  const isAdoc = lower.endsWith(".adoc");
  const rel = toPosix(relative(root, full));
  if (!isMd && !isAdoc) {
    seed[rel] = "";
    continue;
  }
  if (statSync(full).size > EXT_LIMIT) {
    skippedLarge++;
    continue;
  }
  seed[rel] = readFileSync(full, "utf8");
  if (isMd) md++;
  else adoc++;
}

/**
 * 用 Vite 的 SSR 模块加载器跑源码：Node 的 type stripping 不支持 TS 参数属性
 * （`constructor(private vault: Vault)`），而这些核心类大量使用它。
 */
async function buildReport(): Promise<IndexReport> {
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

    const events = new EventBus();
    const vault = new Vault(new MemoryVaultAdapter(seed), events);
    await vault.load();

    const index = new MetadataIndex(vault, events);
    const t0 = performance.now();
    await index.rebuildAll();
    const elapsedMs = performance.now() - t0;

    const all = index.getAll();
    const graph = index.getGraph();

    const bySyntax: Record<string, number> = {
      xref: 0,
      "xref-short": 0,
      "link-macro": 0,
      include: 0,
    };
    const unresolved: UnresolvedLink[] = [];
    let adocLinks = 0;
    for (const meta of all) {
      if (!meta.path.toLowerCase().endsWith(".adoc")) continue;
      adocLinks += meta.links.length;
      for (const link of meta.links) {
        if (link.syntax) bySyntax[link.syntax] = (bySyntax[link.syntax] ?? 0) + 1;
        if (index.resolveByKind(link, meta.path) !== null) continue;
        unresolved.push({
          from: meta.path,
          target: link.target,
          syntax: link.syntax ?? "?",
          // 区分两类：属性没定义 → 扫描器无能为力；目标真的不存在 → 真断链
          reason: /\{[A-Za-z0-9_-]+\}/.test(link.target) ? "属性未定义" : "目标不存在",
        });
      }
    }

    const unresolvedPlaceholders = unresolved.filter((u) => u.reason === "属性未定义").length;
    return {
      vault: root,
      scanned: { md, adoc, skippedLarge },
      indexed: all.length,
      elapsedMs: Math.round(elapsedMs),
      graph: { nodes: graph.nodes.length, edges: graph.edges.length },
      adocLinks,
      bySyntax,
      unresolved: {
        total: unresolved.length,
        placeholders: unresolvedPlaceholders,
        missing: unresolved.length - unresolvedPlaceholders,
      },
      unresolvedDetail: unresolved.slice(0, 40),
    };
  } finally {
    await server.close();
  }
}

const report = await buildReport();

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const { scanned, indexed, elapsedMs, graph, bySyntax, unresolved } = report;
  console.log("");
  console.log(`ADKM 索引报告`);
  console.log(`  工作区    ${report.vault}`);
  console.log(
    `  扫描      ${scanned.md} md · ${scanned.adoc} adoc` +
      (scanned.skippedLarge ? ` · 跳过 ${scanned.skippedLarge} 个大文件` : ""),
  );
  console.log(`  索引      ${indexed} 文档 · ${elapsedMs} ms`);
  console.log(`  图谱      ${graph.nodes} 节点 · ${graph.edges} 边`);
  console.log(`  adoc 链接 ${report.adocLinks} 条`);
  console.log(
    `  按语法    xref ${bySyntax.xref} · xref-short ${bySyntax["xref-short"]} · ` +
      `link-macro ${bySyntax["link-macro"]} · include ${bySyntax.include}`,
  );
  console.log(
    `  未解析    ${unresolved.total} 条（属性未定义 ${unresolved.placeholders} · 目标不存在 ${unresolved.missing}）`,
  );
  for (const u of report.unresolvedDetail) {
    console.log(`     ${u.from} → ${u.target}  [${u.reason}]`);
  }
  console.log("");
}

if (report.scanned.adoc < MIN_ADOC) {
  console.error(`adoc 文档数 ${report.scanned.adoc} 低于阈值 ${MIN_ADOC}`);
  process.exit(1);
}
