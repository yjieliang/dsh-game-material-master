/**
 * 「界面 payload → 配置补丁」的构造。
 *
 * 纯数据变换：不读盘、不写盘、不碰 ffmpeg 探测缓存。落盘时机与副作用
 * （`saveConfig`、`ffmpegCache`、谱曲依赖缓存）留在网关，两件事分开。
 *
 * 约定：凭据类字段**不带 = 保持原值，带串 = 覆盖，`clearXxx` = 清空**，
 * 所以它们不进 `directKeys`（那是原样透传），逐个 trim / 归一化。
 */
import { normalizeComfyCookies } from "./comfy.js";
function asRecord(value) {
    return value !== null && typeof value === "object" ? value : {};
}
export function buildConfigPatch(payload) {
    const input = asRecord(payload);
    const patch = {};
    const directKeys = [
        "toapisBaseUrl",
        "toapisImageModel",
        "toapisImageSize",
        "toapisImageQuality",
        "toapisImageBackground",
        "toapisVideo",
        "toapisVideoModel",
        "toapisVideoDuration",
        "toapisVideoResolution",
        "toapisVideoAspectRatio",
        "toapisTimeoutMs",
        "imageProvider",
        "customProtocol",
        "customBaseUrl",
        "customModel",
        "customSize",
        "customNegativePrompt",
        "customSteps",
        "customCfgScale",
        "customSampler",
        "customDenoising",
        "customSeed",
        "customWorkflow",
        "customTimeoutMs",
        "arkBaseUrl",
        "arkModel",
        "arkSize",
        "arkWatermark",
        "arkTimeoutMs",
        "minimaxBaseUrl",
        "minimaxModel",
        "minimaxDuration",
        "minimaxResolution",
        "minimaxPromptOptimizer",
        "minimaxTimeoutMs",
        // 本地 ComfyUI 后端（videogen.ts 按 comfyVideo 分派）。
        "comfyVideo",
        "comfyBaseUrl",
        "comfyWorkflow",
        "comfyPromptTarget",
        "comfyFirstFrameTarget",
        "comfyWidth",
        "comfyHeight",
        "comfySeconds",
        "comfySeed",
        "comfyTimeoutMs",
        // 音乐生成编辑（模块七）。Key 不进这里（见下面单独处理）。
        "musicProvider",
        "musicBaseUrl",
        "musicModel",
        "musicTimeoutMs",
        "musicPollTimeoutMs",
        // 谱曲模式依赖路径（空 = 自动探测）。
        "musicPythonPath",
        "musicFluidsynthPath",
        "musicSoundfontPath",
        // 音效生成（模块八）。Key 同样不进这里（见下面单独处理）。
        "sfxProvider",
        "sfxBaseUrl",
        "sfxModel",
        "sfxFormat",
        "sfxSampleRate",
        "sfxTimeoutMs",
        "cellWidth",
        "cellHeight",
        "frameCount",
        "fitMode",
        "workingLongEdge",
        "pixelSize",
        "autoCrop",
        "fillRatio",
        "bottomMargin",
        "cropInset",
        "keyLow",
        "keyHigh",
        "despill",
        "bgTolerance",
        "edgeShrink",
        "rowOrder",
        "concurrency",
        // 功能可见性：设置页的「功能管理」写它，`normalizeConfig` 会收敛成合法子集。
        // 对话工具面**不允许**改它（见 tools.ts），否则模型可以自己把隐藏的功能放出来。
        "hiddenModules"
    ];
    for (const key of directKeys) {
        if (input[key] !== undefined)
            patch[key] = input[key];
    }
    if (typeof input.toapisApiKey === "string")
        patch.toapisApiKey = input.toapisApiKey.trim();
    if (input.clearToapisApiKey === true)
        patch.toapisApiKey = "";
    if (typeof input.arkApiKey === "string")
        patch.arkApiKey = input.arkApiKey.trim();
    if (typeof input.minimaxApiKey === "string")
        patch.minimaxApiKey = input.minimaxApiKey.trim();
    if (typeof input.customApiKey === "string")
        patch.customApiKey = input.customApiKey.trim();
    // 音乐模块的 Key 与其它凭据同一套约定：不带 = 保持原值，带串 = 覆盖。
    if (typeof input.musicApiKey === "string")
        patch.musicApiKey = input.musicApiKey.trim();
    // 音效模块的 Key 是**语音控制台**的 API Key（X-Api-Key），与方舟 Key 不同源。
    if (typeof input.sfxApiKey === "string")
        patch.sfxApiKey = input.sfxApiKey.trim();
    if (input.clearArkApiKey === true)
        patch.arkApiKey = "";
    if (input.clearMinimaxApiKey === true)
        patch.minimaxApiKey = "";
    if (input.clearCustomApiKey === true)
        patch.customApiKey = "";
    if (input.clearMusicApiKey === true)
        patch.musicApiKey = "";
    if (input.clearSfxApiKey === true)
        patch.sfxApiKey = "";
    // ComfyUI 的 Cookie 也是凭据，与 API Key 同一套约定：不带 = 保持原值，带串 = 覆盖，
    // clearComfyCookies = 清空。它**不进** directKeys——那里是原样透传，Cookie 要先归一化。
    if (typeof input.comfyCookies === "string")
        patch.comfyCookies = normalizeComfyCookies(input.comfyCookies);
    if (input.clearComfyCookies === true)
        patch.comfyCookies = "";
    return patch;
}
