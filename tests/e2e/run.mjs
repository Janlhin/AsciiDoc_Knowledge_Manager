/**
 * T-040 / T-004 baseline: twenty-two high-frequency paths against the REAL release
 * build, driven over WebView2 CDP. Zero new dependencies.
 *
 *   node tests/e2e/run.mjs --port=9222      # attach to a running release instance
 *   node tests/e2e/run.mjs --self-check   # prove case 3 fails when its expectation
 *                                          is inverted (guards the guard)
 *   node tests/e2e/run.mjs --prepare <dir> # write fixture notes for that vault
 *
 * Env overrides: GEODE_EXE, GEODE_E2E_VAULT, E2E_PORT.
 */
import { mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { connectCdp, waitForCdp, sleep } from "./cdp.mjs";
import { startMockLlm } from "./mock-llm.mjs";

const requireCjs = createRequire(import.meta.url);
const JSZip = requireCjs("jszip");

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


/** AsciiDoc fixtures for the T-045 reference checks (docs/index.adoc). */
const DOC_INDEX = `= E2E Docs
:toc:

Valid cross-reference: xref:chapter.adoc#details[chapter].

Broken cross-reference: xref:missing.adoc[].

Valid include:

include::partials/intro.adoc[]

Broken include:

include::partials/gone.adoc[]
`;

const DOC_CHAPTER = `= Chapter

Some body text.

[[details]]
== Details

More text below the anchor.
`;

const DOC_INTRO = `= Intro

Included text.
`;

const DOC_CYCLE_A = `= Cycle A

include::cycle-b.adoc[]
`;

const DOC_CYCLE_B = `= Cycle B

include::cycle-a.adoc[]
`;

/** T-045 slice 2: two versions of one Antora component, plus a valid/broken id. */
const ANTORA_DESCRIPTOR_20 = `name: catalog\nversion: '2.0'\n`;
const ANTORA_DESCRIPTOR_21 = `name: catalog\nversion: '2.1'\n`;
const ANTORA_INDEX = `= Catalog Index

Catalog entry page.
`;
const ANTORA_PARTIAL = `= Catalog Intro

Shared partial.
`;
const ANTORA_GUIDE = `= Catalog Guide

A valid id in the same component: xref:2.0@catalog:ROOT:index.adoc[].
`;
/** Outside every component: an omitted version must NOT pick one silently. */
const ANTORA_CHECK = `= Antora Check

Ambiguous version: xref:catalog:ROOT:index.adoc[].

Unknown version: xref:9.9@catalog:ROOT:index.adoc[].
`;

/** 1×1 PNG for single-image and CBZ fixtures. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function fb2(title, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"
             xmlns:l="http://www.w3.org/1999/xlink">
  <description><title-info><book-title>${title}</book-title></title-info></description>
  <body>${body}</body>
</FictionBook>`;
}

const FB2_PLAIN = fb2("E2E FictionBook", "<title><p>Chapter One</p></title><p>Hello from FB2.</p>");
const FB2_ZIPPED = fb2("Zipped FictionBook", "<p>Book came out of a ZIP archive.</p>");

/** File entries of a backup archive (directory entries filtered out). */
async function readZipEntries(file) {
  const zip = await JSZip.loadAsync(readFileSync(file));
  return Object.keys(zip.files).filter((k) => !zip.files[k].dir);
}

/** Write the fixture notes into a throwaway vault directory. */
async function prepareVault(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "E2E-Note.md"), NOTE_A, "utf-8");
  writeFileSync(path.join(dir, "E2E-Other.md"), NOTE_B, "utf-8");
  writeFileSync(path.join(dir, "E2E-Guide.adoc"), NOTE_ADOC, "utf-8");
  mkdirSync(path.join(dir, "sub"), { recursive: true });
  writeFileSync(path.join(dir, "sub", "Nested.md"), "# Delta\n", "utf-8");
  // T-045: xref / include fixtures, including one broken target each and a cycle.
  mkdirSync(path.join(dir, "docs", "partials"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "index.adoc"), DOC_INDEX, "utf-8");
  writeFileSync(path.join(dir, "docs", "chapter.adoc"), DOC_CHAPTER, "utf-8");
  writeFileSync(path.join(dir, "docs", "partials", "intro.adoc"), DOC_INTRO, "utf-8");
  writeFileSync(path.join(dir, "docs", "cycle-a.adoc"), DOC_CYCLE_A, "utf-8");
  writeFileSync(path.join(dir, "docs", "cycle-b.adoc"), DOC_CYCLE_B, "utf-8");
  // P1-3: a large AsciiDoc source for the worker-vs-main-thread probe. Kept
  // generated (not committed as a fixture) because it is only a load shape.
  writeFileSync(
    path.join(dir, "docs", "big-preview.adoc"),
    `= Large AsciiDoc\n\n` +
      Array.from(
        { length: 500 },
        (_, i) =>
          `== Section ${i}\n\nParagraph ${i}: *bold*, _italic_ and link:https://example.com[external] with \`code\`.\n\n- item one\n- item two\n\n`,
      ).join(""),
    "utf-8",
  );
  // T-045 slice 2: Antora component versions, a valid id, an ambiguous id and
  // an unknown version. Descriptor files themselves are not indexable notes.
  for (const version of ["2.0", "2.1"]) {
    const root = path.join(dir, "catalog", version);
    mkdirSync(path.join(root, "modules", "ROOT", "pages"), { recursive: true });
    mkdirSync(path.join(root, "modules", "ROOT", "partials"), { recursive: true });
    writeFileSync(path.join(root, "antora.yml"),
      version === "2.0" ? ANTORA_DESCRIPTOR_20 : ANTORA_DESCRIPTOR_21, "utf-8");
    writeFileSync(path.join(root, "modules", "ROOT", "pages", "index.adoc"), ANTORA_INDEX, "utf-8");
  }
  writeFileSync(path.join(dir, "catalog", "2.0", "modules", "ROOT", "partials", "intro.adoc"),
    ANTORA_PARTIAL, "utf-8");
  writeFileSync(path.join(dir, "catalog", "2.1", "modules", "ROOT", "pages", "guide.adoc"),
    ANTORA_GUIDE, "utf-8");
  writeFileSync(path.join(dir, "antora-check.adoc"), ANTORA_CHECK, "utf-8");
  // L4 extension: read-only FictionBook / comic ZIP / single image fixtures.
  writeFileSync(path.join(dir, "sample.fb2"), FB2_PLAIN, "utf-8");
  writeFileSync(path.join(dir, "sample.png"), Buffer.from(PNG_B64, "base64"));
  const fbz = new JSZip();
  fbz.file("book.fb2", FB2_ZIPPED);
  writeFileSync(path.join(dir, "sample.fb2.zip"), await fbz.generateAsync({ type: "nodebuffer" }));
  const cbz = new JSZip();
  for (const name of ["page10.png", "page2.png", "page1.png"]) {
    cbz.file(name, PNG_B64, { base64: true });
  }
  cbz.file("readme.txt", "not an image");
  writeFileSync(path.join(dir, "sample.cbz"), await cbz.generateAsync({ type: "nodebuffer" }));
  // Q-005: invalid Kindle samples prove format routing + honest failure.
  // No third-party ebook binary is bundled into the repo (see MANIFEST.md).
  writeFileSync(path.join(dir, "sample.mobi"), "not a real MOBI container");
  writeFileSync(path.join(dir, "sample.azw3"), "not a real KF8 container");
  // T-061: PDF startup gate. scan-small.pdf is a real (if tiny) PDF; scan-big.pdf is
  // 40 MB of zeros whose CONTENT is never read while the gate holds — only its size
  // matters for the assertion.
  writePdf(path.join(dir, "docs", "scan-small.pdf"));
  writeFileSync(path.join(dir, "docs", "scan-big.pdf"), Buffer.alloc(40 * 1024 * 1024));
  // T-061: a real EPUB (nav document + 3 chapters) so the reader's TOC and
  // position persistence can be driven end to end. EPUB had no fixture before.
  const book = new JSZip();
  book.file("mimetype", "application/epub+zip", { compression: "STORE" });
  book.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  const chapters = [1, 2, 3];
  book.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:e2e-epub</dc:identifier><dc:title>E2E Book</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters
      .map((n) => `<item id="ch${n}" href="ch${n}.xhtml" media-type="application/xhtml+xml"/>`)
      .join("")}</manifest><spine>${chapters.map((n) => `<itemref idref="ch${n}"/>`).join("")}</spine></package>`,
  );
  book.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${chapters
      .map((n) => `<li><a href="ch${n}.xhtml">Chapter ${["One", "Two", "Three"][n - 1]}</a></li>`)
      .join("")}</ol></nav></body></html>`,
  );
  for (const n of chapters) {
    book.file(
      `OEBPS/ch${n}.xhtml`,
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${n}</title></head><body><h1>Chapter ${["One", "Two", "Three"][n - 1]}</h1>${Array.from(
        { length: 40 },
        (_, k) => `<p>Chapter ${n} paragraph ${k + 1}: filler text long enough to paginate the reader.</p>`,
      ).join("")}</body></html>`,
    );
  }
  writeFileSync(path.join(dir, "sample.epub"), await book.generateAsync({ type: "nodebuffer" }));

  // T-061: an EPUB with no nav document at all — the reader must say so instead of
  // rendering an empty panel or failing to open.
  const noNav = new JSZip();
  noNav.file("mimetype", "application/epub+zip", { compression: "STORE" });
  noNav.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  noNav.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:e2e-epub-nonav</dc:identifier><dc:title>No Nav</dc:title><dc:language>en</dc:language></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>`,
  );
  noNav.file(
    "OEBPS/ch1.xhtml",
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Only</title></head><body><h1>Only chapter</h1><p>No navigation document here.</p></body></html>`,
  );
  writeFileSync(path.join(dir, "sample-nonav.epub"), await noNav.generateAsync({ type: "nodebuffer" }));
}

/** Structurally valid single-page PDF (correct xref offsets) for the gate case. */
function writePdf(file) {
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (s) => {
    const b = Buffer.from(s, "latin1");
    parts.push(b);
    length += b.length;
  };
  const obj = (id, body) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  };
  push("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Count 1 /Kids [3 0 R] >>");
  obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>");
  const stream = "BT /F1 12 Tf 40 800 Td (scan) Tj ET\n";
  obj(4, `<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  const xrefAt = length;
  let table = "xref\n0 5\n0000000000 65535 f \n";
  for (let id = 1; id <= 4; id += 1) table += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  writeFileSync(file, Buffer.concat(parts));
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
    await prepareVault(dir);
    console.log(`prepared E2E vault: ${dir}`);
    return 0;
  }
  await attach();
  let c = await connectCdp(port);
  // Readiness must not assume which tab the previous run left active: a
  // singleton view (audit / graph) has neither explorer nor editor-pane.
  const APP_SHELL = `!!document.querySelector('[data-testid="app-root"]') && !!document.querySelector('[data-testid^="tab-bar-"]')`;
  await c.waitFor(APP_SHELL, 20000, "app shell");

  /**
   * Reload the SPA and re-attach. Needed by the AI proofreading case: the LLM
   * provider store reads localStorage at module init, so a provider configured
   * mid-session is invisible to the panel until the page reloads.
   */
  async function reloadApp() {
    await c.call("Page.reload", { ignoreCache: false });
    try {
      c.close();
    } catch {
      /* the socket may already be gone */
    }
    await sleep(1200);
    c = await connectCdp(port);
    await c.waitFor(APP_SHELL, 25000, "app shell after reload");
  }

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

  // ---- 7. T-047 AI proofreading against a local mock provider ------------
  // Verifies the whole chain without a key or a network call: prompt carries
  // the T-046 rules → SSE streams into the panel → reply parses into jumpable
  // findings → out-of-range ones are dropped and reported → jump reveals.
  const llm = await startMockLlm();
  try {
    await runCase("ai-proofread", async () => {
      const snapshot = await c.evaluate(`JSON.stringify({
        providers: localStorage.getItem("adkm.llm.providers"),
        active: localStorage.getItem("adkm.llm.active"),
      })`);
      try {
        await c.evaluate(`(() => {
          const provider = {
            id: "e2e-mock",
            label: "E2E mock",
            baseUrl: ${JSON.stringify(llm.baseUrl)},
            model: "mock",
            secretName: "",
            temperature: 0,
          };
          localStorage.setItem("adkm.llm.providers", JSON.stringify([provider]));
          localStorage.setItem("adkm.llm.active", "e2e-mock");
          return true;
        })()`);
        await reloadApp();

        await c.key("o", "KeyO", 79, 2); // Ctrl+O quick switcher
        await c.waitFor(`!!document.querySelector('[data-testid="switcher-input"]')`, 6000, "quick switcher");
        await c.setInput('[data-testid="switcher-input"]', "E2E-Note");
        await sleep(300);
        assert(await c.click('[data-testid="switcher-item"]'), "could not open the fixture note");
        await c.waitFor(`!document.querySelector('[data-testid="editor-empty"]')`, 10000, "note opened");

        await c.key("p", "KeyP", 80, 2); // Ctrl+P command palette
        await c.waitFor(`!!document.querySelector('[data-testid="palette-input"]')`, 6000, "command palette");
        // Locale-independent lookup: the zh name contains 校对, the en one Proofread.
        await c.setInput('[data-testid="palette-input"]', "按规范校对");
        await sleep(350);
        if ((await c.evaluate(`document.querySelectorAll('[data-testid="palette-item"]').length`)) === 0) {
          await c.setInput('[data-testid="palette-input"]', "roofread note");
          await sleep(350);
        }
        assert(
          (await c.evaluate(`document.querySelectorAll('[data-testid="palette-item"]').length`)) > 0,
          "proofread command is not registered in the palette",
        );
        await c.click('[data-testid="palette-item"]');

        await c.waitFor(`!!document.querySelector('[data-testid="ai-proofread-result"]')`, 15000, "AI findings list");
        const state = await c.evaluate(`(() => {
          const items = [...document.querySelectorAll('[data-testid="ai-proofread-issue"]')];
          return {
            panel: !!document.querySelector('[data-testid="ai-panel"]'),
            issues: items.length,
            text: items.map((el) => el.textContent || "").join(" | "),
            dropped: !!document.querySelector('[data-testid="ai-proofread-dropped"]'),
          };
        })()`);
        assert(state.panel === true, "AI panel did not open");
        assert(state.issues === 2, `expected 2 locatable findings, got ${state.issues}`);
        assert(state.dropped === true, "the out-of-range finding was not reported as dropped");
        assert(/术语|terminology/i.test(state.text), `terminology finding missing: ${state.text}`);

        const sent = llm.requests.at(-1)?.body ?? "";
        assert(sent !== "", "the mock provider received no request");
        assert(sent.includes("terminology") && sent.includes("broken-link"),
          "the prompt did not carry the T-046 rule set");
        assert(sent.includes("E2E-Note.md"), "the prompt did not name the audited note");

        assert(await c.realClick('[data-testid="ai-proofread-issue"]', 0), "could not click a finding");
        await c.waitFor(
          `!!document.querySelector('.cm-reveal-flash') || !!document.querySelector('.preview-reveal-flash')`,
          6000,
          "editor reveal flash after the jump",
        );
        return `${state.issues} findings (1 dropped), rule set in prompt, jump revealed`;
      } finally {
        // Never leave the user's real provider list pointing at a dead port.
        await c.evaluate(`(() => {
          const snap = ${snapshot};
          if (snap.providers === null) localStorage.removeItem("adkm.llm.providers");
          else localStorage.setItem("adkm.llm.providers", snap.providers);
          if (snap.active === null) localStorage.removeItem("adkm.llm.active");
          else localStorage.setItem("adkm.llm.active", snap.active);
          return true;
        })()`).catch(() => {});
        await reloadApp().catch(() => {});
      }
    });
  } finally {
    await llm.close();
  }

  // ---- 8. T-045 xref / include integrity in the audit panel --------------
  await runCase("docs-as-code-refs", async () => {
    await c.key("p", "KeyP", 80, 2); // Ctrl+P command palette
    await c.waitFor(`!!document.querySelector('[data-testid="palette-input"]')`, 6000, "command palette");
    await c.setInput('[data-testid="palette-input"]', "检查文档规范");
    await sleep(350);
    if ((await c.evaluate(`document.querySelectorAll('[data-testid="palette-item"]').length`)) === 0) {
      await c.setInput('[data-testid="palette-input"]', "conventions");
      await sleep(350);
    }
    assert(await c.click('[data-testid="palette-item"]'), "audit command not found in the palette");
    await c.waitFor(`!!document.querySelector('[data-testid="doc-audit-view"]')`, 8000, "doc audit view");
    await c.waitFor(
      `document.querySelectorAll('[data-testid="doc-audit-issue"]').length > 0`,
      25000,
      "audit findings",
    );
    const state = await c.evaluate(`(() => {
      const text = [...document.querySelectorAll('[data-testid="doc-audit-issue"]')]
        .map((el) => el.textContent || "");
      const cycle = text.filter((t) => t.includes("循环引用"));
      return {
        total: text.length,
        xref: text.filter((t) => t.includes("missing.adoc")).length,
        include: text.filter((t) => t.includes("partials/gone.adoc")).length,
        cycles: cycle.length,
        cycleCoversBoth: cycle.filter((t) => t.includes("cycle-a.adoc") && t.includes("cycle-b.adoc")).length,
      };
    })()`);
    assert(state.xref === 1, `expected exactly one broken xref, got ${state.xref} (total=${state.total})`);
    assert(state.include === 1, `expected exactly one missing include, got ${state.include} (total=${state.total})`);
    assert(state.cycles === 1, `include cycle must be reported once, got ${state.cycles}`);
    assert(state.cycleCoversBoth === 1, "cycle message does not name both files");

    // A finding must navigate away from the singleton view to the offending note.
    assert(await c.realClick('[data-testid="doc-audit-issue"]', 0), "could not click a finding");
    await c.waitFor(
      `!document.querySelector('[data-testid="doc-audit-view"]')`,
      8000,
      "note opened from the audit",
    );
    return `${state.total} findings: 1 xref, 1 include, 1 cycle; jump left the audit view`;
  });

  // ---- 9. T-045 slice 2: Antora component/version lookup -----------------
  await runCase("antora-components", async () => {
    await c.key("p", "KeyP", 80, 2); // Ctrl+P command palette
    await c.waitFor(`!!document.querySelector('[data-testid="palette-input"]')`, 6000, "command palette");
    await c.setInput('[data-testid="palette-input"]', "检查文档规范");
    await sleep(350);
    if ((await c.evaluate(`document.querySelectorAll('[data-testid="palette-item"]').length`)) === 0) {
      await c.setInput('[data-testid="palette-input"]', "conventions");
      await sleep(350);
    }
    assert(await c.click('[data-testid="palette-item"]'), "audit command not found in the palette");
    await c.waitFor(`!!document.querySelector('[data-testid="doc-audit-view"]')`, 8000, "doc audit view");
    await c.waitFor(
      `document.querySelectorAll('[data-testid="doc-audit-issue"]').length > 0`,
      25000,
      "audit findings",
    );
    const state = await c.evaluate(`(() => {
      const text = [...document.querySelectorAll('[data-testid="doc-audit-issue"]')]
        .map((el) => el.textContent || "");
      return {
        versions: text.filter((t) => t.includes("2 个组件版本")).length,
        broken: text.filter((t) => t.includes("9.9@catalog")).length,
        valid: text.filter((t) => t.includes("2.0@catalog")).length,
      };
    })()`);
    assert(state.versions === 1,
      `expected one honest version ambiguity, got ${state.versions}`);
    assert(state.broken === 1,
      `expected one broken unknown-version id, got ${state.broken}`);
    assert(state.valid === 0,
      `a version-qualified valid id was reported as broken: ${state.valid}`);
    return `1 version ambiguity, 1 unknown version, 0 false positives`;
  });

  // ---- 10. L4 extension: read-only ebook formats + shared image reader ----
  await runCase("ebook-formats", async () => {
    // Earlier cases leave the left sidebar on the search panel; the explorer is
    // a different left-panel tab and is not mounted at all until shown.
    await c.key("p", "KeyP", 80, 2);
    await c.waitFor(`!!document.querySelector('[data-testid="palette-input"]')`, 6000, "command palette");
    await c.setInput('[data-testid="palette-input"]', "显示文件列表");
    await sleep(350);
    assert(await c.click('[data-testid="palette-item"]'), "show file explorer command not found");
    await c.waitFor(`!!document.querySelector('[data-testid="explorer"]')`, 8000, "explorer mounted");

    const open = async (file, testid) => {
      const clicked = await c.click(`[data-testid="explorer-item"][data-path="${file}"]`);
      assert(clicked, `could not open ${file} from the explorer`);
      await c.waitFor(
        `!!document.querySelector('[data-testid="${testid}"]')`,
        10000,
        `${file} preview mounted`,
      );
    };

    await open("sample.fb2", "fb2-preview");
    let text = await c.evaluate(
      `document.querySelector('[data-testid="fb2-preview"]').textContent`);
    assert(text.includes("E2E FictionBook") && text.includes("Chapter One"),
      `plain FB2 content missing: ${text}`);

    await open("sample.fb2.zip", "fb2-preview");
    text = await c.evaluate(
      `document.querySelector('[data-testid="fb2-preview"]').textContent`);
    assert(text.includes("Zipped FictionBook"), `zipped FB2 content missing: ${text}`);

    await open("sample.cbz", "cbz-preview");
    await c.waitFor(
      `document.querySelector('[data-testid="image-position"]')?.textContent.includes("1 / 3")`,
      8000,
      "comic first page (3 images)",
    );
    assert(await c.click('[data-testid="image-next"]'), "comic next-page button");
    await c.waitFor(
      `document.querySelector('[data-testid="image-position"]')?.textContent.includes("2 / 3")`,
      6000,
      "comic page 2",
    );
    const alt = await c.evaluate(
      `document.querySelector('[data-testid="attachment-image"]')?.getAttribute("alt")`);
    assert(alt === "page2.png", `numeric page ordering broken: ${alt}`);

    await open("sample.png", "image-reader");
    const natural = await c.evaluate(
      `document.querySelector('[data-testid="attachment-image"]')?.naturalWidth ?? 0`);
    assert(natural > 0, "single image did not decode");
    assert(await c.click('[data-testid="image-zoom-in"]'), "zoom-in button");
    const zoom = await c.evaluate(
      `document.querySelector('[data-testid="image-zoom"]')?.textContent`);
    assert(zoom && zoom.includes("125"), `zoom did not change: ${zoom}`);
    return "FB2 + FB2.ZIP + CBZ (3 numeric pages) + single image with zoom";
  });

  // ---- 11. T-045 slice 3: pin one Antora component version ----------------
  await runCase("antora-version-switch", async () => {
    await c.key("p", "KeyP", 80, 2);
    await c.waitFor(`!!document.querySelector('[data-testid="palette-input"]')`, 6000, "command palette");
    await c.setInput('[data-testid="palette-input"]', "检查文档规范");
    await sleep(350);
    if ((await c.evaluate(`document.querySelectorAll('[data-testid="palette-item"]').length`)) === 0) {
      await c.setInput('[data-testid="palette-input"]', "conventions");
      await sleep(350);
    }
    assert(await c.click('[data-testid="palette-item"]'), "audit command not found in the palette");
    await c.waitFor(`!!document.querySelector('[data-testid="doc-audit-view"]')`, 8000, "doc audit view");
    await c.waitFor(`!!document.querySelector('[data-testid="doc-audit-version"]')`, 10000, "version picker");
    const options = await c.evaluate(
      `document.querySelector('[data-testid="doc-audit-version"]').options.length`);
    assert(options === 3, `expected auto + 2 component versions, got ${options}`);
    await c.waitFor(
      `[...document.querySelectorAll('[data-testid="doc-audit-issue"]')].some(e => (e.textContent || "").includes("2 个组件版本"))`,
      25000,
      "initial version ambiguity",
    );

    // A native select needs its own value setter (cdp.setInput targets inputs).
    const setVersion = (value) => c.evaluate(`(() => {
      const el = document.querySelector('[data-testid="doc-audit-version"]');
      if (!el) return false;
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    // U+0000 separates component / version in the option value; build it at
    // runtime so no backslash escape is folded by the template literal.
    const sep = String.fromCharCode(0);
    assert(await setVersion("catalog" + sep + "2.0"), "could not set version");

    await c.waitFor(
      `[...document.querySelectorAll('[data-testid="doc-audit-issue"]')].every(e => !(e.textContent || "").includes("2 个组件版本"))`,
      25000,
      "pin removes the ambiguity",
    );
    const state = await c.evaluate(`(() => {
      const text = [...document.querySelectorAll('[data-testid="doc-audit-issue"]')]
        .map((e) => e.textContent || "");
      return {
        versions: text.filter((x) => x.includes("2 个组件版本")).length,
        broken: text.filter((x) => x.includes("9.9@catalog")).length,
        selected: document.querySelector('[data-testid="doc-audit-version"]').value,
      };
    })()`);
    assert(state.versions === 0, `ambiguity remained after pin: ${state.versions}`);
    assert(state.broken === 1, "an explicit version@ id must still be validated");
    assert(state.selected.includes("2.0"), `picker did not reflect the pin: ${state.selected}`);

    assert(await setVersion(""), "could not reset version");
    await c.waitFor(
      `[...document.querySelectorAll('[data-testid="doc-audit-issue"]')].some(e => (e.textContent || "").includes("2 个组件版本"))`,
      25000,
      "auto mode restored",
    );
    return "2 versions offered; pin removes ambiguity, explicit version@ still checked, auto restored";
  });

  // ---- 12. Q-005: Kindle formats are routed, read-only, fail visibly -----
  await runCase("kindle-formats", async () => {
    await c.key("p", "KeyP", 80, 2);
    await c.waitFor(`!!document.querySelector('[data-testid="palette-input"]')`, 6000, "command palette");
    await c.setInput('[data-testid="palette-input"]', "显示文件列表");
    await sleep(350);
    assert(await c.click('[data-testid="palette-item"]'), "show file explorer command not found");
    await c.waitFor(`!!document.querySelector('[data-testid="explorer"]')`, 8000, "explorer mounted");

    const open = async (file) => {
      assert(await c.click(`[data-testid="explorer-item"][data-path="${file}"]`),
        `could not open ${file}`);
      await c.waitFor(
        `document.querySelector('[data-testid="attachment-view"]')?.getAttribute("data-attachment-path") === ${JSON.stringify(file)} && !!document.querySelector('[data-testid="format-error"]')`,
        20000,
        `${file} routed to the Kindle viewer with an error`,
      );
      const state = await c.evaluate(`(() => {
        const view = document.querySelector('[data-testid="attachment-view"]');
        return {
          format: view?.getAttribute("data-format"),
          save: !!document.querySelector('[data-testid="xlsx-save"]'),
        };
      })()`);
      assert(state.format === "Kindle", `expected Kindle viewer, got ${state.format}`);
      assert(state.save === false, "a read-only preview must not expose a save button");
    };
    await open("sample.mobi");
    await open("sample.azw3");
    return "MOBI + AZW3 routed to a read-only Kindle viewer; invalid files report a visible error";
  });

  // ---- 13. T-056: edit recovery covers text formats, not just .md --------
  // Drives the REAL save hook (file:modified → recordSnapshot); before T-056 an
  // AsciiDoc edit produced no history at all.
  await runCase("snapshot-text-formats", async () => {
    await c.key("p", "KeyP", 80, 2);
    await c.waitFor(`!!document.querySelector('[data-testid="palette-input"]')`, 6000, "command palette");
    await c.setInput('[data-testid="palette-input"]', "显示文件列表");
    await sleep(350);
    assert(await c.click('[data-testid="palette-item"]'), "show file explorer command not found");
    await c.waitFor(`!!document.querySelector('[data-testid="explorer"]')`, 8000, "explorer mounted");

    assert(await c.click('[data-testid="explorer-item"][data-path="E2E-Guide.adoc"]'),
      "could not open E2E-Guide.adoc");
    await c.waitFor(`!!document.querySelector('[data-testid="editor-pane"]')`, 10000, "editor pane");
    // default open mode is the reading view — switch to source so we can type
    assert(await c.click('[data-testid="mode-source"]'), "no source button for the AsciiDoc file");
    await c.waitFor(`!!document.querySelector('.cm-editor .cm-content')`, 10000, "AsciiDoc opened in the editor");

    const before = await c.evaluate(
      `globalThis.__geodeSnapshots.list("E2E-Guide.adoc").then((l) => l.length)`,
    );

    // CM6 only commits text from a FOCUSED contenteditable; CDP `Input.insertText`
    // is silently a no-op here, so drive it through execCommand and assert it took.
    const typed = await c.evaluate(`(() => {
      const el = document.querySelector(".cm-editor .cm-content");
      if (!el) return false;
      el.focus();
      return document.execCommand("insertText", false, "\\nT-056 probe ${Date.now()}\\n");
    })()`);
    assert(typed === true, "could not type into the AsciiDoc editor");

    await c.waitFor(
      `globalThis.__geodeSnapshots.list("E2E-Guide.adoc").then((l) => l.length > ${before})`,
      15000,
      "editing + autosave of an .adoc file recorded a recovery snapshot",
    );

    // A binary in the same vault must never accumulate history.
    const binarySnaps = await c.evaluate(
      `globalThis.__geodeSnapshots.list("sample.png").then((l) => l.length)`,
    );
    assert(binarySnaps === 0, `an image must not have snapshots, got ${binarySnaps}`);
    return `.adoc save recorded history (${before} → ${before + 1}); image kept 0`;
  });

  // ---- 14. T-057: optional off-disk backup writes a real archive outside ----
  await runCase("offdisk-backup", async () => {
    const target = process.env.GEODE_E2E_BACKUP || path.join(os.tmpdir(), "adkm-e2e-backup");
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });

    const first = await c.evaluate(
      `globalThis.__geodeBackup.run(${JSON.stringify(target)}, 10, Date.now())`,
    );
    assert(first && first.ok === true, `backup failed: ${JSON.stringify(first)}`);

    // the archive is on disk, holds the document and the config tree
    const entries = await readZipEntries(path.join(target, first.name));
    assert(entries.includes("E2E-Guide.adoc"), "archive lost the AsciiDoc document");
    assert(entries.some((e) => e.startsWith(".obsidian/")), "archive lost the .obsidian config tree");
    assert(!entries.some((e) => e.startsWith(".trash/")), "archive must skip the trash");

    // a target inside the vault must be refused (otherwise it recurses)
    const vaultPath = await c.evaluate(`globalThis.__geodeBackup.vaultPath()`);
    assert(typeof vaultPath === "string" && vaultPath.length > 0, "probe did not expose the vault path");
    const refused = await c.evaluate(
      `globalThis.__geodeBackup.run(${JSON.stringify(path.join(vaultPath, "bk"))}, 10, Date.now())`,
    );
    assert(refused && refused.ok === false && refused.reason === "inside-vault",
      `vault-internal target was not refused: ${JSON.stringify(refused)}`);

    // retention: a second run with keep=1 leaves exactly one archive
    const second = await c.evaluate(
      `globalThis.__geodeBackup.run(${JSON.stringify(target)}, 1, Date.now() + 5000)`,
    );
    assert(second && second.ok === true, `second backup failed: ${JSON.stringify(second)}`);
    const left = readdirSync(target).filter((n) => n.startsWith("adkm-backup-"));
    assert(left.length === 1 && left[0] === second.name,
      `keep=1 should leave exactly the newest archive, got ${JSON.stringify(left)}`);
    return `${first.name}: ${entries.length} entries; inside-vault refused; keep=1 → 1 archive`;
  });

  // ---- 15. T-058: startup mode really changes what a reload brings back ----
  await runCase("startup-mode", async () => {
    // start from a session with one open tab so "restore" is observable
    await c.key("p", "KeyP", 80, 2);
    await c.waitFor(`!!document.querySelector('[data-testid="palette-input"]')`, 6000, "command palette");
    await c.setInput('[data-testid="palette-input"]', "显示文件列表");
    await sleep(350);
    assert(await c.click('[data-testid="palette-item"]'), "show file explorer command not found");
    await c.waitFor(`!!document.querySelector('[data-testid="explorer"]')`, 8000, "explorer mounted");
    assert(await c.click('[data-testid="explorer-item"][data-path="E2E-Note.md"]'), "could not open E2E-Note.md");
    await c.waitFor(`document.querySelectorAll('.tab-bar .tab').length >= 1`, 10000, "a tab is open");

    const setMode = async (mode) => {
      await c.key(",", "Comma", 188, 2); // Mod+, → settings
      await c.waitFor(`!!document.querySelector('[data-testid="settings-modal"]')`, 8000, "settings modal");
      assert(await c.click('[data-testid="settings-nav-startup"]'), "no startup section in settings");
      await c.waitFor(
        `!!document.querySelector('[data-testid="settings-startup-radio-${mode}"]')`,
        8000,
        "startup radios",
      );
      assert(await c.click(`[data-testid="settings-startup-radio-${mode}"]`), `could not pick ${mode}`);
      const saved = await c.evaluate(`localStorage.getItem("adkm.startupMode")`);
      assert(saved === mode, `startup mode not persisted (got ${saved})`);
      assert(await c.click('[data-testid="settings-close"]'), "could not close settings");
      await c.waitFor(`!document.querySelector('[data-testid="settings-modal"]')`, 6000, "settings closed");
    };

    const reload = async () => {
      await c.call("Page.reload", { ignoreCache: false });
      await sleep(2500);
      await c.waitFor(`!!document.querySelector('[data-testid="app-root"]')`, 25000, "app booted after reload");
    };

    await setMode("fresh");
    await reload();

    // T-059: the theme must be decided by the inline bootstrap in index.html,
    // BEFORE this bundle runs — otherwise the first frame paints in the wrong
    // colour (the stylesheet default is dark).
    const themeBoot = await c.evaluate(`JSON.stringify({
      boot: window.__themeBootstrapAt ?? null,
      script: window.__appScriptAt ?? null,
      theme: document.documentElement.dataset.theme ?? null,
      bg: getComputedStyle(document.documentElement).backgroundColor,
    })`);
    const boot = JSON.parse(themeBoot);
    assert(boot.boot !== null, "the pre-paint theme bootstrap did not run");
    assert(boot.script !== null && boot.boot <= boot.script,
      `theme decided after the bundle started (boot=${boot.boot}, script=${boot.script})`);
    assert(boot.theme === "dark" || boot.theme === "light", `data-theme not resolved: ${boot.theme}`);
    const expectedBg = boot.theme === "dark" ? "rgb(30, 30, 30)" : "rgb(245, 245, 245)";
    assert(boot.bg === expectedBg, `first frame colour ${boot.bg} != ${expectedBg} for ${boot.theme}`);

    const freshTabs = await c.evaluate(`document.querySelectorAll('.tab-bar .tab').length`);
    assert(freshTabs === 0, `a fresh window must restore no tabs, got ${freshTabs}`);

    await setMode("restore");
    await reload();
    await c.waitFor(
      `document.querySelectorAll('.tab-bar .tab').length >= 1`,
      20000,
      "the previous session came back after switching to restore",
    );
    const restored = await c.evaluate(`document.querySelectorAll('.tab-bar .tab').length`);
    return `${freshTabs} tab(s) in a fresh window; ${restored} restored after switching back`;
  });

  // ---- 16. T-061: a large PDF must not be read during startup ------------
  await runCase("pdf-startup-gate", async () => {
    // earlier cases may have left the docs folder expanded — only toggle when closed
    const smallVisible = () => c.evaluate(
      `!!document.querySelector('[data-testid="explorer-item"][data-path="docs/scan-small.pdf"]')`,
    );
    if (!(await smallVisible())) {
      await c.click('[data-testid="explorer-item"][data-path="docs"]');
      await sleep(500);
    }
    assert(await smallVisible(), "the docs folder did not reveal the PDF fixtures");

    assert(await c.click('[data-testid="explorer-item"][data-path="docs/scan-small.pdf"]'),
      "could not open scan-small.pdf");
    await c.waitFor(`!!document.querySelector('[data-testid="attachment-pdf"]')`, 15000,
      "a small PDF still mounts (deferred past the boot paint)");

    assert(await c.click('[data-testid="explorer-item"][data-path="docs/scan-big.pdf"]'),
      "could not open scan-big.pdf");    await c.waitFor(`!!document.querySelector('[data-testid="attachment-pdf-gated"]')`, 15000,
      "the 40 MB PDF is gated behind a button");
    const embeds = await c.evaluate(`document.querySelectorAll('[data-testid="attachment-pdf"]').length`);
    assert(embeds === 0, `a gated PDF must not create an <embed> before the user asks (got ${embeds})`);

    assert(await c.click('[data-testid="attachment-pdf-load"]'), "the gate has no load button");
    await c.waitFor(`!!document.querySelector('[data-testid="attachment-pdf"]')`, 20000,
      "clicking load mounts the PDF");
    return "small PDF mounts after paint; a 40 MB PDF waits for an explicit load";
  });

  // ---- 17. T-061: EPUB TOC + reading position survive a restart -----------
  await runCase("epub-toc-progress", async () => {
    assert(await c.click('[data-testid="explorer-item"][data-path="sample.epub"]'), "could not open sample.epub");
    await c.waitFor(`!!document.querySelector('[data-testid="epub-preview"]')`, 20000, "epub viewer mounted");

    assert(await c.click('[data-testid="epub-toc-toggle"]'), "the reader has no contents button");
    await c.waitFor(`document.querySelectorAll('[data-testid="epub-toc-item"]').length >= 3`, 20000,
      "the nav document produced three TOC rows");
    const labels = await c.evaluate(`JSON.stringify([...document.querySelectorAll('[data-testid="epub-toc-item"]')].map(function (b) { return b.textContent.trim(); }))`);
    assert(labels.includes("Chapter Three"), `TOC labels look wrong: ${labels}`);

    // jump to the last chapter: the footer percentage must follow
    await c.evaluate(`(() => { const b = [...document.querySelectorAll('[data-testid="epub-toc-item"]')].find(function (x) { return x.textContent.trim() === "Chapter Three"; }); if (b) b.click(); return !!b; })()`);
    await c.waitFor(`document.querySelector('[data-testid="epub-percent"]') && document.querySelector('[data-testid="epub-percent"]').textContent.trim() === "100%"`,
      20000, "percentage tracks the chapter jump");
    await sleep(700); // the position write is debounced by 400 ms

    const stored = await c.evaluate(`(() => { const k = Object.keys(localStorage).find(function (x) { return x.startsWith("adkm.epub.pos:"); }); if (!k) return null; const p = JSON.parse(localStorage.getItem(k)); return { percent: p.percent, hasCfi: typeof p.cfi === "string" && p.cfi.length > 0 }; })()`);
    assert(stored && stored.hasCfi, `no reading position was stored: ${JSON.stringify(stored)}`);
    assert(stored.percent === 100, `stored percentage should be 100, got ${stored.percent}`);

    // restart the app page: the reader must come back to the same place
    await c.call("Page.reload", { ignoreCache: false });
    await sleep(2500);
    await c.waitFor(`!!document.querySelector('[data-testid="app-root"]')`, 25000, "app booted after reload");
    await c.waitFor(`document.querySelector('[data-testid="epub-percent"]') && document.querySelector('[data-testid="epub-percent"]').textContent.trim() === "100%"`,
      25000, "the reading position was restored after a restart");
    return `3 TOC rows, jump → 100%, position restored after restart (${stored.percent}%)`;
  });

  // ---- 18. T-061: regress the startup stall, not just the gate UI ----------
  // A restored large PDF used to block the renderer for 72+151 ms. The gate made
  // that zero; this case keeps it zero by summing animation-frame gaps during boot.
  await runCase("pdf-restore-no-stall", async () => {
    if (!(await c.evaluate(`!!document.querySelector('[data-testid="explorer-item"][data-path="docs/scan-big.pdf"]')`))) {
      await c.click('[data-testid="explorer-item"][data-path="docs"]');
      await sleep(500);
    }
    assert(await c.click('[data-testid="explorer-item"][data-path="docs/scan-big.pdf"]'),
      "could not open scan-big.pdf");
    await c.waitFor(`!!document.querySelector('[data-testid="attachment-pdf-gated"]')`, 20000,
      "the 40 MB PDF is gated");

    // the Page domain must be enabled before new-document scripts are honoured
    await c.call("Page.enable");
    const injected = await c.call("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__e2eGap = [];
(function raf() { var prev = performance.now(); function tick() { var now = performance.now();
  if (now - prev > 50) window.__e2eGap.push(Math.round(now - prev)); prev = now; requestAnimationFrame(tick); }
  requestAnimationFrame(tick); })();`,
    });
    try {
      await c.call("Page.reload", { ignoreCache: false });
      await sleep(4500);
      // vacuity guard: if the injected recorder never ran, an empty list would
      // make "0 ms blocked" meaningless
      const raw = await c.evaluate(`Array.isArray(window.__e2eGap) ? JSON.stringify(window.__e2eGap) : "MISSING"`);
      assert(raw !== "MISSING", "the frame-gap recorder did not run — the check would be vacuous");
      const gaps = JSON.parse(raw);
      const blocked = gaps.reduce((sum, ms) => sum + ms, 0);
      assert(blocked <= 100, `startup blocked ${blocked} ms across ${gaps.length} frames (${JSON.stringify(gaps)})`);
      await c.waitFor(`!!document.querySelector('[data-testid="attachment-pdf-gated"]')`, 25000,
        "the gated PDF is still gated after restart");
      return `boot blocked ${blocked} ms (${gaps.length} frames >50 ms); 40 MB PDF still behind the gate`;
    } finally {
      await c.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: injected.identifier });
    }
  });

  // ---- 19. P1-3: AsciiDoc conversion runs off the main thread -------------
  await runCase("adoc-worker-offthread", async () => {
    const measure = async () => JSON.parse(await c.evaluate(`(async () => {
      if (typeof window.__geodeAdocProbe !== "function") return { missing: true };
      const source = "= Worker bench\\n\\n" + "== Section\\n\\nText *bold*.\\n\\n".repeat(500);
      return JSON.stringify(await window.__geodeAdocProbe(source));
    })()`));
    const result = await measure();
    assert(!result.missing, "the AsciiDoc worker probe is not installed");
    // P1-3 is a CPU-offload change, not a wall-clock speedup: Asciidoctor yields
    // internally, so a 5 ms timer is not measurably delayed on either path here.
    // Prove instead that the Worker actually produced identical HTML.
    assert(result.workerActive === true, "AsciiDoc conversion did not use the Worker");
    assert(result.sameHtml === true, "Worker and in-page conversion produced different HTML");
    assert(result.workerMs > 0 && result.inPageMs > 0,
      `conversions did not run: ${JSON.stringify(result)}`);
    return `Worker ${result.workerMs} ms vs in-page ${result.inPageMs} ms, identical HTML, Worker active`;
  });

  // ---- 20. T-062/P0-1: raw-byte IPC round-trips a large binary ------------
  // Uses the always-on explorer-copy throat: readBinary → createBinary →
  // readBinary on REAL fs. The old base64 envelope added atob + a per-byte JS loop.
  await runCase("raw-binary-ipc", async () => {
    if (!(await c.evaluate(`!!document.querySelector('[data-testid="explorer-item"][data-path="docs/scan-big.pdf"]')`))) {
      await c.click('[data-testid="explorer-item"][data-path="docs"]');
      await sleep(500);
    }
    const result = await c.evaluate(`(async () => {
      const gaps = [];
      let prev = performance.now();
      let live = true;
      (function tick() { const now = performance.now(); if (now - prev > 50) gaps.push(Math.round(now - prev)); prev = now; if (live) requestAnimationFrame(tick); })();
      const t0 = performance.now();
      const out = await window.__geodeExplorerCopy("docs/scan-big.pdf");
      const ms = Math.round(performance.now() - t0);
      live = false;
      return JSON.stringify({ ...out, ms, gaps });
    })()`);
    const copy = JSON.parse(result);
    assert(copy.sameBytes === true, `raw-byte copy must be byte-identical: ${JSON.stringify(copy)}`);
    assert(copy.len === 40 * 1024 * 1024, `unexpected copy length ${copy.len}`);
    const blocked = copy.gaps.reduce((s, ms) => s + ms, 0);
    assert(blocked < 200, `raw-byte copy blocked ${blocked} ms across ${copy.gaps.length} frames`);
    return `40 MB copy byte-identical in ${copy.ms} ms, ${blocked} ms main-thread gaps`;
  });

  // ---- 21. T-061: TOC jumps really move the reader, and highlight follows --
  await runCase("epub-reading-controls", async () => {
    assert(await c.click('[data-testid="explorer-item"][data-path="sample.epub"]'), "could not open sample.epub");
    await c.waitFor(`!!document.querySelector('[data-testid="epub-preview"]')`, 20000, "epub viewer mounted");
    if (!(await c.evaluate(`!!document.querySelector('[data-testid="epub-toc"]')`))) {
      await c.click('[data-testid="epub-toc-toggle"]');
    }
    await c.waitFor(`document.querySelectorAll('[data-testid="epub-toc-item"]').length >= 3`, 20000, "toc rows");

    const jump = async (label, expected) => {
      await c.evaluate(`(() => { const b = [...document.querySelectorAll('[data-testid="epub-toc-item"]')].find(function (x) { return x.textContent.trim() === ${JSON.stringify(label)}; }); if (b) b.click(); return !!b; })()`);
      await c.waitFor(`document.querySelector('[data-testid="epub-percent"]').textContent.trim() === "${expected}"`,
        20000, `percentage after jumping to ${label}`);
      const current = await c.evaluate(`(() => { const el = document.querySelector('[data-testid="epub-toc-item"].is-current'); return el ? el.textContent.trim() : null; })()`);
      assert(current === label, `current chapter highlight is ${current}, expected ${label}`);
    };

    await jump("Chapter One", "33%");
    await jump("Chapter Two", "67%");
    await jump("Chapter Three", "100%");

    // page turning: next() must move the percentage off 100 only by wrapping is not
    // asserted; instead go back to Chapter One and page forward until it advances.
    await jump("Chapter One", "33%");
    let advanced = false;
    for (let i = 0; i < 8 && !advanced; i += 1) {
      assert(await c.click('[data-testid="epub-next"]'), "no next button");
      await sleep(350);
      const pct = await c.evaluate(`document.querySelector('[data-testid="epub-percent"]').textContent.trim()`);
      if (pct !== "33%") advanced = true;
    }
    assert(advanced, "clicking next never advanced past 33%");
    assert(await c.click('[data-testid="epub-prev"]'), "no prev button");
    await sleep(350);
    return "TOC jumps 33/67/100 with matching highlight; next advances, prev responds";
  });

  // ---- 22. T-061: a book without a nav document degrades honestly ----------
  await runCase("epub-no-nav", async () => {
    assert(await c.click('[data-testid="explorer-item"][data-path="sample-nonav.epub"]'),
      "could not open sample-nonav.epub");
    await c.waitFor(`!!document.querySelector('[data-testid="epub-preview"]')`, 20000, "viewer mounts without a nav doc");
    if (!(await c.evaluate(`!!document.querySelector('[data-testid="epub-toc"]')`))) {
      await c.click('[data-testid="epub-toc-toggle"]');
    }
    await c.waitFor(`!!document.querySelector('.epub-toc-empty')`, 15000,
      "an empty-TOC message is shown instead of a blank panel");
    // the reader must also report a real position: a single-spine book resolves to
    // 100%, and 0% would mean `relocated` never fired
    await c.waitFor(`document.querySelector('[data-testid="epub-percent"]').textContent.trim() !== "0%"`,
      15000, "the reader reported a position for a book without a nav document");
    const pct = await c.evaluate(`document.querySelector('[data-testid="epub-percent"]').textContent.trim()`);
    assert(pct === "100%", `a one-chapter book should report 100%, got ${pct}`);
    return `no nav → "no contents" notice, reader still reports ${pct}`;
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
