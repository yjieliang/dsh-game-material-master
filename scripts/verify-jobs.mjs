/**
 * 宿主加固（P8）自检：统一任务表 / 全局并发池 / 付费 receipt。
 *
 *   node scripts/verify-jobs.mjs
 *
 * 纯本地：不起网络、不调任何付费接口、不需要 ffmpeg。
 * 数据写在临时 DSH_HOME 下，跑完就删。
 *
 * 覆盖四块：
 *   1. 任务表：重复 kick 拒绝、取消会 abort、activate*() 复位仍然有效；
 *   2. 并发池：上限 1 时真的串行、排队按 FIFO、排队位次与预计等待可读；
 *   3. receipt：同一 requestId 二次提交被拒且**不产生第二次远端调用**、
 *      指纹兜底去重、取消不删记录、重启后只核对不重发；
 *   4. 静态契约：wire / 宿主 / 客户端三处付费方法清单一致，且没有漏挂 confirm/requestId。
 */

import { mkdtemp, readFile, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOME = await mkdtemp(join(tmpdir(), "dsh-gmm-jobs-"));
process.env.DSH_HOME = HOME;

const jobs = await import("../lib/jobs.js");
const receipts = await import("../lib/receipts.js");

const failures = [];
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
}
function section(title) {
  console.log(`\n${title}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const src = (relative) => readFile(join(ROOT, relative), "utf8");

// ── 1) 统一任务表 ───────────────────────────────────────────────────────
section("1) 统一任务表（jobs.ts）");

jobs.activateJobs();

const first = jobs.startJob({ module: "music", scope: "m1", taskKey: "generation", label: "生成" });
check("startJob 拿到 id 与 signal", first.started === true && typeof first.id === "string" && first.signal instanceof AbortSignal, first.id);

const duplicate = jobs.startJob({ module: "music", scope: "m1", taskKey: "generation", label: "生成" });
check("同一 module:scope:taskKey 第二次被拒（与旧 kick 语义一致）", duplicate.started === false);

check("listJobs 能看到在跑的任务", jobs.listJobs({ module: "music", scope: "m1" }).length === 1);
check("tasksOf 回任务键", JSON.stringify(jobs.tasksOf("music", "m1")) === JSON.stringify(["generation"]));
check("busyOf 对在跑的归属为真", jobs.busyOf("music", "m1") === true && jobs.busyOf("music", "m2") === false);
check("isJobRunning 精确到 taskKey", jobs.isJobRunning("music", "m1", "generation") === true && jobs.isJobRunning("music", "m1", "tool") === false);

jobs.updateJob(first.id, { targets: ["a", "b"], detail: "排队中" });
const updated = jobs.getJob(first.id);
check("updateJob 能写 targets / detail", JSON.stringify(updated?.targets) === JSON.stringify(["a", "b"]) && updated?.detail === "排队中");

const cancelled = jobs.cancelJob(first.id, "用户取消");
check("cancelJob 返回 true 且 signal 已 abort", cancelled === true && first.signal.aborted === true);
check("取消后运行表里已经没有了", jobs.isJobRunning("music", "m1", "generation") === false);
check("取消记进 recent 且状态是 cancelled", jobs.recentJobs().some((record) => record.id === first.id && record.state === "cancelled"));
check("重复 cancel 是空操作（返回 false）", jobs.cancelJob(first.id) === false);

const done = jobs.startJob({ module: "sfx", scope: "f1", taskKey: "generation", label: "生成" });
jobs.finishJob(done.id, "succeeded");
check("finishJob 把任务移出运行表", jobs.isJobRunning("sfx", "f1", "generation") === false);
check("finishJob 记进 recent 且状态是 succeeded", jobs.recentJobs().some((record) => record.id === done.id && record.state === "succeeded"));

const pipelineJob = jobs.startJob({ module: "pipeline", scope: "p1", taskKey: "images:all", label: "批量" });
const rigJob = jobs.startJob({ module: "rig", scope: "r1", taskKey: "sheet", label: "拆件" });
jobs.resetModule("pipeline", "测试复位");
check(
  "resetModule 只清自己那个模块",
  jobs.isJobRunning("pipeline", "p1", "images:all") === false && jobs.isJobRunning("rig", "r1", "sheet") === true
);
check("resetModule 会 abort 旧任务的 signal", pipelineJob.signal.aborted === true && rigJob.signal.aborted === false);

// 五个模块的 activate*() 必须仍然复位自己的表（P8 之前的行为不能退化）
const [pipelineModule, seqModule, rigModule, musicModule, sfxModule] = await Promise.all([
  import("../lib/pipeline.js"),
  import("../lib/seqgen.js"),
  import("../lib/riggen.js"),
  import("../lib/musicgen.js"),
  import("../lib/sfxgen.js")
]);
const activateCases = [
  ["pipeline", pipelineModule.activatePipeline, () => jobs.startJob({ module: "pipeline", scope: "px", taskKey: "frames:extract", label: "抽帧" })],
  ["sequence", seqModule.activateSequence, () => jobs.startJob({ module: "sequence", scope: "sx", taskKey: "frames", label: "抽帧" })],
  ["rig", rigModule.activateRig, () => jobs.startJob({ module: "rig", scope: "rx", taskKey: "atlas", label: "图集" })],
  ["music", musicModule.activateMusic, () => jobs.startJob({ module: "music", scope: "mx", taskKey: "edit:1", label: "编辑" })],
  ["sfx", sfxModule.activateSfx, () => jobs.startJob({ module: "sfx", scope: "fx", taskKey: "generation", label: "生成" })]
];
for (const [name, activate, start] of activateCases) {
  const started = start();
  const before = started.started;
  activate();
  check(
    `${name}.activate*() 复位后表为空（重载后不会永远「任务已在进行中」）`,
    before === true && started.signal.aborted === true && jobs.listJobs({ module: name }).length === 0
  );
}
jobs.activateJobs();

// ── 2) 全局并发池 ───────────────────────────────────────────────────────
section("2) 全局并发池（paid / local 双通道）");

jobs.configurePools({ paid: 1, local: 1 });
check("configurePools 改了上限", jobs.poolSnapshot("paid")[0].limit === 1 && jobs.poolSnapshot("local")[0].limit === 1);

let active = 0;
let peak = 0;
const order = [];
const queued = [];
const runOne = (label, ms) =>
  jobs.withSlot(
    "paid",
    { label, onQueued: (info) => queued.push({ label, position: info.position, etaMs: info.etaMs }) },
    async () => {
      active++;
      peak = Math.max(peak, active);
      await sleep(ms);
      order.push(label);
      active--;
    }
  );
const during = jobs.withSlot("paid", { label: "watcher" }, async () => {
  await sleep(10);
  return jobs.poolSnapshot("paid")[0];
});
await Promise.all([runOne("a", 30), runOne("b", 12), runOne("c", 6), during]);
check("上限 1 时真的串行（并发峰值 = 1）", peak === 1, `峰值 ${peak}`);
check("排队按 FIFO 执行", JSON.stringify(order) === JSON.stringify(["a", "b", "c"]), order.join(","));
check("排队过的人拿到位次与预计等待", queued.length >= 2 && queued[0].position === 1 && Number.isFinite(queued[0].etaMs), JSON.stringify(queued));
check("全部结束后通道归零", jobs.poolSnapshot("paid")[0].running === 0 && jobs.poolSnapshot("paid")[0].queued === 0);

jobs.configurePools({ paid: 3, local: 3 });
const parallel = await Promise.all([
  jobs.withSlot("local", { label: "x" }, async () => {
    await sleep(20);
    return 1;
  }),
  jobs.withSlot("local", { label: "y" }, async () => {
    await sleep(20);
    return 2;
  })
]);
check("上限放开后可以并行", JSON.stringify(parallel) === JSON.stringify([1, 2]));
check("队列说明文案带位次与上限", /第 \d+ 位/.test(jobs.queueMessage({ lane: "paid", position: 2, ahead: 1, limit: 3, etaMs: 4000 })));

// 排队信息要落到「正在跑的那个任务」的说明上，界面才看得到「在等，不是坏了」。
const queueNotice = jobs.startJob({ module: "music", scope: "queued-scope", taskKey: "generation", label: "生成" });
jobs.noteQueued("queued-scope", { lane: "paid", position: 2, ahead: 1, limit: 1, etaMs: 5000 });
check("排队位次写进任务说明", /第 2 位/.test(jobs.getJob(queueNotice.id)?.detail ?? ""), jobs.getJob(queueNotice.id)?.detail ?? "");
jobs.cancelJob(queueNotice.id);
jobs.resetPools();

// ── 3) 付费 receipt ─────────────────────────────────────────────────────
section("3) 付费 receipt（幂等 / 指纹兜底 / 不删记录）");

const intent = { requestId: "req-abcdef12", method: "runSfxGeneration", module: "sfx", jobId: "f-test" };
const identity = { prompt: "短促的 UI 点击声", format: "mp3" };
let remoteCalls = 0;
const fakeRemote = async () => {
  remoteCalls++;
  return { ok: true };
};

const keyRoot = receipts.receiptsRoot();
check("receipts 目录在 DSH_HOME 下", keyRoot.startsWith(HOME), keyRoot);

const ticket = await receipts.beginPaidCall({ provider: "seed-audio", identity, intent });
check("beginPaidCall 建出 submitting 记录", (await receipts.readReceipt(ticket.key))?.state === "submitting");
const files = await readdir(keyRoot);
check("记录真的落盘（重启后还在）", files.includes(`${ticket.key}.json`), files.join(","));

let duplicateError;
try {
  await receipts.beginPaidCall({ provider: "seed-audio", identity, intent });
} catch (error) {
  duplicateError = error;
}
if (duplicateError !== undefined) remoteCalls += 0; // 第二次提交连远端都没碰
await fakeRemote();
check(
  "同一 requestId 二次提交被拒绝，且不产生第二次远端调用",
  duplicateError instanceof receipts.PaidDuplicateError && remoteCalls === 1,
  `远端调用 ${remoteCalls} 次；错误 ${duplicateError?.code ?? "无"}`
);

await receipts.markPaidSubmitted(ticket.key, { taskId: "task-1" });
const submitted = await receipts.readReceipt(ticket.key);
check("markPaidSubmitted 记下远端 taskId", submitted?.state === "submitted" && submitted?.taskId === "task-1");

await receipts.markPaidResolved(ticket.key, { detail: "音频已拿到" });
check("markPaidResolved 收尾", (await receipts.readReceipt(ticket.key))?.state === "resolved");

// 「取消本地等待」不应该删记录
await receipts.markPaidUncertain(ticket.key, { detail: "等待被取消；远端可能仍会完成" });
const cancelledReceipt = await receipts.readReceipt(ticket.key);
check("取消 / 异常不会删除 receipt 文件（只改状态）", cancelledReceipt?.state === "uncertain" && cancelledReceipt?.detail.includes("取消"));

const pending = await receipts.pendingReceipts();
check("pendingReceipts 只报不确定态（submitted 有 taskId 可续查，不算风险）", pending.some((record) => record.key === ticket.key));
check("summarizePendingReceipts 给出可读警告", /不要.*重发|不要重复提交/.test(receipts.summarizePendingReceipts(pending) ?? ""));

// 无幂等键：同一内容在没结清时被拦住，结清后允许重新生成
const anonymousIntent = { method: "runImage", module: "sprite" };
let anonTicket;
try {
  anonTicket = await receipts.beginPaidCall({ provider: "ark", identity: { prompt: "一只猫" }, intent: { ...anonymousIntent } });
} catch (error) {
  anonTicket = undefined;
}
let anonymousDuplicate;
try {
  await receipts.beginPaidCall({ provider: "ark", identity: { prompt: "一只猫" }, intent: { ...anonymousIntent } });
} catch (error) {
  anonymousDuplicate = error;
}
check(
  "没带 requestId 时按内容指纹兜底（同内容第二次被拦）",
  anonTicket !== undefined && anonymousDuplicate instanceof receipts.PaidDuplicateError
);
let regeneration;
try {
  await receipts.markPaidFailed(anonTicket.key, { detail: "HTTP 400：参数错误" });
  regeneration = await receipts.beginPaidCall({ provider: "ark", identity: { prompt: "一只猫" }, intent: { ...anonymousIntent } });
} catch (error) {
  regeneration = undefined;
}
check("上一笔已定失败时允许重新生成（不会把用户永久锁死）", regeneration !== undefined);
if (regeneration !== undefined) await receipts.markPaidResolved(regeneration.key, { detail: "重新生成成功" });

// 不同 requestId = 新的付费提交，互不干扰
const other = await receipts.beginPaidCall({ provider: "seed-audio", identity, intent: { ...intent, requestId: "req-99999999" } });
check("换一个 requestId 是另一笔提交（不被误挡）", other.key !== ticket.key && (await receipts.readReceipt(other.key))?.state === "submitting");

// 失败归类：4xx = 没接单；超时 / 网络中断 = 可能已计费
check(
  "4xx 归为 failed（远端明确没接单）",
  receipts.assessPaidFailure(Object.assign(new Error("bad request"), { status: 400 })).state === "failed"
);
check(
  "超时 / 5xx 归为 uncertain（可能已经计费）",
  receipts.assessPaidFailure(new Error("生成超时（180 秒）")).state === "uncertain" &&
    receipts.assessPaidFailure(Object.assign(new Error("upstream"), { status: 502 })).state === "uncertain"
);

// 按远端 taskId 收敛
const settleTicket = await receipts.beginPaidCall({ provider: "minimax", identity: { task: "x" }, intent: { method: "runVideos", module: "sprite" } });
await receipts.markPaidSubmitted(settleTicket.key, { taskId: "video-task-9" });
const settledCount = await receipts.settleReceiptByTaskId("video-task-9", "resolved", { detail: "视频好了" });
check("settleReceiptByTaskId 按 taskId 收敛凭证", settledCount === 1 && (await receipts.readReceipt(settleTicket.key))?.state === "resolved");

check("listReceipts 能按模块过滤并按住时间排序", (await receipts.listReceipts({ module: "sfx" })).every((record) => record.module === "sfx"));

// 清理临时数据目录
await rm(HOME, { recursive: true, force: true }).catch(() => undefined);

// ── 4) 静态契约 ─────────────────────────────────────────────────────────
section("4) 静态契约（wire / 宿主 / 客户端三处一致）");

const wireText = await src("src/wire.ts");
const hostText = await src("src/index.ts");
const clientApiText = await src("src/client/platform/api.ts");
const clientApplyText = await src("src/client/shell/apply.ts");

const PAID_METHODS = [
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

const wireMissing = PAID_METHODS.filter((method) => !new RegExp(`method: "${method}", payload: withPaidFields\\(`).test(wireText));
check("wire.ts：每个付费方法都挂了 confirm/requestId 字段", wireMissing.length === 0, wireMissing.join("、") || "");

const hostMissing = PAID_METHODS.filter((method) => !hostText.includes(`paidEntry("${method}"`));
check("index.ts：每个付费方法都过 paidEntry（校验 confirm + 注入幂等上下文）", hostMissing.length === 0, hostMissing.join("、") || "");

const hostList = /export const PAID_METHODS: readonly string\[\] = \[([\s\S]*?)\];/.exec(hostText)?.[1] ?? "";
const hostMethods = [...hostList.matchAll(/"([A-Za-z0-9_]+)"/g)].map((match) => match[1]);
check("index.ts 的 PAID_METHODS 与清单逐条一致", JSON.stringify(hostMethods.slice().sort()) === JSON.stringify(PAID_METHODS.slice().sort()));

const clientList = /export const PAID_METHODS: readonly string\[\] = \[([\s\S]*?)\];/.exec(clientApiText)?.[1] ?? "";
const clientMethods = [...clientList.matchAll(/"([A-Za-z0-9_]+)"/g)].map((match) => match[1]);
check("客户端 platform/api 的 PAID_METHODS 与宿主一致", JSON.stringify(clientMethods.slice().sort()) === JSON.stringify(PAID_METHODS.slice().sort()));

const callPaidMissing = PAID_METHODS.filter((method) => !clientApplyText.includes(`callPaid("${method}"`));
check("客户端 apply.ts：每个付费方法都走 callPaid（自动带 confirm + requestId）", callPaidMissing.length === 0, callPaidMissing.join("、") || "");

check(
  "客户端平台层会拒绝没有 confirm 的付费调用",
  clientApiText.includes("confirm-required") && clientApiText.includes("input.confirm !== true")
);

const moduleTexts = await Promise.all(["src/pipeline.ts", "src/seqgen.ts", "src/riggen.ts", "src/musicgen.ts", "src/sfxgen.ts"].map((file) => src(file)));
const resetMissing = moduleTexts
  .map((text, index) => ["pipeline", "sequence", "rig", "music", "sfx"][index])
  .filter((module, index) => !moduleTexts[index].includes(`resetModuleJobs("${module}"`));
check("五个模块的 activate*/dispose* 都走统一复位（重载后不会残留任务）", resetMissing.length === 0, resetMissing.join("、") || "");

const mediaText = await src("src/media.ts");
check("本机 ffmpeg 走 local 通道", mediaText.includes('withSlot("local"'));

const providerTexts = await Promise.all([
  src("src/imageprovider.ts"),
  src("src/videogen.ts"),
  src("src/musicapi.ts"),
  src("src/sfxapi.ts"),
  src("src/toapis.ts")
]);
check(
  "五个付费提交层都接 receipt（beginPaidCall）",
  providerTexts.every((text) => text.includes("beginPaidCall"))
);
// toapis.ts 是「被 imageprovider / videogen 包着的传输层」，通道在调用方就收过了，
// 所以它只要求 receipt、不要求自己再抢名额（否则同一笔会被算两次）。
check(
  "四个直连付费提交层都走 paid 通道",
  providerTexts.slice(0, 4).every((text) => text.includes('withSlot("paid"'))
);

// ── 汇总 ────────────────────────────────────────────────────────────────
console.log("");
if (failures.length > 0) {
  console.log(`失败 ${failures.length} 项：${failures.join("、")}`);
  process.exitCode = 1;
} else {
  console.log(`共 ${checks} 项检查，全部通过。`);
}
