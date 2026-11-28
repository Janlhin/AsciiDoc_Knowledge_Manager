/**
 * T-063 / Issue #19 #20 — integrated-build GPU graph matrix benchmark driver.
 *
 * Sweeps nodes × worker count × SAB on/off against the real Vite dev server
 * and a headful Edge over CDP. Per cell it records:
 *
 *  - render frame time: median / p95 / p99 / 1% low recomputed from the raw
 *    per-frame samples the hook returns;
 *  - layout tick: engine rolling median / p95 from `stats()`, plus an onTick
 *    delta window summarised the same way; `stageMs` phase breakdown when the
 *    engine exposes it;
 *  - observed pool state: workers / cores / tier / tierReason / sab / wasm /
 *    frozen / tickCount / queueDepth / droppedTicks / shardCount / workerBytes;
 *  - machine facts, requested vs observed settings, heap / RSS / threads.
 *
 * Honesty rules (do not weaken):
 *  - Render frame samples and layout tick samples are never mixed.
 *  - Requested `benchWorkerCount` / `benchTier` / `benchSab` are recorded as
 *    requested; observed values come from `stats()`. A mismatch is flagged in
 *    `workersMatch` instead of being smoothed over.
 *  - A missing memory / thread source stays `null` / `unknown`; no guessed numbers.
 *  - Workers 2/4/8 and SAB-off rows are recorded exactly as observed; the
 *    driver does not tune correctness checks to hit a target number.
 *
 * Usage:
 *   node scripts/layout-bench.mjs --nodes=100000,200000 --workers=1,2,4,8 --sab=on,off
 *   node scripts/layout-bench.mjs --workers=8 --nodes=100000 --rounds=3
 *   node scripts/layout-bench.mjs --quality
 *
 * Env overrides: ADKM_TOOLS_DIR, ADKM_EDGE_PATH.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  summarize,
  machineInfo,
  gitHead,
  parseFlags,
  flagInt,
  flagNumList,
  pctDiff,
  sleep,
} from "./bench-stats.mjs";
import {
  DEV_PORT,
  CDP_PORT,
  EDGE_PATH,
  ensureDevServer,
  killDevServer,
  killEdgeTree,
  removeProfile,
  edgeVersion,
  connectCdp,
  waitForCdp,
  withTimeout,
  ENV_PROBE_EXPR,
  SOFTWARE_RE,
  probeMemory,
  benchUrl,
  spawnEdge,
  openGpuView,
} from "./bench-cdp.mjs";
import { lengthStats, countCrossings } from "./bench-quality.mjs";

const TOOLS_DIR = process.env.ADKM_TOOLS_DIR || "D:\\Projects\\ADKM-1127-wt\\t063-tools";
const OUT_DIR = path.join(TOOLS_DIR, "p063-bench");

const log = (...args) => console.log("[layout-bench]", ...args);

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

function printHelp() {
  console.log(`layout-bench.mjs — T-063 integrated-build GPU matrix benchmark

Options:
  --nodes=<list>     synthetic node counts, comma-separated (default 100000,200000)
  --workers=<list>  requested benchWorkerCount list (default 1)
  --sab=<on,off>    SAB switch list, comma-separated (default off)
  --seed=<n>         synthetic fixture seed (default 1)
  --frames=<n>       render frames sampled per cell (default 600)
  --warmup-ms=<n>    settle delay after load() before sampling (default 4000)
  --rounds=<n>       repeat every cell N times; summary takes per-round medians (default 1)
  --quality          after the matrix, dump settled positions for 1W and 8W at the first node count
  --cdp=<port>       CDP port (default 9222)
  --port=<port>      dev server port (default 1420)
  --out-dir=<dir>    evidence directory (default <tools>/p063-bench)
  --help             this message
`);
}

const { flags } = parseFlags(process.argv.slice(2));
if (flags.help) {
  printHelp();
  process.exit(0);
}

const cfg = {
  nodes: flagNumList(flags, "nodes", [100000, 200000]),
  workers: flagNumList(flags, "workers", [1]),
  sabList: String(flags.sab || "off")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s === "on" || s === "off"),
  seed: flagInt(flags, "seed", 1),
  frames: flagInt(flags, "frames", 600),
  warmupMs: flagInt(flags, "warmup-ms", 4000),
  rounds: Math.max(1, flagInt(flags, "rounds", 1)),
  quality: flags.quality === true || flags["quality-only"] === true,
  qualityOnly: flags["quality-only"] === true,
  cdpPort: flagInt(flags, "cdp", CDP_PORT),
  devPort: flagInt(flags, "port", DEV_PORT),
  outDir: typeof flags["out-dir"] === "string" ? flags["out-dir"] : OUT_DIR,
};

if (cfg.sabList.length === 0) cfg.sabList = ["off"];

/* ------------------------------------------------------------------ */
/* in-page direct-client sweep (engine stats + tick deltas)            */
/* ------------------------------------------------------------------ */

