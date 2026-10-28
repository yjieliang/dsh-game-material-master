/**
 * 付费调用的 receipt（宿主半区 · P8 加固）。
 *
 * 背景：生图 / 生视频 / 音乐 / 音效 / 谱曲交 Suno 都是**真实计费**的远程提交。
 * 网络抖动、重复点击、宿主重载后重试，任何一次「其实已经提交了但本地不知道」的
 * 重发都会让用户再付一次钱。ToAPIs 那条链路此前有一套自己的 receipt，这个模块
 * 把它抽象成通用件，其余四个付费入口都接到这里。
 *
 * 三条硬规则：
 *   1. **提交前先建凭证**：`beginPaidCall` 用 `wx` 独占建文件，并发下同一个 key
 *      只有一个能赢；输了的那次不会发出任何远程请求。
 *   2. **同一 requestId 永不重复提交**：客户端带幂等键时，只要凭证存在就一律拒绝
 *      （终态也一样）——重试应当回已有任务，而不是再买一次。由于 requestId 每次点击
 *      都会重新生成，键必然不同，所以再加一道**按内容指纹**的兜底：同一指纹仍有
 *      未决记录（submitting / submitted / uncertain）时同样拒绝。
 *   3. **凭证只加不删**：取消本地等待、进程重载、任务失败都不删记录；只有下一次
 *      不同的提交才会覆盖同一个 key 的旧记录（无幂等键、且旧记录已到终态时）。
 *
 * requestId 从网关到提交层不靠层层传参：网关在付费方法入口用 `runPaidIntent`
 * 建一个 AsyncLocalStorage 上下文，后台任务（kick 出来的 async 链）自然继承。
 * 批量方向各自带不同的 `slot`，所以一次 requestId 下的 8 个方向不会互相顶掉。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { mkdir, open, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "./config.js";
import { readJson, writeJsonAtomic } from "./jsonio.js";

/** 付费调用属于哪个模块（只用于归档与排障）。 */
export type PaidModule = "sprite" | "image" | "sequence" | "rig" | "music" | "sfx" | "score";

/** 凭证状态。 */
export type ReceiptState = "submitting" | "submitted" | "resolved" | "failed" | "uncertain";

/** 一条凭证。 */
export interface ReceiptRecord {
  version: 1;
  /** 文件名（= sha256）。 */
  key: string;
  /** 客户端给的幂等键；工具面 / 老调用点没有。 */
  requestId?: string;
  /** 远程方法名（runImage / runSfxGeneration / …）或内部入口名。 */
  method: string;
  module: PaidModule;
  /** 实际出钱的后端：ark / toapis / minimax / suno / seed-audio / custom。 */
  provider: string;
  /** 同一次请求里的一次付费调用（批量方向的 key），避免互相顶掉。 */
  slot: string;
  /** 请求内容指纹（无 requestId 时兜底去重）。 */
  fingerprint: string;
  state: ReceiptState;
  createdAt: number;
  updatedAt: number;
  /** 远端任务 id（视频 / 音乐 / ToAPIs 异步任务）。 */
  taskId?: string;
  /** 宿主侧任务 / 项目 id，便于人和日志对上号。 */
  jobId?: string;
  /** 最后一次说明（失败原因 / 不确定态怎么对账）。 */
  detail?: string;
}

/** 付费方法入口注入的上下文（AsyncLocalStorage）。 */
export interface PaidIntent {
  requestId?: string;
  method: string;
  module: PaidModule;
  /** 宿主侧任务 / 项目 id（对账时能直接找到是哪个活）。 */
  jobId?: string;
}

const intentStore = new AsyncLocalStorage<PaidIntent>();

/** 在一段付费调用里执行：后台任务会继承这里的 requestId / method / module。 */
export function runPaidIntent<T>(intent: PaidIntent, run: () => T): T {
  return intentStore.run(intent, run);
}

/** 当前付费上下文（不在付费调用里返回 undefined）。 */
export function currentPaidIntent(): PaidIntent | undefined {
  return intentStore.getStore();
}

/** 凭证目录。 */
export function receiptsRoot(): string {
  return join(dataRoot(), "receipts");
}

function receiptFile(key: string): string {
  return join(receiptsRoot(), `${key}.json`);
}

/** 键排序后的稳定 JSON（指纹必须与键顺序无关）。 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

/** sha256 十六进制（字符串 / Buffer 直接喂，其它走稳定 JSON）。 */
export function digest(value: unknown): string {
  const hash = createHash("sha256");
  if (typeof value === "string") hash.update(value);
  else if (Buffer.isBuffer(value)) hash.update(value);
  else hash.update(stableStringify(value));
  return hash.digest("hex");
}

