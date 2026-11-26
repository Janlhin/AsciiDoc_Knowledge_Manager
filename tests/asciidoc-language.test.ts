/**
 * T-067 (ADKM L3): contract tests for the hand-written AsciiDoc lexer and
 * xref cursor locator (`src/features/editor/asciidocLanguage.ts`).
 *
 * Pure-function tests: no real CodeMirror view is built. Tokens are asserted by
 * type + relative offset; block state is threaded line by line exactly as the
 * StreamLanguage adapter does. Negative cases (unclosed fence, empty attribute
 * name, broken xref syntax, oversized line) must degrade to plain text without
 * throwing.
 */
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  findAnchorOffset,
  findXrefAt,
  initialAdocBlockState,
  scanAsciiDocLine,
  asciiDocLanguageSupport,
  type AdocToken,
} from "@features/editor/asciidocLanguage";

function types(line: string, state = initialAdocBlockState()): AdocToken[] {
  return scanAsciiDocLine(line, state).tokens;
}

function firstOf(tokens: AdocToken[], type: string): AdocToken | undefined {
  return tokens.find((tk) => tk.type === type);
}

describe("scanAsciiDocLine — headings", () => {
  it("tokens level 1–6 ATX headings with the whole-line span", () => {
    for (let level = 1; level <= 6; level++) {
      const line = `${"=".repeat(level)} Section ${level}`;
      const [tok] = types(line);
      expect(tok.type).toBe("heading");
      expect(tok.level).toBe(level);
      expect([tok.from, tok.to]).toEqual([0, line.length]);
    }
  });

  it("does not treat a leading = in body text as a heading", () => {
    const tokens = types("=not a heading (no space)");
    expect(tokens).toEqual([]);
  });
});

describe("scanAsciiDocLine — attribute lines and refs", () => {
  it("splits :attr: value into attrName + attrValue with exact spans", () => {
    const line = ":author: Jane Doe";
    const tokens = types(line);
    const name = firstOf(tokens, "attrName");
    const value = firstOf(tokens, "attrValue");
    expect(name && [name.from, name.to]).toEqual([0, 8]);
    expect(line.slice(name!.from, name!.to)).toBe(":author:");
    expect(value && [value.from, value.to]).toEqual([9, line.length]);
    expect(line.slice(value!.from, value!.to)).toBe("Jane Doe");
  });

  it("highlights {attr} references in body text", () => {
    const line = "See the {project-version} release notes.";
    const tok = firstOf(types(line), "attrRef");
    expect(tok).toBeDefined();
    expect(line.slice(tok!.from, tok!.to)).toBe("{project-version}");
  });

  it("an empty attribute name degrades to plain text instead of throwing", () => {
    const line = ": :value with no name";
    expect(() => types(line)).not.toThrow();
    expect(firstOf(types(line), "attrName")).toBeUndefined();
  });
});

describe("scanAsciiDocLine — comments", () => {
  it("marks a // line comment", () => {
    const line = "// a short comment";
    expect(types(line)).toEqual([{ type: "comment", from: 0, to: line.length }]);
  });

  it("treats //// as a block-comment fence and threads the state", () => {
    let state = initialAdocBlockState();
    const open = scanAsciiDocLine("////", state);
    expect(open.tokens[0].type).toBe("blockComment");
    expect(open.state.inComment).toBe(true);

    const inner = scanAsciiDocLine("hidden xref:foo.adoc[bar]", open.state);
    expect(inner.tokens[0].type).toBe("blockComment");
    expect(firstOf(inner.tokens, "xref")).toBeUndefined();
    expect(inner.state.inComment).toBe(true);

    const close = scanAsciiDocLine("////", inner.state);
    expect(close.tokens[0].type).toBe("blockComment");
    expect(close.state.inComment).toBe(false);
  });
});

describe("scanAsciiDocLine — inline macros", () => {
  it("tokens an xref: macro over the whole match", () => {
    const line = "See xref:chapters/a.adoc#anchor[Text] for details.";
    const tok = firstOf(types(line), "xref");
    expect(tok).toBeDefined();
    expect(line.slice(tok!.from, tok!.to)).toBe("xref:chapters/a.adoc#anchor[Text]");
  });

  it("tokens the <<target,text>> short form", () => {
    const line = "As shown in <<chapters/b.adoc#anchor, 显示文本>> above.";
    const tok = firstOf(types(line), "shortXref");
    expect(tok).toBeDefined();
    expect(line.slice(tok!.from, tok!.to)).toBe("<<chapters/b.adoc#anchor, 显示文本>>");
  });

  it("tokens a link: macro", () => {
    const line = "Visit link:https://example.com[the site] please.";
    const tok = firstOf(types(line), "link");
    expect(tok).toBeDefined();
    expect(line.slice(tok!.from, tok!.to)).toBe("link:https://example.com[the site]");
  });

  it("tokens an include:: directive", () => {
    const line = "include::shared/setup.adoc[]";
    const tok = firstOf(types(line), "include");
    expect(tok).toBeDefined();
    expect(line.slice(tok!.from, tok!.to)).toBe("include::shared/setup.adoc[");
  });

  it("does not tokenize a malformed xref without brackets", () => {
    const line = "xref:target-no-bracket";
    expect(firstOf(types(line), "xref")).toBeUndefined();
    expect(findXrefAt(line, 0, 5)).toBeNull();
  });
});

