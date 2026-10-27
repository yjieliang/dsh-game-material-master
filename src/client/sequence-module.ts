/**
 * SequenceModule：面板实现。
 *
 * 拆成工厂函数的原因：面板要用宿主 `require("react")` 提供的 React，而 `require` 只在
 * `__ModuleLoader__.load` 的 factory 里可用 —— 模块顶层不能直接抓 React。所以共享物
 * （React / h / T / api 辅助 / 公共组件）由入口显式传进来，这里只构造一次组件。
 */
export interface SequenceRuntime {
  React: any;
  h: any;
  T: any;
  useLocaleTick: any;
  useStudioIntent: any;
  msg: any;
  mergeDrafts: any;
  askNewName: any;
  Chip: any;
  StatusChip: any;
  Btn: any;
  NumField: any;
  useGlobalConfig: any;
  GlobalModelField: any;
  ZoomableImage: any;
  usePendingTasks: any;
  LoadingOverlay: any;
  MediaBox: any;
  BusyBtn: any;
  BusyBadge: any;
  ReviewModeBar: any;
  ApproveBtn: any;
  readFileBase64: any;
  UploadBox: any;
  KeyingFields: any;
  CopyIdButton: any;
  JobSidebar: any;
  K_SEQ_VIDEO: any;
  K_SEQ_FRAMES: any;
  K_SEQ_KEY: any;
  K_SEQ_COMPOSE: any;
  K_SEQ_UPLOAD: any;
  K_SEQ_CREATE: any;
  K_SEQ_POLL: any;
  RefRow: any;
  SequencePlayer: any;
  JobLogPanel: any;
}

