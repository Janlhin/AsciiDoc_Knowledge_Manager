# DECISIONS

追加式决策日志。每条记录被采纳的方案、被否决的替代方案与理由、影响范围与复审条件。

字段：编号 · 日期 · 决策 · 背景 · 被采纳方案 · 被否决的替代方案与理由 · 影响范围 · 复审条件。

---

## D-001 采用 ADKM 作为代码基线

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
- **背景**：实际核查发现目标能力与 ADKM 现状的差距为六个新增层（AsciiDoc 解析与编辑、引用校验、双语对齐、Canvas、Git、信息架构），而非一个解析器。在如此差距下维持最小增量，会导致大量代码写进上游文件，rebase 全面冲突。
- **被采纳方案**：七层结构 L1–L7，层内自洽、层间按序交付；禁止跨层并行；每层完成后 `npm run build` 必须通过且应用可启动。完整论证见 ADR-0004（当前存放于项目文档目录，待迁入本仓库 `docs/decisions/`，迁移为 TASKS.md 中的待办项）。
- **被否决的替代方案**：
  - *继续最小增量*：仅加 AsciiDoc 解析器，其余能力不做。否决理由：无法满足引用校验与双语对齐这两项已被证实的真实需求。
  - *完全自建*：放弃 ADKM。否决理由：损失 52,000 行已验证的外壳，工期从周级升至月级。
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
- **背景**：ADKM 此前从未逆向过 Obsidian 本体。既有 `docs/obsidian-clone-report.adoc` 核查的是 Opensidian / ADKM / Lokus / Otterly / Mdit / Cherit 六个**社区开源模仿品**，回答的是「别人怎么模仿 Obsidian」，不是「Obsidian 自己怎么实现」。缺的是本体证据——缓存与增量策略、插件契约、模块边界、状态真源、失效边界，恰是 ADKM 完善时最容易踩坑处（如本项目已出现的「重计算全堵 UI 主线程」「多真源漂移」问题）。
- **分析对象**：Obsidian 安装目录 `resources/` 下的主程序资源包，**非其启动壳**——选错对象会导致整轮分析作废，故阶段一先做对象核实。（具体路径与字节数已于 2026-11-16 公开前移出，不随仓库分发。）
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
  - 若 REA MCP 在重启后仍不加载工具，改用 REA 的 CLI 分析子命令兜底（该路径不需要 MCP 注册，且同样返回 Evidence 记录）。
  - 若 Obsidian 升级导致主体代码包结构变化，重新确认分析对象后再下结论，避免结论套用到新版本。
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

## D-025 编辑恢复＝覆盖全部可编辑文本；冗余边界＝应用内只做撤销级，跨盘交给系统

- **日期**：2026-11-16
- **状态**：**已实施**（覆盖规则，T-056）；**待裁决**（跨盘冗余路线，Q-006）。
- **决策一（已实施）**：文件恢复快照的覆盖范围，从「仅 `.md`」改为「**编辑器能当文本打开的全部格式**」——`.md`、AsciiDoc（`.adoc`/`.asciidoc`）、纯文本（`.txt`/`.log`/`.rst`/`.org`…）、源码与配置。判定复用 `isEditableTextPath()`（与附件路由器同一真源，`isAttachmentPath` 改为其否定式），二进制与未知扩展名永不快照。自动捕获新增 **512 KB 上限**；**强制捕获（还原前的当前内容备份）不受上限约束**。
- **决策二（立场）**：**应用层不提供跨盘/跨设备冗余**，也不静默向库外写入。跨盘由操作系统层承担（文件历史记录 / 卷影副本 / 存储空间镜像 / 网盘）。应用内只承诺「撤销级」恢复：可恢复删除（`.trash`）+ 编辑快照，两者都在库内同一磁盘上，**不防介质级事故**。
- **背景**：`isSnapshotable()` 原要求 `.md`，而 AsciiDoc 是本项目的双一等公民——最核心的格式反而没有任何编辑历史，属于覆盖缺口。同时用户询问「本地多盘冗余」，需明确产品边界，避免把「撤销键」误当「备份本」。章程 `:958` 已写「不做自动版本备份（属独立项目）」，T-048 已把同步服务列为结构性不做。
- **被采纳方案**：
  - 覆盖判定下沉到 `isEditableTextPath()`（`attachments.ts`），快照与附件路由共用一套扩展名语义，杜绝第二份清单漂移。
  - 上限只作用于**节流后的自动捕获**；`force` 捕获无视上限，因为还原会在覆盖前调用它，若因体积跳过就等于「没备份就覆盖」——破坏原有承诺。
  - 超限文件按路径记忆（`tooLarge`），避免每次保存都整份读入；库切换时清空该表与节流表。
  - 超限时**只告警一次**并入 `console.warn`，不静默吞掉。
- **被否决的替代方案**：
  - *只补 `.adoc`*：否决理由——用户明确要求「.adoc / txt 等文本」，且源码/配置同样是「能改就能改坏」，逐个白名单只会留下下一个缺口。
  - *把 512 KB 上限也套到强制捕获*：否决理由——会让还原在大文件上变成「无备份覆盖」，违背 R49 的数据安全承诺。
  - *自动向库外目录（另一块盘）写快照*：否决理由——需要新增静默写库外的通道，与「库内写、路径受限（`assertSafeRelPath`）」的既有边界冲突，须单独决策（Q-006）。
  - *应用内自研多盘镜像/双向同步*：否决理由——T-048 已定性为商业体量问题；且同步冲突（base 快照、diff3）是独立项目量级。
- **影响范围**：`src/core/attachments.ts`（导出 `isEditableTextPath`、`isAttachmentPath` 改为否定式）、`src/core/snapshots.ts`（覆盖判定、上限、`tooLarge`）、`src/core/i18n/dict.app.ts`（`recovery.noFile` 文案改为「文本文件」）、`tests/snapshots.test.ts`（新增 16 用例）、`tests/e2e/run.mjs`（第 13 条 `snapshot-text-formats`）。
- **诚实缺口**：`.trash` 与快照仍在库内同一磁盘，**不防磁盘故障**；快照保留 25 份/文件、节流 1 分钟，属「近期撤销」而非「长期归档」；超过 512 KB 的文本没有自动历史（仅还原时可强制捕获一次）；`.txt`/`.json` 等文件若被外部程序改写同样会生成快照，可能产生较多无关条目。**复审条件**：若用户选择 Q-006 的库外备份根或导出快照包，重开此条并把「备份」与「撤销」两条能力显式分开命名；若需要按格式配置保留份数/上限，另开一片。

## D-026 云端/异地副本＝可选能力，首形态为「分盘备份」；自研同步仍不做

