/**
 * ADKM: 哪些文件算「文档」，参与索引。
 *
 * 放在独立模块里而不是 `metadata.ts`，是因为 `vault.ts` 也要用它过滤文件列表，
 * 而 `vault.ts` 不能反过来依赖 `metadata.ts`（会成环）。
 */

const INDEXABLE_EXTENSIONS = new Set(["md", "adoc"]);

/** 路径的扩展名（不含点），统一小写；无扩展名返回空串 */
export function extensionOf(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dot = path.lastIndexOf(".");
  return dot > slash ? path.slice(dot + 1).toLowerCase() : "";
}

/** 该路径是否参与索引 */
export function isIndexable(path: string): boolean {
  return INDEXABLE_EXTENSIONS.has(extensionOf(path));
}

/**
 * 去掉可索引文档的扩展名，得到链接解析用的名字。
 * `Notes/Welcome.md` → `Notes/Welcome`；`a/b.adoc` → `a/b`；其它后缀原样返回。
 */
export function stripDocExtension(path: string): string {
  return isIndexable(path) ? path.slice(0, path.lastIndexOf(".")) : path;
}

/** 链接解析时按优先级尝试的扩展名：先 md（历史行为），再 adoc */
export const RESOLVE_EXTENSIONS = [".md", ".adoc"] as const;
