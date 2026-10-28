/**
 * 去背抽象：绿幕（现有算法）/ BiRefNet（本机 ComfyUI 工作流）/ 自动。
 *
 * 模块①②③ 原来各自直接调 chroma.keyGreen。现在统一走这里，好处是：
 *   1. 可切换：matteBackend 选 keygreen（默认，行为不变）/ birefnet / auto；
 *   2. 失败显式回退：BiRefNet 不可用（ComfyUI 没开、模型缺失、超时、尺寸不一致……）
 *      时按 matteFallback 回退绿幕，并把原因写进返回值 → job.json 与任务日志，
 *      绝不静默产出黑底 / 脏边；
 *   3. 同图同参数不重复跑：BiRefNet 结果按内容哈希落 <DSH_HOME>/inkbox/matte-cache/，
 *      重跑抠像 / 换参数时直接复用（免费但费时）；
 *   4. 批量并发受控：默认 2 路上传 / 轮询 / 下载，ComfyUI 自己排队，不抢它的显存。
 *
 * 与 chroma 的边界：绿幕算法一行不改；BiRefNet 只负责「把一张 RGBA 图变成一张
 * 带 alpha 的 RGBA 图」，裁剪 / 缩放 / 合成整图仍然走 chroma.composeSheet。
 *
 * ## BiRefNet 调用链（本机 127.0.0.1:8188，免费）
 *
 *   1. RGBA → PNG → POST /upload/image 拿文件名；
 *   2. 把文件名注入工作流的 LoadImage（内置工作流是节点 1），POST /prompt 拿 prompt_id；
 *   3. 轮询 GET /history/<id>（没进 history 时看 /queue 区分排队 / 执行）；
 *   4. 从 outputs 里挑图片 → GET /view 取回 PNG；
 *   5. 尺寸必须与原图一致：不一致直接报错（防止被缩放过的小图覆盖原图）；
 *   6. 输出带 alpha 就直接用；只输出 mask（RGB 灰度）就用 mask 与原图合成 RGBA。
 *
 * 工作流取法：builtin.matte-birefnet 用本文件内嵌的 API 格式 JSON（从本机
 * user\default\workflows\游戏素材_抠图透明化_BiRefNet.json 转出来的，节点结构
 * RemoveBackground → InvertMask → JoinImageWithAlpha → SaveImage）。其它 id 先问
 * setMatteWorkflowResolver() 注册的解析器（合并工作流库后由 Lead 接），再退回读
 * <DSH_HOME>/inkbox/workflows/<id>.json（兼容工作流库的落盘格式），最后才允许
 * <id> 本身是个 .json 路径（手工调试用）。
 *
 * ## 为什么自己写 PNG 解码
 *
 * 项目里 png.ts 只有编码器；其它解码都交给 ffmpeg（视频链路必须用）。但去背是
 * 每帧一次的热路径，再为它 spawn 一次 ffmpeg 既慢又让纯本地自检多一个外部依赖。
 * 这里只需要「ComfyUI 输出的 8 位、非隔行 PNG」这一种，zlib.inflateSync + 五种行过滤
 * 约 120 行就够，且能明确区分「带 alpha」与「只有 mask」两种情况。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { dataRoot, type Config } from "./config.js";
import { DEFAULT_KEY_OPTIONS, keyGreen, type KeyOptions } from "./chroma.js";
import { encodePng } from "./png.js";
import {
  ComfyError,
  applyComfyInputs,
  detectComfyBindings,
  downloadComfyFile,
  normalizeComfyBaseUrl,
  parseComfyWorkflow,
  queryComfyImage,
  submitComfyVideo,
  uploadComfyImage,
  type ComfyRequest,
  type ComfyWorkflow
} from "./comfy.js";

// ── 类型 ────────────────────────────────────────────────────────────────────

/** 去背后端。auto = 先跑绿幕，判据不成立才改用模型。 */
export const MATTE_BACKENDS = ["auto", "keygreen", "birefnet"] as const;
export type MatteBackend = (typeof MATTE_BACKENDS)[number];

/** 内置 BiRefNet 去背工作流的 id（config.matteWorkflowId 的默认值）。 */
export const BUILTIN_MATTE_WORKFLOW_ID = "builtin.matte-birefnet";

/** 单帧超时上限（毫秒）。批量时逐帧独立计时，不是整批共用一个。 */
export const DEFAULT_MATTE_TIMEOUT_MS = 120_000;

/** 批量默认并发。ComfyUI 自己排队，这里只并行「上传 / 轮询 / 下载」这三段网络等待。 */
export const DEFAULT_MATTE_CONCURRENCY = 2;

/** auto 判据：绿幕几乎没抠掉东西（背景占比 < 5%）就认为这不是绿幕图。 */
export const AUTO_MIN_BACKGROUND_FRACTION = 0.05;
/** auto 判据：前景带绿色残留（彩边）超过 2% 就认为绿幕算法效果不够。 */
export const AUTO_MAX_GREEN_FRINGE = 0.02;

