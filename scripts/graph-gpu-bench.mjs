/**
 * T-063 GPU graph view — reproducible performance benchmark (D 归属).
 *
 * Reuses the running Vite dev server when 1420 answers; otherwise spawns it.
 * Launches a headful Edge against the app, drives the frozen
 * `window.__adkmGpuBench` hook through a 100k / 200k synthetic graph and a
 * small 400 / 800 control graph, and writes raw per-frame samples plus the
 * full environment facts to the tools directory. Zero new dependencies.
 *
 * Re-runnable hygiene: every attempt gets a fresh empty profile directory and
 * its own CDP port (9333/9334/9335); only the process tree this script spawned
 * is killed. If every headful attempt fails, one `--headless=new` attempt runs
 * as a fallback and is flagged headless=true in the JSON. If the browser path
 * still cannot be driven, the 100k numbers are recorded as
 * "未测（浏览器自动化环境受限）" with the raw error — never fabricated.
 *
 * Run from the repo root:
 *   node scripts/graph-gpu-bench.mjs
 *
 * Env overrides:
 *   ADKM_TOOLS_DIR    evidence directory
 *   ADKM_EDGE_PATH    override the Edge executable path
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(HERE);

const TOOLS_DIR =
  process.env.ADKM_TOOLS_DIR || "D:\\Projects\\ADKM-1127-wt\\t063-tools";
const NODE_DIR = "D:\\Projects\\_tools\\node-v22.23.2";
const EDGE_PATH =
  process.env.ADKM_EDGE_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const DEV_PORT = 1420;
const PORT_BASE = 9333;
const HEADFUL_ATTEMPTS = 3;
/** one extra headless=new attempt only if all headful attempts failed */
const HEADLESS_FALLBACK = true;

const OUT_JSON = path.join(TOOLS_DIR, "bench-100k.json");
const ERR_JSON = path.join(TOOLS_DIR, "bench-error.json");

const THRESHOLD = { fpsMin: 60, p95MaxMs: 20 };

/** Strings that identify a software / fallback WebGL renderer. */
const SOFTWARE_RE =
  /swiftshader|llvmpipe|softpipe|basic\s*render|software\s*opengl|microsoft basic/i;

const log = (...args) => console.log("[gpu-bench]", ...args);

/* ------------------------------------------------------------------ */
/* minimal CDP client (desktop Edge binds 127.0.0.1, unlike WebView2)   */
/* ------------------------------------------------------------------ */

const requireCjs = createRequire(import.meta.url);
const WebSocket = requireCjs("ws");

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

async function connectCdp4(port) {
  const targets = await getJson4(port, "/json/list");
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error("no CDP page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  const logs = [];
  const pushEntry = (entry) => {
    if (!entry) return;
    logs.push(`[${entry.source || "page"}/${entry.level || "info"}] ${entry.text || ""}`);
  };
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.method === "Log.entryAdded") pushEntry(msg.params.entry);
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

  const waitFor = async (expression, timeoutMs = 8000, label = expression) => {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await evaluate(expression);
      if (last) return last;
      await sleep(150);
    }
    throw new Error(`waitFor timed out: ${label} (last=${JSON.stringify(last)})`);
  };

  const getLogs = () => logs.slice();

  return { evaluate, waitFor, call, getLogs, close: () => ws.close() };
}

/* ------------------------------------------------------------------ */
/* dev server: reuse an answering 1420 instance, else spawn one          */
/* ------------------------------------------------------------------ */

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

/** Vite may bind ::1 only, so probe IPv4, IPv6 loopback and localhost. */
async function devAlive() {
  const [v4, v6, local] = await Promise.all([
    devAliveHost("127.0.0.1"),
    devAliveHost("::1"),
    devAliveHost("localhost"),
  ]);
  return v4 || v6 || local;
}

