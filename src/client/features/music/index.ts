/**
 * 模块七 音乐生成编辑 —— feature 切片。
 *
 * 从 client.ts 搬出：时间格式化、音频/下载 URL、操作文案表、状态徽章、波形组件，
 * 以及 createMusicModule 的装配调用。行为不变（纯搬运）。
 */

import { createMusicModule } from "../../music-module.js";
import { createFeatureBoundary } from "../../platform/errors.js";

export function createMusic(deps: any) {
  // 依赖：组合根注入（先按需展开，由 tsc 报错驱动补齐）
  const {
    T,
    h,
    Chip,
    React,
    activeLang,
    useLocaleTick,
    buildMusicRequestPrompt,
    buildComposeRequestPrompt,
    deriveMusicName,
    MUSIC_ENGINES,
    MUSIC_FORMATS,
    MUSIC_EDIT_LIMITS,
    useStudioIntent,
    msg,
    Btn,
    NumField,
    BusyBtn,
    BusyBadge,
    ReviewModeBar,
    CopyIdButton,
    openMusicChat,
  } = deps;

    // ── 模块七：音乐生成编辑 ─────────────────────────────────────────────
    //
    // 这个模块不自己生成音乐：用户在「新建音乐」里确认后，客户端先 `createMusicJob`
    // 建任务，再开一个**不挂靠项目**的新对话，把带 jobId 的任务说明发进去。
    // 对话里的 agent 用 `getMusicGuide` + `runMusicGeneration` 推进；生成完把
    // openUrl 贴回来，用户点开就落到这里试听 / 裁剪 / 调音量 / 淡入淡出 / 导出。
    function musicFmtTime(seconds) {
      const value = Math.max(0, Number(seconds) || 0);
      const minutes = Math.floor(value / 60);
      const rest = value - minutes * 60;
      return `${minutes}:${String(Math.floor(rest)).padStart(2, "0")}`;
    }

    function musicAssetUrl(job, relative, fallback) {
      const base = job !== null && job !== undefined && typeof job.assetBase === "string" ? job.assetBase : "";
      if (typeof relative === "string" && relative !== "" && base !== "") {
        const encoded = relative.replace(/^\/+/, "").split("/").map((part) => encodeURIComponent(part)).join("/");
        return `${base}${encoded}`;
      }
      if (typeof fallback === "string" && fallback !== "") {
        const basePath = base !== "" ? new URL(base, window.location.origin).pathname : "";
        try {
          const parsed = new URL(fallback, window.location.origin);
          if (basePath !== "" && parsed.pathname.startsWith(basePath)) return `${parsed.pathname}${parsed.search}`;
        } catch {
          // 不是合法 URL 就原样交给浏览器。
        }
        return fallback;
      }
      return "";
    }

    function musicDownloadUrl(job, relative, fallback) {
      const url = musicAssetUrl(job, relative, fallback);
      if (url === "") return "";
      // 只有本地相对路径能安全地加下载参数；平台远程地址可能已经有自己的查询串。
      return typeof relative === "string" && relative !== "" ? `${url}${url.includes("?") ? "&" : "?"}download=1` : url;
    }

    function makeMusicOps(duration) {
      return {
        start: 0,
        end: Math.max(0, Number(duration) || 0),
        gainDb: 0,
        fadeIn: 0,
        fadeOut: 0,
        normalize: false,
        lufs: -14,
        truePeak: -1,
        format: "mp3",
        bitrate: 192
      };
    }

    function musicOpsText(ops) {
      const parts = [];
      if (Number(ops.start) > 0 || Number(ops.end) > 0) parts.push(T("裁剪 {n0}–{n1}", { n0: musicFmtTime(ops.start), n1: musicFmtTime(ops.end) }));
      if (Number(ops.gainDb) !== 0) parts.push(T("音量 {n0} dB", { n0: ops.gainDb > 0 ? `+${ops.gainDb}` : ops.gainDb }));
      if (Number(ops.fadeIn) > 0) parts.push(T("淡入 {n0}s", { n0: ops.fadeIn }));
      if (Number(ops.fadeOut) > 0) parts.push(T("淡出 {n0}s", { n0: ops.fadeOut }));
      if (ops.normalize === true) parts.push(T("标准化 {n0} LUFS", { n0: ops.lufs }));
      parts.push(String(ops.format ?? "mp3").toUpperCase());
      return parts.join(" · ");
    }

    function musicStatusChip(status) {
      const text = status === "succeeded" ? T("已完成") : status === "failed" ? T("失败") : status === "processing" ? T("处理中") : T("排队中");
      const kind = status === "succeeded" ? "ready" : status === "failed" ? "error" : "running";
      return h(Chip, { kind, text });
    }

    function MusicWave(props) {
      const peaks = Array.isArray(props.peaks) ? props.peaks : [];
      const duration = Math.max(0.001, Number(props.duration) || 0.001);
      const left = Math.max(0, Math.min(100, (Number(props.start) / duration) * 100));
      const right = Math.max(left, Math.min(100, (Number(props.end) / duration) * 100));
      return h(
        "div",
        { className: "SPR_musicWave", "data-testid": "music-wave" },
        h("div", { className: "SPR_musicBars" }, peaks.length === 0
          ? h("span", { className: "SPR_musicWaveEmpty" }, T("波形还没算出来（可以先直接裁剪/调音量）"))
          : peaks.map((value, index) =>
              h("span", { key: index, className: "SPR_musicBar", style: { height: `${Math.max(2, Math.round(Number(value) * 100))}%` } })
            )),
        h("div", { className: "SPR_musicSel", style: { left: `${left}%`, width: `${Math.max(1, right - left)}%` } })
      );
    }

    const RawModule = createMusicModule({ React, h, activeLang, T, useLocaleTick, buildMusicRequestPrompt, buildComposeRequestPrompt, deriveMusicName, MUSIC_ENGINES, MUSIC_FORMATS, MUSIC_EDIT_LIMITS, useStudioIntent, msg, Chip, Btn, NumField, BusyBtn, BusyBadge, ReviewModeBar, CopyIdButton, musicFmtTime, musicAssetUrl, musicDownloadUrl, makeMusicOps, musicOpsText, musicStatusChip, MusicWave, openMusicChat });

  // 错误隔离：整个模块挂一层边界（单模块故障只降级这一块）
  const Boundary = createFeatureBoundary({ name: "music" });

  return {
    musicFmtTime, musicAssetUrl, musicDownloadUrl, makeMusicOps, musicOpsText, musicStatusChip, MusicWave, MusicModule: (props: any) => h(Boundary, null, h(RawModule, props)),
    MusicModuleRaw: RawModule,
  };
}

