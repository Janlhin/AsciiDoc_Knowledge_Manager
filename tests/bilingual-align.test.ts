/**
 * T-066: bilingual alignment engine. Positive cases pin the four machine-judgeable
 * checks (version, heading totals/distribution, section structure, line count);
 * negative cases prove odd input degrades to informative issues instead of
 * throwing or crying wolf. The engine is pure text-in / report-out — no DOM,
 * no IPC, no app singletons.
 */
import { describe, expect, it } from "vitest";
import {
  buildBilingualReport,
  comparePair,
  digestDocument,
  headingSimilarity,
  suffixLanguage,
  LINE_DEVIATION_RATIO,
  type DocInput,
} from "@core/bilingualAlign";

const doc = (path: string, content: string): DocInput => ({ path, content });

const ZH_ADOC = [
  ":revnumber: 1.2.3",
  ":lang: zh-CN",
  "",
  "= 指南",
  "",
  "== 简介",
  "",
  "这是第一段正文，用来撑出行数。",
  "",
  "== 第二章",
  "",
  "这是第二段正文。",
].join("\n");

const EN_ADOC = [
  ":revnumber: 1.2.3",
  ":lang: en",
  "",
  "= Guide",
  "",
  "== Intro",
  "",
  "First body paragraph to keep the line count close.",
  "",
  "== Chapter Two",
  "",
  "Second body paragraph.",
].join("\n");

function pair(notes: DocInput[]) {
  const report = buildBilingualReport(notes);
  expect(report.pairs.length).toBe(1);
  return report.pairs[0];
}

describe("T-066 pairing", () => {
  it("pairs foo.adoc with foo-en.adoc by filename suffix", () => {
    const report = buildBilingualReport([
      doc("guide.adoc", ZH_ADOC),
      doc("guide-en.adoc", EN_ADOC),
    ]);
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0].base.path).toBe("guide.adoc");
    expect(report.pairs[0].translation.path).toBe("guide-en.adoc");
    expect(report.unmatched).toEqual([]);
  });

  it("leaves a lone file unmatched and reports no pair", () => {
    const report = buildBilingualReport([doc("solo.md", "# Solo\n")]);
    expect(report.pairs).toHaveLength(0);
    expect(report.unmatched).toEqual(["solo.md"]);
  });

  it("does not treat a non-language suffix as a translation tag", () => {
    const report = buildBilingualReport([
      doc("report.adoc", "= R\n"),
      doc("report-final.adoc", "= R final\n"),
    ]);
    expect(report.pairs).toHaveLength(0);
  });

  it("normalizes a full-width hyphen suffix for matching (NFKC), keeps original paths", () => {
    const report = buildBilingualReport([
      doc("foo.adoc", ZH_ADOC),
      // full-width hyphen U+FF0D where a half-width '-' would sit
      doc("foo－en.adoc", EN_ADOC),
    ]);
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0].translation.path).toBe("foo－en.adoc");
  });

  it("does not pair the same stem across different folders", () => {
    const report = buildBilingualReport([
      doc("alpha/guide.adoc", ZH_ADOC),
      doc("beta/guide-en.adoc", EN_ADOC),
    ]);
    expect(report.pairs).toHaveLength(0);
  });

  it("pairs suffix files inside the same folder when paths carry directories", () => {
    const report = buildBilingualReport([
      doc("alpha/guide.adoc", ZH_ADOC),
      doc("alpha/guide-en.adoc", EN_ADOC),
    ]);
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0].base.path).toBe("alpha/guide.adoc");
    expect(report.pairs[0].translation.path).toBe("alpha/guide-en.adoc");
  });

  it("recognizes a full regional suffix instead of splitting at the first hyphen", () => {
    expect(suffixLanguage("guide-zh-cn")).toEqual({ baseStem: "guide", langTag: "zh-cn" });
    expect(suffixLanguage("foo-bar-en")).toEqual({ baseStem: "foo-bar", langTag: "en" });
  });

  it("pairs guide.adoc with guide-zh-cn.adoc", () => {
    const report = buildBilingualReport([
      doc("guide.adoc", ZH_ADOC),
      doc("guide-zh-cn.adoc", ZH_ADOC),
    ]);
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0].translation.path).toBe("guide-zh-cn.adoc");
  });

  it("pairs same-stem different-format files via explicit differing lang markers (auxiliary)", () => {
    const report = buildBilingualReport([
      doc("note.adoc", ":lang: zh-CN\n\n= 笔记\n"),
      doc("note.md", "---\nlang: en\n---\n\n# Note\n"),
    ]);
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0].auxiliary).toBe(true);
  });
});

