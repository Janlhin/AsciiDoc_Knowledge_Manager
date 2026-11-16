/** ADKM Web · HTTP 服务（零框架，node:http） */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { readGitStatus } from "./git.ts";
import { readSource, renderDocument } from "./render.ts";
import { Workspace } from "./workspace.ts";
import type { EdgeRef, RenderResult } from "../shared/types.ts";

const ROOT = resolve(process.argv[2] ?? "C:/Users/me/Desktop/Blueprint");
const PORT = Number(process.env.PORT ?? 8787);
const DIST = join(import.meta.dirname, "..", "web", "dist");

const ws = new Workspace(ROOT);

// ---------- 工具 ----------
function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function text(res: ServerResponse, body: string, status = 200, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

/** 把 URL 路径转为工作区内的相对 id，拒绝越界 */
function toDocId(pathname: string, prefix: string): string | null {
  const raw = decodeURIComponent(pathname.slice(prefix.length));
  if (!raw) return null;
  const cleaned = normalize(raw.replace(/^\/+/, "")).split(sep).join("/");
  if (cleaned.startsWith("..") || cleaned.includes("\0")) return null;
  return cleaned;
}

function edgeRefs(id: string): { outgoing: EdgeRef[]; incoming: EdgeRef[] } {
  const { outgoing, incoming } = ws.neighbors(id);
  const map = (e: { target: string; source: string; kind: string; status: string; line: number; reftext: string }, out: boolean): EdgeRef => {
    const other = out ? e.target : e.source;
    const node = ws.node(other);
    return {
      other,
      otherTitle: node?.title ?? other.replace(/^\?/, ""),
      kind: e.kind as EdgeRef["kind"],
      status: e.status as EdgeRef["status"],
      line: e.line,
      reftext: e.reftext,
    };
  };
  return {
    outgoing: outgoing.map((e) => map(e, true)),
    incoming: incoming.map((e) => map(e, false)),
  };
}

// ---------- 路由 ----------
async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;

  if (p === "/api/info") {
    const g = ws.data;
    json(res, {
      root: ws.root,
      docCount: g ? g.nodes.filter((n) => n.format !== "asset").length : 0,
      assetCount: g ? g.nodes.filter((n) => n.format === "asset").length : 0,
      edgeCount: g ? g.edges.length : 0,
      git: await readGitStatus(ws.root),
    });
    return true;
  }

  if (p === "/api/tree") {
    json(res, ws.tree());
    return true;
  }

  if (p === "/api/graph") {
    const g = ws.data;
    if (!g) {
      json(res, { error: "尚未索引" }, 503);
      return true;
    }
    json(res, g);
    return true;
  }

  if (p === "/api/git") {
    json(res, await readGitStatus(ws.root));
    return true;
  }

  if (p === "/api/reindex" && req.method === "POST") {
    const g = await ws.index();
    console.log(`重新索引：${g.nodes.length} 节点 / ${g.edges.length} 边 / ${g.elapsedMs.toFixed(0)}ms`);
    json(res, { ok: true, nodes: g.nodes.length, edges: g.edges.length, elapsedMs: Math.round(g.elapsedMs) });
    return true;
  }

  if (p.startsWith("/api/doc/")) {
    const id = toDocId(p, "/api/doc/");
    if (!id) return json(res, { error: "非法路径" }, 400), true;
    const node = ws.node(id);
    if (!node) return json(res, { error: "文档不在索引中" }, 404), true;
    try {
      const html = await renderDocument(ws, id);
      const refs = edgeRefs(id);
      const result: RenderResult = {
        id,
        title: node.title,
        format: node.format,
        html,
        headingsSummary: node.headings,
        outgoing: refs.outgoing,
        incoming: refs.incoming,
      };
      json(res, result);
    } catch (e) {
      json(res, { error: e instanceof Error ? e.message : "渲染失败" }, 500);
    }
    return true;
  }

  if (p.startsWith("/api/raw/")) {
    const id = toDocId(p, "/api/raw/");
    if (!id) return json(res, { error: "非法路径" }, 400), true;
    try {
      text(res, readSource(ws, id));
    } catch {
      json(res, { error: "读取失败" }, 404);
    }
    return true;
  }

  if (p === "/api/resolve") {
    const from = url.searchParams.get("from") ?? "";
    const target = url.searchParams.get("target") ?? "";
    const hit = ws.data?.edges.find((e) => e.source === from && (e.target.endsWith(target) || e.reftext === target));
    json(res, { id: hit && hit.status === "resolved" ? hit.target : null });
    return true;
  }

  if (p.startsWith("/api/asset/")) {
    const id = toDocId(p, "/api/asset/");
    if (!id) return json(res, { error: "非法路径" }, 400), true;
    const abs = join(ws.root, id);
    if (!abs.startsWith(ws.root) || !existsSync(abs) || !statSync(abs).isFile()) {
      return json(res, { error: "不存在" }, 404), true;
    }
    res.writeHead(200, { "content-type": MIME[extname(abs).toLowerCase()] ?? "application/octet-stream" });
    res.end(readFileSync(abs));
    return true;
  }

  return false;
}

function serveStatic(res: ServerResponse, pathname: string): void {
  if (!existsSync(DIST)) {
    text(res, "前端尚未构建。请运行：npm run build:web", 503);
    return;
  }
  const rel = pathname === "/" ? "/index.html" : pathname;
  const abs = join(DIST, normalize(rel));
  if (!abs.startsWith(DIST) || !existsSync(abs) || !statSync(abs).isFile()) {
    // SPA 回退
    const index = join(DIST, "index.html");
    if (existsSync(index)) {
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(readFileSync(index));
    } else {
      text(res, "未找到", 404);
    }
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(abs).toLowerCase()] ?? "application/octet-stream" });
  res.end(readFileSync(abs));
}

// ---------- 启动 ----------
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  handleApi(req, res, url)
    .then((handled) => {
      if (!handled) serveStatic(res, url.pathname);
    })
    .catch((e) => {
      console.error(e);
      if (!res.headersSent) json(res, { error: "服务器内部错误" }, 500);
    });
});

console.log(`工作区：${ROOT}`);
console.log("正在索引…");
const g = await ws.index();
console.log(`索引完成：${g.nodes.length} 节点 / ${g.edges.length} 边 / ${g.elapsedMs.toFixed(0)} ms`);
console.log(`  有效 ${g.stats.resolved} · 断链 ${g.stats.broken} · 未解析 ${g.stats.unresolved}`);
console.log(`  已连接 ${g.stats.connected} · 孤立 ${g.stats.orphaned}`);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\nADKM 已启动：http://127.0.0.1:${PORT}`);
});
