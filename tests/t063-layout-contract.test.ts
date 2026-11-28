/**
 * T-063 — the layout handle contract, exercised against the single-thread
 * fallback (no `Worker` in this environment). Guards the parts both the pool
 * (#20) and the motion layer (#19) rely on: stable `targets`, a version that
 * advances per tick, a stats snapshot with every field, and freeze/thaw.
 */
import { describe, expect, it } from "vitest";
import { createAsyncLayout } from "../src/features/graph/gpu/layout-client";
import type { GpuGraph } from "../src/features/graph/gpu/types";

function ring(count: number, degree: number): GpuGraph {
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    label: `n${i}`,
    resolved: true,
    degree,
  }));
  const edges = Array.from({ length: count }, (_, i) => ({
    source: i,
    target: (i + 1) % count,
    broken: false,
  }));
  return { nodes, edges };
}

const STAT_KEYS = [
  "workers",
  "cores",
  "tier",
  "tierReason",
  "sab",
  "wasm",
  "frozen",
  "tickMedianMs",
  "tickP95Ms",
  "tickCount",
  "queueDepth",
  "droppedTicks",
] as const;

describe("t063 layout handle contract", () => {
  it("publishes stable targets sized to the graph", () => {
    const graph = ring(64, 2);
    const handle = createAsyncLayout(graph);
    const targets = handle.targets;
    expect(targets.count).toBe(graph.nodes.length);
    expect(targets.x.length).toBe(graph.nodes.length);
    expect(targets.y.length).toBe(graph.nodes.length);
    expect(targets.version).toBe(0);
    // the object is stable: same reference across calls
    expect(handle.targets).toBe(targets);
    handle.destroy();
  });

  it("advances targets.version exactly once per applied tick", async () => {
    const handle = createAsyncLayout(ring(64, 2));
    const seen: number[] = [];
    const off = handle.onTick(() => seen.push(handle.targets.version));
    handle.start();
    await new Promise((resolve) => setTimeout(resolve, 120));
    handle.stop();
    off();
    handle.destroy();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toBe(1);
    const deltas = seen.slice(1).map((v, i) => v - seen[i]);
    for (const d of deltas) expect(d).toBe(1);
  });

  it("reports every stats field and reflects freeze()", () => {
    const handle = createAsyncLayout(ring(32, 2));
    const stats = handle.stats();
    for (const key of STAT_KEYS) expect(stats).toHaveProperty(key);
    expect(stats.cores).toBeGreaterThanOrEqual(1);
    expect(["S", "A", "B", "C"]).toContain(stats.tier);
    expect(stats.frozen).toBe(false);
    handle.freeze();
    expect(handle.stats().frozen).toBe(true);
    handle.thaw();
    expect(handle.stats().frozen).toBe(false);
    handle.destroy();
  });

  it("makes destroy idempotent and stops ticking", async () => {
    const handle = createAsyncLayout(ring(32, 2));
    handle.start();
    handle.destroy();
    handle.destroy();
    const count = handle.stats().tickCount;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(handle.stats().tickCount).toBe(count);
  });
});
