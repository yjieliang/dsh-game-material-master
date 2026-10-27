/**
 * 浏览器半区 · 集中轮询调度（platform/scheduler）。
 *
 * 现在的问题：2500ms 的 setInterval 有 4 处、5000ms 2 处、15000ms 2 处，各模块
 * 互相不知道对方在跑；页面切到后台照跑；请求失败就干等下一个周期；同一个 key
 * 的两次请求可能叠在一起（慢网关时尤其明显）。
 *
 * 这个调度器把这些行为集中成一处策略：
 *   · 去重    —— 同一 key 上一轮没回来，这一轮直接跳过并计 stale
 *   · 退避    —— 失败后 2x 增长（上限 = 基础间隔的 8 倍）+ 抖动，成功后复位
 *   · 可见性  —— document 隐藏时全暂停，回到前台立即补跑一次
 *   · 并发上限 —— 同时最多 N 个在飞，超出排队（避免多模块同时打同一网关）
 *   · 生命周期 —— 组件卸载 unwatch 即释放，不再需要各自清 setInterval
 *
 * 计时器可注入（测试用假时钟），生产用默认的 window.setInterval。
 */

/** 一个轮询任务。 */
export interface PollEntryOptions {
  /** 唯一 key（建议 module:entity:id） */
  key: string;
  /** 基础间隔（毫秒） */
  intervalMs: number;
  /** 实际执行的拉取函数 */
  run: () => unknown | Promise<unknown>;
  /** 是否启用；false 时不跑但保留注册 */
  enabled?: boolean;
  /** 注册后是否立刻跑一次（默认 true） */
  immediate?: boolean;
  /** 失败回调（用于 UI 展示，不改变调度行为） */
  onError?: (error: unknown) => void;
}

/** 调度器句柄。 */
export interface PollHandle {
  /** 取消注册 */
  cancel(): void;
  /** 立刻补跑一次（会走同一条去重/并发路径） */
  poke(): void;
  /** 读当前注册项（调试用） */
  readonly key: string;
  readonly enabled: boolean;
}

/** 统计快照（性能与可用性验收用）。 */
export interface PollStats {
  registrations: number;
  runs: number;
  failures: number;
  stale: number;
  deferred: number;
  inflight: number;
  paused: boolean;
}

interface Entry {
  key: string;
  intervalMs: number;
  run: () => unknown | Promise<unknown>;
  enabled: boolean;
  onError?: (error: unknown) => void;
  nextAt: number;
  failures: number;
  inflight: boolean;
}

/** 调度器配置。 */
export interface PollSchedulerOptions {
  /** 主时钟粒度，默认 250ms */
  tickMs?: number;
  /** 同时在飞上限，默认 3 */
  maxConcurrent?: number;
  /** 时间源（测试可注入） */
  now?: () => number;
  /** 定时器实现（测试可注入） */
  setTimer?: (fn: () => void, ms: number) => any;
  clearTimer?: (handle: any) => void;
  /** 页面可见性来源；不传则用 globalThis.document */
  documentRef?: any;
}

/**
 * 创建调度器。
 * @param options - 配置
 * @returns 调度器
 */
