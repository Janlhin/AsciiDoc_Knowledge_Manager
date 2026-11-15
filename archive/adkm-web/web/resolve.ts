/** 前端链接解析：把渲染结果里的相对路径解析为文档 id */
import type { GraphNode } from "../shared/types.ts";

export interface Resolver {
  /** 按路径解析（相对当前文档） */
  byPath: (fromId: string, raw: string) => string | null;
  /** 按文件名解析（wikilink） */
  byName: (raw: string) => string | null;
}

export function createResolver(nodes: GraphNode[]): Resolver {
  const ids = new Set(nodes.map((n) => n.id));
  const lower = new Map<string, string>();
  const stems = new Map<string, string[]>();

  for (const n of nodes) {
    lower.set(n.id.toLowerCase(), n.id);
    if (n.format === "asset") continue;
    const stem = n.id.split("/").pop()!.replace(/\.(adoc|md)$/i, "");
    if (!stems.has(stem)) stems.set(stem, []);
    stems.get(stem)!.push(n.id);
  }

  const normalize = (p: string): string => {
    const out: string[] = [];
    for (const seg of p.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") out.pop();
      else out.push(seg);
    }
    return out.join("/");
  };

  return {
    byPath(fromId: string, raw: string): string | null {
      const t = raw.split("#")[0].trim();
      if (!t) return fromId;
      const base = fromId.includes("/") ? fromId.slice(0, fromId.lastIndexOf("/")) : "";
      const cands: string[] = [];
      const joined = base ? `${base}/${t}` : t;
      cands.push(normalize(joined));
      if (/\.html?$/i.test(t)) {
        const noExt = t.replace(/\.html?$/i, "");
        cands.push(normalize(base ? `${base}/${noExt}.adoc` : `${noExt}.adoc`));
        cands.push(normalize(base ? `${base}/${noExt}.md` : `${noExt}.md`));
      }
      if (!/\.[a-z0-9]+$/i.test(t)) {
        cands.push(normalize(base ? `${base}/${t}.adoc` : `${t}.adoc`));
        cands.push(normalize(base ? `${base}/${t}.md` : `${t}.md`));
      }
      for (const c of cands) {
        if (ids.has(c)) return c;
        const l = lower.get(c.toLowerCase());
        if (l) return l;
      }
      return null;
    },
    byName(raw: string): string | null {
      const t = raw.split("#")[0].trim().replace(/\.(adoc|md)$/i, "");
      const list = stems.get(t);
      return list && list.length > 0 ? list[0] : null;
    },
  };
}
