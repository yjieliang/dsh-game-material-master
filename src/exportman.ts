/**
 * 引擎导出：manifest v1 / Godot SpriteFrames `.tres` / Aseprite JSON / 帧序列 / zip。
 *
 * 为什么单独成模块：导出是**只读派生**（读整图 → 算帧矩形 → 写文本产物），不参与
 * 生图 / 视频 / 抽帧的编排，也不需要任务表与 receipt。放在这里可以用
 * `scripts/verify-export.mjs` 在临时数据目录里拿「真合成出来的整图」跑一遍完整导出，
 * 不必拉起整个网关。
 *
 * 格式依据（**只参考格式，不搬代码**）：
 *   - `G:\image\sprite-gen\docs\engine-export.md`：Aseprite JSON 的 frames / frameTags / meta.image 映射；
 *   - `G:\image\.agents\skills\minimax-h3-walk-cycle\scripts\export_godot_spriteframes.py`：
 *     Godot 4 `SpriteFrames`（`format=3`）文本结构、`AtlasTexture` 的 `region = Rect2(...)`、
 *     `duration` 的单位是 `1/speed` 秒、`metadata/autoplay` 写在 `[resource]` 段。
 *   - 设计文档 `docs/墨盒-skill能力合并-重构设计.md` §7（manifest v1 / zip 结构）。
 *
 * 四条「错了不会报错、只会解压出来引擎打不开」的硬约束：
 *   1. 帧顺序 = **行优先**；每行一个方向，行序取**项目实际合成整图时用的 rowOrder**
 *      （不是当前 settings）。对不上就**直接报错**，不猜、不静默改（设计 §7.1）。
 *   2. 整图尺寸必须**恰好**等于 `cell × (columns, rows)`。改过单格尺寸 / 帧数却没重新
 *      合成整图的项目会在这里被拦下，而不是导出一张切歪的图。
 *   3. zip 走 `src/zip.ts`（时间戳写死、UTF-8 位标记、正斜杠路径），同一份输入永远
 *      得到逐字节相同的 zip。
 *   4. 不碰既有 `out/` 命名：新产物只落 `out/engine/<name>/` 与 `out/<name>-engine.zip`，
 *      `exportImages` 打的那份 `<项目名>-images.zip` 里保留了项目内相对路径，语义不变。
 *
 * pivot 口径：整图合成时角色是**贴底**放置的（脚底落在 `cellHeight - bottomMargin`，
 * 见 `src/chroma.ts` 的 `composeSheet`），所以 manifest 里的 pivot 用归一化坐标
 * `(0.5, (cellHeight - bottomMargin) / cellHeight)` 表达「脚底线」。改过底部留白
 * 之后要重新合成整图，否则 pivot 会偏。
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { inflateSync } from "node:zlib";
import { appendJobLog } from "./jsonio.js";
import { encodePng } from "./png.js";
import { readSequenceJob, sequenceAssetPath, writeSequenceJob, type SequenceJob } from "./seqgen.js";
import { assetPath, log as logProject, patchProject, readProject, type Project } from "./store.js";
import { zipEntries, type ZipEntry } from "./zip.js";

// ── 常量 ────────────────────────────────────────────────────────────────

/** manifest 版本号（设计 §7.1 的 format 字段）。 */
export const MANIFEST_FORMAT = "inkbox-sprite@1";
/** 帧率默认值（项目里没有 fps 概念；行走循环 10 fps 是常见口径，可被导出参数覆盖）。 */
export const DEFAULT_EXPORT_FPS = 10;
export const EXPORT_FPS_MIN = 1;
export const EXPORT_FPS_MAX = 60;
/** 导出根目录（项目内相对路径）。out 已在静态资源白名单里，所以无需改路由。 */
export const EXPORT_ROOT = "out/engine";
/** 整图在导出目录里的文件名（设计 §7.4，与 sprite-gen 的约定一致）。 */
export const SHEET_FILE_NAME = "sprite-sheet.png";
/** 可勾选的导出内容；zip = 再把上面勾中的内容打成一个包。 */
export const SPRITE_EXPORT_FORMATS = ["sheet", "frames", "manifest", "godot", "aseprite", "zip"] as const;
export type SpriteExportFormat = (typeof SPRITE_EXPORT_FORMATS)[number];
/** 新装 / 没配过时的默认勾选（设计 §9.1 的 exportDefaults 默认值）。 */
export const DEFAULT_EXPORT_FORMATS: readonly SpriteExportFormat[] = ["manifest"];
/** 一帧多少毫秒（整数 fps 下四舍五入到整毫秒；Godot 侧用 speed + duration 表达，不吃这个数）。 */
export function frameDurationMs(fps: number): number {
  return Math.max(1, Math.round(1000 / fps));
}

/** 导出错误码。用户能看到的每一类「对不上」都有独立 code，自检按 code 断言。 */
export type ExportErrorCode =
  | "project-not-found"
  | "job-not-found"
  | "target-missing"
  | "target-ambiguous"
  | "sheet-missing"
  | "sheet-unreadable"
  | "sheet-size-mismatch"
  | "png-invalid"
  | "png-unsupported"
  | "manifest-invalid"
  | "fps-invalid"
  | "duration-invalid"
  | "direction-count-mismatch"
  | "direction-invalid"
  | "frame-count-mismatch"
  | "frame-order-mismatch"
  | "frame-layout-mismatch"
  | "frame-cell-mismatch"
  | "frame-rect-out-of-bounds"
  | "frame-rect-overlap"
  | "format-invalid"
  | "export-empty"
  | "name-invalid";

export class ExportError extends Error {
  readonly code: ExportErrorCode;
  constructor(code: ExportErrorCode, message: string) {
    super(message);
    this.name = "ExportError";
    this.code = code;
  }
}

export function isExportError(value: unknown): value is ExportError {
  return value instanceof ExportError;
}

function fail(code: ExportErrorCode, message: string): never {
  throw new ExportError(code, message);
}

// ── manifest ────────────────────────────────────────────────────────────

export interface SpriteManifestFrame {
  /** 行优先的全局序号（0 … columns*rows-1）。 */
  index: number;
  row: number;
  column: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 每帧时长（毫秒）。 */
  durationMs: number;
}