export function createPollScheduler(options: PollSchedulerOptions = {}) {
  const tickMs = options.tickMs ?? 250;
  const maxConcurrent = options.maxConcurrent ?? 3;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: any) => clearInterval(handle));
  const doc = options.documentRef ?? (typeof document === "undefined" ? undefined : document);

  const entries: Map<string, Entry> = new Map();
  const stats: PollStats = { registrations: 0, runs: 0, failures: 0, stale: 0, deferred: 0, inflight: 0, paused: false };
  let timer: any = null;
  let disposed = false;

  const visible = (): boolean => {
    if (stats.paused) return false;
    if (doc === undefined || doc === null) return true;
    return doc.visibilityState !== "hidden";
  };

  const scheduleEntry = (entry: Entry): void => {
    const factor = Math.min(8, Math.pow(2, entry.failures));
    const base = entry.intervalMs * factor;
    const jitter = entry.failures === 0 ? base * 0.1 * Math.random() : base * 0.2 * Math.random();
    entry.nextAt = now() + base + jitter;
  };

  const runEntry = async (entry: Entry): Promise<void> => {
    if (entry.inflight) {
      stats.stale++;
      return;
    }
    if (stats.inflight >= maxConcurrent) {
      stats.deferred++;
      return;
    }
    entry.inflight = true;
    stats.inflight++;
    stats.runs++;
    try {
      await entry.run();
      entry.failures = 0;
    } catch (error) {
      entry.failures++;
      stats.failures++;
      try {
        entry.onError?.(error);
      } catch {
        /* 失败回调自己出错不能影响调度 */
      }
    } finally {
      entry.inflight = false;
      stats.inflight--;
      scheduleEntry(entry);
    }
  };

  const tick = (): void => {
    if (disposed) return;
    if (!visible()) return;
    const at = now();
    for (const entry of entries.values()) {
      if (!entry.enabled) continue;
      if (entry.inflight) continue;
      if (entry.nextAt > at) continue;
      void runEntry(entry);
    }
  };

  const onVisibility = (): void => {
    if (!visible()) return;
    // 回到前台：所有到期项立刻补跑一次（错过的周期不补，只补最新状态）
    const at = now();
    for (const entry of entries.values()) {
      if (entry.enabled && entry.nextAt > at) entry.nextAt = at;
    }
  };

  if (doc !== undefined && doc !== null && typeof doc.addEventListener === "function") {
    doc.addEventListener("visibilitychange", onVisibility);
  }

  const start = (): void => {
    if (timer !== null || disposed) return;
    timer = setTimer(tick, tickMs);
  };
  start();

  return {
    /**
     * 注册（或覆盖）一个轮询任务。
     * @param opts - 任务定义
     * @returns 句柄；组件卸载时调用 handle.cancel()
     */
    watch(opts: PollEntryOptions): PollHandle {
      const immediate = opts.immediate !== false;
      const entry: Entry = {
        key: opts.key,
        intervalMs: opts.intervalMs,
        run: opts.run,
        enabled: opts.enabled !== false,
        onError: opts.onError,
        nextAt: immediate ? now() : now() + opts.intervalMs,
        failures: 0,
        inflight: false
      };
      if (!entries.has(opts.key)) stats.registrations++;
      entries.set(opts.key, entry);
      if (immediate && entry.enabled) void runEntry(entry);
      return {
        key: entry.key,
        get enabled() {
          return entry.enabled;
        },
        cancel() {
          if (entries.get(entry.key) === entry) entries.delete(entry.key);
        },
        poke() {
          entry.nextAt = now();
        }
      };
    },
    /** 按 key 取消。 */
    unwatch(key: string): void {
      entries.delete(key);
    },
    /** 整体暂停（例如编辑器全屏时）。 */
    pause(): void {
      stats.paused = true;
    },
    /** 恢复。 */
    resume(): void {
      if (!stats.paused) return;
      stats.paused = false;
      onVisibility();
    },
    /** 立刻补跑某个 key。 */
    poke(key: string): void {
      const entry = entries.get(key);
      if (entry !== undefined) entry.nextAt = now();
    },
    /** 统计快照（只读拷贝）。 */
    stats(): PollStats {
      return { ...stats, registrations: entries.size };
    },
    /** 停止并清空（模块卸载 / 插件重载时调用）。 */
    dispose(): void {
      disposed = true;
      entries.clear();
      if (timer !== null) clearTimer(timer);
      timer = null;
      if (doc !== undefined && doc !== null && typeof doc.removeEventListener === "function") {
        doc.removeEventListener("visibilitychange", onVisibility);
      }
    }
  };
}

/** 调度器类型。 */
export type PollScheduler = ReturnType<typeof createPollScheduler>;
