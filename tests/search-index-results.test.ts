/**
 * Contract for the index-backed search helpers (T-041).
 *
 * The security property matters most: snippets come from note bodies and pass
 * through FTS5, so anything that treats them as HTML would turn a note into an
 * injection vector. These cases pin the parsing behaviour; the component then
 * renders every part as a React text node.
 */
import { describe, expect, it } from "vitest";
import { orderIndexHits, parseSnippetParts } from "../src/features/search/indexResults.ts";

describe("parseSnippetParts", () => {
  it("returns nothing for an empty snippet", () => {
    expect(parseSnippetParts("")).toEqual([]);
  });

  it("keeps plain text as one non-hit part", () => {
    expect(parseSnippetParts("a plain body excerpt")).toEqual([
      { text: "a plain body excerpt", hit: false },
    ]);
  });

  it("splits one match into three parts", () => {
    expect(parseSnippetParts("before <mark>rust</mark> after")).toEqual([
      { text: "before ", hit: false },
      { text: "rust", hit: true },
      { text: " after", hit: false },
    ]);
  });

  it("handles several matches in one snippet", () => {
    expect(parseSnippetParts("<mark>a</mark> x <mark>b</mark>")).toEqual([
      { text: "a", hit: true },
      { text: " x ", hit: false },
      { text: "b", hit: true },
    ]);
  });

  it("treats HTML-looking note content as literal text", () => {
    const parts = parseSnippetParts("use <script>alert(1)</script> here <mark>link</mark>");
    expect(parts.map((p) => p.text).join("")).toBe(
      "use <script>alert(1)</script> here link",
    );
    expect(parts.find((p) => p.hit)?.text).toBe("link");
  });

  it("tolerates a stray close sentinel", () => {
    expect(parseSnippetParts("abc </mark> def")).toEqual([
      { text: "abc ", hit: false },
      { text: " def", hit: false },
    ]);
  });

  it("tolerates an unclosed mark (rest stays highlighted, still plain text)", () => {
    expect(parseSnippetParts("a <mark>b")).toEqual([
      { text: "a ", hit: false },
      { text: "b", hit: true },
    ]);
  });

  it("tolerates nested marks without producing empty parts", () => {
    expect(parseSnippetParts("x <mark><mark>y</mark> z")).toEqual([
      { text: "x ", hit: false },
      { text: "y", hit: true },
      { text: " z", hit: false },
    ]);
  });
});

describe("orderIndexHits", () => {
  it("sorts bm25 ascending (lower is more relevant) without mutating input", () => {
    const hits = [{ rank: 2 }, { rank: -5 }, { rank: 0.5 }];
    expect(orderIndexHits(hits).map((h) => h.rank)).toEqual([-5, 0.5, 2]);
    expect(hits.map((h) => h.rank)).toEqual([2, -5, 0.5]);
  });

  it("puts a missing/NaN rank last instead of breaking the comparison", () => {
    const hits = [{ rank: Number.NaN }, { rank: 1 }, { rank: -1 }];
    expect(orderIndexHits(hits).map((h) => h.rank)).toEqual([-1, 1, Number.NaN]);
  });
});