export interface SpriteManifest {
  format: string;
  name: string;
  cell: { width: number; height: number };
  columns: number;
  rows: number;
  fps: number;
  loop: boolean;
  /** 归一化脚底线：x = 0.5、y = (cellHeight - bottomMargin) / cellHeight。 */
  pivot: { x: number; y: number };
  frameLayout: SpriteManifestFrame[];
  /** 行序 = 方向（模块① 是 front/downLeft/…，模块③ 是单行 action）。 */
  directions: string[];
  source: {
    module: "sprite" | "sequence";
    projectId?: string;
    jobId?: string;
    /** 整图在项目 / 任务内的相对路径。 */
    sheet: string;
    /** 脱敏后的生成参数（不含任何 Key）。 */
    settings: Record<string, unknown>;
  };
  generatedAt: string;
}

/** 已解析好的整图来源（宿主侧读盘 + 解码后交给纯函数用）。 */
export interface SheetExportSource {
  module: "sprite" | "sequence";
  /** 项目 id / 任务 id。 */
  id: string;
  /** 用户可读名（manifest.name 默认值）。 */
  name: string;
  /** 整图在项目 / 任务内的相对路径。 */
  sheetFile: string;
  /** 整图原始字节（写进 bundle 的 sprite-sheet.png）。 */
  sheetBytes: Buffer;
  /** 整图像素（切帧用；与 sheetBytes 是同一张图）。 */
  sheetRgba: Buffer;
  sheetWidth: number;
  sheetHeight: number;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  directions: string[];
  fps: number;
  loop: boolean;
  pivot: { x: number; y: number };
  settings: Record<string, unknown>;
  /** 解析阶段发现的可容忍问题（写进导出结果的 warnings）。 */
  warnings: string[];
}

/** 每行动画的引擎名：模块① 加 _walk 后缀（设计 §7.2），模块③ 就是那一行的标签。 */
export function animationNameOf(module: "sprite" | "sequence", direction: string): string {
  return module === "sprite" ? `${direction}_walk` : direction;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * 由「整图 + 单格尺寸 + 行序」生成 manifest v1。
 *
 * 纯函数：不读盘、不猜尺寸。对不上整图的情况交给 assertFrameAlignment。
 */
export function buildManifest(source: SheetExportSource): SpriteManifest {
  const { columns, rows, cellWidth, cellHeight, directions } = source;
  if (!Number.isInteger(columns) || columns < 1) fail("manifest-invalid", `列数非法：${columns}（必须是 ≥1 的整数）`);
  if (!Number.isInteger(rows) || rows < 1) fail("manifest-invalid", `行数非法：${rows}（必须是 ≥1 的整数）`);
  if (!Number.isInteger(cellWidth) || cellWidth < 1) fail("manifest-invalid", `单格宽非法：${cellWidth}`);
  if (!Number.isInteger(cellHeight) || cellHeight < 1) fail("manifest-invalid", `单格高非法：${cellHeight}`);
  if (!Array.isArray(directions) || directions.length !== rows)
    fail("direction-count-mismatch", `方向数 ${Array.isArray(directions) ? directions.length : "?"} 与行数 ${rows} 不一致`);
  const fps = Math.round(source.fps);
  if (!Number.isFinite(fps) || fps < EXPORT_FPS_MIN || fps > EXPORT_FPS_MAX)
    fail("fps-invalid", `帧率非法：${source.fps}（允许 ${EXPORT_FPS_MIN}~${EXPORT_FPS_MAX}）`);

  const durationMs = frameDurationMs(fps);
  const frameLayout: SpriteManifestFrame[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      frameLayout.push({
        index: row * columns + column,
        row,
        column,
        x: column * cellWidth,
        y: row * cellHeight,
        w: cellWidth,
        h: cellHeight,
        durationMs
      });
    }
  }

  return {
    format: MANIFEST_FORMAT,
    name: source.name,
    cell: { width: cellWidth, height: cellHeight },
    columns,
    rows,
    fps,
    loop: source.loop !== false,
    pivot: { x: round4(source.pivot?.x ?? 0.5), y: round4(source.pivot?.y ?? 1) },
    frameLayout,
    directions: directions.slice(),
    source: {
      module: source.module,
      ...(source.module === "sprite" ? { projectId: source.id } : { jobId: source.id }),
      sheet: source.sheetFile,
      settings: { ...source.settings }
    },
    generatedAt: new Date().toISOString()
  };
}


/**
 * 逐帧对齐校验（设计 §7.1）——**不一致直接报错**，不做任何「修正」。
 *
 * 检查项：数量 / 顺序（index、row、column）/ 矩形与行列一致 / 单帧宽高 = 单格 /
 * 不越界 / 两两不重叠 / 整图尺寸 = cell × (columns, rows) / 方向数 = 行数 / fps 与时长合法。
 */
