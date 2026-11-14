/**
 * Contract tests for note parsing (src/core/metadata.ts `parseNote`).
 *
 * Why this file exists before anything else: the persistent search index stores
 * whatever `parseNote` extracted, and its incremental sync skips files whose
 * mtime/size did not change (T-039, `PARSE_RULES_VERSION`). A silent change in
 * tag/link/heading extraction therefore leaves every untouched note carrying
 * results from the old rules — no error, no warning, just wrong tags and
 * backlinks after an upgrade. Pinning the contract here makes such a change
 * deliberate: if these go red, the Rust constant must be bumped too.
 */
import { describe, expect, it } from "vitest";
import { parseNote } from "@core/metadata";

describe("parseNote — tags", () => {
  it("collects inline tags in document order", () => {
    const tags = parseNote("a.md", "#alpha\n#beta/gamma\n#alpha").tags.map((t) => t.tag);
    expect(tags).toEqual(["alpha", "beta/gamma", "alpha"]);
  });

  it("ignores tags inside fenced code", () => {
    const doc = ["```", "#inside-fence", "```", "#outside"].join("\n");
    expect(parseNote("b.md", doc).tags.map((t) => t.tag)).toEqual(["outside"]);
  });

  it("does not treat a bare # as a tag", () => {
    expect(parseNote("c.md", "issue # and # not-a-tag").tags.map((t) => t.tag)).toEqual([]);
  });

  // Recorded deviation, not endorsed behaviour: Obsidian requires at least one
  // non-numeric character in a tag, so `#123` should not be one. Geode's TAG_RE
  // accepts it. `it.fails` keeps this visible — the day someone tightens the
  // regex this test starts failing and the marker must be dropped (and
  // PARSE_RULES_VERSION bumped).
  it.fails("does not treat a numeric #123 as a tag (known deviation)", () => {
    expect(parseNote("c2.md", "issue #123").tags.map((t) => t.tag)).toEqual([]);
  });
});

describe("parseNote — links", () => {
  it("keeps wikilinks and markdown links in one list", () => {
    const doc = ["[[Note A]]", "[[Note B|alias]]", "[md](folder/note.md)"].join("\n");
    expect(parseNote("d.md", doc).links.map((l) => l.target)).toEqual([
      "Note A",
      "Note B",
      "folder/note.md",
    ]);
  });

  it("ignores links inside fenced code", () => {
    const doc = ["```", "[[inside-link]]", "```"].join("\n");
    expect(parseNote("e.md", doc).links).toEqual([]);
  });

  it("records the alias separately from the target", () => {
    const [link] = parseNote("f.md", "[[Target|Shown]]").links;
    expect(link.target).toBe("Target");
    expect(link.alias).toBe("Shown");
  });
});

describe("parseNote — headings", () => {
  it("keeps level and raw text, in document order", () => {
    // `text` is the raw heading tail; closing hashes are stripped at match time
    // (`stripHeadingText`, metadata.ts:640) rather than at parse time.
    const doc = ["# One", "## Two ##", "text", "### Three"].join("\n");
    expect(parseNote("g.md", doc).headings.map((h) => [h.level, h.text])).toEqual([
      [1, "One"],
      [2, "Two ##"],
      [3, "Three"],
    ]);
  });

  it("does not treat a heading inside a fence as a heading", () => {
    const doc = ["```", "# not a heading", "```"].join("\n");
    expect(parseNote("h.md", doc).headings).toEqual([]);
  });
});

describe("parseNote — frontmatter", () => {
  it("exposes aliases and titles", () => {
    const doc = ["---", "aliases:", "  - First", "  - Second", "title: Real", "---", "# Body"].join(
      "\n",
    );
    const meta = parseNote("i.md", doc);
    expect(meta.aliases).toEqual(["First", "Second"]);
    expect(meta.frontmatter?.fields["title"]).toBe("Real");
  });
});

describe("parseNote — block ids", () => {
  it("registers `^id` anchors", () => {
    const ids = parseNote("j.md", "para ^dup\nother ^unique").blocks.map((b) => b.id);
    expect([...new Set(ids)].sort()).toEqual(["dup", "unique"]);
  });
});

describe("parseNote — degenerate input", () => {
  it("handles an empty document without throwing", () => {
    const meta = parseNote("k.md", "");
    expect(meta.tags).toEqual([]);
    expect(meta.headings).toEqual([]);
    expect(meta.links).toEqual([]);
  });

  it("does not choke on an unterminated fence", () => {
    expect(() => parseNote("l.md", "```\n#inside")).not.toThrow();
  });
});
