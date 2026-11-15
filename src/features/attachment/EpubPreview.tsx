import { useEffect, useRef, useState } from "react";
import type { Book } from "epubjs";
import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";

/**
 * EPUB preview (ADKM L4) — epub.js renders the book into a paginated reader
 * inside a container. Read-only (matching vscode-office, which also only
 * *views* EPUB — there is no in-browser EPUB editor). epub.js unpacks the book
 * into memory and serves each spine item via blob URLs, so no network access is
 * required (works offline inside the Tauri webview).
 *
 * epub.js is lazy-loaded so it stays out of the main bundle.
 */
export function EpubPreview({ path }: { path: string }) {
  const app = useApp();
  const t = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let book: Book | null = null;
    const dispose = () => {
      const ownedBook = book;
      book = null;
      try {
        ownedBook?.off("openFailed", fail);
        // Book owns the rendition and destroys it; do not destroy it twice.
        ownedBook?.destroy();
      } catch {
        /* best-effort teardown if epub.js fails during destruction */
      }
    };
    const fail = (err: unknown) => {
      dispose();
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    };
    setError(null);
    void (async () => {
      try {
        const bytes = await app.vault.readBinary(path);
        if (cancelled) return;
        const ePub = (await import("epubjs")).default;
        if (cancelled) return;
        const el = containerRef.current;
        if (!el) return;
        const arrayBuffer = bytes.slice().buffer;
        book = ePub(arrayBuffer);
        // Failed opening emits an event; display() can remain pending forever.
        book.on("openFailed", fail);
        const height = el.clientHeight || 640;
        const rendition = book.renderTo(el, {
          width: "100%",
          height,
          spread: "none",
          flow: "paginated",
        });
        await rendition.display();
      } catch (err) {
        fail(err);
      }
    })();
    return () => {
      cancelled = true;
      dispose();
    };
  }, [app, path]);

  if (error) {
    return (
      <div className="attachment-placeholder" data-testid="format-error">
        <span>{t("attachment.loadFailed")}</span>
      </div>
    );
  }

  return (
    <div className="format-epub" data-testid="epub-preview">
      <div className="epub-viewer" ref={containerRef} />
    </div>
  );
}
