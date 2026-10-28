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
import { createEngineExportCard } from "./shell/components/engine-export-card.js";

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
  /** 引擎导出卡（与模块③ 共用同一份实现，只是传 projectId / jobId 不同）。 */
  const EngineExportCard = createEngineExportCard({ React, h, T, Btn, BusyBtn, msg });

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

  /** 项目列表（侧栏「当前项目」卡片展开的弹层内容；只在项目列表 / 当前选中项变化时重渲染）。 */
  function SpriteProjectList() {
    markRender("SpriteProjectList");
    const projects = store.use((state: any) => state.projects);
    const projectId = store.use((state: any) => state.projectId);
    return h(
      React.Fragment,
      null,
      h("div", { className: "SPR_projPopHead" }, T("项目（{n0}）", { n0: projects.length })),
      projects.length === 0
        ? h("p", { className: "SPR_sideEmpty" }, T("还没有项目，点上方「新建项目」开始。"))
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

  /** 五个阶段：顶部步骤条整卡（编号圆 + 标题，整块可点）。只订阅「各阶段是否已通过」。 */
  function SpriteStepBar(props: any) {
    markRender("SpriteStepBar");
    const flags = store.use(
      (state: any) => (state.project === null ? NO_STAGE_FLAGS : STAGES.map((item: any) => stageDone(state.project, item.key))),
      shallowEqual
    );
    return h(
      "div",
      { className: "SPR_stepBar", role: "tablist", "aria-label": T("生成流程") },
      STAGES.map((item: any, index: number) =>
        h(
          "button",
          {
            key: item.key,
            type: "button",
            role: "tab",
            "aria-selected": item.key === props.stage ? "true" : "false",
            className: "SPR_stepCard",
            "data-stage": item.key,
            "data-active": item.key === props.stage ? "true" : "false",
            "data-done": flags[index] ? "true" : "false",
            onClick: () => props.setStage(item.key)
          },
          h("span", { className: "SPR_stepNum" }, String(index + 1).padStart(2, "0")),
          // 阶段标题自带「①…」前缀，编号圆已经表达过序号，这里剥掉避免「① ①八方向绿幕图」。
          h("span", { className: "SPR_stepLabel" }, String(item.title).replace(/^[\s\u2460-\u2473\d.、]+/, "") || item.title)
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

    const hasSource = project?.source !== null && project?.source !== undefined;
    // 拖拽区 + 三条件清单：阶段①按设计稿把它们放进阶段卡里（bare），其它阶段单独成一卡。
    const dropZone = h(
      "div",
      { className: "SPR_sourceBlock" },
      h(
        "button",
        {
          type: "button",
          className: "SPR_dropZone",
          "data-over": dropOver ? "true" : "false",
          "data-has": hasSource ? "true" : "false",
          "data-testid": "gmm-source-drop",
          onClick: () => fileInputRef.current?.click(),
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
        hasSource
          ? h("img", {
              className: "SPR_dropThumb",
              src: assetUrl(project, project.source.file, project.updatedAt),
              alt: T("源图")
            })
          : h("span", { className: "SPR_dropIcon" }, h(ModuleIcon, { name: "sprite", size: 22 })),
        h("span", { className: "SPR_dropTitle" }, sourceBusy ? T("正在上传…") : hasSource ? T("已上传源图") : T("拖入角色设定图")),
        h("span", { className: "SPR_dropSub" }, T("PNG / JPG / WebP，最大 20 MB")),
        h("span", { className: "SPR_dropPick" }, hasSource ? T("更换图片") : T("选择图片"))
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
      }),
      h(
        "div",
        { className: "SPR_tips" },
        h("h4", { className: "SPR_tipsTitle" }, T("一张合适的源图，会减少后续返工")),
        h("p", { className: "SPR_tipsText" }, T("上传后，八个方向都以这张图作为唯一角色参考。")),
        h(
          "ol",
          { className: "SPR_tipsList" },
          h("li", { className: "SPR_tip" }, h("span", { className: "SPR_tipNo" }, "01"), h("span", { className: "SPR_tipText" }, T("正面全身，四肢完整无遮挡"))),
          h("li", { className: "SPR_tip" }, h("span", { className: "SPR_tipNo" }, "02"), h("span", { className: "SPR_tipText" }, T("纯色背景，轮廓清晰"))),
          h("li", { className: "SPR_tip" }, h("span", { className: "SPR_tipNo" }, "03"), h("span", { className: "SPR_tipText" }, T("不添加文字、水印或场景道具")))
        )
      )
    );

    // bare：不套卡片、不重复标题（阶段①把它嵌进阶段卡里）。
    if (props.bare === true) return dropZone;
    return h(
      "div",
      { className: "SPR_card" },
      h("div", { className: "SPR_cardHead" }, h("h3", null, T("源图"))),
      h("p", { className: "SPR_hint" }, T("上传角色的原始设定图。第一步的正面绿幕图会以它为唯一参考。")),
      dropZone
    );
  }

  /** 阶段卡片（左列主卡）：标题 + 提示 + 阶段正文；阶段①在正文前嵌入源图拖拽区。 */
  function SpriteStageArea(props: any) {
    markRender("SpriteStageArea");
    const activeStageIndex = STAGES.findIndex((item: any) => item.key === props.stage);
    const activeStage = STAGES[activeStageIndex < 0 ? 0 : activeStageIndex];
    const hint = store.use((state: any) => (state.project === null ? "" : stageHint(state.project, props.stage, activeStage)));
    const head = store.use(
      (state: any) => ({
        hasSource: state.project?.source !== null && state.project?.source !== undefined,
        done: state.project === null ? false : stageDone(state.project, props.stage)
      }),
      shallowEqual
    );
    // 头部的状态胶囊：没源图时「等待源图」（设计稿同款），已通过时「已完成」。
    const chip =
      props.stage === "images" && !head.hasSource
        ? h("span", { className: "SPR_chip" }, T("等待源图"))
        : head.done
          ? h("span", { className: "SPR_chip", "data-kind": "ok" }, T("已完成"))
          : null;
    return h(
      React.Fragment,
      null,
      h(
        "div",
        { className: "SPR_panel" },
        h(
          "div",
          { className: "SPR_panelHead" },
          h(
            "div",
            { className: "SPR_panelHeadMain" },
            // 阶段标题自带「①…」前缀：步骤条与面板标题都不再重复序号。
            h("h2", { className: "SPR_panelTitle" }, String(activeStage.title).replace(/^[\s\u2460-\u2473\d.、]+/, "") || activeStage.title),
            // 阶段①的说明跟着生成方式走：转圈截帧不是「八个方向各生成一次」，
            // 沿用逐方向生图那句话会让人以为走错了页面。
            h("p", { className: "SPR_panelSub" }, hint)
          ),
          chip === null ? null : h("div", { className: "SPR_panelHeadAside" }, chip)
        ),
        h(
          "div",
          { className: "SPR_panelBody" },
          props.stage === "images"
            ? h(SpriteSourceCard, {
                bare: true,
                api: props.api,
                loadProject: props.loadProject,
                setNotice: props.setNotice
              })
            : null,
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
          // 整图出来之后才谈得上「进引擎」：卡片挂在阶段④ 下方（模块③ 里挂在合成卡之后）。
          props.stage === "sheet" ? h(SpriteEngineExport, { api: props.api, setNotice: props.setNotice }) : null,
          props.stage === "preview" ? h(WalkPreview, { tasks: props.tasks }) : null
        )
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

  /**
   * 阶段④（sheet）下方的「引擎导出」卡。
   *
   * 只订阅「当前项目 id / 产物基址 / 整图是否就绪 / 上次导出记录」这几段：
   * 生成视频、抽帧这些无关变更不该把这个卡片拖着重渲染。
   */
  function SpriteEngineExport(props: any) {
    markRender("SpriteEngineExport");
    const view = store.use(
      (state: any) => ({
        id: state.project?.id ?? null,
        assetBase: state.project?.assetBase ?? "",
        ready: state.project?.sheet?.status === "ready",
        lastExport: state.project?.export ?? null
      }),
      shallowEqual
    );
    if (view.id === null) return null;
    return h(EngineExportCard, {
      api: props.api,
      assetBase: view.assetBase,
      target: { projectId: view.id },
      ready: view.ready,
      lastExport: view.lastExport,
      setNotice: props.setNotice
    });
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
   * 右列「本步设置」：设计稿四行 —— 候选帧数 / 转圈方向 / 输出规格 / 审核方式。
   *
   * 前两行是**真实参数**，值做成可点改的浅色块：
   *   · 候选帧数 = `settings.turnFrameCount`（8~512，宿主 saveSettings 会顺手把候选帧标脏并自动重抽）；
   *   · 转圈方向 = `turn.direction`（点一下走已有的 resetTurnPicks 换向 + 重排八个圆圈）。
   * 后两行只读：输出规格跟随 `settings.frameCount`；审核方式由页头胶囊负责修改，这里只显示当前值
   * （两处同时放可改控件会互相打架）。
   */
  function SpriteStageSettings(props: any) {
    markRender("SpriteStageSettings");
    // 一行 store 订阅：四行要的值都在这一个切片里。store.use 是 platform/store 的既有能力
    // （内部 useRef + useSyncExternalStore），加的是**子组件**的 Hook，StudioPanel 仍是 13 个槽位。
    const view = store.use(
      (state: any) => {
        const project = state.project;
        const settings = project?.settings;
        const turnFrames = Number(settings?.turnFrameCount);
        const frameCount = Number(settings?.frameCount ?? settings?.frames);
        return {
          id: project?.id ?? null,
          turn: Number.isFinite(turnFrames) && turnFrames > 0 ? Math.round(turnFrames) : 32,
          frames: Number.isFinite(frameCount) && frameCount > 0 ? Math.round(frameCount) : null,
          direction: project?.turn?.direction === "ccw" ? "ccw" : "cw",
          review: project?.reviewMode === "manual" ? "manual" : project?.reviewMode === "auto" ? "auto" : ""
        };
      },
      shallowEqual
    );
    // 候选帧数的输入草稿（null = 跟着宿主值走）、正在提交哪一行、错误行。
    const [countDraft, setCountDraft] = React.useState(null);
    const [saving, setSaving] = React.useState(null);
    const [error, setError] = React.useState(null);
    // 与宿主 src/directions.ts 的 TURN_FRAME_COUNT_MIN / _MAX 一致；宿主也会 clamp，这里先夹一遍。
    const TURN_MIN = 8;
    const TURN_MAX = 512;
    /** 候选帧数：走已有的 saveSettings（宿主会标脏候选帧，有视频时还会自动重抽）。 */
    const commitTurnFrameCount = async () => {
      const parsed = countDraft === null ? view.turn : Number(countDraft);
      const next = Number.isFinite(parsed) ? Math.min(TURN_MAX, Math.max(TURN_MIN, Math.round(parsed))) : view.turn;
      setCountDraft(String(next));
      if (view.id === null || next === view.turn) {
        setCountDraft(null);
        return;
      }
      setSaving("count");
      try {
        await props.api.saveSettings({ projectId: view.id, settings: { turnFrameCount: next } });
        await props.loadProject(view.id);
        setError(null);
        setCountDraft(null);
      } catch (saveError) {
        setError(msg(saveError));
        setCountDraft(null);
      } finally {
        setSaving(null);
      }
    };
    /** 转圈方向：已有的 resetTurnPicks 既换向又重排八个圆圈（和原来那枚按钮同一条路）。 */
    const toggleTurnDirection = async () => {
      if (view.id === null || saving !== null) return;
      const next = view.direction === "ccw" ? "cw" : "ccw";
      setSaving("direction");
      try {
        await props.api.resetTurnPicks({ projectId: view.id, direction: next });
        await props.loadProject(view.id);
        setError(null);
      } catch (saveError) {
        setError(msg(saveError));
      } finally {
        setSaving(null);
      }
    };
    const reviewText = view.review === "auto" ? T("自动审核") : view.review === "manual" ? T("逐步审核") : T("未设置审核");
    const specText =
      view.frames === null ? T("8 方向 × 8 帧") : T("{n0} 方向 × {n1} 帧", { n0: DIRECTION_KEYS.length, n1: view.frames });
    return h(
      "div",
      { className: "SPR_railCard", "data-card": "settings" },
      h("div", { className: "SPR_railHead" }, h("h3", { className: "SPR_railTitle" }, T("本步设置"))),
      // 候选帧数：62×32 的浅色块，点进去改数字，失焦 / 回车提交。
      h(
        "div",
        { className: "SPR_railRow", "data-row": "turn-frames" },
        h("label", { className: "SPR_railLabel", htmlFor: "gmm-rail-turn-frames" }, T("候选帧数")),
        h(
          "span",
          { className: "SPR_railValueWrap" },
          h("input", {
            id: "gmm-rail-turn-frames",
            type: "number",
            className: "SPR_railNum",
            "data-testid": "rail-turn-frame-count",
            "data-busy": saving === "count" ? "true" : undefined,
            min: TURN_MIN,
            max: TURN_MAX,
            step: 1,
            disabled: view.id === null || saving !== null,
            value: countDraft === null ? String(view.turn) : countDraft,
            onChange: (event: any) => setCountDraft(event.target.value),
            onFocus: (event: any) => {
              try {
                event.target.select?.();
              } catch {
                /* 个别浏览器对 number 输入框的 select 有限制，忽略 */
              }
            },
            onBlur: () => void commitTurnFrameCount(),
            onKeyDown: (event: any) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }
          })
        )
      ),
      // 转圈方向：82×32 的浅色块，点一下换向并重排八个圆圈。
      h(
        "div",
        { className: "SPR_railRow", "data-row": "turn-direction" },
        h("span", { className: "SPR_railLabel" }, T("转圈方向")),
        h(
          "button",
          {
            type: "button",
            className: "SPR_railChip",
            "data-testid": "rail-turn-direction",
            "data-busy": saving === "direction" ? "true" : undefined,
            disabled: view.id === null || saving !== null,
            title: T("点一下换向，并按新方向重排八个圆圈"),
            onClick: () => void toggleTurnDirection()
          },
          view.direction === "ccw" ? T("逆时针") : T("顺时针")
        )
      ),
      // 输出规格：只读（在第 4 步「合成精灵整图」里改）。
      h(
        "div",
        { className: "SPR_railRow", "data-row": "output-spec" },
        h("span", { className: "SPR_railLabel" }, T("输出规格")),
        h("span", { className: "SPR_railValue" }, specText)
      ),
      // 审核方式：只读；改在页头那枚胶囊里。
      h(
        "div",
        { className: "SPR_railRow", "data-row": "review-mode" },
        h("span", { className: "SPR_railLabel" }, T("审核方式")),
        h("span", { className: "SPR_railValue SPR_railValue-accent" }, reviewText)
      ),
      error === null ? null : h("p", { className: "SPR_railError" }, error)
    );
  }

  /**
   * 右列「产出预览」：有产物就显示缩略图（整图优先，其次正面 / 任意一张已生成的方向图），
   * 否则保持设计稿同款占位块（260×190 浅灰底 + 居中浅灰字「八方向预览」）。
   */
  function SpriteStagePreview(props: any) {
    markRender("SpriteStagePreview");
    // 只订阅缩略图会用到的几段：别的阶段产物变化不重渲染这一张卡。
    const project = store.use(
      (state: any) => state.project,
      (a: any, b: any) => projectFieldsEqual(a, b, ["assetBase", "images", "sheet", "updatedAt"])
    );
    // 整图是最终产物，优先；还没合图时看方向图（正面最直观，没有再随便挑一张）。
    let file = project?.sheet?.file;
    let version = project?.sheet?.updatedAt ?? project?.updatedAt;
    if (file === undefined || file === null) {
      const readyKeys = DIRECTION_KEYS.filter((key: string) => project?.images?.[key]?.file !== undefined);
      const key = readyKeys.includes("front") ? "front" : readyKeys[0];
      if (key !== undefined) {
        file = project.images[key].file;
        version = project.images[key].updatedAt ?? project.updatedAt;
      }
    }
    const hasPreview = file !== undefined && file !== null;
    return h(
      "div",
      { className: "SPR_railCard", "data-card": "preview" },
      h(
        "div",
        { className: "SPR_railHead" },
        h("h3", { className: "SPR_railTitle" }, T("产出预览")),
        h("span", { className: "SPR_railAside" }, hasPreview ? T("已生成") : T("尚未生成"))
      ),
      h(
        "div",
        { className: "SPR_previewBox" },
        hasPreview ? h("img", { src: assetUrl(project, file, version), alt: T("八方向预览") }) : T("八方向预览")
      ),
      h("p", { className: "SPR_previewCaption" }, T("生成后可逐方向查看、调整截帧位置，或下载全部图片。")),
      h("p", { className: "SPR_previewFoot" }, T("PNG 序列帧 · 本地处理"))
    );
  }

  /**
   * 项目主体：没有项目时是空态；有项目时是「步骤条 + 左列阶段卡 + 右列设置/预览」。
   * 它自己只订阅一个布尔（有没有项目），其余全部下放给各自的组件。
   */
  function SpriteProjectArea(props: any) {
    markRender("SpriteProjectArea");
    const hasProject = store.use((state: any) => state.project !== null);
    if (!hasProject) return h(SpriteProjectEmpty, { loading: props.loading, createProject: props.createProject });
    return h(
      React.Fragment,
      null,
      h(SpriteStepBar, { stage: props.stage, setStage: props.setStage }),
      h(
        "div",
        { className: "SPR_cols" },
        h("div", { className: "SPR_col" }, h(SpriteStageArea, props)),
        h(
          "div",
          { className: "SPR_col" },
          h(SpriteStageSettings, { api: props.api, loadProject: props.loadProject, stage: props.stage }),
          h(SpriteStagePreview, { stage: props.stage })
        )
      )
    );
  }

  /** sprite 模块的整块界面（外壳负责侧栏 / 顶栏 / 页头 / 提示条，这里只出内容）。 */
  function SpriteWorkbench(props: any) {
    markRender("SpriteWorkbench");
    return h(SpriteProjectArea, props);
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
      return h(
        "div",
        { className: "SPR_root" },
        h("p", { className: "SPR_empty" }, T("正在挂载墨盒…"))
      );
    }

    // ── 外壳：侧栏 / 顶栏 / 页头（设计稿 1440×960）────────────────────
    /** 侧栏：品牌 + 新建项目 + 创作工具导航 + 当前项目卡（点开是项目列表弹层）。 */
    function SideBar(props: any) {
      const info = props.info;
      const stageIndex = Math.max(0, STAGES.findIndex((item: any) => item.key === props.stage));
      const reviewLabel =
        info.review === "auto" ? T("自动审核") : info.review === "manual" ? T("逐步审核") : T("未设置审核");
      const framesLabel = info.frames === null || info.frames === undefined ? T("8 帧") : T("{n0} 帧", { n0: info.frames });
      return h(
        "aside",
        { className: "SPR_sidebar" },
        h(
          "div",
          { className: "SPR_brand" },
          h("span", { className: "SPR_brandMark", "aria-hidden": "true" }, h("i", null), h("i", null), h("i", null), h("i", null)),
          h(
            "div",
            { className: "SPR_brandText" },
            h("span", { className: "SPR_brandTitle" }, T("墨盒")),
            h("span", { className: "SPR_brandSub" }, T("AI 游戏资产工作台"))
          )
        ),
        h("button", { type: "button", className: "SPR_newProject", onClick: () => void createProject() }, T("新建项目")),
        h("div", { className: "SPR_sideGroup" }, T("创作工具")),
        h(
          "nav",
          { className: "SPR_nav", "aria-label": T("创作工具") },
          visibleModules.map((entry: any) =>
            h(
              "button",
              {
                key: entry.key,
                type: "button",
                className: "SPR_navItem",
                "data-module": entry.key,
                "data-active": activeModule === entry.key ? "true" : "false",
                "aria-pressed": activeModule === entry.key ? "true" : "false",
                title: entry.title + " — " + entry.hint,
                onClick: () => setModule(entry.key)
              },
              h(
                "span",
                { className: "SPR_navTitleRow" },
                h("span", { className: "SPR_navTitle" }, entry.title),
                entry.experimental === true ? h("span", { className: "SPR_navFlag" }, "· " + T("实验")) : null
              ),
              h("span", { className: "SPR_navHint" }, entry.hint)
            )
          ),
          props.hiddenCount > 0
            ? h("p", { className: "SPR_navHint", style: { padding: "6px 4px 0" } }, T("已隐藏 {n0} 个功能（设置 → 墨盒 → 功能管理）", { n0: props.hiddenCount }))
            : null
        ),
        h(
          "details",
          { className: "SPR_sideProjWrap" },
          h(
            "summary",
            { className: "SPR_sideProject" + (info.id === null ? " SPR_sideProject-empty" : ""), "data-testid": "gmm-sidebar-project" },
            h("span", { className: "SPR_sideProjectLabel" }, T("当前项目")),
            h("span", { className: "SPR_sideProjectName" }, info.id === null ? T("还没有项目") : info.name),
            info.id === null
              ? null
              : h("span", { className: "SPR_sideProjectMeta" }, T("八方向图 · {n0} · {n1}", { n0: framesLabel, n1: reviewLabel })),
            info.id === null
              ? null
              : h("span", { className: "SPR_sideProjectState" }, T("进行中 · 步骤 {n0}/{n1}", { n0: stageIndex + 1, n1: STAGES.length }))
          ),
          h("div", { className: "SPR_projPop" }, h(SpriteProjectList, null))
        )
      );
    }

    /** 顶栏：面包屑 + 本地处理状态 + 设置。 */
    function TopBar() {
      const entry = visibleModules.find((item: any) => item.key === activeModule);
      return h(
        "header",
        { className: "SPR_topbar" },
        h(
          "div",
          { className: "SPR_crumb" },
          h("span", null, T("工作台")),
          h("span", { className: "SPR_crumbSep" }, "/"),
          h("b", null, entry === undefined ? T("墨盒") : entry.title)
        ),
        h("span", { className: "SPR_topSpacer" }),
        h("span", { className: "SPR_topStatus", "data-off": api === undefined ? "true" : "false" }, h("i", null), T("本地处理已连接")),
      );
    }

    /** 页头：模块标题 + 一句说明 + 右侧模块级操作。 */
    function PageHead() {
      const entry = visibleModules.find((item: any) => item.key === activeModule);
      if (entry === undefined) return null;
      return h(
        "div",
        { className: "SPR_pageHead" },
        h(
          "div",
          { className: "SPR_pageHeadMain" },
          h("h1", { className: "SPR_pageTitle" }, entry.title),
          h("p", { className: "SPR_pageSub" }, entry.hint)
        ),
        h(
          "div",
          { className: "SPR_pageActions" },
          // 设计稿：页头右上是一枚「审核方式」胶囊（八方向模块才有审核模式）。
          activeModule === "sprite" ? h("div", { className: "SPR_headPill" }, h(SpriteReviewHost, { api, loadProject })) : null,
          entry.experimental === true ? h("span", { className: "SPR_expTag" }, T("实验性")) : null
        )
      );
    }

    /** 侧栏「当前项目」卡要显示的数据：现读 store，不订阅（面板 Hook 槽位保持 13 个）。 */
    const projectNow = typeof store.getState === "function" ? store.getState().project : null;
    const projectSummary = {
      id: projectNow?.id ?? null,
      name: projectNow?.name ?? "",
      review: projectNow?.reviewMode ?? null,
      frames: projectNow?.settings?.frames ?? null
    };

    return h(
      "div",
      { className: "SPR_root" },
      h(
        "div",
        { className: "SPR_app" },
        h(SideBar, {
          info: projectSummary,
          stage,
          hiddenCount: hidden.length,
          activeModule,
          setModule,
          createProject
        }),
        h(
          "div",
          { className: "SPR_mainCol" },
          h(TopBar, null),
          h(
            "div",
            { className: "SPR_scroll" },
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
            h(PageHead, null),
            activeModule === null
              ? h("p", { className: "SPR_empty" }, T("所有功能都已被隐藏。请到「设置 → 墨盒 → 功能管理」里打开至少一个。"))
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
          )
        )
      )
    );
  }

  return StudioPanel;
}
