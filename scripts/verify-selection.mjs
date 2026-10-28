/**
 * 自动选帧自检：纯本地、零依赖、不需要 ffmpeg / API Key / 网络。
 *
 *   node scripts/verify-selection.mjs
 *
 * 覆盖四类：
 *   1. **合成走路帧 fixture**：已知周期、半周期自证、八度折半、无周期回退、静帧、
 *      帧太少、空帧 —— 每条都能算出期望值，不靠「看上去对」。
 *   2. **算法零件**：轮廓统计（bbox/身高/头宽/脚位/步幅）、自相关、腿 IoU、
 *      与 Python round 一致的取整、等分公式、contact/passing 相位。
 *   3. **工程约束**：确定性、长边 >768 降采样、> maxAnalysisFrames 抽稀换算、性能。
 *   4. **真实素材对比**：G:/image 里三段真实走循环素材（p1 / p3 / 八度样本 p3s42），
 *      与 make_cycle.py --select-only（本机 2026-10-29 新鲜跑出来的结果，写在
 *      MAKE_CYCLE_REFERENCE 里）逐帧对比，允许 ±1 帧。
 *      这些素材只在装了 G:/image 的机器上存在：缺了就打印 SKIP，不计失败。
 *
 * 参考实现与阈值来源：G:/image/.agents/skills/minimax-h3-walk-cycle/scripts/make_cycle.py
 * 与 SKILL.md；G:/image/sprite-gen（Apache-2.0）只参考思路、未搬运代码。
 * 详见 docs/自动选帧-算法与阈值.md。
 */

import { inflateSync } from "node:zlib";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CYCLE_DEFAULTS,
  CYCLE_REASON_TEXT,
  analyzeAlphaFrame,
  analyzeFrames,
  autocorrOf,
  evenPicks,
  legIouOf,
  pickCycleFrames,
  roundHalfEven,
  stridePeaksOf
} from "../lib/cycle.js";

const failures = [];
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log("  " + (ok ? "✓" : "✗") + " " + name + (detail === undefined ? "" : " — " + detail));
  if (!ok) failures.push(name);
}

// ── 合成走路帧 fixture ──────────────────────────────────────────────────────
// 一个极简火柴人：头 + 躯干 + 两条腿。腿的横向位置随相位走 2*amp*|cos|，
// 两条腿宽度不同（10 / 18）——这给了「左右交替」一个**形状上可见**的不对称：
// 半周期后两条腿换了位置、宽度也互换，所以腿部 ROI 的 IoU 明显低于整周期。
// 脚位（底部 6% 行带）始终是两簇（或 passing 相位合成一簇），与真实素材同构。

