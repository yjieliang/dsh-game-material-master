/**
 * 产物 QA：把 skill 里的硬指标移植成插件内的自动体检。
 *
 * ## 口径来源
 *
 * 指标与阈值参考本机技能 minimax-h3-walk-cycle（scripts/qa_walk.py 与 SKILL.md §7
 * 验收指标，本机实测：身高 CV ≤1%、头宽 CV ≤2%、循环缝 IoU ≥0.35）。
 * 只参考口径，不搬代码；全部在本文件用纯 TS 在 RGBA 缓冲区上算。
 *
 * ## 设计口径（与 docs/墨盒-skill能力合并-重构设计.md §6.2 的对应）
 *
 * - transparentRatio：alpha < 8 的像素占比。报告取逐帧平均，同时看逐帧极值
 *   （默认 0.05~0.95，越界 warn）。
 * - fringeRatio：alpha 边缘（8 ≤ alpha ≤ 247，或前景里贴着全透明像素的那一圈）中，
 *   绿色优势 g - max(r,b) > 40 的占比（≤0.15，超阈 warn）。
 * - bboxCv：逐帧 alpha 包围盒「宽度」的变异系数（%）。设计表里 bboxCv 写了
 *   「宽 ≤5%、高 ≤1%」，其中「高」并入 heightCv（更严，fail），
 *   避免同一个数值出现两个相反判定。
 * - heightCv：逐帧 alpha 包围盒「高度」的 CV（%），≤1%，超阈 fail。
 * - headWidthCv：顶部 15% 行段最大行宽（span，与 qa_walk.py 同口径）的 CV（%），≤2% warn。
 * - loopSeamIou：循环组「末帧 ↔ 首帧」alpha 掩码 IoU，≥0.35，低于 fail。
 * - loopSeamDiff：循环组末帧与首帧在前景并集上的平均 RGB 差，≤24 warn。
 * - centroidJitter / centroidJitterMedian：相邻帧（含循环首尾）alpha 质心位移的
 *   最大值 / 中位数（px），只记录（info）。
 *
 * 交替指标（左右脚交替 Δ）依赖 src/cycle.ts 的脚位/步幅读数（自动选帧分支），
 * 本分支不 import 它（跨分支编译依赖）；报告里不出现该指标，另见 docs。
 *
 * ## 降采样
 *
 * 长边 > 512 时先按整数系数做盒式平均降采样（alpha 预乘，避免透明像素的 RGB
 * 污染边缘），系数 = ceil(长边 / 512)。报告里的 sampled 就是这个系数（1 = 未降采样）。
 *
 * ## 阈值覆盖
 *
 * 默认值在 DEFAULT_QA_THRESHOLDS；配置项 qaThresholds 逐键覆盖（只认已知键，
 * 非法值丢弃并夹到安全区间）。报告里的 thresholds 是本次实际生效的整份阈值。
 */
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { writeJsonAtomic } from "./jsonio.js";
/** 降采样阈值：长边超过它就先降。 */
export const QA_MAX_EDGE = 512;
/** alpha 判定阈值：小于它视为透明。 */
export const QA_ALPHA_MIN = 8;
/** 默认阈值（键名与报告里的 thresholds 一致）。 */
export const DEFAULT_QA_THRESHOLDS = {
    transparentRatioMin: 0.05,
    transparentRatioMax: 0.95,
    fringeRatioMax: 0.15,
    bboxCvMax: 5,
    heightCvMax: 1,
    headWidthCvMax: 2,
    loopSeamIouMin: 0.35,
    loopSeamDiffMax: 24
};
/** 已知阈值键的安全区间（防止配置写进离谱值把判定搞坏）。 */
const THRESHOLD_LIMITS = {
    transparentRatioMin: [0, 1],
    transparentRatioMax: [0, 1],
    fringeRatioMax: [0, 1],
    bboxCvMax: [0, 100],
    heightCvMax: [0, 100],
    headWidthCvMax: [0, 100],
    loopSeamIouMin: [0, 1],
    loopSeamDiffMax: [0, 255]
};
/** 把配置里的阈值覆盖收敛成一份完整、安全的阈值表。 */
export function normalizeQaThresholds(input) {
    const out = { ...DEFAULT_QA_THRESHOLDS };
    if (input === null || typeof input !== "object")
        return out;
    const raw = input;
    for (const key of Object.keys(DEFAULT_QA_THRESHOLDS)) {
        const limits = THRESHOLD_LIMITS[key];
        const value = typeof raw[key] === "number" ? raw[key] : Number.parseFloat(String(raw[key] ?? ""));
        if (!Number.isFinite(value))
            continue;
        out[key] = Math.min(limits[1], Math.max(limits[0], value));
    }
    // 透明比例的上下界写反时自动让路（下限必须 < 上限）。
    if (out.transparentRatioMin >= out.transparentRatioMax) {
        out.transparentRatioMin = DEFAULT_QA_THRESHOLDS.transparentRatioMin;
        out.transparentRatioMax = DEFAULT_QA_THRESHOLDS.transparentRatioMax;
    }
    return out;
}
/** 计算长边降采样系数（1 = 不降）。 */
export function qaDownscaleFactor(width, height, maxEdge = QA_MAX_EDGE) {
    const longEdge = Math.max(width, height);
    if (!Number.isFinite(longEdge) || longEdge <= maxEdge)
        return 1;
    return Math.max(1, Math.ceil(longEdge / maxEdge));
}
/**
 * 盒式平均降采样（alpha 预乘）。
 *
 * 只支持整数系数：输出尺寸 = floor(宽/系数) × floor(高/系数)（至少 1×1）。
 */
