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
  - 新增 `scripts/verify-format-libs.ts`：用真实库在 Node 侧回归核心逻辑（mammoth docx→HTML、xlsx 解析↔回写往返、pptx 文本+图片经 rels 抽取），4 项全 PASS。
- **被否决的替代方案**：
  - *直接并入 vscode-office 的扩展代码*：否决理由——其代码深度绑定 `vscode.*` API（命令、Webview、文件系统），无法在 geode 的 React/Tauri 上下文运行；真正可复用的是库选型，不是脚手架。
  - *DOCX/PPTX/EPUB 也做成可编辑*：否决理由——纯前端没有干净的可往返编辑器：docxjs 偏单向且样式保真有限；pptx 无成熟 Web 编辑器；epub 编辑超出本次范围。只有 XLSX 有成熟可编辑网格（x-data-spreadsheet）+ 稳定序列化（SheetJS），故仅 XLSX 支持编辑。DOCX 真编辑列为 phase-2（引入 docxjs 往返）。
  - *放进 Markdown 编辑器（CodeMirror）预览*：否决理由——二进制文件进入文本缓冲区会污染 autosave 与 diff 链路；既有 AttachmentView 路由已是正确归宿。
  - *把重型库打进主包*：否决理由——合计 >1 MB，会拖慢无此类文件的 vault 的冷启动；动态 `import()` 按需加载代价更低（多数 vault 无 office 文件）。
- **影响范围**：`src/features/attachment/formatPreview.ts`（新增）、`DocxPreview.tsx`、`PptxPreview.tsx`、`EpubPreview.tsx`、`XlsxPreview.tsx`（新增）、`AttachmentView.tsx`（编辑）、`src/styles/app.scss`（编辑）、`src/core/i18n/dict.views.ts`（编辑，新增 `attachment.rendering/save/saved/xlsxHint`）、`src/format-shims.d.ts`（新增，mammoth 缺类型声明）、`package.json`（依赖）、`scripts/verify-format-libs.ts`（新增）。Markdown/adoc 预览路径零改动。
- **复审条件**：
  - 若确需 DOCX 真编辑，引入 docxjs 往返并新增可编辑分支（phase-2）。
  - 若 x-data-spreadsheet 停更，评估 Luckysheet / Univer 替代。
  - 真实浏览器/Tauri 运行下复核 x-data-spreadsheet 网格渲染与 epub.js 阅读器（当前仅构建+逻辑验证，DOM 渲染未目视确认）——首次 Tauri 起服时复核。
  - 这些库解析不可信文件，需持续关注 mammoth/xlsx/jszip/epubjs 的安全更新，必要时加 `safe`/净化。

---

## D-014 用 REA 逆向 Obsidian 本体作为 ADKM 的学习来源，且只学优先逻辑

- **日期**：2026-11-13
- **决策**：ADKM（以 geode 为底座）的后续完善，引入 **REA 逆向 Obsidian 本体** 作为学习来源，但学习范围**严格限定**为九条优先项——软件逻辑五条、代码逻辑四条；每条结论必须挂 REA Evidence ID、区分「观察/推断/未知」，且必须映射到 ADKM 的具体落点，**不可映射的结论不进 ADR**。
- **背景**：ADKM 此前从未逆向过 Obsidian 本体。既有 `docs/obsidian-clone-report.adoc` 核查的是 Opensidian / Geode / Lokus / Otterly / Mdit / Cherit 六个**社区开源模仿品**，回答的是「别人怎么模仿 Obsidian」，不是「Obsidian 自己怎么实现」。缺的是本体证据——缓存与增量策略、插件契约、模块边界、状态真源、失效边界，恰是 ADKM 完善时最容易踩坑处（如本项目已出现的「重计算全堵 UI 主线程」「多真源漂移」问题）。
- **分析目标（已核实）**：`主程序资源包`。同目录 `启动壳资源包`**仅是 Electron 启动壳，不是分析目标**——选错文件会导致整轮分析作废。
- **学习范围（只学优先项）**：
  - *软件逻辑*：① 文件/元数据缓存与增量更新策略；② 插件 API 契约与生命周期；③ 解析上下文与跨格式引用解析分层；④ 编辑视图与阅读视图分离；⑤ 大库下的性能调度（虚拟化、惰性加载）。
  - *代码逻辑*：⑥ 模块边界与依赖方向；⑦ 事件总线/订阅模型；⑧ 状态单一真源与持久化时机；⑨ 缓存失效与重算边界。
  - *明确不学*：UI 像素级实现、主题皮肤细节、与 ADKM 定位无关的边缘功能、第三方许可代码的逐行搬运。
