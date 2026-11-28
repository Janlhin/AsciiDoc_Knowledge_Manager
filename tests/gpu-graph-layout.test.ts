/**
 * T-063 GPU graph view — layout kernel tests: determinism, bounds stability,
 * finiteness and a single-tick cost sample. Pure TS, no DOM / WebGL.
 */
import { describe, expect, it } from "vitest";
import { createLayout } from "@features/graph/gpu/layout";
import { createAsyncLayout } from "@features/graph/gpu/layout-client";
import type { GpuEdge, GpuGraph, GpuNode } from "@features/graph/gpu/types";

/** deterministic PRNG for fixtures only — the layout itself uses its own xorshift. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= (s << 13) >>> 0;
    s ^= s >>> 17;
    s ^= (s << 5) >>> 0;
    s >>>= 0;
    return s / 4294967296;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeGraph(n: number, edgeCount: number, seed: number): GpuGraph {
  const rnd = makeRng(seed);
  const degree = new Array<number>(n).fill(0);
  const nodes: GpuNode[] = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ id: `n${i}`, label: `n${i}`, resolved: true, degree: 0 });
  }
  const edges: GpuEdge[] = [];
  for (let e = 0; e < edgeCount; e++) {
    const a = Math.floor(rnd() * n);
    const b = Math.floor(rnd() * n);
    if (a === b) continue;
    edges.push({ source: a, target: b, broken: false });
    degree[a]++;
    degree[b]++;
  }
  for (let i = 0; i < n; i++) nodes[i].degree = degree[i];
  return { nodes, edges };
}

describe("gpu graph layout — determinism", () => {
  it("same graph + same seed ⇒ identical fingerprint and element-wise positions", () => {
    const graph = makeGraph(10_000, 20_000, 42);
    const a = createLayout(graph, { seed: 1234 });
    const b = createLayout(graph, { seed: 1234 });
    a.stepUntil(300);
    b.stepUntil(300);

    expect(a.fingerprint()).toBe(b.fingerprint());
    for (let i = 0; i < a.count; i++) {
      expect(a.x[i]).toBe(b.x[i]);
      expect(a.y[i]).toBe(b.y[i]);
    }
  }, 30_000);

  it("different seed ⇒ different fingerprint", () => {
    const graph = makeGraph(10_000, 20_000, 42);
    const a = createLayout(graph, { seed: 1 });
    const b = createLayout(graph, { seed: 2 });
    a.stepUntil(300);
    b.stepUntil(300);
    expect(a.fingerprint()).not.toBe(b.fingerprint());
  }, 30_000);

  it("all positions stay finite after settling", () => {
    // 2k nodes: finiteness is a property of the integrator, not of graph size,
    // and 10k × 1000 ticks exceeded the default 5s budget on CI.
    const graph = makeGraph(2_000, 4_000, 7);
    const layout = createLayout(graph);
    layout.stepUntil(1000);
    for (let i = 0; i < layout.count; i++) {
      expect(Number.isFinite(layout.x[i])).toBe(true);
      expect(Number.isFinite(layout.y[i])).toBe(true);
    }
  }, 20_000);

  it("bounds neither collapse to a point nor explode after 1000 ticks", () => {
    const graph = makeGraph(1_000, 2_000, 99);
    const layout = createLayout(graph);
    layout.stepUntil(1000);
    const b = layout.bounds();
    const side = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    const link = layout.options.linkDistance;
    expect(side).toBeGreaterThan(link);
    expect(side).toBeLessThan(100 * link);
  });

  it("alpha decays toward the floor and settles", () => {
    const graph = makeGraph(500, 1_000, 5);
    const layout = createLayout(graph, { alphaDecay: 0.03 });
    const first = layout.alpha();
    layout.stepUntil(layout.options.maxTicks);
    expect(layout.alpha()).toBeLessThan(first);
    expect(layout.settled()).toBe(true);
  });
});

describe("gpu graph layout — 100k single-tick cost", () => {
  it("samples 20 ticks, reports median / p95 (informational, no hard ceiling)", () => {
    const graph = makeGraph(100_000, 200_000, 20261128);
    const layout = createLayout(graph);

    for (let i = 0; i < 5; i++) layout.step(); // warmup

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      layout.step();
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    const p95 = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)];
    console.log(
      `[perf] 100k nodes / 200k edges single tick: median=${median.toFixed(2)}ms p95=${p95.toFixed(2)}ms`,
    );

    // sanity guard: nothing runaway (real target ≤8ms, reported separately in the receipt)
    expect(median).toBeLessThan(1000);
    for (let i = 0; i < layout.count; i++) {
      expect(Number.isFinite(layout.x[i])).toBe(true);
      expect(Number.isFinite(layout.y[i])).toBe(true);
    }
  }, 60_000);
});

describe("gpu graph async layout — worker fallback", () => {
  it("degrades to main mode without a Worker and fires onTick", async () => {
    const graph = makeGraph(500, 1_000, 5);
    const handle = createAsyncLayout(graph, { seed: 1234 });
    expect(handle.mode).toBe("main");

    let ticks = 0;
    const off = handle.onTick(() => ticks++);
    handle.start();
    await sleep(80);
    expect(ticks).toBeGreaterThan(0);

    handle.stop();
    off();
    handle.destroy();
    handle.destroy(); // idempotent
  });

  it("main-mode async fingerprint matches the sync kernel after one tick", async () => {
    const graph = makeGraph(500, 1_000, 5);
    const handle = createAsyncLayout(graph, { seed: 1234 });
    const sync = createLayout(graph, { seed: 1234 });

    const firstTick = new Promise<void>((resolve) => handle.onTick(() => resolve()));
    handle.start();
    await firstTick;
    sync.step();

    expect(handle.layout.fingerprint()).toBe(sync.fingerprint());
    handle.destroy();
  });
});