- **日期**：2026-11-16
- **状态**：**已实施（首片，T-057）**。**局部修订章程** `:958`「不做云端服务，不做自动版本备份」——不再作为禁令，改为「可选、默认关闭、由用户显式指定目标」。T-048 的「同步服务不做」**继续有效**（指的是自研同步引擎）。
- **决策**：
  - ①**「云端」按最短路径实现**：应用不内置账号、协议、服务端，只把备份写成标准文件到**用户亲手选的目录**；用户把该目录指向 OneDrive/坚果云等客户端已同步的文件夹，就等于「上了云」。这样零协议、零冲突合并、零账号体系，却满足「用不用是用户的事情」。
  - ②**分盘备份**（学 Trilium / Obsidian 的取舍）：每次运行写一个带时间戳的 ZIP（原稿 + `.obsidian` 配置树），目标不得在库内，保留 `keep` 份（默认 10，上限 100），旧包按文件名顺序删除。
  - ③**写入与删除的权限边界**（关键）：新增三个窄命令 —— `export_write_binary`（绝对路径 + 临时文件 rename）、`export_list_backups`（只列出 `adkm-backup-*.zip`）、`export_delete_backup`（文件名不匹配即拒绝）。**N 名契约在 Rust 侧二次校验**，即使前端被 bug 或插件利用，也不可能变成通用 `rm`。
- **背景**：用户原话「做云端服务，用不用是用户的事情」「我们也学 Obsidian，但可选分盘备份」。此前 Q-006 的结论是「应用内只做撤销级，跨盘交给系统」，用户选择越过该边界。
- **被采纳方案**：单文件 ZIP/次（原子、易 prune、可被任何工具继续搬运）；`.trash` **排除**（删除恢复的辅助数据，体积大且非灾难恢复必需）；点目录排除（`.git`、插件缓存），`.obsidian` 单独精确采集；结果以底部通知反馈（成功给文件名与文件数，失败给原因码）。
- **被否决的替代方案**：
  - *自研同步引擎（账号 + 服务端 + 冲突合并）*：否决理由——T-048 定性为商业体量问题；冲突合并需要 base 快照与 diff3，是独立项目量级。
  - *逐文件镜像到第二块盘*：否决理由——非原子（中途失败会留下半套备份）、无法按"份"保留、且需要遍历删除，风险面远大于收益。
  - *后台静默写库外任意路径*：否决理由——与「库内写、路径受限」的既有安全边界冲突；本片只允许**用户显式选择的目录**，且只写本应用命名的压缩包。
  - *把备份做成默认开启*：否决理由——写用户没指定过的位置属越权；且大库全量 ZIP 有可感知的 IO 成本。
- **影响范围**：`src-tauri/src/main.rs`（3 个命令 + 注册）、`src/core/backup.ts`（设置、路径/命名规则、ZIP 组装、Tauri IO）、`src/app/App.tsx`（2 条命令 + 通知）、`src/main.tsx`（E2E 探针 `__geodeBackup`）、`src/core/i18n/dict.app.ts`（8 键）、`tests/backup.test.ts`（15 用例）、`tests/e2e/run.mjs`（第 14 条 `offdisk-backup`）、`docs/backup-guide.adoc`、`docs/project-charter-v2.adoc`（修订注）、`README.md`、`TASKS.md`、`CHANGELOG.adoc`。
- **诚实缺口**：**没有定时**（需设置界面，属下一片；当前只有手动命令）；**没有增量**（每次全量 ZIP，大库耗 IO）；**没有加密**（目标若为共享网盘，请自行放到加密卷/容器）；**不解决多机并发**（两台机器写同一个库仍会互相覆盖，这是同步引擎的范畴，本片明确不做）；网盘「占位文件」场景未实测（若库本身在 OneDrive 目录且启用按需下载，读取可能触发下载或拿到占位内容）。**复审条件**：若用户要求定时/增量/加密，重开此条并按「设置界面 → 增量包 → 加密容器」顺序分片；若要求真正的多端同步，回到 T-048 重新论证商业模式，而不是在本条上叠加。

## D-027 启动行为＝可选「恢复上次会话 / 全新窗口」，且 fresh 不覆盖快照

- **日期**：2026-11-16
- **状态**：**已实施**（T-058）。
- **决策**：新增独立设置分区「启动」，两项单选：**继续上次打开的标签**（默认，即既有行为）与**全新窗口打开**。语义刻意**非对称**：fresh 模式下启动既不重放快照，**也不覆盖**快照——切回 restore 时仍能恢复上一次真正被恢复过的会话；代价是 fresh 会话中的标签变化不被记忆，这一点写进设置说明，不做隐藏例外。
- **背景**：`Workspace` 自 T-035 起按库把面板树与标签持久化到 localStorage，并在构造时无条件重放，用户没有选择权；浏览器（Chrome/Edge）对同一问题给的是「继续浏览上次打开的网页 / 打开新标签页 / 打开特定网页」的显式设置。用户要求把这一层选择暴露出来。
- **被采纳方案**：
  - 设置存 `localStorage["adkm.startupMode"]`（全局，非按库——"怎么开窗"是用户偏好，不是库属性），解析容错：任何非 `fresh` 值一律视为 `restore`。
  - 三处闸门集中在 `core/startup.ts`（`shouldRestoreSession` / `shouldPersistSession`），`Workspace` 只在 `restore()` / `persist()` / `adoptVaultStorage()` 各问一次，避免把判断散落到 UI。
  - 切换即时写入并即时影响**下一次启动**；当前窗口不做热重排（否则等于替用户关标签）。
  - **空壳保护**：`fresh` 启动的会话在「还没有打开任何标签」时不写快照。没有这道保护，用户「fresh 启动 → 打开设置切回 restore」这一步的模态开关本身就是状态变更，会把 `tabs: []` 写回去，把承诺的可逆性直接破坏（E2E 第一次运行就抓到了）。一旦该会话打开过标签，持久化恢复正常——也就是说 fresh 会话用起来之后，它会成为新的「上次会话」。
  - 切库时同样遵循该设置：fresh 模式下打开另一个库也得到干净窗口，但那个库自己的快照不被删除。
- **被否决的替代方案**：
  - *三项，含「打开指定工作区」*：否决理由——已有具名工作区（R45）可手动应用，做成启动项需要选择器 + 启动时序编排，属独立一片；本轮先把用户明确要的两态做对。
  - *fresh 时清空持久化快照*：否决理由——不可逆，且让「切回 restore」失去意义。
  - *启动时弹框询问*：否决理由——每次启动都打扰，与知识库工具的高频打开习惯冲突。
  - *把开关放进命令面板而非设置*：否决理由——用户按浏览器的心理模型去设置里找，命令面板不构成可发现性。
- **影响范围**：`src/core/startup.ts`（新增）、`src/core/workspace.ts`（`restore` / `persist` / `adoptVaultStorage` 三处 gate）、`src/features/settings/SettingsModal.tsx`（分区 + 单选组件）、`src/core/i18n/dict.views.ts`（7 键 en/zh）、`src/features/settings/settings.scss`（单选行样式）、`tests/startup.test.ts`（4 用例）、`tests/e2e/run.mjs`（第 15 条 `startup-mode`）。
- **诚实缺口**：fresh 模式下不记忆标签（有意，已写入 UI 文案）；「最近关闭的标签」仍只在会话内（跨启动不保留）；没有「打开指定工作区 / 一组固定标签」；单窗口架构下不涉及多窗口状态。**复审条件**：若用户要求按工作区启动或"每次启动问一次"，重开此条并先补设置项语义（工作区选择器、询问频率），不要在现有两态上叠条件分支。

