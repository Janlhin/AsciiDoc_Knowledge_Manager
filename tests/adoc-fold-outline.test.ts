/**
 * T-071 (D-045): AsciiDoc heading folding + outline row construction.
 *
 * Fold side: the pure `foldAdocSection` / `collectAdocHeadings` reuse the batch-1
 * `scanAsciiDocLine` block state, so `=`-prefixed lines inside verbatim fences,
 * `////` block comments, `[source,…]` blocks and `//` line comments are NOT
 * headings. The Markdown fold path is untouched; these tests only cover the adoc
 * scanner-based range geometry.
 *
 * Outline side: `buildRows` is format-blind; here it is fed real
 * `parseDocument("….adoc", …)` headings and asserted on level / collapse key /
 * child flag. Degenerate inputs (empty, all-code, very deep) must not throw.
 */
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  adocFoldRange,
  adocFoldService,
  collectAdocHeadings,
  foldAdocSection,
} from "@features/editor/folding";
import { asciiDocLanguageSupport } from "@features/editor/asciidocLanguage";
import { buildRows } from "@features/outline/outlineRows";
import { parseDocument } from "@core/metadata";

/** Exclusive end offset of 0-based line `n`, excluding a trailing CR (LF/CRLF safe). */
function lineEnd(source: string, n: number): number {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  const s = starts[n];
  if (s === undefined) throw new Error(`line ${n} out of range`);
  let e = source.indexOf("\n", s);
  if (e === -1) e = source.length;
  if (e > s && source.charCodeAt(e - 1) === 13) e--;
  return e;
}

describe("foldAdocSection — heading boundaries", () => {
  it("folds an H1 to EOF when every successor is a deeper level", () => {
    const src = ["= Title", "intro", "== Section A", "body A", "== Section B", "body B"].join("\n");
    expect(foldAdocSection(src, 0)).toEqual({ from: lineEnd(src, 0), to: src.length });
  });

  it("stops an H2 at the next same-level heading", () => {
    const src = ["= Title", "intro", "== Section A", "body A", "== Section B", "body B"].join("\n");
    expect(foldAdocSection(src, 2)).toEqual({ from: lineEnd(src, 2), to: lineEnd(src, 3) });
  });

  it("a deeper H6 does not terminate an H2 section (level jump down to ======)", () => {
    const src = ["== H2", "body", "====== H6", "deep body"].join("\n");
    expect(foldAdocSection(src, 0)).toEqual({ from: lineEnd(src, 0), to: src.length });
    expect(foldAdocSection(src, 2)).toEqual({ from: lineEnd(src, 2), to: src.length });
  });

  it("the last section folds to EOF", () => {
    const src = ["= A", "== B", "== C", "tail"].join("\n");
    expect(foldAdocSection(src, 2)).toEqual({ from: lineEnd(src, 2), to: src.length });
  });

  it("a single-line document with no trailing newline folds nothing", () => {
    expect(foldAdocSection("= Only", 0)).toBeNull();
  });

  it("a leaf heading with no body folds nothing", () => {
    const src = ["= A", "== B"].join("\n");
    expect(foldAdocSection(src, 1)).toBeNull();
  });

  it("nested: the H2 ends at the next H2; the H3 ends at that same H2", () => {
    const src = [
      "= Root",
      "== Sub 1",
      "=== Leaf 1a",
      "leaf body",
      "== Sub 2",
      "=== Leaf 2a",
      "leaf 2 body",
    ].join("\n");
    expect(foldAdocSection(src, 1)).toEqual({ from: lineEnd(src, 1), to: lineEnd(src, 3) });
    expect(foldAdocSection(src, 2)).toEqual({ from: lineEnd(src, 2), to: lineEnd(src, 3) });
    expect(foldAdocSection(src, 4)).toEqual({ from: lineEnd(src, 4), to: src.length });
  });

  it("keeps CRLF offsets exact (range end excludes the CR)", () => {
    const src = "= Title\r\nintro\r\n== Next\r\nbody\r\n== After\r\ntail\r\n";
    expect(foldAdocSection(src, 0)).toEqual({ from: lineEnd(src, 0), to: src.length });
    expect(foldAdocSection(src, 2)).toEqual({ from: lineEnd(src, 2), to: lineEnd(src, 3) });
    expect(foldAdocSection(src, 4)).toEqual({ from: lineEnd(src, 4), to: src.length });
  });
});