- **被否决的替代方案**：
  - *继续只做开源模仿品核查*：否决理由——社区项目的实现水平参差（报告自身已做可信度分级），能借鉴的是产品形态而非工程实现深度；且社区项目天然只覆盖 Obsidian 的公开功能面，无法回答「它内部为何这样设计」。
  - *直接读 Obsidian 官方文档与公开 API*：否决理由——公开面只给契约，不给实现策略（缓存失效时机、事件总线拓扑、状态真源位置），而 ADKM 缺的正是后者。
  - *全量逆向并追求像素级复刻*：否决理由——与 ADKM「专业文档工程」定位冲突（像素级复刻是 D-002 已否定的路线）；且第三方许可代码不可搬运，只取思想不复制代码。
- **影响范围**：新增 `docs/technical-decisions/ADR-0005-*.adoc`；geode 侧 `TASKS.md` 新增 T-025（拆解任务本身），落地实现待办为 T-026 及之后。本决策不改任何运行时代码。
- **复审条件**：
  - 若 REA MCP 在重启后仍不加载工具，改用 `REA 分析子命令` CLI 兜底（该路径不需要 MCP 注册，且同样返回 Evidence 记录）。
  - 若 Obsidian 升级导致 asar 结构变化，重新确认分析目标指纹后再下结论，避免结论套用到新版本。
  - 若某条优先项经查证在 Obsidian 中并无对应实现，记为「不适用 + 理由」而非强行凑结论。


## D-015 首期形态＝侧边栏对话（不做内联改写）

