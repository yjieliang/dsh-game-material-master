/**
 * 自动选帧：步态 / 周期分析 + 均匀取帧（纯 TypeScript，零依赖）。
 *
 * 输入是同一方向的一串 RGBA 帧（抠像后的 alpha，或整图帧）；输出是一个完整走路
 * 周期里的 N 个建议帧（下标）与置信度。硬条件不满足时显式回退等分并给出原因，
 * 绝不静默降级。
 *
 * ## 算法（参考本机 skill，未搬运代码文本）
 *
 * - 参考实现：G:/image/.agents/skills/minimax-h3-walk-cycle/scripts/make_cycle.py
 *   （select_cycle / period_from_stride / half_witness / octave_fold_plan）与同目录
 *   SKILL.md 的验收口径；G:/image/sprite-gen（Apache-2.0）只参考思路。
 *   逐条阈值与来源见 docs/自动选帧-算法与阈值.md。
 * - 步骤：
 *   1. 逐帧 alpha 轮廓：bbox / 身高 / 头宽（顶部 15% 行带、逐行连续段的中位数）/
 *      脚位（底部 6% 行段列聚类，取两簇中心 x）；stride = |xL - xR|。
 *   2. 周期：stride 序列去均值归一后的自相关 r(tau)，tau 属于 [8, min(N-8, 64)]；
 *      tau 峰先按「重叠对 N-tau >= 15」筛，再取近峰集（r >= 0.9 * max r）；
 *      在近峰集里用相位 IoU（leg_iou(c0, c0+tau)，腿部 ROI = 下 1/2）印证 tie-break。
 *   3. 锚点 c0 必须是 stride 局部极大、幅度 >= 0.5 * max，且 c0 + tau <= N-1；
 *      再叠相位自证 leg_iou(c0, c0+tau) >= 0.7 与半周期自证
 *      leg_iou(c0, c0+tau) - leg_iou(c0, c0+round(tau/2)) >= 0.20（防把两倍周期当周期）。
 *   4. 八度折半：某近峰 tau 在所有可用探针锚点上都过不了半周期自证、而 tau/2 在
 *      自相关上可信（r >= 0.5 且重叠对够）且能自证时，把 tau 判为倍频、以 tau/2 重估。
 *   5. 多个合格锚点时按「窗口闭合质量」择优：picks 的缝 IoU 减内部相邻步进均值
 *      （drop 越大越好，与参考实现 §3.7 同口径，只是 ROI 直接取源帧 alpha）。
 *   6. picks 在 [c0, c0+round(tau)) 上均匀取 count 帧（round 用与 Python 一致的
 *      四舍六入五成双，保证与参考实现逐帧一致）。
 *   7. 置信度 = 周期相关性 x 相位一致性 x 交替自证（三项都夹到 0~1）。
 * - 性能：只在长边 <= 768 的 alpha 上算；超过 768 先盒式降采样；超过
 *   maxAnalysisFrames（默认 128）时按步长抽稀，结果再换算回输入下标。
 */
