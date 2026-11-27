# 文档索引

本目录是 ADKM 的项目文档树。本页只索引仓内真实存在的文件；界面截图素材见 `screenshots/`，逐轮累积的施工长日志见 `internal/`。

## 入口与治理

| 文档 | 用途 | 路径 |
| --- | --- | --- |
| 项目 README | 产品定位、快速开始、技术栈与目录结构 | [../README.md](../README.md) |
| 协作与提交约定 | 本地搭建、提交前必跑检查、提交规范与 PR 要求 | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 开发引导 | 开发环境与命令细节 | [DEVELOPMENT.md](DEVELOPMENT.md) |
| 安全策略 | 威胁范围、私密报告渠道与已知缺口 | [SECURITY.md](SECURITY.md) |
| 分发与自动更新 | 打包产物、签名与自动更新链路 | [DISTRIBUTION.md](DISTRIBUTION.md) |
| 来源与变更声明 | 上游 Geode 来源、改动清单与许可义务 | [PROVENANCE.adoc](PROVENANCE.adoc) |
| 项目立项书 v2 | 产品定位、P0 目标与能力分层 | [project-charter-v2.adoc](project-charter-v2.adoc) |
| 备份指南 | 分盘 / 网络盘 ZIP 备份的使用与边界 | [backup-guide.adoc](backup-guide.adoc) |
| 变更记录 | 版本变更日志（AsciiDoc 格式） | [../CHANGELOG.adoc](../CHANGELOG.adoc) |
| 决策日志 | 追加式决策记录 | [../DECISIONS.md](../DECISIONS.md) |
| 第三方来源登记 | 依赖与素材来源台账 | [../MANIFEST.md](../MANIFEST.md) |

## 规范、审计与评估

| 文档 | 用途 | 路径 |
| --- | --- | --- |
| Obsidian 复刻差距审计 | Obsidian 完整复刻差距审计（常驻活文档） | [OBSIDIAN_REPLICA_GAP_AUDIT.md](OBSIDIAN_REPLICA_GAP_AUDIT.md) |
| 性能基准 | 10k 笔记基准测试与优化记录 | [PERFORMANCE.md](PERFORMANCE.md) |
| 插件 API | 内置功能同款插件扩展接口说明 | [PLUGINS.md](PLUGINS.md) |
| G3 命令复刻矩阵（英文） | G3 侧栏域命令复刻矩阵 | [G3-COMMAND-MATRIX.md](G3-COMMAND-MATRIX.md) |
| G3 命令复刻矩阵（中文） | G3 命令复刻矩阵：Obsidian → ADKM → 状态 | [G3-命令复刻矩阵.md](G3-命令复刻矩阵.md) |
| MTX Loop 配置 | 轮次编排体系的项目配置说明 | [mtx.config.md](mtx.config.md) |
| 决策单 | 按轮记录的待裁决事项台账 | [adkm-decision-sheet.md](adkm-decision-sheet.md) |
| 占位符与国际化清单 | 产品占位符与国际化改造清单 | [product-placeholders.adoc](product-placeholders.adoc) |
| 技术路线评估 | ADKM 技术路线评估报告 | [route-evaluation.adoc](route-evaluation.adoc) |
| 同类实现调研 | 同类开源实现的代码级调研 | [clone-code-survey.adoc](clone-code-survey.adoc) |
| 模仿品核查 | Obsidian 模仿品核查报告 | [obsidian-clone-report.adoc](obsidian-clone-report.adoc) |
| 主线程成本审计 | 主线程成本审计与搬迁方案 | [main-thread-audit.adoc](main-thread-audit.adoc) |

## 基线记录

| 文档 | 用途 | 路径 |
| --- | --- | --- |
| AI 校对基线 | AI 按规范校对基线（T-047） | [ai-proofread-baseline.adoc](ai-proofread-baseline.adoc) |
| 文档体检基线 | 文档规范体检基线（T-046 / T-047 前置） | [doc-audit-baseline.adoc](doc-audit-baseline.adoc) |
| Docs-as-Code 基线 | 引用校验基线（T-045 三片） | [docs-as-code-baseline.adoc](docs-as-code-baseline.adoc) |
| E2E CDP 基线 | WebView2 CDP 通道 E2E 基线（T-004 / T-040） | [e2e-cdp-baseline.adoc](e2e-cdp-baseline.adoc) |
| 多格式预览基线 | 多格式只读预览基线（T-054 / T-055 / D-022 / D-024） | [format-preview-baseline.adoc](format-preview-baseline.adoc) |
| 底座差异基线 | 相对 geode 底座的差异基线 | [geode-baseline.adoc](geode-baseline.adoc) |

## 实施计划与架构决策记录

| 文档 | 用途 | 路径 |
| --- | --- | --- |
| L2 实施计划 | AsciiDoc 接入索引 | [plans/L2-asciidoc-indexing.md](plans/L2-asciidoc-indexing.md) |
| L3 实施记录 | AsciiDoc 阅读视图 | [plans/L3-asciidoc-preview.md](plans/L3-asciidoc-preview.md) |
| ADR-0001 | Asciidoctor.js 4.x 能力边界与解析分层策略 | [technical-decisions/ADR-0001-asciidoctor-js-capability.adoc](technical-decisions/ADR-0001-asciidoctor-js-capability.adoc) |
| ADR-0002 | 解析上下文模型（include 归属、属性优先级与条件求值） | [technical-decisions/ADR-0002-parsing-context.adoc](technical-decisions/ADR-0002-parsing-context.adoc) |
| ADR-0003 | 交付形态与实现基础的选择 | [technical-decisions/ADR-0003-geode-as-base.adoc](technical-decisions/ADR-0003-geode-as-base.adoc) |
| ADR-0004 | 从最小增量改为深度改造 | [technical-decisions/ADR-0004-deep-modification.adoc](technical-decisions/ADR-0004-deep-modification.adoc) |

## 子目录

| 目录 | 用途 | 入口 |
| --- | --- | --- |
| `internal/` | 构建期施工日志：架构、轮次交接、兼容矩阵、路线图；体量大、信息密度低，不属公开文档面 | [internal/README.md](internal/README.md) |
| `evidence/` | 取证素材（Obsidian 命令 ID 清单） | [evidence/obsidian-command-ids.txt](evidence/obsidian-command-ids.txt) |
| `screenshots/` | 界面截图素材 | — |