- **日期**：2026-11-14
- **状态**：**已实施**（2026-11-15）。实现见 T-030e 对应提交。
- **决策**：AI 能力首期以**右侧栏对话面板**交付，围绕当前笔记问答/续写；编辑器内联改写（选中文本改写/摘要/翻译）不进首期。
- **背景**：基线无任何模型推理代码。侧栏面板可复用既有右侧面板体系（`RightPanelKind` + tab + i18n），改动面最小；内联改写需要额外的 diff 预览、撤销栈与编辑器事务集成。
- **拟定方案**：新增 `ai` 面板；上下文取当前笔记（字符上限 12,000，源文件 >2 MB 跳过）；输出不注入 HTML，仅按 ``` 围栏切分文本/代码段。
- **被否决的替代方案**：
  - *内联改写先行*：否决理由——需要 diff 预览与撤销语义，工期与风险都高于面板；且没有对话历史难以迭代提示词。
  - *两者同时做*：否决理由——工期约为只做面板的 1.8 倍，首期无法独立验收。
  - *以 Obsidian 插件实现*：否决理由——依赖第三方生态，兼容层无法保证一等公民面板与流式渲染。
- **影响范围**：`src/features/ai/*`、`RightPanelKind`、右侧 tab、`dict.panels.ts` / `dict.app.ts`。
- **复审条件**：需要「选中文本改写」时，重新评估编辑器集成与 diff/undo 方案。

---

## D-016 协议范围＝仅 OpenAI 兼容（本地模型复用同一协议）

- **日期**：2026-11-14
- **状态**：**已实施**（2026-11-15）。实现见 T-030c / T-030d。
- **决策**：只实现 OpenAI 兼容的 `POST {baseUrl}/chat/completions` + SSE；**本地模型不引入第二套协议**——Ollama、LM Studio、llama.cpp 均暴露 OpenAI 兼容端点，按预设 + 空 Key 处理。
- **背景**：一套协议即可覆盖 OpenAI、DeepSeek、通义千问（DashScope 兼容模式）、Moonshot、OneAPI、vLLM，以及全部主流本地服务端；原生协议差异集中在流式事件模型。
- **拟定方案**：协议解析只在 TypeScript 侧（`choices[0].delta.content`，兼容字符串与 parts 数组）；Rust 传输层保持供应商无关。
- **被否决的替代方案**：
  - *Anthropic 原生 `/v1/messages`*：否决理由——SSE 事件模型不同（`content_block_delta`），首期维护面翻倍，且可由兼容网关覆盖。
  - *Gemini 原生 `streamGenerateContent`*：否决理由同上。
  - *三家原生并行*：否决理由——首期无差异化收益，测试矩阵却 ×3。
- **影响范围**：`src/core/llm/types.ts`、`client.ts`、设置页预设。
- **复审条件**：需要原生特性（prompt caching、thinking、tool-use 语义差异）或兼容网关不可用时，再评估原生协议。

---

## D-017 流式策略＝首期即流式，复用 ureq（不引入 reqwest）

- **日期**：2026-11-14
- **状态**：**已实施**（2026-11-15）。实现见 T-030a / T-030d。
- **决策**：首期即做逐字流式；传输用**已在依赖中的 `ureq`** 的 `into_reader()` 逐行读 SSE，通过 Tauri 事件推送；**不新增 `reqwest`/tokio 依赖**。
- **背景**：现有 `http_request` 非流式、30 秒总超时、10 MB 上限，长回答会被截断；后补流式等于重写传输层。硬边界 #5 要求新增依赖须逐项放行，而 ureq 本身支持流式读取。
- **拟定方案**：Rust `llm_stream`（`timeout_read` 滚动超时 180s、`data:` 帧经 `llm:chunk`、`llm:done`/`llm:error` 各一次、`AtomicBool` 取消）；`std::thread::spawn` 保证命令立即返回。前端 `AbortSignal` → `llm_cancel`。
- **被否决的替代方案**：
  - *先非流式*：否决理由——受 30 秒与 10 MB 限制，且后续要重写传输层。
  - *`reqwest` + tokio*：否决理由——新增重量级依赖，对单路 SSE 无收益。
  - *前端 `fetch` 直连*：否决理由——浏览器 CORS 限制，且 Key 会进入 webview 上下文。
- **影响范围**：`src-tauri/src/main.rs`、`Cargo.toml`（仅 keyring，见 D-018）、`src/core/llm/client.ts`。
- **复审条件**：需要 HTTP/2 多路复用、连接池或代理精细控制时，再评估 reqwest。

---

## D-018 密钥存储＝系统凭据库（keyring，硬边界 #5 单点放行）

- **日期**：2026-11-14
- **状态**：**已实施**（2026-11-15）。实现见 T-030b / T-030f。
- **决策**：API Key 写入**操作系统凭据库**（Windows Credential Manager / macOS Keychain），经 `keyring` 3.6.3 的 `windows-native` / `apple-native` 特性；前端只持 `secretName` 句柄。`keyring` 作为硬边界 #5 的**单点审批项**，不夹带在其他改动中。
- **背景**：设置文件/localStorage 明文可被任何能读用户目录的进程取走；环境变量不适合分发给他人。凭据库不可枚举，因此 UI 只能列出「本应用创建过的名称」（索引在 localStorage，值为空）。
- **拟定方案**：`secret_set` / `secret_get` / `secret_delete`（`NoEntry` → `None`，删除幂等）；设置页「钥匙串」列出名称并允许删除，值不可回显。
- **被否决的替代方案**：
  - *设置文件/localStorage 明文*：否决理由——任何本地进程可读。
  - *仅环境变量*：否决理由——桌面端配置繁琐，不适合分发。
  - *自建加密文件*：否决理由——密钥管理等同自造轮子，且主密钥无处安放。
- **影响范围**：`src-tauri/Cargo.toml`、`Cargo.lock`、`main.rs`、`src/core/llm/secrets.ts`、设置页钥匙串分区。
- **复审条件**：需要 Linux 发行版时必须启用 `sync-secret-service`（或 `linux-native`）并补对应往返测试；若用户要求「导出/导入配置」，需明确 Key 不随配置迁移。

---

## D-019 AI 校对＝结构化 JSON 协议 + 复用唯一流式路径

- **日期**：2026-11-15
- **状态**：**已实施**（2026-11-15）。实现见 T-047。
- **决策**：AI 校对要求模型在**单个 `json` 围栏**返回 `{summary, issues:[{line, category, severity, message, suggestion}]}`；解析器接受围栏 / 裸 JSON / 花括号平衡扫描三种载体，并逐项降级（未知类别 → `other`、非法严重度 → `warning`、越界行丢弃并计数、缺字段丢弃并计数、`from` 由笔记原文重算）。校对动作只**发布一次性 turn**，由既有 AI 面板消费；不新建流式 UI。
- **背景**：T-046 已用确定性规则覆盖可判定项（断链、跳级、必填元数据、标点、术语变体、H1 结构）。AI 的增量价值只在规则判不了的语义问题；若回复是自由散文，则结果无法定位、无法跳转、也无法在 E2E 里断言——等于把已经做对的规则换成更贵且更不稳的版本。
- **被采纳方案**：提示词注入六条规则（`AUDIT_RULE_DOCS`）、术语词表、必填字段、同一篇笔记的确定性结果与「不要重复报告」指令；解析结果渲染在助手气泡下方，点击复用 `workspace.revealTarget`。提示词随 UI 语言（`criteria` / `criteriaEn`），规则文案保持单源。
- **被否决的替代方案**：
  - *纯散文回复*：无法跳转、无法回归断言，否决。
  - *流式增量解析*：半截 JSON 会算出错误行号，界面上出现「跳到第 0 行」比晚 2 秒出结果更糟，否决。
  - *新建独立校对视图*：等于第二套流式状态机与错误文案，下一次改动必然只改一处，否决。
  - *把 AI 结果写入 `workspace.docAuditReport`*：两种可信度混进一个数据结构（确定性真源 vs 单次对话猜测），否决。
  - *让模型直接给字符偏移*：模型不可信，偏移一律由「行号 + 笔记原文」重算，否决。
- **影响范围**：`src/core/llm/proofread.ts`、`request.ts`、`proofreadRunner.ts`、`src/features/ai/AiPanel.tsx`、`src/core/docAudit.ts`（`criteriaEn`）、命令 `ai:proofread-note`。
- **复审条件**：真实模型对 `line` 的准确率不足（误报跳转）时，改为要求模型引用原文片段、由前端反查行号；或接入原生 tool-use 后，用工具调用替代围栏协议。

---

## D-020 xref / include 的解析语义＝文件相对优先、库根相对兜底、歧义不臆断

- **日期**：2026-11-15
- **状态**：**已实施**（2026-11-15）。实现见 T-045 首片。
- **决策**：AsciiDoc 的两类引用按各自的真实语义校验，不套用 wikilink 规则：
  - `xref`：纯锚点与外部 URL 直接放行；普通路径按「**文件相对**精确匹配 → 补 `.adoc`/`.md` → **库根相对**」解析；显式 `./`、`../` 只按文件相对，不回退；Antora 资源 ID / family 前缀按**唯一同名文件**解析。
  - `include`：只按文件相对（前导 `/` 为库根）解析，**不做同名回退**；全库层面检测环，闭环只在一条边上报一次。
  - 结果三态：`resolved` / `broken` / `unresolved`（歧义），后者在面板与 AI 结果里是 warning，文案写明「匹配到 N 个文件，无法确定」。
- **背景**：`xref:b.adoc` 在 Asciidoctor 里指**当前文件所在目录**的 `b.adoc`；按 wikilink 的库根/同名规则判会验错对象。但本应用预览把 `href` 交给 Markdown 解析器（库根相对），若 lint 只认文件相对，就会出现「lint 说断了、点得开」的自相矛盾。
- **被采纳方案**：先文件相对、再库根相对；`AuditEnv.files` 提供路径表，缺省时两类检查诚实跳过（单篇审计无法判定）；两类别 `broken-xref` / `broken-include` 进入既有规则集，面板与 AI 提示词自动跟随。
- **被否决的替代方案**：
  - *沿用 `resolveLink`（wikilink 语义）*：否决理由——Antora 目标必然误报，普通相对路径又会验错文件。
  - *只按文件相对*：否决理由——与产品点击行为不一致，产生「站着不动也能点开」的假告警。
  - *include 也做同名回退*：否决理由——Asciidoctor 不回退，回退会掩盖真实的构建断裂。
  - *歧义报 broken*：否决理由——多组件库里同名文件常见，会把大量合法引用标红，噪声淹没真问题。
  - *本片解析 `antora.yml`*：否决理由——组件/版本是独立一片的工作量，先交付能在单组件库里立刻可用的校验。
- **影响范围**：`src/core/docsAsCode.ts`、`src/core/docAudit.ts`（两类规则、`AuditEnv.files`、环检测）、`src/core/docAuditRunner.ts` / `src/core/llm/proofreadRunner.ts`（`parseDocument` 与 files 注入）、`src/core/i18n/dict.app.ts`。
- **复审条件**：接入 `antora.yml` 后资源 ID 改为按组件/模块解析，本决策的「唯一同名」回退退化为兜底；若产品预览改用文件相对解析，则库根兜底应删除。

---

## D-021 Antora 资源 ID＝描述符为权威、省略版本不猜

- **日期**：2026-11-15
- **状态**：**已实施**（2026-11-15）。实现见 T-045 第二片；D-020 的复审条件由此条兑现，「唯一同名」回退退化为**无描述符库的兜底**。
- **决策**：库内每个 `antora.yml` 定义一个组件版本（根＝该文件所在目录，`version` 缺省视为无版本）；`modules/<module>/<family>/...` 下的文件按 `name@version:module:family:path` 建索引。显式资源 ID（`[version@]component[:module][:family$]path`）解析规则：
  - `version@` 精确匹配；未指定版本时**只采用当前文件所属的版本**，否则仅当该组件只有一个版本时才使用；多版本且无当前版本 → `unresolved`，文案写明「匹配到 N 个组件版本」；
  - `module` 缺省取当前文件所属模块，否则 `ROOT`；`family` 缺省 `page`；缺扩展名时补 `.adoc` / `.md`；
  - 两段式 `ROOT:page.adoc` 在第一段不是组件名、但确为当前组件的模块时，按 module 解释；
  - 有描述符的库中，显式资源 ID **不再回退唯一同名**，查不到即 broken；无描述符的库完全保持首片行为；
  - 纯路径目标（无资源 ID 段）仍走 D-020 的「文件相对 → 库根相对」，不改变产品点击语义。
  - 索引键统一小写比较（与既有 `DocIndex` 一致），不是大小写敏感的 Antora 全语义。
- **背景**：首片按唯一 basename 近似解析资源 ID，多版本组件里同一页面名必然重复，合法引用被标成「无法确定」，而不存在的版本又可能被同名文件误判为有效。组件/版本是 Antora 的基本盘，必须读描述符才能判定。
- **被采纳方案**：`src/core/antora.ts` 保持纯函数（解析、建索引、查资源 ID 全部无 I/O），`docAuditRunner.ts` 负责唯一的不纯步骤——枚举并读取 `antora.yml`——再把索引经 `AuditEnv.antora` 注入体检引擎。复用依赖树中已有的 `js-yaml@4`（兼容层已授权使用），**零新增依赖**。模块名集合在建索引时预聚合，避免每个 xref 遍历全库。
- **被否决的替代方案**：
  - *省略版本时取最高/最新版本*：否决理由——这是猜测，且 Antora 的 `latest` 是部署期概念，桌面本地库没有权威答案。
  - *多版本歧义报 broken*：否决理由——把「不确定」伪装成「确定错了」，与首片三态约定冲突。
  - *把纯路径也改成 Antora 语义*：否决理由——会改变无组件段 xref 与产品点击路径的既有契约，超出本片范围。
  - *引入 YAML 解析新依赖 / 手写 YAML 子集*：前者违反零新增依赖，后者会读错合法描述符，均否决。
  - *本片做组件/版本切换 UI*：否决理由——解析与校验是切换的前提，先交付可机器判定的语义层。
- **影响范围**：`src/core/antora.ts`（新）、`src/core/docsAsCode.ts`（`version` 段、`antora` 可选参数、`reason`）、`src/core/docAudit.ts` / `docAuditRunner.ts`、`tests/antora.test.ts`（新）、`tests/e2e/run.mjs`（夹具与第 9 条用例）。
- **复审条件**：接入真实 Antora 语料后若出现 `start_page` / `nav` / `asciidoc.attributes` 影响的解析，或需要大小写敏感、`_include` 目录、`latest` 版本别名时，重开此决策；「发布前检查 / 按组件导出」独立成片。

---

## D-022 电子书格式扩展＝只读优先、编辑能力冻结、新依赖逐项放行

- **日期**：2026-11-15
- **状态**：**已实施**（2026-11-15）。用户明确「更多支持电子书格式并不再追求修改」「图片也预览」「都做了」。
- **决策**：
  1. 新增格式一律**只读**：FictionBook 2（`.fb2` / `.fb2.zip` / `.fbz`）、漫画 ZIP（`.cbz`）；原有 EPUB / PDF / DOCX / PPTX 保持只读。
  2. **共享图片阅读器**：单张图片（png/jpg/jpeg/gif/webp/svg/bmp/ico/avif）与 CBZ 内页共用 `ImageReader`（翻页 + 缩放），替换原先的裸 `<img>`，但 blob URL 仍由 `AttachmentView` 的 effect 拥有与释放。
  3. **编辑能力冻结在 Excel**：保留 `XlsxPreview` 的显式「保存」写回，不再新增任何可编辑格式；**撤销 D-013 复审条件中的「DOCX 真编辑 phase-2」**，不再排期。
  4. **零新增运行期依赖**：FB2 用平台 `DOMParser`，压缩包用既有 `jszip`。MOBI/AZW3/DJVU/CBR/HEIC 等候选已按「先搜寻，后自研」检索评估并记入 `MANIFEST.md`，本片**不引入**，需用户单独放行后独立成片。
  5. 所有新预览组件统一经 `useFormatResource`（可取消加载 + dispose），吸收 PR #27 为 EPUB 建立的生命周期契约；已合并 PR #27 的 `EpubPreview` 保持原实现，不重写已通过 11 项回归测试的组件。
- **背景**：D-013 已否决 DOCX/PPTX/EPUB 的纯前端编辑；用户此次进一步明确放弃「修改」方向。而 `.fb2.zip` 这类复合后缀是 `fileExtension()` 看不到的，必须在 `formatPreviewer` 之前按完整路径判定；`.txt/.html/.xml` 又已被 `EDITABLE_TEXT_EXTS` 判为可编辑文本，不能当只读电子书加入注册表。
- **被采纳方案**：纯解析/选择逻辑放 `src/core/ebookFormats.ts`（可单测）；组件只负责读字节与渲染；FB2 解析结果渲染为 React 文本节点而非 HTML，避免不可信书籍注入标记；CBZ 图片按数值排序并显式 `revokeObjectURL`。
- **被否决的替代方案**：
  - *把新格式塞进 Markdown 编辑器*：否决理由——二进制/未知扩展名进入 CodeMirror 自动保存链路会破坏数据（R105 边界）。
  - *整体换用 foliate-js / epubier*：否决理由——API 不稳定或需多个 peer 依赖与 worker，与已验证的组件化只读路径重复，详见 `MANIFEST.md` 评估表。
  - *用 `innerHTML` 渲染 FB2*：否决理由——本地文件也可能来自外部，React 文本节点已足够且零风险。
  - *把 SVG 改成内联 DOM*：否决理由——会打开脚本执行面，保持 `<img>` 上下文。
  - *重写 `EpubPreview` 以共用 hook*：否决理由——PR #27 刚用 11 项组件回归固定了竞态与 `openFailed` 行为，重构收益低于回归风险；新组件复用同一契约即可。
- **影响范围**：`src/core/ebookFormats.ts`（新）、`src/features/attachment/{useFormatResource,ImageReader,Fb2Preview,CbzPreview}.tsx`（新）、`formatPreview.ts` / `AttachmentView.tsx` / `src/core/i18n/dict.views.ts` / `src/styles/app.scss`、`scripts/verify-format-libs.ts`、`tests/ebook-formats.test.ts`、`tests/e2e/run.mjs`、`MANIFEST.md`、台账与基线文档。
- **复审条件**：用户放行 B 档格式或新解码依赖时重开；CBZ 大体量（>100 MB）需改为流式/按需解压（当前 `readBinary` 全量入内存）；若将来要求统一只读（连 Excel 保存也移除），单独成片。

---

## D-023 组件/版本切换＝索引级 pin，不改体检引擎接口

- **日期**：2026-11-15
- **状态**：**已实施**（2026-11-15）。实现见 T-045 第三片；用户「继续执行」后按非阻塞调度推进（Q-005 仍需单独放行，故先做不依赖它的工作）。
- **决策**：文档体检面板新增「组件版本」选择器。选中某一版本时，所有**省略版本的 Antora 资源 ID** 按该版本解析，而不是按「当前文件所属版本」；带 `version@…` 的显式 ID **不受 pin 影响**；纯路径目标仍按 D-020 的文件相对语义。未选（自动）时行为与 D-021 完全一致。
- **背景**：库根/库外笔记里的 `xref:catalog:ROOT:index.adoc[]` 在多版本组件下只能诚实报「2 个组件版本，无法确定」；发布评审需要「以 2.0 为准看一遍」的确定性视图，不能靠改文档或猜最新版本。
- **被采纳方案**：
  - `AntoraIndex.activeComponent` 为可选字段；`withActiveVersion()` 与 `listComponentVersions()` 均为纯函数。`resolveAntoraResource` 在 pin 存在时忽略 `owner(fromPath)`，组件取 pin、`module` 缺省 `ROOT`。
  - `AuditReport.antoraVersions` 由 runner 附加（纯引擎不读描述符）；`docAuditActiveVersion` Store 是会话级单一真源，命令面板、「重新体检」按钮与下拉共用，`runDocAudit(deps, active?)` 省略参数即沿用上次 pin、传 `null` 回到自动。
  - 切换会重跑全库体检（重新读 descriptor 与笔记），报告与新 pin 一致；未知 component/version 对返回原索引，绝不臆造组件。
- **被否决的替代方案**：
  - *给 `AuditEnv` 新增 active 参数*：否决理由——会出现「索引 pin」与「环境 pin」两份语义；索引自带 pin 才能让 AI 校对、纯函数测试共用同一路径。
  - *自动选最新版本*：否决理由——D-021 已定性为猜测，`latest` 属部署期概念。
  - *UI 自己读 `antora.yml`*：否决理由——破坏 app/features → core 单向分层，且会产生第二份描述符解析。
  - *把 pin 写进 vault 文件*：否决理由——跨库污染本地知识库，且是用户未授权的外部写。
- **影响范围**：`src/core/antora.ts`（`listComponentVersions` / `withActiveVersion` / 解析优先级）、`src/core/docAudit.ts`（报告字段）、`src/core/docAuditRunner.ts`（Store + 签名）、`src/features/docaudit/{DocAuditView.tsx,docaudit.scss}`、`src/core/i18n/dict.app.ts`、`tests/antora-version.test.ts`、`tests/e2e/run.mjs`。
- **诚实缺口**：pin 只改变**引用解析**，体检仍扫描全库笔记，未做「只扫描所选组件版本的笔记」；发布前检查、按组件导出、xref 自动修复仍属下一片。**复审条件**：若需要按组件筛选结果集或导出，重开此决策并明确「扫描范围」与「解析范围」的分离。

## D-024 Q-005 结案＝只放行 Kindle 家族一个 MIT 依赖，其余 B 档仍不引入

- **日期**：2026-11-15
- **状态**：**已实施**（2026-11-15）。实现见 T-055；用户以「做 q005」放行新增运行期依赖后推进；依赖逐项登记见 `MANIFEST.md`。
- **决策**：Q-005 两问分别结案。①**放行新增运行期依赖，但只引入 1 个**——`@lingo-reader/mobi-parser@0.4.6`（MIT），落地 `.mobi/.azw/.prc` 与 `.azw3/.kf8` 只读预览；CBR/CB7、HEIC/HEIF、DJVU/TIFF/JXL/PSD/RAW **仍不引入**，需用户再次单独放行。②「连 Excel 保存也移除」的彻底只读**不做**，沿用 D-022 的编辑能力冻结（保留显式保存）。全部实现零写回：不调 `vault.modifyBinary`，不提供任何保存入口。
- **背景**：Q-005 原记「候选库已检索评估、未引入」，卡在「是否允许新包」。D-022 定下的 A 档（FB2/CBZ/图片）已交付，Kindle 家族是用户实际藏书里占比最高的待支持格式；继续不做的边际成本高于引入一个 MIT 小包。
- **被采纳方案**：
  - 只选**解析器**包，不选阅读器 UI 包：`@lingo-reader/mobi-parser` 自带浏览器独立入口（`dist/index.browser.mjs`），直接接受 `Uint8Array`，与既有 `readBinary → 懒加载 → 渲染` 链路同形，无需 worker 与打包配置。
  - 章节**按需加载**：只解析当前章节的 HTML，不在打开时把整本转成 React 树。
  - 不可信章节 HTML 一律降为**文本块**（标题/段落/图片），走 `DOMParser` + React 文本节点，绝不 `innerHTML`；`<script>`/`<style>`/注释子树整棵剥离。
  - 解析器自带 `destroy()` 负责释放其创建的 blob URL；组件卸载与切文件时调用，避免泄漏（与 `useFormatResource` 的可取消加载契约一致）。
- **被否决的替代方案**：
  - *`foliate-js`*：否决理由——作者明示 API 不稳定；引入等于把已稳定的 epub.js 链路整体替换，风险与收益不匹配。
  - *`@mdgate/mobi`*：否决理由——只输出 Markdown，不提取图片/字体，部分 AZW3 丢结构，作为「只读预览」会**静默丢内容**，比不支持更糟。
  - *`epubier`（drop-in 阅读器）*：否决理由——需 `pdfjs-dist` / `libarchive.js` 等 peer 与 worker，与项目组件化只读预览路径重复，且会一次性拉入多个新依赖。
  - *解压/解码类（`libarchive.js` 解 CBR、`libheif-js` 解 HEIC）*：否决理由——前者需 wasm worker 打包配置，后者是 **LGPL-3.0** 且 9 MB，均需单独做许可与构建评估；不在「只放行一个」的授权范围内。
  - *自行解析 MOBI（PalmDOC / HUFF-CDIC 压缩）*：否决理由——属「级别 6 自研」，HUFF-CDIC 与 KF8 边界情况多，成本远高于引入成熟包。
- **影响范围**：`package.json` + `package-lock.json`（`--save-exact` 钉选）、`src/core/mobi.ts`（纯函数：扩展名路由、章节 HTML 降级）、`src/features/attachment/MobiPreview.tsx`、`src/features/attachment/formatPreview.ts`、`src/core/i18n/dict.views.ts`、`src/styles/app.scss`、`scripts/verify-format-libs.ts`、`tests/mobi.test.ts`、`tests/mobi-preview.test.tsx`、`tests/e2e/run.mjs`。
- **诚实缺口**：真实 MOBI/AZW3 大部头未做真机解析验证（仓库不打包第三方电子书二进制，E2E 用**合成无效文件**验证路由与错误反馈，真实解析链路由 Node 侧导入回归 + 组件级 mock 覆盖）；DRM 保护文件必然失败并给出明确提示，不做任何解密；阅读偏好（字号/主题/进度）未做；CBR/CB7、HEIC/HEIF、DJVU/TIFF/JXL 仍不支持。**复审条件**：若需支持 CBR/HEIC 或阅读偏好，另开一片并重新评估 wasm 与许可；若 `@lingo-reader` 出现破坏性升级，可评估切换到 `rebook`（届时需重新走「先搜寻后自研」评估）。
