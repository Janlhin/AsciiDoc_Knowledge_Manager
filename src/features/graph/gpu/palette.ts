/**
 * T-063 — palette read from CSS custom properties.
 *
 * Variable names and fallback colours mirror the Canvas2D `FALLBACK_PALETTE`
 * in `src/features/graph/GraphView.tsx`; the GPU palette just splits that
 * older bucket into separate node / hover / selected / link / label roles.
 *
 * Under Node (no `document`) or when `getComputedStyle` is unavailable the
 * full fallback set is returned, so pure-logic tests stay deterministic.
 */

import type { GraphPalette } from "./types";

/** Fallback colours, keyed to the same values used by the ordinary GraphView. */
export const FALLBACK_PALETTE: GraphPalette = {
  bg: "#262626",
  node: "#8b7cf6",
  nodeHover: "#9d90f8",
  nodeSelected: "#9d90f8",
  link: "#444444",
  broken: "#e06c75",
  unresolved: "#8b7cf680",
  tag: "#3aa655",
  attachment: "#e0b341",
  label: "#dadada",
};

/** Maps a palette role to the CSS custom property that overrides it. */
const CSS_VARS: Record<keyof GraphPalette, string> = {
  bg: "--bg-panel",
  node: "--accent",
  nodeHover: "--accent-hover",
  nodeSelected: "--accent-hover",
  link: "--border-strong",
  broken: "--danger",
  unresolved: "--link-unresolved",
  tag: "--graph-tag",
  attachment: "--graph-attachment",
  label: "--text-normal",
};

/**
 * Read the palette computed on `el` (defaults to `document.documentElement`).
 * Missing variables fall back to {@link FALLBACK_PALETTE}; any DOM failure
 * also returns the fallback set rather than throwing.
 */
export function readPalette(el?: HTMLElement | null): GraphPalette {
  const fallback = { ...FALLBACK_PALETTE };
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    return fallback;
  }
  let cs: CSSStyleDeclaration;
  try {
    const root: HTMLElement | null = el ?? document.documentElement;
    if (!root) return fallback;
    cs = getComputedStyle(root);
  } catch {
    return fallback;
  }
  const out = { ...fallback };
  for (const key of Object.keys(CSS_VARS) as Array<keyof GraphPalette>) {
    let raw = "";
    try {
      raw = cs.getPropertyValue(CSS_VARS[key]).trim();
    } catch {
      raw = "";
    }
    if (raw) out[key] = raw;
  }
  return out;
}