function blank(w, h) {
  return Buffer.alloc(w * h * 4);
}
function fillRect(buf, w, h, x0, y0, x1, y1) {
  const left = Math.max(0, Math.round(Math.min(x0, x1)));
  const right = Math.min(w - 1, Math.round(Math.max(x0, x1)));
  const top = Math.max(0, Math.round(Math.min(y0, y1)));
  const bottom = Math.min(h - 1, Math.round(Math.max(y0, y1)));
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const o = (y * w + x) * 4;
      buf[o] = 90;
      buf[o + 1] = 70;
      buf[o + 2] = 50;
      buf[o + 3] = 255;
    }
  }
}
function makeWalkFrame(w, h, phase, options) {
  const amp = options.amp ?? 22;
  const scale = options.scale ?? 1;
  const buf = blank(w, h);
  const cx = w / 2;
  const s = Math.cos(2 * Math.PI * phase) * scale;
  const legTop = Math.round(h * 0.5);
  const legBottom = h - 2;
  const xLeft = cx - amp * s;
  const xRight = cx + amp * s;
  fillRect(buf, w, h, xLeft - 5, legTop, xLeft + 5, legBottom);
  fillRect(buf, w, h, xRight - 9, legTop, xRight + 9, legBottom);
  fillRect(buf, w, h, cx - 20, Math.round(h * 0.3), cx + 20, legTop);
  fillRect(buf, w, h, cx - 15, Math.round(h * 0.18), cx + 15, Math.round(h * 0.3));
  return buf;
}
function makeWalkSamples(count, period, options = {}) {
  const w = options.width ?? 160;
  const h = options.height ?? 240;
  const samples = [];
  for (let i = 0; i < count; i++) {
    const phase = (i % period) / period;
    samples.push({ index: i, rgba: makeWalkFrame(w, h, phase, options), width: w, height: h });
  }
  return samples;
}
/** 确定性伪随机（mulberry32），避免每次跑出来的随机样本不一样。 */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 最小 PNG 解码（只支持 8-bit / 非隔行 / 灰度·RGB·RGBA）───────────────────
// 真实素材对比要用到 G:/image 的 cut_NNN.png。这里自写一个解码器，好处是自检脚本
// **不依赖 ffmpeg**（本机另一处红就是「整机没装 ffmpeg」），也不引第三方包。
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  let interlace = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0;
  if (channels === 0 || bitDepth !== 8 || interlace !== 0) throw new Error("不支持的 PNG：" + colorType + "/" + bitDepth + "/" + interlace);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pred) & 255;
      }
      line[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (channels === 4) {
        out[o] = line[x * 4];
        out[o + 1] = line[x * 4 + 1];
        out[o + 2] = line[x * 4 + 2];
        out[o + 3] = line[x * 4 + 3];
      } else if (channels === 3) {
        out[o] = line[x * 3];
        out[o + 1] = line[x * 3 + 1];
        out[o + 2] = line[x * 3 + 2];
        out[o + 3] = 255;
      } else if (channels === 1) {
        out[o] = out[o + 1] = out[o + 2] = line[x];
        out[o + 3] = 255;
      } else {
        out[o] = out[o + 1] = out[o + 2] = line[x * 2];
        out[o + 3] = line[x * 2 + 1];
      }
    }
    prev = line;
  }
  return { rgba: out, width, height };
}

function loadCutFrames(dir) {
  const files = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort();
  return files.map((name, i) => {
    const image = decodePng(readFileSync(join(dir, name)));
    return { index: i, rgba: image.rgba, width: image.width, height: image.height };
  });
}

function diffPicks(actual, expectedZeroBased) {
  if (actual.length !== expectedZeroBased.length) return Infinity;
  let worst = 0;
  for (let i = 0; i < actual.length; i++) worst = Math.max(worst, Math.abs(actual[i] - expectedZeroBased[i]));
  return worst;
}

/**
 * make_cycle.py --select-only 的真实输出（2026-10-29 本机用
 * sel-venv + numpy 2.5.4 / scipy 1.18.1 / Pillow 13.0.0 现跑的结果）。
 * 帧号是 1 起，与它 cycle_report.json 的 picked_numbers 同口径。
 */
const MAKE_CYCLE_REFERENCE = [
  {
    name: "p1",
    dir: "G:/image/work/sprite-walk/p1/wudu_p1_walk/cut",
    frames: 90,
    period: 26,
    conf: 0.8396,
    cycleStart: 23,
    picked: [23, 26, 29, 33, 36, 39, 43, 46],
    octaveFrom: null
  },
  {
    name: "p3",
    dir: "G:/image/work/sprite-walk/p3/wudu_p3_walk/cut",
    frames: 90,
    period: 33,
    conf: 0.8639,
    cycleStart: 36,
    picked: [36, 40, 44, 48, 53, 57, 61, 65],
    octaveFrom: null
  },
  {
    name: "octave_p3s42",
    dir: "G:/image/work/sprite-walk/_octave_s42/p3/wudu_p3_s42/cut",
    frames: 90,
    period: 29,
    conf: 0.6062,
    cycleStart: 34,
    picked: [34, 38, 41, 45, 49, 52, 56, 59],
    octaveFrom: 59
  }
];

