// @vitest-environment jsdom
/**
 * T-068: `.txt` 与 `.md` / `.adoc` 同索引——可搜索、可预览、可被引用解析，
 * 但明确「无结构」：不产出标题 / 章节 / 大纲，不猜首行为标题，不伪造层级。
 *
 * 覆盖：
 *  1. txt（含大小写扩展名、路径含空格）进入可索引集合；二进制 / 未知扩展名排除；
 *  2. MemoryVault 的 `getIndexableFiles()` 带上 txt；
 *  3. `parseDocument` 对 txt 返回空结构（标题 / 链接 / 标签 / 块 / 脚注 / 别名）；
 *  4. txt 正文可被 TS 搜索求值器命中；
 *  5. 索引同步把 txt 正文写进索引载荷（Rust FTS 的输入），二进制不写；
 *  6. `xref:` / `link:` 显式 `.txt` 目标按路径解析成功（不做锚点）；
 *  7. 超大 txt 正文截断到索引字符上限；
 *  8. 路径含空格的 txt 可索引、可解析。
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { EventBus } from "@core/events";
import { MemoryVaultAdapter, Vault } from "@core/vault";
import { MetadataIndex, parseDocument } from "@core/metadata";
import { isIndexable, stripDocExtension } from "@core/parsers/indexable";
import { syncSearchIndex, type IndexHost, type IndexedNote } from "@core/indexer";
import { buildDocIndex, resolveXref } from "@core/docsAsCode";
import { evaluateSearch, parseSearchQuery } from "@core/search";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

/** 捕获 `index_upsert` 载荷；非 Tauri 环境下 searchIndex 会软降级，这里打开通道。 */
const upserts: IndexedNote[] = [];

function installTauriFlag(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.__TAURI_INTERNALS__ = {};
}

