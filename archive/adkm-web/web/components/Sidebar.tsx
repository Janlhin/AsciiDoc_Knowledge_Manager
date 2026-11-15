import { useMemo, useState } from "react";
import type { TreeNode } from "../../shared/types.ts";

export function Sidebar({
  tree,
  currentId,
  onOpen,
}: {
  tree: TreeNode | null;
  currentId: string | null;
  onOpen: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  /** 搜索时展平为匹配列表 */
  const matches = useMemo(() => {
    if (!tree || q.trim().length === 0) return null;
    const needle = q.trim().toLowerCase();
    const out: { path: string; name: string; format?: string }[] = [];
    const walk = (n: TreeNode): void => {
      if (n.type === "file" && (n.name.toLowerCase().includes(needle) || n.path.toLowerCase().includes(needle))) {
        out.push({ path: n.path, name: n.name, format: n.format });
      }
      n.children?.forEach(walk);
    };
    walk(tree);
    return out.slice(0, 200);
  }, [tree, q]);

  const toggle = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  function renderNode(n: TreeNode, depth: number): React.ReactNode {
    if (n.type === "dir") {
      const isCollapsed = collapsed.has(n.path);
      const kids = n.children ?? [];
      if (kids.length === 0) return null;
      return (
        <div key={n.path}>
          <div className="tree-node" style={{ paddingLeft: 7 + depth * 2 }} onClick={() => toggle(n.path)}>
            <span className="caret">{isCollapsed ? "▸" : "▾"}</span>
            <span>{n.name}</span>
          </div>
          {!isCollapsed && <div className="tree-children">{kids.map((k) => renderNode(k, depth + 1))}</div>}
        </div>
      );
    }

    const ext = n.format === "asciidoc" ? "adoc" : n.format === "markdown" ? "md" : "";
    return (
      <div
        key={n.path}
        className={`tree-node${currentId === n.path ? " on" : ""}`}
        style={{ paddingLeft: 7 + depth * 2 }}
        onClick={() => onOpen(n.path)}
        title={n.path}
      >
        <span>{n.name}</span>
        {ext && <span className={`ext ${ext}`}>{ext}</span>}
      </div>
    );
  }

  return (
    <aside className="side">
      <div className="side-head">
        <div className="side-title">工作区</div>
        <input
          className="search"
          placeholder="搜索文件名…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="tree">
        {matches
          ? matches.length === 0
            ? <div className="empty">无匹配</div>
            : matches.map((m) => (
                <div
                  key={m.path}
                  className={`tree-node${currentId === m.path ? " on" : ""}`}
                  onClick={() => onOpen(m.path)}
                  title={m.path}
                >
                  <span>{m.name}</span>
                  <span className={`ext ${m.format === "asciidoc" ? "adoc" : m.format === "markdown" ? "md" : ""}`}>
                    {m.format === "asciidoc" ? "adoc" : m.format === "markdown" ? "md" : ""}
                  </span>
                </div>
              ))
          : tree?.children?.map((c) => renderNode(c, 0))}
      </div>
    </aside>
  );
}
