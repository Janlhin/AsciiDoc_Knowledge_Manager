/**
 * T-063 / Issue #19 #20 — long-run soak: continuous pan/zoom + layout, sampling
 * heap / RSS / threads / tick progress every `--interval` seconds, then a
 * linear-regression verdict on whether anything grows monotonically.
 *
 * Default run is 30 minutes (Issue #20 soak requirement). Use `--minutes=3`
 * for a smoke run that proves the harness works without waiting half an hour.
 *
 * What the verdict means:
 *  - `stable`: no series shows a statistically supported upward slope
 *    (provisional bands: heap > 2 MiB/min, RSS > 5 MiB/min, threads > 0.5/min,
 *    R² ≥ 0.8; see `docs/t063-bench.adoc` — bands are provisional until the
 *    post-merge baseline sets them from real data).
 *  - `growing`: at least one series crosses its band with R² ≥ 0.8.
 *  - `unknown`: the source was unavailable for that series (e.g. handle not
 *    exposed on the pre-merge baseline); absence of data is not "stable".
 *
 * Memory sources, in order: in-page `performance.memory` (V8 heap), CDP
 * `Performance.getMetrics` heap, OS WorkingSet64 + thread count for this run's
 * own Edge tree. Missing sources stay null; nothing is estimated.
 *
 * Usage:
 *   node scripts/layout-soak.mjs --help
 *   node scripts/layout-soak.mjs --minutes=3            # smoke
 *   node scripts/layout-soak.mjs --minutes=30 --interval=30
 *
 * Env overrides: ADKM_TOOLS_DIR, ADKM_EDGE_PATH.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  machineInfo,
  gitHead,
  parseFlags,
  flagInt,
  flagNumList,
  sleep,
} from "./bench-stats.mjs";
import {
  DEV_PORT,
  CDP_PORT,
  ensureDevServer,
  killDevServer,
  killEdgeTree,
  removeProfile,
  edgeVersion,
  connectCdp,
  waitForCdp,
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

const log = (...args) => console.log("[layout-soak]", ...args);

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

function printHelp() {
  console.log(`layout-soak.mjs — T-063 long-run soak (pan/zoom + layout)

Options:
  --minutes=<n>      soak duration in minutes (default 30; use 3 for smoke)
  --interval=<n>     sample interval in seconds (default 30)
  --nodes=<n>        synthetic node count (default 100000)
  --edges=<n>        edge count (default 2 × nodes)
  --seed=<n>         fixture seed (default 1)
  --workers=<n>      requested benchWorkerCount (recorded; may be ignored pre-merge)
  --tier=<S|A|B|C>   requested benchTier (default auto)
  --sab=<on|off>     requested benchSab (default off)
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
  minutes: flagInt(flags, "minutes", 30),
  intervalSec: flagInt(flags, "interval", 30),
  nodes: flagNumList(flags, "nodes", [100000])[0] ?? 100000,
  edges: flagInt(flags, "edges", 0),
  seed: flagInt(flags, "seed", 1),
  workers: flagInt(flags, "workers", 1),
  tier: typeof flags.tier === "string" ? flags.tier : "auto",
  sab: flags.sab === "on" ? "on" : "off",
  cdpPort: flagInt(flags, "cdp", CDP_PORT),
  devPort: flagInt(flags, "port", DEV_PORT),
  outDir: typeof flags["out-dir"] === "string" ? flags["out-dir"] : OUT_DIR,
};

if (cfg.minutes <= 0 || cfg.intervalSec <= 0) {
  console.error("参数错误：--minutes / --interval 必须为正整数");
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* interaction drivers                                                   */
/* ------------------------------------------------------------------ */

