# MANIFEST

第三方二进制、源码与逆向对象的来源登记。字段：名称 · 来源 URL · 版本 · 校验值 · 用途 · 许可结论。

**许可结论非空**为硬要求；空白的登记项视为未登记。

---

## 纳入产物的第三方源码

### jsdom — development tests only

- 来源：https://github.com/jsdom/jsdom；npm `jsdom@31.0.1`，MIT。
- 完整性：版本固定；完整包 URL 与 integrity 见 `package-lock.json` 的 `node_modules/jsdom`。
- 用途：ReactDOM EPUB 生命周期测试的 DOM 环境；用户于 2026-11-15 明确批准添加。
- 边界：仅 devDependency；不进入生产应用。复用已有 React、ReactDOM、Vitest，不增加另一套测试运行器。
- License conclusion: MIT permits this use. Retain the package's copyright and license notice when redistributing it; npm preserves those files. No jsdom runtime import is added to the application.

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
| Blueprint 样本数据 | 本地脚本 `scripts/gen-blueprint-seed.ts` 生成 | 生成后可复算 | 已废弃并从源码移除（1.3 MB 死代码） | 自有内容，不涉及第三方许可 |
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

## 格式扩展检索评估与放行记录（2026-11-15）

按《强制工程校验规范》「先搜寻，后自研」的 0→6 顺序执行：级别 0/1（标准库 + 项目已有依赖）先落地 FB2 / CBZ / 图片阅读器；级别 2/3（npm 包注册表 + 代码托管平台）就其余格式做了两轮检索，关键词包括「JavaScript ebook parser MOBI AZW3 FB2 CBZ」「DJVU viewer wasm / libarchive.js CBR / HEIC decoder wasm」。T-054 时**未引入任何新包**；用户于 2026-11-15 22:47 后以「做 q005」放行后，仅引入下列 1 个运行期依赖，其余候选仍不引入。

**已放行的运行期依赖（Q-005）**：

| 字段 | 内容 |
| --- | --- |
| 名称 | `@lingo-reader/mobi-parser` |
| 来源 URL | https://registry.npmjs.org/@lingo-reader/mobi-parser/-/mobi-parser-0.4.6.tgz （上游 https://github.com/hhk-png/lingo-reader） |
| 版本 | `0.4.6`，`--save-exact` 钉选；`package.json` + `package-lock.json` 锁定 |
| 校验值 | `sha512-/TDhO4IuKI04Ci5Bg8294GBhg5tnYzRM+RDlZQFE4HW2hvQHYb03dObZsOIE5gg7huwRovxpso/sWTWoZVHD7A==`（npm dist.integrity，可对照 lockfile 复核） |
| 用途 | `.mobi/.azw/.prc`（`initMobiFile`）与 `.azw3/.kf8`（`initKf8File`）只读解析；浏览器入口 `dist/index.browser.mjs`，动态 import 独立 chunk |
| 评估数据 | MIT；unpacked 196,214 B；依赖 `fflate` + `@lingo-reader/shared`（均 MIT）；周下载 2,661（2026-11-08～11-14）；创建 2025-02-01、最后修改 2026-04-06；单维护者 |
| 许可结论 | **允许闭源衍生**（MIT）。义务：保留随包 `LICENSE` 的版权与许可声明（npm 已随附，分发产物时须一并保留）；无 copyleft、无 NOTICE 要求。版本 <1.0 属已知风险，钉选 + 组件测试 + Node 侧导入回归一起约束 |

**其余候选仍不引入（本片结论）**：

| 候选 | 来源 | 许可 | 排除理由 |
| `foliate-js` | github.com/johnfactotum/foliate-js | MIT | 覆盖 EPUB/MOBI/KF8/FB2/CBZ 且零依赖，但作者明示「API 不稳定、随时会变」，仓库近半年活动放缓；引入等于把已稳定的 epub.js 阅读链路整体换掉，风险与收益不匹配 |
| `rebook` | npm `rebook@0.1.2` | 见包内声明 | 2026 年新包（0.1.2），TypeScript 且覆盖 MOBI/AZW3/FB2/CBZ，但版本成熟度不足，需独立评估片 |
| `epubier` | npm `epubier@0.4.1` | 见包内声明 | drop-in 阅读器 UI，需 `pdfjs-dist` / `@lingo-reader/mobi-parser` / `libarchive.js` 等多个 peer 与 worker 打包，与本项目的组件化只读预览路径重复 |
| `@mdgate/mobi` | npm `@mdgate/mobi@0.6.25` | MIT | 纯 TS 解析 MOBI/AZW3，但只输出 Markdown：**不提取图片/字体/音频、部分 AZW3 丢结构、不支持 NCX 与 DRM**，作为「只读电子书预览」会静默丢内容 |
| `@lingo-reader/mobi-parser` | npm `0.4.6` | MIT | **已放行并引入**（见上表）；表中其余 `@lingo-reader/*` 子包（epub / fb2 / shared 独立引入）仍未采用，避免与既有 epub.js / 自有 FB2 解析重复 |
| `libarchive.js` | npm（MIT；libarchive BSD-2-Clause） | MIT / BSD-2-Clause | 可解 CBR/CB7（RAR/7z），但需 wasm worker 与打包配置；本片已有 jszip 路径，先不叠加 |
| `libheif-js` | npm `libheif-js@1.23.5` | **LGPL-3.0** | 可解 HEIC/HEIF，但 9 MB wasm 且弱著佐权许可，需专门做动态链接/替换义务评估；WebView2 原生不解码 HEIC，不能靠注册扩展名解决 |
| DJVU / TIFF / JXL / PSD / RAW | 检索未见成熟且许可清晰的 npm 浏览器包（DJVU 方案多为站点自行编译 `djvu-rs` wasm） | — | 无可靠可复用实现，按级别 6 自研成本过高，暂不排期 |

**结论**：级别 0/1 已满足「更多电子书格式 + 图片预览」；Q-005 放行后仅补齐 Kindle 家族（MOBI/KF8），其余 B 档格式（CBR/CB7 需 wasm worker、HEIC/HEIF 需 LGPL-3.0 的 9 MB 解码器、DJVU/TIFF/JXL/PSD/RAW 无成熟实现）仍记为「评估过、未引入」，需用户再次单独放行后独立成片。仓库内不打包任何第三方电子书样本二进制：E2E 用合成无效文件验证路由与错误反馈，真实解析链路依赖 Node 侧导入回归与组件级测试。

---

## 维护规则

- 新增任何第三方源码副本、二进制或逆向产物，必须先在本文件登记再引入。
- 校验值优先使用 SHA256；源码仓库可用 commit + tree 作为等价锚点，须在条目中说明复核命令。
- 许可结论必须写明「允许 / 不允许 / 有条件允许」，并列出具体义务；只写许可名称视为未填写。
