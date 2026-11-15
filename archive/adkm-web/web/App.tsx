import { useCallback, useEffect, useMemo, useState } from "react";
import type { GraphData, RenderResult, TreeNode, WorkspaceInfo } from "../shared/types.ts";
import { api } from "./api.ts";
import { DocView } from "./components/DocView.tsx";
import { GraphView } from "./components/GraphView.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { createResolver } from "./resolve.ts";

type View = "graph" | "doc";

export default function App() {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [doc, setDoc] = useState<RenderResult | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [view, setView] = useState<View>("graph");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resolver = useMemo(() => (graph ? createResolver(graph.nodes) : null), [graph]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [i, t, g] = await Promise.all([api.info(), api.tree(), api.graph().catch(() => null)]);
      setInfo(i);
      setTree(t);
      if (g) setGraph(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDoc = useCallback(
    async (id: string) => {
      setCurrentId(id);
      setView("doc");
      setError(null);
      try {
        const d = await api.doc(id);
        setDoc(d);
      } catch (e) {
        setError(e instanceof Error ? e.message : "打开失败");
        setDoc(null);
      }
    },
    [],
  );

  const reindex = useCallback(async () => {
    setBusy(true);
    try {
      await api.reindex();
      const [i, t, g] = await Promise.all([api.info(), api.tree(), api.graph()]);
      setInfo(i);
      setTree(t);
      setGraph(g);
      if (currentId) {
        try {
          setDoc(await api.doc(currentId));
        } catch {
          /* 文档可能已被删除 */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "重建索引失败");
    } finally {
      setBusy(false);
    }
  }, [currentId]);

  const git = info?.git;
  const dirty = (git?.changed ?? 0) > 0;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          ADKM<span>.</span>
        </div>
        <div className="top-tabs">
          <button className={view === "graph" ? "on" : ""} onClick={() => setView("graph")}>
            关系图
          </button>
          <button
            className={view === "doc" ? "on" : ""}
            onClick={() => setView("doc")}
            disabled={!currentId}
          >
            {doc ? doc.title.slice(0, 18) : "文档"}
          </button>
        </div>
        <div className="top-right">
          {git?.available && (
            <div className="git-chip" title={git.lastCommit ? `最近提交：${git.lastCommit.message}` : ""}>
              <span className={`dot${dirty ? " dirty" : ""}`} />
              {git.branch ?? "git"}
              {dirty && ` · ${git.changed} 变更`}
              {git.ahead ? ` · ↑${git.ahead}` : ""}
              {git.behind ? ` · ↓${git.behind}` : ""}
            </div>
          )}
          {!git?.available && <div className="git-chip"><span className="dot" style={{ background: "#5f5f6d" }} />非 Git 仓库</div>}
          <button className="btn-sm" onClick={reindex} disabled={busy}>
            {busy ? "处理中…" : "重建索引"}
          </button>
        </div>
      </header>

      <Sidebar tree={tree} currentId={currentId} onOpen={(id) => void openDoc(id)} />

      <main className="main">
        {error && (
          <div style={{ padding: 28, color: "#e24b4a", fontSize: 13 }}>{error}</div>
        )}
        {!error && view === "graph" && graph && (
          <GraphView graph={graph} onOpen={(id) => void openDoc(id)} />
        )}
        {!error && view === "graph" && !graph && busy && (
          <div className="loading"><span className="spinner" />正在索引工作区…</div>
        )}
        {!error && view === "doc" && doc && resolver && (
          <DocView doc={doc} resolver={resolver} onOpen={(id) => void openDoc(id)} />
        )}
        {!error && view === "doc" && !doc && <div className="loading"><span className="spinner" />读取文档…</div>}
      </main>

      <footer className="status">
        <span>{info?.root ?? ""}</span>
        <span>{info?.docCount ?? 0} 文档</span>
        <span>{info?.assetCount ?? 0} 资源</span>
        <span>{info?.edgeCount ?? 0} 引用</span>
        {graph && <span>索引 {Math.round(graph.elapsedMs)} ms</span>}
        {graph && <span className={graph.stats.broken > 0 ? "warn" : "ok"}>断链 {graph.stats.broken}</span>}
        {graph && <span>孤立 {graph.stats.orphaned}</span>}
      </footer>
    </div>
  );
}
