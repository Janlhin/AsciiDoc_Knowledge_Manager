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
- **方法**：
  1. ✅ 复用已在依赖树中的 `vitest` 5.1.0（原为 `vite-plus` 传递依赖），改为 `devDependencies` 显式声明并与 `package-lock.json` 对齐；
  2. ✅ 把 `npm test` 纳入 `npm run verify` 门禁，测试不通过则构建失败；
  3. ⬜ 覆盖率阈值：`@vitest/coverage-v8` 尚未引入（新增依赖需单独放行），阈值配置留待该步。
- **解决**：**部分完成（2026-11-15）**。步骤 1/2 已落地；`npm test` 实测 30 passed + 1 预期失败 + 1 跳过，退出码 0；`npm install --package-lock-only --dry-run` 报 `up to date`，lock 与 package.json 一致。步骤 3 未做。
- **完成判据（更新）**：① `npm test` 作为 `npm run verify` 的一环且退出码 0（已达成）；② `npx vitest run --coverage` 退出码 0，且覆盖率不低于 `vitest.config.ts` 声明阈值（未达成，依赖 `@vitest/coverage-v8`）。

### T-004 接入 Playwright

- **提出**：2026-11-13
- **问题**：有 UI 即强制。当前仅有上游的 `.calibration/*.mjs` 脚本，未接入标准通道。
- **方法**：原计划安装 `@playwright/test`；2026-11-15 改道为 **WebView2 CDP 通道**（零新增依赖，复用已验证的性能取数链路）。
- **解决**：**改道、部分完成（2026-11-15）**。`tests/e2e/{cdp.mjs,run.mjs}` 提供连接 / 真实按键 / 真实鼠标 / 等待与六条用例；`npm run test:e2e` 6/6 通过、`--self-check` 反转期望后对应用例转红。`@playwright/test` 与 tauri-driver **未引入**。详见 `docs/e2e-cdp-baseline.adoc`。
- **完成判据（更新）**：① `npm run test:e2e` 六条全绿、退出码 0（已达成）；② 负向自检证明用例在守（已达成）；③ 若将来引入 Playwright，则 `npx playwright test` 退出码 0（未达成，当前无此计划）。

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
- **解决**：2026-11-15 阶段二/三完成，结论落于 `docs/technical-decisions/ADR-0005-obsidian-rea-findings.adoc`（九项逐项结论 + 方法学边界），派生 T-036 / T-037 / T-038。关键负面结论：`app.js` 为 3.22 MB 压缩单包，静态语义分析必然超时，⑥⑦ 两项在制品层面不可得。
- **完成判据**：
  1. `REA 分析子命令` 退出码 0，且输出含 Evidence 记录与模块图；
  2. ADKM 仓库存在 `docs/technical-decisions/ADR-0005-*.adoc`，其中「优先学习」9 项逐项有结论或明确的「不适用 + 理由」，每项挂 Evidence ID；
  3. geode/TASKS.md 新增 T-026 及之后的实现待办，每条注明其来源 ADR-0005 的条目号。

### T-028 BacklinksPanel 的未链接提及扫描改为懒加载，消除启动期 87ms 长任务

- **提出**：2026-11-13
- **问题**：`src/features/backlinks/BacklinksPanel.tsx:296-312` 在启动时无条件执行 `app.metadata.getAll().filter(...).sort(localeCompare)`，随后对全库 **416 个文件逐个 `vault.read` 并全文搜索**——这是启动期剩余 87ms 主线程长任务的来源（叠加 React 重渲染）。
- **方法**（用户 2026-11-13 已定：结果缓存按 revision 失效）：把「未链接提及」扫描结果缓存起来，缓存键取 `MetadataIndex.revision`——索引每次变更都会 `bump()` 一次 revision，因此 revision 变化即天然触发重算，无需额外的失效机制。面板打开时若有有效缓存则**秒开**，无缓存才实扫。
- **解决**：—
- **完成判据**：启动期不再出现由本扫描导致的主线程长任务（用 Long Task 探针确认）；且**实机验证**两件事——①首次打开面板仍能正确列出结果；②改动某篇笔记后重新打开面板，结果随之更新（验证 revision 失效生效，不能只看构建通过）。

### T-031 默认打开模式改为代码编辑（source），且在手动切换前不被改写

