/**
 * Keeps the Rust search index (T-039) in step with the vault.
 *
 * The contract is one-way: the vault is the source of truth, the index is a
 * derived store that may be dropped at any time. Consequences enforced here:
 *
 *  - backfill runs *after* first paint and yields between notes, so it never
 *    competes with startup rendering (the thing T-027/T-028 were fighting);
 *  - unchanged files are skipped by mtime/size, so a warm start does no parsing;
 *  - every event handler is fire-and-forget: a failed index write must not
 *    surface as a failed save.
 */
import type { EventBus } from "./events";
import type { MetadataIndex } from "./metadata";
import type { FileNode } from "./types";
import type { Vault } from "./vault";
import {
  indexClose,
  indexKnown,
  indexOpen,
  indexRemove,
  indexRemovePrefix,
  indexRename,
  indexRenamePrefix,
  indexSearch,
  indexUpsert,
  type IndexedNote,
  type IndexSearchHit,
} from "./searchIndex";

/** Enough context to index, without depending on the app bundle (layering). */
export interface IndexHost {
  vault: Vault;
  metadata: MetadataIndex;
  events: EventBus;
}

/** Extensions whose text is worth searching. Binary previews stay out. */
const INDEXABLE = new Set(["md", "adoc"]);

/** A 20 MB note would cost more to index than it can ever return. */
const MAX_BODY_CHARS = 400_000;

/** Files handled per animation frame during backfill. */
const BACKFILL_CHUNK = 8;

let started = false;
let activeVault: string | null = null;

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function indexable(files: FileNode[]): FileNode[] {
  return files.filter((f) => INDEXABLE.has(f.extension));
}

/** Build the payload Rust stores. Title is the basename (no frontmatter parsing
 *  on the Rust side); body is the raw text, trimmed to the size cap. */
async function toIndexedNote(
  host: IndexHost,
  file: FileNode,
): Promise<IndexedNote | null> {
  let text: string;
  try {
    text = await host.vault.read(file.path);
  } catch {
    return null; // vanished between listing and read — the next sync removes it
  }
  const meta = host.metadata.getMetadata(file.path);
  return {
    path: file.path,
    title: file.basename,
    body: text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text,
    tags: meta?.tags?.map((t) => t.tag) ?? [],
    links: meta?.links?.map((l) => l.target) ?? [],
    mtime: file.mtime ?? 0,
    size: file.size ?? text.length,
  };
}

async function indexOne(host: IndexHost, file: FileNode): Promise<void> {
  const note = await toIndexedNote(host, file);
  if (note !== null) await indexUpsert(note);
}

/**
 * Reconcile the index with the vault: drop rows for vanished files, then upsert
 * new/changed ones in chunks. Returns the number of notes written.
 */
export async function syncSearchIndex(host: IndexHost): Promise<number> {
  const files = indexable(host.vault.getFiles());
  const known = new Map((await indexKnown()).map((k) => [k.path, k]));

  const present = new Set(files.map((f) => f.path));
  const vanished = [...known.keys()].filter((path) => !present.has(path));
  if (vanished.length > 0) await indexRemove(vanished);

  let written = 0;
  let sinceYield = 0;
  for (const file of files) {
    const prev = known.get(file.path);
    // 1s slack: FAT/exFAT timestamps are coarse, and a false "unchanged" only
    // costs a stale excerpt, while a false "changed" costs a full re-parse.
    if (
      prev !== undefined &&
      file.mtime !== undefined &&
      Math.abs(prev.mtime - file.mtime) < 1000 &&
      (file.size === undefined || prev.size === file.size)
    ) {
      continue;
    }
    await indexOne(host, file);
    written += 1;
    if (++sinceYield >= BACKFILL_CHUNK) {
      sinceYield = 0;
      await yieldToUi();
    }
  }
  return written;
}

/** Index-backed search. Returns null when no index is open (caller falls back). */
export async function searchIndexed(
  query: string,
  limit = 50,
): Promise<IndexSearchHit[] | null> {
  if (activeVault === null) return null;
  return indexSearch(query, limit);
}

async function openFor(host: IndexHost): Promise<boolean> {
  const vaultPath = host.vault.getVaultPath();
  if (vaultPath === null) return false;
  const stats = await indexOpen(vaultPath);
  if (stats === null) return false;
  activeVault = vaultPath;
  return true;
}

/**
 * Wire the index to a vault. Safe to call more than once: the first call owns
 * the subscriptions, later calls only re-open for the current vault.
 */
export function startSearchIndex(host: IndexHost): void {
  if (started) return;
  started = true;

  // Subscribe first: the app mounts before a vault is open, so the initial
  // open() below is allowed to fail — `vault:changed` retries it.
  host.events.on("file:modified", ({ path }) => void reindexPath(host, path));
  host.events.on("file:created", ({ path }) => void reindexPath(host, path));
  host.events.on("file:deleted", ({ path }) => {
    // A deleted folder arrives as one path; both calls are cheap and idempotent.
    void indexRemove([path]);
    void indexRemovePrefix(path);
  });
  host.events.on("file:renamed", ({ oldPath, newPath }) => {
    void indexRename(oldPath, newPath);
    void indexRenamePrefix(oldPath, newPath);
  });
  host.events.on("vault:changed", ({ reason }) => {
    if (reason !== "load") return;
    void (async () => {
      await indexClose();
      activeVault = null;
      if (!(await openFor(host))) return;
      await syncSearchIndex(host);
    })();
  });

  // Backfill after the first frame, so opening a vault paints before touching
  // disk. A warm start skips every unchanged note and finishes almost instantly.
  void (async () => {
    await yieldToUi();
    if (await openFor(host)) await syncSearchIndex(host);
  })();
}

async function reindexPath(host: IndexHost, path: string): Promise<void> {
  const file = host.vault.getFiles().find((f) => f.path === path);
  if (file === undefined) {
    await indexRemove([path]);
    return;
  }
  if (!INDEXABLE.has(file.extension)) return;
  await indexOne(host, file);
}
