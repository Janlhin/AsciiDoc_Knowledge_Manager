/**
 * T-047 E2E fixture: a local OpenAI-compatible SSE endpoint.
 *
 * The proofreading path must be verifiable without an API key and without
 * sending anything off the machine. This server answers `/chat/completions`
 * with a scripted reply — a prose verdict plus one fenced JSON block, exactly
 * what the prompt asks a real model for — and records every request body so a
 * test can assert the T-046 rule set actually made it into the prompt.
 *
 *   const llm = await startMockLlm();
 *   // … configure a provider with baseUrl = llm.baseUrl …
 *   llm.requests.at(-1).body;
 *   await llm.close();
 */
import http from "node:http";

/** Two locatable findings + one line past the end of the E2E note (must be dropped). */
export const MOCK_REPLY = [
  "总评：标点与术语各有一处需要收尾，其余符合规范。",
  "",
  "```json",
  JSON.stringify({
    summary: "标点与术语各一处",
    issues: [
      {
        // Line 5 is the `## 第 1 节` heading in the fixture note: the reading
        // view only flashes a reveal for heading anchors, so jumping to this
        // one is observable on both surfaces (CM line flash / preview flash).
        line: 5,
        category: "terminology",
        severity: "warning",
        message: "术语写法不规范",
        suggestion: "统一为词表中的规范写法",
      },
      {
        line: 3,
        category: "punctuation",
        severity: "warning",
        message: "中文语境使用了半角标点",
        suggestion: "改为全角标点",
      },
      {
        line: 999,
        category: "structure",
        severity: "info",
        message: "这一行根本不存在，解析器应丢弃",
      },
    ],
  }),
  "```",
].join("\n");

function sseFrames(text) {
  const frames = [];
  const CHUNK = 24;
  for (let i = 0; i < text.length; i += CHUNK) {
    frames.push(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + CHUNK) } }] })}\n\n`);
  }
  frames.push("data: [DONE]\n\n");
  return frames;
}

export async function startMockLlm(options = {}) {
  const reply = options.reply ?? MOCK_REPLY;
  const requests = [];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ url: req.url ?? "", body });
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        });
        res.end();
        return;
      }
      if (!(req.url ?? "").endsWith("/chat/completions")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "mock: unknown path" } }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      for (const frame of sseFrames(reply)) res.write(frame);
      res.end();
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