- **提出**：2026-11-15
- **问题**：用户偏好默认以代码编辑（source）打开笔记；现状 `defaultNewTabMode` 默认 `"live"`，且与 `defaultEditMode`、「默认打开预览模式」开关（T-019）三套语义叠加，存在互相覆盖风险。
- **方法**：核对 `core/appearance.ts`、`workspace.openFile`（`src/core/workspace.ts:456`）与设置页三者的单一真源；首装默认改 `"source"`；明确「新 tab 用默认值 / 已开 tab 不被改写」的边界；任何导航动作不写 `mode`（导航侧由 T-029 修复）。
- **解决**：—
- **完成判据**：① 清空 localStorage 后新开笔记，`tab.mode === "source"`；② 手动切到 live 后再开新笔记，新笔记仍为 source（默认值不继承上一 tab）；③ 设置页修改默认值后，新开 tab 立即生效；④ `npm run verify` 通过。

### T-032 功能区快捷键提示改为从命令注册表派生（消除手写不一致）

- **提出**：2026-11-15
- **问题**：ribbon 按钮的快捷键提示**手写在 i18n 文案里**，与命令注册表脱节。实测：
  - `app.ribbonGraph` / `app.ribbonPalette` / `app.ribbonSettings` 文案硬编码 `(Ctrl+G)` / `(Ctrl+P)` / `(Ctrl+,)`；
  - `app:show-search` 有默认键 `Mod+Shift+F`，但 `app.ribbonSearch` 无提示——同一动作，提示不一致；
  - 手写文案不跟随「设置 → 快捷键」的用户改键；
  - `Mod` 在 macOS 应显示为 ⌘，写死 `Ctrl` 在 Mac 上是错的。
  另：插件面板缺合法单 SVG 图标时，`SidebarPanelIcon`（`src/app/App.tsx:1711`）渲染标题首字母（如 «N»），视觉上像孤立字符。
- **方法**：
  1. 删除 4 条 i18n 文案中的 `(Ctrl+X)`，恢复纯名称；
  2. 新增 `formatHotkey(hotkey)`：`Mod` → Windows `Ctrl` / macOS `⌘`（复用 `isMacPlatform`），其余按规范顺序输出；
  3. 新增 `ribbonTitle(labelKey, commandId)`：`t(labelKey)` + 有效键（`app.commands.getEffectiveHotkey(id)`），无键则不加括号；
  4. ribbon 按钮改为按 command id 取标题：`app:open-graph` / `app:command-palette` / `app:open-settings` / `app:show-search`；
  5. 插件面板兜底图标单列处理（要求插件提供图标，或改用通用图标）——需先定契约，不在本条强制。
- **解决**：—
- **完成判据**：
  ① `npm run verify` 通过；
  ② 手动/Playwright：hover 四个按钮，提示分别为「关系图谱 (Ctrl+G)」「命令面板 (Ctrl+P)」「设置 (Ctrl+,)」「搜索 (Ctrl+Shift+F)」；
  ③ 在设置里把 `app:command-palette` 改为 `Mod+Shift+P` 后，hover 提示同步变为 `Ctrl+Shift+P`；
  ④ `formatHotkey` 单测覆盖 `Mod+P` → Windows `Ctrl+P` / macOS `⌘P`。

### T-036 把「契约优先」的取证顺序写回逆向路线文档

- **提出**：2026-11-15
- **问题**：`docs/obsidian-reverse-engineering.adoc` 的九项学习清单里，⑥（模块边界）⑦（事件总线）经 ADR-0005 证实**在制品层面不可得**（`app.js` 3.22 MB 压缩单包，模块边界已被打包器抹平），而清单仍把它们列为「阶段二下钻」目标，会持续消耗预算。
- **方法**：
  1. 在该文档「学习范围」把 ⑥⑦ 标为**不适用 + 理由**（引 ADR-0005「方法学结论」）；
  2. 把取证顺序改写为**数据契约 → 运行时行为 → 静态语义**，并注明反编译只对未压缩/可分包目标有效；
  3. ②（插件 API 契约）改为以官方 `obsidian.d.ts` 为真源，不再走 REA。
- **解决**：—
- **完成判据**：文档中 ⑥⑦ 带「不适用」标识与证据编号；取证顺序段落与 ADR-0005 一致；`docs/` 下无第二份互相矛盾的取证顺序描述。

### T-037 运行时取证一轮：启动耗时、IndexedDB 键、大库虚拟化

- **提出**：2026-11-15
- **问题**：ADR-0005 中 ①③⑤ 三项（索引是否持久化、解析上下文分层、大库调度）**未取得证据**——静态路径取不到，且它们决定了 ADKM 启动期优化的上限。
- **方法**：
  1. 同一测试库分别测 Obsidian 与 ADKM 的冷启动到可交互耗时，记录是否二次启动更快（若有加速即证明存在持久化索引）；
  2. 查 Obsidian 的 IndexedDB 数据库与键空间，判断索引落在哪一层；
  3. 造 ≥1 万文件库，观察大纲/反链/搜索在滚动时的 DOM 节点数是否随视口有界（虚拟化判据）。
