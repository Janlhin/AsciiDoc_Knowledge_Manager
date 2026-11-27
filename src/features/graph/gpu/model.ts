/**
 * T-063 (C): real-data adapter from the app's `GraphData` into the GPU graph model.
 *
 * Pipeline mirrors the Canvas2D `GraphView` rebuild (exclude → tag/attachment aux
 * → filters → local BFS → neighbour-link pruning) so the GPU view shows the same
 * node/edge set. Pure: no DOM, no WebGL, deterministic for a given input.
 */
import { isExcluded } from "@core/excludedFiles";
import type { GraphData, GraphNode } from "@core/types";
import {
  applyGraphFilters,
  ATTACHMENT_PREFIX,
  buildAttachmentGraph,
  buildTagGraph,
  localEdges,
  localSubgraph,
  nodeGroupColor,
  TAG_PREFIX,
  type GraphPrefs,
} from "../graphPrefs";
import type { GpuEdge, GpuGraph, GpuNode } from "./types";

/** Inputs the view hands to the adapter; maps are optional (test fixtures omit them). */
export interface GpuGraphInput {
  /** raw metadata graph (`app.metadata.getGraph()`) */
  graph: GraphData;
  /** tag → note paths (`app.metadata.getTagMap()`) */
  tagMap?: Map<string, Set<string>>;
  /** attachment path → note paths (`app.metadata.getAttachmentMap()`) */
  attachmentMap?: Map<string, Set<string>>;
  /** persisted graph prefs (mode/depth/filters/display/groups) */
  prefs: GraphPrefs;
  /** local-mode anchor id; ignored in global mode */
  anchorId: string | null;
}

export interface GpuCounts {
  nodes: number;
  edges: number;
  broken: number;
  unresolved: number;
}

function baseName(id: string): string {
  const slash = id.lastIndexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id;
}

function labelOf(node: GraphNode): string {
  return node.label.trim().length > 0 ? node.label : baseName(node.id);
}

/**
 * True when the id names a plain vault note (openable via `openFile`). Tag /
 * attachment / unresolved ids are not files and must never open a phantom tab.
 */
export function isNoteNodeId(id: string): boolean {
  return (
    !id.startsWith(TAG_PREFIX) &&
    !id.startsWith(ATTACHMENT_PREFIX) &&
    !id.startsWith("unresolved:")
  );
}

/**
 * Build the renderer-facing graph. Node/edge order follows the input order
 * throughout (insertion-ordered maps + arrays), so identical inputs produce
 * identical index assignments — tests assert this via `fingerprintOf()`.
 */
export function buildGpuGraph(input: GpuGraphInput): GpuGraph {
  const { graph, prefs, anchorId } = input;

  // R96: drop excluded-files nodes + any edge touching them first.
  const keptExcluded = new Set(
    graph.nodes.filter((n) => !isExcluded(n.id)).map((n) => n.id),
  );
  let nodes = graph.nodes.filter((n) => keptExcluded.has(n.id));
  let edges = graph.edges.filter(
    (e) => keptExcluded.has(e.source) && keptExcluded.has(e.target),
  );

  // R99/R101: merge tag / attachment aux halves when their toggles are on.
  if (prefs.display.tags && input.tagMap) {
    const aux = buildTagGraph(input.tagMap, keptExcluded);
    nodes = nodes.concat(aux.nodes);
    edges = edges.concat(aux.edges);
  }
  if (prefs.display.attachments && input.attachmentMap) {
    const aux = buildAttachmentGraph(input.attachmentMap, keptExcluded);
    nodes = nodes.concat(aux.nodes);
    edges = edges.concat(aux.edges);
  }

  // R84: orphans / existing-files-only filters, BEFORE the local BFS.
  const filtered = applyGraphFilters(nodes, edges, prefs.filters);
  nodes = filtered.nodes;
  edges = filtered.edges;

  // R103: local-mode BFS from the anchor; global keeps everything.
  let picked: GraphNode[];
  let activeAnchor: string | null = null;
  if (prefs.mode === "local") {
    activeAnchor =
      anchorId !== null && nodes.some((n) => n.id === anchorId) ? anchorId : null;
    if (activeAnchor === null) {
      picked = [];
    } else {
      const visited = localSubgraph(edges, activeAnchor, prefs.depth, {
        outgoing: prefs.outgoing,
        incoming: prefs.incoming,
      });
      picked = nodes.filter((n) => visited.has(n.id));
    }
  } else {
    picked = nodes;
  }

  const keptIds = new Set(picked.map((n) => n.id));
  // R110: neighbour-link pruning for local mode.
  const renderedEdges = localEdges(edges, keptIds, activeAnchor, prefs.neighborLinks);

  const indexById = new Map<string, number>();
  const gpuNodes: GpuNode[] = picked.map((n, i) => {
    indexById.set(n.id, i);
    const isAux = n.id.startsWith(TAG_PREFIX) || n.id.startsWith(ATTACHMENT_PREFIX);
    let groupColor: string | undefined;
    if (n.resolved && !isAux) {
      const matched = nodeGroupColor(
        { id: n.id, label: labelOf(n) },
        prefs.groups,
        "\0",
      );
      if (matched !== "\0") groupColor = matched;
    }
    const node: GpuNode = {
      id: n.id,
      label: labelOf(n),
      resolved: n.resolved,
      degree: n.degree,
    };
    if (groupColor !== undefined) node.groupColor = groupColor;
    return node;
  });

  const gpuEdges: GpuEdge[] = [];
  for (const e of renderedEdges) {
    const source = indexById.get(e.source);
    const target = indexById.get(e.target);
    if (source === undefined || target === undefined) continue;
    gpuEdges.push({ source, target, broken: e.kind === "broken" });
  }

  return { nodes: gpuNodes, edges: gpuEdges };
}

/** Count breakdown for the toolbar HUD + tests. */
export function countsOf(graph: GpuGraph): GpuCounts {
  let broken = 0;
  let unresolved = 0;
  for (const n of graph.nodes) if (!n.resolved) unresolved += 1;
  for (const e of graph.edges) if (e.broken) broken += 1;
  return { nodes: graph.nodes.length, edges: graph.edges.length, broken, unresolved };
}

/**
 * Stable fingerprint of node/edge identity + index order. Two builds from the
 * same input must produce the same fingerprint; used by the determinism test.
 */
export function fingerprintOf(graph: GpuGraph): string {
  const nodePart = graph.nodes
    .map(
      (n, i) =>
        `${i}:${n.id}|${n.label}|${n.resolved ? 1 : 0}|${n.degree}|${n.groupColor ?? ""}`,
    )
    .join(";");
  const edgePart = graph.edges
    .map((e) => `${e.source}>${e.target}${e.broken ? "!" : ""}`)
    .join(";");
  return `n=${nodePart}#e=${edgePart}`;
}
