/**
 * R49 File recovery snapshots — periodic content snapshots of text documents,
 * browsable + restorable (Obsidian "File recovery"). The #⑪ companion to R42's
 * trash (delete recovery): this is EDIT recovery.
 *
 * Storage: one JSON per file under `<vault>/.obsidian/snapshots/<encoded-path>.json`
 * = `{ path, snapshots: [{ts, content}, …] }`, written via vault.adapter.writeConfig
 * (creates parent dirs, NO tree-refresh / file:created churn — same quiet path as
 * bookmarks/workspaces). Pruned to the last MAX_PER_FILE in-array (no delete API
 * needed). Serialized RMW (bookmarks precedent, incl. its guarded warn).
 *
 * Coverage (T-056): every file the editor opens as TEXT — `.md` plus AsciiDoc,
 * plain text, source and config (`isEditableTextPath`, one source of truth with the
 * attachment router). Binaries and unknown extensions are never snapshotted, since
 * `vault.read` would yield replacement-char garbage.
 *
 * Size guard: automatic (throttled) captures skip content above MAX_CONTENT_CHARS,
 * so a large log/CSV cannot be amplified into 25 copies. A FORCED capture (restore's
 * pre-overwrite snapshot) intentionally ignores the cap: it is user-initiated, runs
 * once, and must never lose the bytes it is about to overwrite.
 *
 * Data safety: append-only history; the WRITE path STRICT-parses the existing file
 * and refuses to overwrite a malformed/truncated one (bookmarks/workspaces parity —
 * never erase recovery history); restore FLUSHES the dirty editor then snapshots the
 * current content (forced) BEFORE overwriting — never lose unsaved edits or the
 * pre-restore state.
 */
import type { DocumentManager } from "./documents";
import type { EventBus } from "./events";
import { isEditableTextPath } from "./attachments";
import { Store } from "./store";
import type { Vault } from "./vault";

const SNAP_DIR = "snapshots";
const MAX_PER_FILE = 25;
const MIN_INTERVAL_MS = 60_000; // throttle: >= 1 min between snapshots of the same file
/** Automatic captures above this length are skipped (T-056). See the header note. */
const MAX_CONTENT_CHARS = 512 * 1024;

export interface Snapshot {
  ts: number;
  content: string;
}

/** Bumped on every snapshot write so a recovery UI re-renders. */
export const snapshotsRevision = new Store<number>(0);

/** `.obsidian/`-relative key. encodeURIComponent neutralizes "/" (→ %2F) so the
 *  whole note path becomes ONE filename segment — no traversal, no collision. */
function keyFor(path: string): string {
  return `${SNAP_DIR}/${encodeURIComponent(path)}.json`;
}

const lastSnapTs = new Map<string, number>(); // path → last SUCCESSFUL snapshot ts (throttle window)
/** Paths already known to exceed MAX_CONTENT_CHARS — avoids re-reading them on every save. */
const tooLarge = new Set<string>();
function skipTooLarge(path: string, length: number): void {
  if (tooLarge.has(path)) return;
  tooLarge.add(path);
  console.warn(`[snapshots] "${path}" is ${length} chars (> ${MAX_CONTENT_CHARS}) — skipped automatic snapshots`);
}
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  // guarded so a failed readConfig/writeConfig leaves a diagnostic (bookmarks/
  // workspaces parity — else snapshot loss is silent). The chain never breaks.
  const guarded = async (): Promise<T> => {
    try {
      return await task();
    } catch (err) {
      console.warn(`[snapshots] ${SNAP_DIR} operation failed`, err);
      throw err;
    }
  };
  const run = queue.then(guarded, guarded);
  queue = run.catch(() => {});
  return run as Promise<T>;
}

function isValidSnapshot(s: unknown): s is Snapshot {
  return !!s && typeof (s as Snapshot).ts === "number" && typeof (s as Snapshot).content === "string";
}

/** Only files the editor opens as TEXT; never config / dot-prefixed paths (incl. the
 *  snapshot store itself, though config writes don't emit file:modified anyway). */
export function isSnapshotable(path: string): boolean {
  return isEditableTextPath(path) && !path.split("/").some((s) => s.startsWith("."));
}

/** LENIENT read for display/restore-list: a malformed file → empty (never crash). */
async function readList(vault: Vault, path: string): Promise<Snapshot[]> {
  try {
    const raw = await vault.adapter.readConfig(keyFor(path));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    const arr = (parsed as { snapshots?: unknown })?.snapshots;
    if (Array.isArray(arr)) return arr.filter(isValidSnapshot);
  } catch {
    /* malformed — treat as empty rather than crash (read-only path only) */
  }
  return [];
}

