/**
 * LLM provider model (ADKM AI).
 *
 * Only one wire protocol is implemented in the first release: the
 * OpenAI-compatible `POST {baseUrl}/chat/completions` + SSE convention. That
 * single protocol covers hosted APIs (OpenAI, DeepSeek, Qwen/DashScope
 * compatible mode, Moonshot, OneAPI, vLLM…) and local servers (Ollama,
 * LM Studio, llama.cpp), so "local model support" is a preset, not a second
 * protocol.
 *
 * Secrets are NOT part of this type: `secretName` is a handle into the OS
 * credential store (see ./secrets.ts). The value never enters localStorage.
 */

export interface LlmProvider {
  /** Stable local id (also the keychain account suffix). */
  id: string;
  /** User-visible name in the panel + settings. */
  label: string;
  /** Base URL; `/chat/completions` is appended unless already present. */
  baseUrl: string;
  model: string;
  /** Credential-store entry name; empty for local servers that need no key. */
  secretName: string;
  /** 0–2, forwarded as `temperature`. */
  temperature: number;
  /** Optional `max_tokens`; undefined = provider default. */
  maxTokens?: number;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  /** Local servers accept any key; hosted APIs require one. */
  requiresKey: boolean;
}

/** Presets shown in Settings → AI. Users can edit every field afterwards. */
export const PROVIDER_PRESETS: ReadonlyArray<ProviderPreset> = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    requiresKey: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    requiresKey: true,
  },
  {
    id: "qwen",
    label: "通义千问（DashScope 兼容模式）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    requiresKey: true,
  },
  {
    id: "moonshot",
    label: "Moonshot / Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    requiresKey: true,
  },
  {
    id: "ollama",
    label: "Ollama（本地）",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
    requiresKey: false,
  },
  {
    id: "lmstudio",
    label: "LM Studio（本地）",
    baseUrl: "http://localhost:1234/v1",
    model: "local-model",
    requiresKey: false,
  },
  {
    id: "custom",
    label: "自定义（OpenAI 兼容）",
    baseUrl: "",
    model: "",
    requiresKey: true,
  },
];

/** Keychain account name for a provider's API key. */
export function defaultSecretName(providerId: string): string {
  return `llm:${providerId}`;
}

/** Build a provider from a preset (id deduplicated by the caller). */
export function providerFromPreset(preset: ProviderPreset, id: string): LlmProvider {
  return {
    id,
    label: preset.label,
    baseUrl: preset.baseUrl,
    model: preset.model,
    secretName: preset.requiresKey ? defaultSecretName(id) : "",
    temperature: 0.7,
  };
}

/** Runtime guard for values read back from localStorage. */
export function isLlmProvider(value: unknown): value is LlmProvider {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id !== "" &&
    typeof v.label === "string" &&
    typeof v.baseUrl === "string" &&
    typeof v.model === "string" &&
    typeof v.secretName === "string" &&
    typeof v.temperature === "number" &&
    (v.maxTokens === undefined || typeof v.maxTokens === "number")
  );
}
