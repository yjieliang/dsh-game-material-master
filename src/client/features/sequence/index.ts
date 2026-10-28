/**
 * 模块③ 序列帧生成 —— feature 切片。
 *
 * 从 client.ts 搬出该模块的常量 / 辅助组件，以及 createSequence 的装配调用。行为不变（纯搬运）。
 */

import { createSequenceModule } from "../../sequence-module.js";
import { createFeatureBoundary } from "../../platform/errors.js";
import type { FeatureDeps } from "../../platform/deps.js";

export function createSequence(deps: FeatureDeps) {
  // 依赖：组合根注入（先按需展开，由 tsc 报错驱动补齐）
  const {
    store, // P9：组合根注入的共享 store；本模块内部暂未直接使用，不再往下透传。
    h,
    T,
    Btn,
    msg,
    React,
    NumField,
    useLocaleTick,
    useStudioIntent,
    mergeDrafts,
    askNewName,
    Chip,
    StatusChip,
    useGlobalConfig,
    GlobalModelField,
    ZoomableImage,
    usePendingTasks,
    LoadingOverlay,
    MediaBox,
    BusyBtn,
    BusyBadge,
    ReviewModeBar,
    ApproveBtn,
    readFileBase64,
    UploadBox,
    KeyingFields,
    CopyIdButton,
    JobSidebar,
    gmmScheduler,
  } = deps;

    // ── 模块③：序列帧生成 ───────────────────────────────────────────────
    /** 模块③的 pending key：视频、抽帧、抠像、合成、上传、新建任务。 */
    const K_SEQ_VIDEO = "seq:video";

    const K_SEQ_FRAMES = "seq:frames";

    const K_SEQ_KEY = "seq:key";

    const K_SEQ_COMPOSE = "seq:compose";

    const K_SEQ_UPLOAD = "seq:upload";

    const K_SEQ_CREATE = "seq:create";

    const K_SEQ_POLL = "seq:poll";

    /** 单张参考图/首尾帧的展示行。 */
    function RefRow(props) {
      // ⚠️ 这里的 prop 不能叫 `ref`：React 会把名为 ref 的 prop 特殊处理（不进 props），
      // 函数组件里 `props.ref` 恒为 undefined，界面就会永远显示「未上传」——
      // 看起来像「选了图没反应」，实测踩过。
      const { job, frame, kind, api, reload, setNotice } = props;
      if (frame === undefined) return h("span", { className: "SPR_refRow" }, T("未上传"));
      return h(
        "div",
        { className: "SPR_toolbar" },
        h("img", { className: "SPR_thumbMd", src: `${job.assetBase}${frame.file}?v=${job.updatedAt}`, alt: frame.name }),
        h("span", { className: "SPR_refRow" }, frame.name),
        h(
          Btn,
          {
            danger: true,
            onClick: async () => {
              try {
                await api.removeSequenceRef({ jobId: job.id, kind });
                await reload(job.id);
              } catch (error) {
                setNotice({ kind: "error", text: msg(error) });
              }
            }
          },
          T("移除")
        )
      );
    }

    /** 序列帧播放预览：把抠好的帧按 fps 循环播出来。 */
    function SequencePlayer(props) {
      const urls = props.urls;
      const canvasRef = React.useRef(null);
      const imagesRef = React.useRef([]);
      const rafRef = React.useRef(0);
      const liveRef = React.useRef({ fps: 12, scale: 1 });
      const [fps, setFps] = React.useState(12);
      const [scale, setScale] = React.useState(1);
      const [playing, setPlaying] = React.useState(true);
      const [loaded, setLoaded] = React.useState(0);
      const playingRef = React.useRef(true);
      const key = urls.join("|");

      liveRef.current.fps = fps;
      liveRef.current.scale = scale;
      playingRef.current = playing;

      React.useEffect(() => {
        let cancelled = false;
        const images = [];
        let done = 0;
        urls.forEach((url, index) => {
          const image = new Image();
          image.onload = () => {
            done++;
            if (!cancelled) setLoaded(done);
          };
          image.onerror = () => {
            done++;
            if (!cancelled) setLoaded(done);
          };
          image.src = url;
          images[index] = image;
        });
        imagesRef.current = images;
        setLoaded(0);
        return () => {
          cancelled = true;
          imagesRef.current = [];
        };
      }, [key]);

      React.useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas === null) return undefined;
        const g = canvas.getContext("2d");
        let frame = 0;
        let last = performance.now();
        const tick = (now) => {
          rafRef.current = requestAnimationFrame(tick);
          const live = liveRef.current;
          const images = imagesRef.current.filter((image) => image !== undefined && image.naturalWidth > 0);
          if (images.length === 0) return;
          const interval = 1000 / Math.max(1, live.fps);
          if (playingRef.current && now - last >= interval) {
            last = now;
            frame = (frame + 1) % images.length;
          }
          const image = images[frame % images.length];
          const w = Math.round(image.naturalWidth * live.scale);
          const h2 = Math.round(image.naturalHeight * live.scale);
          canvas.width = w;
          canvas.height = h2;
          g.fillStyle = "#ffffff";
          g.fillRect(0, 0, w, h2);
          g.imageSmoothingEnabled = live.scale < 1;
          g.drawImage(image, 0, 0, w, h2);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
      }, [key]);

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "SPR_fields" },
          h(NumField, { label: T("播放帧率（fps）"), value: fps, min: 1, max: 30, onChange: setFps }),
          h(NumField, { label: T("预览缩放"), value: scale, min: 0.2, max: 2, step: 0.1, onChange: setScale }),
          h(
            "label",
            { className: "SPR_field" },
            h("span", { className: "SPR_fieldLabel" }, T("播放")),
            h(
              "select",
              { className: "SPR_input", value: playing ? "on" : "off", onChange: (event) => setPlaying(event.target.value === "on") },
              h("option", { value: "on" }, T("播放中")),
              h("option", { value: "off" }, T("暂停"))
            )
          )
        ),
        h("p", { className: "SPR_hint" }, T("已载入 {n0}/{n1} 帧。这是抠像后的帧按顺序循环播放的效果，用来判断动作连贯性和抠像边缘是否稳定。", { n0: loaded, n1: urls.length })),
        h("div", { className: "SPR_player" }, h("canvas", { ref: canvasRef, className: "SPR_canvasPlayer" }))
      );
    }

    function JobLogPanel({ job }) {
      const [level, setLevel] = React.useState("all");
      const [query, setQuery] = React.useState("");
      const raw = Array.isArray(job?.log) ? job.log : [];
      if (raw.length === 0) return null;

      const paired = [];
      let open = null;
      for (const entry of raw) {
        if (typeof entry?.message !== "string") continue;
        if (/^开始/.test(entry.message)) {
          // 上一条还没闭合就再来一条「开始」：把它单独留下，不要吞掉。
          if (open !== null) paired.push(open);
          open = entry;
          continue;
        }
        if (open !== null && /完成|失败/.test(entry.message)) {
          paired.push({
            at: entry.at,
            level: entry.level,
            message: T("{n0} → {n1}", { n0: open.message.replace(/^开始/, ""), n1: entry.message }),
            startedAt: open.at,
            elapsed: Math.max(0, entry.at - open.at)
          });
          open = null;
          continue;
        }
        paired.push(entry);
      }
      if (open !== null) paired.push(open);

      const wanted = level === "all" ? null : level === "warn" ? (e) => e.level !== "info" : (e) => e.level === "error";
      const filtered = paired.filter((entry) => (wanted === null || wanted(entry)) && (query === "" || String(entry.message).includes(query)));
      const entries = filtered.slice(-40).reverse();
      const counts = paired.reduce((acc, entry) => { acc[entry.level] = (acc[entry.level] ?? 0) + 1; return acc; }, {});
      const formatElapsed = (ms) => (ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`);

      return h(
        "div",
        { className: "SPR_log", "data-testid": "rig-log" },
        h("div", { className: "SPR_logHead" },
          h("span", { className: "SPR_fieldLabel" }, T("运行日志（{n0} 条{n1}）", { n0: paired.length, n1: counts.error ? T(" · {n0} 错误", { n0: counts.error }) : counts.warn ? T(" · {n0} 警告", { n0: counts.warn }) : "" })),
          h("span", { className: "SPR_logFilters" },
            h(Btn, { on: level === "all", "data-testid": "rig-log-all", onClick: () => setLevel("all") }, T("全部")),
            h(Btn, { on: level === "warn", "data-testid": "rig-log-warn", onClick: () => setLevel("warn") }, T("警告+（{n0}）", { n0: (counts.warn ?? 0) + (counts.error ?? 0) })),
            h(Btn, { on: level === "error", "data-testid": "rig-log-error", onClick: () => setLevel("error") }, T("错误（{n0}）", { n0: counts.error ?? 0 })),
            h("input", {
              className: "SPR_input",
              style: { width: 130 },
              placeholder: T("搜关键字…"),
              "data-testid": "rig-log-query",
              value: query,
              onChange: (event) => setQuery(event.target.value)
            })
          )
        ),
        entries.length === 0
          ? h("p", { className: "SPR_hint" }, filtered.length === 0 && paired.length > 0 ? T("当前筛选下没有日志。") : "")
          : h(
              "ul",
              { className: "SPR_logList" },
              entries.map((entry, index) =>
                h(
                  "li",
                  { key: `${entry.at}-${index}`, "data-level": entry.level },
                  h("span", { className: "SPR_logTime" }, new Date(entry.at).toLocaleTimeString("zh-CN", { hour12: false })),
                  h("span", null, entry.message),
                  entry.elapsed === undefined ? null : h("span", { className: "SPR_logElapsed" }, T("（{n0}）", { n0: formatElapsed(entry.elapsed) }))
                )
              )
            )
      );
    }

    function renderLog(project) {
      const entries = Array.isArray(project.log) ? project.log.slice(-40).reverse() : [];
      if (entries.length === 0) return null;
      return h(
        "div",
        { className: "SPR_log" },
        h("span", { className: "SPR_fieldLabel" }, T("运行日志")),
        h(
          "ul",
          { className: "SPR_logList" },
          entries.map((entry, index) =>
            h(
              "li",
              { key: index, "data-level": entry.level },
              h("span", { className: "SPR_logTime" }, new Date(entry.at).toLocaleTimeString("zh-CN", { hour12: false })),
              h("span", null, entry.message)
            )
          )
        )
      );
    }

    const RawModule = createSequenceModule({ React, h, T, useLocaleTick, useStudioIntent, msg, mergeDrafts, askNewName, Chip, StatusChip, Btn, NumField, useGlobalConfig, GlobalModelField, ZoomableImage, usePendingTasks, LoadingOverlay, MediaBox, BusyBtn, BusyBadge, ReviewModeBar, ApproveBtn, readFileBase64, UploadBox, KeyingFields, CopyIdButton, JobSidebar, K_SEQ_VIDEO, K_SEQ_FRAMES, K_SEQ_KEY, K_SEQ_COMPOSE, K_SEQ_UPLOAD, K_SEQ_CREATE, K_SEQ_POLL, RefRow, SequencePlayer, JobLogPanel , scheduler: gmmScheduler });

  // 错误隔离：整个模块挂一层边界（单模块故障只降级这一块）
  const Boundary = createFeatureBoundary({ name: "sequence" });

  /**
   * 根组件包一层 memo：面板因为**别的原因**重渲染时（别的模块的轮询 / 外壳状态变化），
   * 活动模块的根组件不会被无关 props 拖着重画。
   *
   * 比较器只看两个稳定引用（`api` / `studioCtx`）——面板交给模块的就这两样。
   * ⚠️ 自检桩（verify-feedback / verify-sfx-client / perf-baseline）的假 React 没有 `memo`
   * （与 createFeatureBoundary 见过的 `Component` 缺失同一类问题）：缺了就退化为原组件，
   * 否则产物一加载就抛 `React.memo is not a function`，所有自检一起红。
   */
  const MemoRaw = typeof React.memo === "function"
    ? React.memo(RawModule, (a: any, b: any) => a?.api === b?.api && a?.studioCtx === b?.studioCtx)
    : RawModule;

  return {
    K_SEQ_VIDEO, K_SEQ_FRAMES, K_SEQ_KEY, K_SEQ_COMPOSE, K_SEQ_UPLOAD, K_SEQ_CREATE, K_SEQ_POLL, RefRow, SequencePlayer, JobLogPanel, renderLog, SequenceModule: (props: any) => h(Boundary, null, h(MemoRaw, props)),
    SequenceModuleRaw: RawModule,
  };
}

