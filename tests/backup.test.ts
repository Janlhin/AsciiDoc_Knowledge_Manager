// @vitest-environment jsdom
/**
 * T-057 / D-026: optional off-disk backup.
 *
 * What these tests pin: the target-directory safety rule (never the vault itself),
 * which files go into the archive (`.trash` and dot-directories out), the name
 * contract that bounds what may ever be deleted, retention, and that the whole
 * zip → write → prune flow works with only the injected IO.
 */
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import {
  backupFileName,
  checkBackupDir,
  isBackedUpPath,
  isBackupFileName,
  joinPath,
  planBackup,
  planPrune,
  runBackup,
  type BackupIO,
} from "@core/backup";
import type { Vault } from "@core/vault";

const VAULT = "C:\\Vaults\\Notes";

function makeVault(docs: Record<string, string>, config: Record<string, string> = {}): Vault {
  const files = Object.keys(docs).map((path) => ({
    kind: "file" as const,
    path,
    name: path.split("/").pop() ?? path,
    basename: (path.split("/").pop() ?? path).replace(/\.[^.]+$/, ""),
    extension: (path.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase(),
  }));
  const dirs = new Set<string>();
  for (const key of Object.keys(config)) {
    const segs = key.split("/");
    for (let i = 1; i < segs.length; i += 1) dirs.add(segs.slice(0, i).join("/"));
  }
  const vault = {
    getFiles: () => files,
    read: async (p: string) => docs[p] ?? "",
    readBinary: async (p: string) => new TextEncoder().encode(docs[p] ?? ""),
    getVaultPath: () => VAULT,
    adapter: {
      listConfigDir: async (rel: string) => {
        const prefix = rel === "" ? "" : `${rel}/`;
        const seen = new Map<string, boolean>();
        for (const key of [...Object.keys(config), ...dirs]) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          if (rest === "") continue;
          const head = rest.split("/")[0]!;
          seen.set(head, seen.get(head) === true || dirs.has(`${prefix}${head}`) || rest.includes("/"));
        }
        return [...seen].map(([name, isDir]) => ({ name, isDir }));
      },
      readConfig: async (rel: string) => config[rel] ?? null,
    },
  };
  return vault as unknown as Vault;
}

function makeIO(existing: string[] = []) {
  const written = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const io: BackupIO = {
    writeBinary: vi.fn(async (path: string, bytes: Uint8Array) => {
      written.set(path, bytes);
    }),
    listBackups: vi.fn(async () => [...existing, ...[...written.keys()].map((p) => p.split("/").pop()!)]),
    deleteBackup: vi.fn(async (path: string) => {
      deleted.push(path);
      written.delete(path);
    }),
  };
  return { io, written, deleted };
}

describe("name contract", () => {
  it("encodes the moment in a sortable file name", () => {
    const name = backupFileName(new Date(2026, 10, 16, 12, 19, 30).getTime());
    expect(name).toBe("adkm-backup-20261116-121930.zip");
    expect(isBackupFileName(name)).toBe(true);
  });

  it("only accepts the app's own archive names", () => {
    for (const bad of ["notes.md", "adkm-backup.zip", "backup-20260101.zip", "adkm-backup-x.7z"]) {
      expect(isBackupFileName(bad), bad).toBe(false);
    }
  });
});

describe("checkBackupDir", () => {
  it("rejects empty and relative targets", () => {
    expect(checkBackupDir("", VAULT)).toEqual({ ok: false, reason: "empty" });
    expect(checkBackupDir("  ", VAULT)).toEqual({ ok: false, reason: "empty" });
    expect(checkBackupDir("backups", VAULT)).toEqual({ ok: false, reason: "relative" });
    expect(checkBackupDir("./backups", VAULT)).toEqual({ ok: false, reason: "relative" });
  });

  it("rejects the vault itself and anything inside it (case-insensitively)", () => {
    expect(checkBackupDir(VAULT, VAULT).ok).toBe(false);
    expect(checkBackupDir("C:\\Vaults\\Notes\\bk", VAULT).reason).toBe("inside-vault");
    expect(checkBackupDir("c:/vaults/notes/bk", VAULT).reason).toBe("inside-vault");
    expect(checkBackupDir("C:\\Vaults\\Notes\\", VAULT).reason).toBe("inside-vault");
  });

  it("accepts another disk, a sibling folder, a network share or a cloud-sync folder", () => {
    for (const dir of [
      "D:\\ADKM-backups",
      "C:\\Vaults\\Backups",
      "\\\\nas\\share\\adkm",
      "C:\\Users\\me\\OneDrive\\ADKM",
      "/home/me/backups",
    ]) {
      expect(checkBackupDir(dir, VAULT).ok, dir).toBe(true);
    }
  });
});

describe("planPrune", () => {
  it("keeps the newest `keep` archives and returns the oldest for deletion", () => {
    const names = Array.from({ length: 12 }, (_, i) => `adkm-backup-202611${String(i + 1).padStart(2, "0")}-000000.zip`);
    const doomed = planPrune(names, 10);
    expect(doomed).toHaveLength(2);
    expect(doomed).toEqual([names[0], names[1]]);
  });

  it("ignores foreign files in the folder", () => {
    expect(planPrune(["notes.md", "adkm-backup-a.zip", "photo.png"], 5)).toEqual([]);
  });

  it("never deletes when at or under the limit", () => {
    expect(planPrune(["adkm-backup-20261116-000000.zip"], 1)).toEqual([]);
  });
});

