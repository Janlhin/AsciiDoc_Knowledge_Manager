/**
 * T-058 / D-027 — startup behavior: replay the previous session's tabs, or open
 * a fresh window.
 *
 * Before this setting the app always replayed: `Workspace` persisted its pane
 * tree and tabs per vault in localStorage (T-035) and restored them in the
 * constructor. Browsers expose the same choice as "继续浏览上次打开的网页 /
 * 打开新标签页"; this module puts it behind a real setting.
 *
 * Semantics of "fresh" (deliberately asymmetric, see D-027):
 *   - boot: the persisted layout is IGNORED — no tabs come back;
 *   - the persisted snapshot is NOT overwritten either, so switching back to
 *     "restore" still brings back the last restored session rather than an
 *     empty one;
 *   - consequence (documented in the settings copy): tab changes made while in
 *     "fresh" mode are not remembered.
 */
import { Store } from "./store";

export type StartupMode = "restore" | "fresh";

const STORAGE_KEY = "adkm.startupMode";

/** Tolerant parse: anything unrecognised (or a corrupt/absent value) means the
 *  historical behaviour, "restore". */
export function normalizeStartupMode(raw: unknown): StartupMode {
  return raw === "fresh" ? "fresh" : "restore";
}

function readInitial(): StartupMode {
  try {
    return normalizeStartupMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "restore";
  }
}

export const startupMode = new Store<StartupMode>(readInitial());

export function setStartupMode(mode: StartupMode): void {
  startupMode.set(mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage unavailable — the choice still applies to this session */
  }
}

/** Boot gate consulted by `Workspace.restore()`. */
export function shouldRestoreSession(): boolean {
  return startupMode.get() === "restore";
}

/** Whether a state change may overwrite the persisted layout. */
export function shouldPersistSession(): boolean {
  return startupMode.get() === "restore";
}
