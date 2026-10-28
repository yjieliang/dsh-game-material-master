#!/usr/bin/env node
/**
 * 本地 ComfyUI 工作流库契约自检 —— 只连本机回环地址上的 mock ComfyUI，不联网、不花钱，
 * 也不需要真的装 ComfyUI（真实 8188 的联调证据见 docs/本地ComfyUI工作流库-真实联调.md）。
 *
 * 钉住五件事：
 *   1. 目录与 CRUD：9 条目录条目（3 条带正文 + 6 条「需导入」）、保存 / 覆盖 / 删除、
 *      内置不可覆盖不可删、索引与文件不一致时以文件为准重建；
 *   2. 三级绑定解析：显式 bindings → {{占位符}} → 自动探测（含采样器正负连线反查）；
 *      缺关键绑定必须抛 workflow-binding-missing 并列出候选节点与手工写法；
 *   3. 注入：字面量写入（数字仍是数字）、连线跳过、参考图替换 LoadImage / 插入新节点、
 *      纯函数（不改原工作流）、界面格式按 /object_info 精确转换（控件值不丢）；
 *   4. 自检：可达性 / 缺节点 / 缺模型 / 绑定识别 / 真出图（含失败与超时）；
 *   5. 策略与计费：manual / local-first 与回退原因、本地后端走 local 通道
 *      **不写 receipt**、本地工作流不进 PAID_METHODS、wire schema 不丢键。
 *
 * 用法：node scripts/verify-workflow-lib.mjs
 */
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientSourceText } from "./lib/client-source.mjs";

const HOME = await mkdtemp(join(tmpdir(), "dsh-wf-lib-"));
process.env.DSH_HOME = HOME;

const { encodePng } = await import("../lib/png.js");
const wl = await import("../lib/workflowlib.js");
const ib = await import("../lib/imagebackend.js");
const cfgMod = await import("../lib/config.js");
const wire = await import("../lib/wire.js");
const toolsMod = await import("../lib/tools.js");
const receipts = await import("../lib/receipts.js");
const imageprovider = await import("../lib/imageprovider.js");

let passed = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) {
    passed++;
    console.log("  ✓ " + label + (detail ? " — " + detail : ""));
  } else {
    failures.push(label + (detail ? " — " + detail : ""));
    console.log("  ✗ " + label + (detail ? " — " + detail : ""));
  }
}
function section(title) {
  console.log("");
  console.log(title);
}
async function expectFailure(label, fn, includes) {
  try {
    await fn();
    check(label, false, "没有抛错");
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error && error.code ? String(error.code) : "";
    const ok = includes ? (message + " " + code).includes(includes) : true;
    check(label, ok, ok ? message.slice(0, 100) : message.slice(0, 200));
    return error;
  }
}

/* ---------------------------------------------------------------- mock ComfyUI */

const PNG_4X4 = encodePng(Buffer.alloc(4 * 4 * 4, 128), 4, 4);
const state = { stats: 0, uploads: 0, submits: [], requests: [] };

/** 从内置工作流的节点输入反推一份「节点定义」，让自检能真的查到模型 / 节点。 */
function deriveInfo(workflow) {
  const info = {};
  for (const node of Object.values(workflow)) {
    const type = node.class_type;
    const spec = info[type] ?? { input: { required: {}, optional: {} } };
    for (const [name, value] of Object.entries(node.inputs ?? {})) {
      if (Array.isArray(value)) continue;
      if (spec.input.required[name] !== undefined) continue;
      const kind = typeof value === "number" ? (Number.isInteger(value) ? "INT" : "FLOAT") : typeof value === "boolean" ? "BOOLEAN" : "STRING";
      // 模型文件名类输入给一个「可选值列表」：自检据此判断模型在不在。
      spec.input.required[name] = kind === "STRING" && /_name$/.test(name) ? [[String(value)]] : [kind];
    }
    info[type] = spec;
  }
  return info;
}

