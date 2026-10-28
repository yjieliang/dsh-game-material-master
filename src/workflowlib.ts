/**
 * 本地 ComfyUI **工作流库**。
 *
 * 为什么需要它：现在「自定义生图 → ComfyUI 协议」只支持**一份全局工作流**，而本机
 * comfyui-2d-assets 技能里实测有效的有 9 份（透明精灵 / 像素 SDXL / 极速 / 线稿 /
 * 动作帧 / BiRefNet 去背 / 像素化 / 无缝地块 / 精灵表）。一份 JSON 顶不住所有用途，
 * 而换一份 JSON 就要用户整段粘贴、还得自己记住哪个节点是提示词。
 *
 * 这一层的职责：
 *  1. **数据模型**：一条工作流 = 名字 + 用途 + 正文（API 格式）+ 注入绑定 + 默认参数；
 *  2. **CRUD**：正文落 `<DSH_HOME>/inkbox/workflows/<id>.json`，另有可重建的索引；
 *  3. **三级绑定解析**：显式 bindings → 工作流里的 `{{占位符}}` → `detectComfyBindings`
 *     自动探测；关键绑定（generate 的 prompt / post 的 image）仍然缺 → **明确报错**并给出
 *     候选节点与手工写法，绝不静默忽略提示词；
 *  4. **导入**：API 格式与界面格式都收（复用 `comfy.ts` 的 `parseComfyWorkflow`）；
 *  5. **自检材料**：节点类型 / 模型文件存在性 / 绑定识别结果（网络查询在 `inspectWorkflow`）。
 *
 * 存储口径：正文与 `config.json` 分离（配置不该因为一份 15KB 的工作流变得又大又难脱敏）。
 * 索引文件 `workflows/index.json` 只是**加速读**用的缓存，与磁盘不一致时永远以文件为准重建
 * —— 用户手工丢一份 JSON 进来也照样能被列出来。
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot } from "./config.js";
import {
  type ComfyBinding,
  type ComfyBindings,
  type ComfyObjectInfo,
  type ComfyRequest,
  type ComfyWorkflow,
  detectComfyBindings,
  fetchComfyObjectInfo,
  parseBinding,
  parseComfyWorkflow
} from "./comfy.js";
import { BUILTIN_CATALOG, BUILTIN_WORKFLOWS, type BuiltinCatalogEntry } from "./workflowbuiltin.js";

/* ---------------------------------------------------------------- 数据模型 */

/** `generate` = 出图；`post` = 去背 / 像素化 / 拼图这类后处理。 */
export type WorkflowKind = "generate" | "post";
/** `api` = ComfyUI 的 Save (API Format)；`ui` = 界面格式（导入时已转成 API 格式）。 */
export type WorkflowProtocol = "api" | "ui";

/**
 * 可注入的绑定。值统一是 `"节点ID.输入名"`（与 comfy.ts 的 parseBinding 同一套写法）。
 *
 * `image` 与 `first` 的区别：`image` 是「参考图 / 输入图」（图生图、线稿控制、去背），
 * `first` / `last` 留给视频与动画工作流那种首尾帧语义。
 */
export interface WorkflowBindings {
  prompt?: string;
  negative?: string;
  width?: string;
  height?: string;
  seed?: string;
  image?: string;
  /** 第二张参考图（例如 ControlNet 的姿势图）。 */
  image2?: string;
  first?: string;
  last?: string;
  batch?: string;
  steps?: string;
  cfg?: string;
  sampler?: string;
  denoising?: string;
}

export type WorkflowBindingKey = keyof WorkflowBindings;

export const WORKFLOW_BINDING_KEYS: readonly WorkflowBindingKey[] = [
  "prompt",
  "negative",
  "width",
  "height",
  "seed",
  "image",
  "image2",
  "first",
  "last",
  "batch",
  "steps",
  "cfg",
  "sampler",
  "denoising"
];

/** 给人看的绑定名（报错文案与设置页共用）。 */
export const WORKFLOW_BINDING_LABELS: Record<WorkflowBindingKey, string> = {
  prompt: "提示词",
  negative: "负面提示词",
  width: "宽度",
  height: "高度",
  seed: "种子",
  image: "参考图",
  image2: "第二张参考图",
  first: "首帧图",
  last: "尾帧图",
  batch: "批量张数",
  steps: "步数",
  cfg: "CFG",
  sampler: "采样器",
  denoising: "重绘强度"
};

export interface WorkflowDefaults {
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
}

export interface WorkflowEntry {
  /** `builtin.<用途>` 或 `wf_<短哈希>`。 */
  id: string;
  name: string;
  /** 人读用途：透明精灵 / 像素风 / 无缝砖 / 去背 … */
  purpose: string;
  kind: WorkflowKind;
  protocol: WorkflowProtocol;
  /** true = 随包目录条目（正文可能在 `workflowbuiltin.ts` 里，也可能需要用户导入）。 */
  builtin: boolean;
  /** 依赖的模型文件名（自检提示用；不打包模型）。 */
  requiredModels: string[];
  bindings: WorkflowBindings;
  defaults?: WorkflowDefaults;
  /** **API 格式**的对象（界面格式在导入时已经转换过）。 */
  workflow: ComfyWorkflow;
  createdAt: number;
  updatedAt: number;
  notes?: string;
  /** 从哪个本机文件导入的（排障用；界面不回传完整路径以外的内容）。 */
  sourcePath?: string;
}

/** 目录条目（不含正文，给设置页与工作流下拉用）。 */
export interface WorkflowMeta {
  id: string;
  name: string;
  purpose: string;
  kind: WorkflowKind;
  protocol: WorkflowProtocol;
  builtin: boolean;
  requiredModels: string[];
  /** 正文是否已就绪：内置目录里「需导入」的条目为 false。 */
  hasWorkflow: boolean;
  /** true = 目录里有这条，但正文还没导入（设置页要显示「需导入」并给导入按钮）。 */
  needsImport: boolean;
  defaults?: WorkflowDefaults;
  updatedAt: number;
}

/** 工作流库的领域错误：`code` 给界面/工具面分辨处理方式，`detail` 带定位信息。 */
export class WorkflowError extends Error {
  readonly code: string;
  readonly detail?: Record<string, unknown>;
  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    this.detail = detail;
  }
}

/* ---------------------------------------------------------------- 存储 */

export function workflowsRoot(): string {
  return join(dataRoot(), "workflows");
}

const WORKFLOW_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/;

export function isValidWorkflowId(id: string | undefined): boolean {
  return typeof id === "string" && WORKFLOW_ID_RE.test(id.trim());
}

function assertWorkflowId(id: string): string {
  const trimmed = (id ?? "").trim();
  if (!isValidWorkflowId(trimmed)) throw new WorkflowError("workflow-invalid-id", "工作流 id 不合法：" + id);
  return trimmed;
}

export function workflowFile(id: string): string {
  return join(workflowsRoot(), assertWorkflowId(id) + ".json");
}

const INDEX_FILE = "index.json";
const INDEX_VERSION = 1;

interface WorkflowIndexItem {
  id: string;
  name: string;
  purpose: string;
  kind: WorkflowKind;
  builtin: boolean;
  protocol: WorkflowProtocol;
  requiredModels: string[];
  updatedAt: number;
}

interface WorkflowIndexFile {
  version: number;
  updatedAt: number;
  items: WorkflowIndexItem[];
}

function metaOfEntry(entry: WorkflowEntry): WorkflowMeta {
  return {
    id: entry.id,
    name: entry.name,
    purpose: entry.purpose,
    kind: entry.kind,
    protocol: entry.protocol,
    builtin: entry.builtin,
    requiredModels: [...entry.requiredModels],
    hasWorkflow: true,
    needsImport: false,
    ...(entry.defaults === undefined ? {} : { defaults: { ...entry.defaults } }),
    updatedAt: entry.updatedAt
  };
}

