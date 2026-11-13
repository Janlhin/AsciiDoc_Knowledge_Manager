import { Store, useStore } from "./store";
import * as dictAllProperties from "./i18n/dict.allproperties";
import * as dictApp from "./i18n/dict.app";
import * as dictBlockRef from "./i18n/dict.blockref";
import * as dictBookmarks from "./i18n/dict.bookmarks";
import * as dictPanels from "./i18n/dict.panels";
import * as dictQuery from "./i18n/dict.query";
import * as dictSlides from "./i18n/dict.slides";
import * as dictViews from "./i18n/dict.views";

/**
 * i18n (R8) — centralized UI strings, en/zh.
 *
 * Dictionaries are merged from per-agent fragment files (core/i18n/dict.*.ts);
 * keys are namespaced ("explorer.newNote"). `t()` resolves against the current
 * locale with en fallback and never throws — a missing key renders as itself.
 *
 * This module is the second hooks exception in core besides store.ts
 * (one React hook, no components).
 *
 * ADKM: 语言「偏好」与「生效语言」分离。`localePref` 是用户可选项（含
 * 「跟随系统」），`locale` 始终是解析后的具体语言（"en" | "zh"），因此
 * 50+ 处消费方无需感知 "system"。未来做完整 I18N 改造时，扩展 `Locale`
 * 联合类型并只改 `resolveLocale()` 即可，其余调用链保持不变。
 */

export type Locale = "en" | "zh";
/** ADKM: 用户可选的偏好；"system" 为默认值 */
export type LocalePref = "system" | Locale;

const en = {
  ...dictApp.en,
  ...dictPanels.en,
  ...dictViews.en,
  ...dictBookmarks.en,
  ...dictAllProperties.en,
  ...dictSlides.en,
  ...dictQuery.en,
  ...dictBlockRef.en,
};
const zh: Record<string, string> = {
  ...dictApp.zh,
  ...dictPanels.zh,
  ...dictViews.zh,
  ...dictBookmarks.zh,
  ...dictAllProperties.zh,
  ...dictSlides.zh,
  ...dictQuery.zh,
  ...dictBlockRef.zh,
};

export type I18nKey = keyof typeof en;

const STORAGE_KEY = "geode.locale";

/** ADKM: 系统语言 → 当前支持的具体语言。未来新增语种只改这里。 */
export function resolveLocale(pref: LocalePref): Locale {
  if (pref !== "system") return pref;
  try {
    const lang = (navigator.language ?? "").toLowerCase();
    return lang.startsWith("zh") ? "zh" : "en";
  } catch {
    // 非浏览器环境（测试 / SSR）
    return "en";
  }
}

function detectInitialPref(): LocalePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // 历史值 "en" / "zh" 仍有效（用户显式选过则尊重）；
    // 没有存储时默认跟随系统，不再硬编码任何语言。
    if (stored === "en" || stored === "zh" || stored === "system") return stored;
  } catch {
    // storage unavailable — fall through to system detection
  }
  return "system";
}

/** ADKM: 用户偏好（可为 "system"）。设置页下拉绑定它。 */
export const localePref = new Store<LocalePref>(detectInitialPref());

/** Current UI locale. Subscribe via useStore / useI18n to re-render on switch. */
export const locale = new Store<Locale>(resolveLocale(localePref.get()));

export function setLocale(pref: LocalePref): void {
  const next: LocalePref =
    pref === "en" || pref === "zh" || pref === "system" ? pref : "system";
  localePref.set(next);
  locale.set(resolveLocale(next));
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // storage unavailable — locale stays session-local
  }
}

/** ADKM: 系统语言变化时重算「跟随系统」偏好。启动时调用一次。 */
export function watchSystemLocale(): void {
  try {
    window.addEventListener("languagechange", () => {
      if (localePref.get() !== "system") return;
      locale.set(resolveLocale("system"));
    });
  } catch {
    /* no window (non-browser context) */
  }
}

/** Translate a key: current locale → en fallback → the key itself.
 *  `params` interpolate "{name}"-style placeholders. */
export function t(key: I18nKey, params?: Record<string, string | number>): string {
  const primary = locale.get() === "zh" ? zh[key] : undefined;
  let text = primary ?? (en as Record<string, string>)[key] ?? String(key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}

/** React hook: subscribes to the locale store and returns `t`, so components
 *  using it re-render when the language changes. */
export function useI18n(): typeof t {
  useStore(locale);
  return t;
}