export function createSequenceModule(rt: SequenceRuntime) {
  const { React, h, T, useLocaleTick, useStudioIntent, msg, mergeDrafts, askNewName, Chip, StatusChip, Btn, NumField, useGlobalConfig, GlobalModelField, ZoomableImage, usePendingTasks, LoadingOverlay, MediaBox, BusyBtn, BusyBadge, ReviewModeBar, ApproveBtn, readFileBase64, UploadBox, KeyingFields, CopyIdButton, JobSidebar, K_SEQ_VIDEO, K_SEQ_FRAMES, K_SEQ_KEY, K_SEQ_COMPOSE, K_SEQ_UPLOAD, K_SEQ_CREATE, K_SEQ_POLL, RefRow, SequencePlayer, JobLogPanel } = rt;

function SequenceModule(props) {
  useLocaleTick();
  const api = props.api;
  const [jobs, setJobs] = React.useState([]);
  const [jobId, setJobId] = React.useState(null);
  const [job, setJob] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const [uploading, setUploading] = React.useState(false);
  const [promptDraft, setPromptDraft] = React.useState("");
  const [suffixDraft, setSuffixDraft] = React.useState("");
  const [settingsDraft, setSettingsDraft] = React.useState({});
  const [keyingDraft, setKeyingDraft] = React.useState({});
  const globalConfig = useGlobalConfig(api);
  // 「正在调用接口」的记账表：宿主状态没落盘时，遮罩靠它撑住。
  const tasks = usePendingTasks();
  // 深链接：切到某一个序列帧任务。
  const intent = useStudioIntent();
  /**
   * 上一次从宿主读到的草稿（连同任务 id）。
   *
   * 视频 / 抽帧 / 合成在跑时这里每 5 秒 `load()` 一次；无条件覆盖草稿的话，
   * 用户正在改提示词 / 时长时会被打回原形。判定见 `mergeDrafts`。
   */
  const loadedDrafts = React.useRef({ id: null, prompt: "", suffix: "", settings: {}, keying: {} });

  React.useEffect(() => {
    if (intent === null) return;
    if (intent.module === "sequence" && typeof intent.jobId === "string") setJobId(intent.jobId);
  }, [intent]);

  // 时长与分辨率档位跟着全局模型走（优云智算版 H3 多 1080P、可到 30 秒）。
  const modelCaps = globalConfig?.minimaxCapabilities ?? {
    protocol: "v2",
    resolutions: ["768P", "2K", "1080P", "480P"],
    durationMin: 1,
    durationMax: 30
  };
  const effectiveModel = globalConfig?.minimaxModel ?? settingsDraft.model ?? "";
  const effectiveResolution = modelCaps.resolutions.includes(settingsDraft.resolution)
    ? settingsDraft.resolution
    : modelCaps.resolutions[0];

  // 视频、抽帧、抠像/合成任一在跑就保持轮询。
  // 抽帧是后台任务，只刷新一次会一直停在「还没有序列帧」上（实测踩过）。
  const running =
    (job !== null &&
      (job.video?.status === "running" || job.frames?.status === "running" || job.sheet?.status === "running")) ||
    tasks.active;

  const refresh = React.useCallback(async () => {
    try {
      const result = await api.listSequenceJobs();
      setJobs(result.jobs ?? []);
      return result.jobs ?? [];
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
      return [];
    }
  }, [api]);

  const load = React.useCallback(async (id) => {
    if (id === null) return;
    try {
      const next = await api.getSequenceJob(id);
      const previous = loadedDrafts.current;
      const force = previous.id !== id;
      const settings = { ...(next.settings ?? {}) };
      const keying = { ...(next.keying ?? {}) };
      loadedDrafts.current = { id, prompt: next.prompt ?? "", suffix: next.suffix ?? "", settings, keying };
      setJob(next);
      setPromptDraft((current) => mergeDrafts(current, previous.prompt, next.prompt ?? "", force));
      setSuffixDraft((current) => mergeDrafts(current, previous.suffix, next.suffix ?? "", force));
      setSettingsDraft((current) => mergeDrafts(current, previous.settings, settings, force));
      setKeyingDraft((current) => mergeDrafts(current, previous.keying, keying, force));
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    }
  }, [api]);

  const jobIdRef = React.useRef(null);
  React.useEffect(() => {
    jobIdRef.current = jobId;
  }, [jobId]);

  React.useEffect(() => {
    void (async () => {
      const list = await refresh();
      if (list.length > 0) setJobId((current) => current ?? list[0].id);
    })();
  }, [refresh]);

  React.useEffect(() => {
    if (jobId !== null) void load(jobId);
  }, [jobId, load]);

  React.useEffect(() => {
    if (!running || jobId === null) return undefined;
    const timer = setInterval(() => void load(jobId), 5000);
    return () => clearInterval(timer);
  }, [running, jobId, load]);

  /**
   * 跑一次远程调用。`feedback`（可选）给出 pending 的 key 与文案，
   * 界面据此在对应预览上盖 loading、把按钮变成转圈。
   */
  const run = async (fn, okText = undefined, feedback = undefined) => {
    const invoke = async () => {
      try {
        const value = await fn();
        if (okText !== undefined) setNotice({ kind: "ok", text: okText });
        if (jobId !== null) await load(jobId);
        await refresh();
        return value;
      } catch (error) {
        setNotice({ kind: "error", text: msg(error) });
        return undefined;
      }
    };
    if (feedback === undefined) return invoke();
    return tasks.run(feedback.key, feedback.label, invoke);
  };

  /**
   * 启动一个宿主侧「后台任务」（提交视频 / 抽帧 / 抠像 / 合成）。
   * 这些 RPC 是异步启动的——返回时任务状态可能还没落盘，只刷新一次就会
   * 一直停在上一次的结果上（实测：抽帧完成后界面仍显示「还没有序列帧」）。
   * 所以启动后再补几次刷新，直到宿主把 running / ready 写进任务。
   */
  const kickAndWatch = async (fn, okText = undefined, feedback = undefined) => {
    const id = job.id;
    const value = await run(fn, okText, feedback);
    for (const delay of [1200, 3000, 5500, 9000]) {
      setTimeout(() => {
        if (jobIdRef.current === id) void load(id);
      }, delay);
    }
    return value;
  };

  const create = async () => {
    const name = askNewName(T("新序列帧任务的名字"), T("序列帧 {n0}", { n0: new Date().toLocaleString("zh-CN", { hour12: false }) }));
    if (name === null) return;
    await run(async () => {
      const created = await api.createSequenceJob({ name });
      await refresh();
      setJobId(created.jobId);
    }, T("已新建序列帧任务"), { key: K_SEQ_CREATE, label: T("正在新建任务…") });
  };

  const saveJob = (patch) => run(() => api.saveSequenceJob({ jobId: job.id, ...patch }), undefined);

  const del = async () => {
    if (job === null) return;
    if (typeof window !== "undefined" && !window.confirm(T("删除任务「{n0}」？目录会被整个移除。", { n0: job.name }))) return;
    await run(async () => {
      await api.deleteSequenceJob({ jobId: job.id });
      const list = await refresh();
      setJobId(list.length > 0 ? list[0].id : null);
      if (list.length === 0) setJob(null);
    }, T("已删除"));
  };

  const uploadRef = async (files, kind) => {
    setUploading(true);
    await tasks.run(K_SEQ_UPLOAD, T("正在上传 {n0} 个文件…", { n0: files.length }), async () => {
      try {
        for (const file of files) {
          const data = await readFileBase64(file);
          await api.uploadSequenceRef({ jobId: job.id, kind, name: file.name, data });
        }
        await load(job.id);
      } catch (error) {
        setNotice({ kind: "error", text: msg(error) });
      } finally {
        setUploading(false);
      }
    });
  };

  const frameUrls = React.useMemo(() => {
    if (job === null) return [];
    const list = (job.frames?.keyed ?? []).length > 0 ? job.frames.keyed : job.frames?.files ?? [];
    return list.map((file) => `${job.assetBase}${file}?v=${job.frames?.updatedAt ?? job.updatedAt}`);
  }, [job]);

  // ── 「正在调用接口」的派生状态 ──────────────────────────────────────
  // 三段各有一块要盖遮罩的预览区：视频、序列帧/条图、合成结果。
  const videoBusy = job?.video?.status === "running" || tasks.has(K_SEQ_VIDEO);
  const videoText = tasks.label(K_SEQ_VIDEO) ?? T("视频生成中…（H3 通常 1~6 分钟，可以离开本页）");
  const framesBusy = job?.frames?.status === "running" || tasks.has(K_SEQ_FRAMES);
  const framesText = tasks.label(K_SEQ_FRAMES) ?? T("正在抽帧…");
  const composing =
    job?.sheet?.status === "running" || tasks.has(K_SEQ_KEY) || tasks.has(K_SEQ_COMPOSE);
  const composeText = tasks.label(K_SEQ_KEY) ?? tasks.label(K_SEQ_COMPOSE) ?? T("正在抠像并合成条图…");

  return h(
    React.Fragment,
    null,
    h(
      "div",
      { className: "SPR_body" },
      h(JobSidebar, {
        title: T("序列帧任务"),
        items: jobs,
        activeId: jobId,
        onSelect: setJobId,
        onCreate: create,
        renderMeta: (item) => T("{n0} {n1} {n2}", { n0: item.videoReady ? T("视频✓") : T("视频·"), n1: item.frameReady ? T("帧✓") : T("帧·"), n2: item.sheetReady ? T("合成✓") : T("合成·") })
      }),
      h(
        "div",
        { className: "SPR_main" },
        notice !== null
          ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text,
              h("span", { style: { marginLeft: 10 } }, h("button", { type: "button", className: "SPR_miniBtn", onClick: () => setNotice(null) }, T("关闭"))))
          : null,
        h(
          "div",
          { className: "SPR_toolbar" },
          h(BusyBtn, { onClick: create, primary: true, busy: tasks.has(K_SEQ_CREATE), busyText: T("正在新建…") }, T("新建任务")),
          job !== null ? h(Btn, { onClick: del, danger: true }, T("删除任务")) : null,
          job !== null ? h(CopyIdButton, { id: job.id }) : null,
          h(BusyBadge, { show: tasks.active, text: tasks.firstLabel ?? T("正在调用接口…") })
        ),
        job === null
          ? h("p", { className: "SPR_empty" }, T("请选择或新建一个序列帧任务"))
          : h(
              React.Fragment,
              null,
              h(
                "div",
                { className: "SPR_card" },
                h("div", { className: "SPR_cardHead" }, h("h3", null, T("① 视频输入"))),
                h("p", { className: "SPR_hint" }, T("平台规定两种模式互斥：首尾帧模式以一张图作为起始画面；多模态参考模式用参考图+参考视频来约束风格与动作。") ),
                h(
                  "div",
                  { className: "SPR_toolbar" },
                  h(
                    "select",
                    {
                      className: "SPR_input",
                      style: { width: 260 },
                      value: job.mode,
                      onChange: (event) => void run(() => api.saveSequenceJob({ jobId: job.id, mode: event.target.value }), undefined)
                    },
                    h("option", { value: "frames" }, T("首尾帧模式（上传首帧图）")),
                    h("option", { value: "reference" }, T("多模态参考模式（参考图 / 参考视频）"))
                  )
                ),
                job.mode === "frames"
                  ? h(
                      React.Fragment,
                      null,
                      h("span", { className: "SPR_fieldLabel" }, T("首帧图（必填）")),
                      h(RefRow, { job, frame: job.refs.firstFrame, kind: "firstFrame", api, reload: load, setNotice }),
                      h("span", { className: "SPR_fieldLabel" }, T("尾帧图（选填）")),
                      h(RefRow, { job, frame: job.refs.lastFrame, kind: "lastFrame", api, reload: load, setNotice }),
                      h(UploadBox, { label: T("把首帧图拖到这里"), accept: "image/*", busy: uploading || tasks.has(K_SEQ_UPLOAD), onFiles: (files) => void uploadRef(files, "firstFrame") })
                    )
                  : h(
                      React.Fragment,
                      null,
                      h("span", { className: "SPR_fieldLabel" }, T("参考图（{n0}/9）", { n0: (job.refs.referenceImages ?? []).length })),
                      h(
                        "div",
                        { className: "SPR_grid" },
                        (job.refs.referenceImages ?? []).map((ref) =>
                          h(
                            "div",
                            { key: ref.file, className: "SPR_node" },
                            h("img", { className: "SPR_thumb", src: `${job.assetBase}${ref.file}?v=${job.updatedAt}`, alt: ref.name }),
                            h("div", { className: "SPR_btnRow" }, h(Btn, { danger: true, onClick: () => void run(() => api.removeSequenceRef({ jobId: job.id, kind: "referenceImage", file: ref.file }), T("已移除")) }, T("移除")))
                          )
                        )
                      ),
                      h(UploadBox, { label: T("把参考图拖到这里"), accept: "image/*", multiple: true, busy: uploading || tasks.has(K_SEQ_UPLOAD), onFiles: (files) => void uploadRef(files, "referenceImage") }),
                      h("span", { className: "SPR_fieldLabel" }, T("参考视频（{n0}/3，每段 2~15 秒，单文件 ≤ 40MB）", { n0: (job.refs.referenceVideos ?? []).length })),
                      h(
                        "div",
                        { className: "SPR_toolbar" },
                        (job.refs.referenceVideos ?? []).map((ref) =>
                          h(Btn, { key: ref.file, danger: true, onClick: () => void run(() => api.removeSequenceRef({ jobId: job.id, kind: "referenceVideo", file: ref.file }), T("已移除")) }, T("移除 {n0}", { n0: ref.name }))
                        )
                      ),
                      h(UploadBox, { label: T("把参考视频拖到这里"), accept: "video/*", multiple: true, busy: uploading || tasks.has(K_SEQ_UPLOAD), onFiles: (files) => void uploadRef(files, "referenceVideo") })
                    )
              ),
              h(
                "div",
                { className: "SPR_card" },
                h("div", { className: "SPR_cardHead" }, h("h3", null, T("② 提示词与参数"))),
                h("textarea", {
                  className: "SPR_area",
                  value: promptDraft,
                  onChange: (event) => setPromptDraft(event.target.value),
                  onBlur: () => { if (promptDraft !== (job.prompt ?? "")) void saveJob({ prompt: promptDraft }); }
                }),
                h("textarea", {
                  className: "SPR_area",
                  style: { minHeight: 60 },
                  placeholder: T("统一附加提示词（可留空）"),
                  value: suffixDraft,
                  onChange: (event) => setSuffixDraft(event.target.value),
                  onBlur: () => { if (suffixDraft !== (job.suffix ?? "")) void saveJob({ suffix: suffixDraft }); }
                }),
                h(
                  "div",
                  { className: "SPR_fields" },
                  h(GlobalModelField, { label: T("视频模型"), value: effectiveModel }),
                  h(NumField, { label: T("时长（秒，{n0}~{n1}）", { n0: modelCaps.durationMin, n1: modelCaps.durationMax }), value: settingsDraft.duration ?? 5, min: modelCaps.durationMin, max: modelCaps.durationMax, onChange: (v) => { setSettingsDraft({ ...settingsDraft, duration: v }); void saveJob({ settings: { ...settingsDraft, duration: v } }); } }),
                  h(
                    "label",
                    { className: "SPR_field" },
                    h("span", { className: "SPR_fieldLabel" }, T("分辨率")),
                    h(
                      "select",
                      { className: "SPR_input", value: effectiveResolution, onChange: (event) => { setSettingsDraft({ ...settingsDraft, resolution: event.target.value }); void saveJob({ settings: { ...settingsDraft, resolution: event.target.value } }); } },
                      modelCaps.resolutions.map((value) => h("option", { key: value, value }, value))
                    )
                  )
                ),
                h(
                  "div",
                  { className: "SPR_toolbar" },
                  h(
                    BusyBtn,
                    {
                      primary: true,
                      busy: tasks.has(K_SEQ_VIDEO),
                      busyText: T("正在提交视频任务…"),
                      disabled: promptDraft.trim() === "" || tasks.has(K_SEQ_VIDEO),
                      onClick: () =>
                        void kickAndWatch(() => api.runSequenceVideo({ jobId: job.id }), T("已提交视频任务，可离开本页"), {
                          key: K_SEQ_VIDEO,
                          label: T("正在提交视频任务…")
                        })
                    },
                    job.video?.status === "ready" ? T("重新生成视频") : T("生成视频")
                  ),
                  h(
                    BusyBtn,
                    {
                      busy: tasks.has(K_SEQ_POLL),
                      busyText: T("正在查询…"),
                      onClick: () =>
                        void kickAndWatch(
                          () => run(() => api.pollSequenceVideo({ jobId: job.id })),
                          undefined,
                          { key: K_SEQ_POLL, label: T("正在查询远端进度…") }
                        )
                    },
                    T("立即刷新进度")
                  ),
                  h(Btn, { danger: true, disabled: videoBusy, onClick: () => void run(() => api.clearSequenceVideo({ jobId: job.id }), T("已清空视频与帧")) }, T("清空视频重来")),
                  h("span", { className: "SPR_refRow" }, T("H3 768P 按 0.5 元/秒刊例计费"))
                ),
                h(
                  "div",
                  { className: "SPR_toolbar" },
                  h("span", { className: "SPR_refRow" }, T("状态：{n0} {n1} {n2}", { n0: job.video?.status ?? "empty", n1: job.video?.remoteStatus ?? "", n2: job.video?.error ?? "" })),
                  h(BusyBadge, { show: videoBusy, text: videoText })
                ),
                h(
                  "div",
                  { style: { position: "relative", minHeight: job.video?.file === undefined ? 90 : undefined } },
                  job.video?.file !== undefined
                    ? h(
                        MediaBox,
                        { overlay: videoBusy, text: videoText },
                        h("video", { className: "SPR_video", src: `${job.assetBase}${job.video.file}?v=${job.video.updatedAt}`, controls: true, preload: "metadata" })
                      )
                    : videoBusy
                      ? h("div", { className: "SPR_thumbEmpty", style: { minHeight: 90 } }, videoText)
                      : null,
                  job.video?.file === undefined ? h(LoadingOverlay, { show: videoBusy, text: videoText }) : null
                )
              ),
              h(
                "div",
                { className: "SPR_card" },
                h("div", { className: "SPR_cardHead" }, h("h3", null, T("③ 序列帧提取"))),
                h(
                  "div",
                  { className: "SPR_fields" },
                  h(NumField, { label: T("提取张数"), value: settingsDraft.frameCount ?? 8, min: 1, max: 64, onChange: (v) => { setSettingsDraft({ ...settingsDraft, frameCount: v }); void saveJob({ settings: { ...settingsDraft, frameCount: v } }); } }),
                  h(NumField, { label: T("抽帧工作尺寸（长边 px）"), value: settingsDraft.longEdge ?? 768, min: 128, max: 2048, onChange: (v) => { setSettingsDraft({ ...settingsDraft, longEdge: v }); void saveJob({ settings: { ...settingsDraft, longEdge: v } }); } }),
                  h(NumField, { label: T("单格宽（px）"), value: settingsDraft.cellWidth ?? 256, min: 16, max: 2048, onChange: (v) => { setSettingsDraft({ ...settingsDraft, cellWidth: v }); void saveJob({ settings: { ...settingsDraft, cellWidth: v } }); } }),
                  h(NumField, { label: T("单格高（px）"), value: settingsDraft.cellHeight ?? 256, min: 16, max: 2048, onChange: (v) => { setSettingsDraft({ ...settingsDraft, cellHeight: v }); void saveJob({ settings: { ...settingsDraft, cellHeight: v } }); } }),
                  h(NumField, { label: T("像素块边长（0/1 = 关闭）"), value: settingsDraft.pixelSize ?? 0, min: 0, max: 32, onChange: (v) => { setSettingsDraft({ ...settingsDraft, pixelSize: v }); void saveJob({ settings: { ...settingsDraft, pixelSize: v } }); } })
                ),
                h(
                  "div",
                  { className: "SPR_toolbar" },
                  h(
                    BusyBtn,
                    {
                      primary: true,
                      busy: tasks.has(K_SEQ_FRAMES),
                      busyText: T("正在抽帧…"),
                      disabled: job.video?.file === undefined || framesBusy,
                      onClick: () =>
                        void kickAndWatch(() => api.runSequenceFrames({ jobId: job.id }), T("已开始抽帧"), {
                          key: K_SEQ_FRAMES,
                          label: T("正在抽帧…")
                        })
                    },
                    T("按当前张数抽帧（{n0} 张）", { n0: settingsDraft.frameCount ?? 8 })
                  ),
                  job.frames?.stale === true ? h(Chip, { kind: "stale", text: T("参数已变，需重抽") }) : null,
                  h(BusyBadge, { show: framesBusy, text: framesText }),
                  h("span", { className: "SPR_refRow" }, job.frames?.duration !== undefined ? T("视频时长 {n0} 秒 · {n1} 帧", { n0: job.frames.duration.toFixed(2), n1: job.frames.files.length }) : "")
                )
              ),
              h(
                "div",
                { className: "SPR_card" },
                h("div", { className: "SPR_cardHead" }, h("h3", null, T("④ 绿幕抠像与合成"))),
                h(KeyingFields, { draft: keyingDraft, onChange: (patch) => { const next = { ...keyingDraft, ...patch }; setKeyingDraft(next); void saveJob({ keying: patch }); } }),
                h(
                  "div",
                  { className: "SPR_toolbar" },
                  h(
                    BusyBtn,
                    {
                      busy: tasks.has(K_SEQ_KEY),
                      busyText: T("正在重新抠像…"),
                      disabled: framesBusy,
                      onClick: () =>
                        void kickAndWatch(() => api.keySequenceFrames({ jobId: job.id }), T("已开始重新抠像"), {
                          key: K_SEQ_KEY,
                          label: T("正在重新抠像…")
                        })
                    },
                    T("重新抠像")
                  ),
                  h(
                    BusyBtn,
                    {
                      busy: tasks.has(K_SEQ_COMPOSE),
                      busyText: T("正在合成条图…"),
                      disabled: framesBusy,
                      onClick: () =>
                        void kickAndWatch(() => api.composeSequence({ jobId: job.id }), T("已合成"), {
                          key: K_SEQ_COMPOSE,
                          label: T("正在合成横向条图…")
                        })
                    },
                    T("合成横向条图")
                  ),
                  job.sheet?.file !== undefined
                    ? h("a", { className: "SPR_btn", href: `${job.assetBase}${job.sheet.file}?v=${job.sheet.updatedAt}`, download: `${job.name}-strip.png`, style: { textDecoration: "none" } }, T("下载条图"))
                    : null
                ),
                h(
                  "div",
                  { style: { position: "relative" } },
                  frameUrls.length === 0
                    ? h("p", { className: "SPR_empty" }, framesBusy ? T("正在处理序列帧…") : T("还没有序列帧"))
                    : h(SequencePlayer, { urls: frameUrls }),
                  h(LoadingOverlay, { show: framesBusy, text: framesText })
                ),
                job.sheet?.file !== undefined
                  ? h(
                      "div",
                      { className: "SPR_sheetWrap", style: { position: "relative" } },
                      h("img", { className: "SPR_sheet", src: `${job.assetBase}${job.sheet.file}?v=${job.sheet.updatedAt}`, alt: T("序列帧条图"), style: { visibility: composing ? "hidden" : undefined } }),
                      h(LoadingOverlay, { show: composing, text: composeText })
                    )
                  : null,
                frameUrls.length === 0
                  ? null
                  : h(
                      "div",
                      { className: "SPR_frames" },
                      frameUrls.map((url, index) =>
                        h(ZoomableImage, {
                          key: index,
                          className: "SPR_frame",
                          src: url,
                          alt: T("第 {n0} 帧", { n0: index + 1 }),
                          caption: T("第 {n0} / {n1} 帧（点「×」/ 背景 / Esc 关闭）", { n0: index + 1, n1: frameUrls.length })
                        })
                      )
                    )
              ),
              h(
                "div",
                { className: "SPR_card" },
                h("div", { className: "SPR_cardHead" }, h("h3", null, T("⑤ 验收"))),
                h("p", { className: "SPR_hint" }, T("三步各自打「通过」。对话里的 agent 读写同一份标记：选「每一步人工审核」时，它会等你通过才继续。") ),
                h(ReviewModeBar, { api, module: "sequence", id: job.id, mode: job.reviewMode, onChanged: () => void load(job.id) }),
                [
                  { step: "video", title: T("① 生成视频"), node: job.video },
                  { step: "frames", title: T("② 抽帧 + 抠像"), node: job.frames },
                  { step: "sheet", title: T("③ 横向条图"), node: job.sheet }
                ].map((entry) =>
                  h(
                    "div",
                    { key: entry.step, className: "SPR_toolbar", style: { margin: "4px 0" } },
                    h("span", { className: "SPR_nodeTitle", style: { minWidth: 120 } }, entry.title),
                    h(StatusChip, { node: entry.node }),
                    h(ApproveBtn, {
                      approved: entry.node?.approved === true,
                      disabled: entry.node?.status !== "ready",
                      onToggle: () =>
                        void run(
                          () => api.saveSequenceJob({ jobId: job.id, step: entry.step, approved: entry.node?.approved !== true }),
                          entry.node?.approved === true ? T("已取消通过") : T("已标记通过")
                        )
                    })
                  )
                )
              ),
              h(JobLogPanel, { job })
            )
      )
    ),
  );
}

  return SequenceModule;
}
