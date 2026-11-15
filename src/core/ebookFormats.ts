/**
 * Read-only ebook format helpers (ADKM L4 extension).
 *
 * Pure, no I/O. The preview components own the only impure step (reading bytes
 * from the vault); everything here is a plain parser / selector so it can be
 * unit-tested without a running app.
 *
 * Supported here: FictionBook 2 (`.fb2`, `.fb2.zip`, `.fbz`) and comic ZIP
 * archives (`.cbz`). No new runtime dependency: FB2 is XML parsed by the
 * platform `DOMParser`, comic archives are unpacked by the existing `jszip`.
 */
export type EbookKind = "fb2" | "fbz" | "cbz";

/**
 * `fileExtension()` only sees the LAST suffix, so `.fb2.zip` would be reported
 * as `zip`. Match composite suffixes before the single-extension cases.
 */
export function ebookKindFromPath(path: string): EbookKind | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".fb2.zip") || lower.endsWith(".fbz")) return "fbz";
  if (lower.endsWith(".fb2")) return "fb2";
  if (lower.endsWith(".cbz")) return "cbz";
  return null;
}

/** Extensions WebView2 can actually decode as an `<img>` source. */
const COMIC_IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;

export function isComicImage(path: string): boolean {
  return COMIC_IMAGE_EXT.test(path) && !path.endsWith("/");
}

/** Numeric-aware ordering so `page10.png` sorts after `page2.png`. */
export function naturalCompare(a: string, b: string): number {
  const ax = a.split(/(\d+)/);
  const bx = b.split(/(\d+)/);
  for (let i = 0; i < Math.min(ax.length, bx.length); i++) {
    const left = ax[i];
    const right = bx[i];
    if (left === right) continue;
    const numericLeft = /^\d+$/.test(left);
    const numericRight = /^\d+$/.test(right);
    if (numericLeft && numericRight) {
      const delta = Number(left) - Number(right);
      if (delta !== 0) return delta;
    } else {
      return left.toLowerCase() < right.toLowerCase() ? -1 : 1;
    }
  }
  return ax.length - bx.length;
}

export interface Fb2Block {
  kind: "p" | "title" | "image";
  /** Text blocks only; React renders this as text (never raw HTML). */
  text?: string;
  /** Image blocks only: a `data:` URL built from an embedded `<binary>`. */
  src?: string;
}

export interface Fb2Document {
  title: string;
  authors: string[];
  blocks: Fb2Block[];
}

function textOf(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function imageHref(element: Element): string {
  return element.getAttribute("l:href") ??
    element.getAttribute("xlink:href") ??
    element.getAttribute("href") ?? "";
}

/**
 * Parse a FictionBook 2 document into renderable blocks.
 *
 * Deliberately does NOT return HTML: the caller renders React text nodes, so a
 * malicious/invalid FB2 cannot inject markup into the app. Embedded images are
 * base64 `<binary>` payloads resolved by their `#id` reference.
 */
export function parseFb2(xml: string): Fb2Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0 ||
      doc.documentElement?.localName?.toLowerCase() !== "fictionbook") {
    throw new Error("invalid FictionBook 2 document");
  }

  const binaries = new Map<string, string>();
  for (const binary of Array.from(doc.getElementsByTagName("binary"))) {
    const id = binary.getAttribute("id");
    if (!id) continue;
    const mime = binary.getAttribute("content-type") || "image/jpeg";
    const payload = (binary.textContent ?? "").replace(/\s/g, "");
    if (!payload) continue;
    const url = `data:${mime};base64,${payload}`;
    binaries.set(id, url);
    binaries.set(`#${id}`, url);
  }

  const title = doc.getElementsByTagName("book-title")[0]
    ? textOf(doc.getElementsByTagName("book-title")[0])
    : "";
  const authors: string[] = [];
  // FB2 stores name parts as sibling elements with NO whitespace between them;
  // a raw textContent would produce "AdaLovelace".
  const NAME_PARTS = ["first-name", "middle-name", "last-name", "nickname"];
  for (const author of Array.from(doc.getElementsByTagName("author"))) {
    const name = NAME_PARTS
      .map((tag) => author.getElementsByTagName(tag)[0])
      .filter((el): el is Element => el !== undefined)
      .map(textOf)
      .filter((part) => part !== "")
      .join(" ");
    if (name) authors.push(name);
  }

  const blocks: Fb2Block[] = [];
  const body = doc.getElementsByTagName("body")[0];
  if (body === undefined) throw new Error("FB2 document has no body");

  const walk = (parent: Element): void => {
    for (const child of Array.from(parent.children)) {
      const tag = child.localName.toLowerCase();
      if (tag === "section" || tag === "epigraph" || tag === "cite" || tag === "poem") {
        walk(child);
      } else if (tag === "title" || tag === "subtitle") {
        const text = textOf(child);
        if (text) blocks.push({ kind: "title", text });
      } else if (tag === "p") {
        const text = textOf(child);
        if (text) blocks.push({ kind: "p", text });
      } else if (tag === "image") {
        const src = binaries.get(imageHref(child)) ?? "";
        blocks.push({ kind: "image", src });
      }
    }
  };
  walk(body);
  return { title, authors, blocks };
}
