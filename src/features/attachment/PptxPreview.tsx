import { useEffect, useState } from "react";
import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";

/**
 * PowerPoint preview (ADKM L4) — there is no robust pure-frontend PPTX *editor*,
 * so this is a read-only slide extractor: jszip unpacks the OOXML package, and
 * each slide's text frames + embedded media are rendered as a vertical stack of
 * slide cards. This mirrors vscode-office, which also only *views* PPTX.
 *
 * jszip is lazy-loaded so it stays out of the main bundle.
 */

interface PptxSlide {
  index: number;
  text: string;
  images: string[]; // data: URLs
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function mimeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "tiff":
    case "tif":
      return "image/tiff";
    case "svg":
      return "image/svg+xml";
    case "emf":
      return "image/emf";
    case "wmf":
      return "image/wmf";
    default:
      return "application/octet-stream";
  }
}

/** "ppt/slides/slide1.xml" → slide number for stable ordering */
function slideNumber(file: string): number {
  const m = /slide(\d+)\.xml$/.exec(file);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

export function PptxPreview({ path }: { path: string }) {
  const app = useApp();
  const t = useI18n();
  const [slides, setSlides] = useState<PptxSlide[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSlides(null);
    setError(null);
    void (async () => {
      try {
        const bytes = await app.vault.readBinary(path);
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(bytes);

        const slideFiles = Object.keys(zip.files)
          .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
          .sort((a, b) => slideNumber(a) - slideNumber(b));

        const out: PptxSlide[] = [];
        for (let i = 0; i < slideFiles.length; i++) {
          const sf = slideFiles[i];
          const xml = await zip.file(sf)!.async("string");

          // text frames
          const texts: string[] = [];
          const tRe = /<a:t>([\s\S]*?)<\/a:t>/g;
          let m: RegExpExecArray | null;
          while ((m = tRe.exec(xml))) texts.push(decodeXml(m[1]));

          // image relationships for this slide
          const relsPath = sf
            .replace(/slides\/slide(\d+)\.xml$/, "slides/_rels/slide$1.xml.rels");
          const relsXml = zip.file(relsPath)
            ? await zip.file(relsPath)!.async("string")
            : "";
          const embedToTarget: Record<string, string> = {};
          const relRe = /<Relationship[^>]*Id="(rId\d+)"[^>]*Target="([^"]+)"/g;
          while ((m = relRe.exec(relsXml))) embedToTarget[m[1]] = m[2];

          // images (dedup by target)
          const images: string[] = [];
          const seen = new Set<string>();
          const blipRe = /r:embed="(rId\d+)"/g;
          while ((m = blipRe.exec(xml))) {
            const target = embedToTarget[m[1]];
            if (!target || seen.has(target)) continue;
            seen.add(target);
            // rels Target is relative to ppt/slides/ (e.g. "../media/image1.png")
            const mediaPath = ("ppt/slides/" + target).replace(
              /ppt\/slides\/\.\.\//,
              "ppt/",
            );
            const file =
              zip.file(mediaPath) ?? zip.file("ppt/" + target.replace(/^\.\//, ""));
            if (file) {
              const b64 = await file.async("base64");
              images.push(`data:${mimeFromName(target)};base64,${b64}`);
            }
          }

          out.push({ index: i + 1, text: texts.join("\n"), images });
        }
        if (!cancelled) setSlides(out);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
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
  if (slides === null) {
    return (
      <div className="attachment-placeholder">
        <span>{t("attachment.rendering")}</span>
      </div>
    );
  }

  return (
    <div className="format-pptx" data-testid="pptx-preview">
      {slides.map((slide) => (
        <div className="pptx-slide" key={slide.index}>
          <div className="pptx-slide-index">{slide.index}</div>
          <div className="pptx-slide-body">
            {slide.text.split("\n").map((line, i) =>
              line.trim() === "" ? (
                <br key={i} />
              ) : (
                <p className="pptx-line" key={i}>
                  {line}
                </p>
              ),
            )}
            {slide.images.map((src, i) => (
              // eslint-disable-next-line jsx-a11y/img-has-alt
              <img className="pptx-image" key={i} src={src} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