export function assertFrameAlignment(manifest: SpriteManifest, sheet: { width: number; height: number }): void {
  if (manifest === null || typeof manifest !== "object") fail("manifest-invalid", "manifest 不是对象");
  const { columns, rows, cell, frameLayout } = manifest;
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1)
    fail("manifest-invalid", `columns / rows 非法：${columns} × ${rows}`);
  if (!cell || !Number.isInteger(cell.width) || cell.width < 1 || !Number.isInteger(cell.height) || cell.height < 1)
    fail("manifest-invalid", `cell 非法：${JSON.stringify(cell)}`);
  if (!Number.isFinite(manifest.fps) || manifest.fps < EXPORT_FPS_MIN || manifest.fps > EXPORT_FPS_MAX)
    fail("fps-invalid", `fps 非法：${manifest.fps}`);
  if (!Array.isArray(manifest.directions) || manifest.directions.length !== rows)
    fail("direction-count-mismatch", `directions 数量 ${Array.isArray(manifest.directions) ? manifest.directions.length : "?"} ≠ 行数 ${rows}`);
  if (!Array.isArray(frameLayout)) fail("manifest-invalid", "frameLayout 不是数组");
  if (frameLayout.length !== columns * rows)
    fail("frame-count-mismatch", `frameLayout 有 ${frameLayout.length} 帧，期望 ${columns}×${rows}=${columns * rows} 帧`);
  if (!sheet || !Number.isInteger(sheet.width) || !Number.isInteger(sheet.height) || sheet.width < 1 || sheet.height < 1)
    fail("sheet-size-mismatch", `整图尺寸非法：${JSON.stringify(sheet)}`);
  if (sheet.width !== cell.width * columns || sheet.height !== cell.height * rows)
    fail(
      "sheet-size-mismatch",
      `整图 ${sheet.width}×${sheet.height} ≠ 单格 ${cell.width}×${cell.height} × ${columns}列×${rows}行（${cell.width * columns}×${cell.height * rows}）`
    );

  for (let index = 0; index < frameLayout.length; index++) {
    const frame = frameLayout[index];
    if (frame === null || typeof frame !== "object") fail("manifest-invalid", `frameLayout[${index}] 不是对象`);
    if (frame.index !== index)
      fail("frame-order-mismatch", `frameLayout[${index}].index = ${frame.index}，期望 ${index}（必须行优先且连续）`);
    const expectRow = Math.floor(index / columns);
    const expectColumn = index % columns;
    if (frame.row !== expectRow || frame.column !== expectColumn)
      fail("frame-order-mismatch", `frameLayout[${index}] 的 (row, column) = (${frame.row}, ${frame.column})，期望 (${expectRow}, ${expectColumn})`);
    if (frame.x !== expectColumn * cell.width || frame.y !== expectRow * cell.height)
      fail(
        "frame-layout-mismatch",
        `frameLayout[${index}] 的 (x, y) = (${frame.x}, ${frame.y})，期望 (${expectColumn * cell.width}, ${expectRow * cell.height})`
      );
    if (frame.w !== cell.width || frame.h !== cell.height)
      fail("frame-cell-mismatch", `frameLayout[${index}] 的 (w, h) = (${frame.w}, ${frame.h})，期望 (${cell.width}, ${cell.height})`);
    if (!Number.isFinite(frame.durationMs) || frame.durationMs <= 0)
      fail("duration-invalid", `frameLayout[${index}].durationMs 非法：${frame.durationMs}`);
    if (frame.x < 0 || frame.y < 0 || frame.x + frame.w > sheet.width || frame.y + frame.h > sheet.height)
      fail(
        "frame-rect-out-of-bounds",
        `frameLayout[${index}] 的矩形 (${frame.x}, ${frame.y}, ${frame.w}, ${frame.h}) 越出整图 ${sheet.width}×${sheet.height}`
      );
  }

  // 两两不重叠：矩形是按行列切的，正常情况天然不重叠；这里仍独立算一遍，
  // 免得「行优先 + cell 计算」被改动时重叠问题悄悄溜过去（设计 §7.1 明确要求校验）。
  for (let a = 0; a < frameLayout.length; a++) {
    for (let b = a + 1; b < frameLayout.length; b++) {
      const first = frameLayout[a];
      const second = frameLayout[b];
      const overlap =
        first.x < second.x + second.w &&
        second.x < first.x + first.w &&
        first.y < second.y + second.h &&
        second.y < first.y + first.h;
      if (overlap)
        fail(
          "frame-rect-overlap",
          `frameLayout[${a}] 与 frameLayout[${b}] 重叠：(${first.x},${first.y},${first.w},${first.h}) / (${second.x},${second.y},${second.w},${second.h})`
        );
    }
  }
}

// ── PNG 解码（最小实现，零依赖）──────────────────────────────────────────
//
// src/png.ts 只做编码（设计原话：解码交给 ffmpeg）。导出这条路**不能依赖 ffmpeg**：
// 自检脚本要纯本地跑、「整图」本来就是本插件用 encodePng 写出来的。所以这里补一个
// 只覆盖自己产物形态（8 位、非交错、RGBA/RGB/灰度）的最小解码器；遇到别的 PNG
// 明确报 png-unsupported，绝不静默按错误尺寸切图。

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA8，长度 = width * height * 4。 */
  rgba: Buffer;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 解码 PNG（8 位、非交错、颜色类型 0/2/6）。资产损坏抛 png-invalid，形态不支持抛 png-unsupported。 */
export function decodePng(bytes: Buffer): DecodedPng {
  if (!Buffer.isBuffer(bytes) || bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE))
    fail("png-invalid", "不是 PNG 文件（文件头不对）");

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let sawHeader = false;
  const idat: Buffer[] = [];
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) fail("png-invalid", `PNG 数据块越界：${type}`);
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      if (length < 13) fail("png-invalid", "IHDR 长度不足");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
      sawHeader = true;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!sawHeader) fail("png-invalid", "PNG 缺 IHDR");
  if (width < 1 || height < 1) fail("png-invalid", `PNG 尺寸非法：${width}×${height}`);
  if (bitDepth !== 8) fail("png-unsupported", `只支持 8 位 PNG（这张是 ${bitDepth} 位）`);
  if (interlace !== 0) fail("png-unsupported", "不支持隔行扫描（interlaced）PNG");
  if (colorType !== 6 && colorType !== 2 && colorType !== 0)
    fail("png-unsupported", `不支持的颜色类型：${colorType}（支持 灰8 / RGB8 / RGBA8）`);
  if (idat.length === 0) fail("png-invalid", "PNG 没有 IDAT 数据");

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * channels;
  const expected = stride * height;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    fail("png-invalid", "PNG 的 IDAT 解压失败（文件损坏）");
  }
  if (raw.length < expected + height) fail("png-invalid", `PNG 像素数据长度不足：${raw.length} < ${expected + height}`);

  const pixels = Buffer.alloc(expected);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[pos + x];
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const up = y > 0 ? pixels[rowStart - stride + x] : 0;
      const upLeft = x >= channels && y > 0 ? pixels[rowStart - stride + x - channels] : 0;
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
        case 4:
          out = value + paethPredictor(left, up, upLeft);
          break;
        default:
          fail("png-invalid", `PNG 行过滤类型非法：${filter}（第 ${y} 行）`);
      }
      pixels[rowStart + x] = out & 0xff;
    }
    pos += stride;
  }

  if (channels === 4) return { width, height, rgba: pixels };
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (channels === 3) {
      rgba[i * 4] = pixels[i * 3];
      rgba[i * 4 + 1] = pixels[i * 3 + 1];
      rgba[i * 4 + 2] = pixels[i * 3 + 2];
    } else {
      const gray = pixels[i];
      rgba[i * 4] = gray;
      rgba[i * 4 + 1] = gray;
      rgba[i * 4 + 2] = gray;
    }
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

