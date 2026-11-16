/**
 * R102/R104 (㊽ 续续续续续/续续续续续续): read-only viewer for non-md attachment tabs
 * (`viewType: "attachment"`). Renders an inline preview by media kind — image (<img>),
 * audio (<audio>), video (<video>), pdf (<embed>) — via an object-URL blob
 * (vault.readBinary); anything else shows a read-only placeholder. The whole POINT is
 * data safety: this view NEVER calls documents.acquire — so a binary never enters the
 * editable CM buffer / autosave path (which is how clicking a .png used to corrupt it on
 * edit). Pure read; the blob holds the whole file in memory (fine for typical attachments).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";
import { mediaKind, mediaMime, fileExtension } from "@core/attachments";
import { formatPreviewer } from "./formatPreview";
import { ImageReader } from "./ImageReader";
import type { TabState } from "@core/types";

/**
 * T-061: PDF is the one attachment kind whose mount cost lands on the STARTUP path.
 * `<embed>` needs the whole file as a blob, so restoring a 60 MB PDF produced a
 * measured 151 ms + 72 ms main-thread stall right after first paint (rAF-gap probe on
 * the release build). Two-part fix:
 *   - every PDF waits two frames (past the boot paint) before it starts reading;
 *   - PDFs above this size are not read at all until the user asks, so a restored
 *     scanned book costs nothing at launch. Browsers gate plugin content the same way.
 */
const PDF_AUTO_LOAD_BYTES = 32 * 1024 * 1024;

export function AttachmentView({ tab }: { tab: TabState }) {
  const app = useApp();
  const t = useI18n();
  const path = tab.filePath;
  const kind = path !== null ? mediaKind(path) : "other";
  const previewable = kind !== "other";
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** T-061: false while a PDF is held back from the boot window (see above). */
  const [armed, setArmed] = useState(false);

  /** File size from the tree listing (desktop fills it from FS metadata); null when
   *  unknown, in which case we only defer rather than gate. */
  const size = useMemo(() => {
    if (path === null) return null;
    const node = app.vault.getFiles().find((f) => f.path === path);
    return node?.size ?? null;
  }, [app, path]);

  const gatedPdf = kind === "pdf" && size !== null && size > PDF_AUTO_LOAD_BYTES;

  useEffect(() => {
    if (path === null || !previewable || gatedPdf) {
      setArmed(false);
      return;
    }
    if (kind !== "pdf") {
      setArmed(true);
      return;
    }
    // defer past the boot paint: two frames is the smallest honest unit
    let cancelled = false;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (!cancelled) setArmed(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(first);
      if (second !== 0) cancelAnimationFrame(second);
    };
  }, [path, previewable, kind, gatedPdf]);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (path === null || !previewable || !armed) return;
    let cancelled = false;
    let objUrl: string | null = null;
    // read-only raw bytes — NOT documents.acquire (no handle, no autosave, no dirty buffer)
    app.vault.readBinary(path).then(
      (bytes) => {
        if (cancelled) return;
        // copy into a fresh ArrayBuffer-backed view: adapter bytes are typed over
        // ArrayBufferLike, which BlobPart rejects (mirrors compat/util embed src).
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        objUrl = URL.createObjectURL(new Blob([copy], { type: mediaMime(path) }));
        setUrl(objUrl);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [app, path, previewable, armed]);

  if (path === null) return null;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const ext = fileExtension(path);

  const formatEntry = path !== null ? formatPreviewer(path) : null;

  let body: ReactNode = null;
  if (failed) {
    // only reached when readBinary itself rejects (file gone / unreadable). A media element
    // that merely can't DECODE keeps rendering — <audio>/<video> show a native error, and a
    // broken <img> (no native UI) falls back to the placeholder via its onError below.
    body = (
      <div className="attachment-placeholder" data-testid="attachment-failed">
        <span>{t("attachment.loadFailed")}</span>
      </div>
    );
  } else if (gatedPdf && !armed) {
    // T-061: a large PDF restored from the last session must not be read at startup
    body = (
      <div className="attachment-placeholder" data-testid="attachment-pdf-gated">
        <span className="attachment-name">{name}</span>
        <span className="attachment-meta">
          {t("attachment.pdfLarge", { size: `${Math.round((size ?? 0) / (1024 * 1024))} MB` })}
        </span>
        <button
          className="attachment-pdf-load"
          data-testid="attachment-pdf-load"
          onClick={() => setArmed(true)}
        >
          {t("attachment.pdfLoad")}
        </button>
      </div>
    );
  } else if (kind !== "other" && url === null) {
    // a media kind (image/audio/video/pdf) is still loading its blob URL
    body = (
      <div className="attachment-placeholder">
        <span>{t("attachment.rendering")}</span>
      </div>
    );
  } else if (kind !== "other" && url !== null) {
    if (kind === "image") {
      // Shared reader adds paging/zoom while preserving the data-safety
      // boundary: this effect still owns (and revokes) the blob URL, and an
      // <img> decode failure still falls back to the read-only placeholder.
      body = <ImageReader images={[{ src: url, name }]} single onError={() => setFailed(true)} />;
    } else if (kind === "audio") {
      body = <audio className="attachment-audio" data-testid="attachment-audio" src={url} controls />;
    } else if (kind === "video") {
      body = <video className="attachment-video" data-testid="attachment-video" src={url} controls />;
    } else {
      // pdf — <embed> renders natively in Chromium + macOS WKWebView (PDFKit)
      body = <embed className="attachment-pdf" data-testid="attachment-pdf" src={url} type="application/pdf" />;
    }
  } else if (formatEntry) {
    // structured multi-format preview (docx / xlsx / pptx / epub …) — each
    // component lazy-loads its own heavy library and reads bytes itself
    const FormatComponent = formatEntry.Component;
    body = <FormatComponent path={path} />;
  } else {
    body = (
      <div className="attachment-placeholder" data-testid="attachment-placeholder">
        <span className="attachment-name">{name}</span>
        <span className="attachment-meta">{t("attachment.noPreview", { ext: ext || "?" })}</span>
      </div>
    );
  }

  return (
    <div
      className="attachment-view"
      data-testid="attachment-view"
      data-attachment-path={path}
      data-media-kind={kind}
      data-format={formatEntry?.label ?? undefined}
    >
      {body}
    </div>
  );
}
