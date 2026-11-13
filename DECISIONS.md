# DECISIONS

追加式决策日志。每条记录被采纳的方案、被否决的替代方案与理由、影响范围与复审条件。

字段：编号 · 日期 · 决策 · 背景 · 被采纳方案 · 被否决的替代方案与理由 · 影响范围 · 复审条件。

---

## D-001 采用 Geode 作为代码基线

- **日期**：2026-11-12
- **决策**：以 `AlexHercules/geode` 的提交 `7a8ce22`（2026-07-04，Apache-2.0）作为项目起点。
- **背景**：需要一个本地优先、文件即真理、TypeScript 技术栈、许可允许闭源衍生的桌面知识库底座，用于承载 AsciiDoc 支持。
- **被采纳方案**：内嵌基线。首个提交为上游快照（`6e80e93`，根提交），历史自该点独立，不配置上游远端。
- **被否决的替代方案**：
  - *Joplin*：AGPL-3.0 传染；笔记正文存于 SQLite 无文件路径，`xref` 无处可指。
  - *Logseq*：AGPL-3.0；块级 UUID 模型与长文档规范冲突。
  - *Knowledge Base*（`hamawang`）：AGPL-3.0 双许可；`notes.content` 存库，无 `file_path`。
  - *Nodum*：服务端多租户（PostgreSQL + Redis + MinIO），与本地优先原则冲突。
  - *Opensidian*：GPL-3.0；Rust + 原生 JS，无 TypeScript，无法在本技术栈内改造。
  - *Lokus*：FCL-1.0-MIT 为延迟开源许可，非 OSI 认可，法务边界不清。
  - *从零自建*：需重新实现约 52,000 行 UI 外壳，其中多为商品化工作。
- **影响范围**：全部代码来源、许可义务、目录结构。
- **复审条件**：上游恢复活跃且实现了本项目已有能力；或本项目对外分发并需重新评估商标与归属。

---

## D-002 由最小增量 fork 改为深度改造

- **日期**：2026-11-12
- **决策**：不再维持「只改 60 行」的最小增量策略，改为分层深度改造，并冻结上游。
- **背景**：实际核查发现目标能力与 Geode 现状的差距为六个新增层（AsciiDoc 解析与编辑、引用校验、双语对齐、Canvas、Git、信息架构），而非一个解析器。在如此差距下维持最小增量，会导致大量代码写进上游文件，rebase 全面冲突。
- **被采纳方案**：七层结构 L1–L7，层内自洽、层间按序交付；禁止跨层并行；每层完成后 `npm run build` 必须通过且应用可启动。完整论证见 ADR-0004（当前存放于项目文档目录，待迁入本仓库 `docs/decisions/`，迁移为 TASKS.md 中的待办项）。
- **被否决的替代方案**：
  - *继续最小增量*：仅加 AsciiDoc 解析器，其余能力不做。否决理由：无法满足引用校验与双语对齐这两项已被证实的真实需求。
  - *完全自建*：放弃 Geode。否决理由：损失 52,000 行已验证的外壳，工期从周级升至月级。
- **影响范围**：全部后续开发节奏与提交粒度。
- **复审条件**：任一层交付后评估是否仍有必要维持七层划分。

---

## D-003 样式体系转 SCSS，并保留两个 CSS 例外

- **日期**：2026-11-13
- **决策**：24 个 CSS 文件中 22 个转为 SCSS；`theme-bridge.css` 与 `export.css` 永久保留为 CSS。
- **背景**：项目规范要求样式层具备静态检查能力，SCSS 是默认通道。但两个文件通过 Vite `?raw` 以原文注入 `<style>`，编译后内容必须与源文件一致。
- **被采纳方案**：22 个转 SCSS，文件头加 `ADKM:` 变更标记；两个 `?raw` 文件保持 CSS；`:root` 与 `html[data-theme]` 的调色板保持 CSS 自定义属性，不转为编译期变量。
- **被否决的替代方案**：
  - *24 个全转*：`?raw` 会拿到未编译的 SCSS 源码，样式整体失效。
  - *调色板变量化*：Obsidian 主题在运行时覆盖这些变量，编译期常量会切断覆盖链；且 `theme-bridge.css` 头部要求调色板与其逐字同步，变量化后无法用文本检索校验。
