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
 * 一次性延时时器（可取消）：语义与裸 `setTimeout` 完全一致，只是把实现收在 platform。
 *
 * 为什么不走 scheduler：调度器是给**周期轮询**用的（主时钟 250ms + 去重 / 退避 /
 * 页面隐藏暂停）。防抖 / 节流 / 延时刷新大多跟用户这一次操作绑定，塞进调度器会被
 * 主时钟粒度拖慢，而且它们本来就该随 effect 的 cleanup 取消。
 *
 * @param fn - 到点执行
 * @param ms - 延时毫秒
 * @returns 取消函数（effect cleanup 里调，替代 clearTimeout）
 */
export function onceTimer(fn: () => void, ms: number): () => void {
  const handle = setTimeout(fn, ms);
  let cancelled = false;
  return () => {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(handle);
  };
}

/**
 * 周期定时器（可取消）：语义与裸 `setInterval` 完全一致。
 *
 * 只给**纯表现层时钟**用（例如动画帧号推进）。会发请求的轮询不要用它 ——
 * 走 `platform/scheduler.watch`（去重 / 退避 / 页面隐藏暂停都在那边）。
 *
 * @param fn - 每个周期执行
 * @param ms - 周期毫秒
 * @returns 取消函数（effect cleanup 里调，替代 clearInterval）
 */
export function repeatTimer(fn: () => void, ms: number): () => void {
  const handle = setInterval(fn, ms);
  let cancelled = false;
  return () => {
    if (cancelled) return;
    cancelled = true;
    clearInterval(handle);
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
