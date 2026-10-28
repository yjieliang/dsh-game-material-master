/**
 * StudioPanel：面板实现。
 *
 * 拆成工厂函数的原因：面板要用宿主 `require("react")` 提供的 React，而 `require` 只在
 * `__ModuleLoader__.load` 的 factory 里可用 —— 模块顶层不能直接抓 React。所以共享物
 * （React / h / T / api 辅助 / 公共组件）由入口显式传进来，这里只构造一次组件。
 *
 * ★ P9 状态归属：项目快照与草稿都在 platform/store（组合根创建后注入），面板本身
 *   **只订阅「当前项目 id / 草稿写入器」这类粗粒度信号**；标题、画布、任务列表、日志
 *   各自是独立组件，按 selector 订阅自己那一段。一次轮询（2.5s 的 getProject）只重渲染
 *   真正用到变化字段的 1–3 个组件，而不是整棵模块子树。
 *   验收口径见 docs/客户端架构方案-性能与可用性.md 的「P9 轮询重渲染实测」一节。
 */

import { markRender } from "./platform/perf.js";
import { shallowEqual } from "./platform/store.js";

export interface StudioPanelRuntime {
  React: any;
  scheduler: any;
  store: any;
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
  const { React, h, T, scheduler, store, useLocaleTick, DIRECTION_KEYS, STAGES, useHiddenModules, visibleModulesOf, useStudioIntent, msg, mergeDrafts, askNewName, Btn, assetUrl, usePendingTasks, BusyBtn, ReviewModeBar, stageHint, stageDone, KEY_EXPORT_IMAGES, renderImageStage, renderVideoStage, renderFrameStage, renderSheetStage, WalkPreview, fileLabel, CopyIdButton, MapModule, MusicModule, SfxModule, IsoModule, ImageModule, SequenceModule, renderLog, RigModule, ModuleIcon, StudioGlyphIcon } = rt;
  /** store 写入器（草稿写入器带内容短路，内容没变不通知）。 */
  const actions = store.actions;
  /** 没有项目时的阶段完成标记（stageDone 不能对 null 求值）。 */
  const NO_STAGE_FLAGS = STAGES.map(() => false);