- **影响范围**：样式层全部文件；后续任何样式改动须先构建并比对规则集合。
- **复审条件**：若放弃 Obsidian 主题兼容，`theme-bridge.css` 可并入 SCSS 体系。

---

## D-004 依赖升级到当前最新（React 19 / TypeScript 7 / Tauri 2.12 / CodeMirror 6.x）

- **日期**：2026-11-13
- **决策**：一次性将 React、React DOM、TypeScript、Tauri 前后端、CodeMirror 全部升级至当前最新版本。
- **背景**：项目刚建立基线，尚无功能代码依赖旧版 API；延后升级会使后续每层改造都背负版本迁移成本。此决策**偏离**工程规范的默认版本策略（「不求最新，求受支持且可复现」），故单独记录并说明。
- **被采纳方案**：
  - React / React DOM `18.3.1 → 19.3.1`；TypeScript `5.7.0 → 7.0.2`；`@tauri-apps/*` `2.2.0 → 2.12.4`；tauri crate `2.11.2 → 2.12.5`；`@codemirror/*` → 6.x 最新。
  - 升级前扫描 React 19 全部破坏性 API：`forwardRef`、`defaultProps`、`propTypes`、`useRef()` 空参、`ReactDOM.render`、legacy context，命中数为 0（52,286 行 / 180 文件），故组件逻辑零改动。
  - 实际改动集中在类型层：`tsconfig.json` 移除 `baseUrl`（TS 7 已删除）、`paths` 改 `./` 前缀；新增 `src/styles.d.ts` 声明副作用样式导入；三个组件改为从 `react` 显式导入 `JSX` 类型。
  - 验证链路：`tsc --noEmit` 0 错误 → `vite build` 通过 → CSS 产物 989 条规则与升级前等价 → `cargo build --release` 1 分 03 秒 → exe 启动正常。
- **被否决的替代方案**：
  - *停留在 React 18 / TS 5.7，按规范逐版本等待*：否决理由：规范关注的是「受支持、可复现、升级前审查」，而当前项目无历史包袱、无测试依赖，一次性完成迁移的边际风险低于分多次迁移；且 TS 7 的 `baseUrl` 移除是硬性断裂，越晚成本越高。
  - *拆成两个 PR 分别升级 React 与 TypeScript*：用户裁定保留单 PR。**这是对规范「主版本升级须单独提案」的显式偏离**，记录于此。补偿措施：两处主版本升级在同一 PR 内以独立提交区分，且提交信息列明版本区间。
  - *不升级，维持现状*：否决理由：TypeScript 7 为编译器实现更换（Go 版），长期停留在 5.x 会积累迁移债务。
- **影响范围**：全部前端依赖、Rust 侧依赖、构建配置、三个组件文件。
- **复审条件**：若 TypeScript 7 工具链（ESLint 相关插件）无法跟进，退回 5.9 LTS 并在本文件追加记录。

---

## D-005 保留 Obsidian 插件兼容层

- **日期**：2026-11-13
- **决策**：`src/compat/` 全部保留（约 10,397 行，占上游代码 20%）。
- **背景**：该层是唯一的大块可删项，删与留直接影响维护面。
- **被采纳方案**：保留。理由：使产品能加载 Obsidian 社区插件与主题，属差异化能力；该层只处理 Markdown，与 AsciiDoc 解析路径无冲突。
- **被否决的替代方案**：*删除兼容层*。否决理由：失去「Obsidian 生态可用」这一实质优势，且删除后无法回溯（上游已停更，无重新引入来源）。
- **影响范围**：维护成本结构。约束：兼容层的改动必须独立提交，以便度量其占用的开发时间比例。
- **复审条件**：若连续两个月中兼容层提交占比超过主线 30%，重新评估去留。

---

## D-006 根目录白名单的适用解释

- **日期**：2026-11-13
- **决策**：工程规范要求根目录仅允许六类条目。经核对，本项目根目录存在源码目录（`src/`、`src-tauri/`）与资源目录（`public/`、`scripts/`、`docs/`），严格按字面判定均属越界。
- **被采纳方案**：按「文件从严、目录从宽」解释执行——
  - 散文类文件与二进制一律移出根目录（`PROVENANCE.adoc`、`CONTRIBUTING.md`、`SECURITY.md`、`mtx.config.md` 移入 `docs/`，`app-icon.png` 移入 `assets/`）。
  - 源码与资源目录保留，但在 `README.md` 的「目录结构」字段逐一声明职责。
  - `CLAUDE.md` 降为单行引用 `AGENTS.md`，不再作为规则载体。
