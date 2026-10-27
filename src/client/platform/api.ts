/**
 * 浏览器半区 · 远程调用客户端（platform/api）。
 *
 * 现在每个组件/模块各写一遍 try/catch + msg()，重试策略、超时、去重都没有统一
 * 的地方；更要命的是**付费方法**（生图/生视频/音乐/音效）没有一层集中护栏。
 *
 * 这一层的职责：
 *   1. 方法元数据：read（可自动重试）/ write（不自动重试）/ paid（必须显式确认，
 *      带 requestId，便于宿主侧做幂等与 receipt）
 *   2. 统一超时 + 取消（AbortSignal）
 *   3. 只读请求的 in-flight 去重（同一方法与参数同时只发一次）
 *   4. 错误归一化：{ code, message, retriable, method, requestId }
 *   5. 统计：次数 / 失败 / 重试 / 超时（性能与可用性验收用）
 *
 * 客户端只认「方法名 + payload」；具体怎么发由组合根注入的 invoke 决定，
 * 这样测试里可以换成假网关（不联网、不花钱）。
 */

import { perf } from "./perf.js";

/** 方法类别。 */
export type MethodKind = "read" | "write" | "paid";

/** 方法元数据。 */
export interface MethodSpec {
  kind?: MethodKind;
  /** 单次超时（毫秒），默认取客户端默认值 */
  timeoutMs?: number;
  /** 只读方法的重试次数（不含首次），默认 1 */
  retries?: number;
}

/** 归一化后的错误。 */
export interface ApiFailure extends Error {
  code: string;
  retriable: boolean;
  method: string;
  requestId?: string;
}

/** 调用选项。 */
export interface CallOptions {
  /** 覆盖方法类别（默认读元数据） */
  kind?: MethodKind;
  /** 超时（毫秒） */
  timeoutMs?: number;
  /** 取消信号 */
  signal?: AbortSignal;
  /** 幂等键：付费/写操作必须带，宿主据此去重 */
  requestId?: string;
  /** 付费方法必须显式确认（防止误触发真实计费） */
  confirm?: boolean;
}

/** 客户端统计。 */
export interface ApiStats {
  calls: number;
  failures: number;
  retries: number;
  timeouts: number;
  deduped: number;
}

/** 客户端配置。 */
export interface ApiClientOptions {
  /** 真正发请求的实现（组合根接宿主 remote） */
  invoke: (method: string, payload: unknown, options: { requestId?: string; signal?: AbortSignal }) => Promise<unknown>;
  /** 方法元数据表 */
  methods?: Record<string, MethodSpec>;
  /** 默认超时，默认 60000ms */
  defaultTimeoutMs?: number;
  /** 只读方法默认重试次数 */
  readRetries?: number;
  now?: () => number;
}

/**
 * 创建 ApiClient。
 * @param options - 配置
 * @returns 客户端
 */
export function createApiClient(options: ApiClientOptions) {
  const methods = options.methods ?? {};
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000;
  const readRetries = options.readRetries ?? 1;
  const inflight: Map<string, Promise<unknown>> = new Map();
  const stats: ApiStats = { calls: 0, failures: 0, retries: 0, timeouts: 0, deduped: 0 };

  const kindOf = (method: string, explicit?: MethodKind): MethodKind => {
    return explicit ?? methods[method]?.kind ?? "write";
  };

  const fail = (method: string, error: unknown, requestId?: string): ApiFailure => {
    const raw = error as any;
    const message = raw instanceof Error ? raw.message : String(raw);
    const failure = new Error(message) as ApiFailure;
    failure.name = "ApiFailure";
    failure.method = method;
    failure.code = typeof raw?.code === "string" ? raw.code : "unknown-error";
    failure.retriable = raw?.retriable === true;
    if (requestId !== undefined) failure.requestId = requestId;
    return failure;
  };

  const withTimeout = async <T>(run: Promise<T>, timeoutMs: number, method: string): Promise<T> => {
    if (timeoutMs <= 0) return run;
    let handle: any = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      handle = setTimeout(() => {
        stats.timeouts++;
        const failure = fail(method, new Error("请求超时（" + String(timeoutMs) + "ms）"));
        failure.code = "timeout";
        failure.retriable = true;
        reject(failure);
      }, timeoutMs);
    });
    try {
      return await Promise.race([run, timeout]);
    } finally {
      if (handle !== null) clearTimeout(handle);
    }
  };

  const once = async (method: string, payload: unknown, call: CallOptions, kind: MethodKind): Promise<unknown> => {
    const timeoutMs = call.timeoutMs ?? methods[method]?.timeoutMs ?? defaultTimeoutMs;
    stats.calls++;
    const started = options.now?.() ?? Date.now();
    try {
      const value = await withTimeout(
        options.invoke(method, payload, { requestId: call.requestId, signal: call.signal }),
        timeoutMs,
        method
      );
      perf?.recordCall?.(method, (options.now?.() ?? Date.now()) - started, true);
      return value;
    } catch (error) {
      stats.failures++;
      perf?.recordCall?.(method, (options.now?.() ?? Date.now()) - started, false);
      throw fail(method, error, call.requestId);
    }
  };

  return {
    /**
     * 调一个远程方法。
     * @param method - 方法名（对应 wire.ts）
     * @param payload - 入参
     * @param call - 调用选项
     * @returns 方法返回值
     */
    async call<T = unknown>(method: string, payload: unknown = undefined, call: CallOptions = {}): Promise<T> {
      const kind = kindOf(method, call.kind);
      if (kind === "paid" && call.confirm !== true) {
        throw fail(method, Object.assign(new Error("付费操作需要显式确认（confirm:true）"), { code: "confirm-required" }), call.requestId);
      }
      const retries = kind === "read" ? (methods[method]?.retries ?? readRetries) : 0;
      const dedupeKey = kind === "read" && call.signal === undefined
        ? method + ":" + stableStringify(payload)
        : undefined;
      if (dedupeKey !== undefined) {
        const running = inflight.get(dedupeKey);
        if (running !== undefined) {
          stats.deduped++;
          return running as Promise<T>;
        }
      }
      const run = (async (): Promise<unknown> => {
        let attempt = 0;
        while (true) {
          try {
            return await once(method, payload, call, kind);
          } catch (error) {
            const failure = error as ApiFailure;
            const canRetry = kind === "read" && attempt < retries && (failure.retriable !== false);
            if (!canRetry) throw failure;
            attempt++;
            stats.retries++;
            await delay(300 * Math.pow(2, attempt - 1));
          }
        }
      })();
      if (dedupeKey !== undefined) {
        inflight.set(dedupeKey, run);
        try {
          return await run as T;
        } finally {
          inflight.delete(dedupeKey);
        }
      }
      return run as Promise<T>;
    },
    /** 统计快照。 */
    stats(): ApiStats {
      return { ...stats };
    },
    /** 已注册的方法元数据（自检用）。 */
    methodSpec(method: string): MethodSpec | undefined {
      return methods[method];
    }
  };
}

/** ApiClient 类型。 */
export type ApiClient = ReturnType<typeof createApiClient>;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 参数序列化：键排序，保证同一 payload 得到同一 key（只读去重用）。 */
function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value, (_key, item) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(item).sort()) sorted[key] = item[key];
      return sorted;
    }) ?? "null";
  } catch {
    return "unserializable";
  }
}
