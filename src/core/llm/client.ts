/**
 * OpenAI-compatible chat client with streaming.
 *
 * Two transports behind one API:
 *  - Desktop (Tauri): Rust `llm_stream` reads SSE off the UI thread and pushes
 *    `llm:chunk` / `llm:done` / `llm:error` events. No CORS, no 30s cap.
 *  - Browser dev: fetch + ReadableStream, CORS-bound (dev convenience only).
 *
 * The provider-specific JSON parsing lives here (not in Rust) so adding a
 * protocol later does not touch the transport layer.
 */
import { base64ToBytes, httpRequest } from "../net";
import { isTauri } from "../vault";
import { extractOpenAiDelta, extractProviderError } from "./sse";
import { secretGet } from "./secrets";
import type { ChatMessage, LlmProvider } from "./types";

export interface StreamChatOptions {
  provider: LlmProvider;
  messages: ChatMessage[];
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
}

/** Append `/chat/completions` unless the user already pasted a full endpoint. */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed === "") throw new Error("Base URL 为空");
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

async function buildRequest(
  provider: LlmProvider,
  messages: ChatMessage[],
  stream: boolean,
): Promise<{ url: string; headers: Record<string, string>; body: string }> {
  const url = chatCompletionsUrl(provider.baseUrl);
  const key = provider.secretName === "" ? null : await secretGet(provider.secretName);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: stream ? "text/event-stream" : "application/json",
  };
  if (key !== null && key !== "") headers.Authorization = `Bearer ${key}`;
  const payload: Record<string, unknown> = {
    model: provider.model,
    messages,
    stream,
  };
  if (provider.temperature > 0) payload.temperature = provider.temperature;
  if (provider.maxTokens !== undefined && provider.maxTokens > 0) {
    payload.max_tokens = provider.maxTokens;
  }
  return { url, headers, body: JSON.stringify(payload) };
}

export async function streamChat(options: StreamChatOptions): Promise<void> {
  const { provider, messages, onDelta, signal } = options;
  if (provider.model.trim() === "") throw new Error("未配置模型名称");
  if (signal?.aborted === true) return;
  const request = await buildRequest(provider, messages, true);
  if (isTauri()) {
    await streamViaTauri(request, onDelta, signal);
    return;
  }
  await streamViaFetch(request, onDelta, signal);
}

interface StreamRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function newRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid === "string") return uuid;
  return `llm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function streamViaTauri(
  request: StreamRequest,
  onDelta: (delta: string) => void,
  signal: AbortSignal | undefined,
): Promise<void> {
  const [{ invoke }, { listen }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  const requestId = newRequestId();
  let settled = false;
  let resolveDone: () => void = () => {};
  let rejectDone: (error: Error) => void = () => {};
  const finished = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const settle = (action: () => void) => {
    if (settled) return;
    settled = true;
    action();
  };

  const unlisteners: Array<() => void> = [];
  unlisteners.push(
    await listen<{ requestId: string; data: string }>("llm:chunk", (event) => {
      if (event.payload.requestId !== requestId) return;
      const delta = extractOpenAiDelta(event.payload.data);
      if (delta !== null) onDelta(delta);
    }),
  );
  unlisteners.push(
    await listen<{ requestId: string }>("llm:done", (event) => {
      if (event.payload.requestId !== requestId) return;
      settle(resolveDone);
    }),
  );
  unlisteners.push(
    await listen<{ requestId: string; message: string }>("llm:error", (event) => {
      if (event.payload.requestId !== requestId) return;
      const message = event.payload.message;
      settle(() => rejectDone(new Error(message)));
    }),
  );

  const cleanup = () => {
    for (const unlisten of unlisteners) unlisten();
  };
  const onAbort = () => {
    void invoke("llm_cancel", { requestId }).catch(() => {});
    settle(resolveDone);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await invoke("llm_stream", {
      req: {
        requestId,
        url: request.url,
        headers: request.headers,
        bodyText: request.body,
      },
    });
    await finished;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    cleanup();
  }
}

async function streamViaFetch(
  request: StreamRequest,
  onDelta: (delta: string) => void,
  signal: AbortSignal | undefined,
): Promise<void> {
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    signal,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${extractProviderError(text) ?? ""}`);
  }
  if (response.body === null) throw new Error("当前环境不支持流式响应");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice("data:".length).trim();
      if (data === "[DONE]") return;
      const delta = extractOpenAiDelta(data);
      if (delta !== null) onDelta(delta);
    }
  }
}

export interface TestResult {
  /** Whatever text the model returned; "OK" when empty. */
  reply: string;
}

/**
 * Non-streaming round-trip used by Settings → AI → 测试连接. Reuses the
 * existing CORS-free `http_request` transport (30s, 10 MB) — a connection test
 * has no reason to stream, and this keeps the failure surface small.
 */
export async function testProvider(provider: LlmProvider): Promise<TestResult> {
  if (provider.model.trim() === "") throw new Error("未配置模型名称");
  const request = await buildRequest(
    provider,
    [{ role: "user", content: "Reply with the single word: OK" }],
    false,
  );
  const response = await httpRequest({
    url: request.url,
    method: "POST",
    headers: request.headers,
    contentType: "application/json",
    bodyText: request.body,
  });
  const text = new TextDecoder().decode(base64ToBytes(response.bodyBase64));
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}: ${extractProviderError(text) ?? text.slice(0, 300)}`);
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      const choices = (parsed as { choices?: unknown }).choices;
      if (Array.isArray(choices) && choices.length > 0) {
        const message = (choices[0] as { message?: { content?: unknown } }).message;
        const content = message?.content;
        if (typeof content === "string" && content.trim() !== "") {
          return { reply: content.trim().slice(0, 200) };
        }
      }
    }
  } catch {
    /* fall through */
  }
  return { reply: "OK" };
}