/** 请求内容指纹。 */
export function fingerprintOf(parts: unknown[]): string {
  return digest(parts);
}

/** requestId 只接受 URL 安全字符，长度 8–128（挡住空串 / 超长 / 带分隔符的脏值）。 */
export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

/** 校验 requestId；没给返回 undefined，给了但不合法直接抛。 */
export function assertRequestId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isRequestId(value)) {
    throw new Error("requestId 不合法：只允许 8–128 个字符，字符集 A-Z a-z 0-9 _ -（客户端应当自动生成，不要手写）");
  }
  return value;
}

/** 同一条远端提交已经存在，且不允许再发一次。 */
export class PaidDuplicateError extends Error {
  readonly code = "paid-duplicate";
  readonly receipt: ReceiptRecord;
  constructor(receipt: ReceiptRecord) {
    super(
      `同一笔付费提交已经存在（${receipt.method} · ${receipt.state}${receipt.taskId === undefined ? "" : ` · 远端任务 ${receipt.taskId}`}）：` +
        `不要重复提交，直接查已有任务；凭证在 receipts/${receipt.key}.json`
    );
    this.name = "PaidDuplicateError";
    this.receipt = receipt;
  }
}

/** `beginPaidCall` 的入参。 */
export interface BeginPaidCallInput {
  /** 实际出钱的后端。 */
  provider: string;
  /** 一次请求内的付费调用标识（批量方向传方向 key）。默认 "main"。 */
  slot?: string;
  /** 请求内容（会影响指纹，但不会逐字节落盘）。 */
  identity: unknown;
  /** 宿主侧任务 / 项目 id，便于对账。 */
  jobId?: string;
  /** 覆盖上下文（自检用；正常不传，走 AsyncLocalStorage）。 */
  intent?: PaidIntent;
  method?: string;
  module?: PaidModule;
}

/** `beginPaidCall` 的成功回执。 */
export interface PaidTicket {
  key: string;
  method: string;
  module: PaidModule;
  provider: string;
  requestId?: string;
}

async function readReceiptFile(key: string): Promise<ReceiptRecord | undefined> {
  return readJson<ReceiptRecord>(receiptFile(key));
}

/** 「还没有定论」的状态：这几态下重发都可能二次计费。 */
const PENDING_STATES: ReadonlySet<ReceiptState> = new Set(["submitting", "submitted", "uncertain"]);

/** 按指纹找未决凭证时只回看这么久的记录（更早的不会再触发同一次提交）。 */
const PENDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 按内容指纹找一笔「还没有定论」的凭证。
 *
 * 键里含 requestId，所以同一次用户意图重试时键会变，只能靠指纹找回上一次。
 * 只扫最近 {@link PENDING_WINDOW_MS} 内改过的文件：未决记录必然很新，
 * 避免票据积累之后每次付费提交都全量读一遍目录。
 * @param fingerprint - 请求内容指纹（与建账时同一个）
 * @returns 命中的凭证；没有则 undefined
 */
async function findPendingByFingerprint(fingerprint: string): Promise<ReceiptRecord | undefined> {
  const dir = receiptsRoot();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    // 目录还不存在 = 从来没有付费提交过。
    return undefined;
  }
  const since = Date.now() - PENDING_WINDOW_MS;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = join(dir, name);
    try {
      const info = await stat(file);
      if (info.mtimeMs < since) continue;
      const record = await readJson<ReceiptRecord>(file);
      if (record === undefined || record.fingerprint !== fingerprint) continue;
      if (!PENDING_STATES.has(record.state)) continue;
      return record;
    } catch {
      // 单条读不出来不影响判定，继续看下一条。
      continue;
    }
  }
  return undefined;
}

/** 读一条凭证。 */
export async function readReceipt(key: string): Promise<ReceiptRecord | undefined> {
  return readReceiptFile(key);
}

/**
 * 独占建盘。
 *
 * 用 `wx`（不存在才创建）而不是「先读再写」：两个并发的付费调用必须在文件系统
 * 这一层分胜负，先读后写的话两边都会看到「不存在」，然后都会去花钱。
 */
