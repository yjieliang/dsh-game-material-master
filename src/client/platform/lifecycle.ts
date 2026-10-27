/**
 * 浏览器半区 · 资源登记（platform/lifecycle）。
 *
 * 现在 39 个定时器 / 41 个 addEventListener 散在各组件的 useEffect 里，靠每处
 * 自己写清理；漏一处就是「切模块后还在偷偷请求」。这里给一个统一的登记簿：
 * 组件挂载时把 timer / listener / RAF 交上来，卸载时一次性释放。
 *
 *   const resources = useResources();
 *   resources.timer(() => poll(), 2500);
 *   resources.listener(window, "resize", onResize);
 *   resources.raf(loop);
 *
 * 约定：新代码一律走这里；架构自检会拦住裸 setInterval。
 */

import { studio } from "./runtime.js";

/** 登记簿。 */
export interface Resources {
  timer(fn: () => void, ms: number, repeat?: boolean): () => void;
  listener(target: any, event: string, handler: (event: any) => void, options?: any): () => void;
  raf(fn: (time: number) => void): () => void;
  cleanup(fn: () => void): () => void;
  /** 释放全部（组件卸载/模块销毁） */
  dispose(): void;
  /** 当前登记数量（泄漏排查） */
  size(): number;
}

/**
 * 创建一个手动登记簿（非组件代码也能用）。
 * @returns 登记簿
 */
export function createResources(): Resources {
  const disposers: Array<() => void> = [];
  const track = (dispose: () => void): (() => void) => {
    disposers.push(dispose);
    return () => {
      const index = disposers.indexOf(dispose);
      if (index >= 0) disposers.splice(index, 1);
      dispose();
    };
  };
  return {
    timer(fn: () => void, ms: number, repeat = true): () => void {
      const handle = repeat ? setInterval(fn, ms) : setTimeout(fn, ms);
      return track(() => (repeat ? clearInterval(handle) : clearTimeout(handle)));
    },
    listener(target: any, event: string, handler: (event: any) => void, options?: any): () => void {
      if (target === undefined || target === null || typeof target.addEventListener !== "function") return () => {};
      target.addEventListener(event, handler, options);
      return track(() => target.removeEventListener(event, handler, options));
    },
    raf(fn: (time: number) => void): () => void {
      if (typeof requestAnimationFrame !== "function") return () => {};
      const handle = requestAnimationFrame(fn);
      return track(() => cancelAnimationFrame(handle));
    },
    cleanup(fn: () => void): () => void {
      return track(fn);
    },
    dispose(): void {
      const pending = disposers.splice(0, disposers.length);
      for (const dispose of pending) {
        try {
          dispose();
        } catch {
          /* 单个清理失败不阻断其余清理 */
        }
      }
    },
    size(): number {
      return disposers.length;
    }
  };
}

/**
 * 组件内的登记簿：卸载时自动 dispose。
 * @returns 登记簿
 */
export function useResources(): Resources {
  const { React } = studio();
  const ref = React.useRef(null);
  if (ref.current === null) ref.current = createResources();
  React.useEffect(() => {
    const owned: Resources = ref.current;
    return () => owned.dispose();
  }, []);
  return ref.current;
}