export function downsampleRgba(rgba, width, height, factor) {
    const f = Math.max(1, Math.round(factor));
    if (f <= 1)
        return { rgba, width, height };
    const outWidth = Math.max(1, Math.floor(width / f));
    const outHeight = Math.max(1, Math.floor(height / f));
    const out = Buffer.alloc(outWidth * outHeight * 4);
    for (let oy = 0; oy < outHeight; oy++) {
        for (let ox = 0; ox < outWidth; ox++) {
            let sumR = 0;
            let sumG = 0;
            let sumB = 0;
            let sumA = 0;
            let count = 0;
            for (let y = oy * f; y < oy * f + f && y < height; y++) {
                let index = (y * width + ox * f) * 4;
                for (let x = ox * f; x < ox * f + f && x < width; x++, index += 4) {
                    const a = rgba[index + 3];
                    sumR += rgba[index] * a;
                    sumG += rgba[index + 1] * a;
                    sumB += rgba[index + 2] * a;
                    sumA += a;
                    count++;
                }
            }
            const dest = (oy * outWidth + ox) * 4;
            if (count === 0 || sumA === 0) {
                out[dest] = 0;
                out[dest + 1] = 0;
                out[dest + 2] = 0;
                out[dest + 3] = 0;
                continue;
            }
            out[dest] = Math.round(sumR / sumA);
            out[dest + 1] = Math.round(sumG / sumA);
            out[dest + 2] = Math.round(sumB / sumA);
            out[dest + 3] = Math.round(sumA / count);
        }
    }
    return { rgba: out, width: outWidth, height: outHeight };
}
/** 单帧统计：透明比例 / 彩边比例 / 包围盒 / 头宽 / 质心。 */
function frameStats(rgba, width, height) {
    const total = width * height;
    let transparent = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    let sumX = 0;
    let sumY = 0;
    let fg = 0;
    const mask = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
        const a = rgba[i * 4 + 3];
        if (a < QA_ALPHA_MIN) {
            transparent++;
            continue;
        }
        mask[i] = 1;
        fg++;
        const x = i % width;
        const y = Math.floor(i / width);
        sumX += x;
        sumY += y;
        if (x < minX)
            minX = x;
        if (x > maxX)
            maxX = x;
        if (y < minY)
            minY = y;
        if (y > maxY)
            maxY = y;
    }
    const transparentRatio = total === 0 ? 0 : transparent / total;
    if (fg === 0) {
        return { empty: true, width: 0, height: 0, headWidth: 0, transparentRatio: 1, fringeRatio: 0, centroidX: 0, centroidY: 0 };
    }
    const bboxWidth = maxX - minX + 1;
    const bboxHeight = maxY - minY + 1;
    const headRows = Math.max(1, Math.round(bboxHeight * 0.15));
    let headWidth = 0;
    for (let y = minY; y < minY + headRows && y <= maxY; y++) {
        let rowMin = width;
        let rowMax = -1;
        for (let x = minX; x <= maxX; x++) {
            if (mask[y * width + x] === 0)
                continue;
            if (x < rowMin)
                rowMin = x;
            if (x > rowMax)
                rowMax = x;
        }
        if (rowMax >= rowMin)
            headWidth = Math.max(headWidth, rowMax - rowMin + 1);
    }
    // 彩边：alpha 边缘像素里「绿色优势 > 40」的占比。
    let edgeCount = 0;
    let greenCount = 0;
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const i = y * width + x;
            const a = rgba[i * 4 + 3];
            if (a < QA_ALPHA_MIN)
                continue;
            let isEdge = a <= 247;
            if (!isEdge) {
                isEdge =
                    (x > 0 && mask[i - 1] === 0) ||
                        (x + 1 < width && mask[i + 1] === 0) ||
                        (y > 0 && mask[i - width] === 0) ||
                        (y + 1 < height && mask[i + width] === 0);
            }
            if (!isEdge)
                continue;
            edgeCount++;
            const r = rgba[i * 4];
            const g = rgba[i * 4 + 1];
            const b = rgba[i * 4 + 2];
            if (g - Math.max(r, b) > 40)
                greenCount++;
        }
    }
    return {
        empty: false,
        width: bboxWidth,
        height: bboxHeight,
        headWidth,
        transparentRatio,
        fringeRatio: edgeCount === 0 ? 0 : greenCount / edgeCount,
        centroidX: sumX / fg,
        centroidY: sumY / fg
    };
}
function roundTo(value, digits) {
    const scale = Math.pow(10, digits);
    return Math.round(value * scale) / scale;
}
/** 变异系数（%，总体标准差 / 均值）。空数组返回 0。 */
function cvPercent(values) {
    const valid = values.filter((value) => Number.isFinite(value));
    if (valid.length === 0)
        return 0;
    const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length;
    if (mean === 0)
        return 0;
    const variance = valid.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / valid.length;
    return (Math.sqrt(variance) / mean) * 100;
}
function median(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
/** 计算一份 QA 报告（所有指标都在 RGBA 上现算）。 */
export function qaFrames(frames, options) {
    const startedAt = options.now ?? Date.now();
    const thresholds = normalizeQaThresholds(options.thresholds);
    const consistency = options.consistency !== false && options.scope !== "image";
    const frameCount = frames.length;
    // 1) 降采样 + 逐帧统计。
    let sampled = 1;
    const stats = [];
    for (const frame of frames) {
        const factor = qaDownscaleFactor(frame.width, frame.height);
        if (factor > sampled)
            sampled = factor;
        const down = downsampleRgba(frame.rgba, frame.width, frame.height, factor);
        stats.push(frameStats(down.rgba, down.width, down.height));
    }
    const nonEmpty = stats.filter((entry) => !entry.empty);
    const metrics = [];
    const issues = [];
    /** 记录一项指标；warn / fail 时同时生成 issue。 */
    const push = (metric, message) => {
        metrics.push(metric);
        if ((metric.verdict === "warn" || metric.verdict === "fail") && message !== undefined) {
            issues.push({ code: metric.key, message, level: metric.verdict });
        }
    };
    // 2) 透明比例：平均 + 逐帧极值。
    if (frameCount > 0) {
        const ratios = stats.map((entry) => entry.transparentRatio);
        const mean = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
        const low = Math.min(...ratios);
        const high = Math.max(...ratios);
        const min = thresholds.transparentRatioMin;
        const max = thresholds.transparentRatioMax;
        const bad = mean < min || mean > max || low < min || high > max;
        push({
            key: "transparentRatio",
            label: "透明像素占比",
            value: roundTo(mean, 4),
            threshold: min,
            thresholdMax: max,
            comparison: "min",
            verdict: bad ? "warn" : "pass"
        }, bad
            ? "透明像素占比 " + (mean * 100).toFixed(1) + "%（逐帧 " + (low * 100).toFixed(1) + "%~" + (high * 100).toFixed(1) + "%）超出 " + (min * 100).toFixed(0) + "%~" + (max * 100).toFixed(0) + "%：可能是缺帧、没抠干净或背景没去掉"
            : undefined);
    }
    // 3) 彩边比例。
    if (frameCount > 0) {
        const mean = stats.reduce((sum, entry) => sum + entry.fringeRatio, 0) / stats.length;
        const bad = mean > thresholds.fringeRatioMax;
        push({
            key: "fringeRatio",
            label: "边缘彩边比例",
            value: roundTo(mean, 4),
            threshold: thresholds.fringeRatioMax,
            comparison: "max",
            verdict: bad ? "warn" : "pass"
        }, bad
            ? "边缘彩边比例 " + (mean * 100).toFixed(1) + "% 超过 " + (thresholds.fringeRatioMax * 100).toFixed(1) + "%：绿幕残色没去干净，建议提高「去绿溢出」或「边缘收缩」"
            : undefined);
    }
    // 4) 帧间一致性（只在有 ≥2 张有内容的帧时算）。
    if (consistency && nonEmpty.length >= 2) {
        const bboxCv = roundTo(cvPercent(nonEmpty.map((entry) => entry.width)), 2);
        push({
            key: "bboxCv",
            label: "包围盒宽度 CV",
            value: bboxCv,
            threshold: thresholds.bboxCvMax,
            comparison: "max",
            verdict: bboxCv > thresholds.bboxCvMax ? "warn" : "pass"
        }, bboxCv > thresholds.bboxCvMax ? "包围盒宽度 CV " + bboxCv + "% 超过 " + thresholds.bboxCvMax + "%：各帧角色胖瘦 / 朝向差异偏大" : undefined);
        const heightCv = roundTo(cvPercent(nonEmpty.map((entry) => entry.height)), 2);
        push({
            key: "heightCv",
            label: "身高 CV",
            value: heightCv,
            threshold: thresholds.heightCvMax,
            comparison: "max",
            verdict: heightCv > thresholds.heightCvMax ? "fail" : "pass"
        }, heightCv > thresholds.heightCvMax ? "身高 CV " + heightCv + "% 超过 " + thresholds.heightCvMax + "%：角色身高在帧间漂移，视频模型没稳住（skill 实测门禁 ≤1%）" : undefined);
        const headWidthCv = roundTo(cvPercent(nonEmpty.map((entry) => entry.headWidth)), 2);
        push({
            key: "headWidthCv",
            label: "头宽 CV",
            value: headWidthCv,
            threshold: thresholds.headWidthCvMax,
            comparison: "max",
            verdict: headWidthCv > thresholds.headWidthCvMax ? "warn" : "pass"
        }, headWidthCv > thresholds.headWidthCvMax ? "头宽 CV " + headWidthCv + "% 超过 " + thresholds.headWidthCvMax + "%：头部大小在帧间变化偏大" : undefined);
    }
    // 5) 循环缝（末帧 ↔ 首帧）。
    const loops = (options.loops ?? []).filter((group) => Array.isArray(group) && group.length >= 2);
    if (loops.length > 0) {
        const ious = [];
        const diffs = [];
        for (const group of loops) {
            const firstIndex = group[0];
            const lastIndex = group[group.length - 1];
            const first = frames[firstIndex];
            const last = frames[lastIndex];
            if (first === undefined || last === undefined)
                continue;
            if (stats[firstIndex]?.empty === true || stats[lastIndex]?.empty === true)
                continue;
            const seam = seamMetrics(first, last);
            if (seam === undefined)
                continue;
            ious.push(seam.iou);
            diffs.push(seam.rgbDiff);
        }
        if (ious.length > 0) {
            const iouMean = roundTo(ious.reduce((sum, value) => sum + value, 0) / ious.length, 3);
            const bad = iouMean < thresholds.loopSeamIouMin;
            push({
                key: "loopSeamIou",
                label: "循环缝 IoU",
                value: iouMean,
                threshold: thresholds.loopSeamIouMin,
                comparison: "min",
                verdict: bad ? "fail" : "pass"
            }, bad ? "循环缝 IoU " + iouMean + " 低于 " + thresholds.loopSeamIouMin + "：首尾帧对不上，循环播放会「跳一下」" : undefined);
            const diffMean = roundTo(diffs.reduce((sum, value) => sum + value, 0) / diffs.length, 1);
            const diffBad = diffMean > thresholds.loopSeamDiffMax;
            push({
                key: "loopSeamDiff",
                label: "循环缝 RGB 差",
                value: diffMean,
                threshold: thresholds.loopSeamDiffMax,
                comparison: "max",
                verdict: diffBad ? "warn" : "pass"
            }, diffBad ? "循环缝位置平均 RGB 差 " + diffMean + " 超过 " + thresholds.loopSeamDiffMax + "：首尾帧颜色不一致（打光 / 色偏漂移）" : undefined);
        }
    }
    // 6) 质心抖动（只记录）：相邻帧（含循环首尾）质心位移。
    if (consistency && stats.length >= 2) {
        const distances = [];
        const pushPair = (from, to) => {
            if (from.empty || to.empty)
                return;
            distances.push(Math.hypot(to.centroidX - from.centroidX, to.centroidY - from.centroidY));
        };
        if (loops.length > 0) {
            for (const group of loops) {
                for (let i = 0; i + 1 < group.length; i++)
                    pushPair(stats[group[i]], stats[group[i + 1]]);
                // 循环是闭合的：末帧 → 首帧也算一次相邻位移。
                if (group.length >= 2)
                    pushPair(stats[group[group.length - 1]], stats[group[0]]);
            }
        }
        else {
            for (let i = 0; i + 1 < stats.length; i++)
                pushPair(stats[i], stats[i + 1]);
        }
        if (distances.length > 0) {
            metrics.push({
                key: "centroidJitter",
                label: "相邻帧质心位移最大值",
                value: roundTo(Math.max(...distances), 2),
                verdict: "info"
            });
            metrics.push({
                key: "centroidJitterMedian",
                label: "相邻帧质心位移中位数",
                value: roundTo(median(distances), 2),
                verdict: "info"
            });
        }
    }
    const verdict = metrics.some((metric) => metric.verdict === "fail")
        ? "fail"
        : metrics.some((metric) => metric.verdict === "warn")
            ? "warn"
            : "pass";
    return {
        version: 1,
        scope: options.scope,
        frameCount,
        sampled,
        metrics,
        issues,
        verdict,
        thresholds,
        generatedAt: Date.now(),
        elapsedMs: Math.max(0, Date.now() - startedAt)
    };
}
/** 两张帧的循环缝：alpha 掩码 IoU + 前景并集上的平均 RGB 差。 */
function seamMetrics(a, b) {
    if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0)
        return undefined;
    const scaleA = Math.max(1, Math.ceil(Math.max(a.width, a.height) / QA_MAX_EDGE));
    const scaleB = Math.max(1, Math.ceil(Math.max(b.width, b.height) / QA_MAX_EDGE));
    const scale = Math.max(scaleA, scaleB);
    const first = downsampleRgba(a.rgba, a.width, a.height, scale);
    const second = downsampleRgba(b.rgba, b.width, b.height, scale);
    const w = Math.min(first.width, second.width);
    const h = Math.min(first.height, second.height);
    if (w <= 0 || h <= 0)
        return undefined;
    let intersection = 0;
    let union = 0;
    let diffSum = 0;
    let diffCount = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i2 = (y * first.width + x) * 4;
            const i3 = (y * second.width + x) * 4;
            const fgA = first.rgba[i2 + 3] >= QA_ALPHA_MIN;
            const fgB = second.rgba[i3 + 3] >= QA_ALPHA_MIN;
            if (fgA && fgB)
                intersection++;
            if (fgA || fgB) {
                union++;
                diffSum +=
                    Math.abs(first.rgba[i2] - second.rgba[i3]) +
                        Math.abs(first.rgba[i2 + 1] - second.rgba[i3 + 1]) +
                        Math.abs(first.rgba[i2 + 2] - second.rgba[i3 + 2]);
                diffCount++;
            }
        }
    }
    if (union === 0)
        return { iou: 0, rgbDiff: 0 };
    return { iou: intersection / union, rgbDiff: diffCount === 0 ? 0 : diffSum / diffCount / 3 };
}
/**
 * 把一张合成好的整图 / 条图按格子切成帧（行优先）。
 *
 * 八方向整图：行 = 方向、列 = 帧；序列帧条图：1 行 × N 帧。
 */
