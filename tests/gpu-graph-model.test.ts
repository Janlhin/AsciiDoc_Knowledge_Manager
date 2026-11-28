/**
 * T-063 (C): real-data adapter tests for the GPU graph model.
 * Pure (no DOM / WebGL): feeds hand-built GraphData through `buildGpuGraph`
 * and checks node/edge counts, broken/unresolved flags, filters, local BFS
 * depth, tag/attachment aux halves and index-order determinism.
 */
import { afterEach, describe, expect, it } from "vitest";
import { excludedRaw } from "@core/excludedFiles";
import type { GraphData } from "@core/types";
import { DEFAULT_PREFS, type GraphPrefs } from "@features/graph/graphPrefs";
import {
  buildGpuGraph,
  countsOf,
  fingerprintOf,
  isNoteNodeId,
} from "@features/graph/gpu/model";

function makePrefs(over: Partial<GraphPrefs> = {}): GraphPrefs {
  return {
    ...DEFAULT_PREFS,
    ...over,
    display: { ...DEFAULT_PREFS.display, ...(over.display ?? {}) },
    filters: { ...DEFAULT_PREFS.filters, ...(over.filters ?? {}) },
    groups: over.groups ?? [],
  };
}

const chainGraph: GraphData = {
  nodes: [
    { id: "notes/a.adoc", label: "a", resolved: true, degree: 1 },
    { id: "notes/b.adoc", label: "b", resolved: true, degree: 1 },
    { id: "notes/c.adoc", label: "c", resolved: true, degree: 1 },
    { id: "unresolved:ghost", label: "ghost", resolved: false, degree: 1 },
  ],
  edges: [
    { source: "notes/a.adoc", target: "notes/b.adoc" },
    { source: "notes/b.adoc", target: "notes/c.adoc" },
    { source: "notes/a.adoc", target: "unresolved:ghost", kind: "broken" },
  ],
};

afterEach(() => {
  excludedRaw.set("");
});

describe("gpu-graph model adapter", () => {
  it("keeps unresolved nodes and marks broken edges", () => {
    const graph = buildGpuGraph({ graph: chainGraph, prefs: makePrefs() });
    const counts = countsOf(graph);
    expect(counts.nodes).toBe(4);
    expect(counts.edges).toBe(3);
    expect(counts.broken).toBe(1);
    expect(counts.unresolved).toBe(1);
    const broken = graph.edges.find((e) => e.broken);
    expect(broken).toBeDefined();
    const ghost = graph.nodes.find((n) => !n.resolved);
    expect(ghost?.id).toBe("unresolved:ghost");
  });

  it("drops unresolved nodes under the existing-only filter", () => {
    const graph = buildGpuGraph({
      graph: chainGraph,
      prefs: makePrefs({ filters: { ...DEFAULT_PREFS.filters, existingOnly: true } }),
    });
    const counts = countsOf(graph);
    expect(counts.nodes).toBe(3);
    expect(counts.edges).toBe(2);
    expect(graph.nodes.some((n) => n.id === "unresolved:ghost")).toBe(false);
  });

  it("drops orphan (degree-0) nodes when orphans are hidden", () => {
    const withOrphan: GraphData = {
      nodes: [...chainGraph.nodes, { id: "notes/alone.adoc", label: "alone", resolved: true, degree: 0 }],
      edges: chainGraph.edges,
    };
    const graph = buildGpuGraph({
      graph: withOrphan,
      prefs: makePrefs({ filters: { ...DEFAULT_PREFS.filters, orphans: false } }),
    });
    expect(graph.nodes.some((n) => n.id === "notes/alone.adoc")).toBe(false);
  });

  it("local mode walks the BFS to the configured depth", () => {
    const chainOnly: GraphData = {
      nodes: [
        { id: "notes/a.adoc", label: "a", resolved: true, degree: 1 },
        { id: "notes/b.adoc", label: "b", resolved: true, degree: 1 },
        { id: "notes/c.adoc", label: "c", resolved: true, degree: 1 },
      ],
      edges: [
        { source: "notes/a.adoc", target: "notes/b.adoc" },
        { source: "notes/b.adoc", target: "notes/c.adoc" },
      ],
    };
    const depth1 = buildGpuGraph({
      graph: chainOnly,
      prefs: makePrefs({ mode: "local", depth: 1 }),
      anchorId: "notes/a.adoc",
    });
    expect(depth1.nodes.map((n) => n.id).sort()).toEqual(["notes/a.adoc", "notes/b.adoc"]);

    const depth2 = buildGpuGraph({
      graph: chainOnly,
      prefs: makePrefs({ mode: "local", depth: 2 }),
      anchorId: "notes/a.adoc",
    });
    expect(depth2.nodes.map((n) => n.id).sort()).toEqual([
      "notes/a.adoc",
      "notes/b.adoc",
      "notes/c.adoc",
    ]);
  });

  it("local mode with no anchor renders an empty graph", () => {
    const graph = buildGpuGraph({
      graph: chainGraph,
      prefs: makePrefs({ mode: "local" }),
      anchorId: null,
    });
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("merges tag and attachment aux halves when toggles are on", () => {
    const tagMap = new Map<string, Set<string>>([["foo", new Set(["notes/a.adoc"])]]);
    const attachmentMap = new Map<string, Set<string>>([
      ["assets/pic.png", new Set(["notes/b.adoc"])],
    ]);
    const graph = buildGpuGraph({
      graph: chainGraph,
      tagMap,
      attachmentMap,
      prefs: makePrefs({ display: { ...DEFAULT_PREFS.display, tags: true, attachments: true } }),
    });
    expect(graph.nodes.some((n) => n.id === "tag:foo")).toBe(true);
    expect(graph.nodes.some((n) => n.id === "attachment:assets/pic.png")).toBe(true);
    const tagEdge = graph.edges.find((e) =>
      graph.nodes[e.target]?.id === "tag:foo",
    );
    expect(tagEdge).toBeDefined();
  });

  it("excluded files and edges touching them are dropped", () => {
    excludedRaw.set("Archive/");
    const withHidden: GraphData = {
      nodes: [
        ...chainGraph.nodes,
        { id: "Archive/secret.adoc", label: "secret", resolved: true, degree: 1 },
      ],
      edges: [...chainGraph.edges, { source: "notes/a.adoc", target: "Archive/secret.adoc" }],
    };
    const graph = buildGpuGraph({ graph: withHidden, prefs: makePrefs() });
    expect(graph.nodes.some((n) => n.id === "Archive/secret.adoc")).toBe(false);
    expect(graph.edges.some((e) => e.source === "Archive/secret.adoc" || e.target === "Archive/secret.adoc")).toBe(false);
  });

  it("produces a stable index order for identical inputs", () => {
    const first = buildGpuGraph({ graph: chainGraph, prefs: makePrefs() });
    const second = buildGpuGraph({ graph: chainGraph, prefs: makePrefs() });
    expect(fingerprintOf(first)).toBe(fingerprintOf(second));
    expect(first.nodes.map((n) => n.id)).toEqual(second.nodes.map((n) => n.id));
    expect(first.nodes.map((n) => n.id)[0]).toBe("notes/a.adoc");
  });

  it("classifies openable note ids", () => {
    expect(isNoteNodeId("notes/a.adoc")).toBe(true);
    expect(isNoteNodeId("tag:foo")).toBe(false);
    expect(isNoteNodeId("attachment:assets/pic.png")).toBe(false);
    expect(isNoteNodeId("unresolved:ghost")).toBe(false);
  });
});
