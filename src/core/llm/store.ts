/**
 * Persisted LLM provider list + active selection.
 *
 * Persistence is localStorage on purpose: this is *configuration* (URLs, model
 * names, temperatures). API keys are never written here — they go to the OS
 * credential store via ./secrets.ts and are referenced by `secretName`.
 * Mirrors the existing settings pattern (`core/appearance.ts`: Store + readX /
 * persistX helpers) so every consumer subscribes the same way.
 */
import { Store } from "../store";
import { isLlmProvider, type LlmProvider } from "./types";

const PROVIDERS_KEY = "adkm.llm.providers";
const ACTIVE_KEY = "adkm.llm.active";

function readProviders(): LlmProvider[] {
  try {
    const raw = localStorage.getItem(PROVIDERS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLlmProvider);
  } catch {
    return [];
  }
}

function readActiveId(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? "";
  } catch {
    return "";
  }
}

export const llmProviders = new Store<LlmProvider[]>(readProviders());
export const activeLlmProviderId = new Store<string>(readActiveId());

function persistProviders(next: LlmProvider[]): void {
  llmProviders.set(next);
  try {
    localStorage.setItem(PROVIDERS_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — the in-memory store still works this session */
  }
}

function persistActive(id: string): void {
  activeLlmProviderId.set(id);
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}

/** New id that never collides with an existing provider. */
export function uniqueProviderId(base: string, existing: ReadonlyArray<LlmProvider>): string {
  const taken = new Set(existing.map((p) => p.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function addProvider(provider: LlmProvider): void {
  const next = [...llmProviders.get(), provider];
  persistProviders(next);
  if (!activeLlmProviderId.get()) persistActive(provider.id);
}

export function updateProvider(provider: LlmProvider): void {
  persistProviders(llmProviders.get().map((p) => (p.id === provider.id ? provider : p)));
}

export function removeProvider(id: string): void {
  const next = llmProviders.get().filter((p) => p.id !== id);
  persistProviders(next);
  if (activeLlmProviderId.get() === id) persistActive(next[0]?.id ?? "");
}

export function setActiveLlmProvider(id: string): void {
  persistActive(id);
}

/** The provider the panel should use right now (active, else first). */
export function resolveActiveProvider(
  providers: ReadonlyArray<LlmProvider>,
  activeId: string,
): LlmProvider | null {
  return providers.find((p) => p.id === activeId) ?? providers[0] ?? null;
}

/** True when the provider is configured enough to send a request. */
export function isProviderUsable(provider: LlmProvider): boolean {
  return provider.baseUrl.trim() !== "" && provider.model.trim() !== "";
}