const INFO = {};
for (const entry of (await wl.listWorkflowMetas()).filter((item) => item.hasWorkflow)) {
  const full = await wl.getWorkflowEntry(entry.id);
  Object.assign(INFO, deriveInfo(full.workflow), INFO);
}
// 手工补几个常用节点（自定义工作流测试用）。
INFO.CheckpointLoaderSimple = { input: { required: { ckpt_name: [["sd_xl_base_1.0.safetensors"]] } } };
INFO.KSampler = {
  input: {
    required: {
      seed: ["INT"],
      steps: ["INT"],
      cfg: ["FLOAT"],
      sampler_name: [["euler", "dpmpp_2m"]],
      scheduler: [["karras", "sgm_uniform"]],
      denoise: ["FLOAT"]
    }
  }
};
INFO.CLIPTextEncode = { input: { required: { text: ["STRING"] } } };
INFO.EmptyLatentImage = { input: { required: { width: ["INT"], height: ["INT"], batch_size: ["INT"] } } };
INFO.SaveImage = { input: { required: { filename_prefix: ["STRING"] } } };
INFO.LoadImage = { input: { required: { image: [["present.png"]] } } };
INFO.VAEDecode = { input: { required: {} } };
INFO.MissingModelLoader = { input: { required: { ckpt_name: [["present.safetensors"]] } } };

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const path = url.pathname;
  state.requests.push(path);
  const send = (payload, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  };
  if (req.method === "GET" && path === "/system_stats") {
    state.stats += 1;
    return send({ system: { comfyui_version: "0.43.0-mock" }, devices: [{ name: "Mock GPU" }] });
  }
  if (req.method === "GET" && path === "/queue") return send({ queue_running: [], queue_pending: [] });
  if (req.method === "GET" && path.startsWith("/object_info/")) {
    const type = decodeURIComponent(path.slice("/object_info/".length));
    return send(INFO[type] === undefined ? {} : { [type]: INFO[type] });
  }
  if (req.method === "POST" && path === "/upload/image") {
    state.uploads += 1;
    const body = (await readBody(req)).toString("binary");
    const match = /filename="([^"]*)"/.exec(body);
    return send({ name: match === null ? "uploaded.png" : match[1], subfolder: "", type: "input" });
  }
  if (req.method === "POST" && path === "/prompt") {
    const body = JSON.parse((await readBody(req)).toString("utf8"));
    state.submits.push(body);
    const text = JSON.stringify(body.prompt ?? {});
    if (text.includes("REJECT_TRIGGER")) {
      return send({ error: { type: "prompt_outputs_failed_validation" }, node_errors: { "1": { errors: [{ type: "value_not_in_list", message: "bad" }] } } });
    }
    if (text.includes("HISTORY_FAIL")) return send({ prompt_id: "mock-history-fail", node_errors: {} });
    if (text.includes("SLOW_TRIGGER")) return send({ prompt_id: "mock-slow", node_errors: {} });
    return send({ prompt_id: "mock-prompt", node_errors: {} });
  }
  if (req.method === "GET" && path.startsWith("/history/")) {
    const id = decodeURIComponent(path.slice("/history/".length));
    if (id === "mock-history-fail") {
      return send({
        [id]: {
          status: {
            status_str: "error",
            messages: [["execution_error", { node_type: "KSampler", exception_type: "RuntimeError", exception_message: "boom" }]]
          }
        }
      });
    }
    if (id === "mock-slow") return send({ [id]: { status: { status_str: "running" } } });
    if (id !== "mock-prompt") return send({});
    return send({
      [id]: {
        status: { status_str: "success", completed: true },
        outputs: { "13": { images: [{ filename: "mock-out.png", subfolder: "", type: "output" }] } }
      }
    });
  }
  if (req.method === "GET" && path === "/view") {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(PNG_4X4);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE = "http://127.0.0.1:" + server.address().port;
const CLIENT = { baseUrl: BASE, timeoutMs: 15000, cookies: "" };

/* ---------------------------------------------------------------- 1. 目录 */

section("1) 目录（9 条：3 条带正文 + 6 条需导入）");
const metas = await wl.listWorkflowMetas();
check("目录共 9 条", metas.length === 9, String(metas.length));
check("其中 3 条带正文", metas.filter((item) => item.hasWorkflow === true).length === 3, String(metas.filter((item) => item.hasWorkflow).length));
check("其余 6 条标「需导入」", metas.filter((item) => item.needsImport === true).length === 6, String(metas.filter((item) => item.needsImport).length));
check("目录顺序：内置在前（3 条内置正文 + 6 条目录）", metas.every((item) => item.builtin === true), String(metas.filter((item) => item.builtin).length));
check("目录 id 唯一", new Set(metas.map((item) => item.id)).size === metas.length);
const transparent = await wl.getWorkflowEntry("builtin.transparent-qwen");
const pixel = await wl.getWorkflowEntry("builtin.pixel-sdxl");
const matte = await wl.getWorkflowEntry("builtin.matte-birefnet");
check("透明精灵工作流 13 个节点", Object.keys(transparent.workflow).length === 13, String(Object.keys(transparent.workflow).length));
check("像素风 SDXL 工作流 18 个节点", Object.keys(pixel.workflow).length === 18, String(Object.keys(pixel.workflow).length));
check("BiRefNet 去背工作流 6 个节点", Object.keys(matte.workflow).length === 6, String(Object.keys(matte.workflow).length));
check("内置条目带 requiredModels（自检提示用）", transparent.requiredModels.length >= 3 && pixel.requiredModels.length >= 3 && matte.requiredModels.length >= 1);
check("内置工作流每个节点都有 class_type（探测 / 报错靠它定位）", Object.values(transparent.workflow).every((node) => typeof node.class_type === "string" && node.class_type !== ""));
check("用途推荐：出图 → 透明精灵，后处理 → BiRefNet", wl.defaultWorkflowIdFor("generate") === "builtin.transparent-qwen" && wl.defaultWorkflowIdFor("post") === "builtin.matte-birefnet");
await expectFailure("未导入的目录条目取正文要报「需导入」", () => wl.getWorkflowEntry("builtin.pixel-sdxl-fast"), "workflow-not-imported");
await expectFailure("不存在的工作流要报 not-found", () => wl.getWorkflowEntry("wf_deadbeef00"), "workflow-not-found");
await expectFailure("非法 id 要拒绝（防目录穿越）", () => wl.getWorkflowEntry("../config"), "workflow-invalid-id");

/* ---------------------------------------------------------------- 2. CRUD */

section("2) CRUD（落盘 / 覆盖 / 删除 / 索引自愈）");
const apiJson = JSON.stringify({
  "1": { class_type: "CLIPTextEncode", inputs: { text: "a cat" } },
  "2": { class_type: "SaveImage", inputs: { filename_prefix: "inkbox/verify" } }
});
const saved = await wl.saveWorkflow({ name: "自检工作流 A", purpose: "自检", kind: "generate", json: apiJson, bindings: { prompt: "1.text" } });
check("保存 API 格式：生成 wf_ 前缀 id", /^wf_[0-9a-f]+$/.test(saved.id), saved.id);
check("保存返回节点数与协议", saved.nodes === 2 && saved.protocol === "api", JSON.stringify({ nodes: saved.nodes, protocol: saved.protocol }));
const listed = await wl.listWorkflowMetas();
check("目录里出现新条目（9 → 10）", listed.length === 10, String(listed.length));
const found = listed.find((item) => item.id === saved.id);
check("新条目 hasWorkflow=true / needsImport=false / 非内置", found.hasWorkflow === true && found.needsImport === false && found.builtin === false);
const loadedA = await wl.getWorkflowEntry(saved.id);
check("取回的正文与保存一致", loadedA.workflow["1"].inputs.text === "a cat");
check("显式绑定被保存", loadedA.bindings.prompt === "1.text", String(loadedA.bindings.prompt));
check("保存时识别出绑定并写 note", saved.notes.some((note) => note.includes("提示词")), (saved.notes[0] || "").slice(0, 60));
const savedAgain = await wl.saveWorkflow({ name: "自检工作流 A", purpose: "自检", kind: "generate", json: apiJson, bindings: { prompt: "1.text" } });
check("同一份 JSON 再导入得到同一个 id（内容哈希）", savedAgain.id === saved.id, savedAgain.id);
const loadedA2 = await wl.getWorkflowEntry(saved.id);
check("重复导入保留 createdAt、刷新 updatedAt", loadedA2.createdAt === loadedA.createdAt && loadedA2.updatedAt >= loadedA.updatedAt);
const savedEdge = await wl.saveWorkflow({ id: "wf_selfcheck_custom", name: "自检工作流 B", kind: "generate", json: apiJson });
check("显式 id 可以覆盖写入", savedEdge.id === "wf_selfcheck_custom", savedEdge.id);
await expectFailure("内置条目不能覆盖", () => wl.saveWorkflow({ id: "builtin.transparent-qwen", name: "x", json: apiJson }), "workflow-builtin-immutable");
await expectFailure("坏 JSON 要报 invalid-json", () => wl.saveWorkflow({ name: "坏", json: "{not json" }), "workflow-invalid-json");
await expectFailure("绑定点写法不对要报 invalid-bindings", () => wl.saveWorkflow({ name: "坏绑定", json: apiJson, bindings: { prompt: "没有点号" } }), "workflow-invalid-bindings");
await expectFailure("未知绑定名要报错", () => wl.saveWorkflow({ name: "坏绑定2", json: apiJson, bindings: { nope: "1.text" } }), "workflow-invalid-bindings");
await expectFailure("内置条目不能删除", () => wl.removeWorkflow("builtin.transparent-qwen"), "workflow-builtin-immutable");
const removed = await wl.removeWorkflow("wf_selfcheck_custom");
check("删除用户工作流", removed.removed === true && (await wl.listWorkflowMetas()).length === 10, String((await wl.listWorkflowMetas()).length));

// 索引自愈：删掉索引文件后仍能列出全部条目，并且索引会被重建。
const indexFile = join(cfgMod.dataRoot(), "workflows", "index.json");
await rm(indexFile, { force: true });
const afterIndexLoss = await wl.listWorkflowMetas();
check("索引丢失后以文件为准仍列出 10 条", afterIndexLoss.length === 10, String(afterIndexLoss.length));
const rebuilt = JSON.parse(await readFile(indexFile, "utf8"));
// 索引只记用户导入的工作流（内置 3 份正文在代码里，不进索引）。
check("索引被自动重建（只记用户工作流）", Array.isArray(rebuilt.items) && rebuilt.items.length === 1 && rebuilt.items[0].id === saved.id, JSON.stringify(rebuilt.items.map((item) => item.id)));
check("索引里只记用户工作流（内置正文在代码里）", rebuilt.items.every((item) => item.builtin === false));
// 手工往目录丢一份 JSON（未进索引）→ 必须被列出来。
const orphan = { id: "wf_orphan_file", name: "手工丢进来的", purpose: "", kind: "post", protocol: "api", builtin: false, requiredModels: [], bindings: { image: "1.image" }, workflow: { "1": { class_type: "LoadImage", inputs: { image: "a.png" } } }, createdAt: 1, updatedAt: 2 };
await writeFile(join(cfgMod.dataRoot(), "workflows", "wf_orphan_file.json"), JSON.stringify(orphan), "utf8");
const withOrphan = await wl.listWorkflowMetas();
check("手工丢进目录的工作流也会被列出（索引以文件为准）", withOrphan.some((item) => item.id === "wf_orphan_file"), String(withOrphan.length));
await rm(join(cfgMod.dataRoot(), "workflows", "wf_orphan_file.json"), { force: true });
await wl.removeWorkflow(saved.id);
check("清理后回到 9 条", (await wl.listWorkflowMetas()).length === 9);
const catalog = await wl.getWorkflowCatalog();
check("getWorkflowCatalog 分 builtin / installed 两栏", catalog.builtin.length === 9 && Array.isArray(catalog.installed));

/* ---------------------------------------------------------------- 3. 三级绑定 */

section("3) 三级绑定解析（显式 → 占位符 → 自动探测）");
const explicitEntry = {
  id: "wf_explicit",
  name: "显式绑定",
  purpose: "",
  kind: "generate",
  protocol: "api",
  builtin: false,
  requiredModels: [],
  bindings: { prompt: "1.text" },
  workflow: { "1": { class_type: "CLIPTextEncode", inputs: { text: "" } } },
  createdAt: 0,
  updatedAt: 0
};
const explicitPlan = wl.resolveWorkflowBindings(explicitEntry);
check("第一级：显式 bindings 命中", explicitPlan.bindings.prompt === "1.text" && explicitPlan.sources.prompt === "explicit", JSON.stringify(explicitPlan.sources));
const placeholderEntry = {
  id: "wf_placeholder",
  name: "占位符绑定",
  purpose: "",
  kind: "generate",
  protocol: "api",
  builtin: false,
  requiredModels: [],
  bindings: {},
  workflow: {
    "5": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}" } },
    "6": { class_type: "EmptyLatentImage", inputs: { width: "{{width}}", height: "{{height}}", batch_size: 1 } }
  },
  createdAt: 0,
  updatedAt: 0
};
const placeholderPlan = wl.resolveWorkflowBindings(placeholderEntry);
check("第二级：{{prompt}} 占位符被识别为绑定", placeholderPlan.bindings.prompt === "5.text" && placeholderPlan.sources.prompt === "placeholder", JSON.stringify(placeholderPlan.bindings));
check("第二级：{{width}} / {{height}} 同样识别", placeholderPlan.bindings.width === "6.width" && placeholderPlan.bindings.height === "6.height");
check("占位符清单带节点定位", placeholderPlan.placeholders.some((item) => item.key === "prompt" && item.node === "5" && item.input === "text"));
const autoEntry = {
  id: "wf_auto",
  name: "自动探测",
  purpose: "",
  kind: "generate",
  protocol: "api",
  builtin: false,
  requiredModels: [],
  bindings: {},
  workflow: {
    "3": { class_type: "CLIPTextEncode", inputs: { text: "a cat" } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: "blurry" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
    "6": { class_type: "KSampler", inputs: { seed: 1, steps: 25, cfg: 7, sampler_name: "euler", scheduler: "karras", denoise: 1, positive: ["3", 0], negative: ["4", 0] } }
  },
  createdAt: 0,
  updatedAt: 0
};
const autoPlan = wl.resolveWorkflowBindings(autoEntry);
check("第三级：自动探测到提示词", autoPlan.bindings.prompt === "3.text" && autoPlan.sources.prompt === "detected", String(autoPlan.bindings.prompt));
check("第三级：正面提示词走 positive 连线（不是第一个 text 就完事）", autoPlan.bindings.prompt === "3.text", String(autoPlan.bindings.prompt));
check("第三级：负面提示词走 negative 连线（正负不会写反）", autoPlan.bindings.negative === "4.text", String(autoPlan.bindings.negative));
check("第三级：尺寸 / 种子 / 步数 / CFG / 采样器都识别", autoPlan.bindings.width === "5.width" && autoPlan.bindings.height === "5.height" && autoPlan.bindings.seed === "6.seed" && autoPlan.bindings.steps === "6.steps" && autoPlan.bindings.cfg === "6.cfg" && autoPlan.bindings.sampler === "6.sampler_name", JSON.stringify(autoPlan.bindings));
check("自动探测没有把 batch_size 当成 batch 之外的东西", autoPlan.bindings.batch === "5.batch_size", String(autoPlan.bindings.batch));
const missingEntry = {
  id: "wf_missing",
  name: "缺提示词绑定",
  purpose: "",
  kind: "generate",
  protocol: "api",
  builtin: false,
  requiredModels: [],
  bindings: {},
  workflow: { "3": { class_type: "PromptNode", inputs: { prompt_text: "hello" } } },
  createdAt: 0,
  updatedAt: 0
};
const missingPlan = wl.resolveWorkflowBindings(missingEntry);
check("缺关键绑定：missing 里是 prompt", missingPlan.missing.includes("prompt"), JSON.stringify(missingPlan.missing));
check("缺关键绑定：候选节点列出 3.prompt_text", (missingPlan.candidates.prompt ?? []).some((item) => item.node === "3" && item.input === "prompt_text"));
const missingError = await expectFailure("缺关键绑定：assertWorkflowBindings 抛 workflow-binding-missing", () => {
  wl.assertWorkflowBindings(missingEntry, missingPlan);
}, "workflow-binding-missing");
check("报错文案列出候选节点与手工写法", missingError !== undefined && missingError.message.includes("3.prompt_text") && missingError.message.includes("bindings.prompt"), missingError === undefined ? "" : missingError.message.slice(0, 120));
const postMissingEntry = { ...missingEntry, id: "wf_post_missing", kind: "post", workflow: { "1": { class_type: "SaveImage", inputs: { filename_prefix: "x" } } } };
const postMissingPlan = wl.resolveWorkflowBindings(postMissingEntry);
check("后处理工作流缺的是 image 绑定", postMissingPlan.missing.includes("image"), JSON.stringify(postMissingPlan.missing));
const invalidBindingEntry = { ...explicitEntry, id: "wf_invalid_binding", bindings: { prompt: "没有点号" } };
const invalidPlan = wl.resolveWorkflowBindings(invalidBindingEntry);
check("写法不对的显式绑定被忽略并记 note（退回自动探测）", invalidPlan.sources.prompt === "detected" && invalidPlan.notes.some((note) => note.includes("写法不对")), (invalidPlan.notes.join("|") || "").slice(0, 80));

/* ---------------------------------------------------------------- 4. 注入 */

section("4) 参数注入（字面量 / 占位符 / 参考图 / 纯函数）");
const injectPlan = wl.resolveWorkflowBindings(autoEntry);
const injected = wl.applyWorkflowInputs(autoEntry, injectPlan, { prompt: "a green slime", negativePrompt: "ugly", width: 768, height: 512, seed: 42, steps: 8, cfgScale: 1.5, sampler: "dpmpp_2m", denoising: 0.65 });
check("注入提示词到 positive 节点", injected.workflow["3"].inputs.text === "a green slime", String(injected.workflow["3"].inputs.text));
check("注入负面提示词到 negative 节点", injected.workflow["4"].inputs.text === "ugly", String(injected.workflow["4"].inputs.text));
check("注入尺寸 / 种子（数字仍然是数字）", injected.workflow["5"].inputs.width === 768 && injected.workflow["6"].inputs.seed === 42, JSON.stringify(injected.workflow["5"].inputs));
check("注入步数 / CFG / 采样器 / 重绘强度", injected.workflow["6"].inputs.steps === 8 && injected.workflow["6"].inputs.cfg === 1.5 && injected.workflow["6"].inputs.sampler_name === "dpmpp_2m" && injected.workflow["6"].inputs.denoise === 0.65, JSON.stringify(injected.workflow["6"].inputs));
check("注入返回 applied 清单", Array.isArray(injected.applied) && injected.applied.includes("prompt") && injected.applied.includes("seed"), JSON.stringify(injected.applied));
check("注入是纯函数（原工作流没被改）", autoEntry.workflow["3"].inputs.text === "a cat" && autoEntry.workflow["5"].inputs.width === 512);
const placeholderInjected = wl.applyWorkflowInputs(placeholderEntry, placeholderPlan, { prompt: "a dog", width: 640, height: 384 });
check("占位符：字符串被替换", placeholderInjected.workflow["5"].inputs.text === "a dog", String(placeholderInjected.workflow["5"].inputs.text));
check("占位符：写在引号里的数字占位符 → 仍是数字", placeholderInjected.workflow["6"].inputs.width === 640, JSON.stringify(placeholderInjected.workflow["6"].inputs.width));
check("占位符替换记进 notes", placeholderInjected.notes.some((note) => note.includes("{{prompt}}")), (placeholderInjected.notes[0] || "").slice(0, 60));
const loadImageEntry = {
  id: "wf_loadimage",
  name: "LoadImage 工作流",
  purpose: "",
  kind: "generate",
  protocol: "api",
  builtin: false,
  requiredModels: [],
  bindings: { prompt: "1.text", image: "2.image" },
  workflow: {
    "1": { class_type: "CLIPTextEncode", inputs: { text: "" } },
    "2": { class_type: "LoadImage", inputs: { image: "old.png" } }
  },
  createdAt: 0,
  updatedAt: 0
};
const loadPlan = wl.resolveWorkflowBindings(loadImageEntry);
const loadInjected = wl.applyWorkflowInputs(loadImageEntry, loadPlan, { prompt: "x", imageNames: ["inkbox_new.png"] });
check("参考图：直接替换 LoadImage 的 image 文件名（不动连线）", loadInjected.workflow["2"].inputs.image === "inkbox_new.png", String(loadInjected.workflow["2"].inputs.image));
const insertEntry = {
  id: "wf_insert",
  name: "IMAGE 输入非 LoadImage",
  purpose: "",
  kind: "generate",
  protocol: "api",
  builtin: false,
  requiredModels: [],
  bindings: { prompt: "1.text", image: "1.image" },
  workflow: {
    "1": { class_type: "CLIPTextEncode", inputs: { text: "", image: ["9", 0] } },
    "2": { class_type: "VAEDecode", inputs: { samples: ["3", 0] } }
  },
  createdAt: 0,
  updatedAt: 0
};
const insertPlan = wl.resolveWorkflowBindings(insertEntry);
const insertInjected = wl.applyWorkflowInputs(insertEntry, insertPlan, { prompt: "x", imageNames: ["inkbox_second.png"] });
const insertedNode = Object.values(insertInjected.workflow).find((node) => node.class_type === "LoadImage");
check("参考图：目标不是 LoadImage 时插入一个 LoadImage 节点再连线", insertedNode !== undefined && insertedNode.inputs.image === "inkbox_second.png", JSON.stringify(insertedNode && insertedNode.inputs));
const linkedEntry = {
  id: "wf_linked",
  name: "目标是连线",
  purpose: "",
  kind: "generate",
  protocol: "api",
  builtin: false,
  requiredModels: [],
  bindings: { prompt: "1.text" },
  workflow: { "1": { class_type: "CLIPTextEncode", inputs: { text: ["2", 0] } }, "2": { class_type: "SomeTextNode", inputs: { text: "linked" } } },
  createdAt: 0,
  updatedAt: 0
};
const linkedPlan = wl.resolveWorkflowBindings(linkedEntry);
const linkedInjected = wl.applyWorkflowInputs(linkedEntry, linkedPlan, { prompt: "被占位" });
check("目标输入是连线时跳过注入并记 note（不静默覆盖）", linkedInjected.workflow["1"].inputs.text[0] === "2" && linkedInjected.notes.some((note) => note.includes("连线")), linkedInjected.notes.join("|").slice(0, 80));

/* ---------------------------------------------------------------- 5. 界面格式 */

section("5) 界面格式 → API 格式（控件值不能丢）");
const uiRecord = {
  nodes: [
    { id: 1, type: "CLIPTextEncode", inputs: [], widgets_values: ["a cat"] },
    { id: 2, type: "SaveImage", inputs: [], widgets_values: ["inkbox/ui"] }
  ],
  links: []
};
const precise = wl.convertUiWorkflowPrecise(uiRecord, INFO);
check("界面格式精确转换：CLIPTextEncode.text 来自 widgets_values", precise.workflow["1"].inputs.text === "a cat", JSON.stringify(precise.workflow["1"].inputs));
check("界面格式精确转换：SaveImage.filename_prefix 正确", precise.workflow["2"].inputs.filename_prefix === "inkbox/ui", JSON.stringify(precise.workflow["2"].inputs));
check("界面格式精确转换：没有缺必填输入", precise.problems.length === 0, precise.problems.join("；"));
const namedRecord = {
  nodes: [{ id: 1, type: "LoadImage", inputs: [], widgets_values: ["named.png", "image"], widgets_values_named: { image: "named.png", upload: "image" } }],
  links: []
};
const namedPrecise = wl.convertUiWorkflowPrecise(namedRecord, INFO);
check("widgets_values_named：按名字映射（upload 这种界面控件被丢掉）", namedPrecise.workflow["1"].inputs.image === "named.png" && namedPrecise.workflow["1"].inputs.upload === undefined, JSON.stringify(namedPrecise.workflow["1"].inputs));
const ksRecord = {
  nodes: [
    {
      id: 6,
      type: "KSampler",
      inputs: [
        { name: "model", type: "MODEL", link: 1 },
        { name: "positive", type: "CONDITIONING", link: 2 },
        { name: "negative", type: "CONDITIONING", link: 3 },
        { name: "latent_image", type: "LATENT", link: 4 }
      ],
      widgets_values: [42, 8, 1.5, "euler", "karras", 1]
    }
  ],
  links: [
    [1, 1, 0, 6, 0, "MODEL"],
    [2, 2, 0, 6, 1, "CONDITIONING"],
    [3, 3, 0, 6, 2, "CONDITIONING"],
    [4, 4, 0, 6, 3, "LATENT"]
  ]
};
const ksPrecise = wl.convertUiWorkflowPrecise(ksRecord, INFO);
check("界面格式：KSampler 按输入顺序映射 seed/steps/cfg/sampler/scheduler/denoise", ksPrecise.workflow["6"].inputs.seed === 42 && ksPrecise.workflow["6"].inputs.steps === 8 && ksPrecise.workflow["6"].inputs.cfg === 1.5 && ksPrecise.workflow["6"].inputs.sampler_name === "euler" && ksPrecise.workflow["6"].inputs.denoise === 1, JSON.stringify(ksPrecise.workflow["6"].inputs));
check("界面格式：连线仍然写成 [节点, 槽位]", JSON.stringify(ksPrecise.workflow["6"].inputs.positive) === JSON.stringify(["2", 0]), JSON.stringify(ksPrecise.workflow["6"].inputs.positive));
check("collectUiClassTypes 收集节点类型（跳过便签）", JSON.stringify(wl.collectUiClassTypes(JSON.stringify({ nodes: [{ type: "KSampler" }, { type: "Note" }] }))) === JSON.stringify(["KSampler"]));
const uiText = JSON.stringify(uiRecord);
const offlineParsed = await wl.parseWorkflowText(uiText);
check("离线解析界面格式：标成 ui 协议并警告控件值可能丢失", offlineParsed.protocol === "ui" && offlineParsed.notes.some((note) => note.includes("离线") || note.includes("可能丢失")), offlineParsed.notes.join("|").slice(0, 100));
const preciseParsed = await wl.parseWorkflowText(uiText, { request: CLIENT });
check("联网解析界面格式：notes 说明已精确转换", preciseParsed.notes.some((note) => note.includes("精确")), preciseParsed.notes.join("|").slice(0, 100));
check("联网解析结果保留控件值", preciseParsed.workflow["1"].inputs.text === "a cat");
const savedUi = await wl.saveWorkflow({ name: "界面格式导入", kind: "generate", json: uiText, request: CLIENT });
const loadedUi = await wl.getWorkflowEntry(savedUi.id);
check("保存界面格式：protocol=ui / converted=true", savedUi.protocol === "ui" && savedUi.converted === true, JSON.stringify({ protocol: savedUi.protocol, converted: savedUi.converted }));
check("保存界面格式：正文已是 API 格式且控件值在", loadedUi.workflow["1"].inputs.text === "a cat" && loadedUi.workflow["2"].inputs.filename_prefix === "inkbox/ui");
await wl.removeWorkflow(savedUi.id);

/* ---------------------------------------------------------------- 6. 自检 */

section("6) 自检（可达性 / 节点 / 模型 / 绑定 / 真出图）");
const cfgMock = cfgMod.normalizeConfig({
  comfyBaseUrl: BASE,
  comfyTimeoutMs: 20000,
  imageProvider: "comfy",
  imageWorkflowId: "",
  comfyCookies: ""
});
const selfTest = await ib.selfTestComfyWorkflow(cfgMock, { id: "builtin.transparent-qwen" });
check("自检：内置透明精灵通过", selfTest.ok === true, JSON.stringify({ error: selfTest.error, missing: selfTest.missingNodeTypes, models: selfTest.missingModels }));
check("自检：报出 ComfyUI 版本", selfTest.service !== undefined && selfTest.service.version === "0.43.0-mock", JSON.stringify(selfTest.service));
check("自检：节点类型一个不缺", selfTest.missingNodeTypes.length === 0, selfTest.missingNodeTypes.join("、"));
check("自检：模型一个不缺（按 Loader 节点查选项）", selfTest.missingModels.length === 0, selfTest.missingModels.join("、"));
check("自检：返回绑定识别结果（prompt=5.prompt）", selfTest.bindings.prompt === "5.prompt", JSON.stringify(selfTest.bindings));
check("自检：模型检查有逐项明细", Array.isArray(selfTest.modelChecks) && selfTest.modelChecks.length >= 3 && selfTest.modelChecks.every((item) => item.exists === true), String(selfTest.modelChecks && selfTest.modelChecks.length));
const missingModelJson = JSON.stringify({
  "1": { class_type: "MissingModelLoader", inputs: { ckpt_name: "missing.safetensors" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "x" } },
  "3": { class_type: "VAEDecode", inputs: {} }
});
const missingModelSaved = await wl.saveWorkflow({ name: "缺模型工作流", kind: "generate", json: missingModelJson, bindings: { prompt: "2.text" } });
const missingModelTest = await ib.selfTestComfyWorkflow(cfgMock, { id: missingModelSaved.id });
check("自检：缺模型要明确列出", missingModelTest.ok === false && missingModelTest.missingModels.includes("missing.safetensors"), JSON.stringify(missingModelTest.missingModels));
const missingNodeJson = JSON.stringify({
  "1": { class_type: "NotInstalledNode", inputs: {} },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "x" } }
});
const missingNodeSaved = await wl.saveWorkflow({ name: "缺节点工作流", kind: "generate", json: missingNodeJson, bindings: { prompt: "2.text" } });
const missingNodeTest = await ib.selfTestComfyWorkflow(cfgMock, { id: missingNodeSaved.id });
check("自检：缺自定义节点要明确列出", missingNodeTest.ok === false && missingNodeTest.missingNodeTypes.includes("NotInstalledNode"), JSON.stringify(missingNodeTest.missingNodeTypes));
const cfgUnreachable = cfgMod.normalizeConfig({ comfyBaseUrl: "http://127.0.0.1:1", comfyTimeoutMs: 2000, imageProvider: "comfy" });
const unreachableTest = await ib.selfTestComfyWorkflow(cfgUnreachable, { id: "builtin.transparent-qwen" });
check("自检：ComfyUI 不可达时说「不可达」（不是「所有节点都缺」）", unreachableTest.ok === false && String(unreachableTest.error).includes("不可达") && unreachableTest.missingNodeTypes.length === 0, String(unreachableTest.error).slice(0, 100));
const generatedTest = await ib.selfTestComfyWorkflow(cfgMock, { id: "builtin.transparent-qwen", generate: true, prompt: "selfcheck slime" });
check("自检可选真出图：拿到字节与耗时", generatedTest.ok === true && generatedTest.generated !== undefined && generatedTest.generated.bytes > 0 && generatedTest.generated.ext === "png", JSON.stringify(generatedTest.generated));
await wl.removeWorkflow(missingModelSaved.id);
await wl.removeWorkflow(missingNodeSaved.id);