- **被否决的替代方案**：
  - *严格字面执行，把 `src/` 等目录移入白名单目录下*：否决理由：违反 Tauri 与 Vite 的默认路径约定，需改大量配置，收益为零。
  - *不整理，登记豁免*：否决理由：规范明确「白名单之外先问再做」，登记豁免不能替代整理。
- **影响范围**：根目录布局、文档链接、22 个 SCSS 文件头部的引用文字。
- **复审条件**：若规范后续为源码目录提供明确条目，按新条目重判。

---

## D-007 遗留的 `.claude/`、`.calibration/` 与 `nul`（待裁决）

- **日期**：2026-11-13
- **决策**：暂不处理，登记为待裁决事项。
- **背景**：
  - `.claude/` 内含上游的自主开发契约（agents / commands / hooks），其中「收到『继续开发』即全自主推进、不要反问」的条款与本项目规范「歧义必须询问」直接冲突，且构成第二份规则载体。
  - `.calibration/` 含上百个 `.mjs` 校准脚本，属上游自建测试工具链，与本项目规范「统一 Pwsh 脚本入口」不一致。
  - 根目录 `nul` 为 Windows 保留设备名残留文件，常规方式无法删除。
- **被采纳方案**：待 L2 完成后一并处置，避免与功能开发交叉。
- **被否决的替代方案**：*立即删除 `.claude/`*。否决理由：其中 hooks 可能仍被本地工具链读取，删除前需确认无工具依赖。
- **影响范围**：AI 协作规则的一致性、脚本入口统一性。
- **复审条件**：L2 交付时强制复审。

---

## D-008 引入 vite-plus 作为构建与工具链入口

- **日期**：2026-11-13
- **决策**：以 `vite-plus@1.6.0` 取代裸 Vite，作为 dev / build / preview 的入口。
- **背景**：项目需接入 lint、format、test 三通道（TASKS.md T-001 至 T-003）。vite-plus 将 Vite、Vitest、Oxlint、Oxfmt、Rolldown 打包为单一工具链，可一次到位；实测构建耗时由 7.29 秒降至 1.48–2.09 秒。
- **被采纳方案**：`vp migrate --no-interactive --no-agent --no-editor --no-hooks` 完成迁移，产生三处改动：`scripts` 改为 `vp dev|build|preview`；`vite` 通过 `overrides` 别名为 `@voidzero-dev/vite-plus-core@1.6.0`；`vite.config.ts` 的 `defineConfig` 改为从 `vite-plus` 导入。
- **被否决的替代方案**：
  - *维持 Vite 6，仅单独引入 oxlint + oxfmt*（原建议）：否决理由由用户裁定——需要统一的单入口，避免多套工具并存导致的规则冲突。**本条记录保留意见：该方案风险最低，若下列风险触发，回退到此路径。**
  - *等待 oxfmt 发布 1.0 再引入*：否决理由同上。
- **保留的风险（必须逐项验证）**：
  1. **隐式引入 Vite 8 与 Rolldown**。`vp toolchain` 显示实际为 `vite@8.3.7` + `rolldown@1.2.18` + `oxc@0.156.0`。这是一次未单独提案的主版本升级，与规范 §版本策略 存在张力，故在此留痕。
  2. **`@vitejs/plugin-react` 4.7.0 的 peer 依赖不匹配**（要求 vite ^6/^7，实际为 1.6.0 的 core 包）。**已于 2026-11-13 实测 dev 模式**：服务器 264 ms 就绪，`/` 与 `/@vite/client` 均 200；`main.tsx` 转换产出 `jsxDEV` 调用并注入 `@react-refresh`；改 SCSS 与改 TSX 均触发 `hmr update`，回滚同样触发。功能可用。
   遗留三条告警，均不阻断：
   - `[vite:react-babel] esbuild option deprecated, use oxc instead`
   - `Invalid key: "jsx"` —— Babel 插件把 `jsx` 选项传给 Rolldown，被拒但 Babel 路径仍生效
   - `optimizeDeps.rollupOptions deprecated` —— 上游插件所设，非本项目配置

   告警建议改用 `@vitejs/plugin-react-oxc`，**已核查不可行**：该包最新为 `0.4.3`（发布于 2025-11-12，已一年未更新），peer 仅声明 `vite ^6.3.0 || ^7.0.0`，不覆盖当前的 core 1.6.0（vite 8）。换用它会把一个 0.x 且滞后的包引入主构建链路，风险高于现有告警。
  3. **CSS 产物被 lightningcss 重新规范化**。比对结果：选择器 976 → 975，规则 989 → 988；135 处声明差异（`background:transparent` → `background:0 0`、`var()` 逗号后空格移除、自动补 `-webkit-` 前缀），11 处选择器写法差异（属性选择器转义、规则合并）。判定为等价规范化。
     **2026-11-13 已做视觉核对**：以浏览器模式加载改造后构建，**主界面**与改造前无可辨差异（使用者判定）。
     范围限定：仅主界面；设置页、图谱页、编辑器独立视图未逐一核对。结论：已核范围内无视觉回归，其余页面的回归风险依据「135 处差异全部定性为压缩器规范化」推断为低，但未经目视确认。
  4. **构建配置项更名**：`build.rollupOptions` → `build.rolldownOptions`。当前配置未使用该字段，无影响。
  5. **oxfmt 仍为 0.78.0**（未到 1.0），格式器行为可能变化。