async function createReceiptExclusive(key: string, record: ReceiptRecord): Promise<boolean> {
  const file = receiptFile(key);
  await mkdir(dirname(file), { recursive: true });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(file, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  return true;
}

/**
 * 开始一次付费提交：先查重 / 建凭证，**然后**才允许调用远端。
 *
 * 返回的回执里带着 `key`，提交成功 / 失败都要回来打标（`markPaidSubmitted` /
 * `markPaidUncertain`）；不打标的话这条记录会一直停在 `submitting`，重启后
 * 看起来像「有一笔不知道结果的付费调用」——这正是要避免的状态，所以调用方必须打标。
 */
export async function beginPaidCall(input: BeginPaidCallInput): Promise<PaidTicket> {
  const intent = input.intent ?? currentPaidIntent();
  const module = input.module ?? intent?.module ?? "sprite";
  const method = input.method ?? intent?.method ?? "unknown";
  const requestId = intent?.requestId;
  const slot = input.slot ?? "main";
  const fingerprint = fingerprintOf([input.provider, module, method, slot, input.identity]);
  const key = digest(`${method}|${requestId ?? "-"}|${slot}|${fingerprint}`);
  const now = Date.now();
  const record: ReceiptRecord = {
    version: 1,
    key,
    requestId,
    method,
    module,
    provider: input.provider,
    slot,
    fingerprint,
    state: "submitting",
    createdAt: now,
    updatedAt: now,
    ...((input.jobId ?? intent?.jobId) === undefined ? {} : { jobId: input.jobId ?? intent?.jobId })
  };

  const existing = await readReceiptFile(key);
  if (existing !== undefined) {
    // 幂等键一旦用过就永不重复提交（终态也一样）：重试应当回已有任务。
    if (requestId !== undefined) throw new PaidDuplicateError(existing);
    // 没有幂等键：只在「上一次还没有确定结果」时阻止。
    if (existing.state === "submitting" || existing.state === "submitted" || existing.state === "uncertain") {
      throw new PaidDuplicateError(existing);
    }
    // 终态（resolved / failed）：用户显式重新生成是合法的，覆盖旧记录。
    await writeJsonAtomic(receiptFile(key), record);
    return { key, method, module, provider: input.provider, requestId };
  }
  // 键里含 requestId，而 requestId 每次点击都会重新生成，所以同一次意图的重试
  // 拿到的是**另一个键**、查不到上面那条 existing。这里按内容指纹再兜一次：
  // 上一笔还没定论（可能已被远端受理）时拒绝，避免「失败重试 = 二次扣费」。
  const pending = await findPendingByFingerprint(fingerprint);
  if (pending !== undefined) throw new PaidDuplicateError(pending);
  const created = await createReceiptExclusive(key, record);
  if (!created) {
    // 并发下被另一笔抢先创建：直接认对方的记录，绝不重发。
    const winner = (await readReceiptFile(key)) ?? record;
    throw new PaidDuplicateError(winner);
  }
  return { key, method, module, provider: input.provider, requestId };
}

async function patchReceipt(key: string, patch: Partial<ReceiptRecord>): Promise<ReceiptRecord | undefined> {
  const current = await readReceiptFile(key);
  if (current === undefined) return undefined;
  const next: ReceiptRecord = { ...current, ...patch, key, version: 1, updatedAt: Date.now() };
  await writeJsonAtomic(receiptFile(key), next);
  return next;
}

/** 标记「已经交给远端」并记下远端任务 id。 */
export async function markPaidSubmitted(
  key: string,
  patch: { taskId?: string; jobId?: string; detail?: string } = {}
): Promise<ReceiptRecord | undefined> {
  return patchReceipt(key, { state: "submitted", ...patch });
}

/** 标记「结果已经拿到」（同步接口 / 异步任务完成）。 */
export async function markPaidResolved(
  key: string,
  patch: { taskId?: string; detail?: string } = {}
): Promise<ReceiptRecord | undefined> {
  return patchReceipt(key, { state: "resolved", ...patch });
}

/**
 * 标记「提交过程出错，但不确定远端是否已经收下」。
 *
 * ⚠️ 这是最重要的一态：网络超时 / 连接被切断时远端可能已经扣费。
 * 用户看到「失败」会重试，所以这里必须留下记录，让下一次 `beginPaidCall`
 * 按指纹 / requestId 挡住重发，并把「去核对哪一条」写进 detail。
 */
export async function markPaidUncertain(key: string, patch: { detail: string; taskId?: string }): Promise<ReceiptRecord | undefined> {
  return patchReceipt(key, { state: "uncertain", ...patch });
}

/** 标记「确定失败（远端明确拒绝 / 4xx / 未发出请求）」。 */
export async function markPaidFailed(key: string, patch: { detail: string; taskId?: string } = { detail: "" }): Promise<ReceiptRecord | undefined> {
  return patchReceipt(key, { state: "failed", ...patch });
}

/** 列出凭证（新→旧）。 */
export async function listReceipts(
  filter: { module?: PaidModule; states?: ReceiptState[]; limit?: number } = {}
): Promise<ReceiptRecord[]> {
  let names: string[];
  try {
    names = await readdir(receiptsRoot());
  } catch {
    return [];
  }
  const records: ReceiptRecord[] = [];
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const record = await readJson<ReceiptRecord>(join(receiptsRoot(), name));
    if (record === undefined) continue;
    if (filter.module !== undefined && record.module !== filter.module) continue;
    if (filter.states !== undefined && !filter.states.includes(record.state)) continue;
    records.push(record);
  }
  records.sort((a, b) => b.updatedAt - a.updatedAt);
  return filter.limit === undefined ? records : records.slice(0, filter.limit);
}

