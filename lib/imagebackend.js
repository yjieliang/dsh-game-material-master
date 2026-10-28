/**
 * 生图后端的**抽象层**：接口 / 能力声明 / 四个适配器 / 选择与回退策略。
 *
 * 背景：原来 \`imageprovider.ts\` 用一个 if 链把 ark / toapis / custom 分派出去，
 * 而 "本地 ComfyUI" 只是 custom 协议里的一个分支（一份全局工作流）。工作流库接进来之后，
 * 本地后端需要：能力声明（本地免费、不走付费通道）、任务级工作流选择、自检，以及
 * 「本地优先」策略下的显式回退。这些都不该继续长在 if 链里。
 *
 * 约定（设计 §2.1）：
 *   · **能力可声明**：每个后端暴露 \`capabilities\`（是否本地 / 是否付费 / 参考图上限 / 透明方式）；
 *   · **本地免费 ≠ 付费**：\`local: true\` 的后端走 \`local\` 并发通道，**不建 receipt**；
 *   · **失败显式回退**：\`local-first\` 探测失败时回退到配置里指定的云端后端，并把
 *     「用了谁、为什么回退」记下来给界面显示，禁止静默降级；
 *   · **唯一门面不变**：\`imageprovider.generateImageWithProvider\` 仍是所有生图调用点的入口，
 *     这里只负责「选谁 + 怎么调」。
 */