- **附带收益**：Rolldown 的 `IMPORT_IS_UNDEFINED` 检查暴露了一处此前静默的兼容层限制——`src/compat/obsidian/loader.ts` 引用的 `tokenClassNodeProp` 在新版 `@codemirror/language` 中已不存在，代码以 `?? new NodeProp()` 兜底（源码注释已说明）。该限制为上游既有行为，非本次引入，但此前无人可见。
- **影响范围**：构建入口、依赖树、CSS 产物、Tauri 的 `beforeBuildCommand` 链路。
- **复审条件**：出现任一项即回退到「裸 Vite 6 + 独立 oxlint/oxfmt」——dev 模式 HMR 异常；CSS 视觉回归经确认；`vp` 升级导致构建不稳定。

---

## D-009 新建 `docs/plans/` 目录

- **日期**：2026-11-13
- **决策**：新建 `docs/plans/`，容纳 L2–L7 各层的实施计划。
- **背景**：规范 §目录结构与文件放置 的第二条判据要求「无同类可循时，位置选择记入 `DECISIONS.md`，写明选这个目录的理由，以及它未来要容纳什么」。`docs/` 下已有规范原文与来源声明，但没有任何目录承载「实施计划」这一类内容，属无同类可循。
- **被采纳方案**：`docs/plans/`，每层一份，命名 `L<n>-<主题>.md`。
- **被否决的替代方案**：
  - *写进 `TASKS.md` 的任务正文*：否决理由——任务队列应保持一屏可扫，设计正文会把条目撑到数百行，且完成判据会被正文淹没。T-012 现只保留目标、计划链接、完成判据三行。
  - *写进 `docs/decisions/` 与 ADR 同目录*：否决理由——ADR 记录的是「已决定的取舍」，计划记录的是「打算怎么做」。前者不可变，后者随实施修正，混放会让 ADR 的稳定性失效。
  - *沿用仓库外的桌面项目目录*：否决理由——违反规范的可达性要求，换机器即断链。
- **格式选择**：Markdown 而非 AsciiDoc。理由：`.adoc` 在 GitHub 不渲染，锚点失效，而计划文档需要被反复跳转与在上下文内读取。ADR 保持 `.adoc`（数量固定、以标题而非锚点引用），两种格式并存不构成「同一文档双格式」。
- **影响范围**：`docs/` 目录结构；`AGENTS.md` 与 `README.md` 的文档索引各增一条。
- **复审条件**：若某层计划膨胀到需要拆分子文档，改为 `docs/plans/L<n>/` 目录并在本文件追加说明。

---

## D-010 无扩展名链接按引用方格式优先解析

