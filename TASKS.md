# TASKS

任务队列与待裁决台账。每条含提出时间、问题、方法、解决时间；**完成判据必须可机器判定**（命令 + 期望退出码）。已决条目不得删除。

---

## 待办

### T-001 接入 ESLint + Prettier（`--max-warnings=0`）

- **提出**：2026-11-13
- **问题**：项目无任何代码规范检查。52,286 行自有代码，AI 高发缺陷（未使用变量、悬空 Promise、误用相等判断）无拦截。
- **方法**：安装 `eslint`、`@typescript-eslint/*`、`prettier`、`eslint-config-prettier`；配置置于 `config/`（工具支持显式路径时移入）；新增 `npm run lint`、`npm run fmt:check`。
- **解决**：—
- **完成判据**：`npx eslint . --max-warnings=0` 退出码 0，且 `npx prettier --check .` 退出码 0。

### T-002 接入 Stylelint（SCSS 通道）

- **提出**：2026-11-13
- **问题**：22 个 SCSS 文件无静态检查；规范要求样式层必须可检查，且「SCSS 只允许通过 Token 取值」。
- **方法**：安装 `stylelint`、`stylelint-config-standard-scss`；规则需放行 `src/compat/` 注入的外部主题样式；新增 `npm run lint:style`。
- **解决**：—
- **完成判据**：`npx stylelint "src/**/*.scss"` 退出码 0。

### T-003 接入 Vitest 与覆盖率阈值

- **提出**：2026-11-13
- **问题**：零测试。`src/core/` 的解析与索引逻辑无行为验证，改造中回归不可见。
- **方法**：安装 `vitest`、`@vitest/coverage-v8`；首批覆盖 `src/core/metadata.ts`、`src/core/vault.ts`、`src/core/parsers/asciidoc.ts`；阈值先设低值并逐步抬高。
- **解决**：—
- **完成判据**：`npx vitest run --coverage` 退出码 0，且覆盖率不低于 `vitest.config.ts` 中声明阈值。

### T-004 接入 Playwright

- **提出**：2026-11-13
- **问题**：有 UI 即强制。当前仅有上游的 `.calibration/*.mjs` 脚本，未接入标准通道。
- **方法**：安装 `@playwright/test`；首批用例覆盖「打开 vault → 文件树渲染 → 打开文档 → 图谱渲染」。
- **解决**：—
- **完成判据**：`npx playwright test` 退出码 0。

### T-005 接入 Husky + lint-staged + commitlint

- **提出**：2026-11-13
- **问题**：提交门禁缺失，校验只能在 CI 或人工执行，往返成本高。
- **方法**：安装 `husky`、`lint-staged`、`@commitlint/cli`、`@commitlint/config-conventional`；`pre-commit` 跑 lint-staged，`commit-msg` 跑 commitlint。
- **解决**：—
- **完成判据**：`git commit` 触发钩子；故意提交不符合 Conventional Commits 的信息时退出码非 0。

### T-006 适配 GitHub Actions 流水线

- **提出**：2026-11-13
- **问题**：`.github/workflows/ci.yml` 来自上游，检测项与本项目不符。
- **方法**：改为 `verify` + lint + stylelint + vitest 四步；Node 版本由 `.nvmrc` 提供。
- **解决**：—
- **完成判据**：推送后 workflow 结论为 success。

### T-007 引入运行期边界校验（Zod / Valibot）

- **提出**：2026-11-13
- **问题**：编译期类型在运行时不存在。当前边界输入包括 vault 路径、`.obsidian` 配置 JSON、`.canvas` 文件、环境变量，均无 schema。
- **方法**：选其一（倾向 Zod，生态成熟）；先在 `.obsidian` 配置与 `.canvas` 解析两处落地。
- **解决**：—
- **完成判据**：`npx vitest run` 中存在针对非法输入的用例且通过。

### T-008 处置 `.claude/` 与 `.calibration/`

