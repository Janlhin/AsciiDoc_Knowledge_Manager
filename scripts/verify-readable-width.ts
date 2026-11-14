#!/usr/bin/env node
/**
 * Behaviour check for the reading-column width bounds (src/core/readableWidth.ts).
 *
 * The failure worth guarding is not visual: a stored value outside the slider's
 * range (hand-edited localStorage, a future range change, a NaN from an empty
 * input) must still render a sane column rather than collapsing to 0em or
 * ballooning to the viewport width.
 *
 * Usage: node scripts/verify-readable-width.ts
 * Exit code: 0 = all cases pass, 1 = at least one mismatch.
 */
import {
  READABLE_LINE_WIDTH_DEFAULT,
  READABLE_LINE_WIDTH_MAX,
  READABLE_LINE_WIDTH_MIN,
  clampReadableLineWidth,
} from "../src/core/readableWidth.ts";

let failures = 0;
let cases = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  cases += 1;
  if (actual === expected) return;
  failures += 1;
  console.error(`FAIL ${name}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`);
}

/* ---- in range: passed through unchanged ---- */
check("default", clampReadableLineWidth(46), 46);
check("lower bound kept", clampReadableLineWidth(READABLE_LINE_WIDTH_MIN), READABLE_LINE_WIDTH_MIN);
check("upper bound kept", clampReadableLineWidth(READABLE_LINE_WIDTH_MAX), READABLE_LINE_WIDTH_MAX);
check("mid range", clampReadableLineWidth(72), 72);

/* ---- out of range: clamped, not rejected ---- */
check("below range", clampReadableLineWidth(5), READABLE_LINE_WIDTH_MIN);
check("above range", clampReadableLineWidth(500), READABLE_LINE_WIDTH_MAX);
check("negative", clampReadableLineWidth(-10), READABLE_LINE_WIDTH_MIN);
check("zero", clampReadableLineWidth(0), READABLE_LINE_WIDTH_MIN);

/* ---- fractional: whole em only ---- */
check("rounds down", clampReadableLineWidth(45.2), 45);
check("rounds up", clampReadableLineWidth(45.8), 46);

/* ---- not a number: default, never NaN/0 ---- */
check("NaN", clampReadableLineWidth(Number.NaN), READABLE_LINE_WIDTH_DEFAULT);
check("Infinity", clampReadableLineWidth(Number.POSITIVE_INFINITY), READABLE_LINE_WIDTH_DEFAULT);
check("-Infinity", clampReadableLineWidth(Number.NEGATIVE_INFINITY), READABLE_LINE_WIDTH_DEFAULT);

/* ---- shape invariants ---- */
check(
  "default sits inside the range",
  READABLE_LINE_WIDTH_DEFAULT > READABLE_LINE_WIDTH_MIN &&
    READABLE_LINE_WIDTH_DEFAULT < READABLE_LINE_WIDTH_MAX,
  true,
);
check(
  "result always whole and finite",
  [5, 500, Number.NaN, 45.7].every((v) => {
    const out = clampReadableLineWidth(v);
    return Number.isFinite(out) && Number.isInteger(out);
  }),
  true,
);

console.log(
  failures === 0
    ? `readable-width: ${cases}/${cases} cases pass`
    : `readable-width: ${failures} of ${cases} cases FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
