/**
 * T-046: pin the six documentation-lint rules. Each rule has a positive case
 * (fires) and, where meaningful, a negative case (stays silent). A clean note
 * must produce zero issues — that is the guard against a lint that cries wolf.
 */
import { describe, expect, it } from "vitest";
import {
  auditNote, auditVault, maskForScan,
  DEFAULT_AUDIT_CONFIG, AUDIT_CATEGORIES,
  type AuditEnv, type AuditNoteInput, type AuditCategory,
} from "@core/docAudit";
import { parseNote } from "@core/metadata";

/** Build an AuditNoteInput from raw markdown, with a controlled link resolver. */
function note(content: string, resolve = (_t: string, _p: string) => "some/path.md"): { input: AuditNoteInput; env: AuditEnv } {
  return {
    input: { path: "Test.md", content, meta: parseNote("Test.md", content) },
    env: { resolveLink: resolve },
  };
}

function cats(content: string, resolve?: (t: string, p: string) => string | null): AuditCategory[] {
  const n = note(content, resolve);
  return [...new Set(auditNote(n.input, n.env).map((i) => i.category))];
}

describe("T-046 doc audit — clean note", () => {
  it("emits zero issues for a well-formed note", () => {
    const content = [
      "---",
      "title: Sample",
      "---",
      "",
      "# Sample",
      "",
      "Use frontmatter for properties and a [[Target|wikilink]] to navigate.",
      "",
      "## Section",
      "",
      "这是一个规范的段落，使用全角标点。没有任何问题。",
    ].join("\n");
    const n = note(content);
    expect(auditNote(n.input, n.env)).toEqual([]);
  });

  it("does not scan inside frontmatter or code blocks", () => {
    const content = [
      "---",
      "title: front matter, test",
      "---",
      "",
      "# Ok",
      "",
      "```text",
      "wiki link, hello;world",
      "```",
      "",
      "Clean body with no drift.",
    ].join("\n");
    const n = note(content);
    const issues = auditNote(n.input, n.env);
    expect(issues.filter((i) => i.category === "terminology" || i.category === "punctuation")).toEqual([]);
  });
});

describe("T-046 — terminology consistency", () => {
  it("flags a variant and suggests the canonical term", () => {
    const [n] = [note("# T\n\nWe store it in front matter.\n")];
    const issues = auditNote(n.input, n.env).filter((i) => i.category === "terminology");
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain("frontmatter");
    expect(issues[0].line).toBe(3);
  });

  it("stays silent on the canonical spelling", () => {
    expect(cats("# T\n\nWe store it in frontmatter.\n")).not.toContain("terminology");
  });
});

describe("T-046 — broken links", () => {
  it("flags a wikilink whose target does not resolve", () => {
    const n = note("# T\n\nSee [[Missing Note]].\n", () => null);
    const issues = auditNote(n.input, n.env).filter((i) => i.category === "broken-link");
    expect(issues.length).toBe(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("Missing Note");
  });

  it("stays silent on resolved links, external URLs, anchors and includes", () => {
    const content = [
      "# T", "",
      "[[Present]] and [site](https://example.com) and [[#local]]",
      "",
      "include::fragment.adoc[]",
    ].join("\n");
    // Recognise the plain [[Present]] as present; everything else is skipped by rule.
    const n = note(content, (t) => (t === "Present" ? "Present.md" : null));
    expect(auditNote(n.input, n.env).filter((i) => i.category === "broken-link")).toEqual([]);
  });
});

describe("T-046 — heading level skip", () => {
  it("flags H2 -> H4", () => {
    const issues = note("# T\n\n## A\n\n#### C\n");
    const found = auditNote(issues.input, issues.env).filter((i) => i.category === "heading-skip");
    expect(found.length).toBe(1);
    expect(found[0].message).toContain("H2");
    expect(found[0].message).toContain("H4");
  });

  it("stays silent on a well-nested outline", () => {
    expect(cats("# T\n\n## A\n\n### B\n\n## C\n")).not.toContain("heading-skip");
  });
});

describe("T-046 — required frontmatter", () => {
  it("flags a missing title field", () => {
    const n = note("# T\n\nNo properties here.\n");
    const issues = auditNote(n.input, n.env).filter((i) => i.category === "frontmatter-missing");
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain("title");
  });

  it("honours a custom required-field list", () => {
    const content = "---\ntitle: T\n---\n\n# T\n\nBody.\n";
    const n = note(content);
    n.env.config = { requiredFrontmatter: ["status"] };
    expect(auditNote(n.input, n.env).some((i) => i.category === "frontmatter-missing" && i.message.includes("status"))).toBe(true);
  });
});

describe("T-046 — structure", () => {
  it("flags multiple H1 headings", () => {
    const n = note("# One\n\n# Two\n");
    const issues = auditNote(n.input, n.env).filter((i) => i.category === "structure");
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain("2 个一级标题");
  });

  it("flags a document whose first heading is not H1", () => {
    const n = note("## Starts at two\n\nBody.\n");
    const issues = auditNote(n.input, n.env).filter((i) => i.category === "structure");
    expect(issues.length).toBe(1);
    expect(issues[0].message).toContain("缺少一级标题");
  });
});

describe("T-046 — punctuation", () => {
  it("flags halfwidth comma after a Chinese character", () => {
    const n = note("# T\n\n中文,后面还有内容。\n");
    const issues = auditNote(n.input, n.env).filter((i) => i.category === "punctuation");
    expect(issues.some((i) => i.message.includes("逗号"))).toBe(true);
  });

  it("stays silent on fullwidth punctuation", () => {
    expect(cats("# T\n\n中文，后面还有内容。\n")).not.toContain("punctuation");
  });

  it("does not fire on ASCII commas in English prose", () => {
    expect(cats("# T\n\nOne, two, three in English.\n")).not.toContain("punctuation");
  });
});

describe("T-046 — vault aggregation", () => {
  it("reports scanned files, category and severity counts", () => {
    const a = note("# T\n\n中文,这里有半角逗号。\n").input;
    const b = note("---\ntitle: B\n---\n\n# B\n\nClean.\n").input;
    const report = auditVault([a, b], { resolveLink: () => "x.md" });
    expect(report.filesScanned).toBe(2);
    expect(report.issues.length).toBeGreaterThan(0);
    expect(AUDIT_CATEGORIES.every((c) => c in report.byCategory)).toBe(true);
    expect(report.byCategory.punctuation).toBeGreaterThan(0);
    expect(report.bySeverity.warning).toBeGreaterThan(0);
  });

  it("maskForScan preserves length so offsets stay valid", () => {
    const content = "---\ntitle: x\n---\n# H\n\n正文 `code` 结束。";
    expect(maskForScan(content).length).toBe(content.length);
  });
});