/** 真正执行去背的两种后端（auto 只是决策，不是执行者）。 */
export type MatteRunBackend = "keygreen" | "birefnet";

/** 一张图：RGBA 缓冲 + 尺寸。所有去背 API 都只吃这个。 */
export interface MatteInput {
  rgba: Buffer;
  width: number;
  height: number;
}

export interface MatteOptions {
  /** 覆盖 config.matteBackend（rematte 的任务级切换用）。 */
  backend?: MatteBackend;
  /** 绿幕参数，缺省用 chroma 的默认值。 */
  keying?: KeyOptions;
  /** 覆盖 config.matteFallback。false = 模型失败直接抛错，不静默降级。 */
  fallback?: boolean;
  /** 单帧超时（毫秒）。默认 120 秒。 */
  timeoutMs?: number;
  /** 是否使用内容哈希缓存（只有 birefnet 结果会缓存）。默认 true。 */
  cache?: boolean;
}

export interface MatteResult {
  rgba: Buffer;
  width: number;
  height: number;
  /** 实际跑了哪个后端（auto 会二选一，所以这里永远不是 auto）。 */
  backend: MatteRunBackend;
  /** 回退原因：非空表示「本该走模型、最后走了绿幕」（或 auto 判定用绿幕）。 */
  fallbackReason?: string;
  elapsedMs: number;
  /** 判定为背景的像素占比：绿幕下标定口径；模型下 = alpha < 128 的占比。 */
  backgroundFraction?: number;
  /** 绿幕诊断：边框采样点总数。 */
  borderSamples?: number;
  /** 绿幕诊断：被排除的边框采样点数（角色贴边时会 > 0）。 */
  borderSamplesDropped?: number;
  /** 绿幕诊断：是否真的用上了空间分割。 */
  usedSegmentation?: boolean;
  /** 绿幕结果里「明显偏绿」的前景像素占比（auto 判据用）。 */
  greenFringeFraction?: number;
  /** 结果来自缓存（没有真的提交 ComfyUI）。 */
  cached?: boolean;
  /** 实际用的工作流 id（birefnet 时）。 */
  workflowId?: string;
}

export interface MatteBatchOptions extends MatteOptions {
  /** 并发上限，默认 2。 */
  concurrency?: number;
  /** 每完成一帧回调一次（进度 / 日志用）。 */
  onProgress?: (done: number, total: number, result: MatteResult) => void;
}

/** 一次去背（单帧或一批）的汇总，写进 job.json 的 matte 节点。 */
export interface MatteJobInfo {
  /** 实际后端；一批里混用两种时为 mixed（auto 模式下可能发生）。 */
  backend: MatteRunBackend | "mixed";
  fallbackReason?: string;
  elapsedMs: number;
  frames: number;
  fallbackCount: number;
  cachedCount: number;
  workflowId?: string;
}

// ── PNG 解码（只支持 ComfyUI SaveImage 会产出的那种）─────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface DecodedPng {
  rgba: Buffer;
  width: number;
  height: number;
  /** PNG 颜色类型：6 = RGBA / 2 = RGB / 0 = 灰度 / 4 = 灰度 + alpha / 3 = 调色板。 */
  colorType: number;
  /** 是否带 alpha 通道（调色板要有 tRNS 才算）。 */
  hasAlpha: boolean;
}

function pngChannels(colorType: number): number {
  if (colorType === 6) return 4;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 0) return 1;
  if (colorType === 3) return 1;
  return 0;
}