/**
 * The bench hook keeps its handle internal, so the engine stats / stage timings
 * are collected by driving the layout client directly inside the page, the same
 * way the pool-side sweep does. The render frame pass still goes through the
 * `window.__adkmGpuBench` hook.
 */
function sweepExpr({ nodes, edges, seed, workers, sab, warmupMs, sampleMs }) {
  return `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    function rng(seed) {
      let s = (seed >>> 0) || 1;
      return () => {
        s ^= (s << 13) >>> 0; s ^= s >>> 17; s ^= (s << 5) >>> 0; s >>>= 0;
        return s / 4294967296;
      };
    }
    function makeGraph(n, e, seed) {
      const rnd = rng(seed);
      const deg = new Array(n).fill(0);
      const nodes = Array.from({ length: n }, (_, i) => ({ id: 'n' + i, label: 'n' + i, resolved: true, degree: 0 }));
      const edges = [];
      for (let k = 0; k < e; k++) {
        const a = Math.floor(rnd() * n);
        let b = Math.floor(rnd() * n);
        if (b === a) b = (b + 1) % n;
        edges.push({ source: a, target: b, broken: false });
        deg[a]++; deg[b]++;
      }
      nodes.forEach((nd, i) => { nd.degree = deg[i]; });
      return { nodes, edges };
    }
    const client = await import('/src/features/graph/gpu/layout-client.ts');
    const graph = makeGraph(${nodes}, ${edges}, ${seed});
    const handle = client.createAsyncLayout(graph, undefined, { forceWorkers: ${workers}, sab: ${sab === "on"} });
    const deltas = [];
    let prev = null;
    const off = handle.onTick(() => {
      const now = performance.now();
      if (prev != null) deltas.push(now - prev);
      prev = now;
    });
    handle.start();
    await sleep(${warmupMs});
    prev = null;
    await sleep(${sampleMs});
    const stats = handle.stats();
    const out = { mode: handle.mode, deltas, stats, stageMs: stats.stageMs ?? null };
    handle.stop();
    off();
    handle.destroy();
    await sleep(300);
    return out;
  })()`;
}

/* ------------------------------------------------------------------ */
/* result builders                                                      */
/* ------------------------------------------------------------------ */

function buildRender(hook) {
  const summary = summarize(hook.samples || []);
  return {
    nodes: hook.nodes,
    edges: hook.edges,
    frames: hook.frames,
    hook: {
      medianMs: hook.medianMs,
      p95Ms: hook.p95Ms,
      fps: hook.fps,
      mode: hook.mode,
      gpu: hook.gpu,
      dpr: hook.dpr,
      width: hook.width,
      height: hook.height,
    },
    samples: summary,
  };
}

