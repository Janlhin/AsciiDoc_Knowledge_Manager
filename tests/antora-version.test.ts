/**
 * T-045 slice 3: pinning a component version for publishing / review.
 *
 * The contract: with a pin, version-less resource ids resolve against the
 * SELECTED version instead of the version of the file they sit in. An explicit
 * `version@…` id still wins. Plain path targets keep slice-1 semantics.
 */
import { describe, expect, it } from "vitest";
import {
  buildAntoraIndex, listComponentVersions, parseAntoraYml,
  withActiveVersion, type AntoraComponent,
} from "@core/antora";
import { buildDocIndex, resolveXref } from "@core/docsAsCode";
import { auditVault } from "@core/docAudit";
import { parseDocument } from "@core/metadata";

const DESCRIPTORS: AntoraComponent[] = [
  parseAntoraYml("name: catalog\nversion: '2.0'\n", "docs/catalog/2.0/antora.yml")!,
  parseAntoraYml("name: catalog\nversion: '2.1'\n", "docs/catalog/2.1/antora.yml")!,
  parseAntoraYml("name: admin\n", "docs/admin/antora.yml")!,
];

const PATHS = [
  "docs/catalog/2.0/antora.yml",
  "docs/catalog/2.0/modules/ROOT/pages/index.adoc",
  "docs/catalog/2.0/modules/ROOT/pages/guide.adoc",
  "docs/catalog/2.0/modules/ROOT/partials/intro.adoc",
  "docs/catalog/2.1/antora.yml",
  "docs/catalog/2.1/modules/ROOT/pages/index.adoc",
  "docs/catalog/2.1/modules/ROOT/partials/intro.adoc",
  "docs/catalog/2.1/modules/admin/pages/settings.adoc",
  "docs/admin/antora.yml",
  "docs/admin/modules/ROOT/pages/index.adoc",
  "notes/loose.adoc",
];

const index = buildAntoraIndex(DESCRIPTORS, PATHS);
const docIndex = buildDocIndex(PATHS);
const OUTSIDE = "notes/loose.adoc";

describe("listComponentVersions", () => {
  it("lists each component version with its module file count", () => {
    const versions = listComponentVersions(index);
    expect(versions.map((v) => `${v.component}@${v.version}:${v.files}`)).toEqual([
      "admin@:1", "catalog@2.0:3", "catalog@2.1:3",
    ]);
  });

  it("returns an empty list for a vault without descriptors", () => {
    expect(listComponentVersions(buildAntoraIndex([], PATHS))).toEqual([]);
  });
});

describe("withActiveVersion", () => {
  it("ignores unknown pairs instead of inventing a component", () => {
    expect(withActiveVersion(index, "nope", "9.9")).toBe(index);
  });

  it("pins a version-less id to the selected version", () => {
    const pinned20 = withActiveVersion(index, "catalog", "2.0");
    expect(resolveXref("catalog:ROOT:index.adoc", OUTSIDE, docIndex, pinned20)).toMatchObject({
      status: "resolved", path: "docs/catalog/2.0/modules/ROOT/pages/index.adoc", via: "antora",
    });
    const pinned21 = withActiveVersion(index, "catalog", "2.1");
    expect(resolveXref("catalog:ROOT:index.adoc", OUTSIDE, docIndex, pinned21)).toMatchObject({
      status: "resolved", path: "docs/catalog/2.1/modules/ROOT/pages/index.adoc", via: "antora",
    });
  });

  it("without a pin, the outside file still reports an honest ambiguity", () => {
    expect(resolveXref("catalog:ROOT:index.adoc", OUTSIDE, docIndex, index)).toMatchObject({
      status: "unresolved", candidates: 2, reason: "versions",
    });
  });

  it("an explicitly version-qualified id is NOT overridden by the pin", () => {
    const pinned20 = withActiveVersion(index, "catalog", "2.0");
    expect(resolveXref("2.1@catalog:ROOT:index.adoc", OUTSIDE, docIndex, pinned20)).toMatchObject({
      status: "resolved", path: "docs/catalog/2.1/modules/ROOT/pages/index.adoc",
    });
  });

  it("pins a family-only id that omits the component", () => {
    const pinned20 = withActiveVersion(index, "catalog", "2.0");
    expect(resolveXref("partial$intro.adoc", OUTSIDE, docIndex, pinned20)).toMatchObject({
      status: "resolved", path: "docs/catalog/2.0/modules/ROOT/partials/intro.adoc", via: "antora",
    });
    const pinned21 = withActiveVersion(index, "catalog", "2.1");
    expect(resolveXref("partial$intro.adoc", OUTSIDE, docIndex, pinned21)).toMatchObject({
      status: "resolved", path: "docs/catalog/2.1/modules/ROOT/partials/intro.adoc", via: "antora",
    });
  });

  it("keeps the bare `ROOT:page.adoc` module form under a pin", () => {
    const pinned21 = withActiveVersion(index, "catalog", "2.1");
    expect(resolveXref("ROOT:index.adoc", OUTSIDE, docIndex, pinned21)).toMatchObject({
      status: "resolved", path: "docs/catalog/2.1/modules/ROOT/pages/index.adoc",
    });
  });

  it("plain path targets are untouched by the pin", () => {
    const pinned20 = withActiveVersion(index, "catalog", "2.0");
    expect(resolveXref("index.adoc", "notes/loose.adoc", docIndex, pinned20)).toMatchObject({
      status: "broken", failure: "missing",
    });
  });

  it("the audit engine consumes the pin through AuditEnv.antora", () => {
    const note = {
      path: OUTSIDE,
      content: "= Loose\n\nxref:catalog:ROOT:index.adoc[]\n",
      meta: parseDocument(OUTSIDE, "= Loose\n\nxref:catalog:ROOT:index.adoc[]\n"),
    };
    const ambiguous = auditVault([note], { resolveLink: () => null, antora: index });
    expect(ambiguous.issues.filter((i) => i.category === "broken-xref")).toHaveLength(1);

    const pinned = withActiveVersion(index, "catalog", "2.0");
    const resolved = auditVault([note], { resolveLink: () => null, antora: pinned });
    expect(resolved.issues.filter((i) => i.category === "broken-xref")).toEqual([]);
  });
});