/** 解 PNG → RGBA8。8 位、非隔行；这恰好是 ComfyUI SaveImage 的产出格式。 */
export function decodePngImage(bytes: Buffer): DecodedPng {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("去背输出不是 PNG（文件头不对）");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const idat: Buffer[] = [];
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) throw new Error("去背输出 PNG 被截断（块长度超出文件）");
    if (type === "IHDR") {
      width = bytes.readUInt32BE(start);
      height = bytes.readUInt32BE(start + 4);
      bitDepth = bytes[start + 8];
      colorType = bytes[start + 9];
      interlace = bytes[start + 12];
    } else if (type === "PLTE") {
      palette = Buffer.from(bytes.subarray(start, end));
    } else if (type === "tRNS") {
      transparency = Buffer.from(bytes.subarray(start, end));
    } else if (type === "IDAT") {
      idat.push(Buffer.from(bytes.subarray(start, end)));
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4;
  }
  if (width <= 0 || height <= 0) throw new Error("去背输出 PNG 没有有效的宽高");
  if (bitDepth !== 8) throw new Error(`去背输出 PNG 是 ${bitDepth} 位色深，只支持 8 位`);
  if (interlace !== 0) throw new Error("去背输出 PNG 用了隔行扫描，不支持");
  const channels = pngChannels(colorType);
  if (channels === 0) throw new Error(`去背输出 PNG 的颜色类型不支持：${colorType}`);
  if (idat.length === 0) throw new Error("去背输出 PNG 没有像素数据（IDAT 为空）");
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  if (raw.length < (stride + 1) * height) throw new Error("去背输出 PNG 的像素数据不足");

  const pixels = Buffer.alloc(stride * height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src];
    src += 1;
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[src + x];
      const left = x >= bpp ? pixels[rowStart + x - bpp] : 0;
      const up = y > 0 ? pixels[rowStart - stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? pixels[rowStart - stride + x - bpp] : 0;
      let out: number;
      switch (filter) {
        case 0:
          out = value;
          break;
        case 1:
          out = value + left;
          break;
        case 2:
          out = value + up;
          break;
        case 3:
          out = value + ((left + up) >> 1);
          break;
        case 4: {
          // Paeth：取「和左 / 上 / 左上最接近」的那个做差。PNG 规范的预测器，不能省。
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          out = value + predictor;
          break;
        }
        default:
          throw new Error(`去背输出 PNG 的行过滤类型不支持：${filter}`);
      }
      pixels[rowStart + x] = out & 0xff;
    }
    src += stride;
  }

  const count = width * height;
  const rgba = Buffer.alloc(count * 4);
  const hasAlpha = colorType === 6 || colorType === 4 || (colorType === 3 && transparency !== undefined);
  for (let i = 0; i < count; i++) {
    const s = i * bpp;
    const d = i * 4;
    if (colorType === 6) {
      rgba[d] = pixels[s];
      rgba[d + 1] = pixels[s + 1];
      rgba[d + 2] = pixels[s + 2];
      rgba[d + 3] = pixels[s + 3];
    } else if (colorType === 2) {
      rgba[d] = pixels[s];
      rgba[d + 1] = pixels[s + 1];
      rgba[d + 2] = pixels[s + 2];
      rgba[d + 3] = 255;
    } else if (colorType === 4) {
      rgba[d] = pixels[s];
      rgba[d + 1] = pixels[s];
      rgba[d + 2] = pixels[s];
      rgba[d + 3] = pixels[s + 1];
    } else if (colorType === 0) {
      const gray = pixels[s];
      rgba[d] = gray;
      rgba[d + 1] = gray;
      rgba[d + 2] = gray;
      // tRNS 给了「哪个灰度值算透明」；没给就是不透明。
      rgba[d + 3] = transparency !== undefined && transparency.length >= 2 && gray === ((transparency[0] << 8) | transparency[1]) ? 0 : 255;
    } else if (colorType === 3 && palette !== undefined) {
      const index = pixels[s];
      const p = index * 3;
      rgba[d] = palette[p] ?? 0;
      rgba[d + 1] = palette[p + 1] ?? 0;
      rgba[d + 2] = palette[p + 2] ?? 0;
      rgba[d + 3] = transparency !== undefined && index < transparency.length ? transparency[index] : 255;
    }
  }
  return { rgba, width, height, colorType, hasAlpha };
}

/**
 * 把「只有 mask」的输出合成成 RGBA：mask 的亮度就是前景不透明度（白 = 前景）。
 *
 * SaveImage 只收 IMAGE，所以只输出 MASK 的工作流一定经过了 MaskToImage，
 * 拿到的是一张 RGB 灰度图。这里按原图补回颜色，alpha 用亮度。
 */
export function composeMaskWithOriginal(original: Buffer, mask: DecodedPng): Buffer {
  const count = mask.width * mask.height;
  const out = Buffer.alloc(count * 4);
  for (let i = 0; i < count; i++) {
    const m = i * 4;
    const coverage = (mask.rgba[m] * 0.299 + mask.rgba[m + 1] * 0.587 + mask.rgba[m + 2] * 0.114) / 255;
    out[m] = original[m];
    out[m + 1] = original[m + 1];
    out[m + 2] = original[m + 2];
    out[m + 3] = Math.round(original[m + 3] * coverage);
  }
  return out;
}

// ── 内置工作流 ──────────────────────────────────────────────────────────────

/**
 * 内置 BiRefNet 去背工作流（API 格式）。
 *
 * 来源：本机 E:\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI (1)\\ComfyUI\\user\\default\\workflows\\
 * 游戏素材_抠图透明化_BiRefNet.json（界面格式），按 ComfyUI 的 API 格式重写：
 * 节点 id 与连线保持原样，控件值按 /object_info 的真实输入名映射
 * （LoadBackgroundRemovalModel 的输入名是 bg_removal_name，不是界面上显示的 bg_model）。
 *
 * 关键点：RemoveBackground 输出的 mask 方向是反的（背景 = 1），必须经 InvertMask
 * 再交给 JoinImageWithAlpha，否则角色变透明、背景留下 —— 这一点在
 * G:\\image\\.agents\\skills\\comfyui-2d-assets 的已知坑里写着，实测确认。
 */