## D-028 首帧颜色＝内联引导决定，主题镜像到单一 localStorage 键

- **日期**：2026-11-16
- **状态**：**已实施**（T-059）。
- **决策**：在 `index.html` 的 `<head>` 里放一段**内联脚本 + 两行关键 CSS**，在 bundle 执行之前决定 `data-theme` 并给 `<html>` 上底色。主题的权威值仍在工作区快照里，但另**镜像**一份到 `localStorage["adkm.theme"]`（写入点：`setTheme()` 与 `applyDocumentEffects()`），内联脚本只读这一个键；键缺失/非法时按 `prefers-color-scheme` 解析，与 `resolveTheme("system", …)` 同语义。
- **背景（实测，不是猜测）**：用 CDP 在真机上装 `PerformanceObserver` 测启动——重载 800 条笔记的库，`first-contentful-paint` **176 ms**、`domContentLoaded` 71 ms、**无任何 >50 ms 长任务**、`metadataIndexMs` 0.9 ms（水合 800 条）。所以"启动那瞬间卡顿"不是 JS 计算量。真正的可见症状是**颜色闪变**：`app.scss` 的 `:root` 默认是深色（`--bg-app:#1e1e1e`），而 `data-theme` 要等 bundle 跑完才写，**浅色主题用户每次启动都会先看到一帧深色**，然后跳到浅色。
- **被采纳方案**：内联脚本只做三件事——读镜像键、必要时用 `matchMedia` 解析、写 `dataset.theme`；并用 `html{background:#1e1e1e} / html[data-theme="light"]{background:#f5f5f5}` 两行关键 CSS 保证首帧底色正确（两个字面量镜像 `--bg-app`，属 critical CSS，改色需同步）。全部包在 `try/catch` 里：存储被禁时退化为旧行为，绝不阻断启动。
- **被否决的替代方案**：
  - *内联脚本直接解析工作区快照*：否决理由——主题在**按库**的快照里（`geode.workspace.v2:<path>`），启动时不知道该读哪个键；遍历全部键既慢又可能读到别的库。
  - *把 CSS 默认改成浅色*：否决理由——只是把闪变方向反过来，深色用户（多数）变成受害方。
  - *窗口先隐藏、等 React 就绪再 show*：否决理由——会把"闪一下"换成"白屏更久"，且需要改窗口生命周期与失败兜底；作为后续优化保留，不在本片。
- **影响范围**：`index.html`（内联引导 + 关键 CSS）、`src/core/workspace.ts`（`mirrorThemeForBootstrap`，两处调用）、`src/main.tsx`（`__appScriptAt` 标记，供 E2E 校验先后顺序）、`tests/e2e/run.mjs`（`startup-mode` 增加断言：引导时间戳 ≤ bundle 开始、`data-theme` 已解析、计算出的底色与主题一致）。
- **诚实缺口**：只修"首帧颜色"。**WebView2 初始化与窗口创建的那段（页面内无法测量）没有优化**；`--editor-font-size` 仍由 JS 应用（会触发一次重排，不产生颜色闪变）；若系统主题在启动瞬间切换，内联值可能与随后的 `applyDocumentEffects` 不一致（随后纠正）。**复审条件**：若用户反馈的仍是"卡住不动"而非"闪一下"，改走窗口 show 时机与 WebView2 冷启动测量（需要进程级时间戳），不要再调 CSS。

## D-029 启动路径上的 PDF：延后到首帧之后，超过 32 MB 改为「点击加载」

- **日期**：2026-11-16
- **状态**：**已实施**（T-060）。
- **决策**：`AttachmentView` 的 PDF 分支做两件事——①**所有 PDF 都延后两帧**（跨过启动首绘）才开始 `readBinary`；②**超过 32 MB 的 PDF 不自动读取**，显示占位与「加载 PDF」按钮，用户点了才读（浏览器对大插件内容也是这个策略）。
- **背景（实测，用户先怀疑、后被证实）**：用户指出「可能是 PDF/EPUB 标签」。用 rAF 帧间隔探针在真机 release 上量：恢复 3 个 EPUB 标签（含 6 MB 重书）**无卡顿**；恢复 8 个笔记标签（4 个源码模式）+800 条笔记的库**无卡顿**；恢复**一个 60 MB PDF** → 首绘 112 ms 之后出现 **72 ms + 151 ms** 两次主线程阻塞。用户判断正确。
- **机制**：PDF 走 `<embed src=blobUrl>`，需要先把整份文件经 IPC 读入、复制成 `Uint8Array`、再 `new Blob` ——这三步都在主线程，成本随文件线性增长；WebView2 的 PDF 查看器本身在独立进程（所以 4.4 MB 时无感，60 MB 才暴露）。
- **被采纳方案**：双闸门（时间闸 + 体积闸）。体积取自文件树里的 `size`（桌面端由 Rust `vault_list` 用 FS metadata 填充），拿不到 size 时**只延后、不拦截**——宁可慢一点也不能让用户永远打不开。延后用两次 `requestAnimationFrame`（最小可验证单位），组件卸载时取消。
- **被否决的替代方案**：
  - *只延后、不做体积闸*：否决理由——只是把 151 ms 从"启动瞬间"挪到"启动之后 200 ms"，用户仍会感到卡；且 200 MB 扫描书会把延后变成 1 秒级卡顿。
  - *只做体积闸、不延后*：否决理由——32 MB 以下的 PDF 仍会在启动首绘阶段争用主线程。
  - *改造成 pdf.js 渲染（可控分页）*：否决理由——新依赖 + 重新实现文本层/选中/缩放，超出本片；体积闸已消除启动成本。
  - *永久要求点击（所有 PDF）*：否决理由——对日常小 PDF 是明显退步，用户会认为是 bug。
- **影响范围**：`src/features/attachment/AttachmentView.tsx`（`armed` 状态、尺寸读取、双闸门、占位 UI）、`src/core/i18n/dict.views.ts`（`attachment.pdfLoad` / `attachment.pdfLarge`）、`src/styles/app.scss`（`.attachment-pdf-load`）、`tests/e2e/run.mjs`（夹具新增 `docs/scan-small.pdf`（结构合法）与 `docs/scan-big.pdf`（40 MB 零字节，内容从不被读）+ 第 16 条 `pdf-startup-gate`）。
- **诚实缺口**：32 MB 是**经验阈值**，不是从硬件模型推出来的；超大图片、超大视频仍走原路径（没有同类实测）；`.workbuddy` 之外的其它重格式（docx/xlsx/epub）本轮未加闸；用户在「点击加载」后仍会有一次与文件大小成正比的卡顿（不可避免，除非换成分页式渲染）。
- **复审条件**：若用户报告「大 PDF 点开也会卡很久」，下一步是引入分片读取或 pdf.js 按页渲染，而不是继续调阈值；若报告「小 PDF 打开也慢」，先量再动，别凭阈值猜。

