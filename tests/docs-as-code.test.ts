/**
 * T-045 slice 1: pin the two Docs-as-Code reference rules.
 *
 * The point of these tests is the *semantics*, not the plumbing:
 *  - AsciiDoc resolves xref file-relative, not like a wikilink;
 *  - a plain target may fall back to vault-root (the app's click handler does),
 *    but an explicit `./` must not — otherwise a typo validates against a file
 *    the author did not mean;
 *  - Antora resource ids are answered with a unique basename or an honest
 *    "ambiguous", never a guess;
 *  - include chains must not loop.
 */
import { describe, expect, it } from "vitest";
import {
  buildDocIndex, findIncludeCycles, includeEdges, joinVaultPath,
  parseXref, resolveInclude, resolveXref,
} from "@core/docsAsCode";

const PATHS = [
  "index.adoc",
  "guide.adoc",
  "sub/chapter.adoc",
  "sub/partials/intro.adoc",
  "sub/partials/outro.adoc",
  "other/intro.adoc",
];
const index = buildDocIndex(PATHS);

describe("T-045 parseXref", () => {
  it("splits path and anchor", () => {
    expect(parseXref("b.adoc#sec")).toMatchObject({
      path: "b.adoc", anchor: "sec", anchorOnly: false, external: false,
    });
  });

  it("recognises pure anchors, resource ids and families", () => {
    expect(parseXref("#local").anchorOnly).toBe(true);
    expect(parseXref("component:module:page.adoc#x")).toMatchObject({
      component: "component", module: "module", path: "page.adoc", anchor: "x",
    });
    expect(parseXref("component::page.adoc")).toMatchObject({
      component: "component", path: "page.adoc",
    });
    expect(parseXref("component::page.adoc").module).toBeUndefined();
    expect(parseXref("partial$intro.adoc")).toMatchObject({
      family: "partial", path: "intro.adoc",
    });
  });

  it("keeps URLs out of vault resolution", () => {
    expect(parseXref("https://example.com/a").external).toBe(true);
    expect(parseXref("mailto:a@b").external).toBe(true);
    // `component:module:page` must not be mistaken for a URL scheme.
    expect(parseXref("component:module:page.adoc").external).toBe(false);
  });
});

describe("T-045 resolveXref", () => {
  it("resolves file-relative first", () => {
    expect(resolveXref("partials/intro.adoc", "sub/chapter.adoc", index)).toMatchObject({
      status: "resolved", path: "sub/partials/intro.adoc", via: "relative",
    });
  });

  it("falls back to vault root for a plain target (app click semantics)", () => {
    expect(resolveXref("guide.adoc", "sub/chapter.adoc", index)).toMatchObject({
      status: "resolved", path: "guide.adoc", via: "root",
    });
  });

  it("never falls back to the root for an explicitly relative target", () => {
    expect(resolveXref("./guide.adoc", "sub/chapter.adoc", index)).toMatchObject({
      status: "broken", failure: "missing",
    });
    expect(resolveXref("../guide.adoc", "sub/chapter.adoc", index)).toMatchObject({
      status: "resolved", path: "guide.adoc",
    });
  });

  it("treats a leading slash as vault root", () => {
    expect(resolveXref("/index.adoc", "sub/chapter.adoc", index)).toMatchObject({
      status: "resolved", path: "index.adoc", via: "root",
    });
  });

  it("appends a document extension when the target omits it", () => {
    expect(resolveXref("guide", "sub/chapter.adoc", index).path).toBe("guide.adoc");
  });

  it("resolves anchors and external URLs without touching the filesystem", () => {
    expect(resolveXref("#local", "guide.adoc", index).status).toBe("resolved");
    expect(resolveXref("https://example.com", "guide.adoc", index).status).toBe("resolved");
  });

  it("resolves a resource id by unique basename", () => {
    expect(resolveXref("cmp:mod:chapter.adoc", "guide.adoc", index)).toMatchObject({
      status: "resolved", path: "sub/chapter.adoc", via: "resource",
    });
  });

  it("reports an ambiguous resource id instead of guessing", () => {
    expect(resolveXref("cmp:mod:intro.adoc", "guide.adoc", index)).toMatchObject({
      status: "unresolved", failure: "ambiguous", candidates: 2,
    });
  });

  it("reports a missing target as broken", () => {
    expect(resolveXref("nope.adoc", "guide.adoc", index)).toMatchObject({
      status: "broken", failure: "missing",
    });
  });
});

