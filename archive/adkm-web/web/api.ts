import type { GraphData, RenderResult, TreeNode, WorkspaceInfo } from "../shared/types.ts";

const enc = (id: string): string => id.split("/").map(encodeURIComponent).join("/");

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return (await r.json()) as T;
}

export const api = {
  info: (): Promise<WorkspaceInfo> => getJson<WorkspaceInfo>("/api/info"),
  tree: (): Promise<TreeNode> => getJson<TreeNode>("/api/tree"),
  graph: (): Promise<GraphData> => getJson<GraphData>("/api/graph"),
  doc: (id: string): Promise<RenderResult> => getJson<RenderResult>(`/api/doc/${enc(id)}`),
  raw: async (id: string): Promise<string> => {
    const r = await fetch(`/api/raw/${enc(id)}`);
    if (!r.ok) throw new Error(r.statusText);
    return r.text();
  },
  reindex: async (): Promise<{ ok: boolean; nodes: number; edges: number; elapsedMs: number }> => {
    const r = await fetch("/api/reindex", { method: "POST" });
    return r.json() as Promise<{ ok: boolean; nodes: number; edges: number; elapsedMs: number }>;
  },
};
