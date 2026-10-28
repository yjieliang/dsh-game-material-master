#!/usr/bin/env node
/**
 * 真实产物 QA 报告生成器（不是断言脚本，是证据采集工具）。
 *
 *   node scripts/qa-live-report.mjs
 *   node scripts/qa-live-report.mjs --out docs/qa-live-20261029
 *
 * 做法：把本机已有的真实交付物（G:/image 下的 sprite_sheet.png，只读复制）塞进
 * 临时 DSH_HOME 的「项目整图」位置，再走插件自己的 runProjectQA 算一份报告，
 * 报告 JSON 与 Markdown 摘要都写进 --out 目录，供人眼验收与文档引用。
 *
 * 为什么不用合成 fixture：合成数据只能证明公式自洽；真实产物（真实抠像、真实抗锯齿、
 * 真实循环）才能证明阈值没写反、报告读数与肉眼判断一致。
 *
 * 只读 G:/image，不写它；临时 DSH_HOME 用完即删。
 */

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = argv.indexOf("--" + name);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
};
const OUT = argOf("out", "docs/qa-live-20261029");

/** 真实产物清单：路径 + 显示名 + 单格尺寸（其余从图里推）。 */
const CASES = [
  { name: "p3-walk_v11", sheet: "G:/image/deliverables/p3-walk_v11/sprite_sheet.png", cellWidth: 256, cellHeight: 384, note: "走循环（生产定稿，期望 QA 通过或仅轻微警告）" },
  { name: "noblewoman-walk_v1", sheet: "G:/image/deliverables/noblewoman-walk_v1/sprite_sheet.png", cellWidth: 256, cellHeight: 384, note: "另一角色走循环" },
  { name: "knight-attack_v1", sheet: "G:/image/deliverables/knight-attack_v1/sprite_sheet.png", cellWidth: 256, cellHeight: 384, note: "一次性攻击动作（不是循环，首尾帧本来就不同 —— 期望循环缝指标暴露这一点）" }
];

const HOME = await mkdtemp(join(tmpdir(), "dsh-gmm-qa-live-"));
process.env.DSH_HOME = HOME;

const QA = await import("../lib/qa.js");
const store = await import("../lib/store.js");
const pipeline = await import("../lib/pipeline.js");

function markdownCell(text) {
  return String(text).split("|").join("/");
}

function metricText(metric) {
  const key = metric.key;
  if (key === "transparentRatio" || key === "fringeRatio") return (Number(metric.value) * 100).toFixed(1) + "%";
  if (key === "bboxCv" || key === "heightCv" || key === "headWidthCv") return metric.value + "%";
  if (key === "loopSeamIou") return Number(metric.value).toFixed(3);
  if (key === "loopSeamDiff") return String(metric.value);
  return metric.value + "px";
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const rows = [];
  const details = [];
  for (const testCase of CASES) {
    let buffer;
    try {
      buffer = await readFile(testCase.sheet);
    } catch (error) {
      console.log("跳过（读不到）：" + testCase.sheet);
      continue;
    }
    const decoded = QA.decodePngRgba(buffer);
    if (decoded === undefined) {
      console.log("跳过（不是 RGBA8 PNG）：" + testCase.sheet);
      continue;
    }
    const columns = Math.max(1, Math.round(decoded.width / testCase.cellWidth));
    const rowCount = Math.max(1, Math.round(decoded.height / testCase.cellHeight));
    const project = await store.createProject("QA 真实产物 · " + testCase.name);
    await copyFile(testCase.sheet, store.assetPath(project.id, "out/sheet.png"));
    const staged = await store.readProject(project.id);
    staged.sheet = {
      status: "ready",
      file: "out/sheet.png",
      approved: false,
      width: decoded.width,
      height: decoded.height,
      rowOrder: ["front"],
      cellWidth: testCase.cellWidth,
      cellHeight: testCase.cellHeight,
      frameCount: columns
    };
    await store.writeProject(staged);
    const result = await pipeline.runProjectQA(project.id);
    const report = result.report;
    const reportName = testCase.name + "-report.json";
    await writeFile(join(OUT, reportName), JSON.stringify(report, null, 2) + "\n", "utf8");
    const attention = report.metrics.filter((metric) => metric.verdict === "warn" || metric.verdict === "fail");
    rows.push({
      name: testCase.name,
      note: testCase.note,
      size: decoded.width + "×" + decoded.height,
      frames: report.frameCount,
      verdict: report.verdict,
      attention: attention.length === 0 ? "—" : attention.map((metric) => metric.key + ": " + metric.verdict).join("、"),
      report: reportName
    });
    details.push({ name: testCase.name, report, note: testCase.note, rowCount, columns });
    console.log("\n== " + testCase.name + "（" + decoded.width + "×" + decoded.height + "，" + report.frameCount + " 帧）→ " + report.verdict);
    for (const metric of report.metrics) console.log("  " + metric.key + "=" + metricText(metric) + " (" + metric.verdict + ")");
  }

  const lines = [];
  lines.push("# 产物 QA 真实联调报告（" + new Date().toISOString().slice(0, 10) + "）");
  lines.push("");
  lines.push("数据来自本机 G:/image/deliverables 的真实交付物（只读复制到临时 DSH_HOME，不动原目录）；");
  lines.push("报告由插件自己的 runProjectQA（src/qa.ts）算出，JSON 与本文件同目录。");
  lines.push("");
  lines.push("| 产物 | 尺寸 | 帧数 | QA 结论 | 需要关注 | 说明 |");
  lines.push("|---|---|---|---|---|---|");
  for (const row of rows) {
    lines.push("| " + row.name + " | " + row.size + " | " + row.frames + " | " + row.verdict + " | " + markdownCell(row.attention) + " | " + markdownCell(row.note) + " |");
  }
  lines.push("");
  for (const entry of details) {
    lines.push("## " + entry.name + " — " + entry.report.verdict);
    lines.push("");
    lines.push(entry.note + "。整图 " + entry.report.frameCount + " 帧（" + entry.columns + " 列 × " + entry.rowCount + " 行），降采样系数 " + entry.report.sampled + "。");
    lines.push("");
    lines.push("| 指标 | 数值 | 阈值 | 判定 |");
    lines.push("|---|---|---|---|");
    for (const metric of entry.report.metrics) {
      const threshold = metric.threshold === undefined ? "—" : String(metric.threshold) + (metric.thresholdMax === undefined ? "" : "~" + metric.thresholdMax);
      lines.push("| " + metric.label + "（" + metric.key + "） | " + metricText(metric) + " | " + threshold + " | " + metric.verdict + " |");
    }
    lines.push("");
    if (entry.report.issues.length > 0) {
      lines.push("问题：");
      for (const issue of entry.report.issues) lines.push("- [" + issue.level + "] " + issue.code + "：" + issue.message);
      lines.push("");
    }
  }
  await writeFile(join(OUT, "README.md"), lines.join("\n"), "utf8");
  console.log("\n已写出 " + join(OUT, "README.md"));
}

try {
  await main();
} finally {
  await rm(HOME, { recursive: true, force: true }).catch(() => undefined);
}
