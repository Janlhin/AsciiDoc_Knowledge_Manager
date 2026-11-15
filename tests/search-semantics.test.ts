/**
 * T-041: pin the boundary between the two co-existing search semantics.
 *
 * The substring evaluator matches mid-word text ("nership" in "ownership");
 * the FTS5 index cannot (pinned in Rust `index_tokenization_is_prefix_only`).
 * These tests exist so a future refactor cannot silently replace the substring
 * path with the index path and drop results without anyone noticing.
 */
import { describe, expect, it } from "vitest";
import { evaluateSearch, parseSearchQuery } from "@core/search";
import type { SearchInput } from "@core/search";

function input(content: string): SearchInput {
  return {
    path: "a.md",
    fileName: "a.md",
    basename: "a",
    content,
    tags: [],
  };
}

function matches(query: string, content: string): boolean {
  const parsed = parseSearchQuery(query);
  expect(parsed.error).toBeNull();
  expect(parsed.expr).not.toBeNull();
  return evaluateSearch(parsed.expr!, input(content)).matched;
}

describe("substring search semantics (must NOT be replaced by FTS)", () => {
  it("matches a mid-word substring", () => {
    expect(matches("nership", "the ownership model")).toBe(true);
    expect(matches("ownership", "the ownership model")).toBe(true);
  });

  it("matches across word boundaries and punctuation", () => {
    expect(matches("标准研磨", "本库遵循《标准研磨日志》规范")).toBe(true);
    expect(matches("doc-1", "see doc-1.md for details")).toBe(true);
  });

  it("is case-insensitive by default", () => {
    expect(matches("RUST", "rust ownership")).toBe(true);
  });

  it("parses query operators (the index mode does not parse operators at all)", () => {
    const parsed = parseSearchQuery("tag:spec");
    expect(parsed.error).toBeNull();
    expect(parsed.expr).not.toBeNull();
  });
});

describe("operator support", () => {
  it("tag: evaluates against metadata tags", () => {
    const parsed = parseSearchQuery("tag:spec");
    expect(parsed.error).toBeNull();
    expect(
      evaluateSearch(parsed.expr!, { ...input("plain body"), tags: ["spec"] }).matched,
    ).toBe(true);
    expect(
      evaluateSearch(parsed.expr!, { ...input("plain body"), tags: ["other"] }).matched,
    ).toBe(false);
  });
});
