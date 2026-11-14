/**
 * Contract for the "Show debug info" block: the perf section exists because
 * `metadataIndexMs` / `metadataHydrated` are the only way to answer "did the
 * warm start actually skip the reads" without DevTools. Format matters — a
 * human pastes this block into a bug report.
 */
import { describe, expect, it } from "vitest";
import { buildDebugInfo } from "@core/debugInfo";

const base = {
  version: "0.269.0",
  platform: "Win32",
  locale: "zh-CN",
  plugins: [{ name: "Compat", id: "compat", enabled: true }],
};

describe("buildDebugInfo", () => {
  it("keeps the original header and plugin list", () => {
    const text = buildDebugInfo(base);
    expect(text.startsWith("Geode debug info:")).toBe(true);
    expect(text).toContain("Version: 0.269.0");
    expect(text).toContain("1. Compat (compat)");
  });

  it("omits the perf section when there are no readings", () => {
    expect(buildDebugInfo(base)).not.toContain("Perf:");
    expect(buildDebugInfo({ ...base, perf: {} })).not.toContain("Perf:");
  });

  it("lists readings sorted, so pasted reports are comparable", () => {
    const text = buildDebugInfo({
      ...base,
      perf: { metadataIndexMs: 12.5, metadataHydrated: 415, graphBuildMs: 3 },
    });
    expect(text).toContain("Perf:");
    expect(text).toContain("  metadataHydrated: 415");
    const order = ["graphBuildMs", "metadataHydrated", "metadataIndexMs"].map((k) =>
      text.indexOf(k),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
