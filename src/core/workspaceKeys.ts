/**
 * Storage keys for the persisted workspace layout.
 *
 * The layout used to live under one global key, so every vault shared a single
 * snapshot: opening vault B pruned vault A's tabs (their paths do not exist
 * there) and wrote the pruned result back — A's layout was already gone when it
 * was reopened. Obsidian sidesteps this by writing `.obsidian/workspace.json`
 * inside each vault; localStorage has no such natural partition, so the key has
 * to carry the vault identity explicitly — and be normalised first, otherwise
 * `C:\Vault` and `c:/vault/` would produce two snapshots for one vault.
 */

/** Pre-isolation key. Still holds "no vault open" state, and the one-time migration source. */
export const LEGACY_WORKSPACE_KEY = "geode.workspace.v1";

/** Prefix for per-vault keys: `geode.workspace.v2:<normalised vault path>`. */
export const WORKSPACE_KEY_PREFIX = "geode.workspace.v2:";

/**
 * Canonical form of a vault path: forward slashes, no trailing separator,
 * lowercased. Windows and macOS paths are case-insensitive, so `C:\Vault\` and
 * `c:/vault` must not produce two snapshots. A case-sensitive Linux path still
 * maps consistently onto itself, which is all a storage key needs.
 */
export function normalizeVaultPath(
  vaultPath: string | null | undefined,
): string | null {
  if (typeof vaultPath !== "string") return null;
  const trimmed = vaultPath
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/") // collapse repeats, so `C://Vault//` cannot fan out
    .replace(/\/+$/, "");
  if (trimmed === "") return null;
  return trimmed.toLowerCase();
}

/** The localStorage key holding the layout for `vaultPath` (legacy key when null). */
export function workspaceStateKey(
  vaultPath: string | null | undefined,
): string {
  const normalized = normalizeVaultPath(vaultPath);
  return normalized === null
    ? LEGACY_WORKSPACE_KEY
    : WORKSPACE_KEY_PREFIX + normalized;
}
