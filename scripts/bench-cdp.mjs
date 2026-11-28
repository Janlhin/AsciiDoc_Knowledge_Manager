/**
 * T-063 / Issue #19 #20 — shared CDP + dev-server + Edge lifecycle helpers.
 *
 * Used by `layout-bench.mjs` (matrix benchmark) and `layout-soak.mjs` (30-minute
 * soak). Zero new dependencies: Node http + the `ws` package already in the
 * toolchain.
 *
 * Cleanup is PRECISE, not a broad tree kill:
 *  - dev server: kill only the PID listening on this lane's dev port;
 *  - Edge: kill only msedge.exe whose command line carries this run's unique
 *    profile directory.
 * Other lanes' processes (and the user's everyday Edge) are never touched.
 *
 * Port convention for the parallel T-063 lanes: this lane owns dev 1420 and
 * CDP 9222. Other lanes use 1421/9401, 1422/9402, 1423/9403 — do not take
 * their ports or their profile directories.
 */
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { sleep } from "./bench-stats.mjs";
import { osEdgeTree } from "./bench-procs.mjs";

const requireCjs = createRequire(import.meta.url);
const WebSocket = requireCjs("ws");

export const NODE_DIR = "D:\\Projects\\_tools\\node-v22.23.2";
export const EDGE_PATH =
  process.env.ADKM_EDGE_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
export const DEV_PORT = 1420;
export const CDP_PORT = 9222;

const CDP_HOSTS = ["127.0.0.1", "::1"];

export { sleep };

/* ------------------------------------------------------------------ */
/* CDP transport                                                       */
/* ------------------------------------------------------------------ */

function getJson(host, port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: host, port, path: pathname, family: host === "::1" ? 6 : 4 },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(2500, () => req.destroy(new Error("CDP timeout")));
  });
}

/** `/json/list` on every answering stack; one Edge may fall back to IPv6 when
 *  the IPv4 debug port is already held by another process. */
async function listCdpTargets(port) {
  const found = [];
  for (const host of CDP_HOSTS) {
    try {
      const targets = await getJson(host, port, "/json/list");
      found.push({ host, targets });
    } catch {
      /* not answering on this stack */
    }
  }
  return found;
}

export async function waitForCdp(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const lists = await listCdpTargets(port);
    if (lists.some((l) => l.targets.length > 0)) return;
    await sleep(300);
  }
  throw new Error(`CDP port ${port} did not open within ${timeoutMs} ms`);
}

/**
 * @param {number} port
 * @param {{ marker?: string }} [opts] marker: substring the target page URL
 *   must contain (e.g. "gpu-bench=1") so we never attach to the everyday Edge.
 */
export async function connectCdp(port, opts = {}) {
  const { marker } = opts;
  const lists = await listCdpTargets(port);
  let page = null;
  for (const { targets } of lists) {
    const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (marker) {
      page = pages.find((t) => String(t.url || "").includes(marker));
    } else {
      page = pages[0];
    }
    if (page) break;
  }
  if (!page) {
    throw new Error(`no CDP page target${marker ? ` matching ${marker}` : ""}`);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("CDP page WebSocket open timeout (15s)"));
    }, 15000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
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
      const e = msg.params.entry;
      logs.push(`[${e?.source || "page"}/${e?.level || "info"}] ${e?.text || ""}`);
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      const args = (msg.params.args || [])
        .map((a) => a.description || String(a.value ?? ""))
        .join(" ");
      logs.push(`[console/${msg.params.type}] ${args}`);
    }
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

  const waitFor = async (expression, timeoutMs = 30000, label = expression) => {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await evaluate(expression);
      if (last) return last;
      await sleep(150);
    }
    throw new Error(`waitFor timed out: ${label} (last=${JSON.stringify(last)})`);
  };

  return { evaluate, waitFor, call, getLogs: () => logs.slice(), close: () => ws.close() };
}

export function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/* ------------------------------------------------------------------ */
/* dev server: reuse an answering instance, else spawn our own one      */
/* ------------------------------------------------------------------ */

