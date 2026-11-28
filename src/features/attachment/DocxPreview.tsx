import { useEffect, useState } from "react";
import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";
import { workerPool } from "@core/workers/workerPool";

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
 * T-063: mammoth runs through the shared WorkerPool (P1-1). The pool keeps the
 * id-routed pending map, lane reuse and fallback; this bridge only supplies the
 * worker URL, the payload and the reply decoder. If the pool cannot run
 * off-thread (tier C / spawn failure) the caller falls back to the in-page
 * import, exactly like the former dedicated worker.
 */
async function convertInWorker(arrayBuffer: ArrayBuffer): Promise<string> {
  return workerPool.submit<string>({
    spec: {
      kind: "docx",
      url: new URL("./docx.worker.ts", import.meta.url),
      create: () => new Worker(new URL("./docx.worker.ts", import.meta.url), { type: "module" }),
    },
    payload: { arrayBuffer },
    transfer: [arrayBuffer],
    priority: "visible",
    decode: (reply) => {
      if (typeof reply.html === "string") return reply.html;
      throw new Error(
        typeof reply.error === "string" && reply.error !== ""
          ? reply.error
          : "DOCX worker returned no HTML",
      );
    },
  });
}

async function convertInPage(arrayBuffer: ArrayBuffer): Promise<string> {
  const mammoth = (await import("mammoth")).default as unknown as {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
  };
  return (await mammoth.convertToHtml({ arrayBuffer })).value;
}

/** Exposed for the perf probe: has a pooled Worker lane for DOCX been spawned? */
export function isDocxWorkerActive(): boolean {
  return workerPool.hasActiveKind("docx");
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