function indexItemOf(entry: WorkflowEntry): WorkflowIndexItem {
  return {
    id: entry.id,
    name: entry.name,
    purpose: entry.purpose,
    kind: entry.kind,
    builtin: entry.builtin,
    protocol: entry.protocol,
    requiredModels: [...entry.requiredModels],
    updatedAt: entry.updatedAt
  };
}

async function listUserFiles(): Promise<string[]> {
  try {
    const dirents = await readdir(workflowsRoot(), { withFileTypes: true });
    return dirents
      .filter((item) => item.isFile() && item.name.endsWith(".json") && item.name !== INDEX_FILE)
      .map((item) => item.name.slice(0, -".json".length))
      .filter((id) => isValidWorkflowId(id));
  } catch {
    return [];
  }
}

/** 从磁盘读一条用户工作流（不做任何补全）；损坏 / 缺字段的文件返回 undefined。 */
async function readUserEntry(id: string): Promise<WorkflowEntry | undefined> {
  let text: string;
  try {
    text = await readFile(workflowFile(id), "utf8");
  } catch {
    return undefined;
  }
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (raw === null || typeof raw !== "object") return undefined;
  const workflow = raw.workflow;
  if (workflow === null || typeof workflow !== "object" || Array.isArray(workflow)) return undefined;
  return {
    id,
    name: typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name : id,
    purpose: typeof raw.purpose === "string" ? raw.purpose : "",
    kind: raw.kind === "post" ? "post" : "generate",
    protocol: raw.protocol === "ui" ? "ui" : "api",
    builtin: false,
    requiredModels: Array.isArray(raw.requiredModels) ? raw.requiredModels.filter((item: unknown) => typeof item === "string") : [],
    bindings: normalizeBindings(raw.bindings),
    ...(raw.defaults !== null && typeof raw.defaults === "object" ? { defaults: normalizeDefaults(raw.defaults) } : {}),
    workflow,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
    ...(typeof raw.notes === "string" && raw.notes !== "" ? { notes: raw.notes } : {}),
    ...(typeof raw.sourcePath === "string" && raw.sourcePath !== "" ? { sourcePath: raw.sourcePath } : {})
  };
}

async function readIndex(): Promise<WorkflowIndexFile | undefined> {
  try {
    const text = await readFile(join(workflowsRoot(), INDEX_FILE), "utf8");
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.items)) return undefined;
    return parsed as WorkflowIndexFile;
  } catch {
    return undefined;
  }
}

async function writeIndex(items: WorkflowIndexItem[]): Promise<void> {
  const payload: WorkflowIndexFile = { version: INDEX_VERSION, updatedAt: Date.now(), items };
  const target = join(workflowsRoot(), INDEX_FILE);
  const tmp = target + ".tmp";
  await mkdir(workflowsRoot(), { recursive: true });
  await writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  await rename(tmp, target);
}

/**
 * 对齐索引与文件：**以文件为准**。
 *
 * 三种情况都要修：索引缺失、索引里有文件已删除的条目、文件有索引里没有的条目
 * （用户手工把 JSON 丢进目录 / 另一个进程写的）。修完返回磁盘上的真实条目。
 */
async function syncIndex(): Promise<WorkflowIndexItem[]> {
  const ids = await listUserFiles();
  const existing = await readIndex();
  const items: WorkflowIndexItem[] = [];
  for (const id of ids) {
    const entry = await readUserEntry(id);
    if (entry === undefined) continue;
    items.push(indexItemOf(entry));
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  const same =
    existing !== undefined &&
    existing.items.length === items.length &&
    items.every((item, index) => {
      const other = existing.items[index];
      return (
        other !== undefined &&
        other.id === item.id &&
        other.updatedAt === item.updatedAt &&
        other.name === item.name &&
        other.kind === item.kind
      );
    });
  if (!same) await writeIndex(items);
  return items;
}

/* ---------------------------------------------------------------- 目录与 CRUD */

const BUILTIN_IDS = new Set(BUILTIN_WORKFLOWS.map((entry) => entry.id));

/** 9 条目录条目的元数据（3 条带正文，其余 6 条 needsImport）。 */
export function builtinCatalog(): WorkflowMeta[] {
  return BUILTIN_CATALOG.map((entry) => metaOfCatalog(entry));
}

function metaOfCatalog(entry: BuiltinCatalogEntry): WorkflowMeta {
  const workflow = BUILTIN_WORKFLOWS.find((item) => item.id === entry.id);
  return {
    id: entry.id,
    name: entry.name,
    purpose: entry.purpose,
    kind: entry.kind,
    protocol: workflow === undefined ? "ui" : workflow.protocol,
    builtin: true,
    requiredModels: [...entry.requiredModels],
    hasWorkflow: workflow !== undefined,
    needsImport: workflow === undefined,
    ...(entry.defaults === undefined ? {} : { defaults: { ...entry.defaults } }),
    updatedAt: 0
  };
}

/** 目录（内置 9 条 + 用户导入的，内置在前）。 */
export async function listWorkflowMetas(): Promise<WorkflowMeta[]> {
  const items = await syncIndex();
  const builtin = builtinCatalog();
  const builtinIds = new Set(builtin.map((item) => item.id));
  const installed: WorkflowMeta[] = [];
  for (const item of items) {
    if (builtinIds.has(item.id)) continue;
    installed.push({
      id: item.id,
      name: item.name,
      purpose: item.purpose,
      kind: item.kind,
      protocol: item.protocol,
      builtin: false,
      requiredModels: [...item.requiredModels],
      hasWorkflow: true,
      needsImport: false,
      updatedAt: item.updatedAt
    });
  }
  return [...builtin, ...installed];
}

export async function getWorkflowCatalog(): Promise<{ builtin: WorkflowMeta[]; installed: WorkflowMeta[] }> {
  const all = await listWorkflowMetas();
  return {
    builtin: all.filter((item) => item.builtin),
    installed: all.filter((item) => !item.builtin)
  };
}

function cloneEntry(entry: WorkflowEntry): WorkflowEntry {
  return JSON.parse(JSON.stringify(entry)) as WorkflowEntry;
}

/** 按 id 取一条完整工作流（含正文）。内置条目未导入正文时抛错并说明怎么导入。 */
export async function getWorkflowEntry(id: string): Promise<WorkflowEntry> {
  const target = assertWorkflowId(id);
  const builtin = BUILTIN_WORKFLOWS.find((entry) => entry.id === target);
  if (builtin !== undefined) return cloneEntry(builtin);
  const user = await readUserEntry(target);
  if (user !== undefined) return user;
  const catalogEntry = BUILTIN_CATALOG.find((entry) => entry.id === target);
  if (catalogEntry !== undefined) {
    throw new WorkflowError(
      "workflow-not-imported",
      "「" +
        catalogEntry.name +
        "」只是目录条目，正文还没导入。请到设置 → 墨盒 → 本地 ComfyUI · 工作流库点「导入工作流」，" +
        "选中本机 ComfyUI 的 user\\default\\workflows\\ 下对应的 JSON（界面格式与 API 格式都收）。",
      { id: target }
    );
  }
  throw new WorkflowError("workflow-not-found", "工作流不存在：" + target, { id: target });
}

function normalizeBindings(raw: unknown): WorkflowBindings {
  const out: WorkflowBindings = {};
  if (raw === null || typeof raw !== "object") return out;
  for (const key of WORKFLOW_BINDING_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim() !== "") out[key] = value.trim();
  }
  return out;
}

function normalizeDefaults(raw: unknown): WorkflowDefaults {
  const out: WorkflowDefaults = {};
  if (raw === null || typeof raw !== "object") return out;
  const record = raw as Record<string, unknown>;
  if (typeof record.width === "number" && record.width > 0) out.width = Math.round(record.width);
  if (typeof record.height === "number" && record.height > 0) out.height = Math.round(record.height);
  if (typeof record.steps === "number" && record.steps > 0) out.steps = Math.round(record.steps);
  if (typeof record.cfg === "number" && record.cfg >= 0) out.cfg = record.cfg;
  if (typeof record.sampler === "string" && record.sampler.trim() !== "") out.sampler = record.sampler.trim();
  return out;
}

