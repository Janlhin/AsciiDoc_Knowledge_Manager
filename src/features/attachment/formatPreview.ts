/**
 * ADKM L4: multi-format preview registry.
 *
 * Extends the read-only attachment viewer (R102) with structured rendering for
 * Office / e-book formats, reusing the same library choices vscode-office
 * validates:
 *   - Word  → mammoth        (docx → semantic HTML)
 *   - Excel → x-spreadsheet + SheetJS (editable grid; parse + write-back)
 *   - PPT   → jszip         (slide text + images → read-only cards)
 *   - EPUB  → epub.js       (paginated reader)
 *   - FB2   → DOMParser + jszip (plain XML or zipped FictionBook → text blocks)
 *   - CBZ   → jszip + shared ImageReader (paged comic pages with zoom)
 *   - Kindle→ @lingo-reader/mobi-parser (MOBI/KF8 → safe text chapters)
 *
 * All formats added after 2026-11-15 are READ-ONLY by product decision: the
 * only editable format remains Excel (see DECISIONS.md D-013 / D-022). New
 * preview components use `useFormatResource` so cancellation and disposal
 * follow the same contract PR #27 established for EPUB.
 *
 * Each entry's heavy dependency is lazy-loaded INSIDE its component via a
 * dynamic `import()`, so it stays out of the main bundle and only loads when a
 * file of that type is actually opened.
 *
 * To add a format: register its (lowercase, no-dot) extension → entry here. No
 * other wiring is needed — AttachmentView calls `formatPreviewer(path)` for the
 * "other" media kind and falls back to the placeholder for anything unregistered.
 */
import type { ComponentType } from "react";
import { fileExtension } from "@core/attachments";
import { ebookKindFromPath } from "@core/ebookFormats";
import { DocxPreview } from "./DocxPreview";
import { XlsxPreview } from "./XlsxPreview";
import { PptxPreview } from "./PptxPreview";
import { EpubPreview } from "./EpubPreview";
import { Fb2Preview } from "./Fb2Preview";
import { CbzPreview } from "./CbzPreview";
import { MobiPreview } from "./MobiPreview";

export interface FormatPreviewerEntry {
  /** human-readable label (e.g. for the toolbar / status) */
  label: string;
  /** React component that renders the preview; receives the vault-relative path */
  Component: ComponentType<{ path: string }>;
}

export const FORMAT_PREVIEWERS: Record<string, FormatPreviewerEntry> = {
  // Word — mammoth converts the .docx OOXML package to semantic HTML.
  // Legacy binary .doc is NOT supported by mammoth (the component surfaces an error).
  docx: { label: "Word", Component: DocxPreview },
  dotx: { label: "Word", Component: DocxPreview },
  // Excel — x-spreadsheet editable grid; SheetJS for parse + write-back.
  xlsx: { label: "Excel", Component: XlsxPreview },
  xlsm: { label: "Excel", Component: XlsxPreview },
  xls: { label: "Excel", Component: XlsxPreview },
  // PowerPoint — jszip extracts each slide's text + images → read-only cards.
  pptx: { label: "PowerPoint", Component: PptxPreview },
  pptm: { label: "PowerPoint", Component: PptxPreview },
  // EPUB — epub.js paginated reader.
  epub: { label: "EPUB", Component: EpubPreview },
  // FictionBook 2 — plain XML, or a ZIP containing it (.fb2.zip / .fbz).
  fb2: { label: "FictionBook", Component: Fb2Preview },
  fbz: { label: "FictionBook", Component: Fb2Preview },
  // Comic book ZIP — shared ImageReader (paging + zoom).
  cbz: { label: "Comic", Component: CbzPreview },
  // Kindle — MOBI/KF8 via @lingo-reader/mobi-parser (Q-005 approved dep).
  mobi: { label: "Kindle", Component: MobiPreview },
  azw: { label: "Kindle", Component: MobiPreview },
  azw3: { label: "Kindle", Component: MobiPreview },
  kf8: { label: "Kindle", Component: MobiPreview },
  prc: { label: "Kindle", Component: MobiPreview },
};

/** Look up a previewer entry by a vault path's extension (lowercased). */
export function formatPreviewer(path: string): FormatPreviewerEntry | null {
  // Composite suffixes (.fb2.zip) are invisible to fileExtension().
  const ebook = ebookKindFromPath(path);
  if (ebook !== null) {
    const entry = FORMAT_PREVIEWERS[ebook];
    if (entry !== undefined) return entry;
  }
  const ext = fileExtension(path);
  return Object.prototype.hasOwnProperty.call(FORMAT_PREVIEWERS, ext)
    ? FORMAT_PREVIEWERS[ext]
    : null;
}
