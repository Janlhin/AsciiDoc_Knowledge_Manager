// @vitest-environment jsdom
/**
 * T-072 §9.2 稳定性补齐的契约测试。四条各取「可注入假 host」的纯 TS 路径，
 * 不依赖真实 Tauri 进程：
 *
 *  1. 单文件解析失败不中断整体，失败项进入内存注册表、可被 UI 查询；
 *  2. 索引行损坏 / 索引文件缺失时，回退全量读盘重建；
 *  3. watcher 同一批事件去重（TS 侧兜底；Rust 侧去抖/去重见 main.rs watcher_tests）；
 *  4. 长任务（backfill）协作式可取消：取消不写半截批次，重置后重试可收敛。
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { EventBus } from "@core/events";
import { Vault, dedupePaths } from "@core/vault";
import { MetadataIndex } from "@core/metadata";
import { isIndexable } from "@core/parsers/indexable";
import {
  installIndexHydration,
  resetSearchIndexCancel,
  cancelSearchIndex,
  syncSearchIndex,
  type IndexHost,
  type IndexedNote,
} from "@core/indexer";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const upserts: IndexedNote[] = [];

function installTauriFlag(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.__TAURI_INTERNALS__ = {};
}

interface FakeVaultSeed {
  files: Record<string, string>;
  /** paths whose read() rejects — simulates a corrupt / locked / unreadable note */
  broken?: ReadonlySet<string>;
  /** optional hook fired inside read(), e.g. to raise the cancel flag mid-backfill */
  onRead?: (path: string) => void;
}

async function makeHost(
  seed: FakeVaultSeed,
  vaultPath: string,
): Promise<{ host: IndexHost; metadata: MetadataIndex }> {
  const events = new EventBus();
  const nodes = Object.entries(seed.files).map(([path, content]) => {
    const name = path.split("/").pop() ?? path;
    const dot = name.lastIndexOf(".");
    return {
      kind: "file" as const,
      path,
      name,
      basename: dot > 0 ? name.slice(0, dot) : name,
      extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : "",
      size: content.length,
      mtime: 1,
    };
  });
  const read = async (p: string): Promise<string> => {
    seed.onRead?.(p);
    if (seed.broken?.has(p)) throw new Error(`boom: ${p}`);
    return seed.files[p] ?? "";
  };
  const vault = {
    getFiles: () => nodes,
    getIndexableFiles: () => nodes.filter((n) => isIndexable(n.path)),
    read,
    getVaultPath: () => vaultPath,
    fileExists: (p: string) => p in seed.files,
  };
  const metadata = new MetadataIndex(vault as unknown as Vault, events);
  return { host: { vault: vault as unknown as Vault, metadata, events }, metadata };
}

beforeEach(() => {
  upserts.length = 0;
  invoke.mockReset();
  installTauriFlag();
  resetSearchIndexCancel();
  invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "index_open") {
      return { notes: 0, links: 0, tags: 0, parseRulesVersion: 1, dbPath: "" };
    }
    if (cmd === "index_known") return [];
    if (cmd === "index_upsert") {
      upserts.push(args?.note as IndexedNote);
      return undefined;
    }
    return undefined;
  });
});

describe("§9.2-1 单文件解析失败：不中断整体，失败可查询", () => {
  it("一个坏文件不影响其余文件入库，失败项进入注册表", async () => {
    const { host, metadata } = await makeHost(
      {
        files: {
          "notes/good-a.md": "# Alpha\n#tagA",
          "notes/broken.md": "should never be read",
          "notes/good-b.md": "# Beta\n#tagB",
        },
        broken: new Set(["notes/broken.md"]),
      },
      "C:\\FakeVault\\One",
    );

    await metadata.rebuildAll();

    expect(metadata.getMetadata("notes/good-a.md")?.tags.map((t) => t.tag)).toEqual(["tagA"]);
    expect(metadata.getMetadata("notes/good-b.md")?.tags.map((t) => t.tag)).toEqual(["tagB"]);
    expect(metadata.getMetadata("notes/broken.md")).toBeUndefined();

    const errors = metadata.getParseErrors();
    expect(errors).toEqual([{ path: "notes/broken.md", message: "boom: notes/broken.md" }]);
    expect(metadata.getParseError("notes/broken.md")).toBe("boom: notes/broken.md");
    expect(metadata.getParseError("notes/good-a.md")).toBeUndefined();

    // sanity: the backfill path also tolerates the broken note. `written` counts
    // processed files; the unreadable one never reaches an upsert.
    const written = await syncSearchIndex(host);
    expect(written).toBe(3);
    expect(upserts.map((u) => u.path)).not.toContain("notes/broken.md");
  });

  it("修好后重新解析，注册表条目被清除", async () => {
    const seed: FakeVaultSeed = {
      files: { "notes/broken.md": "should never be read" },
      broken: new Set(["notes/broken.md"]),
    };
    const { metadata } = await makeHost(seed, "C:\\FakeVault\\Two");
    await metadata.rebuildAll();
    expect(metadata.getParseError("notes/broken.md")).toBeDefined();

    // file becomes readable again; a fresh rebuild drops the error record
    seed.broken = undefined;
    seed.files["notes/broken.md"] = "# Fixed\n#tagFixed";
    await metadata.rebuildAll();
    expect(metadata.getParseErrors()).toEqual([]);
    expect(metadata.getMetadata("notes/broken.md")?.tags.map((t) => t.tag)).toEqual(["tagFixed"]);
  });
});