/** 校验用户填的 `节点ID.输入名`：写错要立刻报，不能等到生成时才失败。 */
export function parseWorkflowBindings(raw: unknown): { bindings: WorkflowBindings; notes: string[] } {
  const out: WorkflowBindings = {};
  const notes: string[] = [];
  if (raw === null || raw === undefined) return { bindings: out, notes };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new WorkflowError("workflow-invalid-bindings", "bindings 必须是一个对象（键 = prompt / image 等，值 = 节点ID.输入名）");
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(WORKFLOW_BINDING_KEYS as readonly string[]).includes(key)) {
      throw new WorkflowError("workflow-invalid-bindings", "未知的绑定名「" + key + "」。可用：" + WORKFLOW_BINDING_KEYS.join(" / "));
    }
    if (value === null || value === undefined || value === "") continue;
    const text = String(value).trim();
    if (text === "") continue;
    const parsed = parseBinding(text);
    if (parsed === undefined) {
      throw new WorkflowError(
        "workflow-invalid-bindings",
        "绑定「" + WORKFLOW_BINDING_LABELS[key as WorkflowBindingKey] + "」的写法不对：应填「节点ID.输入名」，例如 6.text；实际是「" + text + "」"
      );
    }
    out[key as WorkflowBindingKey] = text;
    notes.push(WORKFLOW_BINDING_LABELS[key as WorkflowBindingKey] + " → " + text);
  }
  return { bindings: out, notes };
}

export interface SaveWorkflowInput {
  id?: string;
  name: string;
  purpose?: string;
  kind?: WorkflowKind;
  protocol?: WorkflowProtocol;
  /** 工作流 JSON 正文（API 格式或界面格式都收）。 */
  json: string;
  bindings?: Record<string, unknown> | WorkflowBindings;
  requiredModels?: string[];
  defaults?: WorkflowDefaults;
  notes?: string;
  sourcePath?: string;
  /** 内部用（不进 wire）：有它才能把界面格式精确转换（读 /object_info）。 */
  request?: ComfyRequest;
}

export interface SaveWorkflowResult {
  id: string;
  name: string;
  protocol: WorkflowProtocol;
  converted: boolean;
  nodes: number;
  droppedWidgets: number;
  bindings: WorkflowBindings;
  notes: string[];
}

/**
 * 导入 / 编辑一条工作流。
 *
 * 没给 id = 新建（id 由内容哈希得出，重复导入同一份 JSON 会得到**同一个 id** 并覆盖更新；
 * 用户改过名字时也一样 —— 这正是「重新导入修好的版本」想要的行为）。
 */
export async function saveWorkflow(input: SaveWorkflowInput): Promise<SaveWorkflowResult> {
  const name = String(input.name ?? "").trim();
  if (name === "") throw new WorkflowError("workflow-invalid", "工作流名称不能为空");
  if (name.length > 80) throw new WorkflowError("workflow-invalid", "工作流名称最多 80 个字符");
  if (typeof input.json !== "string" || input.json.trim() === "") {
    throw new WorkflowError("workflow-invalid-json", "工作流 JSON 是空的");
  }
  const parsed = await parseWorkflowText(input.json, { request: input.request });
  const notes: string[] = [...parsed.notes];
  const requestedId = input.id === undefined || input.id === "" ? undefined : assertWorkflowId(String(input.id));
  if (requestedId !== undefined && BUILTIN_IDS.has(requestedId)) {
    throw new WorkflowError("workflow-builtin-immutable", "内置工作流不能覆盖（" + requestedId + "）：请另存为一个新条目。", { id: requestedId });
  }
  const { bindings, notes: bindingNotes } = parseWorkflowBindings(input.bindings);
  notes.push(...bindingNotes);
  const placeholders = scanPlaceholders(parsed.workflow);
  if (placeholders.length > 0) {
    notes.push(
      "识别到占位符：" +
        placeholders.map((item) => "{{" + item.key + "}} → " + item.node + "." + item.input).join("、") +
        "（生成时会自动替换）"
    );
  }
  const now = Date.now();
  const id =
    requestedId ??
    "wf_" +
      createHash("sha1")
        .update(name + "\u0000" + input.json)
        .digest("hex")
        .slice(0, 10);
  const existing = requestedId === undefined ? await readUserEntry(id) : await readUserEntry(id);
  const entry: WorkflowEntry = {
    id,
    name,
    purpose: String(input.purpose ?? "").trim(),
    kind: input.kind === "post" ? "post" : "generate",
    protocol: parsed.protocol,
    builtin: false,
    requiredModels: Array.isArray(input.requiredModels) ? input.requiredModels.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [],
    bindings,
    ...(input.defaults === undefined ? {} : { defaults: normalizeDefaults(input.defaults) }),
    workflow: parsed.workflow,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(input.notes === undefined || input.notes === "" ? {} : { notes: input.notes }),
    ...(input.sourcePath === undefined || input.sourcePath === "" ? {} : { sourcePath: input.sourcePath })
  };
  await persistEntry(entry);
  if (existing !== undefined) notes.push("已更新已有的工作流条目「" + existing.name + "」。");
  return {
    id,
    name,
    protocol: entry.protocol,
    converted: parsed.protocol === "ui",
    nodes: parsed.nodes,
    droppedWidgets: 0,
    bindings,
    notes
  };
}

async function persistEntry(entry: WorkflowEntry): Promise<void> {
  const target = workflowFile(entry.id);
  const tmp = target + ".tmp";
  await mkdir(workflowsRoot(), { recursive: true });
  await writeFile(tmp, JSON.stringify(entry, null, 2) + "\n", "utf8");
  await rename(tmp, target);
  await syncIndex();
}

/** 删除一条用户导入的工作流。内置条目不可删除（正文跟着版本走）。 */
export async function removeWorkflow(id: string): Promise<{ id: string; removed: boolean }> {
  const target = assertWorkflowId(id);
  if (BUILTIN_IDS.has(target) || BUILTIN_CATALOG.some((entry) => entry.id === target)) {
    throw new WorkflowError("workflow-builtin-immutable", "内置工作流不能删除：" + target, { id: target });
  }
  await rm(workflowFile(target), { force: true });
  await syncIndex();
  return { id: target, removed: true };
}

/** 把索引与目录重新对齐一次（设置页「刷新」用；返回重整后的条目数）。 */
export async function rebuildWorkflowLibrary(): Promise<{ installed: number; builtin: number }> {
  const items = await syncIndex();
  return { installed: items.length, builtin: BUILTIN_CATALOG.length };
}

/* ---------------------------------------------------------------- 占位符 */

export interface WorkflowPlaceholder {
  key: string;
  node: string;
  input: string;
}

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

/** 扫描工作流里所有的 `{{key}}` 占位符（递归整棵树）。 */
export function scanPlaceholders(workflow: ComfyWorkflow): WorkflowPlaceholder[] {
  const found: WorkflowPlaceholder[] = [];
  for (const [nodeId, node] of Object.entries(workflow ?? {})) {
    const inputs = node?.inputs;
    if (inputs === undefined) continue;
    for (const [input, value] of Object.entries(inputs)) {
      if (typeof value !== "string") continue;
      PLACEHOLDER_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = PLACEHOLDER_RE.exec(value)) !== null) {
        found.push({ key: match[1], node: nodeId, input });
      }
    }
  }
  return found;
}

/** 占位符别名 → 绑定键（`{{negative_prompt}}` 与 `{{negative}}` 是同一件事）。 */
const PLACEHOLDER_ALIASES: Record<string, WorkflowBindingKey> = {
  prompt: "prompt",
  text: "prompt",
  negative: "negative",
  negative_prompt: "negative",
  width: "width",
  height: "height",
  seed: "seed",
  image: "image",
  image_1: "image",
  image1: "image",
  image_2: "image2",
  image2: "image2",
  first: "first",
  first_frame: "first",
  last: "last",
  last_frame: "last",
  batch: "batch",
  steps: "steps",
  cfg: "cfg",
  cfg_scale: "cfg",
  sampler: "sampler",
  denoising: "denoising",
  denoising_strength: "denoising"
};

