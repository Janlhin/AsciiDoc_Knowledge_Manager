# AI 支持草案（拆分为 7 段，暂缓实施）

- **打包时间**：2026-11-15
- **状态**：**暂缓实施**。用户 2026-11-14 指示「先记录，不做」，2026-11-15 要求「拆分、发 PR、重新构建」。因此本目录**只含 patch 与说明，不含任何生效代码**。
- **对应台账**：`TASKS.md` T-030a ~ T-030f（六个原子任务）、`DECISIONS.md` D-015 ~ D-018（四条决策）。

## 序列（按依赖顺序，逐段可独立编译/验证）

| 文件 | 内容 | 该段自带验证 |
| --- | --- | --- |
| `01-rust-sse-transport.patch` | `llm_stream` / `llm_cancel`、`sse_data_payload`、SSE 帧单测 | `cargo test`（`sse_frames`） |
| `02-rust-credential-store.patch` | `keyring` 依赖、`secret_set/get/delete`、凭据库往返测试（硬边界 #5 单点） | `cargo test -- --ignored` |
| `03-ts-protocol-core.patch` | `core/llm/{types,store,sse}.ts`、`settingsNav`、校验脚本与 npm script | `node scripts/verify-llm-sse.ts` |
| `04-ts-stream-binding.patch` | `secrets.ts`、`client.ts`（Tauri 事件流 + fetch 双通道、取消、测试连接） | `npm run typecheck` |
| `05-ai-panel.patch` | `AiPanel` / `ai.scss`、`RightPanelKind "ai"`、tab、图标、面板 i18n | 面板行为（实机/Playwright） |
| `06-ai-settings.patch` | 设置页「AI」「钥匙串」分区、深链、设置 i18n、样式 | 添加→保存→测试连接 |
| `07-records.patch` | `TASKS.md` / `DECISIONS.md` 的原子化版本 | 文档一致性 |
| `00-umbrella.patch` | 上述 7 段的合并包（等价于一次应用） | 同上 |

## 应用方式（推荐 `git apply`）

```bash
cd geode
for p in docs/drafts/ai-support-2026-11-14/0[1-7]-*.patch; do
  git apply --check "$p" && git apply "$p"
done
```

一条命令的等价方式：`git apply docs/drafts/ai-support-2026-11-14/00-umbrella.patch`。

**CRLF 注意**：`src/core/types.ts` 在仓库中是 CRLF。用 `git am` 逐个应用时必须加 `--keep-cr`，否则第 5 段会因行尾被剥离而失败：

```bash
for p in docs/drafts/ai-support-2026-11-14/0[1-7]-*.patch; do
  git am --keep-cr "$p"
done
```

## 验证记录（打包前）

- 第 1 段：`cargo test` 通过（SSE 帧 6 例）
- 第 2 段：`cargo test -- --ignored` 通过（写入→覆盖→读取→删除→幂等删除，含 `llm:` 冒号命名）
- 第 3 段：`node scripts/verify-llm-sse.ts` 15/15 通过
- 全序列：在干净树上按序 `git am --keep-cr` 后，**24 个文件与已验证实现逐字节一致**（22 个代码文件 + 2 个台账文件，SHA-256 比对无差异）
- 未做：真机 GUI 目视（侧栏渲染、逐字流式、停止按钮）

## 已知限制

无会话持久化；无全库 RAG；无原生 Anthropic/Gemini；Linux 未启用 secret-service；助手输出不做完整 Markdown（XSS 取舍，仅文本 + 围栏代码块）；无 token 计数，上下文按字符估算。