// ── 切帧 ────────────────────────────────────────────────────────────────

export interface SheetFrameSlice {
  index: number;
  row: number;
  column: number;
  /** 这一帧所属的方向（= 行序里的方向 key）。 */
  direction: string;
  /** 帧号（0 起，行内序号）。 */
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rgba: Buffer;
}

/**
 * 按 manifest 的矩形把整图切成逐帧 RGBA。
 *
 * 调用前必须先过 assertFrameAlignment：这里只负责取像素，不重复做校验。
 */
export function sliceSheetFrames(rgba: Buffer, sheetWidth: number, sheetHeight: number, manifest: SpriteManifest): SheetFrameSlice[] {
  const expected = sheetWidth * sheetHeight * 4;
  if (rgba.length < expected) fail("png-invalid", `RGBA 缓冲区太小：${rgba.length} < ${expected}`);
  if (!Array.isArray(manifest.frameLayout)) fail("manifest-invalid", "frameLayout 不是数组");
  const out: SheetFrameSlice[] = [];
  for (const frame of manifest.frameLayout) {
    const { x, y, w, h } = frame;
    if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > sheetWidth || y + h > sheetHeight)
      fail("frame-rect-out-of-bounds", `第 ${frame.index} 帧的矩形越界`);
    const slice = Buffer.alloc(w * h * 4);
    for (let row = 0; row < h; row++) {
      const from = ((y + row) * sheetWidth + x) * 4;
      rgba.copy(slice, row * w * 4, from, from + w * 4);
    }
    out.push({
      index: frame.index,
      row: frame.row,
      column: frame.column,
      direction: manifest.directions[frame.row] ?? String(frame.row),
      frame: frame.column,
      x,
      y,
      w,
      h,
      rgba: slice
    });
  }
  return out;
}

// ── Godot SpriteFrames ──────────────────────────────────────────────────

export interface GodotSpriteFramesOptions {
  /** 整图在 Godot 里的资源路径（res://…）。 */
  texturePath: string;
}

/** 数字 → .tres 字面量：整数原样，浮点去尾零（与 Godot saver / 参考实现同一种写法）。 */
function txtNumber(value: number, digits = 4): string {
  if (Number.isInteger(value)) return String(value);
  const fixed = value.toFixed(digits);
  return fixed.replace(/0+$/u, "").replace(/\.$/u, "");
}

/** duration 用显式小数（Godot 侧是 float；写 1.0000 比 1 更贴近官方 saver）。 */
function txtSeconds(value: number): string {
  return value.toFixed(4);
}

