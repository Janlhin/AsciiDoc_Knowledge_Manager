// @vitest-environment jsdom
/**
 * Q-005 / B-tier: Kindle parser selection and untrusted-HTML reduction.
 * The safety tests are the point: chapter HTML comes from an external file and
 * must never reach the app as markup or executable content.
 */
import { describe, expect, it } from "vitest";
import { mobiParserKind, sanitizeMobiHtml } from "@core/mobi";

describe("mobiParserKind", () => {
  it("routes MOBI-family and KF8-family extensions to the right parser", () => {
    expect(mobiParserKind("book.MOBI")).toBe("mobi");
    expect(mobiParserKind("book.azw")).toBe("mobi");
    expect(mobiParserKind("book.prc")).toBe("mobi");
    expect(mobiParserKind("books/book.azw3")).toBe("kf8");
    expect(mobiParserKind("book.kf8")).toBe("kf8");
    expect(mobiParserKind("book.epub")).toBeNull();
    expect(mobiParserKind("book")).toBeNull();
  });
});

describe("sanitizeMobiHtml", () => {
  it("extracts headings and paragraphs without duplicating nested blocks", () => {
    const blocks = sanitizeMobiHtml(
      "<h1>Chapter One</h1><div><p>First.</p><p>Second.</p></div>",
    );
    expect(blocks.map((b) => `${b.kind}:${b.text}`)).toEqual([
      "heading:Chapter One", "paragraph:First.", "paragraph:Second.",
    ]);
  });

  it("keeps only parser-produced image URLs", () => {
    const blocks = sanitizeMobiHtml(
      '<p>Cover</p><img src="blob:abc"><img src="data:image/png;base64,aGk=">' +
      '<img src="javascript:alert(1)"><img src="https://example.com/x.png">',
    );
    expect(blocks.filter((b) => b.kind === "image").map((b) => b.src)).toEqual([
      "blob:abc", "data:image/png;base64,aGk=",
    ]);
  });

  it("drops script/style subtrees, including from the plain-text fallback", () => {
    const blocks = sanitizeMobiHtml(
      "<script>alert(1)</script><style>body{color:red}</style><p>Visible.</p>",
    );
    expect(blocks.map((b) => b.text)).toEqual(["Visible."]);
    const scriptOnly = sanitizeMobiHtml("<div><script>alert(1)</script></div>");
    expect(scriptOnly).toEqual([]);
  });

  it("never emits attributes, so event handlers cannot survive", () => {
    const blocks = sanitizeMobiHtml(
      '<p onclick="alert(1)">Text with handler</p><img src="blob:x" onerror="alert(2)">',
    );
    expect(JSON.stringify(blocks)).not.toContain("onclick");
    expect(JSON.stringify(blocks)).not.toContain("onerror");
    expect(blocks[0].text).toBe("Text with handler");
  });

  it("falls back to a plain-text block for inline-only markup", () => {
    expect(sanitizeMobiHtml("<span><b>Bold</b> tail</span>")).toMatchObject([
      { kind: "paragraph", text: "Bold tail" },
    ]);
    expect(sanitizeMobiHtml("")).toEqual([]);
  });
});
