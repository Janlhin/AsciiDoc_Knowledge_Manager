// @vitest-environment jsdom
/**
 * T-056: file-recovery snapshots must cover every TEXT document the editor opens
 * (`.md`, `.adoc`, `.txt`, source, config), not just Markdown — AsciiDoc is a
 * first-class format here, so having no edit history for `.adoc` was a real gap.
 *
 * These tests pin the coverage rule, the size guard, and the two data-safety
 * invariants the module promises: never overwrite an unreadable history file, and
 * never restore without first backing up what is about to be overwritten.
 */
import { describe, expect, it, vi } from "vitest";
import {
  isSnapshotable,
  listSnapshots,
  recordSnapshot,
  restoreSnapshot,
} from "@core/snapshots";
import type { Vault } from "@core/vault";

const MAX = 512 * 1024;

interface FakeVault extends Vault {
  config: Map<string, string>;
  files: Map<string, string>;
}

function makeVault(initialFiles: Record<string, string> = {}): FakeVault {
  const config = new Map<string, string>();
  const files = new Map<string, string>(Object.entries(initialFiles));
  const vault = {
    adapter: {
      readConfig: async (k: string) => config.get(k) ?? null,
      writeConfig: async (k: string, v: string) => {
        config.set(k, v);
      },
    },
    read: async (p: string) => files.get(p) ?? "",
    modify: async (p: string, c: string) => {
      files.set(p, c);
    },
    fileExists: (p: string) => files.has(p),
    config,
    files,
  };
  return vault as unknown as FakeVault;
}

const keyOf = (path: string) => `snapshots/${encodeURIComponent(path)}.json`;

function readStore(vault: FakeVault, path: string): { path: string; snapshots: { ts: number; content: string }[] } {
  const raw = vault.config.get(keyOf(path));
  expect(raw, `no snapshot store written for ${path}`).toBeTruthy();
  return JSON.parse(raw!) as { path: string; snapshots: { ts: number; content: string }[] };
}

describe("isSnapshotable — text documents only", () => {
  it("accepts markdown, AsciiDoc, plain text, source and config", () => {
    for (const p of ["a.md", "docs/guide.adoc", "notes.txt", "run.log", "src/main.ts", "data.json", "conf.yaml"]) {
      expect(isSnapshotable(p), p).toBe(true);
    }
  });

  it("rejects binaries, media and unknown extensions", () => {
    for (const p of ["cover.png", "paper.pdf", "book.epub", "song.mp3", "archive.cbz", "blob.weird"]) {
      expect(isSnapshotable(p), p).toBe(false);
    }
  });

  it("never snapshots dot-prefixed config or the snapshot store itself", () => {
    expect(isSnapshotable(".obsidian/snapshots/x.json")).toBe(false);
    expect(isSnapshotable("notes/.hidden/a.adoc")).toBe(false);
  });
});

