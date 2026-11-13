# L3 实施记录：AsciiDoc 阅读视图

- **层**：L3（AsciiDoc 编辑与预览，本轮只交付阅读视图）
- **前置**：L2 让 `.adoc` 进入索引（`docs/plans/L2-asciidoc-indexing.md`）
- **状态**：已完成（2026-11-13）
- **触发**：使用者打开 adoc 的阅读视图，发现标题、表格按 Markdown 渲染，显示不对

---

## 1. 问题

L2 之后 adoc 能进文件树、图谱和反链，但阅读视图仍走 `renderPreview()` → `renderMarkdownToHtml()`。AsciiDoc 的 `= 标题` 被当成正文，`|===` 表格变成普通段落，admonition 也丢失。

## 2. 方案

**索引与渲染继续分家**（L2 计划 P3 的既定裁决）：索引走纯正则扫描保持 67 ms；阅读视图按需加载完整解析器。

新增 `src/core/asciidoctorPreview.ts`：

| 环节 | 做法 |
| --- | --- |
| 加载 | `import("@asciidoctor/core")` 动态导入，首次打开 adoc 阅读视图才下载；失败可重试 |
| 转换 | `convert(source, { standalone: false, safe: "secure", attributes: {...} })` |
| 标题 | `showtitle: true` 让 `= 标题` 在片段里输出 `<h1>` |
| 链接 | `outfilesuffix: ".adoc"` 阻止把 `xref:Foo.adoc[]` 改写成 `Foo.html` |
| 链接接管 | 后处理把 vault 内链接改写成 `<a class="internal-link" data-target="…" data-subpath="…">`，复用 EditorPane 既有点击逻辑 |
| 安全 | `safe: "secure"` 禁用 include；另移除 `<script>` / `<iframe>` / `on*=` / `javascript:` |
| 缓存 | 只缓存最近一次 `(source, html)`，重复渲染零耗时 |

`@asciidoctor/core@4.2.1` 的 `exports["."].browser` 提供官方浏览器构建，**只有命名导出**（没有 default）。Vite 会把它引用的 `node:fs` / `node:path` / `node:async_hooks` 外部化，但 `convert(source, …)` 不触发这些路径，实测无影响。

`EditorPane.tsx`：新增一个 `useEffect` 做异步转换，把结果放进 `adocResult` state；`previewHtml` 仍是 `useMemo`，只对 adoc 分支返回异步结果。Markdown 路径保持完全同步，零改动。容器额外加 `adoc-preview-view` 类，把新样式隔离在 `src/styles/adoc-preview.scss` 内。

## 3. 验证

```
npm run verify                     退出码 0，构建 2.14 s
产物分包                           Asciidoctor 独立成 979 KB + 366 KB 两个 chunk；
                                   主 chunk 不含 asciidoctor 字符串
CSS 产物                           adoc-preview-view 规则 90 处

渲染探针（Vite ssrLoadModule 加载真实模块）
  <h1> / <h2> / sect1             1 / 1 / 1
  admonitionblock / table         1 / 2
  xref:Other.adoc                 → <a class="internal-link" data-target="Other.adoc" href="#">
  xref:Other.adoc#anchor          → 额外带 data-subpath="anchor"
  <<cleanup,文内>>                → data-target="" 的自链接
  https / mailto 外部链接         原样保留，不接管
  重复渲染                        elapsedMs = 0，内容一致

真实文档 AI_Engineering_Gate.adoc
  67,113 字符 → 202,617 字符 HTML · 38 ms
  94 个章节 · 212 条内部链接
```

## 4. 已知边界（本层不做）

| 边界 | 影响 | 后续 |
| --- | --- | --- |
| `include::` 在预览里**不展开** | `safe: "secure"` 禁用 include，且浏览器构建没有 `node:fs` | 需要自定义 IncludeProcessor，从 vault 读文件后喂给解析器；ADR-0002 的归属语义也要一起定 |
| 没有 `data-line` 源码定位 | Markdown 渲染会为块输出 `data-line`，插件的 `getSectionInfo` 依赖它；adoc 视图里这些插件拿不到 section 信息 | 用 Asciidoctor AST 的 sourcemap（ADR-0001 已验证 495/495 节点带行号）补写 `data-line` |
| 编辑器仍是 Markdown 语言模式 | 源码模式没有 AsciiDoc 语法高亮；折叠与结构化导航依赖 Lezer 树，而 AsciiDoc 没有 Lezer 语法 | L3 剩余部分：接 `codemirror-asciidoc` 的 `StreamLanguage`，并自写基于文本的折叠/大纲 |
| 阅读视图里的 embeds / 任务勾选等 Markdown 专属交互 | adoc DOM 没有对应标记，这些水合逻辑会自然跳过（不会报错） | 按需补 AsciiDoc 对应物 |
| 链接目标是 `.html` 附件时 | 仍会转成 `internal-link`，`openWikilink` 可能打不开 | 后处理时区分文档与附件，或让 `openWikilink` 支持附件跳转 |

## 5. 为什么不顺便把编辑器也换掉

CodeMirror 6 的结构化能力全部建立在 Lezer 语法树上，`lezer-asciidoc` 在 npm 上不存在，`codemirror-asciidoc` 只有 `StreamLanguage`（逐行 token，无树）。换语言模式只能解决高亮，折叠和大纲仍要另写一套。阅读视图是独立链路，先交付它的收益最大、风险最小。

## 6. 完成定义

- [x] adoc 阅读视图用 Asciidoctor 渲染，md 阅读视图行为不变
- [x] `xref:` 链接在阅读视图里可点击跳转
- [x] 解析器懒加载，不进主 chunk
- [x] `npm run verify` 退出码 0
- [x] 桌面 exe 重建并启动正常；阅读视图的端到端验证走 CDP 无头浏览器（含截图）
