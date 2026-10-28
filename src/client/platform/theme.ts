/**
 * 宿主明暗探测（platform/theme）。
 *
 * 整体 UI 重设计后插件自带 --gmm-* 设计令牌（src/client/css/tokens.ts），不再跟随宿主的
 * --dsw-alias-* 主题令牌，所以要把「宿主现在是深色还是浅色」测出来，写到
 * <html data-gmm-theme="dark|light"> 上，CSS 据此切两套值。
 *
 * 为什么挂在 <html> 而不是面板根节点：
 *   1. 面板根节点是 React 渲染的，要用 Hook 才能拿到；面板的 Hook 槽位被
 *      verify-feedback 逐槽位喂桩数据（数量/顺序一变整片断言错位），不该为了主题多一个 Hook。
 *   2. 设置页（config-section）不在面板里，挂在 <html> 上它也能跟着换。
 *   属性前缀只作用于 .SPR_* 类，不会影响宿主自己的界面。
 *
 * 探测口径（按可靠性排序）：
 *   1. 探针元素的背景取宿主 alias 令牌 --dsw-alias-bg-layer-1，读回 computed rgb 判亮度；
 *   2. 退到 body / html 的背景色；
 *   3. 再退到 prefers-color-scheme。
 */

export interface ThemeProbeDeps {
  window: any;
  document: any;
}

const DARK_LUMA = 128;
const ATTR = "data-gmm-theme";

function parseRgb(value: string): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value);
  if (m === null) return null;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return [r, g, b];
}

function lumaOf(rgb: [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function createTheme(deps: ThemeProbeDeps) {
  const win = deps.window;
  const doc = deps.document;
  let observer: any = null;
  let media: any = null;
  let stopped = false;

  /** 读一个元素上会跟随主题变化的背景色；全透明视为「这层没上色」。 */
  function bgOf(el: any): [number, number, number] | null {
    if (el === undefined || el === null) return null;
    try {
      const raw = String(win.getComputedStyle(el).backgroundColor ?? "");
      if (/rgba\([^)]*,\s*0(\.0+)?\s*\)/.test(raw)) return null;
      return parseRgb(raw);
    } catch {
      return null;
    }
  }

  function probeByToken(): [number, number, number] | null {
    const host = doc?.body ?? doc?.documentElement;
    if (host === undefined || host === null || typeof doc.createElement !== "function") return null;
    let probe: any = null;
    try {
      probe = doc.createElement("div");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText =
        "position:absolute;left:-9999px;top:0;width:1px;height:1px;pointer-events:none;background-color:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-canvas,transparent))";
      host.appendChild(probe);
      return bgOf(probe);
    } catch {
      return null;
    } finally {
      try {
        if (probe !== null && typeof probe.remove === "function") probe.remove();
      } catch {
        /* 探测失败不影响主流程 */
      }
    }
  }

  /** "dark" | "light" —— 探测失败一律按浅色（设计稿以浅色为主）。 */
  function current(): "dark" | "light" {
    if (win === undefined || win === null || doc === undefined || doc === null) return "light";
    const sampled = probeByToken() ?? bgOf(doc.body) ?? bgOf(doc.documentElement) ?? null;
    if (sampled !== null) return lumaOf(sampled) < DARK_LUMA ? "dark" : "light";
    try {
      return typeof win.matchMedia === "function" && win.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      return "light";
    }
  }

  /** 把当前明暗写到 <html data-gmm-theme>；宿主换肤时自动重测。 */
  function apply(): void {
    const root = doc?.documentElement;
    if (root === undefined || root === null || stopped) return;
    try {
      root.setAttribute(ATTR, current());
    } catch {
      /* 属性写不进去就按浅色渲染 */
    }
  }

  /** 订阅宿主主题变化并立即同步一次；返回停止函数。 */
  function start(): () => void {
    apply();
    const sync = () => apply();
    try {
      media = typeof win?.matchMedia === "function" ? win.matchMedia("(prefers-color-scheme: dark)") : null;
      if (media !== null && typeof media.addEventListener === "function") media.addEventListener("change", sync);
      else if (media !== null && typeof media.addListener === "function") media.addListener(sync);
    } catch {
      media = null;
    }
    try {
      const Observer = win?.MutationObserver;
      if (typeof Observer === "function") {
        observer = new Observer(sync);
        const attrs = ["class", "style", "data-theme", "data-dsw-theme", "data-color-scheme", "data-mode"];
        if (doc?.documentElement) observer.observe(doc.documentElement, { attributes: true, attributeFilter: attrs });
        if (doc?.body) observer.observe(doc.body, { attributes: true, attributeFilter: attrs });
        // 宿主换主题的常见实现是往 head 里换 <style>，attribute 观察不到。
        if (doc?.head) observer.observe(doc.head, { childList: true, subtree: true });
      }
    } catch {
      observer = null;
    }
    return () => {
      stopped = true;
      try {
        if (media !== null && typeof media.removeEventListener === "function") media.removeEventListener("change", sync);
        else if (media !== null && typeof media.removeListener === "function") media.removeListener(sync);
      } catch {
        /* 忽略 */
      }
      try {
        if (observer !== null && typeof observer.disconnect === "function") observer.disconnect();
      } catch {
        /* 忽略 */
      }
    };
  }

  return { current, apply, start };
}