  /**
   * 只比较项目快照里与「这块界面」相关的几段字段。
   *
   * 和 sprite 里的 projectFieldsEqual 同口径：selector 还是取同一个 project 对象，
   * 但把「与我没关系的变化」判成相等 → store 返回旧引用 → 组件不重渲染。
   */
  function projectFieldsEqual(a: any, b: any, fields: string[]): boolean {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) return false;
    for (const field of fields) {
      if (!Object.is(a[field], b[field])) return false;
    }
    return true;
  }

  /**
   * 宿主侧还有任务在跑吗（轮询开关；只被 effect 读，不参与渲染）。
   *
   * 注意这个判断以前是面板渲染期算的 `busy`：一旦放进渲染，任务跑完/开跑都会让面板
   * 重渲染、把整棵 sprite 子树带着重画。现在只在「轮询控制 effect」里读。
   */
  function projectBusy(project: any): boolean {
    if (project === null || project === undefined) return false;
    return (
      (project.jobs?.length ?? 0) > 0 ||
      DIRECTION_KEYS.some((key: string) => project.videos?.[key]?.status === "running") ||
      // 转圈视频是「提交完就返回」的后台任务：kick 的那条记录在提交结束时就撤了，
      // 之后只剩节点自己还是 running。不把它算进来，界面在几分钟的等视频期间
      // 一次都不会刷新（宿主其实一直在轮询），看着就像卡住了。
      project.turn?.video?.status === "running"
    );
  }

  // ── 子组件 ───────────────────────────────────────────────────────────────
  // 每个组件只订阅自己画的那部分数据；面板重渲染时它们照常重渲染（父驱动），
  // 但一次轮询只有「数据真的变了」的那几个会被 store 叫醒。

  /** 顶栏右侧的项目操作：刷新列表 / 重命名 / 删除 / 复制 id / 新建。 */
  function SpriteProjectHead(props: any) {
    markRender("SpriteProjectHead");
    const view = store.use(
      (state: any) => ({ id: state.project?.id ?? null, name: state.project?.name ?? "" }),
      shallowEqual
    );
    const renameCurrent = async () => {
      if (view.id === null) return;
      // eslint-disable-next-line no-alert
      const next = typeof window === "undefined" ? null : window.prompt(T("新的项目名"), view.name);
      if (next === null || next.trim() === "") return;
      await props.withApi(async () => {
        await props.api.renameProject({ projectId: view.id, name: next.trim() });
        await props.refreshProjects();
      }, { reload: true });
    };
    const deleteCurrent = async () => {
      if (view.id === null) return;
      // eslint-disable-next-line no-alert
      if (typeof window !== "undefined" && !window.confirm(T("确定删除项目「{n0}」？项目目录会被整个移除，无法撤销。", { n0: view.name }))) return;
      await props.withApi(async () => {
        await props.api.deleteProject({ projectId: view.id });
        const list = await props.refreshProjects();
        const nextId = list.length > 0 ? list[0].id : null;
        actions.setProjectId(nextId);
        if (nextId === null) actions.clearProject();
      });
    };
    return h(
      React.Fragment,
      null,
      h(Btn, { onClick: () => void props.refreshProjects(), disabled: props.loading }, T("刷新列表")),
      view.id !== null ? h(Btn, { onClick: renameCurrent }, T("重命名")) : null,
      view.id !== null ? h(Btn, { onClick: deleteCurrent, danger: true }, T("删除项目")) : null,
      view.id !== null ? h(CopyIdButton, { id: view.id }) : null,
      h(Btn, { onClick: () => void props.createProject(), primary: true }, T("新建项目"))
    );
  }

  /** 左侧项目列表（只在项目列表 / 当前选中项变化时重渲染）。 */
  function SpriteProjectList() {
    markRender("SpriteProjectList");
    const projects = store.use((state: any) => state.projects);
    const projectId = store.use((state: any) => state.projectId);
    return h(
      "div",
      { className: "SPR_side" },
      h("div", { className: "SPR_sideTitle" }, T("项目（{n0}）", { n0: projects.length })),
      projects.length === 0
        ? h("p", { className: "SPR_sideEmpty" }, T("还没有项目，点右上角「新建项目」开始。"))
        : projects.map((summary: any) =>
            h(
              "button",
              {
                key: summary.id,
                type: "button",
                className: "SPR_projItem",
                "data-active": summary.id === projectId ? "true" : "false",
                onClick: () => actions.setProjectId(summary.id)
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
    );
  }

  /** 审核模式条：只订阅 id / reviewMode。 */
  function SpriteReviewHost(props: any) {
    markRender("SpriteReviewHost");
    const view = store.use(
      (state: any) => ({ id: state.project?.id ?? null, mode: state.project?.reviewMode ?? null }),
      shallowEqual
    );
    if (view.id === null) return null;
    return h(ReviewModeBar, { api: props.api, module: "sprite", id: view.id, mode: view.mode, onChanged: () => void props.loadProject(view.id) });
  }

  /** 五个阶段页签：只订阅「各阶段是否已通过」这组布尔值。 */
  function SpriteStageTabs(props: any) {
    markRender("SpriteStageTabs");
    const flags = store.use(
      (state: any) => (state.project === null ? NO_STAGE_FLAGS : STAGES.map((item: any) => stageDone(state.project, item.key))),
      shallowEqual
    );
    return h(
      "div",
      { className: "SPR_steps" },
      STAGES.map((item: any, index: number) =>
        h(
          "button",
          {
            key: item.key,
            type: "button",
            className: "SPR_step",
            "data-active": item.key === props.stage ? "true" : "false",
            onClick: () => props.setStage(item.key)
          },
          h("span", {
            className: "SPR_stepDot",
            style: {
              background: flags[index]
                ? "var(--dsw-alias-state-success-primary)"
                : "var(--dsw-alias-state-label-tertiary, var(--dsw-alias-label-tertiary))"
            }
          }),
          item.title
        )
      )
    );
  }

  /** 源图卡片：只订阅 source / assetBase / updatedAt 这几个字段。 */
  function SpriteSourceCard(props: any) {
    markRender("SpriteSourceCard");
    const project = store.use(
      (state: any) => state.project,
      (a: any, b: any) => projectFieldsEqual(a, b, ["assetBase", "id", "name", "source", "updatedAt"])
    );
    const [sourceBusy, setSourceBusy] = React.useState(false);
    const [dropOver, setDropOver] = React.useState(false);
    const fileInputRef = React.useRef(null);

    const uploadSource = React.useCallback(
      async (file: any) => {
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
          await props.api.uploadSource({ projectId: project.id, name: file.name, data: base64 });
          props.setNotice({ kind: "ok", text: T("已上传源图：{n0}", { n0: file.name }) });
          await props.loadProject(project.id);
        } catch (error) {
          props.setNotice({ kind: "error", text: msg(error) });
        } finally {
          setSourceBusy(false);
        }
      },
      [project, props.api, props.loadProject, props.setNotice]
    );

    return h(
      "div",
      { className: "SPR_card" },
      h("div", { className: "SPR_cardHead" }, h("h3", null, T("源图"))),
      h("p", { className: "SPR_hint" }, T("上传角色的原始设定图。第一步的正面绿幕图会以它为唯一参考。")),
      h(
        "div",
        { className: "SPR_sourceRow" },
        project?.source !== null && project?.source !== undefined
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
              onDragOver: (event: any) => {
                event.preventDefault();
                setDropOver(true);
              },
              onDragLeave: () => setDropOver(false),
              onDrop: (event: any) => {
                event.preventDefault();
                setDropOver(false);
                void uploadSource(event.dataTransfer?.files?.[0]);
              }
            },
            sourceBusy ? T("正在上传…") : T("把图片拖到这里，或")
          ),
          h(
            "div",
            { className: "SPR_toolbar" },
            h(
              Btn,
              { onClick: () => fileInputRef.current?.click(), disabled: sourceBusy, primary: project?.source === null || project?.source === undefined },
              project?.source === null || project?.source === undefined ? T("选择源图") : T("更换源图")
            ),
            project?.source !== null && project?.source !== undefined
              ? h("span", { className: "SPR_refRow" }, project.source.name)
              : null
          ),
          h("input", {
            ref: fileInputRef,
            type: "file",
            accept: "image/*",
            style: { display: "none" },
            onChange: (event: any) => {
              const file = event.target.files?.[0];
              void uploadSource(file);
              event.target.value = "";
            }
          })
        )
      )
    );
  }

  /** 阶段卡片：只订阅「当前阶段提示文案」（图片模式相关的那一句）。 */
  function SpriteStageArea(props: any) {
    markRender("SpriteStageArea");
    const activeStageIndex = STAGES.findIndex((item: any) => item.key === props.stage);
    const activeStage = STAGES[activeStageIndex < 0 ? 0 : activeStageIndex];
    const hint = store.use((state: any) => (state.project === null ? "" : stageHint(state.project, props.stage, activeStage)));
    return h(
      React.Fragment,
      null,
      h(
        "div",
        { className: "SPR_card" },
        h("div", { className: "SPR_cardHead" }, h("h3", null, activeStage.title)),
        // 阶段①的说明跟着生成方式走：转圈截帧不是「八个方向各生成一次」，
        // 沿用逐方向生图那句话会让人以为走错了页面。
        h("p", { className: "SPR_hint" }, hint),
        props.stage === "images"
          ? h(renderImageStage, { api: props.api, start: props.start, setNotice: props.setNotice, savePrompts: props.savePrompts, tasks: props.tasks })
          : null,
        props.stage === "videos"
          ? h(renderVideoStage, { api: props.api, start: props.start, setNotice: props.setNotice, savePrompts: props.savePrompts, tasks: props.tasks })
          : null,
        props.stage === "frames"
          ? h(renderFrameStage, { api: props.api, start: props.start, setNotice: props.setNotice, loadProject: props.loadProject, saveSettings: props.saveSettings, tasks: props.tasks })
          : null,
        props.stage === "sheet"
          ? h(renderSheetStage, { api: props.api, start: props.start, setNotice: props.setNotice, loadProject: props.loadProject, saveSettings: props.saveSettings, tasks: props.tasks })
          : null,
        props.stage === "preview" ? h(WalkPreview, { tasks: props.tasks }) : null
      ),
      h(SpriteLog, null),
      h(SpriteToolbar, props)
    );
  }

  /** 运行日志：只订阅 project.log 的引用。 */
  function SpriteLog() {
    markRender("SpriteLog");
    const log = store.use((state: any) => state.project?.log ?? null);
    return log === null || log === undefined ? null : renderLog({ log });
  }

  /** 阶段工具栏：刷新状态 / 保存全部图片（zip）/ 打开项目目录。 */
  function SpriteToolbar(props: any) {
    markRender("SpriteToolbar");
    const { start } = props;
    const view = store.use(
      (state: any) => ({ id: state.project?.id ?? null, assetBase: state.project?.assetBase ?? "" }),
      shallowEqual
    );
    const exportAllImages = () => {
      if (view.id === null) return undefined;
      return void start(
        async () => {
          const pack = await props.api.exportImages({ projectId: view.id });
          const url = `${pack?.assetBase ?? view.assetBase ?? ""}${pack?.file ?? ""}`;
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = fileLabel(pack?.file);
          anchor.style.display = "none";
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          props.setNotice({
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
    };
    return h(
      "div",
      { className: "SPR_toolbar" },
      h(Btn, { onClick: () => void props.loadProject(view.id) }, T("刷新状态")),
      // 中间图片（绿幕图 / 转圈候选帧与条带 / 各方向原始帧与抠像帧 / 整图）
      // 一次打成一个 zip：转圈模式的候选帧一抽就是 32~64 张，一张一个链接
      // 既点不完也看不清。放在这条**各阶段共用**的工具栏上，任何阶段都能存。
      h(
        BusyBtn,
        {
          busy: props.tasks.has(KEY_EXPORT_IMAGES),
          busyText: T("正在打包…"),
          onClick: () => exportAllImages()
        },
        T("保存全部图片（zip）")
      ),
      h(Btn, { onClick: () => void props.api.revealProject({ projectId: view.id }) }, T("在访达中打开项目目录"))
    );
  }

  /** 没有项目时的空态 / 载入态。 */
  function SpriteProjectEmpty(props: any) {
    markRender("SpriteProjectEmpty");
    if (props.loading) return h("p", { className: "SPR_empty" }, T("正在载入…"));
    return h(
      "div",
      { className: "SPR_emptyHero" },
      h("span", { className: "SPR_emptyHeroMark" }, h(ModuleIcon, { name: "sprite", size: 28 })),
      h("h3", { className: "SPR_emptyHeroTitle" }, T("请选择或新建一个项目")),
      h("p", { className: "SPR_emptyHeroDesc" }, T("一张角色设定图，生成 8 个方向 × 8 帧的行走精灵图。流程分五步，每一步都可以单独重做。")),
      h(
        "ol",
        { className: "SPR_emptySteps" },
        STAGES.map((item: any) =>
          h(
            "li",
            { key: item.key, className: "SPR_emptyStep" },
            h("span", { className: "SPR_emptyStepTitle" }, item.title),
            h("span", { className: "SPR_emptyStepHint" }, item.hint)
          )
        )
      ),
      h(Btn, { onClick: () => void props.createProject(), primary: true }, T("新建项目"))
    );
  }

  /**
   * 项目主体：没有项目时是空态；有项目时是「审核模式 + 阶段页签 + 源图 + 当前阶段 + 日志 + 工具栏」。
   * 它自己只订阅一个布尔（有没有项目），其余全部下放给各自的组件。
   */
  function SpriteProjectArea(props: any) {
    markRender("SpriteProjectArea");
    const hasProject = store.use((state: any) => state.project !== null);
    if (!hasProject) return h(SpriteProjectEmpty, { loading: props.loading, createProject: props.createProject });
    return h(
      React.Fragment,
      null,
      // 审核模式：与对话里的 game_material({action:'reviewMode'}) 是同一份数据。
      h(SpriteReviewHost, { api: props.api, loadProject: props.loadProject }),
      h(SpriteStageTabs, { stage: props.stage, setStage: props.setStage }),
      h(SpriteSourceCard, { api: props.api, loadProject: props.loadProject, setNotice: props.setNotice }),
      h(SpriteStageArea, props)
    );
  }

  /** sprite 模块的整块界面（左侧项目列表 + 右侧主体）。 */
  function SpriteWorkbench(props: any) {
    markRender("SpriteWorkbench");
    return h(
      "div",
      { className: "SPR_body" },
      h(SpriteProjectList, null),
      h(
        "div",
        { className: "SPR_main" },
        props.notice !== null
          ? h(
              "div",
              { className: "SPR_note", "data-kind": props.notice.kind },
              props.notice.text,
              h(
                "span",
                { style: { marginLeft: 10 } },
                h("button", { type: "button", className: "SPR_miniBtn", onClick: () => props.setNotice(null) }, T("关闭"))
              )
            )
          : null,
        h(SpriteProjectArea, props)
      )
    );
  }

  // ── 面板本体 ─────────────────────────────────────────────────────────────
  function StudioPanel(props: any) {
    // 渲染计数：真机在控制台 __GMM_PERF__.renderCount("StudioPanel") 可看（验证「一次轮询最多重渲染几次」）。
    markRender("StudioPanel");
    const localeTick = useLocaleTick();
    const api = props?.api;
    // 粗粒度订阅：项目 id（切项目才变，轮询不变）+ 有项目与否交给下面的组件。
    const projectId = store.use((state: any) => state.projectId);
    const [stage, setStage] = React.useState("images");
    const [module, setModule] = React.useState("sprite");
    const [notice, setNotice] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
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
    const loadedPrompts = React.useRef({ projectId: null, images: {}, video: "", signature: "" });

    /** 草稿写入器：store 内置内容短路（内容没变不通知），组件按切片订阅。 */
    const setPromptDraft = actions.setPromptDraft;
    const setVideoPromptDraft = actions.setVideoPromptDraft;
    const setSettingsDraft = actions.setSettingsDraft;
    const setPromptOpen = actions.setPromptOpen;

    const visibleModules = visibleModulesOf(hidden);
    /**
     * 真正渲染的模块：当前选中项被隐藏（或压根不存在）时落到第一个可见模块。
     *
     * 不用等 `useEffect` 把 state 改回来——那样会先渲染一帧隐藏模块，
     * 深链接进被隐藏的模块时就会闪一下它的界面。
     */
    const activeModule =
      visibleModules.some((entry: any) => entry.key === module) ? module : visibleModules.length > 0 ? visibleModules[0].key : null;

    React.useEffect(() => {
      if (activeModule !== null && activeModule !== module) setModule(activeModule);
    }, [activeModule, module]);

    React.useEffect(() => {
      if (intent === null) return;
      if (typeof intent.module === "string") setModule(intent.module);
      if (typeof intent.projectId === "string") actions.setProjectId(intent.projectId);
      if (typeof intent.stage === "string" && STAGES.some((item: any) => item.key === intent.stage)) setStage(intent.stage);
    }, [intent]);

    const refreshProjects = React.useCallback(async () => {
      if (api === undefined) return [];
      try {
        const result = await api.listProjects();
        actions.setProjects(result.projects ?? []);
        return result.projects ?? [];
      } catch (error) {
        setNotice({ kind: "error", text: msg(error) });
        return [];
      }
    }, [api]);

    const loadProject = React.useCallback(
      async (id: any, options: any = {}) => {
        if (api === undefined || id === null) return;
        try {
          const next = await api.getProject(id);

          const previous = loadedPrompts.current;
          // 内容没变就别 setState（轮询的绝大多数时刻都是这种情况）。
          const signature = JSON.stringify(next ?? null);
          const forceUpdate = options.resetDrafts === true;
          if (!forceUpdate && previous.projectId === id && signature === previous.signature) return;
          // 换项目、或用户明确点了「重置为默认」：草稿整份换成宿主的。
          const force = options.resetDrafts === true || previous.projectId !== id;
          const images = { ...(next.prompts?.images ?? {}) };
          const video = next.prompts?.video ?? "";
          loadedPrompts.current = { projectId: id, images, video, signature };
          // 一次回包是多处写入：batch 合并成一次通知（否则订阅者会被连续叫醒两次）。
          store.batch(() => {
            actions.setProject(next);
            setPromptDraft((current) => mergeDrafts(current, previous.images, images, force));
            setVideoPromptDraft((current) => mergeDrafts(current, previous.video, video, force));
            setSettingsDraft({ ...(next.settings ?? {}) });
            setPromptOpen((current) => {
              const keys = Object.keys(current);
              if (keys.length > 0) return current;
              return {};
            });
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
        if (list.length > 0) {
          const current = store.getState().projectId;
          if (current === null) actions.setProjectId(list[0].id);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [refreshProjects]);

    React.useEffect(() => {
      if (projectId === null) {
        actions.clearProject();
        return;
      }
      void loadProject(projectId);
      // `localeTick` 也在依赖里：内置默认提示词存在宿主侧，界面重渲染换不掉它们，
      // 语言一变就得重新拉一次项目（宿主会把「从没改过」的提示词换成新语言的默认值）。
    }, [projectId, loadProject, localeTick]);

    // 有任务在跑时轮询；跑完自动停。
    // ★ 这里**不订阅渲染**：busy 从 store.getState() 现读，store.subscribe 里决定开/停，
    //   所以「任务开始/结束」不会让面板重渲染（那是整棵子树重画的旧病根）。
    React.useEffect(() => {
      if (projectId === null) return undefined;
      let handle: any = null;
      const stop = () => {
        if (handle !== null) {
          handle.cancel();
          handle = null;
        }
      };
      const sync = () => {
        const polling = projectBusy(store.getState().project) || tasks.active;
        if (polling) {
          if (handle === null) {
            // 走集中调度器：同 key 去重、失败退避、页面隐藏暂停（原来是面板自己的周期定时器）。
            handle = scheduler.watch({
              key: "project:" + String(projectId) + ":busy",
              intervalMs: 2500,
              immediate: false,
              run: () => loadProject(projectId)
            });
          }
        } else {
          stop();
        }
      };
      sync();
      const unsubscribe = store.subscribe(sync);
      return () => {
        unsubscribe();
        stop();
      };
    }, [projectId, loadProject, scheduler, tasks]);

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
      async (fn: any, options: any = {}) => {
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
          actions.setProjectId(created.projectId);
        },
        { notice: T("已创建新项目") }
      );
    };

    const savePrompts = (patch: any) =>
      withApi(() => api.savePrompts({ projectId: store.getState().project?.id, ...patch }), {
        reload: true,
        notice: T("提示词已保存"),
        noticeKind: "ok"
      });

    const saveSettings = (patch: any) =>
      withApi(() => api.saveSettings({ projectId: store.getState().project?.id, settings: patch }), {
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
    const start = async (fn: any, done: any, feedback?: any) => {
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

    if (api === undefined) {
      return h("div", { className: "SPR_root" }, h("p", { className: "SPR_empty" }, T("正在挂载游戏素材大师…")));
    }

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
          ? h(SpriteProjectHead, {
              api,
              loading,
              refreshProjects,
              createProject,
              withApi,
              setNotice,
              loadProject
            })
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
        visibleModules.map((entry: any) =>
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
        : activeModule === "sprite"
          ? h(SpriteWorkbench, {
              api,
              tasks,
              stage,
              setStage,
              notice,
              setNotice,
              loading,
              refreshProjects,
              loadProject,
              start,
              savePrompts,
              saveSettings,
              createProject,
              withApi
            })
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
