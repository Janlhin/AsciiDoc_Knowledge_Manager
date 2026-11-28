/**
 * T-063 GPU graph view — E2E against the release build over WebView2 CDP.
 *
 * This script is standalone: it does not modify run.mjs and adds no dependency.
 * By default it launches the release exe itself with the debug port injected;
 * set ADKM_E2E_ATTACH=1 to attach to an already running instance instead.
 *
 *   node tests/e2e/gpu-graph.e2e.mjs
 *   ADKM_E2E_ATTACH=1 node tests/e2e/gpu-graph.e2e.mjs
 *
 * Env overrides: ADKM_EXE, ADKM_E2E_VAULT, ADKM_E2E_PORT, ADKM_TOOLS_DIR.
 * Evidence (screenshots + JSON) lands in the tools directory.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sleep, waitForCdp, connectCdp } from "./cdp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(path.dirname(HERE));

const TOOLS_DIR =
  process.env.ADKM_TOOLS_DIR || "D:\\Projects\\ADKM-1127-wt\\t063-tools";
const EVIDENCE_DIR = path.join(TOOLS_DIR, "gpu-e2e-evidence");
const EXE =
  process.env.ADKM_EXE ||
  path.join(REPO_ROOT, "src-tauri", "target", "release", "adkm.exe");
const VAULT =
  process.env.ADKM_E2E_VAULT ||
  "D:\\Projects\\ADKM-1127-wt\\t063-fixtures\\real-vault";
const PORT = Number(process.env.ADKM_E2E_PORT || 9444);
const ATTACH = process.env.ADKM_E2E_ATTACH === "1";

const OUT_JSON =
  process.env.ADKM_E2E_OUT_JSON || path.join(TOOLS_DIR, "gpu-e2e.json");
const COMPARE_JSON =
  process.env.ADKM_E2E_COMPARE_JSON || path.join(TOOLS_DIR, "e2e-419.json");
/** Filename prefix for compare-case screenshots, so reruns do not clobber evidence. */
const EVIDENCE_PREFIX = process.env.ADKM_E2E_EVIDENCE_PREFIX || "e2e-419";
/** When set, only this case runs; the rest are recorded as 未测. */
const ONLY_CASE = process.env.ADKM_E2E_ONLY || "";

const APP_SHELL = `!!document.querySelector('[data-testid="app-root"]')`;

const results = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/* ------------------------------------------------------------------ */
/* shared in-page probes                                                */
/* ------------------------------------------------------------------ */

const PIXEL_PROBE_EXPR = `(() => {
  const canvas = document.querySelector('[data-testid="gpu-canvas"]');
  if (!canvas || canvas.width < 2 || canvas.height < 2) return null;
  const probe = document.createElement('canvas');
  probe.width = canvas.width;
  probe.height = canvas.height;
  const ctx = probe.getContext('2d');
  try { ctx.drawImage(canvas, 0, 0); } catch (e) { return { error: String(e) }; }
  const img = ctx.getImageData(0, 0, probe.width, probe.height).data;
  let nonBg = 0;
  let total = 0;
  for (let i = 0; i < img.length; i += 16) {
    total += 1;
    const r = img[i], g = img[i + 1], b = img[i + 2];
    const bg = Math.abs(r - 38) < 14 && Math.abs(g - 38) < 14 && Math.abs(b - 38) < 14;
    if (!bg) nonBg += 1;
  }
  return { width: canvas.width, height: canvas.height, nonBg, total, nonBgRatio: total ? nonBg / total : 0 };
})()`;

const RENDERER_PROBE_EXPR = `(() => {
  const canvas = document.querySelector('[data-testid="gpu-canvas"]');
  if (!canvas) return null;
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return { renderer: 'no-webgl-context' };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
  return { renderer: raw || gl.getParameter(gl.RENDERER) || 'unknown' };
})()`;

const GPU_COUNTS_EXPR = `(() => {
  const root = document.querySelector('[data-gpu-graph-view]');
  if (!root) return null;
  const nodes = Number(root.getAttribute('data-gpu-graph-nodes') || 0);
  const hud = document.querySelector('[data-testid="gpu-hud"]');
  let edges = null;
  if (hud) {
    const nums = [...hud.textContent.matchAll(/(\\d+)/g)].map((m) => Number(m[1]));
    edges = nums.length >= 2 ? nums[1] : (nums[0] ?? null);
  }
  return { nodes, edges };
})()`;