function buildLayout(requested, sweep) {
  const stats = sweep?.stats ?? null;
  const observed = stats
    ? {
        workers: stats.workers ?? null,
        cores: stats.cores ?? null,
        tier: stats.tier ?? null,
        tierReason: stats.tierReason ?? null,
        sab: stats.sab ?? null,
        wasm: stats.wasm ?? null,
        frozen: stats.frozen ?? null,
        tickCount: stats.tickCount ?? null,
        queueDepth: stats.queueDepth ?? null,
        droppedTicks: stats.droppedTicks ?? null,
        shardCount: stats.shardCount ?? null,
        workerBytes: stats.workerBytes ?? null,
      }
    : null;
  const tick = sweep
    ? {
        deltas: summarize(sweep.deltas || []),
        engineTickMedianMs: stats?.tickMedianMs ?? null,
        engineTickP95Ms: stats?.tickP95Ms ?? null,
        // Contract exposes no tick p99 yet; record null, do not estimate.
        engineTickP99Ms: null,
        stageMs: sweep.stageMs,
      }
    : null;
  return {
    handleAvailable: Boolean(stats),
    reason: stats ? null : "layout handle stats unavailable in this build",
    requested,
    observed,
    mode: sweep?.mode ?? null,
    workersMatch: stats ? stats.workers === requested.workerCount : null,
    tick,
  };
}

/** Load the pre-merge baseline (round 1) for the same 1W/off cell, if present. */
function loadPriorBaseline(nodes) {
  try {
    const priorPath = path.join(TOOLS_DIR, "p063-bench", `baseline-layout-1w-${nodes}n-saboff.json`);
    return JSON.parse(readFileSync(priorPath, "utf8"));
  } catch {
    return null;
  }
}

function crossCheck(render, prior) {
  if (!prior || !render) return null;
  const s = render.samples;
  const priorS = prior.render?.samples ?? null;
  if (!priorS) return null;
  return {
    prior: { medianMs: priorS.medianMs, p95Ms: priorS.p95Ms, fps: prior.render?.hook?.fps ?? null, frames: priorS.count },
    current: { medianMs: s.medianMs, p95Ms: s.p95Ms, fps: s.fpsFromMedian, frames: s.count },
    medianDiffPct: pctDiff(s.medianMs, priorS.medianMs),
    p95DiffPct: pctDiff(s.p95Ms, priorS.p95Ms),
  };
}

/* ------------------------------------------------------------------ */
/* one matrix cell                                                      */
/* ------------------------------------------------------------------ */

async function runOne(c, { nodes, workers, sab, priorBaseline, notes }) {
  const edges = nodes * 2;
  const requested = { workerCount: workers, tier: "auto", sab };

  await c.call("Page.navigate", {
    url: benchUrl({ workerCount: workers, tier: "auto", sab }, cfg.devPort),
  });
  await c.waitFor(
    `document.readyState === "complete" && document.body && document.body.innerText.trim().length > 0`,
    75000,
    "app shell",
  );
  await openGpuView(c);
  await c.waitFor(`!!window.__adkmGpuBench`, 30000, "bench hook attached");
  await c.call("Page.bringToFront");

  notes.push(`load(${nodes}, ${edges}, seed=${cfg.seed}) w=${workers} sab=${sab}`);
  await c.evaluate(`window.__adkmGpuBench.load(${nodes}, ${edges}, ${cfg.seed})`);
  await sleep(cfg.warmupMs);

  let hook = null;
  let runError = null;
  try {
    hook = await withTimeout(
      c.evaluate(`window.__adkmGpuBench.run(${cfg.frames})`),
      180000,
      `run(${cfg.frames})`,
    );
  } catch (e) {
    runError = e instanceof Error ? e.message : String(e);
    notes.push(`run error: ${runError}`);
  }
  await c.evaluate(`window.__adkmGpuBench.stop()`).catch(() => {});

  let sweep = null;
  let sweepError = null;
  try {
    sweep = await c.evaluate(
      sweepExpr({
        nodes,
        edges,
        seed: cfg.seed,
        workers,
        sab,
        warmupMs: cfg.warmupMs,
        sampleMs: 3000,
      }),
    );
  } catch (e) {
    sweepError = e instanceof Error ? e.message : String(e);
    notes.push(`sweep error: ${sweepError}`);
  }

  const memory = await probeMemory(c, cfg.cdpPort, profileDir);

  return {
    schema: "t063-layout-bench/v2",
    config: {
      nodes,
      edges,
      seed: cfg.seed,
      frames: cfg.frames,
      warmupMs: cfg.warmupMs,
      requested,
    },
    render: hook ? buildRender(hook) : null,
    layout: buildLayout(requested, sweep),
    memory,
    runError,
    sweepError,
    crossCheck:
      cfg.nodes.length === 1 && workers === 1 && sab === "off"
        ? crossCheck(hook ? buildRender(hook) : null, priorBaseline)
        : null,
  };
}