- **解决**：—
- **完成判据**：三项各有一张可复现的测量记录（命令 + 数值 + 结论），写入 ADR-0005 增补节；结论区分观察与推断。

### T-039 持久化检索索引（SQLite FTS5）并让派生数据按解析规则版本失效

- **提出**：2026-11-15
- **问题**：两条同源。① `MetadataIndex` 只在内存，进程重启即 `rebuildAll()` 全量重算，是「进入软件卡一下」的结构性来源；同类项目（otterly / kb / lokus / mdit）都把检索索引持久化，且把结构变更（改名/移动/删除）做成一等命令而不是整体重建。② 一旦索引持久化，`metadata.ts` 的解析规则（`TAG_RE`、frontmatter、标题提取）改动后**没有任何机制让旧结果失效**，表现会是「升级后旧笔记的标签/反链静默错误」。
- **参照实现**（代码级，见 `docs/clone-code-survey.adoc`）：
  - `otterly/src-tauri/src/features/search/db.rs`：`notes` + `notes_fts`(fts5) + `outlinks`(索引 `target_path`) + `note_tags`(索引 `tag_key`)；`PRAGMA journal_mode=WAL; synchronous=NORMAL`；BM25 按列加权（标题 10 / 文件名 12 / 路径 5 / 正文 1）+ `snippet()` 高亮；
  - 同一文件用 `PRAGMA user_version` 存**解析器规则版本**，版本不符则清空 manifest 让下次同步整体重解析——这正是 ② 的解法。
- **方法**：
  1. Rust 侧新增 `features/index/`（不得堆进 `main.rs`，见 T-039 备注里 opensidian 的反面教材）：`open(db_path)`、`upsert_note`、`remove_note`、`remove_by_prefix`、`rename_note`、`rename_folder`、`search`、`rebuild`、`cancel`；
  2. 索引库落**应用数据目录、按 vault 分目录**，不写进 vault（保持「纯文件库」性质）；
  3. `user_version` 存解析规则版本常量，与 TS 侧共享同一常量来源；
  4. TS 侧 `MetadataIndex` 改为「内存为热缓存 + 持久层为真源」，启动时先读库再后台校验。
- **解决**：**2026-11-15 五条判据全部达成**（一期持久化、二期暖启动水合、三期启动时序修复；实测数值见下）。
- **完成判据**：
  ① `cargo test` 覆盖 schema 初始化、规则版本变更触发整体重解析、重命名后 `outlinks` 同步（对照 otterly 的 `tests/search_db_behavior.rs` 写法）；
  ② 同一 416 文件测试库冷启动 `metadataIndexMs` 相比改动前显著下降（给出前后数值）；
  ③ 改动 `TAG_RE` 后启动，旧笔记标签被重算而不是保留旧值；
  ④ vault 内不出现任何 `.db`/`-wal`/`-shm` 文件；
  ⑤ `npm run verify` 通过。
- **前置**：**违反硬边界 #5**——`rusqlite`（bundled）会把 SQLite C 源码编进二进制，显著增加体积与构建时间。**需用户显式放行**后方可动手。

- **进展（2026-11-15，一期已实现）**：
  - Rust `src-tauri/src/features/index/{mod,schema}.rs`：10 个命令、WAL、`PRAGMA user_version` 存**解析规则版本**；`cargo test` 13 条全过（含规则版本变更丢弃派生数据）。
  - TS `core/searchIndex.ts`（软失败封装）+ `core/indexer.ts`（首帧后回填、每 8 文件让出、mtime/size 跳过、事件维护）；App 挂载启动。
  - **二期已实现（暖启动水合）**：`notes.meta_json` 存整份 `NoteMetadata`（`PARSE_RULES_VERSION` 升至 2，旧库整体丢弃）；`MetadataIndex.setHydrator()` 让 `rebuildAll` 对 mtime/size 命中的文件直接反序列化，跳过读盘与解析；任何缺失/不匹配/损坏行都回退到原路径。新增 perf mark `metadataHydrated`。
  - **三期已实现（启动时序修复，2026-11-15）**：实机 CDP 取数发现**水合从未生效**——`main.tsx` 的 `await vault.load()` 早于 `ReactDOM.createRoot().render()`，而 `MetadataIndex` 在构造期就订阅 `vault:changed(load)` 并立即 `rebuildAll()`；hydrator 却装在 App 的 `useEffect` 里，永远赶不上。修法：`primeIndexHydration(app)` 在 `adapter.setVaultPath()` 后、`vault.load()` 前预热并按 vaultPath 缓存水合行；hydrator 命中缓存即纯内存返回；`vault:changed(load)` 在同库时不再 `indexClose()`，避免与 hydrator 的 `indexKnown()` 竞争。
  - **实测（2026-11-15，release 版 / 真实库 408 文件，经 WebView2 CDP 读 `window.__geodePerf`）**：
    | 场景 | `metadataIndexMs` | `metadataHydrated` |
    | --- | --- | --- |
    | 冷启动（规则版本 1→2 清库重建） | 2346.5 ms | 0 |
    | 修复前暖启动（第二次启动，库已有 404 行 meta_json） | 1859.7 ms | 0 |
    | **修复后暖启动（同一库）** | **6.8 ms** | **404** |

    暖启动较修复前快约 **273 倍**；408 个文件中 404 个直接反序列化，仅 4 个回退读盘。判据 ② 闭合，判据 ①③④⑤ 均已达成（④ 已核对 vault 内无 `.db`/`-wal`/`-shm`）。
  - **搜索接入**：按 T-041 方案 2 已实现（两套语义并存）。