## D-030 EPUB 阅读器补全：目录 + 阅读位置，不引入全文索引

- **日期**：2026-11-16
- **状态**：**已实施**（T-061）。
- **决策**：EPUB 预览补上**目录面板**（epub.js `book.loaded.navigation`，按层级缩进、当前章高亮）、**翻页**（按钮 + 方向键）、**阅读位置持久化**（`relocated` → CFI + spine 百分比，去抖 400ms 写入 localStorage，按库路径命名空间）。**百分比用 spine 索引算**，不用 `book.locations.generate()`。
- **背景**：用户反馈「EPUB 预览也有问题（目录/进度不对）」。读代码发现比"不对"更彻底——83 行的组件只做了 `rendition.display()`：**没有目录、没有 relocated 监听、没有位置读写**，每本书永远从第一页打开，跳转一关就丢。这条能发布出去的直接原因是 **EPUB 在 E2E 里一条用例都没有**（ebook 那条只覆盖 FB2/CBZ/图片）。
- **被采纳方案**：
  - TOC 由纯函数 `flattenToc` 拍平（丢无 href 项、空标签回退文件名、保留 depth），可直接单测；「当前章」用 `sameDocument` 比较（忽略锚点与 URL 编码），解决 epub.js 报 `ch1.xhtml` 而 nav 写 `ch1.xhtml#s1` 的常见不一致。
  - 位置存 `{cfi, index, percent}`；恢复用 `display(cfi)`，**失败回退 `display()`**（文件被替换时不能白屏）。
  - 百分比 = `(spineIndex+1)/spineLength`，成本 O(1)。
- **被否决的替代方案**：
  - *`book.locations.generate()` 求准确百分比*：否决理由——它遍历每个 spine item 做字符统计，50MB 的中文书在主线程要数秒，等于把 PDF 那类卡顿搬到 EPUB 上；进度条精度不值这个代价。
  - *把阅读位置写进 `.obsidian`（跟库走）*：否决理由——跨机器互相同步"读到哪"会互相覆盖，且与 D-027 的会话语义冲突；机器本地偏好更适合 localStorage（本片取舍，若用户要多端接续需另开一条并要求冲突策略）。
  - *引入第三方 EPUB 阅读器组件*：否决理由——新增运行期依赖需 Q-005 放行，且现方案的缺口只是 UI 与持久化，不需要换引擎。
- **影响范围**：`src/core/epubNav.ts`（新增：拍平/比较/位置存取/百分比）、`src/features/attachment/EpubPreview.tsx`（重写：TOC、翻页、恢复、去抖保存）、`src/core/i18n/dict.views.ts`（4 键 en/zh）、`src/styles/app.scss`（工具栏/侧栏/高亮）、`tests/epubNav.test.ts`（9 用例）、`tests/epub-preview.test.tsx`（mock 补 `getVaultPath`）、`tests/e2e/run.mjs`（新增真实 EPUB 夹具 + 第 17 条 `epub-toc-progress`）。
- **诚实缺口**：位置按**机器+库**保存，不跨设备；CFI 依赖文件不变，换文件后只能回到第一页；TOC 层级缩进但不折叠（超长目录要滚动）；未做字号/主题/分栏偏好（epub.js 支持，但属另一片）；未做"全书搜索"（需 `locations.generate()` 或自定义索引，成本已知）。**复审条件**：若用户要求跨设备接续或全书搜索，先评估把 EPUB 解压搬进 Rust（D-029 的技术方向）再谈位置与索引，否则又会回到主线程卡顿。

## D-031 原始字节 IPC：把文件内容的 base64 搬运税移出主线程

- **日期**：2026-11-17
- **状态**：**已实施**（T-062 / P0-1）。
- **决策**：桌面端 `vault_read_binary` 改为返回 `tauri::ipc::Response`（原始字节；前端拿到 `ArrayBuffer` 后直接 `new Uint8Array`），`vault_write_binary` / `vault_modify_binary` 改为接收 Tauri 原始 body（`tauri::ipc::Request`），vault 路径与相对路径放在 header（base64 编码 UTF-8，兼容中文路径）。**只对这两条短路径字符串编码，绝不编码文件内容。**
- **背景（实测）**：旧链路 Rust 先 base64 编码，前端 `atob` + 逐字节循环；144 MB 文件在页面上实测 `atob` 106 ms + 循环 216 ms ≈ **322 ms** 主线程时间，外加 201,326,592 字符中间字符串。用户要求「全场景支持多核」，这是所有大文件场景的共同前置。
- **被采纳方案**：Tauri 2 官方 `ipc::Response` 与 raw `Request` body；Rust 仍用 `#[tauri::command(async)]`，文件 IO 留在 worker 线程。MemoryVaultAdapter 与所有上层调用签名不变。
- **被否决的替代方案**：
  - *只在 Worker 里跑 `atob` + 循环*：否决理由——仍要在 Rust 编码、仍多出 33% 字符串体积和复制；原始字节是更短的链路。
  - *用 Tauri Channel 分块流式传输*：否决理由——本轮目标是替换编码方式而非重新设计分块协议；大文件的按需读取要等 P0-2（Rust 解压/分章）。
  - *把 base64 编码也移到 Rust 的多线程运行时*：否决理由——前端解码依旧在主线程，解决不了核心成本。
- **影响范围**：`src-tauri/src/main.rs`（3 个命令 + 2 个头部/body 辅助函数）、`src/core/vault.ts`（TauriVaultAdapter 的 `invokeBinary` 与 3 个方法）、`tests/e2e/run.mjs`（新增第 19 条 `raw-binary-ipc`：40 MB 文件 read→write→read 字节一致且主线程帧间隔为 0）。
- **验证**：`npm run typecheck` 0；`cargo check` 0；`npm test` 193 passed；`npm run build` 0；`npx tauri build --no-bundle` 产出 `adkm.exe`；真机 E2E **21/21**（`raw-binary-ipc`：40 MB 拷贝 976 ms、主线程阻塞 0 ms）；`--self-check` OK。
- **诚实缺口**：**这不是「全场景多核」的完成态**。本项只消除传输编码成本；EPUB/PPTX 解压仍在 JS 主线程（P0-2），备份 ZIP 仍由 JSZip 在主线程生成（P0-3），docx/xlsx/asciidoctor/索引解析仍在 JS 主线程（P1），图谱布局仍在 JS 主线程（P2）。
- **复审条件**：若 raw `Request` 在其它平台（macOS WKWebView / iOS）不能保留 header 或 body，应把 header 改成 command 参数并改走 Channel，再重开本条。

## D-032 AsciiDoc 转换进 Worker：CPU 卸载，不宣称卡顿改善

