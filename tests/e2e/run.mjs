/**
 * T-040 / T-004 baseline: six high-frequency paths against the REAL release
 * build, driven over WebView2 CDP. Zero new dependencies.
 *
 *   node tests/e2e/run.mjs --port=9222      # attach to a running release instance
 *   node tests/e2e/run.mjs --self-check   # prove case 3 fails when its expectation
 *                                          is inverted (guards the guard)
 *   node tests/e2e/run.mjs --prepare <dir> # write fixture notes for that vault
 *
 * Env overrides: GEODE_EXE, GEODE_E2E_VAULT, E2E_PORT.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectCdp, waitForCdp, sleep } from "./cdp.mjs";

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const port = Number(process.env.E2E_PORT || (argv.find((a) => a.startsWith("--port=")) || "").split("=")[1] || 9222);
const SELF_CHECK = has("--self-check");

const NOTE_A = `# Alpha

Intro paragraph with the keyword Alpha. See also [[E2E-Other]].

## 第 1 节 Section 1

段落 1-1：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 1-2：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 1-3：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 1-4：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 1-5：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 1-6：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

## 第 2 节 Section 2

段落 2-1：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 2-2：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 2-3：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 2-4：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 2-5：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 2-6：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

## 第 3 节 Section 3

段落 3-1：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 3-2：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 3-3：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 3-4：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 3-5：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 3-6：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

## 第 4 节 Section 4

段落 4-1：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 4-2：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 4-3：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 4-4：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 4-5：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

段落 4-6：这是一段用于撑开阅读视图高度的正文，包含可检索的关键词 Alpha，以及足够多的文字以便在 720px 视口之外产生真实的滚动距离。

## Omega

Final section with Alpha again.
`;

const NOTE_B = `# Gamma

A short second note linking to [[E2E-Note]].
`;
/** AsciiDoc with a real :toc: — T-033 fixed exactly these #_id anchors. */
const NOTE_ADOC = `= E2E Guide
:toc:
:toc-title: 目录

== Alpha Section

Alpha appears here too, so the index-backed search has a hit.

段落 1：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 1：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 1：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。

段落 2：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 2：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 2：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。

段落 3：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 3：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 3：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。

段落 4：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 4：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 4：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。

段落 5：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 5：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 5：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。

段落 6：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 6：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 6：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。

段落 7：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 7：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 7：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。

段落 8：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 8：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。段落 8：用于撑开 AsciiDoc 阅读视图高度的正文，确保目录跳转产生真实滚动。

== Beta Section

More body text with the keyword Alpha.

== Omega Section

The final section. Alpha is repeated here for full-text search.
`;


/** Write the three fixture notes into a throwaway vault directory. */
function prepareVault(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "E2E-Note.md"), NOTE_A, "utf-8");
  writeFileSync(path.join(dir, "E2E-Other.md"), NOTE_B, "utf-8");
  writeFileSync(path.join(dir, "E2E-Guide.adoc"), NOTE_ADOC, "utf-8");
  mkdirSync(path.join(dir, "sub"), { recursive: true });
  writeFileSync(path.join(dir, "sub", "Nested.md"), "# Delta\n", "utf-8");
}

/**
 * The sandbox does not allow a script to spawn the GUI process, and an E2E
 * runner should not own the app lifecycle anyway. Attach to an instance that
 * was started with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port.
 */
async function attach() {
  try {
    await waitForCdp(port, 8000);
  } catch {
    throw new Error(
      `CDP port ${port} is not open. Start the app first://n` +
      `  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=${port} ./src-tauri/target/release/geode.exe "<vault>"\n` +
      `Then re-run: node tests/e2e/run.mjs --port=${port}`,
    );
  }
}

