/**
 * ADKM: AsciiDoc 解析器 —— 产出与 Markdown 一致的 NoteMetadata
 *
 * 设计边界（见 ADR-0001）：
 *  - 索引阶段不依赖 Asciidoctor.js（它是 Node 依赖，且体积大），改用受控文本扫描
 *  - 块级结构（章节层级）用行首标记判定，行内引用在块内容上扫描
 *  - 属性替换必须求值，否则 xref:{attr} 无法解析
 *  - 渲染阶段再按需懒加载 Asciidoctor.js
 *
 * 与渲染路径的已知偏差（计划 P3）：条件包含 `ifdef`、变量默认值、跨文件属性
 * 一律按文本原样处理。索引结果不得声称等同渲染结果。
 */
import type { HeadingRef, LinkRef, NoteMetadata, TagRef } from "../types";

const XREF = /xref:([^\[\s]+)\[([^\]]*)\]/g;
const LINK_MACRO = /(?<!x)link:([^\[\s]+)\[([^\]]*)\]/g;
const SHORT_XREF = /<<([^<>\n]+)>>/g;
const INCLUDE = /^include::([^\[]+)\[/;
const ATTR_LINE = /^:([A-Za-z0-9_-]+):\s*(.*)$/;
const HEADING = /^(={1,6})\s+(.+)$/;
/**
 * 只有「逐字块」内部的文本不参与链接扫描。
 *
 * 这里曾经把 `====`（示例块）、`****`（侧栏）、`____`（引用）、`--`（开放块）
 * 也一并屏蔽，结果 `[WARNING]\n====\n…\n====` 里的 xref 被静默丢弃。
 * 那四种块的内部仍是正常 AsciiDoc，必须照常扫描。
 */
const VERBATIM_FENCE = /^(\/{4}|-{4,}|\.{4,}|\+{4,}|\${4})$/;

interface SourceLine {
  /** line text with the CR of a CRLF pair removed */
  text: string;
  /** exact character offset of the line start in the source */
  start: number;
}

/**
 * ADKM: split preserving exact offsets.
 *
 * `content.split("\n")` cannot be used: every line then keeps a trailing `\r`
 * on CRLF files, which breaks the `$`-anchored block delimiter match (a
 * `----\r` line would no longer be recognised as a block fence) and would let
 * listing-block content leak into the link scan. Offsets come from the real
 * index rather than `length + 1`, so LF and CRLF both stay exact.
 */
function splitLines(content: string): SourceLine[] {
  const out: SourceLine[] = [];
  let start = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) !== 10) continue;
    const end = i > start && content.charCodeAt(i - 1) === 13 ? i - 1 : i;
    out.push({ text: content.slice(start, end), start });
    start = i + 1;
  }
  out.push({ text: content.slice(start), start });
  return out;
}

/** 文档头属性：只取正文之前的连续属性行 */
function collectAttributes(lines: SourceLine[]): Record<string, string> {
  const attrs: Record<string, string> = {};
  let seenTitle = false;
  for (const { text: line } of lines) {
    if (!seenTitle && HEADING.test(line)) {
      seenTitle = true;
      continue;
    }
    const m = ATTR_LINE.exec(line);
    if (m) {
      attrs[m[1].toLowerCase()] = m[2].trim();
      continue;
    }
    if (line.trim() === "" || line.startsWith("//")) continue;
    // 首个非标题、非属性、非空行即正文起点，文档头结束
    break;
  }
  return attrs;
}

/** 属性替换：{name} → value，递归求值并带深度上限 */
function substitute(input: string, attrs: Record<string, string>): string {
  let cur = input;
  let prev = "";
  let guard = 0;
  while (cur !== prev && guard < 10) {
    prev = cur;
    cur = cur.replace(/\{([A-Za-z0-9_-]+)\}/g, (m, k: string) => attrs[k.toLowerCase()] ?? m);
    guard++;
  }
  return cur;
}