- **实测基线（2026-11-15，真实库 415 文件 / 28.9 MB，脚本 `tests/parse-bench.test.ts`）**：
  - 读盘 **198 ms**、解析 **90 ms**、串行合计 **287 ms**（0.69 ms/文件）。
  - **结论：瓶颈在读盘（69%），不在解析。** 二期收益必须靠「少读文件」兑现——把 `NoteMetadata` 整体序列化进索引，启动时按 mtime/size 命中即反序列化，而不是只存 title/body/tags/links。
- **搜索接入被语义问题挡住**：`evaluateSearch` 是**子串**匹配，FTS5 的 `unicode61` 只匹配**词首前缀**（查 `nership` 命中不了 `ownership`）。当预筛会静默丢结果，不能直接替换。两条出路见 T-041。

### T-040 建立测试基线：前端零测试 → 关键路径可回归

- **提出**：2026-11-15
- **问题**：`docs/clone-code-survey.adoc` 实测，七个可直接比较的同类项目里，geode 是**唯一前端零测试**（JS 测试文件 0，Rust 测试 1）。后果是可验证的：2026-11-15 一天内修掉的 4 个缺陷（T-029 大纲切模式、T-033 锚点不跳、D-013 标题栏主题、T-034 右键菜单漏 WebView2）**全部由人工截图发现**，其中 2 个属于「类型检查通过、构建通过、行为错误」。
- **方法**：
  1. 只覆盖高频路径，不做覆盖率军备竞赛（参照 otterly 的 151 条，但只取前 10%）；
  2. 优先 Playwright 六条：开笔记 → 切模式 → 点大纲 → 点锚点 → 阅读视图右键 → 多库切换后布局保留（T-035）；
  3. 纯函数继续用现有 `scripts/verify-*.ts` 模式，不引入测试框架；
  4. CI 侧只跑 `npm run verify` + 上述脚本。
- **解决**：**首片完成（2026-11-15）**。六条 E2E 走 CDP 通道（开笔记 / 切模式 / 点大纲不切模式 / wikilink 导航 / 阅读视图右键 / 搜索双模式），`npm run test:e2e` 6/6 通过；`--self-check` 把大纲用例的期望反转后该用例转红，证明不是空断言。E2E 未并入 `npm run verify`，构建门禁未被拖慢。详见 `docs/e2e-cdp-baseline.adoc`。
- **完成判据（更新）**：
  ① `npm run test:e2e` 六条全绿、退出码 0、总时长 < 60s（已达成）；
  ② 负向自检：反转 `outline-keeps-mode` 期望后必须转红（已达成，等价于回退 T-029 的检测）；
  ③ `npm run verify` 仍为唯一构建门禁，不被测试拖慢（已达成）。
- **仍缺**：T-033 的同文档锚点用例（Markdown 标题无 id、临时库 adoc 预览为空，见 T-049）；覆盖率阈值（T-003 步骤 3）。

### T-041 索引检索的接入方式：trigram 分词器 vs 独立检索模式

- **提出**：2026-11-15
- **问题**：`evaluateSearch` 是**子串**语义，FTS5 默认 `unicode61` 分词只匹配词首前缀。直接接到搜索面板会静默丢结果，比慢更糟。
- **两个选项**：
  1. **换 `trigram` 分词器**（FTS5 为子串/LIKE 场景提供）：可安全当预筛；代价是索引体积约 3 倍，且 <3 字符的查询需回退全量扫描。
  2. **独立「全文检索」模式**：保留现有子串搜索不动，另给按 bm25 排序、带 snippet 高亮的入口；代价是两套语义并存。
