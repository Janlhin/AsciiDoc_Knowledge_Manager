/**
 * T-067 (ADKM L3, D-17 / D-040): AsciiDoc source-mode language support for
 * CodeMirror 6.
 *
 * Zero new dependency: the lexer is a hand-written line scanner exposed as pure
 * functions (`scanAsciiDocLine`, `findXrefAt`, `findAnchorOffset`) so token
 * types/positions are unit-testable without a real CM view. `StreamLanguage`
 * (already shipped with `@codemirror/language`) adapts the scanner to the
 * editor. The Markdown language path is untouched — `.md` files keep the
 * existing `@codemirror/lang-markdown` support byte-for-byte.
 *
 * Scope (L3 only): headings, attribute lines / `{attr}` refs, line and block
 * comments, `xref:` / `link:` / `include::` macros, `<<…>>` short refs, list
 * markers, block attribute lines and verbatim fences. This is deliberately
 * NOT a full AsciiDoc grammar: no inline bold/italic model, no macro argument
 * parsing, no fold/outline tree — see DECISIONS.md D-040 for the L4 boundary.
 */
import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import { tags as t, type Tag } from "@lezer/highlight";

/* ------------------------------ pure scanner ------------------------------ */

export type AdocTokenType =
  | "heading"
  | "attrName"
  | "attrValue"
  | "attrRef"
  | "comment"
  | "blockComment"
  | "xref"
  | "shortXref"
  | "link"
  | "include"
  | "listMark"
  | "blockAttr"
  | "fence"
  | "code";

export interface AdocToken {
  type: AdocTokenType;
  /** offset relative to the line start, inclusive */
  from: number;
  /** offset relative to the line start, exclusive */
  to: number;
  /** heading level 1–6 (heading tokens only) */
  level?: number;
}

/** Block-level state carried across lines (fences / block comments). */
export interface AdocBlockState {
  inCode: boolean;
  /** the opening fence capture (`----` / `….` / `++++` / `$$$$`) */
  fence: string;
  inComment: boolean;
}

export function initialAdocBlockState(): AdocBlockState {
  return { inCode: false, fence: "", inComment: false };
}

const HEADING_RE = /^(={1,6})\s+(.+)$/;
const ATTR_LINE_RE = /^:([A-Za-z0-9_-]+):\s*(.*)$/;
const BLOCK_COMMENT_FENCE_RE = /^\/\/\/\/\s*$/;
const CODE_FENCE_RE = /^(-{4,}|\.{4,}|\+{4,}|\${4})\s*$/;
const BLOCK_ATTR_RE = /^\[[^\]]*\]/;
const LIST_RE = /^(\s*)(?:[-*•]\s+|[0-9]+\.\s+|[a-zA-Z]+\)\s+)/;

