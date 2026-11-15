/** ADKM Web · 前后端共享的类型定义 */

export type DocFormat = "asciidoc" | "markdown" | "asset";

export type LinkKind =
  | "wikilink"
  | "markdown-link"
  | "xref"
  | "xref-short"
  | "link-macro"
  | "include";

export type LinkStatus = "resolved" | "broken" | "unresolved";

export interface Heading {
  level: number;
  text: string;
  line: number;
}

export interface GraphNode {
  id: string;
  title: string;
  format: DocFormat;
  headings: Heading[];
  size: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: LinkKind;
  line: number;
  status: LinkStatus;
  reftext: string;
  ambiguous?: number;
  tried?: string;
}

export interface GraphStats {
  resolved: number;
  broken: number;
  unresolved: number;
  self: number;
  connected: number;
  orphaned: number;
}

export interface GraphData {
  root: string;
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
  elapsedMs: number;
}

/** 文件树节点 */
export interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  format?: DocFormat;
  children?: TreeNode[];
  size?: number;
}

/** 单个文档的渲染结果 */
export interface RenderResult {
  id: string;
  title: string;
  format: DocFormat;
  /** 渲染后的 HTML 片段 */
  html: string;
  /** 文档大纲（含源码行号） */
  headingsSummary: Heading[];
  /** 本文档的出链与入链 */
  outgoing: EdgeRef[];
  incoming: EdgeRef[];
}

export interface EdgeRef {
  /** 对端文档 id */
  other: string;
  otherTitle: string;
  kind: LinkKind;
  status: LinkStatus;
  line: number;
  reftext: string;
}

export interface GitStatus {
  available: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  /** 变更文件数 */
  changed?: number;
  /** 最近一次提交摘要 */
  lastCommit?: { hash: string; message: string; date: string };
  /** 未追踪 / 已修改 / 已删除 */
  files?: { path: string; status: string }[];
  error?: string;
}

export interface WorkspaceInfo {
  root: string;
  docCount: number;
  assetCount: number;
  edgeCount: number;
  git: GitStatus;
}

/** 解析器产出的中间结构（服务端内部使用） */
export interface ParsedDoc {
  title: string;
  headings: Heading[];
  links: RawLink[];
}

/** 解析器产出的原始引用（目标尚未解析） */
export interface RawLink {
  raw: string;
  target: string;
  kind: LinkKind;
  line: number;
  reftext: string;
  unresolvedAttr?: boolean;
}