import { generateImage } from "./ark.js";
import { generateCustomImage } from "./customimage.js";
import { assertToapisReady, generateToapisImage } from "./toapis.js";
import { ComfyError, downloadComfyFile, fetchComfyObjectInfo, parseComfyWorkflow, queryComfyImage, submitComfyPrompt, testComfy, uploadComfyImage } from "./comfy.js";
import { applyWorkflowInputs, assertWorkflowBindings, defaultWorkflowIdFor, getWorkflowEntry, inspectWorkflow, resolveWorkflowBindings } from "./workflowlib.js";
import { BUILTIN_CATALOG, BUILTIN_WORKFLOWS } from "./workflowbuiltin.js";
/* ---------------------------------------------------------------- 工具 */
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** "1024x1024" → {width,height}；解析不了返回 undefined（交给工作流默认值）。 */
export function parseWorkflowSize(size) {
    const match = /^\s*(\d{2,5})\s*[x×*]\s*(\d{2,5})\s*$/i.exec(size ?? "");
    if (match === null)
        return undefined;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16)
        return undefined;
    return { width: Math.min(4096, Math.round(width)), height: Math.min(4096, Math.round(height)) };
}
function comfyRequestOf(config) {
    return { baseUrl: config.comfyBaseUrl, timeoutMs: config.comfyTimeoutMs, cookies: config.comfyCookies };
}
/** 内置工作流的显示名（同步查，界面摘要用）。 */
export function builtinWorkflowName(id) {
    const workflow = BUILTIN_WORKFLOWS.find((entry) => entry.id === id);
    if (workflow !== undefined)
        return workflow.name;
    const catalog = BUILTIN_CATALOG.find((entry) => entry.id === id);
    return catalog?.name;
}
/** 当前生效的工作流 id（任务级 → 配置默认 → 用途推荐）。 */
export function resolveWorkflowId(config, workflowId) {
    const explicit = (workflowId ?? "").trim();
    if (explicit !== "")
        return explicit;
    const configured = (config.imageWorkflowId ?? "").trim();
    if (configured !== "")
        return configured;
    return defaultWorkflowIdFor("generate");
}
/* ---------------------------------------------------------------- 云端适配器 */
const arkBackend = {
    capabilities: {
        kind: "ark",
        label: "火山方舟 Seedream",
        local: false,
        paid: true,
        maxReferenceImages: 10,
        transparency: "keyed",
        workflowLibrary: false,
        selfTestGenerates: false
    },
    blocker(config) {
        if (config.arkApiKey.trim() === "")
            return "尚未配置火山方舟 API Key（设置 → 墨盒 → 生图后端 → 火山方舟）";
        if (config.arkModel.trim() === "")
            return "尚未配置火山方舟的生图模型 ID";
        return undefined;
    },
    async generate(config, request, signal) {
        const result = await generateImage({
            baseUrl: config.arkBaseUrl,
            apiKey: config.arkApiKey,
            model: request.model?.trim() || config.arkModel,
            prompt: request.prompt,
            images: request.images,
            size: request.size,
            watermark: request.watermark,
            timeoutMs: request.timeoutMs ?? config.arkTimeoutMs
        }, signal);
        // 保持原样透传：usage / remoteUrl 是日志与回执要用的信息（门面不做裁剪）。
        return { bytes: result.bytes, ext: result.ext, usage: result.usage };
    },
    async selfTest(config) {
        const blocker = arkBackend.blocker(config);
        if (blocker !== undefined)
            return { ok: false, detail: blocker };
        return { ok: true, detail: "配置就绪（云端按次计费，未真实出图；要真测请点设置页的「测试连接」）" };
    }
};
const toapisBackend = {
    capabilities: {
        kind: "toapis",
        label: "ToAPIs",
        local: false,
        paid: true,
        maxReferenceImages: 10,
        transparency: "native",
        workflowLibrary: false,
        selfTestGenerates: false
    },
    blocker(config) {
        try {
            assertToapisReady(config);
            return undefined;
        }
        catch (error) {
            return messageOf(error);
        }
    },
    async generate(config, request, signal) {
        const result = await generateToapisImage(config, request, signal);
        // usage.taskId 是 ToAPIs 对账 / 排障要用的（verify-toapis 也断言它），必须透传。
        return { bytes: result.bytes, ext: result.ext, remoteUrl: result.remoteUrl, usage: result.usage };
    },
    async selfTest(config) {
        const blocker = toapisBackend.blocker(config);
        if (blocker !== undefined)
            return { ok: false, detail: blocker };
        return { ok: true, detail: "配置就绪（云端按次计费，未真实出图）" };
    }
};
/** 与 imageprovider 的 customImageBlocker 同一套判断（放在这里是为了不反向依赖门面）。 */
function customBlocker(config) {
    if (config.customBaseUrl.trim() === "") {
        return "尚未配置自定义生图服务的地址（设置 → 墨盒 → 生图后端 → 自定义生图模型）";
    }
    if (config.customProtocol === "comfyui" && config.customWorkflow.trim() === "") {
        return "选了 ComfyUI 协议，但还没填工作流 JSON（在 ComfyUI 里「导出（API）」拿到那份 JSON，整段粘贴）";
    }
    if (config.customProtocol === "openai" && config.customModel.trim() === "")
        return "选了 OpenAI 协议，但还没填模型名";
    return undefined;
}
const customBackend = {
    capabilities: {
        kind: "custom",
        label: "自定义生图服务",
        local: false,
        paid: false,
        maxReferenceImages: 10,
        transparency: "none",
        workflowLibrary: false,
        selfTestGenerates: false
    },
    blocker(config) {
        return customBlocker(config);
    },
    async generate(config, request, signal) {
        const result = await generateCustomImage({
            protocol: config.customProtocol,
            baseUrl: config.customBaseUrl,
            apiKey: config.customApiKey,
            model: request.model?.trim() || config.customModel,
            prompt: request.prompt,
            images: request.images,
            size: request.size,
            timeoutMs: request.timeoutMs ?? config.customTimeoutMs,
            negativePrompt: request.negativePrompt ?? config.customNegativePrompt,
            steps: request.steps ?? config.customSteps,
            cfgScale: request.cfgScale ?? config.customCfgScale,
            sampler: request.sampler ?? config.customSampler,
            denoising: request.denoising ?? config.customDenoising,
            seed: request.seed ?? config.customSeed,
            workflow: config.customWorkflow
        }, signal);
        return { bytes: result.bytes, ext: result.ext, usage: result.usage };
    },
    async selfTest(config) {
        const blocker = customBackend.blocker(config);
        if (blocker !== undefined)
            return { ok: false, detail: blocker };
        return { ok: true, detail: "配置就绪（自定义服务是否免费由用户自己的服务器决定，未自动出图）" };
    }
};
/* ---------------------------------------------------------------- 本地 ComfyUI 适配器 */
/** 本地后端能不能开跑（同步判断，不探测网络——探测在生成时才做）。 */
export function comfyImageBlocker(config) {
    if ((config.comfyBaseUrl ?? "").trim() === "") {
        return "尚未配置本地 ComfyUI 地址（设置 → 墨盒 → 本地 ComfyUI · 工作流库）";
    }
    const id = (config.imageWorkflowId ?? "").trim();
    if (id !== "" && BUILTIN_WORKFLOWS.every((entry) => entry.id !== id) && BUILTIN_CATALOG.every((entry) => entry.id !== id)) {
        // 用户导入的工作流：id 形如 wf_xxx，磁盘上是否存在要到生成时才知道（这里是同步函数）。
        if (!/^wf_[0-9a-f]+$/.test(id))
            return "默认工作流 id 不像是一个已导入的工作流：" + id;
    }
    if (id !== "" && BUILTIN_CATALOG.some((entry) => entry.id === id) && BUILTIN_WORKFLOWS.every((entry) => entry.id !== id)) {
        return "默认工作流「" + (builtinWorkflowName(id) ?? id) + "」只有目录条目、正文还没导入：请到设置 → 墨盒 → 本地 ComfyUI · 工作流库点「导入工作流」";
    }
    return undefined;
}
/** 上传一张参考图到 ComfyUI 的 input 目录（http(s) 地址先下载成字节）。 */
async function uploadReference(config, image, prefix) {
    const request = comfyRequestOf(config);
    if (/^https?:\/\//i.test(image.trim())) {
        const response = await fetch(image, { signal: AbortSignal.timeout(Math.max(5000, config.comfyTimeoutMs)) });
        if (response.ok !== true)
            throw new ComfyError("下载参考图失败（HTTP " + response.status + "）：" + image.slice(0, 120));
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length === 0)
            throw new ComfyError("下载到的参考图是空的：" + image.slice(0, 120));
        const mime = (response.headers.get("content-type") ?? "image/png").split(";")[0].trim();
        return uploadComfyImage(request, "data:" + mime + ";base64," + bytes.toString("base64"), prefix);
    }
    return uploadComfyImage(request, image, prefix);
}
function defaultSeed() {
    return Math.floor(Math.random() * 2147483000);
}
/** 解析出这次生成要用的工作流条目（任务级 → 配置 → 用途推荐）。 */
export async function resolveWorkflowEntryForImage(config, workflowId) {
    const id = resolveWorkflowId(config, workflowId);
    const entry = await getWorkflowEntry(id);
    if (entry.kind !== "generate") {
        throw new ComfyError("工作流「" + entry.name + "」是后处理工作流（kind=post），不能当生图后端用。请在设置 → 墨盒 → 本地 ComfyUI · 工作流库把默认工作流换成一个出图工作流。");
    }
    return { entry, workflowId: id };
}
/**
 * 调一次本地 ComfyUI 出图。
 *
 * 流程与视频那条完全同形（上传 → 探测注入点 → 提交 → 轮询 → 取回），区别只在
 * 「取回的是图片」与「绑定由工作流库解析」。
 */
