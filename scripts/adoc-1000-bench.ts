#!/usr/bin/env node
/**
 * T-069: 1,000 篇 adoc 性能基准（章程 §9.1）。
 *
 * 测的是哪一层（务必与报告口径一致）：
 *  - 「索引构建」= TS 侧 `MetadataIndex.rebuildAll()`：内存夹具读取 + `parseDocument`
 *    解析 + 元数据表 / 名称映射重建。**不含** Rust FTS5 持久化索引的 IPC 写入，
 *    **不含** Asciidoctor.js 渲染；两者在 Tauri 桌面路径上另测。
 *  - 「引用校验」= 纯函数引擎 `auditVault()`：在已解析的 meta.links 上做
 *    resolveLink / resolveXref / resolveInclude 解析与 include 环检测。
 *  - 内存口径 = Node 22 进程 `process.memoryUsage()`：`heapUsed` 为 V8 堆，
 *    `rss` 为常驻内存。**不含** WebView / Tauri 侧占用。
 *
 * 夹具确定性：LCG（种子 42）生成 N 篇平均约 5KB 的 adoc，含标题层级、文档头
 * 属性、xref / link / <<>> / include 引用（目标尽量可解析），另生成 20 个
 * include 片段。同一 count 下逐字节一致，可跨轮次 / 跨机器复跑比较。
 *
 * 用法:
 *   node scripts/adoc-1000-bench.ts [--count=1000] [--cold=5] [--hot=7] [--json]
 *
 * 退出码: 0 正常产出；2 参数错误；1 运行异常。
 */
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

const argv = process.argv.slice(2);

function flagInt(name: string, fallback: number): number {
  const hit = argv.find((a) => a.startsWith(`${name}=`));
  if (hit) return Number(hit.slice(name.length + 1));
  const idx = argv.indexOf(name);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("--")) return Number(argv[idx + 1]);
  return fallback;
}

const COUNT = flagInt("--count", 1000);
const COLD_ROUNDS = flagInt("--cold", 5);
const HOT_ROUNDS = flagInt("--hot", 7);
const JSON_OUT = argv.includes("--json");

if (!Number.isFinite(COUNT) || COUNT <= 0 || !Number.isFinite(COLD_ROUNDS) || COLD_ROUNDS <= 0 ||
  !Number.isFinite(HOT_ROUNDS) || HOT_ROUNDS <= 0) {
  console.error("参数错误：--count / --cold / --hot 必须为正整数");
  process.exit(2);
}

/* -------------------------------------------------------------------------- */
/* 确定性夹具                                                                 */
/* -------------------------------------------------------------------------- */

const WORDS = [
  "chapter", "section", "reference", "document", "source", "archive", "index", "notes",
  "schema", "policy", "review", "draft", "summary", "detail", "context", "structure",
  "link", "anchor", "heading", "metadata", "search", "vault", "concept", "example",
  "procedure", "guideline", "template", "property", "format", "render", "parse",
];

/** 确定性 xorshift LCG（与 graph-scale-bench 同一族），种子固定 42。 */
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}

