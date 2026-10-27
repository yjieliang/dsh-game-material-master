/**
 * 浏览器半区 · 多语言（platform/i18n）。
 *
 * 界面文案一律 T(中文原文)，中文原文就是 key；英文表在 src/client/i18n-en.ts。
 * 模块级（工厂顶层）的 T() 在插件 load 时就求值，那时 locale 服务还没挂上，
 * 所以这些表由 staticTextRebuilders 在语言变化时重建 —— 本文件只负责文案与订阅。
 */

import { EN } from "../i18n-en.js";

export function createI18n(deps: any) {
  // 依赖：组合根注入（先按需展开，由 tsc 报错驱动补齐）
  const {
    PACKAGE,
    rebuildStaticText,
    React,
  } = deps;

    const I18N_NS = PACKAGE;

    const ZH: Record<string, string> = Object.fromEntries(Object.keys(EN).map((key) => [key, key]));

    /** DSH locale 服务给的绑定翻译函数；服务还没挂载时是 null。 */
    let boundTranslate: ((key: string, params?: Record<string, unknown>) => string) | null = null;

    /** locale 服务本身；宿主侧的默认提示词要靠它算出「该用哪国话」。 */
    let localeService: any = null;

    /** 语言变化时要重渲染的订阅者（各模块顶层组件挂一个，子树跟着重渲染）。 */
    const localeListeners: Set<() => void> = new Set();

    function activeLang(): "zh" | "en" {
      const active = localeService?.getSnapshot?.()?.active;
      return typeof active === "string" && active.trim().toLowerCase().startsWith("en") ? "en" : "zh";
    }

    /** `{name}` 插值；与 locale 服务内部用的是同一条规则。 */
    function fill(text: string, params?: Record<string, unknown>): string {
      if (params === undefined) return text;
      return String(text).replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match));
    }

    /** 翻译。没有 locale 服务时退回中文原文——自检脚本直接渲染组件走的就是这条。 */
    function T(key: string, params?: Record<string, unknown>): string {
      return boundTranslate === null ? fill(key, params) : boundTranslate(key, params);
    }

    function installI18n(ctx: any): boolean {
      const locale = ctx.get("locale");
      if (locale === undefined || locale === null) return false;
      try {
        ctx.effect(() => locale.register(I18N_NS, { zh: ZH, en: EN }), `${PACKAGE}: i18n dictionary`);
        localeService = locale;
        boundTranslate = locale.bind(I18N_NS);
        // 模块级文案表是**模块加载时**求值的（那时还没有 locale 服务，全是中文原文），
        // 所以挂上服务的第一件事就是把它们按当前语言重算一遍。
        rebuildStaticText();
        ctx.effect(
          () =>
            locale.subscribe(() => {
              boundTranslate = locale.bind(I18N_NS);
              rebuildStaticText();
              for (const listener of [...localeListeners]) {
                try {
                  listener();
                } catch {
                  // 单个订阅者出错不该拖垮语言切换本身。
                }
              }
            }),
          `${PACKAGE}: locale switch re-render`
        );
        return true;
      } catch {
        return false;
      }
    }

    /** 语言切换时重渲染当前组件。挂在各模块顶层即可，子树跟着一起重渲染。 */
    function useLocaleTick(): number {
      const [tick, setTick] = React.useState(0);
      React.useEffect(() => {
        const listener = () => setTick((value) => value + 1);
        localeListeners.add(listener);
        return () => {
          localeListeners.delete(listener);
        };
      }, []);
      return tick;
    }

    function attachI18n(ctx: any): void {
      if (installI18n(ctx)) return;
      try {
        ctx.inject(["locale"], (child: any) => {
          installI18n(child);
        });
      } catch {
        // 老版本宿主没有 ctx.inject：那就一直用中文原文，界面仍然是完整的。
      }
    }

  return {
    I18N_NS, ZH, boundTranslate, localeService, localeListeners, activeLang, fill, T, installI18n, useLocaleTick, attachI18n
  };
}
