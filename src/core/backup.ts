/**
 * T-057 / D-026 — optional OFF-DISK backup ("分盘备份", and the shortest honest
 * path to "cloud": point the target at a folder your cloud client already syncs).
 *
 * Shape of the feature: the user picks ONE directory (another disk, a network
 * share, or e.g. `OneDrive\ADKM`); each run writes a timestamped ZIP there —
 * vault documents + the `.obsidian` config tree (bookmarks, workspaces, snapshots)
 * — and old archives are pruned to `keep`.
 *
 * Deliberate non-goals: no sync engine, no merge, no conflict resolution, no
 * background daemon, and no silent writes anywhere the user did not choose.
 * A ZIP per run is atomic (temp + rename), trivially pruned by name, and can be
 * copied further by any tool afterwards.
 *
 * Data-safety: the target may never be the vault or anything inside it (that
 * would recurse and grow the vault with its own backups); only files matching
 * the app's own `adkm-backup-*.zip` contract are ever listed or deleted, and that
 * guard is enforced in Rust as well.
 */
import JSZip from "jszip";
import { isEditableTextPath } from "./attachments";
import { Store } from "./store";
import type { Vault } from "./vault";

const STORAGE_KEY = "adkm.backup";
export const BACKUP_PREFIX = "adkm-backup-";
export const BACKUP_SUFFIX = ".zip";
const DEFAULT_KEEP = 10;

export interface BackupSettings {
  dir: string | null;
  keep: number;
  lastAt: number | null;
  lastName: string | null;
}

function readInitial(): BackupSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<BackupSettings>;
      return {
        dir: typeof p.dir === "string" && p.dir !== "" ? p.dir : null,
        keep: typeof p.keep === "number" && p.keep > 0 ? Math.min(p.keep, 100) : DEFAULT_KEEP,
        lastAt: typeof p.lastAt === "number" ? p.lastAt : null,
        lastName: typeof p.lastName === "string" ? p.lastName : null,
      };
    }
  } catch {
    /* corrupt settings → defaults; never block startup */
  }
  return { dir: null, keep: DEFAULT_KEEP, lastAt: null, lastName: null };
}

export const backupSettings = new Store<BackupSettings>(readInitial());

export function saveBackupSettings(next: BackupSettings): void {
  backupSettings.set(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage full / blocked — the in-memory value still drives this session */
  }
}

/* ------------------------------- pure rules ------------------------------ */