async function ensureDevServer(notes) {
  if (await devAlive()) {
    return { child: null, port: DEV_PORT, reused: true };
  }
  const env = { ...process.env, PATH: `${NODE_DIR};${process.env.PATH}` };
  const child = spawn(
    process.env.ComSpec,
    ["/d", "/s", "/c", "npm", "run", "dev"],
    { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (chunk) => notes.push(String(chunk).trim().slice(0, 300)));
  child.stderr.on("data", (chunk) => notes.push(String(chunk).trim().slice(0, 300)));

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await devAlive()) return { child, port: DEV_PORT, reused: false };
    await sleep(500);
  }
  killTree(child);
  throw new Error("dev server did not come up within 90s");
}

/* ------------------------------------------------------------------ */
/* process / profile cleanup                                            */
/* ------------------------------------------------------------------ */

function killTree(child) {
  if (!child || child.pid == null) return;
  spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
}

async function removeProfile(dir) {
  for (let i = 0; i < 3; i += 1) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      return;
    } catch (e) {
      if (i === 2) log("profile dir cleanup skipped:", e.message);
      await sleep(500);
    }
  }
}

function edgeVersion() {
  const res = spawnSync(EDGE_PATH, ["--version"], { encoding: "utf8", timeout: 5000 });
  const v = String(res.stdout || res.stderr || "").trim();
  return v || "unknown";
}

/* ------------------------------------------------------------------ */
/* in-page probes                                                      */
/* ------------------------------------------------------------------ */

const ENV_PROBE_EXPR = `(() => {
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
    renderer,
    raw,
    glVersion,
    ctxType,
    dpr: window.devicePixelRatio || 1,
    width: window.innerWidth,
    height: window.innerHeight,
    ua: navigator.userAgent,
  };
})()`;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/** Wait until the SPA has actually painted: document complete + non-empty body. */
async function waitBodyPopulated(c, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await c.evaluate(
      `document.readyState === "complete" && document.body && document.body.innerText.trim().length > 0`,
    );
    if (ready) return;
    await sleep(150);
  }
  const url = await c.evaluate(`location.href`);
  const bodyLen = await c.evaluate(
    `document.body ? document.body.innerText.trim().length : -1`,
  );
  const logs = c.getLogs().slice(0, 8);
  throw new Error(
    `app shell empty after ${timeoutMs}ms; url=${url}, bodyTextLen=${bodyLen}, logs=${JSON.stringify(logs)}`,
  );
}

/* ------------------------------------------------------------------ */
/* one attempt                                                          */
/* ------------------------------------------------------------------ */