/* ------------------------------------------------------------------ */
/* browser-side quality snapshot (1W vs 8W settled positions)           */
/* ------------------------------------------------------------------ */

const QUALITY_DUMP_EXPR = ({ nodes, edges, seed, workers, warmupMs }) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
      s ^= (s << 13) >>> 0; s ^= s >>> 17; s ^= (s << 5) >>> 0; s >>>= 0;
      return s / 4294967296;
    };
  }
  function makeGraph(n, e, seed) {
    const rnd = rng(seed);
    const deg = new Array(n).fill(0);
    const nodes = Array.from({ length: n }, (_, i) => ({ id: 'n' + i, label: 'n' + i, resolved: true, degree: 0 }));
    const edges = [];
    for (let k = 0; k < e; k++) {
      const a = Math.floor(rnd() * n);
      let b = Math.floor(rnd() * n);
      if (b === a) b = (b + 1) % n;
      edges.push({ source: a, target: b, broken: false });
      deg[a]++; deg[b]++;
    }
    nodes.forEach((nd, i) => { nd.degree = deg[i]; });
    return { nodes, edges };
  }
  const client = await import('/src/features/graph/gpu/layout-client.ts');
  const graph = makeGraph(${nodes}, ${edges}, ${seed});
  const handle = client.createAsyncLayout(graph, undefined, { forceWorkers: ${workers}, sab: true });
  handle.start();
  await sleep(${warmupMs});
  const targets = handle.targets;
  const out = {
    x: Array.from(targets.x),
    y: Array.from(targets.y),
    edges: graph.edges.map((e) => ({ source: e.source, target: e.target })),
    stats: handle.stats(),
  };
  handle.stop();
  handle.destroy();
  await sleep(300);
  return out;
})()`;

async function runQuality(c, nodes) {
  const results = [];
  for (const workers of [1, 8]) {
    await c.call("Page.navigate", {
      url: benchUrl({ workerCount: workers, tier: "auto", sab: "on" }, cfg.devPort),
    });
    await c.waitFor(
      `document.readyState === "complete" && document.body && document.body.innerText.trim().length > 0`,
      75000,
      "app shell",
    );
    await openGpuView(c);
    await c.waitFor(`!!window.__adkmGpuBench`, 30000, "bench hook attached");
    await c.call("Page.bringToFront");

    const dumped = await c.evaluate(
      QUALITY_DUMP_EXPR({ nodes, edges: nodes * 2, seed: cfg.seed, workers, warmupMs: cfg.warmupMs }),
    );
    const lengths = dumped.edges.map((e) => {
      const dx = dumped.x[e.source] - dumped.x[e.target];
      const dy = dumped.y[e.source] - dumped.y[e.target];
      return Math.sqrt(dx * dx + dy * dy);
    });
    const edgeLengths = lengthStats(lengths);
    const crossings = countCrossings(dumped.x, dumped.y, dumped.edges, 32);
    const report = {
      schema: "t063-layout-quality-browser/v1",
      timestamp: new Date().toISOString(),
      fixture: { nodes, edges: nodes * 2, seed: cfg.seed, workers, sab: true, rng: "xorshift32" },
      observed: dumped.stats
        ? {
            workers: dumped.stats.workers,
            cores: dumped.stats.cores,
            tier: dumped.stats.tier,
            tierReason: dumped.stats.tierReason,
            sab: dumped.stats.sab,
            wasm: dumped.stats.wasm,
            tickCount: dumped.stats.tickCount,
          }
        : null,
      edgeLengths,
      crossings,
    };
    const file = path.join(cfg.outDir, `quality-browser-n${nodes}-w${workers}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
    results.push({ workers, report, file });
    log(`quality w=${workers}: len mean=${edgeLengths.mean} std=${edgeLengths.stddev} crossings≈${crossings.approxCount} (truncated=${crossings.truncated})`);
  }

  const [w1, w8] = results;
  const compare = {
    schema: "t063-layout-quality-compare/v1",
    timestamp: new Date().toISOString(),
    fixture: { nodes, seed: cfg.seed, workers: [1, 8] },
    w1: { edgeLengths: w1.report.edgeLengths, crossings: w1.report.crossings },
    w8: { edgeLengths: w8.report.edgeLengths, crossings: w8.report.crossings },
    note: "Crossing counts are comparable only when both rows share the same --cells and neither side's truncation differs; see caveats in each quality JSON.",
  };
  const compareFile = path.join(cfg.outDir, `quality-browser-compare-n${nodes}.json`);
  writeFileSync(compareFile, JSON.stringify(compare, null, 2), "utf8");
  log(`quality compare: ${compareFile}`);
  return results;
}