/* ---------------------------------------------------------------- 绑定解析 */

export interface WorkflowBindingCandidate {
  node: string;
  input: string;
  title: string;
  classType: string;
  /** 已经是连线（`[节点, 槽位]`）时为 true —— 这种位置不能直接写值。 */
  linked: boolean;
}

export interface WorkflowBindingPlan {
  bindings: WorkflowBindings;
  sources: Partial<Record<WorkflowBindingKey, "explicit" | "placeholder" | "detected">>;
  /** 占位符实际落在哪个输入上（注入时会先替换它们）。 */
  placeholders: WorkflowPlaceholder[];
  /** 工作流**必须有**的绑定：generate 要 prompt，post 要 image。 */
  critical: WorkflowBindingKey[];
  missing: WorkflowBindingKey[];
  /** 缺关键绑定时的候选节点（报错与设置页提示共用）。 */
  candidates: Partial<Record<WorkflowBindingKey, WorkflowBindingCandidate[]>>;
  notes: string[];
  detected: ComfyBindings;
}

const PROMPT_LIKE_KEYS = ["text", "prompt", "positive", "positive_prompt", "caption", "text_g", "text_l"];
const NEGATIVE_LIKE_KEYS = ["negative", "negative_prompt", "text_negative", "neg"];
const IMAGE_LIKE_KEYS = ["image", "image_1", "image1", "first_image", "init_image", "reference", "control_image", "pose_image"];
const IMAGE2_LIKE_KEYS = ["image_2", "image2", "pose", "pose_image", "reference_image", "control_image"];
const STEPS_LIKE_KEYS = ["steps", "num_steps", "step"];
const CFG_LIKE_KEYS = ["cfg", "cfg_scale", "guidance", "guidance_scale"];
const SAMPLER_LIKE_KEYS = ["sampler", "sampler_name", "sampler_mode"];
const DENOISE_LIKE_KEYS = ["denoising", "denoise", "denoising_strength", "strength"];
const BATCH_LIKE_KEYS = ["batch", "batch_size", "amount", "count"];

function sortedNodeIds(workflow: ComfyWorkflow): string[] {
  return Object.keys(workflow ?? {}).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    const fa = Number.isFinite(na);
    const fb = Number.isFinite(nb);
    if (fa && fb) return na - nb;
    if (fa !== fb) return fa ? -1 : 1;
    return a.localeCompare(b);
  });
}

function titleOf(classType: string, node: any): string {
  const title = node?._meta?.title;
  return typeof title === "string" && title !== "" ? title + "（" + classType + "）" : classType;
}

/** 在整棵工作流里找「名字像 X 且类型对得上」的候选输入。 */
function findCandidates(workflow: ComfyWorkflow, keys: string[], want: "string" | "number", preferClass?: RegExp): WorkflowBindingCandidate[] {
  const out: WorkflowBindingCandidate[] = [];
  for (const nodeId of sortedNodeIds(workflow)) {
    const node = workflow[nodeId];
    const inputs = node?.inputs;
    if (inputs === undefined) continue;
    const classType = String(node?.class_type ?? "");
    for (const key of keys) {
      const value = inputs[key];
      if (value === undefined) continue;
      if (want === "string" && typeof value !== "string") continue;
      if (want === "number" && typeof value !== "number") continue;
      const linked = Array.isArray(value);
      out.push({ node: nodeId, input: key, title: titleOf(classType, node), classType, linked });
    }
    if (preferClass !== undefined && preferClass.test(classType)) {
      for (const [key, value] of Object.entries(inputs)) {
        if (typeof value !== "string") continue;
        if (keys.includes(key)) continue;
        if (!/^[a-z][a-z0-9_]*$/i.test(key)) continue;
        out.push({ node: nodeId, input: key, title: titleOf(classType, node), classType, linked: Array.isArray(value) });
      }
    }
  }
  return out;
}

/**
 * 三级绑定解析（**这一层的核心**）。
 *
 *   1. 条目上显式写的 `bindings`（`节点ID.输入名`）；
 *   2. 工作流里的 `{{占位符}}`（交给注入时的 JSON 树替换）；
 *   3. `detectComfyBindings` 自动探测（有 `/object_info` 时连「工作流里没连的 optional IMAGE」
 *      也能发现；没有网络时退化成「只看工作流里已经写着的输入」）。
 *
 * 三级都拿不到关键绑定 **不抛错**，而是把 `missing` 与候选交回去 ——
 * 让调用方（设置页预览 / 生成前检查）决定怎么展示；生成入口会调
 * `assertWorkflowBindings` 抛 `workflow-binding-missing`。
 */
/**
 * 从采样器 / 引导器的 positive / negative 连线反查条件节点里的文本输入。
 *
 * 为什么需要：像素风 SDXL 这类工作流有两个 CLIPTextEncode（正 / 负各一个），
 * 两个节点的输入名都叫 text。只按「名字像 text」取第一个会把**负面提示词**
 * 当成正面写进去（或反过来）——不报错，只是出图质量莫名变差。
 * 连线是唯一可靠的语义来源：KSampler.negative 指向的那个节点才是负面。
 *
 * 一个条件节点可能有多个字符串输入（text / text_g / text_l），按 PROMPT_LIKE_KEYS 的顺序取。
 */
function conditioningBindings(workflow: ComfyWorkflow): { positive?: string; negative?: string } {
  const out: { positive?: string; negative?: string } = {};
  const samplerRe = /KSampler|Sampler|Guider|CFG/i;
  for (const nodeId of sortedNodeIds(workflow)) {
    const node = workflow[nodeId];
    const classType = String(node?.class_type ?? "");
    if (!samplerRe.test(classType)) continue;
    for (const which of ["positive", "negative"] as const) {
      const link = node?.inputs?.[which];
      if (!Array.isArray(link) || link.length < 2) continue;
      const target = workflow[String(link[0])];
      const inputs = target?.inputs;
      if (inputs === undefined) continue;
      // 同一个条件节点可能同时提供正负两个输出槽（例如 TextEncodeQwenImage21 的
      // positive=槽 0 / negative=槽 1）：负向先找名字里带 negative 的输入。
      const keys = which === "negative" ? [...NEGATIVE_LIKE_KEYS, ...PROMPT_LIKE_KEYS] : PROMPT_LIKE_KEYS;
      for (const key of keys) {
        const value = inputs[key];
        if (typeof value !== "string") continue;
        const candidate = String(link[0]) + "." + key;
        if (which === "negative" && candidate === out.positive) continue;
        if (which === "positive" && candidate === out.negative) continue;
        out[which] = candidate;
        break;
      }
    }
  }
  return out;
}

