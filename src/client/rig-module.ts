/**
 * RigModule：面板实现。
 *
 * 拆成工厂函数的原因：面板要用宿主 `require("react")` 提供的 React，而 `require` 只在
 * `__ModuleLoader__.load` 的 factory 里可用 —— 模块顶层不能直接抓 React。所以共享物
 * （React / h / T / api 辅助 / 公共组件）由入口显式传进来，这里只构造一次组件。
 */

import { markRender } from "./platform/perf.js";

export interface RigRuntime {
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
  usePendingTasks: any;
  LoadingOverlay: any;
  BusyBtn: any;
  BusyBadge: any;
  ReviewModeBar: any;
  readFileBase64: any;
  UploadBox: any;
  CopyIdButton: any;
  JobLogPanel: any;
  RIG_ANIMATIONS: any;
  RIG_STAGES: any;
  K_RIG_JOB: any;
  K_RIG_SHEET: any;
  K_RIG_SEGMENT: any;
  K_RIG_QA: any;
  K_RIG_LAYOUT: any;
  K_RIG_BONES: any;
  K_RIG_ATLAS: any;
  K_RIG_CREATE: any;
  RIG_BUSY_LABEL: any;
  rigStageOf: any;
  RigPartCard: any;
  RigSemanticsPanel: any;
  RigBoneEditor: any;
  RigAnimationPanel: any;
  RigTimelineEditor: any;
  RigQaPanel: any;
  RigConstraintPanel: any;
  RigMeshPanel: any;
  RigPathPanel: any;
  RigTexturePanel: any;
  RigAssemblyEditor: any;
  experimentalGateMuted: any;
  ExperimentalBar: any;
  RigExperimentalDialog: any;
  /** 集中轮询调度器（platform/scheduler；组合根注入） */
  scheduler: any;
}