const results = [];
async function runCase(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`  PASS  ${name}${detail ? "  — " + detail : ""}`);
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
    console.log(`  FAIL  ${name}  — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  if (has("--prepare")) {
    const dir = argv[argv.indexOf("--prepare") + 1];
    if (!dir) throw new Error("--prepare needs a directory path");
    prepareVault(dir);
    console.log(`prepared E2E vault: ${dir}`);
    return 0;
  }
  await attach();
  const c = await connectCdp(port);
  await c.waitFor(`!!document.querySelector('[data-testid="explorer"]') || !!document.querySelector('[data-testid="editor-pane"]')`, 20000, "app shell");

  // ---- 1. open a note -----------------------------------------------------
  await runCase("open-note", async () => {
    await c.key("o", "KeyO", 79, 2); // Ctrl+O quick switcher
    await c.waitFor(`!!document.querySelector('[data-testid="switcher-input"]')`, 5000, "quick switcher");
    await c.setInput('[data-testid="switcher-input"]', "E2E-Note");
    await sleep(300);
    const items = await c.evaluate(`document.querySelectorAll('[data-testid="switcher-item"]').length`);
    assert(items > 0, "quick switcher returned no items");
    assert(await c.click('[data-testid="switcher-item"]'), "could not click the switcher result");
    await c.waitFor(`!!document.querySelector('[data-testid="editor-pane"]') && !document.querySelector('[data-testid="editor-empty"]')`, 10000, "editor pane");
    await c.waitFor(`(document.querySelector('[data-testid="preview"]')?.scrollHeight || 0) > 1200 || !!document.querySelector('.cm-editor')`, 10000, "long note rendered");
    return "editor opened via quick switcher";
  });

  // ---- 2. switch view modes ----------------------------------------------
  await runCase("view-modes", async () => {
    assert(await c.click('[data-testid="mode-source"]'), "no source button");
    await c.waitFor(`!!document.querySelector('.cm-editor')`, 8000, "CodeMirror source view");
    assert(await c.click('[data-testid="mode-preview"]'), "no preview button");
    await c.waitFor(`!!document.querySelector('[data-testid="preview"]')`, 8000, "reading view");
    return "source → preview both rendered";
  });

  // ---- 3. outline click must NOT change the mode (T-029) ------------------
  await runCase("outline-keeps-mode", async () => {
    // Open the right outline panel through the command palette.
    await c.key("p", "KeyP", 80, 2); // Ctrl+P
    await c.waitFor(`!!document.querySelector('[data-testid="palette-input"]')`, 5000, "command palette");
    await c.setInput('[data-testid="palette-input"]', "大纲");
    await sleep(350);
    if (await c.evaluate(`document.querySelectorAll('[data-testid="palette-item"]').length > 0`)) {
      await c.click('[data-testid="palette-item"]');
    } else {
      await c.key("Escape", "Escape", 27);
    }
    await sleep(500);
    // Some locales/commands may not resolve by name; fall back to the tab.
    let items = await c.evaluate(`document.querySelectorAll('[data-testid="outline-item"]').length`);
    if (items < 2) {
      await c.click('[data-testid="right-tab-outline"]');
      await sleep(400);
      items = await c.evaluate(`document.querySelectorAll('[data-testid="outline-item"]').length`);
    }
    assert(items >= 2, `outline needs >= 2 headings, got ${items}`);

    const scroller = `[data-testid="preview"]`;
    await c.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(scroller)}); const s = e && e.parentElement; if (s) s.scrollTop = 0; return true; })()`);
    await sleep(150);
    const before = await c.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(scroller)}); const s = e && e.parentElement; return s ? s.scrollTop : document.scrollingElement.scrollTop; })()`);
    assert(await c.realClick('[data-testid="outline-item"] .outline-label', 2),
      "could not click the third outline label");
    await sleep(600);

    const stillPreview = await c.evaluate(`!!document.querySelector('[data-testid="preview"]') && !document.querySelector('.cm-editor')`);
    // --self-check inverts this single expectation: the case MUST then fail.
    const expected = SELF_CHECK ? false : true;
    assert(stillPreview === expected,
      SELF_CHECK
        ? "self-check expected this case to fail (inverted expectation) but it passed — the assertion is not guarding anything"
        : "outline click switched out of the reading view (T-029 regression)");
    const after = await c.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(scroller)}); const s = e && e.parentElement; return s ? s.scrollTop : document.scrollingElement.scrollTop; })()`);
    assert(after > before || await c.evaluate(`!!document.querySelector('.preview-reveal-flash')`),
      `outline click did not scroll (before=${before}, after=${after})`);
    return `mode kept, scroll ${before} → ${after}`;
  });

  // ---- 4. wikilink navigation through the preview click delegate ---------
  await runCase("wikilink-navigation", async () => {
    const link = await c.evaluate(`(() => {
      const a = document.querySelector('[data-testid="preview"] a.internal-link');
      return a ? { text: a.textContent.trim(), target: a.getAttribute('data-target') || '' } : null;
    })()`);
    assert(link, "no wikilink rendered in the reading view");
    // The previous case scrolled the reading view; return to the top so the
    // link is on-screen. Wikilinks are handled by a delegated click on the
    // preview container, so a DOM click (which bubbles) is the reliable path.
    await c.evaluate(`(() => { const p = document.querySelector('[data-testid="preview"]'); const s = p && p.parentElement; if (s) s.scrollTop = 0; return true; })()`);
    await sleep(200);
    assert(await c.click('[data-testid="preview"] a.internal-link'), "could not click the wikilink");
    await c.waitFor(`/E2E-Other/.test(document.querySelector('.inline-title')?.textContent || '')`, 8000, "target note opened");
    return `opened E2E-Other via ${link.text}`;
  });

  // ---- 5. reading-view context menu (T-034) ------------------------------
  await runCase("context-menu", async () => {
    const prevented = await c.evaluate(`(() => {
      const el = document.querySelector('[data-testid="preview"]');
      if (!el) return null;
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    })()`);
    assert(prevented === true, "default browser context menu was not prevented");
    await c.waitFor(`!!document.querySelector('.ctx-menu')`, 5000, "app context menu");
    const text = await c.evaluate(`document.querySelector('.ctx-menu').textContent`);
    assert(/复制|Copy/.test(text), "app menu has no Copy item");
    assert(!/刷新|检查|Reload|Inspect/.test(text), "browser menu items leaked into the app menu");
    return "app menu only";
  });

  // ---- 6. two co-existing search semantics (T-041) -----------------------
  await runCase("search-modes", async () => {
    await c.key("Escape", "Escape", 27);
    await sleep(200);
    // Ctrl+Shift+F opens global search.
    await c.key("F", "KeyF", 70, 2 | 8); // Ctrl+Shift
    await c.waitFor(`!!document.querySelector('[data-testid="search-input"]')`, 6000, "search panel");
    assert(await c.click('[data-testid="search-mode-index"]'), "no full-text mode button");
    await c.setInput('[data-testid="search-input"]', "Alpha");
    const beforeMs = await c.evaluate(`(globalThis.__geodePerf || {}).searchIndexMs ?? null`);
    // The input may still hold the same string from a previous run; React skips
    // onChange for an identical value, so clear first to guarantee a new query.
    await c.setInput('[data-testid="search-input"]', "");
    await sleep(350);
    await c.setInput('[data-testid="search-input"]', "Alpha");
    await c.waitFor(`(globalThis.__geodePerf || {}).searchIndexMs !== ${JSON.stringify(beforeMs)} || (globalThis.__geodePerf || {}).searchIndexMs === undefined`, 10000, "a fresh index query ran");
    await c.waitFor(`/索引命中|index hits/.test(document.querySelector('.search-meta')?.textContent || '') || /索引中没有匹配|No index results/.test(document.querySelector('.search-hint')?.textContent || '')`, 10000, "index-semantics label");
    const state = await c.evaluate(`JSON.stringify({
      hits: document.querySelectorAll('[data-testid="search-result"]').length,
      meta: document.querySelector('.search-meta')?.textContent || '',
      hint: document.querySelector('.search-hint')?.textContent || '',
      unavailable: !!document.querySelector('[data-testid="search-index-unavailable"]'),
      modeActive: document.querySelector('[data-testid="search-mode-index"]')?.classList.contains('is-active'),
      ms: (globalThis.__geodePerf || {}).searchIndexMs,
    })`);
    const r = JSON.parse(state);
    assert(!r.unavailable, "index reported unavailable instead of querying");
    assert(r.modeActive === true, "full-text mode is not the active mode");
    assert(r.meta !== "" || /索引中没有匹配|No index results/.test(r.hint),
      "result set is not labelled as index semantics (silent fallback?)");
    return `${r.hits} hits, labelled as index results, ${r.ms} ms`;
  });

  c.close();

  // ---- report -------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (SELF_CHECK) {
    const inverted = failed.length === 1 && failed[0].name === "outline-keeps-mode";
    console.log(inverted
      ? "SELF-CHECK OK: the outline case turns red when its expectation is inverted."
      : `SELF-CHECK FAILED: expected exactly one failure (outline-keeps-mode), got: ${failed.map((f) => f.name).join(", ") || "none"}`);
    return inverted ? 0 : 1;
  }
  return failed.length === 0 ? 0 : 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (e) {
  console.error("[e2e] fatal:", e.message);
} finally {
  // attach mode owns no process and no vault directory
}
process.exit(exitCode);
