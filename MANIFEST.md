# MANIFEST

第三方二进制、源码与逆向对象的来源登记。字段：名称 · 来源 URL · 版本 · 校验值 · 用途 · 许可结论。

**许可结论非空**为硬要求；空白的登记项视为未登记。

---

## 纳入产物的第三方源码

### Geode

| 字段 | 内容 |
| --- | --- |
| 名称 | Geode（本地优先 Markdown 知识库） |
| 来源 URL | https://github.com/AlexHercules/geode |
| 版本 | 0.269.0 |
| 校验值 | 源码仓库，无二进制 SHA256。完整性锚点为 **commit `7a8ce22cb6fd289913c1032e7ecdc3667033748e`** 与 **tree `09a6f647b1fad36d17942bed7fa74602ca405ba1`**，可用 `git cat-file -p 7a8ce22` 与 `git ls-tree` 复核 |
| 用途 | 本项目代码基线。本项目在其之上做分层深度改造，改造范围见 `docs/PROVENANCE.adoc` |
| 许可结论 | **Apache-2.0，允许闭源衍生**。义务：保留 `LICENSE` 全文；修改过的文件带显著变更声明（已在 22 个 SCSS 文件头标注）；上游无 `NOTICE` 文件，故无第 4(d) 条传播义务。**「Geode」名称与图标不在授权范围内**，本项目不以该名义发布 |

### 本项目自有的生成物

| 名称 | 来源 | 校验值 | 用途 | 许可结论 |
| --- | --- | --- | --- | --- |
| Blueprint 样本数据 | 本地脚本 `scripts/gen-blueprint-seed.mjs` 生成 | 生成后可复算 | 已废弃并从源码移除（1.3 MB 死代码） | 自有内容，不涉及第三方许可 |
| `app-icon.png` | 上游随仓库提供 | `assets/app-icon.png` | 应用图标素材 | 随上游 Apache-2.0 一并授权；若对外发布需替换为自有图标，避免商标风险 |

---

## 评估期参考仓库（未纳入产物）

以下仓库为选型阶段的调研对象，**代码未进入本项目产物**，仅用于确认技术路线与能力边界。登记目的是满足「先搜寻，后自研」的留痕要求。

| 名称 | 来源 | 许可 | 结论 |
| --- | --- | --- | --- |
| Joplin | https://github.com/laurent22/joplin | AGPL-3.0 | 未采用。正文存于 SQLite 无文件路径；AGPL 传染 |
| Logseq | https://github.com/logseq/logseq | AGPL-3.0 | 未采用。块级 UUID 模型与长文档规范冲突 |
| Nodum | https://github.com/nodummd/nodum | MIT | 未采用。服务端多租户，与本地优先冲突 |
| Knowledge Base | https://github.com/hamawang/knowledge-base | AGPL-3.0（双许可） | 未采用。`notes.content` 存库，无 `file_path` |
| Opensidian | https://github.com/jpzk/opensidian | GPL-3.0 | 未采用。Rust + 原生 JS，无 TypeScript |
| Lokus | https://github.com/lokus-ai/lokus | FCL-1.0-MIT | 未采用。延迟开源许可，非 OSI 认可 |
| Luhmann | https://github.com/graemeg/luhmann | BSD-3-Clause（源文件头标 MIT，存在矛盾） | 未采用。Pascal，无法进入 TS 生态；仅借鉴其能力边界认知 |
| Otterly | https://github.com/ajkdrag/otterly | MIT | 未采用。Svelte 技术栈，功能面窄于本项目需求 |
| Mdit | https://github.com/hjinco/mdit | Apache-2.0 | 未采用。块编辑器与源码可编辑模型冲突 |

---

## 运行期依赖

运行期依赖不做逐项登记，理由：全部通过 `package.json` + `package-lock.json` 锁定，版本与完整性由 npm 校验，符合规范「版本登记在 `devDependencies` 并由 lockfile 锁定」的要求。需要逐项审计时以 lockfile 为单一真相源。

---

## 维护规则

- 新增任何第三方源码副本、二进制或逆向产物，必须先在本文件登记再引入。
- 校验值优先使用 SHA256；源码仓库可用 commit + tree 作为等价锚点，须在条目中说明复核命令。
- 许可结论必须写明「允许 / 不允许 / 有条件允许」，并列出具体义务；只写许可名称视为未填写。
