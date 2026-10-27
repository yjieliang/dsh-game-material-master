/**
 * 浏览器半区 · 轻量可观测性（platform/perf）。
 *
 * 性能与可用性问题最大的敌人是「只能靠肉眼猜」。这里提供极小的计数器：
 *   · 渲染次数（按组件名）  —— 验证「一次轮询只重渲染 1–3 个组件」
 *   · 远程调用（次数/耗时/失败）—— 验证「请求数 ≤ 活跃任务数」
 *   · 错误（按作用域）      —— 错误边界与轮询失败会记一笔
 *   · 轮询统计               —— 由 scheduler.stats() 提供，调试时读
 *
 * 开发态挂在 window.__GMM_PERF__ 上；生产构建默认只保留计数（开销可忽略），
 * 由组合根决定是否暴露到 window。
 */

/** 单次远程调用统计。 */
export interface CallStat {
  count: number;
  failures: number;
  totalMs: number;
  maxMs: number;
}

/** 错误记录。 */
export interface ErrorRecord {
  scope: string;
  message: string;
  at: number;
}

/** 计数器。 */
export interface Perf {
  recordRender(name: string): void;
  recordCall(method: string, ms: number, ok: boolean): void;
  recordError(scope: string, error: unknown): void;
  renderCount(name: string): number;
  callStat(method: string): CallStat | undefined;
  snapshot(): {
    renders: Record<string, number>;
    calls: Record<string, CallStat>;
    errors: ErrorRecord[];
    totalRenders: number;
    totalCalls: number;
  };
  reset(): void;
  /** 开发态暴露到 globalThis[globalName] */
  installGlobal(globalName?: string): void;
}

/**
 * 创建计数器。
 * @param options.enabled - 是否计数（默认 true；生产可传 false 只留空实现）
 * @param options.maxErrors - 错误保留条数（默认 50）
 * @returns 计数器
 */
export function createPerf(options: { enabled?: boolean; maxErrors?: number } = {}): Perf {
  const enabled = options.enabled !== false;
  const maxErrors = options.maxErrors ?? 50;
  let renders: Map<string, number> = new Map();
  let calls: Map<string, CallStat> = new Map();
  let errors: ErrorRecord[] = [];
  let totalRenders = 0;
  let totalCalls = 0;

  const toObject = <V>(map: Map<string, V>): Record<string, V> => {
    const out: Record<string, V> = {};
    for (const [key, value] of map) out[key] = value;
    return out;
  };

  return {
    recordRender(name: string): void {
      if (!enabled) return;
      totalRenders++;
      renders.set(name, (renders.get(name) ?? 0) + 1);
    },
    recordCall(method: string, ms: number, ok: boolean): void {
      if (!enabled) return;
      totalCalls++;
      const current = calls.get(method) ?? { count: 0, failures: 0, totalMs: 0, maxMs: 0 };
      current.count++;
      current.totalMs += ms;
      current.maxMs = Math.max(current.maxMs, ms);
      if (!ok) current.failures++;
      calls.set(method, current);
    },
    recordError(scope: string, error: unknown): void {
      if (!enabled) return;
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ scope, message, at: Date.now() });
      if (errors.length > maxErrors) errors = errors.slice(errors.length - maxErrors);
    },
    renderCount(name: string): number {
      return renders.get(name) ?? 0;
    },
    callStat(method: string): CallStat | undefined {
      return calls.get(method);
    },
    snapshot() {
      return {
        renders: toObject(renders),
        calls: toObject(calls),
        errors: [...errors],
        totalRenders,
        totalCalls
      };
    },
    reset(): void {
      renders = new Map();
      calls = new Map();
      errors = [];
      totalRenders = 0;
      totalCalls = 0;
    },
    installGlobal(globalName = "__GMM_PERF__"): void {
      if (typeof globalThis === "undefined") return;
      (globalThis as any)[globalName] = this;
    }
  };
}

/**
 * 记住当前进程的计数器（组合根 installRuntime 时挂进去，便于非组件代码记录）。
 * 这是一个可被子会话覆盖的弱引用，不做强约束。
 */
export const perf: Perf = createPerf();