export async function generateComfyImage(config, request, signal) {
    const blocked = comfyImageBlocker(config);
    if (blocked !== undefined)
        throw new ComfyError(blocked);
    const request0 = comfyRequestOf(config);
    const { entry, workflowId } = await resolveWorkflowEntryForImage(config, request.workflowId);
    const startedAt = Date.now();
    // /object_info 只在探测「工作流里没连的 optional IMAGE」时需要；拿不到就退回纯本地规则。
    const info = await fetchComfyObjectInfo(request0, Object.values(entry.workflow ?? {}).map((node) => String(node?.class_type ?? ""))).catch(() => undefined);
    const plan = resolveWorkflowBindings(entry, info);
    assertWorkflowBindings(entry, plan);
    // 参考图给了但工作流没有图像注入点：与「提示词被静默忽略」同一类坑，必须报出来。
    if ((request.images ?? []).length > 0 && plan.bindings.image === undefined && plan.bindings.first === undefined) {
        throw new ComfyError("工作流「" + entry.name + "」没有参考图（图像输入）注入点，这次带了 " + request.images.length + " 张参考图，不能静默丢掉。" +
            "请在设置里把「参考图注入点」填成 节点ID.输入名，或换一个支持图生图的工作流。");
    }
    const imageNames = [];
    for (const [index, image] of (request.images ?? []).entries()) {
        if (typeof image !== "string" || image.trim() === "")
            continue;
        imageNames.push(await uploadReference(config, image, "inkbox" + (index === 0 ? "" : String(index + 1))));
    }
    const size = parseWorkflowSize(request.size);
    const seed = request.seed === undefined || request.seed < 0 ? defaultSeed() : Math.floor(request.seed);
    const injected = applyWorkflowInputs(entry, plan, {
        prompt: request.prompt,
        negativePrompt: request.negativePrompt ?? config.customNegativePrompt,
        width: size?.width ?? entry.defaults?.width,
        height: size?.height ?? entry.defaults?.height,
        seed,
        steps: request.steps ?? entry.defaults?.steps,
        cfgScale: request.cfgScale ?? entry.defaults?.cfg,
        sampler: request.sampler ?? entry.defaults?.sampler,
        denoising: request.denoising,
        batch: 1,
        imageNames
    });
    const timeoutMs = Math.max(10_000, request.timeoutMs ?? config.comfyTimeoutMs);
    const promptId = await submitComfyPrompt({ ...request0, workflow: injected.workflow });
    const deadline = Date.now() + timeoutMs;
    let lastStatus = "pending";
    while (Date.now() < deadline) {
        if (signal?.aborted === true)
            throw new ComfyError("已取消本地 ComfyUI 生图（任务已提交，远端可能仍在执行）");
        const query = await queryComfyImage({ ...request0, promptId });
        lastStatus = query.remoteStatus;
        if (query.status === "failed")
            throw new ComfyError(query.error ?? "ComfyUI 执行失败");
        if (query.status === "succeeded" && query.file !== undefined) {
            const bytes = await downloadComfyFile(request0, query.file);
            // comfy.ts 的 downloadComfyFile 只回字节（去背链路还要自己解码像素），
            // 生图后端这边按文件名补 ext（PNG 优先；不认识的扩展名按 png 交给上层嗅探）。
            const extMatch = /\.([A-Za-z0-9]{2,5})$/.exec(query.file.filename);
            const ext = (extMatch === null ? "png" : extMatch[1]).toLowerCase();
            const workNote = injected.notes.filter((note) => note !== "");
            if (workNote.length > 0) {
                // 只记一次，便于排查「提示词到底写进哪个节点」；不含密钥。
                console.info("[inkbox] ComfyUI 注入：" + workNote.join("；"));
            }
            return {
                bytes,
                ext,
                usage: { seed, workflowId, promptId, filename: query.file.filename, elapsedMs: Date.now() - startedAt }
            };
        }
        await new Promise((resolve) => setTimeout(resolve, 900));
    }
    throw new ComfyError("本地 ComfyUI 生图超时（" + Math.round(timeoutMs / 1000) + " 秒，最后状态：" + lastStatus + "）。可以在 ComfyUI 里看看队列是不是被别的任务占着。");
}
const comfyBackend = {
    capabilities: {
        kind: "comfy",
        label: "本地 ComfyUI",
        local: true,
        paid: false,
        maxReferenceImages: 2,
        transparency: "native",
        workflowLibrary: true,
        selfTestGenerates: true
    },
    blocker(config) {
        return comfyImageBlocker(config);
    },
    async generate(config, request, signal) {
        return generateComfyImage(config, request, signal);
    },
    async selfTest(config) {
        const result = await selfTestComfyWorkflow(config, { generate: false });
        return {
            ok: result.ok,
            detail: result.ok
                ? "本地 ComfyUI 可达，工作流「" + (result.name ?? result.workflowId ?? "") + "」的节点 / 模型 / 绑定都就绪"
                : result.error ?? result.missingModels.join("、") ?? result.missingNodeTypes.join("、") ?? "自检失败"
        };
    }
};
/* ---------------------------------------------------------------- 选择与回退 */
const BACKENDS = {
    ark: arkBackend,
    toapis: toapisBackend,
    custom: customBackend,
    comfy: comfyBackend
};
export function backendOfKind(kind) {
    return BACKENDS[kind];
}
export function listImageBackends() {
    return [arkBackend, toapisBackend, customBackend, comfyBackend].map((backend) => backend.capabilities);
}
/** 配置指定的后端（\`manual\` 语义；不探测、不回退）。 */
export function resolveImageBackend(config) {
    const kind = config.imageProvider === "toapis" ? "toapis" : config.imageProvider === "custom" ? "custom" : config.imageProvider === "comfy" ? "comfy" : "ark";
    return BACKENDS[kind];
}
let lastDecision;
/** 最近一次后端选择（界面显示「用了谁 / 为什么回退」）。 */
export function lastBackendDecision() {
    return lastDecision === undefined ? undefined : { ...lastDecision };
}
export function noteBackendDecision(decision) {
    lastDecision = decision;
}
let comfyProbeCache;
const COMFY_PROBE_TTL_MS = 30_000;
/** 清掉探测缓存（配置变更 / 设置页点自检后调用）。 */
export function resetComfyProbe() {
    comfyProbeCache = undefined;
}
/**
 * 探测本地 ComfyUI 是否可用（30 秒缓存）。
 *
 * 只做**便宜**的两件事：/system_stats 可达 + 默认工作流正文存在（本地读盘）。
 * 不做 /object_info 与真出图——那两件事由设置页的自检按钮显式触发，
 * 否则「本地优先」会让每张图都先等一轮网络。
 */
