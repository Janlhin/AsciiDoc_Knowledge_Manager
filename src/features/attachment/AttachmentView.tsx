/**
 * R102/R104 (㊽ 续续续续续/续续续续续续): read-only viewer for non-md attachment tabs
 * (`viewType: "attachment"`). Renders an inline preview by media kind — image (<img>),
 * audio (<audio>), video (<video>), pdf (<embed>) — via an object-URL blob
 * (vault.readBinary); anything else shows a read-only placeholder. The whole POINT is
 * data safety: this view NEVER calls documents.acquire — so a binary never enters the
 * editable CM buffer / autosave path (which is how clicking a .png used to corrupt it on
 * edit). Pure read; the blob holds the whole file in memory (fine for typical attachments).
 */
import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "@core/store";
import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";
import { heavyLoadMode } from "@core/heavyLoad";
import { mediaKind, mediaMime, fileExtension } from "@core/attachments";
import { formatPreviewer } from "./formatPreview";
import { ImageReader } from "./ImageReader";
import type { TabState } from "@core/types";

/**
 * T-061 / Q-007: PDF used to gate files over 32 MB, but the user's real vault is
 * made of 20-144 MB scans and they chose auto-loading as the default. The size
 * gate now belongs to the explicit `onDemand` setting (D-034); in `auto` mode a
 * restored PDF still waits two frames so boot paint is never blocked.
 */
export function AttachmentView({ tab }: { tab: TabState }) {
  const app = useApp();
  const t = useI18n();
  const loadMode = useStore(heavyLoadMode);
  const path = tab.filePath;
  const kind = path !== null ? mediaKind(path) : "other";
  const previewable = kind !== "other";
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** T-061: false while a PDF is held back from the boot window (see above). */
  const [armed, setArmed] = useState(false);

  const heavyPreview = formatPreviewer(path ?? "") !== null;
  const onDemand = loadMode === "onDemand";
  /** Q-007: auto loads every PDF; onDemand gates every structured preview. */
  const gatedPdf = kind === "pdf" && onDemand;
  const gatedHeavy = onDemand && heavyPreview;

  useEffect(() => {
    if (path === null || !previewable || gatedPdf || gatedHeavy) {
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
  }, [path, previewable, kind, gatedPdf, gatedHeavy]);

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
  } else if ((gatedPdf || gatedHeavy) && !armed) {
    // Q-007 onDemand: restored heavy content waits for an explicit Load click.
    // In auto mode this is only the legacy >32 MB PDF gate.
    const meta = t("attachment.heavyOnDemand");
    body = (
      <div className="attachment-placeholder" data-testid="attachment-pdf-gated">
        <span className="attachment-name">{name}</span>
        <span className="attachment-meta">{meta}</span>
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