async function makeFakeVault(files: Record<string, string>): Promise<{
  vault: Vault;
  metadata: MetadataIndex;
  host: IndexHost;
}> {
  const events = new EventBus();
  const nodes = Object.entries(files).map(([path, content]) => {
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
  const vault = {
    getFiles: () => nodes,
    getIndexableFiles: () => nodes.filter((n) => isIndexable(n.path)),
    read: async (p: string) => files[p] ?? "",
    getVaultPath: () => "C:\\FakeVault",
    fileExists: (p: string) => p in files,
  };
  const metadata = new MetadataIndex(vault as unknown as Vault, events);
  await metadata.rebuildAll();
  return {
    vault: vault as unknown as Vault,
    metadata,
    host: { vault: vault as unknown as Vault, metadata, events },
  };
}

beforeEach(() => {
  upserts.length = 0;
  invoke.mockReset();
  installTauriFlag();
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

describe("T-068 .txt 可索引判定", () => {
  it("txt（含大小写扩展名、路径含空格）被判定为可索引", () => {
    expect(isIndexable("notes/alpha.txt")).toBe(true);
    expect(isIndexable("notes/alpha.TXT")).toBe(true);
    expect(isIndexable("notes/alpha.Txt")).toBe(true);
    expect(isIndexable("docs/My Notes/Report.txt")).toBe(true);
  });

  it("二进制 / 未知 / 无扩展名文件被排除", () => {
    expect(isIndexable("assets/pic.png")).toBe(false);
    expect(isIndexable("archive/backup.zip")).toBe(false);
    expect(isIndexable("notes/unknown.xyz")).toBe(false);
    expect(isIndexable("LICENSE")).toBe(false);
  });

  it("stripDocExtension 剥掉 .txt 后缀，其它后缀原样返回", () => {
    expect(stripDocExtension("notes/alpha.txt")).toBe("notes/alpha");
    expect(stripDocExtension("assets/pic.png")).toBe("assets/pic.png");
  });

  it("MemoryVault 的 getIndexableFiles() 带上 txt、排除二进制", async () => {
    const seed = {
      "notes/alpha.txt": "plain text body",
      "notes/note.adoc": "= Title",
      "assets/pic.png": "binary bytes",
    };
    const events = new EventBus();
    const vault = new Vault(new MemoryVaultAdapter(seed), events);
    await vault.load();
    const indexablePaths = vault.getIndexableFiles().map((f) => f.path);
    expect(indexablePaths).toContain("notes/alpha.txt");
    expect(indexablePaths).toContain("notes/note.adoc");
    expect(indexablePaths).not.toContain("assets/pic.png");
  });
});

describe("T-068 txt 解析：无结构，不伪造标题", () => {
  it("不产出标题 / 链接 / 标签 / 块 / 脚注 / 别名，首行不被猜成标题", () => {
    const body = [
      "# Fake Heading",
      "[[wikilink]]",
      "[md](note.md)",
      "#tag",
      "^block-id",
      "[^1]: footnote definition",
      "```",
      "#inside fence",
      "```",
    ].join("\n");
    const meta = parseDocument("notes/a.txt", body);
    expect(meta.headings).toEqual([]);
    expect(meta.links).toEqual([]);
    expect(meta.tags).toEqual([]);
    expect(meta.blocks).toEqual([]);
    expect(meta.footnotes).toEqual([]);
    expect(meta.footnoteRefs).toEqual([]);
    expect(meta.aliases).toEqual([]);
    expect(meta.frontmatter).toBeUndefined();
    expect(meta.contentLength).toBe(body.length);
  });
});

describe("T-068 txt 搜索命中", () => {
  it("TS 搜索求值器在 txt 正文中命中关键词", () => {
    const expr = parseSearchQuery("zephyr").expr!;
    const outcome = evaluateSearch(expr, {
      path: "notes/alpha.txt",
      fileName: "alpha.txt",
      basename: "alpha",
      content: "The zephyr keyword lives in this plain note.",
      tags: [],
    });
    expect(outcome.matched).toBe(true);
    expect(outcome.ranges.length).toBeGreaterThan(0);
  });

  it("索引同步把 txt 正文写进索引载荷，二进制不写入", async () => {
    const { host } = await makeFakeVault({
      "notes/alpha.txt": "The zephyr keyword lives here.",
      "notes/note.adoc": "xref:alpha.txt[]",
      "assets/pic.png": "binary bytes",
    });
    const written = await syncSearchIndex(host);
    expect(written).toBe(2);
    const txtNote = upserts.find((n) => n.path === "notes/alpha.txt");
    expect(txtNote).toBeDefined();
    expect(txtNote!.title).toBe("alpha");
    expect(txtNote!.body).toContain("zephyr");
    expect(upserts.some((n) => n.path === "assets/pic.png")).toBe(false);
  });
});

describe("T-068 txt 引用解析", () => {
  it("MetadataIndex 按显式 .txt 后缀与路径解析到 txt 文件", async () => {
    const { metadata } = await makeFakeVault({
      "notes/alpha.txt": "plain",
      "notes/note.adoc": "xref:alpha.txt[]",
    });
    expect(metadata.resolveLink("notes/alpha.txt", "notes/note.adoc")).toBe(
      "notes/alpha.txt",
    );
    expect(metadata.resolveLink("alpha.txt", "notes/note.adoc")).toBe(
      "notes/alpha.txt",
    );
  });

  it("docsAsCode 的 resolveXref 解析显式 .txt 路径目标（纯路径，无锚点）", () => {
    const paths = ["notes/alpha.txt", "notes/note.adoc"];
    const index = buildDocIndex(paths);
    const byPath = resolveXref("notes/alpha.txt", "notes/note.adoc", index);
    expect(byPath.status).toBe("resolved");
    expect(byPath.path).toBe("notes/alpha.txt");

    const byName = resolveXref("alpha.txt", "notes/note.adoc", index);
    expect(byName.status).toBe("resolved");
    expect(byName.path).toBe("notes/alpha.txt");
  });

  it("adoc 中的 xref: / link: 宏提取出 .txt 目标，再走解析", () => {
    const adoc = "xref:alpha.txt[看原文]\nlink:alpha.txt[链接]";
    const meta = parseDocument("notes/note.adoc", adoc);
    expect(meta.links.map((l) => l.target)).toEqual(["alpha.txt", "alpha.txt"]);
  });
});

describe("T-068 边界与负向", () => {
  it("超大 txt 正文截断到索引字符上限，不整文入库", async () => {
    const huge = "x".repeat(400_000 + 1001);
    const { host } = await makeFakeVault({ "notes/huge.txt": huge });
    await syncSearchIndex(host);
    const note = upserts.find((n) => n.path === "notes/huge.txt");
    expect(note).toBeDefined();
    expect(note!.body.length).toBe(400_000);
  });

  it("路径含空格的 txt 可索引且可被名称解析命中", async () => {
    expect(isIndexable("docs/My Notes/Report.txt")).toBe(true);
    const { metadata } = await makeFakeVault({
      "docs/My Notes/Report.txt": "body",
      "docs/intro.adoc": "xref:Report.txt[]",
    });
    expect(metadata.resolveLink("Report.txt", "docs/intro.adoc")).toBe(
      "docs/My Notes/Report.txt",
    );
  });
});
