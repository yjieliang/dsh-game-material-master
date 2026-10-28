/**
 * 静态资源路由：把各模块落盘的产物按白名单路径直接发给浏览器。
 *
 * 单独成模块的原因：它是插件**唯一的非 RPC 出站面**（HTTP 状态码、Range、缓存、
 * 目录穿越防护都在这里），与网关的业务方法没有共享状态。改错的表现通常只是
 * 「图裂了 / 视频拖不动」，不会有任何异常抛出来，所以白名单改动要格外小心。
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import * as imagegen from "./imagegen.js";
import * as seqgen from "./seqgen.js";
import * as riggen from "./riggen.js";
import * as isogen from "./isogen.js";
import * as mapgen from "./mapgen.js";
import * as musicgen from "./musicgen.js";
import * as sfxgen from "./sfxgen.js";
import { assetPath } from "./store.js";
export const ROUTE_PREFIX = "/dsh-inkbox";
const PROJECT_ID_PATTERN = /^p[a-z0-9]{4,40}$/;
const MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    // 音乐模块（模块七）：音频 / 工具产物。少了这些，浏览器会把音频当 octet-stream，
    // <audio> 的拖动进度与时长都可能异常。
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".mid": "audio/midi",
    ".midi": "audio/midi",
    ".py": "text/x-python; charset=utf-8",
    ".pdf": "application/pdf",
    ".xml": "application/xml; charset=utf-8",
    ".musicxml": "application/vnd.recordare.musicxml+xml; charset=utf-8",
    ".lrc": "text/plain; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    // 模块六的导出包：`.zip` 少了这一条会掉进 octet-stream —— 浏览器照样存得下来，
    // 但少了这个类型，某些浏览器/壳会把「另存为」的默认扩展名写错。
    ".zip": "application/zip",
    // 骨骼动画的自包含预览是一整个 HTML 文件，必须用 text/html 才能被 iframe 渲染。
    ".html": "text/html; charset=utf-8",
    ".atlas": "text/plain; charset=utf-8"
};
// ── 静态资源路由 ────────────────────────────────────────────────────────
/** 各模块允许通过 HTTP 路由读取的子目录白名单。 */
// `turn/` 是转圈截帧的候选帧与缩略条带：轴上那八个圆圈是对着条带拖的，
// 少了这条白名单，整个时间轴会 403（界面看着只是「图裂了」）。
// `qa/` 是产物体检报告（<目标目录>/qa/report.json）：界面要能直接下载 / 打开，
// 少这一条就是「徽标有、点导出 403」。
const SERVABLE_DIRS = new Set(["source", "images", "videos", "frames", "keyed", "preview", "out", "turn", "qa"]);
const SERVABLE_IMAGE_DIRS = new Set(["refs", "out", "keyed", "qa"]);
const SERVABLE_SEQUENCE_DIRS = new Set(["refs", "video-refs", "videos", "frames", "keyed", "out", "qa"]);
/** 骨骼动画：源图、拆件摊平图、部件、装配结果、骨骼与图集。 */
// `export/` 是后加的第二条导出路径（DragonBones 5.5 的 `_ske.json`）。
// 白名单只比对**第一段**路径，所以 `export/dragonbones/xxx.json` 加一条 `export` 就够。
const SERVABLE_RIG_DIRS = new Set(["source", "sheet", "parts", "layout", "rig", "atlas", "export"]);
/**
 * 地图编辑器（模块六）：素材原图、验收预览图、导出包、AI 素材暂存区。
 *
 * **唯一真源在 `mapgen.SERVABLE_MAP_DIRS`**（建项目时的目录清单读的也是它）——
 * 两处各写一份的话，漏掉的那条只会以「图裂了 / 403」的形式出现，不报错。
 *
 * ⚠️ 另一半仍要同步：`AssetScope` 类型、`resolveAssetTarget` 的分支、`SCOPES`
 * 数组（那三处是 **scope** 级；`ai/` 是子目录级，只比对第一段路径，加一行就够）。
 *
 * 单项目 = 单张地图之后 `maps/` 目录不存在了（地图就是项目根下的 `map.json`，
 * 不通过资源路由读）。
 */
