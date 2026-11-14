/**
 * One-shot handshake for "open Settings on section X".
 *
 * Lives in core (not in the settings feature) because callers are other
 * features: feature→feature imports are a layering violation, while both may
 * depend on core. Module-level state on purpose — the caller fires before the
 * modal component exists, and the modal remounts on every open.
 *
 * peek/clear are separate so a React StrictMode double-invoked state
 * initializer cannot consume the request twice.
 */
let pendingSection: string | null = null;

export function requestSettingsSection(id: string): void {
  pendingSection = id;
}

export function peekSettingsSection(): string | null {
  return pendingSection;
}

export function clearSettingsSection(): void {
  pendingSection = null;
}
