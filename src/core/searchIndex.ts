/**
 * Thin client for the Rust persistent search index (T-039).
 *
 * The index is derived state: it can be deleted and rebuilt from the vault at
 * any moment. Every call here therefore fails soft — a missing command, a
 * browser dev session, or a corrupt database must degrade to "no index", never
 * break the editor. Callers check for `null` rather than catching.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./vault";

/** One note as the frontend understands it; Rust never re-parses Markdown. */
export interface IndexedNote {
  path: string;
  title: string;
  body: string;
  tags: string[];
  links: string[];
  /** ms epoch — used only to skip unchanged files during backfill */
  mtime: number;
  size: number;
}

export interface IndexSearchHit {
  path: string;
  title: string;
  /** body excerpt with `<mark>` around matches (render as text, or sanitise) */
  snippet: string;
  rank: number;
}

export interface IndexKnownNote {
  path: string;
  mtime: number;
  size: number;
}

export interface IndexStats {
  notes: number;
  links: number;
  tags: number;
  parseRulesVersion: number;
  dbPath: string;
}

let warned = false;

/** Log the first index failure only — a broken index must not flood the console. */
function warnOnce(command: string, error: unknown): void {
  if (warned) return;
  warned = true;
  console.warn(`[search-index] ${command} failed; continuing without the index`, error);
}

async function call<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  fallback: T,
): Promise<T> {
  if (!isTauri()) return fallback;
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    warnOnce(command, error);
    return fallback;
  }
}

/** Open (or create) the index for a vault. Returns null when unavailable. */
export function indexOpen(vaultPath: string): Promise<IndexStats | null> {
  return call<IndexStats | null>("index_open", { vaultPath }, null);
}

export function indexClose(): Promise<void> {
  return call<void>("index_close", undefined, undefined);
}

export function indexUpsert(note: IndexedNote): Promise<void> {
  return call<void>("index_upsert", { note }, undefined);
}

export function indexRemove(paths: string[]): Promise<void> {
  return call<void>("index_remove", { paths }, undefined);
}

export function indexRemovePrefix(prefix: string): Promise<number> {
  return call<number>("index_remove_prefix", { prefix }, 0);
}

export function indexRename(from: string, to: string): Promise<void> {
  return call<void>("index_rename", { from, to }, undefined);
}

export function indexRenamePrefix(from: string, to: string): Promise<number> {
  return call<number>("index_rename_prefix", { from, to }, 0);
}

export function indexSearch(query: string, limit = 50): Promise<IndexSearchHit[]> {
  return call<IndexSearchHit[]>("index_search", { query, limit }, []);
}

export function indexKnown(): Promise<IndexKnownNote[]> {
  return call<IndexKnownNote[]>("index_known", undefined, []);
}

export function indexClear(): Promise<void> {
  return call<void>("index_clear", undefined, undefined);
}
