/**
 * CPU tier classification for the WorkerPool (T-063 / Issue #21).
 *
 * One probe per session: logical core count, Worker availability, and
 * SharedArrayBuffer exposure. The pool keeps one lane per permitted worker,
 * always reserving a core for the UI thread.
 *
 * Tier table (see docs/t063-worker-pool.adoc):
 *
 * | Tier | Cores        | Lanes | Behaviour                                     |
 * |------|--------------|-------|-----------------------------------------------|
 * | S    | >= 8 logical | 4–8   | full concurrency                              |
 * | A    | 4–7          | 2–3   | moderate concurrency                          |
 * | B    | 2–3          | 1     | serial lane; background work yields to input   |
 * | C    | 1 core / fail | 0    | main-thread only, 8 ms budget, degrade notice |
 *
 * A downgrade is never silent: every decision carries a `tierReason` string.
 */

export type Tier = "S" | "A" | "B" | "C";

export interface TierProbe {
  /** logical cores reported by the host (`navigator.hardwareConcurrency`). */
  cores: number;
  /** whether a `Worker` constructor exists in this environment. */
  workerAvailable: boolean;
  /** whether SharedArrayBuffer is exposed (recorded for diagnosis; the pool
   *  itself never relies on it). */
  sabAvailable: boolean;
}

export interface TierDecision {
  tier: Tier;
  /** number of reusable worker lanes the pool may open. */
  lanes: number;
  /** why this tier was chosen / downgraded; surfaced in `getPoolStats()`. */
  tierReason: string;
  cores: number;
  workerAvailable: boolean;
  sabAvailable: boolean;
}

/** Read the host probe. Split out so tests can inject a fake environment. */
export function readProbe(env: {
  hardwareConcurrency?: number;
  workerAvailable: boolean;
  sabAvailable: boolean;
}): TierProbe {
  return {
    cores: Number.isFinite(env.hardwareConcurrency) && env.hardwareConcurrency! > 0
      ? Math.floor(env.hardwareConcurrency!)
      : 4,
    workerAvailable: env.workerAvailable,
    sabAvailable: env.sabAvailable,
  };
}

function lanesFor(tier: Exclude<Tier, "C">, cores: number): number {
  switch (tier) {
    case "S":
      return Math.min(Math.max(cores - 1, 4), 8);
    case "A":
      return Math.min(Math.max(cores - 1, 2), 3);
    case "B":
      return 1;
  }
}

/**
 * Classify the probe into a tier. `forceTier` overrides the hardware rule
 * (tests and manual diagnostics only); the reason always records the override.
 */
export function classifyTier(probe: TierProbe, forceTier: Tier | null = null): TierDecision {
  if (!probe.workerAvailable) {
    return {
      tier: "C",
      lanes: 0,
      tierReason: "worker-unavailable",
      cores: probe.cores,
      workerAvailable: false,
      sabAvailable: probe.sabAvailable,
    };
  }
  if (probe.cores <= 1) {
    return {
      tier: "C",
      lanes: 0,
      tierReason: "single-core",
      cores: probe.cores,
      workerAvailable: probe.workerAvailable,
      sabAvailable: probe.sabAvailable,
    };
  }

  let hardware: Exclude<Tier, "C">;
  if (probe.cores >= 8) hardware = "S";
  else if (probe.cores >= 4) hardware = "A";
  else hardware = "B";

  const tier: Tier = forceTier ?? hardware;
  if (tier === "C") {
    return {
      tier: "C",
      lanes: 0,
      tierReason: forceTier ? "forced-C" : "single-core",
      cores: probe.cores,
      workerAvailable: probe.workerAvailable,
      sabAvailable: probe.sabAvailable,
    };
  }

  return {
    tier,
    lanes: lanesFor(tier, probe.cores),
    tierReason: forceTier ? `forced-${tier}` : `cores-${probe.cores}`,
    cores: probe.cores,
    workerAvailable: probe.workerAvailable,
    sabAvailable: probe.sabAvailable,
  };
}

/** Runtime downgrade: move one tier down after a worker creation/error failure. */
export function downgrade(decision: TierDecision, reason: string): TierDecision {
  const order: Tier[] = ["S", "A", "B", "C"];
  const next = order[Math.min(order.indexOf(decision.tier) + 1, order.length - 1)];
  if (next === "C") {
    return { ...decision, tier: "C", lanes: 0, tierReason: `${decision.tierReason}: ${reason}` };
  }
  return {
    ...decision,
    tier: next,
    lanes: next === "B" ? 1 : lanesFor(next, decision.cores),
    tierReason: `${decision.tierReason}: ${reason}`,
  };
}