const SERVABLE_MAP_DIRS = mapgen.SERVABLE_MAP_DIRS;
/** 音乐生成编辑（模块七）：原曲、版本、波形缓存、工具产物、导出。 */
const SERVABLE_MUSIC_DIRS = musicgen.SERVABLE_MUSIC_DIRS;
/** 音效生成（模块八）：参考素材、每次生成的音频、导出。 */
const SERVABLE_SFX_DIRS = sfxgen.SERVABLE_SFX_DIRS;
function resolveAssetTarget(scope, id, relative) {
    if (scope === "assets") {
        if (!PROJECT_ID_PATTERN.test(id))
            return undefined;
        return { file: assetPath(id, relative), dirs: SERVABLE_DIRS };
    }
    if (scope === "image-assets") {
        if (!imagegen.isValidImageJobId(id))
            return undefined;
        return { file: imagegen.imageAssetPath(id, relative), dirs: SERVABLE_IMAGE_DIRS };
    }
    if (scope === "rig-assets") {
        if (!riggen.isValidRigJobId(id))
            return undefined;
        return { file: riggen.rigAssetPath(id, relative), dirs: SERVABLE_RIG_DIRS };
    }
    if (scope === "iso-assets") {
        if (!isogen.isValidIsoProjectId(id))
            return undefined;
        return { file: isogen.isoAssetPath(id, relative), dirs: isogen.SERVABLE_ISO_DIRS };
    }
    if (scope === "map-assets") {
        if (!mapgen.isValidMapProjectId(id))
            return undefined;
        return { file: mapgen.mapAssetPath(id, relative), dirs: SERVABLE_MAP_DIRS };
    }
    if (scope === "music-assets") {
        if (!musicgen.isValidMusicJobId(id))
            return undefined;
        return { file: musicgen.musicAssetPath(id, relative), dirs: SERVABLE_MUSIC_DIRS };
    }
    if (scope === "sfx-assets") {
        if (!sfxgen.isValidSfxJobId(id))
            return undefined;
        return { file: sfxgen.sfxAssetPath(id, relative), dirs: SERVABLE_SFX_DIRS };
    }
    if (!seqgen.isValidSequenceJobId(id))
        return undefined;
    return { file: seqgen.sequenceAssetPath(id, relative), dirs: SERVABLE_SEQUENCE_DIRS };
}
function sendText(res, status, text) {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(text);
}
/**
 * 把各模块的产物路径映射到磁盘文件：
 *   /dsh-inkbox/assets/<项目 id>/<相对路径>           八方向图
 *   /dsh-inkbox/image-assets/<任务 id>/<相对路径>      图片生成
 *   /dsh-inkbox/sequence-assets/<任务 id>/<相对路径>   序列帧生成
 *   /dsh-inkbox/rig-assets/<任务 id>/<相对路径>        骨骼动画生成
 *   /dsh-inkbox/iso-assets/<项目 id>/<相对路径>        45°地图编辑器
 *   /dsh-inkbox/map-assets/<项目 id>/<相对路径>        地图编辑器
 *   /dsh-inkbox/music-assets/<任务 id>/<相对路径>      音乐生成编辑
 *
 * 支持 Range：没有它浏览器里的 <video> 就不能拖动进度条，验收视频时会很难受。
 */
