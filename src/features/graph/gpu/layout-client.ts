/**
 * T-063 (#19/#20) — async layout entry point.
 *
 * Probes the machine (cores, SAB, WASM, Worker availability, memory budget),
 * decides the CPU tier / mode / worker count, and returns the matching handle:
 *
 *  - `main`  — {@link MainLayoutHandle}: throttled main-thread fallback (tier C);
 *  - `pool` / `single` — {@link PoolLayoutHandle}: one worker per shard, SAB or
 *    transferable sync, freeze + local relayout.
 *
 * The heavy lifting lives under `./layout/`; this file only wires the probe to
 * the handles and re-exports the frozen contract types.
 */
import { MainLayoutHandle } from "./layout/main-handle";
import { PoolLayoutHandle } from "./layout/pool-client";
import { decideTier, probeEnvironment } from "./layout/tier";
import type {
  AsyncLayoutHandle,
  CpuTier,
  LayoutClientOptions,
  LayoutMode,
  LayoutStats,
  LayoutTargets,
} from "./layout-api";
import type { GpuGraph, LayoutOptions } from "./types";

export type {
  AsyncLayoutHandle,
  LayoutClientOptions,
  LayoutStats,
  LayoutTargets,
  CpuTier,
  LayoutMode,
};

function warnFallback(): void {
  console.warn("[gpu-graph] Worker unavailable; layout falls back to throttled main-thread ticks.");
}

/**
 * Build an async layout. Benchmark overrides (`forceWorkers`, `forceTier`,
 * `sab`, `wasm`, `mainTickNodeLimit`) are honoured by the tier decision.
 */
export function createAsyncLayout(
  graph: GpuGraph,
  opts?: Partial<LayoutOptions>,
  client?: LayoutClientOptions,
): AsyncLayoutHandle {
  const probe = probeEnvironment(client);
  const decision = decideTier(
    probe,
    { nodes: graph.nodes.length, edges: graph.edges.length },
    client,
  );

  if (decision.mode === "main") {
    return new MainLayoutHandle(graph, opts, client, decision.tierReason || undefined);
  }

  try {
    return new PoolLayoutHandle(graph, opts, decision, client);
  } catch {
    warnFallback();
    return new MainLayoutHandle(graph, opts, client, "pool-construction-failed");
  }
}