describe("foldAdocSection — lexer-aware exclusions", () => {
  it("ignores = lines inside an unclosed code fence", () => {
    const src = ["----", "= not a heading", "still code"].join("\n");
    expect(collectAdocHeadings(src)).toEqual([]);
    expect(foldAdocSection(src, 1)).toBeNull();
  });

  it("ignores = lines inside a //// block comment", () => {
    const src = ["////", "= hidden title", "////", "= real title", "body"].join("\n");
    expect(collectAdocHeadings(src).map((h) => h.line)).toEqual([3]);
    expect(foldAdocSection(src, 1)).toBeNull();
    expect(foldAdocSection(src, 3)).toEqual({ from: lineEnd(src, 3), to: src.length });
  });

  it("ignores a // line-comment that looks like a heading", () => {
    const src = ["// = commented heading", "= real"].join("\n");
    expect(collectAdocHeadings(src).map((h) => h.line)).toEqual([1]);
    expect(foldAdocSection(src, 0)).toBeNull();
  });

  it("ignores = lines inside a [source,…] verbatim block", () => {
    const src = [
      "[source,ts]",
      "----",
      "const x = 1;",
      "= fake heading in code",
      "----",
      "== real section",
    ].join("\n");
    expect(collectAdocHeadings(src).map((h) => h.line)).toEqual([5]);
    expect(foldAdocSection(src, 3)).toBeNull();
  });

  it("does not treat seven-or-more = as a heading", () => {
    const src = ["======= not a heading", "= real"].join("\n");
    expect(collectAdocHeadings(src).map((h) => h.line)).toEqual([1]);
  });
});

describe("foldAdocSection — Fold heading setting", () => {
  it("returns null when foldHeadingOn is false", () => {
    const src = ["= A", "body"].join("\n");
    expect(foldAdocSection(src, 0, false)).toBeNull();
  });
});

describe("outline rows — AsciiDoc headings", () => {
  const src = ["= Doc Title", "== Chapter One", "=== Section One A", "== Chapter Two"].join("\n");
  const headings = parseDocument("demo.adoc", src).headings;

  it("keeps level, text and source offset from the adoc parser", () => {
    expect(headings.map((h) => h.level)).toEqual([1, 2, 3, 2]);
    expect(headings.map((h) => h.text)).toEqual(["Doc Title", "Chapter One", "Section One A", "Chapter Two"]);
    for (const h of headings) expect(h.from).toBeGreaterThanOrEqual(0);
  });

  it("builds rows with index collapse keys and child flags", () => {
    const rows = buildRows(headings);
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(rows.map((r) => r.hasChildren)).toEqual([true, true, false, false]);
    expect(rows[0].heading.from).toBe(headings[0].from);
    expect(rows[2].heading.level).toBe(3);
  });
});

describe("outline + folding — degenerate input", () => {
  it("empty document yields no headings and no rows", () => {
    expect(collectAdocHeadings("")).toEqual([]);
    expect(foldAdocSection("", 0)).toBeNull();
    expect(buildRows([])).toEqual([]);
  });

  it("an all-code document yields no headings", () => {
    const src = ["----", "= x", "// y", "----"].join("\n");
    expect(collectAdocHeadings(src)).toEqual([]);
    expect(foldAdocSection(src, 1)).toBeNull();
    expect(buildRows(parseDocument("c.adoc", src).headings)).toEqual([]);
  });

  it("a very deep heading sequence does not crash", () => {
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) lines.push(`${"=".repeat((i % 6) + 1)} Deep ${i}`);
    const src = lines.join("\n");
    expect(() => collectAdocHeadings(src)).not.toThrow();
    const headings = collectAdocHeadings(src);
    expect(headings.length).toBe(500);
    for (const h of headings) {
      const range = foldAdocSection(src, h.line);
      if (range) expect(range.from).toBeGreaterThanOrEqual(h.to);
    }
    expect(() => buildRows(parseDocument("deep.adoc", src).headings)).not.toThrow();
  });
});

describe("adocFoldService — light assembly probe", () => {
  it("mounts the adoc language + fold service in an EditorState without crashing", () => {
    const state = EditorState.create({
      doc: "= Title\n\n== Section\nbody\n",
      extensions: [asciiDocLanguageSupport(), adocFoldService(true)],
    });
    const line = state.doc.line(1);
    expect(adocFoldRange(state, line.from, line.to, true)).not.toBeNull();
  });

  it("the gated-off service reports no foldable range", () => {
    const state = EditorState.create({
      doc: "= Title\nbody\n",
      extensions: [asciiDocLanguageSupport(), adocFoldService(false)],
    });
    const line = state.doc.line(1);
    expect(adocFoldRange(state, line.from, line.to, false)).toBeNull();
  });
});
