/**
 * 生图后端的分发层。
 *
 * 插件支持两类生图后端（`config.imageProvider`）：
 *
 *   · `ark`（默认）—— 火山方舟 Seedream，走 `ark.generateImage`；
 *   · `custom` —— 用户自己的服务，协议见 `customimage.ts`（OpenAI / ComfyUI / SD WebUI）。
 *
 * 所有生图调用点（八方向图 / 图片生成 / 骨骼动画 / 地图地块）都只经过这里。
 * 这样「换生图后端」只改一处，各模块不必各判一次 provider —— 历史教训是
 * 这种「每处判一次」的分叉迟早会漏一处，而漏掉的那一处**不报错**，
 * 只是偷偷还在用另一家模型。
 */

import { CUSTOM_PROTOCOL_DEFAULTS, loadConfig, type Config } from "./config.js";
import { CustomImageError, generateCustomImage } from "./customimage.js";
import { noteQueued, withSlot } from "./jobs.js";
import {
  builtinWorkflowName,
  comfyImageBlocker,
  lastBackendDecision,
  resolveImageBackend,
  resolveImageBackendForRequest,
  resolveWorkflowId,
  type BackendDecision,
  type ImageBackendKind,
  type ImageGenerateRequest,
  type ImageGenerateResult
} from "./imagebackend.js";
import { BUILTIN_WORKFLOWS } from "./workflowbuiltin.js";
import {
  assessPaidFailure,
  beginPaidCall,
  currentPaidIntent,
  digest,
  markPaidFailed,
  markPaidResolved,
  markPaidUncertain
} from "./receipts.js";

export type ProviderImageRequest = ImageGenerateRequest;
export type ProviderImageResult = ImageGenerateResult;

/** Non-Ark backends take their size from their own provider settings. */
export function imageUsesConfiguredSize(config: Config): boolean {return config.imageProvider !== "ark";}
/** Only Ark supports a separate redraw model; other backends retain their selected model. */
export function imageRedrawModelOf(config: Config): string {
  return config.imageProvider === "ark" ? config.arkRedrawModel.trim() || config.arkModel : imageModelOf(config);
}

export function isCustomProvider(config: Config): boolean {
  return config.imageProvider === "custom";
}

/** 当前生图模型（Ark 是 `arkModel`，自定义是 `customModel`，本地是工作流名）。 */
export function imageModelOf(config: Config): string {
  if (config.imageProvider === "toapis") return config.toapisImageModel;
  if (isCustomProvider(config)) return config.customModel;
  if (config.imageProvider === "comfy") {
    const id = resolveWorkflowId(config);
    return builtinWorkflowName(id) ?? id;
  }
  return config.arkModel;
}

/** 本地工作流的默认出图尺寸（内置工作流带 defaults；用户导入的用 1024x1024 兜底）。 */
function comfySizeOf(config: Config): string {
  const id = resolveWorkflowId(config);
  const workflow = BUILTIN_WORKFLOWS.find((entry) => entry.id === id);
  const defaults = workflow?.defaults;
  if (defaults?.width !== undefined && defaults?.height !== undefined) return defaults.width + "x" + defaults.height;
  return "1024x1024";
}

/** 当前输出尺寸。 */
export function imageSizeOf(config: Config): string {
  if (config.imageProvider === "toapis") return config.toapisImageSize;
  if (isCustomProvider(config)) return config.customSize;
  if (config.imageProvider === "comfy") return comfySizeOf(config);
  return config.arkSize;
}

/** 当前水印开关。水印是火山方舟特有的参数，自定义 / 本地后端一律不带。 */
export function imageWatermarkOf(config: Config): boolean {
  if (config.imageProvider === "toapis") return false;
  if (isCustomProvider(config) || config.imageProvider === "comfy") return false;
  return config.arkWatermark;
}

/** 当前请求超时。 */
export function imageTimeoutOf(config: Config): number {
  if (config.imageProvider === "toapis") return config.toapisTimeoutMs;
  if (isCustomProvider(config)) return config.customTimeoutMs;
  if (config.imageProvider === "comfy") return config.comfyTimeoutMs;
  return config.arkTimeoutMs;
}