describe("§9.2-2 索引损坏 / 缺失时从原文重建", () => {
  it("损坏的索引行被跳过，该文件回退读盘解析", async () => {
    const aBody = "# Alpha\n#tagA";
    const bBody = "# Beta\n#tagB";
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "index_open") {
        return { notes: 1, links: 0, tags: 0, parseRulesVersion: 1, dbPath: "" };
      }
      if (cmd === "index_known") {
        return [
          // mtime/size still match, but `meta` is corrupt JSON → hydration must skip it
          { path: "notes/a.md", mtime: 1, size: aBody.length, meta: "{not-json" },
        ];
      }
      return [];
    });
    const { host, metadata } = await makeHost(
      { files: { "notes/a.md": aBody, "notes/b.md": bBody } },
      "C:\\FakeVault\\Three",
    );
    installIndexHydration(host);

    await metadata.rebuildAll();

    const a = metadata.getMetadata("notes/a.md");
    expect(a?.tags.map((t) => t.tag)).toEqual(["tagA"]); // came from disk, not the corrupt row
    expect(metadata.getMetadata("notes/b.md")?.tags.map((t) => t.tag)).toEqual(["tagB"]);
  });

  it("索引文件缺失（index_open 返回 null）时仍全量读盘重建", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "index_open") return null; // persisted index gone/unopenable
      if (cmd === "index_known") return [];
      return [];
    });
    const { host, metadata } = await makeHost(
      {
        files: {
          "notes/a.md": "# Alpha\n#tagA",
          "notes/b.md": "# Beta\n#tagB",
        },
      },
      "C:\\FakeVault\\Four",
    );
    installIndexHydration(host);

    await metadata.rebuildAll();

    expect(metadata.getMetadata("notes/a.md")?.tags.map((t) => t.tag)).toEqual(["tagA"]);
    expect(metadata.getMetadata("notes/b.md")?.tags.map((t) => t.tag)).toEqual(["tagB"]);
  });
});

describe("§9.2-3 watcher 事件去重（TS 侧兜底）", () => {
  it("同一批重复路径折叠为首次出现的单条，空路径丢弃", () => {
    expect(dedupePaths(["a.md", "b.md", "a.md", "c.md", "b.md"])).toEqual([
      "a.md",
      "b.md",
      "c.md",
    ]);
    expect(dedupePaths([])).toEqual([]);
    expect(dedupePaths([""])).toEqual([]);
  });
});

describe("§9.2-4 backfill 协作式取消", () => {
  function eightFiles(): Record<string, string> {
    const files: Record<string, string> = {};
    for (let i = 0; i < 8; i++) files[`notes/n${i}.md`] = `# Note ${i}`;
    return files;
  }

  it("取消标志置位后一个文件都不写入", async () => {
    const { host } = await makeHost({ files: eightFiles() }, "C:\\FakeVault\\Five");
    cancelSearchIndex();
    const written = await syncSearchIndex(host);
    expect(written).toBe(0);
    expect(upserts).toEqual([]);
  });

  it("跑到一半取消：已提交的行保持一致，重置后重试收敛到全量", async () => {
    let cancelRaised = false;
    const { host } = await makeHost(
      {
        files: eightFiles(),
        // raising the cancel flag inside the first read proves the loop checks
        // the flag between notes, not only before starting
        onRead: () => {
          if (!cancelRaised) {
            cancelRaised = true;
            cancelSearchIndex();
          }
        },
      },
      "C:\\FakeVault\\Six",
    );

    const writtenFirst = await syncSearchIndex(host);
    expect(writtenFirst).toBe(1);
    expect(upserts.map((u) => u.path)).toEqual(["notes/n0.md"]);

    // retry after reset: no half-written batch to repair, the run resumes and converges.
    // The mock index has no persisted known-rows, so n0 is re-upserted idempotently;
    // what matters is the final indexed set covers every note.
    resetSearchIndexCancel();
    const writtenSecond = await syncSearchIndex(host);
    expect(writtenSecond).toBe(8);
    expect(new Set(upserts.map((u) => u.path))).toEqual(
      new Set(
        Array.from({ length: 8 }, (_, i) => `notes/n${i}.md`),
      ),
    );
  });
});
