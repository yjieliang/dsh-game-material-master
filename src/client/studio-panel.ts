/**
 * StudioPanel：面板实现。
 *
 * 拆成工厂函数的原因：面板要用宿主 `require("react")` 提供的 React，而 `require` 只在
 * `__ModuleLoader__.load` 的 factory 里可用 —— 模块顶层不能直接抓 React。所以共享物
 * （React / h / T / api 辅助 / 公共组件）由入口显式传进来，这里只构造一次组件。
 */
export interface StudioPanelRuntime {
  React: any;
  scheduler: any;
  h: any;
  T: any;
  useLocaleTick: any;
  DIRECTION_KEYS: any;
  STAGES: any;
  useHiddenModules: any;
  visibleModulesOf: any;
  useStudioIntent: any;
  msg: any;
  mergeDrafts: any;
  askNewName: any;
  Btn: any;
  assetUrl: any;
  usePendingTasks: any;
  BusyBtn: any;
  ReviewModeBar: any;
  stageHint: any;
  stageDone: any;
  KEY_EXPORT_IMAGES: any;
  renderImageStage: any;
  renderVideoStage: any;
  renderFrameStage: any;
  renderSheetStage: any;
  WalkPreview: any;
  fileLabel: any;
  CopyIdButton: any;
  MapModule: any;
  MusicModule: any;
  SfxModule: any;
  IsoModule: any;
  ImageModule: any;
  SequenceModule: any;
  renderLog: any;
  RigModule: any;
  ModuleIcon: any;
  StudioGlyphIcon: any;
}