function makeSeed(n: number): Record<string, string> {
  const random = rng(42);
  const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  const pick = <T,>(arr: T[]): T => arr[Math.floor(random() * arr.length)];

  const titles: string[] = [];
  for (let i = 0; i < n; i += 1) {
    titles.push(`Note ${String(i).padStart(5, "0")} ${pick(WORDS)}`);
  }

  const sentence = (words: number): string => {
    const out: string[] = [];
    for (let w = 0; w < words; w += 1) out.push(pick(WORDS));
    return out.join(" ");
  };

  const files: Record<string, string> = {};
  const partialCount = 20;
  for (let p = 0; p < partialCount; p += 1) {
    files[`partials/p${p}.adoc`] = `= Partial ${p}\n\n${sentence(12)}.\n`;
  }

  // 文件名用 slug（不含空格）：AsciiDoc xref/link 目标在空格处截断，
  // 带空格的 basename 会被误判为未解析；空格只保留在文档标题行里。
  const slugs: string[] = titles.map((t, i) => {
    const word = t.split(" ").pop() ?? "note";
    return `note-${String(i).padStart(5, "0")}-${word}`;
  });

  const folderOf = (x: number) => `Folder ${String(Math.floor(x / 100)).padStart(3, "0")}`;

  for (let i = 0; i < n; i += 1) {
    const folder = folderOf(i);
    let j = int(0, n - 1);
    if (j === i) j = (j + 1) % n;
    let k = int(0, n - 1);
    if (k === i) k = (k + 1) % n;
    const l = int(0, n - 1);
    const partial = `partials/p${int(0, partialCount - 1)}.adoc`;

    const parts: string[] = [
      `= ${titles[i]}`,
      ":revnumber: 1",
      ":bench-author: ADKM benchmark",
      "",
      "== Overview",
      "",
      `${sentence(18)}.`,
      "",
      "== References",
      "",
      // resolveXref 对纯 basename 无回退匹配，目标写库内相对路径（与真实 docs 写法一致）。
      `xref:${folderOf(l)}/${slugs[l]}.adoc[相关文档]`,
      `link:${folderOf(j)}/${slugs[j]}.adoc[链接说明]`,
      `<<${folderOf(k)}/${slugs[k]}.adoc, 短交叉引用>>`,
      `include::../${partial}[]`,
      "",
    ];

    let body = parts.join("\n");
    // 平均约 5KB：不足则补 prose，超出不裁（上限由索引层 MAX_BODY_CHARS 兜底，与本基准无关）。
    while (body.length < 5000) body += `\n${sentence(int(10, 24))}.\n`;
    files[`${folder}/${slugs[i]}.adoc`] = body;
  }
  return files;
}

/* -------------------------------------------------------------------------- */
/* 测量统计                                                                   */
/* -------------------------------------------------------------------------- */

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
}

interface PhaseSample {
  median: number;
  p95: number;
  mean: number;
  min: number;
  max: number;
  samples: number[];
}

function summarize(label: string, samples: number[]): PhaseSample {
  return {
    median: Math.round(median(samples) * 100) / 100,
    p95: Math.round(percentile(samples, 0.95) * 100) / 100,
    mean: Math.round(mean(samples) * 100) / 100,
    min: Math.round(Math.min(...samples) * 100) / 100,
    max: Math.round(Math.max(...samples) * 100) / 100,
    samples: samples.map((s) => Math.round(s * 100) / 100),
  };
}