function escapeGodotString(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

function moduleOf(manifest: SpriteManifest): "sprite" | "sequence" {
  return manifest.source?.module === "sequence" ? "sequence" : "sprite";
}

/**
 * 生成 Godot 4 SpriteFrames（format=3）文本资源。
 *
 * 每个方向一个动画：front_walk / downLeft_walk …（模块③ 是单行动画，名字就是 action）。
 * speed = fps、每帧 duration = 1.0（单位是 1/speed 秒，见参考实现），loop 取 manifest 的 loop。
 * 整图作为一张 Texture2D 外链，每帧一个 AtlasTexture 子资源 + region = Rect2(x, y, w, h)。
 */
export function buildGodotSpriteFrames(manifest: SpriteManifest, options: GodotSpriteFramesOptions): string {
  const texturePath = options?.texturePath ?? "";
  if (typeof texturePath !== "string" || texturePath === "")
    fail("manifest-invalid", "Godot 导出需要整图资源路径（texturePath）");
  const { columns, cell, frameLayout, fps } = manifest;
  if (!Array.isArray(frameLayout) || frameLayout.length !== columns * manifest.rows)
    fail("frame-count-mismatch", "frameLayout 数量与 columns×rows 不一致，无法生成 .tres");
  if (!Number.isFinite(fps) || fps <= 0) fail("fps-invalid", `fps 非法：${fps}`);

  const total = frameLayout.length;
  const extId = "1_sheet";
  const lines: string[] = [];
  lines.push(`[gd_resource type="SpriteFrames" load_steps=${total + 2} format=3]`);
  lines.push("");
  lines.push("");
  lines.push(`[ext_resource type="Texture2D" path="${escapeGodotString(texturePath)}" id="${extId}"]`);

  // 每帧一个 AtlasTexture 子资源；id 里带方向与帧号，便于人眼对照。
  const subIdOf = new Map<number, string>();
  for (const frame of frameLayout) {
    const direction = manifest.directions[frame.row] ?? String(frame.row);
    const id = `AtlasTexture_${direction}_${frame.column + 1}`;
    subIdOf.set(frame.index, id);
    lines.push("");
    lines.push(`[sub_resource type="AtlasTexture" id="${escapeGodotString(id)}"]`);
    lines.push(`atlas = ExtResource("${extId}")`);
    lines.push(`region = Rect2(${frame.x}, ${frame.y}, ${frame.w}, ${frame.h})`);
  }

  lines.push("");
  lines.push("[resource]");
  const module = moduleOf(manifest);
  const firstAnimation = animationNameOf(module, manifest.directions[0] ?? "default");
  // SpriteFrames 本身不存 autoplay：写进 resource metadata，AnimatedSprite2D 侧读 metadata/autoplay。
  lines.push(`metadata/autoplay = "${escapeGodotString(firstAnimation)}"`);
  lines.push(`metadata/pivot = Vector2(${txtNumber(manifest.pivot?.x ?? 0.5)}, ${txtNumber(manifest.pivot?.y ?? 1)})`);
  lines.push(`metadata/cell = Vector2(${cell.width}, ${cell.height})`);
  lines.push("animations = [{");
  const seen = new Set<string>();
  let firstAgent = true;
  for (let row = 0; row < manifest.rows; row++) {
    const direction = manifest.directions[row] ?? String(row);
    const name = animationNameOf(module, direction);
    if (seen.has(name)) fail("direction-invalid", `导出里出现了重复的动画名：${name}（方向不能重名）`);
    seen.add(name);
    const frames = frameLayout.filter((frame) => frame.row === row).sort((a, b) => a.column - b.column);
    if (frames.length !== columns) fail("frame-count-mismatch", `方向 ${direction} 的帧数 ${frames.length} ≠ 列数 ${columns}`);
    if (firstAgent) {
      lines.push('"frames": [{');
      firstAgent = false;
    } else {
      lines.push("}, {");
      lines.push('"frames": [{');
    }
    for (let k = 0; k < frames.length; k++) {
      const frame = frames[k];
      const subId = subIdOf.get(frame.index);
      if (subId === undefined) fail("manifest-invalid", "帧索引与子资源对不上");
      lines.push(`"duration": ${txtSeconds(1)}`);
      lines.push(`"texture": SubResource("${escapeGodotString(subId)}")`);
      lines.push(`}${k < frames.length - 1 ? "," : ""}`);
      if (k < frames.length - 1) lines.push("{");
    }
    lines.push("],");
    lines.push(`"loop": ${manifest.loop === false ? "false" : "true"},`);
    lines.push(`"name": &"${escapeGodotString(name)}",`);
    lines.push(`"speed": ${txtNumber(fps)}`);
  }
  lines.push("}]");
  lines.push("");
  return lines.join("\n");
}

// ── Aseprite JSON ───────────────────────────────────────────────────────

export interface AsepriteJsonOptions {
  /** meta.image：相对 json 的整图路径（默认 ../sprite-sheet.png）。 */
  image?: string;
}

/**
 * 生成 Aseprite 兼容 JSON（Phaser / Flame 的加载器直接吃这一份）。
 *
 * - frames：**全局连续数字键**（"0"…"N-1"），值为 frame 矩形 / duration / sourceSize；
 *   参考实现与 Phaser 都按「字符串化的数字下标」查帧，所以不能用 front_0 这类键；
 * - meta.frameTags：每个方向一段，from / to 是全局下标（行优先连续）；
 * - meta.image 指向整图（相对 json 所在目录，故默认 ../sprite-sheet.png）；
 * - 循环策略 Aseprite JSON 不表达（tag 只有 direction），loop 留在 manifest 里。
 */
export function buildAsepriteJson(manifest: SpriteManifest, options?: AsepriteJsonOptions): string {
  const image = options?.image ?? `../${SHEET_FILE_NAME}`;
  const { columns, rows, cell, frameLayout } = manifest;
  if (!Array.isArray(frameLayout) || frameLayout.length !== columns * rows)
    fail("frame-count-mismatch", "frameLayout 数量与 columns×rows 不一致，无法生成 Aseprite JSON");
  const frames: Record<string, unknown> = {};
  for (const frame of frameLayout) {
    frames[String(frame.index)] = {
      frame: { x: frame.x, y: frame.y, w: frame.w, h: frame.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frame.w, h: frame.h },
      sourceSize: { w: frame.w, h: frame.h },
      duration: frame.durationMs
    };
  }
  const module = moduleOf(manifest);
  const frameTags = manifest.directions.map((direction, row) => ({
    name: animationNameOf(module, direction),
    from: row * columns,
    to: row * columns + columns - 1,
    direction: "forward" as const
  }));
  const payload = {
    frames,
    meta: {
      app: "inkbox",
      version: "1.0",
      image,
      format: "RGBA8888",
      size: { w: cell.width * columns, h: cell.height * rows },
      scale: "1",
      frameTags,
      layers: [{ name: "sprite", opacity: 255, blendMode: "normal" }]
    }
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

// ── bundle README（给人看的导入说明）────────────────────────────────────

/** 导出包里附的 README：目录结构、Godot 导入步骤、pivot 换算、Phaser 用法。 */
export function buildBundleReadme(manifest: SpriteManifest, options: { stem: string; texturePath: string }): string {
  const module = moduleOf(manifest);
  const animations = manifest.directions.map((direction) => animationNameOf(module, direction));
  const pivotXpx = Math.round(manifest.pivot.x * manifest.cell.width);
  const pivotYpx = Math.round(manifest.pivot.y * manifest.cell.height);
  const durationMs = manifest.frameLayout[0]?.durationMs ?? frameDurationMs(manifest.fps);
  const stem = options.stem;
  return [
    `# ${manifest.name} · 引擎导出（${MANIFEST_FORMAT}）`,
    "",
    `- 整图：${SHEET_FILE_NAME}（${manifest.cell.width * manifest.columns}×${manifest.cell.height * manifest.rows}，${manifest.columns} 列 × ${manifest.rows} 行，单格 ${manifest.cell.width}×${manifest.cell.height}）`,
    `- 帧率：${manifest.fps} fps（每帧 ${durationMs} ms）`,
    `- 循环：${manifest.loop === false ? "否" : "是"}`,
    `- 脚底线（pivot，归一化）：(${manifest.pivot.x}, ${manifest.pivot.y})；换算成像素 = (${pivotXpx}, ${pivotYpx})，原点在单格左上角`,
    `- 方向（行序）：${manifest.directions.join(" / ")}`,
    `- 动画名：${animations.join(" / ")}`,
    "",
    "## 目录",
    "",
    `${stem}/`,
    `  ${SHEET_FILE_NAME}           整图（所有帧同在一张图上）`,
    "  manifest.json            运行时清单：fps / 帧矩形 / pivot / 方向 / 来源",
    `  godot/${stem}.tres       Godot 4 SpriteFrames（texture path = ${options.texturePath}）`,
    `  aseprite/${stem}.json    Aseprite 兼容 JSON（Phaser / Flame 可直接吃）`,
    "  frames/<方向>/f00.png…   逐帧 PNG（帧序列，给不吃图集的管线用）",
    "  README.txt               本文件",
    "",
    "## Godot 4",
    "",
    `1. 把 ${stem}/ 整个目录复制进工程，放到 res://inkbox/${stem}/`,
    "   （.tres 里的 texture path 就按这个位置写死；放别处要改 .tres 的 ext_resource path）。",
    `2. 把 godot/${stem}.tres 拖到一个 AnimatedSprite2D 的 sprite_frames 上。`,
    `3. 动画名就是 ${animations.join(" / ")}；speed = ${manifest.fps}，loop = ${manifest.loop === false ? "false" : "true"}。`,
    `4. 脚底线：metadata/pivot 已写在资源里（归一化），换算像素 = (${pivotXpx}, ${pivotYpx})；`,
    "   Godot 的 Sprite2D 用 offset 或 centered=false 自己对齐即可。",
    "",
    "## Phaser / Flame（Aseprite JSON）",
    "",
    `this.load.aseprite("${stem}", "${SHEET_FILE_NAME}", "aseprite/${stem}.json");`,
    `this.anims.createFromAseprite("${stem}");`,
    "",
    "Flame（Dart）用 SpriteAnimation.fromAsepriteData 读同一份 JSON 的 frames map。",
    "",
    "## 校验口径",
    "",
    "  - 帧顺序 = 行优先：index = row * columns + column，行序见上面的「方向（行序）」；",
    "  - frameLayout 的矩形不越界、两两不重叠，且整图尺寸恰好 = 单格 ×（列, 行），否则导出会直接报错；",
    "  - pivot 由合成时的底部留白推算，改过「底部留白」要重新合成整图再导出。",
    ""
  ].join("\n");
}

// ── 文件名安全化 / 目标解析 ──────────────────────────────────────────────

function safeFileStem(input: string, fallback: string): string {
  const cleaned = String(input ?? "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 40);
  return cleaned === "" ? fallback : cleaned;
}

function clampFps(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return DEFAULT_EXPORT_FPS;
  return Math.min(EXPORT_FPS_MAX, Math.max(EXPORT_FPS_MIN, Math.round(n)));
}

/** 模块① 的脱敏参数快照（不含任何 Key）。 */
function spriteSettingsSnapshot(project: Project): Record<string, unknown> {
  const settings = project.settings;
  return {
    cellWidth: settings.cellWidth,
    cellHeight: settings.cellHeight,
    frameCount: settings.frameCount,
    fitMode: settings.fitMode,
    autoCrop: settings.autoCrop,
    fillRatio: settings.fillRatio,
    pixelSize: settings.pixelSize,
    bottomMargin: settings.bottomMargin,
    cropInset: settings.cropInset,
    workingLongEdge: settings.workingLongEdge,
    rowOrder: Array.isArray(settings.rowOrder) ? settings.rowOrder.slice() : [],
    imageMode: project.imageMode,
    keying: {
      keyLow: settings.keyLow,
      keyHigh: settings.keyHigh,
      despill: settings.despill,
      bgTolerance: settings.bgTolerance,
      edgeShrink: settings.edgeShrink
    }
  };
}

/** 模块③ 的脱敏参数快照（不含任何 Key）。 */
function sequenceSettingsSnapshot(job: SequenceJob): Record<string, unknown> {
  return {
    cellWidth: job.settings.cellWidth,
    cellHeight: job.settings.cellHeight,
    frameCount: job.settings.frameCount,
    longEdge: job.settings.longEdge,
    pixelSize: job.settings.pixelSize,
    duration: job.settings.duration,
    resolution: job.settings.resolution,
    model: job.settings.model,
    keying: {
      keyLow: job.keying.keyLow,
      keyHigh: job.keying.keyHigh,
      despill: job.keying.despill,
      bgTolerance: job.keying.bgTolerance,
      edgeShrink: job.keying.edgeShrink
    }
  };
}

export interface ResolveExportOptions {
  fps?: unknown;
  loop?: unknown;
}

/** 读模块①项目，解析成「可以导出」的来源；对不上整图直接抛错。 */
export async function resolveSpriteExportSource(projectId: string, options: ResolveExportOptions = {}): Promise<SheetExportSource> {
  const project = await readProject(projectId);
  if (project === undefined) fail("project-not-found", `项目不存在：${projectId}`);
  const sheet = project.sheet;
  if (sheet === undefined || sheet.status !== "ready" || typeof sheet.file !== "string" || sheet.file === "")
    fail("sheet-missing", "还没有合成整图：先在第 4 步「合成整图」，再导出到引擎");

  let bytes: Buffer;
  try {
    bytes = await readFile(assetPath(projectId, sheet.file));
  } catch {
    fail("sheet-unreadable", `整图文件读不到：${sheet.file}（可能被手删了，请重新合成整图）`);
  }
  const decoded = decodePng(bytes);
  const warnings: string[] = [];
  const settings = project.settings;
  const cellWidth = Number.isFinite(sheet.cellWidth) && sheet.cellWidth > 0 ? sheet.cellWidth : settings.cellWidth;
  const cellHeight = Number.isFinite(sheet.cellHeight) && sheet.cellHeight > 0 ? sheet.cellHeight : settings.cellHeight;
  const columns = Number.isFinite(sheet.frameCount) && sheet.frameCount > 0 ? sheet.frameCount : settings.frameCount;
  const hasRowOrder = Array.isArray(sheet.rowOrder) && sheet.rowOrder.length > 0;
  const directions = (hasRowOrder ? sheet.rowOrder : settings.rowOrder).map(String);
  if (!hasRowOrder) warnings.push("整图记录里没有行序（老项目）：按当前项目的方向顺序推断，若与整图实际行序不符请重新合成整图");
  if (!Number.isFinite(sheet.cellWidth) || !Number.isFinite(sheet.frameCount))
    warnings.push("整图记录缺单格尺寸 / 帧数（老项目）：按当前项目设置推断");
  const rows = directions.length;
  if (decoded.width !== cellWidth * columns || decoded.height !== cellHeight * rows)
    fail(
      "sheet-size-mismatch",
      `整图 ${decoded.width}×${decoded.height} 与 ${columns} 列 × ${rows} 行 × 单格 ${cellWidth}×${cellHeight}（${cellWidth * columns}×${cellHeight * rows}）不一致：` +
        "单格尺寸 / 帧数 / 方向数改过之后没有重新合成整图，请先在第 4 步重新合成"
    );

  const bottomMargin = Math.max(0, Math.min(cellHeight - 1, Math.round(Number(settings.bottomMargin) || 0)));
  const fps = clampFps(options.fps);
  if (options.fps === undefined) warnings.push(`没有指定帧率，按默认 ${DEFAULT_EXPORT_FPS} fps 导出（可在导出卡里改）`);

  return {
    module: "sprite",
    id: projectId,
    name: typeof project.name === "string" && project.name.trim() !== "" ? project.name : projectId,
    sheetFile: sheet.file,
    sheetBytes: bytes,
    sheetRgba: decoded.rgba,
    sheetWidth: decoded.width,
    sheetHeight: decoded.height,
    columns,
    rows,
    cellWidth,
    cellHeight,
    directions,
    fps,
    loop: options.loop === undefined ? true : options.loop !== false,
    pivot: { x: 0.5, y: (cellHeight - bottomMargin) / cellHeight },
    settings: spriteSettingsSnapshot(project),
    warnings
  };
}

/** 读模块③任务（单行动画条图），解析成导出来源。 */
export async function resolveSequenceExportSource(jobId: string, options: ResolveExportOptions = {}): Promise<SheetExportSource> {
  const job = await readSequenceJob(jobId);
  if (job === undefined) fail("job-not-found", `任务不存在：${jobId}`);
  const sheet = job.sheet;
  if (sheet === undefined || sheet.status !== "ready" || typeof sheet.file !== "string" || sheet.file === "")
    fail("sheet-missing", "还没有合成横向条图：先在「④ 绿幕抠像与合成」点「合成横向条图」，再导出到引擎");

  let bytes: Buffer;
  try {
    bytes = await readFile(sequenceAssetPath(jobId, sheet.file));
  } catch {
    fail("sheet-unreadable", `条图文件读不到：${sheet.file}（可能被手删了，请重新合成）`);
  }
  const decoded = decodePng(bytes);
  const warnings: string[] = [];
  const cellWidth = Math.max(1, Math.round(job.settings.cellWidth));
  const cellHeight = Math.max(1, Math.round(job.settings.cellHeight));
  if (decoded.height !== cellHeight)
    fail(
      "sheet-size-mismatch",
      `条图高 ${decoded.height} 与单格高 ${cellHeight} 不一致：单格尺寸改过之后没有重新合成条图，请先重新合成`
    );
  if (decoded.width % cellWidth !== 0)
    fail("sheet-size-mismatch", `条图宽 ${decoded.width} 不是单格宽 ${cellWidth} 的整数倍：单格尺寸改过之后没有重新合成条图，请先重新合成`);
  const columns = decoded.width / cellWidth;
  if (columns < 1) fail("sheet-size-mismatch", `条图里一帧都没有（宽 ${decoded.width}）`);
  const sourceFrames = Array.isArray(job.frames?.files) ? job.frames.files.length : 0;
  if (sourceFrames > 0 && sourceFrames !== columns)
    warnings.push(`条图有 ${columns} 列，但任务记录里抽了 ${sourceFrames} 帧（合成后改过抽帧数？）——以条图为准导出`);
  const fps = clampFps(options.fps);
  if (options.fps === undefined) warnings.push(`没有指定帧率，按默认 ${DEFAULT_EXPORT_FPS} fps 导出（可在导出卡里改）`);
  // 模块③ 合成条图时 bottomMargin 固定 2（见 seqgen.composeSequenceSheet）。
  const bottomMargin = Math.max(0, Math.min(cellHeight - 1, 2));

  return {
    module: "sequence",
    id: jobId,
    name: typeof job.name === "string" && job.name.trim() !== "" ? job.name : jobId,
    sheetFile: sheet.file,
    sheetBytes: bytes,
    sheetRgba: decoded.rgba,
    sheetWidth: decoded.width,
    sheetHeight: decoded.height,
    columns,
    rows: 1,
    cellWidth,
    cellHeight,
    directions: ["action"],
    fps,
    loop: options.loop === undefined ? true : options.loop !== false,
    pivot: { x: 0.5, y: (cellHeight - bottomMargin) / cellHeight },
    settings: sequenceSettingsSnapshot(job),
    warnings
  };
}

// ── 导出主流程 ──────────────────────────────────────────────────────────

export interface SpriteExportRequest {
  projectId?: string;
  jobId?: string;
  /** 勾选的导出内容；缺省用 cfgDefaults（网关传 config.exportDefaults）。 */
  formats?: unknown;
  cfgDefaults?: unknown;
  name?: string;
  fps?: unknown;
  loop?: unknown;
}

export interface SpriteExportResult {
  files: string[];
  manifest: SpriteManifest;
  warnings: string[];
  /** 产物基址（网关补，界面据此拼下载 URL）。 */
  assetBase?: string;
  /** 落盘的安全名（导出目录 / zip 都以它命名）。 */
  name: string;
  /** 导出目录（项目内相对路径）。 */
  root: string;
  /** zip 相对路径（没勾 zip 就没有）。 */
  zip?: string;
  formats: SpriteExportFormat[];
  counts: { files: number; frames: number; animations: number };
  elapsedMs: number;
}

function normalizeFormats(raw: unknown, fallback: unknown): SpriteExportFormat[] {
  const value = raw === undefined || raw === null ? fallback : raw;
  if (value === undefined || value === null) return [...DEFAULT_EXPORT_FORMATS];
  if (!Array.isArray(value)) fail("format-invalid", "formats 必须是字符串数组");
  const out: SpriteExportFormat[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !(SPRITE_EXPORT_FORMATS as readonly string[]).includes(item))
      fail("format-invalid", `未知的导出内容：${String(item)}（可选：${SPRITE_EXPORT_FORMATS.join(" / ")}）`);
    const format = item as SpriteExportFormat;
    if (!out.includes(format)) out.push(format);
  }
  return SPRITE_EXPORT_FORMATS.filter((format) => out.includes(format));
}

function sortFiles(files: string[]): string[] {
  return files.slice().sort((a, b) => {
    const depth = (value: string): number => value.split("/").length;
    return depth(a) - depth(b) || a.localeCompare(b);
  });
}

/**
 * 导出引擎产物：写 out/engine/<name>/…（勾 zip 时再打 out/<name>-engine.zip），
 * 并把这次导出记到 project.json / 任务 job.json 的 export 字段。
 */
export async function exportSprite(request: SpriteExportRequest): Promise<SpriteExportResult> {
  const started = Date.now();
  const projectId = typeof request.projectId === "string" && request.projectId.trim() !== "" ? request.projectId : undefined;
  const jobId = typeof request.jobId === "string" && request.jobId.trim() !== "" ? request.jobId : undefined;
  if (projectId === undefined && jobId === undefined) fail("target-missing", "要导出哪个工程？projectId 或 jobId 必须给一个");
  if (projectId !== undefined && jobId !== undefined) fail("target-ambiguous", "projectId 与 jobId 只能给一个");

  const source =
    projectId !== undefined
      ? await resolveSpriteExportSource(projectId, { fps: request.fps, loop: request.loop })
      : await resolveSequenceExportSource(jobId as string, { fps: request.fps, loop: request.loop });

  const manifest = buildManifest(source);
  assertFrameAlignment(manifest, { width: source.sheetWidth, height: source.sheetHeight });

  const formats = normalizeFormats(request.formats, request.cfgDefaults);
  const zipWanted = formats.includes("zip");
  const content = formats.filter((format) => format !== "zip");
  const warnings = source.warnings.slice();
  let effectiveContent = content;
  if (content.length === 0 && zipWanted) {
    effectiveContent = ["sheet", "frames", "manifest", "godot", "aseprite"];
    warnings.push("只勾了 zip：已按「全部内容」打包");
  }
  if (effectiveContent.length === 0)
    fail("export-empty", `至少勾选一种导出内容（${SPRITE_EXPORT_FORMATS.join(" / ")}）`);
  const id = source.id;
  const stem = safeFileStem(request.name ?? source.name, source.module === "sequence" ? `sequence-${id.slice(-6)}` : `sprite-${id.slice(-6)}`);
  if (stem === "") fail("name-invalid", "导出名不能为空");
  const root = `${EXPORT_ROOT}/${stem}`;
  const texturePath = `res://inkbox/${stem}/${SHEET_FILE_NAME}`;
  const resolveOut = (relative: string): string => (source.module === "sprite" ? assetPath(id, relative) : sequenceAssetPath(id, relative));

  // 先清掉上次的导出目录（同名覆盖；不清理会留下上一次勾过、这次没勾的旧文件）。
  await rm(resolveOut(root), { recursive: true, force: true });

  /** 写进 bundle 的文件（按 zip 里的相对路径），zip 也从这份清单出。 */
  const bundleFiles: { path: string; data: Buffer }[] = [];
  const push = (path: string, data: Buffer): void => {
    bundleFiles.push({ path, data });
  };
  push(SHEET_FILE_NAME, source.sheetBytes);
  if (effectiveContent.includes("manifest")) push("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"));
  if (effectiveContent.includes("godot")) push(`godot/${stem}.tres`, Buffer.from(buildGodotSpriteFrames(manifest, { texturePath }), "utf8"));
  if (effectiveContent.includes("aseprite"))
    push(`aseprite/${stem}.json`, Buffer.from(buildAsepriteJson(manifest, { image: `../${SHEET_FILE_NAME}` }), "utf8"));
  if (effectiveContent.includes("frames")) {
    const slices = sliceSheetFrames(source.sheetRgba, source.sheetWidth, source.sheetHeight, manifest);
    for (const slice of slices) {
      push(`frames/${slice.direction}/f${String(slice.frame).padStart(2, "0")}.png`, encodePng(slice.rgba, slice.w, slice.h));
    }
  }
  push("README.txt", Buffer.from(buildBundleReadme(manifest, { stem, texturePath }), "utf8"));

  // 落盘（bundle 的目录结构 == zip 里的目录结构，只是磁盘上多一层 out/engine/<stem>/）。
  for (const file of bundleFiles) {
    const target = resolveOut(`${root}/${file.path}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.data);
  }
  const files: string[] = bundleFiles.map((file) => `${root}/${file.path}`);

  let zipRelative: string | undefined;
  if (zipWanted) {
    const entries: ZipEntry[] = bundleFiles.map((file) => ({ path: `${stem}/${file.path}`, data: file.data }));
    const zipBytes = zipEntries(entries);
    zipRelative = `out/${stem}-engine.zip`;
    const zipAbs = resolveOut(zipRelative);
    await mkdir(dirname(zipAbs), { recursive: true });
    await writeFile(zipAbs, zipBytes);
    files.push(zipRelative);
  }

  const summary =
    `引擎导出完成：${stem}（${manifest.columns} 列 × ${manifest.rows} 行，${manifest.fps} fps，` +
    `${effectiveContent.join(" / ")}${zipWanted ? " + zip" : ""}，共 ${files.length} 个文件）`;

  // 记一笔到 project.json / job.json（设计 §9.2 的 export 字段）。
  const record = { files: files.slice(), formats: formats.slice(), at: Date.now() };
  if (source.module === "sprite" && projectId !== undefined) {
    await patchProject(projectId, (project) => {
      project.export = record;
      logProject(project, "info", summary);
    });
  } else if (jobId !== undefined) {
    const fresh = await readSequenceJob(jobId);
    if (fresh !== undefined) {
      fresh.export = record;
      appendJobLog(fresh.log, "info", summary);
      await writeSequenceJob(fresh);
    }
  }

  return {
    files: sortFiles(files),
    manifest,
    warnings,
    name: stem,
    root,
    zip: zipRelative,
    formats,
    counts: { files: files.length, frames: manifest.columns * manifest.rows, animations: manifest.rows },
    elapsedMs: Date.now() - started
  };
}