describe("scanAsciiDocLine — lists", () => {
  it("marks a bullet list item", () => {
    const tok = firstOf(types("- bullet item"), "listMark");
    expect(tok && [tok.from, tok.to]).toEqual([0, 2]);
  });

  it("marks an ordered list item", () => {
    const tok = firstOf(types("1. ordered item"), "listMark");
    expect(tok && [tok.from, tok.to]).toEqual([0, 3]);
  });
});

describe("scanAsciiDocLine — verbatim blocks", () => {
  it("marks the [source,...] block attribute line and the fence pair", () => {
    let state = initialAdocBlockState();
    const attr = scanAsciiDocLine("[source,ts]", state);
    expect(attr.tokens[0].type).toBe("blockAttr");
    state = attr.state;

    const open = scanAsciiDocLine("----", state);
    expect(open.tokens[0].type).toBe("fence");
    expect(open.state.inCode).toBe(true);
    state = open.state;

    const inner = scanAsciiDocLine("const x = 1; // not a comment", state);
    expect(inner.tokens[0].type).toBe("code");
    expect(firstOf(inner.tokens, "comment")).toBeUndefined();
    state = inner.state;

    const close = scanAsciiDocLine("----", state);
    expect(close.tokens[0].type).toBe("fence");
    expect(close.state.inCode).toBe(false);
  });

  it("keeps scanning code after an unclosed fence (no throw)", () => {
    let state = initialAdocBlockState();
    state = scanAsciiDocLine("----", state).state;
    const dangling = scanAsciiDocLine("still inside, xref:foo.adoc[bar]", state);
    expect(dangling.tokens[0].type).toBe("code");
    expect(dangling.state.inCode).toBe(true);
  });
});

describe("findXrefAt — cursor location", () => {
  it("splits xref:target#anchor[text] into target / subpath / text", () => {
    const line = "xref:chapters/a.adoc#anchor[Display]";
    const ref = findXrefAt(line, 100, 110);
    expect(ref).toMatchObject({
      kind: "xref",
      target: "chapters/a.adoc",
      subpath: "anchor",
      text: "Display",
      from: 100,
      to: 100 + line.length,
    });
  });

  it("parses the short form target/subpath/alias, cursor at the closing edge", () => {
    const line = "<<note.adoc#heading, Alias>>";
    const ref = findXrefAt(line, 0, line.length);
    expect(ref).toMatchObject({
      kind: "short",
      target: "note.adoc",
      subpath: "heading",
      text: "Alias",
    });
  });

  it("returns null on plain text and outside a link span", () => {
    const line = "just a paragraph with no reference";
    expect(findXrefAt(line, 0, 10)).toBeNull();
    const xref = "xref:only.adoc[one]";
    expect(findXrefAt(xref, 0, xref.length + 5)).toBeNull();
  });

  it("flags external schemes without matching a vault target", () => {
    const ref = findXrefAt("xref:https://example.com[x]", 0, 10);
    expect(ref?.external).toBe(true);
  });
});

describe("findAnchorOffset — plain-text anchor scan", () => {
  it("finds a [[anchor]] block anchor", () => {
    const content = "= Intro\n\n[[my-anchor]]\n== Section\n";
    expect(findAnchorOffset(content, "my-anchor")).toBe(content.indexOf("[[my-anchor]]"));
  });

  it("finds a [#anchor] block attribute", () => {
    const content = "[#other-id]\n----\ncode\n----\n";
    expect(findAnchorOffset(content, "other-id")).toBe(0);
  });

  it("returns null for a missing or empty anchor", () => {
    expect(findAnchorOffset("= Doc", "nope")).toBeNull();
    expect(findAnchorOffset("= Doc", "")).toBeNull();
  });
});

describe("robustness — oversized / malformed input", () => {
  it("does not choke on a very long plain line", () => {
    const longLine = "word ".repeat(20_000);
    expect(() => types(longLine)).not.toThrow();
    expect(types(longLine).length).toBe(0);
  });

  it("does not choke on a broken short ref with no closing >>", () => {
    const line = "<<never-closed, text";
    expect(() => types(line)).not.toThrow();
    expect(findXrefAt(line, 0, 3)).toBeNull();
  });

  it("keeps every token inside the line bounds", () => {
    const line = "= H\n:k: v\n// c\nxref:a.adoc[b]\n<<c.adoc, t>>\n----\ncode\n----";
    let state = initialAdocBlockState();
    for (const l of line.split("\n")) {
      const res = scanAsciiDocLine(l, state);
      state = res.state;
      for (const tk of res.tokens) {
        expect(tk.from).toBeGreaterThanOrEqual(0);
        expect(tk.to).toBeLessThanOrEqual(l.length);
        expect(tk.to).toBeGreaterThan(tk.from);
      }
    }
  });
});

describe("asciiDocLanguageSupport — mounts in an EditorState without crashing", () => {
  it("builds a state with the adoc language extension", () => {
    const state = EditorState.create({
      doc: "= Title\n\nxref:a.adoc[b]\n",
      extensions: [asciiDocLanguageSupport()],
    });
    expect(state.doc.length).toBeGreaterThan(0);
    // no throw above is the assertion: the StreamLanguage adapter mounts cleanly.
  });
});