describe("T-066 check 1 — version number", () => {
  it("matches equal AsciiDoc :revnumber: values", () => {
    const p = pair([doc("guide.adoc", ZH_ADOC), doc("guide-en.adoc", EN_ADOC)]);
    expect(p.version.status).toBe("match");
    expect(p.version.base).toBe("1.2.3");
    expect(p.version.translation).toBe("1.2.3");
  });

  it("flags a revnumber mismatch as a warning version issue", () => {
    const en = EN_ADOC.replace("1.2.3", "1.2.4");
    const p = pair([doc("guide.adoc", ZH_ADOC), doc("guide-en.adoc", en)]);
    expect(p.version.status).toBe("mismatch");
    const issues = p.issues.filter((i) => i.category === "version");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("degrades to unknown when either side lacks a revnumber, no throw", () => {
    const zh = ZH_ADOC.replace(":revnumber: 1.2.3\n", "");
    const p = pair([doc("guide.adoc", zh), doc("guide-en.adoc", EN_ADOC)]);
    expect(p.version.status).toBe("unknown");
    expect(p.issues.some((i) => i.category === "version" && i.severity === "info")).toBe(true);
  });

  it("reads Markdown frontmatter revnumber / version", () => {
    const zh = "---\nrevnumber: 2.0\nlang: zh\n---\n\n# 笔记\n";
    const en = "---\nversion: 2.0\nlang: en\n---\n\n# Note\n";
    const p = pair([doc("note.md", zh), doc("note-en.md", en)]);
    expect(p.version.status).toBe("match");
    expect(p.base.revSource).toBe("frontmatter");
    expect(p.translation.revSource).toBe("frontmatter");
  });
});

describe("T-066 check 2 — heading totals and level distribution", () => {
  it("reports a match on equal totals and distribution", () => {
    const p = pair([doc("guide.adoc", ZH_ADOC), doc("guide-en.adoc", EN_ADOC)]);
    expect(p.headingSummary.status).toBe("match");
    expect(p.headingSummary.totalBase).toBe(3);
    expect(p.headingSummary.totalTranslation).toBe(3);
    expect(p.headingSummary.distributionBase).toEqual({ 1: 1, 2: 2 });
  });

  it("flags a heading-count mismatch", () => {
    const en = EN_ADOC.replace(/== Chapter Two[\s\S]*/, "");
    const p = pair([doc("guide.adoc", ZH_ADOC), doc("guide-en.adoc", en)]);
    expect(p.headingSummary.status).toBe("mismatch");
    expect(p.issues.some((i) => i.category === "heading-count")).toBe(true);
  });

  it("flags a level-distribution mismatch even when totals match", () => {
    // base: H1 + H2 + H2 ; translation: H1 + H2 + H3
    const en = [
      ":revnumber: 1.2.3",
      ":lang: en",
      "",
      "= Guide",
      "",
      "== Intro",
      "",
      "=== Deep note",
    ].join("\n");
    const p = pair([doc("guide.adoc", ZH_ADOC), doc("guide-en.adoc", en)]);
    expect(p.headingSummary.totalBase).toBe(3);
    expect(p.headingSummary.totalTranslation).toBe(3);
    expect(p.issues.some((i) => i.category === "heading-distribution")).toBe(true);
  });
});

describe("T-066 check 3 — section structure alignment", () => {
  it("marks a section missing in the translation side", () => {
    const en = EN_ADOC.replace(/== Chapter Two[\s\S]*/, "");
    const p = pair([doc("guide.adoc", ZH_ADOC), doc("guide-en.adoc", en)]);
    const missingRight = p.structure.filter((r) => r.status === "missing-right");
    expect(missingRight).toHaveLength(1);
    expect(missingRight[0].left?.text).toBe("第二章");
    expect(missingRight[0].right).toBeNull();
    expect(p.issues.some((i) => i.category === "missing-section")).toBe(true);
  });

  it("marks an extra section on the translation side", () => {
    const en = EN_ADOC.replace("== Chapter Two", "== Chapter Two\n\n== Bonus");
    const p = pair([doc("guide.adoc", ZH_ADOC), doc("guide-en.adoc", en)]);
    const missingLeft = p.structure.filter((r) => r.status === "missing-left");
    expect(missingLeft).toHaveLength(1);
    expect(missingLeft[0].right?.text).toBe("Bonus");
    expect(p.issues.some((i) => i.category === "extra-section")).toBe(true);
  });

  it("attaches an auxiliary similarity ratio to matched rows, no equality requirement", () => {
    const p = pair([doc("guide.adoc", ZH_ADOC), doc("guide-en.adoc", EN_ADOC)]);
    const matched = p.structure.filter((r) => r.status === "matched");
    expect(matched.length).toBeGreaterThan(0);
    for (const row of matched) {
      expect(row.similarity).toBeGreaterThanOrEqual(0);
      expect(row.similarity).toBeLessThanOrEqual(1);
    }
  });
});

describe("T-066 check 4 — line count deviation", () => {
  it("reports match when both sides stay within the deviation ratio", () => {
    const p = pair([doc("guide.adoc", ZH_ADOC), doc("guide-en.adoc", EN_ADOC)]);
    expect(p.lines.status).toBe("match");
    expect(Math.abs(p.lines.ratio)).toBeLessThanOrEqual(LINE_DEVIATION_RATIO);
  });

  it("flags a large line-count deviation", () => {
    const shortEn = ":revnumber: 1.2.3\n:lang: en\n\n= Guide\n";
    const p = pair([doc("guide.adoc", ZH_ADOC), doc("guide-en.adoc", shortEn)]);
    expect(p.lines.status).toBe("deviation");
    expect(p.lines.translation).toBeLessThan(p.lines.base);
    expect(p.issues.some((i) => i.category === "line-deviation")).toBe(true);
  });
});

describe("T-066 negative / self-check", () => {
  it("does not throw on empty files and degrades to an info line issue", () => {
    const p = pair([doc("empty.adoc", ""), doc("empty-en.adoc", "")]);
    expect(p.base.lineCount).toBe(0);
    expect(p.translation.lineCount).toBe(0);
    expect(p.lines.status).toBe("deviation");
    expect(p.issues.some((i) => i.category === "line-deviation" && i.severity === "info")).toBe(true);
  });

  it("survives a disordered heading hierarchy without crashing", () => {
    const zh = "# 标题\n\n#### 突然四级\n\n## 回到二级\n";
    const en = "# Title\n\n#### Deep H4\n\n## Back to H2\n";
    const p = pair([doc("odd.md", zh), doc("odd-en.md", en)]);
    expect(p.structure.length).toBe(3);
    expect(p.structure.every((r) => r.left || r.right)).toBe(true);
  });

  it("handles ASCII / Chinese mixed headings and computes a similarity", () => {
    const zh = "# 引言 Introduction\n";
    const en = "# Introduction 引言\n";
    const p = pair([doc("mix.md", zh), doc("mix-en.md", en)]);
    expect(p.structure).toHaveLength(1);
    expect(p.structure[0].status).toBe("matched");
    expect(p.structure[0].similarity).toBeGreaterThan(0);
  });

  it("extracts lang and revnumber from the digest directly", () => {
    const adoc = digestDocument(doc("a.adoc", ":revnumber: 2.1.0\n:lang: de\n\n= X\n"));
    expect(adoc.lang).toBe("de");
    expect(adoc.revnumber).toBe("2.1.0");
    expect(adoc.revSource).toBe("attr");

    const md = digestDocument(doc("a.md", "---\nlang: fr\nversion: 0.9\n---\n\n# X\n"));
    expect(md.lang).toBe("fr");
    expect(md.revnumber).toBe("0.9");
    expect(md.revSource).toBe("frontmatter");
  });

  it("similarity is 1 for equal stripped headings and bounded otherwise", () => {
    expect(headingSimilarity("**Intro**", "Intro")).toBe(1);
    expect(headingSimilarity("完全不同的中文标题", "Entirely different English heading")).toBeGreaterThanOrEqual(0);
    expect(headingSimilarity("", "")).toBe(1);
  });

  it("suffixLanguage rejects ordinary hyphenated words", () => {
    expect(suffixLanguage("read-me")).toBeNull();
    expect(suffixLanguage("guide-en")).toEqual({ baseStem: "guide", langTag: "en" });
  });

  it("comparePair never throws on a digest with zero headings", () => {
    const a = digestDocument(doc("a.adoc", ""));
    const b = digestDocument(doc("a-en.adoc", "= Only title\n"));
    const report = comparePair(a, b, false);
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.structure.some((r) => r.status === "missing-left")).toBe(true);
  });
});