async function canvasCenter(c) {
  return c.evaluate(`(() => {
    const el = document.querySelector('[data-testid="gpu-canvas"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
}

async function zoom(c, center, deltaY) {
  await c.call("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: center.x,
    y: center.y,
    deltaX: 0,
    deltaY,
  });
}

async function panDrag(c, center) {
  const dx = 80;
  const dy = 40;
  await c.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: center.x,
    y: center.y,
    button: "left",
    clickCount: 1,
  });
  for (let i = 1; i <= 3; i += 1) {
    await c.call("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: center.x + (dx * i) / 3,
      y: center.y + (dy * i) / 3,
      button: "left",
    });
    await sleep(30);
  }
  await c.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: center.x + dx,
    y: center.y + dy,
    button: "left",
    clickCount: 1,
  });
}

/** One sample: memory snapshot + handle stats snapshot. */
async function sample(c, profileDir, tSec) {
  const memory = await probeMemory(c, cfg.cdpPort, profileDir);
  const handle = await c.evaluate(HANDLE_EXPR);
  const stats = handle.stats ?? null;
  return {
    tSec: Math.round(tSec * 100) / 100,
    heapUsedBytes: memory.pageHeap?.usedJSHeapSize ?? null,
    totalJSHeapBytes: memory.pageHeap?.totalJSHeapSize ?? null,
    rssBytes: memory.os.rssBytes,
    threads: memory.os.threads,
    cdpHeapUsedSize: memory.cdpMetrics.metrics?.HeapUsedSize ?? null,
    tickCount: stats?.tickCount ?? null,
    tickVersion: handle.targets?.version ?? null,
    workers: stats?.workers ?? null,
    tier: stats?.tier ?? null,
    tierReason: stats?.tierReason ?? null,
    sab: stats?.sab ?? null,
    wasm: stats?.wasm ?? null,
    queueDepth: stats?.queueDepth ?? null,
    droppedTicks: stats?.droppedTicks ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* regression + verdict                                                  */
/* ------------------------------------------------------------------ */

/** Ordinary least squares over the sample index; slope converted to per-minute. */
function regression(ys, sampleIntervalSec) {
  const n = ys.length;
  const validCount = ys.filter((v) => v != null).length;
  if (n < 2 || validCount < 2) {
    return { slopePerMin: null, r2: null, samples: validCount };
  }
  const xs = ys.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + (b ?? 0), 0) / validCount;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    if (ys[i] == null) continue;
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
    syy += (ys[i] - meanY) ** 2;
  }
  const slope = sxx === 0 ? null : sxy / sxx;
  const r2 = sxx === 0 || syy === 0 ? null : (sxy * sxy) / (sxx * syy);
  return {
    slopePerMin: slope == null ? null : Math.round((slope / (sampleIntervalSec / 60)) * 100) / 100,
    r2: r2 == null ? null : Math.round(r2 * 10000) / 10000,
    samples: validCount,
  };
}

/** Provisional growth bands; see docs/t063-bench.adoc for the fail-upgrade path. */
const BANDS = {
  heapUsedBytes: { slopePerMin: 2 * 1024 * 1024, label: "heap" },
  rssBytes: { slopePerMin: 5 * 1024 * 1024, label: "rss" },
  threads: { slopePerMin: 0.5, label: "threads" },
};

function seriesVerdict(reg, band) {
  if (reg.slopePerMin == null || reg.r2 == null) return "unknown";
  if (reg.slopePerMin > band.slopePerMin && reg.r2 >= 0.8) return "growing";
  return "stable";
}

/* ------------------------------------------------------------------ */
/* main                                                                 */
/* ------------------------------------------------------------------ */

async function main() {
  mkdirSync(cfg.outDir, { recursive: true });
  const notes = [];
  let devHandle = null;
  let edge = null;
  let profileDir = "";

  try {
    devHandle = await ensureDevServer(notes, cfg.devPort, REPO_ROOT);

    profileDir = path.join(TOOLS_DIR, `edge-profile-soak-${Date.now()}`);
    edge = spawnEdge({
      cdpPort: cfg.cdpPort,
      profileDir,
      url: benchUrl(
        { workerCount: cfg.workers, tier: cfg.tier, sab: cfg.sab },
        cfg.devPort,
      ),
    });
    await waitForCdp(cfg.cdpPort, 30000);

    const c = await connectCdp(cfg.cdpPort, { marker: "gpu-bench=1" });
    await c.waitFor(
      `document.readyState === "complete" && document.body && document.body.innerText.trim().length > 0`,
      75000,
      "app shell",
    );
    notes.push(`GPU view opened via ${await openGpuView(c)}`);
    await c.waitFor(`!!window.__adkmGpuBench`, 30000, "bench hook attached");
    await c.call("Page.bringToFront");

    const envProbe = await c.evaluate(ENV_PROBE_EXPR);
    const software = SOFTWARE_RE.test(String(envProbe.renderer || ""));
    let browserVersion = "unknown";
    try {
      const bv = await c.call("Browser.getVersion");
      browserVersion = bv.product || bv.userAgent || "unknown";
    } catch {
      /* optional probe */
    }

    const edges = cfg.edges > 0 ? cfg.edges : cfg.nodes * 2;
    await c.evaluate(`window.__adkmGpuBench.load(${cfg.nodes}, ${edges}, ${cfg.seed})`);
    await sleep(4000);

    const samples = [];
    const startedAt = Date.now();
    const deadline = startedAt + cfg.minutes * 60_000;
    let zoomIn = true;

    while (Date.now() < deadline) {
      const tSec = (Date.now() - startedAt) / 1000;
      samples.push(await sample(c, profileDir, tSec));

      // Drive interaction between samples: one pan drag + two zoom steps.
      const center = await canvasCenter(c);
      if (center) {
        await panDrag(c, center);
        await zoom(c, center, zoomIn ? -120 : 120);
        zoomIn = !zoomIn;
        await zoom(c, center, zoomIn ? -120 : 120);
        zoomIn = !zoomIn;
      }

      const remain = deadline - Date.now();
      if (remain <= 0) break;
      await sleep(Math.min(cfg.intervalSec * 1000, remain));
    }

    const series = {
      heapUsedBytes: regression(samples.map((s) => s.heapUsedBytes), cfg.intervalSec),
      rssBytes: regression(samples.map((s) => s.rssBytes), cfg.intervalSec),
      threads: regression(samples.map((s) => s.threads), cfg.intervalSec),
    };
    const verdicts = {
      heapUsedBytes: seriesVerdict(series.heapUsedBytes, BANDS.heapUsedBytes),
      rssBytes: seriesVerdict(series.rssBytes, BANDS.rssBytes),
      threads: seriesVerdict(series.threads, BANDS.threads),
    };
    const overall = Object.values(verdicts).includes("growing")
      ? "growing"
      : Object.values(verdicts).includes("unknown")
        ? "unknown"
        : "stable";

    const tickStart = samples[0]?.tickCount ?? null;
    const tickEnd = samples.at(-1)?.tickCount ?? null;
    const report = {
      schema: "t063-layout-soak/v1",
      timestamp: new Date().toISOString(),
      commandLine: process.argv.join(" "),
      repo: { root: REPO_ROOT, git: gitHead() },
      env: {
        machine: machineInfo(),
        headless: false,
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
      },
      config: {
        minutes: cfg.minutes,
        intervalSec: cfg.intervalSec,
        nodes: cfg.nodes,
        edges,
        seed: cfg.seed,
        workerCount: cfg.workers,
        tier: cfg.tier,
        sab: cfg.sab,
      },
      samples,
      regression: series,
      verdicts,
      overall,
      tickProgress: {
        start: tickStart,
        end: tickEnd,
        advanced: tickStart != null && tickEnd != null ? tickEnd - tickStart : null,
      },
      bands: BANDS,
      notes,
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(cfg.outDir, `soak-${cfg.nodes}-${cfg.minutes}min-${stamp}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
    log(`written: ${file}`);
    log(`overall=${overall} verdicts=${JSON.stringify(verdicts)} samples=${samples.length}`);
    log(`tick progress: ${tickStart} → ${tickEnd}`);
    return 0;
  } finally {
    if (edge) killEdgeTree(profileDir);
    if (profileDir) await removeProfile(profileDir);
    if (devHandle && !devHandle.reused) killDevServer(cfg.devPort);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[layout-soak] fatal:", err);
    process.exit(1);
  });