/** 自定义后端自己的必填项检查（不看 `imageProvider`，供「测试连接」按钮用）。 */
export function customImageBlocker(config: Config): string | undefined {
  if (config.customBaseUrl.trim() === "") {
    return "尚未配置自定义生图服务的地址（设置 → 墨盒 → 生图后端 → 自定义生图模型）";
  }
  if (config.customProtocol === "comfyui" && config.customWorkflow.trim() === "") {
    return "选了 ComfyUI 协议，但还没填工作流 JSON（在 ComfyUI 里「导出（API）」拿到那份 JSON，整段粘贴）";
  }
  if (config.customProtocol === "openai" && config.customModel.trim() === "") {
    return "选了 OpenAI 协议，但还没填模型名";
  }
  return undefined;
}

/**
 * 当前后端「能不能开跑」。返回 undefined = 可以。
 *
 * 错误文案里必须写清**去哪里配**：两种后端的用户不是同一批人，
 * 只说「未配置」会让人在设置页里来回找。
 */
export function imageProviderBlocker(config: Config): string | undefined {
  const backend = resolveImageBackend(config);
  if (config.imageBackendPolicy === "local-first") {
    // 本地优先：真正能不能开跑取决于「回退目标」。本地不可用属于**预期内**的情况，
    // 原因记在 lastBackendDecision 里由界面显示，这里不报成 blocker。
    const fallback = config.imageProviderFallback ?? "ark";
    if (fallback === "none") return comfyImageBlocker(config) ?? backend.blocker(config);
    const target = resolveImageBackend({ ...config, imageProvider: fallback === "custom" ? "custom" : "ark" });
    return target.blocker(config);
  }
  return backend.blocker(config);
}

export function assertImageProviderReady(config: Config): void {
  const blocker = imageProviderBlocker(config);
  if (blocker !== undefined) throw new Error(blocker);
}

/** 一句话摘要（界面角标与工具面共用）。 */
export function imageProviderSummary(config: Config): string {
  const kind = resolveImageBackend(config).capabilities.kind;
  if (kind === "toapis") return `ToAPIs · ${config.toapisImageModel}`;
  if (kind === "custom") {
    const label = CUSTOM_PROTOCOL_DEFAULTS[config.customProtocol]?.label ?? config.customProtocol;
    const model = config.customModel.trim() === "" ? "" : ` · ${config.customModel}`;
    return `自定义 · ${label} · ${config.customBaseUrl}${model}`;
  }
  if (kind === "comfy") {
    const workflowId = resolveWorkflowId(config);
    const name = builtinWorkflowName(workflowId) ?? workflowId;
    return `本地 ComfyUI · ${config.comfyBaseUrl} · ${name}`;
  }
  return `火山方舟 · ${config.arkModel}`;
}

/**
 * 界面 / 工具面共用的后端状态快照：选了谁、能力是什么、最近一次回退原因。
 *
 * `fallbackReason` 是设计 §3.3 的硬要求（「界面必须显示回退原因」）：
 * 本地优先在本地不可用时静默换成云端，用户会以为用的是本地免费模型。
 */
export interface ImageBackendStatus {
  kind: ImageBackendKind;
  label: string;
  local: boolean;
  paid: boolean;
  policy: string;
  workflowLibrary: boolean;
  workflowId: string;
  workflowName: string;
  fallbackTarget: string;
  fallbackReason: string | null;
  blocker: string | null;
}

export function imageBackendStatus(config: Config): ImageBackendStatus {
  const backend = resolveImageBackend(config);
  const workflowId = resolveWorkflowId(config);
  const decision: BackendDecision | undefined = lastBackendDecision();
  const fallbackReason =
    decision !== undefined && decision.fallbackReason !== undefined && decision.fallbackReason !== "" ? decision.fallbackReason : null;
  return {
    kind: backend.capabilities.kind,
    label: backend.capabilities.label,
    local: backend.capabilities.local,
    paid: backend.capabilities.paid,
    policy: config.imageBackendPolicy,
    workflowLibrary: backend.capabilities.workflowLibrary,
    workflowId,
    workflowName: backend.capabilities.workflowLibrary ? (builtinWorkflowName(workflowId) ?? workflowId) : "",
    fallbackTarget: config.imageProviderFallback,
    fallbackReason,
    blocker: imageProviderBlocker(config) ?? null
  };
}

