/**
 * T-045 slice 2: Antora descriptors, component/version lookup and the audit
 * integration. The point of these tests is that a version is never guessed:
 * omitted versions resolve to the *current* component version, otherwise the
 * answer is an honest `unresolved`.
 */
import { describe, expect, it } from "vitest";
import {
  buildAntoraIndex, parseAntoraYml, type AntoraComponent, type AntoraIndex,
} from "@core/antora";
import { buildDocIndex, parseXref, resolveInclude, resolveXref } from "@core/docsAsCode";
import { auditVault } from "@core/docAudit";
import { parseDocument } from "@core/metadata";

const DESCRIPTORS: AntoraComponent[] = [
  parseAntoraYml("name: catalog\nversion: '2.0'\ntitle: Catalog\n", "docs/catalog/2.0/antora.yml")!,
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

function build(): AntoraIndex {
  return buildAntoraIndex(DESCRIPTORS, PATHS);
}
const index = buildDocIndex(PATHS);
const antora = build();
const CURRENT = "docs/catalog/2.1/modules/ROOT/pages/index.adoc";

describe("T-045 slice 2 — parseAntoraYml", () => {
  it("reads name/version and derives the component root", () => {
    expect(DESCRIPTORS[0]).toEqual({
      descriptorPath: "docs/catalog/2.0/antora.yml",
      root: "docs/catalog/2.0",
      name: "catalog",
      version: "2.0",
    });
  });

  it("treats a missing version as an unversioned component", () => {
    expect(DESCRIPTORS[2]).toMatchObject({ name: "admin", version: "" });
  });

  it("coerces a numeric version to text rather than dropping it", () => {
    expect(parseAntoraYml("name: catalog\nversion: 2\n", "root/antora.yml"))
      .toMatchObject({ name: "catalog", version: "2", root: "root" });
  });

  it("rejects descriptors without a name and malformed YAML", () => {
    expect(parseAntoraYml("title: no name\n", "root/antora.yml")).toBeNull();
    expect(parseAntoraYml("name: [\n", "root/antora.yml")).toBeNull();
    expect(parseAntoraYml("just a string", "root/antora.yml")).toBeNull();
  });
});

describe("T-045 slice 2 — buildAntoraIndex", () => {
  it("indexes both versions of a component and keeps module/family ownership", () => {
    expect(antora.byName.get("catalog")).toHaveLength(2);
    expect(antora.owner.get("docs/catalog/2.1/modules/admin/pages/settings.adoc"))
      .toMatchObject({ module: "admin", family: "page" });
    expect(antora.owner.get("docs/catalog/2.0/modules/ROOT/partials/intro.adoc"))
      .toMatchObject({ module: "ROOT", family: "partial" });
    expect(antora.owner.get("notes/loose.adoc")).toBeUndefined();
  });

  it("maps a descriptor at the vault root and lets the longest root win", () => {
    const nested = buildAntoraIndex(
      [
        { descriptorPath: "antora.yml", root: "", name: "outer", version: "1" },
        { descriptorPath: "sub/antora.yml", root: "sub", name: "inner", version: "1" },
      ],
      ["antora.yml", "sub/antora.yml", "sub/modules/ROOT/pages/index.adoc"],
    );
    expect(nested.owner.get("sub/modules/ROOT/pages/index.adoc")?.component.name).toBe("inner");
  });
});

describe("T-045 slice 2 — resource ids", () => {
  it("splits version@ out of the target", () => {
    expect(parseXref("2.0@catalog:ROOT:partial$intro.adoc#top")).toMatchObject({
      version: "2.0", component: "catalog", module: "ROOT",
      family: "partial", path: "intro.adoc", anchor: "top",
    });
  });

  it("resolves an explicitly version-qualified id across versions", () => {
    expect(resolveXref("2.0@catalog:ROOT:index.adoc", CURRENT, index, antora)).toMatchObject({
      status: "resolved", path: "docs/catalog/2.0/modules/ROOT/pages/index.adoc", via: "antora",
    });
  });

  it("uses the current component version when the id omits it", () => {
    expect(resolveXref("catalog:ROOT:index.adoc", CURRENT, index, antora)).toMatchObject({
      status: "resolved", path: "docs/catalog/2.1/modules/ROOT/pages/index.adoc", via: "antora",
    });
  });

  it("refuses to guess among versions for a file outside every component", () => {
    expect(resolveXref("catalog:ROOT:index.adoc", "notes/loose.adoc", index, antora)).toMatchObject({
      status: "unresolved", failure: "ambiguous", candidates: 2, reason: "versions",
    });
  });

  it("honours family$, module and extension-less paths", () => {
    expect(resolveXref("2.0@catalog:ROOT:partial$intro", CURRENT, index, antora)).toMatchObject({
      status: "resolved", path: "docs/catalog/2.0/modules/ROOT/partials/intro.adoc",
    });
    expect(resolveXref("2.1@catalog:admin:settings.adoc", CURRENT, index, antora)).toMatchObject({
      status: "resolved", path: "docs/catalog/2.1/modules/admin/pages/settings.adoc",
    });
  });

  it("accepts the bare `ROOT:page.adoc` module form and a single-version component", () => {
    expect(resolveXref("ROOT:index.adoc", CURRENT, index, antora)).toMatchObject({
      status: "resolved", path: "docs/catalog/2.1/modules/ROOT/pages/index.adoc",
    });
    expect(resolveXref("admin:ROOT:index.adoc", CURRENT, index, antora)).toMatchObject({
      status: "resolved", path: "docs/admin/modules/ROOT/pages/index.adoc",
    });
  });

  it("reports unknown components / versions as broken, not as a basename guess", () => {
    expect(resolveXref("nope:ROOT:index.adoc", CURRENT, index, antora)).toMatchObject({
      status: "broken", failure: "missing",
    });
    expect(resolveXref("9.9@catalog:ROOT:index.adoc", CURRENT, index, antora)).toMatchObject({
      status: "broken", failure: "missing",
    });
  });

  it("leaves plain path targets on the slice-1 file-relative semantics", () => {
    expect(resolveXref("index.adoc", CURRENT, index, antora)).toMatchObject({
      status: "resolved", via: "relative", path: CURRENT,
    });
  });

  it("keeps the unique-basename fallback when no descriptor index is supplied", () => {
    const plain = buildDocIndex(["partials/intro.adoc"]);
    expect(resolveXref("partial$intro.adoc", "guide.adoc", plain)).toMatchObject({
      status: "resolved", path: "partials/intro.adoc", via: "resource",
    });
    const multiple = buildDocIndex(["a/intro.adoc", "b/intro.adoc"]);
    expect(resolveXref("partial$intro.adoc", "guide.adoc", multiple)).toMatchObject({
      status: "unresolved", reason: "files", candidates: 2,
    });
  });

  it("resolves family-qualified includes through the same index", () => {
    expect(resolveInclude("partial$intro.adoc", CURRENT, index, antora)).toMatchObject({
      status: "resolved", path: "docs/catalog/2.1/modules/ROOT/partials/intro.adoc", via: "antora",
    });
  });
});

describe("T-045 slice 2 — audit integration", () => {
  function note(path: string, body: string) {
    return { path, content: body, meta: parseDocument(path, body) };
  }

  it("treats an authoritative descriptor index as the source of truth", () => {
    const report = auditVault(
      [note(CURRENT, "= Index\n\nxref:2.0@catalog:ROOT:missing.adoc[]\n")],
      { resolveLink: () => null, antora },
    );
    const xref = report.issues.filter((i) => i.category === "broken-xref");
    expect(xref).toHaveLength(1);
    expect(xref[0].severity).toBe("error");
  });

  it("names versions (not files) in the ambiguity warning", () => {
    const report = auditVault(
      [note("notes/loose.adoc", "= Loose\n\nxref:catalog:ROOT:index.adoc[]\n")],
      { resolveLink: () => null, antora },
    );
    const xref = report.issues.filter((i) => i.category === "broken-xref");
    expect(xref).toHaveLength(1);
    expect(xref[0].severity).toBe("warning");
    expect(xref[0].message).toContain("2 个组件版本");
  });

  it("valid xrefs stay silent", () => {
    const report = auditVault(
      [note(CURRENT, "= Index\n\nxref:2.1@catalog:ROOT:index.adoc[]\n")],
      { resolveLink: () => null, antora },
    );
    expect(report.issues.filter((i) => i.category === "broken-xref")).toEqual([]);
  });
});
