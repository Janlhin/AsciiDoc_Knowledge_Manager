import { useMemo, useState } from "react";
import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";
import { mobiParserKind, sanitizeMobiHtml, type MobiBlock } from "@core/mobi";
import { useFormatResource } from "./useFormatResource";

/** Minimal structural view of the parser's Mobi / Kf8 instances. */
interface MobiBook {
  getSpine(): ReadonlyArray<{ id: string }>;
  getMetadata(): { title?: string; author?: string[] } | undefined;
  loadChapter(id: string): { html?: string } | undefined;
  destroy(): void;
}

interface LoadedMobi {
  book: MobiBook;
  spine: ReadonlyArray<{ id: string }>;
  title: string;
  authors: string[];
}

/**
 * Kindle preview — READ-ONLY. `.mobi/.azw/.prc` use initMobiFile;
 * `.azw3/.kf8` use initKf8File. The library is lazy-loaded and owns its blob
 * URLs, which `destroy()` revokes on tab close / format switch.
 *
 * Chapters are loaded on demand (one at a time), so a large book does not
 * render hundreds of chapters into the DOM at once.
 */
export function MobiPreview({ path }: { path: string }) {
  const app = useApp();
  const t = useI18n();
  const [chapter, setChapter] = useState(0);

  const { data, failed } = useFormatResource<LoadedMobi | null>(path, async (isCancelled) => {
    const bytes = await app.vault.readBinary(path);
    if (isCancelled()) return { data: null };
    const mod = await import("@lingo-reader/mobi-parser");
    if (isCancelled()) return { data: null };
    const kind = mobiParserKind(path);
    const book = (kind === "kf8"
      ? await mod.initKf8File(bytes)
      : await mod.initMobiFile(bytes)) as unknown as MobiBook;
    if (isCancelled()) {
      book.destroy();
      return { data: null };
    }
    const spine = book.getSpine();
    const meta = book.getMetadata();
    return {
      data: {
        book,
        spine,
        title: meta?.title ?? "",
        authors: meta?.author ?? [],
      },
      dispose: () => book.destroy(),
    };
  });

  const blocks = useMemo<ReadonlyArray<MobiBlock>>(() => {
    if (!data) return [];
    const entry = data.spine[Math.min(chapter, data.spine.length - 1)];
    if (!entry) return [];
    return sanitizeMobiHtml(data.book.loadChapter(entry.id)?.html ?? "");
  }, [data, chapter]);

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
  if (data.spine.length === 0) {
    return (
      <div className="attachment-placeholder" data-testid="mobi-empty">
        <span>{t("attachment.emptyBook")}</span>
      </div>
    );
  }

  const total = data.spine.length;
  return (
    <div className="format-mobi markdown-rendered" data-testid="mobi-preview">
      <div className="format-mobi-toolbar">
        <button
          type="button"
          className="image-reader-btn"
          data-testid="mobi-prev"
          title={t("attachment.prevChapter")}
          disabled={chapter === 0}
          onClick={() => setChapter((n) => Math.max(0, n - 1))}
        >
          ‹
        </button>
        <span className="image-reader-position" data-testid="mobi-position">
          {t("attachment.chapterOf", { page: String(chapter + 1), total: String(total) })}
        </span>
        <button
          type="button"
          className="image-reader-btn"
          data-testid="mobi-next"
          title={t("attachment.nextChapter")}
          disabled={chapter >= total - 1}
          onClick={() => setChapter((n) => Math.min(total - 1, n + 1))}
        >
          ›
        </button>
        {data.title && <span className="format-mobi-title">{data.title}</span>}
        {data.authors.length > 0 && <span className="format-mobi-authors">{data.authors.join(", ")}</span>}
      </div>
      <div className="format-mobi-body">
        {blocks.length === 0 ? (
          <div className="attachment-placeholder" data-testid="mobi-chapter-empty">
            <span>{t("attachment.mobiEmpty")}</span>
          </div>
        ) : blocks.map((block, index) => {
          if (block.kind === "image") {
            return <img className="mobi-image" key={index} src={block.src} alt="" />;
          }
          if (block.kind === "heading") return <h2 key={index}>{block.text}</h2>;
          return <p key={index}>{block.text}</p>;
        })}
      </div>
    </div>
  );
}
