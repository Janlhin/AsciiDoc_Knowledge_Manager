/**
 * T-063 (#20) — layout pool benchmark: worker count × graph size × SAB on/off.
 *
 * Reuses the running Vite dev server when 1422 answers; otherwise spawns it.
 * Launches headful Edge against the app shell, dynamically imports the layout
 * client in the page, sweeps the worker / SAB matrix on synthetic graphs, and
 * writes per-tick deltas + engine stats to the tools directory. Zero new
 * dependencies; the CDP client mirrors `graph-gpu-bench.mjs`.
 *
 * Run from the repo root:
 *   node scripts/t063-pool-bench.mjs
 *
 * Env overrides:
 *   ADKM_TOOLS_DIR   evidence directory (default D:\Projects\ADKM-1127-wt\t063-tools\p063-pool)
 *   ADKM_EDGE_PATH   override the Edge executable path
 *
 * Port plan (parallel agents): this line uses dev 1422 / CDP 9402; bench keeps
 * 1420 / 9222. Do not kill processes owned by other agents.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(HERE);

const TOOLS_DIR =
  process.env.ADKM_TOOLS_DIR || "D:\\Projects\\ADKM-1127-wt\\t063-tools\\p063-pool";
const NODE_DIR = "D:\\Projects\\_tools\\node-v22.23.2";
const EDGE_PATH =
  process.env.ADKM_EDGE_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const DEV_PORT = 1422;
const CDP_PORT = 9402;
const PROFILE_DIR = path.join(TOOLS_DIR, `edge-profile-pool-${Date.now()}`);
const OUT_JSON = path.join(TOOLS_DIR, "pool-bench.json");

const requireCjs = createRequire(import.meta.url);
const WebSocket = requireCjs("ws");

const log = (...args) => console.log("[pool-bench]", ...args);

/* ---------------------------------------------------------- CDP client -- */

function getJson4(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(buf));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(2500, () => req.destroy(new Error("CDP timeout")));
  });
}

async function waitForCdp4(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await getJson4(port, "/json/version");
      return;
    } catch {
      await sleep(300);
    }
  }
  throw new Error(`CDP port ${port} did not open within ${timeoutMs} ms`);
}

/** Kill whatever listens on our CDP port (orphaned Edge from a prior run). */
function killPort(port) {
  try {
    const ps = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`],
      { encoding: "utf8" },
    );
    const pids = String(ps.stdout || "")
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s));
    for (const pid of pids) spawnSync("taskkill", ["/pid", pid, "/T", "/F"]);
  } catch {
    // best-effort only
  }
}

async function fetchTargets(port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const targets = await getJson4(port, "/json/list");
      if (Array.isArray(targets) && targets.length > 0) return targets;
    } catch {
      // transient: retry until the page target registers
    }
    await sleep(1000);
  }
  throw new Error("empty /json/list after retries");
}

async function connectCdp4(port) {
  const targets = await fetchTargets(port);
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error("no CDP page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  let seq = 0;
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const on = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id !== id) return;
        ws.off("message", on);
        if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      };
      ws.on("message", on);
      ws.send(JSON.stringify({ id, method, params }));
    });

  const logs = [];
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.method === "Log.entryAdded") {
      logs.push(`[${msg.params.entry.source}/${msg.params.entry.level}] ${msg.params.entry.text || ""}`);
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      const args = (msg.params.args || [])
        .map((a) => a.description || String(a.value ?? ""))
        .join(" ");
      logs.push(`[console/${msg.params.type}] ${args}`);
    }
  });

  await call("Log.enable");
  await call("Runtime.enable");
  const evaluate = async (expression) => {
    const r = await call("Runtime.evaluate", {
      expression: `(async () => { return (${expression}); })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        `evaluate failed: ${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails)}`,
      );
    }
    return r.result?.value;
  };

  return {
    evaluate,
    getLogs: () => logs.slice(),
    navigate: (url) => call("Page.navigate", { url }),
    close: () => ws.close(),
  };
}

/* ------------------------------------------------------ dev server ------ */