export function createRigModule(rt: RigRuntime) {
  const { React, h, T, useLocaleTick, useStudioIntent, msg, mergeDrafts, askNewName, Chip, StatusChip, Btn, NumField, useGlobalConfig, usePendingTasks, LoadingOverlay, BusyBtn, BusyBadge, ReviewModeBar, readFileBase64, UploadBox, CopyIdButton, JobLogPanel, RIG_ANIMATIONS, RIG_STAGES, K_RIG_JOB, K_RIG_SHEET, K_RIG_SEGMENT, K_RIG_QA, K_RIG_LAYOUT, K_RIG_BONES, K_RIG_ATLAS, K_RIG_CREATE, RIG_BUSY_LABEL, rigStageOf, RigPartCard, RigSemanticsPanel, RigBoneEditor, RigAnimationPanel, RigTimelineEditor, RigQaPanel, RigConstraintPanel, RigMeshPanel, RigPathPanel, RigTexturePanel, RigAssemblyEditor, experimentalGateMuted, ExperimentalBar, RigExperimentalDialog, scheduler } = rt;

function RigModule(props) {
  markRender("RigModule");
  useLocaleTick();
  const api = props.api;
  const [jobs, setJobs] = React.useState([]);
  const [jobId, setJobId] = React.useState(null);
  const [job, setJob] = React.useState(null);
  const [stage, setStage] = React.useState("parts");
  const [notice, setNotice] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  const [showReference, setShowReference] = React.useState(true);
  // 实验性进入提示：RigModule 恰好就是「进入了模块④」，页签切换和深链接都会
  // 重新挂载它，所以放在这里等于「每次进入都弹」；勾过「本次会话不再提示」就不弹。
  const [gateOpen, setGateOpen] = React.useState(experimentalGateMuted.rig !== true);
  const closeGate = React.useCallback(() => setGateOpen(false), []);
  const [anim, setAnim] = React.useState("idle");
  const [promptDraft, setPromptDraft] = React.useState("");
  const [suffixDraft, setSuffixDraft] = React.useState("");
  const [settingsDraft, setSettingsDraft] = React.useState({});
  const globalConfig = useGlobalConfig(api);
  const tasks = usePendingTasks();
  const intent = useStudioIntent();
  /**
   * 上一次从宿主读到的草稿（连同任务 id）。
   *
   * 有阶段在跑时这里每 2.5 秒 `load()` 一次；无条件覆盖草稿的话，用户正在改
   * 摊平提示词 / 网格参数时会被打回原形。判定见 `mergeDrafts`。
   */
  const loadedDrafts = React.useRef({ id: null, prompt: "", suffix: "", settings: {} });

  React.useEffect(() => {
    if (intent === null) return;
    if (intent.module === "rig" && typeof intent.jobId === "string") setJobId(intent.jobId);
    if (typeof intent.stage === "string" && RIG_STAGES.some((entry) => entry.key === intent.stage)) setStage(intent.stage);
  }, [intent]);

  const stageEntry = job === null ? null : rigStageOf(job, stage);
  const stageBusy = stageEntry !== null && stageEntry.status === "running";
  const busy = (job !== null && (job.stages ?? []).some((entry) => entry.status === "running")) || tasks.active;
  const keyBusy = (key) => tasks.has(key);
  const PART_K = (name, action) => `rig:${action}:${name}`;

  /**
   * 刚提交过宿主任务 → 接下来这几秒保持轮询（时间戳，0 = 不额外轮询）。
   *
   * 为什么需要：`run()` 里的 `tasks.active` 在 `await fn()` 返回时就变回 false，
   * 而 `kick()` 是「登记后台任务后立即返回」——宿主写 `running` 落盘、以及本地任务
   * （推骨骼 / 装配 / 打图集，通常不到 1 秒）跑完，都发生在这一次 `load()` **之后**。
   * 于是 `busy` 一直是 false，轮询不启动，界面停在旧状态：表现为「点完按钮没反应、
   * 下一步的按钮还是灰的」，用户只能手动刷新页面（实测踩过：骨骼明明建好了，
   * ③ 还是没打勾）。所以提交成功后给一个短暂的「沉降窗口」。
   */
  const [settleUntil, setSettleUntil] = React.useState(0);

  const refresh = React.useCallback(async () => {
    if (api === undefined) return [];
    try {
      const result = await api.listRigJobs();
      const list = result.jobs ?? [];
      setJobs(list);
      return list;
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
      return [];
    }
  }, [api]);

  const load = React.useCallback(
    async (id) => {
      if (api === undefined || id === null) return;
      try {
        const next = await api.getRigJob({ jobId: id });
        // 宿主半区是进程启动时冻结的模块图：如果它还是旧版本，返回的是原始任务
        // 而不是统一视图，界面会以各种「读不到字段」的形式坏掉。与其让用户对着
        // 一个灰按钮猜，不如直说。
        if (next !== null && next !== undefined && next.sourceUrl === undefined && (next.stages ?? []).every((entry) => entry.stage === undefined)) {
          setNotice({ kind: "error", text: T("宿主半区版本过旧（缺少骨骼动画模块的字段）。请重启 DSH Desktop 后重试。") });
          setJob(null);
          return;
        }
        const previous = loadedDrafts.current;
        const force = previous.id !== id;
        const prompt = next.prompts?.sheet ?? "";
        const suffix = next.prompts?.suffix ?? "";
        const settings = { ...(next.settings ?? {}) };
        loadedDrafts.current = { id, prompt, suffix, settings };
        setJob(next);
        setPromptDraft((current) => mergeDrafts(current, previous.prompt, prompt, force));
        setSuffixDraft((current) => mergeDrafts(current, previous.suffix, suffix, force));
        setSettingsDraft((current) => mergeDrafts(current, previous.settings, settings, force));
        setSelected((current) => (current !== null && (next.parts ?? []).some((part) => part.name === current) ? current : null));
      } catch (error) {
        setNotice({ kind: "error", text: msg(error) });
      }
    },
    [api]
  );

  React.useEffect(() => {
    void (async () => {
      const list = await refresh();
      setLoading(false);
      if (list.length > 0) setJobId((current) => current ?? list[0].id);
    })();
  }, [refresh]);

  React.useEffect(() => {
    if (jobId !== null) void load(jobId);
  }, [jobId, load]);

  React.useEffect(() => {
    if (jobId === null) return undefined;
    // 有任务在跑，或刚提交完还在「沉降窗口」里，都要继续刷新。
    // 走集中调度器：同 key 去重、失败退避、页面隐藏暂停。
    if (!busy && Date.now() >= settleUntil) return undefined;
    const handle = scheduler.watch({
      key: "rig:" + String(jobId),
      intervalMs: 2500,
      immediate: false,
      run: () => load(jobId)
    });
    return () => handle.cancel();
  }, [busy, jobId, load, settleUntil, scheduler]);

  const run = async (fn, okText = undefined, feedback = undefined) => {
    const invoke = async () => {
      try {
        const value = await fn();
        if (okText !== undefined) setNotice({ kind: "ok", text: okText });
        // 提交成功就开一个沉降窗口：宿主可能还没把任务登记成 `running`
        // （本地任务甚至可能已经跑完），只 load 一次会读到「什么都没发生」。
        setSettleUntil(Date.now() + 6000);
        if (jobId !== null) await load(jobId);
        await refresh();
        return value;
      } catch (error) {
        setNotice({ kind: "error", text: msg(error) });
        return undefined;
      }
    };
    if (feedback === undefined) return invoke();
    const label = RIG_BUSY_LABEL[feedback] ?? (feedback.startsWith("rig:relayout") ? T("正在重新定位…") : T("正在处理…"));
    return tasks.run(feedback, label, invoke);
  };

  const createJob = async () => {
    const name = askNewName(T("新骨骼动画任务的名字"), T("新骨骼动画任务"));
    if (name === null) return;
    await run(
      async () => {
        const created = await api.createRigJob({ name });
        await refresh();
        setJobId(created.jobId);
        setStage("parts");
        return created;
      },
      T("已新建骨骼动画任务"),
      K_RIG_CREATE
    );
  };

  const deleteJob = async () => {
    if (job === null) return;
    if (typeof window !== "undefined" && !window.confirm(T("删除任务「{n0}」？产物文件会一并删除。", { n0: job.name }))) return;
    await run(async () => {
      await api.deleteRigJob({ jobId: job.id });
      const list = await refresh();
      setJobId(list.length > 0 ? list[0].id : null);
      if (list.length === 0) setJob(null);
    });
  };

  const renameJob = async () => {
    if (job === null) return;
    const next = typeof window === "undefined" ? null : window.prompt(T("新的任务名"), job.name);
    if (next === null || next.trim() === "") return;
    await run(() => api.saveRigJob({ jobId: job.id, name: next.trim() }), T("已重命名"));
  };

  const uploadSource = async (files) => {
    const file = files[0];
    if (file === undefined || job === null) return;
    setUploading(true);
    try {
      const data = await readFileBase64(file);
      await api.uploadRigSource({ jobId: job.id, name: file.name, data });
      setNotice({ kind: "ok", text: T("已上传参考图：{n0}", { n0: file.name }) });
      await load(job.id);
      await refresh();
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setUploading(false);
    }
  };

  const uploadParts = async (files) => {
    if (job === null) return;
    setUploading(true);
    try {
      for (const file of files) {
        const data = await readFileBase64(file);
        await api.uploadRigPart({ jobId: job.id, name: file.name, data });
      }
      setNotice({ kind: "ok", text: T("已上传 {n0} 个部件（文件名即部件名）", { n0: files.length }) });
      await load(job.id);
      await refresh();
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setUploading(false);
    }
  };

  const saveSettings = () =>
    run(
      () => api.saveRigJob({ jobId: job.id, sheetPrompt: promptDraft, suffix: suffixDraft, settings: settingsDraft }),
      T("已保存提示词与参数")
    );

  const selectedItem = job !== null && selected !== null ? (job.layout?.items ?? {})[selected] : undefined;

  if (api === undefined) {
    return h("div", { className: "SPR_rigPanel" }, h("p", { className: "SPR_hint" }, T("远程服务尚未挂载完成，请稍候…")));
  }

  const headerButtons = h(
    React.Fragment,
    null,
    h(Btn, { onClick: () => void refresh(), disabled: loading || keyBusy(K_RIG_JOB) }, T("刷新列表")),
    job !== null ? h(Btn, { onClick: () => void renameJob() }, T("重命名")) : null,
    job !== null ? h(Btn, { onClick: () => void deleteJob(), danger: true }, T("删除任务")) : null,
    h(BusyBtn, { onClick: () => void createJob(), busy: keyBusy(K_RIG_CREATE), busyText: T("创建中…"), primary: true }, T("新建任务"))
  );

  return h(
    "div",
    { className: "SPR_rigPanel" },
    // 弹窗是 position:fixed，放在这个滚动容器里也照样盖住整个工作台，
    // 不必为此把 RigModule 再包一层 Fragment。
    gateOpen ? h(RigExperimentalDialog, { onClose: closeGate }) : null,
    h(ExperimentalBar, null),
    h(
      "div",
      { className: "SPR_toolbar" },
      h("span", { className: "SPR_refRow" }, T("生图模型")),
      h("span", { className: "SPR_badge" }, globalConfig?.imageModel ?? globalConfig?.arkModel ?? job?.settings?.model ?? T("未配置")),
      h("span", { className: "SPR_refRow" }, T("（模型在「设置 → 游戏素材大师」里改）")),
      h("span", { className: "SPR_spacer" }),
      headerButtons
    ),
    notice !== null
      ? h(
          "div",
          { className: "SPR_notice", "data-kind": notice.kind === "error" ? "error" : "info" },
          notice.text,
          h(Btn, { onClick: () => setNotice(null) }, T("关闭"))
        )
      : null,
    h(
      "div",
      { className: "SPR_modules" },
      RIG_STAGES.map((entry) => {
        const info = job === null ? { status: "empty" } : rigStageOf(job, entry.key);
        const done = info.status === "ready";
        return h(
          "button",
          {
            key: entry.key,
            type: "button",
            className: "SPR_module",
            "data-active": stage === entry.key ? "true" : "false",
            onClick: () => setStage(entry.key)
          },
          h("span", { className: "SPR_moduleTitle" }, `${done ? "✓ " : ""}${entry.title}`),
          h("span", { className: "SPR_moduleHint" }, info.status === "running" ? T("进行中…") : entry.hint)
        );
      })
    ),
    jobs.length === 0
      ? h("p", { className: "SPR_hint" }, loading ? T("正在读取任务…") : T("还没有骨骼动画任务，点右上角「新建任务」开始。"))
      : h(
          React.Fragment,
          null,
          h(
            "div",
            { className: "SPR_toolbar", style: { flexWrap: "wrap" } },
            h("span", { className: "SPR_refRow" }, T("任务")),
            h(
              "select",
              { className: "SPR_input", style: { width: 260 }, value: jobId ?? "", onChange: (event) => setJobId(event.target.value) },
              jobs.map((entry) => h("option", { key: entry.id, value: entry.id }, T("{n0}（部件 {n1}）", { n0: entry.name, n1: entry.partCount })))
            ),
            job !== null ? h("span", { className: "SPR_badge" }, job.id) : null,
            job !== null ? h(CopyIdButton, { id: job.id }) : null,
            stageBusy ? h(BusyBadge, { show: true, text: T("本阶段进行中…") }) : null
          ),
          job === null
            ? null
            : h(
                React.Fragment,
                null,
                h(ReviewModeBar, { api, module: "rig", id: job.id, mode: job.reviewMode, onChanged: () => void load(job.id) }),
                h(RigQaPanel, { job, api, run, busy, activeKey: K_RIG_QA }),

                // ── 第 0 步：角色参考图 ────────────────────────────────
                h(
                  "div",
                  { className: "SPR_rigStage" },
                  h(
                    "div",
                    { className: "SPR_rigStageHead" },
                    h("span", { className: "SPR_rigStageTitle" }, T("角色参考图")),
                    h("span", { className: "SPR_rigStageHint" }, T("拆件、装配、骨骼都以这张整图为基准；建议用能看清全身、背景干净的角色立绘。")),
                    job.sourceUrl !== null && job.sourceUrl !== undefined ? h(Chip, { kind: "ready", text: `${job.canvas?.width ?? "?"}×${job.canvas?.height ?? "?"}` }) : h(Chip, { kind: "empty", text: T("未上传") })
                  ),
                  h(
                    "div",
                    { className: "SPR_toolbar", style: { marginTop: 10 } },
                    h(UploadBox, { label: T("拖入角色整图（PNG / JPG）"), accept: "image/*", onFiles: (files) => void uploadSource(files), busy: uploading }),
                    h(UploadBox, { label: T("拖入部件 PNG（可多选，文件名即部件名）"), accept: "image/*", multiple: true, onFiles: (files) => void uploadParts(files), busy: uploading })
                  ),
                  job.sourceUrl !== null && job.sourceUrl !== undefined
                    ? h("img", { className: "SPR_rigCardImg", style: { height: 200, marginTop: 10 }, src: job.sourceUrl, alt: "reference" })
                    : null
                ),

                // ── ① 拆件 ────────────────────────────────────────────
                stage === "parts"
                  ? h(
                      "div",
                      { className: "SPR_rigStage" },
                      h(
                        "div",
                        { className: "SPR_rigStageHead" },
                        h("span", { className: "SPR_rigStageTitle" }, T("① 拆件")),
                        h("span", { className: "SPR_rigStageHint" }, T("让生图模型把角色拆成摊平的部件图，再自动分割成逐件透明 PNG。**这一步花钱**，只跑一次；参数改了可以「重新分割」，不额外计费。")),
                        h(StatusChip, { node: rigStageOf(job, "parts") })
                      ),
                      h(
                        "div",
                        { className: "SPR_rigEditorRow" },
                        h(
                          BusyBtn,
                          {
                            busy: keyBusy(K_RIG_SHEET),
                            busyText: T("正在拆件生图…"),
                            primary: true,
                            disabled: job.sourceUrl === null || job.sourceUrl === undefined || busy,
                            onClick: () => void run(() => api.runRigSheet({ jobId: job.id }), T("已提交拆件生图"), K_RIG_SHEET)
                          },
                          job.sheet?.status === "ready" ? T("重新生成拆件图（会花钱）") : T("生成拆件图（会花钱）")
                        ),
                        h(
                          BusyBtn,
                          {
                            busy: keyBusy(K_RIG_SEGMENT),
                            busyText: T("正在分割…"),
                            disabled: job.sheet?.status !== "ready" || busy,
                            onClick: () => void run(() => api.runRigSegment({ jobId: job.id }), T("已提交重新分割"), K_RIG_SEGMENT)
                          },
                          T("用现有拆件图重新分割")
                        ),
                        h(NumField, { label: T("网格列"), value: settingsDraft.gridColumns ?? 4, min: 1, max: 8, onChange: (value) => setSettingsDraft({ ...settingsDraft, gridColumns: value }) }),
                        h(NumField, { label: T("网格行"), value: settingsDraft.gridRows ?? 4, min: 1, max: 8, onChange: (value) => setSettingsDraft({ ...settingsDraft, gridRows: value }) }),
                        h(NumField, { label: T("底色容差"), value: settingsDraft.backgroundTolerance ?? 30, min: 1, max: 200, onChange: (value) => setSettingsDraft({ ...settingsDraft, backgroundTolerance: value }) }),
                        h(NumField, { label: T("边缘羽化"), value: settingsDraft.feather ?? 26, min: 1, max: 200, onChange: (value) => setSettingsDraft({ ...settingsDraft, feather: value }) }),
                        h(NumField, { label: T("最小面积"), value: settingsDraft.minArea ?? 0, min: 0, max: 100000, onChange: (value) => setSettingsDraft({ ...settingsDraft, minArea: value }) }),
                        // 「边缘羽化」以前是「离底色多远才不透明」的斜率，浅色填充会
                        // 因此整片变半透明；现在它只作用于轮廓最外圈，内部一律不透明。
                        h("p", { className: "SPR_hint", style: { marginTop: 4, marginBottom: 0 } },
                          T("底色容差：与底色多接近算背景。边缘羽化：只决定轮廓最外圈那几个像素的软过渡，部件内部不会变半透明。")),
                        h(Btn, { onClick: () => void saveSettings() }, T("保存参数与提示词"))
                      ),
                      h("textarea", {
                        className: "SPR_input",
                        style: { width: "100%", minHeight: 110, marginTop: 10, fontFamily: "inherit", fontSize: 12 },
                        value: promptDraft,
                        placeholder: T("留空则使用内置的网格拆件提示词（要求模型按 4×4 网格摆放 16 个标准人形部件）"),
                        onChange: (event) => setPromptDraft(event.target.value)
                      }),
                      h("textarea", {
                        className: "SPR_input",
                        style: { width: "100%", minHeight: 48, marginTop: 6, fontFamily: "inherit", fontSize: 12 },
                        value: suffixDraft,
                        placeholder: T("统一附加提示词（可留空）"),
                        onChange: (event) => setSuffixDraft(event.target.value)
                      }),
                      job.sheet?.url !== null && job.sheet?.url !== undefined
                        ? h(
                            "div",
                            { className: "SPR_rigCanvasWrap" },
                            h("img", { src: job.sheet.url, alt: "sheet" }),
                            h(LoadingOverlay, { show: keyBusy(K_RIG_SHEET) || keyBusy(K_RIG_SEGMENT), text: keyBusy(K_RIG_SHEET) ? T("生图模型正在拆件…") : T("正在分割部件…") })
                          )
                        : h("p", { className: "SPR_hint", style: { marginTop: 10 } }, job.sourceUrl === null || job.sourceUrl === undefined ? T("先上传角色参考图。") : T("还没有拆件图：点上面的「生成拆件图」，或者用上面的上传框直接给现成部件 PNG。")),
                      (job.parts ?? []).length > 0
                        ? h(
                            "div",
                            null,
                            h("h3", { style: { fontSize: 13, margin: "14px 0 0" } }, T("部件（{n0}）——逐件验收，摆错的可单独重跑", { n0: job.parts.length })),
                            h(
                              "div",
                              { className: "SPR_rigGrid" },
                              job.parts.map((part) =>
                                h(RigPartCard, {
                                  key: part.name,
                                  part,
                                  selected: selected === part.name,
                                  busy,
                                  onSelect: () => {
                                    setSelected(part.name);
                                    setStage("layout");
                                  },
                                  onApprove: () => void run(() => api.saveRigJob({ jobId: job.id, approved: part.approved !== true, stage: "parts", part: part.name })),
                                  onHide: () => void run(() => api.setRigPartVisibility({ jobId: job.id, name: part.name, hidden: part.hidden !== true })),
                                  onRemove: () => void run(() => api.removeRigPart({ jobId: job.id, name: part.name })),
                                  onRename: () => {
                                    const next = typeof window === "undefined" ? null : window.prompt(
                                      T("把「{n0}」改成什么名字？\n（名字决定骨骼层级，标准名如 head / torso / hip / left-upper-arm / left-lower-leg / right-foot，见拆件提示词里的网格表）", { n0: part.name }),
                                      part.name
                                    );
                                    if (next === null || next.trim() === "" || next === part.name) return;
                                    void run(() => api.renameRigPart({ jobId: job.id, from: part.name, to: next.trim() }), T("已改名为「{n0}」", { n0: next.trim() }));
                                  },
                                  onRetry: () =>
                                    void run(
                                      () => api.runRigLayout({ jobId: job.id, names: [part.name] }),
                                      T("已重新定位「{n0}」", { n0: part.name }),
                                      PART_K(part.name, "relayout")
                                    )
                                })
                              )
                            )
                          )
                        : null,
                      h(RigSemanticsPanel, { job, api, run, activeKey: K_RIG_LAYOUT }),
                      h(RigTexturePanel, {
                        job,
                        api,
                        run,
                        busy,
                        keyBusy,
                        activeKey: K_RIG_SEGMENT,
                        selected,
                        onSelect: setSelected
                      }),
                      h(
                        "div",
                        { className: "SPR_toolbar", style: { marginTop: 12 } },
                        h(Btn, {
                          onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: true, stage: "parts" }), T("第①步已通过")),
                          on: rigStageOf(job, "parts").approved === true,
                          disabled: (job.parts ?? []).filter((part) => part.status === "ready").length === 0
                        }, rigStageOf(job, "parts").approved === true ? T("第①步：已通过") : T("第①步：通过")),
                        h(Btn, {
                          onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: false, stage: "parts" }))
                        }, T("取消通过")),
                        h(Btn, { onClick: () => setStage("layout") }, T("下一步：装配定位 →"))
                      )
                    )
                  : null,

                // ── ② 装配定位 ────────────────────────────────────────
                stage === "layout"
                  ? h(
                      "div",
                      { className: "SPR_rigStage" },
                      h(
                        "div",
                        { className: "SPR_rigStageHead" },
                        h("span", { className: "SPR_rigStageTitle" }, T("② 装配定位")),
                        h("span", { className: "SPR_rigStageHint" }, T("多尺度模板匹配把每个部件摆回参考姿态。**本地计算，免费**：失败或摆错只重跑那几个部件，不用整批重来。")),
                        h(StatusChip, { node: rigStageOf(job, "layout") })
                      ),
                      h(
                        "div",
                        { className: "SPR_rigEditorRow" },
                        h(
                          BusyBtn,
                          {
                            busy: keyBusy(K_RIG_LAYOUT),
                            busyText: T("正在装配定位…"),
                            primary: true,
                            disabled: (job.parts ?? []).filter((part) => part.status === "ready").length === 0 || busy,
                            onClick: () => void run(() => api.runRigLayout({ jobId: job.id }), T("已提交装配定位（本地计算）"), K_RIG_LAYOUT)
                          },
                          T("重新装配全部部件")
                        ),
                        h(
                          BusyBtn,
                          {
                            busy: keyBusy(K_RIG_LAYOUT),
                            busyText: T("正在重试…"),
                            disabled: (job.review?.unmatched ?? []).length === 0 || busy,
                            onClick: () => void run(() => api.runRigLayout({ jobId: job.id, names: job.review.unmatched }), T("已提交重试未命中的部件"), K_RIG_LAYOUT)
                          },
                          T("只重试未命中的 {n0} 个", { n0: (job.review?.unmatched ?? []).length })
                        ),
                        h(Btn, { onClick: () => setShowReference((current) => !current), on: showReference }, showReference ? T("只显示合成图") : T("并排显示参考图"))
                      ),
                      h(RigAssemblyEditor, { job, api, run, busy, activeKey: K_RIG_LAYOUT }),
                      (job.review?.unmatched ?? []).length > 0
                        ? h("p", { className: "SPR_hint", style: { color: "var(--dsw-alias-state-warning-primary, #b45309)" } }, T("这些部件没匹配上，请手工拖到正确位置：{n0}", { n0: job.review.unmatched.join(T("、")) }))
                        : null,
                      h(
                        "div",
                        { className: "SPR_toolbar", style: { marginTop: 12 } },
                        h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: true, stage: "layout" }), T("第②步已通过")), on: rigStageOf(job, "layout").approved === true, disabled: job.layout?.status !== "ready" }, rigStageOf(job, "layout").approved === true ? T("第②步：已通过") : T("第②步：通过")),
                        h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: false, stage: "layout" })) }, T("取消通过")),
                        h(Btn, { onClick: () => setStage("rig") }, T("下一步：骨骼与动画 →"))
                      )
                    )
                  : null,

                // ── ③ 骨骼与动画 ──────────────────────────────────────
                stage === "rig"
                  ? h(
                      "div",
                      { className: "SPR_rigStage" },
                      h(
                        "div",
                        { className: "SPR_rigStageHead" },
                        h("span", { className: "SPR_rigStageTitle" }, T("③ 骨骼与动画")),
                        h("span", { className: "SPR_rigStageHint" }, T("按部件语义自动推骨骼层级，并生成六个动画预设。**本地计算，免费**。下面直接播放验收。")),
                        h(StatusChip, { node: rigStageOf(job, "rig") })
                      ),
                      h(
                        "div",
                        { className: "SPR_rigEditorRow" },
                        h(
                          BusyBtn,
                          {
                            busy: keyBusy(K_RIG_BONES),
                            busyText: T("正在生成骨骼…"),
                            primary: true,
                            disabled: job.layout?.status !== "ready" || busy,
                            onClick: () => void run(() => api.runRigBones({ jobId: job.id }), T("已提交骨骼构建"), K_RIG_BONES)
                          },
                          T("生成骨骼与动画")
                        ),
                        h("span", { className: "SPR_refRow" }, T("动画预设")),
                        RIG_ANIMATIONS.map((name) =>
                          h(
                            "label",
                            { key: name, className: "SPR_refRow", style: { display: "inline-flex", gap: 4, alignItems: "center" } },
                            h("input", {
                              type: "checkbox",
                              checked: (settingsDraft.animations ?? []).includes(name),
                              onChange: (event) => {
                                const current = new Set(settingsDraft.animations ?? []);
                                if (event.target.checked) current.add(name);
                                else current.delete(name);
                                setSettingsDraft({ ...settingsDraft, animations: RIG_ANIMATIONS.filter((entry) => current.has(entry)) });
                              }
                            }),
                            name
                          )
                        ),
                        h(Btn, { onClick: () => void saveSettings() }, T("保存动画选择")),
                        job.rig?.skeleton !== null && job.rig?.skeleton !== undefined ? h("a", { className: "SPR_link", href: job.rig.skeleton, download: "skeleton.json" }, T("下载 skeleton.json")) : null,
                        job.rig?.preview !== null && job.rig?.preview !== undefined ? h("a", { className: "SPR_link", href: job.rig.preview, target: "_blank", rel: "noreferrer" }, T("新窗口打开预览")) : null
                      ),
                      (job.rig?.warnings ?? []).length > 0
                        ? h("p", { className: "SPR_hint", style: { color: "var(--dsw-alias-state-warning-primary, #b45309)" } }, T("骨骼告警：{n0}", { n0: job.rig.warnings.join(T("；")) }))
                        : null,
                      job.rig?.preview !== null && job.rig?.preview !== undefined
                        ? h(
                            React.Fragment,
                            null,
                            h(
                              "div",
                              { className: "SPR_rigEditorRow" },
                              h("span", { className: "SPR_refRow" }, T("播放动画")),
                              (job.rig.animations ?? []).map((name) =>
                                h(Btn, { key: name, on: anim === name, onClick: () => setAnim(name) }, name)
                              ),
                              h("span", { className: "SPR_hint" }, T("预览里也能拖时间轴、开骨骼网格"))
                            ),
                            h("iframe", {
                              className: "SPR_rigPreview",
                              // `?v=` 用 `rig.updatedAt` 做缓存破除：时间轴改完会重算骨骼，
                              // 快照一变 iframe 就重载，预览才能「立即反映」。
                              // 少了它 React 认为 src 没变、不重新挂载，预览会一直是旧的。
                              src: `${job.rig.preview}?v=${job.rig.updatedAt ?? 0}#${anim}`,
                              title: T("骨骼动画预览")
                            })
                          )
                        : h("p", { className: "SPR_hint", style: { marginTop: 10 } }, job.layout?.status === "ready" ? T("点「生成骨骼与动画」得到 skeleton.json 与可播放预览。") : T("先完成第②步装配定位。")),
                      h(RigAnimationPanel, { job, api, run, busy, activeKey: K_RIG_BONES }),
                      h(RigTimelineEditor, { job, api, run, busy, activeKey: K_RIG_BONES, onRebuild: true }),
                      h(RigConstraintPanel, { job, api, run, busy, activeKey: K_RIG_BONES }),
                      h(RigMeshPanel, { job, api, run, busy, activeKey: K_RIG_BONES }),
                      h(RigPathPanel, { job, api, run, busy, activeKey: K_RIG_BONES }),
                      h(RigBoneEditor, { job, api, run, busy, activeKey: K_RIG_BONES }),
                      // 两条导出路径同源：Spine 的 skeleton.json 与 DragonBones 的 _ske.json。
                      job.rig?.dragonBones?.skeleton !== null && job.rig?.dragonBones?.skeleton !== undefined
                        ? h(
                            "div",
                            { className: "SPR_rigEditorRow", "data-testid": "rig-bones-db" },
                            h("span", { className: "SPR_refRow" }, T("DragonBones 骨架")),
                            h("a", { className: "SPR_link", href: job.rig.dragonBones.skeleton, target: "_blank", rel: "noreferrer" }, "skeleton_ske.json"),
                            h("span", { className: "SPR_hint" }, T("同一份骨架的 DragonBones 5.5 写法（Cocos / Egret / Laya 可直接加载）"))
                          )
                        : null,
                      h(
                        "div",
                        { className: "SPR_toolbar", style: { marginTop: 12 } },
                        h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: true, stage: "rig" }), T("第③步已通过")), on: rigStageOf(job, "rig").approved === true, disabled: job.rig?.status !== "ready" }, rigStageOf(job, "rig").approved === true ? T("第③步：已通过") : T("第③步：通过")),
                        h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: false, stage: "rig" })) }, T("取消通过")),
                        h(Btn, { onClick: () => setStage("atlas") }, T("下一步：图集 →"))
                      )
                    )
                  : null,

                // ── ④ 图集 ────────────────────────────────────────────
                stage === "atlas"
                  ? h(
                      "div",
                      { className: "SPR_rigStage" },
                      h(
                        "div",
                        { className: "SPR_rigStageHead" },
                        h("span", { className: "SPR_rigStageTitle" }, T("④ 图集")),
                        h("span", { className: "SPR_rigStageHint" }, T("把部件按装配后的尺寸打包成 Spine 纹理图集。区域尺寸与 skeleton.json 里挂点的 width/height 一致，导入引擎不会错位。")),
                        h(StatusChip, { node: rigStageOf(job, "atlas") })
                      ),
                      h(
                        "div",
                        { className: "SPR_rigEditorRow" },
                        h(
                          BusyBtn,
                          {
                            busy: keyBusy(K_RIG_ATLAS),
                            busyText: T("正在打包…"),
                            primary: true,
                            disabled: job.rig?.status !== "ready" || busy,
                            onClick: () => void run(() => api.runRigAtlas({ jobId: job.id }), T("已提交图集打包"), K_RIG_ATLAS)
                          },
                          T("打包纹理图集")
                        ),
                        job.atlas?.text !== null && job.atlas?.text !== undefined ? h("a", { className: "SPR_link", href: job.atlas.text, target: "_blank", rel: "noreferrer" }, T("查看 skeleton.atlas")) : null,
                        job.atlas?.image !== null && job.atlas?.image !== undefined ? h("a", { className: "SPR_link", href: job.atlas.image, download: "skeleton.png" }, T("下载 skeleton.png")) : null,
                        job.atlas?.width !== undefined ? h(Chip, { kind: "ready", text: T("{n0}×{n1} · {n2} 区域{n3}", { n0: job.atlas.width, n1: job.atlas.height, n2: job.atlas.regions, n3: (job.atlas.pages ?? []).length > 1 ? T(" · {n0} 页", { n0: job.atlas.pages.length }) : "" }) }) : null
                      ),
                      // 同一份图集的**两种描述**：Spine 的 .atlas 与 DragonBones 的 _tex.json。
                      // 两者必须是同一次装箱出来的——分开各装一次，坐标迟早对不上，
                      // 而运行时的表现只是「画错位」，不会有任何报错。
                      (job.atlas?.dragonBones ?? []).length > 0
                        ? h(
                            "div",
                            { className: "SPR_rigEditorRow", "data-testid": "rig-atlas-db" },
                            h("span", { className: "SPR_refRow" }, T("DragonBones 贴图")),
                            job.atlas.dragonBones.map((entry) =>
                              h("a", { key: entry.file, className: "SPR_link", href: entry.url, target: "_blank", rel: "noreferrer" },
                                entry.file.split("/").pop())
                            )
                          )
                        : null,
                      (job.atlas?.warnings ?? []).length > 0
                        ? h("p", { className: "SPR_hint", style: { color: "var(--dsw-alias-state-warning-primary, #b45309)" } },
                            T("图集提示：{n0}", { n0: job.atlas.warnings.join(T("；")) }))
                        : null,
                      job.atlas?.url !== null && job.atlas?.url !== undefined
                        ? h("div", { className: "SPR_rigAtlasWrap" }, h("img", { src: job.atlas.url, alt: "atlas" }))
                        : h("p", { className: "SPR_hint", style: { marginTop: 10 } }, job.rig?.status === "ready" ? T("点「打包纹理图集」生成 skeleton.png + skeleton.atlas。") : T("先完成第③步骨骼构建。")),
                      // 多页图集：逐页给下载与预览（页名与 .atlas 第一行严格一致）。
                      (job.atlas?.pages ?? []).length > 1
                        ? h(
                            "div",
                            { className: "SPR_rigEditorRow" },
                            h("span", { className: "SPR_refRow" }, T("分页")),
                            job.atlas.pages.map((page) =>
                              h("a", { key: page.file, className: "SPR_link", href: `/${page.file}`, target: "_blank", rel: "noreferrer" },
                                T("{n0}（{n1}×{n2} · {n3} 区域）", { n0: page.file.split("/").pop(), n1: page.width, n2: page.height, n3: page.regions }))
                            )
                          )
                        : null,
                      h(
                        "div",
                        { className: "SPR_toolbar", style: { marginTop: 12 } },
                        h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: true, stage: "atlas" }), T("第④步已通过")), on: rigStageOf(job, "atlas").approved === true, disabled: job.atlas?.status !== "ready" }, rigStageOf(job, "atlas").approved === true ? T("第④步：已通过") : T("第④步：通过")),
                        h(Btn, { onClick: () => void run(() => api.saveRigJob({ jobId: job.id, approved: false, stage: "atlas" })) }, T("取消通过"))
                      ),
                      h("p", { className: "SPR_hint", style: { marginTop: 10 } }, T("导入 Spine：把 skeleton.json、skeleton.atlas、skeleton.png 三个文件放在同一目录，打开 Spine 时选 skeleton.json 即可。")),
                      h("p", { className: "SPR_hint", style: { marginTop: 4 } }, T("导入 DragonBones：把 export/dragonbones/skeleton_ske.json 与 atlas/skeleton_tex.json、atlas/skeleton.png 放同一目录后加载 .json 数据与纹理。"))
                    )
                  : null,

                h(JobLogPanel, { job })
              )
        )
  );
}

  return RigModule;
}
