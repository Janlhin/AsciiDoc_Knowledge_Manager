/**
 * API-key storage. Desktop: OS credential store via the Rust `secret_*`
 * commands (Windows Credential Manager / macOS Keychain). Browser dev server:
 * localStorage, clearly a degraded fallback — never used in a packaged build.
 *
 * The credential store cannot be enumerated portably, so the *names* of the
 * secrets we created are indexed locally. Values are never indexed.
 */
import { isTauri } from "../vault";

const BROWSER_PREFIX = "adkm.llm.secret.";
const INDEX_KEY = "adkm.llm.secretIndex";

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function writeIndex(names: string[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(names));
  } catch {
    /* ignore */
  }
}

/** Names of secrets this app has stored (for Settings → Keychain). */
export function listSecretNames(): string[] {
  return readIndex();
}

function rememberName(name: string): void {
  const names = readIndex();
  if (!names.includes(name)) writeIndex([...names, name].sort());
}

function forgetName(name: string): void {
  writeIndex(readIndex().filter((n) => n !== name));
}

/** True when keys are persisted in the OS credential store (desktop only). */
export function usesOsCredentialStore(): boolean {
  return isTauri();
}

export async function secretSet(name: string, value: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("secret_set", { name, value });
    rememberName(name);
    return;
  }
  localStorage.setItem(BROWSER_PREFIX + name, value);
  rememberName(name);
}

/** Returns null when no value is stored (not an error). */
export async function secretGet(name: string): Promise<string | null> {
  if (name === "") return null;
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string | null>("secret_get", { name });
  }
  return localStorage.getItem(BROWSER_PREFIX + name);
}

export async function secretDelete(name: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("secret_delete", { name });
    forgetName(name);
    return;
  }
  localStorage.removeItem(BROWSER_PREFIX + name);
  forgetName(name);
}

/** Whether a value exists for `name` (does not return the value itself). */
export async function secretExists(name: string): Promise<boolean> {
  if (name === "") return false;
  try {
    return (await secretGet(name)) !== null;
  } catch {
    return false;
  }
}
