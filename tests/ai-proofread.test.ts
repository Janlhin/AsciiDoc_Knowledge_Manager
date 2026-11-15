/**
 * T-047: pin the proofreading contract on both sides of the wire.
 *
 * Prompt side — the model must receive the T-046 rule set (not a paraphrase),
 * the vault glossary, the deterministic findings, and the real note body, in
 * the language the UI is currently in.
 *
 * Reply side — models wrap JSON in prose, rename keys, invent line numbers and
 * drop fields. Every degradation must be observable: `parsed` / `rejected` /
 * `outOfRange` exist so the panel can say "the model answered badly" instead of
 * silently rendering zero findings as a clean bill of health.
 */
import { describe, expect, it } from "vitest";
import { AUDIT_RULE_DOCS, DEFAULT_AUDIT_CONFIG, type AuditIssue } from "@core/docAudit";
import { buildProofreadPrompt, parseProofreadReply, PROOFREAD_MAX_CHARS } from "@core/llm/proofread";

const NOTE = [
  "# Alpha",
  "",
  "First paragraph, with a halfwidth comma, inside Chinese text.",
  "",
  "## Section",
  "",
  "正文,这里有半角逗号。",
].join("\n");

function finding(line: number, message: string): AuditIssue {
  return {
    path: "Notes/Alpha.md",
    category: "punctuation",
    severity: "warning",
    line,
    column: 3,
    from: 0,
    message,
    excerpt: "",
  };
}

describe("T-047 prompt — rule set is forwarded verbatim", () => {
  it("carries every T-046 rule with its criteria", () => {
    const prompt = buildProofreadPrompt({ path: "Notes/Alpha.md", content: NOTE, locale: "zh" });
    const system = prompt.messages[0].content;
    expect(prompt.messages).toHaveLength(2);
    expect(prompt.messages[0].role).toBe("system");
    expect(prompt.messages[1].role).toBe("user");
    for (const rule of AUDIT_RULE_DOCS) {
      expect(system).toContain(rule.category);
      expect(system).toContain(rule.criteria);
    }
    // The output protocol is part of the contract, not an optional hint.
    expect(system).toContain("```json");
    expect(system).toContain("\"issues\"");
  });

  it("carries the glossary and the required frontmatter fields", () => {
    const system = buildProofreadPrompt({ path: "a.md", content: NOTE, locale: "zh" }).messages[0].content;
    for (const term of DEFAULT_AUDIT_CONFIG.terms) {
      expect(system).toContain(term.canonical);
      for (const variant of term.variants) expect(system).toContain(variant);
    }
    for (const field of DEFAULT_AUDIT_CONFIG.requiredFrontmatter) expect(system).toContain(field);
  });

  it("forwards deterministic findings as context and says so when there are none", () => {
    const withFindings = buildProofreadPrompt({
      path: "Notes/Alpha.md",
      content: NOTE,
      findings: [finding(7, "中文语境建议使用全角逗号「，」")],
      locale: "zh",
    });
    expect(withFindings.messages[0].content).toContain("第 7 行");
    expect(withFindings.messages[0].content).toContain("中文语境建议使用全角逗号「，」");
    expect(withFindings.findingsCount).toBe(1);

    const clean = buildProofreadPrompt({ path: "Notes/Alpha.md", content: NOTE, locale: "zh" });
    expect(clean.findingsCount).toBe(0);
    expect(clean.messages[0].content).toContain("（无）");
  });

  it("puts the note body in the user turn, fenced, with its path", () => {
    const prompt = buildProofreadPrompt({ path: "Notes/Alpha.md", content: NOTE, locale: "zh" });
    const user = prompt.messages[1].content;
    expect(user).toContain("Notes/Alpha.md");
    expect(user).toContain("正文,这里有半角逗号。");
    expect(user).toContain("````");
    expect(prompt.display).toContain("Alpha.md");
    expect(prompt.truncated).toBe(false);
  });

  it("truncates oversized notes and reports it", () => {
    const long = "x".repeat(PROOFREAD_MAX_CHARS + 100);
    const prompt = buildProofreadPrompt({ path: "big.md", content: long, locale: "zh", maxChars: 50 });
    expect(prompt.truncated).toBe(true);
    expect(prompt.messages[1].content).toContain("仅前 50 字符");
    // The body itself is capped: the fence must not carry the whole note.
    expect(prompt.messages[1].content.length).toBeLessThan(300);
  });

  it("speaks English when the UI does", () => {
    const prompt = buildProofreadPrompt({ path: "Notes/Alpha.md", content: NOTE, locale: "en" });
    const system = prompt.messages[0].content;
    expect(system).toContain("Output format");
    for (const rule of AUDIT_RULE_DOCS) expect(system).toContain(rule.criteriaEn);
    expect(prompt.display.startsWith("Proofread")).toBe(true);
    expect(prompt.messages[1].content).toContain("path: Notes/Alpha.md");
  });
});