export async function probeComfy(config, force = false) {
    const now = Date.now();
    if (force !== true && comfyProbeCache !== undefined && now - comfyProbeCache.at < COMFY_PROBE_TTL_MS)
        return comfyProbeCache;
    const blocked = comfyImageBlocker(config);
    if (blocked !== undefined) {
        comfyProbeCache = { at: now, ok: false, reason: blocked };
        return comfyProbeCache;
    }
    try {
        await testComfy(comfyRequestOf(config));
        await resolveWorkflowEntryForImage(config);
        comfyProbeCache = { at: now, ok: true };
    }
    catch (error) {
        comfyProbeCache = { at: now, ok: false, reason: messageOf(error) };
    }
    return comfyProbeCache;
}
/**
 * 按 \`imageBackendPolicy\` 决定这次真正用谁。
 *
 * · \`manual\`（默认）：完全按 \`imageProvider\`，行为与今天一致；
 * · \`local-first\`：探测本地 ComfyUI，可用就用本地；不可用则回退 \`imageProviderFallback\`
 *   （ark / custom / none），并把原因记进 \`lastDecision\`。
 *
 * \`none\` = 明确「不回退」：本地不可用时报错（有些用户就是不想在不知情时用云端花钱）。
 */
export async function resolveImageBackendForRequest(config, request) {
    const requested = resolveImageBackend(config).capabilities.kind;
    const at = Date.now();
    if (config.imageBackendPolicy !== "local-first") {
        const decision = { backend: resolveImageBackend(config), requested, kind: requested, at };
        noteBackendDecision(decision);
        return decision;
    }
    const probe = await probeComfy(config);
    if (probe.ok) {
        const decision = { backend: comfyBackend, requested, kind: "comfy", at };
        noteBackendDecision(decision);
        return decision;
    }
    const fallback = config.imageProviderFallback ?? "ark";
    if (fallback === "none") {
        const decision = { backend: resolveImageBackend(config), requested, kind: requested, fallbackReason: probe.reason ?? "本地 ComfyUI 不可用", at };
        noteBackendDecision(decision);
        throw new Error("本地优先策略下本地 ComfyUI 不可用，且回退目标设为「不回退」：" + decision.fallbackReason);
    }
    const targetKind = fallback === "custom" ? "custom" : "ark";
    const target = BACKENDS[targetKind];
    const targetBlocker = target.blocker(config);
    const reason = (probe.reason ?? "本地 ComfyUI 不可用") + (targetBlocker === undefined ? "" : "；回退目标不可用：" + targetBlocker);
    const decision = { backend: target, requested, kind: targetKind, fallbackReason: reason, at };
    noteBackendDecision(decision);
    return decision;
}
function testEntryFromJson(json) {
    const parsed = parseComfyWorkflow(json);
    if (parsed.ok !== true)
        throw new Error("工作流 JSON 解析失败：" + parsed.error);
    return {
        id: "adhoc",
        name: "临时工作流",
        purpose: "",
        kind: "generate",
        protocol: parsed.converted === true ? "ui" : "api",
        builtin: false,
        requiredModels: [],
        bindings: {},
        workflow: parsed.workflow,
        createdAt: 0,
        updatedAt: 0
    };
}
/**
 * 工作流自检：\`/system_stats\` 可达 + 节点类型存在性 + 模型文件存在性 + 绑定识别结果
 * +（可选）真出图一张。
 *
 * 注意「先确认可达再查 /object_info」的顺序：\`fetchComfyObjectInfo\` 对单个类型的失败是
 * **静默吞掉**的（视频链路的既定语义），连不上时会把「所有节点都缺」报成结论。
 */