- **提出**：2026-11-13
- **问题**：`.claude/` 内含上游的自主开发契约（含「不要反问」条款），与本项目规范「歧义必须询问」冲突且构成第二份规则载体；`.calibration/` 上百个 `.mjs` 脚本与「统一 Pwsh 入口」不一致。
- **方法**：删除前先确认无本地工具依赖；保留必要校准脚本并迁移为 Pwsh。
- **解决**：—
- **完成判据**：`grep -rl "继续开发" .claude 2>/dev/null` 无输出，且 `npm run build` 仍退出码 0。

### T-009 ADR 迁入 `docs/decisions/`

- **提出**：2026-11-13
- **问题**：ADR-0001 至 ADR-0004 及立项书存放在仓库外（桌面项目目录），不随仓库分发，`DECISIONS.md` 中的引用无法解析。
- **方法**：复制到 `docs/decisions/`，在 `README.md` 目录结构与 `AGENTS.md` 文档表登记。
- **解决**：—
- **完成判据**：`ls docs/decisions/*.adoc` 至少 4 个文件；`AGENTS.md` 中存在指向该目录的链接。

### T-010 清除根目录 `nul`

- **提出**：2026-11-13
- **问题**：Windows 保留设备名残留文件，常规 API 将其解析为设备而非文件，`git add` 会崩（`mmap failed`）。
- **方法**：在提权命令行或资源管理器中删除；或重建工作目录时排除。
- **解决**：—
- **完成判据**：`ls nul` 返回「不存在」，且 `git fsck --full` 零输出。

### T-011 接入 `.nvmrc` 版本登记

- **提出**：2026-11-13
- **问题**：规范要求运行时版本写入版本文件，CI 与本地同源。当前 Node 版本仅存在于开发者机器。
- **方法**：新建 `.nvmrc`，写入 `26.13.0`，并在 `README.md` 技术栈表中引用。
- **解决**：—
- **完成判据**：`.nvmrc` 存在且内容为有效版本号；`README.md` 中出现该文件名。

### T-025 用 REA 拆解 Obsidian，仅学习优先软件逻辑与代码逻辑以完善 ADKM

- **提出**：2026-11-13
- **问题**：ADKM（Geode 底座）已有 D-013 等对上游库的复用决策，但从未逆向过 Obsidian 本体。既有 `docs/obsidian-clone-report.adoc` 走的是「社区开源模仿品」路线（Opensidian/Geode/Lokus/Otterly/Mdit/Cherit 六个项目的公开信息核查），查的是**别人怎么模仿 Obsidian**，不是 Obsidian 自己怎么实现——缺的是本体证据（如缓存/增量策略、插件契约、模块边界、状态真源），恰是 ADKM 完善时最容易踩坑处。
- **方法**：用 REA 逆向 Obsidian 的 ASAR 包，分三阶段推进。
  - **阶段一 · 连接与就绪**：REA MCP 已在 `本机 REA 服务注册项` 注册为 `rea`（REA 服务），但当前会话未加载其工具 → 需重启 WorkBuddy 客户端使注册生效；**不依赖 MCP 的兜底路径**：`REA 分析子命令`（CLI 直接返回 Evidence 记录）。目标文件：`主程序资源包`；同目录 `启动壳资源包`仅 Electron 启动壳，非分析目标。
  - **阶段二 · 静态地图**：以 `detail: "summary"` 起步取得 Evidence 与模块图，再凭 `parent_evidence_id` 分页取模块视图；沿「入口 → 数据与状态变更 → 结果」路径推进，只在 summary 留下具体缺口时才下钻，避免重复分析。
  - **阶段三 · 结论落地**：写 `docs/technical-decisions/ADR-0005-*.adoc`，并在 geode 侧登记 T-026+ 实现待办。
- **学习范围（严格限定，只学优先项）**：
  - *软件逻辑*：① 文件/元数据缓存与增量更新策略；② 插件 API 契约与生命周期；③ 解析上下文与跨格式引用解析分层；④ 编辑视图与阅读视图分离；⑤ 大库下的性能调度（虚拟化、惰性加载）。
  - *代码逻辑*：⑥ 模块边界与依赖方向；⑦ 事件总线/订阅模型；⑧ 状态单一真源与持久化时机；⑨ 缓存失效与重算边界。
  - *明确不学*：UI 像素级实现、主题皮肤细节、与 ADKM 定位无关的边缘功能、第三方许可代码的逐行搬运——**只取思想，不复制代码**。