async function main() {
  console.log("\n── 1) 轮廓统计（bbox / 身高 / 头宽 / 脚位 / 步幅）──");
  const w = 160;
  const h = 240;
  const contact = { index: 0, rgba: makeWalkFrame(w, h, 0, {}), width: w, height: h };
  const passing = { index: 1, rgba: makeWalkFrame(w, h, 0.25, {}), width: w, height: h };
  const contactFrame = analyzeFrames([contact]).frames[0];
  const contactStats = analyzeAlphaFrame(contactFrame, 0);
  check("bbox 上边落在头顶点", contactStats.bbox !== null && contactStats.bbox.top === Math.round(h * 0.18), String(contactStats.bbox && contactStats.bbox.top));
  check("bbox 下边落在脚底", contactStats.bbox !== null && contactStats.bbox.bottom === h - 2, String(contactStats.bbox && contactStats.bbox.bottom));
  check("身高 = 下边 - 上边 + 1", contactStats.height === h - 2 - Math.round(h * 0.18) + 1, String(contactStats.height));
  check("头宽 ≈ 头的矩形宽 30px（±2）", Math.abs(contactStats.headWidth - 30) <= 2, String(contactStats.headWidth));
  check("contact 帧有两只脚", contactStats.feet.length === 2, JSON.stringify(contactStats.feet));
  check("contact 帧步幅 = 44px（2 × amp）", contactStats.stride === 44, String(contactStats.stride));
  const passingStats = analyzeAlphaFrame(analyzeFrames([passing]).frames[0], 1);
  check("passing 帧两腿重叠成一只脚 -> 步幅 0", passingStats.stride === 0, String(passingStats.stride));
  const emptyFrame = { index: 9, rgba: blank(w, h), width: w, height: h };
  const emptyStats = analyzeAlphaFrame(analyzeFrames([emptyFrame]).frames[0], 9);
  check("全透明帧被标成 empty", emptyStats.empty === true && emptyStats.stride === 0);
  check("全透明帧不崩（bbox 为 null）", emptyStats.bbox === null);

  console.log("\n── 2) 算法零件：自相关 / 腿 IoU / 取整 / 等分 ──");
  const sineStrides = [];
  for (let i = 0; i < 90; i++) sineStrides.push(20 + 10 * Math.cos((2 * Math.PI * (i % 30)) / 30));
  const auto = autocorrOf(sineStrides);
  let bestLag = auto.lags[0];
  let bestR = -Infinity;
  for (let i = 0; i < auto.lags.length; i++) {
    if (auto.rs[i] > bestR) {
      bestR = auto.rs[i];
      bestLag = auto.lags[i];
    }
  }
  check("周期 30 的正弦 stride，自相关主峰在 30", bestLag === 30, "lag=" + bestLag + " r=" + bestR.toFixed(4));
  check("自相关 lag 下界是 8", auto.lags[0] === CYCLE_DEFAULTS.minPeriod, String(auto.lags[0]));
  check("自相关 lag 上界是 min(N-8, 64)", auto.lags[auto.lags.length - 1] === Math.min(90 - 8, CYCLE_DEFAULTS.maxPeriod), String(auto.lags[auto.lags.length - 1]));
  check("自相关系数都落在 -1~1", auto.rs.every((value) => value >= -1.0000001 && value <= 1.0000001));
  const repeatStrides = [];
  for (let i = 0; i < 72; i++) repeatStrides.push(44 * Math.abs(Math.cos((Math.PI * (i % 24)) / 12)));
  check("stride 局部极大都在接触相位（8 的倍数）", stridePeaksOf(repeatStrides).every((index) => index % 12 === 0), JSON.stringify(stridePeaksOf(repeatStrides).slice(0, 6)));
  check("腿 IoU：同一帧 = 1", Math.abs(legIouOf(contactFrame, contactFrame) - 1) < 1e-9);
  const contactHalf = analyzeFrames([{ index: 2, rgba: makeWalkFrame(w, h, 0.5, {}), width: w, height: h }]).frames[0];
  const iouOpposite = legIouOf(contactFrame, contactHalf);
  check("腿 IoU：半周期互换后明显 < 1", iouOpposite < 0.9 && iouOpposite > 0.3, iouOpposite.toFixed(4));
  check("round 与 Python 一致：28.5 -> 28", roundHalfEven(28.5) === 28, String(roundHalfEven(28.5)));
  check("round 与 Python 一致：29.5 -> 30", roundHalfEven(29.5) === 30, String(roundHalfEven(29.5)));
  check("round 与 Python 一致：41.5 -> 42", roundHalfEven(41.5) === 42, String(roundHalfEven(41.5)));
  check("round 与 Python 一致：2.4 -> 2 / 2.6 -> 3", roundHalfEven(2.4) === 2 && roundHalfEven(2.6) === 3);
  check("等分 picks 与 pipeline 的格心公式一致", JSON.stringify(evenPicks(72, 8)) === JSON.stringify([4, 13, 22, 31, 40, 49, 58, 67]), JSON.stringify(evenPicks(72, 8)));
  check("等分 picks 单调、去重、在界内", (() => {
    const picks = evenPicks(37, 8);
    return picks.length === 8 && picks.every((value, i) => value >= 0 && value < 37 && (i === 0 || value > picks[i - 1]));
  })());

  console.log("\n── 3) 已知周期的合成走路素材（周期 24 / 72 帧）──");
  const known = pickCycleFrames(makeWalkSamples(72, 24), 8);
  check("找到周期，没有回退", known.fallback === false && known.reason === undefined);
  check("周期 = 24", known.period === 24, String(known.period));
  check("picks 张数 = 8", known.picks.length === 8, JSON.stringify(known.picks));
  check("picks 均匀铺在一个周期里（步长 3）", known.picks.every((value, i) => i === 0 || value - known.picks[i - 1] === 3), JSON.stringify(known.picks));
  check("picks 全落在 [cycleStart, cycleStart+period)", known.picks.every((value) => value >= known.cycleStart && value < known.cycleEnd), "[" + known.cycleStart + "," + known.cycleEnd + ")");
  check("置信度 ≥ 0.9", known.confidence >= 0.9, String(known.confidence));
  check("周期窗口长度 = 24", known.cycleEnd - known.cycleStart === 24);
  check("contact 有两帧", known.contacts.length === 2, JSON.stringify(known.contacts));
  check("contact 帧的步幅就是全片最大步幅", known.contacts.length === 2 && known.contacts.every((frame) => known.stride[frame] === Math.max.apply(null, known.stride)), JSON.stringify(known.contacts.map((frame) => known.stride[frame])));
  check("passing 帧的步幅接近 0", known.passing.length === 2 && known.passing.every((frame) => known.stride[frame] <= 1), JSON.stringify(known.passing.map((frame) => known.stride[frame])));
  check("循环缝 / 内部相邻步进的指标都在", known.metrics !== null && known.metrics.seamIou !== null && known.metrics.adjIouMean !== null, JSON.stringify(known.metrics && { seam: known.metrics.seamIou, adj: known.metrics.adjIouMean }));
  check("同相位 IoU ≥ 反相位 IoU（腿真的在交替）", known.metrics !== null && known.metrics.iouSame >= known.metrics.iouOpp, JSON.stringify(known.metrics && [known.metrics.iouSame, known.metrics.iouOpp]));
  check("交替自证 Δ ≥ 0.20", known.metrics !== null && known.metrics.alternationDelta >= 0.2, String(known.metrics && known.metrics.alternationDelta));
  check("notes 里有周期 / 锚点说明", known.notes.some((line) => line.indexOf("周期") >= 0) && known.notes.some((line) => line.indexOf("锚点") >= 0), JSON.stringify(known.notes.slice(0, 2)));

  console.log("\n── 4) 八度折半（自相关主峰是两倍周期）──");
  check("折半计划被触发", known.octave.fired === true, JSON.stringify(known.octave.foldedTaus));
  check("折叠候选里有 24（48 折半）", known.octave.foldedTaus.indexOf(24) >= 0, JSON.stringify(known.octave.foldedTaus));
  check("嫌疑周期 48 的失败探针与折叠候选都记录了", known.octave.suspects.some((item) => item.tau === 48 && item.foldCandidates.indexOf(24) >= 0), JSON.stringify(known.octave.suspects));
  check("最终周期仍是基频 24（没被 48 骗走）", known.period === 24);
  check("选中的锚点周期是 24", known.candidates.some((entry) => entry.selected === true) && known.candidates.filter((entry) => entry.selected === true).every((entry) => entry.tau === 24), JSON.stringify(known.candidates.filter((entry) => entry.selected).map((entry) => ({ c0: entry.c0Label, tau: entry.tau }))));
  check("半周期（tau=12）的锚点没有被选中（放不下整周期的锚点会退到短周期，不能赢）", known.candidates.filter((entry) => entry.tau !== null && entry.tau < 24).every((entry) => entry.selected === false), JSON.stringify(known.candidates.map((entry) => ({ c0: entry.c0Label, tau: entry.tau, sel: entry.selected }))));
  check("八度信息不写进回退原因（成功路径 reason 为空）", known.reason === undefined);

  console.log("\n── 5) 周期 30 / 90 帧（不同周期都要对）──");
  const period30 = pickCycleFrames(makeWalkSamples(90, 30), 8);
  check("周期 = 30", period30.period === 30, String(period30.period));
  check("picks 步长 3~4（30 / 8 = 3.75）", period30.picks.every((value, i) => i === 0 || (value - period30.picks[i - 1] >= 3 && value - period30.picks[i - 1] <= 4)), JSON.stringify(period30.picks));
  check("置信度高（>= 0.9）", period30.confidence >= 0.9, String(period30.confidence));

  console.log("\n── 6) 失败样本：必须回退等分并给出原因 ──");
  const random = seededRandom(20261029);
  const randomSamples = [];
  for (let i = 0; i < 72; i++) {
    const buf = blank(160, 240);
    const cx = 40 + random() * 80;
    const spread = 5 + random() * 30;
    fillRect(buf, 160, 240, cx - spread - 5, 120, cx - spread + 5, 238);
    fillRect(buf, 160, 240, cx + spread - 9, 120, cx + spread + 9, 238);
    fillRect(buf, 160, 240, cx - 20, 72, cx + 20, 120);
    fillRect(buf, 160, 240, cx - 15, 43, cx + 15, 72);
    randomSamples.push({ index: i, rgba: buf, width: 160, height: 240 });
  }
  const randomResult = pickCycleFrames(randomSamples, 8);
  check("随机素材：回退到等分", randomResult.fallback === true);
  check("随机素材：有原因码", typeof randomResult.reason === "string" && randomResult.reason.length > 0, String(randomResult.reason));
  check("随机素材：原因码有中文说明", CYCLE_REASON_TEXT[randomResult.reason] !== undefined, String(CYCLE_REASON_TEXT[randomResult.reason]));
  check("随机素材：picks 就是等分", JSON.stringify(randomResult.picks) === JSON.stringify(evenPicks(72, 8)), JSON.stringify(randomResult.picks));
  check("随机素材：confidence 低（< 0.6）", randomResult.confidence < 0.6, String(randomResult.confidence));
  const staticSamples = [];
  for (let i = 0; i < 72; i++) staticSamples.push({ index: i, rgba: makeWalkFrame(160, 240, 0, {}), width: 160, height: 240 });
  const staticResult = pickCycleFrames(staticSamples, 8);
  check("静帧（脚从不动）：回退等分", staticResult.fallback === true && JSON.stringify(staticResult.picks) === JSON.stringify(evenPicks(72, 8)));
  check("静帧：period = 0", staticResult.period === 0);
  const tooFew = pickCycleFrames(makeWalkSamples(5, 24), 8);
  check("帧太少（5 帧）：reason = too_few_frames", tooFew.reason === "too_few_frames", String(tooFew.reason));
  const blankSamples = [];
  for (let i = 0; i < 24; i++) blankSamples.push({ index: i, rgba: blank(160, 240), width: 160, height: 240 });
  const blankResult = pickCycleFrames(blankSamples, 8);
  check("全空帧：回退等分 + 原因非空", blankResult.fallback === true && typeof blankResult.reason === "string", String(blankResult.reason));

  console.log("\n── 7) 工程约束：确定性 / 降采样 / 抽稀 / 性能 ──");
  const again = pickCycleFrames(makeWalkSamples(72, 24), 8);
  check("同一输入两次结果完全一致", JSON.stringify(again.picks) === JSON.stringify(known.picks) && again.period === known.period && again.confidence === known.confidence);
  const bigSamples = makeWalkSamples(48, 24, { width: 400, height: 800 });
  const big = pickCycleFrames(bigSamples, 8);
  check("长边 800 > 768 时自动降采样", big.analysis.downscaled === true, JSON.stringify({ w: big.analysis.width, h: big.analysis.height }));
  check("降采样后周期不变（24）", big.period === 24, String(big.period));
  check("降采样后 picks 与原生分辨率一致（±1 帧）", diffPicks(big.picks, known.picks) <= 1, JSON.stringify(big.picks));
  const sparse = pickCycleFrames(makeWalkSamples(72, 24), 8, { maxAnalysisFrames: 36 });
  check("抽稀到 36 帧分析：周期换算回 24", sparse.period === 24, String(sparse.period));
  check("抽稀后 picks 仍是 8 个合法下标", sparse.picks.length === 8 && sparse.picks.every((value) => value >= 0 && value < 72), JSON.stringify(sparse.picks));
  check("抽稀元数据正确（analysisStep = 2）", sparse.analysis.analysisStep === 2, String(sparse.analysis.analysisStep));
  const perfSamples = makeWalkSamples(90, 30, { width: 256, height: 384 });
  const perfStart = Date.now();
  const perfResult = pickCycleFrames(perfSamples, 8);
  const perfMs = Date.now() - perfStart;
  check("90 帧 256×384 分析 < 3000ms（参考实现口径 < 300ms）", perfMs < 3000, perfMs + "ms / period=" + perfResult.period);
  check("分析耗时记录在 analysis.elapsedMs 里", typeof known.analysis.elapsedMs === "number" && known.analysis.elapsedMs >= 0);

  console.log("\n── 8) 接线与界面契约（wire / config / 客户端方法 / 工具面 / docs）──");
  {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = fileURLToPath(new URL("../", import.meta.url));
    const read = (relative) => readFileSync(join(root, relative), "utf8");
    const wire = await import("../lib/wire.js");
    const autoPick = wire.METHODS.find((spec) => spec.method === "autoPickFrames");
    const applyPick = wire.METHODS.find((spec) => spec.method === "applyAutoPicks");
    check("wire 注册了 autoPickFrames", autoPick !== undefined);
    check("wire 注册了 applyAutoPicks", applyPick !== undefined);
    const autoPayload = autoPick === undefined ? null : autoPick.payload.parse({ projectId: "p1", jobId: "s1", key: "front", count: 8 });
    check(
      "autoPickFrames 的 payload 键不丢（projectId / jobId / key / count）",
      autoPayload !== null && autoPayload.projectId === "p1" && autoPayload.jobId === "s1" && autoPayload.key === "front" && autoPayload.count === 8,
      JSON.stringify(autoPayload)
    );
    const applyPayload = applyPick === undefined ? null : applyPick.payload.parse({ projectId: "p1", picks: [1, 2, 3] });
    check(
      "applyAutoPicks 的 payload 键不丢（projectId / picks）",
      applyPayload !== null && applyPayload.projectId === "p1" && Array.isArray(applyPayload.picks) && applyPayload.picks.length === 3,
      JSON.stringify(applyPayload)
    );
    const configModule = await import("../lib/config.js");
    check("config 默认 autoSelectFrames = true", configModule.DEFAULT_CONFIG.autoSelectFrames === true, String(configModule.DEFAULT_CONFIG.autoSelectFrames));
    const patchModule = await import("../lib/configpatch.js");
    const patch = patchModule.buildConfigPatch({ autoSelectFrames: false });
    check("autoSelectFrames 进了 saveConfig 白名单（directKeys）", patch.autoSelectFrames === false, JSON.stringify(patch));
    const tools = await import("../lib/tools.js");
    check("工具面把两个新方法归到 sprite 模块", tools.METHOD_MODULE.autoPickFrames === "sprite" && tools.METHOD_MODULE.applyAutoPicks === "sprite", JSON.stringify({ auto: tools.METHOD_MODULE.autoPickFrames, apply: tools.METHOD_MODULE.applyAutoPicks }));
    const indexSource = read("src/index.ts");
    check("网关实现了 autoPickFrames / applyAutoPicks 并按 jobId 分派模块③", indexSource.includes("async autoPickFrames(payload)") && indexSource.includes("async applyAutoPicks(payload)") && indexSource.includes("autoPickSequenceFrames"));
    const pipelineSource = read("src/pipeline.ts");
    check("pipeline 导出 autoPickFrames / applyAutoPicks 并在抽完候选帧后自动应用", pipelineSource.includes("export async function autoPickFrames") && pipelineSource.includes("export async function applyAutoPicks") && pipelineSource.includes("maybeAutoSelectFrames(projectId, key)"));
    const seqgenSource = read("src/seqgen.ts");
    check("seqgen 导出 autoPickSequenceFrames / applySequenceAutoPicks", seqgenSource.includes("export async function autoPickSequenceFrames") && seqgenSource.includes("export async function applySequenceAutoPicks"));
    const clientText = read("lib/client.js");
    check("客户端有「自动选帧」按钮", clientText.includes('T("自动选帧")'));
    check("客户端调用了 autoPickFrames / applyAutoPicks", clientText.includes('call("autoPickFrames"') && clientText.includes('call("applyAutoPicks"'));
    check("客户端建议卡有缩略图 / 置信度 / 回退原因", clientText.includes("SPR_autoPickThumbs") && clientText.includes("置信度 {n0}%") && clientText.includes("已回退等分"));
    check("设置页有 autoSelectFrames 开关", clientText.includes("cfg-auto-select-frames") && clientText.includes("抽帧后自动选帧"));
    const en = read("src/client/i18n-en.ts");
    check("英文词条补齐（自动选帧相关）", en.includes('"自动选帧": "Auto-pick frames"') && en.includes('"自动选帧建议": "Auto-pick suggestion"'));
    const docs = read("docs/自动选帧-算法与阈值.md");
    check("docs 记录算法阈值来源与真实对比", docs.includes("make_cycle.py") && docs.includes("Apache-2.0") && docs.includes("±0 帧"));
    {
  // 方法数会随其他分支合并变化：按当前 wire 清单动态比，别写死数字。
  const { METHODS } = await import("../lib/wire.js");
  const expected = METHODS.length;
  check(
    `verify-host / verify-iso-gateway 的 wire 方法计数已改 ${expected}`,
    read("scripts/verify-host.mjs").includes(`invocations.length === ${expected}`) &&
      read("scripts/verify-iso-gateway.mjs").includes(`WIRE.METHODS.length === ${expected}`)
  );
}
    const storeSource = read("src/store.ts");
    check(
      "selection 带循环质量指标（QA 可直接读，不必重算）",
      storeSource.includes("normalizeSelectionMetrics") && storeSource.includes("heightCvPct") && pipelineSource.includes("metrics:") && seqgenSource.includes("metrics:")
    );
  }

  console.log("\n── 9) 真实走循环素材 vs make_cycle.py（G:/image）──");
  const available = MAKE_CYCLE_REFERENCE.filter((item) => existsSync(item.dir));
  if (available.length === 0) {
    console.log("  SKIP 本机没有 G:/image 走循环素材（真实对比那一组不计入检查项）");
  } else {
    console.log("  参考实现：make_cycle.py --select-only（本机 2026-10-29 现跑）");
    for (const item of available) {
      const samples = loadCutFrames(item.dir);
      check("真实素材 " + item.name + "：cut 帧数 = " + item.frames, samples.length === item.frames, String(samples.length));
      const started = Date.now();
      const result = pickCycleFrames(samples, 8);
      const elapsed = Date.now() - started;
      const expectedZero = item.picked.map((value) => value - 1);
      const worst = diffPicks(result.picks, expectedZero);
      const oursPicked = result.picks.map((value) => value + 1);
      console.log("    对比 " + item.name + "：make_cycle 周期 " + item.period + " / c0 " + item.cycleStart + " / picks " + JSON.stringify(item.picked) + "；本实现 周期 " + result.period + " / c0 " + (result.cycleStart + 1) + " / picks " + JSON.stringify(oursPicked) + " / 置信度 " + result.confidence + " / 耗时 " + elapsed + "ms");
      check("真实素材 " + item.name + "：没有回退", result.fallback === false && result.reason === undefined);
      check("真实素材 " + item.name + "：周期与 make_cycle.py 一致（±1）", Math.abs(result.period - item.period) <= 1, result.period + " vs " + item.period);
      check("真实素材 " + item.name + "：锚点与 make_cycle.py 一致（±1）", Math.abs(result.cycleStart + 1 - item.cycleStart) <= 1, (result.cycleStart + 1) + " vs " + item.cycleStart);
      check("真实素材 " + item.name + "：建议帧序与 make_cycle.py 逐帧一致（±1 帧）", worst <= 1, "最大偏差 " + worst + " 帧");
      check("真实素材 " + item.name + "：置信度 > 0.5", result.confidence > 0.5, String(result.confidence));
      check("真实素材 " + item.name + "：单次分析 < 3000ms", elapsed < 3000, elapsed + "ms");
      if (item.octaveFrom !== null) {
        check("真实素材 " + item.name + "：识别出八度折半（自相关主峰 " + item.octaveFrom + "）", result.octave.foldedTaus.length > 0, JSON.stringify(result.octave.foldedTaus));
        check("真实素材 " + item.name + "：折半后周期 ≈ " + item.period, result.octave.foldedTaus.some((tau) => Math.abs(tau - item.period) <= 1), JSON.stringify(result.octave.foldedTaus));
        check("真实素材 " + item.name + "：有锚点在「半周期自证」上被拦下（不是没交替）", result.candidates.some((entry) => entry.halfOk === false && entry.phaseOk === true), JSON.stringify(result.candidates.filter((entry) => entry.halfOk === false).map((entry) => entry.c0Label)));
      } else {
        check("真实素材 " + item.name + "：不需要八度折半", result.octave.foldedTaus.length === 0 || result.octave.foldedTaus.every((tau) => Math.abs(tau - result.period) > 2), JSON.stringify(result.octave.foldedTaus));
      }
    }
  }

  console.log("");
  if (failures.length > 0) {
    console.error("失败 " + failures.length + " 项：" + failures.join("、"));
    process.exit(1);
  }
  console.log("共 " + checks + " 项检查，全部通过。");
}

await main();
