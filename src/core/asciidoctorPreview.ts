/**
 * ADKM L3: AsciiDoc reading-view renderer.
 *
 * The index path deliberately does NOT use Asciidoctor (see
 * docs/plans/L2-asciidoc-indexing.md, P3) — it is a pure regex scan so the
 * vault stays fast. The READING view needs full AsciiDoc semantics, so it
 * loads the official browser build lazily on the first `.adoc` preview.
 *
 * Verified 2026-11-13: `@asciidoctor/core@4.2.1` exposes
 * `exports["."].browser = build/browser/index.js`. It has NAMED exports only
 * (no default), and Vite externalizes its `node:fs`/`node:path` imports; those
 * code paths are never hit by `convert(source, ...)`.
 */

/*
 * P1-3: the converter module runs in a dedicated worker. One worker is enough:
 * the editor only renders the ACTIVE preview and stale results are ignored by
 * the caller; requests are routed by id so a slow conversion cannot answer the
 * wrong request. On environments without Worker (unit tests / older webviews)
 * we fall back to the original in-page dynamic import so previews still work.
 */
interface WorkerResponse {
  id: number;
  html?: string;
  error?: string;
}

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (html: string) => void; reject: (err: Error) => void }>();

function ensureWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./asciidoctor.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const req = pending.get(event.data.id);
      if (!req) return;
      pending.delete(event.data.id);
      if (typeof event.data.html === "string") req.resolve(event.data.html);
      else req.reject(new Error(event.data.error ?? "AsciiDoc worker returned no HTML"));
    };
    worker.onerror = () => {
      // fail all in-flight conversions; subsequent calls use the in-page fallback
      workerBroken = true;
      worker?.terminate();
      worker = null;
      for (const req of pending.values()) req.reject(new Error("AsciiDoc worker failed"));
      pending.clear();
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

async function convertInWorker(source: string): Promise<string> {
  const w = ensureWorker();
  if (!w) throw new Error("worker unavailable");
  const id = nextId;
  nextId += 1;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, source });
  });
}

async function convertInPage(source: string): Promise<string> {
  const mod = (await import("@asciidoctor/core")) as unknown as {
    convert(source: string, options?: Record<string, unknown>): Promise<string> | string;
  };
  return String(await mod.convert(source, {
    standalone: false,
    safe: "secure",
    attributes: {
      showtitle: true,
      outfilesuffix: ".adoc",
      icons: "font",
      sectanchors: false,
    },
  }));
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Asciidoctor's HTML backend assumes published `.html` files, so
 * `xref:Foo.adoc[]` becomes `href="Foo.html"` and the link is dead inside the
 * vault. `outfilesuffix: ".adoc"` (set below) keeps source suffixes intact;
 * this pass then rewrites every vault-local anchor into the same
 * `a.internal-link[data-target]` shape the Markdown pipeline emits, so the
 * existing click handler in EditorPane can open it (and `#anchor` becomes
 * `data-subpath`).
 *
 * External schemes, protocol-relative URLs and `data:`/`javascript:` links are
 * left alone (or neutralised by sanitizeHtml).
 */
function localizeLinks(html: string): string {
  return html.replace(/<a\s+[^>]*?href="([^"]+)"[^>]*>/gi, (full, href: string) => {
    // Same-document anchor (AsciiDoc :toc: / intra-page xref): keep the
    // fragment. Rewriting it into internal-link + data-subpath made the click
    // resolve as a note link, and Asciidoctor ids ("_xxx") are not resolvable
    // subpaths — the click then did nothing.
    if (href.startsWith("#")) return full;
    // scheme or protocol-relative → external, keep as-is
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return full;

    const hash = href.indexOf("#");
    const path = hash >= 0 ? href.slice(0, hash) : href;
    const subpath = hash >= 0 ? href.slice(hash + 1) : "";
    // decode nothing: Asciidoctor already emits the raw target for .adoc with
    // outfilesuffix, and `resolveMarkdownLink` handles %xx when needed.
    const attrs = [
      'class="internal-link"',
      `data-target="${escapeAttr(path)}"`,
      subpath ? `data-subpath="${escapeAttr(subpath)}"` : "",
      'href="#"',
    ]
      .filter(Boolean)
      .join(" ");
    return `<a ${attrs}>`;
  });
}

/** Minimal hardening before the fragment is assigned to innerHTML.
 *  `safe: "secure"` already disables includes; this covers raw HTML passthrough. */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "");
}

export interface AsciiDocPreviewResult {
  html: string;
  /** conversion + post-processing time, for the perf probe */
  elapsedMs: number;
}

let lastSource: string | null = null;
let lastHtml: string | null = null;

/** Render one AsciiDoc source string into an HTML fragment for the reading view. */
export async function renderAsciiDocPreview(
  source: string,
  options: { forceInPage?: boolean; skipCache?: boolean } = {},
): Promise<AsciiDocPreviewResult> {
  if (!options.skipCache && source === lastSource && lastHtml !== null) {
    return { html: lastHtml, elapsedMs: 0 };
  }
  const t0 = performance.now();
  let raw: string;
  try {
    raw = options.forceInPage ? await convertInPage(source) : await convertInWorker(source);
  } catch {
    // Worker creation/module load can fail in restricted webviews; the preview
    // must still render (with the old thread profile) rather than show an error.
    raw = await convertInPage(source);
  }
  const html = localizeLinks(sanitizeHtml(raw));
  lastSource = source;
  lastHtml = html;
  return { html, elapsedMs: performance.now() - t0 };
}

/** True when conversions are currently handled by the off-thread worker.
 *  Exposed for the perf probe so an E2E case can prove which path ran. */
export function isAsciiDocWorkerActive(): boolean {
  return worker !== null && !workerBroken;
}

/** True when the path should use the AsciiDoc reading-view pipeline. */
export function isAsciiDocPath(path: string): boolean {
  return path.toLowerCase().endsWith(".adoc");
}