const XREF_RE = /xref:([^\[\s]+)\[([^\]]*)\]/g;
const LINK_RE = /(?<!x)link:([^\[\s]+)\[([^\]]*)\]/g;
const SHORT_RE = /<<([^<>\n]+)>>/g;
const INCLUDE_RE = /^include::([^\[\s]+)\[/;
const ATTR_REF_RE = /\{([A-Za-z0-9_-]+)\}/g;

function overlaps(tokens: readonly AdocToken[], from: number, to: number): boolean {
  return tokens.some((tk) => from < tk.to && to > tk.from);
}

/** Inline macro/attribute-ref scan on one line; skips ranges already claimed
 *  by a block-level token (heading / attribute line / list marker / block attr). */
function scanInline(line: string, tokens: AdocToken[]): void {
  const matches: Array<{ from: number; to: number; type: AdocTokenType }> = [];
  const inline: Array<{ re: RegExp; type: AdocTokenType }> = [
    { re: XREF_RE, type: "xref" },
    { re: LINK_RE, type: "link" },
    { re: SHORT_RE, type: "shortXref" },
    { re: ATTR_REF_RE, type: "attrRef" },
  ];
  for (const { re, type } of inline) {
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) {
      const from = m.index ?? 0;
      matches.push({ from, to: from + m[0].length, type });
    }
  }
  const inc = INCLUDE_RE.exec(line);
  if (inc) matches.push({ from: 0, to: inc[0].length, type: "include" });

  matches.sort((a, b) => a.from - b.from);
  for (const mt of matches) {
    if (mt.to <= mt.from) continue;
    if (overlaps(tokens, mt.from, mt.to)) continue;
    tokens.push({ type: mt.type, from: mt.from, to: mt.to });
  }
}

/**
 * Tokenize one AsciiDoc line. Pure: the previous block state is passed in and
 * the updated state returned, so a whole document can be tokenized line by
 * line without a CodeMirror view. Malformed input (unclosed fence, empty
 * attribute name, broken macro syntax, oversized line) degrades to plain text
 * tokens — it never throws.
 */
export function scanAsciiDocLine(
  line: string,
  state: AdocBlockState = initialAdocBlockState(),
): { tokens: AdocToken[]; state: AdocBlockState } {
  const tokens: AdocToken[] = [];
  const next: AdocBlockState = { ...state };
  const len = line.length;

  // Inside a block comment: everything is comment text until the closing fence.
  if (state.inComment) {
    if (len > 0) tokens.push({ type: "blockComment", from: 0, to: len });
    if (BLOCK_COMMENT_FENCE_RE.test(line)) next.inComment = false;
    return { tokens, state: next };
  }

  // Inside a verbatim block: text is code; the matching fence closes it.
  if (state.inCode) {
    const fm = CODE_FENCE_RE.exec(line);
    if (fm && fm[1] === state.fence) {
      tokens.push({ type: "fence", from: 0, to: len });
      next.inCode = false;
      next.fence = "";
    } else if (len > 0) {
      tokens.push({ type: "code", from: 0, to: len });
    }
    return { tokens, state: next };
  }

  // Block comment fence opens a comment region.
  if (BLOCK_COMMENT_FENCE_RE.test(line)) {
    tokens.push({ type: "blockComment", from: 0, to: len });
    next.inComment = true;
    return { tokens, state: next };
  }

  // Verbatim fence opens a code region.
  const fence = CODE_FENCE_RE.exec(line);
  if (fence) {
    tokens.push({ type: "fence", from: 0, to: len });
    next.inCode = true;
    next.fence = fence[1];
    return { tokens, state: next };
  }

  const heading = HEADING_RE.exec(line);
  if (heading) {
    tokens.push({ type: "heading", from: 0, to: len, level: heading[1].length });
    return { tokens, state: next };
  }

  // Line comment: `//` at column 0 (the `////` fence was handled above).
  if (line.startsWith("//")) {
    tokens.push({ type: "comment", from: 0, to: len });
    return { tokens, state: next };
  }

  // Document attribute line: `:attr: value`. An empty attribute name fails the
  // `[A-Za-z0-9_-]+` class and falls through to plain-text inline scanning.
  const attr = ATTR_LINE_RE.exec(line);
  if (attr) {
    const nameEnd = 1 + attr[1].length + 1; // `:name:`
    tokens.push({ type: "attrName", from: 0, to: nameEnd });
    const value = attr[2];
    if (value.length > 0) {
      const valueStart = line.length - value.length;
      tokens.push({ type: "attrValue", from: valueStart, to: line.length });
    }
    return { tokens, state: next };
  }

  // Block attribute line: `[source,ts]`, `[#anchor]`, `[role=foo]`, …
  const blockAttr = BLOCK_ATTR_RE.exec(line);
  if (blockAttr) {
    tokens.push({ type: "blockAttr", from: 0, to: blockAttr[0].length });
  }

  // List marker: bullet, ordered `1.` / `a)`.
  const list = LIST_RE.exec(line);
  if (list) {
    const markerStart = list[1].length;
    tokens.push({ type: "listMark", from: markerStart, to: list[0].length });
  }

  scanInline(line, tokens);
  return { tokens, state: next };
}

/* --------------------------- xref cursor locating -------------------------- */

export interface AdocXrefRef {
  kind: "xref" | "short";
  /** vault target before the first `#` (alias dropped) */
  target: string;
  /** raw text after the first `#` (anchor / heading), or "" */
  subpath: string;
  /** bracket / comma display text, or "" */
  text: string;
  from: number;
  to: number;
  /** external scheme (http(s)/mailto/tel) — opened outside the vault */
  external: boolean;
}

const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|tel:)/i;

function splitHash(body: string): [string, string] {
  const hash = body.indexOf("#");
  return hash === -1 ? [body.trim(), ""] : [body.slice(0, hash).trim(), body.slice(hash + 1).trim()];
}

/**
 * Find the AsciiDoc xref under the cursor on one editor line. Mirrors
 * `linkAtCursor` (core/linkAtCursor.ts) but for `xref:target[text]` and
 * `<<target,text>>`. Pure string scan; returns the first whose absolute span
 * contains the cursor (inclusive at both edges). `lineStart` is the global
 * offset of the line so `from`/`to` are document-absolute.
 */
