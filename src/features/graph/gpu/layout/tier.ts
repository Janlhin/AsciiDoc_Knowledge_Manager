/**
 * T-063 (#20) — CPU capability probe and tier / worker-count decision.
 *
 * Pure functions over an injectable {@link ProbeInput}, so the matrix can be
 * exercised in unit tests without a real `Worker` or `navigator`. The browser
 * entry point fills the probe from `navigator`; benchmarks override fields
 * directly to sweep the hardware matrix.
 *
 * Tier table (#20):
 *
 * | Tier | Condition | Runtime |
 * | --- | --- | --- |
 * | S | ≥8 cores + SAB + WASM | pool, up to 4 workers |
 * | A | ≥4 cores (or S-capable but WASM missing) | pool / 2+ workers |
 * | B | 2–3 cores, or ≥4 cores without SAB | 1–2 workers + freeze / local relayout |
 * | C | 1 core, Worker creation failed, or over memory budget | main-thread 8ms budget + freeze / local relayout |
 *
 * WASM is intentionally reported `false` this round: the Rust wasm-pack /
 * AssemblyScript toolchain is a new build chain and needs separate approval
 * (repo hard boundary #5). The S-tier WASM Barnes–Hut path is a recorded gap,
 * not a reported success.
 */
import type { CpuTier, LayoutClientOptions, LayoutMode } from "../layout-api";

/** Node facts the memory budget estimate needs. */
export interface GraphSize {
  nodes: number;
  edges: number;
}

/** Raw capability facts; every field can be overridden by the benchmark. */
export interface ProbeInput {
  cores: number;
  /** `SharedArrayBuffer` constructible *and* the page is cross-origin isolated. */
  sab: boolean;
  /** WASM kernel available; hard-coded false this round. */
  wasm: boolean;
  /** rough device memory bytes; 0 = unknown. */
  deviceMemoryBytes: number;
  /** `Worker` constructible in this environment. */
  workerAvailable: boolean;
}

/** Decided runtime configuration handed to the pool / main handles. */
export interface TierDecision {
  tier: CpuTier;
  /** short user-visible reason; `""` when the machine runs its nominal tier. */
  tierReason: string;
  mode: LayoutMode;
  workers: number;
  sab: boolean;
  wasm: boolean;
}

/** Main-thread fallback refuses a full tick above this node count (#20, tier C). */
export const DEFAULT_MAIN_TICK_NODE_LIMIT = 20_000;

/** hard upper bound on layout workers (#20). */
export const MAX_WORKERS = 8;

/** Reserve one core for the UI thread (#20). */
const UI_CORE_RESERVE = 1;

/** Total pool memory ceiling when device memory is unknown. */
const FALLBACK_BUDGET_BYTES = 1 << 30; // 1 GiB
/** Fraction of reported device memory the layout pool may claim. */
const DEVICE_MEMORY_FRACTION = 0.25;
/** Per-worker replica estimate: pos 8n + vel 8n + force 8n + mass 4n, edges 8e. */
const BYTES_PER_NODE = 28;
const BYTES_PER_EDGE = 8;

/** Read the raw environment. Kept side-effect free apart from `navigator`/`self` reads. */
export function probeEnvironment(opts: LayoutClientOptions | undefined): ProbeInput {
  const nav: Navigator | undefined =
    typeof navigator !== "undefined" ? navigator : undefined;
  const cores = Math.max(1, Math.floor(nav?.hardwareConcurrency || 1));

  const sabConstructible = typeof SharedArrayBuffer !== "undefined";
  const isolated =
    typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : false;
  const sab = opts?.sab !== false && sabConstructible && isolated;

  // No WASM kernel shipped this round; keep the flag wired for the future chain.
  const wasm = opts?.wasm === true && false;

  const deviceMemory = (nav as Navigator & { deviceMemory?: number } | undefined)
    ?.deviceMemory;
  const deviceMemoryBytes = deviceMemory
    ? Math.floor(deviceMemory * 1024 * 1024 * 1024)
    : 0;

  const workerAvailable = typeof Worker !== "undefined";

  return { cores, sab, wasm, deviceMemoryBytes, workerAvailable };
}