export function qaCellFrames(input) {
    const { rgba, sheetWidth, columns, rows, cellWidth, cellHeight } = input;
    const frames = [];
    if (columns <= 0 || rows <= 0 || cellWidth <= 0 || cellHeight <= 0)
        return frames;
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
            const cell = Buffer.alloc(cellWidth * cellHeight * 4);
            for (let y = 0; y < cellHeight; y++) {
                const srcStart = ((row * cellHeight + y) * sheetWidth + col * cellWidth) * 4;
                const srcEnd = srcStart + cellWidth * 4;
                if (srcEnd > rgba.length)
                    break;
                rgba.copy(cell, y * cellWidth * 4, srcStart, srcEnd);
            }
            frames.push({ rgba: cell, width: cellWidth, height: cellHeight, label: row + ":" + col });
        }
    }
    return frames;
}
/** 合成整图 / 条图的循环组：每行一组。 */
export function qaLoopGroups(rows, columns) {
    if (rows <= 0 || columns < 2)
        return [];
    const groups = [];
    for (let row = 0; row < rows; row++) {
        const group = [];
        for (let col = 0; col < columns; col++)
            group.push(row * columns + col);
        groups.push(group);
    }
    return groups;
}
/** 直接对「合成好的整图 / 条图」出报告。 */
export function qaComposedSheet(input) {
    const frames = qaCellFrames({
        rgba: input.rgba,
        sheetWidth: input.width,
        columns: input.columns,
        rows: input.rows,
        cellWidth: input.cellWidth,
        cellHeight: input.cellHeight
    });
    return qaFrames(frames, {
        scope: input.scope,
        thresholds: input.thresholds,
        loops: qaLoopGroups(input.rows, input.columns)
    });
}
/** 摘要（回包 / 界面用）。 */
export function summarizeQA(report, options = {}) {
    if (report === undefined || report.version !== 1)
        return undefined;
    const warnCount = report.metrics.filter((metric) => metric.verdict === "warn").length;
    const failCount = report.metrics.filter((metric) => metric.verdict === "fail").length;
    const failClosed = options.failClosed === true;
    return {
        verdict: report.verdict,
        scope: report.scope,
        issues: report.issues.slice(0, options.limit ?? 5),
        warnCount,
        failCount,
        frameCount: report.frameCount,
        sampled: report.sampled,
        generatedAt: report.generatedAt,
        failClosed,
        blocked: failClosed && report.verdict === "fail",
        reportPath: "qa/report.json"
    };
}
/**
 * fail-closed 闸门：只有「用户显式开启 + 报告 fail」才返回阻断原因，否则返回 null。
 *
 * 默认（qaFailClosed: false）永远不阻断 —— QA 只提示，符合设计 §15 裁决。
 */