describe("planBackup", () => {
  it("excludes the trash and dot-directories, keeping the rest", () => {
    expect(isBackedUpPath(".trash/old.md")).toBe(false);
    expect(isBackedUpPath(".git/config")).toBe(false);
    expect(isBackedUpPath("notes/.hidden/a.adoc")).toBe(false);
    expect(isBackedUpPath("notes/a.adoc")).toBe(true);
  });

  it("splits text documents from binaries", () => {
    const plan = planBackup(["b.md", "a.adoc", "img/cover.png", "data.csv", ".trash/x.md"]);
    expect(plan.text).toEqual(["a.adoc", "b.md", "data.csv"]);
    expect(plan.binary).toEqual(["img/cover.png"]);
  });
});

describe("joinPath", () => {
  it("does not double a trailing separator", () => {
    expect(joinPath("D:\\bk\\", "a.zip")).toBe("D:\\bk/a.zip");
    expect(joinPath("D:/bk", "a.zip")).toBe("D:/bk/a.zip");
  });
});

describe("runBackup", () => {
  const docs = { "notes/a.adoc": "= A\n", "img/x.png": "png-bytes", ".trash/gone.md": "old" };
  const config = { "bookmarks.json": "[]", "workspaces/one.json": "{}" };

  it("writes a zip holding documents and the config tree, skipping the trash", async () => {
    const vault = makeVault(docs, config);
    const { io, written } = makeIO();
    const now = new Date(2026, 10, 16, 12, 19, 30).getTime();

    const result = await runBackup(vault, io, { dir: "D:\\bk", keep: 10, now });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toMatch(/^adkm-backup-20261116-121930-[0-9a-f-]+\.zip$/);
    expect(result.documents).toBe(2);
    expect(result.configFiles).toBe(2);

    const bytes = written.get(`D:\\bk/${result.name}`);
    expect(bytes).toBeInstanceOf(Uint8Array);
    const zip = await JSZip.loadAsync(bytes!);
    const entries = Object.keys(zip.files).filter((k) => !zip.files[k]!.dir).sort();
    expect(entries).toEqual([
      ".obsidian/bookmarks.json",
      ".obsidian/workspaces/one.json",
      "img/x.png",
      "notes/a.adoc",
    ]);
    expect(await zip.file("notes/a.adoc")!.async("string")).toBe("= A\n");
  });

  it("refuses a target inside the vault without touching the disk", async () => {
    const vault = makeVault(docs);
    const { io, written } = makeIO();
    const result = await runBackup(vault, io, { dir: `${VAULT}\\bk`, keep: 10, now: 1 });
    expect(result).toEqual({ ok: false, reason: "inside-vault" });
    expect(written.size).toBe(0);
    expect(io.writeBinary).not.toHaveBeenCalled();
  });

  it("reports a missing target instead of guessing one", async () => {
    const vault = makeVault(docs);
    const { io } = makeIO();
    expect(await runBackup(vault, io, { dir: null, keep: 10, now: 1 })).toEqual({ ok: false, reason: "no-dir" });
  });

  it("prunes the oldest archives down to `keep`", async () => {
    const vault = makeVault(docs);
    const { io, deleted } = makeIO([
      "adkm-backup-20261114-000000.zip",
      "adkm-backup-20261115-000000.zip",
    ]);
    const result = await runBackup(vault, io, {
      dir: "D:\\bk",
      keep: 2,
      now: new Date(2026, 10, 16, 12, 19, 30).getTime(),
    });
    expect(result.ok).toBe(true);
    expect(deleted.map((p) => p.split("/").pop())).toEqual(["adkm-backup-20261114-000000.zip"]);
  });
});


describe("backup concurrency and failures", () => {
  const opts = { dir: "D:/bk", keep: 1, now: new Date(2026, 10, 17, 12).getTime() };
  it("rejects overlap before a second read and releases the guard afterwards", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = makeVault({ "a.md": "first" });
    const read = vi.spyOn(first, "read").mockImplementation(async () => { await gate; return "first"; });
    const second = makeVault({ "b.md": "second" });
    const secondRead = vi.spyOn(second, "read");
    const a = makeIO(); const b = makeIO();
    const pending = runBackup(first, a.io, opts);
    expect(read).toHaveBeenCalledOnce();
    try {
      expect(await runBackup(second, b.io, opts)).toMatchObject({ ok: false, reason: "io" });
      expect(secondRead).not.toHaveBeenCalled();
      expect(b.io.writeBinary).not.toHaveBeenCalled();
    } finally { release(); await pending; }
    const retried = await runBackup(second, b.io, opts);
    expect(retried.ok).toBe(true);
  });

  it("never lists or prunes after a failed write and permits retry", async () => {
    const { io, deleted, written } = makeIO(["adkm-backup-20261116-000000.zip"]);
    vi.mocked(io.writeBinary).mockRejectedValueOnce(new Error("chunk failed"));
    const vault = makeVault({ "a.md": "new" });
    expect(await runBackup(vault, io, opts)).toMatchObject({ ok: false, reason: "io" });
    expect(io.listBackups).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
    expect((await runBackup(vault, io, opts)).ok).toBe(true);
    expect(written.size).toBe(1);
  });

  it("keeps sequential same-second snapshots distinct and readable", async () => {
    const { io, written } = makeIO();
    const a = await runBackup(makeVault({ "a.md": "first" }), io, { ...opts, keep: 10 });
    const b = await runBackup(makeVault({ "a.md": "second" }), io, { ...opts, keep: 10 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.name).not.toBe(b.name);
    expect(written.size).toBe(2);
    for (const [result, text] of [[a, "first"], [b, "second"]] as const) {
      const zip = await JSZip.loadAsync(written.get(`D:/bk/${result.name}`)!, { checkCRC32: true });
      expect(await zip.file("a.md")!.async("string")).toBe(text);
    }
  });
});
