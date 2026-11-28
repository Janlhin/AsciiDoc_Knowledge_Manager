/**
 * T-063 / Issue #19 #20 — GPU graph layout + render benchmark driver.
 *
 * Drives the real Vite dev server (port 1420) and a headful Edge on CDP port
 * 9222 against the `?gpu-bench=1` synthetic fixture. For every matrix cell it
 * records:
 *
 *  - render frame time: median / p95 / p99 / 1% low from the raw per-frame
 *    samples (the hook itself only returns median/p95; this script recomputes
 *    the full summary from `samples`);
 *  - layout tick: before/after `handle.stats()` delta + `targets.version`
 *    cross-check, tick count, wall time, ticks/s;
 *  - memory / threads: in-page V8 heap, CDP process info + metrics, OS RSS and
 *    thread count for this run's own Edge tree;
 *  - machine facts, git HEAD, requested vs observed worker/tier/SAB settings.
 *
 * Honesty rules (do not weaken):
 *  - If the build does not expose the layout handle yet (current pre-merge
 *    baseline: pool/motion lanes not merged), tick fields are `null` with a
 *    reason; nothing is estimated from frame times.
 *  - Requested `benchWorkerCount` / `benchTier` / `benchSab` are recorded as
 *    requested; observed values come from `stats()`. When the params are
 *    ignored by the build, the JSON says so instead of pretending they applied.
 *  - A missing memory/thread source stays `null`/`unknown`; no guessed numbers.
 *
 * Usage:
 *   node scripts/layout-bench.mjs --help
 *   node scripts/layout-bench.mjs --baseline
 *   node scripts/layout-bench.mjs --workers=4 --tier=A --sab=off --nodes=100000,200000
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
  HANDLE_EXPR,
  SOFTWARE_RE,
  probeMemory,
  benchUrl,
  spawnEdge,
  openGpuView,
} from "./bench-cdp.mjs";

const TOOLS_DIR = process.env.ADKM_TOOLS_DIR || "D:\\Projects\\ADKM-1127-wt\\t063-tools";
const OUT_DIR = path.join(TOOLS_DIR, "p063-bench");

const log = (...args) => console.log("[layout-bench]", ...args);

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

function printHelp() {
  console.log(`layout-bench.mjs — T-063 GPU graph render + layout benchmark

Options:
  --workers=<n>      benchWorkerCount requested to the page (default 1; baseline)
  --tier=<S|A|B|C>   benchTier requested; auto = leave to the engine (default auto)
  --sab=<on|off>     benchSab switch (default off; benchSab=off sent when off)
  --nodes=<list>     synthetic node counts, comma-separated (default 100000,200000)
  --edges=<n>        edge count per graph (default 2 × nodes)
  --seed=<n>         synthetic fixture seed (default 1)
  --frames=<n>       render frames sampled per graph (default 600)
  --warmup-ms=<n>    settle delay after load() before sampling (default 4000)
  --baseline         write baseline-*.json and cross-check against bench-100k.json
  --cdp=<port>       CDP port (default 9222)
  --port=<port>      dev server port (default 1420)
  --out-dir=<dir>    evidence directory (default <tools>/p063-bench)
  --help             this message

Notes:
  - Layout tick fields are null until the pool/motion lanes expose the handle
    (window.__adkmGpuBench.handle or .getHandle()). This script records that
    honestly instead of estimating ticks from frame samples.
  - Only the Edge tree spawned by this script is killed on exit.
`);
}

const { flags } = parseFlags(process.argv.slice(2));
if (flags.help) {
  printHelp();
  process.exit(0);
}

const cfg = {
  workers: flagInt(flags, "workers", 1),
  tier: typeof flags.tier === "string" ? flags.tier : "auto",
  sab: flags.sab === "on" ? "on" : "off",
  nodes: flagNumList(flags, "nodes", [100000, 200000]),
  edges: flagInt(flags, "edges", 0),
  seed: flagInt(flags, "seed", 1),
  frames: flagInt(flags, "frames", 600),
  warmupMs: flagInt(flags, "warmup-ms", 4000),
  baseline: flags.baseline === true,
  cdpPort: flagInt(flags, "cdp", CDP_PORT),
  devPort: flagInt(flags, "port", DEV_PORT),
  outDir: typeof flags["out-dir"] === "string" ? flags["out-dir"] : OUT_DIR,
};

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

function buildLayout(before, after, wallMs) {
  const base = {
    handleAvailable: Boolean(after.available),
    reason: after.available ? null : after.reason || "unknown",
    requested: { workerCount: cfg.workers, tier: cfg.tier, sab: cfg.sab },
    observed: after.stats ?? null,
    mode: after.mode ?? null,
    tick: null,
  };
  if (!after.available || !before.available) return base;

  const a = before.stats || {};
  const b = after.stats || {};
  const versionBefore = before.targets?.version ?? null;
  const versionAfter = after.targets?.version ?? null;
  const countDelta =
    Number.isFinite(b.tickCount) && Number.isFinite(a.tickCount) ? b.tickCount - a.tickCount : null;
  const versionDelta = versionBefore != null && versionAfter != null ? versionAfter - versionBefore : null;

  base.tick = {
    countDelta,
    versionDelta,
    crossCheckMatch: countDelta == null ? null : countDelta === versionDelta,
    wallMs: Math.round(wallMs * 100) / 100,
    ticksPerSec:
      countDelta != null && wallMs > 0
        ? Math.round((countDelta / (wallMs / 1000)) * 100) / 100
        : null,
    engineTickMedianMs: b.tickMedianMs ?? null,
    engineTickP95Ms: b.tickP95Ms ?? null,
    engineTickP99Ms: null, // contract does not expose a tick p99 yet
    queueDepth: b.queueDepth ?? null,
    droppedTicks: b.droppedTicks ?? null,
    // Optional per-worker peak memory: only recorded when the engine exposes it;
    // otherwise "unknown" — never estimated from the main-thread heap.
    workerPeakHeapBytes: b.workerHeapPeakBytes ?? b.peakMemoryBytes ?? "unknown",
  };
  return base;
}

function crossCheck(render, priorBig) {
  if (!priorBig || !render) return null;
  const s = render.samples;
  const medianDiff = pctDiff(s.medianMs, priorBig.medianMs);
  const p95Diff = pctDiff(s.p95Ms, priorBig.p95Ms);
  const large =
    (medianDiff != null && Math.abs(medianDiff) > 5) || (p95Diff != null && Math.abs(p95Diff) > 5);
  return {
    prior: {
      medianMs: priorBig.medianMs,
      p95Ms: priorBig.p95Ms,
      fps: priorBig.fps,
      frames: priorBig.frames,
    },
    current: {
      medianMs: s.medianMs,
      p95Ms: s.p95Ms,
      fps: s.fpsFromMedian,
      frames: s.count,
    },
    medianDiffPct: medianDiff,
    p95DiffPct: p95Diff,
    note: large
      ? "差异 >5%：需结合冷启动、采样帧数、窗口可见性与 GPU 占用在回执中说明；无数据不得宣称提升。"
      : "差异 ≤5%，在采样噪声范围内。",
  };
}

/* ------------------------------------------------------------------ */
/* one matrix cell                                                      */
/* ------------------------------------------------------------------ */