export function qaBlockReason(report, options) {
    if (options.qaEnabled === false || options.qaFailClosed !== true)
        return null;
    if (report === undefined || report.version !== 1 || report.verdict !== "fail")
        return null;
    const fails = report.issues.filter((issue) => issue.level === "fail").map((issue) => issue.message);
    const reasons = fails.length === 0 ? report.metrics.filter((metric) => metric.verdict === "fail").map((metric) => metric.label) : fails;
    return "产物 QA 未通过（" + reasons.join("；") + "）。已开启「QA 不通过就阻断」，请先修复产物，或在「设置 → 墨盒 → 产物体检」里关闭该开关。";
}
/** 报告的一句话结论（宿主日志 / 工具文本用）。 */
export function qaVerdictText(report) {
    if (report === undefined)
        return "未体检";
    const warnCount = report.metrics.filter((metric) => metric.verdict === "warn").length;
    const failCount = report.metrics.filter((metric) => metric.verdict === "fail").length;
    if (report.verdict === "fail")
        return failCount + " 项失败" + (warnCount > 0 ? "、" + warnCount + " 项警告" : "");
    if (report.verdict === "warn")
        return warnCount + " 项警告";
    return "通过";
}
/** 报告目录（目标目录下的 qa/）。 */
export function qaDirOf(targetDir) {
    return join(targetDir, "qa");
}
/** 报告相对路径（写进摘要 / 下载链接）。 */
export const QA_REPORT_RELATIVE = "qa/report.json";
/** 把报告写到 <targetDir>/qa/report.json。 */
export async function writeQAReportFile(targetDir, report) {
    const dir = qaDirOf(targetDir);
    await mkdir(dir, { recursive: true });
    const file = join(dir, "report.json");
    await writeJsonAtomic(file, report);
    return file;
}
/** 读回 <targetDir>/qa/report.json（读不到或版本不对返回 undefined）。 */
export async function readQAReportFile(targetDir) {
    try {
        const text = await readFile(join(qaDirOf(targetDir), "report.json"), "utf8");
        const parsed = JSON.parse(text);
        if (parsed === null || typeof parsed !== "object" || parsed.version !== 1)
            return undefined;
        return parsed;
    }
    catch {
        return undefined;
    }
}
// ── 极简 PNG 解码（只认本插件自己写出的 RGBA8）───────────────────────────
//
// 为什么需要它：runQA 要「按已落盘的产物复算一遍」，而仓库里只有 PNG 编码器
// （src/png.ts，解码一律交给 ffmpeg）。再 spawn 一次 ffmpeg 只为了读一张我们自己
// 写出来的无损 PNG 是浪费；这里用 node:zlib 的 inflate 解出 IHDR / IDAT 即可。
// 拒绝所有「不是我们产出形态」的 PNG（隔行 / 非 8bit / 调色板），交给调用方报错，
// 避免拿半成品数据算出一份看起来正常的报告。
/**
 * 解码 RGBA8 PNG（非隔行）。
 *
 * 支持 color type 6（RGBA）与 2（RGB，补 alpha = 255），位深 8，非隔行；
 * 其余形态返回 undefined（本插件产出的都是 RGBA8）。
 */