const BUILTIN_MATTE_WORKFLOW: ComfyWorkflow = {
  "1": { class_type: "LoadImage", inputs: { image: "" }, _meta: { title: "墨盒 · 待去背图" } },
  "2": { class_type: "LoadBackgroundRemovalModel", inputs: { bg_removal_name: "birefnet.safetensors" } },
  "3": {
    class_type: "RemoveBackground",
    inputs: { bg_removal_model: ["2", 0], image: ["1", 0] },
    _meta: { title: "BiRefNet 去背" }
  },
  "4": { class_type: "InvertMask", inputs: { mask: ["3", 0] }, _meta: { title: "mask 反向（背景=1 → 前景=1）" } },
  "5": { class_type: "JoinImageWithAlpha", inputs: { image: ["1", 0], alpha: ["4", 0] } },
  "6": { class_type: "SaveImage", inputs: { images: ["5", 0], filename_prefix: "game-assets/cutout/asset" } }
};

/** 内置工作流的一份深拷贝（调用方可以随便注入，不污染模块常量）。 */
export function builtinMatteWorkflow(): ComfyWorkflow {
  return JSON.parse(JSON.stringify(BUILTIN_MATTE_WORKFLOW)) as ComfyWorkflow;
}

// ── 工作流解析 ──────────────────────────────────────────────────────────────

/**
 * 工作流解析器：返回 API 格式工作流；找不到返回 undefined（由调用方继续下一步）。
 *
 * 合并工作流库之后，Lead 可以用 setMatteWorkflowResolver() 把它接到
 * workflowlib.getWorkflow(id)；本分支不 import workflowlib.js（跨分支编译依赖），
 * 所以先退回读 <DSH_HOME>/inkbox/workflows/<id>.json。
 */
export type MatteWorkflowResolver = (id: string) => Promise<ComfyWorkflow | undefined>;

let workflowResolver: MatteWorkflowResolver | undefined;

export function setMatteWorkflowResolver(resolver: MatteWorkflowResolver | undefined): void {
  workflowResolver = resolver;
}

function looksLikeApiWorkflow(value: unknown): value is ComfyWorkflow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.values(value as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every((node) => node !== null && typeof node === "object" && typeof (node as Record<string, unknown>).class_type === "string");
}

/**
 * 解析 matteWorkflowId 对应的 API 格式工作流。
 *
 * 顺序：注册的解析器 → 内置 id → <DSH_HOME>/inkbox/workflows/<id>.json（工作流库落盘格式）
 * → 当成 .json 本机路径读。都失败时抛的错要能指导用户：给出尝试过的位置。
 */
