/**
 * T-066 多版本（双语）一致性校验 — pure rule engine.
 *
 * 章程 §5.2：识别 `foo.adoc` ↔ `foo-en.adoc` 这类双语配对（文档头 `:lang:` /
 * frontmatter `lang:` 仅作辅助判定），对一对文档比较四类内容：
 *
 *   1. 版本号       — AsciiDoc `:revnumber:`；Markdown frontmatter `revnumber` / `version`
 *   2. 标题规模     — 标题总数 + 各级标题数量分布
 *   3. 章节结构     — 按层级序列对齐（LCS over level），定位缺失 / 多余章节；
 *                     标题文本相似度只作辅助展示，不要求完全一致
 *   4. 行数偏差     — 总行数与相对偏差
 *
 * No I/O, no app singletons, no DOM / IPC: every document arrives as
 * `{ path, content }` text. The runner (bilingualAlignRunner) owns the only
 * impure step — reading notes off disk — then hands plain data here.
 */
import { parseDocument, parseFrontmatter, fmField } from "./metadata";
import { isAsciiDoc } from "./parsers/asciidoc";

/** Known two-letter language tags (plus common region variants) that a `-xx`
 *  filename suffix is allowed to match. Kept small on purpose: a stem like
 *  `read-me` must NOT be misread as translation `me` merely because `me`
 *  happens to be a country code. Region variants follow the primary tag. */
const KNOWN_LANG_TAGS = new Set([
  "en", "zh", "de", "fr", "es", "ja", "ko", "pt", "ru", "it", "nl",
  "sv", "ar", "hi", "tr", "pl", "uk", "cs", "da", "fi", "el", "he",
  "th", "vi", "id", "ms", "no", "nb", "nn", "hu", "ro", "uk",
]);
const KNOWN_REGION_VARIANTS = new Set([
  "en-us", "en-gb", "zh-cn", "zh-tw", "zh-hk", "pt-br", "pt-pt", "es-es",
  "es-mx", "fr-fr", "fr-ca", "de-de", "it-it", "nl-nl", "sv-se", "ru-ru",
]);

/** Filename suffix shape: `foo-en` / `foo-en-us`. Case-insensitive. */
const SUFFIX_RE = /^(.*)-([a-z]{2,3}(?:-[a-z0-9]{2,8})?)$/;

/** AsciiDoc preamble attribute line `:revnumber: 1.2.3`. */
const ADOC_ATTR_RE = /^:([A-Za-z0-9_-]+):\s*(.*)$/;
/** AsciiDoc section heading `====== Title`. */
const ADOC_HEADING_RE = /^(={1,6})\s+\S/;

/** Relative line-count deviation above which the pair counts as deviated. */
export const LINE_DEVIATION_RATIO = 0.25;

export interface DocInput {
  path: string;
  content: string;
}

export interface DigestHeading {
  level: number;
  text: string;
  /** character offset in the source (jump target) */
  from: number;
  /** 1-based line number for display */
  line: number;
}

/** Parsed, format-blind digest of one document. */
export interface DocDigest {
  path: string;
  /** basename without extension */
  stem: string;
  /** extension without dot, lowercased */
  ext: string;
  /** explicit language marker (`:lang:` / frontmatter `lang:`), lowercased; null = absent */
  lang: string | null;
  /** version string; null when neither source carries it */
  revnumber: string | null;
  revSource: "attr" | "frontmatter" | null;
  headings: DigestHeading[];
  headingCount: number;
  /** level -> count, e.g. { 1: 1, 2: 3 } */
  levelDistribution: Record<number, number>;
  lineCount: number;
}

export type IssueCategory =
  | "version"
  | "heading-count"
  | "heading-distribution"
  | "missing-section"
  | "extra-section"
  | "line-deviation"
  | "lang-marker";

export type AlignSeverity = "warning" | "info";