/** Rough per-worker replica footprint in bytes. */
export function estimatePerWorkerBytes(size: GraphSize): number {
  return size.nodes * BYTES_PER_NODE + size.edges * BYTES_PER_EDGE;
}

/** Total memory budget the whole pool may claim. */
export function memoryBudgetBytes(probe: ProbeInput): number {
  if (probe.deviceMemoryBytes > 0) {
    return Math.min(FALLBACK_BUDGET_BYTES, Math.floor(probe.deviceMemoryBytes * DEVICE_MEMORY_FRACTION));
  }
  return FALLBACK_BUDGET_BYTES;
}

/**
 * Decide tier, mode and worker count from the probe, graph size and overrides.
 * `forceWorkers` / `forceTier` / `sab` from {@link LayoutClientOptions} win over
 * the probe; a forced worker count that the memory budget cannot hold drops
 * back to the largest affordable count.
 */
export function decideTier(
  probe: ProbeInput,
  size: GraphSize,
  opts: LayoutClientOptions | undefined,
): TierDecision {
  const sab = opts?.sab === false ? false : probe.sab;
  const wasm = probe.wasm;

  let tier: CpuTier;
  let reason = "";

  if (probe.cores >= 8 && sab && wasm) {
    tier = "S";
  } else if (probe.cores >= 4) {
    tier = "A";
    if (!wasm) reason = "no-wasm-kernel";
    if (!sab) reason = reason ? `${reason};no-sab` : "no-sab";
  } else if (probe.cores >= 2) {
    tier = "B";
    reason = sab ? "few-cores" : "few-cores;no-sab";
  } else {
    tier = "C";
    reason = "single-core";
  }

  // No SAB drops an otherwise A/S machine to B (#20: B covers "no SAB").
  if (!sab && (tier === "S" || tier === "A")) {
    tier = "B";
    reason = reason ? `${reason};no-sab` : "no-sab";
  }

  // Capability downgrades: no Worker constructor available ⇒ main fallback.
  if (!probe.workerAvailable) {
    tier = "C";
    reason = "worker-unavailable";
  }

  let workers = targetWorkerCount(probe.cores, tier);

  // Memory budget: shrink the pool until the replica copies fit the ceiling.
  const perWorker = estimatePerWorkerBytes(size);
  const budget = memoryBudgetBytes(probe);
  while (workers > 1 && workers * perWorker > budget) workers -= 1;
  if (perWorker > budget) {
    workers = 0;
    tier = "C";
    reason = "over-memory-budget";
  }

  // Benchmark overrides.
  if (opts?.forceTier) {
    tier = opts.forceTier;
    reason = reason || `forced-${tier}`;
  }
  if (typeof opts?.forceWorkers === "number" && opts.forceWorkers > 0) {
    workers = Math.min(MAX_WORKERS, Math.max(1, Math.floor(opts.forceWorkers)));
    if (workers * perWorker > budget) {
      workers = Math.max(1, Math.floor(budget / Math.max(1, perWorker)));
      reason = reason || "memory-capped-workers";
    }
  }

  if (tier === "C") {
    workers = 0;
  }

  const mode: LayoutMode = workers === 0 ? "main" : workers === 1 ? "single" : "pool";
  return { tier, tierReason: reason, mode, workers, sab, wasm };
}

function targetWorkerCount(cores: number, tier: CpuTier): number {
  if (tier === "C") return 0;
  const usable = Math.max(1, cores - UI_CORE_RESERVE);
  const target = cores >= 8 ? 4 : 2;
  return Math.min(MAX_WORKERS, Math.max(1, Math.min(usable, target)));
}
