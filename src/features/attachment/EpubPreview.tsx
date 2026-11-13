import { useEffect, useRef, useState } from "react";
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
    let book: any = null;
    let rendition: any = null;
    setError(null);
    void (async () => {
      try {
        const bytes = await app.vault.readBinary(path);
        const ePub = (await import("epubjs")).default;
        const arrayBuffer = bytes.slice().buffer;
        book = (ePub as (b: ArrayBuffer) => any)(arrayBuffer);
        const el = containerRef.current;
        if (!el) return;
        const height = el.clientHeight || 640;
        rendition = book.renderTo(el, {
          width: "100%",
          height,
          spread: "none",
          flow: "paginated",
        }) as any;
        await (rendition as any).display();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      try {
        rendition?.destroy?.();
        book?.destroy?.();
      } catch {
        /* ignore teardown errors */
      }
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