- **输出纪律**：每条结论必须挂 REA Evidence ID，明确区分「观察 / 推断 / 未知」；且必须映射到 ADKM 的具体落点（geode 的 `src/core/`、`src/features/` 对应模块）。**不可映射到 ADKM 落点的结论不进 ADR**，避免把逆向笔记堆成与项目无关的赏析。
- **解决**：—
- **完成判据**：
  1. `REA 分析子命令` 退出码 0，且输出含 Evidence 记录与模块图；
  2. ADKM 仓库存在 `docs/technical-decisions/ADR-0005-*.adoc`，其中「优先学习」9 项逐项有结论或明确的「不适用 + 理由」，每项挂 Evidence ID；
  3. geode/TASKS.md 新增 T-026 及之后的实现待办，每条注明其来源 ADR-0005 的条目号。

### T-027 Rust 侧用 rayon 并行读文件，把启动期的 IO 等待分摊到多核

- **提出**：2026-11-13
- **问题**：启动期最大的单项不是 CPU，是 IO。实测：真实 app 的索引耗时明显高于同一份数据走内存 vault 的耗时，差额即**等磁盘的时间**（测试库：磁盘读 69MB / 416 个文件 vs 内存 vault，两者相差数倍）；同时 profiling 显示启动期 CPU **绝大部分为 idle**——多核在闲着，瓶颈是 IO 等待而非算力。这也是用户反馈的「进入软件会卡一下，之后就流畅」的来源之一。
- **方法**：只做 IO、不搬业务逻辑——这是 rayon 在本项目唯一划算的用法：在 Rust 侧把 vault 文件的读取并行化（`paths.par_iter().map(read_to_string)`）。**前端一行不动，不需要 Worker。**
- **解决**：—
- **完成判据**：启动期索引耗时的「等磁盘」部分显著下降（用同一测试库对比改动前后的 `metadataIndexMs`，且总耗时应降至磁盘读取理论下限的数倍以内）；`npm run verify` 与关窗测试仍全绿。

### T-028 BacklinksPanel 的未链接提及扫描改为懒加载，消除启动期 87ms 长任务

- **提出**：2026-11-13
- **问题**：`src/features/backlinks/BacklinksPanel.tsx:296-312` 在启动时无条件执行 `app.metadata.getAll().filter(...).sort(localeCompare)`，随后对全库 **416 个文件逐个 `vault.read` 并全文搜索**——这是启动期剩余 87ms 主线程长任务的来源（叠加 React 重渲染）。
- **方法**（用户 2026-11-13 已定：结果缓存按 revision 失效）：把「未链接提及」扫描结果缓存起来，缓存键取 `MetadataIndex.revision`——索引每次变更都会 `bump()` 一次 revision，因此 revision 变化即天然触发重算，无需额外的失效机制。面板打开时若有有效缓存则**秒开**，无缓存才实扫。
- **解决**：—
- **完成判据**：启动期不再出现由本扫描导致的主线程长任务（用 Long Task 探针确认）；且**实机验证**两件事——①首次打开面板仍能正确列出结果；②改动某篇笔记后重新打开面板，结果随之更新（验证 revision 失效生效，不能只看构建通过）。

### T-029 大纲点击不应强制切换视图模式（preview 下点大纲被切到代码编辑态）

- **提出**：2026-11-14
- **问题**：右侧「大纲」面板点击条目时，`OutlinePanel.jumpTo`（`src/features/outline/OutlinePanel.tsx:124-138`）先 `openFile(activePath)` 再派发 `geode:scroll-to-heading` 事件。`openFile` 对同文件复用既存 tab、不改 `mode`，因此模式翻转不在此处。真正根因在编辑器侧监听器 `onJump`（`src/features/editor/EditorPane.tsx:842-867`）：当 `tab.mode === "preview"` 时执行 `app.workspace.setTabMode(tab.id, "live")` 后 `return`——即**把阅读视图强制切到可编辑态，并吞掉本次跳转**；真正的滚动（`CodeMirror` 的 `scrollIntoView`）只在 live/source 模式才执行。
- **方法**：**只改导航行为，不改默认模式**（默认模式见 T-031）。
  1. `onJump` 删除 preview 分支的 `setTabMode(...)` 调用；
  2. preview 态改为在已渲染 DOM 中按 `data-heading-from` / 标题文本定位 heading 节点并 `scrollIntoView`；
  3. 不新增任何写 `mode` 的路径。