export interface AlignIssue {
  category: IssueCategory;
  severity: AlignSeverity;
  message: string;
  /** heading on the base document, when the issue sits on one */
  left?: DigestHeading;
  /** heading on the translation document, when the issue sits on one */
  right?: DigestHeading;
}

export type StructureRowStatus = "matched" | "missing-right" | "missing-left";

export interface StructureRow {
  left: DigestHeading | null;
  right: DigestHeading | null;
  /** auxiliary heading-text similarity in [0,1]; null when one side is absent */
  similarity: number | null;
  status: StructureRowStatus;
}

export type VersionStatus = "match" | "mismatch" | "unknown";
export type CountStatus = "match" | "mismatch";

export interface PairReport {
  base: DocDigest;
  translation: DocDigest;
  /** true when the pair came from the auxiliary lang-marker heuristic rather
   *  than the `-<lang>` filename suffix */
  auxiliary: boolean;
  version: { status: VersionStatus; base: string | null; translation: string | null };
  headingSummary: {
    totalBase: number;
    totalTranslation: number;
    distributionBase: Record<number, number>;
    distributionTranslation: Record<number, number>;
    status: CountStatus;
  };
  structure: StructureRow[];
  lines: { base: number; translation: number; diff: number; ratio: number; status: CountStatus | "deviation" };
  issues: AlignIssue[];
}

export interface BilingualReport {
  pairs: PairReport[];
  /** vault-relative paths that took part in no pair (auxiliary context) */
  unmatched: string[];
  generatedAt: number;
}

/* ------------------------------------------------------------------ */
/* path / name helpers                                                 */
/* ------------------------------------------------------------------ */

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

function splitName(path: string): { dir: string; stem: string; ext: string } {
  const base = basename(path);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return { dir: "", stem: base, ext: "" };
  return { dir: "", stem: base.slice(0, dot), ext: base.slice(dot + 1).toLowerCase() };
}

/** Is `tag` an accepted language suffix (`en`, `zh-cn`, …)? */
function isKnownLangTag(tag: string): boolean {
  const lower = tag.toLowerCase();
  if (KNOWN_LANG_TAGS.has(lower)) return true;
  if (KNOWN_REGION_VARIANTS.has(lower)) return true;
  const [primary] = lower.split("-");
  return KNOWN_LANG_TAGS.has(primary);
}

/**
 * Split a stem into `{ baseStem, langTag }` when it ends with a known
 * `-<lang>` suffix. Returns null otherwise. NFKC-normalized so a full-width
 * hyphen `－` does not crash the detector; the original path is untouched.
 */
export function suffixLanguage(stem: string): { baseStem: string; langTag: string } | null {
  const normalized = stem.normalize("NFKC");
  const m = SUFFIX_RE.exec(normalized);
  if (!m) return null;
  const langTag = m[2].toLowerCase();
  if (!isKnownLangTag(langTag)) return null;
  return { baseStem: m[1], langTag };
}

/* ------------------------------------------------------------------ */
/* digest extraction                                                   */
/* ------------------------------------------------------------------ */

/** Read an AsciiDoc preamble attribute value (`:name: value`) before the body. */
function adocAttribute(content: string, name: string): string | null {
  const lines = content.split("\n");
  let bodyStarted = false;
  for (const rawLine of lines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (ADOC_HEADING_RE.test(line)) { bodyStarted = true; continue; }
    const m = ADOC_ATTR_RE.exec(line.trim());
    if (m) {
      if (m[1].toLowerCase() === name) return m[2].trim();
      continue;
    }
    if (line.trim() === "" || line.trimStart().startsWith("//")) continue;
    bodyStarted = true;
    break;
  }
  return null;
}

function frontmatterScalar(fields: Record<string, string | string[]>, name: string): string | null {
  const raw = fmField(fields, name);
  if (raw === undefined) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value.trim() === "" ? null : value.trim();
}