/**
 * 调一次生图，自动按当前后端分发。
 *
 * 所有生图都会先过**并发池**（超限排队，不拒绝）：
 *   · 云端（ark / toapis / custom）走 `paid` 通道；ark 还要落 receipt（见 receipts.ts）；
 *     ToAPIs 的提交在 `toapis.ts` 内部已有 receipt（那里才能按 taskId 对账），不重复记账；
 *   · 本地 ComfyUI 走 `local` 通道、**不建 receipt**（本地免费，记 receipt 只会让
 *     「可能已付费」的凭证目录里混进一堆不该有的记录）。
 *
 * 选谁 / 怎么回退由 `imagebackend.resolveImageBackendForRequest` 决定（manual / local-first），
 * 这里只负责并发通道与 receipt。
 */
export async function generateImageWithProvider(request: ProviderImageRequest, signal?: AbortSignal): Promise<ProviderImageResult> {
  const config = await loadConfig();
  const decision = await resolveImageBackendForRequest(config, request);
  const backend = decision.backend;
  const kind = backend.capabilities.kind;
  const blocker = backend.blocker(config);
  if (blocker !== undefined) throw new Error(blocker);
  const model = request.model?.trim() || imageModelOf(config);
  const label =
    kind === "ark"
      ? `生图 · 火山方舟 · ${model}`
      : kind === "toapis"
        ? `生图 · ToAPIs · ${model}`
        : kind === "comfy"
          ? `生图 · 本地 ComfyUI · ${model}`
          : `生图 · 自定义后端 · ${model}`;
  const lane = backend.capabilities.local ? "local" : "paid";
  return withSlot(lane, { label, module: "sprite", onQueued: (info) => noteQueued(currentPaidIntent()?.jobId, info) }, async () => {
    const ticket =
      kind === "ark"
        ? await beginPaidCall({
            provider: "ark",
            identity: {
              model,
              size: request.size,
              watermark: request.watermark,
              prompt: request.prompt,
              images: request.images.map((image) => digest(image))
            }
          })
        : undefined;
    try {
      const result = await backend.generate(config, { ...request, model }, signal);
      if (ticket !== undefined) {
        await markPaidResolved(ticket.key, { detail: `已返回 ${result.bytes.length} 字节` }).catch(() => undefined);
      }
      return result;
    } catch (error) {
      if (ticket !== undefined) {
        const assessment = assessPaidFailure(error);
        if (assessment.state === "failed") await markPaidFailed(ticket.key, { detail: assessment.detail }).catch(() => undefined);
        else await markPaidUncertain(ticket.key, { detail: assessment.detail }).catch(() => undefined);
      }
      throw error;
    }
  });
}

/**
 * 连通性自检：对**自定义后端**真实生成一张小图。
 *
 * 与 `testArk` 对称：各自测各自那一组配置，所以「当前用哪家」不影响按钮能不能点
 * —— 用户经常是先把两边的地址都填好、各测一次，再决定切哪个。
 * 只有真跑一次才能同时验证「地址对不对」和「服务端真的能出图」，看配置看不出来。
 */
export async function testCustomImage(): Promise<{ ok: true; provider: string; model: string; bytes: number; ext: string }> {
  const config = await loadConfig();
  const blocker = customImageBlocker(config);
  if (blocker !== undefined) throw new Error(blocker);
  const result = await generateCustomImage({
    protocol: config.customProtocol,
    baseUrl: config.customBaseUrl,
    apiKey: config.customApiKey,
    model: config.customModel,
    prompt: "一张纯绿色背景的空白测试图，画面中只有一个居中的小圆点",
    images: [],
    size: config.customSize,
    timeoutMs: config.customTimeoutMs,
    negativePrompt: config.customNegativePrompt,
    steps: config.customSteps,
    cfgScale: config.customCfgScale,
    sampler: config.customSampler,
    denoising: config.customDenoising,
    // 测试图固定种子，便于对比两次测试的结果是否一致（排查缓存 / 没真跑的问题）。
    seed: 20261016,
    workflow: config.customWorkflow
  });
  return {
    ok: true,
    provider: `自定义 · ${CUSTOM_PROTOCOL_DEFAULTS[config.customProtocol]?.label ?? config.customProtocol}`,
    model: config.customModel,
    bytes: result.bytes.length,
    ext: result.ext
  };
}

export { CustomImageError };
export type { CustomProtocol } from "./config.js";
