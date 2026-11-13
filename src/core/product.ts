/**
 * ADKM: 产品身份占位符 —— 单一事实来源。
 *
 * 本文件是当前唯一允许书写「产品叫什么、是什么、基于什么」的地方。
 * 所有值均为占位符，等待项目所有者填写，见 docs/product-placeholders.md。
 *
 * 设计要点（为将来的 I18N 改造预留）：
 *  - 消费方只读取这里的常量，不自行拼接品牌文案；
 *  - 未来做完整国际化时，只需把本文件换成「按 locale 取值」的实现，
 *    消费方一行都不用改；
 *  - 占位符使用全大写下划线形式，便于全局检索与逐步替换。
 *
 * 注意：包名、Tauri identifier、图标文件等属于构建期标识，不在本文件内；
 * 它们同样列在待填清单里，改动前请阅读该文档的「不可直接改」一节。
 */

export const PRODUCT = {
  /** 产品名：窗口标题、关于页、安装包显示名 */
  name: "APP_NAME",
  /** 展示用版本号（真实构建版本仍以 package.json / tauri.conf.json 为准） */
  version: "0.0.0",
  /** 一句话标语：欢迎页 / 空 vault 提示 */
  tagline: "APP_TAGLINE",
  /** 关于页的长描述 */
  description: "APP_DESCRIPTION",
  /** 关于页的技术栈说明行 */
  techStack: "APP_TECH_STACK",
  /** 关于页的临时图形占位（未来换正式图标资源） */
  logo: "APP_LOGO",
  /** 版权 / 归属行（关于页预留，当前未渲染） */
  credit: "APP_CREDIT",
} as const;

export type ProductKey = keyof typeof PRODUCT;