export function createStudioPanel(rt: StudioPanelRuntime) {
  const { React, h, T, scheduler, useLocaleTick, DIRECTION_KEYS, STAGES, useHiddenModules, visibleModulesOf, useStudioIntent, msg, mergeDrafts, askNewName, Btn, assetUrl, usePendingTasks, BusyBtn, ReviewModeBar, stageHint, stageDone, KEY_EXPORT_IMAGES, renderImageStage, renderVideoStage, renderFrameStage, renderSheetStage, WalkPreview, fileLabel, CopyIdButton, MapModule, MusicModule, SfxModule, IsoModule, ImageModule, SequenceModule, renderLog, RigModule, ModuleIcon, StudioGlyphIcon } = rt;

function StudioPanel(props) {
  const localeTick = useLocaleTick();
  const api = props?.api;
  const [projects, setProjects] = React.useState([]);
  const [projectId, setProjectId] = React.useState(null);
  const [project, setProject] = React.useState(null);
  const [stage, setStage] = React.useState("images");
  const [module, setModule] = React.useState("sprite");
  const [notice, setNotice] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [promptDraft, setPromptDraft] = React.useState({});
  const [promptOpen, setPromptOpen] = React.useState({});
  const [videoPromptDraft, setVideoPromptDraft] = React.useState("");
  const [settingsDraft, setSettingsDraft] = React.useState(null);
  const [sourceBusy, setSourceBusy] = React.useState(false);
  const [dropOver, setDropOver] = React.useState(false);
  const fileInputRef = React.useRef(null);
  // 「正在调用接口」的记账表：宿主侧任务状态还没落盘时，遮罩靠它撑住。
  const tasks = usePendingTasks();
  // 深链接意图：会话里点「查看验收」时落到对应模块 / 项目 / 阶段。
  const intent = useStudioIntent();
  // 功能管理：被隐藏的模块既不在页签里，也不该在别处被切进来（深链接也会被挡）。
  const hidden = useHiddenModules(api);
  /**
   * 上一次从宿主读到的提示词（连同项目 id）。
   *
   * 后台轮询（有任务在跑时 2.5 秒一次、视频阶段固定 5 秒一次）会反复拉项目，
   * 用它判断界面上的草稿有没有被用户改过，别再拿宿主的值把正在输入的内容覆盖掉
   * （真机反馈：「我替换的时候它一秒钟又换回来」）。判定规则见 `mergeDrafts`。
   */
  const loadedPrompts = React.useRef({ projectId: null, images: {}, video: "" });
  const visibleModules = visibleModulesOf(hidden);
  /**
   * 真正渲染的模块：当前选中项被隐藏（或压根不存在）时落到第一个可见模块。
   *
   * 不用等 `useEffect` 把 state 改回来——那样会先渲染一帧隐藏模块，
   * 深链接进被隐藏的模块时就会闪一下它的界面。
   */
  const activeModule =
    visibleModules.some((entry) => entry.key === module) ? module : visibleModules.length > 0 ? visibleModules[0].key : null;

  React.useEffect(() => {
    if (activeModule !== null && activeModule !== module) setModule(activeModule);
  }, [activeModule, module]);

  React.useEffect(() => {
    if (intent === null) return;
    if (typeof intent.module === "string") setModule(intent.module);
    if (typeof intent.projectId === "string") setProjectId(intent.projectId);
    if (typeof intent.stage === "string" && STAGES.some((item) => item.key === intent.stage)) setStage(intent.stage);
  }, [intent]);

  const busy = project !== null && ((project.jobs?.length ?? 0) > 0 ||
    DIRECTION_KEYS.some((key) => project.videos?.[key]?.status === "running") ||
    // 转圈视频是「提交完就返回」的后台任务：kick 的那条记录在提交结束时就撤了，
    // 之后只剩节点自己还是 running。不把它算进来，界面在几分钟的等视频期间
    // 一次都不会刷新（宿主其实一直在轮询），看着就像卡住了。
    project.turn?.video?.status === "running");
  // 轮询条件也要算上正在跑的这一次调用，否则点完按钮到 running 落盘之间不会刷新。
  const polling = busy || tasks.active;

  const refreshProjects = React.useCallback(async () => {
    if (api === undefined) return;
    try {
      const result = await api.listProjects();
      setProjects(result.projects ?? []);
      return result.projects ?? [];
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
      return [];
    }
  }, [api]);

  const loadProject = React.useCallback(
    async (id, options: any = {}) => {
      if (api === undefined || id === null) return;
      try {
        const next = await api.getProject(id);
        const previous = loadedPrompts.current;
        // 换项目、或用户明确点了「重置为默认」：草稿整份换成宿主的。
        const force = options.resetDrafts === true || previous.projectId !== id;
        const images = { ...(next.prompts?.images ?? {}) };
        const video = next.prompts?.video ?? "";
        loadedPrompts.current = { projectId: id, images, video };
        setProject(next);
        setPromptDraft((current) => mergeDrafts(current, previous.images, images, force));
        setVideoPromptDraft((current) => mergeDrafts(current, previous.video, video, force));
        setSettingsDraft({ ...(next.settings ?? {}) });
        setPromptOpen((current) => {
          const keys = Object.keys(current);
          if (keys.length > 0) return current;
          return {};
        });
      } catch (error) {
        setNotice({ kind: "error", text: msg(error) });
      }
    },
    [api]
  );

  // 首次挂载：拉项目列表，自动选中最近一个。
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await refreshProjects();
      if (cancelled) return;
      setLoading(false);
      if (list.length > 0) setProjectId((current) => current ?? list[0].id);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshProjects]);

  React.useEffect(() => {
    if (projectId === null) {
      setProject(null);
      return;
    }
    void loadProject(projectId);
    // `localeTick` 也在依赖里：内置默认提示词存在宿主侧，界面重渲染换不掉它们，
    // 语言一变就得重新拉一次项目（宿主会把「从没改过」的提示词换成新语言的默认值）。
  }, [projectId, loadProject, localeTick]);

  // 有任务在跑时轮询；跑完自动停。
  React.useEffect(() => {
    if (!polling || projectId === null) return undefined;
    // 走集中调度器：同 key 去重、失败退避、页面隐藏暂停（原来是裸 setInterval）。
    const handle = scheduler.watch({
      key: "project:" + String(projectId) + ":busy",
      intervalMs: 2500,
      immediate: false,
      run: () => loadProject(projectId)
    });
    return () => handle.cancel();
  }, [polling, projectId, loadProject, scheduler]);

  // 视频阶段即便宿主侧在轮询，界面也要定期刷新任务状态。
  React.useEffect(() => {
    if (stage !== "videos" || projectId === null) return undefined;
    const handle = scheduler.watch({
      key: "project:" + String(projectId) + ":videos",
      intervalMs: 5000,
      immediate: false,
      run: () => loadProject(projectId)
    });
    return () => handle.cancel();
  }, [stage, projectId, loadProject, scheduler]);

  const withApi = React.useCallback(
    async (fn, options: any = {}) => {
      if (api === undefined) {
        setNotice({ kind: "error", text: T("远程服务尚未挂载完成，请稍候再试") });
        return undefined;
      }
      try {
        const value = await fn();
        if (options.notice !== undefined) setNotice({ kind: options.noticeKind ?? "info", text: options.notice });
        if (options.reload === true && projectId !== null)
          await loadProject(projectId, { resetDrafts: options.resetDrafts === true });
        return value;
      } catch (error) {
        setNotice({ kind: "error", text: msg(error) });
        return undefined;
      }
    },
    [api, projectId, loadProject]
  );

  const createProject = async () => {
    const name = askNewName(T("新项目的名字"), T("角色 {n0}", { n0: new Date().toLocaleString("zh-CN", { hour12: false }) }));
    if (name === null) return;
    await withApi(
      async () => {
        const created = await api.createProject({ name });
        await refreshProjects();
        setProjectId(created.projectId);
      },
      { notice: T("已创建新项目") }
    );
  };

  const deleteCurrent = async () => {
    if (project === null) return;
    // eslint-disable-next-line no-alert
    if (typeof window !== "undefined" && !window.confirm(T("确定删除项目「{n0}」？项目目录会被整个移除，无法撤销。", { n0: project.name }))) return;
    await withApi(async () => {
      await api.deleteProject({ projectId: project.id });
      const list = await refreshProjects();
      setProjectId(list.length > 0 ? list[0].id : null);
      if (list.length === 0) setProject(null);
    });
  };

  const renameCurrent = async () => {
    if (project === null) return;
    // eslint-disable-next-line no-alert
    const next = typeof window === "undefined" ? null : window.prompt(T("新的项目名"), project.name);
    if (next === null || next.trim() === "") return;
    await withApi(async () => {
      await api.renameProject({ projectId: project.id, name: next.trim() });
      await refreshProjects();
    }, { reload: true });
  };

  const uploadSource = React.useCallback(
    async (file) => {
      if (project === null || file === undefined || file === null) return;
      setSourceBusy(true);
      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const text = String(reader.result ?? "");
            resolve(text.slice(text.indexOf(",") + 1));
          };
          reader.onerror = () => reject(new Error(T("读取文件失败")));
          reader.readAsDataURL(file);
        });
        await api.uploadSource({ projectId: project.id, name: file.name, data: base64 });
        setNotice({ kind: "ok", text: T("已上传源图：{n0}", { n0: file.name }) });
        await loadProject(project.id);
      } catch (error) {
        setNotice({ kind: "error", text: msg(error) });
      } finally {
        setSourceBusy(false);
      }
    },
    [api, project, loadProject]
  );

  const savePrompts = (patch) =>
    withApi(() => api.savePrompts({ projectId: project.id, ...patch }), {
      reload: true,
      notice: T("提示词已保存"),
      noticeKind: "ok"
    });

  const saveSettings = (patch) =>
    withApi(() => api.saveSettings({ projectId: project.id, settings: patch }), {
      reload: true,
      notice: T("参数已保存"),
      noticeKind: "ok"
    });

  /**
   * 启动一个后台任务。
   * `started: false` 表示宿主拒绝了这次启动（例如同一任务已在跑）——
   * 这不算错误，但必须让用户看见原因，否则点按钮像是没反应。
   *
   * 第三个参数是「正在调用接口」的反馈：给了就按 key 记账，
   * 界面据此盖 loading 遮罩 / 把按钮变成转圈。
   */
  const start = async (fn, done, feedback?: any) => {
    const invoke = () => withApi(fn, done);
    const result =
      feedback === undefined
        ? await invoke()
        : await tasks.run(feedback.key, feedback.label, invoke);
    if (result !== null && typeof result === "object" && result.started === false) {
      setNotice({ kind: "info", text: result.reason ?? T("任务没有启动") });
    }
    return result;
  };

  /**
   * 「保存全部图片（zip）」：宿主按**当前项目状态**现打一个 zip 落到 `out/` 下，
   * 这里再触发一次浏览器下载。
   *
   * 为什么不直接摆一个 `<a href>`：包里有哪些图（以及文件名）只有宿主知道，
   * 没有固定地址可指，所以只能「先请求、拿到相对路径再下载」。
   */
  const exportAllImages = () =>
    void start(
      async () => {
        const pack = await api.exportImages({ projectId: project.id });
        const url = `${pack?.assetBase ?? project.assetBase ?? ""}${pack?.file ?? ""}`;
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileLabel(pack?.file);
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setNotice({
          kind: "ok",
          text:
            Number(pack?.skipped ?? 0) > 0
              ? T("已打包 {n0} 张图片（另有 {n1} 张读不到，已跳过）", { n0: pack?.count ?? 0, n1: pack?.skipped ?? 0 })
              : T("已打包 {n0} 张图片", { n0: pack?.count ?? 0 })
        });
        return pack;
      },
      { reload: true },
      { key: KEY_EXPORT_IMAGES, label: T("正在打包全部图片…") }
    );

  if (api === undefined) {
    return h("div", { className: "SPR_root" }, h("p", { className: "SPR_empty" }, T("正在挂载游戏素材大师…")));
  }

  const activeStageIndex = STAGES.findIndex((s) => s.key === stage);
  const activeStage = STAGES[activeStageIndex < 0 ? 0 : activeStageIndex];

  return h(
    "div",
    { className: "SPR_root" },
    h(
      "div",
      { className: "SPR_head" },
      h(
        "div",
        { className: "SPR_headBrand" },
        h("span", { className: "SPR_headMark" }, h(StudioGlyphIcon, { size: 18 })),
        h(
          "div",
          { className: "SPR_headText" },
          h("h2", null, T("游戏素材大师")),
          h("span", { className: "SPR_headSub" }, T("火山方舟 Seedream 生图 · MiniMax 图生视频 · 谱乐 AI 音乐 · 火山引擎音效 · 本地处理"))
        )
      ),
      h("span", { className: "SPR_spacer" }),
      activeModule === "sprite"
        ? h(
            React.Fragment,
            null,
            h(Btn, { onClick: () => void refreshProjects(), disabled: loading }, T("刷新列表")),
            project !== null ? h(Btn, { onClick: renameCurrent }, T("重命名")) : null,
            project !== null ? h(Btn, { onClick: deleteCurrent, danger: true }, T("删除项目")) : null,
            project !== null ? h(CopyIdButton, { id: project.id }) : null,
            h(Btn, { onClick: createProject, primary: true }, T("新建项目"))
          )
        : null
    ),
    h(
      "div",
      {
        className: "SPR_modules",
        "data-hidden-count": String(hidden.length),
        // ≤4 个排一行；更多时均分两行（8 → 4+4，7 → 4+3），宽面板再由容器查询放成一行。
        style: {
          "--spr-module-cols": String(Math.max(1, visibleModules.length <= 4 ? visibleModules.length : Math.ceil(visibleModules.length / 2))),
          "--spr-module-count": String(Math.max(1, visibleModules.length))
        }
      },
      visibleModules.map((entry) =>
        h(
          "button",
          {
            key: entry.key,
            type: "button",
            className: "SPR_module",
            "data-module": entry.key,
            "data-active": activeModule === entry.key ? "true" : "false",
            "aria-pressed": activeModule === entry.key ? "true" : "false",
            title: `${entry.title} — ${entry.hint}`,
            onClick: () => setModule(entry.key)
          },
          h("span", { className: "SPR_moduleIcon" }, h(ModuleIcon, { name: entry.key, size: 18 })),
          h(
            "span",
            { className: "SPR_moduleTitleRow" },
            h("span", { className: "SPR_moduleTitle" }, entry.title),
            entry.experimental === true ? h("span", { className: "SPR_expTag" }, T("实验性")) : null
          ),
          h("span", { className: "SPR_moduleHint" }, entry.hint)
        )
      ),
      hidden.length > 0
        ? h("span", { className: "SPR_modulesHiddenNote" }, T("已隐藏 {n0} 个功能（设置 → 游戏素材大师 → 功能管理）", { n0: hidden.length }))
        : null
    ),
    activeModule === null
      ? h(
          "div",
          { className: "SPR_body" },
          h("p", { className: "SPR_empty" }, T("所有功能都已被隐藏。请到「设置 → 游戏素材大师 → 功能管理」里打开至少一个。"))
        )
      : null,
    activeModule === "sprite"
      ? h(
      "div",
      { className: "SPR_body" },
      h(
        "div",
        { className: "SPR_side" },
        h("div", { className: "SPR_sideTitle" }, T("项目（{n0}）", { n0: projects.length })),
        projects.length === 0
          ? h("p", { className: "SPR_sideEmpty" }, T("还没有项目，点右上角「新建项目」开始。"))
          : projects.map((summary) =>
              h(
                "button",
                {
                  key: summary.id,
                  type: "button",
                  className: "SPR_projItem",
                  "data-active": summary.id === projectId ? "true" : "false",
                  onClick: () => setProjectId(summary.id)
                },
                h("span", { className: "SPR_projNameRow" },
                  h("span", { className: "SPR_projName" }, summary.name),
                  h(CopyIdButton, { id: summary.id, inline: true })
                ),
                h(
                  "span",
                  { className: "SPR_projMeta" },
                  T("图 {n0}/8 · 视频 {n1}/8 · 帧 {n2}/8{n3}", { n0: summary.imageReady, n1: summary.videoReady, n2: summary.framesReady, n3: summary.sheetReady ? T(" · 整图✓") : "" })
                )
              )
            )
      ),
      h(
        "div",
        { className: "SPR_main" },
        notice !== null
          ? h(
              "div",
              { className: "SPR_note", "data-kind": notice.kind },
              notice.text,
              h(
                "span",
                { style: { marginLeft: 10 } },
                h("button", { type: "button", className: "SPR_miniBtn", onClick: () => setNotice(null) }, T("关闭"))
              )
            )
          : null,
        project === null
          ? loading
            ? h("p", { className: "SPR_empty" }, T("正在载入…"))
            : h(
                "div",
                { className: "SPR_emptyHero" },
                h("span", { className: "SPR_emptyHeroMark" }, h(ModuleIcon, { name: "sprite", size: 28 })),
                h("h3", { className: "SPR_emptyHeroTitle" }, T("请选择或新建一个项目")),
                h("p", { className: "SPR_emptyHeroDesc" }, T("一张角色设定图，生成 8 个方向 × 8 帧的行走精灵图。流程分五步，每一步都可以单独重做。")),
                h(
                  "ol",
                  { className: "SPR_emptySteps" },
                  STAGES.map((item) =>
                    h(
                      "li",
                      { key: item.key, className: "SPR_emptyStep" },
                      h("span", { className: "SPR_emptyStepTitle" }, item.title),
                      h("span", { className: "SPR_emptyStepHint" }, item.hint)
                    )
                  )
                ),
                h(Btn, { onClick: createProject, primary: true }, T("新建项目"))
              )
          : h(
              React.Fragment,
              null,
              // 审核模式：与对话里的 game_material({action:'reviewMode'}) 是同一份数据。
              h(ReviewModeBar, { api, module: "sprite", id: project.id, mode: project.reviewMode, onChanged: () => void loadProject(project.id) }),
              h(
                "div",
                { className: "SPR_steps" },
                STAGES.map((item, index) =>
                  h(
                    "button",
                    {
                      key: item.key,
                      type: "button",
                      className: "SPR_step",
                      "data-active": item.key === stage ? "true" : "false",
                      onClick: () => setStage(item.key)
                    },
                    h("span", {
                      className: "SPR_stepDot",
                      style: {
                        background: stageDone(project, item.key)
                          ? "var(--dsw-alias-state-success-primary)"
                          : "var(--dsw-alias-label-tertiary)"
                      }
                    }),
                    item.title
                  )
                )
              ),
              h(
                "div",
                { className: "SPR_card" },
                h("div", { className: "SPR_cardHead" }, h("h3", null, T("源图"))),
                h("p", { className: "SPR_hint" }, T("上传角色的原始设定图。第一步的正面绿幕图会以它为唯一参考。")),
                h(
                  "div",
                  { className: "SPR_sourceRow" },
                  project.source !== null
                    ? h("img", {
                        className: "SPR_sourcePreview",
                        src: assetUrl(project, project.source.file, project.updatedAt),
                        alt: T("源图")
                      })
                    : h("div", { className: "SPR_thumbEmpty", style: { width: 132, height: 132, flex: "none" } }, T("尚未上传源图")),
                  h(
                    "div",
                    { style: { flex: 1, minWidth: 240 } },
                    h(
                      "div",
                      {
                        className: "SPR_drop",
                        "data-over": dropOver ? "true" : "false",
                        onDragOver: (event) => {
                          event.preventDefault();
                          setDropOver(true);
                        },
                        onDragLeave: () => setDropOver(false),
                        onDrop: (event) => {
                          event.preventDefault();
                          setDropOver(false);
                          const file = event.dataTransfer?.files?.[0];
                          void uploadSource(file);
                        }
                      },
                      sourceBusy ? T("正在上传…") : T("把图片拖到这里，或")
                    ),
                    h(
                      "div",
                      { className: "SPR_toolbar" },
                      h(
                        Btn,
                        { onClick: () => fileInputRef.current?.click(), disabled: sourceBusy, primary: project.source === null },
                        project.source === null ? T("选择源图") : T("更换源图")
                      ),
                      project.source !== null
                        ? h("span", { className: "SPR_refRow" }, project.source.name)
                        : null
                    ),
                    h("input", {
                      ref: fileInputRef,
                      type: "file",
                      accept: "image/*",
                      style: { display: "none" },
                      onChange: (event) => {
                        const file = event.target.files?.[0];
                        void uploadSource(file);
                        event.target.value = "";
                      }
                    })
                  )
                )
              ),
              h(
                "div",
                { className: "SPR_card" },
                h("div", { className: "SPR_cardHead" }, h("h3", null, activeStage.title)),
                // 阶段①的说明跟着生成方式走：转圈截帧不是「八个方向各生成一次」，
                // 沿用逐方向生图那句话会让人以为走错了页面。
                h("p", { className: "SPR_hint" }, stageHint(project, stage, activeStage)),
                stage === "images"
                  ? renderImageStage({
                      project,
                      api,
                      promptDraft,
                      setPromptDraft,
                      promptOpen,
                      setPromptOpen,
                      savePrompts,
                      start,
                      setNotice,
                      loadProject,
                      tasks
                    })
                  : null,
                stage === "videos"
                  ? renderVideoStage({
                      project,
                      api,
                      videoPromptDraft,
                      setVideoPromptDraft,
                      savePrompts,
                      start,
                      setNotice,
                      loadProject,
                      tasks
                    })
                  : null,
                stage === "frames"
                  ? renderFrameStage({ project, api, start, setNotice, loadProject, settingsDraft, saveSettings, tasks })
                  : null,
                stage === "sheet"
                  ? renderSheetStage({
                      project,
                      api,
                      settingsDraft,
                      setSettingsDraft,
                      saveSettings,
                      start,
                      setNotice,
                      loadProject,
                      tasks
                    })
                  : null,
                stage === "preview" ? h(WalkPreview, { project, tasks }) : null
              ),
              renderLog(project),
              h(
                "div",
                { className: "SPR_toolbar" },
                h(Btn, { onClick: () => void loadProject(project.id) }, T("刷新状态")),
                // 中间图片（绿幕图 / 转圈候选帧与条带 / 各方向原始帧与抠像帧 / 整图）
                // 一次打成一个 zip：转圈模式的候选帧一抽就是 32~64 张，一张一个链接
                // 既点不完也看不清。放在这条**各阶段共用**的工具栏上，任何阶段都能存。
                h(
                  BusyBtn,
                  {
                    busy: tasks.has(KEY_EXPORT_IMAGES),
                    busyText: T("正在打包…"),
                    onClick: () => void exportAllImages()
                  },
                  T("保存全部图片（zip）")
                ),
                h(Btn, { onClick: () => void withApi(() => api.revealProject({ projectId: project.id })) }, T("在访达中打开项目目录"))
              )
            )
      )
    )
      : activeModule === "image"
        ? h(ImageModule, { api })
        : activeModule === "sequence"
          ? h(SequenceModule, { api })
          : activeModule === "iso"
            ? h(IsoModule, { api })
            : activeModule === "map"
              ? h(MapModule, { api, studioCtx: props.studioCtx })
              : activeModule === "music"
                ? h(MusicModule, { api, studioCtx: props.studioCtx })
                : activeModule === "sfx"
                  ? h(SfxModule, { api })
                  : activeModule === "rig"
                    ? h(RigModule, { api })
                    : null
  );
}

  return StudioPanel;
}
