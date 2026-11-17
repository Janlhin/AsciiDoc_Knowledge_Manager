/**
 * Q-007 / D-034 — heavy-content loading policy.
 *
 * Session restore used to treat PDF specially: files over 32 MB were gated,
 * everything else mounted immediately. The user chose auto-loading as the
 * DEFAULT and asked for a setting, so this module makes the policy explicit:
 *
 *   - "auto": every preview mounts as before; there is no PDF size gate. This
 *     matches the user's real vault (14 scanned PDFs, mostly 20-144 MB).
 *   - "onDemand": PDF/EPUB/Office/CBZ and other structured previews show a
 *     placeholder with an explicit Load button. Cheap media (image/audio/video)
 *     still mounts — gating a small image would be pointless.
 *
 * The setting is machine-local, like startupMode: it must not be written into
 * the user's vault. Tolerant parsing keeps a missing/corrupt value on
 * "onDemand" — the user's Q-007 choice: restored heavy tabs must not trigger
 * disk reads or large allocations until the reader clicks Load.
 */
import { Store } from "./store";

export type HeavyLoadMode = "auto" | "onDemand";

const STORAGE_KEY = "adkm.heavyLoadMode";

export function normalizeHeavyLoadMode(raw: unknown): HeavyLoadMode {
  return raw === "auto" ? "auto" : "onDemand";
}

function readInitial(): HeavyLoadMode {
  try {
    return normalizeHeavyLoadMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "onDemand";
  }
}

export const heavyLoadMode = new Store<HeavyLoadMode>(readInitial());

export function setHeavyLoadMode(mode: HeavyLoadMode): void {
  heavyLoadMode.set(mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage blocked — the choice still applies to this session */
  }
}