- **日期**：2026-11-17
- **状态**：**已实施**（T-062 / P1-3）。
- **决策**：新增 `src/core/asciidoctor.worker.ts`，由专用 Web Worker 持有 `@asciidoctor/core` 并执行 `convert(source, options)`；主线程只做 `sanitizeHtml` + `localizeLinks` 两个轻量字符串处理。Worker 不可用或失败时自动回退到原来的页内动态 import，保证预览不中断。
- **背景**：用户要求「全场景支持多核」。P0-1 已完成原始字节 IPC；P0-2（EPUB 解压进 Rust）因新增 `zip` crate 撞硬边界 #5、未获放行而暂缓，故先做零新依赖的 P1-3。
- **实测（同一 release）**：E2E 夹具（5000 节）Worker 47 ms vs 页内 38 ms；独立探针（1000 节）启动的 5 ms 定时器在两条路径上的延迟约 1 ms / 0 ms。**结论：`@asciidoctor/core` 自身会把转换切成异步片段，主线程并未被长时间堵住；本项的价值是把 CPU 时间移到独立线程，不是消除用户可感知的卡顿，也不宣称更快。** 早期用 rAF 帧间隔做判据时该环境下出现 0ms/0ms 的不可判别结果，已改为「Worker 实际产出且 HTML 与页内一致」的断言。
- **被采纳方案**：单 Worker + id 路由；`isAsciiDocWorkerActive()` 暴露给探针；`renderAsciiDocPreview(source, { forceInPage, skipCache })` 仅供对照探针使用，其它调用点保持原签名。
- **被否决的替代方案**：
  - *把 sanitize/localize 也搬进 Worker*：否决理由——它们只是两次字符串替换，跨线程回传反而增加传输；且主线程 DOM 更新仍必需。
  - *Worker 池按硬件并发数创建多个转换器*：否决理由——编辑器一次只渲染活动预览，没有并发请求；池会徒增内存与复杂度。
  - *新增 `zip` crate 先做 P0-2*：否决理由——撞硬边界 #5，未获用户签字，不自行放行。
- **影响范围**：`src/core/asciidoctor.worker.ts`（新增）、`src/core/asciidoctorPreview.ts`（Worker 桥 + 回退 + 探针参数）、`src/main.tsx`（`__geodeAdocProbe`）、`tests/e2e/run.mjs`（第 19 条 `adoc-worker-offthread` + 大文档夹具）。
- **验证**：`npm run verify` 0；`npx tauri build --no-bundle` 成功；真机 E2E **22/22**（`adoc-worker-offthread`：Worker active、HTML 一致）；`--self-check` OK。
- **诚实缺口**：Worker 失败后的页内回退仍占主线程；转换总耗时未下降（47 vs 38 ms）；未做 docx/xlsx/索引的 Worker 化（P1 其余项）；EPUB/PPTX 解压仍在 JS 主线程（P0-2，待依赖授权）。
- **复审条件**：若用户要的是**可测量的卡顿降低**而非 CPU 卸载，需先给出可复现的卡顿场景和基线，再决定是否值得继续搬；单纯把更多东西丢进 Worker 不自动等于更快。

## D-033 DOCX/XLSX 解析进 Worker：CPU 卸载，不宣称提速

- **日期**：2026-11-17
- **状态**：**已实施**（T-062 / P1-1 + P1-2）。
- **决策**：DOCX 用 `docx.worker.ts` 持有 mammoth 的 `convertToHtml`；XLSX 用 `xlsx.worker.ts` 持有 SheetJS 的 `read` + `sheet_to_json`。两条都在组件侧保留 id 路由、Worker 失败回退页内解析；XLSX 的网格渲染与显式 Save（序列化）仍在主线程——前者依赖 DOM，后者是用户动作，不自动写盘的安全边界不变。
- **背景**：用户要求「全场景支持多核」，并明确继续做。P0-2 仍需新增 `zip` crate、未获签字，故继续零新依赖的 P1。
- **实测（同一构建、真机 CDP）**：DOCX Worker 46 ms vs 页内 9 ms、HTML 一致；XLSX Worker 25 ms vs 页内 18 ms、1 个 sheet、数据一致。**这些数字不证明提速**；测量目的是证明 CPU 工作确实发生在 Worker 且产出等价。小文件里启动/序列化开销会盖过解析成本。
- **被否决的替代方案**：
  - *把 x-data-spreadsheet 网格也搬进 Worker*：否决理由——它直接操作 DOM，无法在 Worker 运行；强行 OffscreenCanvas 等于换组件。
  - *把 Save 序列化也搬进 Worker*：本轮不做——保存路径涉及 `vault.modifyBinary` 与显式用户意图，保持简单可审计；若未来量出保存卡顿再开独立片。
  - *新增 zip crate 先做 P0-2*：仍因硬边界 #5 未获放行。
- **影响范围**：`src/features/attachment/docx.worker.ts`（新增）、`xlsx.worker.ts`（新增）、`DocxPreview.tsx`、`XlsxPreview.tsx`、`src/main.tsx`（两个对照探针）、`tests/e2e/run.mjs`（新增 docx/xlsx 夹具与两条用例；新增 `--only=<case>` 过滤能力用于隔离用例）。
- **验证**：`npm run verify` 0；`npx tauri build --no-bundle` 成功；真机 E2E **24/24**；`--self-check` 23/24 且 outline 用例按预期变红。
- **诚实缺口**：Worker 启动与结构化克隆仍有成本；大文件的收益未被专门量化（夹具为 120 段 docx / 300 行 xlsx）；Save 序列化仍占主线程；docx/xlsx 两个 Worker 同时存在但未做并发压测。
- **复审条件**：若用户提供真实大 docx/xlsx 并报告卡顿，先用 `--only` 单用例和对照探针量化，再决定是否扩大夹具或移动 Save。

## D-034 重内容默认点击加载，设置可切自动

- **日期**：2026-11-17
- **状态**：**已实施**（Q-007 结案）。
- **决策**：恢复会话时，PDF/EPUB/Office/CBZ 等重内容**默认“点击后加载”**：只恢复标签，显示“加载内容”按钮，点击前不读取文件。设置 → 启动行为新增“恢复的附件”单选，可切为**自动加载**（包括 32MB 以上的 PDF）。设置保存在机器本地 `localStorage`，不写入用户库。
- **背景**：原实现只对 32MB 以上 PDF 做体积闸，EPUB/Office 全部自动加载；用户库有 14 本 PDF（多为 20–144MB）与 8 本 EPUB，明确要求默认点击、可改自动。
- **被采纳方案**：新增 `core/heavyLoad.ts`（`auto` / `onDemand`，缺省/损坏值归一为 `onDemand`）；`AttachmentView` 在 onDemand 下统一闸住 PDF 与 `formatPreviewer` 的格式；auto 下取消 32MB 体积闸，仅保留 PDF 两帧延迟以避开首绘。
- **被否决的替代方案**：
  - *保留 32MB PDF 闸并让 auto 只作用于 EPUB*：否决理由——用户库里多数扫描书 >32MB，自动模式将名不副实。
  - *把设置写进 `.obsidian` 跟随库*：否决理由——启动性能是机器属性，跨设备同步会互相覆盖；与 D-027 的会话语义一致。
  - *onDemand 只闸 PDF*：否决理由——用户明确要求“重内容”，EPUB/Office/CBZ 的解压同样是大开销。