- **方法**：先补 `evaluateSearch` 与预筛谓词的单测（`nership`/`ownership`、大小写、全词边界），再按选定方案接入。
- **解决**：**方案 2 已定**（2026-11-15 用户选择「两套语义并存」）。保留现有子串搜索不动；索引检索作为独立模式（bm25 排序 + snippet 高亮），由搜索面板显式切换。理由：子串语义是既有行为契约，FTS 的分词语义无法在不丢结果的前提下替代它；两套并存让用户按场景选择，代价是 UI 需要标明当前模式。
- **完成判据**：① 单一真源写进 ADR（记录两套语义的边界与切换位置）；② 单测覆盖子串边界（`nership`/`ownership`、大小写、全词）；③ 索引模式下结果**明确标注**为全文检索结果，不与子串结果混排；④ 索引模式的查询耗时给出数值。
- **实现（2026-11-15）**：
  - 搜索面板新增「子串 / 全文」模式切换（`geode.searchMode` 持久化）；**原子串路径只加了一行 early-return，行为零改动**。
  - 全文模式走 `searchIndexed()`（bm25 排序 + `snippet()` 高亮），独立渲染分支，结果明确标注为索引命中，不与子串结果混排；索引不可用时给出可读提示，**不静默回退**以偷换语义。
  - `snippet` 的 `<mark>` 由 `parseSnippetParts()` 拆成纯文本片段、用 React 文本节点渲染；笔记正文里的 HTML 字串保持字面量，不构成注入。
  - 语义边界双向钉死：Rust `index_tokenization_is_prefix_only` 证明 `nership` 命中不了 `ownership`；`tests/search-semantics.test.ts` 证明子串路径能命中。防止将来有人把两条路径合并而静默丢结果。
  - **判据 ④ 实测（2026-11-15，release 版经 CDP 驱动 UI）**：查询「规范」首次 `searchIndexMs=151.5 ms`、重复 `87 ms`，返回 **59 条**「索引命中」；查询「研磨」`4.2 ms` 但 **0 条**——FTS5 `unicode61` 把连续中文整串当一个 token，这正是「两套语义并存」不能合并的又一实证（子串模式能命中「标准研磨日志」）。判据 ④ 闭合。

### T-049 复核一次性 vault 中 AsciiDoc 阅读视图为空

- **提出**：2026-11-15
- **现象**：E2E 夹具的 `E2E-Guide.adoc`（含 `:toc:`）打开后，`[data-testid="preview"]` 的 `innerHTML` 为 **0**、class 无 `adoc-preview-view`、大纲 0 项；但该文件**能被索引**，搜索 snippet 有内容。用户 `Blueprint` 库里的 adoc 预览此前正常。
- **待判**：产品缺陷 vs 夹具 / 动态 chunk 加载时序。本轮**未擅自改产品代码**。
- **方法**：在真实库与一次性库分别复现；检查 `adocResult` 状态、`@asciidoctor/core` 动态 import 是否失败、`DocumentHandle` 是否为 null、扩展名注册路径。
- **解决**：—
- **完成判据**：给出可复现结论并写入 ADR；若确为缺陷，修复后在 E2E 补回「点 `:toc:` 目录锚点滚动」用例，把 T-033 纳入自动回归。

### T-045 Docs-as-Code 引用校验（xref / include）

- **提出**：2026-11-15
- **来源**：ADKM 的定位是「专业文档工程 + AsciiDoc 一等公民」，而 Obsidian 结构上不会做这条线。
- **内容**：Antora 组件/版本切换、`xref` 全库校验、`include::` 链解析与缺失告警、发布前检查、按组件导出。
- **参考实现**：`archive/adkm-web/shared/types.ts` 已把链接分为 `wikilink / markdown-link / xref / xref-short / link-macro / include` 六类并定义 `resolved / broken / unresolved` 三态；`archive/adkm-web/server/parsers/asciidoc.ts` 展示 xref/include 的解析边界。收录于 2026-11-15，见该目录 README。
- **判断**：这是**唯一可能「超越」而非「对齐」**的方向。分片交付，先做引用完整性，再做 Antora 集成。
- **体量**：中到大。
- **解决**：**首片完成（2026-11-15）**。纯函数 `src/core/docsAsCode.ts`（`parseXref` / `resolveXref` / `resolveInclude` / `includeEdges` / `findIncludeCycles`）；文档体检新增 `broken-xref` / `broken-include` 两类（`AuditEnv.files` 注入路径表，单篇审计缺省时诚实跳过）；`auditVault` 追加全库 include 环检测（闭环只报一次）；AI 校对提示词随 `AUDIT_RULE_DOCS` 自动变为八条。语义契约：xref 先文件相对、再库根相对（兼容产品点击），显式 `./` 不回退；Antora 资源 ID 唯一同名才解析，多个时按 `unresolved` 报 warning。顺带修正 `.adoc` 元数据兜底误用 Markdown 解析器。21 新单测 + 6 条体检用例、负向自检两处转红、真机 E2E 8/8（新增 `docs-as-code-refs`）。详见 `docs/docs-as-code-baseline.adoc`。
- **完成判据（首片）**：① `npx vitest run tests/docs-as-code.test.ts tests/doc-audit.test.ts` 退出码 0（已达成：21 + 23）；② 负向自检证明用例在守（已达成：把 xref 改为仅库根解析 → 3 条转红；关闭环检测 → 3 条转红）；③ 真机 `npm run test:e2e` 8/8，`docs-as-code-refs` 断言恰好 1 条失效 xref + 1 条失效 include + 1 条环并点击跳转（已达成）；④ `npm run verify` 退出码 0、零新增依赖（已达成：90 单测通过）。
- **仍缺（下一片）**：解析 `antora.yml` 以实现组件/版本切换；`#anchor` 存在性校验（`[[id]]` 未进索引）；include 深度阈值；条件包含 `ifdef`；发布前检查与按组件导出；xref 自动修复。