- **解决**：—
- **完成判据**：Playwright——
  ① preview 点大纲某条目：`tab.mode` 仍为 `"preview"`，且对应 heading 进入视口；
  ② source 点大纲：`tab.mode` 仍为 `"source"`，且光标/滚动到位。
  用例 `npx playwright test` 退出码 0。

### T-031 默认打开模式改为代码编辑（source），且在手动切换前不被改写

- **提出**：2026-11-15
- **问题**：用户偏好默认以代码编辑（source）打开笔记；现状 `defaultNewTabMode` 默认 `"live"`，且与 `defaultEditMode`、「默认打开预览模式」开关（T-019）三套语义叠加，存在互相覆盖风险。
- **方法**：核对 `core/appearance.ts`、`workspace.openFile`（`src/core/workspace.ts:456`）与设置页三者的单一真源；首装默认改 `"source"`；明确「新 tab 用默认值 / 已开 tab 不被改写」的边界；任何导航动作不写 `mode`（导航侧由 T-029 修复）。
- **解决**：—
- **完成判据**：① 清空 localStorage 后新开笔记，`tab.mode === "source"`；② 手动切到 live 后再开新笔记，新笔记仍为 source（默认值不继承上一 tab）；③ 设置页修改默认值后，新开 tab 立即生效；④ `npm run verify` 通过。

## 待裁决

| 编号 | 时间 | 问题 | 现状 |
| --- | --- | --- | --- |
| Q-001 | 2026-11-13 | `src/`、`src-tauri/`、`public/`、`scripts/`、`docs/` 等目录严格按字面不在根目录白名单内，是否逐项申请豁免 | 已按 D-006 解释为「文件从严、目录从宽」，README 目录结构声明职责 |
| Q-002 | 2026-11-13 | 覆盖率阈值初始定多少（建议先 20%，逐层抬高） | 待 T-003 落地时定 |
| Q-003 | 2026-11-13 | `oxfmt` 尚未到 1.0，是否等 1.0 再引入格式化 | 待定；当前 T-001 用 Prettier |

## 已决

