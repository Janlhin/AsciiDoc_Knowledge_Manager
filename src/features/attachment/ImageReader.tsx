import { useEffect, useState } from "react";
import { useI18n } from "@core/i18n";

export interface ReaderImage {
  src: string;
  name: string;
}

/** Zoom steps used by the shared reader (percent of the stage width). */
const MIN_ZOOM = 25;
const MAX_ZOOM = 400;
const ZOOM_STEP = 25;

/**
 * Shared read-only image viewer for single attachments AND comic archives.
 *
 * Single-image mode hides paging, but keeps zoom. `attachment-image` testid is
 * preserved so the existing attachment E2E assertions keep working. Callers
 * own the blob URLs — this component never creates or revokes them.
 */
export function ImageReader({
  images,
  single = false,
  onError,
}: {
  images: ReadonlyArray<ReaderImage>;
  single?: boolean;
  onError?: () => void;
}) {
  const t = useI18n();
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState<number | "fit">("fit");

  // A new file may have fewer pages than the previous one. Keyed by URLs (not
  // the array identity) so a parent that passes an inline literal does not
  // reset zoom/page on every render.
  const imageKey = images.map((image) => image.src).join("\u0000");
  useEffect(() => {
    setPage(0);
    setZoom("fit");
  }, [imageKey]);

  const total = images.length;
  const current = images[Math.min(page, total - 1)];
  const paged = !single && total > 1;

  return (
    <div className="image-reader" data-testid="image-reader">
      <div className="image-reader-toolbar">
        {paged && (
          <>
            <button
              type="button"
              className="image-reader-btn"
              data-testid="image-prev"
              title={t("attachment.prevPage")}
              disabled={page === 0}
              onClick={() => setPage((n) => Math.max(0, n - 1))}
            >
              ‹
            </button>
            <span className="image-reader-position" data-testid="image-position">
              {t("attachment.imageOf", { page: String(page + 1), total: String(total) })}
            </span>
            <button
              type="button"
              className="image-reader-btn"
              data-testid="image-next"
              title={t("attachment.nextPage")}
              disabled={page >= total - 1}
              onClick={() => setPage((n) => Math.min(total - 1, n + 1))}
            >
              ›
            </button>
          </>
        )}
        <span className="image-reader-spacer" />
        <button
          type="button"
          className="image-reader-btn"
          data-testid="image-zoom-out"
          title={t("attachment.zoomOut")}
          disabled={zoom === "fit" || zoom === MIN_ZOOM}
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, (z === "fit" ? 100 : z) - ZOOM_STEP))}
        >
          −
        </button>
        <button
          type="button"
          className="image-reader-btn"
          data-testid="image-zoom-fit"
          title={t("attachment.zoomFit")}
          onClick={() => setZoom("fit")}
        >
          {t("attachment.zoomFit")}
        </button>
        <button
          type="button"
          className="image-reader-btn"
          data-testid="image-zoom-in"
          title={t("attachment.zoomIn")}
          disabled={typeof zoom === "number" && zoom >= MAX_ZOOM}
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, (z === "fit" ? 100 : z) + ZOOM_STEP))}
        >
          +
        </button>
        <span className="image-reader-zoom" data-testid="image-zoom">
          {zoom === "fit" ? t("attachment.zoomFit") : `${zoom}%`}
        </span>
      </div>
      <div className="image-reader-stage">
        {current && (
          <img
            className={`attachment-image${zoom === "fit" ? " is-fit" : ""}`}
            data-testid="attachment-image"
            src={current.src}
            alt={current.name}
            style={zoom === "fit" ? undefined : { width: `${zoom}%`, maxWidth: "none", maxHeight: "none" }}
            onError={onError}
          />
        )}
      </div>
    </div>
  );
}
