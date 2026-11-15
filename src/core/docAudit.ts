/**
 * T-046 文档规范体检 — pure rule engine.
 *
 * No I/O, no app singletons: every dependency (link resolution, configuration)
 * is injected. That keeps the six checks unit-testable and lets T-047 reuse the
 * very same rule set as prompt context for AI proofreading.
 *
 * The six original checks (TASKS.md T-046):
 *   1. terminology        — inconsistent term variants (configurable glossary)
 *   2. broken-link        — wikilink / xref that resolves to no file
 *   3. heading-skip       — heading level jumps more than one level
 *   4. frontmatter-missing— required frontmatter fields absent
 *   5. structure          — H1 count / first-heading-level conventions
 *   6. punctuation        — halfwidth punctuation inside Chinese prose
 *
 * T-045 adds the two Docs-as-Code reference checks, which need the vault's path
 * list (`env.files`) and therefore stay silent when it is not supplied:
 *   7. broken-xref        — AsciiDoc xref / <<path>> with no resolvable target
 *   8. broken-include     — missing include:: target, or an include cycle
 *
 * Scanning uses the same masking as the index parser (frontmatter + code
 * regions blanked) so matches keep stable offsets and never fire inside code.
 */
import { buildDocIndex, findIncludeCycles, includeEdges, resolveInclude, resolveXref, type DocIndex } from "./docsAsCode";
import { maskCodeRegions, parseFrontmatter } from "./metadata";
import type { NoteMetadata } from "./types";

export type AuditCategory =
  | "terminology"
  | "broken-link"
  | "broken-xref"
  | "broken-include"
  | "heading-skip"
  | "frontmatter-missing"
  | "structure"
  | "punctuation";

export type AuditSeverity = "error" | "warning" | "info";

export const AUDIT_CATEGORIES: readonly AuditCategory[] = [
  "terminology", "broken-link", "broken-xref", "broken-include", "heading-skip",
  "frontmatter-missing", "structure", "punctuation",
];

export const SEVERITY_ORDER: Record<AuditSeverity, number> = { error: 0, warning: 1, info: 2 };

/** A glossary entry: seeing any `variants` spelling should suggest `canonical`. */
export interface TermRule {
  canonical: string;
  variants: string[];
}

export interface AuditConfig {
  /** Terminology glossary. Case-insensitive phrase matching. */
  terms: TermRule[];
  /** Frontmatter fields every audited note must carry. */
  requiredFrontmatter: string[];
  /** Maximum allowed increase between adjacent heading levels (1 = no skips). */
  maxHeadingLevelJump: number;
  /** Require exactly one level-1 heading. */
  requireSingleH1: boolean;
  /** Enable halfwidth-punctuation-in-Chinese check. */
  punctuationEnabled: boolean;
}

/**
 * Deliberately conservative defaults: only high-confidence variants (spacing /
 * hyphen drift in English tech terms), `title` as the sole required field, and
 * only comma / semicolon / CJK-to-CJK full stop as warnings. Question/exclamation
 * marks are info because technical prose sometimes uses them halfwidth on purpose.
 */
export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  terms: [
    { canonical: "frontmatter", variants: ["front matter", "front-matter"] },
    { canonical: "wikilink", variants: ["wiki link", "wiki-link"] },
    { canonical: "live preview", variants: ["live-preview", "livepreview"] },
    { canonical: "backlink", variants: ["back-link", "back link"] },
  ],
  requiredFrontmatter: ["title"],
  maxHeadingLevelJump: 1,
  requireSingleH1: true,
  punctuationEnabled: true,
};

export interface AuditIssue {
  path: string;
  category: AuditCategory;
  severity: AuditSeverity;
  /** 1-based, human-facing line / column. */
  line: number;
  column: number;
  /** 0-based char offset in the original content (jump target). */
  from: number;
  message: string;
  /** Trimmed, truncated source line for the results panel. */
  excerpt: string;
}