export function decodePngRgba(bytes) {
    if (bytes.length < 8)
        return undefined;
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < signature.length; i++) {
        if (bytes[i] !== signature[i])
            return undefined;
    }
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idat = [];
    while (offset + 8 <= bytes.length) {
        const length = bytes.readUInt32BE(offset);
        const type = bytes.toString("ascii", offset + 4, offset + 8);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd + 4 > bytes.length)
            return undefined;
        if (type === "IHDR") {
            if (length < 13)
                return undefined;
            width = bytes.readUInt32BE(dataStart);
            height = bytes.readUInt32BE(dataStart + 4);
            bitDepth = bytes[dataStart + 8];
            colorType = bytes[dataStart + 9];
            interlace = bytes[dataStart + 12];
        }
        else if (type === "IDAT") {
            idat.push(bytes.subarray(dataStart, dataEnd));
        }
        else if (type === "IEND") {
            break;
        }
        offset = dataEnd + 4; // 跳过 CRC
    }
    if (width <= 0 || height <= 0 || bitDepth !== 8 || interlace !== 0)
        return undefined;
    if (colorType !== 6 && colorType !== 2)
        return undefined;
    const channels = colorType === 6 ? 4 : 3;
    if (idat.length === 0)
        return undefined;
    let raw;
    try {
        raw = inflateSync(Buffer.concat(idat));
    }
    catch {
        return undefined;
    }
    const stride = width * channels;
    if (raw.length < (stride + 1) * height)
        return undefined;
    const out = Buffer.alloc(width * height * 4);
    const prev = Buffer.alloc(stride);
    const line = Buffer.alloc(stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        raw.copy(line, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? line[x - channels] : 0;
            const b = prev[x];
            const c = x >= channels ? prev[x - channels] : 0;
            let value = line[x];
            if (filter === 1)
                value = (value + a) & 0xff;
            else if (filter === 2)
                value = (value + b) & 0xff;
            else if (filter === 3)
                value = (value + Math.floor((a + b) / 2)) & 0xff;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
                value = (value + predictor) & 0xff;
            }
            else if (filter !== 0)
                return undefined;
            line[x] = value;
        }
        for (let x = 0; x < width; x++) {
            out[(y * width + x) * 4] = line[x * channels];
            out[(y * width + x) * 4 + 1] = line[x * channels + 1];
            out[(y * width + x) * 4 + 2] = line[x * channels + 2];
            out[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3] : 255;
        }
        line.copy(prev);
    }
    return { rgba: out, width, height };
}
