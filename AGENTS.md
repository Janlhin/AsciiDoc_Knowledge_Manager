# AGENTS.md

工程约束以 `README.md`、`docs/CONTRIBUTING.md` 与 `npm run verify` 为准；本文件只放 AI 协作相关约定。

**本文件是目录，不是手册。** 不放规范正文，只放命令入口、禁止清单、条款索引与项目特有约定。深层内容一律链接过去。

> 条款索引按**章节标题**检索而非 URL 锚点：`.adoc` 在 GitHub 上不渲染，锚点不可达；标题文本可 `grep` 校验，且改标题时会在 diff 中暴露。

## 强制命令入口

| 命令 | 作用 | 期望 |
| --- | --- | --- |
| `npm run verify` | 全量校验（类型 + 构建） | 退出码 0 |
| `npm run typecheck` | `tsc --noEmit` | 退出码 0，零错误 |
| `npm run build` | 前端产物构建 | 退出码 0 |
| `npm run tauri build --no-bundle` | 桌面可执行文件 | 产出 `src-tauri/target/release/adkm.exe` |
| `cargo build --release` | 仅 Rust 侧（在 `src-tauri/`） | 退出码 0 |

`verify` 当前只含类型检查与构建。Lint、样式检查、测试三道通道尚未接入，见 `TASKS.md` T-003 至 T-006。

## 条款索引

| 主题 | 规范章节 |
| --- | --- |
| 五个必备文档与字段 | §文档先行：项目文档的建立、变更与校验 |
| 文档变更的三层校验 | §文档变更的三层校验 |
| 强制工具链基线 | §强制工具链基线 |
| 版本策略（不求最新） | §工具与运行时的版本策略：不求最新，求受支持且可复现 |
| 技术栈登记 | §技术栈登记与工具偏好 |
| 根目录白名单 | §目录结构与文件放置 |
| 脚本统一 Pwsh | §脚本执行基线：禁止 cmd / bat，统一 Pwsh |
| 四层防御与校验矩阵 | §四层防御模型 |
| 关键配置基线（TS / SCSS / 门禁） | §关键配置基线 |
| 对 AI 的硬性约束 | §对 AI 的硬性约束条款 |
| 歧义处理 | §歧义处理协议：不明白就问，并且做成选项 |
| 先搜寻后自研 | §先搜寻，后自研：代码与工具获取规范 |
| 原子化 | §原子化要求 |
| 提交与交付闭环 | §提交与交付闭环 |
| 版本号规则 | §版本号规则：SemVer 2.0.0 |
| 冗余清理 | §冗余清理与死代码治理 |
| 来源留痕 | §来源留痕（强制） |

## 项目文档

| 文件 | 职责 |
| --- | --- |
| [`README.md`](README.md) | 项目定位、技术栈、目录结构、运行与验收 |
| [`DECISIONS.md`](DECISIONS.md) | 追加式决策日志 |
| [`TASKS.md`](TASKS.md) | 任务队列与待裁决台账 |
| [`MANIFEST.md`](MANIFEST.md) | 第三方来源登记 |
| [`docs/PROVENANCE.adoc`](docs/PROVENANCE.adoc) | 上游来源、改动清单、许可义务 |
| [`docs/plans/`](docs/plans/) | 各层实施计划（L2 起） |
| [`docs/product-placeholders.adoc`](docs/product-placeholders.adoc) | 产品身份占位符待填清单、系统默认值、未来 I18N 改造 |
| [`docs/perf-1000-adoc.adoc`](docs/perf-1000-adoc.adoc) | T-069 千篇 adoc 性能基准：脚本、实测数值、与章程 §9.1 目标对照 |
| [`docs/release-checklist.adoc`](docs/release-checklist.adoc) | T-072 发版清单：前置检查、五处版本号同步、unsigned/signed 构建命令、产物校验、回滚与 blocked 项 |

## 禁止事项

- **禁止 `--no-verify`** 绕过 Husky 门禁。
- **禁止新增 `.cmd` / `.bat`**；脚本入口统一 PowerShell 7.4+。现有 `.mjs` 校准脚本为上游遗留，见 `TASKS.md` T-008。
- **禁止在功能提交中夹带主版本升级**；升级须独立 `chore(deps):` 提交，并在 `DECISIONS.md` 留痕。
- **禁止第二份规则副本**：`.cursorrules`、`CLAUDE.md`、`copilot-instructions.md` 只允许一行指向本文件。
- **禁止在根目录新增白名单外条目**，须先询问并获批准，批准后补 `README.md` 目录结构与 `DECISIONS.md`。
- **禁止用 `any` 关闭类型通道**；`strict` 全开，不使用 `@ts-ignore` 掩盖真实缺陷。
- **禁止删除测试或下调覆盖率阈值**来使门禁通过。

## 项目特有约定

- **两个 CSS 文件永不转 SCSS**：`src/compat/obsidian/theme-bridge.css`、`src/features/export/export.css`。二者经 Vite `?raw` 原文注入，转换后样式整体失效。
- **调色板保持 CSS 自定义属性**：`:root` 与 `html[data-theme]` 中的颜色字面量不得变量化为编译期常量，否则 Obsidian 主题的运行时覆盖链断裂。
- **样式改动须比对规则集合**：机械改动要求规则数不变、声明等价，仅在有意改变视觉时允许差异。
- **兼容层改动独立提交**：`src/compat/` 的任何改动单独成提交，用于度量其占用的开发时间比例（见 `DECISIONS.md` D-005）。
- **上游已冻结**：不 rebase、不合并上游分支。需要摘取上游某个提交时，按 `docs/PROVENANCE.adoc` 的临时远端步骤操作。
- **不要用 `asciidoctor -o /dev/null`**：在 Git Bash 下 `/dev/null` 会被解释为 Windows 设备名 `nul`，生成无法删除的文件。改用临时文件。

## 上下文可达性

本文件与五个文档中的所有相对链接必须可达，断链即失败。新增文档时，必须同时在上表增加一行指向它，否则该文档不构成约束。
