/**
 * 宿主半区的统一后台任务表 + 全局并发池（宿主加固 · P8）。
 *
 * 此前 `pipeline` / `seqgen` / `riggen` / `musicgen` / `sfxgen` 各管一张表：
 * 五套 Map、五种取消方式、五个「重载后要复位」的坑。这个模块把「登记 / 查重 /
 * 取消 / 复位」收成一处，模块只保留自己的业务实现：
 *
 *   const started = jobs.startJob({ module: "music", scope: id, taskKey: "generate", label: "生成" });
 *   if (!started.started) return false;          // 同键已在跑 → 与旧行为一致
 *   void (async () => { try { await run(started.signal); } finally { jobs.finishJob(started.id); } })();
 *
 * 并发池分两条通道：
 *   · `paid`（付费生成：生图 / 视频 / 音乐 / 音效）—— 网络与账号配额才是瓶颈；
 *   · `local`（本机 ffmpeg）—— 吃 CPU / 磁盘，太多并行反而更慢。
 * **超限排队，不拒绝**：排队期间通过 `onQueued` 回「第 N 位 · 预计 X 秒」，
 * 用户知道自己在等什么，而不是以为按钮坏了又点一次（那一次可能真的花钱）。
 *
 * 时长估计是 EMA（默认 paid 20s / local 3s，随实测收敛），只用于给排队位次
 * 配一句「预计等待」，不是精确值。
 */

import { messageOf } from "./jsonio.js";

/** 后台任务属于哪个模块。 */
export type JobModule = "pipeline" | "sequence" | "rig" | "music" | "sfx";

/** 任务状态（运行中的记录才会留在表里）。 */
export type JobState = "running" | "succeeded" | "failed" | "cancelled";

/** 并发通道。 */
export type JobLane = "paid" | "local";

/** 一条后台任务。 */
export interface JobRecord {
  /** `module:scope:taskKey`，全局唯一。 */
  id: string;
  module: JobModule;
  /** 模块内部的归属：pipeline 是 projectId，其余是 jobId。 */
  scope: string;
  taskKey: string;
  label: string;
  lane: JobLane;
  state: JobState;
  startedAt: number;
  finishedAt?: number;
  /** 八方向图那套「还没轮到哪些方向」的遮罩清单。 */
  targets?: string[];
  /** 最近一次说明（失败原因 / 排队位次）。 */
  detail?: string;
}

export interface StartJobInput {
  module: JobModule;
  scope: string;
  taskKey: string;
  label: string;
  lane?: JobLane;
  targets?: string[];
}

export interface StartedJob {
  /** false = 同 `module:scope:taskKey` 已在跑（与旧 kick 的语义一致）。 */
  started: boolean;
  id: string;
  signal: AbortSignal;
}

export interface JobFilter {
  module?: JobModule;
  scope?: string;
}

/** 运行表（只放还在跑的任务）。 */
const records = new Map<string, JobRecord>();
/** 每个任务的取消句柄；由注册表持有，取消与复位都从这里走。 */
const controllers = new Map<string, AbortController>();
/** 最近结束的任务（排障用，最多 50 条；不影响「在跑」判断）。 */
const finished: JobRecord[] = [];
const FINISHED_LIMIT = 50;
let disposed = false;

/** 任务 id。 */
export function jobIdOf(module: JobModule, scope: string, taskKey: string): string {
  return `${module}:${scope}:${taskKey}`;
}

/** 重载 / apply 时复位：把残留任务全部按取消处理（旧任务不应再写盘）。 */
export function activateJobs(): void {
  abortAll("插件已重载，旧任务作废");
  disposed = false;
  records.clear();
  controllers.clear();
  finished.length = 0;
  resetPools();
}

/** 插件卸载：取消全部在跑任务。 */
export function disposeJobs(): void {
  disposed = true;
  abortAll("插件已卸载");
  records.clear();
  controllers.clear();
}

/** 插件实例是否已卸载（模块的 kick 用它区分「真在跑」与「实例已废」）。 */
export function jobsDisposed(): boolean {
  return disposed;
}

function abortAll(reason: string): void {
  for (const controller of controllers.values()) {
    try {
      controller.abort(new Error(reason));
    } catch {
      // abort 本身不会抛；这里只是防御
    }
  }
}

