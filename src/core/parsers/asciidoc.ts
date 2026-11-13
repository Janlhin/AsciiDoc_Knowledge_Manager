/**
 * ADKM: AsciiDoc 解析器 —— 产出与 Markdown 一致的 NoteMetadata
 *
 * 设计边界（见 ADR-0001）：
 *  - 索引阶段不依赖 Asciidoctor.js（它是 Node 依赖，且体积大），改用受控文本扫描
 *  - 块级结构（章节层级）用行首标记判定，行内引用在块内容上扫描
 *  - 属性替换必须求值，否则 xref:{attr} 无法解析
 *  - 渲染阶段再按需懒加载 Asciidoctor.js
 */
import type { HeadingRef, LinkRef, NoteMetadata, TagRef } from "../types";

const XREF = /xref:([^\[\s]+)\[([^\]]*)\]/g;
const LINK_MACRO = /(?<!x)link:([^\[\s]+)\[([^\]]*)\]/g;
const SHORT_XREF = /<<([^<>\n]+)>>/g;
const INCLUDE = /^include::([^\[]+)\[/;
const ATTR_LINE = /^:([A-Za-z0-9_-]+):\s*(.*)$/;
const HEADING = /^(={1,6})\s+(.+)$/;
const BLOCK_DELIM = /^(\/{4}|-{4,}|\.{4,}|\+{4,}|_{4,}|\*{4,}|={4,})$/;

/** 文档头属性：只取正文之前的连续属性行 */
function collectAttributes(lines: string[]): Record<string, string> {
  const attrs: Record<string, string> = {};
  let seenTitle = false;
  let inHeader = true;
  for (const line of lines) {
    if (!inHeader) break;
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
    // 遇到第一段正文即视为文档头结束
    if (seenTitle) inHeader = false;
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
  const lines = content.split("\n");
  const attrs = collectAttributes(lines);

  const links: LinkRef[] = [];
  const headings: HeadingRef[] = [];
  const tags: TagRef[] = [];

  let offset = 0;
  let inBlock = false;
  let blockChar = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    offset += line.length + 1; // 粗略：+1 覆盖 \n

    const delim = BLOCK_DELIM.exec(line);
    if (delim) {
      const ch = delim[1][0];
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
      const target = substitute(m[1], attrs);
      links.push({
        target,
        alias: m[2] || undefined,
        from: lineStart + m.index!,
        to: lineStart + m.index! + m[0].length,
        context: makeSnippet(content, lineStart + m.index!, lineStart + m.index! + m[0].length),
        kind: "markdown",
      });
    }

    // ---------- link:target[text] ----------
    for (const m of line.matchAll(LINK_MACRO)) {
      if (/^https?:/i.test(m[1])) continue;
      const target = substitute(m[1], attrs);
      links.push({
        target,
        alias: m[2] || undefined,
        from: lineStart + m.index!,
        to: lineStart + m.index! + m[0].length,
        context: makeSnippet(content, lineStart + m.index!, lineStart + m.index! + m[0].length),
        kind: "markdown",
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
      const target = substitute(targetPart, attrs);
      links.push({
        target,
        alias: reftext || undefined,
        from: lineStart + m.index!,
        to: lineStart + m.index! + m[0].length,
        context: makeSnippet(content, lineStart + m.index!, lineStart + m.index! + m[0].length),
        kind: "markdown",
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
