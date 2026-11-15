// @vitest-environment jsdom
/**
 * ADKM L4 extension: pure helpers for the read-only ebook formats.
 * The point of these tests is the format semantics (composite suffix, numeric
 * ordering, FB2 XML → safe text blocks), not the React plumbing.
 */
import { describe, expect, it } from "vitest";
import {
  ebookKindFromPath, isComicImage, naturalCompare, parseFb2,
} from "@core/ebookFormats";

const FB2 = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"
             xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <author><first-name>Ada</first-name><last-name>Lovelace</last-name></author>
      <book-title>Notes</book-title>
    </title-info>
  </description>
  <body>
    <title><p>Chapter 1</p></title>
    <section>
      <title><p>First</p></title>
      <p>Hello &amp; welcome</p>
      <p>&lt;script&gt;alert(1)&lt;/script&gt;</p>
      <image l:href="#cover"/>
    </section>
  </body>
  <binary id="cover" content-type="image/png">aGVsbG8=</binary>
</FictionBook>`;

describe("ebookKindFromPath", () => {
  it("recognises plain and composite FictionBook suffixes", () => {
    expect(ebookKindFromPath("book.FB2")).toBe("fb2");
    expect(ebookKindFromPath("books/book.fb2.zip")).toBe("fbz");
    expect(ebookKindFromPath("book.fbz")).toBe("fbz");
    expect(ebookKindFromPath("books/comic.cbz")).toBe("cbz");
    expect(ebookKindFromPath("book.epub")).toBeNull();
    expect(ebookKindFromPath("archive.zip")).toBeNull();
  });
});

describe("comic image selection", () => {
  it("accepts decodable image extensions, rejects everything else", () => {
    expect(isComicImage("page/webp.webp")).toBe(true);
    expect(isComicImage("p/10.JPG")).toBe(true);
    expect(isComicImage("__MACOSX/notes.txt")).toBe(false);
    expect(isComicImage("folder/")).toBe(false);
  });

  it("sorts numeric filenames numerically", () => {
    const names = ["page10.png", "page2.png", "page1.png"];
    expect([...names].sort(naturalCompare)).toEqual(["page1.png", "page2.png", "page10.png"]);
  });
});

describe("parseFb2", () => {
  it("extracts title, author and ordered blocks", () => {
    const doc = parseFb2(FB2);
    expect(doc.title).toBe("Notes");
    expect(doc.authors).toEqual(["Ada Lovelace"]);
    expect(doc.blocks.map((b) => b.kind)).toEqual(["title", "title", "p", "p", "image"]);
    expect(doc.blocks[0].text).toBe("Chapter 1");
    expect(doc.blocks[2].text).toBe("Hello & welcome");
  });

  it("resolves embedded binaries to data URLs", () => {
    const images = parseFb2(FB2).blocks.filter((b) => b.kind === "image");
    expect(images).toHaveLength(1);
    expect(images[0].src).toBe("data:image/png;base64,aGVsbG8=");
  });

  it("returns markup-looking content as PLAIN TEXT, never as HTML", () => {
    const text = parseFb2(FB2).blocks[3].text;
    expect(text).toBe("<script>alert(1)</script>");
    expect(text).not.toContain("&lt;");
  });

  it("rejects malformed XML and books without a body", () => {
    expect(() => parseFb2("<FictionBook><body>")).toThrow();
    expect(() => parseFb2("<FictionBook></FictionBook>")).toThrow(/body/);
  });
});
