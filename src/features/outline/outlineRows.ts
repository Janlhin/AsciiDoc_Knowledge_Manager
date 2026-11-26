/**
 * Outline row construction (T-071 / D-045): pure heading-list → rows mapping,
 * format-blind so the same model serves Markdown and AsciiDoc headings.
 *
 * The panel (`OutlinePanel.tsx`) owns collapse state, filtering and DOM; this
 * module holds only the array geometry so it can be unit-tested without a view.
 */
import type { HeadingRef } from "@core/types";

export interface OutlineRow {
  /** index into the original headings array — used as collapse key */
  index: number;
  heading: HeadingRef;
  /** true when deeper-level headings immediately follow */
  hasChildren: boolean;
}

/** Build rows and child info from the flat heading list. A row has children
 *  when the next heading is a deeper level (`next.level > heading.level`), the
 *  same nesting rule the reading-view heading fold uses. */
export function buildRows(headings: HeadingRef[]): OutlineRow[] {
  return headings.map((heading, index) => {
    const next = headings[index + 1];
    return {
      index,
      heading,
      hasChildren: next !== undefined && next.level > heading.level,
    };
  });
}