const PLAIN_COUNTS_EXPR = `(() => {
  const stats = typeof window.__geodeGraphLayoutStats === 'function'
    ? window.__geodeGraphLayoutStats() : null;
  const legend = document.querySelector('[data-testid="graph-legend"]');
  let edges = null;
  let legendText = null;
  if (legend) {
    legendText = legend.textContent.trim();
    const spans = [...legend.querySelectorAll('span')].map((s) => s.textContent.trim());
    const nums = [];
    spans.forEach((s) => {
      const m = s.match(/(\\d[\\d,]*)/);
      if (m) nums.push(Number(m[1].replace(/,/g, '')));
    });
    edges = nums.length >= 2 ? nums[1] : (nums[0] ?? null);
  }
  return { nodeCount: stats ? stats.nodeCount : null, edges, legendText };
})()`;

/** Injection that blocks WebGL(2) context acquisition, for the degradation case. */
const BLOCK_WEBGL_SOURCE = `(() => {
  const proto = HTMLCanvasElement.prototype;
  const orig = proto.getContext;
  proto.getContext = function (type, attrs) {
    if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
    return orig.call(this, type, attrs);
  };
})()`;

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

async function runCase(name, fn) {
  if (ONLY_CASE && name !== ONLY_CASE) {
    results.push({ name, ok: null, detail: `未测（本次仅运行 ${ONLY_CASE}）` });
    return;
  }
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || "" });
    console.log(`  PASS  ${name}${detail ? "  — " + detail : ""}`);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, ok: false, detail });
    console.log(`  FAIL  ${name}  — ${detail}`);
  }
}

async function screenshot(c, name) {
  const r = await c.call("Page.captureScreenshot", { format: "png" });
  const buf = Buffer.from(r.data, "base64");
  const p = path.join(EVIDENCE_DIR, name);
  writeFileSync(p, buf);
  return p;
}

async function tabTitles(c) {
  return c.evaluate(`[...document.querySelectorAll('.tab-bar .tab')].map((t) => t.title || t.textContent.trim())`);
}

/** Open the GPU graph view via the command palette; fall back to the app handle. */
async function openGpuView(c) {
  await c.key("p", "KeyP", 80, 2); // Ctrl+P command palette
  await c.waitFor(`!!document.querySelector('[data-testid="palette-input"]')`, 6000, "command palette");
  await c.setInput('[data-testid="palette-input"]', "GPU");
  await sleep(300);
  const itemCount = await c.evaluate(
    `document.querySelectorAll('[data-testid="palette-item"]').length`,
  );
  if (itemCount > 0) {
    await c.click('[data-testid="palette-item"]');
  } else {
    await c.evaluate(`(() => {
      const a = window.geode && window.geode.app;
      if (a && a.commands) a.commands.execute('app:open-gpu-graph');
      else if (a && a.workspace) a.workspace.openGpuGraph();
    })()`);
  }
  await c.waitFor(`!!document.querySelector('[data-gpu-graph-view]')`, 10000, "gpu graph view mounted");
}

async function reloadApp(c) {
  await c.call("Page.reload", { ignoreCache: false });
  try {
    c.close();
  } catch {
    /* socket may already be gone */
  }
  await sleep(1500);
  const next = await connectCdp(PORT);
  await next.waitFor(APP_SHELL, 25000, "app shell after reload");
  return next;
}

function killTree(child) {
  if (!child || child.pid == null) return;
  spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
}

/* ------------------------------------------------------------------ */
/* main                                                                 */
/* ------------------------------------------------------------------ */