| 编号 | 完成时间 | 结果 |
| --- | --- | --- |
| T-000 | 2026-11-13 | 五个必备文档建立：README.md、AGENTS.md、DECISIONS.md、TASKS.md、MANIFEST.md |
| T-013 | 2026-11-13 | 规范原文 vendor 至 `README.md` |
| T-014 | 2026-11-13 | 根目录散文文件迁移；`CLAUDE.md` 降为单行引用 |
| T-015 | 2026-11-13 | vite-plus 引入后的视觉核对：主界面与改造前无可辨差异（仅主界面，其余页面未逐一核对） |
| T-012 | 2026-11-13 | L2 完成：`.adoc` 与 `.md` 同索引。Blueprint 实测 130 篇 adoc、220 条引用、0 条未解析、全量 67 ms；md 子图接入前后逐字段一致 |
| T-017 | 2026-11-13 | L3 阅读视图：adoc 用懒加载 Asciidoctor 渲染；`xref:` 可点；真实文档 67 KB→38 ms / 94 章节 / 212 链接；md 预览零改动 |
| T-018 | 2026-11-13 | L4 阅读视图：复用 vscode-office 库选型，扩展只读 AttachmentView 支持 docx/pptx/epub 只读预览 + xlsx 可编辑（mammoth/jszip/epubjs/x-data-spreadsheet+SheetJS，懒加载代码分割）；`scripts/verify-format-libs.ts` 4 项全 PASS，`npm run build` 通过 |
| T-019 | 2026-11-13 | 设置→编辑器：把「默认视图模式（编辑/阅读）」下拉改造成独立的「默认打开预览模式」开关（R272 reskin）；底层仍复用 `defaultNewTabMode` 单一真源（preview ⇄ 记忆的 live/source），与 Ctrl+E 循环命令同源、自动同步；清理废弃的 `viewEditing`/`viewReading`/旧 `defaultNewTabMode` i18n 键。`npm run build` 通过 |
| T-020 | 2026-11-13 | 修标题栏 X 关闭失效（**最终根因 = Tauri v2 的 Rust 侧默认阻止关闭**，此前三次修法全部误判）：读 `tauri-2.12.5/src/manager/window.rs` 确认——`WindowEvent::CloseRequested` 分支中 `if window.has_js_listener(WINDOW_CLOSE_REQUESTED_EVENT) { api.prevent_close(); }`，即**只要前端注册了 close 监听器，Rust 就放弃自动关窗，关窗责任 100% 交给 JS 的 `destroy()`**；而本项目实测 JS 的 `invoke('plugin:window|destroy')` 链路从未生效（`plugin:window|destroy` 在 2.12.5 确有注册，故非命令名问题，而是该链路本身不可靠），于是 X 永久失效。前三次修法（改 preventDefault / 加超时 race / 手动 destroy）**全都在 JS 侧**，故全部无效。**终版：在 Rust 侧接管**——`src-tauri/src/main.rs` 新增 `.on_window_event()`，收到 `CloseRequested` 时 `api.prevent_close()`，再起线程 sleep 600ms（给 webview 留 flush 时间）→ `window.destroy()` → 再 `app_handle().exit(0)` 兜底；JS 侧 handler 退化为纯 flush（不调 preventDefault、不调 destroy），并给动态 import 补 `.catch` 使注册失败不再静默。验证方式：新增 Python+ctypes 自动化测试，给窗口发原生 `WM_CLOSE` 后检查进程是否退出，**连续 3 次 PASS**，且实测耗时 ~600ms 反证正是 Rust 兜底路径生效（即 JS 路径确实无效） |
| T-021 | 2026-11-13 | 排查「打开不流畅」：geode.exe 自身健康（~33 MB）；卡顿元凶是早期 L3 验证遗留的 ~50 个失控 chrome 自动化孤儿进程（累计烧 800+ CPU 秒、占 1.3 GB RAM，无窗口、带 remote-debugging 标记），已自行退出；950 MB 的 node 9172 是用户本机 OpenClaw Gateway（`openclaw-session-host.exe` 子进程），非遗留、不动。前端重型库全部动态 import，未泄漏进启动路径，无代码层性能回归 |
| T-022 | 2026-11-13 | CSS→SCSS 收尾：`src/` 内仅剩的 2 个 `.css` 改名为 `.scss`（`compat/obsidian/theme-bridge.css`→`.scss`、`features/export/export.css`→`.scss`），同步更新 `themes.ts` / `export.ts` 的 `?raw` 导入路径，并在 `src/raw-import.d.ts` 补 `*.scss?raw` 模块声明（否则 `tsc --noEmit` 报 TS2307）；另修正两处指向已不存在的 `app.css` / `theme-bridge.css` 的过期注释。SCSS 是 CSS 超集，无需改语法。验收：`src` 内 `.css` 归零（23→25 个 `.scss`），`npm run build` 通过 |
| T-023 | 2026-11-13 | JS→TS 收尾：`scripts/` 下 4 个 `.mjs`（adoc-index-report / gen-blueprint-seed / gen-icon / verify-format-libs）全部转为 `.ts` 并补齐类型（NodeNext ESM；`xlsx` 经 `createRequire` 取 CJS 运行时同时保留 `typeof import("xlsx")` 类型；`mammoth` 用 `scripts/shims.d.ts` 补声明）；新增 `scripts/tsconfig.json` 独立类型检查（`npm run typecheck:scripts`，已并入 `npm run verify`），根 tsconfig 加 `"types": []` 避免 `@types/node` 污染浏览器端；同步更新 package.json 与 README/MANIFEST/DECISIONS/TASKS/docs 中的脚本路径。验收：`node scripts/verify-format-libs.ts` 4 项全 PASS（与原 `.mjs` 一致）。**刻意保留的 JS**：`compat-fixtures/*/main.js` 与 `demo-vault/.geode/plugins/hello-status.js` 是运行时经 `new Function()` 求值的 Obsidian 插件载荷，必须是 JS，转 TS 会破坏兼容性测试的真实性 |
| T-024 | 2026-11-13 | 待办体系：JS→TS / CSS→SCSS / CPU 多线程 三项待办已登记。CPU 多线程经用户确认先做**性能画像**再决定并行化范围——现状是 Rust 后端极薄（仅 main.rs 一处 `std::thread::spawn`、无 rayon/tokio），前端 5.3 万行 TS 的解析/图谱(416 节点)/索引/重写全跑在 UI 主线程且无任何 Web Worker，重计算堵在 UI 线程是早前「卡顿」的潜在根因 |
| T-026 | 2026-11-13 | 前端性能画像（CPU 多线程待办的第一阶段，**用实测数据否定了多线程化**）：经 WebView2 CDP（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 注入调试端口，无需改代码）+ Long Task API + 项目自带 `perfMark` 埋点测得：**启动期主线程阻塞 185ms**（85ms + 100ms 两个长任务），CPU 采样 88.7% 为 idle。根因是**单个 50MB 文件**——`Knowledge/书籍库/诸子百家系列.md`（18,487,265 字符 / 566,721 行），占全库 69MB 的 73%；其 `parseNote` 中 **block 标记扫描占 57%**（每行一次 `masked.slice` + 正则 exec）。**已修**：改为先用一次原生 `indexOf("^")` 定位候选行、只处理含 `^` 的行，成本从「按行数」变为「按标记数」；行为等价经 22 个边界用例（CRLF/代码围栏内标记/行首 `^`/重复 id/EOF 无换行/跨段范围等，18 个含真实标记）+ 416 个真实文件逐项比对，0 不匹配。**实测收益**：该文件 parseNote 84.9→39.4ms、parseDocument 181→38.6ms；全库 rebuildAll 193→134ms、解析总耗时 182.7→82.1ms、平均每文件 0.439→0.197ms、最慢文件 118.25→39.55ms；真实 app 启动长任务 185→141ms。**结论：不需要 Worker 化**——热点是单文件内的算法复杂度问题，Worker 化反而要序列化 18.5MB 字符串；且 `rebuildNameMap` 实测仅 0.25ms、`getGraph` 1.4ms、图谱 settle 1112ms 属动画帧预算内，均非热点。已新增可复跑工具 `npm run profile:hotspots / profile:bigfile / verify:block-scan` |
| T-030a | 2026-11-15 | Rust SSE 流式传输：`llm_stream` / `llm_cancel`；`ureq` 的 `into_reader()` 逐行读，`data:` 帧经 `llm:chunk` 推送，`llm:done` / `llm:error` 各一次，`AtomicBool` 协作取消；`cargo test`（`sse_frames`）通过 |
| T-030b | 2026-11-15 | 系统凭据库：`keyring` 3.6.3（`windows-native` / `apple-native`）+ `secret_set/get/delete`；`cargo test -- --ignored` 通过（含 `llm:` 冒号命名、幂等删除）——硬边界 #5 单点落地 |
| T-030c | 2026-11-15 | 协议核心：`core/llm/{types,store,sse}.ts`（纯函数 + localStorage 配置，Key 不入库）；`node scripts/verify-llm-sse.ts` 15/15 通过 |
| T-030d | 2026-11-15 | 传输绑定：`secrets.ts` / `client.ts`，Tauri 事件流 + fetch 双通道、`AbortSignal` → `llm_cancel`、`testProvider` 复用 `http_request`；`npm run typecheck` 通过 |
| T-030e | 2026-11-15 | 右侧 `ai` 面板：`AiPanel` + `ai.scss` + tab + `sparkles` + 面板 i18n；输出仅文本/围栏代码块（不注入 HTML）；附带笔记上限 12,000 字符、源文件 >2 MB 跳过；面板行为待实机目视 |
| T-030f | 2026-11-15 | 设置页「AI」「钥匙串」分区：7 预设、URL/模型/密钥/温度/max tokens/测试连接/删除；密钥仅显示「已存入」；`settingsNav` 深链 |
