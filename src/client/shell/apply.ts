/**
 * 浏览器半区 · 装配入口（shell/apply）。
 *
 * DSH 加载插件时调用 apply(ctx)：注入样式、挂远程服务、注册工作台与设置页两个 slot。
 * 这里只管「和宿主接线」，界面本身在 shell/composition.ts 里装好之后传进来。
 */

import { createApiClient, createMethodSpecs, preparePaidPayload } from "../platform/api.js";
import { provideRuntime } from "../platform/runtime.js";
import type { ApplyDeps } from "../platform/deps.js";

export function createApply(deps: ApplyDeps) {
  // 依赖：组合根注入的键由 platform/deps 的 ApplyDeps 钉住，解构这里按需展开。
  const {
    attachI18n,
    attachSessionBridge,
    PACKAGE,
    CONTRIBUTION,
    SERVICE,
    T,
    activeLang,
    installIntentInterceptor,
    intentListeners,
    CSS,
    clearPendingIntent,
    reportClientOrigin,
    consumeUrlIntent,
    GAME_STUDIO_PANEL_ID,
    StudioGlyph,
    StudioPanel,
    ConfigSection,
  } = deps;

    function apply(ctx) {
      // 界面文案跟随 DSH 的语言设置；服务不可用时安静地退回中文原文。
      attachI18n(ctx);
      // 新对话桥：拿浏览器的 sessions / uiWorkspace（可选依赖，缺了只影响「AI 生成素材」）。
      attachSessionBridge(ctx);

      // 样式随 fiber 生命周期注入/移除。
      ctx.effect(() => {
        if (typeof document === "undefined") return () => {};
        const style = document.createElement("style");
        style.setAttribute("data-plugin", PACKAGE);
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => {
          style.remove();
        };
      }, `${PACKAGE}: styles`);

      const mount = ctx.remote.$mount(CONTRIBUTION);

      /**
       * 发一次远程调用：等挂载完成 → 取远程服务 → 校验返回壳。
       *
       * 只管「怎么把请求发出去」。超时、重试、并发去重、错误归一化由
       * `platform/api` 的 ApiClient 负责。
       */
      const invoke = async (method: string, payload: unknown): Promise<unknown> => {
        await mount;
        const remote = ctx.get(`remote.${SERVICE}`);
        if (remote === undefined) throw new Error(T("gameStudio 远程服务不可用，请确认插件已启用"));
        // 付费方法必须带 confirm + requestId（confirm 已由 ApiClient 校验，这里补幂等键；非付费方法原样透传）。
        const prepared = preparePaidPayload(method, payload);
        const result = prepared === undefined ? await remote[method]() : await remote[method](prepared);
        if (result === null || typeof result !== "object" || result.ok !== true) {
          const detail = result?.error;
          const failure = new Error(
            detail === undefined ? T("{n0} 调用失败", { n0: method }) : `${detail.code ?? "ERROR"}: ${detail.message ?? ""}`
          ) as Error & { code?: string; retriable?: boolean };
          failure.code = detail?.code ?? "unknown-error";
          failure.retriable = detail?.retriable === true;
          throw failure;
        }
        return result.value;
      };

      const apiClient = createApiClient({
        invoke,
        methods: createMethodSpecs(),
        // 抽帧 / 合图 / 导出是同步 await 的长任务，默认超时会把它们误判成失败。
        defaultTimeoutMs: 0
      });

      // 运行时可取到同一个客户端：模块里 `studio().api` 与组件里的 `props.api` 同源。
      provideRuntime({ api: apiClient });

      /** 普通调用：只读方法自动重试与并发去重，写方法原样发一次。 */
      const call = (method: string, payload?: any): Promise<any> => apiClient.call<any>(method, payload);

      /**
       * 付费方法的唯一通道。
       *
       * 用户点的那次按钮本身已经写明「计费 / 会消耗积分」，这里替它打上
       * `confirm: true`（平台层还会再校验一次）；幂等键 `requestId` 由
       * `preparePaidPayload` 在 invoke 里补齐——同一笔提交的重试要靠宿主 receipt
       * 按指纹挡住，不是靠这里复用 key。
       */
      const callPaid = (method: string, payload: any = {}): Promise<any> =>
        apiClient.call<any>(method, { confirm: true, ...payload }, { kind: "paid", confirm: true });

      const api = {
        getConfig: () => call("getConfig"),
        saveConfig: (payload) => call("saveConfig", payload),
        testArk: () => callPaid("testArk"),
        testCustomImage: () => call("testCustomImage"),
        testMinimax: () => call("testMinimax"),
        testComfy: () => call("testComfy"),
        listProjects: () => call("listProjects"),
        createProject: (payload) => call("createProject", payload),
        // 内置默认提示词存在宿主侧，所以「读」和「重置为默认」都要把当前界面语言带过去：
        // getProject 借它把「从没改过」的提示词换成目标语言的默认值，
        // savePrompts 借它决定「重置为默认」重置成哪国话（`...payload` 在后，显式传的优先）。
        getProject: (projectId) => call("getProject", { projectId, lang: activeLang() }),
        deleteProject: (payload) => call("deleteProject", payload),
        renameProject: (payload) => call("renameProject", payload),
        uploadSource: (payload) => call("uploadSource", payload),
        savePrompts: (payload) => call("savePrompts", { lang: activeLang(), ...payload }),
        saveSettings: (payload) => call("saveSettings", payload),
        setApproved: (payload) => call("setApproved", payload),
        revealProject: (payload) => call("revealProject", payload),
        uploadVideo: (payload) => call("uploadVideo", payload),
        exportImages: (payload) => call("exportImages", payload),
        runImage: (payload) => callPaid("runImage", payload),
        runImages: (payload) => callPaid("runImages", payload),
        setImageMode: (payload) => call("setImageMode", payload),
        runTurnVideo: (payload) => callPaid("runTurnVideo", payload),
        runTurnFrames: (payload) => call("runTurnFrames", payload),
        setTurnPick: (payload) => call("setTurnPick", payload),
        setTurnPicks: (payload) => call("setTurnPicks", payload),
        resetTurnPicks: (payload) => call("resetTurnPicks", payload),
        cutTurnFrames: (payload) => call("cutTurnFrames", payload),
        runVideos: (payload) => callPaid("runVideos", payload),
        pollVideos: (payload) => call("pollVideos", payload),
        clearVideos: (payload) => call("clearVideos", payload),
        runFrames: (payload) => call("runFrames", payload),
        prepareFramePick: (payload) => call("prepareFramePick", payload),
        setFramePick: (payload) => call("setFramePick", payload),
        setFramePicks: (payload) => call("setFramePicks", payload),
        resetFramePicks: (payload) => call("resetFramePicks", payload),
        rekey: (payload) => call("rekey", payload),
        compose: (payload) => call("compose", payload),

        listImageJobs: () => call("listImageJobs"),
        createImageJob: (payload) => call("createImageJob", payload),
        getImageJob: (jobId) => call("getImageJob", { jobId }),
        deleteImageJob: (payload) => call("deleteImageJob", payload),
        saveImageJob: (payload) => call("saveImageJob", payload),
        uploadImageRef: (payload) => call("uploadImageRef", payload),
        removeImageRef: (payload) => call("removeImageRef", payload),
        addImageItem: (payload) => call("addImageItem", payload),
        removeImageItem: (payload) => call("removeImageItem", payload),
        runImageJob: (payload) => callPaid("runImageJob", payload),
        keyImageJob: (payload) => call("keyImageJob", payload),

        listSequenceJobs: () => call("listSequenceJobs"),
        createSequenceJob: (payload) => call("createSequenceJob", payload),
        getSequenceJob: (jobId) => call("getSequenceJob", { jobId }),
        deleteSequenceJob: (payload) => call("deleteSequenceJob", payload),
        saveSequenceJob: (payload) => call("saveSequenceJob", payload),
        uploadSequenceRef: (payload) => call("uploadSequenceRef", payload),
        removeSequenceRef: (payload) => call("removeSequenceRef", payload),
        runSequenceVideo: (payload) => callPaid("runSequenceVideo", payload),
        pollSequenceVideo: (payload) => call("pollSequenceVideo", payload),
        clearSequenceVideo: (payload) => call("clearSequenceVideo", payload),
        runSequenceFrames: (payload) => call("runSequenceFrames", payload),
        keySequenceFrames: (payload) => call("keySequenceFrames", payload),
        composeSequence: (payload) => call("composeSequence", payload),
        setReviewMode: (payload) => call("setReviewMode", payload),
        reportClientOrigin: (payload) => call("reportClientOrigin", payload),

        // 模块④：骨骼动画生成。
        // 注意：这张表必须与上面的 REMOTE_METHODS 逐条对应——REMOTE_METHODS 只负责
        // 向宿主的远程服务**声明**方法名，真正的方法体是在这里逐个挂到 api 上的。
        // 只加声明、忘了加这里，界面就会在调用时报 “api.xxx is not a function”。
        // scripts/verify-client.mjs 里有一条契约专门盯这件事。
        listRigJobs: () => call("listRigJobs"),
        createRigJob: (payload) => call("createRigJob", payload),
        getRigJob: (payload) => call("getRigJob", payload),
        deleteRigJob: (payload) => call("deleteRigJob", payload),
        saveRigJob: (payload) => call("saveRigJob", payload),
        uploadRigSource: (payload) => call("uploadRigSource", payload),
        uploadRigPart: (payload) => call("uploadRigPart", payload),
        removeRigPart: (payload) => call("removeRigPart", payload),
        renameRigPart: (payload) => call("renameRigPart", payload),
        setRigPartVisibility: (payload) => call("setRigPartVisibility", payload),
        saveRigLayoutItem: (payload) => call("saveRigLayoutItem", payload),
        saveRigLayoutItems: (payload) => call("saveRigLayoutItems", payload),
        setRigLayoutHints: (payload) => call("setRigLayoutHints", payload),
    setRigSemantics: (payload) => call("setRigSemantics", payload),
    setRigBoneOffsets: (payload) => call("setRigBoneOffsets", payload),
    resetRigBoneOffsets: (payload) => call("resetRigBoneOffsets", payload),
    setRigAnimationSettings: (payload) => call("setRigAnimationSettings", payload),
    resetRigAnimationSettings: (payload) => call("resetRigAnimationSettings", payload),
    getRigAnimation: (payload) => call("getRigAnimation", payload),
    saveRigAnimation: (payload) => call("saveRigAnimation", payload),
    resetRigAnimation: (payload) => call("resetRigAnimation", payload),
    runRigQa: (payload) => call("runRigQa", payload),
    setRigConstraints: (payload) => call("setRigConstraints", payload),
    resetRigConstraints: (payload) => call("resetRigConstraints", payload),
    setRigMesh: (payload) => call("setRigMesh", payload),
    resetRigMesh: (payload) => call("resetRigMesh", payload),
    setRigPath: (payload) => call("setRigPath", payload),
    resetRigPath: (payload) => call("resetRigPath", payload),
    tintRigParts: (payload) => call("tintRigParts", payload),
    uploadRigTexture: (payload) => call("uploadRigTexture", payload),
    setRigTextureVersion: (payload) => call("setRigTextureVersion", payload),
    removeRigTextureVersion: (payload) => call("removeRigTextureVersion", payload),
    runRigRedraw: (payload) => callPaid("runRigRedraw", payload),
        runRigSheet: (payload) => callPaid("runRigSheet", payload),
        runRigSegment: (payload) => call("runRigSegment", payload),
        runRigLayout: (payload) => call("runRigLayout", payload),
        runRigBones: (payload) => call("runRigBones", payload),
        runRigAtlas: (payload) => call("runRigAtlas", payload),

        // 45° 地图编辑器（模块五 · iso）：全本地，没有一步收费
        listIsoProjects: () => call("listIsoProjects"),
        createIsoProject: (payload) => call("createIsoProject", payload),
        getIsoProject: (payload) => call("getIsoProject", payload),
        saveIsoProject: (payload) => call("saveIsoProject", payload),
        deleteIsoProject: (payload) => call("deleteIsoProject", payload),
        importIsoTileset: (payload) => call("importIsoTileset", payload),
        importIsoSampleTileset: (payload) => call("importIsoSampleTileset", payload),
        composeIsoAsset: (payload) => call("composeIsoAsset", payload),
        saveIsoTileset: (payload) => call("saveIsoTileset", payload),
        removeIsoTileset: (payload) => call("removeIsoTileset", payload),
        saveIsoDoc: (payload) => call("saveIsoDoc", payload),
        applyIsoOps: (payload) => call("applyIsoOps", payload),
        isoUndo: (payload) => call("isoUndo", payload),
        isoRedo: (payload) => call("isoRedo", payload),
        isoPlan: (payload) => call("isoPlan", payload),
        isoInspect: (payload) => call("isoInspect", payload),
        isoRender: (payload) => call("isoRender", payload),
        runIsoGenerate: (payload) => call("runIsoGenerate", payload),
        runIsoPreview: (payload) => call("runIsoPreview", payload),
        runIsoExport: (payload) => call("runIsoExport", payload),
        cancelIsoJob: (payload) => call("cancelIsoJob", payload),
        setIsoApproved: (payload) => call("setIsoApproved", payload),
        revealIsoProject: (payload) => call("revealIsoProject", payload),

        // 俯视地图编辑器（模块六）：全本地，没有一步收费
        listMapProjects: () => call("listMapProjects"),
        createMapProject: (payload) => call("createMapProject", { lang: activeLang(), ...payload }),
        getMapProject: (payload) => call("getMapProject", { lang: activeLang(), ...payload }),
        saveMapProject: (payload) => call("saveMapProject", payload),
        deleteMapProject: (payload) => call("deleteMapProject", payload),
        importMapTileset: (payload) => call("importMapTileset", payload),
        importSampleTileset: (payload) => call("importSampleTileset", payload),
        // 界面不发起这一步（它是对话里 agent 的活），但方法清单必须与宿主一致，
        // 所以照样挂一条 —— 少一条 verify-tools 的「客户端清单覆盖全部方法」就红。
        composeMapAsset: (payload) => call("composeMapAsset", payload),
        recomposeMapTileset: (payload) => call("recomposeMapTileset", payload),
        saveMapTileset: (payload) => call("saveMapTileset", payload),
        removeMapTileset: (payload) => call("removeMapTileset", payload),
        saveMapDoc: (payload) => call("saveMapDoc", payload),
        applyMapOps: (payload) => call("applyMapOps", payload),
        mapUndo: (payload) => call("mapUndo", payload),
        mapRedo: (payload) => call("mapRedo", payload),
        mapPlan: (payload) => call("mapPlan", payload),
        mapInspect: (payload) => call("mapInspect", payload),
        mapRender: (payload) => call("mapRender", payload),
        runMapGenerate: (payload) => call("runMapGenerate", payload),
        runMapPreview: (payload) => call("runMapPreview", payload),
        runMapExport: (payload) => call("runMapExport", payload),
        cancelMapJob: (payload) => call("cancelMapJob", payload),
        setMapApproved: (payload) => call("setMapApproved", payload),
        revealMapProject: (payload) => call("revealMapProject", payload),
        // 音乐生成编辑（模块七）
        testMusic: () => call("testMusic"),
        getMusicGuide: (payload) => call("getMusicGuide", payload ?? {}),
        listMusicJobs: () => call("listMusicJobs"),
        createMusicJob: (payload) => call("createMusicJob", payload),
        getMusicJob: (payload) => call("getMusicJob", { ...payload, lang: activeLang() }),
        getMusicScoreGuide: (payload) => call("getMusicScoreGuide", { ...payload, lang: activeLang() }),
        testMusicScore: () => call("testMusicScore"),
        saveMusicScorePlan: (payload) => call("saveMusicScorePlan", payload),
        runMusicScore: (payload) => call("runMusicScore", payload),
        submitMusicScoreToSuno: (payload) => callPaid("submitMusicScoreToSuno", payload),
        saveMusicJob: (payload) => call("saveMusicJob", payload),
        deleteMusicJob: (payload) => call("deleteMusicJob", payload),
        setMusicApproved: (payload) => call("setMusicApproved", payload),
        revealMusicJob: (payload) => call("revealMusicJob", payload),
        runMusicGeneration: (payload) => callPaid("runMusicGeneration", payload),
        cancelMusicGeneration: (payload) => call("cancelMusicGeneration", payload),
        refreshMusicJob: (payload) => call("refreshMusicJob", payload),
        getMusicWav: (payload) => call("getMusicWav", payload),
        getMusicLrc: (payload) => call("getMusicLrc", payload),
        listMusicHistory: (payload) => call("listMusicHistory", payload ?? {}),
        listMusicStemInstruments: () => call("listMusicStemInstruments"),
        runMusicTool: (payload) => callPaid("runMusicTool", payload),
        musicPeaks: (payload) => call("musicPeaks", payload),
        renderMusicEdit: (payload) => call("renderMusicEdit", payload),
        saveMusicVersion: (payload) => call("saveMusicVersion", payload),
        deleteMusicVersion: (payload) => call("deleteMusicVersion", payload),
        exportMusic: (payload) => call("exportMusic", payload),
        // 音效生成（模块八）
        testSfx: () => callPaid("testSfx"),
        listSfxJobs: () => call("listSfxJobs"),
        createSfxJob: (payload) => call("createSfxJob", payload),
        getSfxJob: (payload) => call("getSfxJob", payload),
        saveSfxJob: (payload) => call("saveSfxJob", payload),
        deleteSfxJob: (payload) => call("deleteSfxJob", payload),
        uploadSfxRef: (payload) => call("uploadSfxRef", payload),
        removeSfxRef: (payload) => call("removeSfxRef", payload),
        runSfxGeneration: (payload) => callPaid("runSfxGeneration", payload),
        cancelSfxGeneration: (payload) => call("cancelSfxGeneration", payload),
        setSfxApproved: (payload) => call("setSfxApproved", payload),
        revealSfxJob: (payload) => call("revealSfxJob", payload),
        exportSfx: (payload) => call("exportSfx", payload)
      };

      // ── 深链接：会话里的链接点一下切到本插件页面 ─────────────────────
      // 拦截器与生命周期绑定：插件停止 / 更新时监听器一定被摘掉。
      ctx.effect(() => {
        const disposeInterceptor = installIntentInterceptor(ctx);
        return () => {
          disposeInterceptor();
          intentListeners.clear();
          clearPendingIntent();
        };
      }, T("{n0}: 深链接拦截", { n0: PACKAGE }));

      // 上报 origin（宿主据此拼可点链接），并处理「直接以深链接打开」的兜底路径。
      ctx.effect(() => {
        reportClientOrigin(api);
        consumeUrlIntent(ctx);
        return () => {};
      }, T("{n0}: 深链接引导", { n0: PACKAGE }));

      // 侧栏全局面板图标；id 与 main 的 key 必须一致，点击即切到工作台。
      // 额外注入 api / studioCtx：图标右下角的菜单按钮要靠它们读可见性、
      // 并在选中某一项时切到对应模块（`openStudioIntent`）。
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: GAME_STUDIO_PANEL_ID,
            order: 40,
            label: () => T("墨盒"),
            inject: () => ({ api, studioCtx: ctx })
          },
          StudioGlyph
        )
      );

      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: GAME_STUDIO_PANEL_ID,
            // `studioCtx` 一并注入：地图编辑器的「AI 生成素材」要借它开新对话
            // （侧栏那一份已经这么注入了）。
            inject: () => ({ api, studioCtx: ctx })
          },
          StudioPanel
        )
      );

      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: GAME_STUDIO_PANEL_ID,
            order: 18,
            label: () => T("墨盒"),
            inject: () => ({ api })
          },
          ConfigSection
        )
      );
    }

  return apply;
}