function devAliveHost(host, devPort) {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: host, port: devPort, path: "/", family: host === "::1" ? 6 : 4 },
      (res) => {
        res.destroy();
        resolve(res.statusCode < 500);
      },
    );
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function devAlive(devPort) {
  const [v4, v6] = await Promise.all([
    devAliveHost("127.0.0.1", devPort),
    devAliveHost("::1", devPort),
  ]);
  return v4 || v6;
}

/**
 * @param {string[]} notes log sink
 * @param {number} devPort
 * @param {string} repoRoot
 */
export async function ensureDevServer(notes, devPort, repoRoot) {
  if (await devAlive(devPort)) return { child: null, reused: true };
  const env = { ...process.env, PATH: `${NODE_DIR};${process.env.PATH}` };
  const child = spawn(process.env.ComSpec, ["/d", "/s", "/c", "npm", "run", "dev"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => notes.push(String(chunk).trim().slice(0, 300)));
  child.stderr.on("data", (chunk) => notes.push(String(chunk).trim().slice(0, 300)));
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await devAlive(devPort)) return { child, reused: false };
    await sleep(500);
  }
  killDevServer(devPort);
  throw new Error("dev server did not come up within 90s");
}

/** Kill only the PID LISTENING on this lane's dev port. No ancestor walk. */
export function killDevServer(port) {
  const pids = new Set();
  try {
    const out = spawnSync("netstat", ["-ano"], { encoding: "utf8" }).stdout || "";
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+(?:127\.0\.0\.1|\[::1\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
      if (m && Number(m[1]) === port) {
        const pid = Number(m[2]);
        if (pid > 0) pids.add(pid);
      }
    }
  } catch {
    /* netstat unavailable: leave the server to the next reuse check */
  }
  for (const pid of pids) spawnSync("taskkill", ["/PID", String(pid), "/F"]);
}

/** Kill only msedge.exe carrying this run's unique profile directory. */
export function killEdgeTree(profileDir) {
  if (!profileDir) return;
  const safe = String(profileDir).replace(/'/g, "''");
  const script =
    `(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | ` +
    `Where-Object { $_.CommandLine -like '*${safe}*' }).ProcessId`;
  try {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", timeout: 10000 },
    );
    const pids = String(r.stdout || "")
      .split(/\s+/)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
    for (const pid of pids) spawnSync("taskkill", ["/PID", String(pid), "/F"]);
  } catch {
    /* best effort; removeProfile retries below */
  }
}

export async function removeProfile(dir) {
  for (let i = 0; i < 3; i += 1) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      return;
    } catch (e) {
      if (i === 2) console.error("[bench-cdp] profile cleanup skipped:", e.message);
      await sleep(500);
    }
  }
}

export function edgeVersion() {
  const res = spawnSync(EDGE_PATH, ["--version"], { encoding: "utf8", timeout: 5000 });
  return String(res.stdout || res.stderr || "").trim() || "unknown";
}

/* ------------------------------------------------------------------ */
/* in-page probes                                                       */
/* ------------------------------------------------------------------ */

export const ENV_PROBE_EXPR = `(() => {
  const canvas = document.querySelector('[data-testid="gpu-canvas"]') || document.querySelector('canvas');
  let renderer = "no-canvas";
  let raw = null;
  let glVersion = null;
  let ctxType = null;
  if (canvas) {
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (gl) {
      ctxType = canvas.getContext("webgl2") ? "webgl2" : "webgl";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      if (ext) raw = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      renderer = raw || gl.getParameter(gl.RENDERER) || "unknown";
      glVersion = gl.getParameter(gl.VERSION);
    } else {
      renderer = "no-webgl-context";
    }
  }
  return {
    renderer, raw, glVersion, ctxType,
    dpr: window.devicePixelRatio || 1,
    width: window.innerWidth, height: window.innerHeight,
    ua: navigator.userAgent,
  };
})()`;

export const HEAP_EXPR = `(() => {
  const m = performance.memory;
  if (!m) return null;
  return {
    usedJSHeapSize: m.usedJSHeapSize,
    totalJSHeapSize: m.totalJSHeapSize,
    jsHeapSizeLimit: m.jsHeapSizeLimit,
  };
})()`;

/**
 * Reach the layout handle through every accessor the contract may expose.
 * On the pre-merge baseline none exists; `available=false` + reason is the
 * honest result, and callers must not invent tick numbers.
 */