- **日期**：2026-11-13
- **决策**：`[[Note]]` / `xref:Note[]` 这类**不写后缀**的引用，先在同名候选中筛出与引用方同格式的目标；写了后缀的引用，后缀优先。两者都不命中才回退到「同目录优先、其次字典序」。
- **背景**：L2 让 `.adoc` 进入索引后，同一个目录下允许 `Amb.md` 与 `Amb.adoc` 并存。原有的解析只按「同目录 → 字典序」挑，字典序会让 `.adoc` 排在前，于是**仅仅新增一个 adoc 文件，就会把既有的 Markdown 链接改指向**。这类改动不报错、不改文件，只在图谱与反链里悄悄换边。
- **被采纳方案**：按引用方扩展名过滤候选。md 笔记的链接优先命中 md，adoc 文档优先命中 adoc；显式后缀（`xref:a/Note.adoc[]`）不受此规则影响。
- **被否决的替代方案**：
  - *保持纯字典序*：否决理由——违背 L2 的验收要求「md 部分图谱必须与接入前完全一致」，且用户无法从界面看出指向变了。
  - *固定优先 `.md`*：否决理由——adoc 文档之间互相引用时会被 md 同名文件抢走，adoc 侧同样出现静默改指向，只是把问题挪到另一边。
  - *禁止同名不同格式共存*：否决理由——需要在文件创建/重命名时拦截，属于 L3 的编辑期校验，且会否掉 `README.md` + `README.adoc` 这类合理布局。
- **影响范围**：`MetadataIndex.resolveLink`；图谱、反链、出链、链接重写全部经由它。
- **复审条件**：若出现「同名不同格式 + 引用方格式不是期望目标」的真实案例，改为在 UI 上显式呈现歧义（列出候选），而不是继续加优先级规则。

---

## D-012 阅读视图按格式分派，Asciidoctor 只在预览侧懒加载

- **日期**：2026-11-13
- **决策**：`.adoc` 的阅读视图使用 `@asciidoctor/core@4.2.1` 官方浏览器构建渲染；`.md` 继续走同步的 `renderMarkdownToHtml()`。解析器用动态 `import()` 按需加载，不进入主 chunk。
- **背景**：L2 让 adoc 进入索引后，阅读视图仍按 Markdown 渲染，`= 标题` 与 `|===` 表格显示错误。使用者实测发现。
- **被采纳方案**：索引与渲染两条路径继续分离（沿用 L2 计划 P3）。索引保持纯扫描（Blueprint 399 篇 67 ms），预览付出一次约 1.3 MB 的懒加载成本换取完整 AsciiDoc 语义。
- **被否决的替代方案**：
  - *索引也改用 Asciidoctor*：否决理由——全异步、体积大，会让文件级增量索引变成整文档批处理；ADR-0001 已实测过。
  - *把 Asciidoctor 打进主包*：否决理由——主 chunk 已 1.8 MB，再加 1.3 MB 会拖慢每个用户的冷启动，而多数 vault 没有 adoc。
  - *用 Rust 侧 CLI 渲染再回传 HTML*：否决理由——需要在每个平台分发 Ruby/CLI 运行时，且跨 IPC 传输大 HTML，复杂度远高于浏览器内转换。
  - *暂不渲染、只显示源码*：否决理由——使用者明确要求阅读视图正确，且 adoc 的核心价值就是结构化呈现。
- **配套决定**：`safe: "secure"`（禁用 include）、`outfilesuffix: ".adoc"`（保留源文件后缀以便应用内跳转）、链接后处理复用 `a.internal-link[data-target]`、样式隔离在 `.adoc-preview-view` 下。
- **影响范围**：`src/core/asciidoctorPreview.ts`（新增）、`src/features/editor/EditorPane.tsx`、`src/styles/adoc-preview.scss`（新增）、`src/main.tsx`、`package.json`。Markdown 预览路径零改动。
- **复审条件**：若需要展开 `include::`，引入自定义 IncludeProcessor 并同步确定 ADR-0002 的片段归属语义；若插件依赖 `data-line`，用 AST sourcemap 补齐。详见 `docs/plans/L3-asciidoc-preview.md` §4。

---

## D-013 复用 vscode-office 的库选型，扩展只读 AttachmentView 支持 office 多格式

