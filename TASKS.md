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

### T-015 vite-plus 引入后的视觉回归抽查

- **提出**：2026-11-13
- **问题**：引入 vite-plus 后 CSS 由 lightningcss 重新规范化（规则 989 → 988，135 处声明差异、11 处选择器写法差异）。判定为等价，但未做视觉确认。
- **方法**：以改造前的 exe 与当前的 exe 分别截图同一 vault 的首屏、设置页、图谱页、编辑器页，逐像素比对；差异处人工判定是否为可接受规范化。
- **解决**：—
- **完成判据**：四个页面各一组截图存档于 `docs/visual-baseline/`，且 `DECISIONS.md` D-008 复审条件中「CSS 视觉回归」一项被标记为已核。

### T-011 接入 `.nvmrc` 版本登记

- **提出**：2026-11-13
- **问题**：规范要求运行时版本写入版本文件，CI 与本地同源。当前 Node 版本仅存在于开发者机器。
- **方法**：新建 `.nvmrc`，写入 `26.13.0`，并在 `README.md` 技术栈表中引用。
- **解决**：—
- **完成判据**：`.nvmrc` 存在且内容为有效版本号；`README.md` 中出现该文件名。

### T-012 L2：AsciiDoc 接入索引（主线）

- **提出**：2026-11-13
- **问题**：`src/core/parsers/asciidoc.ts`（193 行）已写未接线。adoc 不出现在文件树与图谱中，README 声明的核心能力尚不可用。
- **方法**：① `src/core/metadata.ts` 的 4 处扩展名判断改为 `isIndexable()` 分派；② `src/core/vault.ts` 的 `getMarkdownFiles()` 改名 `getIndexableFiles()`；③ 用 Blueprint 的 130 篇 adoc 验证产出的 `NoteMetadata`。
- **解决**：—
- **完成判据**：以 Blueprint 作为 vault 启动，图谱节点数包含 adoc 文档（`/api/graph` 或等价调试输出中 `.adoc` 计数 ≥ 130），且 `npm run verify` 退出码 0。

---

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