async function runOne(c, nodes, priorBig, profileDir, notes) {
  const edges = cfg.edges > 0 ? cfg.edges : nodes * 2;
  notes.push(`load(${nodes}, ${edges}, seed=${cfg.seed})`);
  await c.evaluate(`window.__adkmGpuBench.load(${nodes}, ${edges}, ${cfg.seed})`);
  await sleep(cfg.warmupMs);

  const before = await c.evaluate(HANDLE_EXPR);
  const t0 = performance.now();
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
  const wallMs = performance.now() - t0;
  const after = await c.evaluate(HANDLE_EXPR);
  await c.evaluate(`window.__adkmGpuBench.stop()`).catch(() => {});

  const render = hook ? buildRender(hook) : null;
  const layout = buildLayout(before, after, wallMs);
  const memory = await probeMemory(c, cfg.cdpPort, profileDir);

  return {
    schema: "t063-layout-bench/v1",
    timestamp: new Date().toISOString(),
    config: {
      workerCount: cfg.workers,
      tier: cfg.tier,
      sab: cfg.sab,
      seed: cfg.seed,
      frames: cfg.frames,
      warmupMs: cfg.warmupMs,
      nodes,
      edges,
    },
    render,
    layout,
    memory,
    runError,
    crossCheck: cfg.baseline && nodes === 100000 ? crossCheck(render, priorBig) : null,
  };
}

/* ------------------------------------------------------------------ */
/* main                                                                 */
/* ------------------------------------------------------------------ */