function mb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* 主流程：经 Vite SSR 加载应用真实模块（与 profile-hotspots 同一方式）        */
/* -------------------------------------------------------------------------- */

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
  const { MetadataIndex, parseDocument } = await server.ssrLoadModule("/src/core/metadata.ts");
  const { EventBus } = await server.ssrLoadModule("/src/core/events.ts");
  const { auditVault } = await server.ssrLoadModule("/src/core/docAudit.ts");

  const seed = makeSeed(COUNT);
  const seedPaths = Object.keys(seed);

  interface BuiltContext {
    vault: InstanceType<typeof Vault>;
    index: InstanceType<typeof MetadataIndex>;
  }

  async function buildContext(): Promise<BuiltContext> {
    const events = new EventBus();
    const vault = new Vault(new MemoryVaultAdapter(seed), events);
    await vault.load();
    const index = new MetadataIndex(vault, events);
    await index.rebuildAll();
    return { vault, index };
  }

  const memBaseline = process.memoryUsage();

  // ① 冷索引：每轮全新 vault + 全新元数据索引，测首次构建。
  const coldIndexSamples: number[] = [];
  for (let round = 0; round < COLD_ROUNDS; round += 1) {
    const t0 = performance.now();
    const ctx = await buildContext();
    coldIndexSamples.push(performance.now() - t0);
    void ctx;
  }
  const memAfterCold = process.memoryUsage();

  // ② 热索引：同一索引反复 rebuildAll（暖启动路径，解析命中缓存之外的纯重建成本）。
  const warm = await buildContext();
  const hotIndexSamples: number[] = [];
  for (let round = 0; round < HOT_ROUNDS; round += 1) {
    const t0 = performance.now();
    await warm.index.rebuildAll();
    hotIndexSamples.push(performance.now() - t0);
  }
  const memAfterHotIndex = process.memoryUsage();

  // ③ 全量引用校验：auditVault 纯引擎，热跑多轮。
  const notes = seedPaths.map((path) => {
    const meta = warm.index.getMetadata(path);
    return { path, content: seed[path], meta: meta ?? parseDocument(path, seed[path]) };
  });
  const env = {
    resolveLink: (target: string, fromPath: string) => warm.index.resolveLink(target, fromPath),
    files: seedPaths,
  };
  const auditSamples: number[] = [];
  let auditIssueCount = 0;
  let auditScanned = 0;
  let auditByCategory: Record<string, number> = {};
  let auditBySeverity: Record<string, number> = {};
  for (let round = 0; round < HOT_ROUNDS; round += 1) {
    const t0 = performance.now();
    const report = auditVault(notes, env);
    auditSamples.push(performance.now() - t0);
    if (round === 0) {
      auditIssueCount = report.issues.length;
      auditScanned = report.filesScanned;
      auditByCategory = report.byCategory;
      auditBySeverity = report.bySeverity;
      console.error(`[bench] audit issues: ${auditIssueCount} files scanned: ${auditScanned}`);
      console.error(`[bench] byCategory: ${JSON.stringify(auditByCategory)}`);
    }
  }
  const memFinal = process.memoryUsage();

  const result = {
    env: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
      count: COUNT,
      coldRounds: COLD_ROUNDS,
      hotRounds: HOT_ROUNDS,
    },
    phases: {
      indexCold: summarize("index-cold", coldIndexSamples),
      indexHot: summarize("index-hot", hotIndexSamples),
      auditHot: summarize("audit-hot", auditSamples),
    },
    audit: {
      issues: auditIssueCount,
      filesScanned: auditScanned,
      byCategory: auditByCategory,
      bySeverity: auditBySeverity,
    },
    memory: {
      baseline: { heapUsedMb: mb(memBaseline.heapUsed), rssMb: mb(memBaseline.rss) },
      afterCold: { heapUsedMb: mb(memAfterCold.heapUsed), rssMb: mb(memAfterCold.rss) },
      afterHotIndex: { heapUsedMb: mb(memAfterHotIndex.heapUsed), rssMb: mb(memAfterHotIndex.rss) },
      final: { heapUsedMb: mb(memFinal.heapUsed), rssMb: mb(memFinal.rss) },
    },
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`T-069 adoc benchmark  count=${COUNT} cold=${COLD_ROUNDS} hot=${HOT_ROUNDS}`);
    console.log(`env: node=${process.version} platform=${process.platform} arch=${process.arch}`);
    console.log("");
    console.log("phase        median_ms  p95_ms   mean_ms   min_ms   max_ms");
    for (const [key, label] of [
      ["indexCold", "index-cold"],
      ["indexHot", "index-hot "],
      ["auditHot", "audit-hot "],
    ] as const) {
      const s = result.phases[key];
      console.log(
        `${label.padEnd(12)} ${String(s.median).padStart(9)} ${String(s.p95).padStart(8)} ${String(s.mean).padStart(9)} ${String(s.min).padStart(8)} ${String(s.max).padStart(8)}`,
      );
    }
    console.log("");
    console.log("memory        heapUsed_MB  rss_MB");
    for (const [key, label] of [
      ["baseline", "baseline   "],
      ["afterCold", "after-cold "],
      ["afterHotIndex", "after-hot-i"],
      ["final", "final      "],
    ] as const) {
      const m = result.memory[key];
      console.log(`${label.padEnd(14)} ${String(m.heapUsedMb).padStart(11)} ${String(m.rssMb).padStart(8)}`);
    }
    console.log("");
    console.log(`audit issues=${auditIssueCount} scanned=${auditScanned}`);
    console.log(
      `audit broken-xref=${auditByCategory["broken-xref"] ?? 0} broken-include=${auditByCategory["broken-include"] ?? 0}`,
    );
  }
} catch (err) {
  console.error("benchmark failed:", err);
  process.exit(1);
} finally {
  await server.close();
}
