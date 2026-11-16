import { useEffect, useRef, useState } from "react";
import type { Book, Rendition } from "epubjs";
import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";
import {
  flattenToc,
  readPosition,
  sameDocument,
  spinePercent,
  writePosition,
  type TocEntry,
} from "@core/epubNav";

/**
 * EPUB preview (ADKM L4) — epub.js renders the book into a paginated reader
 * inside a container. Read-only (matching vscode-office, which also only
 * *views* EPUB — there is no in-browser EPUB editor). epub.js unpacks the book
 * into memory and serves each spine item via blob URLs, so no network access is
 * required (works offline inside the Tauri webview).
 *
 * T-061 added what was missing and made the feature feel broken: a real TOC
 * (epub.js `book.loaded.navigation`), page navigation, and a persisted reading
 * position (`relocated` → CFI + spine percentage). Before that, every book opened
 * on page one and every jump was forgotten on reload.
 *
 * epub.js is lazy-loaded so it stays out of the main bundle.
 */
export function EpubPreview({ path }: { path: string }) {
  const app = useApp();
  const t = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const saveTimer = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [currentHref, setCurrentHref] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let book: Book | null = null;
    const vaultPath = app.vault.getVaultPath();

    const dispose = () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      renditionRef.current = null;
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
    setToc([]);
    setCurrentHref(null);
    const saved = readPosition(vaultPath, path);
    setPercent(saved?.percent ?? 0);

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
        renditionRef.current = rendition;

        // T-061: resume where the reader left off. A stale CFI (edited file) must
        // fall back to page one instead of leaving the pane blank.
        try {
          await rendition.display(saved?.cfi);
        } catch {
          await rendition.display();
        }

        void book.loaded.navigation
          .then((nav) => {
            if (!cancelled) setToc(flattenToc(nav?.toc));
          })
          .catch(() => {
            /* a book without a nav document simply has no TOC */
          });

        rendition.on("relocated", (location: { start?: { href?: string; index?: number; cfi?: string } }) => {
          if (cancelled) return;
          const start = location?.start;
          const href = typeof start?.href === "string" ? start.href : null;
          if (href !== null) setCurrentHref(href);
          // epub.js' Spine extends Array at runtime but its typings do not say so
          const spineLength = (book?.spine as unknown as { length?: number } | null)?.length ?? 0;
          const pct = spinePercent(typeof start?.index === "number" ? start.index : 0, spineLength);
          setPercent(pct);
          const cfi = typeof start?.cfi === "string" ? start.cfi : null;
          const index = typeof start?.index === "number" ? start.index : 0;
          if (cfi === null) return;
          // debounce: relocated fires on every page turn during a scroll burst
          if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(() => {
            writePosition(vaultPath, path, { cfi, index, percent: pct });
          }, 400);
        });
      } catch (err) {
        fail(err);
      }
    })();

    return () => {
      cancelled = true;
      dispose();
    };
  }, [app, path]);

  // Page turning from the keyboard. The reader lives in an iframe that swallows
  // keys, so listen on window while this (the only mounted) viewer is alive.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() ?? "";
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      const rendition = renditionRef.current;
      if (!rendition) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        void rendition.next();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        void rendition.prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const goTo = (href: string) => {
    void renditionRef.current?.display(href);
  };

  if (error) {
    return (
      <div className="attachment-placeholder" data-testid="format-error">
        <span>{t("attachment.loadFailed")}</span>
      </div>
    );
  }

  return (
    <div className="format-epub" data-testid="epub-preview">
      <div className="epub-toolbar" data-testid="epub-toolbar">
        <button
          type="button"
          className={`epub-toolbar-btn${tocOpen ? " is-on" : ""}`}
          data-testid="epub-toc-toggle"
          onClick={() => setTocOpen((v) => !v)}
          aria-expanded={tocOpen}
        >
          {t("epub.contents")}
        </button>
        <button
          type="button"
          className="epub-toolbar-btn"
          data-testid="epub-prev"
          onClick={() => void renditionRef.current?.prev()}
        >
          {t("epub.previous")}
        </button>
        <span className="epub-percent" data-testid="epub-percent">{percent}%</span>
        <button
          type="button"
          className="epub-toolbar-btn"
          data-testid="epub-next"
          onClick={() => void renditionRef.current?.next()}
        >
          {t("epub.next")}
        </button>
      </div>
      <div className="epub-body">
        {tocOpen && (
          <nav className="epub-toc" data-testid="epub-toc">
            {toc.length === 0 ? (
              <div className="epub-toc-empty">{t("epub.noContents")}</div>
            ) : (
              toc.map((entry, i) => (
                <button
                  key={`${entry.href}-${i}`}
                  type="button"
                  className={`epub-toc-item${sameDocument(entry.href, currentHref) ? " is-current" : ""}`}
                  style={{ paddingLeft: 6 + entry.depth * 14 }}
                  data-testid="epub-toc-item"
                  onClick={() => goTo(entry.href)}
                >
                  {entry.label}
                </button>
              ))
            )}
          </nav>
        )}
        <div className="epub-viewer" ref={containerRef} />
      </div>
    </div>
  );
}