export async function selfTestComfyWorkflow(config, payload = {}) {
    const startedAt = Date.now();
    const base = {
        ok: false,
        at: startedAt,
        missingNodeTypes: [],
        missingModels: [],
        notes: [],
        elapsedMs: 0
    };
    const request0 = comfyRequestOf(config);
    let service;
    try {
        service = await testComfy(request0);
    }
    catch (error) {
        return { ...base, error: "本地 ComfyUI 不可达：" + messageOf(error), elapsedMs: Date.now() - startedAt };
    }
    let entry;
    try {
        if (payload.json !== undefined && payload.json.trim() !== "") {
            entry = testEntryFromJson(payload.json);
            entry.kind = "generate";
        }
        else {
            const id = (payload.id ?? "").trim() || resolveWorkflowId(config);
            entry = await getWorkflowEntry(id);
        }
    }
    catch (error) {
        return { ...base, service, error: messageOf(error), elapsedMs: Date.now() - startedAt };
    }
    let inspection;
    try {
        inspection = await inspectWorkflow(entry, request0);
    }
    catch (error) {
        return { ...base, service, workflowId: entry.id, name: entry.name, error: "自检失败：" + messageOf(error), elapsedMs: Date.now() - startedAt };
    }
    const bindings = {};
    for (const [key, value] of Object.entries(inspection.bindings))
        if (typeof value === "string")
            bindings[key] = value;
    const result = {
        ok: inspection.ok,
        at: startedAt,
        workflowId: entry.id,
        name: entry.name,
        service,
        nodes: inspection.nodes,
        classTypes: inspection.classTypes,
        missingNodeTypes: inspection.missingNodeTypes,
        modelChecks: inspection.modelChecks,
        missingModels: inspection.missingModels,
        bindings,
        sources: inspection.sources,
        placeholders: inspection.placeholders,
        critical: inspection.critical,
        missing: inspection.missing,
        candidates: inspection.candidates,
        notes: inspection.notes,
        elapsedMs: 0
    };
    if (payload.generate === true) {
        const generateStartedAt = Date.now();
        try {
            const size = entry.defaults?.width !== undefined ? { width: entry.defaults.width, height: entry.defaults.height } : { width: 768, height: 768 };
            const generated = await generateComfyImage(config, {
                prompt: payload.prompt ?? "a single centered red circle on a transparent background, flat 2d icon",
                images: [],
                size: size.width + "x" + size.height,
                watermark: false,
                workflowId: entry.id,
                timeoutMs: config.comfyTimeoutMs
            });
            result.generated = {
                bytes: generated.bytes.length,
                ext: generated.ext,
                elapsedMs: Date.now() - generateStartedAt,
                promptId: generated.usage?.promptId,
                filename: generated.usage?.filename,
                seed: generated.usage?.seed
            };
        }
        catch (error) {
            result.ok = false;
            result.error = "试跑失败：" + messageOf(error);
            result.generated = { bytes: 0, ext: "", elapsedMs: Date.now() - generateStartedAt };
        }
    }
    result.elapsedMs = Date.now() - startedAt;
    return result;
}