export async function resolveMatteWorkflow(id: string): Promise<ComfyWorkflow> {
  const wanted = (id ?? "").trim();
  if (wanted === "" || wanted === BUILTIN_MATTE_WORKFLOW_ID) return builtinMatteWorkflow();
  const tried: string[] = [];
  if (workflowResolver !== undefined) {
    try {
      const resolved = await workflowResolver(wanted);
      if (resolved !== undefined && looksLikeApiWorkflow(resolved)) return JSON.parse(JSON.stringify(resolved)) as ComfyWorkflow;
    } catch {
      // 解析器自己失败不应阻断后面的兜底；失败原因由最终报错体现。
    }
    tried.push("工作流库解析器");
  }
  const libraryPath = join(dataRoot(), "workflows", `${wanted}.json`);
  tried.push(libraryPath);
  try {
    const info = await stat(libraryPath);
    if (info.isFile()) {
      const text = await readFile(libraryPath, "utf8");
      const workflow = workflowFromStored(safeParseJson(text));
      if (workflow !== undefined) return workflow;
    }
  } catch {
    // 文件不存在 / 读不了：继续尝试「按路径读」。
  }
  if (wanted.endsWith(".json")) {
    tried.push(wanted);
    try {
      const info = await stat(wanted);
      if (info.isFile()) {
        const text = await readFile(wanted, "utf8");
        const parsed = parseComfyWorkflow(text);
        if (parsed.ok === true) return parsed.workflow;
        throw new Error(`去背工作流文件解析失败：${parsed.error}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("去背工作流文件解析失败")) throw error;
    }
  }
  throw new Error(
    `找不到去背工作流「${wanted}」：需要内置 id（${BUILTIN_MATTE_WORKFLOW_ID}）、工作流库里的 id 或一个本机 .json 路径。` +
      `已尝试：${tried.join("、")}。可在设置页把「去背工作流」改回内置 id。`
  );
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * 工作流库落盘格式（<id>.json 里是 WorkflowEntry，正文在 workflow 字段）
 * 与「直接的 API 格式 JSON」两种都认。
 */
function workflowFromStored(value: unknown): ComfyWorkflow | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (looksLikeApiWorkflow(record.workflow)) return JSON.parse(JSON.stringify(record.workflow)) as ComfyWorkflow;
  if (looksLikeApiWorkflow(record)) return JSON.parse(JSON.stringify(record)) as ComfyWorkflow;
  // 界面格式（顶层 nodes / links）：交给 comfy.ts 的转换器，别在这里另写一套。
  const parsed = parseComfyWorkflow(JSON.stringify(record));
  return parsed.ok === true ? parsed.workflow : undefined;
}

// ── 配置读取 ────────────────────────────────────────────────────────────────

/** 当前生效的去背后端（非法值一律退回 keygreen = 老行为）。 */
export function matteBackendOf(config: Config): MatteBackend {
  const value = config?.matteBackend;
  return value === "birefnet" || value === "auto" || value === "keygreen" ? value : "keygreen";
}

/** 模型失败时是否回退绿幕（默认 true）。 */
export function matteFallbackOf(config: Config): boolean {
  return config?.matteFallback !== false;
}

/** 当前生效的去背工作流 id（空 = 内置）。 */
export function matteWorkflowIdOf(config: Config): string {
  const value = typeof config?.matteWorkflowId === "string" ? config.matteWorkflowId.trim() : "";
  return value === "" ? BUILTIN_MATTE_WORKFLOW_ID : value;
}

/** 任意值收敛成合法后端（auto 之外非法值退回 keygreen）。 */
export function normalizeBackend(value: unknown): MatteBackend {
  return value === "birefnet" || value === "auto" || value === "keygreen" ? value : "keygreen";
}

/** 把 unknown 错误转成给人看的文案。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── 绿幕 ────────────────────────────────────────────────────────────────────

/** 去背前后都用的绿幕参数兜底。 */
export function keyingOrDefault(keying: KeyOptions | undefined): KeyOptions {
  if (keying === undefined || keying === null) return { ...DEFAULT_KEY_OPTIONS };
  return {
    keyLow: numberOr(keying.keyLow, DEFAULT_KEY_OPTIONS.keyLow),
    keyHigh: numberOr(keying.keyHigh, DEFAULT_KEY_OPTIONS.keyHigh),
    despill: numberOr(keying.despill, DEFAULT_KEY_OPTIONS.despill),
    edgeShrink: numberOr(keying.edgeShrink, DEFAULT_KEY_OPTIONS.edgeShrink),
    bgTolerance: numberOr(keying.bgTolerance, DEFAULT_KEY_OPTIONS.bgTolerance)
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 「明显偏绿」的前景像素占比：绿优势值 > 40 且不完全透明的像素 / 总像素。 */
function greenFringeFraction(rgba: Buffer): number {
  const count = rgba.length / 4;
  if (count === 0) return 0;
  let bad = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    if (rgba[i + 1] - Math.max(rgba[i], rgba[i + 2]) > 40) bad++;
  }
  return bad / count;
}

/** 透明像素占比（alpha < 128）。 */
function transparentFraction(rgba: Buffer): number {
  const count = rgba.length / 4;
  if (count === 0) return 0;
  let transparent = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 128) transparent++;
  }
  return transparent / count;
}

function runKeyGreen(input: MatteInput, keying: KeyOptions): MatteResult {
  const started = Date.now();
  const result = keyGreen(input.rgba, input.width, input.height, keying);
  return {
    rgba: result.rgba,
    width: input.width,
    height: input.height,
    backend: "keygreen",
    elapsedMs: Date.now() - started,
    backgroundFraction: result.backgroundFraction,
    borderSamples: result.borderSamples,
    borderSamplesDropped: result.borderSamplesDropped,
    usedSegmentation: result.usedSegmentation,
    greenFringeFraction: greenFringeFraction(result.rgba)
  };
}

export interface AutoMatteDecision {
  /** true = 该改用模型。 */
  useModel: boolean;
  /** 给人看的原因（写进任务日志）。 */
  reason: string;
}

/**
 * auto 的判据：先跑绿幕，再判「这次绿幕靠不靠谱」。
 *
 * - 背景占比 < 5%：画面里几乎没有被判定为背景的像素 → 不是绿幕图（手绘 / 照片 / 渐变）；
 * - 前景绿色残留 > 2%：抠掉了大面，但角色边缘一圈绿边 → 绿幕效果不够；
 * - 其余情况认为绿幕可信（省一次模型推理，也避免模型把绿幕图裁坏）。
 */
export function assessAutoBackend(green: Pick<MatteResult, "backgroundFraction" | "greenFringeFraction">): AutoMatteDecision {
  const background = green.backgroundFraction ?? 0;
  const fringe = green.greenFringeFraction ?? 0;
  if (background < AUTO_MIN_BACKGROUND_FRACTION) {
    return {
      useModel: true,
      reason: `绿幕只抠掉 ${(background * 100).toFixed(1)}% 的背景（< ${(AUTO_MIN_BACKGROUND_FRACTION * 100).toFixed(0)}%），判定不是绿幕图`
    };
  }
  if (fringe > AUTO_MAX_GREEN_FRINGE) {
    return {
      useModel: true,
      reason: `前景有 ${(fringe * 100).toFixed(1)}% 的像素明显偏绿（> ${(AUTO_MAX_GREEN_FRINGE * 100).toFixed(0)}%），绿边太重`
    };
  }
  return {
    useModel: false,
    reason: `绿幕可信（背景占比 ${(background * 100).toFixed(1)}%，绿色残留 ${(fringe * 100).toFixed(2)}%）`
  };
}

// ── 缓存 ────────────────────────────────────────────────────────────────────

/** 去背缓存目录（只存 birefnet 结果；绿幕是纯 CPU 计算，没必要缓存）。 */
export function matteCacheDir(): string {
  return join(dataRoot(), "matte-cache");
}

/** 缓存格式版本：解码 / 合成口径变了就 +1，老缓存自动失效。 */
const MATTE_CACHE_VERSION = 1;

/** 缓存开关：显式 cache:false 或环境变量 INKBOX_MATTE_CACHE=0 时关闭（自检 / 排障用）。 */
export function matteCacheEnabled(options?: { cache?: boolean }): boolean {
  if (options?.cache === false) return false;
  return process.env.INKBOX_MATTE_CACHE !== "0";
}

/**
 * 同图同参数的缓存键：工作流正文 + 尺寸 + 像素一起哈希。
 *
 * 带上工作流正文而不是只带 id：换了模型名 / 改了节点，结果就不同，不能复用旧缓存。
 */
export function matteCacheKey(input: MatteInput, workflow: ComfyWorkflow): string {
  const hash = createHash("sha256");
  hash.update(`matte-v${MATTE_CACHE_VERSION}:${input.width}x${input.height}:`);
  hash.update(JSON.stringify(workflow));
  hash.update("\u0000");
  hash.update(input.rgba);
  return hash.digest("hex");
}

interface MatteCacheMeta {
  version: number;
  width: number;
  height: number;
  backend: MatteRunBackend;
  workflowId: string;
  createdAt: number;
}

async function readMatteCache(key: string, width: number, height: number): Promise<Buffer | undefined> {
  try {
    const meta = JSON.parse(await readFile(join(matteCacheDir(), `${key}.json`), "utf8")) as MatteCacheMeta;
    if (meta?.version !== MATTE_CACHE_VERSION || meta.width !== width || meta.height !== height) return undefined;
    const rgba = await readFile(join(matteCacheDir(), `${key}.rgba`));
    if (rgba.length !== width * height * 4) return undefined;
    return Buffer.from(rgba);
  } catch {
    return undefined;
  }
}

async function writeMatteCache(key: string, rgba: Buffer, meta: Omit<MatteCacheMeta, "version" | "createdAt">): Promise<void> {
  try {
    await mkdir(matteCacheDir(), { recursive: true });
    const payload: MatteCacheMeta = { version: MATTE_CACHE_VERSION, createdAt: Date.now(), ...meta };
    await writeFile(join(matteCacheDir(), `${key}.rgba`), rgba);
    await writeFile(join(matteCacheDir(), `${key}.json`), `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    // 缓存写失败不影响去背本身（下次再算一遍而已）。
  }
}

// ── BiRefNet（ComfyUI）──────────────────────────────────────────────────────

/** 一次去背请求的参数（只约束单次 HTTP；整个任务超时由 deadline 控制）。 */
function comfyRequestFor(config: Config, timeoutMs: number): ComfyRequest {
  return {
    baseUrl: normalizeComfyBaseUrl(config?.comfyBaseUrl),
    timeoutMs: Math.max(5000, Math.min(Math.round(timeoutMs), 60_000)),
    cookies: typeof config?.comfyCookies === "string" ? config.comfyCookies : ""
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 把上传后的文件名注入工作流：优先 LoadImage（替换 image），否则按探测结果插节点。 */
function injectMatteImage(workflow: ComfyWorkflow, name: string): ComfyWorkflow {
  const detected = detectComfyBindings(workflow);
  if (detected.bindings.first === undefined) {
    const note = detected.notes.length > 0 ? `（${detected.notes.join("；")}）` : "";
    throw new Error(
      "去背工作流里没有接收输入图的位置" + note + "：需要有一个 LoadImage 节点，或一个 first / image 之类的 IMAGE 输入。" +
        "可在 ComfyUI 里把待去背图接到 LoadImage 上，再把工作流另存为 API 格式导入。"
    );
  }
  const applied = applyComfyInputs(workflow, detected.bindings, { firstImageName: name });
  return applied.workflow;
}

/** 真正提交一次 BiRefNet：上传 → 提交 → 轮询 → 取回 → 校验尺寸 → 合成 RGBA。 */
async function runBirefnet(config: Config, input: MatteInput, options: MatteOptions, signal?: AbortSignal): Promise<MatteResult> {
  const started = Date.now();
  const timeoutMs = typeof options.timeoutMs === "number" && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_MATTE_TIMEOUT_MS;
  const deadline = started + timeoutMs;
  const workflowId = matteWorkflowIdOf(config);
  const request = comfyRequestFor(config, timeoutMs);

  const ensureAlive = (): void => {
    if (signal?.aborted === true) throw new Error("去背任务已取消");
    if (Date.now() > deadline) throw new Error(`BiRefNet 去背超时（${Math.round(timeoutMs / 1000)} 秒）`);
  };

  const workflow = await resolveMatteWorkflow(workflowId);
  ensureAlive();
  const cacheKey = matteCacheKey(input, workflow);
  if (matteCacheEnabled(options)) {
    const cached = await readMatteCache(cacheKey, input.width, input.height);
    if (cached !== undefined) {
      return {
        rgba: cached,
        width: input.width,
        height: input.height,
        backend: "birefnet",
        elapsedMs: Date.now() - started,
        backgroundFraction: transparentFraction(cached),
        cached: true,
        workflowId
      };
    }
  }

  ensureAlive();
  const png = encodePng(input.rgba, input.width, input.height);
  const name = await uploadComfyImage(request, `data:image/png;base64,${png.toString("base64")}`, "matte");
  ensureAlive();
  const prepared = injectMatteImage(workflow, name);
  const promptId = await submitComfyVideo({ ...request, workflow: prepared });
  ensureAlive();

  // 轮询：ComfyUI 的 history 只有跑完才出现，期间用 /queue 区分「排队」与「执行」。
  let file: { filename: string; subfolder?: string; type?: string } | undefined;
  for (;;) {
    ensureAlive();
    const state = await queryComfyImage({ ...request, promptId });
    if (state.status === "failed") throw new Error(state.error ?? "ComfyUI 执行去背工作流失败");
    if (state.status === "succeeded" && state.file !== undefined) {
      file = state.file;
      break;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`BiRefNet 去背超时（${Math.round(timeoutMs / 1000)} 秒）`);
    await sleep(Math.min(500, remaining));
  }
  ensureAlive();
  const bytes = await downloadComfyFile(request, file);
  const decoded = decodePngImage(bytes);
  if (decoded.width !== input.width || decoded.height !== input.height) {
    throw new Error(
      `BiRefNet 输出尺寸 ${decoded.width}×${decoded.height} 与原图 ${input.width}×${input.height} 不一致（可能工作流里带了缩放节点）` +
        `。去背不允许改尺寸，请在 ComfyUI 里把工作流改成与原图同尺寸。`
    );
  }
  const rgba = decoded.hasAlpha ? decoded.rgba : composeMaskWithOriginal(input.rgba, decoded);
  if (matteCacheEnabled(options)) {
    await writeMatteCache(cacheKey, rgba, { width: input.width, height: input.height, backend: "birefnet", workflowId });
  }
  return {
    rgba,
    width: input.width,
    height: input.height,
    backend: "birefnet",
    elapsedMs: Date.now() - started,
    backgroundFraction: transparentFraction(rgba),
    workflowId
  };
}

// ── 对外入口 ────────────────────────────────────────────────────────────────

/** 单张去背。默认后端 = config.matteBackend；失败按 config.matteFallback 回退绿幕。 */
export async function matteOne(config: Config, input: MatteInput, options: MatteOptions = {}, signal?: AbortSignal): Promise<MatteResult> {
  if (input?.rgba === undefined || input.rgba.length < input.width * input.height * 4) {
    throw new Error(`去背输入不是完整的 RGBA：期望 ${input.width * input.height * 4} 字节，实际 ${input?.rgba?.length ?? 0}`);
  }
  const backend = normalizeBackend(options.backend ?? matteBackendOf(config));
  const keying = keyingOrDefault(options.keying);
  const fallback = options.fallback ?? matteFallbackOf(config);
  if (backend === "keygreen") return runKeyGreen(input, keying);

  if (backend === "auto") {
    const green = runKeyGreen(input, keying);
    const decision = assessAutoBackend(green);
    if (!decision.useModel) return green;
    try {
      return await runBirefnet(config, input, options, signal);
    } catch (error) {
      const reason = messageOf(error);
      if (!fallback) throw error;
      return { ...green, fallbackReason: `auto 判定改用 BiRefNet 失败：${reason}` };
    }
  }

  try {
    return await runBirefnet(config, input, options, signal);
  } catch (error) {
    const reason = messageOf(error);
    if (!fallback) throw error;
    const green = runKeyGreen(input, keying);
    return { ...green, fallbackReason: reason };
  }
}

/**
 * 批量去背：结果顺序与输入一致；并发默认 2（见 DEFAULT_MATTE_CONCURRENCY）。
 *
 * 任何一张未开启回退的失败会向上抛（调用方把该阶段标 error），其它张已经跑完的
 * 结果不会丢 —— 与原来「逐帧 keyGreen，抛错就整段失败」的语义一致。
 */
export async function matteBatch(
  config: Config,
  inputs: MatteInput[],
  options: MatteBatchOptions = {},
  signal?: AbortSignal
): Promise<MatteResult[]> {
  const results: MatteResult[] = new Array(inputs.length);
  if (inputs.length === 0) return results;
  const concurrency = Math.max(1, Math.min(inputs.length, Math.round(options.concurrency ?? DEFAULT_MATTE_CONCURRENCY)));
  // 只把真正属于 MatteOptions 的字段往下传：batch 自己的 concurrency / onProgress
  // 不是单帧参数，混进去会让 matteOne 的类型收窄失败（也不会用上）。
  const single: MatteOptions = {
    backend: options.backend,
    keying: options.keying,
    fallback: options.fallback,
    timeoutMs: options.timeoutMs,
    cache: options.cache
  };
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= inputs.length) return;
      const result = await matteOne(config, inputs[index], single, signal);
      results[index] = result;
      done += 1;
      options.onProgress?.(done, inputs.length, result);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

/** 一批结果的汇总（写 job.json 的 matte 节点 + 任务日志）。 */
export function summarizeMatte(results: Array<MatteResult | undefined>): MatteJobInfo | undefined {
  const list = results.filter((result): result is MatteResult => result !== undefined);
  if (list.length === 0) return undefined;
  const backendSet = new Set(list.map((result) => result.backend));
  const backend: MatteRunBackend | "mixed" = backendSet.size === 1 ? [...backendSet][0] : "mixed";
  const fallbacks = list.filter((result) => typeof result.fallbackReason === "string" && result.fallbackReason !== "");
  const uniqueReasons: string[] = [];
  for (const result of fallbacks) {
    if (result.fallbackReason !== undefined && !uniqueReasons.includes(result.fallbackReason)) uniqueReasons.push(result.fallbackReason);
  }
  const workflowId = list.find((result) => result.workflowId !== undefined)?.workflowId;
  return {
    backend,
    ...(uniqueReasons.length === 0 ? {} : { fallbackReason: uniqueReasons[0] }),
    elapsedMs: list.reduce((sum, result) => sum + result.elapsedMs, 0),
    frames: list.length,
    fallbackCount: fallbacks.length,
    cachedCount: list.filter((result) => result.cached === true).length,
    ...(workflowId === undefined ? {} : { workflowId })
  };
}

/**
 * 把多个 `MatteJobInfo`（例如 8 个方向各自的汇总）合成一条。
 *
 * `summarizeMatte` 处理的是「一帧一张 result」，这里处理的是「已经汇总过的若干批」，
 * 所以 frames / elapsedMs / fallbackCount 都是**求和**，backend 混用记 mixed。
 */
export function combineMatteInfos(infos: Array<MatteJobInfo | undefined>): MatteJobInfo | undefined {
  const list = infos.filter((info): info is MatteJobInfo => info !== undefined);
  if (list.length === 0) return undefined;
  const backendSet = new Set(list.map((info) => info.backend));
  const backend: MatteRunBackend | "mixed" = backendSet.size === 1 ? [...backendSet][0] : "mixed";
  const uniqueReasons: string[] = [];
  for (const info of list) {
    if (info.fallbackReason !== undefined && !uniqueReasons.includes(info.fallbackReason)) uniqueReasons.push(info.fallbackReason);
  }
  const workflowId = list.find((info) => info.workflowId !== undefined)?.workflowId;
  return {
    backend,
    ...(uniqueReasons.length === 0 ? {} : { fallbackReason: uniqueReasons[0] }),
    elapsedMs: list.reduce((sum, info) => sum + info.elapsedMs, 0),
    frames: list.reduce((sum, info) => sum + info.frames, 0),
    fallbackCount: list.reduce((sum, info) => sum + info.fallbackCount, 0),
    cachedCount: list.reduce((sum, info) => sum + info.cachedCount, 0),
    ...(workflowId === undefined ? {} : { workflowId })
  };
}

/**
 * 从 job.json 读回的 `matte` 节点做归一化：旧任务没有这个字段 → undefined；
 * 字段残缺（手改过 JSON / 老版本）时补默认值，不让界面拿到半截对象。
 */
export function matteJobInfoFrom(value: unknown): MatteJobInfo | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const backend = record.backend;
  if (backend !== "keygreen" && backend !== "birefnet" && backend !== "mixed") return undefined;
  return {
    backend,
    fallbackReason: typeof record.fallbackReason === "string" ? record.fallbackReason : undefined,
    elapsedMs: typeof record.elapsedMs === "number" ? record.elapsedMs : 0,
    frames: typeof record.frames === "number" ? record.frames : 0,
    fallbackCount: typeof record.fallbackCount === "number" ? record.fallbackCount : 0,
    cachedCount: typeof record.cachedCount === "number" ? record.cachedCount : 0,
    workflowId: typeof record.workflowId === "string" ? record.workflowId : undefined
  };
}

/** 一句话描述这次去背（任务日志用）。 */
export function describeMatte(info: MatteJobInfo | undefined): string {
  if (info === undefined) return "去背后端：？（没有拿到任何帧的结果）";
  const backendLabel = info.backend === "birefnet" ? "BiRefNet" : info.backend === "keygreen" ? "绿幕" : "BiRefNet + 绿幕混合";
  const parts = [`去背后端：${backendLabel}`, `${info.frames} 帧`, `${(info.elapsedMs / 1000).toFixed(1)} 秒`];
  if (info.cachedCount > 0) parts.push(`缓存命中 ${info.cachedCount} 帧`);
  if (info.fallbackCount > 0) parts.push(`回退 ${info.fallbackCount} 帧`);
  const text = parts.join(" / ");
  return info.fallbackReason === undefined ? text : `${text}（原因：${info.fallbackReason}）`;
}

/** 给外部（自检 / 排障）用：ComfyUI 不可用时抛的错要能区分「连不上」与「工作流错」。 */
export function isComfyUnavailable(error: unknown): boolean {
  return error instanceof ComfyError && /无法连接本地 ComfyUI/.test(error.message);
}
