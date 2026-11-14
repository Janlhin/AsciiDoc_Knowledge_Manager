/**
 * Pure bounds for the reading column width (settings → appearance).
 *
 * Kept out of `appearance.ts` so the clamping rules can be exercised without a
 * DOM: that module touches `localStorage` and `document` at load time, while
 * these two functions are the only part with behaviour worth asserting.
 */

/** Narrower than this and code blocks re-wrap on almost every line. */
export const READABLE_LINE_WIDTH_MIN = 30;

/** Wider than this and the cap stops being visible on a 1080p window. */
export const READABLE_LINE_WIDTH_MAX = 100;

/** Prior hard-coded CSS fallback (`var(--readable-line-width, 46em)`). */
export const READABLE_LINE_WIDTH_DEFAULT = 46;

/** Coerce any input to a usable width: round to whole `em`, clamp to range,
 *  and fall back to the default when the value is not a finite number. */
export function clampReadableLineWidth(em: number): number {
  if (!Number.isFinite(em)) return READABLE_LINE_WIDTH_DEFAULT;
  return Math.min(
    READABLE_LINE_WIDTH_MAX,
    Math.max(READABLE_LINE_WIDTH_MIN, Math.round(em)),
  );
}