export function findXrefAt(line: string, lineStart: number, cursor: number): AdocXrefRef | null {
  const rel = cursor - lineStart;
  if (rel < 0) return null;

  for (const m of line.matchAll(XREF_RE)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (rel < from || rel > to) continue;
    const [target, subpath] = splitHash(m[1]);
    return {
      kind: "xref",
      target,
      subpath,
      text: m[2],
      from: lineStart + from,
      to: lineStart + to,
      external: EXTERNAL_RE.test(m[1]),
    };
  }

  for (const m of line.matchAll(SHORT_RE)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (rel < from || rel > to) continue;
    const inner = m[1];
    const comma = inner.indexOf(",");
    const targetPart = (comma >= 0 ? inner.slice(0, comma) : inner).trim();
    const text = comma >= 0 ? inner.slice(comma + 1).trim() : "";
    const [target, subpath] = splitHash(targetPart);
    return {
      kind: "short",
      target,
      subpath,
      text,
      from: lineStart + from,
      to: lineStart + to,
      external: EXTERNAL_RE.test(targetPart),
    };
  }

  return null;
}

/**
 * Locate an anchor inside a target document by plain-text regex scan (no
 * syntax tree). Recognises AsciiDoc block anchors `[[anchor]]` and block
 * attribute `[#anchor]`. Returns the document offset of the matching line, or
 * null when the anchor is not found. Empty anchor → null.
 */
export function findAnchorOffset(content: string, anchor: string): number | null {
  if (!anchor) return null;
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`^\\[\\[${escaped}\\]\\]`, "m"),
    new RegExp(`^\\[#${escaped}\\]`, "m"),
  ];
  for (const re of patterns) {
    const m = re.exec(content);
    if (m && m.index !== undefined) return m.index;
  }
  return null;
}

/* --------------------------- StreamLanguage adapter ------------------------ */

interface AdocStreamState {
  block: AdocBlockState;
  queue: AdocToken[];
}

/** StreamLanguage token names; mapped to lezer tags via `adocTokenTable`. */
function tokenNameFor(token: AdocToken): string {
  switch (token.type) {
    case "heading": {
      const level = Math.min(6, Math.max(1, token.level ?? 1));
      return `heading${level}`;
    }
    case "attrName":
      return "attrName";
    case "attrValue":
      return "attrValue";
    case "attrRef":
      return "attrRef";
    case "comment":
      return "comment";
    case "blockComment":
      return "blockComment";
    case "xref":
    case "shortXref":
    case "link":
    case "include":
      return "link";
    case "listMark":
      return "listMark";
    case "blockAttr":
      return "blockAttr";
    case "fence":
      return "fence";
    case "code":
      return "code";
  }
}

const adocTokenTable: Record<string, Tag> = {
  heading1: t.heading1,
  heading2: t.heading2,
  heading3: t.heading3,
  heading4: t.heading4,
  heading5: t.heading5,
  heading6: t.heading6,
  attrName: t.attributeName,
  attrValue: t.attributeValue,
  attrRef: t.propertyName,
  comment: t.lineComment,
  blockComment: t.blockComment,
  link: t.link,
  listMark: t.list,
  blockAttr: t.meta,
  fence: t.processingInstruction,
  code: t.monospace,
};

const adocStreamLanguage = StreamLanguage.define<AdocStreamState>({
  tokenTable: adocTokenTable,
  startState: (): AdocStreamState => ({ block: initialAdocBlockState(), queue: [] }),
  blankLine: (state) => {
    // A blank line does not exit a fence/comment region; just clear the queue.
    state.queue = [];
  },
  copyState: (state) => ({ block: { ...state.block }, queue: [...state.queue] }),
  token(stream, state) {
    if (stream.sol()) {
      const { tokens, state: block } = scanAsciiDocLine(stream.string, state.block);
      state.queue = tokens;
      state.block = block;
    }
    const tok = state.queue[0];
    if (!tok) {
      if (!stream.eol()) stream.next();
      return null;
    }
    // Gap of plain text before the next queued token.
    if (stream.pos < tok.from) {
      stream.pos = tok.from;
      return null;
    }
    stream.pos = tok.to;
    state.queue.shift();
    return tokenNameFor(tok);
  },
});

/** CM LanguageSupport for `.adoc` source editing. */
export function asciiDocLanguageSupport(): LanguageSupport {
  return new LanguageSupport(adocStreamLanguage);
}
