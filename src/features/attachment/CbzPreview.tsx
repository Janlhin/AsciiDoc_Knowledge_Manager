import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";
import { mediaMime } from "@core/attachments";
import { isComicImage, naturalCompare } from "@core/ebookFormats";
import { useFormatResource } from "./useFormatResource";
import { ImageReader, type ReaderImage } from "./ImageReader";

/**
 * CBZ (comic book ZIP) preview — READ-ONLY. jszip (already a runtime dep)
 * unpacks the archive; image files are sorted numerically and turned into
 * object URLs consumed by the shared ImageReader (paging + zoom).
 *
 * All object URLs are revoked on tab close / format switch via the loader's
 * dispose(). Like every other attachment, the whole archive is read into
 * memory by vault.readBinary — very large comics are a known limitation.
 */
export function CbzPreview({ path }: { path: string }) {
  const app = useApp();
  const t = useI18n();

  const { data, failed } = useFormatResource<ReadonlyArray<ReaderImage>>(path, async (isCancelled) => {
    const bytes = await app.vault.readBinary(path);
    if (isCancelled()) return { data: [] };
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes.slice());
    const names = Object.values(zip.files)
      .filter((f) => !f.dir && isComicImage(f.name))
      .map((f) => f.name)
      .sort(naturalCompare);

    const urls: string[] = [];
    const images: ReaderImage[] = [];
    for (const name of names) {
      const entry = zip.file(name);
      if (!entry) continue;
      const raw = await entry.async("uint8array");
      if (isCancelled()) break;
      // Adapter bytes can be a view over a larger buffer; Blob needs an exact copy.
      const copy = new Uint8Array(raw.byteLength);
      copy.set(raw);
      const url = URL.createObjectURL(new Blob([copy], { type: mediaMime(name) }));
      urls.push(url);
      images.push({ src: url, name });
    }
    return {
      data: images,
      dispose: () => { for (const url of urls) URL.revokeObjectURL(url); },
    };
  });

  if (failed) {
    return (
      <div className="attachment-placeholder" data-testid="format-error">
        <span>{t("attachment.loadFailed")}</span>
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="attachment-placeholder">
        <span>{t("attachment.rendering")}</span>
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className="attachment-placeholder" data-testid="cbz-empty">
        <span>{t("attachment.emptyComic")}</span>
      </div>
    );
  }
  return (
    <div className="format-cbz" data-testid="cbz-preview">
      <ImageReader images={data} />
    </div>
  );
}