## 待命（候选功能，未排期）

> 本节记录**已评估但未排期**的候选功能。它们不是任务：没有完成判据、没有承诺时间。
> 转正式实施前，先复制一条到「待办」并补齐判据——避免待命区变成愿望清单。
> 排序依据：投入体量 / 与既有资产的契合度 / 是否属于同类项目已有而 ADKM 缺失。

### T-043 Canvas（白板/画布视图）

- **提出**：2026-11-15
- **来源**：Obsidian 核心插件；同类 lokus / kb 均已具备；ADKM 缺失。
- **判断**：属于「完整复刻」口径下的大件，且与 AsciiDoc 定位无直接增益。
- **体量**：大（画布数据结构 + 拖拽/缩放/连线 + 嵌入笔记渲染）。
- **前置**：先定 `.canvas` 文件格式是否与 Obsidian 兼容（决定能否打开别人的画布）。

### T-044 Bases / 数据库视图

- **提出**：2026-11-15
- **来源**：Obsidian 1.9 的招牌功能；ADKM 完全缺失。
- **判断**：**可复用 T-039 的 SQLite 索引作为地基**，比从零做便宜；但 UI（视图配置、筛选、排序、公式）仍是主要工作量。
- **体量**：大。
- **前置**：T-039 闭合（索引需成为可信真源，而不是旁路缓存）。

### T-046 文档规范体检

- **提出**：2026-11-15
- **内容**：术语一致性、失效链接、标题层级跳级、必填 frontmatter 缺失、章节结构偏差、中文标点混用。
- **参考实现**：`archive/adkm-web/server/git.ts`（77 行，只读 Git 状态：分支 / ahead-behind / 脏文件）与 `shared/types.ts` 的 `LinkStatus` 三态，可直接作为「断链」判据的语义起点。
- **判断**：与 T-045 同源，但可独立交付；纯前端 + 元数据即可，依赖面小。
- **体量**：中。可先做成一条命令 + 结果面板。
- **解决**：**完成（2026-11-15）**。纯函数规则引擎 `src/core/docAudit.ts`（六项规则，注入 `resolveLink`/配置，零 I/O）+ `src/core/docAuditRunner.ts`（唯一不纯的读库步骤）+ 命令 `tools:doc-audit` + 主区单例结果面板 `src/features/docaudit/`。17 单测全绿、负向自检转红、真机 UI 冒烟 11/11（demo-vault 扫 7 篇得 8 条问题、7 类筛选、点击跳转、重新体检）。规则上下文 `AUDIT_RULE_DOCS` 供 T-047 复用。详见 `docs/doc-audit-baseline.adoc`。
- **完成判据**：① 六项规则各有正向用例、干净文档零告警（已达成：17 单测）；② 负向自检证明用例在守（已达成：破坏断链规则后对应用例转红）；③ 真机可打开结果面板并跳转问题行（已达成：CDP 冒烟 11/11）；④ `npm run verify` 不被拖慢、零新增依赖（已达成）。
- **仍缺（记入后续，不阻断本片）**：规则配置 UI（现为 `DEFAULT_AUDIT_CONFIG` 写死）；附件链接断链判定应先走 `resolveAttachment` 再降级（现对 `demo-vault` 中不存在的 `geode-dot.png` 如实报断链）。

### T-047 AI 按规范校对