- **真实库测试（只读复制到临时库，原库未改）**：22 本（14 PDF + 8 EPUB，合计 757,674,358 字节）。onDemand：22/22 在 3–11ms 显示占位，零文件读取。auto：22/22 成功挂载，最慢 697ms（PDF），EPUB 均 <100ms。重启后 22 个标签恢复；实测**只有当前标签挂载**（1 个 attachment-view），其余按需挂载——所以“22 标签恢复”不等于“22 本同时进内存”。
- **影响范围**：`src/core/heavyLoad.ts`（新增）、`src/features/attachment/AttachmentView.tsx`、`src/features/settings/SettingsModal.tsx`、`src/core/i18n/dict.views.ts`、`tests/heavyLoad.test.ts`、`tests/e2e/run.mjs`。
- **验证**：`npm run verify` 0（19 个测试文件）；`npx tauri build --no-bundle` 成功；相关 E2E 用例通过；真实库记录见 `.workbuddy/tmp/real-books-*.json`（临时副本已清理）。
- **诚实缺口**：真实库测试使用的是**副本**，不是应用直接指向原库；22 标签重启只挂载当前标签，未验证“22 本同时渲染”的极端场景；onDemand 下切换标签仍需一次点击；PDF 大小阈值不再作为闸门，Q-008 因此失效。
- **复审条件**：若用户要求“恢复时预加载前 N 个标签”或“仅大文件点击”，需重新定义策略；本次只实现二态开关。

## D-035 备份分块写入：修掉大库静默产出 0 字节归档

- **日期**：2026-11-17
- **状态**：**已实施**（T-057 回归修复）。
- **问题**：真实库全量测试时，440MB 夹具让备份产出**0 字节 ZIP，但命令仍返回 ok:true**——这是静默数据丢失，不能留。
- **根因**：`tauriBackupIO.writeBinary` 把整个归档编成一个 base64 参数（440MB → 约 590MB 字符串）。实测该单参数路径在 Tauri IPC 上失效，Rust 侧收到空数据并成功写了空文件；现有 ZIP 读取测试只有在归档非空时才会发现。
- **决策**：`export_write_binary` 保留兼容，但备份改用 **begin / append / finish** 三个窄命令，前端按 **4MB** 分块 base64 传输；Rust 追加写入 sibling temp，finish 时 rename，失败保持原子性与旧语义。
- **同时修正测试污染**：`prepareVault` 现在先校验目录名包含 `e2e-vault` 再清空；`raw-binary-ipc` 每轮复制 40MB PDF 曾让夹具累积到 440MB，正是它触发了这条缺陷。
- **验证**：同一 440MB 夹具，分块后生成 **461,536,071 字节** ZIP，`JSZip.loadAsync` 可读 40 个文件条目；完整 E2E **24/24**；`--self-check` 23/24（outline 按预期红）；`npm run verify` 0；`npx tauri build --no-bundle` 成功。
- **影响范围**：`src/core/backup.ts`、`src-tauri/src/main.rs`（3 个新命令 + 注册）、`tests/e2e/run.mjs`（清空夹具）。
- **诚实缺口**：仍未把 ZIP 压缩本身搬到 Rust（P0-3）；分块写入有多次 IPC 往返，440MB 备份约 15.5 秒；未做备份中断/磁盘满的故障注入。
- **复审条件**：若备份继续做大（多 GB）或需要进度条，应直接改用 Rust `zip` crate 流式写盘（需硬边界 #5 放行）。

## D-036 Q-011 spike：WebGL 能画 10 万，布局不能交互

- **日期**：2026-11-17
- **状态**：**spike 完成；生产改造未做，待 Q-011 最终选择**。
- **问题**：用户问 WebGL 理论上能否支撑 10 万节点。需要区分“绘制”与“力导布局”，并用本机数据判断是否值得换架构。
- **实测环境**：Windows 本机；布局为 Node 26 + d3-force（与 GraphView 同一组 force：link/charge/center/radial/collide，alphaDecay 0.03）；渲染为 Edge Chromium 1200×800，WebGL points+LINES vs Canvas2D，无标签。
- **布局实测（合成图，约 2 边/节点）**：
  - 1k 节点 / 2k 边：build 0.8ms，首次 tick 8.3ms，平均 2.8ms，227 tick **settled**，约 637ms。
  - 10k / 20k：build 4.3ms，首次 50ms，平均 **42.5ms**，227 tick settled，约 **9.66s**。
  - 50k / 100k：首次 386ms，平均 406ms，15s 仅 38 tick，**未 settled**。
  - 100k / 200k：首次 **1026.8ms**，平均 **924.7ms**，15s 仅 17 tick，**未 settled**。
- **渲染实测**：1k/10k/50k/100k 节点下，WebGL **0.0/0.1/0.4/0.6ms**，Canvas2D **0.6/2.0/9.1/16.7ms**（均无标签）。
- **结论**：WebGL 只解决光栅化；10 万节点的 d3-force 布局是分钟级，不能 60fps 交互。以当前 419 节点/88 边的真实图谱，Canvas2D 已足够，**不应换 WebGL**。若未来要做 10 万级，必须先换布局（Worker/GPU/预计算）并加聚类/LOD/搜索，不能只换渲染器。
- **工具**：`scripts/graph-scale-bench.ts`（`npm run bench:graph-scale`）、`scripts/graph-scale-webgl.html`（浏览器绘制对照，手工用静态服务器打开）。
- **未做**：没有修改生产 `GraphView`；没有把 `RENDER_CAP` 从 3000 调到 800；没有做 GPU 力导原型；渲染测试不是 Tauri WebView2 内的直接测量。
- **复审条件**：节点数 ≥2000 且实际绘制 >16ms，或用户明确要求 10 万级分析视图；先用同一套脚本复测再决定。

## D-037 GPU 图谱原型：WebGL2 跑 10 万节点，但“跑满显卡”不是目标