export function resolveWorkflowBindings(entry: WorkflowEntry, info?: ComfyObjectInfo): WorkflowBindingPlan {
  const workflow = entry.workflow ?? {};
  const notes: string[] = [];
  const sources: Partial<Record<WorkflowBindingKey, "explicit" | "placeholder" | "detected">> = {};
  const bindings: WorkflowBindings = {};

  // ── 1. 显式 ──
  for (const key of WORKFLOW_BINDING_KEYS) {
    const raw = entry.bindings?.[key];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const parsed = parseBinding(raw);
    if (parsed === undefined) {
      notes.push("显式绑定「" + WORKFLOW_BINDING_LABELS[key] + "」写法不对（" + raw + "），已忽略。");
      continue;
    }
    if (workflow[parsed.node] === undefined) {
      notes.push("显式绑定「" + WORKFLOW_BINDING_LABELS[key] + "」指向的节点 " + parsed.node + " 不存在，已忽略。");
      continue;
    }
    bindings[key] = raw;
    sources[key] = "explicit";
  }

  // ── 2. 占位符 ──
  const placeholders = scanPlaceholders(workflow);
  for (const item of placeholders) {
    const key = PLACEHOLDER_ALIASES[item.key.toLowerCase()];
    if (key === undefined) continue;
    if (bindings[key] === undefined) {
      bindings[key] = item.node + "." + item.input;
      sources[key] = "placeholder";
    }
  }
  if (placeholders.length > 0) {
    notes.push(
      "工作流里有占位符：" +
        placeholders.map((item) => "{{" + item.key + "}} → " + item.node + "." + item.input).join("、")
    );
  }

  // ── 3. 自动探测（复用 comfy.ts 的那一套，语义不变）──
  const detected = detectComfyBindings(
    workflow,
    {
      prompt: entry.bindings?.prompt,
      width: entry.bindings?.width,
      height: entry.bindings?.height,
      seed: entry.bindings?.seed,
      first: entry.bindings?.first ?? entry.bindings?.image,
      last: entry.bindings?.last
    },
    info
  );
  // detectComfyBindings 是视频链路的老函数，会给「没有首帧注入点」这种视频语义的提示；
  // 生图工作流里那句话只会误导人（没有图像输入是正常的），过滤掉。
  notes.push(...detected.notes.filter((note) => !note.includes("图生视频") && !note.includes("尾帧")));
  const fromDetected: Array<[WorkflowBindingKey, ComfyBinding | undefined]> = [
    ["prompt", detected.bindings.prompt],
    ["width", detected.bindings.width],
    ["height", detected.bindings.height],
    ["seed", detected.bindings.seed],
    ["image", detected.bindings.first],
    ["first", detected.bindings.first],
    ["last", detected.bindings.last]
  ];
  for (const [key, binding] of fromDetected) {
    if (key === "image" && bindings.image !== undefined) continue;
    if (key === "first" && bindings.image !== undefined) continue;
    if (binding === undefined) continue;
    if (bindings[key] !== undefined) continue;
    bindings[key] = binding.node + "." + binding.input;
    sources[key] = "detected";
  }
  // 探测只认 prompt / 尺寸 / 种子 / 图；其余（负面提示词、步数、CFG、采样器、批量）用同一套
  // 「名字像 + 类型对」的规则补一遍 —— 不这样做，像素工作流的 negative / steps 只能手工填。
  const extra: Array<[WorkflowBindingKey, string[], "string" | "number"]> = [
    ["negative", NEGATIVE_LIKE_KEYS, "string"],
    ["steps", STEPS_LIKE_KEYS, "number"],
    ["cfg", CFG_LIKE_KEYS, "number"],
    ["sampler", SAMPLER_LIKE_KEYS, "string"],
    ["denoising", DENOISE_LIKE_KEYS, "number"],
    ["batch", BATCH_LIKE_KEYS, "number"],
    ["image2", IMAGE2_LIKE_KEYS, "string"]
  ];
  const candidates: Partial<Record<WorkflowBindingKey, WorkflowBindingCandidate[]>> = {};
  /**
   * 顺着采样器的 positive / negative 连线找提示词节点（比「名字像 text」可靠）。
   * 像素风 SDXL 这类工作流正负两个 CLIPTextEncode 的输入名都是 text。
   */
  const conditioning = conditioningBindings(workflow);
  if (conditioning.positive !== undefined && (bindings.prompt === undefined || sources.prompt === "detected")) {
    bindings.prompt = conditioning.positive;
    sources.prompt = "detected";
  }
  if (conditioning.negative !== undefined && bindings.negative === undefined) {
    bindings.negative = conditioning.negative;
    sources.negative = "detected";
  } else if (bindings.negative === undefined) {
    notes.push("没有找到负面提示词的注入点（采样器没有 negative 连线，或负面节点没有文本输入）。");
  }
  for (const [key, keys, want] of extra) {
    if (bindings[key] !== undefined) continue;
    const found = findCandidates(workflow, keys, want);
    if (found.length > 0) {
      const usable = found.find((item) => !item.linked) ?? found[0];
      bindings[key] = usable.node + "." + usable.input;
      sources[key] = "detected";
      if (found.length > 1) notes.push(WORKFLOW_BINDING_LABELS[key] + "有 " + found.length + " 个候选，当前用 " + bindings[key] + "。");
    }
  }
  // 第二张参考图：image 已用掉的那个 LoadImage 不能重复用（一张图装不了两张）。
  if (bindings.image2 !== undefined && bindings.image === bindings.image2) delete bindings.image2;

  const critical: WorkflowBindingKey[] = entry.kind === "post" ? ["image"] : ["prompt"];
  if (entry.kind === "post" && bindings.image === undefined && bindings.first !== undefined) bindings.image = bindings.first;
  const missing: WorkflowBindingKey[] = [];
  for (const key of critical) {
    if (bindings[key] !== undefined) continue;
    if (placeholders.some((item) => PLACEHOLDER_ALIASES[item.key.toLowerCase()] === key)) continue;
    missing.push(key);
    candidates[key] = candidateHints(workflow, key);
  }
  if (missing.length > 0) {
    notes.push(
      "缺少关键绑定：" +
        missing.map((key) => WORKFLOW_BINDING_LABELS[key]).join("、") +
        "。请在工作流条目里手工指定（写法「节点ID.输入名」，可用候选见候选节点）。"
    );
  }
  return { bindings, sources, placeholders, critical, missing, candidates, notes, detected: detected.bindings };
}

const IMAGE_CLASS_RE = /LoadImage|Image|Mask|ControlNet|Reference|IPAdapter/i;
const TEXT_CLASS_RE = /TextEncode|Text|CLIP|Prompt|String/i;

function candidateHints(workflow: ComfyWorkflow, key: WorkflowBindingKey): WorkflowBindingCandidate[] {
  if (key === "prompt" || key === "negative") {
    const keys = key === "prompt" ? PROMPT_LIKE_KEYS : NEGATIVE_LIKE_KEYS;
    const found = findCandidates(workflow, keys, "string", TEXT_CLASS_RE);
    // 纯 CLIPTextEncode 的 text 已经是字符串，findCandidates 第一轮就命中了；这里只兜底「名字不像但类型像」的。
    if (found.length > 0) return found.slice(0, 8);
  }
  if (key === "image" || key === "image2" || key === "first" || key === "last") {
    const found = findCandidates(workflow, IMAGE_LIKE_KEYS, "string", IMAGE_CLASS_RE);
    if (found.length > 0) return found.slice(0, 8);
  }
  return findCandidates(workflow, key === "cfg" ? CFG_LIKE_KEYS : [], "string").slice(0, 8);
}

/** 关键绑定缺了就抛错：文案里必须带**候选节点**与**手工写法**。 */
export function assertWorkflowBindings(entry: WorkflowEntry, plan: WorkflowBindingPlan): void {
  if (plan.missing.length === 0) return;
  const parts = plan.missing.map((key) => {
    const hints = plan.candidates[key] ?? [];
    const list =
      hints.length === 0
        ? "（这个工作流里没有找到名字像「" + WORKFLOW_BINDING_LABELS[key] + "」的输入）"
        : hints.map((item) => item.node + "." + item.input + (item.title === "" ? "" : " " + item.title) + (item.linked ? "（已有连线，需先在 ComfyUI 里断开）" : "")).join("、");
    return WORKFLOW_BINDING_LABELS[key] + "：候选节点 " + list + "；手工写法 bindings." + key + " = \"" + (hints[0] === undefined ? "节点ID.输入名" : hints[0].node + "." + hints[0].input) + "\"";
  });
  throw new WorkflowError(
    "workflow-binding-missing",
    "工作流「" + entry.name + "」缺少关键注入点，不能静默跳过（否则提示词会被忽略、图会按工作流里的旧值出）。" + parts.join("；"),
    {
      id: entry.id,
      missing: plan.missing,
      candidates: plan.candidates,
      bindings: plan.bindings
    }
  );
}

/* ---------------------------------------------------------------- 注入 */

export interface WorkflowInjectInput {
  prompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  cfgScale?: number;
  sampler?: string;
  denoising?: number;
  batch?: number;
  /** 已上传到 ComfyUI 的输入图文件名（按顺序：image、image2 / first、last）。 */
  imageNames?: string[];
}

