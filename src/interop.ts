/**
 * 素材互操作（模块九之前的能力层）：把「本机已有的文件」顺进插件，减少手工搬运。
 *
 * 只做三件事：
 *   1. **按文件头识别**：扩展名不可信（改了后缀的任意文件、无后缀的导出图），一律 sniff；
 *   2. **显式路径校验**：只读用户/调用方明确给出的路径，先 stat、再判大小上限，
 *      目录导入也必须由调用方显式给出目录（不隐式扫家目录 / 全盘）；
 *   3. **工作流文件解析**：把 ComfyUI 的 API / 界面两种格式都归一成 API 格式，
 *      做静态绑定识别（不联网也能用），把「缺什么」说清楚。
 *
 * 设计依据：docs/墨盒-skill能力合并-重构设计.md §4.3 / §9.3（req_7180b0d06a）。
 * 放在能力层而不是 wire 层：这样 verify-interop.mjs 可以完全不碰网关就测全部分支。
 */
import { open, readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import {
  detectComfyBindings,
  fetchComfyObjectInfo,
  parseComfyWorkflow,
  type ComfyNodeSpec,
  type ComfyObjectInfo,
  type ComfyRequest,
  type ComfyWorkflow
} from "./comfy.js";

/** 单个文件的硬上限（与既有上传通道一致；超了给人话，不要静默截断）。 */
export const LOCAL_IMAGE_MAX_BYTES = 30 * 1024 * 1024;
export const LOCAL_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
/** 工作流 JSON 的上限：正常 API 格式几十 KB 到几百 KB，2 MB 已经非常宽松。 */
export const LOCAL_WORKFLOW_MAX_BYTES = 2 * 1024 * 1024;
/** 目录批量导入一次最多收多少个文件（防止误把 deliverables 整棵树拖进来）。 */
export const LOCAL_DIR_MAX_FILES = 200;

export type LocalMediaKind = "image" | "video" | "workflow" | "unknown";

export interface LocalMediaInfo {
  /** 绝对路径。 */
  path: string;
  name: string;
  bytes: number;
  kind: LocalMediaKind;
  ext: string;
  mime: string;
}

const IMAGE_SNIFFS: Array<{ ext: string; mime: string; test: (head: Buffer) => boolean }> = [
  { ext: "png", mime: "image/png", test: (h) => h.length >= 8 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47 },
  { ext: "jpg", mime: "image/jpeg", test: (h) => h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff },
  { ext: "webp", mime: "image/webp", test: (h) => h.length >= 12 && h.toString("ascii", 0, 4) === "RIFF" && h.toString("ascii", 8, 12) === "WEBP" },
  { ext: "gif", mime: "image/gif", test: (h) => h.length >= 6 && h.toString("ascii", 0, 3) === "GIF" },
  { ext: "bmp", mime: "image/bmp", test: (h) => h.length >= 2 && h.toString("ascii", 0, 2) === "BM" }
];

const VIDEO_SNIFFS: Array<{ ext: string; mime: string; test: (head: Buffer) => boolean }> = [
  // MP4 / MOV / M4V：第 4..8 字节是 "ftyp"。
  { ext: "mp4", mime: "video/mp4", test: (h) => h.length >= 12 && h.toString("ascii", 4, 8) === "ftyp" },
  // WebM / MKV：EBML 头 0x1A45DFA3。
  { ext: "webm", mime: "video/webm", test: (h) => h.length >= 4 && h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3 },
  // AVI：RIFF....AVI 。
  { ext: "avi", mime: "video/x-msvideo", test: (h) => h.length >= 12 && h.toString("ascii", 0, 4) === "RIFF" && h.toString("ascii", 8, 11) === "AVI" }
];

/** 按文件头判媒体类型；扩展名只在「嗅探失败」时用于给更友好的报错。 */
export function sniffLocalMedia(head: Buffer): { kind: "image" | "video"; ext: string; mime: string } | undefined {
  for (const item of IMAGE_SNIFFS) if (item.test(head)) return { kind: "image", ext: item.ext, mime: item.mime };
  for (const item of VIDEO_SNIFFS) if (item.test(head)) return { kind: "video", ext: item.ext, mime: item.mime };
  return undefined;
}

/** 只读文件头 16 字节（100MB 的视频也只读这 16 字节，别整个读进来）。 */
async function readHead(path: string): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, 16, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function classifyByExtension(path: string): LocalMediaKind {
  const ext = extname(path).toLowerCase();
  if ([".json"].includes(ext)) return "workflow";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) return "image";
  if ([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"].includes(ext)) return "video";
  return "unknown";
}

/**
 * 解析一个**显式给出的**本机路径：
 *   - 文件：返回它的嗅探结果（图片 / 视频 / 工作流）；
 *   - 目录：返回目录本身（由调用方决定是否按目录批量导入），不递归；
 *   - 不存在 / 不可读：直接抛错（不静默跳过，否则界面上是「导入了 0 个文件」）。
 */
export async function describeLocalPath(rawPath: string): Promise<
  | { kind: "file"; file: LocalMediaInfo }
  | { kind: "directory"; dir: string; files: LocalMediaInfo[]; skipped: Array<{ path: string; reason: string }> }
> {
  const text = (rawPath ?? "").trim();
  if (text === "") throw new Error("路径为空：请给出本机绝对路径");
  const absolute = resolve(text);
  const info = await stat(absolute);
  if (info.isDirectory()) {
    const entries = await readdir(absolute, { withFileTypes: true });
    const files: LocalMediaInfo[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"))) {
      if (!entry.isFile()) continue;
      if (files.length >= LOCAL_DIR_MAX_FILES) {
        skipped.push({ path: entry.name, reason: `目录内文件超过 ${LOCAL_DIR_MAX_FILES} 个，剩余未导入` });
        break;
      }
      const child = resolve(absolute, entry.name);
      try {
        const head = await readHead(child);
        const sniffed = sniffLocalMedia(head);
        if (sniffed === undefined) {
          skipped.push({ path: child, reason: "不是可识别的图片 / 视频" });
          continue;
        }
        files.push({
          path: child,
          name: entry.name,
          bytes: (await stat(child)).size,
          kind: sniffed.kind,
          ext: sniffed.ext,
          mime: sniffed.mime
        });
      } catch (error) {
        skipped.push({ path: child, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { kind: "directory", dir: absolute, files, skipped };
  }
  if (!info.isFile()) throw new Error(`不是文件也不是目录：${absolute}`);
  const head = await readHead(absolute);
  const sniffed = sniffLocalMedia(head);
  if (sniffed !== undefined) {
    return {
      kind: "file",
      file: { path: absolute, name: basename(absolute), bytes: info.size, kind: sniffed.kind, ext: sniffed.ext, mime: sniffed.mime }
    };
  }
  const byExt = classifyByExtension(absolute);
  if (byExt === "workflow") {
    return { kind: "file", file: { path: absolute, name: basename(absolute), bytes: info.size, kind: "workflow", ext: "json", mime: "application/json" } };
  }
  throw new Error(`无法识别的文件格式（支持 PNG / JPEG / WebP / GIF / BMP / MP4 / MOV / WebM / AVI / 工作流 JSON）：${absolute}`);
}

/** 读一个图片 / 视频文件，按媒体上限校验；返回原始字节。 */
export async function readLocalMediaFile(
  path: string,
  kind: "image" | "video"
): Promise<{ bytes: Buffer; name: string; ext: string; mime: string }> {
  const absolute = resolve(path);
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error(`不是文件：${absolute}`);
  const limit = kind === "image" ? LOCAL_IMAGE_MAX_BYTES : LOCAL_VIDEO_MAX_BYTES;
  if (info.size > limit) {
    throw new Error(`${kind === "image" ? "图片" : "视频"} ${(info.size / 1024 / 1024).toFixed(1)}MB 超过上限 ${Math.round(limit / 1024 / 1024)}MB：${absolute}`);
  }
  const head = await readHead(absolute);
  const sniffed = sniffLocalMedia(head);
  if (sniffed === undefined) throw new Error(`无法识别的文件格式：${absolute}`);
  if (sniffed.kind !== kind) throw new Error(`这里是${sniffed.kind === "image" ? "图片" : "视频"}，但目标槽位要${kind === "image" ? "图片" : "视频"}：${absolute}`);
  return { bytes: await readFile(absolute), name: basename(absolute), ext: sniffed.ext, mime: sniffed.mime };
}

// ── 工作流文件（ComfyUI JSON）解析与静态绑定识别 ────────────────────────

export interface StaticWorkflowBindings {
  prompt?: string;
  negative?: string;
  image?: string;
  image2?: string;
  width?: string;
  height?: string;
  seed?: string;
  steps?: string;
  cfg?: string;
  sampler?: string;
  denoising?: string;
  batch?: string;
}

export interface WorkflowFilePreview {
  name: string;
  /** api = 已经是 API 格式；ui = 界面格式，已自动转换。 */
  protocol: "api" | "ui";
  /** API 格式正文（可直接交给 ComfyUI /prompt）。 */
  json: ComfyWorkflow;
  nodeCount: number;
  /** 工作流里出现的节点类型（用于对照 /object_info 查缺）。 */
  classTypes: string[];
  /** 静态识别出的绑定（节点ID.输入名）。 */
  bindings: StaticWorkflowBindings;
  /** 静态推断出的模型文件名清单（缺模型时给人看）。 */
  requiredModels: string[];
  /** 只出现在工作流里、ComfyUI 却没有的节点类型（错误定位到节点）。 */
  unknownNodes: Array<{ node: string; classType: string; reason: string }>;
  /** 解析 / 转换过程的说明（给人看的）。 */
  notes: string[];
  /** 是否做了联网（/object_info）精确转换与校验。 */
  live: boolean;
  warnings: string[];
}

/** 节点输入里看起来是「模型文件名」的值。 */
const MODEL_FILE_PATTERN = /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i;
/** 常见「正向 / 反向提示词」节点类型前缀；按节点 id 顺序取第一个为正向、第二个为反向。 */
const PROMPT_CLASS_PATTERN = /^(CLIPTextEncode|CLIPTextEncodeSDXL|CLIPTextEncodeSDXLRefiner|TextEncodeQwenImageEdit|TextEncodeQwenImageEditPlus|TextEncodeQwenImage21|T5TextEncode|BNK_CLIPTextEncodeAdvanced)/;
const LATENT_CLASS_PATTERN = /^(EmptyLatentImage|EmptySD3LatentImage|EmptyQwenImageLayeredLatentImage|EmptyHunyuanLatentVideo|EmptyLatentImagePresets)/;
const SAMPLER_CLASS_PATTERN = /^KSampler/;

function nodeIds(workflow: ComfyWorkflow): string[] {
  return Object.keys(workflow).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

/** 从工作流 JSON 静态识别常用绑定。不联网、不猜没把握的输入（接错比不接更坏）。 */
export function detectStaticBindings(workflow: ComfyWorkflow): {
  bindings: StaticWorkflowBindings;
  requiredModels: string[];
  classTypes: string[];
} {
  const bindings: StaticWorkflowBindings = {};
  const requiredModels = new Set<string>();
  const classTypes: string[] = [];
  const promptNodes: Array<{ id: string; input: string }> = [];
  const imageNodes: Array<{ id: string; input: string }> = [];
  for (const id of nodeIds(workflow)) {
    const node = workflow[id];
    if (node === undefined) continue;
    const classType = typeof node.class_type === "string" ? node.class_type : "";
    if (classType === "") continue;
    if (!classTypes.includes(classType)) classTypes.push(classType);
    const inputs = (node.inputs ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(inputs)) {
      if (typeof value === "string" && MODEL_FILE_PATTERN.test(value)) requiredModels.add(value);
    }
    // 提示词节点：自定义节点类型太多，不能按 class_type 白名单认——
    // 按「输入名像提示词、值是字符串」识别（Qwen 的 TextEncodeQwenImage21 也是这么被认出来的）。
    const textKey = Object.keys(inputs).find((key) => {
      if (typeof inputs[key] !== "string") return false;
      const lower = key.toLowerCase();
      if (lower === "text" || lower === "prompt" || lower === "positive" || lower === "negative") return true;
      return lower.endsWith("_text") || lower.endsWith("prompt");
    });
    if (textKey !== undefined) {
      promptNodes.push({ id, input: textKey });
      continue;
    }
    if (/^LoadImage/.test(classType) && typeof inputs.image === "string") {
      imageNodes.push({ id, input: "image" });
      continue;
    }
    if (LATENT_CLASS_PATTERN.test(classType)) {
      if (bindings.width === undefined && typeof inputs.width === "number") bindings.width = `${id}.width`;
      if (bindings.height === undefined && typeof inputs.height === "number") bindings.height = `${id}.height`;
      if (bindings.batch === undefined && typeof inputs.batch_size === "number") bindings.batch = `${id}.batch_size`;
      continue;
    }
    if (SAMPLER_CLASS_PATTERN.test(classType)) {
      if (bindings.seed === undefined && typeof inputs.seed === "number") bindings.seed = `${id}.seed`;
      if (bindings.steps === undefined && typeof inputs.steps === "number") bindings.steps = `${id}.steps`;
      if (bindings.cfg === undefined && typeof inputs.cfg === "number") bindings.cfg = `${id}.cfg`;
      if (bindings.sampler === undefined && typeof inputs.sampler_name === "string") bindings.sampler = `${id}.sampler_name`;
      if (bindings.denoising === undefined && typeof inputs.denoise === "number") bindings.denoising = `${id}.denoise`;
    }
  }
  if (promptNodes.length > 0) bindings.prompt = `${promptNodes[0].id}.${promptNodes[0].input}`;
  if (promptNodes.length > 1) bindings.negative = `${promptNodes[1].id}.${promptNodes[1].input}`;
  if (imageNodes.length > 0) bindings.image = `${imageNodes[0].id}.${imageNodes[0].input}`;
  if (imageNodes.length > 1) bindings.image2 = `${imageNodes[1].id}.${imageNodes[1].input}`;
  return { bindings, requiredModels: Array.from(requiredModels).sort(), classTypes: classTypes.sort() };
}

// ── 界面格式 → API 格式（联网精确版）────────────────────────────────────

/** ComfyUI 界面格式的连线表：链接 id → 来源节点 + 槽位（新版对象、旧版数组，两种都读）。 */
function uiLinkTable(record: Record<string, unknown>): Map<number, { originId: string; originSlot: number }> {
  const table = new Map<number, { originId: string; originSlot: number }>();
  if (!Array.isArray(record.links)) return table;
  for (const item of record.links) {
    if (Array.isArray(item)) {
      const id = Number(item[0]);
      if (Number.isFinite(id)) table.set(id, { originId: String(item[1] ?? ""), originSlot: Number(item[2] ?? 0) || 0 });
      continue;
    }
    if (item !== null && typeof item === "object") {
      const entry = item as Record<string, unknown>;
      const id = Number(entry.id);
      if (Number.isFinite(id)) table.set(id, { originId: String(entry.origin_id ?? ""), originSlot: Number(entry.origin_slot ?? 0) || 0 });
    }
  }
  return table;
}

/** 界面格式里 seed 后面跟的控件名（fixed / randomize…），不是节点输入。 */
const UI_CONTROL_WORDS = new Set(["fixed", "increment", "decrement", "randomize"]);

/** 这个输入定义是「控件」还是会话连线槽位：INT / FLOAT / STRING / BOOLEAN / 枚举数组 = 控件。 */
function isWidgetDef(def: unknown[] | undefined): boolean {
  if (!Array.isArray(def)) return false;
  const type = def[0];
  if (Array.isArray(type)) return true;
  return ["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"].includes(String(type));
}

/** 节点定义里的输入表（required 在前、optional 在后，**顺序就是 widgets_values 的顺序**）。 */
function nodeSpecInputs(spec: ComfyNodeSpec | undefined): Record<string, unknown[]> {
  if (spec === undefined) return {};
  const group = spec.input ?? spec;
  return { ...(group.required ?? {}), ...(group.optional ?? {}) };
}

/** 收集界面格式里出现的全部节点类型（便签与静音 / 旁路节点不算）。 */
export function collectUiClassTypes(record: Record<string, unknown>): string[] {
  const rawNodes = Array.isArray(record.nodes) ? record.nodes : [];
  const types = new Set<string>();
  for (const item of rawNodes) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const node = item as Record<string, unknown>;
    const classType = typeof node.type === "string" ? node.type.trim() : "";
    if (classType === "" || classType === "Note" || classType === "MarkdownNote") continue;
    const mode = Number(node.mode);
    if (mode === 2 || mode === 4) continue;
    types.add(classType);
  }
  return Array.from(types).sort();
}

/**
 * 用 /object_info 把界面格式**精确**转成 API 格式。
 *
 * 为什么不能只靠工作流里的 `inputs`：ComfyUI 导出的界面 JSON 往往不把控件写进
 * `inputs`，只留下 `widgets_values` 数组。离线转换只能按声明的 widget 槽位猜名字，
 * 实测本机 9 个工作流（透明精灵 Turbo 13 节点）会丢掉 20 个控件值——提示词、
 * 模型文件名、尺寸整段消失，而且不报错。这里按 ComfyUI 前端自己的口径来：
 * 按节点定义顺序消费 widgets_values，有连线的输入直接用连线。
 */
export function convertUiWorkflowWithObjectInfo(
  record: Record<string, unknown>,
  objectInfo: ComfyObjectInfo
): { workflow: ComfyWorkflow; notes: string[]; unknownNodes: Array<{ node: string; classType: string; reason: string }> } {
  const rawNodes = Array.isArray(record.nodes) ? record.nodes : [];
  const links = uiLinkTable(record);
  const workflow: ComfyWorkflow = {};
  const notes: string[] = [];
  const unknownNodes: Array<{ node: string; classType: string; reason: string }> = [];
  for (const item of rawNodes) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const node = item as Record<string, unknown>;
    const id = node.id;
    if (id === undefined || id === null || String(id) === "") continue;
    const classType = typeof node.type === "string" ? node.type.trim() : "";
    if (classType === "" || classType === "Note" || classType === "MarkdownNote") continue;
    const mode = Number(node.mode);
    if (mode === 2 || mode === 4) continue;
    const spec = objectInfo[classType];
    if (spec === undefined) {
      unknownNodes.push({ node: String(id), classType, reason: "ComfyUI 的 /object_info 里没有这个节点类型（多半是缺自定义节点）" });
    }
    /** 声明里的连线输入：name → [来源节点, 来源槽位]。 */
    const linked = new Map<string, [string, number]>();
    const declaredInputs = Array.isArray(node.inputs) ? node.inputs : [];
    for (const slot of declaredInputs) {
      if (slot === null || typeof slot !== "object" || Array.isArray(slot)) continue;
      const entry = slot as Record<string, unknown>;
      const name = typeof entry.name === "string" ? entry.name : "";
      if (name === "" || entry.link === null || entry.link === undefined) continue;
      const end = links.get(Number(entry.link));
      if (end !== undefined) linked.set(name, [end.originId, end.originSlot]);
    }
    const values: unknown[] = Array.isArray(node.widgets_values) ? [...node.widgets_values] : [];
    let widgetIndex = 0;
    const inputs: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(nodeSpecInputs(spec))) {
      const link = linked.get(name);
      if (link !== undefined) {
        inputs[name] = link;
        continue;
      }
      if (!isWidgetDef(def)) continue;
      if (widgetIndex >= values.length) {
        notes.push(`节点 ${id}（${classType}）缺控件值「${name}」：该工作流可能来自更复杂的自定义节点，请用 ComfyUI 的 Save (API Format) 重新导出`);
        continue;
      }
      inputs[name] = values[widgetIndex];
      widgetIndex += 1;
      if (widgetIndex < values.length && UI_CONTROL_WORDS.has(String(values[widgetIndex]))) widgetIndex += 1;
    }
    // 声明里没写、但连线表里有的输入，也照实接上（少数自定义节点会这样）。
    for (const [name, link] of linked) if (inputs[name] === undefined) inputs[name] = link;
    const entry: ComfyWorkflow[string] = { class_type: classType, inputs };
    if (typeof node.title === "string" && node.title !== "") entry._meta = { title: node.title };
    workflow[String(id)] = entry;
  }
  return { workflow, notes, unknownNodes };
}

/** JSON.parse 的错误信息在 Node 24 里可能很长，截到能定位的一句就够。 */
function jsonError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 200 ? message.slice(0, 197) + "…" : message;
}

function isUiWorkflowRecord(parsed: unknown): parsed is Record<string, unknown> {
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as Record<string, unknown>).nodes);
}

function workflowClassTypes(workflow: ComfyWorkflow): string[] {
  const types = new Set<string>();
  for (const node of Object.values(workflow)) {
    const classType = typeof node?.class_type === "string" ? node.class_type : "";
    if (classType !== "") types.add(classType);
  }
  return Array.from(types).sort();
}

/**
 * 读并解析一个 ComfyUI 工作流文件（API / 界面两种格式都收）。
 *
 * - 传了 `request`（ComfyUI 地址）→ 用 /object_info 做**精确**转换 + 节点类型校验
 *   （缺自定义节点会逐节点列出来，带节点 id）；
 * - 没传 / ComfyUI 不可达 → 退回离线近似转换，并把「可能丢控件值」写进 warnings。
 *
 * 报错必须能定位：JSON 不合法时给位置信息；格式不对时把 `parseComfyWorkflow` 的原因原样带出来。
 */
export async function readWorkflowFile(
  rawPath: string,
  options: { request?: ComfyRequest } = {}
): Promise<WorkflowFilePreview> {
  const text = (rawPath ?? "").trim();
  if (text === "") throw new Error("路径为空：请给出工作流 JSON 的本机绝对路径");
  const absolute = resolve(text);
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error(`不是文件：${absolute}`);
  if (info.size > LOCAL_WORKFLOW_MAX_BYTES) {
    throw new Error(`工作流文件 ${(info.size / 1024 / 1024).toFixed(1)}MB 超过上限 2MB：${absolute}`);
  }
  const raw = await readFile(absolute, "utf8");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new Error(`工作流解析失败（${basename(absolute)}）：不是合法 JSON：${jsonError(error)}`);
  }
  const warnings: string[] = [];
  const notes: string[] = [];
  let workflow: ComfyWorkflow;
  let protocol: "api" | "ui";
  let unknownNodes: Array<{ node: string; classType: string; reason: string }> = [];
  let objectInfo: ComfyObjectInfo | undefined;
  if (isUiWorkflowRecord(parsedJson)) {
    protocol = "ui";
    const uiTypes = collectUiClassTypes(parsedJson);
    if (options.request !== undefined) {
      const fetched = await fetchComfyObjectInfo(options.request, uiTypes);
      // 一个类型都查不到 = ComfyUI 不可达（fetchComfyObjectInfo 失败时静默返回空表）：
      // 这时不能假装「节点全缺」，退回离线近似转换并说明原因。
      const reachable = uiTypes.length > 0 && uiTypes.some((type) => fetched[type] !== undefined);
      if (reachable) {
        objectInfo = fetched;
        const converted = convertUiWorkflowWithObjectInfo(parsedJson, fetched);
        workflow = converted.workflow;
        unknownNodes = converted.unknownNodes;
        notes.push(...converted.notes);
        const missing = uiTypes.filter((type) => fetched[type] === undefined);
        if (missing.length > 0) warnings.push(`ComfyUI 缺少这些节点类型（缺自定义节点）：${missing.join("、")}`);
        warnings.push(`界面格式已按 ComfyUI /object_info 精确转成 API 格式（${Object.keys(workflow).length} 节点）`);
      } else {
        const offline = parseComfyWorkflow(raw);
        if (offline.ok !== true) throw new Error(`工作流解析失败（${basename(absolute)}）：${offline.error}`);
        workflow = offline.workflow;
        warnings.push(`ComfyUI 不可达（${options.request.baseUrl}），已退回离线近似转换（丢弃未命名控件值 ${offline.droppedWidgets ?? 0} 个）`);
      }
    } else {
      const offline = parseComfyWorkflow(raw);
      if (offline.ok !== true) throw new Error(`工作流解析失败（${basename(absolute)}）：${offline.error}`);
      workflow = offline.workflow;
      warnings.push(`界面格式已离线转成 API 格式（丢弃未命名控件值 ${offline.droppedWidgets ?? 0} 个；连上 ComfyUI 后重新导入可精确转换）`);
    }
  } else {
    const parsed = parseComfyWorkflow(raw);
    if (parsed.ok !== true) throw new Error(`工作流解析失败（${basename(absolute)}）：${parsed.error}`);
    workflow = parsed.workflow;
    protocol = parsed.converted === true ? "ui" : "api";
    if (options.request !== undefined) {
      const types = workflowClassTypes(workflow);
      const fetched = await fetchComfyObjectInfo(options.request, types);
      if (types.some((type) => fetched[type] !== undefined)) {
        objectInfo = fetched;
        const missing = types.filter((type) => fetched[type] === undefined);
        if (missing.length > 0) warnings.push(`ComfyUI 缺少这些节点类型（缺自定义节点）：${missing.join("、")}`);
      }
    }
  }
  const staticDetect = detectStaticBindings(workflow);
  const bindings = staticDetect.bindings;
  const requiredModels = staticDetect.requiredModels;
  const classTypes = staticDetect.classTypes;
  if (objectInfo !== undefined) {
    const detected = detectComfyBindings(workflow, {}, objectInfo);
    const textOf = (binding: { node: string; input: string } | undefined): string | undefined =>
      binding === undefined ? undefined : `${binding.node}.${binding.input}`;
    if (detected.bindings.prompt !== undefined) bindings.prompt = textOf(detected.bindings.prompt);
    if (detected.bindings.width !== undefined) bindings.width = textOf(detected.bindings.width);
    if (detected.bindings.height !== undefined) bindings.height = textOf(detected.bindings.height);
    if (detected.bindings.seed !== undefined) bindings.seed = textOf(detected.bindings.seed);
    if (detected.bindings.first !== undefined) bindings.image = textOf(detected.bindings.first);
    notes.push(...detected.notes);
  }
  if (bindings.prompt === undefined) warnings.push("没有识别到提示词节点：导入后请在绑定里手工指定（节点ID.输入名），否则提示词会被忽略");
  if (bindings.image === undefined) warnings.push("没有识别到图像输入（LoadImage）：如果这是去背 / 图生图工作流，请手工指定 image 绑定");
  if (requiredModels.length === 0) warnings.push("没有识别到模型文件名：自检时无法提示缺哪个模型，请人工确认");
  return {
    name: basename(absolute).replace(/\.json$/i, ""),
    protocol,
    json: workflow,
    nodeCount: Object.keys(workflow).length,
    classTypes,
    bindings,
    requiredModels,
    unknownNodes,
    notes,
    live: objectInfo !== undefined,
    warnings
  };
}