- **提出**：2026-11-15
- **来源**：AI 面板已内置（流式 + 系统凭据库），但当前只能「自由问答」，没有产品化动作。
- **内容**：把 T-046 的规则作为提示词上下文，「按本库规范检查当前章」并给出可跳转的问题列表。
- **判断**：把已有 AI 能力从「玩具」变成「工作流的一环」，投入小、感知强。
- **体量**：中（依赖 T-046 的规则集，不依赖其 UI）。
- **方法**：提示词要求**单个 `json` 围栏**（`summary` + `issues[{line, category, severity, message, suggestion}]`），解析器容忍围栏/裸 JSON/前后散文，并对越界行、缺字段、未知类别逐项降级且**计数可见**；笔记正文与确定性体检结果一并注入，避免模型重跑规则。流式复用 AI 面板唯一路径，动作只发布一次性 turn。
- **解决**：**完成（2026-11-15）**。纯函数 `src/core/llm/proofread.ts`（`buildProofreadPrompt` / `parseProofreadReply`）+ 一次性请求 Store `request.ts` + 读库桥 `proofreadRunner.ts`；命令 `ai:proofread-note` 与 AI 面板按钮共用同一入口；结果以可跳转列表渲染在助手气泡下方，跳转复用 `revealTarget`。规则文案单源（`AUDIT_RULE_DOCS` 增补 `criteriaEn`，提示词随 UI 语言）。16 单测全绿、两处负向自检转红、真机 E2E 新增 `ai-proofread` 用例（7/7，含提示词携带规则集断言与跳转断言）、mock 只回散文时该用例转红。详见 `docs/ai-proofread-baseline.adoc`。
- **完成判据**：① `npx vitest run tests/ai-proofread.test.ts` 退出码 0（已达成：16/16）；② 负向自检证明用例在守（已达成：类别回退与行号越界两处破坏均转红）；③ 真机 `npm run test:e2e` 7/7，且 `ai-proofread` 断言「2 条可定位问题 + 1 条越界丢弃 + 提示词含规则集 + 点击跳转触发 reveal」（已达成）；④ `npm run verify` 退出码 0、零新增依赖（已达成：177 命令 id / 201 i18n 键 / 63 单测通过）。
- **仍缺（不阻断本片）**：未接真实模型验证协议遵从度（本机无可用 Key，全部经 mock 与纯函数验证）；规则配置 UI 仍缺（与 T-046 同一缺口，提示词用 `DEFAULT_AUDIT_CONFIG`，不与体检面板分叉）；AI 结果不写回 `workspace.docAuditReport`（单次对话产物，不与确定性真源混存）。

### T-048 结构性不做的边界（记录，防止反复讨论）

- **提出**：2026-11-15
- **内容**：**同步服务、移动端、多窗口 pop-out、像素级 UI 复刻**——不进入排期。
- **依据**：ADR-0005 把前三者定性为「商业体量问题而非技术问题」；D-002 已否决像素级复刻。
- **用途**：以后再有人提，直接指向本条，不再重复论证。

## 待裁决

| 编号 | 时间 | 问题 | 现状 |
| --- | --- | --- | --- |
| Q-001 | 2026-11-13 | `src/`、`src-tauri/`、`public/`、`scripts/`、`docs/` 等目录严格按字面不在根目录白名单内，是否逐项申请豁免 | 已按 D-006 解释为「文件从严、目录从宽」，README 目录结构声明职责 |
| Q-002 | 2026-11-13 | 覆盖率阈值初始定多少（建议先 20%，逐层抬高） | 待 T-003 落地时定 |
| Q-003 | 2026-11-13 | `oxfmt` 尚未到 1.0，是否等 1.0 再引入格式化 | 待定；当前 T-001 用 Prettier |
| Q-004 | 2026-11-15 | 应用标识改名（`productName` / `identifier`）与数据目录迁移：新 identifier 用什么前缀、`package.json` 的 name 是否同步改 | **待定**。方案已定，参数未定；仓库名已改为 `AsciiDoc_Knowledge_Manager` |

**Q-004 待定方案（2026-11-15 已确认要做，缺两个参数）**