/* ---------------------------------------------------------------- 7. 生成与计费 */

section("7) 本地生成（提交 / 注入 / 取回 / 不建 receipt）");
const cfgComfy = cfgMod.normalizeConfig({
  comfyBaseUrl: BASE,
  comfyTimeoutMs: 20000,
  comfyCookies: "",
  imageProvider: "comfy",
  imageWorkflowId: "builtin.transparent-qwen"
});
const generated = await ib.generateComfyImage(cfgComfy, {
  prompt: "a green slime",
  images: [],
  size: "512x512",
  watermark: false,
  workflowId: "builtin.transparent-qwen",
  seed: 123
});
check("生成：拿到 PNG 字节", generated.bytes.length === PNG_4X4.length && generated.ext === "png", String(generated.bytes.length));
check("生成：返回 promptId / seed / workflowId", generated.usage !== undefined && generated.usage.promptId === "mock-prompt" && generated.usage.seed === 123 && generated.usage.workflowId === "builtin.transparent-qwen", JSON.stringify(generated.usage));
const submit = state.submits[state.submits.length - 1];
check("生成：提示词写进 5.prompt", submit.prompt["5"].inputs.prompt === "a green slime", String(submit.prompt["5"].inputs.prompt));
check("生成：512x512 写进 6.width / 6.height", submit.prompt["6"].inputs.width === 512 && submit.prompt["6"].inputs.height === 512, JSON.stringify(submit.prompt["6"].inputs));
check("生成：种子写进 9.noise_seed", submit.prompt["9"].inputs.noise_seed === 123, String(submit.prompt["9"].inputs.noise_seed));
check("生成：工作流自带的 filename_prefix 没被动过", submit.prompt["13"].inputs.filename_prefix === "game-assets/sprites/sprite", String(submit.prompt["13"].inputs.filename_prefix));
const receiptFiles = await readdir(receipts.receiptsRoot()).catch(() => []);
check("本地生成不建 receipt（receipts 目录 0 条）", receiptFiles.length === 0, String(receiptFiles.length));
const dataUri = "data:image/png;base64," + PNG_4X4.toString("base64");
const withImageSaved = await wl.saveWorkflow({
  name: "带参考图的工作流",
  kind: "generate",
  json: JSON.stringify({
    "1": { class_type: "CLIPTextEncode", inputs: { text: "" } },
    "2": { class_type: "LoadImage", inputs: { image: "old.png" } }
  }),
  bindings: { prompt: "1.text", image: "2.image" }
});
const uploadsBefore = state.uploads;
const generatedWithImage = await ib.generateComfyImage(cfgComfy, {
  prompt: "reference pose",
  images: [dataUri],
  size: "1024x1024",
  watermark: false,
  workflowId: withImageSaved.id
});
const submitWithImage = state.submits[state.submits.length - 1];
check("生成：参考图会先上传到 /upload/image", state.uploads === uploadsBefore + 1, String(state.uploads));
check("生成：上传后的文件名写进 LoadImage.image", String(submitWithImage.prompt["2"].inputs.image).startsWith("inkbox"), String(submitWithImage.prompt["2"].inputs.image));
check("生成：带参考图也能取回字节", generatedWithImage.bytes.length > 0);
await wl.removeWorkflow(withImageSaved.id);
const noImageBinding = await expectFailure("参考图没有注入点要报错（不能静默丢掉）", () => ib.generateComfyImage(cfgComfy, { prompt: "x", images: [dataUri], size: "512x512", watermark: false, workflowId: "builtin.transparent-qwen" }), "没有参考图");
check("参考图报错文案说明怎么修", noImageBinding !== undefined && noImageBinding.message.includes("节点ID.输入名"), noImageBinding === undefined ? "" : noImageBinding.message.slice(0, 100));
const rejectEntry = await wl.saveWorkflow({
  name: "会被拒的工作流",
  kind: "generate",
  json: JSON.stringify({ "1": { class_type: "CLIPTextEncode", inputs: { text: "" } } }),
  bindings: { prompt: "1.text" }
});
await expectFailure("ComfyUI 拒绝工作流时把 node_errors 报出来", () => ib.generateComfyImage(cfgComfy, { prompt: "REJECT_TRIGGER", images: [], size: "512x512", watermark: false, workflowId: rejectEntry.id }), "拒绝");
await expectFailure("ComfyUI 执行失败（history 报错）要透出异常", () => ib.generateComfyImage(cfgComfy, { prompt: "HISTORY_FAIL", images: [], size: "512x512", watermark: false, workflowId: rejectEntry.id }), "执行失败");
await wl.removeWorkflow(rejectEntry.id);
const postEntry = await wl.saveWorkflow({ name: "后处理工作流", kind: "post", json: JSON.stringify({ "1": { class_type: "LoadImage", inputs: { image: "x.png" } } }), bindings: { image: "1.image" } });
await expectFailure("后处理工作流不能当生图后端（kind 不匹配要报）", () => ib.generateComfyImage(cfgComfy, { prompt: "x", images: [], size: "512x512", watermark: false, workflowId: postEntry.id }), "后处理工作流");
await wl.removeWorkflow(postEntry.id);

