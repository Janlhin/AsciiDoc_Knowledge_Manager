/**
 * T-063 (#20) — spatial shard plan and neighbourhood helpers.
 *
 * Sharding choice: 1D strips along the longer axis. Nodes are projected onto
 * that axis, sorted by (projection, index) and split into `shardCount`
 * contiguous groups. Alternatives considered: uniform grid cells, Morton
 * code blocks, recursive quad-tree bisection. Strips win on implementation
 * cost and balanced node counts; the cross-shard edge ratio is measured by
 * the benchmark and recorded in `docs/t063-layout-pool.adoc`.
 *
 * The plan is built once from the initial disk spread and stays stable for the
 * handle's lifetime: re-sharding every tick would cost an O(n) sort per
 * worker per tick, and node migration between shards is rare in practice.
 */
import type { GpuGraph } from "../types";

/** Per-shard node membership and edge grouping, flat typed arrays. */
export interface ShardPlan {
  shardCount: number;
  /** node index → shard index. */
  shardOf: Int32Array;
  /** `shardNodes[shardStart[s] .. shardStart[s+1])` are node indices in shard s. */
  shardStart: Int32Array;
  shardNodes: Int32Array;
  /** edge indices grouped by the source endpoint's shard (flat + offsets). */
  edgeStart: Int32Array;
  edgeByShard: Int32Array;
  /** edges whose both ends live in the same shard. */
  intraEdgeCount: number;
  /** edges crossing shard boundaries. */
  crossEdgeCount: number;
}

/** Undirected adjacency for the `wake()` neighbourhood pass (#19 route A). */
export interface Adjacency {
  /** flat neighbour indices; `adj[start[i] .. start[i+1])` for node i. */
  adj: Int32Array;
  start: Int32Array;
}

/**
 * Build the shard plan. `positions` are the initial layout positions; when
 * absent, nodes are split round-robin by index (fallback for empty / unit graphs).
 */
export function buildShardPlan(
  graph: GpuGraph,
  shardCount: number,
  positions?: { x: Float32Array; y: Float32Array },
): ShardPlan {
  const n = graph.nodes.length;
  const count = Math.max(1, Math.min(shardCount, n));
  const shardOf = new Int32Array(n);

  if (n === 0) {
    return {
      shardCount: count,
      shardOf,
      shardStart: new Int32Array(count + 1),
      shardNodes: new Int32Array(0),
      edgeStart: new Int32Array(count + 1),
      edgeByShard: new Int32Array(0),
      intraEdgeCount: 0,
      crossEdgeCount: 0,
    };
  }

  // Project onto the longer axis so strips follow the layout's spread.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  if (positions) {
    for (let i = 0; i < n; i++) {
      const xi = positions.x[i];
      const yi = positions.y[i];
      if (xi < minX) minX = xi;
      if (xi > maxX) maxX = xi;
      if (yi < minY) minY = yi;
      if (yi > maxY) maxY = yi;
    }
  }
  const horizontal = maxX - minX >= maxY - minY;

  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const proj = (i: number): number =>
    positions ? (horizontal ? positions.x[i] : positions.y[i]) : i;
  order.sort((a, b) => proj(a) - proj(b) || a - b);

  const shardNodes = new Int32Array(n);
  const shardStart = new Int32Array(count + 1);
  const perShard = Math.ceil(n / count);
  for (let s = 0; s < count; s++) {
    const begin = s * perShard;
    const end = Math.min(n, begin + perShard);
    shardStart[s] = begin;
    for (let k = begin; k < end; k++) {
      const node = order[k];
      shardOf[node] = s;
      shardNodes[k] = node;
    }
  }
  shardStart[count] = n;

  // Group edges by their source's shard; count cross-shard edges for reporting.
  const edges = graph.edges;
  const edgeByShard = new Int32Array(edges.length);
  const edgeStart = new Int32Array(count + 1);
  const perShardEdge = new Array<number>(count).fill(0);
  let intra = 0;
  let cross = 0;
  for (let e = 0; e < edges.length; e++) {
    const s = shardOf[edges[e].source];
    perShardEdge[s]++;
    if (shardOf[edges[e].target] === s) intra++;
    else cross++;
  }
  let acc = 0;
  for (let s = 0; s < count; s++) {
    edgeStart[s] = acc;
    acc += perShardEdge[s];
  }
  edgeStart[count] = edges.length;
  const cursor = edgeStart.slice(0, count);
  for (let e = 0; e < edges.length; e++) {
    const s = shardOf[edges[e].source];
    edgeByShard[cursor[s]++] = e;
  }

  return {
    shardCount: count,
    shardOf,
    shardStart,
    shardNodes,
    edgeStart,
    edgeByShard,
    intraEdgeCount: intra,
    crossEdgeCount: cross,
  };
}

/** Build undirected adjacency for local relayout (#19 route A). */
export function buildAdjacency(graph: GpuGraph): Adjacency {
  const n = graph.nodes.length;
  const degree = new Int32Array(n);
  for (const e of graph.edges) {
    degree[e.source]++;
    degree[e.target]++;
  }
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + degree[i];
  const adj = new Int32Array(start[n]);
  const cursor = start.slice(0, n);
  for (const e of graph.edges) {
    adj[cursor[e.source]++] = e.target;
    adj[cursor[e.target]++] = e.source;
  }
  return { adj, start };
}

/**
 * BFS `hops` from the seed indices. Returns a sorted, de-duplicated index
 * array. `hops = 1` is the shipped default; 2 hops are more natural but cost
 * more, and stay configurable here for the follow-up.
 */
export function localNeighborhood(
  adj: Adjacency,
  seeds: readonly number[],
  hops: number,
): number[] {
  const n = adj.start.length - 1;
  const visited = new Uint8Array(n);
  const out: number[] = [];
  let frontier: number[] = [];
  for (const seed of seeds) {
    if (seed < 0 || seed >= n || visited[seed]) continue;
    visited[seed] = 1;
    frontier.push(seed);
    out.push(seed);
  }
  for (let h = 0; h < hops; h++) {
    const next: number[] = [];
    for (const node of frontier) {
      for (let k = adj.start[node]; k < adj.start[node + 1]; k++) {
        const j = adj.adj[k];
        if (!visited[j]) {
          visited[j] = 1;
          next.push(j);
          out.push(j);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  out.sort((a, b) => a - b);
  return out;
}

/** Per-shard far-field summary: centroid, total mass, node count. */
export interface ShardSummary {
  comX: Float32Array;
  comY: Float32Array;
  mass: Float32Array;
  count: Int32Array;
}

/** Aggregate one summary per shard from current positions and per-node mass. */
export function shardSummaries(
  plan: ShardPlan,
  x: Float32Array,
  y: Float32Array,
  mass: Float32Array,
): ShardSummary {
  const k = plan.shardCount;
  const comX = new Float32Array(k);
  const comY = new Float32Array(k);
  const m = new Float32Array(k);
  const count = new Int32Array(k);
  for (let s = 0; s < k; s++) {
    let mx = 0;
    let my = 0;
    let total = 0;
    for (let i = plan.shardStart[s]; i < plan.shardStart[s + 1]; i++) {
      const node = plan.shardNodes[i];
      const mi = mass[node];
      mx += x[node] * mi;
      my += y[node] * mi;
      total += mi;
      count[s]++;
    }
    m[s] = total;
    if (total > 0) {
      comX[s] = mx / total;
      comY[s] = my / total;
    }
  }
  return { comX, comY, mass: m, count };
}