export interface WorkflowInjectResult {
  workflow: ComfyWorkflow;
  notes: string[];
  applied: WorkflowBindingKey[];
  usedPlaceholders: string[];
}

function cloneWorkflow(workflow: ComfyWorkflow): ComfyWorkflow {
  return JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
}

function placeholderValues(input: WorkflowInjectInput, imageNames: string[], negative: string): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  if (input.prompt !== undefined) {
    values.prompt = input.prompt;
    values.text = input.prompt;
  }
  if (negative !== "") {
    values.negative = negative;
    values.negative_prompt = negative;
  }
  if (input.width !== undefined) values.width = Math.round(input.width);
  if (input.height !== undefined) values.height = Math.round(input.height);
  if (input.seed !== undefined) values.seed = Math.floor(input.seed);
  if (input.steps !== undefined) {
    values.steps = Math.round(input.steps);
    values.num_steps = Math.round(input.steps);
  }
  if (input.cfgScale !== undefined) {
    values.cfg = input.cfgScale;
    values.cfg_scale = input.cfgScale;
  }
  if (input.sampler !== undefined) {
    values.sampler = input.sampler;
    values.sampler_name = input.sampler;
  }
  if (input.denoising !== undefined) {
    values.denoising = input.denoising;
    values.denoising_strength = input.denoising;
  }
  if (input.batch !== undefined) values.batch = Math.round(input.batch);
  imageNames.forEach((name, index) => {
    values["image" + (index + 1)] = name;
    if (index === 0) {
      values.image = name;
      values.image_1 = name;
    }
    if (index === 1) {
      values.image2 = name;
      values.image_2 = name;
    }
  });
  return values;
}

/** JSON 树替换：整串恰好是占位符 → 取原始类型（数字仍是数字），嵌在中间 → 取文本。 */
function substituteTree(node: unknown, values: Record<string, string | number>, used: Set<string>): unknown {
  if (typeof node === "string") {
    const exact = /^\{\{(\w+)\}\}$/.exec(node);
    if (exact !== null && Object.prototype.hasOwnProperty.call(values, exact[1])) {
      used.add(exact[1]);
      return values[exact[1]];
    }
    return node.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
      if (!Object.prototype.hasOwnProperty.call(values, key)) return whole;
      used.add(key);
      return String(values[key]);
    });
  }
  if (Array.isArray(node)) {
    // 连线是 [节点ID, 槽位]，里面可能带占位符（少见），同样递归。
    return node.map((item) => substituteTree(item, values, used));
  }
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) out[key] = substituteTree(value, values, used);
    return out;
  }
  return node;
}

function writeLiteral(workflow: ComfyWorkflow, binding: string | undefined, value: unknown, label: string, notes: string[]): boolean {
  if (binding === undefined) return false;
  const parsed = parseBinding(binding);
  if (parsed === undefined) return false;
  const node = workflow[parsed.node];
  if (node === undefined) {
    notes.push(label + "目标 " + binding + " 指向的节点不存在，已跳过。");
    return false;
  }
  const inputs = node.inputs ?? {};
  if (Array.isArray(inputs[parsed.input])) {
    notes.push(label + "目标 " + binding + " 现在是连线，已跳过注入（要在 ComfyUI 里先断开这条连线）。");
    return false;
  }
  node.inputs = { ...inputs, [parsed.input]: value };
  return true;
}

function nextNodeId(workflow: ComfyWorkflow): string {
  let max = 0;
  for (const id of Object.keys(workflow)) {
    const value = Number(id);
    if (Number.isFinite(value) && value > max) max = Math.floor(value);
  }
  let candidate = String(max + 1);
  while (Object.prototype.hasOwnProperty.call(workflow, candidate)) candidate = String(Number(candidate) + 1);
  return candidate;
}

/**
 * 把输入图接到工作流上。
 *
 * 目标本来就是 `LoadImage.image` → 直接换文件名（不动连线，最稳）；
 * 目标是别的节点的 IMAGE 输入 → 插入一个 LoadImage 节点再连线。
 */
function injectImage(workflow: ComfyWorkflow, binding: string | undefined, name: string, label: string, notes: string[]): boolean {
  if (binding === undefined) return false;
  const parsed = parseBinding(binding);
  if (parsed === undefined) return false;
  const node = workflow[parsed.node];
  if (node === undefined) {
    notes.push(label + "目标 " + binding + " 指向的节点不存在，已跳过。");
    return false;
  }
  if (node.class_type === "LoadImage" && parsed.input === "image") {
    node.inputs = { ...(node.inputs ?? {}), image: name };
    notes.push("已把" + label + "替换为 " + name + "（工作流自带的 LoadImage 节点 " + parsed.node + "）。");
    return true;
  }
  const newId = nextNodeId(workflow);
  workflow[newId] = { class_type: "LoadImage", inputs: { image: name }, _meta: { title: "墨盒 · " + label } } as any;
  node.inputs = { ...(node.inputs ?? {}) };
  (node.inputs as Record<string, unknown>)[parsed.input] = [newId, 0];
  notes.push("已插入 LoadImage 节点 " + newId + "，把 " + name + " 接到 " + binding + "。");
  return true;
}

/** 按解析结果把参数写进工作流（纯函数：不改传入对象）。 */
export function applyWorkflowInputs(entry: WorkflowEntry, plan: WorkflowBindingPlan, input: WorkflowInjectInput): WorkflowInjectResult {
  const notes: string[] = [];
  const applied: WorkflowBindingKey[] = [];
  const imageNames = Array.isArray(input.imageNames) ? input.imageNames.filter((name) => typeof name === "string" && name !== "") : [];
  const negative = input.negativePrompt === undefined ? "" : input.negativePrompt;
  const values = placeholderValues(input, imageNames, negative ?? "");
  const used = new Set<string>();
  const workflow = substituteTree(cloneWorkflow(entry.workflow ?? {}), values, used) as ComfyWorkflow;
  if (used.size > 0) notes.push("已替换占位符：" + Array.from(used).map((key) => "{{" + key + "}}").join("、"));

  const bindingOf = (key: WorkflowBindingKey): string | undefined => plan.bindings[key];
  const covered = (key: WorkflowBindingKey): boolean => {
    const aliases = Object.entries(PLACEHOLDER_ALIASES).filter(([, value]) => value === key).map(([alias]) => alias);
    return aliases.some((alias) => used.has(alias));
  };
  const write = (key: WorkflowBindingKey, value: unknown): void => {
    if (value === undefined) return;
    if (covered(key)) return;
    if (writeLiteral(workflow, bindingOf(key), value, WORKFLOW_BINDING_LABELS[key], notes)) applied.push(key);
  };

  if (input.prompt !== undefined) write("prompt", input.prompt);
  write("negative", negative === "" ? undefined : negative);
  write("width", input.width === undefined ? undefined : Math.round(input.width));
  write("height", input.height === undefined ? undefined : Math.round(input.height));
  write("seed", input.seed === undefined ? undefined : Math.max(0, Math.floor(input.seed)));
  write("steps", input.steps === undefined ? undefined : Math.round(input.steps));
  if (input.cfgScale !== undefined) write("cfg", input.cfgScale);
  write("sampler", input.sampler);
  write("denoising", input.denoising);
  write("batch", input.batch === undefined ? undefined : Math.round(input.batch));

  // 图像：image / image2 / first / last。优先用 image 系列的绑定，first 作为兼容位。
  const imageTargets: Array<[WorkflowBindingKey, string]> = [
    ["image", imageNames[0]],
    ["image2", imageNames[1]],
    ["first", imageNames[0]],
    ["last", imageNames[1]]
  ];
  for (const [key, name] of imageTargets) {
    if (name === undefined || name === "") continue;
    if (covered(key)) continue;
    // image 与 first 通常指向同一个 LoadImage：写过一次就不要再写。
    if (key === "first" && (applied.includes("image") || bindingOf("image") === bindingOf("first"))) continue;
    if (key === "last" && imageNames[1] === undefined) continue;
    if (injectImage(workflow, bindingOf(key), name, WORKFLOW_BINDING_LABELS[key], notes)) applied.push(key);
  }
  return { workflow, notes, applied, usedPlaceholders: Array.from(used) };
}