/**
 * 「结果不明」的凭证：重启后必须先核对、**不许重发**的那些。
 *
 * 只看 `submitting` / `uncertain` —— 这两态说明连远端 taskId 都没拿到，
 * 远端可能已经收下并计费。`submitted` 有 taskId，可以按 id 续查，不算风险。
 */
export async function pendingReceipts(): Promise<ReceiptRecord[]> {
  return listReceipts({ states: ["submitting", "uncertain"] });
}

/**
 * 按远端任务 id 收敛凭证（任务跑完 / 失败时调用）。
 *
 * 异步付费入口（视频 / 音乐 / 谱曲交 Suno）提交时只有 taskId，结果要等轮询；
 * 轮询到终态时把对应凭证标成 `resolved` / `failed`，目录里就不会一直挂着
 * 「已提交但没人知道结局」的记录。
 */
export async function settleReceiptByTaskId(
  taskId: string,
  state: Extract<ReceiptState, "resolved" | "failed">,
  patch: { detail?: string } = {}
): Promise<number> {
  if (typeof taskId !== "string" || taskId.trim() === "") return 0;
  let names: string[];
  try {
    names = await readdir(receiptsRoot());
  } catch {
    return 0;
  }
  let settled = 0;
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const record = await readJson<ReceiptRecord>(join(receiptsRoot(), name));
    if (record === undefined || record.taskId !== taskId) continue;
    if (record.state !== "submitted" && record.state !== "uncertain") continue;
    await patchReceipt(record.key, { state, ...patch });
    settled++;
  }
  return settled;
}

/** 从错误对象里掏 HTTP 状态码（各家的 Error 形状不一，这里只认最常见的几种）。 */
export function statusOfError(error: unknown): number | undefined {
  const raw = error as { status?: unknown; statusCode?: unknown; code?: unknown } | undefined;
  for (const value of [raw?.status, raw?.statusCode]) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = /\bHTTP\s+(\d{3})\b/.exec(message) ?? /\b(\d{3})\b.*(?:status|状态码)/i.exec(message);
  if (match !== null) {
    const status = Number(match[1]);
    if (status >= 100 && status <= 599) return status;
  }
  return undefined;
}

/**
 * 失败归类：`failed` = 远端明确没接单（不会计费），`uncertain` = 可能已经收下并计费。
 *
 * 判错的代价不对称：把「其实已经计费」记成 failed，用户重试就会再付一次钱；
 * 把「根本没发出去」记成 uncertain，用户会被要求先对账——多一步，但不会多花一分钱。
 * 所以只有明确的 4xx（408 / 429 除外，那两个是限流 / 超时，请求可能已经被处理）
 * 才算 failed，其余一律 uncertain。
 */
export function assessPaidFailure(error: unknown): { state: "failed" | "uncertain"; detail: string; status?: number } {
  const detail = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const haystack = `${detail} ${cause}`;
  const status = statusOfError(error);
  if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return { state: "failed", detail: `HTTP ${status}：${detail}`, status };
  }
  // 请求根本没发出去（DNS 失败 / 连接被拒 / TLS 握手前就断开）：远端没可能计费。
  if (/\b(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ERR_INVALID_URL)\b/.test(haystack) || /握手失败|handshake/i.test(haystack)) {
    return { state: "failed", detail, status };
  }
  return { state: "uncertain", detail: status === undefined ? detail : `HTTP ${status}：${detail}`, status };
}

/** 给 apply() 用的一句话摘要（没结清的凭证要点名，别让用户重复付款）。 */
export function summarizePendingReceipts(records: ReceiptRecord[]): string | undefined {
  if (records.length === 0) return undefined;
  const uncertain = records.filter((record) => record.state === "uncertain" || record.state === "submitting").length;
  const head = records
    .slice(0, 3)
    .map((record) => `${record.method}(${record.provider})${record.taskId === undefined ? "" : ` → ${record.taskId}`}`)
    .join(" / ");
  return (
    `[inkbox] 有 ${records.length} 笔付费提交尚未结清（其中 ${uncertain} 笔结果不确定）：${head}` +
    `。请先核对远端账单 / 任务，不要直接重发；凭证在 ${receiptsRoot()}`
  );
}