export async function handleAsset(req, res, bootInfo) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        sendText(res, 405, "Method Not Allowed");
        return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const rest = decodeURIComponent(url.pathname.slice(ROUTE_PREFIX.length)).replace(/^\/+/, "");
    /**
     * 构建探针。走 prefix 路由，所以路径是 `/dsh-inkbox/_health`。
     *
     * 不读盘、无副作用，只回「本模块是哪次 import 进来的」——客户端 bundle 每次请求
     * 都从磁盘现读，宿主半区却只在进程启动（或 profile patch 热重载）时 import 一次，
     * 两者会不一致。有这个端点，界面与测试就能明确区分「代码没生效」和「功能坏了」，
     * 而不是像以前那样以「按钮一直是灰的 / 图片 404」的形式坏掉。
     */
    if (rest === "_health") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(`${JSON.stringify({ ok: true, pid: process.pid, ...bootInfo })}\n`);
        return;
    }
    const segments = rest.split("/").filter((segment) => segment !== "");
    if (segments.length < 3) {
        sendText(res, 404, "Not Found");
        return;
    }
    const scope = segments[0];
    // ⚠️ 这是**运行时**白名单，必须与 `AssetScope` 类型和 `resolveAssetTarget` 的分支
    // 三处同步。只改类型不改这里，TypeScript 一句话都不会说 —— `scope` 是断言出来的，
    // 而漏掉的那个 scope 会在这里直接掉进 404（界面表现只是「图裂了」）。
    // 实测：`iso-assets` / `tile-assets` 这类 scope 都漏过一轮，素材全 404。
    const SCOPES = ["assets", "image-assets", "sequence-assets", "rig-assets", "iso-assets", "map-assets", "music-assets", "sfx-assets"];
    if (!SCOPES.includes(scope)) {
        sendText(res, 404, "Not Found");
        return;
    }
    const id = segments[1];
    const relative = segments.slice(2).join("/");
    if (relative.includes("..")) {
        sendText(res, 400, "Bad Request");
        return;
    }
    let target;
    try {
        target = resolveAssetTarget(scope, id, relative);
    }
    catch {
        sendText(res, 400, "Bad Request");
        return;
    }
    if (target === undefined) {
        sendText(res, 400, "Bad Request");
        return;
    }
    if (!target.dirs.has(relative.split("/")[0])) {
        sendText(res, 403, "Forbidden");
        return;
    }
    let info;
    try {
        info = await stat(target.file);
    }
    catch {
        sendText(res, 404, "Not Found");
        return;
    }
    if (!info.isFile()) {
        sendText(res, 404, "Not Found");
        return;
    }
    const type = MIME_TYPES[extname(target.file).toLowerCase()] ?? "application/octet-stream";
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const baseHeaders = {
        "Content-Type": type,
        ETag: etag,
        "Last-Modified": new Date(info.mtimeMs).toUTCString(),
        // 产物是不可变的（每次重跑都会换 mtime → 换 ETag），所以可以放心长缓存。
        "Cache-Control": "private, max-age=300",
        "Accept-Ranges": "bytes"
    };
    /**
     * `?download=1`：给音乐模块的导出链接用，强制浏览器存盘而不是在线播放。
     * 文件名只用磁盘上的 basename（不接受 URL 里的文件名），中文走 RFC 5987。
     */
    if (url.searchParams.get("download") === "1") {
        const name = basename(target.file);
        const ascii = name.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_");
        baseHeaders["Content-Disposition"] = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
        baseHeaders["Cache-Control"] = "no-store";
    }
    if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, baseHeaders);
        res.end();
        return;
    }
    const rangeHeader = req.headers.range;
    if (typeof rangeHeader === "string") {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
        if (match !== null) {
            const start = match[1] === "" ? Math.max(0, info.size - Number(match[2])) : Number(match[1]);
            const end = match[1] === "" || match[2] === "" ? info.size - 1 : Math.min(info.size - 1, Number(match[2]));
            if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < info.size) {
                res.writeHead(206, {
                    ...baseHeaders,
                    "Content-Range": `bytes ${start}-${end}/${info.size}`,
                    "Content-Length": String(end - start + 1)
                });
                if (req.method === "HEAD") {
                    res.end();
                    return;
                }
                const stream = createReadStream(target.file, { start, end });
                stream.on("error", () => res.destroy());
                stream.pipe(res);
                return;
            }
        }
    }
    res.writeHead(200, { ...baseHeaders, "Content-Length": String(info.size) });
    if (req.method === "HEAD") {
        res.end();
        return;
    }
    const stream = createReadStream(target.file);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
}
