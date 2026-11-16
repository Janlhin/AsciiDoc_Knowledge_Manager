/**
 * ADKM: 产品身份占位符 —— 单一事实来源。
 *
 * 本文件是当前唯一允许书写「产品叫什么、是什么、基于什么」的地方。
 * 值已按 ADKM 填写（2026-11-16），填写记录见 docs/product-placeholders.adoc。
 *
 * 设计要点（为将来的 I18N 改造预留）：
 *  - 消费方只读取这里的常量，不自行拼接品牌文案；
 *  - 未来做完整国际化时，只需把本文件换成「按 locale 取值」的实现，
 *    消费方一行都不用改；
 *  - 版本号取自 package.json，不在此处二次维护。
 *
 * 注意：包名、Tauri identifier、图标文件等属于构建期标识，不在本文件内；
 * 它们同样列在待填清单里，改动前请阅读该文档的「不可直接改」一节。
 */

import pkg from "../../package.json";

export const PRODUCT = {
  /** 产品名：窗口标题、关于页、安装包显示名 */
  name: "ADKM",
  /** 展示用版本号：直接取 package.json，避免与构建版本脱节 */
  version: pkg.version,
  /** 一句话标语：欢迎页 / 空 vault 提示 */
  tagline: "本地优先的 AsciiDoc 知识库",
  /** 关于页的长描述 */
  description:
    "把 AsciiDoc 与 Markdown 收进同一个本地库：统一索引、跨格式链接、离线可用。基于 Geode（Apache-2.0）构建。",
  /** 关于页的技术栈说明行 */
  techStack: "Tauri 2 · React 19 · TypeScript · CodeMirror 6",
  /** 关于页的临时图形占位（未来换正式图标资源） */
  logo: "◆",
  /** 版权 / 归属行（关于页预留，当前未渲染） */
  credit: "© 2026 Janlhin · Built on Geode (Apache-2.0)",
} as const;

export type ProductKey = keyof typeof PRODUCT;