/* ---------------------------------------------------------------- 自检（只读检查） */

export interface WorkflowModelCheck {
  node: string;
  classType: string;
  input: string;
  value: string;
  exists: boolean;
}

export interface WorkflowInspection {
  ok: boolean;
  nodes: number;
  classTypes: string[];
  missingNodeTypes: string[];
  modelChecks: WorkflowModelCheck[];
  missingModels: string[];
  bindings: WorkflowBindings;
  sources: PartWorkflowBindingSources;
  placeholders: WorkflowPlaceholder[];
  critical: WorkflowBindingKey[];
  missing: WorkflowBindingKey[];
  candidates: Partial<Record<WorkflowBindingKey, WorkflowBindingCandidate[]>>;
  notes: string[];
}

type PartWorkflowBindingSources = Partial<Record<WorkflowBindingKey, "explicit" | "placeholder" | "detected">>;

/** 看起来是「模型文件名」的输入名（ComfyUI 各 Loader 的惯例）。 */
const MODEL_INPUT_NAMES = new Set([
  "ckpt_name",
  "unet_name",
  "clip_name",
  "clip_name1",
  "clip_name2",
  "clip_name3",
  "vae_name",
  "lora_name",
  "control_net_name",
  "bg_removal_name",
  "style_model_name",
  "gligen_name",
  "upscale_model_name",
  "model_name",
  "model"
]);

/** 从节点定义里取某个输入的可选值列表（兼容 [选项数组] 与 ["COMBO", {options}] 两种写法）。 */
export function inputOptionsOf(spec: any, input: string): string[] | undefined {
  const group = spec?.input ?? spec;
  for (const part of [group?.required ?? {}, group?.optional ?? {}]) {
    const raw = part[input];
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const first = raw[0];
    if (Array.isArray(first)) return first.filter((item: unknown) => typeof item === "string");
    if (first === "COMBO" && raw[1] !== null && typeof raw[1] === "object" && Array.isArray((raw[1] as any).options)) {
      return ((raw[1] as any).options as unknown[]).filter((item: unknown) => typeof item === "string");
    }
    return undefined;
  }
  return undefined;
}

function isModelInput(classType: string, input: string): boolean {
  if (MODEL_INPUT_NAMES.has(input)) return true;
  if (/(_name|_file)$/.test(input) && /(Loader|Checkpoint|Upscale|ControlNet|Lora|VAE|CLIP|UNET|Model)/i.test(classType)) return true;
  return false;
}

/**
 * 只读检查：节点类型是否都有、模型文件是否都在、绑定认出几个。
 *
 * 前提：调用方已经确认 ComfyUI 可达（`selfTestWorkflow` 里先跑 /system_stats），
 * 否则 `fetchComfyObjectInfo` 会把「连不上」静默吞掉，表现成「所有节点都不存在」。
 */
export async function inspectWorkflow(entry: WorkflowEntry, request: ComfyRequest): Promise<WorkflowInspection> {
  const workflow = entry.workflow ?? {};
  const classTypes = Array.from(new Set(sortedNodeIds(workflow).map((id) => String(workflow[id]?.class_type ?? "")).filter((item) => item !== "")));
  const info = await fetchComfyObjectInfo(request, classTypes);
  const missingNodeTypes = classTypes.filter((item) => info[item] === undefined);
  const modelChecks: WorkflowModelCheck[] = [];
  const missingModels: string[] = [];
  for (const nodeId of sortedNodeIds(workflow)) {
    const node = workflow[nodeId];
    const classType = String(node?.class_type ?? "");
    const inputs = node?.inputs;
    if (inputs === undefined) continue;
    for (const [input, value] of Object.entries(inputs)) {
      if (typeof value !== "string") continue;
      if (!isModelInput(classType, input)) continue;
      const options = inputOptionsOf(info[classType], input);
      if (options === undefined) continue;
      const exists = options.includes(value);
      modelChecks.push({ node: nodeId, classType, input, value, exists });
      if (!exists && !missingModels.includes(value)) missingModels.push(value);
    }
  }
  // 条目声明的 requiredModels 逐个核对（有些模型是在工作流里间接引用的）。
  const optionPool = new Set<string>();
  for (const classType of classTypes) {
    const spec = info[classType];
    if (spec === undefined) continue;
    const inputNames = Object.keys({ ...(spec.input?.required ?? spec.required ?? {}), ...(spec.input?.optional ?? spec.optional ?? {}) });
    for (const input of inputNames) {
      if (!isModelInput(classType, input)) continue;
      for (const option of inputOptionsOf(spec, input) ?? []) optionPool.add(option);
    }
  }
  for (const model of entry.requiredModels ?? []) {
    if (model === "") continue;
    const exists = optionPool.has(model) || Array.from(optionPool).some((option) => option.endsWith("/" + model) || option.endsWith("\\" + model));
    if (!exists && !missingModels.includes(model)) missingModels.push(model);
  }
  const plan = resolveWorkflowBindings(entry, info);
  const ok = missingNodeTypes.length === 0 && missingModels.length === 0 && plan.missing.length === 0;
  return {
    ok,
    nodes: Object.keys(workflow).length,
    classTypes,
    missingNodeTypes,
    modelChecks,
    missingModels,
    bindings: plan.bindings,
    sources: plan.sources,
    placeholders: plan.placeholders,
    critical: plan.critical,
    missing: plan.missing,
    candidates: plan.candidates,
    notes: plan.notes
  };
}

/* ---------------------------------------------------------------- 界面格式的精确转换 */

/**
 * 界面格式 → API 格式（**按 /object_info 的节点定义精确映射控件值**）。
 *
 * 为什么不能只靠 parseComfyWorkflow 的离线近似：本机 ComfyUI 存的
 * user/default/workflows/*.json 是界面格式，inputs 数组里只留**连线过**的输入，
 * 控件值放在 widgets_values（按顺序）或 widgets_values_named（按名字）。
 * 没有节点定义就只能猜名字 —— 猜不出来时 parseComfyWorkflow 会返回
 * droppedWidgets > 0，实测「透明精灵 Turbo」13 个节点丢 20 个控件值
 * （提示词、模型名、尺寸全没了），而且**不报错**，提交后 ComfyUI 用默认值跑一遍。
 *
 * 这里的做法：按 /object_info 里 required → optional 的输入顺序消费 widgets_values，
 * 跳过连线类输入（IMAGE / LATENT / MODEL / CLIP …）与 seed 后面的 fixed/randomize 控件词；
 * 有 widgets_values_named 时优先按名字映射。
 *
 * ⚠️ Lead 的主分支在 src/interop.ts 里有同一件事的实现（convertUiWorkflowWithObjectInfo），
 * 合并时统一去重；这里先自带一份，保证工作流库单独就能「导入界面格式不丢控件值」。
 */
export interface PreciseUiConversion {
  workflow: ComfyWorkflow;
  nodes: number;
  problems: string[];
}

const LINK_TYPE_WORDS = new Set([
  "IMAGE",
  "LATENT",
  "MODEL",
  "CLIP",
  "CONDITIONING",
  "VAE",
  "MASK",
  "CONTROL_NET",
  "SAMPLER",
  "SIGMAS",
  "NOISE",
  "GUIDER",
  "BACKGROUND_REMOVAL",
  "CLIP_VISION",
  "UPSCALE_MODEL",
  "AUDIO",
  "VIDEO",
  "SEGS"
]);

const WIDGET_CONTROL_WORDS = new Set(["fixed", "increment", "decrement", "randomize"]);

