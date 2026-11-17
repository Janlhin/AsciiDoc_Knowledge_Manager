import { useEffect, useState } from "react";
import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";

/**
 * DOCX preview (ADKM L4) — mammoth converts the .docx OOXML package to semantic
 * HTML (headings, lists, tables, bold/italic, links, images-as-relative-paths).
 * Read-only: the attachment viewer never enters the editable/autosave path
 * (R102), so a .docx can never be corrupted by a UTF-8 round-trip. Legacy
 * binary .doc is not supported by mammoth → we surface `attachment.loadFailed`.
 *
 * The mammoth dependency is large; it is lazy-loaded via dynamic import so it
 * stays in its own chunk and only downloads when a Word file is opened.
 */
/*
 * P1-1: mammoth runs in a dedicated Worker. The bridge keeps one pending map
 * (id-routed so overlapping opens cannot cross-answer) and falls back to the
 * original in-page import when Worker is unavailable or fails.
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
    worker = new Worker(new URL("./docx.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const req = pending.get(event.data.id);
      if (!req) return;
      pending.delete(event.data.id);
      if (typeof event.data.html === "string") req.resolve(event.data.html);
      else req.reject(new Error(event.data.error ?? "DOCX worker returned no HTML"));
    };
    worker.onerror = () => {
      workerBroken = true;
      worker?.terminate();
      worker = null;
      for (const req of pending.values()) req.reject(new Error("DOCX worker failed"));
      pending.clear();
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

async function convertInWorker(arrayBuffer: ArrayBuffer): Promise<string> {
  const w = ensureWorker();
  if (!w) throw new Error("worker unavailable");
  const id = nextId;
  nextId += 1;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, arrayBuffer });
  });
}

async function convertInPage(arrayBuffer: ArrayBuffer): Promise<string> {
  const mammoth = (await import("mammoth")).default as unknown as {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
  };
  return (await mammoth.convertToHtml({ arrayBuffer })).value;
}

/** Exposed for the perf probe: is the active converter a Worker? */
export function isDocxWorkerActive(): boolean {
  return worker !== null && !workerBroken;
}

/** Probe-only entry point; normal callers use the component effect below. */
export async function convertDocx(
  arrayBuffer: ArrayBuffer,
  options: { forceInPage?: boolean } = {},
): Promise<string> {
  if (options.forceInPage) return convertInPage(arrayBuffer);
  try {
    return await convertInWorker(arrayBuffer);
  } catch {
    return convertInPage(arrayBuffer);
  }
}

export function DocxPreview({ path }: { path: string }) {
  const app = useApp();
  const t = useI18n();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    void (async () => {
      try {
        const bytes = await app.vault.readBinary(path);
        // copy into a standalone ArrayBuffer (adapter bytes may be a view over a
        // larger buffer; slice() yields a fresh, exact-size buffer)
        const arrayBuffer = bytes.slice().buffer;
        const value = await convertDocx(arrayBuffer);
        if (!cancelled) setHtml(value);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app, path]);

  if (error) {
    return (
      <div className="attachment-placeholder" data-testid="format-error">
        <span>{t("attachment.loadFailed")}</span>
      </div>
    );
  }
  if (html === null) {
    return (
      <div className="attachment-placeholder">
        <span>{t("attachment.rendering")}</span>
      </div>
    );
  }
  return (
    <div
      className="format-docx docx-reading-view markdown-rendered"
      data-testid="docx-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
