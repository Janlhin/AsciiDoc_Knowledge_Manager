// @vitest-environment jsdom
/** Q-007 / D-034: tolerant parsing of the heavy-content loading preference. */
import { describe, expect, it } from "vitest";
import { normalizeHeavyLoadMode } from "@core/heavyLoad";

describe("normalizeHeavyLoadMode", () => {
  it("defaults to on-demand (the user's Q-007 choice)", () => {
    expect(normalizeHeavyLoadMode(null)).toBe("onDemand");
    expect(normalizeHeavyLoadMode(undefined)).toBe("onDemand");
    expect(normalizeHeavyLoadMode("")).toBe("onDemand");
    expect(normalizeHeavyLoadMode("corrupt")).toBe("onDemand");
  });

  it("accepts the explicit on-demand choice", () => {
    expect(normalizeHeavyLoadMode("onDemand")).toBe("onDemand");
    expect(normalizeHeavyLoadMode("auto")).toBe("auto");
  });
});
