/**
 * 浏览器半区 · 极简可订阅 store（platform/store）。
 *
 * 解决什么问题：现在 265 个 useState 把任务状态放在组件里，每 2.5 秒一次的轮询
 * 回包 setState 就会重渲染整棵模块子树（地图/骨骼这种大组件首当其冲）。
 * 改成「状态在 store、组件按 selector 订阅」之后，一次轮询只重渲染真正用到
 * 那个字段的组件。
 *
 * 不引第三方状态库（客户端禁止 import 第三方）；这里只做三件事：
 *   · 极小的 setState + 订阅（同步通知、无中间件）
 *   · useStore(store, selector) —— 基于 useSyncExternalStore 的精确订阅
 *   · selector 结果用 Object.is 比较，引用没变就不重渲染
 *
 * 约定：store 里放「渲染要用的数据」；高频播放/画布位置这类每帧都变的值
 * 留在 ref + requestAnimationFrame 里，不要进 store。
 */

import { studio } from "./runtime.js";

/** 最小 store 接口。 */
export interface StudioStore<T extends object> {
  /** 当前状态（引用稳定，变更时整体替换） */
  getState(): T;
  /**
   * 合并式更新：浅合并到当前状态（传函数时先算增量）。
   * @param patch - 部分状态或产生部分状态的函数
   * @returns 更新后的状态
   */
  setState(patch: Partial<T> | ((state: T) => Partial<T>)): T;
  /** 订阅变更；返回取消订阅函数 */
  subscribe(listener: () => void): () => void;
  /** 订阅者数量（泄漏排查用） */
  listenerCount(): number;
}

/**
 * 创建 store。
 * @param initial - 初始状态
 * @param options.name - 名字，仅用于调试与性能埋点
 * @returns store 实例
 */
export function createStore<T extends object>(initial: T, options: { name?: string } = {}): StudioStore<T> & { name: string } {
  let state = initial;
  const listeners: Set<() => void> = new Set();
  const name = options.name ?? "store";

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    name,
    getState(): T {
      return state;
    },
    setState(patch: Partial<T> | ((current: T) => Partial<T>)): T {
      const delta = typeof patch === "function" ? (patch as (current: T) => Partial<T>)(state) : patch;
      if (delta === null || typeof delta !== "object") return state;
      let changed = false;
      const keys = Object.keys(delta) as Array<keyof T>;
      if (keys.length === 0) return state;
      const next = { ...state } as T;
      for (const key of keys) {
        const value = delta[key];
        if (!Object.is(next[key], value)) {
          next[key] = value as T[keyof T];
          changed = true;
        }
      }
      if (!changed) return state;
      state = next;
      notify();
      return state;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    listenerCount(): number {
      return listeners.size;
    }
  };
}

/**
 * 组件内精确订阅 store 的一个切片。
 *
 * @param store - 目标 store
 * @param selector - 从状态里取切片（返回值要尽量是原始值或稳定引用）
 * @param isEqual - 切片比较函数，默认 Object.is
 * @returns 切片值；切片没变时组件不重渲染
 */
export function useStore<T extends object, S>(
  store: StudioStore<T>,
  selector: (state: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is
): S {
  // React 由运行时注入，不在模块顶层 import（客户端禁止 import 第三方）
  const { React } = studio();
  const cache = React.useRef({ has: false as boolean, value: undefined as any });
  const getSnapshot = (): S => {
    const next = selector(store.getState());
    if (cache.current.has && isEqual(cache.current.value, next)) return cache.current.value;
    cache.current = { has: true, value: next };
    return next;
  };
  return React.useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** 内部：避免 store 模块直接 import runtime（保持 platform 内部依赖单向）。 */
function requireRuntime(): { React: any } {
  // 这里用动态取法而不是顶层 import，顺手避免循环依赖
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const runtime = (globalThis as any).__GMM_RUNTIME_FOR_STORE__;
  if (runtime === undefined) {
    throw new Error("platform/store: 没有拿到运行时（installRuntime 应先于任何 useStore）");
  }
  return runtime;
}