function devAliveHost(host) {
  return new Promise((resolve) => {
    const authority = host.includes(":") ? `[${host}]` : host;
    const req = http.get(`http://${authority}:${DEV_PORT}/`, (res) => {
      res.destroy();
      resolve(res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function devAlive() {
  const [v4, v6, local] = await Promise.all([
    devAliveHost("127.0.0.1"),
    devAliveHost("::1"),
    devAliveHost("localhost"),
  ]);
  return v4 || v6 || local;
}

async function ensureDevServer(notes) {
  if (await devAlive()) return { child: null, reused: true };
  const env = { ...process.env, PATH: `${NODE_DIR};${process.env.PATH}` };
  const child = spawn(process.env.ComSpec, ["/d", "/s", "/c", "npm", "run", "dev", "--", "--port", String(DEV_PORT)], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (c) => notes.push(String(c).trim().slice(0, 300)));
  child.stderr.on("data", (c) => notes.push(String(c).trim().slice(0, 300)));
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await devAlive()) return { child, reused: false };
    await sleep(500);
  }
  spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  throw new Error("dev server did not come up within 90s");
}

/* --------------------------------------------------------- in-page ----- */

/**
 * Build the in-page sweep expression. CDP cannot hand a function back over
 * `returnByValue`, so the whole sweep runs inside one evaluated async IIFE;
 * configs are embedded as JSON. Each handle runs a warmup window then a sample
 * window; onTick deltas are returned raw and summarised in Node.
 */
function pageExpr(configs) {
  return `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    function benchRng(seed) {
      let s = (seed >>> 0) || 1;
      return () => {
        s ^= (s << 13) >>> 0;
        s ^= s >>> 17;
        s ^= (s << 5) >>> 0;
        s >>>= 0;
        return s / 4294967296;
      };
    }
    function makeGraph(n, e, seed) {
      const rnd = benchRng(seed);
      const degree = new Array(n).fill(0);
      const nodes = Array.from({ length: n }, (_, i) => ({ id: 'n' + i, label: 'n' + i, resolved: true, degree: 0 }));
      const edges = [];
      for (let k = 0; k < e; k++) {
        const a = Math.floor(rnd() * n);
        let b = Math.floor(rnd() * n);
        if (b === a) b = (b + 1) % n;
        edges.push({ source: a, target: b, broken: false });
        degree[a]++; degree[b]++;
      }
      nodes.forEach((nd, i) => { nd.degree = degree[i]; });
      return { nodes, edges };
    }
    const client = await import('/src/features/graph/gpu/layout-client.ts');
    const shard = await import('/src/features/graph/gpu/layout/shard.ts');
    const out = [];
    for (const cfg of ${JSON.stringify(configs)}) {
      try {
        const graph = makeGraph(cfg.nodes, cfg.edges, 1);
        const plan = shard.buildShardPlan(graph, Math.max(1, cfg.workers));
        const handle = client.createAsyncLayout(graph, { seed: 1 }, { forceWorkers: cfg.workers, sab: cfg.sab });
        const deltas = [];
        let prev = null;
        const off = handle.onTick(() => {
          const now = performance.now();
          if (prev != null) deltas.push(now - prev);
          prev = now;
        });
        handle.start();
        await sleep(cfg.warmupMs);
        prev = null;
        await sleep(cfg.sampleMs);
        handle.stop();
        const stats = handle.stats();
        out.push({
          config: cfg,
          mode: handle.mode,
          crossEdges: plan.crossEdgeCount,
          intraEdges: plan.intraEdgeCount,
          deltas,
          stats,
          debug: handle.debugState,
        });
        off();
        handle.destroy();
        await sleep(400);
      } catch (err) {
        out.push({
          config: cfg,
          mode: "error",
          error: err && (err.stack || err.message) || String(err),
          deltas: [],
          stats: null,
        });
      }
    }
    return { isolated: crossOriginIsolated, sabConstructible: typeof SharedArrayBuffer !== 'undefined', out };
  })()`;
}

const CONFIGS = [
  { nodes: 100_000, edges: 200_000, workers: 1, sab: true, warmupMs: 2500, sampleMs: 3000 },
  { nodes: 100_000, edges: 200_000, workers: 2, sab: true, warmupMs: 2000, sampleMs: 3000 },
  { nodes: 100_000, edges: 200_000, workers: 4, sab: true, warmupMs: 2000, sampleMs: 3000 },
  { nodes: 100_000, edges: 200_000, workers: 4, sab: false, warmupMs: 2000, sampleMs: 3000 },
  { nodes: 100_000, edges: 200_000, workers: 8, sab: true, warmupMs: 2000, sampleMs: 3000 },
  { nodes: 200_000, edges: 400_000, workers: 4, sab: true, warmupMs: 3000, sampleMs: 3000 },
  { nodes: 200_000, edges: 400_000, workers: 8, sab: true, warmupMs: 3000, sampleMs: 3000 },
];

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

function summarize(deltas) {
  const sorted = [...deltas].sort((a, b) => a - b);
  return {
    samples: deltas.length,
    medianMs: quantile(sorted, 0.5),
    p95Ms: quantile(sorted, 0.95),
    p99Ms: quantile(sorted, 0.99),
    minMs: sorted[0] ?? null,
    maxMs: sorted[sorted.length - 1] ?? null,
  };
}

async function main() {
  mkdirSync(TOOLS_DIR, { recursive: true });
  const notes = [];
  let devHandle = null;
  killPort(CDP_PORT);
  try {
    devHandle = await ensureDevServer(notes);

    const edge = spawn(EDGE_PATH, [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=CalculateNativeWinOcclusion,msEdgeStartupBoost",
      "--window-size=1600,1000",
    ], { stdio: "ignore" });

    await waitForCdp4(CDP_PORT, 60000);
    const c = await connectCdp4(CDP_PORT);
    // The launcher can drop the URL argument under a fresh profile; navigate
    // explicitly over CDP so the shell is guaranteed to load.
    await c.navigate(`http://localhost:${DEV_PORT}/`);

    // wait for the SPA shell to paint
    const deadline = Date.now() + 75000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await c.evaluate(`document.readyState === 'complete' && document.body && document.body.innerText.trim().length > 0`);
      if (ready) break;
      await sleep(200);
    }
    if (!ready) throw new Error("app shell did not populate");

    const env = await c.evaluate(`({
      ua: navigator.userAgent,
      cores: navigator.hardwareConcurrency,
      dpr: window.devicePixelRatio || 1,
      width: window.innerWidth,
      height: window.innerHeight,
    })`);

    const report = await c.evaluate(pageExpr(CONFIGS));
    for (const line of c.getLogs()) notes.push(line);

    const results = report.out.map((r) => ({
      ...r.config,
      mode: r.mode,
      error: r.error ?? null,
      crossEdges: r.crossEdges,
      intraEdges: r.intraEdges,
      crossEdgeRatio: r.intraEdges + r.crossEdges > 0 ? r.crossEdges / (r.intraEdges + r.crossEdges) : 0,
      timing: summarize(r.deltas),
      stats: r.stats,
      debug: r.debug ?? null,
    }));

    const out = {
      schema: "t063-pool-bench/v1",
      timestamp: new Date().toISOString(),
      commandLine: process.argv.join(" "),
      env: { ...env, isolated: report.isolated, sabConstructible: report.sabConstructible },
      results,
      notes,
    };
    writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), "utf8");

    for (const r of results) {
      log(
        `n=${r.nodes} e=${r.edges} w=${r.workers} sab=${r.sab}`,
        `median=${r.timing.medianMs?.toFixed(2)}ms`,
        `p95=${r.timing.p95Ms?.toFixed(2)}ms`,
        `p99=${r.timing.p99Ms?.toFixed(2)}ms`,
        `tier=${r.stats?.tier ?? "?"} mode=${r.mode}`,
        `dropped=${r.stats?.droppedTicks ?? "?"}`,
        r.error ? `error=${r.error.slice(0, 160)}` : "",
      );
    }
    log(`written: ${OUT_JSON}`);
    c.close();
    killPort(CDP_PORT);
    return 0;
  } catch (err) {
    const fatal = err instanceof Error ? err.message : String(err);
    console.error("[pool-bench] fatal:", fatal);
    writeFileSync(
      OUT_JSON,
      JSON.stringify({ schema: "t063-pool-bench/v1", timestamp: new Date().toISOString(), fatal, notes }, null, 2),
      "utf8",
    );
    return 1;
  } finally {
    if (devHandle && !devHandle.reused) {
      spawnSync("taskkill", ["/pid", String(devHandle.child.pid), "/T", "/F"]);
    }
  }
}

main().then((code) => process.exit(code));
