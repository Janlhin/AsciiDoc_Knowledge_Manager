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
        const mammoth = (await import("mammoth")).default;
        // copy into a standalone ArrayBuffer (adapter bytes may be a view over a
        // larger buffer; slice() yields a fresh, exact-size buffer)
        const arrayBuffer = bytes.slice().buffer;
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (!cancelled) setHtml(result.value);
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