function uiLinkTable(record: Record<string, unknown>): Map<number, { originId: string; originSlot: number }> {
  const table = new Map<number, { originId: string; originSlot: number }>();
  if (!Array.isArray(record.links)) return table;
  for (const item of record.links) {
    if (Array.isArray(item)) {
      table.set(Number(item[0]), { originId: String(item[1] ?? ""), originSlot: Number(item[2] ?? 0) || 0 });
    } else if (item !== null && typeof item === "object") {
      const entry = item as Record<string, unknown>;
      table.set(Number(entry.id), { originId: String(entry.origin_id ?? ""), originSlot: Number(entry.origin_slot ?? 0) || 0 });
    }
  }
  return table;
}

/** 界面格式里出现过的节点类型（用于一次性查 /object_info）。 */
export function collectUiClassTypes(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const nodes = (parsed as any)?.nodes;
  if (!Array.isArray(nodes)) return [];
  const types = new Set<string>();
  for (const node of nodes) {
    const type = typeof node?.type === "string" ? node.type.trim() : "";
    if (type !== "" && type !== "Note" && type !== "MarkdownNote") types.add(type);
  }
  return Array.from(types);
}

function specGroupOf(spec: any): { required: Record<string, unknown>; optional: Record<string, unknown> } {
  const group = spec?.input ?? spec ?? {};
  return { required: group.required ?? {}, optional: group.optional ?? {} };
}

function inputTypeOf(spec: any, name: string): string {
  const { required, optional } = specGroupOf(spec);
  const raw = required[name] ?? optional[name];
  if (!Array.isArray(raw) || raw.length === 0) return "UNKNOWN";
  if (Array.isArray(raw[0])) return "COMBO";
  if (raw[0] === "COMBO") return "COMBO";
  return String(raw[0]);
}

export function convertUiWorkflowPrecise(record: Record<string, unknown>, info: ComfyObjectInfo): PreciseUiConversion {
  const rawNodes = record.nodes;
  const problems: string[] = [];
  if (!Array.isArray(rawNodes)) return { workflow: {}, nodes: 0, problems: ["没有 nodes 数组"] };
  const links = uiLinkTable(record);
  const workflow: ComfyWorkflow = {};
  for (const item of rawNodes) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const node = item as Record<string, unknown>;
    const id = node.id;
    if (id === undefined || id === null || String(id) === "") continue;
    const classType = typeof node.type === "string" ? node.type.trim() : "";
    if (classType === "" || classType === "Note" || classType === "MarkdownNote") continue;
    const mode = Number(node.mode);
    if (mode === 2 || mode === 4) continue;
    const inputs: Record<string, unknown> = {};
    const linked = new Set<string>();
    const declared = Array.isArray(node.inputs) ? node.inputs : [];
    for (const slot of declared) {
      if (slot === null || typeof slot !== "object" || Array.isArray(slot)) continue;
      const spec = slot as Record<string, unknown>;
      const name = typeof spec.name === "string" ? spec.name : "";
      if (name === "") continue;
      if (spec.link !== null && spec.link !== undefined) {
        const end = links.get(Number(spec.link));
        if (end !== undefined) {
          inputs[name] = [end.originId, end.originSlot];
          linked.add(name);
        }
      }
    }
    const nodeInfo = info[classType];
    const { required, optional } = specGroupOf(nodeInfo);
    const allNames = [...Object.keys(required), ...Object.keys(optional)];
    const named =
      node.widgets_values_named !== null && typeof node.widgets_values_named === "object" && !Array.isArray(node.widgets_values_named)
        ? (node.widgets_values_named as Record<string, unknown>)
        : undefined;
    if (named !== undefined) {
      for (const [name, value] of Object.entries(named)) {
        if (inputs[name] !== undefined) continue;
        if (nodeInfo !== undefined && !allNames.includes(name)) continue;
        inputs[name] = value;
      }
    }
    const widgets: unknown[] = Array.isArray(node.widgets_values) ? [...node.widgets_values] : [];
    if (widgets.length > 0 && nodeInfo !== undefined) {
      let index = 0;
      for (const name of allNames) {
        if (linked.has(name) || inputs[name] !== undefined) continue;
        if (LINK_TYPE_WORDS.has(inputTypeOf(nodeInfo, name))) continue;
        if (index >= widgets.length) break;
        inputs[name] = widgets[index];
        index += 1;
        if (WIDGET_CONTROL_WORDS.has(String(widgets[index]))) index += 1;
      }
    } else if (widgets.length > 0 && named === undefined) {
      problems.push("节点 " + id + "（" + classType + "）没有节点定义，控件值无法映射");
    }
    const entry: any = { class_type: classType, inputs };
    if (typeof node.title === "string" && node.title !== "") entry._meta = { title: node.title };
    workflow[String(id)] = entry;
    if (nodeInfo !== undefined) {
      for (const name of Object.keys(required)) {
        if (inputs[name] === undefined) problems.push("节点 " + id + "（" + classType + "）缺必填输入 " + name);
      }
    }
  }
  return { workflow, nodes: Object.keys(workflow).length, problems };
}

export interface ParseWorkflowOptions {
  /** 有这个才能把界面格式精确转成 API 格式（读 /object_info）。 */
  request?: ComfyRequest;
}

export interface ParsedWorkflow {
  workflow: ComfyWorkflow;
  nodes: number;
  protocol: WorkflowProtocol;
  notes: string[];
}

/**
 * 解析导入的工作流文本：API 格式直通；界面格式**尽量精确**转换。
 *
 * 三级退化顺序（每一级都写进 notes，界面能看懂这次的转换有多可信）：
 *   1. 有 request 且 /object_info 至少返回一个节点类型 → 精确转换（控件值不丢）；
 *   2. ComfyUI 不可达 / 这些节点一个都没装 → 用离线近似转换，并明确警告「控件值可能丢失」；
 *   3. 都不是合法工作流 → 抛 workflow-invalid-json。
 */
export async function parseWorkflowText(text: string, options: ParseWorkflowOptions = {}): Promise<ParsedWorkflow> {
  const parsed = parseComfyWorkflow(text);
  if (parsed.ok !== true) throw new WorkflowError("workflow-invalid-json", "工作流 JSON 解析失败：" + parsed.error);
  if (parsed.converted !== true) return { workflow: parsed.workflow, nodes: parsed.nodes, protocol: "api", notes: [] };
  const classTypes = collectUiClassTypes(text);
  const notes: string[] = [];
  if (options.request !== undefined && classTypes.length > 0) {
    const info = await fetchComfyObjectInfo(options.request, classTypes).catch(() => ({} as ComfyObjectInfo));
    if (Object.keys(info).length > 0) {
      const precise = convertUiWorkflowPrecise(JSON.parse(text) as Record<string, unknown>, info);
      if (precise.problems.length === 0) {
        notes.push("已按 ComfyUI 的节点定义把界面格式精确转成 API 格式（" + precise.nodes + " 个节点，控件值全部保留）。");
      } else {
        notes.push(
          "界面格式已按节点定义转换（" + precise.nodes + " 个节点），但有 " + precise.problems.length + " 处需要注意：" + precise.problems.slice(0, 5).join("；")
        );
      }
      return { workflow: precise.workflow, nodes: precise.nodes, protocol: "ui", notes };
    }
    notes.push(
      "ComfyUI 不可达（或这些自定义节点一个都没装），界面格式只能做离线近似转换：提示词 / 模型名 / 尺寸这类控件值可能丢失。启动 ComfyUI 后重新导入一次即可精确转换。"
    );
  } else if (options.request === undefined) {
    notes.push("界面格式在离线状态下转换：控件值可能丢失（导入时若 ComfyUI 可达会自动精确转换）。");
  }
  if (parsed.droppedWidgets !== undefined && parsed.droppedWidgets > 0) {
    notes.push("离线转换丢弃了 " + parsed.droppedWidgets + " 个控件值。");
  }
  return { workflow: parsed.workflow, nodes: parsed.nodes, protocol: "ui", notes };
}

/** 一条工作流的「用途推荐」：没配默认工作流时按用途挑。 */
export function defaultWorkflowIdFor(kind: WorkflowKind): string {
  return kind === "post" ? "builtin.matte-birefnet" : "builtin.transparent-qwen";
}