/**
 * 登记一个后台任务并立刻返回；重复的 `module:scope:taskKey` 被拒绝。
 *
 * 调用方拿到 `signal` 后应把它透传给可以中断的远程调用；
 * 任务结束（成功 / 失败 / 取消）都必须调一次 `finishJob`，否则记录会一直挂着。
 */
export function startJob(input: StartJobInput): StartedJob {
  const id = jobIdOf(input.module, input.scope, input.taskKey);
  const controller = new AbortController();
  if (disposed || records.has(id)) return { started: false, id, signal: controller.signal };
  records.set(id, {
    id,
    module: input.module,
    scope: input.scope,
    taskKey: input.taskKey,
    label: input.label,
    lane: input.lane ?? "paid",
    state: "running",
    startedAt: Date.now(),
    ...(input.targets === undefined ? {} : { targets: [...input.targets] })
  });
  controllers.set(id, controller);
  return { started: true, id, signal: controller.signal };
}

/** 收尾：从运行表移除并记进最近结束列表。 */
export function finishJob(id: string, state: Exclude<JobState, "running"> = "succeeded", detail?: string): void {
  const record = records.get(id);
  if (record === undefined) return;
  records.delete(id);
  controllers.delete(id);
  const done: JobRecord = { ...record, state, finishedAt: Date.now(), ...(detail === undefined ? {} : { detail }) };
  finished.unshift(done);
  if (finished.length > FINISHED_LIMIT) finished.length = FINISHED_LIMIT;
}

/** 更新运行中任务的说明 / 遮罩清单（例如方向做完后从 targets 里摘掉）。 */
export function updateJob(id: string, patch: Partial<Pick<JobRecord, "detail" | "targets" | "label" | "lane">>): void {
  const record = records.get(id);
  if (record === undefined) return;
  if (patch.detail !== undefined) record.detail = patch.detail;
  if (patch.targets !== undefined) record.targets = [...patch.targets];
  if (patch.label !== undefined) record.label = patch.label;
  if (patch.lane !== undefined) record.lane = patch.lane;
}

/** 取一条运行中的任务。 */
export function getJob(id: string): JobRecord | undefined {
  return records.get(id);
}

/** 列出运行中的任务（不带过滤时返回全部）。 */
export function listJobs(filter: JobFilter = {}): JobRecord[] {
  const rows: JobRecord[] = [];
  for (const record of records.values()) {
    if (filter.module !== undefined && record.module !== filter.module) continue;
    if (filter.scope !== undefined && record.scope !== filter.scope) continue;
    rows.push({ ...record, ...(record.targets === undefined ? {} : { targets: [...record.targets] }) });
  }
  return rows;
}

/** 某个归属下正在跑的任务键（seqgen / riggen / musagen / sfxgen 的旧 listXxxTasks 用它）。 */
export function tasksOf(module: JobModule, scope: string): string[] {
  return listJobs({ module, scope }).map((record) => record.taskKey);
}

/** 取某个任务的取消信号（模块把它透传给可中断的远程调用 / sleep）。 */
export function signalOf(module: JobModule, scope: string, taskKey: string): AbortSignal | undefined {
  return controllers.get(jobIdOf(module, scope, taskKey))?.signal;
}

/** 某个具体的 `module:scope:taskKey` 是否在跑（模块里的「已在生成中」判断用它）。 */
export function isJobRunning(module: JobModule, scope: string, taskKey: string): boolean {
  return records.has(jobIdOf(module, scope, taskKey));
}

/** 该归属下有没有任务在跑。 */
export function busyOf(module: JobModule, scope: string): boolean {
  for (const record of records.values()) {
    if (record.module === module && record.scope === scope) return true;
  }
  return false;
}

/** 取消一条任务（abort 信号 + 状态标 cancelled）。不存在返回 false。 */
export function cancelJob(id: string, reason = "已取消"): boolean {
  const record = records.get(id);
  if (record === undefined) return false;
  const controller = controllers.get(id);
  try {
    controller?.abort(new Error(reason));
  } catch {
    // 防御
  }
  finishJob(id, "cancelled", reason);
  return true;
}