- **日期**：2026-11-13
- **决策**：以 `cweijan/vscode-office` 验证过的「纯前端 DOM 库选型」为蓝本，在既有的**只读** `AttachmentView` 上扩展四种格式预览：Word（`.docx/.dotx`）用 mammoth 转语义 HTML；PowerPoint（`.pptx/.pptm`）用 jszip 解 OOXML 抽取每页文本与图片；EPUB（`.epub`）用 epub.js 分页阅读器；Excel（`.xlsx/.xlsm/.xls`）用 x-data-spreadsheet 提供**可编辑**表格，并通过 SheetJS 做解析/回写，显式「保存」才写回 `vault.modifyBinary`。
- **背景**：用户要求「融入 vscode-office 的代码支持各种格式」。核查发现 vscode-office 的价值在于它替我们验证过一套可复用的纯前端库组合（pdf.js / mammoth / pptxviewjs / SheetJS / epub.js），这些库本身是 Web 库、与 VS Code 运行时无关，可直接搬进 geode 的 Web 上下文，而它的扩展脚手架（依赖 `vscode` API）无法复用。
- **被采纳方案**：
  - 新增 `src/features/attachment/formatPreview.ts` 作为**格式→预览组件**注册表：小写扩展名映射到 `{ label, Component }`，组件内部用动态 `import()` 懒加载重型库，使其不进入主 chunk（已实测代码分割：xlsx ~424 KB、asciidoctor browser ~374 KB 各自独立分块）。
  - 扩展点落在 `AttachmentView` 而非 Markdown 编辑器：二进制文件（docx/pdf/xlsx）本就路由到 `fileViewType() → "attachment"`，且不应进入 CodeMirror 缓冲区与自动保存路径，故在其「other」分支挂载格式预览组件。
  - 数据安全保障：二进制内容只经 `app.vault.readBinary(path)` 进出；XLSX 的编辑改动**仅**在用户点「保存」时经 `vault.modifyBinary` 写回，绝不走 autosave。
  - 复用 vscode-office 的库清单并做版本钉选：`mammoth@^1.13`、`xlsx@^0.18.5`（SheetJS 官方 npm 最后版）、`x-data-spreadsheet@^1.1.9`、`jszip@^3.10`、`epubjs@^0.3.93`，并补 `less` 作为 devDep 供 x-data-spreadsheet 的 `index.less` 导入。
  - 新增 `scripts/verify-format-libs.mjs`：用真实库在 Node 侧回归核心逻辑（mammoth docx→HTML、xlsx 解析↔回写往返、pptx 文本+图片经 rels 抽取），4 项全 PASS。
- **被否决的替代方案**：
  - *直接并入 vscode-office 的扩展代码*：否决理由——其代码深度绑定 `vscode.*` API（命令、Webview、文件系统），无法在 geode 的 React/Tauri 上下文运行；真正可复用的是库选型，不是脚手架。
  - *DOCX/PPTX/EPUB 也做成可编辑*：否决理由——纯前端没有干净的可往返编辑器：docxjs 偏单向且样式保真有限；pptx 无成熟 Web 编辑器；epub 编辑超出本次范围。只有 XLSX 有成熟可编辑网格（x-data-spreadsheet）+ 稳定序列化（SheetJS），故仅 XLSX 支持编辑。DOCX 真编辑列为 phase-2（引入 docxjs 往返）。
  - *放进 Markdown 编辑器（CodeMirror）预览*：否决理由——二进制文件进入文本缓冲区会污染 autosave 与 diff 链路；既有 AttachmentView 路由已是正确归宿。
  - *把重型库打进主包*：否决理由——合计 >1 MB，会拖慢无此类文件的 vault 的冷启动；动态 `import()` 按需加载代价更低（多数 vault 无 office 文件）。
- **影响范围**：`src/features/attachment/formatPreview.ts`（新增）、`DocxPreview.tsx`、`PptxPreview.tsx`、`EpubPreview.tsx`、`XlsxPreview.tsx`（新增）、`AttachmentView.tsx`（编辑）、`src/styles/app.scss`（编辑）、`src/core/i18n/dict.views.ts`（编辑，新增 `attachment.rendering/save/saved/xlsxHint`）、`src/format-shims.d.ts`（新增，mammoth 缺类型声明）、`package.json`（依赖）、`scripts/verify-format-libs.mjs`（新增）。Markdown/adoc 预览路径零改动。
- **复审条件**：
  - 若确需 DOCX 真编辑，引入 docxjs 往返并新增可编辑分支（phase-2）。
  - 若 x-data-spreadsheet 停更，评估 Luckysheet / Univer 替代。
  - 真实浏览器/Tauri 运行下复核 x-data-spreadsheet 网格渲染与 epub.js 阅读器（当前仅构建+逻辑验证，DOM 渲染未目视确认）——首次 Tauri 起服时复核。
  - 这些库解析不可信文件，需持续关注 mammoth/xlsx/jszip/epubjs 的安全更新，必要时加 `safe`/净化。
