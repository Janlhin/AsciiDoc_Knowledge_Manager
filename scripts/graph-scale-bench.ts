#!/usr/bin/env node
/**
 * Q-011 spike: how does the graph pipeline scale on THIS machine?
 *
 * The production graph uses d3-force on the main thread, then Canvas2D. This
 * script isolates the layout half: build time, first tick, average tick, and
 * whether a size can finish inside a fixed budget. It is a benchmark, not a
 * product path; output is intentionally plain text so CI does not depend on it.
 *
 * Usage:
 *   node scripts/graph-scale-bench.ts
 *   node scripts/graph-scale-bench.ts 1000 10000 100000 --budget=15000
 */
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

interface SimNode extends SimulationNodeDatum {
  id: string;
  degree: number;
}

type SimLink = SimulationLinkDatum<SimNode>;

const argv = process.argv.slice(2);
const sizes = argv
  .filter((a) => !a.startsWith("--") && Number.isFinite(Number(a)))
  .map(Number);
const budgetArg = argv.find((a) => a.startsWith("--budget="));
const budgetMs = budgetArg ? Number(budgetArg.split("=")[1]) : 15000;
const runSizes = sizes.length > 0 ? sizes : [1000, 10000, 50000, 100000];

/** Deterministic xorshift so runs can be compared across machines/sessions. */
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}

/** Synthetic graph with ~2 edges per node, no self-links, deterministic. */
function makeGraph(n: number): { nodes: SimNode[]; links: SimLink[] } {
  const random = rng(0x9e3779b9);
  const nodes: SimNode[] = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    degree: 0,
  }));
  const links: SimLink[] = [];
  const seen = new Set<string>();
  const targetEdges = n * 2;
  while (links.length < targetEdges) {
    const a = Math.floor(random() * n);
    const b = Math.floor(random() * n);
    if (a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: nodes[a], target: nodes[b] });
    nodes[a].degree += 1;
    nodes[b].degree += 1;
  }
  return { nodes, links };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

const round = (n: number) => Math.round(n * 10) / 10;

console.log(`Q-011 graph layout benchmark  budget=${budgetMs}ms/size`);
console.log("nodes\tedges\tbuild_ms\tfirst_tick_ms\tavg_tick_ms\tp95_tick_ms\tticks\tsettled\telapsed_ms");
for (const n of runSizes) {
  const buildStart = performance.now();
  const { nodes, links } = makeGraph(n);
  const buildMs = performance.now() - buildStart;

  const sim = forceSimulation<SimNode>(nodes)
    .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(70).strength(0.5))
    .force("charge", forceManyBody<SimNode>().strength(-200).distanceMax(420))
    .force("center", forceCenter(0, 0).strength(0.06))
    .force("circle", forceRadial<SimNode>(() => 240).strength(0.06))
    .force("collide", forceCollide<SimNode>(() => 6))
    .alpha(1)
    .alphaDecay(0.03)
    .stop();

  const tickTimes: number[] = [];
  const start = performance.now();
  let ticks = 0;
  let firstTickMs = 0;
  while (sim.alpha() > sim.alphaMin() && performance.now() - start < budgetMs) {
    const tickStart = performance.now();
    sim.tick();
    const tickMs = performance.now() - tickStart;
    if (ticks === 0) firstTickMs = tickMs;
    else tickTimes.push(tickMs);
    ticks += 1;
  }
  const elapsed = performance.now() - start;
  sim.stop();
  console.log(
    [
      n,
      links.length,
      round(buildMs),
      round(firstTickMs),
      round(tickTimes.reduce((a, b) => a + b, 0) / Math.max(1, tickTimes.length)),
      round(percentile(tickTimes, 0.95)),
      ticks,
      sim.alpha() <= sim.alphaMin() ? "yes" : "no",
      round(elapsed),
    ].join("\t"),
  );
}