/**
 * 取消某个归属下（可再按 taskKey 过滤）的全部任务。
 *
 * 旧的 `cancelMusicGeneration` / `cancelSfxGeneration` / 删除任务时的清理都走它。
 */
export function cancelScope(module: JobModule, scope: string, options: { taskKey?: string; reason?: string } = {}): number {
  let count = 0;
  for (const record of [...records.values()]) {
    if (record.module !== module || record.scope !== scope) continue;
    if (options.taskKey !== undefined && record.taskKey !== options.taskKey) continue;
    if (cancelJob(record.id, options.reason ?? "已取消")) count++;
  }
  return count;
}

/** 复位某个模块的表（每个 `activate*` / `dispose*` 调它，保持旧的「重载即清空」约定）。 */
export function resetModule(module: JobModule, reason = "模块已复位"): void {
  for (const record of [...records.values()]) {
    if (record.module === module) cancelJob(record.id, reason);
  }
}

/** 排障快照：在跑 + 最近结束。 */
export function jobsSnapshot(): { running: JobRecord[]; recent: JobRecord[] } {
  return { running: listJobs(), recent: finished.slice() };
}

/** 最近结束的任务。 */
export function recentJobs(): JobRecord[] {
  return finished.slice();
}

/**
 * 包住一次「任务体的收尾」：成功标 succeeded，抛出标 failed 并把原因记进 detail。
 *
 * 各模块仍然自己决定「失败时往哪写日志」（项目日志 / job.log），这里只负责表。
 */
export async function runJobBody(id: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    finishJob(id, "succeeded");
  } catch (error) {
    finishJob(id, "failed", messageOf(error));
    throw error;
  }
}

// ── 全局并发池 ──────────────────────────────────────────────────────────

interface LaneWaiter {
  id: string;
  label: string;
  /** 只用于排障（付费调用可能来自 sprite / image / sequence / rig 任意模块）。 */
  module?: string;
  enqueuedAt: number;
  ahead: number;
  resolve: (ticket: SlotTicket) => void;
}

interface LaneState {
  limit: number;
  running: number;
  queue: LaneWaiter[];
  /** 最近几次实际耗时的 EMA（毫秒），只用于估等待。 */
  averageMs: number;
}

const lanes: Record<JobLane, LaneState> = {
  paid: { limit: 3, running: 0, queue: [], averageMs: 20_000 },
  local: { limit: 2, running: 0, queue: [], averageMs: 3_000 }
};

/** 通道快照（界面 / 自检 / 日志用）。 */
export interface LaneSnapshot {
  lane: JobLane;
  limit: number;
  running: number;
  queued: number;
  /** 队列末尾那一笔的预计等待（毫秒）。 */
  etaMs: number;
  averageMs: number;
}

export interface QueueInfo {
  lane: JobLane;
  /** 自己在队列里的位次（1 = 下一个）。 */
  position: number;
  ahead: number;
  limit: number;
  etaMs: number;
}

export interface SlotMeta {
  id?: string;
  label?: string;
  /** 只用于排障（付费调用可能来自任意模块）。 */
  module?: string;
  /** 进入排队时回调一次（模块据此往任务说明 / 日志里写「第 N 位 · 预计 X 秒」）。 */
  onQueued?: (info: QueueInfo) => void;
}

export interface SlotTicket {
  lane: JobLane;
  waitedMs: number;
  queuedAhead: number;
  /** 必须且只能释放一次（重复释放是安全的空操作）。 */
  release: () => void;
}

/** 配置通道上限（apply 时按 config.concurrency 算；saveConfig 后要重配）。 */
export function configurePools(input: { paid?: number; local?: number }): void {
  if (input.paid !== undefined) lanes.paid.limit = clampLimit(input.paid, 1, 8);
  if (input.local !== undefined) lanes.local.limit = clampLimit(input.local, 1, 8);
  pump("paid");
  pump("local");
}

function clampLimit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 复位池（重载时调用：清排队、计数归零）。 */
export function resetPools(): void {
  for (const lane of ["paid", "local"] as JobLane[]) {
    lanes[lane].running = 0;
    lanes[lane].queue.length = 0;
  }
}