async function main() {
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  let child = null;
  if (!ATTACH) {
    assert(existsSync(EXE), `release exe not found: ${EXE}`);
    const env = {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    };
    child = spawn(EXE, [VAULT], { env, stdio: "ignore" });
  }

  let c = null;
  try {
    await waitForCdp(PORT, 30000);
    c = await connectCdp(PORT);
    await c.waitFor(APP_SHELL, 20000, "app shell");

    let browserVersion = "unknown";
    try {
      const bv = await c.call("Browser.getVersion");
      browserVersion = bv.product || bv.userAgent || "unknown";
    } catch {
      /* version probe unavailable */
    }

    const bootEnv = await c.evaluate(`(() => ({
      ua: navigator.userAgent,
      dpr: window.devicePixelRatio || 1,
      width: window.innerWidth,
      height: window.innerHeight,
    }))()`);

    let gpuRenderer = "未测（GPU 视图尚未打开）";

    // ---- 1. entry: command palette opens the GPU graph view ----------------
    await runCase("entry-open-gpu-graph", async () => {
      await openGpuView(c);
      const attr = await c.evaluate(
        `document.querySelector('[data-gpu-graph-view]')?.getAttribute('data-gpu-graph-view')`,
      );
      const nodes = Number(
        await c.evaluate(
          `document.querySelector('[data-gpu-graph-view]')?.getAttribute('data-gpu-graph-nodes') || '0'`,
        ),
      );
      assert(attr === "ready", `view status=${attr}, expected ready`);
      assert(nodes > 0, `data-gpu-graph-nodes=${nodes}, expected > 0`);
      const rprobe = await c.evaluate(RENDERER_PROBE_EXPR);
      if (rprobe && rprobe.renderer) gpuRenderer = rprobe.renderer;
      return `status=${attr}, nodes=${nodes}, gpu=${gpuRenderer}`;
    });

    // ---- 2. render: canvas paints non-background pixels --------------------
    await runCase("render-canvas-pixels", async () => {
      const shot = await screenshot(c, "e2e-gpu-render.png");
      const probe = await c.evaluate(PIXEL_PROBE_EXPR);
      assert(probe && !probe.error, `pixel probe failed: ${JSON.stringify(probe)}`);
      assert(
        probe.nonBgRatio > 0.05,
        `non-background pixel ratio ${(probe.nonBgRatio * 100).toFixed(2)}% <= 5%`,
      );
      return `non-bg ${(probe.nonBgRatio * 100).toFixed(2)}% (${probe.nonBg}/${probe.total} samples), canvas ${probe.width}x${probe.height}; screenshot ${shot}`;
    });

    // ---- 3. click opens a note tab (weak assertion; no exposed mapping) -----
    await runCase("click-opens-note-tab", async () => {
      const before = await tabTitles(c);
      const box = await c.evaluate(`(() => {
        const el = document.querySelector('[data-testid="gpu-canvas"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
      })()`);
      assert(box, "gpu canvas not found");
      for (const type of ["mousePressed", "mouseReleased"]) {
        await c.call("Input.dispatchMouseEvent", {
          type,
          x: box.x,
          y: box.y,
          button: "left",
          clickCount: 1,
        });
      }
      await sleep(1500);
      const after = await tabTitles(c);
      const opened =
        after.length > before.length || after.some((t) => /\.md(\s|$)/i.test(t));
      assert(
        opened,
        `tab count ${before.length} -> ${after.length}, no .md tab appeared (weak assertion)`,
      );
      return `weak assertion: tabs ${before.length} -> ${after.length}; titles=${JSON.stringify(after)}`;
    });

    // ---- 4. degrade: real WebGL block -> banner + plain GraphView -----------
    let blockerId = null;
    await runCase("degrade-block-webgl", async () => {
      const added = await c.call("Page.addScriptToEvaluateOnNewDocument", {
        source: BLOCK_WEBGL_SOURCE,
      });
      blockerId = added.identifier || null;
      c = await reloadApp(c);
      // Belt and suspenders: re-apply the override directly on the fresh
      // document, in case the new-document hook did not run after reload.
      await c.evaluate(BLOCK_WEBGL_SOURCE);
      await openGpuView(c);
      const banner = await c.evaluate(
        `!!document.querySelector('[data-testid="gpu-fallback-banner"]')`,
      );
      const fbAttr = await c.evaluate(
        `document.querySelector('[data-gpu-graph-view]')?.getAttribute('data-gpu-graph-view')`,
      );
      const plain = await c.evaluate(`!!document.querySelector('[data-testid="graph-view"]')`);
      assert(banner, "fallback banner not visible");
      assert(fbAttr === "fallback", `data-gpu-graph-view=${fbAttr}`);
      assert(plain, "plain GraphView did not render after fallback");
      const shot = await screenshot(c, "e2e-fallback.png");
      return `banner=${banner}, fallback attr=${fbAttr}, plain GraphView=${plain}; ${shot}`;
    });

    // ---- 5. context lost: loseContext() -> degradation, no blank screen -----
    await runCase("context-lost-recovery", async () => {
      if (blockerId) {
        try {
          await c.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: blockerId });
        } catch {
          /* remove best-effort */
        }
        blockerId = null;
      }
      c = await reloadApp(c);
      await openGpuView(c);
      const lost = await c.evaluate(`(() => {
        const canvas = document.querySelector('[data-testid="gpu-canvas"]');
        if (!canvas) return { ok: false, reason: "no gpu canvas" };
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) return { ok: false, reason: "no gl context" };
        const ext = gl.getExtension('WEBGL_lose_context');
        if (!ext) return { ok: false, reason: "WEBGL_lose_context unavailable" };
        ext.loseContext();
        return { ok: true };
      })()`);
      assert(lost.ok, lost.reason || "loseContext failed");
      await sleep(2000);
      const banner = await c.evaluate(
        `!!document.querySelector('[data-testid="gpu-fallback-banner"]')`,
      );
      const fbAttr = await c.evaluate(
        `document.querySelector('[data-gpu-graph-view]')?.getAttribute('data-gpu-graph-view')`,
      );
      const plain = await c.evaluate(`!!document.querySelector('[data-testid="graph-view"]')`);
      const shell = await c.evaluate(`!!document.querySelector('[data-testid="app-root"]')`);
      const degraded = banner || fbAttr === "fallback" || plain;
      assert(degraded, `context loss did not surface a degradation path; shell present=${shell}`);
      const shot = await screenshot(c, "e2e-context-lost.png");
      return `banner=${banner}, fallback=${fbAttr}, plain=${plain}; ${shot}`;
    });

    // ---- 6. 419 comparison: GPU vs plain GraphView counts -----------------
    let comparison = null;
    await runCase("compare-419-counts", async () => {
      c = await reloadApp(c);
      await openGpuView(c);
      await sleep(1200);
      const gpu = await c.evaluate(GPU_COUNTS_EXPR);
      const gpuShot = await screenshot(c, `${EVIDENCE_PREFIX}-gpu.png`);

      await c.evaluate(`(() => {
        const a = window.geode && window.geode.app;
        if (a && a.commands) a.commands.execute('app:open-graph');
        else if (a && a.workspace) a.workspace.openGraph();
      })()`);
      await c.waitFor(`!!document.querySelector('[data-testid="graph-view"]')`, 10000, "plain GraphView mounted");
      await sleep(1200);
      const plain = await c.evaluate(PLAIN_COUNTS_EXPR);
      const plainShot = await screenshot(c, `${EVIDENCE_PREFIX}-plain.png`);

      const nodesMatch = gpu.nodes === plain.nodeCount;
      const edgesMatch = gpu.edges === plain.edges;
      const edgesPositive = Number(gpu.edges) > 0 && Number(plain.edges) > 0;
      comparison = {
        gpu,
        plain,
        nodesMatch,
        edgesMatch,
        edgesPositive,
        evidence: { gpuShot, plainShot },
      };
      writeFileSync(
        COMPARE_JSON,
        JSON.stringify(
          {
            schema: "t063-gpu-compare/v1",
            timestamp: new Date().toISOString(),
            vault: VAULT,
            comparison,
          },
          null,
          2,
        ),
        "utf8",
      );
      assert(nodesMatch, `node count mismatch: gpu=${gpu.nodes} plain=${plain.nodeCount}`);
      assert(edgesMatch, `edge count mismatch: gpu=${gpu.edges} plain=${plain.edges}`);
      if (process.env.ADKM_E2E_REQUIRE_EDGES === "1") {
        assert(edgesPositive, `edges not positive: gpu=${gpu.edges} plain=${plain.edges}`);
      }
      return `gpu nodes=${gpu.nodes} edges=${gpu.edges}; plain nodes=${plain.nodeCount} edges=${plain.edges}; nodesMatch=${nodesMatch} edgesMatch=${edgesMatch} edgesPositive=${edgesPositive}`;
    });

    const failed = results.filter((r) => r.ok === false);
    const skipped = results.filter((r) => r.ok === null);
    const passed = results.filter((r) => r.ok === true);
    const report = {
      schema: "t063-gpu-e2e/v1",
      timestamp: new Date().toISOString(),
      env: {
        exe: EXE,
        vault: VAULT,
        cdpPort: PORT,
        headless: false,
        browserVersion,
        userAgent: bootEnv.ua,
        dpr: bootEnv.dpr,
        viewport: { width: bootEnv.width, height: bootEnv.height },
        gpuRenderer,
      },
      comparison,
      cases: results.map((r) => ({ name: r.name, ok: r.ok, detail: r.detail })),
      summary: {
        total: results.length,
        passed: passed.length,
        failed: failed.length,
        skipped: skipped.length,
      },
    };
    writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), "utf8");
    console.log(`\n${report.summary.passed}/${report.summary.total} passed; report ${OUT_JSON}`);
    return failed.length === 0 ? 0 : 1;
  } finally {
    killTree(child);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[gpu-e2e] fatal:", err);
    try {
      writeFileSync(
        OUT_JSON,
        JSON.stringify(
          { timestamp: new Date().toISOString(), fatal: String(err) },
          null,
          2,
        ),
        "utf8",
      );
    } catch {
      /* reporting itself failed */
    }
    process.exit(1);
  });