// ── 阈值常量（与参考实现同口径；改动必须同步 docs/自动选帧-算法与阈值.md）──────
export const CYCLE_DEFAULTS = {
    /** 前景判定：alpha > 16（与 make_cycle.py 的 a > 16 一致）。 */
    alphaThreshold: 16,
    /** 头宽行带：bbox 顶部 15% 行。 */
    headBandFrac: 0.15,
    /** 脚位行带：bbox 底部 6% 行。 */
    footBandFrac: 0.06,
    /** 脚位行带里列方向的断开阈值（px）：间隔 > 12 视为两只脚。 */
    footRunGap: 12,
    /** 一段脚只算一个脚趾簇的最小宽度（px）：e - s > 8。 */
    minFootRun: 8,
    /** 自相关 tau 下界（帧）。 */
    minPeriod: 8,
    /** 自相关 tau 上界（帧）；实际取 min(N-8, 64)，不用 N/2。 */
    maxPeriod: 64,
    /** 近峰候选阈值：r(tau) >= 0.9 * max r。 */
    nearPeakRel: 0.9,
    /** 周期置信度下限（qa.min_period_corr 初值）。 */
    minConfidence: 0.5,
    /** 相位自证门槛：c0 处 leg_iou(c0, c0+T) >= 0.7。 */
    minPhaseIou: 0.7,
    /** 半周期自证余量（qa.min_alternation_delta_phase 初值）。 */
    minAlternationDelta: 0.2,
    /** 自相关的重叠对下限：N - tau >= 15，少于它的 tau 峰不可信。 */
    minPeriodPairs: 15,
    /** c0 候选的 stride 幅度护栏：stride >= 0.5 * max。 */
    candidateStrideRel: 0.5,
    /** 八度折半的探针锚点幅度护栏：>= 0.5 * max。 */
    octaveProbeRel: 0.5,
    /** 分析分辨率长边上限（px）；超过先盒式降采样。 */
    maxAnalysisEdge: 768,
    /** 最多分析多少帧；超过按步长抽稀。 */
    maxAnalysisFrames: 128,
};
/** 回退原因码 -> 中文说明（宿主日志 / 工具回包用；界面另有 T() 词条）。 */
export const CYCLE_REASON_TEXT = {
    too_few_frames: "候选帧太少（少于 4 帧），无法分析步态",
    empty_frames: "多数候选帧里没有角色（alpha 为空），无法分析步态",
    no_stride_signal: "帧里左右脚几乎没有分开过（原地站立 / 滑步 / 单人剪影），找不到步幅信号",
    no_period: "自相关没有可用周期（帧数不足或步幅没有重复）",
    low_period_confidence: "周期相关性太低（< 0.5），不认为存在可信周期",
    insufficient_period_pairs: "重叠采样对不足（少于 15 对），周期不可信",
    no_full_period: "候选锚点后面放不下一个完整周期（视频太短 / 周期太长）",
    phase_iou_below_min: "相位自证不过（循环首尾姿态差得太多，不是闭合循环）",
    half_period_not_witnessed: "半周期没有换相位（可能是两倍周期 / 素材本来没有左右交替）",
    period_ambiguous: "周期不明确（疑似两倍周期，折半后也无法自证）",
    no_valid_cycle: "没有找到合格的循环窗口",
};
function opt(value, fallback) {
    return value === undefined || value === null ? fallback : value;
}
function clamp01(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.max(0, Math.min(1, value));
}
function medianOf(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
/**
 * Python round() 的等价实现：四舍六入五成双（ties-to-even）。
 *
 * 参考实现用 int(round(...)) 生成 picks；用 Math.round 会在 .5 这类边界上系统性 +1，
 * 真机对比时表现为「个别帧固定差 1」。这里逐字对齐。
 */
export function roundHalfEven(value) {
    if (!Number.isFinite(value))
        return 0;
    const floor = Math.floor(value);
    const diff = value - floor;
    if (diff > 0.5)
        return floor + 1;
    if (diff < 0.5)
        return floor;
    return floor % 2 === 0 ? floor : floor + 1;
}
/**
 * 等分 picks（回退口径，与 src/pipeline.ts 里手动选帧的「格心」公式逐字一致）：
 * round(((i + 0.5) * total) / count - 0.5)。
 *
 * 为什么用格心而不是 round(i * total / count)：旧行为（用户点「重置为等分」看到的
 * 圆圈位置）就是格心，回退必须与它一模一样，否则「自动失败」时界面会莫名其妙跳一格。
 */
export function evenPicks(total, count) {
    const n = Math.max(1, Math.round(total));
    const c = Math.max(1, Math.round(count));
    const picks = [];
    for (let i = 0; i < c; i++) {
        picks.push(Math.min(n - 1, Math.max(0, Math.round(((i + 0.5) * n) / c - 0.5))));
    }
    return picks;
}
/** 把一帧 RGBA 的 alpha 通道按长边上限做盒式降采样（只保留 alpha）。 */
export function alphaFromSample(sample, maxEdge = CYCLE_DEFAULTS.maxAnalysisEdge) {
    const srcW = Math.max(1, Math.floor(sample.width));
    const srcH = Math.max(1, Math.floor(sample.height));
    const longEdge = Math.max(srcW, srcH);
    if (sample.alpha !== undefined && sample.alpha !== null && sample.alpha.length >= srcW * srcH) {
        const raw = { width: srcW, height: srcH, alpha: sample.alpha };
        return longEdge <= maxEdge ? raw : downscaleAlphaFrame(raw, maxEdge);
    }
    const rgba = sample.rgba ?? Buffer.alloc(0);
    if (longEdge <= maxEdge) {
        const alpha = new Uint8Array(srcW * srcH);
        for (let i = 0; i < alpha.length; i++)
            alpha[i] = rgba[i * 4 + 3] ?? 0;
        return { width: srcW, height: srcH, alpha };
    }
    const source = { width: srcW, height: srcH, alpha: new Uint8Array(srcW * srcH) };
    for (let i = 0; i < source.alpha.length; i++)
        source.alpha[i] = rgba[i * 4 + 3] ?? 0;
    return downscaleAlphaFrame(source, maxEdge);
}
/** 把 alpha 帧按长边上限盒式降采样（区域平均；与参考实现的 LANCZOS 目的相同、实现更轻）。 */
export function downscaleAlphaFrame(frame, maxEdge = CYCLE_DEFAULTS.maxAnalysisEdge) {
    const srcW = Math.max(1, Math.floor(frame.width));
    const srcH = Math.max(1, Math.floor(frame.height));
    const longEdge = Math.max(srcW, srcH);
    if (longEdge <= maxEdge)
        return { width: srcW, height: srcH, alpha: frame.alpha };
    const scale = maxEdge / longEdge;
    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));
    const sum = new Uint32Array(dstW * dstH);
    const cnt = new Uint16Array(dstW * dstH);
    for (let sy = 0; sy < srcH; sy++) {
        const dy = Math.min(dstH - 1, Math.floor((sy * dstH) / srcH));
        const rowBase = dy * dstW;
        const srcRow = sy * srcW;
        for (let sx = 0; sx < srcW; sx++) {
            const d = rowBase + Math.min(dstW - 1, Math.floor((sx * dstW) / srcW));
            sum[d] += frame.alpha[srcRow + sx] ?? 0;
            cnt[d] += 1;
        }
    }
    const alpha = new Uint8Array(dstW * dstH);
    for (let i = 0; i < alpha.length; i++)
        alpha[i] = cnt[i] === 0 ? 0 : Math.round(sum[i] / cnt[i]);
    return { width: dstW, height: dstH, alpha };
}
/** 一行的连续段（间隔 > gap 视为断开；与参考实现 runs_of 同口径）。 */
function runsOf(maskRow, width, gap) {
    const out = [];
    let start = -1;
    let prev = -1;
    for (let x = 0; x < width; x++) {
        if (!maskRow(x))
            continue;
        if (start < 0) {
            start = x;
        }
        else if (x - prev > gap) {
            out.push({ start, end: prev });
            start = x;
        }
        prev = x;
    }
    if (start >= 0)
        out.push({ start, end: prev });
    return out;
}
/** 逐帧 alpha 轮廓统计（bbox / 身高 / 头宽 / 脚位 / 步幅）。 */
export function analyzeAlphaFrame(frame, index, options = {}) {
    const threshold = opt(options.alphaThreshold, CYCLE_DEFAULTS.alphaThreshold);
    const headBandFrac = opt(options.headBandFrac, CYCLE_DEFAULTS.headBandFrac);
    const footBandFrac = opt(options.footBandFrac, CYCLE_DEFAULTS.footBandFrac);
    const footRunGap = opt(options.footRunGap, CYCLE_DEFAULTS.footRunGap);
    const minFootRun = opt(options.minFootRun, CYCLE_DEFAULTS.minFootRun);
    const width = frame.width;
    const height = frame.height;
    const alpha = frame.alpha;
    let left = width;
    let right = -1;
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
        const rowBase = y * width;
        for (let x = 0; x < width; x++) {
            if (alpha[rowBase + x] <= threshold)
                continue;
            if (top < 0)
                top = y;
            bottom = y;
            if (x < left)
                left = x;
            if (x > right)
                right = x;
        }
    }
    if (top < 0) {
        return { index, empty: true, bbox: null, height: 0, headWidth: 0, feet: [], stride: 0 };
    }
    const boxHeight = bottom - top + 1;
    // 头宽：顶部 15% 行带，逐行取「包含行带前景中位 x 的连续段」，
    // 宽度 = 段内 alpha 覆盖和，再取中位数（抗单行抗锯齿尖峰）。
    const headRows = top + Math.max(1, Math.round(boxHeight * headBandFrac));
    const bandXs = [];
    for (let y = top; y < Math.min(height, headRows); y++) {
        const rowBase = y * width;
        for (let x = 0; x < width; x++) {
            if (alpha[rowBase + x] > threshold)
                bandXs.push(x);
        }
    }
    const centerX = bandXs.length > 0 ? medianOf(bandXs) : width / 2;
    const widths = [];
    const runGap = 3;
    for (let y = top; y < Math.min(height, headRows); y++) {
        const rowBase = y * width;
        const runs = runsOf((x) => alpha[rowBase + x] > threshold, width, runGap);
        if (runs.length === 0)
            continue;
        let best = runs[0];
        let bestDistance = Infinity;
        for (const run of runs) {
            const distance = centerX >= run.start && centerX <= run.end ? 0 : Math.min(Math.abs(run.start - centerX), Math.abs(run.end - centerX));
            if (distance < bestDistance) {
                bestDistance = distance;
                best = run;
            }
        }
        let coverage = 0;
        for (let x = best.start; x <= best.end; x++)
            coverage += alpha[rowBase + x] / 255;
        widths.push(coverage);
    }
    const headWidth = widths.length > 0 ? Math.round(medianOf(widths) * 100) / 100 : 0;
    // 脚位：bbox 底部 6% 行带，列方向「有前景」求连续段（间隔 > 12 断开），
    // 中心取段的 (start+end)/2；段宽必须 > 8px 才算一只脚。
    const footTop = bottom - Math.floor(boxHeight * footBandFrac);
    const columnHas = new Uint8Array(width);
    for (let y = Math.max(0, footTop); y <= bottom; y++) {
        const rowBase = y * width;
        for (let x = 0; x < width; x++) {
            if (alpha[rowBase + x] > threshold)
                columnHas[x] = 1;
        }
    }
    const feet = [];
    {
        let start = -1;
        let prev = -1;
        const push = () => {
            if (start < 0)
                return;
            if (prev - start > minFootRun)
                feet.push(Math.round((start + prev) / 2));
            start = -1;
        };
        for (let x = 0; x < width; x++) {
            if (columnHas[x] === 0)
                continue;
            if (start < 0)
                start = x;
            else if (x - prev > footRunGap) {
                push();
                start = x;
            }
            prev = x;
        }
        push();
    }
    const stride = feet.length >= 2 ? Math.max(...feet) - Math.min(...feet) : 0;
    return { index, empty: false, bbox: { left, top, right, bottom }, height: boxHeight, headWidth, feet, stride };
}
/** 把这个方向的帧序列转成 alpha 帧 + 轮廓统计（大图先降采样到长边 <= 768）。 */
export function analyzeFrames(samples, options = {}) {
    const maxEdge = opt(options.maxAnalysisEdge, CYCLE_DEFAULTS.maxAnalysisEdge);
    const frames = [];
    const stats = [];
    let emptyFrames = 0;
    for (const sample of samples) {
        const frame = alphaFromSample(sample, maxEdge);
        const stat = analyzeAlphaFrame(frame, sample.index, options);
        if (stat.empty)
            emptyFrames++;
        frames.push(frame);
        stats.push(stat);
    }
    const stride = stats.map((item) => item.stride);
    const smax = stride.reduce((max, value) => (value > max ? value : max), 0);
    const first = frames[0];
    const downscaled = first !== undefined && samples[0] !== undefined && (first.width < samples[0].width || first.height < samples[0].height);
    return { frames, stats, stride, smax, width: first?.width ?? 0, height: first?.height ?? 0, downscaled, emptyFrames };
}
/** 去均值归一后的自相关 r(tau)；tau 属于 [minLag, min(N-8, maxLag)]。 */
export function autocorrOf(strides, minLag = CYCLE_DEFAULTS.minPeriod, maxLag = CYCLE_DEFAULTS.maxPeriod) {
    const n = strides.length;
    const hi = Math.min(n - 8, maxLag);
    const lags = [];
    const rs = [];
    for (let lag = Math.max(1, Math.floor(minLag)); lag <= hi; lag++) {
        const size = n - lag;
        if (size < 3)
            continue;
        let sumA = 0;
        let sumB = 0;
        for (let i = 0; i < size; i++) {
            sumA += strides[i];
            sumB += strides[i + lag];
        }
        const meanA = sumA / size;
        const meanB = sumB / size;
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < size; i++) {
            const a = strides[i] - meanA;
            const b = strides[i + lag] - meanB;
            dot += a * b;
            normA += a * a;
            normB += b * b;
        }
        const den = Math.sqrt(normA * normB);
        lags.push(lag);
        rs.push(den > 1e-9 ? dot / den : 0);
    }
    return { lags, rs };
}
/** stride 曲线的局部极大（>= rel * max，且做平台 / 相邻双峰去重），返回时间顺序下标。 */
export function stridePeaksOf(strides, rel = CYCLE_DEFAULTS.candidateStrideRel) {
    if (strides.length < 3)
        return [];
    const smax = strides.reduce((max, value) => (value > max ? value : max), 0);
    if (!(smax > 0))
        return [];
    const out = [];
    for (let i = 1; i < strides.length - 1; i++) {
        if (strides[i] < rel * smax || strides[i] <= 0)
            continue;
        if (strides[i] >= strides[i - 1] && strides[i] >= strides[i + 1]) {
            const last = out[out.length - 1];
            if (last !== undefined && i - last <= 2) {
                if (strides[i] > strides[last])
                    out[out.length - 1] = i;
                continue;
            }
            out.push(i);
        }
    }
    return out;
}
/** 腿部 ROI 的剪影 IoU（ROI = 下 1/2 行；alpha > 阈值算前景）。 */
export function legIouOf(a, b, options = {}) {
    const threshold = opt(options.alphaThreshold, CYCLE_DEFAULTS.alphaThreshold);
    const height = Math.min(a.height, b.height);
    const width = Math.min(a.width, b.width);
    const startRow = Math.floor(height / 2);
    let intersection = 0;
    let union = 0;
    for (let y = startRow; y < height; y++) {
        const rowA = y * a.width;
        const rowB = y * b.width;
        for (let x = 0; x < width; x++) {
            const fa = a.alpha[rowA + x] > threshold;
            const fb = b.alpha[rowB + x] > threshold;
            if (fa && fb)
                intersection++;
            if (fa || fb)
                union++;
        }
    }
    return union > 0 ? intersection / union : 0;
}
/** 半周期自证：同相位 IoU 与反相位 IoU 的差 >= margin。 */
export function halfWitnessOf(frames, c0, tau, margin = CYCLE_DEFAULTS.minAlternationDelta, options = {}) {
    const out = { halfLag: 0, iouFull: null, iouHalf: null, delta: null, ok: null, reason: null };
    const rt = roundHalfEven(tau);
    const rh = roundHalfEven(tau / 2);
    if (!(rt > 0) || !(rh > 0)) {
        out.reason = "no_period";
        return out;
    }
    out.halfLag = rh;
    const jf = c0 + rt;
    const jh = c0 + rh;
    const n = frames.length;
    if (jf > n - 1) {
        out.reason = "no_full_period";
        return out;
    }
    if (jh > n - 1) {
        out.reason = "no_half_period";
        return out;
    }
    const full = legIouOf(frames[c0], frames[jf], options);
    const half = legIouOf(frames[c0], frames[jh], options);
    out.iouFull = Math.round(full * 10000) / 10000;
    out.iouHalf = Math.round(half * 10000) / 10000;
    out.delta = Math.round((full - half) * 10000) / 10000;
    out.ok = half < full - margin;
    return out;
}
/** 八度（倍频）折半计划：全局判定某个近峰 tau 是不是基频的整数倍。 */
export function octaveFoldPlan(strides, frames, probes, options = {}) {
    const minLag = opt(options.minPeriod, CYCLE_DEFAULTS.minPeriod);
    const maxLag = opt(options.maxPeriod, CYCLE_DEFAULTS.maxPeriod);
    const margin = opt(options.minAlternationDelta, CYCLE_DEFAULTS.minAlternationDelta);
    const minCorr = opt(options.minConfidence, CYCLE_DEFAULTS.minConfidence);
    const minPairs = opt(options.minPeriodPairs, CYCLE_DEFAULTS.minPeriodPairs);
    const nearRel = opt(options.nearPeakRel, CYCLE_DEFAULTS.nearPeakRel);
    const { lags, rs } = autocorrOf(strides, minLag, maxLag);
    const rmap = new Map();
    for (let i = 0; i < lags.length; i++)
        rmap.set(lags[i], rs[i]);
    const info = {
        fired: false,
        witnessed: false,
        foldedTaus: [],
        suspects: [],
        foldTaus: [],
    };
    if (lags.length === 0 || frames.length === 0)
        return info;
    const n = strides.length;
    let rmax = 0;
    for (const value of rs)
        rmax = Math.max(rmax, value);
    const near = lags.filter((lag) => (rmap.get(lag) ?? 0) >= nearRel * rmax && n - lag >= minPairs);
    if (near.length === 0)
        return info;
    const plist = probes.filter((value, position) => value >= 0 && value < n && probes.indexOf(value) === position);
    for (const tau of near) {
        const usable = plist.filter((i) => i + tau <= n - 1);
        if (usable.length === 0)
            continue;
        const witnesses = usable.map((i) => ({ i, witness: halfWitnessOf(frames, i, tau, margin, options) }));
        if (witnesses.some((item) => item.witness.ok !== false))
            continue;
        const fold = [];
        const candidates = [...new Set([Math.floor(tau / 2), Math.ceil(tau / 2)])].sort((a, b) => a - b);
        for (const candidate of candidates) {
            if (candidate < minLag || candidate >= tau)
                continue;
            if (n - candidate < minPairs || (rmap.get(candidate) ?? 0) < minCorr)
                continue;
            const witnessedAt = plist.filter((i) => i + candidate <= n - 1 && halfWitnessOf(frames, i, candidate, margin, options).ok === true);
            fold.push({ tau: candidate, from: tau, r: Math.round((rmap.get(candidate) ?? 0) * 10000) / 10000, witnessedAt });
        }
        if (fold.length === 0)
            continue;
        info.suspects.push({
            tau,
            r: Math.round((rmap.get(tau) ?? 0) * 10000) / 10000,
            failedAt: witnesses.map((item) => item.i + 1),
            usableProbes: usable.map((i) => i + 1),
            foldCandidates: fold.map((item) => item.tau),
        });
        for (const item of fold) {
            if (!info.foldTaus.some((existing) => existing.tau === item.tau)) {
                info.foldTaus.push(item);
                info.foldedTaus.push(item.tau);
            }
        }
    }
    info.fired = info.foldTaus.length > 0;
    info.witnessed = info.foldTaus.some((item) => item.witnessedAt.length > 0);
    return info;
}
/** 由 stride 自相关估计周期（含近峰候选、相位 IoU tie-break、八度折半候选）。 */
export function periodFromStride(strides, options = {}) {
    const frames = options.frames;
    const c0 = options.c0;
    const minLag = opt(options.minPeriod, CYCLE_DEFAULTS.minPeriod);
    const maxLag = opt(options.maxPeriod, CYCLE_DEFAULTS.maxPeriod);
    const minCorr = opt(options.minConfidence, CYCLE_DEFAULTS.minConfidence);
    const margin = opt(options.minAlternationDelta, CYCLE_DEFAULTS.minAlternationDelta);
    const nearRel = opt(options.nearPeakRel, CYCLE_DEFAULTS.nearPeakRel);
    const minPairs = opt(options.minPeriodPairs, CYCLE_DEFAULTS.minPeriodPairs);
    const n = strides.length;
    const { lags, rs } = autocorrOf(strides, minLag, maxLag);
    const rmap = new Map();
    for (let i = 0; i < lags.length; i++)
        rmap.set(lags[i], rs[i]);
    const out = {
        frames: null,
        framesSubframe: null,
        conf: 0,
        confRaw: 0,
        peakRawTau: null,
        nearPeakTaus: [],
        poolTaus: [],
        phaseIouAtT: null,
        halfWitness: null,
        halfWitnessOk: null,
        pairs: 0,
        pairsOk: false,
        found: false,
        octaveFold: false,
        octaveFrom: null,
        tieBreak: "argmax",
    };
    if (lags.length === 0)
        return out;
    let peakIndex = 0;
    for (let i = 1; i < rs.length; i++)
        if (rs[i] > rs[peakIndex])
            peakIndex = i;
    const rawTau = lags[peakIndex];
    const rPeak = rs[peakIndex];
    out.peakRawTau = rawTau;
    out.confRaw = Math.round(rPeak * 10000) / 10000;
    // v2 A8b：先按重叠对下限剔除不可信的长 tau，再在剩下的 lag 里取近峰候选。
    const validLags = lags.filter((lag) => n - lag >= minPairs);
    let near = [];
    if (validLags.length > 0) {
        let validMax = 0;
        for (const lag of validLags)
            validMax = Math.max(validMax, rmap.get(lag) ?? 0);
        near = validLags.filter((lag) => (rmap.get(lag) ?? 0) >= nearRel * validMax);
    }
    const nearSet = new Set(near);
    const fold = new Map();
    for (const item of options.extraTaus ?? [])
        if (item !== undefined)
            fold.set(item.tau, item.from ?? null);
    const foldOnly = [...fold.keys()].filter((tau) => !nearSet.has(tau)).sort((a, b) => a - b);
    const pool = [...new Set([...nearSet, ...fold.keys()])].sort((a, b) => a - b);
    out.nearPeakTaus = near.map((tau) => ({ tau, corr: Math.round((rmap.get(tau) ?? 0) * 10000) / 10000 }));
    out.poolTaus = pool;
    let tau = rawTau;
    let conf = rPeak;
    const iouAt = new Map();
    const halfAt = new Map();
    if (frames !== undefined && c0 !== undefined) {
        for (const candidate of pool) {
            const j = c0 + candidate;
            if (j > frames.length - 1)
                continue;
            iouAt.set(candidate, legIouOf(frames[c0], frames[j], options));
            halfAt.set(candidate, halfWitnessOf(frames, c0, candidate, margin, options));
        }
        if (iouAt.size > 0) {
            let pickPool;
            if (fold.size > 0) {
                const okPool = [...iouAt.keys()].filter((candidate) => halfAt.get(candidate)?.ok === true);
                pickPool = okPool.length > 0 ? okPool : [[...iouAt.keys()].reduce((min, value) => Math.min(min, value), Infinity)];
            }
            else {
                pickPool = [...iouAt.keys()];
            }
            let best = pickPool[0];
            for (const candidate of pickPool) {
                const better = (iouAt.get(candidate) ?? 0) > (iouAt.get(best) ?? 0);
                const tie = (iouAt.get(candidate) ?? 0) === (iouAt.get(best) ?? 0) && Math.abs(candidate - rawTau) < Math.abs(best - rawTau);
                if (better || tie)
                    best = candidate;
            }
            tau = best;
            conf = rmap.get(tau) ?? 0;
            out.tieBreak = "phase_iou";
        }
    }
    let subframe = tau;
    const tauIndex = lags.indexOf(tau);
    if (tauIndex > 0 && tauIndex < rs.length - 1) {
        const y0 = rs[tauIndex - 1];
        const y1 = rs[tauIndex];
        const y2 = rs[tauIndex + 1];
        const den = y0 - 2 * y1 + y2;
        if (Math.abs(den) > 1e-12) {
            const delta = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den));
            subframe = tau + delta;
        }
    }
    const half = halfAt.get(tau) ?? null;
    const pairs = Math.max(0, n - tau);
    out.frames = tau;
    out.framesSubframe = Math.round(subframe * 10000) / 10000;
    out.conf = Math.round(clamp01(conf) * 10000) / 10000;
    out.phaseIouAtT = iouAt.has(tau) ? Math.round(iouAt.get(tau) * 10000) / 10000 : null;
    out.halfWitness = half;
    out.halfWitnessOk = half === null ? null : half.ok;
    out.pairs = pairs;
    out.pairsOk = pairs >= minPairs;
    out.found = out.conf >= minCorr && out.pairsOk;
    out.octaveFold = foldOnly.includes(tau);
    out.octaveFrom = out.octaveFold ? fold.get(tau) ?? null : null;
    return out;
}
/** picks 的窗口闭合质量（缝 IoU vs 内部相邻步进）。 */
export function windowClosureOf(frames, picks, options = {}) {
    if (picks.length < 2)
        return null;
    const adj = [];
    for (let i = 0; i < picks.length - 1; i++)
        adj.push(legIouOf(frames[picks[i]], frames[picks[i + 1]], options));
    const seam = legIouOf(frames[picks[picks.length - 1]], frames[picks[0]], options);
    let sum = 0;
    for (const value of adj)
        sum += value;
    const mean = sum / adj.length;
    let min = Infinity;
    let max = 0;
    for (const value of adj) {
        min = Math.min(min, value);
        max = Math.max(max, value);
    }
    let std = null;
    if (adj.length >= 2) {
        let variance = 0;
        for (const value of adj)
            variance += (value - mean) * (value - mean);
        std = Math.sqrt(variance / adj.length);
    }
    const seamZ = std !== null && std > 1e-9 ? (seam - mean) / std : null;
    const opposite = picks.length >= 4 ? legIouOf(frames[picks[0]], frames[picks[Math.floor(picks.length / 2)]], options) : null;
    return { seamIou: seam, adjIou: adj, adjIouMean: mean, adjIouMin: min, adjIouMax: max, adjIouStd: std, seamZ, drop: seam - mean, oppositeIouRef: opposite };
}
/** picks 的实际相位与理想均匀相位的偏差（度）。 */
export function phaseUniformityOf(picks, c0, period) {
    if (!(period > 0) || picks.length === 0)
        return { maxDevDeg: null, meanDevDeg: null, perFrame: [] };
    const perFrame = [];
    for (let k = 0; k < picks.length; k++) {
        const actual = ((((picks[k] - c0) % period) + period) % period) / period * 360;
        const ideal = (k / picks.length) * 360;
        let dev = Math.abs(actual - ideal) % 360;
        dev = Math.min(dev, 360 - dev);
        perFrame.push(Math.round(dev * 100) / 100);
    }
    let maxDev = 0;
    let sum = 0;
    for (const value of perFrame) {
        maxDev = Math.max(maxDev, value);
        sum += value;
    }
    return { maxDevDeg: Math.round(maxDev * 100) / 100, meanDevDeg: Math.round((sum / perFrame.length) * 100) / 100, perFrame };
}
/** 从 picks 里挑出 contact（相位 0 / 0.5）与 passing（0.25 / 0.75）对应的帧。 */
export function frameEventsOf(picks, c0, period) {
    if (!(period > 0))
        return { contacts: [], passing: [] };
    const phaseOf = (frame) => ((((frame - c0) % period) + period) % period) / period;
    const circularDistance = (a, b) => {
        const d = Math.abs(a - b) % 1;
        return Math.min(d, 1 - d);
    };
    const used = new Set();
    const pickNearest = (anchor) => {
        let best = null;
        let bestDistance = Infinity;
        for (let k = 0; k < picks.length; k++) {
            if (used.has(k))
                continue;
            const distance = circularDistance(phaseOf(picks[k]), anchor);
            if (distance < bestDistance - 1e-9) {
                bestDistance = distance;
                best = k;
            }
        }
        if (best === null)
            return null;
        used.add(best);
        return picks[best];
    };
    const contacts = [];
    const passing = [];
    for (const anchor of [0, 0.5]) {
        const frame = pickNearest(anchor);
        if (frame !== null)
            contacts.push(frame);
    }
    for (const anchor of [0.25, 0.75]) {
        const frame = pickNearest(anchor);
        if (frame !== null)
            passing.push(frame);
    }
    return { contacts, passing };
}
function cvPct(values) {
    const clean = values.filter((value) => Number.isFinite(value) && value > 0);
    if (clean.length === 0)
        return null;
    let sum = 0;
    for (const value of clean)
        sum += value;
    const mean = sum / clean.length;
    if (!(mean > 0))
        return null;
    let variance = 0;
    for (const value of clean)
        variance += (value - mean) * (value - mean);
    return Math.round((Math.sqrt(variance / clean.length) / mean) * 10000) / 100;
}
/** 置信度 = 周期相关性 x 相位一致性 x 交替自证（三项各夹到 0~1）。 */
function computeConfidence(estimate, margin) {
    const period = clamp01(estimate.conf);
    const phase = clamp01(estimate.phaseIouAtT ?? 0);
    const delta = estimate.halfWitness?.delta ?? 0;
    const alternation = margin > 0 ? clamp01(delta / margin) : clamp01(delta);
    return Math.round(period * phase * alternation * 10000) / 10000;
}
function buildMetrics(frames, stats, picks, c0, tau, estimate, options) {
    const closure = windowClosureOf(frames, picks, options);
    const uniformity = phaseUniformityOf(picks, c0, tau);
    let iouSame = null;
    let iouOpp = null;
    if (tau > 0) {
        const same = c0 + roundHalfEven(tau);
        const opp = c0 + roundHalfEven(tau / 2);
        if (same <= frames.length - 1)
            iouSame = Math.round(legIouOf(frames[c0], frames[same], options) * 10000) / 10000;
        if (opp <= frames.length - 1)
            iouOpp = Math.round(legIouOf(frames[c0], frames[opp], options) * 10000) / 10000;
    }
    const pickedStats = picks.map((frame) => stats[frame]).filter((item) => item !== undefined);
    const round4 = (value) => Math.round(value * 10000) / 10000;
    return {
        seamIou: closure !== null ? round4(closure.seamIou) : null,
        adjIouMean: closure !== null ? round4(closure.adjIouMean) : null,
        adjIouMin: closure !== null ? round4(closure.adjIouMin) : null,
        adjIouStd: closure !== null && closure.adjIouStd !== null ? round4(closure.adjIouStd) : null,
        seamZ: closure !== null && closure.seamZ !== null ? Math.round(closure.seamZ * 1000) / 1000 : null,
        drop: closure !== null ? round4(closure.drop) : null,
        alternationDelta: estimate?.halfWitness?.delta ?? null,
        iouSame,
        iouOpp,
        phaseDevMaxDeg: uniformity.maxDevDeg,
        phaseDevMeanDeg: uniformity.meanDevDeg,
        heightCvPct: cvPct(pickedStats.map((item) => item.height)),
        headWidthCvPct: cvPct(pickedStats.map((item) => item.headWidth)),
    };
}
/** 从 alpha 帧 + stride 序列里选出一个完整周期（内部实现，pickCycleFrames 调它）。 */
function selectCycle(frames, stats, count, options) {
    const minCorr = opt(options.minConfidence, CYCLE_DEFAULTS.minConfidence);
    const minPhaseIou = opt(options.minPhaseIou, CYCLE_DEFAULTS.minPhaseIou);
    const margin = opt(options.minAlternationDelta, CYCLE_DEFAULTS.minAlternationDelta);
    const strideRel = opt(options.candidateStrideRel, CYCLE_DEFAULTS.candidateStrideRel);
    const probeRel = opt(options.octaveProbeRel, CYCLE_DEFAULTS.octaveProbeRel);
    const minPairs = opt(options.minPeriodPairs, CYCLE_DEFAULTS.minPeriodPairs);
    const windowSelect = opt(options.windowSelect, true);
    const n = frames.length;
    const strides = stats.map((item) => item.stride);
    const smax = strides.reduce((max, value) => (value > max ? value : max), 0);
    const emptySelection = {
        picks: [],
        confidence: 0,
        period: 0,
        contacts: [],
        passing: [],
        cycleStart: 0,
        cycleEnd: 0,
        candidates: [],
        periodDetail: null,
        octave: { fired: false, witnessed: false, foldedTaus: [], suspects: [] },
        metrics: null,
        notes: [],
    };
    // 锚点候选：首个 stride 局部极大（>= 0.9 * smax，参考实现保留的老启发式）+ 全部 >= 0.5 * smax 的局部极大。
    let defaultAnchor = 0;
    for (let i = 1; i < strides.length - 1; i++) {
        if (strides[i] >= 0.9 * smax && strides[i] >= strides[i - 1] && strides[i] >= strides[i + 1]) {
            defaultAnchor = i;
            break;
        }
    }
    const seen = [];
    for (const candidate of [defaultAnchor, ...stridePeaksOf(strides, strideRel)]) {
        if (candidate < 0 || candidate >= n)
            continue;
        if (seen.some((value) => Math.abs(value - candidate) <= 2))
            continue;
        seen.push(candidate);
    }
    seen.sort((a, b) => a - b);
    // 八度折半计划：探针锚点取 >= 0.5 * smax 的 stride 局部极大（与参考实现 PERIOD_OCTAVE_PROBE_REL 同口径）。
    const probes = stridePeaksOf(strides, probeRel);
    const fold = octaveFoldPlan(strides, frames, probes.length > 0 ? probes : seen, options);
    const foldTaus = fold.foldTaus.map((item) => ({ tau: item.tau, from: item.from }));
    const entries = [];
    const periods = new Map();
    for (const i of seen) {
        const estimate = periodFromStride(strides, { ...options, frames, c0: i, extraTaus: foldTaus });
        periods.set(i, estimate);
        const tau = estimate.frames ?? 0;
        const rt = tau > 0 ? roundHalfEven(tau) : 0;
        const iou = estimate.phaseIouAtT;
        const half = estimate.halfWitness;
        const strideOk = strides[i] >= strideRel * smax;
        const rangeOk = rt > 0 && i + rt <= n - 1;
        const pairsOk = estimate.pairsOk;
        const confOk = estimate.found && pairsOk;
        const phaseOk = iou !== null && iou >= minPhaseIou;
        const halfOk = half !== null && half.ok === true;
        entries.push({
            c0: i,
            c0Label: i + 1,
            stride: strides[i],
            strideOverSmax: smax > 0 ? Math.round((strides[i] / smax) * 10000) / 10000 : null,
            tau: rt > 0 ? rt : null,
            phaseIouAtT: iou,
            strideOk,
            rangeOk,
            pairsOk,
            confOk,
            phaseOk,
            halfOk,
            halfLag: half?.halfLag ?? null,
            iouHalf: half?.iouHalf ?? null,
            deltaPhase: half?.delta ?? null,
            octaveFold: estimate.octaveFold,
            octaveFrom: estimate.octaveFrom,
            selected: false,
            reason: null,
        });
    }
    const inRange = entries.filter((entry) => entry.rangeOk);
    const confAt = inRange.filter((entry) => entry.confOk);
    const pairsAt = inRange.filter((entry) => entry.pairsOk);
    const eligibleBase = entries.filter((entry) => entry.strideOk && entry.rangeOk && entry.confOk && entry.phaseOk);
    const eligible = eligibleBase.filter((entry) => entry.halfOk);
    const halfOnly = inRange.filter((entry) => entry.confOk && entry.pairsOk && entry.phaseOk && !entry.halfOk);
    for (const entry of entries) {
        if (eligible.includes(entry))
            continue;
        if (!entry.strideOk)
            entry.reason = "stride_below_" + strideRel + "_smax";
        else if (!entry.rangeOk)
            entry.reason = "c_end_out_of_range";
        else if (!entry.pairsOk)
            entry.reason = "insufficient_period_pairs";
        else if (!entry.confOk)
            entry.reason = "period_conf_below_min";
        else if (!entry.phaseOk)
            entry.reason = "phase_iou_below_min";
        else
            entry.reason = "half_period_not_witnessed";
    }
    const uniformPicks = (cycleStart, cycleEnd) => {
        const picks = [];
        for (let k = 0; k < count; k++) {
            picks.push(Math.min(n - 1, roundHalfEven(cycleStart + (k * (cycleEnd - cycleStart)) / count)));
        }
        return picks;
    };
    if (eligible.length === 0) {
        let reason;
        if (inRange.length === 0)
            reason = "no_full_period";
        else if (confAt.length === 0)
            reason = "low_period_confidence";
        else if (pairsAt.length === 0)
            reason = "insufficient_period_pairs";
        else
            reason = "no_valid_cycle";
        if (reason === "no_valid_cycle" && halfOnly.length > 0 && fold.fired && fold.witnessed)
            reason = "period_ambiguous";
        const sortedEntries = [...entries].sort((a, b) => (b.phaseIouAtT ?? -1) - (a.phaseIouAtT ?? -1));
        const best = sortedEntries[0] ?? null;
        const estimate = best !== null ? periods.get(best.c0) ?? null : null;
        return {
            ...emptySelection,
            reason,
            candidates: entries,
            periodDetail: estimate,
            octave: { fired: fold.fired, witnessed: fold.witnessed, foldedTaus: fold.foldedTaus, suspects: fold.suspects },
            notes: [CYCLE_REASON_TEXT[reason] ?? reason],
            confidence: estimate !== null ? computeConfidence(estimate, margin) : 0,
        };
    }
    let chosen;
    if (eligible.length === 1 || !windowSelect) {
        chosen = eligible[0];
    }
    else {
        let bestDrop = -Infinity;
        chosen = eligible[0];
        for (const entry of eligible) {
            const tau = entry.tau ?? 0;
            const picks = uniformPicks(entry.c0, entry.c0 + tau);
            const closure = windowClosureOf(frames, picks, options);
            const drop = closure?.drop ?? -Infinity;
            if (drop > bestDrop) {
                bestDrop = drop;
                chosen = entry;
            }
        }
    }
    chosen.selected = true;
    const estimate = periods.get(chosen.c0) ?? null;
    const cycleStart = chosen.c0;
    const tau = chosen.tau ?? 0;
    const cycleEnd = cycleStart + tau;
    const picks = uniformPicks(cycleStart, cycleEnd);
    const confidence = estimate !== null ? computeConfidence(estimate, margin) : 0;
    const metrics = buildMetrics(frames, stats, picks, cycleStart, tau, estimate, options);
    const events = frameEventsOf(picks, cycleStart, tau);
    const notes = [];
    notes.push("周期 " + tau + " 帧（相关性 " + (estimate?.conf ?? 0) + "，相位 IoU " + (estimate?.phaseIouAtT ?? 0) + "）");
    if (chosen.octaveFold && chosen.octaveFrom !== null)
        notes.push("八度折半：" + chosen.octaveFrom + " -> " + tau + "（原自相关主峰是两倍周期）");
    notes.push("锚点 c0 = 第 " + (cycleStart + 1) + " 帧，窗口 [" + (cycleStart + 1) + ", " + (cycleEnd + 1) + ")");
    if (estimate !== null && estimate.halfWitness !== null && estimate.halfWitness.ok === true) {
        notes.push("半周期自证：Δ=" + estimate.halfWitness.delta + "（>= " + margin + "）");
    }
    if (events.contacts.length === 2)
        notes.push("contact = 第 " + events.contacts.map((frame) => frame + 1).join(" / ") + " 帧");
    if (events.passing.length === 2)
        notes.push("passing = 第 " + events.passing.map((frame) => frame + 1).join(" / ") + " 帧");
    return {
        picks,
        confidence,
        period: tau,
        contacts: events.contacts,
        passing: events.passing,
        cycleStart,
        cycleEnd,
        candidates: entries,
        periodDetail: estimate,
        octave: { fired: fold.fired, witnessed: fold.witnessed, foldedTaus: fold.foldedTaus, suspects: fold.suspects },
        metrics,
        notes,
    };
}
/**
 * 自动选帧主入口。
 *
 * @param samples 某个方向的连续帧（RGBA）。picks 返回的是输入数组下标。
 * @param count 要取几帧（= 每段视频抽帧数）。
 * @returns 建议帧 + 置信度 + 周期 + 回退原因（失败时 picks 是等分）。
 */