async function main() {
  mkdirSync(cfg.outDir, { recursive: true });
  const notes = [];
  const errors = [];
  let devHandle = null;
  let edge = null;
  let profileDir = "";

  const priorBig = (() => {
    if (!cfg.baseline) return null;
    try {
      const priorPath = path.join(TOOLS_DIR, "bench-100k.json");
      const prior = JSON.parse(readFileSync(priorPath, "utf8"));
      return prior.big ?? null;
    } catch (e) {
      notes.push(`prior bench-100k.json unreadable: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  })();

  try {
    devHandle = await ensureDevServer(notes, cfg.devPort, REPO_ROOT);
    log(`dev server: ${devHandle.reused ? "reused" : "spawned"}`);

    profileDir = path.join(TOOLS_DIR, `edge-profile-p063-${Date.now()}`);
    edge = spawnEdge({
      cdpPort: cfg.cdpPort,
      profileDir,
      url: benchUrl(
        { workerCount: cfg.workers, tier: cfg.tier, sab: cfg.sab },
        cfg.devPort,
      ),
    });
    log(`edge launching: ${profileDir}`);
    await waitForCdp(cfg.cdpPort, 30000);
    log("cdp endpoint answering");

    const c = await connectCdp(cfg.cdpPort, { marker: "gpu-bench=1" });
    log("cdp page connected");

    // Wait for the SPA shell to paint; dev-mode cold boot compiles the module
    // graph on demand, so the window is generous.
    await c.waitFor(
      `document.readyState === "complete" && document.body && document.body.innerText.trim().length > 0`,
      75000,
      "app shell",
    );

    const openedVia = await openGpuView(c);
    notes.push(`GPU view opened via ${openedVia}`);

    await c.waitFor(`!!window.__adkmGpuBench`, 30000, "bench hook attached");
    await c.call("Page.bringToFront");

    const vis = await c.evaluate(`({ visibility: document.visibilityState, focus: document.hasFocus() })`);
    const rafGaps = await c.evaluate(`(async () => {
      const frames = [];
      await new Promise((res) => {
        let n = 0;
        const step = () => { frames.push(performance.now()); if (++n < 10) requestAnimationFrame(step); else res(); };
        requestAnimationFrame(step);
      });
      const gaps = [];
      for (let i = 1; i < frames.length; i++) gaps.push(Number((frames[i] - frames[i - 1]).toFixed(2)));
      return gaps;
    })()`);

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
      userAgent: envProbe.ua,
      devPort: cfg.devPort,
      cdpPort: cfg.cdpPort,
      profileDir,
      rendererProbe: {
        renderer: envProbe.renderer,
        unmaskedRenderer: envProbe.raw,
        glVersion: envProbe.glVersion,
        ctxType: envProbe.ctxType,
      },
      dpr: envProbe.dpr,
      viewport: { width: envProbe.width, height: envProbe.height },
      softwareRenderer: software,
      diag: { visibility: vis.visibility, focus: vis.focus, rafGaps },
    };

    const entries = [];
    for (const nodes of cfg.nodes) {
      log(`matrix cell: nodes=${nodes}, workers=${cfg.workers}, sab=${cfg.sab}`);
      try {
        const entry = await runOne(c, nodes, priorBig, profileDir, notes);
        entries.push(entry);
        const tag = cfg.baseline ? "baseline-" : "";
        const sabTag = cfg.sab === "on" ? "on" : "off";
        const file = path.join(
          cfg.outDir,
          `${tag}layout-${cfg.workers}w-${nodes}n-sab${sabTag}.json`,
        );
        writeFileSync(
          file,
          JSON.stringify({ env, repo: { root: REPO_ROOT, git: gitHead() }, ...entry }, null, 2),
          "utf8",
        );
        log(`written: ${file}`);
        if (entry.render) {
          const s = entry.render.samples;
          log(
            `  render median=${s.medianMs}ms p95=${s.p95Ms}ms p99=${s.p99Ms}ms low1=${s.low1Ms}ms (${s.count} frames)`,
          );
        }
        if (entry.layout.tick) {
          log(
            `  tick count=${entry.layout.tick.countDelta} versionDelta=${entry.layout.tick.versionDelta} ticks/s=${entry.layout.tick.ticksPerSec}`,
          );
        } else {
          log(`  layout tick: ${entry.layout.reason}`);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ nodes, message });
        console.error(`  cell failed: ${message}`);
      }
    }

    c.close();

    const summary = {
      schema: "t063-layout-bench-summary/v1",
      timestamp: new Date().toISOString(),
      commandLine: process.argv.join(" "),
      env,
      repo: { root: REPO_ROOT, git: gitHead() },
      config: cfg,
      entries: entries.map((e) => ({
        nodes: e.config.nodes,
        edges: e.config.edges,
        render: e.render?.samples ?? null,
        layout: e.layout,
        runError: e.runError ?? null,
      })),
      notes,
      errors,
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const summaryFile = path.join(cfg.outDir, `layout-bench-summary-${stamp}.json`);
    writeFileSync(summaryFile, JSON.stringify(summary, null, 2), "utf8");
    log(`summary: ${summaryFile}`);
    log(`done. entries=${entries.length}, errors=${errors.length}`);
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
    try {
      mkdirSync(cfg.outDir, { recursive: true });
      writeFileSync(
        path.join(cfg.outDir, "layout-bench-fatal.json"),
        JSON.stringify({ timestamp: new Date().toISOString(), fatal: String(err) }, null, 2),
        "utf8",
      );
    } catch {
      /* reporting itself failed */
    }
    process.exit(1);
  });
