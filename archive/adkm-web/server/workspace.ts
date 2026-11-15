/** 工作区索引：扫描、解析、缓存、查询 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { parseAsciiDoc } from "./parsers/asciidoc.ts";
import { parseMarkdown } from "./parsers/markdown.ts";
import type {
  DocFormat,
  GraphData,
  GraphEdge,
  GraphNode,
  GraphStats,
  RawLink,
  TreeNode,
} from "../shared/types.ts";

const SKIP_DIRS = new Set([".git", "node_modules", ".obsidian", "dist", "build", ".adkm"]);
const DOC_EXT = /\.(adoc|md)$/i;

export interface Neighbors {
  outgoing: GraphEdge[];
  incoming: GraphEdge[];
}

export class Workspace {
  readonly root: string;
  private graph: GraphData | null = null;
  private nodeById = new Map<string, GraphNode>();
  private outgoing = new Map<string, GraphEdge[]>();
  private incoming = new Map<string, GraphEdge[]>();

  constructor(root: string) {
    this.root = root;
  }

  get indexed(): boolean {
    return this.graph !== null;
  }

  get data(): GraphData | null {
    return this.graph;
  }

  // ---------- 扫描 ----------
  private walk(dir: string, out: string[] = []): string[] {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        this.walk(join(dir, e.name), out);
      } else if (DOC_EXT.test(e.name)) {
        out.push(join(dir, e.name));
      }
    }
    return out;
  }

  private toId(abs: string): string {
    return relative(this.root, abs).split("\\").join("/");
  }

  private static normalize(p: string): string {
    const out: string[] = [];
    for (const seg of p.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") out.pop();
      else out.push(seg);
    }
    return out.join("/");
  }

  // ---------- 索引 ----------
  async index(): Promise<GraphData> {
    const t0 = performance.now();
    const files = this.walk(this.root);
    const idSet = new Set(files.map((f) => this.toId(f)));
    const lowerIdMap = new Map<string, string>([...idSet].map((id) => [id.toLowerCase(), id]));

    const stemMap = new Map<string, Set<string>>();
    for (const id of idSet) {
      const stem = basename(id, extname(id));
      if (!stemMap.has(stem)) stemMap.set(stem, new Set());
      stemMap.get(stem)!.add(id);
    }

    const resolvePath = (fromId: string, raw: string): { status: "resolved" | "broken" | "self" | "asset"; id?: string; tried?: string } => {
      const t = raw.split("#")[0].trim();
      if (!t) return { status: "self" };
      const base = dirname(fromId);
      const prefixed = (p: string): string => (base === "." ? p : `${base}/${p}`);
      const cands: string[] = [];
      const push = (p: string): void => {
        const n = Workspace.normalize(p);
        if (n && !cands.includes(n)) cands.push(n);
      };
      push(prefixed(t));
      if (/\.html?$/i.test(t)) {
        const noExt = t.replace(/\.html?$/i, "");
        push(prefixed(`${noExt}.adoc`));
        push(prefixed(`${noExt}.md`));
      }
      if (!extname(t)) {
        push(prefixed(`${t}.adoc`));
        push(prefixed(`${t}.md`));
      }
      for (const c of cands) {
        if (idSet.has(c)) return { status: "resolved", id: c };
        const lower = lowerIdMap.get(c.toLowerCase());
        if (lower) return { status: "resolved", id: lower };
      }
      for (const c of cands) {
        const abs = join(this.root, c);
        if (existsSync(abs) && statSync(abs).isFile()) return { status: "asset", id: c };
      }
      return { status: "broken", tried: cands[0] };
    };

    const resolveWiki = (fromId: string, raw: string): { status: "resolved" | "broken"; id?: string; tried?: string } => {
      const t = raw.split("#")[0].trim().replace(/\.(md|adoc)$/i, "");
      const c = stemMap.get(t);
      if (!c || c.size === 0) return { status: "broken", tried: t };
      if (c.size === 1) return { status: "resolved", id: [...c][0] };
      const sameDir = [...c].find((x) => dirname(x) === dirname(fromId));
      return { status: "resolved", id: sameDir ?? [...c][0] };
    };

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const assetIds = new Set<string>();
    const tally = { resolved: 0, broken: 0, unresolved: 0, self: 0 };

    for (const abs of files) {
      const id = this.toId(abs);
      const isAdoc = id.toLowerCase().endsWith(".adoc");
      const buf = readFileSync(abs);
      const content = buf.toString("utf8");
      let parsed;
      try {
        parsed = isAdoc ? await parseAsciiDoc(id, abs, this.root, content) : parseMarkdown(id, content);
      } catch {
        parsed = { title: basename(id, extname(id)), headings: [], links: [] as RawLink[] };
      }

      nodes.push({
        id,
        title: parsed.title || basename(id, extname(id)),
        format: isAdoc ? "asciidoc" : "markdown",
        headings: parsed.headings,
        size: buf.byteLength,
      });

      for (const link of parsed.links) {
        if (link.unresolvedAttr) {
          tally.unresolved++;
          edges.push({ source: id, target: `?${link.target}`, kind: link.kind, line: link.line, status: "unresolved", reftext: link.reftext });
          continue;
        }
        const r = link.kind === "wikilink" ? resolveWiki(id, link.target) : resolvePath(id, link.target);

        if (r.status === "self") { tally.self++; continue; }

        if (r.status === "asset") {
          const aid = r.id!;
          if (!assetIds.has(aid)) {
            assetIds.add(aid);
            const aabs = join(this.root, aid);
            nodes.push({ id: aid, title: basename(aid), format: "asset", headings: [], size: existsSync(aabs) ? statSync(aabs).size : 0 });
          }
          tally.resolved++;
          edges.push({ source: id, target: aid, kind: link.kind, line: link.line, status: "resolved", reftext: link.reftext });
          continue;
        }

        if (r.status === "resolved") {
          tally.resolved++;
          edges.push({ source: id, target: r.id!, kind: link.kind, line: link.line, status: "resolved", reftext: link.reftext });
        } else {
          tally.broken++;
          edges.push({ source: id, target: `?${link.target}`, kind: link.kind, line: link.line, status: "broken", reftext: link.reftext, ...(r.tried ? { tried: r.tried } : {}) });
        }
      }
    }

    const elapsedMs = performance.now() - t0;
    const connected = new Set<string>();
    for (const e of edges) {
      if (e.status !== "resolved") continue;
      connected.add(e.source);
      connected.add(e.target);
    }
    const stats: GraphStats = { ...tally, connected: connected.size, orphaned: nodes.length - connected.size };

    const data: GraphData = { root: this.root, generatedAt: new Date().toISOString(), nodes, edges, stats, elapsedMs };

    // 建索引
    this.nodeById = new Map(nodes.map((n) => [n.id, n]));
    this.outgoing = new Map();
    this.incoming = new Map();
    for (const e of edges) {
      if (!this.outgoing.has(e.source)) this.outgoing.set(e.source, []);
      this.outgoing.get(e.source)!.push(e);
      if (!this.incoming.has(e.target)) this.incoming.set(e.target, []);
      this.incoming.get(e.target)!.push(e);
    }

    this.graph = data;
    return data;
  }

  // ---------- 查询 ----------
  node(id: string): GraphNode | undefined {
    return this.nodeById.get(id);
  }

  neighbors(id: string): Neighbors {
    return { outgoing: this.outgoing.get(id) ?? [], incoming: this.incoming.get(id) ?? [] };
  }

  /** 文件树（含未索引的资源文件） */
  tree(): TreeNode {
    const build = (dirAbs: string, dirRel: string): TreeNode[] => {
      let entries;
      try {
        entries = readdirSync(dirAbs, { withFileTypes: true });
      } catch {
        return [];
      }
      const dirs: TreeNode[] = [];
      const files: TreeNode[] = [];
      for (const e of entries) {
        if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        const abs = join(dirAbs, e.name);
        const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          const children = build(abs, rel);
          dirs.push({ name: e.name, path: rel, type: "dir", children });
        } else {
          const ext = extname(e.name).toLowerCase();
          if (!DOC_EXT.test(e.name) && !/^\.(html?|png|jpg|jpeg|gif|svg|webp|pdf)$/i.test(ext)) continue;
          const fmt: DocFormat = ext === ".adoc" ? "asciidoc" : ext === ".md" ? "markdown" : "asset";
          let size = 0;
          try { size = statSync(abs).size; } catch { /* ignore */ }
          files.push({ name: e.name, path: rel, type: "file", format: fmt, size });
        }
      }
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));
      return [...dirs, ...files];
    };
    return { name: basename(this.root), path: "", type: "dir", children: build(this.root, "") };
  }
}
