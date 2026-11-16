// @vitest-environment jsdom
/**
 * T-058 / D-027: the startup-mode setting ("continue where you left off" vs
 * "fresh window"). The behaviour it drives lives in `Workspace` and is covered
 * by the real-app E2E case `startup-mode`; this file pins the contract that the
 * rest of the app reads — tolerant parsing, persistence, and the two gates.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeStartupMode,
  setStartupMode,
  shouldPersistSession,
  shouldRestoreSession,
  startupMode,
} from "@core/startup";

afterEach(() => {
  setStartupMode("restore");
});

describe("normalizeStartupMode", () => {
  it("accepts the two known values", () => {
    expect(normalizeStartupMode("restore")).toBe("restore");
    expect(normalizeStartupMode("fresh")).toBe("fresh");
  });

  it("falls back to the historical behaviour for anything else", () => {
    for (const raw of [null, undefined, "", "FRESH", "new", 0, 1, {}, []]) {
      expect(normalizeStartupMode(raw), JSON.stringify(raw)).toBe("restore");
    }
  });
});

describe("startupMode store", () => {
  it("defaults to restoring the last session when nothing is stored", () => {
    localStorage.removeItem("adkm.startupMode");
    expect(normalizeStartupMode(localStorage.getItem("adkm.startupMode"))).toBe("restore");
    expect(shouldRestoreSession()).toBe(true);
    expect(shouldPersistSession()).toBe(true);
  });

  it("persists the choice and flips both gates", () => {
    setStartupMode("fresh");
    expect(localStorage.getItem("adkm.startupMode")).toBe("fresh");
    expect(startupMode.get()).toBe("fresh");
    expect(shouldRestoreSession()).toBe(false);
    expect(shouldPersistSession()).toBe(false);

    setStartupMode("restore");
    expect(localStorage.getItem("adkm.startupMode")).toBe("restore");
    expect(shouldRestoreSession()).toBe(true);
    expect(shouldPersistSession()).toBe(true);
  });
});