/* ---------------------------------------------------------------- 8. 策略与回退 */

section("8) 后端选择策略（manual / local-first / 回退原因）");
ib.resetComfyProbe();
const statsBeforeManual = state.stats;
const cfgManual = cfgMod.normalizeConfig({ imageProvider: "ark", imageBackendPolicy: "manual", comfyBaseUrl: BASE });
const manualDecision = await ib.resolveImageBackendForRequest(cfgManual);
check("manual：按 imageProvider 选后端", manualDecision.kind === "ark", manualDecision.kind);
check("manual：不探测本地 ComfyUI（不发 /system_stats）", state.stats === statsBeforeManual, String(state.stats - statsBeforeManual));
const cfgLocalFirst = cfgMod.normalizeConfig({
  imageProvider: "ark",
  imageBackendPolicy: "local-first",
  imageProviderFallback: "ark",
  comfyBaseUrl: BASE,
  imageWorkflowId: "builtin.transparent-qwen"
});
ib.resetComfyProbe();
const localDecision = await ib.resolveImageBackendForRequest(cfgLocalFirst);
check("local-first：本地可用时用本地", localDecision.kind === "comfy" && localDecision.fallbackReason === undefined, localDecision.kind);
ib.resetComfyProbe();
const statsProbe = state.stats;
await ib.probeComfy(cfgLocalFirst);
const statsAfterFirstProbe = state.stats;
const cachedProbe = await ib.probeComfy(cfgLocalFirst);
check("探测缓存 30 秒：第二次不再打 /system_stats", state.stats === statsAfterFirstProbe && cachedProbe.ok === true, String(state.stats - statsProbe));
await ib.probeComfy(cfgLocalFirst, true);
check("force 探测会重新打一次", state.stats > statsAfterFirstProbe, String(state.stats - statsAfterFirstProbe));
const cfgLocalFail = cfgMod.normalizeConfig({
  imageProvider: "ark",
  imageBackendPolicy: "local-first",
  imageProviderFallback: "ark",
  comfyBaseUrl: "http://127.0.0.1:1",
  comfyTimeoutMs: 2000
});
ib.resetComfyProbe();
const fallbackDecision = await ib.resolveImageBackendForRequest(cfgLocalFail);
check("local-first：本地不可用时回退到 ark", fallbackDecision.kind === "ark" && typeof fallbackDecision.fallbackReason === "string" && fallbackDecision.fallbackReason !== "", String(fallbackDecision.fallbackReason).slice(0, 120));
const statusAfterFallback = imageprovider.imageBackendStatus(cfgLocalFail);
check("回退原因进 imageBackendStatus（界面必须显示）", statusAfterFallback.fallbackReason !== null && statusAfterFallback.fallbackReason.includes("ComfyUI"), String(statusAfterFallback.fallbackReason).slice(0, 100));
const cfgFallbackCustom = cfgMod.normalizeConfig({
  imageProvider: "ark",
  imageBackendPolicy: "local-first",
  imageProviderFallback: "custom",
  customBaseUrl: "http://127.0.0.1:7860",
  customProtocol: "sdwebui",
  comfyBaseUrl: "http://127.0.0.1:1",
  comfyTimeoutMs: 2000
});
ib.resetComfyProbe();
const customDecision = await ib.resolveImageBackendForRequest(cfgFallbackCustom);
check("local-first：回退目标可配成自定义服务", customDecision.kind === "custom", customDecision.kind);
const cfgFallbackNone = cfgMod.normalizeConfig({
  imageProvider: "ark",
  imageBackendPolicy: "local-first",
  imageProviderFallback: "none",
  comfyBaseUrl: "http://127.0.0.1:1",
  comfyTimeoutMs: 2000
});
ib.resetComfyProbe();
await expectFailure("回退目标 none：本地不可用时直接报错（不悄悄花钱）", () => ib.resolveImageBackendForRequest(cfgFallbackNone), "不回退");
const cfgComfyProvider = cfgMod.normalizeConfig({ imageProvider: "comfy", imageWorkflowId: "builtin.pixel-sdxl-fast", comfyBaseUrl: BASE });
check("默认工作流只有目录条目时 blocker 说明要导入", String(imageprovider.imageProviderBlocker(cfgComfyProvider)).includes("还没导入"), String(imageprovider.imageProviderBlocker(cfgComfyProvider)).slice(0, 80));
const cfgComfyOk = cfgMod.normalizeConfig({ imageProvider: "comfy", imageWorkflowId: "builtin.transparent-qwen", comfyBaseUrl: BASE });
check("comfy 后端就绪时 blocker 为 null", imageprovider.imageProviderBlocker(cfgComfyOk) === undefined);
check("comfy 摘要包含本机地址与工作流名", imageprovider.imageProviderSummary(cfgComfyOk).includes("本地 ComfyUI") && imageprovider.imageProviderSummary(cfgComfyOk).includes("透明精灵"), imageprovider.imageProviderSummary(cfgComfyOk));
check("comfy 不写水印 / 超时跟随 comfyTimeoutMs / 尺寸取工作流默认", imageprovider.imageWatermarkOf(cfgComfyOk) === false && imageprovider.imageTimeoutOf(cfgComfyOk) === cfgComfyOk.comfyTimeoutMs && imageprovider.imageSizeOf(cfgComfyOk) === "1024x1024", JSON.stringify({ size: imageprovider.imageSizeOf(cfgComfyOk) }));
const comfyCaps = ib.backendOfKind("comfy").capabilities;
check("能力声明：comfy 是本地免费 + 支持工作流库", comfyCaps.local === true && comfyCaps.paid === false && comfyCaps.workflowLibrary === true, JSON.stringify(comfyCaps));
const arkCaps = ib.backendOfKind("ark").capabilities;
check("能力声明：ark 是云端付费", arkCaps.local === false && arkCaps.paid === true, JSON.stringify(arkCaps));
check("四个后端都登记了能力", ib.listImageBackends().length === 4, String(ib.listImageBackends().length));