export function pickCycleFrames(samples, count, options = {}) {
    const startedAt = Date.now();
    const frameCount = Array.isArray(samples) ? samples.length : 0;
    const wanted = Math.max(1, Math.round(count || 1));
    const even = evenPicks(frameCount, wanted);
    const baseAnalysis = {
        frameCount,
        analysisFrames: 0,
        analysisStep: 1,
        width: 0,
        height: 0,
        downscaled: false,
        smax: 0,
        emptyFrames: 0,
        elapsedMs: 0,
    };
    const fail = (reason, extra = {}) => {
        const notes = [CYCLE_REASON_TEXT[reason] ?? reason];
        if (frameCount > 0)
            notes.push("已回退为等分：" + even.join(", "));
        return {
            picks: even,
            confidence: 0,
            period: 0,
            contacts: [],
            passing: [],
            reason,
            fallback: true,
            evenPicks: even,
            cycleStart: 0,
            cycleEnd: 0,
            analysis: { ...baseAnalysis, elapsedMs: Date.now() - startedAt },
            stride: [],
            periodDetail: null,
            candidates: [],
            octave: { fired: false, witnessed: false, foldedTaus: [], suspects: [] },
            metrics: null,
            notes,
            ...extra,
        };
    };
    if (frameCount < 4)
        return fail("too_few_frames");
    const minPeriod = opt(options.minPeriod, CYCLE_DEFAULTS.minPeriod);
    if (frameCount < minPeriod + 8)
        return fail("too_few_frames");
    // 抽稀：帧数超过上限时按步长取样，结果再换算回输入下标。
    const maxAnalysisFrames = Math.max(8, opt(options.maxAnalysisFrames, CYCLE_DEFAULTS.maxAnalysisFrames));
    const analysisStep = Math.max(1, Math.ceil(frameCount / maxAnalysisFrames));
    const used = [];
    for (let i = 0; i < frameCount; i += analysisStep)
        used.push(samples[i]);
    const analyzed = analyzeFrames(used, options);
    const analysis = {
        ...baseAnalysis,
        analysisFrames: used.length,
        analysisStep,
        width: analyzed.width,
        height: analyzed.height,
        downscaled: analyzed.downscaled,
        smax: analyzed.smax,
        emptyFrames: analyzed.emptyFrames,
    };
    if (analyzed.emptyFrames > 0 && analyzed.emptyFrames >= Math.ceil(used.length * 0.5)) {
        return fail("empty_frames", { analysis: { ...analysis, elapsedMs: Date.now() - startedAt }, stride: analyzed.stride });
    }
    if (!(analyzed.smax > 0)) {
        return fail("no_stride_signal", { analysis: { ...analysis, elapsedMs: Date.now() - startedAt }, stride: analyzed.stride });
    }
    const selection = selectCycle(analyzed.frames, analyzed.stats, wanted, options);
    const elapsed = Date.now() - startedAt;
    if (selection.reason !== undefined && selection.reason !== "" && selection.picks.length === 0) {
        return fail(selection.reason, {
            analysis: { ...analysis, elapsedMs: elapsed },
            stride: analyzed.stride,
            candidates: selection.candidates.map((entry) => ({ ...entry, c0: entry.c0 * analysisStep, c0Label: entry.c0 * analysisStep + 1 })),
            periodDetail: selection.periodDetail,
            octave: selection.octave,
            confidence: selection.confidence,
        });
    }
    if (analysisStep === 1) {
        return {
            picks: selection.picks,
            confidence: selection.confidence,
            period: selection.period,
            contacts: selection.contacts,
            passing: selection.passing,
            fallback: false,
            evenPicks: even,
            cycleStart: selection.cycleStart,
            cycleEnd: selection.cycleEnd,
            analysis: { ...analysis, elapsedMs: elapsed },
            stride: analyzed.stride,
            periodDetail: selection.periodDetail,
            candidates: selection.candidates,
            octave: selection.octave,
            metrics: selection.metrics,
            notes: selection.notes,
        };
    }
    // 分析下标 -> 输入下标（抽稀时按步长换算；周期也一起换算）。
    const periodOriginal = Math.max(1, Math.round(selection.period * analysisStep));
    const cycleStart = selection.cycleStart * analysisStep;
    const cycleEnd = Math.min(frameCount, cycleStart + periodOriginal);
    const picks = [];
    for (let k = 0; k < wanted; k++)
        picks.push(Math.min(frameCount - 1, roundHalfEven(cycleStart + (k * (cycleEnd - cycleStart)) / wanted)));
    const strideOriginal = [];
    for (let i = 0; i < frameCount; i++)
        strideOriginal.push(analyzed.stride[Math.min(analyzed.stride.length - 1, Math.floor(i / analysisStep))] ?? 0);
    const events = frameEventsOf(picks, cycleStart, periodOriginal);
    return {
        picks,
        confidence: selection.confidence,
        period: periodOriginal,
        contacts: events.contacts,
        passing: events.passing,
        fallback: false,
        evenPicks: even,
        cycleStart,
        cycleEnd,
        analysis: { ...analysis, elapsedMs: elapsed },
        stride: strideOriginal,
        periodDetail: selection.periodDetail,
        candidates: selection.candidates.map((entry) => ({ ...entry, c0: entry.c0 * analysisStep, c0Label: entry.c0 * analysisStep + 1 })),
        octave: selection.octave,
        metrics: selection.metrics,
        notes: selection.notes,
    };
}