function lineOf(content: string, from: number): number {
  let line = 1;
  const end = Math.max(0, Math.min(from, content.length));
  for (let i = 0; i < end; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

function countLines(content: string): number {
  if (content === "") return 0;
  return content.split(/\r?\n/).length;
}

/** Extract the format-blind digest for one document. Pure; never throws on odd input. */
export function digestDocument(input: DocInput): DocDigest {
  const { path, content } = input;
  const { stem, ext } = splitName(path);
  const fm = parseFrontmatter(content)?.fields ?? {};

  let lang: string | null = null;
  let revnumber: string | null = null;
  let revSource: DocDigest["revSource"] = null;

  if (isAsciiDoc(path)) {
    const attrLang = adocAttribute(content, "lang");
    if (attrLang !== null) lang = attrLang.toLowerCase();
    const attrRev = adocAttribute(content, "revnumber");
    if (attrRev !== null) { revnumber = attrRev; revSource = "attr"; }
  } else {
    const fmLang = frontmatterScalar(fm, "lang");
    if (fmLang !== null) lang = fmLang.toLowerCase();
    const fmRev = frontmatterScalar(fm, "revnumber") ?? frontmatterScalar(fm, "version");
    if (fmRev !== null) { revnumber = fmRev; revSource = "frontmatter"; }
  }

  // Frontmatter `lang:` is also a valid auxiliary marker for AsciiDoc files
  // that keep YAML frontmatter above the preamble.
  if (lang === null) {
    const fmLang = frontmatterScalar(fm, "lang");
    if (fmLang !== null) lang = fmLang.toLowerCase();
  }

  const meta = parseDocument(path, content);
  const headings: DigestHeading[] = meta.headings.map((h) => ({
    level: h.level,
    text: h.text,
    from: h.from,
    line: lineOf(content, h.from),
  }));
  const levelDistribution: Record<number, number> = {};
  for (const h of headings) levelDistribution[h.level] = (levelDistribution[h.level] ?? 0) + 1;

  return {
    path,
    stem,
    ext,
    lang,
    revnumber,
    revSource,
    headings,
    headingCount: headings.length,
    levelDistribution,
    lineCount: countLines(content),
  };
}

/* ------------------------------------------------------------------ */
/* heading-text similarity (auxiliary only)                           */
/* ------------------------------------------------------------------ */

function normalizeHeadingText(text: string): string {
  return text
    .replace(/[*_`~[\]#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Small Levenshtein-based ratio in [0,1]. Auxiliary: a low score never fails a pair. */
export function headingSimilarity(a: string, b: string): number {
  const x = normalizeHeadingText(a);
  const y = normalizeHeadingText(b);
  if (x === y) return 1;
  if (x === "" || y === "") return 0;
  const dist = levenshtein(x, y);
  return 1 - dist / Math.max(x.length, y.length);
}

function levenshtein(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = temp;
    }
  }
  return dp[b.length];
}

/* ------------------------------------------------------------------ */
/* structure alignment (LCS over heading levels)                       */
/* ------------------------------------------------------------------ */

/**
 * Align the two heading sequences by their level sequence, in document order.
 * The two pointers advance together when the current levels match; otherwise
 * the side whose heading is shallower is consumed as missing on the other
 * side. This stays order-preserving (an earlier heading never lines up with a
 * later one) and deterministic. Heading text similarity is attached to matched
 * rows but never gates the alignment — translated titles need not be equal.
 */
export function alignStructure(left: DocDigest, right: DocDigest): StructureRow[] {
  const A = left.headings;
  const B = right.headings;
  const rows: StructureRow[] = [];
  let ai = 0;
  let bj = 0;
  while (ai < A.length && bj < B.length) {
    const a = A[ai];
    const b = B[bj];
    if (a.level === b.level) {
      rows.push({ left: a, right: b, similarity: headingSimilarity(a.text, b.text), status: "matched" });
      ai++;
      bj++;
    } else if (a.level < b.level) {
      rows.push({ left: a, right: null, similarity: null, status: "missing-right" });
      ai++;
    } else {
      rows.push({ left: null, right: b, similarity: null, status: "missing-left" });
      bj++;
    }
  }
  while (ai < A.length) { rows.push({ left: A[ai], right: null, similarity: null, status: "missing-right" }); ai++; }
  while (bj < B.length) { rows.push({ left: null, right: B[bj], similarity: null, status: "missing-left" }); bj++; }
  return rows;
}

/* ------------------------------------------------------------------ */
/* pair comparison                                                     */
/* ------------------------------------------------------------------ */

function sameDistribution(a: Record<number, number>, b: Record<number, number>): boolean {
  const levels = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of levels) {
    if ((a[Number(k)] ?? 0) !== (b[Number(k)] ?? 0)) return false;
  }
  return true;
}

/** Compare one paired document. Pure; degrades to informative issues instead of throwing. */
export function comparePair(base: DocDigest, translation: DocDigest, auxiliary: boolean): PairReport {
  const issues: AlignIssue[] = [];

  // 1. version -------------------------------------------------------------
  const baseRev = base.revnumber;
  const transRev = translation.revnumber;
  let version: PairReport["version"];
  if (baseRev === null || transRev === null) {
    version = { status: "unknown", base: baseRev, translation: transRev };
    issues.push({
      category: "version",
      severity: "info",
      message: baseRev === null && transRev === null
        ? "两侧都没有版本号（:revnumber: / frontmatter revnumber），无法比对"
        : "一侧缺少版本号，无法比对版本一致性",
    });
  } else if (baseRev.trim() === transRev.trim()) {
    version = { status: "match", base: baseRev, translation: transRev };
  } else {
    version = { status: "mismatch", base: baseRev, translation: transRev };
    issues.push({
      category: "version",
      severity: "warning",
      message: `版本号不一致：${baseRev} ≠ ${transRev}`,
    });
  }

  // 2. heading totals + level distribution --------------------------------
  const countMatch = base.headingCount === translation.headingCount;
  const distMatch = sameDistribution(base.levelDistribution, translation.levelDistribution);
  if (!countMatch) {
    issues.push({
      category: "heading-count",
      severity: "warning",
      message: `标题总数不一致：${base.headingCount} ≠ ${translation.headingCount}`,
    });
  }
  if (!distMatch) {
    issues.push({
      category: "heading-distribution",
      severity: "warning",
      message: `层级分布不一致：${formatDistribution(base.levelDistribution)} ≠ ${formatDistribution(translation.levelDistribution)}`,
    });
  }
  const headingSummary: PairReport["headingSummary"] = {
    totalBase: base.headingCount,
    totalTranslation: translation.headingCount,
    distributionBase: base.levelDistribution,
    distributionTranslation: translation.levelDistribution,
    status: countMatch && distMatch ? "match" : "mismatch",
  };

  // 3. structure alignment --------------------------------------------------
  const structure = alignStructure(base, translation);
  for (const row of structure) {
    if (row.status === "missing-right") {
      issues.push({
        category: "missing-section",
        severity: "warning",
        left: row.left ?? undefined,
        message: `译文侧缺少章节「${row.left?.text ?? ""}」`,
      });
    } else if (row.status === "missing-left") {
      issues.push({
        category: "extra-section",
        severity: "warning",
        right: row.right ?? undefined,
        message: `原文侧缺少章节「${row.right?.text ?? ""}」`,
      });
    }
  }

  // 4. line count deviation --------------------------------------------------
  const diff = translation.lineCount - base.lineCount;
  const maxLines = Math.max(base.lineCount, translation.lineCount);
  const ratio = maxLines === 0 ? 0 : Math.abs(diff) / maxLines;
  const lineStatus: PairReport["lines"]["status"] =
    base.lineCount === 0 || translation.lineCount === 0
      ? "deviation"
      : ratio > LINE_DEVIATION_RATIO ? "deviation" : "match";
  if (lineStatus === "deviation") {
    issues.push({
      category: "line-deviation",
      severity: base.lineCount === 0 || translation.lineCount === 0 ? "info" : "warning",
      message: base.lineCount === 0 || translation.lineCount === 0
        ? "其中一侧为空文件，行数偏差不可比对"
        : `行数偏差 ${diff > 0 ? "+" : ""}${diff} 行（${(ratio * 100).toFixed(0)}%）`,
    });
  }
  const lines: PairReport["lines"] = {
    base: base.lineCount,
    translation: translation.lineCount,
    diff,
    ratio,
    status: lineStatus,
  };

  // auxiliary: identical explicit lang markers on both sides are suspicious
  if (base.lang !== null && translation.lang !== null && base.lang === translation.lang) {
    issues.push({
      category: "lang-marker",
      severity: "info",
      message: `两侧语言标记相同（${base.lang}），请确认配对方向与标签`,
    });
  }

  return { base, translation, auxiliary, version, headingSummary, structure, lines, issues };
}

function formatDistribution(dist: Record<number, number>): string {
  return Object.keys(dist)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => `H${k}:${dist[Number(k)]}`)
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* pairing + whole-vault report                                        */
/* ------------------------------------------------------------------ */

/**
 * Discover bilingual pairs across the vault. Primary rule: same folder,
 * `foo.ext` ↔ `foo-<lang>.ext`. Auxiliary rule: same stem, different
 * extension, both carry explicit and differing `lang:` markers.
 *
 * Every document appears in at most one pair; the rest land in `unmatched`.
 */
export function buildBilingualReport(docs: readonly DocInput[]): BilingualReport {
  const digests = docs.map(digestDocument);
  const byPath = new Map(digests.map((d) => [d.path, d]));
  const used = new Set<string>();
  const pairs: PairReport[] = [];

  // Index stem -> digest list (suffix pairing looks up the unsuffixed base).
  const byStem = new Map<string, DocDigest[]>();
  for (const d of digests) {
    const list = byStem.get(d.stem);
    if (list) list.push(d);
    else byStem.set(d.stem, [d]);
  }

  // 1. suffix pairing
  for (const d of digests) {
    if (used.has(d.path)) continue;
    const suffix = suffixLanguage(d.stem);
    if (!suffix) continue;
    const candidates = (byStem.get(suffix.baseStem) ?? []).filter(
      (c) => !used.has(c.path) && c.path !== d.path,
    );
    // prefer same extension, then lexicographically first deterministic pick
    const sameExt = candidates.filter((c) => c.ext === d.ext);
    const base = (sameExt[0] ?? candidates[0]);
    if (base === undefined) continue;
    used.add(d.path);
    used.add(base.path);
    pairs.push(comparePair(base, d, false));
  }

  // 2. auxiliary: same stem, different extension, explicit differing lang markers
  for (const d of digests) {
    if (used.has(d.path)) continue;
    if (d.lang === null) continue;
    const siblings = (byStem.get(d.stem) ?? []).filter(
      (c) => !used.has(c.path) && c.path !== d.path && c.lang !== null && c.lang !== d.lang,
    );
    if (siblings.length === 0) continue;
    const other = siblings.sort((a, b) => a.path.localeCompare(b.path))[0];
    used.add(d.path);
    used.add(other.path);
    const [base, translation] = [d, other].sort((a, b) => a.path.localeCompare(b.path));
    pairs.push(comparePair(base, translation, true));
  }

  pairs.sort((a, b) => a.base.path.localeCompare(b.base.path));
  const unmatched = digests.filter((d) => !used.has(d.path)).map((d) => d.path);
  unmatched.sort();

  return { pairs, unmatched, generatedAt: Date.now() };
}