- **范围**：`productName` `Geode` → `AsciiDoc Knowledge Manager`；`identifier` `com.geode.knowledgebase` → 待定（建议 `com.janlhin.*`）；`package.json` 的 `name` 是否同步改（该字段是内部包名，不影响用户可见名称）。
- **为什么必须一并迁移**：identifier 决定应用数据目录。现值 `%APPDATA%\com.geode.knowledgebase\` 内含索引库（实测 39 MB / 415 行）、设置、最近库列表。改 identifier 而不迁移 = 用户侧「数据全丢」。
- **迁移方式（已定）**：启动时检测——新目录不存在且旧目录存在 → **递归复制**（不是移动，失败时旧数据仍在）→ 写完成标记 → 之后的启动只看新目录。必须在改 identifier 的同一次提交里实现，不允许先改后补。
- **未做验证的部分**：迁移在真实用户数据上只跑一次，无法用现有测试覆盖（无 E2E）；实施后需要一次「旧目录改名→启动→核对行数/设置仍在」的手工验证。
- **待你拍板**：① identifier 前缀；② `package.json` name 是否同步改。

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
| T-029 | 2026-11-15 | 大纲点击不再切换视图模式：删除 `onJump` 的 preview→live 分支；抽出 `scrollPreviewToSource()` 复用 R15 reveal（按元数据标题序号定位 + `preview-reveal-flash`）；preview 下点大纲只滚动，模式保持不变。`npm run verify` 通过 |
| T-033 | 2026-11-15 | 同文档锚点点击不滚动：`localizeLinks` 不再把 `href="#..."` 改写为 `internal-link`（Asciidoctor id `_xxx` 无法被 `resolveSubpath` 解析）；预览点击对 `#fragment` 按 id 定位并 `scrollIntoView`，同时覆盖 Markdown `[x](#id)`。`npm run verify` 通过 |
| T-034 | 2026-11-15 | 阅读视图右键菜单：新增通用 `ContextMenu` 组件（`.ctx-menu`，视口钳制、外点/Esc/滚动关闭）；预览右键提供复制 / 全选 / 打开链接 / 复制链接地址 / 在源码中编辑；新增全局 `contextmenu` 兜底，屏蔽 WebView2 默认菜单（输入框保留原生粘贴菜单）。`npm run verify` 通过 |
| T-035 | 2026-11-15 | 工作区布局按库隔离：验收前 `localStorage["geode.workspace.v1"]` 是全局单键，打开第二个库会修剪并写回第一个库的标签，导致布局丢失。新增 `src/core/workspaceKeys.ts`（`normalizeVaultPath` / `workspaceStateKey` 纯函数，收敛 `C:\Vault`、`c:/vault/`、`C://Vault//`）；`vault:changed` 补 `path` 载荷；`Workspace.adoptVaultStorage()` 按库切换快照并把旧全局快照一次性迁移给首个库。`node scripts/verify-workspace-keys.ts` 16/16（脚本首次运行即抓出 `C://Vault//` 未收敛）、`npm run verify` 通过 |
| T-027 | 2026-11-15 | **关闭，不再实施**：原方案用 rayon 并行读盘来降低启动期 IO 等待，但 T-039 二期落地后暖启动对 mtime/size 命中的文件直接反序列化，**读盘这一步本身被跳过**，并行读已无可优化对象。冷启动首次回填仍读盘，但只发生一次。保留原判据中的测量方法供后续性能复核 |
| T-038 | 2026-11-15 | **代码层面已满足**（复核结论，无需再实施）：台账原写「重渲染器静态引入」，实测四个均已 `await import(...)` — `core/asciidoctorPreview.ts:23`、`features/attachment/{EpubPreview.tsx:28,XlsxPreview.tsx:99/164,DocxPreview.tsx:28}`；`core/math.ts`、`core/mermaid.ts` 同样懒加载。`npm run build` 产物中 `xlsx` 413 KB、`cytoscape` 424 KB 等均为独立 chunk，主包不背重渲染器。**未做的验证**：真机确认「打开 md 不触发重渲染器 chunk」，属 E2E 范畴，见 T-004 |
| T-039 | 2026-11-15 | 持久化检索索引全部判据达成：Rust FTS5 + 规则版本失效 + 整份 `NoteMetadata` 落库 + 启动期预热水合。修复 `vault.load()` 早于 React 挂载导致 hydrator 永远未安装的时序缺陷后，暖启动 `metadataIndexMs` **1859.7 → 6.8 ms**（404/408 行走水合），冷启动 2346.5 ms；全文模式「规范」59 条 / 87 ms |
| T-042 | 2026-11-15 | 命令补齐复核：**原判断不成立并已纠正**。实测 ADKM 175 条（非 101，旧正则漏了批量注册）、Obsidian 制品静态可提取 169 条（热键页 280 含动态/插件命令）、ID 字面差集 114 条（非 179）——其中约 70 条是**命名不同但功能已有**、约 40 条是**能力缺失**（Canvas/Bases/同步/发布/多窗口，由 T-043/T-044/T-048 覆盖或排除）。本轮落地：`docs/command-gap-matrix.adoc`（可复现取证 + 功能域矩阵）、补 4 条真命令（`app:set-reading-view/set-live-preview/set-source-mode/toggle-default-new-pane-mode`，均有 `available` + 真实 callback + en/zh 文案）、`scripts/verify-command-registry.ts` 并入 `npm run verify`（查重复 ID / i18n 缺失 / 无 callback，防审计 §11 的「假完成」）。**未凑数注册空命令，未改已有 ID 以免破坏用户热键绑定** |
