/**
 * Pure helpers for the OpenAI-compatible SSE stream and for safe message
 * rendering. No DOM, no Tauri, no network — unit-testable in Node.
 */

/**
 * Incremental text carried by one `data:` frame.
 * Returns null for frames that carry no text (role-only deltas, usage tails,
 * keep-alives, malformed JSON).
 *
 * Shape handled: `{ choices: [{ delta: { content } }] }` where `content` is
 * either a string or an array of `{ type: "text", text }` parts (some
 * gateways normalise to the array form).
 */
export function extractOpenAiDelta(data: string): string | null {
  if (data === "" || data === "[DONE]") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { delta?: unknown; text?: unknown };
  // Legacy /completions frames put text at choices[0].text.
  if (typeof first.text === "string") return first.text;
  const delta = first.delta;
  if (typeof delta !== "object" || delta === null) return null;
  const content = (delta as { content?: unknown }).content;
  if (typeof content === "string") return content === "" ? null : content;
  if (Array.isArray(content)) {
    let out = "";
    for (const part of content) {
      if (typeof part === "object" && part !== null) {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") out += text;
      }
    }
    return out === "" ? null : out;
  }
  return null;
}

/** Human-readable message from a provider error body, if one is present. */
export function extractProviderError(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed === "") return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null) {
      const error = (parsed as { error?: unknown }).error;
      if (typeof error === "string") return error;
      if (typeof error === "object" && error !== null) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === "string") return message;
      }
      const message = (parsed as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  } catch {
    /* not JSON — fall through to the raw text */
  }
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
}

export interface TextSegment {
  kind: "text" | "code";
  content: string;
  /** Fence info string (e.g. "ts"), empty for text segments. */
  lang: string;
}

/**
 * Split model output into text and fenced-code segments so the UI can render
 * code in a <pre> without ever injecting HTML. Deliberately tiny: ``` fences
 * only (tilde fences and nested fences degrade to text, which is safe).
 */
export function splitCodeFences(text: string): TextSegment[] {
  const lines = text.split("\n");
  const out: TextSegment[] = [];
  let buffer: string[] = [];
  let inCode = false;
  let lang = "";

  const flushText = () => {
    if (buffer.length === 0) return;
    const content = buffer.join("\n");
    buffer = [];
    if (content.trim() !== "") out.push({ kind: "text", content, lang: "" });
  };

  for (const line of lines) {
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence !== null) {
      if (!inCode) {
        flushText();
        inCode = true;
        lang = fence[1].trim();
      } else {
        out.push({ kind: "code", content: buffer.join("\n"), lang });
        buffer = [];
        inCode = false;
        lang = "";
      }
      continue;
    }
    buffer.push(line);
  }
  if (inCode) out.push({ kind: "code", content: buffer.join("\n"), lang });
  else flushText();
  return out;
}

/** Truncate note context by characters, preserving the head (most relevant). */
export function capContext(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}