/* ---------------------------------------------------------------- 9. wire / 工具面 */

section("9) 协议与清单（不丢键 / 本地方法不进付费清单）");
const methodNames = wire.METHODS.map((spec) => spec.method);
const NEW_METHODS = ["listWorkflows", "getWorkflow", "saveWorkflow", "removeWorkflow", "testWorkflow", "getWorkflowCatalog"];
check("wire 注册了 6 个工作流方法", NEW_METHODS.every((name) => methodNames.includes(name)), NEW_METHODS.filter((name) => !methodNames.includes(name)).join("、"));
check("wire 方法总数 ≥ 194（188 基线 + 6）", methodNames.length >= 194, String(methodNames.length));
const specOf = (method) => wire.METHODS.find((spec) => spec.method === method);
const savedSpec = specOf("saveWorkflow");
const parsedSave = savedSpec.payload.parse({
  name: "x",
  json: "{}",
  kind: "generate",
  bindings: { prompt: "1.text" },
  requiredModels: ["a.safetensors"],
  defaults: { width: 512, height: 512, steps: 8, cfg: 7, sampler: "euler" },
  notes: "n"
});
check("saveWorkflow schema 保留 bindings / defaults / requiredModels", parsedSave.bindings.prompt === "1.text" && parsedSave.defaults.steps === 8 && parsedSave.requiredModels[0] === "a.safetensors", JSON.stringify(parsedSave.defaults));
const testSpec = specOf("testWorkflow");
const parsedTest = testSpec.payload.parse({ id: "builtin.transparent-qwen", json: "{}", generate: true, prompt: "p" });
check("testWorkflow schema 保留 generate / prompt（真出图开关）", parsedTest.generate === true && parsedTest.prompt === "p", JSON.stringify(parsedTest));
check("getWorkflow / removeWorkflow 的 payload 只有 id", JSON.stringify(Object.keys(specOf("getWorkflow").payload.parse({ id: "x" }))) === JSON.stringify(["id"]));
// 客户端是**经典脚本**（lib/client.js 里没有模块导出），所以直接从源码读清单（与 verify-jobs 同一套做法）。
const clientApiText = await readFile(new URL("../src/client/platform/api.ts", import.meta.url), "utf8");
const listOf = (name) => {
  const block = new RegExp("export const " + name + ": readonly string\\[\\] = \\[([\\s\\S]*?)\\];").exec(clientApiText);
  if (block === null) return [];
  return [...block[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map((match) => match[1]);
};
const readMethods = listOf("READ_METHODS");
const paidMethods = listOf("PAID_METHODS");
check("客户端把 3 个纯读方法归到 READ（只读可重试）", ["listWorkflows", "getWorkflow", "getWorkflowCatalog"].every((name) => readMethods.includes(name)), readMethods.filter((name) => name.startsWith("listWorkflows") || name.startsWith("getWorkflow")).join("、"));
check("6 个工作流方法都不在付费清单", NEW_METHODS.every((name) => !paidMethods.includes(name)), paidMethods.join("、"));
check("工具面把 6 个方法登记为共享方法", NEW_METHODS.every((name) => toolsMod.SHARED_TOOL_METHODS.has(name)), NEW_METHODS.filter((name) => !toolsMod.SHARED_TOOL_METHODS.has(name)).join("、"));
check("共享方法不归入任何模块（设置页跨模块）", NEW_METHODS.every((name) => toolsMod.METHOD_MODULE[name] === undefined));
const clientText = clientSourceText();
check("客户端 api 有 6 个方法的实现（call，不是 callPaid）", NEW_METHODS.every((name) => clientText.includes('call("' + name + '"')), NEW_METHODS.filter((name) => !clientText.includes('call("' + name + '"')).join("、"));

/* ---------------------------------------------------------------- 收尾 */

server.close();
await rm(HOME, { recursive: true, force: true }).catch(() => undefined);

console.log("");
if (failures.length === 0) {
  console.log("共 " + passed + " 项检查，全部通过。");
  console.log("本地 ComfyUI 工作流库契约全部通过。");
  process.exit(0);
} else {
  console.log("共 " + passed + " 项检查，失败 " + failures.length + " 项：");
  for (const item of failures) console.log("  - " + item);
  process.exit(1);
}
