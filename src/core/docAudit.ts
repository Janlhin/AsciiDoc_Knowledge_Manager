/**
 * T-046 文档规范体检 — pure rule engine.
 *
 * No I/O, no app singletons: every dependency (link resolution, configuration)
 * is injected. That keeps the six checks unit-testable and lets T-047 reuse the
 * very same rule set as prompt context for AI proofreading.
 *
 * The six checks (TASKS.md T-046):
 *   1. terminology        — inconsistent term variants (configurable glossary)
 *   2. broken-link        — wikilink / xref that resolves to no file
 *   3. heading-skip       — heading level jumps more than one level
 *   4. frontmatter-missing— required frontmatter fields absent
 *   5. structure          — H1 count / first-heading-level conventions
 *   6. punctuation        — halfwidth punctuation inside Chinese prose
 *
 * Scanning uses the same masking as the index parser (frontmatter + code
 * regions blanked) so matches keep stable offsets and never fire inside code.
 */
import { maskCodeRegions, parseFrontmatter } from "./metadata";
import type { NoteMetadata } from "./types";

export type AuditCategory =
  | "terminology"
  | "broken-link"
  | "heading-skip"
  | "frontmatter-missing"
  | "structure"
  | "punctuation";

export type AuditSeverity = "error" | "warning" | "info";

export const AUDIT_CATEGORIES: readonly AuditCategory[] = [
  "terminology", "broken-link", "heading-skip",
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
}

export interface AuditReport {
  issues: AuditIssue[];
  filesScanned: number;
  generatedAt: number;
  byCategory: Record<AuditCategory, number>;
  bySeverity: Record<AuditSeverity, number>;
}

/** Rule descriptions for T-047 (AI proofreading prompt context) and the UI legend. */
export const AUDIT_RULE_DOCS: ReadonlyArray<{
  category: AuditCategory;
  title: string;
  criteria: string;
}> = [
  { category: "terminology", title: "术语一致性", criteria: "英文技术术语只使用词表中的规范写法；发现变体（空格/连字符漂移）时提示替换为规范词。" },
  { category: "broken-link", title: "失效链接", criteria: "wikilink / AsciiDoc xref 必须指向库中真实存在的笔记；外部链接、纯锚点、include 片段不检查。" },
  { category: "heading-skip", title: "标题层级跳级", criteria: "相邻标题的层级增量不得超过 1（例如 H2 直接跳到 H4 应修复）。" },
  { category: "frontmatter-missing", title: "必填元数据缺失", criteria: "笔记 frontmatter 必须包含配置中列出的必填字段（默认 title）。" },
  { category: "structure", title: "章节结构偏差", criteria: "文档应恰有一个一级标题，且它应是首个标题。" },
  { category: "punctuation", title: "中文标点混用", criteria: "中文语境使用全角标点；中文后紧跟半角逗号/分号、中文之间的半角句点视为混用。" },
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

/** Run all six checks against one note. Pure. */
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
  for (const link of meta.links) {
    const raw = link.target.trim();
    if (!raw || isExternalOrAnchor(raw)) continue;
    // include:: pulls fragments/attachments, not notes — out of scope.
    if (link.syntax === "include") continue;
    const target = raw.split("#")[0].trim();
    if (!target) continue;
    if (env.resolveLink(target, path) === null) {
      out.push(issue(path, content, link.from, "broken-link", "error",
        `链接目标「${target}」在库中不存在`));
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
  const issues: AuditIssue[] = [];
  for (const note of notes) issues.push(...auditNote(note, env));
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