- **日期**：2026-11-17
- **状态**：**原型完成；生产 GraphView 未替换**。
- **背景**：用户要求把图谱换到 GPU，目标是 10 万节点级别。WebGPU 在当前 Edge/Chromium 中不可用（`navigator.gpu` 为 false），因此选择 **WebGL2 + RGBA32F 浮点纹理 ping-pong**。
- **原型**：`scripts/graph-scale-webgl-layout.html`（静态页）。状态纹理存 `(x,y,vx,vy)`；片元着色器做近似力导（每节点 32 个随机斥力样本 + 最多 2 个边邻居 + 向心），顶点着色器从纹理取位置渲染点与边；无 CPU 每帧回读。
- **实测（Edge Chromium，RTX 5080，1200×800，10 万节点/20 万边）**：**164.1 fps**，平均 **6.09ms/帧**，p95 **6.2ms**，>20ms 坏帧 0。GPU 采样：平均 **14%**、峰值 **49%**、显存峰值约 **2.3GB**（含 Edge）。
- **结论**：GPU 能轻松撑住 10 万节点的**近似布局 + 渲染**；但显卡没有被跑满，因为图谱计算量本身不足以占满 5080，且 165fps 受 vsync 限制。**不应为了“跑满”人为增加无效计算**。
- **精度/产品缺口（未做）**：32 个随机样本不是 Barnes-Hut，边与斥力的视觉质量与 d3-force 不等价；没有标签、点击拾取、拖拽、过滤、局部图、搜索与数据同步；没有接入生产 `GraphView`；没有 Tauri WebView2 内的直接 FPS 测量（Edge 与 WebView2 同为 Chromium/ANGLE，但非同一进程）。
- **如果转生产**：需要先做空间网格/近邻查询（或 GPU 端 Barnes-Hut）、GPU 位置回读/拾取、标签 LOD、与 `GraphData`/筛选/局部图的接线、WebGL 失败回退；这是一轮独立特性，不是换 canvas。
- **复审条件**：节点 ≥2000 且现有 Canvas 绘制 >16ms，或用户明确要“10 万级分析视图”；先用 `scripts/graph-scale-webgl-layout.html?n=100000&frames=600` 复测。


## D-038 Owned chunked backup sessions (local proposal, 2026-11-17)

- Scope: fix the PR #2 shared-temporary-file race; no new dependency or backup scheduler.
- Every export owns an exclusively created sibling file; opaque session IDs replace path-based append/finish. Finish checks both successful-append count and actual file length, syncs data and publishes without replacing any existing file. Abort removes only the owned temporary file.
- Windows uses its native no-replacement move; non-Windows uses a same-directory hard link, failing safely on unsupported filesystems. Non-Windows execution and real desktop IPC remain unverified.
- The renderer rejects overlapping backup requests and releases the guard on all completion paths; successful same-second runs have random suffixes. Existing archive naming/pruning compatibility is retained. Relative retention order within one second and cross-process retention transactions are not promised.
- Pruning is after successful publication only. Crash/renderer termination can leave an unpublished temporary file; no automatic deletion of unknown leftovers. This change does not make vault snapshots point-in-time consistent or guarantee power-loss recovery.
- Verification recorded in TASKS and the external review receipt; not published or merged.

---

## D-039 双语对齐：层级序列保序贪心对齐，文本相似度仅作辅助

- **日期**：2026-11-27
- **状态**：**已实施**（T-066）。
- **决策**：配对以文件名 `-<lang>` 后缀为主规则（同目录、同扩展名优先）；`:lang:` / frontmatter `lang:` 仅作辅助——同词根、跨格式且两侧显式语言标记不同时，才按语言标记配成一对。章节对齐按标题层级序列做保序贪心双指针：当前两侧层级相同即配对，否则先消费层级较浅的一侧（另一侧记缺失 / 多余）；标题文本相似度（归一化后 Levenshtein 比率）只挂在配对行上作辅助展示，不要求译文标题与原文一致。
- **背景**：章程 §5.2 要求逐对比较版本号、标题总数与层级分布、章节结构、行数偏差。译文标题本就与原文不同语言，不能拿文本相等当配对判据；而纯 LCS 在重复同级标题（多篇 H2）上回溯 tie-break 会把靠前章节错配到靠后章节。
- **被采纳方案**：`core/bilingualAlign.ts` 纯函数——`digestDocument` 抽取版本 / 语言 / 标题 / 行数，`alignStructure` 保序贪心对齐，`buildBilingualReport` 发现配对并汇总四类检查；runner 只读盘，视图只消费报告。跳转复用既有 `openFile` + `revealTarget` 一次性请求机制，不另造导航路径。
- **被否决的替代方案**：
  - *标题文本相似度参与配对判据*：否决理由——中英标题天然不同语言，相似度阈值会误杀正常译文；相似度降级为配对行上的辅助展示值。
  - *LCS 最长公共子序列对齐*：否决理由——重复同级标题下回溯 tie-break 会把靠前章节错配到靠后章节；保序贪心双指针在文档顺序上更直观、可测。
  - *按目录树父子关系对齐*：否决理由——现有元数据只拍平标题列表，父子层级需另建树；本轮范围只做层级序列对齐，树状语义留待后续。
- **影响范围**：`src/core/bilingualAlign.ts`（新增）、`src/core/bilingualAlignRunner.ts`（新增）、`src/features/bilingualalign/`（新增视图 + scss）、`src/core/workspace.ts`（报告 Store + 单例视图方法）、`src/core/types.ts`（viewType 联合）、`src/core/i18n/dict.app.ts`（en/zh 文案）、`src/app/App.tsx`（命令 + 视图分发 + 标签标题）、`tests/bilingual-align.test.ts`（新增 24 用例）。
- **验证**：`npx vitest run tests/bilingual-align.test.ts` 退出码 0（24 用例）；`npm run typecheck` 退出码 0；`npm test -- --run` 227 passed + 1 expected fail + 1 skipped；`npm run verify` 退出码 0。
- **诚实缺口**：跨目录配对不支持；语言标签只认内置小词表；行数偏差阈值固定 25%，未暴露设置；结构对齐不解析父子章节嵌套；未做 E2E 真机跳转断言。
- **复审条件**：真实语料出现跨目录同词根配对需求，或重复同级标题下贪心对齐错配被实测报告时，再评估目录参与与树状对齐。

---

## D-040 AsciiDoc 编辑器源码模式：StreamLanguage 自作词法，零新增依赖（T-067）

- **日期**：2026-11-27
- **状态**：**已实施**（T-067）。
- **背景**：D-17 定调先做 C 档（`xref:` 可点击），A 档（彩色高亮）后补；本任务把 A 档以零新增依赖方式一并落地。此前编辑器对 `.adoc` 一律套用 `@codemirror/lang-markdown`，源码模式下 `xref:` / `<<…>>` 不可点，标题、属性、注释等 token 也按 Markdown 规则着色。
- **被采纳方案**：
  - 词法：复用 `@codemirror/language` 已带的 `StreamLanguage` + 手写行扫描纯函数（`scanAsciiDocLine` / `findXrefAt` / `findAnchorOffset`）。token 类别覆盖标题（`=` 至 `======`）、属性行与 `{attr}` 引用、行注释 `//` 与块注释 `////`、`xref:` 宏、`<<…>>` 简写、`link:` 宏、`include::`、列表项、代码块（`----` / `[source,…]`）边界与源码内部。
  - 路由：新增 language compartment，`.adoc` 挂 AsciiDoc 语言，`.md` 原样保留 `markdownSansHeaderFold()`；live preview 链路语义一字未改。
  - 跳转：复用既有 `metadata.resolveMarkdownLink` / `resolveLink` 解析与 `workspace.openFile` / `requestReveal`；锚点回退为纯文本正则定位（不假装有语法树）；坏链弹可见提示 pill，不自动建笔记、不抛异常。
  - 高亮样式复用现有 `HighlightStyle` 调色板（heading / comment / link / monospace / prop 等既有 class），只补三条既有 class 映射，不引入新主题或 CSS 变量。
