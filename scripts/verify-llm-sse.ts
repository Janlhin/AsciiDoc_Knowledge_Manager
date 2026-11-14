#!/usr/bin/env node
/**
 * Behaviour check for the LLM stream helpers (src/core/llm/sse.ts).
 *
 * These are pure functions, so they can be exercised without a browser, a
 * Tauri webview, or a live provider — the cheapest possible guard against the
 * two failure modes that matter: dropping a delta, or splitting a code fence
 * in a way that renders model output as executable HTML (it never does — the
 * UI renders text nodes only).
 *
 * Usage: node scripts/verify-llm-sse.ts
 * Exit code: 0 = all cases pass, 1 = at least one mismatch.
 */
import { capContext, extractOpenAiDelta, extractProviderError, splitCodeFences } from "../src/core/llm/sse.ts";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS  ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL  ${name}\n      expected ${e}\n      actual   ${a}`);
}

// ---- delta extraction ----
check(
  "string content",
  extractOpenAiDelta('{"choices":[{"delta":{"content":"你好"}}]}'),
  "你好",
);
check(
  "role-only delta is not text",
  extractOpenAiDelta('{"choices":[{"delta":{"role":"assistant"}}]}'),
  null,
);
check(
  "array content parts",
  extractOpenAiDelta(
    '{"choices":[{"delta":{"content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}}]}',
  ),
  "ab",
);
check(
  "usage-only tail",
  extractOpenAiDelta('{"choices":[],"usage":{"total_tokens":3}}'),
  null,
);
check("done sentinel", extractOpenAiDelta("[DONE]"), null);
check("malformed json", extractOpenAiDelta("{not json"), null);
check(
  "legacy completions text",
  extractOpenAiDelta('{"choices":[{"text":"legacy"}]}'),
  "legacy",
);

// ---- provider error extraction ----
check(
  "nested error message",
  extractProviderError('{"error":{"message":"invalid api key","type":"auth"}}'),
  "invalid api key",
);
check("plain text error", extractProviderError("  gateway timeout  "), "gateway timeout");
check("empty error body", extractProviderError("   "), null);

// ---- code fence splitting ----
check(
  "text / code / text",
  splitCodeFences("intro\n```ts\nconst x = 1;\n```\noutro"),
  [
    { kind: "text", content: "intro", lang: "" },
    { kind: "code", content: "const x = 1;", lang: "ts" },
    { kind: "text", content: "outro", lang: "" },
  ],
);
check(
  "unterminated fence stays code",
  splitCodeFences("a\n```\nlet y = 2;"),
  [
    { kind: "text", content: "a", lang: "" },
    { kind: "code", content: "let y = 2;", lang: "" },
  ],
);
check("no fences", splitCodeFences("just text"), [
  { kind: "text", content: "just text", lang: "" },
]);

// ---- context cap ----
const capped = capContext("abcdef", 3);
check("cap truncates head", capped, { text: "abc", truncated: true });
check("cap keeps short text", capContext("abc", 3), { text: "abc", truncated: false });

if (failures > 0) {
  console.error(`\n${failures} case(s) failed`);
  process.exit(1);
}
console.log("\nAll LLM helper cases passed.");