async function runAttempt(attemptIndex, headless, notes) {
  const port = PORT_BASE + attemptIndex;
  const profile = path.join(
    TOOLS_DIR,
    `edge-profile-bench-${attemptIndex}-${Date.now()}`,
  );
  mkdirSync(TOOLS_DIR, { recursive: true });

  let edge = null;
  try {
    const edgeArgs = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      // keep the foreground Edge from being timer-throttled / backgrounded as an
      // occluded window; otherwise rAF drops to ~1fps and frame timing is void.
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=CalculateNativeWinOcclusion,msEdgeStartupBoost",
      "--window-size=1600,1000",
      "--window-position=0,0",
      `http://localhost:${DEV_PORT}/?gpu-bench=1`,
    ];
    if (headless) edgeArgs.push("--headless=new");

    edge = spawn(EDGE_PATH, edgeArgs, { stdio: "ignore" });
    await waitForCdp4(port, 30000);

    const c = await connectCdp4(port);

    // Wait until the SPA actually painted, instead of guessing from a single
    // marker; on an empty shell the first captured console/page log is attached
    // to the thrown error. Dev-mode cold boot transforms a large module graph
    // on demand, so allow a generous window before declaring the shell dead.
    await waitBodyPopulated(c, 75000);

    // Open the standalone GPU graph view through the exposed app handle.
    const openedVia = await c.evaluate(`(() => {
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
    notes.push(`GPU view opened via ${openedVia}`);

    await c.waitFor(`!!window.__adkmGpuBench`, 30000, "bench hook attached");

    // Bring the page to the foreground and self-document visibility / focus /
    // rAF cadence. A backgrounded or occluded window throttles rAF to ~1fps,
    // which would make every frame sample meaningless.
    await c.call("Page.bringToFront");
    const vis = await c.evaluate(`({ visibility: document.visibilityState, focus: document.hasFocus() })`);
    const rafGaps = await c.evaluate(`(async () => {
      const frames = [];
      await new Promise((res) => {
        let n = 0;
        const step = () => {
          frames.push(performance.now());
          if (++n < 10) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });
      const gaps = [];
      for (let i = 1; i < frames.length; i++) gaps.push(Number((frames[i] - frames[i - 1]).toFixed(2)));
      return gaps;
    })()`);
    const diag = { visibility: vis.visibility, focus: vis.focus, rafGaps };
    const notVisible = vis.visibility !== "visible";
    if (notVisible) notes.push(`window not visible: visibility=${vis.visibility}, focus=${vis.focus}`);

    const envProbe = await c.evaluate(ENV_PROBE_EXPR);
    let browserVersion = "unknown";
    try {
      const bv = await c.call("Browser.getVersion");
      browserVersion = bv.product || bv.userAgent || "unknown";
    } catch {
      /* CDP version probe unavailable */
    }

    // ---- large synthetic graph first: 100k nodes / 200k edges ------------
    // Priority target: capture this sample as soon as it finishes. A timeout
    // here is recorded as bigError; the control graph below still runs.
    let big = null;
    let bigError = null;
    let small = null;
    let smallError = null;
    if (notVisible) {
      bigError = "window not visible; rAF would be throttled, benchmark not run";
      smallError = "window not visible; rAF would be throttled, benchmark not run";
    } else {
      try {
        await c.evaluate(`window.__adkmGpuBench.load(100000, 200000, 1)`);
        await sleep(4000); // let the layout make visible progress before sampling
        big = await withTimeout(
          c.evaluate(`window.__adkmGpuBench.run(120)`),
          90000,
          "big-graph run(120)",
        );
        await c.evaluate(`window.__adkmGpuBench.stop()`);
      } catch (e) {
        bigError = e instanceof Error ? e.message : String(e);
        notes.push(`big-graph error: ${bigError}`);
      }
      await sleep(800);

      // ---- small control graph: 400 nodes / 800 edges ------------------
      try {
        await c.evaluate(`window.__adkmGpuBench.load(400, 800, 7)`);
        await sleep(1500);
        small = await withTimeout(
          c.evaluate(`window.__adkmGpuBench.run(120)`),
          60000,
          "small-graph run(120)",
        );
        await c.evaluate(`window.__adkmGpuBench.stop()`);
      } catch (e) {
        smallError = e instanceof Error ? e.message : String(e);
        notes.push(`small-graph error: ${smallError}`);
      }
    }

    c.close();

    const software = SOFTWARE_RE.test(String(envProbe.renderer || ""));
    const classification = software
      ? "software-renderer"
      : envProbe.renderer === "no-webgl-context"
        ? "no-gpu"
        : "gpu";

    let verdict;
    if (notVisible) {
      verdict = `未测（窗口不可见导致 rAF 节流：visibility=${vis.visibility}, focus=${vis.focus}）`;
    } else if (big == null) {
      verdict = `未测（100k 基准未在浏览器自动化环境中完成：${bigError ?? "未知原因"}）`;
    } else if (classification === "software-renderer") {
      verdict = "未达标（环境受限：检测到软件渲染器）";
    } else if (classification === "no-gpu") {
      verdict = "未达标（环境受限：无 WebGL 上下文）";
    } else {
      const pass =
        big.fps >= THRESHOLD.fpsMin && big.p95Ms <= THRESHOLD.p95MaxMs;
      verdict = pass
        ? "达标"
        : `未达标（性能未达阈值：fps ${big.fps} < ${THRESHOLD.fpsMin} 或 p95 ${big.p95Ms}ms > ${THRESHOLD.p95MaxMs}ms）`;
    }

    return {
      env: {
        targetMachine: "NVIDIA GeForce RTX 5080, Windows 11",
        headless,
        edgePath: EDGE_PATH,
        edgeVersion: edgeVersion(),
        browserVersion,
        userAgent: envProbe.ua,
        devPort: DEV_PORT,
        cdpPort: port,
        rendererProbe: {
          renderer: envProbe.renderer,
          unmaskedRenderer: envProbe.raw,
          glVersion: envProbe.glVersion,
          ctxType: envProbe.ctxType,
        },
        dpr: envProbe.dpr,
        viewport: { width: envProbe.width, height: envProbe.height },
        softwareRenderer: software,
        classification,
        diag,
      },
      threshold: THRESHOLD,
      big,
      bigError,
      small,
      smallError,
      conclusion: {
        verdict,
        target: THRESHOLD,
        measured: big
          ? {
              fps: big.fps,
              medianMs: big.medianMs,
              p95Ms: big.p95Ms,
              frames: big.frames,
              sampleCount: (big.samples || []).length,
              mode: big.mode,
            }
          : null,
      },
    };
  } finally {
    killTree(edge);
    await removeProfile(profile);
  }
}

/* ------------------------------------------------------------------ */
/* main: headful attempts, then one headless fallback                   */
/* ------------------------------------------------------------------ */

async function main() {
  mkdirSync(TOOLS_DIR, { recursive: true });
  const notes = [];
  const errors = [];
  let devHandle = null;

  const plan = [];
  for (let i = 0; i < HEADFUL_ATTEMPTS; i += 1) plan.push({ index: i, headless: false });
  if (HEADLESS_FALLBACK) plan.push({ index: HEADFUL_ATTEMPTS, headless: true });

  let report = null;
  try {
    devHandle = await ensureDevServer(notes);

    for (const step of plan) {
      try {
        log(`attempt ${step.index + 1}/${plan.length} (headless=${step.headless})`);
        report = await runAttempt(step.index, step.headless, notes);
        // Keep trying the remaining attempts (including the headless control)
        // unless a real 100k sample was captured.
        if (report.big != null) break;
        await sleep(1500);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ attempt: step.index + 1, headless: step.headless, message });
        console.error(`[gpu-bench] attempt ${step.index + 1} failed:`, message);
        await sleep(1500);
      }
    }

    if (!report) {
      const failure = {
        schema: "t063-gpu-bench/v1",
        timestamp: new Date().toISOString(),
        commandLine: process.argv.join(" "),
        conclusion: { verdict: "未测（浏览器自动化环境受限）" },
        errors,
        notes,
      };
      writeFileSync(OUT_JSON, JSON.stringify(failure, null, 2), "utf8");
      writeFileSync(ERR_JSON, JSON.stringify(failure, null, 2), "utf8");
      console.error(`[gpu-bench] all browser attempts failed; wrote ${OUT_JSON}`);
      return 1;
    }

    const out = {
      schema: "t063-gpu-bench/v1",
      timestamp: new Date().toISOString(),
      commandLine: process.argv.join(" "),
      repo: { root: REPO_ROOT },
      ...report,
      notes,
    };
    writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), "utf8");

    if (report.big) {
      log("large graph:", {
        nodes: report.big.nodes,
        edges: report.big.edges,
        frames: report.big.frames,
        samples: (report.big.samples || []).length,
        medianMs: report.big.medianMs,
        p95Ms: report.big.p95Ms,
        fps: report.big.fps,
        mode: report.big.mode,
        gpu: report.big.gpu,
      });
    } else {
      log("large graph: 未测 —", report.bigError);
    }
    log(`classification=${report.env.classification} verdict=${report.conclusion.verdict}`);
    log(`written: ${OUT_JSON}`);
    return 0;
  } finally {
    if (devHandle && !devHandle.reused) killTree(devHandle.child);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[gpu-bench] fatal:", err);
    try {
      writeFileSync(
        ERR_JSON,
        JSON.stringify({ timestamp: new Date().toISOString(), fatal: String(err) }, null, 2),
        "utf8",
      );
    } catch {
      /* reporting itself failed */
    }
    process.exit(1);
  });