describe("T-045 resolveInclude", () => {
  it("resolves relative to the including file", () => {
    expect(resolveInclude("partials/outro.adoc", "sub/chapter.adoc", index)).toMatchObject({
      status: "resolved", path: "sub/partials/outro.adoc",
    });
  });

  it("does not borrow the xref root fallback", () => {
    expect(resolveInclude("guide.adoc", "sub/chapter.adoc", index).status).toBe("broken");
  });

  it("honours a leading slash as vault root", () => {
    expect(resolveInclude("/index.adoc", "sub/chapter.adoc", index)).toMatchObject({
      status: "resolved", path: "index.adoc",
    });
  });

  it("treats a family target as a resource id", () => {
    expect(resolveInclude("partial$intro.adoc", "guide.adoc", index).status).toBe("unresolved");
    expect(resolveInclude("partial$outro.adoc", "guide.adoc", index)).toMatchObject({
      status: "resolved", path: "sub/partials/outro.adoc",
    });
  });
});

describe("T-045 joinVaultPath", () => {
  it("normalises . and .. and clamps above the root", () => {
    expect(joinVaultPath("sub", "../guide.adoc")).toBe("guide.adoc");
    expect(joinVaultPath("", "./a/./b.adoc")).toBe("a/b.adoc");
    expect(joinVaultPath("a", "../../x.adoc")).toBe("x.adoc");
  });
});

describe("T-045 include graph", () => {
  const links = (targets: string[]) =>
    targets.map((target, i) => ({
      target, from: i * 10, to: i * 10 + 5, kind: "markdown" as const, syntax: "include" as const,
    }));

  it("builds edges only for resolved targets", () => {
    const edges = includeEdges(
      [{ path: "sub/chapter.adoc", links: links(["partials/intro.adoc", "gone.adoc"]) }],
      index,
    );
    expect(edges).toEqual([
      { from: "sub/chapter.adoc", to: "sub/partials/intro.adoc", target: "partials/intro.adoc", at: 0 },
    ]);
  });

  it("finds a two-node cycle once, regardless of entry order", () => {
    const edges = [
      { from: "a.adoc", to: "b.adoc", target: "b.adoc", at: 5 },
      { from: "b.adoc", to: "a.adoc", target: "a.adoc", at: 7 },
      { from: "b.adoc", to: "a.adoc", target: "a.adoc", at: 9 },
    ];
    const cycles = findIncludeCycles(edges);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(["a.adoc", "b.adoc"]);
  });

  it("finds a three-node cycle and a self-include", () => {
    const cycles = findIncludeCycles([
      { from: "a.adoc", to: "b.adoc", target: "b.adoc", at: 1 },
      { from: "b.adoc", to: "c.adoc", target: "c.adoc", at: 2 },
      { from: "c.adoc", to: "a.adoc", target: "a.adoc", at: 3 },
      { from: "d.adoc", to: "d.adoc", target: "d.adoc", at: 4 },
    ]);
    expect(cycles).toContainEqual(["a.adoc", "b.adoc", "c.adoc"]);
    expect(cycles).toContainEqual(["d.adoc"]);
  });

  it("returns nothing for an acyclic chain", () => {
    expect(findIncludeCycles([
      { from: "a.adoc", to: "b.adoc", target: "b.adoc", at: 1 },
      { from: "b.adoc", to: "c.adoc", target: "c.adoc", at: 2 },
    ])).toEqual([]);
  });
});