/* ------------------------------------------------------------------ */
/* main                                                                 */
/* ------------------------------------------------------------------ */

let profileDir = "";

async function main() {
  mkdirSync(cfg.outDir, { recursive: true });
  const notes = [];
  const errors = [];
  let devHandle = null;
  let edge = null;

  const combos = [];
  for (const nodes of cfg.nodes) {
    for (const workers of cfg.workers) {
      for (const sab of cfg.sabList) {
        combos.push({ nodes, workers, sab });
      }
    }
  }

  try {
    devHandle = await ensureDevServer(notes, cfg.devPort, REPO_ROOT);
    log(`dev server: ${devHandle.reused ? "reused" : "spawned"}`);

    profileDir = path.join(TOOLS_DIR, `edge-profile-p063-${Date.now()}`);
    edge = spawnEdge({
      cdpPort: cfg.cdpPort,
      profileDir,
      url: benchUrl({ workerCount: cfg.workers[0], tier: "auto", sab: cfg.sabList[0] }, cfg.devPort),
    });
    log(`edge launching: ${profileDir}`);
    await waitForCdp(cfg.cdpPort, 30000);

    const c = await connectCdp(cfg.cdpPort, { marker: "gpu-bench=1" });
    log("cdp page connected");

    await c.waitFor(
      `document.readyState === "complete" && document.body && document.body.innerText.trim().length > 0`,
      75000,
      "app shell",
    );

    const envProbe = await c.evaluate(ENV_PROBE_EXPR);
    let browserVersion = "unknown";
    try {
      const bv = await c.call("Browser.getVersion");
      browserVersion = bv.product || bv.userAgent || "unknown";
    } catch {
      /* CDP version probe unavailable */
    }
    const software = SOFTWARE_RE.test(String(envProbe.renderer || ""));
    const env = {
      machine: machineInfo(),
      headless: false,
      edgePath: EDGE_PATH,
      edgeVersion: edgeVersion() !== "unknown" ? edgeVersion() : browserVersion,
      browserVersion,
      rendererProbe: {
        renderer: envProbe.renderer,
        unmaskedRenderer: envProbe.raw,
        glVersion: envProbe.glVersion,
        ctxType: envProbe.ctxType,
      },
      dpr: envProbe.dpr,
      viewport: { width: envProbe.width, height: envProbe.height },
      softwareRenderer: software,
      profileDir,
    };

    const entries = [];
    const roundsByKey = new Map();

    for (const combo of combos) {
      if (cfg.qualityOnly) continue;
      for (let round = 1; round <= cfg.rounds; round += 1) {
        const priorBaseline = loadPriorBaseline(combo.nodes);
        log(`cell: n=${combo.nodes} w=${combo.workers} sab=${combo.sab} round=${round}/${cfg.rounds}`);
        try {
          const entry = await runOne(c, { ...combo, priorBaseline, notes });
          entries.push(entry);

          const safeSab = combo.sab === "on" ? "on" : "off";
          const file = path.join(
            cfg.outDir,
            `matrix-w${combo.workers}-n${combo.nodes}-sab${safeSab}-r${round}.json`,
          );
          writeFileSync(
            file,
            JSON.stringify({ env, repo: { root: REPO_ROOT, git: gitHead() }, ...entry }, null, 2),
            "utf8",
          );

          const key = `${combo.nodes}-w${combo.workers}-sab${safeSab}`;
          if (!roundsByKey.has(key)) roundsByKey.set(key, []);
          roundsByKey.get(key).push({
            round,
            render: entry.render?.samples ?? null,
            tick: entry.layout?.tick ?? null,
            observed: entry.layout?.observed ?? null,
            workersMatch: entry.layout?.workersMatch ?? null,
            runError: entry.runError ?? null,
            sweepError: entry.sweepError ?? null,
          });

          if (entry.render) {
            const s = entry.render.samples;
            log(
              `  render median=${s.medianMs} p95=${s.p95Ms} p99=${s.p99Ms} low1=${s.low1Ms} (${s.count} frames)`,
            );
          }
          if (entry.layout?.tick) {
            const t = entry.layout.tick;
            log(
              `  tick median=${t.engineTickMedianMs} p95=${t.engineTickP95Ms} count=${entry.layout.observed?.tickCount}`,
            );
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          errors.push({ ...combo, round, message });
          console.error(`  cell failed: ${message}`);
        }
      }
    }

    // Per-key multi-round summary: median across rounds, with min/max band.
    const summaryKeys = [...roundsByKey.entries()].map(([key, rounds]) => {
      const medians = rounds.map((r) => r.render?.medianMs).filter((v) => v != null);
      const p95s = rounds.map((r) => r.render?.p95Ms).filter((v) => v != null);
      const tickMeds = rounds.map((r) => r.tick?.engineTickMedianMs).filter((v) => v != null);
      const medianOf = (arr) => {
        if (arr.length === 0) return null;
        const s = [...arr].sort((a, b) => a - b);
        return Math.round(s[Math.floor((s.length - 1) / 2)] * 100) / 100;
      };
      return {
        key,
        rounds: rounds.length,
        render: {
          medianMs: medianOf(medians),
          p95Ms: medianOf(p95s),
          medianMin: medians.length ? Math.min(...medians) : null,
          medianMax: medians.length ? Math.max(...medians) : null,
        },
        tick: {
          medianMs: medianOf(tickMeds),
        },
        observed: rounds[0]?.observed ?? null,
        workersMatch: rounds.every((r) => r.workersMatch !== false),
      };
    });

    let qualityResults = [];
    if (cfg.quality) {
      qualityResults = await runQuality(c, cfg.nodes[0]);
    }

    const summary = {
      schema: "t063-layout-bench-summary/v2",
      timestamp: new Date().toISOString(),
      commandLine: process.argv.join(" "),
      env,
      repo: { root: REPO_ROOT, git: gitHead() },
      config: { nodes: cfg.nodes, workers: cfg.workers, sab: cfg.sabList, seed: cfg.seed, frames: cfg.frames, rounds: cfg.rounds },
      cells: entries.map((e) => ({
        nodes: e.config.nodes,
        workers: e.config.requested.workerCount,
        sab: e.config.requested.sab,
        render: e.render?.samples ?? null,
        tick: e.layout?.tick ?? null,
        observed: e.layout?.observed ?? null,
        workersMatch: e.layout?.workersMatch ?? null,
        runError: e.runError ?? null,
        sweepError: e.sweepError ?? null,
      })),
      roundSummary: summaryKeys,
      quality: qualityResults.map((q) => ({ workers: q.workers, file: q.file })),
      notes,
      errors,
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const summaryFile = path.join(cfg.outDir, `matrix-summary-${stamp}.json`);
    writeFileSync(summaryFile, JSON.stringify(summary, null, 2), "utf8");
    log(`summary: ${summaryFile}`);
    log(`done. cells=${entries.length}, errors=${errors.length}`);
    return errors.length === 0 ? 0 : 1;
  } finally {
    if (edge) killEdgeTree(profileDir);
    if (profileDir) await removeProfile(profileDir);
    if (devHandle && !devHandle.reused) killDevServer(cfg.devPort);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[layout-bench] fatal:", err);
    process.exit(1);
  });
