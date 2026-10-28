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

/**
 * 付费方法清单（宿主加固 · P8）。
 *
 * 三处必须一致：这里、宿主 `src/index.ts` 的 `PAID_METHODS`、`src/wire.ts` 里
 * 用 `withPaidFields()` 挂着 confirm / requestId 的那些方法。`verify-jobs.mjs`
 * 会逐条比对——漏一处就是某个付费入口既没有确认也没有幂等键，不报错，只重复计费。
 */
export const PAID_METHODS: readonly string[] = [
  "testArk",
  "testSfx",
  "runImage",
  "runImages",
  "runTurnVideo",
  "runVideos",
  "runImageJob",
  "runSequenceVideo",
  "runRigRedraw",
  "runRigSheet",
  "runMusicGeneration",
  "runMusicTool",
  "submitMusicScoreToSuno",
  "runSfxGeneration"
];

/** 是否付费方法。 */
export function isPaidMethod(method: string): boolean {
  return PAID_METHODS.includes(method);
}

/**
 * 只读方法清单（允许自动重试与并发去重）。
 *
 * 只收纯查询：`get*` 与 `list*`。三个名字像读、实际有副作用的方法刻意排除——
 * `getMusicWav` / `getMusicLrc` 会立刻本地化音频并生成歌词文件，
 * `pollVideos` / `pollSequenceVideo` 在轮询的同时会写盘。
 *
 * 清单之外的方法一律按 write 处理：不自动重试、不做并发去重。
 */
export const READ_METHODS: readonly string[] = [
  "getConfig",
  "getProject",
  "getImageJob",
  "getSequenceJob",
  "getRigJob",
  "getRigAnimation",
  "getIsoProject",
  "getMapProject",
  "getMusicJob",
  "getMusicGuide",
  "getMusicScoreGuide",
  "getSfxJob",
  "listProjects",
  "listImageJobs",
  "listSequenceJobs",
  "listRigJobs",
  "listIsoProjects",
  "listMapProjects",
  "listMusicJobs",
  "listMusicHistory",
  "listMusicStemInstruments",
  "listSfxJobs",
  // 本地 ComfyUI 工作流库：目录 / 正文 / 分栏视图都是纯读。
  // saveWorkflow / removeWorkflow / testWorkflow 有副作用（落盘 / 真出图），按 write 处理。
  "listWorkflows",
  "getWorkflow",
  "getWorkflowCatalog"
];

/**
 * 生成一次幂等键。
 *
 * 浏览器优先用 `crypto.randomUUID()`（去掉连字符，字符集与宿主校验一致）；
 * 极老环境退化成「时间戳 + 随机串」——幂等键不要求密码学强度，
 * 只要求同一个 intent 重试时**不重新生成**，所以调用方必须复用它。
 */
export function newRequestId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoApi?.randomUUID === "function") return String(cryptoApi.randomUUID()).replace(/-/g, "");
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * 付费调用的统一处理：confirm 必须显式为 true，缺 requestId 自动补一个。
 *
 * 平台层先挡一道（不发请求、不入账），宿主侧还会再挡一次——两层都写，
 * 是因为任何一层失守都是真实计费。
 */
export function preparePaidPayload(method: string, payload: unknown): unknown {
  if (!isPaidMethod(method)) return payload;
  const input =
    payload !== null && typeof payload === "object" ? { ...(payload as Record<string, unknown>) } : ({} as Record<string, unknown>);
  if (input.confirm !== true) {
    const failure = new Error(`${method} 是付费操作：必须显式确认（confirm: true）后再提交`) as ApiFailure;
    failure.name = "ApiFailure";
    failure.method = method;
    failure.code = "confirm-required";
    failure.retriable = false;
    throw failure;
  }
  if (typeof input.requestId !== "string" || input.requestId === "") input.requestId = newRequestId();
  return input;
}

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
 * 合成方法元数据表：只读清单 → read，付费清单 → paid。
 *
 * 未列入两张清单的方法按 write 处理（`createApiClient` 的默认类别），因此这里
 * 不需要列出全部 188 个方法。付费写在只读之后，同一方法两处都出现时以付费为准。
 */
export function createMethodSpecs(): Record<string, MethodSpec> {
  const specs: Record<string, MethodSpec> = {};
  for (const method of READ_METHODS) specs[method] = { kind: "read" };
  for (const method of PAID_METHODS) specs[method] = { kind: "paid" };
  return specs;
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