/**
 * Append a snapshot of `content` for `path`. Throttled (>= MIN_INTERVAL_MS apart
 * unless `force`), deduped (skip if identical to the latest), pruned to MAX_PER_FILE.
 * The throttle window (lastSnapTs) advances only on a SUCCESSFUL write/dedup, so a
 * failed write is retried on the next save (R49 review).
 */
export function recordSnapshot(
  vault: Vault,
  path: string,
  content: string,
  now: number,
  force = false,
): Promise<void> {
  if (!isSnapshotable(path)) return Promise.resolve();
  // Size guard on AUTOMATIC captures only — `force` (restore's pre-overwrite capture)
  // must always run, otherwise a restore could overwrite bytes it never backed up.
  if (!force && content.length > MAX_CONTENT_CHARS) {
    skipTooLarge(path, content.length);
    return Promise.resolve();
  }
  if (!force) {
    const last = lastSnapTs.get(path);
    if (last !== undefined && now - last < MIN_INTERVAL_MS) return Promise.resolve();
  }
  return enqueue(async () => {
    // STRICT read on the WRITE path: a malformed/truncated file THROWS here → the
    // write below is skipped, preserving the on-disk bytes (R49 review; refuse to
    // overwrite, bookmarks/workspaces parity). readList (above) stays lenient.
    const raw = await vault.adapter.readConfig(keyFor(path));
    let list: Snapshot[] = [];
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw); // throws on malformed → abort (chain logs)
      const arr = (parsed as { snapshots?: unknown })?.snapshots;
      if (!Array.isArray(arr)) throw new Error(`${keyFor(path)} malformed — refusing to overwrite`);
      list = arr.filter(isValidSnapshot);
    }
    // dedup: identical to the latest → nothing to add, but the content IS captured
    if (list.length > 0 && list[list.length - 1].content === content) {
      lastSnapTs.set(path, now);
      return;
    }
    list.push({ ts: now, content });
    while (list.length > MAX_PER_FILE) list.shift(); // prune oldest
    await vault.adapter.writeConfig(keyFor(path), JSON.stringify({ path, snapshots: list }));
    lastSnapTs.set(path, now); // advance throttle ONLY after a successful write (failure → retry-able)
    snapshotsRevision.set(snapshotsRevision.get() + 1);
  });
}

/** All snapshots for `path`, oldest → newest. Lenient (malformed → empty). */
export function listSnapshots(vault: Vault, path: string): Promise<Snapshot[]> {
  return enqueue(() => readList(vault, path));
}

/**
 * Restore the snapshot taken at `ts` for `path`. FLUSHES the (possibly dirty)
 * active editor first so the current content snapshotted below is the user's latest
 * unsaved edits AND the editor reloads the restored bytes instead of clobbering them
 * with a stale buffer (R49 review; R47 flush-before-overwrite parity). Then snapshots
 * the current content (forced) and overwrites. Returns false (no-op) if gone.
 */
export async function restoreSnapshot(
  vault: Vault,
  documents: DocumentManager,
  path: string,
  ts: number,
  now: number,
): Promise<boolean> {
  const list = await listSnapshots(vault, path);
  const snap = list.find((s) => s.ts === ts);
  if (!snap || !vault.fileExists(path)) return false;
  await documents.flushAll();
  const current = await vault.read(path);
  await recordSnapshot(vault, path, current, now, true); // never lose what's there now
  await vault.modify(path, snap.content);
  return true;
}

/** Hook saves → snapshot. Subscribe once at startup; returns a disposer. Clears the
 *  throttle + oversize maps on a vault switch so a stale entry can't suppress the new
 *  vault's first snapshot (R49 review; T-056 added the oversize map). */
export function initSnapshots(vault: Vault, events: EventBus): () => void {
  lastSnapTs.clear();
  tooLarge.clear();
  const offModified = events.on("file:modified", ({ path }) => {
    if (!isSnapshotable(path) || tooLarge.has(path)) return;
    void vault
      .read(path)
      .then((content) => {
        // check before the throttled write so an oversized file is read at most once
        if (content.length > MAX_CONTENT_CHARS) {
          skipTooLarge(path, content.length);
          return;
        }
        return recordSnapshot(vault, path, content, Date.now());
      })
      .catch(() => {});
  });
  const offVault = events.on("vault:changed", ({ reason }) => {
    if (reason === "load") {
      lastSnapTs.clear();
      tooLarge.clear();
    }
  });
  return () => {
    offModified();
    offVault();
  };
}