/** 通道快照。 */
export function poolSnapshot(lane?: JobLane): LaneSnapshot[] {
  const keys: JobLane[] = lane === undefined ? ["paid", "local"] : [lane];
  return keys.map((key) => {
    const state = lanes[key];
    const etaMs = estimateWait(key, state.queue.length);
    return { lane: key, limit: state.limit, running: state.running, queued: state.queue.length, etaMs, averageMs: state.averageMs };
  });
}

function estimateWait(lane: JobLane, position: number): number {
  if (position <= 0) return 0;
  const state = lanes[lane];
  // 粗估：排在前面的人 + 正在跑的人，按通道并行度折算。
  return Math.max(0, Math.round(((state.running + position) * state.averageMs) / Math.max(1, state.limit)));
}

function pump(lane: JobLane): void {
  const state = lanes[lane];
  while (state.running < state.limit && state.queue.length > 0) {
    const waiter = state.queue.shift();
    if (waiter === undefined) break;
    state.running++;
    const startedAt = Date.now();
    let released = false;
    const ticket: SlotTicket = {
      lane,
      waitedMs: startedAt - waiter.enqueuedAt,
      queuedAhead: waiter.ahead,
      release: () => {
        if (released) return;
        released = true;
        const spent = Date.now() - startedAt;
        // EMA：新样本权重 0.3，跑几次之后就收敛到这台机器 / 这个账号的真实耗时。
        state.averageMs = Math.round(state.averageMs * 0.7 + spent * 0.3);
        state.running = Math.max(0, state.running - 1);
        pump(lane);
      }
    };
    waiter.resolve(ticket);
  }
}

/**
 * 申请一个通道名额：有空位立刻给，没有就排队。
 *
 * 排队不超时、不拒绝——付费调用已经在 receipt 层挡过重复了，这里只是限速。
 * 调用方**必须**在 finally 里 `release()`，否则通道会永远少一个名额。
 */
export async function acquireSlot(lane: JobLane, meta: SlotMeta = {}): Promise<SlotTicket> {
  const state = lanes[lane];
  if (state.running < state.limit && state.queue.length === 0) {
    state.running++;
    const startedAt = Date.now();
    let released = false;
    return {
      lane,
      waitedMs: 0,
      queuedAhead: 0,
      release: () => {
        if (released) return;
        released = true;
        const spent = Date.now() - startedAt;
        state.averageMs = Math.round(state.averageMs * 0.7 + spent * 0.3);
        state.running = Math.max(0, state.running - 1);
        pump(lane);
      }
    };
  }
  const ahead = state.queue.length;
  const position = ahead + 1;
  const info: QueueInfo = { lane, position, ahead, limit: state.limit, etaMs: estimateWait(lane, position) };
  meta.onQueued?.(info);
  return new Promise<SlotTicket>((resolve) => {
    state.queue.push({
      id: meta.id ?? `${lane}-${Date.now()}`,
      label: meta.label ?? "",
      module: meta.module,
      enqueuedAt: Date.now(),
      ahead,
      resolve
    });
  });
}

/** 拿名额跑一次就释放（最常见的用法）。 */
export async function withSlot<T>(lane: JobLane, meta: SlotMeta, run: () => Promise<T>): Promise<T> {
  const ticket = await acquireSlot(lane, meta);
  try {
    return await run();
  } finally {
    ticket.release();
  }
}

/**
 * 把「排队中」写进这个归属下正在跑的任务说明里。
 *
 * 付费通道被打满时，用户看到的是「点了但没动静」——和「按钮坏了」长得一模一样，
 * 很容易再点一次（那一次真的会花钱）。所以排队时把位次与预计等待写进任务记录的
 * `detail`，界面 / 日志都能读出来。
 */
export function noteQueued(jobId: string | undefined, info: QueueInfo): void {
  if (jobId === undefined) return;
  const detail = queueMessage(info);
  for (const record of records.values()) {
    if (record.scope === jobId) record.detail = detail;
  }
}

/** 一句话的排队说明（写进任务说明 / 日志用）。 */
export function queueMessage(info: QueueInfo): string {
  return `${info.lane === "paid" ? "付费生成" : "本地转码"}排队中（第 ${info.position} 位，通道上限 ${info.limit}，预计约 ${Math.max(1, Math.round(info.etaMs / 1000))} 秒）`;
}