describe("T-047 parse — structured replies become jumpable issues", () => {
  const note = { path: "Notes/Alpha.md", content: NOTE };

  it("reads a fenced json block surrounded by prose", () => {
    const reply = [
      "总评：整体规范，只有一处标点问题。",
      "",
      "```json",
      JSON.stringify({
        summary: "一处标点问题",
        issues: [{ line: 7, category: "punctuation", severity: "warning", message: "半角逗号", suggestion: "改成「，」" }],
      }),
      "```",
    ].join("\n");
    const result = parseProofreadReply(reply, note);
    expect(result.parsed).toBe(true);
    expect(result.summary).toBe("一处标点问题");
    expect(result.issues).toHaveLength(1);
    const issue = result.issues[0];
    expect(issue).toMatchObject({
      path: "Notes/Alpha.md",
      category: "punctuation",
      severity: "warning",
      line: 7,
      message: "半角逗号",
      suggestion: "改成「，」",
    });
    // Offset = start of line 7 (the line is "正文,这里有半角逗号。", col 1).
    expect(issue.from).toBe(NOTE.split("\n").slice(0, 6).join("\n").length + 1);
    expect(issue.excerpt).toBe("正文,这里有半角逗号。");
  });

  it("accepts bare JSON and a root array", () => {
    const bare = parseProofreadReply(
      '{"issues":[{"line":1,"category":"structure","message":"缺少标题层级"}]}',
      note,
    );
    expect(bare.parsed).toBe(true);
    expect(bare.issues[0].category).toBe("structure");
    expect(bare.summary).toBe("");

    const array = parseProofreadReply('[{"line":2,"category":"terminology","message":"术语"}]', note);
    expect(array.parsed).toBe(true);
    expect(array.issues).toHaveLength(1);
  });

  it("keeps a fenced block without a language tag", () => {
    const reply = "```\n{\"issues\":[{\"line\":3,\"category\":\"punctuation\",\"message\":\"x\"}]}\n```";
    expect(parseProofreadReply(reply, note).issues).toHaveLength(1);
  });

  it("maps aliases and unknown categories honestly", () => {
    const reply = JSON.stringify({
      issues: [
        { line: 1, category: "broken_link", message: "a" },
        { line: 2, category: "frontmatter", message: "b" },
        { line: 3, category: "made-up-rule", message: "c" },
      ],
    });
    const result = parseProofreadReply(reply, note);
    expect(result.issues.map((i) => i.category)).toEqual([
      "broken-link", "frontmatter-missing", "other",
    ]);
  });

  it("defaults severity instead of trusting junk", () => {
    const reply = JSON.stringify({
      issues: [
        { line: 1, category: "punctuation", message: "a", severity: "catastrophic" },
        { line: 2, category: "punctuation", message: "b", severity: "error" },
      ],
    });
    expect(parseProofreadReply(reply, note).issues.map((i) => i.severity)).toEqual(["warning", "error"]);
  });

  it("drops findings it cannot locate and counts them", () => {
    const reply = JSON.stringify({
      issues: [
        { line: 999, category: "punctuation", message: "past the end" },
        { line: 0, category: "punctuation", message: "zero" },
        { line: "not-a-number", category: "punctuation", message: "junk line" },
        { line: 3, category: "punctuation", message: "kept" },
        { line: 4, category: "punctuation" },
        "not-an-object",
      ],
    });
    const result = parseProofreadReply(reply, note);
    expect(result.parsed).toBe(true);
    expect(result.issues.map((i) => i.message)).toEqual(["kept"]);
    expect(result.outOfRange).toBe(1);
    expect(result.rejected).toBe(4);
  });

  it("accepts a numeric string line and clamps the column into the line", () => {
    const reply = JSON.stringify({
      issues: [{ line: "7", column: 999, category: "punctuation", message: "c" }],
    });
    const issue = parseProofreadReply(reply, note).issues[0];
    expect(issue.line).toBe(7);
    expect(issue.from).toBeLessThan(NOTE.length);
    expect(issue.column).toBe("正文,这里有半角逗号。".length);
  });

  it("prefers the note's own line text over a claimed quote", () => {
    const reply = JSON.stringify({
      issues: [{ line: 7, category: "punctuation", message: "m", quote: "这不是原文" }],
    });
    expect(parseProofreadReply(reply, note).issues[0].excerpt).toBe("正文,这里有半角逗号。");
  });

  it("reports non-structured replies as unparsed instead of empty-and-clean", () => {
    for (const reply of [
      "",
      "Looks fine to me!",
      '{"summary": "no issues key"}',
      '{"issues": "not an array"}',
      "```json\n{ broken json \n```",
    ]) {
      const result = parseProofreadReply(reply, note);
      expect(result.parsed, `should not parse: ${reply}`).toBe(false);
      expect(result.issues).toEqual([]);
    }
  });

  it("returns an empty but parsed result for a genuinely clean note", () => {
    const result = parseProofreadReply('{"summary":"干净","issues":[]}', note);
    expect(result.parsed).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.summary).toBe("干净");
  });
});
