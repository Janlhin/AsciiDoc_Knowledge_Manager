/**
 * Pure helpers for the Kindle (MOBI / KF8) read-only preview.
 *
 * No I/O: `MobiPreview` owns the only impure step (vault bytes + lazy import).
 * The parser returns raw chapter HTML, which is UNTRUSTED input; this module
 * reduces it to plain text blocks and whitelisted image URLs so React never
 * has to inject markup (same safety rule as the FB2 preview).
 */
export type MobiParserKind = "mobi" | "kf8";

const MOBI_EXTS = new Set(["mobi", "azw", "prc"]);
const KF8_EXTS = new Set(["azw3", "kf8"]);

/** Which parser entry a path needs. `.azw3` / `.kf8` are KF8 containers. */
export function mobiParserKind(path: string): MobiParserKind | null {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  if (MOBI_EXTS.has(ext)) return "mobi";
  if (KF8_EXTS.has(ext)) return "kf8";
  return null;
}

export interface MobiBlock {
  kind: "heading" | "paragraph" | "image";
  /** Text blocks only; rendered as React text nodes. */
  text?: string;
  /** Image blocks only: blob: or data:image URL produced by the parser. */
  src?: string;
}

/** Drop entire subtrees that can carry executable content. */
const UNSAFE_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "svg", "math",
  "form", "input", "link", "meta", "base", "template", "noscript",
]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const TEXT_TAGS = new Set([
  "p", "div", "li", "blockquote", "pre", "section", "article",
  "td", "th", "figcaption", "caption", "h1", "h2", "h3", "h4", "h5", "h6",
]);
/** Parser emits blob: URLs; data:image is accepted for embedded covers. */
const SAFE_IMAGE_SRC = /^(?:blob:|data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml);base64,)/i;

function directText(element: Element): string {
  let out = "";
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3) out += child.textContent ?? "";
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Convert one chapter's HTML into renderable blocks. Deliberately lossy:
 * CSS, tables-as-layout, links and inline formatting are NOT preserved —
 * this is a text preview, not a typesetting engine.
 */
export function sanitizeMobiHtml(html: string): MobiBlock[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks: MobiBlock[] = [];
  // Remove executable subtrees up-front so the plain-text fallback below can
  // never pick up script/style bodies either.
  for (const el of Array.from(doc.body.querySelectorAll(
    "script,style,iframe,object,embed,svg,math,form,input,link,meta,base,template,noscript",
  ))) {
    el.remove();
  }

  const walk = (element: Element): void => {
    for (const child of Array.from(element.children)) {
      const tag = child.tagName.toLowerCase();
      if (UNSAFE_TAGS.has(tag)) continue;
      if (tag === "img") {
        const src = child.getAttribute("src") ?? "";
        if (SAFE_IMAGE_SRC.test(src)) blocks.push({ kind: "image", src });
        continue;
      }
      if (TEXT_TAGS.has(tag)) {
        const text = directText(child);
        if (text) blocks.push({ kind: HEADING_TAGS.has(tag) ? "heading" : "paragraph", text });
        const hasTextChild = Array.from(child.children).some((c) => TEXT_TAGS.has(c.tagName.toLowerCase()));
        if (!hasTextChild) continue;
      }
      walk(child);
    }
  };
  walk(doc.body);

  if (blocks.length === 0) {
    const fallback = (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
    if (fallback) blocks.push({ kind: "paragraph", text: fallback });
  }
  return blocks;
}
