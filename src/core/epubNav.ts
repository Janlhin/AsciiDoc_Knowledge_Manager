/**
 * T-061 — EPUB reading support: table of contents + reading position.
 *
 * Before this, `EpubPreview` was 83 lines that called `rendition.display()` and
 * stopped there: no TOC panel, no `relocated` listener, no persisted position —
 * every book opened on page one and every chapter jump was lost on reload. That
 * shipped unnoticed because EPUB had no E2E coverage at all (the ebook case only
 * covered FB2/CBZ/images), which is also why the user read it as "目录/进度不对".
 *
 * This module holds the parts worth testing without a browser: flattening epub.js'
 * nested nav tree, and the tolerant localStorage round-trip for positions.
 */
import { normalizeVaultPath } from "./workspaceKeys";

export interface TocEntry {
  label: string;
  href: string;
  /** 0 = top level; rendered as an indent. */
  depth: number;
}

/** epub.js nav item, loosely typed — real books ship missing/odd fields. */
export interface RawTocItem {
  label?: string;
  href?: string;
  subitems?: RawTocItem[];
}

/**
 * Depth-first flatten of `book.navigation.toc`. Labels can be empty strings in
 * hand-made EPUBs, and hrefs may carry URL-encoded paths; both are normalised here
 * so the UI never renders a blank row. Entries without an href are dropped —
 * a TOC row you cannot jump to is worse than a missing one.
 */
export function flattenToc(items: RawTocItem[] | null | undefined, depth = 0, out: TocEntry[] = []): TocEntry[] {
  if (!items) return out;
  for (const item of items) {
    const href = typeof item.href === "string" ? item.href.trim() : "";
    if (href !== "") {
      const rawLabel = typeof item.label === "string" ? item.label.trim() : "";
      out.push({ label: rawLabel === "" ? href.split("/").pop() ?? href : rawLabel, href, depth });
    }
    if (Array.isArray(item.subitems) && item.subitems.length > 0) {
      flattenToc(item.subitems, depth + 1, out);
    }
  }
  return out;
}

/** Compare a TOC href with the rendition's current href: ignore the anchor and
 *  compare URL-decoded tails, because epub.js reports one and navigation ships
 *  the other (e.g. `Text/ch1.xhtml` vs `Text/ch1.xhtml#s1`). */
export function sameDocument(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (v: string) => {
    const noAnchor = v.split("#")[0] ?? "";
    try {
      return decodeURIComponent(noAnchor);
    } catch {
      return noAnchor;
    }
  };
  return norm(a) === norm(b);
}

export interface EpubPosition {
  /** epub.js CFI of the first visible location. */
  cfi: string;
  /** Spine index, used for the percentage when a CFI no longer resolves. */
  index: number;
  /** 1-based display number for the footer. */
  percent: number;
}

const PREFIX = "adkm.epub.pos:";

/** Key is namespaced by vault so two vaults cannot inherit each other's position. */
export function epubPositionKey(vaultPath: string | null, bookPath: string): string {
  return `${PREFIX}${normalizeVaultPath(vaultPath) ?? ""}::${bookPath}`;
}

export function parsePosition(raw: string | null): EpubPosition | null {
  if (raw === null) return null;
  try {
    const p = JSON.parse(raw) as Partial<EpubPosition>;
    if (typeof p.cfi !== "string" || p.cfi === "") return null;
    return {
      cfi: p.cfi,
      index: typeof p.index === "number" && p.index >= 0 ? p.index : 0,
      percent: typeof p.percent === "number" && p.percent >= 0 && p.percent <= 100 ? p.percent : 0,
    };
  } catch {
    return null;
  }
}

export function readPosition(vaultPath: string | null, bookPath: string): EpubPosition | null {
  try {
    return parsePosition(localStorage.getItem(epubPositionKey(vaultPath, bookPath)));
  } catch {
    return null;
  }
}

export function writePosition(vaultPath: string | null, bookPath: string, pos: EpubPosition): void {
  try {
    localStorage.setItem(epubPositionKey(vaultPath, bookPath), JSON.stringify(pos));
  } catch {
    /* storage blocked — the session still reads fine, position just will not persist */
  }
}

/** Spine percentage: cheap and stable, unlike `locations.generate()`, which walks
 *  every spine item (seconds of main-thread work on a 50 MB book). */
export function spinePercent(index: number, spineLength: number): number {
  if (!Number.isFinite(index) || spineLength <= 0) return 0;
  const pct = Math.round(((index + 1) / spineLength) * 100);
  return Math.max(1, Math.min(100, pct));
}