- **被否决的替代方案**：
  - *引入 `codemirror-asciidoc` 之类现成包*：否决理由——硬约束零新增生产/开发依赖；该类包的维护活跃度与许可未核实，且其语法树能力超出 L3 所需，会把折叠/大纲一并绑死在第三方解析上。
  - *直接上完整 Lezer grammar（L4）*：否决理由——章程分级 L3 只要求源码编辑 + 高亮；Lezer grammar 投入大，且与现有 Markdown 折叠/大纲树并存会引入双树一致性问题，留待 L4 单独立项。
- **影响范围**：`src/features/editor/asciidocLanguage.ts`（新增）、`src/features/editor/adocXref.ts`（新增）、`src/features/editor/cmExtensions.ts`（language compartment + adoc 插件接线）、`src/features/editor/EditorPane.tsx`（compartment 装配 + 文件类型路由）、`src/core/i18n/dict.views.ts`（`editor.xrefUnresolved` 文案）、`tests/asciidoc-language.test.ts`（新增）。Canvas、三态校验、图谱边类型、发版签名、`.tauri-keys`、PR #5 相关文件均未触碰；Markdown 路径零回归。
- **诚实缺口**：折叠与结构化导航仍依赖 Markdown 语法树，AsciiDoc 章节折叠未适配；锚点定位是正则行号级，不识别 Asciidoctor 生成的内部 id；行内粗体/斜体与宏参数模型未解析；`link:` 宏高亮但不作为本次点击目标；重命名改扩展名（md ↔ adoc）时语言模式不在原地重路由。
- **复审条件**：若 L4 立项（完整语法树、大纲/折叠适配、宏参数模型），或现成 AsciiDoc CM 包的许可与维护状态核实可接受，再重新评估是否替换自写词法；三态校验落地时，需把 adoc 坏链展示与本任务的 unresolved pill 口径对齐。

---

## D-041 `.txt` 与 md/adoc 同索引，但按无结构纯文本处理

- **日期**：2026-11-27
- **决策**：`.txt` 文件进入可索引集合，参与全文搜索、可走既有文本编辑 / 阅读视图、可被 `xref:` / `link:` 按路径引用解析；但解析层对 txt 产出**空结构**——不提取标题、章节、链接、标签、块标记与脚注，显示标题取 basename，不猜首行、不伪造层级。
- **背景**：章程 §4.1 要求 txt 与 md / adoc 同索引。现状可索引集合仅 `md` / `adoc`，txt 既不进元数据索引也不进检索索引载荷，指向 txt 的引用无法解析。
- **被采纳方案**：
  - `parsers/indexable.ts` 的可索引扩展名集合加入 `txt`；`RESOLVE_EXTENSIONS` 与 `docsAsCode.APPENDABLE` 末尾追加 `.txt`，md / adoc 的既有优先顺序不变。
  - 新增 `parsers/plaintext.ts` 的 `parsePlainText(path, content)`：返回空 `links` / `tags` / `headings` / `blocks` / `footnotes` / `footnoteRefs` / `aliases`，仅记录 `contentLength`；`parseDocument` 分派在 adoc 之后、Markdown 之前拦截 txt。
  - `indexer.ts` 的文件过滤复用共享 `isIndexable()`，删除本地扩展名集合，避免两处真源漂移。
  - 预览 / 编辑路由不改：txt 本就在 `isEditableTextPath()` 白名单，继续走既有文本视图；附件只读边界（二进制 / 未知扩展名）不变。
- **被否决的替代方案与理由**：
  - *复用 `parseNote` 扫描 txt*：会把 `#` 开头的行误判为标题、`[[…]]` 误判为双链、`#tag` 误判为标签，等于在纯文本上伪造 Markdown 结构——否决。
  - *取首行作为标题*：大纲与图谱会出现作者没有写过的层级，违反「无结构」边界——否决。
  - *把 txt 归入只读附件*：违背既有「可编辑文本」分类，且无法进入搜索与引用解析——否决。
- **影响范围**：索引集合、元数据分派、链接解析、docsAsCode 路径解析；不涉及 Canvas、三态校验报告模型、图谱边类型、发版签名与 `.tauri-keys`。
- **复审条件**：若后续产品需要识别 txt 正文内的双链 / 标签，再单独立项评估；当前明确不做。txt 内锚点引用同样不解析。

---

## D-042 千篇基准只测可注入依赖的 TS 计算路径，拒绝用估算代替实测

- **日期**：2026-11-27
- **决策**：T-069 基准脚本经 Vite SSR 加载应用真实 `Vault` / `MetadataIndex` / `auditVault`，测量 TS 侧解析、元数据重建与引用校验路径；内存口径为 Node 进程 `process.memoryUsage()`（`heapUsed` / `rss`）。报告中每一项数字都必须来自脚本真实运行，禁止估算、插值或按小样本外推冒充实测。
- **背景**：章程 §9.1 要求给出 1000 篇规模下的索引 / 校验 / 内存数值与对照结论。索引在桌面路径上走 Tauri 命令进 Rust FTS5，纯 Node 进程跑不到那条链路；若不先划清口径，数字很容易被读成「端到端达标」。
- **被采纳方案**：
  - 夹具确定性生成（LCG 种子 42），同 count 逐字节一致；冷 / 热分轮，输出中位数、p95 与逐轮样本；脚本不写持久临时文件，退出即回收。
  - 报告显式声明未测的层：Rust FTS5 持久化写入、Asciidoctor.js 渲染、WebView2 / Tauri 占用、磁盘 IO；结论只对已测路径负责。
  - 引用校验在真实解析产物上跑，目标尽量可解析；告警项（夹具无 frontmatter）单独归类，不计入失效引用。
- **被否决的替代方案与理由**：
  - *用单库画像或 50 篇小样本的耗时按比例放大到 1000 篇*：非线性部分（名称映射、环检测、缓存命中）无法靠比例推得，属于估算冒充实测——否决。
  - *在脚本里复刻一份简化解析 / 校验逻辑以求跑得快*：与应用内真实代码漂移后，基准数字不再代表产品行为——否决；必须 SSR 加载真实模块。
  - *把 Rust 索引写入、WebView 占用一并写进同一达标结论*：本进程测不到这些层，混写会夸大达标余量——否决，留待真机复测。
- **影响范围**：仅新增基准脚本 `scripts/adoc-1000-bench.ts` 与报告 `docs/perf-1000-adoc.adoc`；不改生产索引、校验、图谱或模型代码；零新增依赖。
- **复审条件**：桌面端 Rust 索引 / WebView 路径具备可测条件后，另立任务补端到端基准，并与本报告的 TS 侧数字分开陈述。