export interface AuditNoteInput {
  path: string;
  content: string;
  meta: Pick<NoteMetadata, "headings" | "links" | "frontmatter">;
}

export interface AuditEnv {
  /** Same contract as MetadataIndex.resolveLink: null = no such note. */
  resolveLink: (target: string, fromPath: string) => string | null;
  config?: Partial<AuditConfig>;
  /**
   * Every vault path (indexable files). Required for the T-045 xref / include
   * checks: without it they are skipped, so a single-note audit (AI proofread
   * on one note) still works but cannot judge those two categories.
   */
  files?: ReadonlyArray<string>;
}

export interface AuditReport {
  issues: AuditIssue[];
  filesScanned: number;
  generatedAt: number;
  byCategory: Record<AuditCategory, number>;
  bySeverity: Record<AuditSeverity, number>;
}

/**
 * Rule descriptions for T-047 (AI proofreading prompt context) and the UI legend.
 * `criteriaEn` exists so the proofreading prompt can follow the UI language
 * without a second copy of the rule set.
 */
export const AUDIT_RULE_DOCS: ReadonlyArray<{
  category: AuditCategory;
  title: string;
  criteria: string;
  criteriaEn: string;
}> = [
  {
    category: "terminology", title: "术语一致性",
    criteria: "英文技术术语只使用词表中的规范写法；发现变体（空格/连字符漂移）时提示替换为规范词。",
    criteriaEn: "Use only the canonical spelling from the glossary for English technical terms; report spacing/hyphen variants of a canonical term.",
  },
  {
    category: "broken-link", title: "失效链接",
    criteria: "wikilink / AsciiDoc xref 必须指向库中真实存在的笔记；外部链接、纯锚点、include 片段不检查。",
    criteriaEn: "A wikilink or AsciiDoc xref must point at a note that exists in this vault; external links, bare anchors and include fragments are out of scope.",
  },
  {
    category: "broken-xref", title: "失效 xref",
    criteria: "AsciiDoc xref / <<路径>> 必须能按「文件相对」或「库根相对」找到文件；Antora 资源 ID 在无唯一同名文件时按无法判定处理，不臆断。",
    criteriaEn: "An AsciiDoc xref / <<path>> must resolve file-relative or vault-root-relative; an Antora resource id with no unique basename is reported as undecidable rather than guessed.",
  },
  {
    category: "broken-include", title: "失效 include / 循环",
    criteria: "include:: 目标必须存在（文件相对，前导 / 为库根），且包含关系不得形成 A→B→A 的环。",
    criteriaEn: "An include:: target must exist (file-relative; a leading / means vault root), and includes must not form a cycle such as A→B→A.",
  },
  {
    category: "heading-skip", title: "标题层级跳级",
    criteria: "相邻标题的层级增量不得超过 1（例如 H2 直接跳到 H4 应修复）。",
    criteriaEn: "Adjacent headings may not increase by more than one level (H2 straight to H4 must be fixed).",
  },
  {
    category: "frontmatter-missing", title: "必填元数据缺失",
    criteria: "笔记 frontmatter 必须包含配置中列出的必填字段（默认 title）。",
    criteriaEn: "The note frontmatter must carry every required field from the configuration (default: title).",
  },
  {
    category: "structure", title: "章节结构偏差",
    criteria: "文档应恰有一个一级标题，且它应是首个标题。",
    criteriaEn: "The document should have exactly one level-1 heading, and it should be the first heading.",
  },
  {
    category: "punctuation", title: "中文标点混用",
    criteria: "中文语境使用全角标点；中文后紧跟半角逗号/分号、中文之间的半角句点视为混用。",
    criteriaEn: "Chinese prose uses fullwidth punctuation; a halfwidth comma/semicolon after a CJK character, or a halfwidth full stop between CJK characters, counts as mixed punctuation.",
  },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Blank frontmatter and code regions, preserving offsets (mirrors parseNote). */
export function maskForScan(content: string): string {
  const fm = parseFrontmatter(content);
  const withoutFm = fm ? " ".repeat(fm.to) + content.slice(fm.to) : content;
  return maskCodeRegions(withoutFm);
}

function lineCol(content: string, from: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.max(0, Math.min(from, content.length));
  for (let i = 0; i < end; i++) {
    if (content[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

function excerptAt(content: string, from: number): string {
  const start = content.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  let end = content.indexOf("\n", from);
  if (end < 0) end = content.length;
  return content.slice(start, end).trim().slice(0, 120);
}

function issue(
  path: string,
  content: string,
  from: number,
  category: AuditCategory,
  severity: AuditSeverity,
  message: string,
): AuditIssue {
  const { line, column } = lineCol(content, from);
  return { path, category, severity, line, column, from, message, excerpt: excerptAt(content, from) };
}

/** External schemes and pure in-note anchors are never "broken links". */
function isExternalOrAnchor(target: string): boolean {
  return /^(?:https?:|mailto:|tel:|ftp:|data:)/i.test(target) || target.startsWith("#");
}

/** Run all checks against one note. Pure. */
export function auditNote(note: AuditNoteInput, env: AuditEnv): AuditIssue[] {
  const cfg: AuditConfig = { ...DEFAULT_AUDIT_CONFIG, ...env.config };
  const out: AuditIssue[] = [];
  const { path, content, meta } = note;
  const masked = maskForScan(content);

  // 1. terminology ----------------------------------------------------------
  for (const term of cfg.terms) {
    for (const variant of term.variants) {
      const re = new RegExp(escapeRegex(variant), "gi");
      for (const m of masked.matchAll(re)) {
        const at = m.index ?? 0;
        // A variant that only differs by case from the canonical word is fine.
        if (m[0].toLowerCase() === term.canonical.toLowerCase()) continue;
        out.push(issue(path, content, at, "terminology", "warning",
          `术语「${m[0]}」不规范，建议改为「${term.canonical}」`));
      }
    }
  }

  // 2. broken links ---------------------------------------------------------
  // wikilink / markdown link / link-macro only: AsciiDoc xref and include have
  // their own resolution rules (T-045) and must not be judged by this one.
  for (const link of meta.links) {
    const raw = link.target.trim();
    if (!raw || isExternalOrAnchor(raw)) continue;
    if (link.syntax === "include" || link.syntax === "xref" || link.syntax === "xref-short") continue;
    const target = raw.split("#")[0].trim();
    if (!target) continue;
    if (env.resolveLink(target, path) === null) {
      out.push(issue(path, content, link.from, "broken-link", "error",
        `链接目标「${target}」在库中不存在`));
    }
  }

  // 2b. xref / include (T-045) ---------------------------------------------
  if (env.files !== undefined) {
    const index: DocIndex = buildDocIndex(env.files);
    for (const link of meta.links) {
      const syntax = link.syntax;
      if (syntax !== "xref" && syntax !== "xref-short" && syntax !== "include") continue;
      const raw = link.target.trim();
      if (raw === "") continue;
      const isInclude = syntax === "include";
      const resolution = isInclude
        ? resolveInclude(raw, path, index)
        : resolveXref(raw, path, index);
      if (resolution.status === "resolved") continue;
      const category: AuditCategory = isInclude ? "broken-include" : "broken-xref";
      const label = isInclude ? "include" : "xref";
      if (resolution.status === "unresolved") {
        out.push(issue(path, content, link.from, category, "warning",
          `${label} 目标「${raw}」匹配到 ${resolution.candidates ?? 0} 个文件，无法确定`));
      } else {
        out.push(issue(path, content, link.from, category, "error",
          `${label} 目标「${raw}」在库中不存在`));
      }
    }
  }

  // 3. heading level skips --------------------------------------------------
  const headings = meta.headings;
  for (let i = 1; i < headings.length; i++) {
    const jump = headings[i].level - headings[i - 1].level;
    if (jump > cfg.maxHeadingLevelJump) {
      out.push(issue(path, content, headings[i].from, "heading-skip", "error",
        `标题层级从 H${headings[i - 1].level} 跳到 H${headings[i].level}（跳级 ${jump}）`));
    }
  }

  // 4. required frontmatter -------------------------------------------------
  const fields = meta.frontmatter?.fields;
  for (const field of cfg.requiredFrontmatter) {
    if (!fields || !(field in fields)) {
      out.push(issue(path, content, 0, "frontmatter-missing", "warning",
        `缺少必填元数据字段「${field}」`));
    }
  }

  // 5. structure ------------------------------------------------------------
  if (cfg.requireSingleH1) {
    const h1 = headings.filter((h) => h.level === 1);
    if (h1.length === 0) {
      const first = headings[0];
      out.push(issue(path, content, first?.from ?? 0, "structure", "warning",
        first
          ? `缺少一级标题（首个标题为 H${first.level}）`
          : "文档没有任何标题"));
    } else if (h1.length > 1) {
      out.push(issue(path, content, h1[1].from, "structure", "warning",
        `存在 ${h1.length} 个一级标题，应只有一个`));
    }
  }

  // 6. halfwidth punctuation inside Chinese prose ---------------------------
  if (cfg.punctuationEnabled) {
    const punctRules: Array<{ re: RegExp; message: string; severity: AuditSeverity }> = [
      { re: /([\u3400-\u9fff]),/g, message: "中文语境建议使用全角逗号「，」", severity: "warning" },
      { re: /([\u3400-\u9fff]);/g, message: "中文语境建议使用全角分号「；」", severity: "warning" },
      { re: /([\u3400-\u9fff])\.(?=[\u3400-\u9fff])/g, message: "中文语境建议使用全角句号「。」", severity: "warning" },
      { re: /([\u3400-\u9fff])\?/g, message: "中文语境建议使用全角问号「？」", severity: "info" },
      { re: /([\u3400-\u9fff])!/g, message: "中文语境建议使用全角叹号「！」", severity: "info" },
    ];
    for (const rule of punctRules) {
      for (const m of masked.matchAll(rule.re)) {
        const at = (m.index ?? 0) + m[0].length - 1;
        out.push(issue(path, content, at, "punctuation", rule.severity, rule.message));
      }
    }
  }

  out.sort((a, b) => a.from - b.from || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return out;
}

/** Audit a whole vault. Pure; `notes` are pre-read by the caller. */
export function auditVault(notes: readonly AuditNoteInput[], env: AuditEnv): AuditReport {
  const files = notes.map((n) => n.path);
  const noteEnv: AuditEnv = { ...env, files };
  const issues: AuditIssue[] = [];
  for (const note of notes) issues.push(...auditNote(note, noteEnv));

  // Include cycles span notes: detect once over the whole graph and report the
  // issue on the edge that closes the loop (the author's editable line).
  const index = buildDocIndex(files);
  const edges = includeEdges(notes.map((n) => ({ path: n.path, links: n.meta.links })), index);
  if (edges.length > 0) {
    const byPath = new Map(notes.map((n) => [n.path, n]));
    for (const cycle of findIncludeCycles(edges)) {
      const edge = edges.find((e) => e.from === cycle[0] && e.to === cycle[1]);
      const note = byPath.get(cycle[0]);
      if (edge === undefined || note === undefined) continue;
      issues.push(issue(note.path, note.content, edge.at, "broken-include", "error",
        `include 循环引用：${[...cycle, cycle[0]].join(" → ")}`));
    }
  }

  issues.sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    a.path.localeCompare(b.path) || a.line - b.line);

  const byCategory = Object.fromEntries(AUDIT_CATEGORIES.map((c) => [c, 0])) as Record<AuditCategory, number>;
  const bySeverity = { error: 0, warning: 0, info: 0 } as Record<AuditSeverity, number>;
  for (const it of issues) {
    byCategory[it.category]++;
    bySeverity[it.severity]++;
  }
  return { issues, filesScanned: notes.length, generatedAt: Date.now(), byCategory, bySeverity };
}
