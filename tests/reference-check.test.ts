// @vitest-environment jsdom
/**
 * T-070: three-state reference check (charter §5.1, D-14 A / D-15 A / D-19 B /
 * D-20 B). Pins the contract:
 *
 *  - resolved / broken / unresolved classification, per the charter §5.1 conditions;
 *  - undefined attribute and include escape-root resolve to `unresolved`;
 *  - an existing file reached through `file.adoc#missing-anchor` stays `resolved`
 *    (D-20 B: anchor existence is NOT judged this round);
 *  - md / adoc / txt cross-format resolution; txt bodies never emit references;
 *  - one record per source location (same offsets reached twice are deduped);
 *  - `sourceLine` recorded at parse time (frontmatter + multi-line scenarios);
 *  - GraphEdge carries `kind: "broken"` only on edges to ghost targets;
 *  - negative: empty file, malformed syntax, unknown extension must not throw.
 *
 * The classifier and report builder are TS pure functions; the MetadataIndex
 * graph test only stubs the vault + events, no Tauri I/O.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { EventBus } from "@core/events";
import { Vault } from "@core/vault";
import { isIndexable } from "@core/parsers/indexable";
import { MetadataIndex, parseDocument, parseNote } from "@core/metadata";
import {
  buildReferenceReport,
  type ReferenceReport,
  type ReferenceReportNote,
} from "@core/referenceReport";
import { runReferenceCheck } from "@core/referenceReportRunner";
import { Store } from "@core/store";
import {
  classifyReferenceStatus,
  hasUnresolvedAttribute,
  includeEscapesVaultRoot,
} from "@core/referenceStatus";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function installTauriFlag(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.__TAURI_INTERNALS__ = {};
}

async function makeVault(files: Record<string, string>): Promise<{
  vault: Vault;
  metadata: MetadataIndex;
}> {
  const events = new EventBus();
  const nodes = Object.entries(files).map(([path, content]) => {
    const name = path.split("/").pop() ?? path;
    const dot = name.lastIndexOf(".");
    return {
      kind: "file" as const,
      path,
      name,
      basename: dot > 0 ? name.slice(0, dot) : name,
      extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : "",
      size: content.length,
      mtime: 1,
    };
  });
  const vault = {
    getFiles: () => nodes,
    getIndexableFiles: () => nodes.filter((n) => isIndexable(n.path)),
    read: async (p: string) => files[p] ?? "",
    getVaultPath: () => "C:\\FakeVault",
    fileExists: (p: string) => p in files,
  };
  const metadata = new MetadataIndex(vault as unknown as Vault, events);
  await metadata.rebuildAll();
  return { vault: vault as unknown as Vault, metadata };
}

function notesOf(files: Record<string, string>): ReferenceReportNote[] {
  return Object.entries(files).map(([path, content]) => ({
    path,
    content,
    meta: parseDocument(path, content),
  }));
}

function entriesOf(report: ReferenceReport) {
  return report.entries.map((e) => ({
    path: e.path,
    target: e.target,
    status: e.status,
    reason: e.reason,
    sourceLine: e.sourceLine,
    syntax: e.syntax,
  }));
}

const VAULT: Record<string, string> = {
  "existing.md": "# Existing\n",
  "existing-2.md": "# E2\n",
  "partial.adoc": "= Partial\n",
  "note.txt": "plain text body\n",
  "src.md": [
    "# Source",
    "",
    "[[Existing]]",
    "[[Missing]]",
    "[Existing](existing.md)",
    "[Ghost](ghost.md)",
    "[Plain text](note.txt)",
    "",
    "---",
    "title: front matter does not count as a link line",
    "---",
    "",
    "[[Existing]]",
  ].join("\n"),
  "doc.adoc": [
    "= Doc",
    "",
    "xref:existing.md[See]",
    "xref:ghost.adoc[No]",
    "xref:{undefined-attr}[No]",
    "xref:existing.md#missing-anchor[Anchor]",
    "link:existing.md[Go]",
    "include::partial.adoc[]",
    "include::ghost-partial.adoc[]",
    "include::../../escape.adoc[]",
  ].join("\n"),
};

beforeEach(() => {
  installTauriFlag();
  invoke.mockReset();
  invoke.mockImplementation(async () => []);
});

describe("T-070 classifier — pure three-state mapping", () => {
  it("resolves when a path resolves to an existing file", () => {
    expect(classifyReferenceStatus({ target: "existing.md", resolvedPath: "existing.md" })).toEqual({
      status: "resolved",
      reason: "missing",
    });
  });

  it("breaks when the resolver returns null for a plain path target", () => {
    expect(classifyReferenceStatus({ target: "ghost.md", resolvedPath: null }).status).toBe("broken");
  });

  it("marks an unresolved attribute as unresolved, not broken", () => {
    const r = classifyReferenceStatus({ target: "{undefined-attr}", resolvedPath: null });
    expect(r.status).toBe("unresolved");
    expect(r.reason).toBe("attribute");
  });

  it("honours the docsAsCode resolution status directly", () => {
    const resolved = classifyReferenceStatus({
      target: "x",
      resolvedPath: null,
      docResolution: { status: "resolved", path: "existing.md" },
    });
    expect(resolved.status).toBe("resolved");

    const broken = classifyReferenceStatus({
      target: "x",
      resolvedPath: null,
      docResolution: { status: "broken", failure: "missing", path: null },
    });
    expect(broken.status).toBe("broken");

    const unresolved = classifyReferenceStatus({
      target: "x",
      resolvedPath: null,
      docResolution: { status: "unresolved", failure: "ambiguous", path: null, candidates: ["a", "b"] },
    });
    expect(unresolved.status).toBe("unresolved");
    expect(unresolved.reason).toBe("ambiguous");
  });

  it("detects a still-unsubstituted {attribute} placeholder", () => {
    expect(hasUnresolvedAttribute("xref:{spec}-ad")).toBe(true);
    expect(hasUnresolvedAttribute("plain.adoc")).toBe(false);
  });

  it("detects an include path escaping the vault root", () => {
    expect(includeEscapesVaultRoot("docs/page.adoc", "../../outside.adoc")).toBe(true);
    expect(includeEscapesVaultRoot("docs/page.adoc", "../other.adoc")).toBe(false);
    expect(includeEscapesVaultRoot("docs/page.adoc", "/absolute/root.adoc")).toBe(false);
  });
});

describe("T-070 report engine — three states end to end", () => {
  it("resolves md wikilinks and markdown links to existing files", async () => {
    const { metadata } = await makeVault(VAULT);
    const report = buildReferenceReport(notesOf(VAULT), {
      resolveByKind: (link, p) => metadata.resolveByKind(link, p),
      files: Object.keys(VAULT),
    });
    const byTarget = entriesOf(report).filter((e) => e.path === "src.md");
    const resolved = byTarget.filter((e) => e.status === "resolved").map((e) => e.target);
    expect(resolved).toEqual(expect.arrayContaining(["Existing", "existing.md", "note.txt"]));
  });

  it("marks a missing md target as broken", async () => {
    const { metadata } = await makeVault(VAULT);
    const report = buildReferenceReport(notesOf(VAULT), {
      resolveByKind: (link, p) => metadata.resolveByKind(link, p),
      files: Object.keys(VAULT),
    });
    const missing = report.entries.find((e) => e.target === "Missing");
    expect(missing?.status).toBe("broken");
    const ghost = report.entries.find((e) => e.target === "ghost.md");
    expect(ghost?.status).toBe("broken");
  });

  it("resolves existing adoc xref / link / include targets", async () => {
    const { metadata } = await makeVault(VAULT);
    const report = buildReferenceReport(notesOf(VAULT), {
      resolveByKind: (link, p) => metadata.resolveByKind(link, p),
      files: Object.keys(VAULT),
    });
    const doc = report.entries.filter((e) => e.path === "doc.adoc");
    expect(doc.find((e) => e.target === "existing.md" && e.syntax === "xref")?.status).toBe("resolved");
    expect(doc.find((e) => e.target === "existing.md" && e.syntax === "link-macro")?.status).toBe("resolved");
    expect(doc.find((e) => e.target === "partial.adoc" && e.syntax === "include")?.status).toBe("resolved");
  });

  it("marks a missing adoc xref and include target as broken", async () => {
    const { metadata } = await makeVault(VAULT);
    const report = buildReferenceReport(notesOf(VAULT), {
      resolveByKind: (link, p) => metadata.resolveByKind(link, p),
      files: Object.keys(VAULT),
    });
    expect(report.entries.find((e) => e.target === "ghost.adoc")?.status).toBe("broken");
    expect(report.entries.find((e) => e.target === "ghost-partial.adoc")?.status).toBe("broken");
  });

  it("classifies an undefined-attribute xref as unresolved", async () => {
    const { metadata } = await makeVault(VAULT);
    const report = buildReferenceReport(notesOf(VAULT), {
      resolveByKind: (link, p) => metadata.resolveByKind(link, p),
      files: Object.keys(VAULT),
    });
    const attr = report.entries.find((e) => e.target === "{undefined-attr}");
    expect(attr?.status).toBe("unresolved");
    expect(attr?.reason).toBe("attribute");
  });

  it("classifies an include escaping the root as unresolved", async () => {
    const { metadata } = await makeVault(VAULT);
    const report = buildReferenceReport(notesOf(VAULT), {
      resolveByKind: (link, p) => metadata.resolveByKind(link, p),
      files: Object.keys(VAULT),
    });
    const escape = report.entries.find((e) => e.target === "../../escape.adoc");
    expect(escape?.status).toBe("unresolved");
    expect(escape?.reason).toBe("rejected");
  });

  it("D-20 B regression: a missing anchor on an existing file still resolves", async () => {
    const { metadata } = await makeVault(VAULT);
    const report = buildReferenceReport(notesOf(VAULT), {
      resolveByKind: (link, p) => metadata.resolveByKind(link, p),
      files: Object.keys(VAULT),
    });
    const anchor = report.entries.find((e) => e.target === "existing.md#missing-anchor");
    expect(anchor?.status).toBe("resolved");
  });

  it("records the parse-time source line, including past frontmatter", async () => {
    const { metadata } = await makeVault(VAULT);
    const report = buildReferenceReport(notesOf(VAULT), {
      resolveByKind: (link, p) => metadata.resolveByKind(link, p),
      files: Object.keys(VAULT),
    });
    const lines = report.entries.filter((e) => e.path === "src.md").map((e) => e.sourceLine);
    // Links are on physical lines 3, 4, 5, 6, 7 and 13 (frontmatter above line 11
    // must not shift the offset-derived line number).
    expect(lines).toEqual(expect.arrayContaining([3, 4, 5, 6, 7, 13]));
  });

  it("keeps one record per source location even if two parse paths add it twice", async () => {
    const content = "[[Existing]]\n";
    const meta = parseNote("dup.md", content);
    // Same offsets added a second time through a second parse path — must dedupe.
    const dup = { ...meta, links: [...meta.links, ...meta.links] };
    const report = buildReferenceReport(
      [{ path: "dup.md", content, meta: dup }],
      { resolveByKind: () => "existing.md", files: ["existing.md"] },
    );
    expect(report.entries.filter((e) => e.path === "dup.md")).toHaveLength(1);
  });

  it("txt bodies never emit outgoing references", () => {
    const meta = parseDocument("note.txt", "plain [[Existing]] text\n");
    expect(meta.links).toEqual([]);
  });

  it("negative: empty file, malformed syntax and unknown extension do not throw", () => {
    const notes: ReferenceReportNote[] = [
      { path: "empty.md", content: "", meta: parseDocument("empty.md", "") },
      { path: "junk.md", content: "[[[\n]]unterpared\nbroken](", meta: parseDocument("junk.md", "[[[\n]]unterpared\nbroken](") },
      { path: "binary.bin", content: "binary\x00blob", meta: parseDocument("binary.bin", "binary\x00blob") },
    ];
    expect(() =>
      buildReferenceReport(notes, { resolveByKind: () => null, files: [] }),
    ).not.toThrow();
  });
});

describe("T-070 graph edges — kind only on broken edges", () => {
  it("tags edges to ghost targets broken and leaves resolved edges plain", async () => {
    const files = {
      "a.md": "[[B]] [[Missing]]\n",
      "b.md": "# B\n",
    };
    const { metadata } = await makeVault(files);
    const graph = metadata.getGraph();
    const aToB = graph.edges.find((e) => e.source === "a.md" && e.target === "b.md");
    const ghost = graph.edges.find((e) => e.target.startsWith("unresolved:"));
    expect(aToB?.kind).toBeUndefined();
    expect(ghost?.kind).toBe("broken");
  });
});

describe("T-070 runner — attachments stay resolvable", () => {
  it("resolves an adoc link to an existing attachment", async () => {
    const { vault, metadata } = await makeVault({
      "docs/guide.adoc": "= Guide\n\nlink:manual.pdf[Manual]\n",
      "manual.pdf": "%PDF-1.4",
    });
    const workspace = { referenceReport: new Store<ReferenceReport | null>(null) };
    const report = await runReferenceCheck({ vault, metadata, workspace });
    const entry = report.entries.find(
      (e) => e.path === "docs/guide.adoc" && e.target === "manual.pdf",
    );
    expect(entry?.status).toBe("resolved");
  });
});