function makeSnippet(content: string, from: number, to: number): string {
  const lineStart = content.lastIndexOf("\n", from) + 1;
  let lineEnd = content.indexOf("\n", to);
  if (lineEnd === -1) lineEnd = content.length;
  const text = content.slice(lineStart, lineEnd).trim();
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

export function parseAsciiDoc(path: string, content: string): NoteMetadata {
  const lines = splitLines(content);
  const attrs = collectAttributes(lines);

  const links: LinkRef[] = [];
  const headings: HeadingRef[] = [];
  const tags: TagRef[] = [];

  let inBlock = false;
  let blockChar = "";

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const { text: line, start: lineStart } = lines[lineNo];
    const sourceLine = lineNo + 1;
    const delim = VERBATIM_FENCE.exec(line);
    if (delim) {
      const ch = delim[1];
      if (!inBlock) {
        inBlock = true;
        blockChar = ch;
      } else if (blockChar === ch) {
        inBlock = false;
        blockChar = "";
      }
      continue;
    }
    if (inBlock) continue;
    if (line.startsWith("//")) continue;

    // ---------- 标题 ----------
    const h = HEADING.exec(line);
    if (h) {
      // adoc 的 `=` 对应 markdown 的 `#`，层级直接取等号个数
      headings.push({ level: h[1].length, text: h[2].trim(), from: lineStart });
    }

    // ---------- 标签 ----------
    const attr = ATTR_LINE.exec(line);
    if (attr && attr[1].toLowerCase() === "tags") {
      const value = attr[2];
      let searchFrom = lineStart + attr[0].indexOf(value);
      for (const raw of value.split(",")) {
        const tag = raw.trim();
        if (!tag) continue;
        tags.push({ tag, from: searchFrom });
        searchFrom += raw.length + 1;
      }
    }

    // ---------- xref:target[text] ----------
    for (const m of line.matchAll(XREF)) {
      const from = lineStart + m.index!;
      const target = substitute(m[1], attrs);
      links.push({
        target,
        alias: m[2] || undefined,
        from,
        to: from + m[0].length,
        context: makeSnippet(content, from, from + m[0].length),
        kind: "markdown",
        syntax: "xref",
        sourceLine,
      });
    }

    // ---------- link:target[text] ----------
    for (const m of line.matchAll(LINK_MACRO)) {
      if (/^https?:/i.test(m[1])) continue;
      const from = lineStart + m.index!;
      const target = substitute(m[1], attrs);
      links.push({
        target,
        alias: m[2] || undefined,
        from,
        to: from + m[0].length,
        context: makeSnippet(content, from, from + m[0].length),
        kind: "markdown",
        syntax: "link-macro",
        sourceLine,
      });
    }

    // ---------- <<target,text>> ----------
    for (const m of line.matchAll(SHORT_XREF)) {
      const inner = m[1];
      const comma = inner.indexOf(",");
      const targetPart = (comma >= 0 ? inner.slice(0, comma) : inner).trim();
      const reftext = comma >= 0 ? inner.slice(comma + 1).trim() : "";
      // 纯锚点（无路径分隔符、无已知扩展名）是文档内引用，不建跨文档边
      const isCrossDoc = /[\/\\]/.test(targetPart) || /\.(adoc|md|html?)$/i.test(targetPart.split("#")[0]);
      if (!isCrossDoc) continue;
      const from = lineStart + m.index!;
      const target = substitute(targetPart, attrs);
      links.push({
        target,
        alias: reftext || undefined,
        from,
        to: from + m[0].length,
        context: makeSnippet(content, from, from + m[0].length),
        kind: "markdown",
        syntax: "xref-short",
        sourceLine,
      });
    }

    // ---------- include::path[] ----------
    const inc = INCLUDE.exec(line);
    if (inc) {
      const target = substitute(inc[1], attrs);
      links.push({
        target,
        from: lineStart,
        to: lineStart + line.length,
        context: makeSnippet(content, lineStart, lineStart + line.length),
        kind: "markdown",
        syntax: "include",
        sourceLine,
      });
    }
  }

  return {
    path,
    links,
    tags,
    headings,
    blocks: [],
    footnotes: [],
    footnoteRefs: [],
    aliases: [],
    contentLength: content.length,
  };
}

/** ADKM: 该路径是否参与索引 */
export function isAsciiDoc(path: string): boolean {
  return path.toLowerCase().endsWith(".adoc");
}
