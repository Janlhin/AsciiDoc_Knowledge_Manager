import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";
import { ebookKindFromPath, parseFb2, type Fb2Document } from "@core/ebookFormats";
import { useFormatResource } from "./useFormatResource";

const EMPTY: Fb2Document = { title: "", authors: [], blocks: [] };

/**
 * FictionBook 2 preview — READ-ONLY. Plain `.fb2` is XML; `.fb2.zip` / `.fbz`
 * are ZIP archives containing that XML (unpacked with the existing jszip).
 * Rendered as React text nodes, never as raw HTML, so a malformed/untrusted
 * book cannot inject markup into the app.
 */
export function Fb2Preview({ path }: { path: string }) {
  const app = useApp();
  const t = useI18n();

  const { data, failed } = useFormatResource<Fb2Document>(path, async (isCancelled) => {
    const bytes = await app.vault.readBinary(path);
    if (isCancelled()) return { data: EMPTY };
    let xml: string;
    if (ebookKindFromPath(path) === "fbz") {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(bytes.slice());
      const entry = Object.values(zip.files)
        .find((f) => !f.dir && f.name.toLowerCase().endsWith(".fb2"));
      if (!entry) throw new Error("no .fb2 document inside the archive");
      xml = await entry.async("string");
    } else {
      xml = new TextDecoder().decode(bytes);
    }
    if (isCancelled()) return { data: EMPTY };
    return { data: parseFb2(xml) };
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
  if (data.blocks.length === 0) {
    return (
      <div className="attachment-placeholder" data-testid="fb2-empty">
        <span>{t("attachment.emptyBook")}</span>
      </div>
    );
  }

  return (
    <div className="format-fb2 markdown-rendered" data-testid="fb2-preview">
      {data.title && <h1>{data.title}</h1>}
      {data.authors.length > 0 && <p className="fb2-authors">{data.authors.join(", ")}</p>}
      {data.blocks.map((block, index) => {
        if (block.kind === "title") return <h2 key={index}>{block.text}</h2>;
        if (block.kind === "image") {
          return block.src
            ? <img className="fb2-image" key={index} src={block.src} alt="" />
            : null;
        }
        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
}