/** `adkm-backup-20261116-121930.zip` — sortable, and the only name we may prune. */
export function backupFileName(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${BACKUP_PREFIX}${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${BACKUP_SUFFIX}`;
}

export function isBackupFileName(name: string): boolean {
  return name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX);
}

/** Accept `C:\x`, `C:/x`, `\\server\share`, `/home/x`; reject plain relative names. */
export function isAbsoluteDir(dir: string): boolean {
  const d = dir.trim();
  if (d === "") return false;
  if (/^[a-zA-Z]:[\\/]/.test(d)) return true;
  if (d.startsWith("\\\\") || d.startsWith("//")) return true;
  return d.startsWith("/");
}

function normalizeDir(dir: string): string {
  return dir.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * The target must be absolute and must NOT be the vault or inside it — writing
 * backups into the backed-up folder would both recurse and inflate the vault.
 * A folder NEXT TO the vault on the same disk is allowed (user's call; it still
 * protects against "deleted the vault folder" even if not against disk death).
 */
export function checkBackupDir(dir: string, vaultPath: string | null): { ok: boolean; reason?: "empty" | "relative" | "inside-vault" } {
  if (dir.trim() === "") return { ok: false, reason: "empty" };
  if (!isAbsoluteDir(dir)) return { ok: false, reason: "relative" };
  if (vaultPath !== null) {
    const d = normalizeDir(dir);
    const v = normalizeDir(vaultPath);
    if (v !== "" && (d === v || d.startsWith(`${v}/`))) return { ok: false, reason: "inside-vault" };
  }
  return { ok: true };
}

/** Names to delete so that at most `keep` archives remain (oldest first, by name). */
export function planPrune(names: string[], keep: number): string[] {
  const backups = names.filter(isBackupFileName).sort();
  const excess = backups.length - Math.max(1, keep);
  return excess > 0 ? backups.slice(0, excess) : [];
}

/** Which vault files go into the archive. `.trash/` and dot-directories are out:
 *  the former is a deletion-recovery aid that can be large, the latter holds
 *  machine state (`.git`, plugin caches) or is added explicitly (`.obsidian`). */
export function isBackedUpPath(path: string): boolean {
  const segs = path.split("/");
  if (segs[0] === ".trash") return false;
  return !segs.some((s) => s.startsWith("."));
}

export interface BackupPlan {
  text: string[];
  binary: string[];
}

export function planBackup(paths: string[]): BackupPlan {
  const plan: BackupPlan = { text: [], binary: [] };
  for (const path of paths) {
    if (!isBackedUpPath(path)) continue;
    if (isEditableTextPath(path)) plan.text.push(path);
    else plan.binary.push(path);
  }
  plan.text.sort();
  plan.binary.sort();
  return plan;
}

/* ------------------------------ orchestration ---------------------------- */

/** Everything outside the vault that backup needs, injected so unit tests can
 *  exercise the whole flow without Tauri. */
export interface BackupIO {
  writeBinary: (absolutePath: string, bytes: Uint8Array) => Promise<void>;
  listBackups: (dir: string) => Promise<string[]>;
  deleteBackup: (absolutePath: string) => Promise<void>;
}

export function joinPath(dir: string, name: string): string {
  return `${dir.trim().replace(/[\\/]+$/, "")}/${name}`;
}

/** Every file under `<vault>/.obsidian/`, recursively, as `relPath → text`. */
async function collectConfig(vault: Vault): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (rel: string): Promise<void> => {
    let entries;
    try {
      entries = await vault.adapter.listConfigDir(rel);
    } catch {
      return; // a vault without a config dir still backs up its documents
    }
    for (const entry of entries) {
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDir) {
        await walk(child);
        continue;
      }
      const raw = await vault.adapter.readConfig(child);
      if (raw !== null) out[child] = raw;
    }
  };
  await walk("");
  return out;
}

export type BackupResult =
  | { ok: true; name: string; documents: number; configFiles: number; pruned: string[] }
  | { ok: false; reason: "no-dir" | "empty" | "relative" | "inside-vault" | "io"; message?: string };

/**
 * Build and write one archive. Never throws: a failure comes back as `{ok:false}`
 * so callers can surface it instead of dying in a promise.
 */
export async function runBackup(
  vault: Vault,
  io: BackupIO,
  opts: { dir: string | null; keep: number; now: number },
): Promise<BackupResult> {
  const { dir } = opts;
  if (dir === null) return { ok: false, reason: "no-dir" };
  const check = checkBackupDir(dir, vault.getVaultPath());
  if (!check.ok) return { ok: false, reason: check.reason ?? "io" };

  try {
    const plan = planBackup(vault.getFiles().map((f) => f.path));
    const zip = new JSZip();
    for (const path of plan.text) {
      zip.file(path, await vault.read(path));
    }
    for (const path of plan.binary) {
      zip.file(path, await vault.readBinary(path));
    }
    const config = await collectConfig(vault);
    for (const [rel, text] of Object.entries(config)) {
      zip.file(`.obsidian/${rel}`, text);
    }

    const bytes = await zip.generateAsync({ type: "uint8array" });
    const name = backupFileName(opts.now);
    await io.writeBinary(joinPath(dir, name), bytes);

    // The listing already contains the archive we just wrote; only add the name
    // when a cached/mocked lister has not caught up, never twice (a duplicate
    // would make `keep` delete one archive too many).
    const listed = await io.listBackups(dir);
    const names = listed.includes(name) ? listed : [...listed, name];
    const pruned = planPrune(names, opts.keep);
    for (const old of pruned) {
      await io.deleteBackup(joinPath(dir, old));
    }

    saveBackupSettings({ ...backupSettings.get(), dir, keep: opts.keep, lastAt: opts.now, lastName: name });
    return {
      ok: true,
      name,
      documents: plan.text.length + plan.binary.length,
      configFiles: Object.keys(config).length,
      pruned,
    };
  } catch (err) {
    return { ok: false, reason: "io", message: err instanceof Error ? err.message : String(err) };
  }
}

/* --------------------------------- Tauri --------------------------------- */

/** Desktop IO. Loaded lazily so the browser build never pulls Tauri in. */
export function tauriBackupIO(): BackupIO {
  const invoke = async <T>(cmd: string, args: Record<string, unknown>): Promise<T> => {
    const { invoke: call } = await import("@tauri-apps/api/core");
    return call<T>(cmd, args);
  };
  return {
    writeBinary: async (absolutePath, bytes) => {
      // A whole-vault archive can be hundreds of MB. A single base64 argument of
      // that size silently produced a 0-byte file in the real app (measured with
      // a 440 MB fixture), so stream it in bounded chunks and append in Rust.
      await invoke<void>("export_begin_binary", { path: absolutePath });
      const CHUNK = 4 * 1024 * 1024;
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        const end = Math.min(bytes.length, offset + CHUNK);
        let binary = "";
        for (let i = offset; i < end; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, end)));
        }
        await invoke<void>("export_append_binary", {
          path: absolutePath,
          data: btoa(binary),
        });
      }
      await invoke<void>("export_finish_binary", { path: absolutePath });
    },
    listBackups: (dir) => invoke<string[]>("export_list_backups", { dir }),
    deleteBackup: (absolutePath) => invoke<void>("export_delete_backup", { path: absolutePath }),
  };
}

/** Native "pick a folder" dialog. Returns null when cancelled / not on desktop. */
export async function pickBackupDir(current: string | null): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Choose a backup folder",
      defaultPath: current ?? undefined,
    });
    return typeof picked === "string" ? picked : null;
  } catch {
    return null;
  }
}
