// @vitest-environment jsdom
/**
 * T-061: EPUB reading support — TOC flattening and reading-position storage.
 *
 * These pin the two behaviours the user experienced as "目录/进度不对": a book with
 * a real nav document must produce a usable, indented TOC, and a position must
 * survive leaving the tab. The rendering itself is covered by the real-app E2E case
 * `epub-toc-progress`.
 */
import { describe, expect, it } from "vitest";
import {
  epubPositionKey,
  flattenToc,
  parsePosition,
  readPosition,
  sameDocument,
  spinePercent,
  writePosition,
} from "@core/epubNav";

describe("flattenToc", () => {
  it("keeps nesting depth so the UI can indent sections", () => {
    const toc = flattenToc([
      { label: "Part One", href: "part1.xhtml", subitems: [
        { label: "Chapter 1", href: "ch1.xhtml" },
        { label: "Chapter 2", href: "ch2.xhtml", subitems: [{ label: "Section 2.1", href: "ch2.xhtml#s1" }] },
      ] },
      { label: "Part Two", href: "part2.xhtml" },
    ]);
    expect(toc.map((e) => [e.label, e.depth, e.href])).toEqual([
      ["Part One", 0, "part1.xhtml"],
      ["Chapter 1", 1, "ch1.xhtml"],
      ["Chapter 2", 1, "ch2.xhtml"],
      ["Section 2.1", 2, "ch2.xhtml#s1"],
      ["Part Two", 0, "part2.xhtml"],
    ]);
  });

  it("drops entries without an href (a row you cannot jump to is worse than none)", () => {
    const toc = flattenToc([{ label: "Broken" }, { label: "Fine", href: "a.xhtml" }]);
    expect(toc).toHaveLength(1);
    expect(toc[0]!.label).toBe("Fine");
  });

  it("falls back to the file name when the label is empty", () => {
    const toc = flattenToc([{ label: "   ", href: "Text/chapter-3.xhtml" }]);
    expect(toc[0]!.label).toBe("chapter-3.xhtml");
  });

  it("survives a book without navigation", () => {
    expect(flattenToc(null)).toEqual([]);
    expect(flattenToc(undefined)).toEqual([]);
    expect(flattenToc([])).toEqual([]);
  });
});

describe("sameDocument", () => {
  it("ignores anchors and URL encoding when marking the current chapter", () => {
    expect(sameDocument("Text/ch1.xhtml#s2", "Text/ch1.xhtml")).toBe(true);
    expect(sameDocument("Text/%E7%AC%AC1%E7%AB%A0.xhtml", "Text/第1章.xhtml")).toBe(true);
    expect(sameDocument("Text/ch1.xhtml", "Text/ch2.xhtml")).toBe(false);
    expect(sameDocument(null, "Text/ch1.xhtml")).toBe(false);
  });
});

describe("spinePercent", () => {
  it("maps a spine index to a bounded 1..100 percentage", () => {
    expect(spinePercent(0, 4)).toBe(25);
    expect(spinePercent(3, 4)).toBe(100);
    expect(spinePercent(9, 4)).toBe(100);
    expect(spinePercent(0, 0)).toBe(0);
    expect(spinePercent(Number.NaN, 4)).toBe(0);
  });
});

describe("position storage", () => {
  it("round-trips cfi, index and percent", () => {
    writePosition("C:\\Vaults\\Notes", "books/a.epub", { cfi: "epubcfi(/6/4!/2/2)", index: 2, percent: 60 });
    expect(readPosition("C:\\Vaults\\Notes", "books/a.epub")).toEqual({
      cfi: "epubcfi(/6/4!/2/2)",
      index: 2,
      percent: 60,
    });
  });

  it("namespaces by vault so two vaults never share a position", () => {
    expect(epubPositionKey("C:\\A", "b.epub")).not.toBe(epubPositionKey("C:\\B", "b.epub"));
    // normalisation is case/separator insensitive, same as the workspace snapshot keys
    expect(epubPositionKey("C:\\A\\", "b.epub")).toBe(epubPositionKey("c:/a", "b.epub"));
  });

  it("returns null for missing or corrupt entries instead of throwing", () => {
    expect(parsePosition(null)).toBeNull();
    expect(parsePosition("{not json")).toBeNull();
    expect(parsePosition(JSON.stringify({ index: 3 }))).toBeNull();
    expect(parsePosition(JSON.stringify({ cfi: "x", index: -5, percent: 400 }))).toEqual({
      cfi: "x",
      index: 0,
      percent: 0,
    });
  });
});
