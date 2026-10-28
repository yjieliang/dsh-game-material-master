#!/usr/bin/env node
/**
 * 产物 QA（体检报告）自检 —— 纯本地，不联网、不花钱。
 *
 *   node scripts/verify-qa.mjs
 *
 * 覆盖：
 *   1. 指标黄金值：合成 RGBA fixture（合格 / 不合格 / 阈值边界 / 降采样 / 报告结构）
 *   2. PNG 解码器（runQA 复算走它）
 *   3. 落盘与接线：seqgen 条图 / pipeline 整图 / imagegen 抠像后 -> qa/report.json
 *   4. 网关：runQA 三路分派、回包 qa 摘要、fail-closed 阻断、资源路由可下载报告
 *   5. 配置：qaEnabled / qaFailClosed / qaThresholds（directKeys）
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

const HOME = await mkdtemp(join(tmpdir(), "dsh-gmm-qa-"));
process.env.DSH_HOME = HOME;

const { Context } = await import("@deepseek-ai/cordis");
const plugin = await import("../lib/index.js");
const QA = await import("../lib/qa.js");
const { encodePng } = await import("../lib/png.js");
const store = await import("../lib/store.js");
const pipeline = await import("../lib/pipeline.js");
const seqgen = await import("../lib/seqgen.js");
const imagegen = await import("../lib/imagegen.js");
const config = await import("../lib/config.js");
const { handleAsset } = await import("../lib/assets.js");
const WIRE = await import("../lib/wire.js");

let checks = 0;
const failures = [];
function check(name, ok, detail) {
  checks++;
  console.log("  " + (ok ? "✓" : "✗") + " " + name + (detail === undefined ? "" : " — " + detail));
  if (!ok) failures.push(name);
}
function section(title) {
  console.log("\n" + title);
}

// ── 合成 RGBA fixture 工具 ──────────────────────────────────────────────
function fillRect(rgba, width, x, y, w, h, r, g, b, a) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = (yy * width + xx) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
}
function characterFrame(width, height, x, y, w, h, color) {
  const rgba = Buffer.alloc(width * height * 4);
  const c = color ?? [200, 120, 80, 255];
  fillRect(rgba, width, x, y, w, h, c[0], c[1], c[2], c[3]);
  return { rgba, width, height };
}
function sameCharacter(index, width, height) {
  return characterFrame(width ?? 64, height ?? 96, 20, 10, 24, 60);
}
function metricsByKey(report) {
  const out = {};
  for (const metric of report.metrics) out[metric.key] = metric;
  return out;
}

async function main() {
  console.log("临时 DSH_HOME: " + HOME);

  // ── 1. 降采样与棋盘速率 ──────────────────────────────────────────────
  section("1) 降采样");
  check("512 长边不降采样", QA.qaDownscaleFactor(512, 300) === 1);
  check("513 长边降 2×", QA.qaDownscaleFactor(513, 300) === 2);
  check("1024 长边降 2×", QA.qaDownscaleFactor(1024, 768) === 2);
  check("1600 长边降 4×", QA.qaDownscaleFactor(1600, 100) === 4);
  check("按长边而不是宽高分别判", QA.qaDownscaleFactor(100, 1600) === 4);
  {
    // 4×4：左半 2×2 块里只有 2 个像素不透明（alpha = 255*2/4 = 127.5 -> 128），
    // 右半 2×2 块全透明 -> 0。
    const rgba = Buffer.alloc(4 * 4 * 4);
    for (let y = 0; y < 2; y++) fillRect(rgba, 4, 0, y, 1, 1, 200, 40, 30, 255);
    const down = QA.downsampleRgba(rgba, 4, 4, 2);
    check("盒式降采样输出尺寸", down.width === 2 && down.height === 2, down.width + "×" + down.height);
    const alphaLeft = down.rgba[(0 * 2 + 0) * 4 + 3];
    const alphaRight = down.rgba[(0 * 2 + 1) * 4 + 3];
    check("alpha 取块平均（一半 255 一半 0 -> 128）", alphaLeft === 128 && alphaRight === 0, alphaLeft + "/" + alphaRight);
    check("RGB 按 alpha 预乘（透明区不污染颜色）", down.rgba[0] === 200 && down.rgba[1] === 40, down.rgba[0] + "," + down.rgba[1]);
  }

  // ── 2. 阈值覆盖 ──────────────────────────────────────────────────────
  section("2) 阈值覆盖");
  const defaults = QA.normalizeQaThresholds(undefined);
  check("默认阈值齐全（8 个键）", Object.keys(defaults).length === 8, Object.keys(defaults).join(","));
  check("默认身高 CV 是 1（fail 线）", defaults.heightCvMax === 1);
  check("默认循环缝 IoU 是 0.35", defaults.loopSeamIouMin === 0.35);
  const overridden = QA.normalizeQaThresholds({ heightCvMax: 2.5, 未知键: 99 });
  check("覆盖率指定键", overridden.heightCvMax === 2.5, String(overridden.heightCvMax));
  check("不认识的键被丢弃", overridden["未知键"] === undefined);
  const clamped = QA.normalizeQaThresholds({ fringeRatioMax: 5, loopSeamIouMin: -2 });
  check("越界值夹回安全区间", clamped.fringeRatioMax === 1 && clamped.loopSeamIouMin === 0, clamped.fringeRatioMax + "/" + clamped.loopSeamIouMin);
  const reversed = QA.normalizeQaThresholds({ transparentRatioMin: 0.9, transparentRatioMax: 0.1 });
  check("透明比例上下界写反时回落默认", reversed.transparentRatioMin === 0.05 && reversed.transparentRatioMax === 0.95);

  // ── 3. PNG 解码器 ────────────────────────────────────────────────────
  section("3) PNG 解码（runQA 复算用）");
  {
    const rgba = Buffer.alloc(3 * 2 * 4);
    for (let i = 0; i < 6; i++) {
      rgba[i * 4] = 10 + i * 20;
      rgba[i * 4 + 1] = 200 - i * 10;
      rgba[i * 4 + 2] = i * 30;
      rgba[i * 4 + 3] = i % 2 === 0 ? 255 : 128;
    }
    const decoded = QA.decodePngRgba(encodePng(rgba, 3, 2));
    check("能解开自己写出的 RGBA8 PNG", decoded !== undefined && decoded.width === 3 && decoded.height === 2);
    check("解码像素逐字节一致", decoded !== undefined && decoded.rgba.equals(rgba));
    check("非 PNG 输入返回 undefined", QA.decodePngRgba(Buffer.from("hello world")) === undefined);
    check("空缓冲返回 undefined", QA.decodePngRgba(Buffer.alloc(0)) === undefined);
  }

  // ── 4. 指标黄金值：合格 fixture ──────────────────────────────────────
  section("4) 指标黄金值（合格）");
  const passFrames = [];
  for (let i = 0; i < 8; i++) passFrames.push(sameCharacter(i));
  const passReport = QA.qaFrames(passFrames, { scope: "sprite", loops: [[0, 1, 2, 3, 4, 5, 6, 7]] });
  const passMetrics = metricsByKey(passReport);
  check("合格产物的结论是 pass", passReport.verdict === "pass", passReport.verdict);
  check("透明比例约 0.7656", Math.abs(passMetrics.transparentRatio.value - 0.765625) < 0.001, String(passMetrics.transparentRatio.value));
  check("身高 CV = 0（所有帧同高）", passMetrics.heightCv.value === 0, String(passMetrics.heightCv.value));
  check("包围盒宽度 CV = 0", passMetrics.bboxCv.value === 0);
  check("头宽 CV = 0", passMetrics.headWidthCv.value === 0);
  check("无彩边（fringeRatio = 0）", passMetrics.fringeRatio.value === 0);
  check("首尾同一帧 -> 循环缝 IoU = 1", passMetrics.loopSeamIou.value === 1);
  check("首尾同一帧 -> 循环缝 RGB 差 = 0", passMetrics.loopSeamDiff.value === 0);
  check("质心抖动只记录（info）", passMetrics.centroidJitter.verdict === "info" && passMetrics.centroidJitterMedian.verdict === "info");
  check("报告结构完整", passReport.version === 1 && passReport.scope === "sprite" && passReport.frameCount === 8 && typeof passReport.generatedAt === "number" && typeof passReport.elapsedMs === "number");
  check("报告可无损 JSON 往返", JSON.stringify(JSON.parse(JSON.stringify(passReport))) === JSON.stringify(passReport));
  check("issues 里只有 warn / fail", passReport.issues.every((issue) => issue.level === "warn" || issue.level === "fail"));
  check("metrics 每项都有 key / label / value / verdict", passReport.metrics.every((metric) => typeof metric.key === "string" && typeof metric.label === "string" && typeof metric.value === "number" && typeof metric.verdict === "string"));

  // ── 5. 不合格 fixture：身高漂移 + 循环缝错位 ─────────────────────────
  section("5) 指标黄金值（不合格）");
  const heights = [60, 54, 48, 42, 36, 30, 24, 60];
  const driftFrames = heights.map((h) => characterFrame(64, 96, 20, 96 - 10 - h, 24, h));
  const driftReport = QA.qaFrames(driftFrames, { scope: "sprite", loops: [[0, 1, 2, 3, 4, 5, 6, 7]] });
  const driftMetrics = metricsByKey(driftReport);
  check("身高不一致 -> heightCv 超线", driftMetrics.heightCv.verdict === "fail" && driftMetrics.heightCv.value > 1, String(driftMetrics.heightCv.value));
  check("身高不一致 -> 结论 fail", driftReport.verdict === "fail");
  check("issues 里带上 heightCv 的 fail（fail-closed 靠它）", driftReport.issues.some((issue) => issue.code === "heightCv" && issue.level === "fail"));
  {
    // 首帧在左下、末帧在右上：掩码完全不相交 -> 循环缝 IoU = 0。
    const frames = [
      characterFrame(64, 96, 4, 60, 16, 30),
      characterFrame(64, 96, 24, 30, 16, 30),
      characterFrame(64, 96, 40, 8, 16, 30),
      characterFrame(64, 96, 40, 8, 16, 30)
    ];
    const report = QA.qaFrames(frames, { scope: "sequence", loops: [[0, 1, 2, 3]] });
    const metrics = metricsByKey(report);
    check("首尾不重叠 -> 循环缝 IoU = 0", metrics.loopSeamIou.value === 0, String(metrics.loopSeamIou.value));
    check("循环缝低于 0.35 -> fail", metrics.loopSeamIou.verdict === "fail");
  }
  {
    // 半透明绿色轮廓：彩边比例拉满 -> warn。
    const rgba = Buffer.alloc(64 * 96 * 4);
    fillRect(rgba, 64, 20, 10, 24, 60, 10, 200, 10, 200);
    const green = [{ rgba, width: 64, height: 96 }];
    const report = QA.qaFrames([green[0], green[0]], { scope: "sequence", loops: [[0, 1]] });
    const metrics = metricsByKey(report);
    check("整片绿边 -> fringeRatio = 1", metrics.fringeRatio.value === 1, String(metrics.fringeRatio.value));
    check("彩边超 0.15 -> warn（不 fail）", metrics.fringeRatio.verdict === "warn");
  }

  // ── 6. 阈值边界 ──────────────────────────────────────────────────────
  section("6) 阈值边界");
  {
    const relaxed = QA.qaFrames(driftFrames, { scope: "sprite", loops: [[0, 1, 2, 3, 4, 5, 6, 7]], thresholds: { heightCvMax: 100 } });
    check("把身高 CV 线放宽到 100 后不再 fail", !relaxed.metrics.some((metric) => metric.verdict === "fail"), relaxed.verdict);
    const tight = QA.qaFrames(passFrames, { scope: "sprite", loops: [[0, 1, 2, 3, 4, 5, 6, 7]], thresholds: { transparentRatioMax: 0.5 } });
    const tightMetrics = metricsByKey(tight);
    check("透明比例上限 0.5 -> 合格产物也报 warn", tightMetrics.transparentRatio.verdict === "warn");
    check("报告里记录本次生效阈值", tight.thresholds.transparentRatioMax === 0.5, String(tight.thresholds.transparentRatioMax));
  }
  {
    // 1024 长边：盒式降 2× 后再算，比例保持一致。
    const big = Buffer.alloc(1024 * 1024 * 4);
    fillRect(big, 1024, 256, 256, 512, 512, 180, 180, 180, 255);
    const bigFrame = { rgba: big, width: 1024, height: 1024 };
    const report = QA.qaFrames([bigFrame, bigFrame], { scope: "sequence", loops: [[0, 1]] });
    const metrics = metricsByKey(report);
    check("长边 1024 记录 sampled = 2", report.sampled === 2, String(report.sampled));
    check("降采样后透明比例仍约 0.75", Math.abs(metrics.transparentRatio.value - 0.75) < 0.01, String(metrics.transparentRatio.value));
    check("降采样后循环缝仍 = 1", metrics.loopSeamIou.value === 1);
  }
  {
    const single = QA.qaFrames([sameCharacter(0)], { scope: "image", consistency: false });
    const keys = single.metrics.map((metric) => metric.key);
    check("单图作用域不算帧间一致性", !keys.includes("bboxCv") && !keys.includes("loopSeamIou"), keys.join(","));
    check("单图作用域仍算透明比例与彩边", keys.includes("transparentRatio") && keys.includes("fringeRatio"));
  }

  // ── 7. 摘要 / fail-closed 判定 ───────────────────────────────────────
  section("7) 摘要与 fail-closed");
  {
    const summary = QA.summarizeQA(driftReport, { failClosed: false });
    check("摘要带 verdict / 计数 / 报告路径", summary.verdict === "fail" && summary.failCount >= 1 && summary.reportPath === "qa/report.json");
    check("摘要 issues 最多 5 条", summary.issues.length <= 5, String(summary.issues.length));
    check("未开 fail-closed 时 blocked=false", summary.blocked === false);
    const blocked = QA.summarizeQA(driftReport, { failClosed: true });
    check("开 fail-closed 且 fail -> blocked=true", blocked.blocked === true && blocked.failClosed === true);
    check("默认不阻断（qaBlockReason 返回 null）", QA.qaBlockReason(driftReport, { qaEnabled: true, qaFailClosed: false }) === null);
    const reason = QA.qaBlockReason(driftReport, { qaEnabled: true, qaFailClosed: true });
    check("fail-closed + fail -> 返回阻断原因", typeof reason === "string" && reason.includes("QA"), reason === null ? "null" : reason.slice(0, 40));
    check("关掉自动体检后不阻断", QA.qaBlockReason(driftReport, { qaEnabled: false, qaFailClosed: true }) === null);
    check("fail-closed + pass -> 不阻断", QA.qaBlockReason(passReport, { qaEnabled: true, qaFailClosed: true }) === null);
    check("结论文案", QA.qaVerdictText(passReport) === "通过" && QA.qaVerdictText(driftReport).includes("失败"));
  }

  // ── 8. 整图切帧 / 合成报告 ───────────────────────────────────────────
  section("8) 整图切帧");
  {
    const cellWidth = 4;
    const cellHeight = 4;
    const columns = 2;
    const rows = 2;
    const width = cellWidth * columns;
    const height = cellHeight * rows;
    const sheet = Buffer.alloc(width * height * 4);
    const colors = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0]
    ];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        fillRect(sheet, width, col * cellWidth, row * cellHeight, cellWidth, cellHeight, colors[row * columns + col][0], colors[row * columns + col][1], colors[row * columns + col][2], 255);
      }
    }
    const frames = QA.qaCellFrames({ rgba: sheet, sheetWidth: width, columns, rows, cellWidth, cellHeight });
    check("切出的帧数 = 行 × 列", frames.length === 4, String(frames.length));
    check("第 1 格取到红色", frames[0].rgba[0] === 255 && frames[0].rgba[1] === 0, frames[0].rgba.slice(0, 4).join(","));
    check("第 4 格取到黄色", frames[3].rgba[0] === 255 && frames[3].rgba[1] === 255, frames[3].rgba.slice(0, 4).join(","));
    check("循环组按行分组", JSON.stringify(QA.qaLoopGroups(2, 3)) === JSON.stringify([[0, 1, 2], [3, 4, 5]]));
    const composed = QA.qaComposedSheet({ scope: "sprite", rgba: sheet, width, columns, rows, cellWidth, cellHeight });
    check("整图直接出报告（scope=sprite, 4 帧）", composed.scope === "sprite" && composed.frameCount === 4);
  }

  // ── 9. 接线：序列帧条图 / 整图 / 图片任务 ────────────────────────────
  section("9) 接线与落盘");
  const seqJob = await seqgen.createSequenceJob("QA 序列帧测试");
  {
    const width = 64;
    const height = 96;
    const count = 4;
    const raw = Buffer.alloc(width * height * 4 * count);
    for (let i = 0; i < count; i++) {
      const frame = Buffer.alloc(width * height * 4);
      fillRect(frame, width, 0, 0, width, height, 0, 230, 0, 255);
      fillRect(frame, width, 20, 10, 24, 60, 180, 180, 180, 255);
      frame.copy(raw, i * width * height * 4);
    }
    await writeFile(seqgen.sequenceAssetPath(seqJob.id, "frames/raw.bin"), raw);
    const staged = await seqgen.readSequenceJob(seqJob.id);
    staged.frames = { status: "ready", count, files: [], keyed: [], raw: "frames/raw.bin", width, height };
    await seqgen.writeSequenceJob(staged);
    await seqgen.keySequenceFrames(seqJob.id);
    await seqgen.composeSequenceSheet(seqJob.id);
    const fresh = await seqgen.readSequenceJob(seqJob.id);
    check("条图合成后 job.qa 有报告", fresh.qa !== undefined && fresh.qa.version === 1, fresh.qa === undefined ? "undefined" : fresh.qa.verdict);
    check("条图报告 scope = sequence", fresh.qa.scope === "sequence");
    check("qa/report.json 落盘", existsSync(join(seqgen.sequenceJobDir(seqJob.id), "qa", "report.json")));
    const onDisk = JSON.parse(await readFile(join(seqgen.sequenceJobDir(seqJob.id), "qa", "report.json"), "utf8"));
    check("落盘报告与 job.qa 一致", onDisk.verdict === fresh.qa.verdict && onDisk.metrics.length === fresh.qa.metrics.length);
  }

  const project = await store.createProject("QA 整图测试");
  {
    const cellWidth = 32;
    const cellHeight = 32;
    const columns = 2;
    const rows = 2;
    const width = cellWidth * columns;
    const height = cellHeight * rows;
    const sheet = Buffer.alloc(width * height * 4);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        fillRect(sheet, width, col * cellWidth + 8, row * cellHeight + 4, 16, 24, 200, 120, 80, 255);
      }
    }
    await writeFile(store.assetPath(project.id, "out/sheet.png"), encodePng(sheet, width, height));
    const staged = await store.readProject(project.id);
    staged.sheet = { status: "ready", file: "out/sheet.png", approved: false, width, height, rowOrder: ["front", "back"], cellWidth, cellHeight, frameCount: columns };
    await store.writeProject(staged);
    const result = await pipeline.runProjectQA(project.id);
    check("整图复算返回报告", result.report.version === 1 && result.report.scope === "sprite");
    check("整图复算 frameCount = 行 × 列", result.report.frameCount === rows * columns, String(result.report.frameCount));
    check("整图报告写回项目节点", (await store.readProject(project.id)).sheet.qa !== undefined);
    check("整图 qa/report.json 落盘", existsSync(join(store.projectDir(project.id), "qa", "report.json")));
  }

  const imageJob = await imagegen.createImageJob("QA 图片任务");
  {
    const keyedA = characterFrame(64, 96, 20, 10, 24, 60, [90, 160, 220, 255]);
    const keyedB = characterFrame(64, 96, 18, 12, 28, 56, [90, 160, 220, 255]);
    await writeFile(imagegen.imageAssetPath(imageJob.id, "keyed/img-00.png"), encodePng(keyedA.rgba, keyedA.width, keyedA.height));
    await writeFile(imagegen.imageAssetPath(imageJob.id, "keyed/img-01.png"), encodePng(keyedB.rgba, keyedB.width, keyedB.height));
    const staged = await imagegen.readImageJob(imageJob.id);
    staged.items = [
      { index: 0, status: "ready", file: "out/img-00.png", keyedFile: "keyed/img-00.png", source: "generated" },
      { index: 1, status: "ready", file: "out/img-01.png", keyedFile: "keyed/img-01.png", source: "generated" }
    ];
    await imagegen.writeImageJob(staged);
    const report = await imagegen.refreshImageJobQA(imageJob.id);
    check("图片任务抠像后出报告", report !== undefined && report.scope === "image");
    check("图片任务报告不含循环缝指标", report !== undefined && !report.metrics.some((metric) => metric.key === "loopSeamIou"));
    check("图片任务 qa/report.json 落盘", existsSync(join(imagegen.imageJobDir(imageJob.id), "qa", "report.json")));
    const fresh = await imagegen.readImageJob(imageJob.id);
    check("图片任务 job.qa 已写回", fresh.qa !== undefined && fresh.qa.version === 1);
  }

  // ── 10. 网关：runQA 分派 / 回包摘要 / fail-closed / 资源路由 ────────
  section("10) 网关与路由");
  const ctx = new Context();
  const captured = { manifest: null, routes: [] };
  ctx.provide("typert", {
    register: (manifest) => {
      captured.manifest = manifest;
      return () => {};
    }
  });
  ctx.provide("webServer", {
    register: (route) => {
      captured.routes.push(route);
      return () => {};
    }
  });
  plugin.apply(ctx);
  const studio = ctx.get("gameStudio");
  check("网关已挂载", studio !== undefined && typeof studio.runQA === "function");

  {
    const result = await studio.runQA({ projectId: project.id });
    check("runQA(projectId) 返回 { report, qa }", result.report !== undefined && result.qa !== undefined);
    check("runQA 的 qa 摘要有 verdict 与计数", ["pass", "warn", "fail"].includes(result.qa.verdict) && typeof result.qa.warnCount === "number");
    const projectView = await studio.getProject({ projectId: project.id });
    check("getProject 回包带 qa 摘要", projectView.qa !== undefined && projectView.qa.reportPath === "qa/report.json");
    const seqResult = await studio.runQA({ jobId: seqJob.id });
    check("runQA(jobId=s…) 走序列帧分支", seqResult.report.scope === "sequence");
    const seqView = await studio.getSequenceJob({ jobId: seqJob.id });
    check("getSequenceJob 回包带 qa 摘要", seqView.qa !== undefined && seqView.qa.verdict === seqResult.qa.verdict);
    const imageResult = await studio.runQA({ jobId: imageJob.id });
    check("runQA(jobId=i…) 走图片分支", imageResult.report.scope === "image");
    const imageView = await studio.getImageJob({ jobId: imageJob.id });
    check("getImageJob 回包带 qa 摘要", imageView.qa !== undefined);
    let threw = null;
    try {
      await studio.runQA({});
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error);
    }
    check("runQA 缺目标时明确报错", threw !== null && threw.includes("projectId"), threw === null ? "未抛错" : threw.slice(0, 40));
  }

  // fail-closed：造一个身高漂移的整图（verdict=fail），开关打开后「打通过」必须被拦。
  const failProject = await store.createProject("QA fail-closed 测试");
  const failSeqJob = await seqgen.createSequenceJob("QA fail-closed 序列帧");
  {
    const cellWidth = 32;
    const cellHeight = 32;
    const columns = 2;
    const rows = 2;
    const width = cellWidth * columns;
    const height = cellHeight * rows;
    const sheet = Buffer.alloc(width * height * 4);
    const heights = [28, 20, 12, 6];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const h = heights[row * columns + col];
        fillRect(sheet, width, col * cellWidth + 8, row * cellHeight + (30 - h), 16, h, 200, 120, 80, 255);
      }
    }
    await writeFile(store.assetPath(failProject.id, "out/sheet.png"), encodePng(sheet, width, height));
    const staged = await store.readProject(failProject.id);
    staged.sheet = { status: "ready", file: "out/sheet.png", approved: false, width, height, rowOrder: ["front", "back"], cellWidth, cellHeight, frameCount: columns };
    await store.writeProject(staged);
    const result = await pipeline.runProjectQA(failProject.id);
    check("漂移整图被判 fail", result.report.verdict === "fail", result.report.verdict);

    // 序列帧：首尾错位 -> 循环缝 fail。
    const frameWidth = 64;
    const frameHeight = 96;
    const count = 4;
    const raw = Buffer.alloc(frameWidth * frameHeight * 4 * count);
    for (let i = 0; i < count; i++) {
      const frame = Buffer.alloc(frameWidth * frameHeight * 4);
      fillRect(frame, frameWidth, 0, 0, frameWidth, frameHeight, 0, 230, 0, 255);
      const x = i === 0 ? 4 : i === count - 1 ? 40 : 22;
      fillRect(frame, frameWidth, x, 30, 16, 30, 180, 180, 180, 255);
      frame.copy(raw, i * frameWidth * frameHeight * 4);
    }
    await writeFile(seqgen.sequenceAssetPath(failSeqJob.id, "frames/raw.bin"), raw);
    const seqStaged = await seqgen.readSequenceJob(failSeqJob.id);
    seqStaged.frames = { status: "ready", count, files: [], keyed: [], raw: "frames/raw.bin", width: frameWidth, height: frameHeight };
    await seqgen.writeSequenceJob(seqStaged);
    await seqgen.keySequenceFrames(failSeqJob.id);
    await seqgen.composeSequenceSheet(failSeqJob.id);
    const failSeq = await seqgen.readSequenceJob(failSeqJob.id);
    check("错位序列帧的条图被判 fail", failSeq.qa !== undefined && failSeq.qa.verdict === "fail", failSeq.qa === undefined ? "undefined" : failSeq.qa.verdict);

    // 默认关：打通过照常通过。
    let defaultThrew = null;
    try {
      await studio.setApproved({ projectId: failProject.id, stage: "sheet", approved: true });
    } catch (error) {
      defaultThrew = error instanceof Error ? error.message : String(error);
    }
    check("默认（warning-only）不阻断打通过", defaultThrew === null, defaultThrew === null ? "" : defaultThrew.slice(0, 60));

    await config.saveConfig({ qaFailClosed: true });
    let blockedMessage = null;
    try {
      await studio.setApproved({ projectId: failProject.id, stage: "sheet", approved: true });
    } catch (error) {
      blockedMessage = error instanceof Error ? error.message : String(error);
    }
    check("开 fail-closed 后整图打通过被拦", blockedMessage !== null && blockedMessage.includes("QA"), blockedMessage === null ? "未拦截" : blockedMessage.slice(0, 50));
    let seqBlocked = null;
    try {
      await studio.saveSequenceJob({ jobId: failSeqJob.id, step: "sheet", approved: true });
    } catch (error) {
      seqBlocked = error instanceof Error ? error.message : String(error);
    }
    check("开 fail-closed 后条图打通过被拦", seqBlocked !== null && seqBlocked.includes("QA"), seqBlocked === null ? "未拦截" : seqBlocked.slice(0, 50));
    await config.saveConfig({ qaFailClosed: false });
    let afterOff = null;
    try {
      await studio.setApproved({ projectId: failProject.id, stage: "sheet", approved: true });
    } catch (error) {
      afterOff = error instanceof Error ? error.message : String(error);
    }
    check("关回去后又能打通过", afterOff === null, afterOff === null ? "" : afterOff.slice(0, 60));
    const summaryView = await studio.getProject({ projectId: failProject.id });
    check("回包摘要里 fail 计数与 failClosed=false 一致", summaryView.qa !== undefined && summaryView.qa.failCount >= 1 && summaryView.qa.blocked === false);
  }

  // 配置：directKeys 透传 + normalize 收敛
  {
    const saved = await studio.saveConfig({ qaEnabled: false, qaThresholds: { heightCvMax: 2.5 } });
    check("saveConfig 写入 qaEnabled", saved.qaEnabled === false);
    check("qaThresholds 被收敛成完整生效表", saved.qaThresholds.heightCvMax === 2.5 && Object.keys(saved.qaThresholds).length === 8, String(saved.qaThresholds.heightCvMax));
    const reloaded = await studio.getConfig();
    check("重读配置仍是新值", reloaded.qaEnabled === false && reloaded.qaThresholds.heightCvMax === 2.5);
    await studio.saveConfig({ qaEnabled: true });
  }

  // wire：runQA 的 payload 键必须过 schema，否则界面的调用会被静默丢掉。
  {
    const spec = WIRE.METHODS.find((entry) => entry.method === "runQA");
    check("wire 里有 runQA", spec !== undefined && spec.payload !== undefined);
    const projectPayload = spec.payload.parse({ projectId: "p1" });
    check("runQA payload 保留 projectId", projectPayload.projectId === "p1");
    const jobPayload = spec.payload.parse({ jobId: "i1" });
    check("runQA payload 保留 jobId", jobPayload.jobId === "i1");
    check("wire 方法总数为 201（合并后全量：互操作 2 + 导出 1 + 去背 1 + QA 1 + 选帧 2 + 工作流库 6，188 + 13）", WIRE.METHODS.length === 201, String(WIRE.METHODS.length));
  }

  // 资源路由：qa/report.json 必须能直接下载（白名单少一条就是「徽章有、导出 403」）。
  {
    const route = captured.routes.find((entry) => entry.kind === "prefix");
    check("资源路由已注册", route !== undefined);
    const server = createServer((req, res) => {
      void route.handler(req, res);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    try {
      const seqUrl = "http://127.0.0.1:" + port + "/dsh-inkbox/sequence-assets/" + seqJob.id + "/qa/report.json";
      const seqResponse = await fetch(seqUrl);
      check("序列帧 qa/report.json 可下载（200）", seqResponse.status === 200, String(seqResponse.status));
      const seqBody = await seqResponse.json();
      check("下载到的就是报告 JSON", seqBody.version === 1 && Array.isArray(seqBody.metrics));
      const projectUrl = "http://127.0.0.1:" + port + "/dsh-inkbox/assets/" + project.id + "/qa/report.json";
      const projectResponse = await fetch(projectUrl);
      check("整图 qa/report.json 可下载（200）", projectResponse.status === 200, String(projectResponse.status));
      const imageUrl = "http://127.0.0.1:" + port + "/dsh-inkbox/image-assets/" + imageJob.id + "/qa/report.json";
      const imageResponse = await fetch(imageUrl);
      check("图片任务 qa/report.json 可下载（200）", imageResponse.status === 200, String(imageResponse.status));
      const otherUrl = "http://127.0.0.1:" + port + "/dsh-inkbox/sequence-assets/" + seqJob.id + "/keyed/../../qa/report.json";
      const otherResponse = await fetch(otherUrl);
      check("目录穿越被挡（400 / 403）", otherResponse.status === 400 || otherResponse.status === 403, String(otherResponse.status));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

try {
  await main();
} catch (error) {
  console.error("\n自检抛异常：", error);
  failures.push("自检抛异常：" + (error instanceof Error ? error.message : String(error)));
} finally {
  await rm(HOME, { recursive: true, force: true }).catch(() => undefined);
}

const passed = checks - failures.length;
console.log("\n共 " + checks + " 项检查，通过 " + passed + " 项。");
if (failures.length > 0) {
  console.log("失败 " + failures.length + " 项：");
  for (const name of failures) console.log("  - " + name);
  process.exit(1);
}
console.log("产物 QA 自检全部通过。");