export const HANDLE_EXPR = `(() => {
  const bench = window.__adkmGpuBench;
  if (!bench) return { available: false, reason: "bench hook missing" };
  const h = bench.handle
    ?? (typeof bench.getHandle === "function" ? bench.getHandle() : null)
    ?? window.__adkmLayoutHandle ?? null;
  if (!h) return { available: false, reason: "layout handle not exposed by this build (pool/motion lanes not merged)" };
  let stats = null;
  try { stats = typeof h.stats === "function" ? h.stats() : null; }
  catch (e) { stats = { error: String(e) }; }
  let targets = null;
  try {
    if (h.targets) targets = { count: h.targets.count, version: h.targets.version };
  } catch (e) { targets = { error: String(e) }; }
  return { available: true, mode: h.mode ?? null, stats, targets };
})()`;

export const SOFTWARE_RE =
  /swiftshader|llvmpipe|softpipe|basic\s*render|software\s*opengl|microsoft basic/i;

/* ------------------------------------------------------------------ */
/* CDP-side memory / process probes                                     */
/* ------------------------------------------------------------------ */

/** Browser-level CDP connection (SystemInfo.* is only supported there). */
async function browserCdp(port) {
  const lists = await listCdpTargets(port);
  if (lists.length === 0) throw new Error("no CDP endpoint answering");
  const ver = await getJson(lists[0].host, port, "/json/version");
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("CDP browser WebSocket open timeout (15s)"));
    }, 15000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
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
  return { call, close: () => ws.close() };
}

export async function probeCdpProcess(port) {
  try {
    const b = await browserCdp(port);
    const info = await b.call("SystemInfo.getProcessInfo");
    b.close();
    return {
      available: true,
      processes: (info.processInfo || []).map((p) => ({
        pid: p.pid,
        type: p.type,
        cpuTime: p.cpuTime ?? null,
        memory: p.memory ?? null,
      })),
    };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : String(e), processes: [] };
  }
}

export async function probeCdpMetrics(c) {
  try {
    const m = await c.call("Performance.getMetrics");
    const map = {};
    for (const item of m.metrics || []) map[item.name] = item.value;
    return { available: true, metrics: map };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : String(e), metrics: {} };
  }
}

/**
 * Full memory snapshot: in-page V8 heap, CDP process info, CDP metrics, OS
 * RSS + threads for this run's own Edge tree. Missing sources stay null.
 */
export async function probeMemory(c, port, profileDir) {
  const pageHeap = await c.evaluate(HEAP_EXPR).catch(() => null);
  const [cdpProcess, cdpMetrics, os] = await Promise.all([
    probeCdpProcess(port),
    probeCdpMetrics(c),
    Promise.resolve(osEdgeTree(profileDir)),
  ]);
  return { pageHeap, cdpProcess, cdpMetrics, os };
}

/** Build the bench URL with the matrix params (only honoured when the build reads them). */
export function benchUrl(params, devPort) {
  const search = new URLSearchParams({ "gpu-bench": "1" });
  if (params.workerCount != null) search.set("benchWorkerCount", String(params.workerCount));
  if (params.tier && params.tier !== "auto") search.set("benchTier", params.tier);
  if (params.sab === "off") search.set("benchSab", "off");
  return `http://localhost:${devPort}/?${search.toString()}`;
}

/** Spawn our own headful Edge with a fresh empty profile; returns the child. */
export function spawnEdge({ cdpPort, profileDir, url }) {
  mkdirSync(path.dirname(profileDir), { recursive: true });
  const edgeArgs = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion,msEdgeStartupBoost",
    "--window-size=1600,1000",
    "--window-position=0,0",
    url,
  ];
  return spawn(EDGE_PATH, edgeArgs, { stdio: "ignore" });
}

/** Open the standalone GPU graph view through the app handle; reports which path worked. */
export async function openGpuView(c) {
  return c.evaluate(`(() => {
    const app = window.geode && window.geode.app;
    if (app && app.workspace && typeof app.workspace.openGpuGraph === "function") {
      app.workspace.openGpuGraph();
      return "workspace.openGpuGraph";
    }
    if (app && app.commands && typeof app.commands.execute === "function") {
      app.commands.execute("app:open-gpu-graph");
      return "commands.execute";
    }
    return "none";
  })()`);
}