describe("recordSnapshot", () => {
  it("stores an AsciiDoc capture under an encoded one-segment key", async () => {
    const vault = makeVault();
    await recordSnapshot(vault, "guides/intro.adoc", "= Intro\n", 1_000);

    const store = readStore(vault, "guides/intro.adoc");
    expect(store.path).toBe("guides/intro.adoc");
    expect(store.snapshots).toEqual([{ ts: 1_000, content: "= Intro\n" }]);
    // "/" must be neutralised so the whole path is a single filename segment
    expect(keyOf("guides/intro.adoc")).not.toContain("guides/");
  });

  it("skips non-text paths entirely", async () => {
    const vault = makeVault();
    await recordSnapshot(vault, "cover.png", "binary-ish", 1_000);
    expect(vault.config.size).toBe(0);
  });

  it("dedupes a capture identical to the newest one", async () => {
    const vault = makeVault();
    await recordSnapshot(vault, "a.md", "same", 1_000);
    await recordSnapshot(vault, "a.md", "same", 200_000);
    expect(readStore(vault, "a.md").snapshots).toHaveLength(1);
  });

  it("throttles automatic captures to one per minute", async () => {
    const vault = makeVault();
    await recordSnapshot(vault, "b.md", "v1", 1_000);
    await recordSnapshot(vault, "b.md", "v2", 30_000); // inside the window → dropped
    expect(readStore(vault, "b.md").snapshots).toHaveLength(1);

    await recordSnapshot(vault, "b.md", "v3", 61_000);
    expect(readStore(vault, "b.md").snapshots.map((s) => s.content)).toEqual(["v1", "v3"]);
  });

  it("lets a forced capture bypass the throttle", async () => {
    const vault = makeVault();
    await recordSnapshot(vault, "c.md", "v1", 1_000);
    await recordSnapshot(vault, "c.md", "v2", 2_000, true);
    expect(readStore(vault, "c.md").snapshots.map((s) => s.content)).toEqual(["v1", "v2"]);
  });

  it("prunes to the newest 25 captures", async () => {
    const vault = makeVault();
    for (let i = 0; i < 30; i += 1) {
      await recordSnapshot(vault, "d.md", `v${i}`, i * 60_000);
    }
    const list = readStore(vault, "d.md").snapshots;
    expect(list).toHaveLength(25);
    expect(list[0]!.ts).toBe(5 * 60_000);
    expect(list[24]!.content).toBe("v29");
  });

  it("skips oversized content on automatic captures but keeps forced ones", async () => {
    const vault = makeVault();
    const big = "x".repeat(MAX + 1);
    await recordSnapshot(vault, "huge.adoc", big, 1_000);
    expect(vault.config.has(keyOf("huge.adoc"))).toBe(false);

    await recordSnapshot(vault, "huge.adoc", big, 1_000, true);
    expect(readStore(vault, "huge.adoc").snapshots).toHaveLength(1);
  });

  it("refuses to overwrite a malformed history file", async () => {
    const vault = makeVault();
    vault.config.set(keyOf("e.md"), "{not json");
    await expect(recordSnapshot(vault, "e.md", "v1", 1_000)).rejects.toThrow();
    expect(vault.config.get(keyOf("e.md"))).toBe("{not json");
  });

  it("refuses to overwrite a structurally valid but shapeless file", async () => {
    const vault = makeVault();
    vault.config.set(keyOf("f.md"), JSON.stringify({ path: "f.md" }));
    await expect(recordSnapshot(vault, "f.md", "v1", 1_000)).rejects.toThrow();
  });
});

describe("listSnapshots", () => {
  it("returns [] for a malformed history file instead of throwing", async () => {
    const vault = makeVault();
    vault.config.set(keyOf("g.md"), "garbage");
    await expect(listSnapshots(vault, "g.md")).resolves.toEqual([]);
  });

  it("drops entries with the wrong shape", async () => {
    const vault = makeVault();
    vault.config.set(keyOf("h.md"), JSON.stringify({
      path: "h.md",
      snapshots: [{ ts: 1, content: "ok" }, { ts: "bad", content: "no" }, { content: "no ts" }],
    }));
    const list = await listSnapshots(vault, "h.md");
    expect(list).toEqual([{ ts: 1, content: "ok" }]);
  });
});

describe("restoreSnapshot", () => {
  it("flushes, snapshots the current bytes, then overwrites", async () => {
    const vault = makeVault({ "notes/a.adoc": "current bytes" });
    const documents = { flushAll: vi.fn(async () => {}) };
    await recordSnapshot(vault, "notes/a.adoc", "old bytes", 1_000);

    const ok = await restoreSnapshot(
      vault,
      documents as unknown as Parameters<typeof restoreSnapshot>[1],
      "notes/a.adoc",
      1_000,
      2_000,
    );

    expect(ok).toBe(true);
    expect(documents.flushAll).toHaveBeenCalledTimes(1);
    expect(vault.files.get("notes/a.adoc")).toBe("old bytes");
    // the state that was overwritten is preserved as a fresh capture
    expect(readStore(vault, "notes/a.adoc").snapshots.map((s) => s.content))
      .toEqual(["old bytes", "current bytes"]);
  });

  it("returns false when the timestamp is gone or the file is missing", async () => {
    const vault = makeVault({ "notes/b.adoc": "x" });
    const documents = { flushAll: vi.fn(async () => {}) };
    const deps = documents as unknown as Parameters<typeof restoreSnapshot>[1];

    await expect(restoreSnapshot(vault, deps, "notes/b.adoc", 999, 2_000)).resolves.toBe(false);
    await expect(restoreSnapshot(vault, deps, "notes/gone.adoc", 999, 2_000)).resolves.toBe(false);
    expect(vault.files.get("notes/b.adoc")).toBe("x");
  });
});
