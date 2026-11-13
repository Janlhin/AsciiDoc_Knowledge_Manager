# ADKM

**Local-first desktop knowledge base for AsciiDoc and Markdown.**

A working rebuild on top of [Geode](https://github.com/AlexHercules/geode) (Apache-2.0). Early stage,
private repository, not ready for external use.

> 工作代号 ADKM，产品名未定。本仓库是 Geode 的深度改造分支，当前处于改造初期。

---

## 这个项目要做什么

市面上的本地知识库都以 Markdown 为前提，因此都没有 AsciiDoc 的语义。AsciiDoc 用户真正依赖的东西——属性别名、交叉引用、include 组装、条件包含——在 `[[wikilink]]` 的世界里没有对应物。

ADKM 的目标不是"给 Obsidian 加一个 AsciiDoc 渲染器"，而是**在 Obsidian 式的界面里，提供一套文档工程的校验能力**：

| 能力 | Markdown 工具 | ADKM 目标 |
| --- | --- | --- |
| 引用 | `[[Note]]`，按文件名模糊匹配 | `xref:` 宏与 `<<>>` 简写，含属性别名展开 |
| 失效检测 | 断链提示 | 三态：有效 / 断链 / **属性未定义** |
| 版本一致性 | 无 | 中英双语章节对齐、行数偏差 |
| 组装 | 无 | `include::` 归属与递归 |
| 图谱 | 笔记级关系 | 文档级关系 + 组装关系 |

## 当前状态

**这是改造初期。** 下表是实情，不是路线图。

### 已经能用的

- 打开本地文件夹作为 vault（Markdown）
- 编辑器三模式：实时预览 / 源码 / 阅读
- 关系图谱：全局与局部、过滤、分组
- 反向链接、出链、大纲、搜索、命令面板、多标签与分屏
- **Obsidian 插件与主题兼容层**（约 10,400 行），从 `.obsidian/` 加载
- 样式体系已转 SCSS（22 个文件，编译产物与改造前逐条等价）
- **AsciiDoc 进入索引**：`.adoc` 与 `.md` 参与同一套文件树、图谱、反链、大纲、搜索
  - 四种引用写法都识别：`xref:path[]`、`<<path,text>>`、`link:path[]`、`include::path[]`
  - 属性别名在文档头内求值，`xref:{spec}[]` 能解析到真实文件
  - 实测 Blueprint 语料：130 篇 adoc、220 条引用、0 条未解析、全量索引 67 ms

### 还不能用的

| 能力 | 状态 |
| --- | --- |
| AsciiDoc 阅读视图 | **按 Markdown 渲染**。adoc 能打开、能编辑、能进图谱，但阅读模式会把它当 Markdown 处理，标题和表格显示不对。语言模式与预览分派是 L3 |
| xref 校验 | 索引已能判定每条引用解析到哪，但**没有校验界面**。断链清单、悬空锚点、属性未定义分类都还没做 |
| 双语对齐 | 未开始 |
| Canvas（`.canvas`） | 未开始。设置里有开关，门后是空的 |
| Git 集成 | 未开始。无任何 git 调用 |

**换句话说：adoc 现在能进图、能参与反链，但读起来还不对。** 想核对索引结果跑：

```sh
node scripts/adoc-index-report.mjs "D:/你的文件夹" --min-adoc 1
```

## 技术栈

| 层 | 选型 | 版本 |
| --- | --- | --- |
| 桌面壳 | Tauri | 2.12 |
| 界面 | React | 19.3 |
| 语言 | TypeScript | 7.0 |
| 编辑器 | CodeMirror | 6.43 |
| 构建 | vite-plus（内含 Vite 8 + Rolldown） | 1.6 |
| 样式 | Sass（SCSS） | 1.108 |
| 样式 | SCSS（`sass`） | 1.108 |

Rust 侧很薄（约 800 行），只负责文件系统、监听、对话框与打包。业务逻辑全在 TypeScript。

## 环境要求

- Node.js 20 或更高（仓库内 `.nvmrc` 固定为 `26.13.0`，CI 与本地以此为准）
- Rust stable + Cargo（实测 1.99.1；Tauri 2.12 的 MSRV 为 1.90）
- Windows：Visual Studio 2022 的 C++ 工具链 + WebView2 运行时
- Tauri 各平台依赖见 <https://tauri.app/start/prerequisites/>

## 构建

```sh
git clone https://github.com/Janlhin/adkm.git
cd adkm

# 依赖锁文件中记录了镜像地址，需要显式放行
npm install --allow-remote=all

# 前端：类型检查 + 打包
npm run build

# 只出可执行文件，最快（增量约 1 分钟，首次编译约 2 分钟）
npx tauri build --no-bundle

# 出 NSIS 安装包
npx tauri build
```

产物：

```
src-tauri/target/release/geode.exe                              约 5.1 MB
src-tauri/target/release/bundle/nsis/*-setup.exe                约 4.6 MB
```

`tauri build` 结束时会出现 `A public key has been found, but no private key` 错误。那是自动更新签名缺少私钥，**安装包已经生成**，不影响本地使用。要消除需设置 `TAURI_SIGNING_PRIVATE_KEY`。

> **不要只跑 `cargo build --release`。** exe 里嵌入的 `dist/` 资源由 `tauri build` 链路刷新；只编译 Rust 侧会得到一个能启动、但**界面全白**的 exe（窗口标题在、Local Storage 也在写，就是没有 UI）。2026-11-13 实测踩过：改成 `npx tauri build --no-bundle` 重编一次即恢复。改完前端代码必须走完整链路。

## 启动

双击 `run-adkm.ps1`（右键 →「使用 PowerShell 运行」），或直接：

```sh
src-tauri/target/release/geode.exe "C:\Users\Janlhin\Desktop\Blueprint"
```

第一个参数会被当成 vault 根目录，跳过文件夹选择对话框。省略参数则恢复上次打开的库。

首次打开 `Blueprint` 时，`.obsidian/` 里的四个插件会被兼容层加载，设置弹窗可能自动出现；点右上角 × 关掉即可看到图谱。

## 开发时的一条硬规矩

样式改动提交前请先跑构建，并确认编译后的 CSS 规则集合没有意外变化：

```sh
npm run build
```

两个文件**永远保持 `.css`**，不要转 SCSS：`src/compat/obsidian/theme-bridge.css`、`src/features/export/export.css`。它们通过 Vite `?raw` 以原文注入，转成 SCSS 会拿到未编译源码。

调色板（`:root` 与 `html[data-theme]`）保持 CSS 自定义属性，不要变量化为编译期常量——Obsidian 主题会在运行时覆盖它们。

## 目录结构

```
src/
├── core/           文档模型、解析、索引、i18n
│   └── parsers/    asciidoc.ts（待接线）
├── features/       各功能面板（图谱、反链、大纲、编辑器…）
├── compat/         Obsidian 插件与主题兼容层
├── app/            应用装配、布局、状态
└── styles/         全局样式与主题令牌
src-tauri/          Rust 壳（文件系统、监听、打包）
public/             静态资源
scripts/            构建期脚本（Node）
assets/             图标等二进制素材
docs/               项目文档与规范原文
├── 工程约束.adoc   工程校验规范
├── PROVENANCE.adoc         来源与许可义务
├── CONTRIBUTING.md         协作约定
├── SECURITY.md             安全策略
├── mtx.config.md           工具配置说明
└── plans/                  各层实施计划
```

顶层目录的职责在上一节声明；`git diff` 中出现声明范围外的路径即为需要解释的信号。

## 项目文档

| 文件 | 职责 |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | AI 协作约束入口（目录式，≤150 行） |
| [`DECISIONS.md`](DECISIONS.md) | 追加式决策日志 |
| [`TASKS.md`](TASKS.md) | 任务队列与待裁决台账 |
| [`MANIFEST.md`](MANIFEST.md) | 第三方来源登记 |
| [`README.md`](README.md) | 本项目适用的工程校验规范 v1.22.0 |
| [`docs/PROVENANCE.adoc`](docs/PROVENANCE.adoc) | 上游来源、改动清单、许可义务 |

## 来源与许可

本项目基于 [Geode](https://github.com/AlexHercules/geode)，Apache License 2.0。

- 上游基线：提交 `7a8ce22`（2026-07-04）
- 完整来源说明、改动清单与许可义务履行情况见 [docs/PROVENANCE.adoc](docs/PROVENANCE.adoc)
- 商标：「Geode」名称与图标不在 Apache-2.0 授权范围内，本项目不以该名义发布
- 与 Obsidian、Dynalist Inc. 无关联；「Obsidian」为其权利人商标

## 状态说明

本仓库为私有工作副本，功能不完整，接口与数据格式随时可能变化。当前不接收外部贡献，也不提供使用支持。
