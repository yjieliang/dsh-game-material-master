/**
 * dsh-game-material-master —— 浏览器半区。
 *
 * 两块界面：
 *   1. `sidebar.panellist` + `main`(key="gameStudio") —— 主体工作台，
 *      四个阶段的卡片式验收界面，每张图 / 每段视频 / 每组帧都能单独看、
 *      单独改提示词、单独重跑、单独打「通过」。
 *   2. `settings.section` —— API Key、模型与全局默认参数。
 *
 * 这份文件由宿主以 /plugins/dsh-game-material-master/client.js 直接提供给浏览器，
 * 源码可以按模块拆（`src/client/*.ts`），但**产物**必须是不带 import/export 的
 * 经典脚本：宿主把 lib/client.js 当普通脚本直接发给浏览器，`scripts/bundle-client.mjs`
 * 把模块图内联回单文件。React 仍由宿主 `require("react")` 提供，不打进包。
 * 所有 React 元素都用 React.createElement 构造（没有 JSX 编译步骤）。
 */

import { CSS } from "./client/styles.js";
import { createUiKit } from "./client/ui.js";
import { installRuntime } from "./client/platform/runtime.js";
import { perf } from "./client/platform/perf.js";
import { provideRuntime } from "./client/platform/runtime.js";
import { createFeatureBoundary } from "./client/platform/errors.js";
import { createPollScheduler } from "./client/platform/scheduler.js";
import { createSprite } from "./client/features/sprite/index.js";
import { createRig } from "./client/features/rig/index.js";
import { createPrompts } from "./client/infra/prompts.js";
import { EN } from "./client/i18n-en.js";

import { createSfxModule } from "./client/sfx-module.js";

import { createConfigSection } from "./client/config-section.js";

import { createImageModule } from "./client/image-module.js";

import { createSequenceModule } from "./client/sequence-module.js";


import { createMusicModule } from "./client/music-module.js";

import { createIsoModule } from "./client/iso-module.js";

import { createMapModule } from "./client/map-module.js";

import { createStudioPanel } from "./client/studio-panel.js";
import { createModuleIcon } from "./client/module-icon.js";

(window as any).__ModuleLoader__.load({
  id: "dsh-game-material-master",
  factory: (require: any) => {
    const bundleModule = { exports: {} as any };
    Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const h = React.createElement;
    // ── platform 运行时 ───────────────────────────────────────────────────
    // 组合根一次性装入「创建后不再变化」的依赖；模块/组件从这里取，不再逐层传参。
    // 现在只装 React / h / T；api 与 ui 在后续阶段接入（P2 起）。
    // T 是函数声明（会提升），这里引用它没问题。
    installRuntime({ React, h, T });

    // 集中轮询：所有模块共用这一个调度器（去重 / 退避 / 页面隐藏暂停）
    const gmmScheduler = createPollScheduler();
    perf.installGlobal();

    // 真机调试：控制台可看轮询统计（注册数 / 运行数 / 过期跳过 / 退避次数）
    if (typeof window !== "undefined") (window as any).__GMM_SCHEDULER__ = gmmScheduler;

    const PACKAGE = "dsh-game-material-master";
    const SERVICE = "gameStudio";
    /**
     * 工作台在 `main` 槽里的 key，也是侧栏 `sidebar.panellist` 的 id。
     * 深链接要切到的就是它（宿主 src/links.ts 的 PANEL_KEY 必须与它一致）。
     */
    const GAME_STUDIO_PANEL_ID = "gameStudio";

    // ── 多语言（中 / 英）──────────────────────────────────────────────────
    /**
     * 界面文案跟随 DSH 的语言设置（设置 → 通用 → 语言），切换即时生效。
     *
     * 词条表的 key 就是**源码里的中文原文**：
     * 800+ 条文案再维护一张人造 key 表只会多一层对不上号的风险。英文表里没有的
     * 条目原样返回中文——漏译只会「少翻一条」，不会在界面上露出 key。
     *
     * 插值用 `{n0}` 这类占位符（与 @deepseek-ai/dsh-client-locale 同一套规则），
     * 英文可以自由换语序：`T("第 {n0} 帧", { n0: 3 })`。
     */
    const I18N_NS = PACKAGE;
    /**
     * 语言切换后必须重算的模块级文案表。
     *
     * 这些表在模块加载时就求了值（`T()` 是纯函数，模块级调用不会自己变），
     * 不重算的话语言切了它们还停在旧语言——页签标题、方向名这类就属于此列。
     */
    const staticTextRebuilders: Array<() => void> = [
      () => {
        DIRECTIONS = make_DIRECTIONS();
      },
      () => {
        MODULES = make_MODULES();
      },
      () => {
        STAGES = make_STAGES();
      },
      () => {
        MUSIC_ENGINES = make_MUSIC_ENGINES();
      },
      () => {
        MUSIC_PHASES = make_MUSIC_PHASES();
      },
      () => {
        IMAGE_MODES = sprite.rebuildStaticText();
      },
      () => {
        rig.rebuildStaticText();
      },
      () => {
        LABEL_OF = make_LABEL_OF();
      }
    ];

    /** 重算全部模块级文案表（幂等；语言切换与首次挂载都会走一次）。 */
    function rebuildStaticText(): void {
      for (const rebuild of staticTextRebuilders) rebuild();
    }

    /**
     * 中文表是恒等映射。必须写全：locale 服务的回退链是「当前语言 → en」，
     * 只注册 en 的话中文界面会一路落到英文。
     */
    const ZH: Record<string, string> = Object.fromEntries(Object.keys(EN).map((key) => [key, key]));
    /** DSH locale 服务给的绑定翻译函数；服务还没挂载时是 null。 */
    let boundTranslate: ((key: string, params?: Record<string, unknown>) => string) | null = null;
    /** locale 服务本身；宿主侧的默认提示词要靠它算出「该用哪国话」。 */
    let localeService: any = null;
    /** 语言变化时要重渲染的订阅者（各模块顶层组件挂一个，子树跟着重渲染）。 */
    const localeListeners: Set<() => void> = new Set();

    /**
     * 当前界面语言，规整成宿主认识的两个值。
     *
     * 内置默认提示词（八方向生图 / 行走视频 / 转圈视频）存在宿主侧，
     * 宿主没有 locale 服务，所以每次读写提示词都把它带过去。
     * 服务不在时按中文算——那也正是界面当时的语言。
     */
    function activeLang(): "zh" | "en" {
      const active = localeService?.getSnapshot?.()?.active;
      return typeof active === "string" && active.trim().toLowerCase().startsWith("en") ? "en" : "zh";
    }

    /** `{name}` 插值；与 locale 服务内部用的是同一条规则。 */
    function fill(text: string, params?: Record<string, unknown>): string {
      if (params === undefined) return text;
      return String(text).replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match));
    }

    /** 翻译。没有 locale 服务时退回中文原文——自检脚本直接渲染组件走的就是这条。 */
    function T(key: string, params?: Record<string, unknown>): string {
      return boundTranslate === null ? fill(key, params) : boundTranslate(key, params);
    }

    /**
     * 挂上 DSH 的 locale 服务。
     *
     * locale 是**可选**依赖：服务不在（或注册失败）时界面继续用中文原文，
     * 插件不会因为缺这一个服务就整块不挂载。
     * @returns 是否挂上了。
     */
    function installI18n(ctx: any): boolean {
      const locale = ctx.get("locale");
      if (locale === undefined || locale === null) return false;
      try {
        ctx.effect(() => locale.register(I18N_NS, { zh: ZH, en: EN }), `${PACKAGE}: i18n dictionary`);
        localeService = locale;
        boundTranslate = locale.bind(I18N_NS);
        // 模块级文案表是**模块加载时**求值的（那时还没有 locale 服务，全是中文原文），
        // 所以挂上服务的第一件事就是把它们按当前语言重算一遍。
        rebuildStaticText();
        ctx.effect(
          () =>
            locale.subscribe(() => {
              boundTranslate = locale.bind(I18N_NS);
              rebuildStaticText();
              for (const listener of [...localeListeners]) {
                try {
                  listener();
                } catch {
                  // 单个订阅者出错不该拖垮语言切换本身。
                }
              }
            }),
          `${PACKAGE}: locale switch re-render`
        );
        return true;
      } catch {
        return false;
      }
    }

    /** 语言切换时重渲染当前组件。挂在各模块顶层即可，子树跟着一起重渲染。 */
    function useLocaleTick(): number {
      const [tick, setTick] = React.useState(0);
      React.useEffect(() => {
        const listener = () => setTick((value) => value + 1);
        localeListeners.add(listener);
        return () => {
          localeListeners.delete(listener);
        };
      }, []);
      return tick;
    }

    /**
     * 把 locale 服务接进来。立刻不是它的锅（服务可能比插件后挂载），
     * 所以先试一次，没成就等它可用——用 ctx.inject 而不是把它写进 inject 列表：
     * 写进去会让整个插件卡在这个服务上，缺了它就整个不挂载。
     */
    function attachI18n(ctx: any): void {
      if (installI18n(ctx)) return;
      try {
        ctx.inject(["locale"], (child: any) => {
          installI18n(child);
        });
      } catch {
        // 老版本宿主没有 ctx.inject：那就一直用中文原文，界面仍然是完整的。
      }
    }

    // ── 新对话桥：把「AI 生成素材」的活派给一个不挂靠项目的新对话 ────────────
    //
    // 素材窗口那颗「AI 生成素材」不自己生成图：它开一个**新对话**，把拼好的需求作为
    // 第一句话发进去，剩下的交给对话里的 agent（它有 game_material 工具与按需手册）。
    //
    // `sessions` / `uiWorkspace` 是 DSH 核心的浏览器侧服务。它们是**可选依赖**：
    // 写进 `inject` 数组会让整个插件卡在这两个服务上（缺一个就整块不挂载），
    // 所以照 `attachI18n` 的写法懒接一次；没接上时点「生成」给一句可读的提示。
    let sessionsService: any = null;
    let uiWorkspaceService: any = null;

    function attachSessionBridge(ctx: any): void {
      const bind = (child: any) => {
        try {
          if (child === null || child === undefined || typeof child.get !== "function") return;
          const sessions = child.get("sessions");
          const workspace = child.get("uiWorkspace");
          if (sessions !== undefined && sessions !== null) sessionsService = sessions;
          if (workspace !== undefined && workspace !== null) uiWorkspaceService = workspace;
        } catch {
          // 取服务失败不影响插件其余功能。
        }
      };
      bind(ctx);
      if (sessionsService !== null && uiWorkspaceService !== null) return;
      try {
        ctx.inject(["sessions", "uiWorkspace"], bind);
      } catch {
        // 没有 ctx.inject 的宿主：点「生成」时会明确提示，界面其余部分照常。
      }
    }

    /**
     * 开一个新对话并把提示词发进去（音乐 / 地图素材等自动任务共用）。
     *
     * `sessions.create({})` **不给 workspaceId、也不给 cwd** —— 这就是「不挂靠项目」：
     * 会话落在侧栏的未分组里，不占任何项目 / 工作区。建好先 `openSession` 把主列切到
     * 对话界面（`uiWorkspace.openSession` 内部会 `layout.selectPanel(null)`），
     * 再用 `beginSubmission` + `prompt` 把那句话作为第一轮发出去。
     */
    async function openStudioTaskChat(text: string, source: string): Promise<string> {
      const sessions = sessionsService;
      const workspace = uiWorkspaceService;
      if (sessions === null || workspace === null) {
        throw new Error(T("当前环境不支持自动开新对话，请在对话里直接说明你要的素材。"));
      }
      const sessionId = await sessions.create({});
      workspace.openSession(sessionId);
      const reference = sessions.retain(sessionId, { source });
      try {
        await reference.ready;
        const session = reference.binding.session;
        const submission = session.beginSubmission({ mode: "queue", text, attachments: [] });
        const result = await session.prompt([{ type: "text", text }], "queue", undefined, submission.requestId);
        if (result === null || result === undefined || result.ok !== true) {
          submission.abandon();
          const detail = result?.error;
          throw new Error(detail === undefined ? T("新对话打开了，但提示词没发出去。") : `${detail.code ?? "ERROR"}: ${detail.message ?? ""}`);
        }
      } finally {
        reference.release();
      }
      return sessionId;
    }

    /** 地图编辑器「AI 生成素材」的对话（保留原名字给自检）。 */
    async function openAssetChat(text: string): Promise<string> {
      return openStudioTaskChat(text, "gameStudioAssetRequest");
    }

    /** 45° 编辑器「AI 生成素材」的对话。 */
    async function openIsoAssetChat(text: string): Promise<string> {
      return openStudioTaskChat(text, "gameStudioIsoAssetRequest");
    }

    /** 音乐生成编辑的对话。 */
    async function openMusicChat(text: string): Promise<string> {
      return openStudioTaskChat(text, "gameStudioMusicRequest");
    }

    /**
     * 从提示词里取一个像样的素材名字。
     *
     * 只在用户没填名字时用：去掉换行与多余空白，取前 12 个字。名字最终由宿主
     * 归一成文件名（`safeAssetStem`），这里只决定「默认叫什么」。
     */
    /** 「这块素材怎么用」：`auto` = 让对话里的 agent 按判据判断（默认）。 */
    /**
     * 整图占格的上下限：**上限是地图自己**（一张整图最多和整张地图一样大）。
     *
     * 硬编码 8 是老限制，用户要做「一张图铺满整张地图」的城门就完全不够；
     * 真正该拦的是「比地图还大」——那个在宿主那边按项目尺寸校验，这里只是把输入框夹住。
     */
    /**
     * 拼给新对话的提示词。
     *
     * 结构：身份说明 → 已定死的参数（含**这块素材怎么用**）→ 素材主题（用户原文）→
     * 第一步定形态 → 第二步按形态规划排布 → 第三步生成 → 第四步整理并回链 → 审核模式。
     *
     * ⚠️ 这里**逐行**拼、每行各自套一层 `T()`：整段塞进一条 `T()` 的话，模板里的 JSON
     * 花括号会被 i18n 的 `{word}` 插值规则当成占位符（`{projectId}` 恰好还是真的
     * 参数名），插件一换语言就可能把示例替换成别的值。
     */
    /**
     * 自动任务的第一行：先让 agent 读手册，再按手册里的方法名调用。
     * 手册按需加载，不占常驻上下文；这里只负责把入口告诉它。
     */
    /**
     * 拼给 45° 编辑器 AI 素材任务的提示词。
     *
     * 与俯视的 `buildAssetRequestPrompt` 同一个套路，但几何完全不同：
     * 地面是 2:1 菱形，物件是整张图 + footprint；首版不生成 4×4 自动连接。
     * 逐行 `T()`，避免整段模板被 i18n 插值规则误伤。
     */
    /**
     * 拼给音乐任务新对话的提示词。
     *
     * 与「AI 生成素材」同一个套路：**逐行 `T()`**，把已定参数、用户原文、步骤、
     * 计费提醒、审核模式与回链写清。任务 id 已经由宿主建好，agent 只需要在
     * 这个任务上推进，不要再建一个。
     */
    /**
     * 拼给「谱曲模式」新对话的提示词。
     *
     * 核心顺序不能变：**先分析、先把方案给用户看** → 保存方案 →
     *（manual 停下）→ 写 scoremill 脚本 → 本地渲染试听 → 逐版修改 →
     * 只有用户明确要求才交 Suno（计费；先上传试听音频作参考，再走 cover）。
     */
    // 与宿主 src/wire.ts 的 METHODS 必须一一对应；那份是唯一的真源。
    // 宿主校验在服务端；浏览器半区只声明同一套 strict codec。
    // DSH 的 typert 要求 create() 工厂，运行时走 codec.create().parse()。
    const codec = (symbol) => ({ mode: "strict", typeSymbol: symbol, create: () => ({ parse: (value) => value }) });

    const REMOTE_METHODS = [
      ["getConfig", false],
      ["saveConfig", true],
      ["testArk", false],
      ["testCustomImage", false],
      ["testMinimax", false],
      ["testComfy", false],
      ["testMusic", false],
      ["listProjects", false],
      ["createProject", true],
      ["getProject", true],
      ["deleteProject", true],
      ["renameProject", true],
      ["uploadSource", true],
      ["savePrompts", true],
      ["saveSettings", true],
      ["setApproved", true],
      ["setReviewMode", true],
      ["reportClientOrigin", true],
      ["revealProject", true],
      // 本地自选视频（转圈 / 某个方向）与中间图片打包。
      ["uploadVideo", true],
      ["exportImages", true],
      ["runImage", true],
      ["runImages", true],
      ["setImageMode", true],
      ["runTurnVideo", true],
      ["runTurnFrames", true],
      ["setTurnPick", true],
      ["setTurnPicks", true],
      ["resetTurnPicks", true],
      ["cutTurnFrames", true],
      ["runVideos", true],
      ["pollVideos", true],
      ["clearVideos", true],
      ["runFrames", true],
      ["prepareFramePick", true],
      ["setFramePick", true],
      ["setFramePicks", true],
      ["resetFramePicks", true],
      ["rekey", true],
      ["compose", true],

      // 模块②（图片生成）—— 这一段只是远程方法清单，和下面的组件区无关
      ["listImageJobs", false],
      ["createImageJob", true],
      ["getImageJob", true],
      ["deleteImageJob", true],
      ["saveImageJob", true],
      ["uploadImageRef", true],
      ["removeImageRef", true],
      ["addImageItem", true],
      ["removeImageItem", true],
      ["runImageJob", true],
      ["keyImageJob", true],

      // 模块③：序列帧生成
      ["listSequenceJobs", false],
      ["createSequenceJob", true],
      ["getSequenceJob", true],
      ["deleteSequenceJob", true],
      ["saveSequenceJob", true],
      ["uploadSequenceRef", true],
      ["removeSequenceRef", true],
      ["runSequenceVideo", true],
      ["pollSequenceVideo", true],
      ["clearSequenceVideo", true],
      ["runSequenceFrames", true],
      ["keySequenceFrames", true],
      ["composeSequence", true],

      // 模块④：骨骼动画生成
      ["listRigJobs", false],
      ["createRigJob", true],
      ["getRigJob", true],
      ["deleteRigJob", true],
      ["saveRigJob", true],
      ["uploadRigSource", true],
      ["uploadRigPart", true],
      ["removeRigPart", true],
      ["renameRigPart", true],
      ["setRigPartVisibility", true],
      ["saveRigLayoutItem", true],
      ["saveRigLayoutItems", true],
      ["setRigLayoutHints", true],
    ["setRigSemantics", true],
    ["setRigBoneOffsets", true],
    ["resetRigBoneOffsets", true],
    ["setRigAnimationSettings", true],
    ["resetRigAnimationSettings", true],
    ["getRigAnimation", true],
    ["saveRigAnimation", true],
    ["resetRigAnimation", true],
    ["runRigQa", true],
    ["setRigConstraints", true],
    ["resetRigConstraints", true],
    ["setRigMesh", true],
    ["resetRigMesh", true],
    ["setRigPath", true],
    ["resetRigPath", true],
    ["tintRigParts", true],
    ["uploadRigTexture", true],
    ["setRigTextureVersion", true],
    ["removeRigTextureVersion", true],
    ["runRigRedraw", true],
      ["runRigSheet", true],
      ["runRigSegment", true],
      ["runRigLayout", true],
      ["runRigBones", true],
      ["runRigAtlas", true],
      // 地图地块。
      // ⚠️ 第二个字段是「这个方法**收不收 payload**」，不是「要不要盖遮罩」。
      // 写成 false 而方法其实收 payload，typert 会在浏览器侧直接拒绝：
      //   client api: gameStudio/getTileProject expected 0 argument(s), got 1
      // 界面表现是「点了没反应 + 一行错误」，不会崩，所以很容易漏过去。
      // scripts/verify-tools.mjs 现在会把两边的 payload 布尔逐条比对（见该文件的
      // 「客户端清单的 payload 标记」），这类错配不会再溜过。
      ["listIsoProjects", false],
      ["createIsoProject", true],
      ["getIsoProject", true],
      ["saveIsoProject", true],
      ["deleteIsoProject", true],
      ["importIsoTileset", true],
      ["importIsoSampleTileset", true],
      ["composeIsoAsset", true],
      ["saveIsoTileset", true],
      ["removeIsoTileset", true],
      ["saveIsoDoc", true],
      ["applyIsoOps", true],
      ["isoUndo", true],
      ["isoRedo", true],
      ["isoPlan", true],
      ["isoInspect", true],
      ["isoRender", true],
      ["runIsoGenerate", true],
      ["runIsoPreview", true],
      ["runIsoExport", true],
      ["cancelIsoJob", true],
      ["setIsoApproved", true],
      ["revealIsoProject", true],
      // 地图编辑器（模块六）。同样：第二个字段是「收不收 payload」。
      ["listMapProjects", false],
      ["createMapProject", true],
      ["getMapProject", true],
      ["saveMapProject", true],
      ["deleteMapProject", true],
      ["importMapTileset", true],
      ["importSampleTileset", true],
      ["composeMapAsset", true],
      ["recomposeMapTileset", true],
      ["saveMapTileset", true],
      ["removeMapTileset", true],
      ["saveMapDoc", true],
      ["applyMapOps", true],
      ["mapUndo", true],
      ["mapRedo", true],
      ["mapPlan", true],
      ["mapInspect", true],
      ["mapRender", true],
      ["runMapGenerate", true],
      ["runMapPreview", true],
      ["runMapExport", true],
      ["cancelMapJob", true],
      ["setMapApproved", true],
      ["revealMapProject", true],
      // 音乐生成编辑（模块七）。第二个字段仍然是「收不收 payload」。
      ["getMusicGuide", true],
      ["listMusicJobs", false],
      ["createMusicJob", true],
      ["getMusicJob", true],
      ["getMusicScoreGuide", true],
      ["testMusicScore", false],
      ["saveMusicScorePlan", true],
      ["runMusicScore", true],
      ["submitMusicScoreToSuno", true],
      ["saveMusicJob", true],
      ["deleteMusicJob", true],
      ["setMusicApproved", true],
      ["revealMusicJob", true],
      ["runMusicGeneration", true],
      ["cancelMusicGeneration", true],
      ["refreshMusicJob", true],
      ["getMusicWav", true],
      ["getMusicLrc", true],
      ["listMusicHistory", true],
      ["listMusicStemInstruments", false],
      ["runMusicTool", true],
      ["musicPeaks", true],
      ["renderMusicEdit", true],
      ["saveMusicVersion", true],
      ["deleteMusicVersion", true],
      ["exportMusic", true],
      // 音效生成（模块八）。
      ["testSfx", false],
      ["listSfxJobs", false],
      ["createSfxJob", true],
      ["getSfxJob", true],
      ["saveSfxJob", true],
      ["deleteSfxJob", true],
      ["uploadSfxRef", true],
      ["removeSfxRef", true],
      ["runSfxGeneration", true],
      ["cancelSfxGeneration", true],
      ["setSfxApproved", true],
      ["revealSfxJob", true],
      ["exportSfx", true]
    ];

    const CONTRIBUTION = {
      package: PACKAGE,
      descriptors: REMOTE_METHODS.map(([method, hasPayload]) => ({
        id: `${PACKAGE}#${SERVICE}/${method}`,
        service: SERVICE,
        namespace: SERVICE,
        method,
        invocation: { kind: "direct" },
        parameters: hasPayload
          ? [{ name: "payload", wire: "payload", source: "json", codec: codec(`${PACKAGE}#${method}Payload`) }]
          : [],
        result: codec(`${PACKAGE}#${method}Result`)
      }))
    };

    // ── 方向元数据（与宿主 src/directions.ts 保持一致）────────────────────
    // 「看不看得见脸」由南北决定——朝北走就是背对镜头，不是抬头。
    function make_DIRECTIONS() {
      return [
      { key: "front", compass: "S", label: T("南 · 正对镜头"), refs: [T("源图")] },
      { key: "back", compass: "N", label: T("北 · 背对镜头"), refs: [T("南")] },
      { key: "downLeft", compass: "SW", label: T("西南 · 四分之三正面"), refs: [T("南")] },
      { key: "downRight", compass: "SE", label: T("东南 · 四分之三正面"), refs: [T("南")] },
      { key: "upLeft", compass: "NW", label: T("西北 · 四分之三背面"), refs: [T("北")] },
      { key: "upRight", compass: "NE", label: T("东北 · 四分之三背面"), refs: [T("北")] },
      { key: "left", compass: "W", label: T("西 · 左侧脸"), refs: [T("南"), T("北")] },
      { key: "right", compass: "E", label: T("东 · 右侧脸"), refs: [T("南"), T("北")] }
    ];
    }
    let DIRECTIONS = make_DIRECTIONS();

    const DIRECTION_KEYS = DIRECTIONS.map((d) => d.key);
    function make_LABEL_OF() {
      return Object.fromEntries(DIRECTIONS.map((d) => [d.key, d.label]));
    }
    let LABEL_OF = make_LABEL_OF();

    const COMPASS_OF = Object.fromEntries(DIRECTIONS.map((d) => [d.key, d.compass]));

    /** 屏幕位移向量 → 方向 key。dy > 0 是往画面下方走（向南）。 */
    function directionKeyFor(dx, dy) {
      if (dx === 0 && dy === 0) return null;
      if (dy > 0) return dx > 0 ? "downRight" : dx < 0 ? "downLeft" : "front";
      if (dy < 0) return dx > 0 ? "upRight" : dx < 0 ? "upLeft" : "back";
      return dx > 0 ? "right" : "left";
    }

    /** WASD 与方向键统一成四个布尔轴。 */
    const KEY_AXIS = {
      w: "up",
      arrowup: "up",
      s: "down",
      arrowdown: "down",
      a: "left",
      arrowleft: "left",
      d: "right",
      arrowright: "right"
    };

    // ── 宿主侧后台任务的覆盖面（与宿主 src/pipeline.ts 的 JobInfo.targets 对应）──
    /**
     * 找一个正在跑的后台任务。
     *
     * `getProject` 会把宿主的运行表一起带回来（`project.jobs`），这是「正在跑什么」
     * 的唯一真相：本地那张 pending 表只活到远程调用返回（批量提交是 kick 型调用，
     * 一提交就返回 `{started:true}`，真正的活还在后台），撑不住整段任务。
     */
    function hostJob(project, taskKey) {
      const list = Array.isArray(project?.jobs) ? project.jobs : [];
      return list.find((job) => job !== null && typeof job === "object" && job.key === taskKey);
    }

    /**
     * 这个方向是不是还在某个后台任务的覆盖面里（还没轮到，或者产物还没出来）。
     *
     * 拿它当「等待中」的依据，才能让「提取全部序列帧」这种一次两个方向慢慢做的
     * 批量任务，从点下去到结果出来**一路盖着遮罩**：抽帧一共八段，宿主是先给两个
     * 方向写 running 的，其余六个在那段时间里既没有 running 也没有产物，只看本地
     * pending 就会退化成「尚未抽帧」——看着像点击没生效，实测就是这个 bug。
     *
     * 覆盖面由宿主维护并在产物真的可见时逐个摘掉，所以这里不需要再猜。
     */
    function jobCovers(job, key) {
      return job !== undefined && Array.isArray(job.targets) && job.targets.includes(key);
    }

    /**
     * 实验性模块的呈现材料。
     *
     * `experimental` 只影响**呈现**：页签上加角标、进入时弹一次说明、模块里常驻一条提示条。
     * 功能本身一概不拦——链路照常可用，只是要让用户先知道现状，并把共建入口摆出来。
     */
    // 模块⑥「俯视地图编辑器」**已经不再是实验性功能**：链路全本地、零计费，几何与导出
    // 都有像素级自检兜底（`verify-map*` 四件），界面上与导出的 PNG 执行同一份绘制计划。
    // 所以它没有实验性角标、没有进入弹窗、模块内也没有常驻提示条
    // —— 留下任何一条都会让「正式」这个说法名不副实。

    /** 六个功能模块。插件是「大师」，每个模块管一类素材。 */
    function make_MODULES() {
      return [
      { key: "sprite", title: T("八方向图生成"), hint: T("一张设定图 → 8 方向 × 8 帧精灵图") },
      { key: "image", title: T("图片生成"), hint: T("按提示词出图，可带参考图，支持抠绿幕导出 PNG") },
      { key: "sequence", title: T("序列帧生成"), hint: T("图/视频参考生成视频 → 抽帧 → 抠像 → 合成与播放预览") },
      { key: "rig", title: T("骨骼动画生成"), hint: T("拆件 → 装配定位 → 推骨骼与动画 → 打包 Spine 图集"), experimental: true },
      { key: "iso", title: T("45°地图编辑器"), hint: T("导入菱形地块 → 自动连接 → 画 45° 等距地图 → 导出 PNG") },
      { key: "map", title: T("俯视地图编辑器"), hint: T("导入自己的素材图 → 自动连接 → 俯视画布上直接画 → 导出 PNG") },
      { key: "music", title: T("音乐生成编辑"), hint: T("灵感/歌词 → 对话里生成 → 回界面裁剪、调音量、淡入淡出与导出") },
      { key: "sfx", title: T("音效生成"), hint: T("一句话描述 → 音效 / 环境音 / 角色配音（火山引擎 Seed-Audio）") }
    ];
    }
    let MODULES = make_MODULES();


    function make_STAGES() {
      return [
      { key: "images", title: T("① 八方向绿幕图"), hint: T("以源图为基准，按依赖顺序生成八个方位的纯绿幕全身图") },
      { key: "videos", title: T("② 行走动作视频"), hint: T("固定镜头、固定背景，让角色朝原方位原地走三步") },
      { key: "frames", title: T("③ 提取序列帧"), hint: T("可整批等分抽帧，也可对每一段视频手动选帧") },
      { key: "sheet", title: T("④ 抠绿幕合成整图"), hint: T("剔除绿幕并按行序拼成一张精灵图") },
      { key: "preview", title: T("⑤ 行走预览"), hint: T("用 WASD 或方向键操控角色，看看八方向接起来顺不顺") }
    ];
    }
    let STAGES = make_STAGES();

    // ── 音乐生成编辑（模块七）────────────────────────────────────────────
    //
    // 引擎/模型表在这里也有一份：浏览器半区是经典脚本，不能 import 宿主模块。
    // 真源是宿主 `src/musicmodels.ts`；自检按 id 比对，防止两边漂移。
    function make_MUSIC_ENGINES() {
      return [
        {
          id: "suno",
          label: T("Suno"),
          hint: T("v6 系列：可只给灵感，也可给完整歌词与风格标签；每次提交返回 2 首"),
          models: [
            { id: "chirp-v6", label: T("chirp-v6（默认 · 完成度最好）") },
            { id: "chirp-v6-wild", label: T("chirp-v6-wild（探索 · 更有个性、更不可控）") },
            { id: "chirp-v6-mini", label: T("chirp-v6-mini（更快更省 · 草稿）") }
          ]
        },
        {
          id: "mureka",
          label: T("Mureka"),
          hint: T("另一个音乐模型家族；纯音乐可直接用 instrumental 端点，每次可出 1–3 首"),
          models: [
            { id: "mureka-9.5", label: "mureka-9.5" },
            { id: "mureka-9", label: "mureka-9" },
            { id: "mureka-8", label: "mureka-8" },
            { id: "mureka-7.6", label: "mureka-7.6" },
            { id: "mureka-o2", label: "mureka-o2" },
            { id: "auto", label: "auto" }
          ]
        },
        {
          id: "minimax",
          label: T("MiniMax"),
          hint: T("音乐 3.0：需要提示词与歌词（纯音乐可只给提示词），可指定采样率/码率"),
          models: [
            { id: "music-3.0", label: "music-3.0" },
            { id: "music-2.6", label: "music-2.6" }
          ]
        },
        {
          id: "aceStep",
          label: T("ACE-Step"),
          hint: T("可明确指定 BPM / 调式 / 拍号与演唱语言；适合游戏循环与纯音乐"),
          models: [{ id: "v15-turbo", label: "v15-turbo" }]
        }
      ];
    }
    let MUSIC_ENGINES = make_MUSIC_ENGINES();

    function make_MUSIC_PHASES() {
      return [
        { key: "generate", title: T("① 生成歌曲"), hint: T("在对话里扩写提示词、选引擎/模式并提交；按谱乐 AI 积分计费") },
        { key: "edit", title: T("② 编辑"), hint: T("裁剪 / 音量 / 淡入淡出 / 标准化；全部本机 ffmpeg，免费") },
        { key: "export", title: T("③ 导出"), hint: T("保存版本并导出 MP3 / WAV / M4A，多产物自动打 zip") }
      ];
    }
    let MUSIC_PHASES = make_MUSIC_PHASES();

    // ── 提示词构建器（infra/prompts）──────────────────────────────────────
    const prompts = createPrompts({ T, MUSIC_ENGINES });
    const { buildAssetRequestPrompt, buildIsoAssetRequestPrompt, buildMusicRequestPrompt, buildComposeRequestPrompt, deriveMusicName, deriveAssetName, ASSET_FRAMES_MIN, ASSET_FRAMES_MAX, ASSET_SHAPES, assetShapeLabel, stampLimits, clampStampSpan } = prompts;

    const MUSIC_FORMATS = ["mp3", "wav", "m4a"];
    const MUSIC_EDIT_LIMITS = { gainDb: 24, fade: 30 };

    function musicEngineOf(key) {
      return MUSIC_ENGINES.find((entry) => entry.id === key) ?? MUSIC_ENGINES[0];
    }

    // ── 功能管理（被隐藏的模块）──────────────────────────────────────────
    //
    // 设置页「功能管理」写、工作台页签与侧栏菜单读，所以状态放在工厂闭包里共享
    // 一份，而不是各自去 `getConfig()`。
    //
    // 「隐藏」是**双向**的：这里只管界面，对话工具面由宿主 `src/tools.ts` 再拦
    // 一次（`hiddenModules` 存在宿主配置里，两侧读的是同一份）。只藏界面不拦
    // 工具等于没藏——模型照样能调生成类方法，真实计费。
    const hiddenModulesState = { keys: [] as string[], listeners: new Set<(keys: string[]) => void>() };

    /** 收敛成合法且顺序固定的 key 数组（与宿主 `normalizeHiddenModules` 同口径）。 */
    function normalizeHiddenKeys(value) {
      if (!Array.isArray(value)) return [];
      return MODULES.map((entry) => entry.key).filter((key) => value.includes(key));
    }

    /** 写入并通知订阅者；内容没变就不通知（避免无谓重渲染）。 */
    function publishHiddenModules(value) {
      const next = normalizeHiddenKeys(value);
      if (next.length === hiddenModulesState.keys.length && next.every((key, index) => key === hiddenModulesState.keys[index])) return;
      hiddenModulesState.keys = next;
      for (const listener of [...hiddenModulesState.listeners]) {
        try {
          listener(next);
        } catch {
          // 单个订阅者出错不该拖垮别的。
        }
      }
    }

    /** 从宿主读一次当前可见性。读失败就当作「全部可见」，不要因此白屏。 */
    async function refreshHiddenModules(api) {
      if (api === undefined) return;
      try {
        const config = await api.getConfig();
        publishHiddenModules(config?.hiddenModules);
      } catch {
        // 配置读不到不是致命错误：界面照常，工具面仍然会拦。
      }
    }

    /**
     * 组件里用：当前被隐藏的模块 key 数组。
     *
     * `api` 可省略（那时只订阅、不主动拉取）——设置页自己会 `load()` 并 publish。
     */
    function useHiddenModules(api) {
      const [hidden, setHidden] = React.useState(hiddenModulesState.keys);
      React.useEffect(() => {
        hiddenModulesState.listeners.add(setHidden);
        // 订阅之前可能已经有值了（设置页先加载完），补一次对齐。
        setHidden(hiddenModulesState.keys);
        return () => {
          hiddenModulesState.listeners.delete(setHidden);
        };
      }, []);
      React.useEffect(() => {
        void refreshHiddenModules(api);
      }, [api]);
      return hidden;
    }

    /** 可见的模块（页签、侧栏菜单都按它渲染）。 */
    function visibleModulesOf(hidden) {
      return MODULES.filter((entry) => !hidden.includes(entry.key));
    }


    // ── 深链接：从会话里点一下链接就切到插件对应页面 ─────────────────────
    //
    // 宿主 src/links.ts 是这套约定的唯一真源；这里只能复制常量（浏览器半区是
    // 经典脚本，不能 import），两边的一致性由 scripts/verify-tools.mjs 的
    // 文本契约钉住：参数名、模块名、面板 id 任一处改动都会让本地测试失败。
    //
    // 拦截方式刻意选在**捕获阶段**：会话正文的 Markdown 渲染器会给所有
    // http(s) 链接加 target="_blank"，不拦就会真的新开一个标签页。
    // 只按 `dsh-gmm` 参数识别自己的链接，其它链接（含站外的）一律放行。
    const OPEN_QUERY_KEY = "dsh-gmm";
    const OPEN_MODULES = new Set(["sprite", "image", "sequence", "rig", "iso", "map", "music", "sfx"]);
    /** `dialog` 允许的取值（宿主 `links.ts` 的 `OPEN_DIALOGS`，改一处要同步）。 */
    const OPEN_DIALOGS = new Set(["add"]);
    /** `shape` 允许的取值（宿主 `links.ts` 的 `OPEN_SHAPES`，改一处要同步）。 */
    const OPEN_SHAPES = new Set(["plain", "corner16", "a2quad", "stamp"]);
    /** 45° 编辑器的 AI 回链用同一个 `shape` 参数，取值是 ground / object。 */
    const OPEN_ISO_SHAPES = new Set(["ground", "object"]);
    /** 深链接里所有属于本插件的参数名：清理地址栏时一起摘掉。 */
    const OPEN_PARAM_KEYS = [OPEN_QUERY_KEY, "module", "project", "job", "stage", "score", "direction", "dialog", "asset", "frames", "shape", "scale", "cols", "rows", "keyed"];
    /** 意图订阅者：各模块组件都挂着，谁在挂载谁就被通知。 */
    const intentListeners = new Set<any>();
    /** 最近一次意图。晚挂载的组件（切模块后才渲染）订阅时立刻拿到它。 */
    let pendingIntent = null;

    function subscribeIntent(listener) {
      intentListeners.add(listener);
      if (pendingIntent !== null) listener(pendingIntent);
      return () => {
        intentListeners.delete(listener);
      };
    }

    /** 组件里用：拿到最近一次深链接意图（没有就是 null）。 */
    function useStudioIntent() {
      const [intent, setIntent] = React.useState(null);
      React.useEffect(() => subscribeIntent(setIntent), []);
      return intent;
    }

    /** 解析查询串。不是我们的链接就返回 null（宿主侧 links.ts 的同名实现）。 */
    function parseIntents(search) {
      let params;
      try {
        params = new URLSearchParams(typeof search === "string" ? search : "");
      } catch {
        return null;
      }
      if (!params.has(OPEN_QUERY_KEY)) return null;
      const intent: any = {};
      const module = params.get("module");
      if (module !== null && OPEN_MODULES.has(module)) intent.module = module;
      const projectId = params.get("project");
      if (projectId) intent.projectId = projectId;
      const jobId = params.get("job");
      if (jobId) intent.jobId = jobId;
      const stage = params.get("stage");
      if (stage) intent.stage = stage;
      const scoreId = params.get("score");
      if (scoreId) intent.score = scoreId;
      const direction = params.get("direction");
      if (direction) intent.direction = direction;
      const dialog = params.get("dialog");
      if (dialog !== null && OPEN_DIALOGS.has(dialog)) intent.dialog = dialog;
      /**
       * `asset` 只接受项目资源目录下的相对路径。绝对路径与 `..` 一律丢掉 ——
       * 宿主资源路由另有拦截，但坏值不该进界面（它会被拼进 fetch 的 URL）。
       */
      const asset = params.get("asset");
      if (asset !== null && asset.trim() !== "" && !asset.startsWith("/") && !asset.startsWith("\\") && !asset.includes("..") && !asset.includes("\\")) {
        intent.asset = asset.trim();
      }
      const frames = Number(params.get("frames"));
      if (params.get("frames") !== null && Number.isInteger(frames) && frames > 0) intent.frames = frames;
      /** `shape` = 「这块素材怎么用」的预选值（宿主 `links.ts` 的 `OPEN_SHAPES`，改一处要同步）。 */
      const shape = params.get("shape");
      if (shape !== null && (OPEN_SHAPES.has(shape) || OPEN_ISO_SHAPES.has(shape))) intent.shape = shape;
      /**
       * `scale` = 这张素材图**每格几倍分辨率**（宿主 `links.ts` 的 1..8）。
       * 少了它，「新增素材」会以为图就是格子大小，把 4 倍图切成 16 倍碎块。
       */
      const scale = Number(params.get("scale"));
      if (params.get("scale") !== null && Number.isInteger(scale) && scale >= 1 && scale <= 8) intent.scale = scale;
      /**
       * `cols` / `rows` = 整图占几格（宿主 `links.ts` 的 1..512）。
       * 少了它们，「新增素材」会按默认 3×3 预填 —— 图与占格对不上就会被拉伸。
       */
      const cols = Number(params.get("cols"));
      if (params.get("cols") !== null && Number.isInteger(cols) && cols >= 1 && cols <= 512) intent.cols = cols;
      const rows = Number(params.get("rows"));
      if (params.get("rows") !== null && Number.isInteger(rows) && rows >= 1 && rows <= 512) intent.rows = rows;
      /** `keyed=1`：整理时**已经抠过绿幕**，「新增素材」据此取消「抠掉绿幕」勾选（免得抠两遍）。 */
      if (params.get("keyed") === "1") intent.keyed = 1;
      return intent;
    }

    /**
     * 切到工作台面板并广播意图。
     *
     * `layout.selectPanel` 在面板还没注册时会抛错（插件 apply 与页面启动有先后），
     * 所以这里带重试；重试期间意图已经广播出去了，组件挂载后会自己接上。
     */
    function openStudioIntent(ctx, intent, attempt = 0) {
      if (attempt === 0) {
        pendingIntent = intent;
        for (const listener of [...intentListeners]) {
          try {
            listener(intent);
          } catch {
            // 单个订阅者出错不该拖垮切换本身。
          }
        }
      }
      const layout = ctx.get("layout");
      // `layout` 可能在页面刚启动 / 插件刚 apply 时还没挂上。以前这里直接 return，
      // 结果是「深链接被消费掉、面板却没切过去」——用户点回链只会看到对话页。
      // 和 selectPanel 抛错同样重试，直到 layout 出现。
      if (layout === undefined) {
        if (attempt < 20 && typeof window !== "undefined") {
          window.setTimeout(() => openStudioIntent(ctx, intent, attempt + 1), 150);
        }
        return;
      }
      try {
        layout.selectPanel(GAME_STUDIO_PANEL_ID);
      } catch {
        if (attempt < 20 && typeof window !== "undefined") {
          window.setTimeout(() => openStudioIntent(ctx, intent, attempt + 1), 150);
        }
      }
    }

    function intentOfAnchor(event) {
      if (event.button !== 0) return null;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null; // 让浏览器按用户意图新开标签页
      const target = event.target;
      if (target === null || target === undefined || typeof target.closest !== "function") return null;
      const anchor = target.closest("a[href]");
      if (anchor === null) return null;
      let url;
      try {
        url = new URL(anchor.getAttribute("href"), window.location.origin);
      } catch {
        return null;
      }
      return parseIntents(url.search);
    }

    /** 捕获阶段拦下深链接点击：原地切面板，不跳转、不新开标签。 */
    function installIntentInterceptor(ctx) {
      if (typeof document === "undefined" || typeof window === "undefined" || window.location === undefined) return () => {};
      const onClick = (event) => {
        if (event.defaultPrevented) return;
        let intent;
        try {
          intent = intentOfAnchor(event);
        } catch {
          return;
        }
        if (intent === null) return;
        event.preventDefault();
        event.stopPropagation();
        openStudioIntent(ctx, intent);
      };
      document.addEventListener("click", onClick, true);
      return () => document.removeEventListener("click", onClick, true);
    }

    /**
     * 直接以 `/?dsh-gmm=…` 打开时的兜底路径（中键、Ctrl+点击、或用户手动贴链接）：
     * 应用正常启动，这里读一次查询参数、把它从地址栏清掉、再切面板。
     */
    function consumeUrlIntent(ctx) {
      if (typeof window === "undefined" || window.location === undefined) return;
      const intent = parseIntents(window.location.search);
      if (intent === null) return;
      try {
        const url = new URL(window.location.href);
        // 确认过 dsh-gmm 才走到这里，所以这几个键一定是本插件写的，一起清掉。
        // ⚠️ 这张表就是 `OPEN_PARAM_KEYS`：新增一个深链接参数忘了加进来，它就会
        // 一直留在地址栏里（刷新一次又被解析一遍）。
        for (const key of OPEN_PARAM_KEYS) {
          url.searchParams.delete(key);
        }
        window.history.replaceState(null, "", url.toString());
      } catch {
        // 清不掉参数也不影响切换，忽略。
      }
      openStudioIntent(ctx, intent);
    }

    /**
     * 把真实 origin 与应用路径前缀报给宿主：宿主不知道对外地址（可能被反代改写），
     * 而模型要在回复里贴出可点的绝对链接。`path` 让 DSH 0.2.1 的
     * `--public-url https://host/prefix/` 部署也能拼对回链与产物地址。
     * 失败不影响任何功能。
     */
    function reportClientOrigin(api) {
      if (typeof window === "undefined" || window.location === undefined) return;
      const origin = window.location.origin;
      if (typeof origin !== "string" || origin === "" || origin === "null") return;
      const path = typeof window.location.pathname === "string" ? window.location.pathname : "";
      // 宿主刚重启时插件可能比远程服务先就绪：失败就退避重试，
      // 否则 `clientOrigin` 会一直空着，所有绝对产物地址都变成 `http://localhost`。
      // 重试窗口给到 ~30s，并在窗口重新聚焦 / 回到前台时再补报一次——
      // 用户重启 DSH 后不刷新页面也能恢复正确 origin。
      const send = (attempt) => {
        let pending;
        try {
          pending = api.reportClientOrigin({ origin, path });
        } catch {
          pending = Promise.reject(new Error("reportClientOrigin failed"));
        }
        Promise.resolve(pending)
          .then((result) => {
            if (result?.ok === false && attempt < 60) window.setTimeout(() => send(attempt + 1), 500);
          })
          .catch(() => {
            if (attempt < 60) window.setTimeout(() => send(attempt + 1), 500);
          });
      };
      send(0);
      // 宿主重启后页面通常不会重新 apply；focus / 回到前台是最可靠的补报时机。
      if (typeof window.addEventListener === "function") {
        window.addEventListener("focus", () => send(0));
      }
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") send(0);
        });
      }
    }

    // ── 样式 ─────────────────────────────────────────────────────────────
    // ⚠️ `.SPR_root` 上的 `overflow-y:auto` 不能删。
    // 面板的外层（DSH 的 `.BynINW_centerCol` / `.BynINW_frame`）是 `overflow:hidden`，
    // 而 `.SPR_root` 是 `height:100%`，所以内容一旦超过面板高度就会被**直接裁掉**，
    // 既看不到下半截、也没法滚动。
    // 实测：模块五「地图地块生成」的五个阶段加起来 810px > 面板 686px，底部的地块卡片
    // 就被切了；而前四个模块恰好都在 686 以内，所以这个坑一直没暴露出来。

    // ── 小工具与基础组件 ───────────────────────────────────────────────────
    // 实现已移到 src/client/ui.ts；这里取回同一份引用继续用。
    const { cls, msg, sameDraft, mergeDrafts, askNewName, statusKind, Chip, StatusChip, Btn, NumField, useGlobalConfig, GlobalModelField, assetUrl, ZoomableImage, TASK_HOLD_MS, usePendingTasks, LoadingOverlay, MediaBox, BusyBtn, BusyBadge, ReviewModeBar, ApproveBtn, readFileBase64, UploadBox, LocalVideoPick, fileLabel, SaveLink, pickLocalVideo, KeyingFields, copyIdText, CopyIdButton, JobSidebar } = createUiKit({ React, h, T, useLocaleTick });
    // ui 组件表挂到运行时：后续模块可直接 studio().ui.Btn 取用（P3 起）
    provideRuntime({ scheduler: gmmScheduler, ui: { cls, msg, sameDraft, mergeDrafts, askNewName, statusKind, Chip, StatusChip, Btn, NumField, useGlobalConfig, GlobalModelField, assetUrl, ZoomableImage, TASK_HOLD_MS, usePendingTasks, LoadingOverlay, MediaBox, BusyBtn, BusyBadge, ReviewModeBar, ApproveBtn, readFileBase64, UploadBox, LocalVideoPick, fileLabel, SaveLink, pickLocalVideo, KeyingFields, copyIdText, CopyIdButton, JobSidebar } });

    /**
     * 数字参数输入框。
     *
     * ★ 必须**在失焦 / 回车时才提交**，不能边打字边提交：宿主那边对每个参数
     * 都会 clamp（单格宽最小 16、时长最小 4 秒…），敲一个字符就提交一次的话，
     * 想输入「128」会在敲下「1」的瞬间被夹成 16、输入框随即被回包覆盖——
     * 表现就是「数字总跳成别的值，根本没法输入」。所以这里本地存草稿文本，
     * 只在 onBlur / Enter 时解析 + 夹取 + 回调，输入过程中一个远程调用都不发。
     */
    /**
     * 形状工具（**模块级**，不是组件内的 const）。
     *
     * ⚠️ 必须是模块级：组件里那几处（`itemsForSave` 等）在**渲染早期**就要用到
     * 它们，而组件内的 `const` 在那个位置还处于暂时性死区 —— 实测报
     * `Cannot access 'shapeFromRect' before initialization`，整块白屏。
     */
    /**
     * 模板文件名的中文说明。
     *
     * 形状变了模板名也变，所以名字要从文件名**反推**，不能写死几个分支。
     * `cell.png` → 单格；`grid{C}x{R}.png` → C×R 矩形；
     * `shape-{格子}.png` → 非矩形（把格子坐标列出来，用户能对上是哪个形状）。
     */

    /**
     * 全局模型设置。生图模型 / 视频模型都是插件级设置（设置 → 游戏素材大师），
     * 各功能模块只跟随、不各自留一份副本——否则切换模型后旧任务会打到错误网关
     * （实测：任务里存官方 H3 + 全局已切优云智算 → cp.compshare.cn/v2/... 404）。
     */



    /**
     * 双击看大图的缩略图。
     *
     * 序列帧缩略图按格子尺寸显示（默认 256px、像素风还会更小），肉眼根本看不清
     * 动作与抠像质量——双击弹出原图，右上角「×」、点背景、按 Esc 都能关。
     * 遮罩用 position:fixed，所以它在卡片内部渲染也能盖住整页。
     */

    // ── 「正在调用接口」的视觉反馈 ───────────────────────────────────────
    /**
     * 点一次按钮 = 一次远程调用。调用期间界面必须看得见「在跑」，
     * 所以把「哪一个操作正在跑」抽成一个按 key 记账的 pending 表：
     *
     *   const tasks = usePendingTasks();
     *   await tasks.run(`image:${key}`, "正在生成…", () => api.runImage(…));
     *   tasks.has(`image:${key}`)   // 盖遮罩用
     *
     * 两个要点：
     * 1. 遮罩在**调用返回后仍多留一会儿**（HOLD_MS）。宿主把任务标成 running 是
     *    落在下一次 getProject 里的，如果调用一返回就撤遮罩，会有一次「图已经
     *    变旧了但还没盖上」的闪烁。多留 700ms 足够让下一次轮询把 running 状态刷进来。
     * 2. 卸载后不再 setState（长任务可能几分钟才回来）。
     */


    /**
     * 盖在预览区上的 loading 遮罩。父元素必须是 position:relative
     * （`.SPR_thumbBox` 或 `.SPR_stage`）。
     */

    /**
     * 行内进度条：**不遮挡、可点击穿透**。
     *
     * 与 `LoadingOverlay`（绝对定位盖住容器）的分工：
     *   · 要让人「看得见就放心、但不挡路」的**长任务**用这个；
     *   · 要盖住一小块预览区、明确「这块正在变」的用 `LoadingOverlay`。
     *
     * 长任务（生成地块一轮几十秒）绝不能盖整块面板：用户要能切阶段、
     * 去别的模块干活，而且「停止」按钮得点得到。
     */
    /**
     * 一张图 / 一段视频的预览位：内容 + 可选遮罩。
     * 原来各阶段的 `<img className="SPR_thumb">` 直接放在节点卡片里，
     * 现在统一包一层定位容器，遮罩才能正好盖住预览区。
     */



    // ── 验收：审核模式与「通过」───────────────────────────────────────────
    /**
     * 审核模式（固定流程必问项）：`auto` = agent 自己审完继续，`manual` = 每一步人工审。
     *
     * 与对话里的 `game_material({action:'reviewMode'})` 写的是同一份数据（存在项目 / 任务上），
     * 所以用户在界面上改了、会话里的 agent 也会按新值走，反之亦然。
     */


    // ── 侧栏图标（入口按钮 + 快捷菜单）───────────────────────────────────
    /**
     * 图标本体。抽出来是因为 `StudioGlyph` 现在还要在旁边挂一个菜单按钮，
     * 而自检脚本会单独拿这个纯图形做断言。
     */
    function StudioGlyphIcon(props) {
      const size = props?.size ?? 18;
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
        h("rect", { x: 3.2, y: 3.2, width: 17.6, height: 17.6, rx: 3, stroke: "currentColor", strokeWidth: 1.6 }),
        h("rect", { x: 5.6, y: 5.6, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }),
        h("rect", { x: 10.2, y: 5.6, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 14.8, y: 5.6, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }),
        h("rect", { x: 5.6, y: 10.2, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 10.2, y: 10.2, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.28 }),
        h("rect", { x: 14.8, y: 10.2, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 5.6, y: 14.8, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }),
        h("rect", { x: 10.2, y: 14.8, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 14.8, y: 14.8, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 })
      );
    }

    /** 菜单按钮上的小折角箭头。 */
    function ChevronGlyph() {
      return h(
        "svg",
        { width: 8, height: 8, viewBox: "0 0 8 8", fill: "none", "aria-hidden": "true" },
        h("path", { d: "M1.4 2.6 L4 5.4 L6.6 2.6", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" })
      );
    }

    /**
     * 侧栏「游戏素材大师」入口。
     *
     * 宿主把这一坨渲染在**它自己的 `<button class=…panelRow>` 里面**（见
     * dsh-client-ui-sidebar 的 `PanelRow`），所以我们没法在旁边加一个平级的
     * `<button>`——那会变成嵌套按钮。做法是：图标右下角挂一个
     * `span[role=button]` 的小折角，点击时 `stopPropagation` 掉宿主那一下
     * （否则会顺带切面板），然后在它旁边弹出功能菜单。
     *
     * 菜单用 `position:fixed` 渲染：侧栏面板列本身不裁剪，但祖先里有
     * `overflow:hidden` 的容器，`absolute` 会在某些窗口布局下被切掉。
     */
    function StudioGlyph(props) {
      const size = props?.size ?? 18;
      const api = props?.api;
      const studioCtx = props?.studioCtx;
      const hidden = useHiddenModules(api);
      const [open, setOpen] = React.useState(false);
      const [anchor, setAnchor] = React.useState(null);
      const rootRef = React.useRef(null);
      const menuRef = React.useRef(null);

      const entries = visibleModulesOf(hidden);

      // 菜单开着时：点外面 / 按 Esc 关掉。监听挂在 document 上，
      // 用捕获阶段，避免被宿主自己的处理吞掉。
      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const root = rootRef.current;
          if (root !== null && root !== undefined && typeof root.contains === "function" && root.contains(event.target)) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
          document.removeEventListener("mousedown", onPointerDown, true);
          document.removeEventListener("keydown", onKeyDown);
        };
      }, [open]);

      const toggle = (event) => {
        // 两下都要拦：宿主 `<button>` 的 onClick 也在这条冒泡路径上。
        event.preventDefault();
        event.stopPropagation();
        if (open) {
          setOpen(false);
          return;
        }
        const target = event.currentTarget;
        if (target !== null && target !== undefined && typeof target.getBoundingClientRect === "function") {
          const rect = target.getBoundingClientRect();
          setAnchor({ left: rect.right + 8, top: rect.top - 4, bottom: rect.bottom });
        } else {
          setAnchor(null);
        }
        setOpen(true);
      };

      const pick = (key) => {
        setOpen(false);
        openStudioIntent(studioCtx, { module: key });
      };

      // 菜单从按钮右上角展开；超出视口下沿时整体上移，别让它跑到屏幕外。
      let menuStyle = { left: 0, top: 0 };
      if (anchor !== null) {
        const viewportHeight = typeof window !== "undefined" && Number.isFinite(window.innerHeight) ? window.innerHeight : 0;
        const estimated = 96 + entries.length * 52;
        const top = viewportHeight > 0 ? Math.max(8, Math.min(anchor.top, viewportHeight - estimated - 12)) : anchor.top;
        menuStyle = { left: anchor.left, top };
      }

      return h(
        "span",
        { className: "SPR_railGlyph", ref: rootRef },
        h(StudioGlyphIcon, { size }),
        h(
          "span",
          {
            className: "SPR_railMenuBtn",
            role: "button",
            tabIndex: 0,
            "aria-haspopup": "menu",
            "aria-expanded": open ? "true" : "false",
            "aria-label": T("功能菜单"),
            title: T("功能菜单"),
            "data-testid": "gmm-rail-menu-btn",
            onClick: toggle,
            onKeyDown: (event) => {
              if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") toggle(event);
            }
          },
          h(ChevronGlyph, null)
        ),
        open
          ? h(
              "div",
              {
                className: "SPR_railMenu",
                role: "menu",
                ref: menuRef,
                style: menuStyle,
                "data-testid": "gmm-rail-menu",
                onClick: (event) => event.stopPropagation(),
                onMouseDown: (event) => event.stopPropagation()
              },
              h("div", { className: "SPR_railMenuHead" }, T("快捷进入功能")),
              entries.length === 0
                ? h("p", { className: "SPR_railMenuEmpty" }, T("所有功能都已被隐藏，请到「设置 → 游戏素材大师 → 功能管理」里打开至少一个。"))
                : entries.map((entry) =>
                    h(
                      "button",
                      {
                        key: entry.key,
                        type: "button",
                        role: "menuitem",
                        className: "SPR_railMenuItem",
                        "data-module": entry.key,
                        onClick: () => pick(entry.key)
                      },
                      h(
                        "span",
                        { className: "SPR_railMenuItemTitle" },
                        entry.title,
                        entry.experimental === true ? h("span", { className: "SPR_expTag" }, T("实验性")) : null
                      ),
                      h("span", { className: "SPR_railMenuItemHint" }, entry.hint)
                    )
                  ),
              hidden.length > 0
                ? h("div", { className: "SPR_railMenuFoot" }, T("已隐藏 {n0} 个功能（设置 → 游戏素材大师 → 功能管理）", { n0: hidden.length }))
                : null
            )
          : null
      );
    }

    // ── 主体工作台 ───────────────────────────────────────────────────────

    /** 阶段卡片下方的说明文字（阶段①有两种生成方式，各说各的）。 */
    function stageHint(project, stage, activeStage) {
      if (stage === "images" && sprite.imageModeOf(project) === "turn") {
        return T("先生成一段「角色原地匀速转一整圈」的绿幕视频，再按时间截出八个方向的帧；下面时间轴上的八个圆圈就是各自的截帧位置，拖动即可改。");
      }
      return activeStage.hint;
    }

    function stageDone(project, key) {
      if (key === "images") return DIRECTION_KEYS.every((k) => project.images?.[k]?.approved);
      if (key === "videos") return DIRECTION_KEYS.every((k) => project.videos?.[k]?.approved);
      if (key === "frames") return DIRECTION_KEYS.every((k) => project.frames?.[k]?.approved);
      if (key === "preview") return project.sheet?.approved === true;
      return project.sheet?.approved === true;
    }



    /**
     * 本地自选视频的 pending key（转圈与每个方向各一条）。
     *
     * 前缀刻意和 `turn:*` / `video:*` 错开：那两个前缀被「这个阶段有没有在跑」
     * 的判定用着（`tasks.any("video:*")`），混进去会把不相干的按钮一起禁用。
     */

    /**
     * 项目用的是哪种生成方式。
     *
     * 宿主 `normalizeProject` 一定会补齐 `imageMode`；这里再兜一层是给**渲染桩数据**
     * 用的（测试里的项目对象不经过宿主），也是给「字段还不存在的老项目」用的：
     * 已经有图就按逐方向生图走，否则走默认的转圈截帧。
     */




    /**
     * 八个截帧位置的时间轴。
     *
     * 轴底是整圈候选帧的缩略条带，「对着画面拖圆圈」是唯一不需要解释的交互——
     * 拖到哪个位置，那个方向就切那一帧。松手才提交（拖动过程只改本地状态），
     * 所以一次拖动最多只触发一次重切。方向键 ←/→ 也能逐个候选帧地微调。
     */






    /**
     * 某一段行走视频的选帧轴。圆圈个数 = 输出帧数，拖到候选条带的哪一格，
     * 那一张输出帧就用那一格。松手才提交，和转圈截帧的八圆圈是同一套交互。
     */








    /**
     * 把整图当精灵表用 canvas 现场播放。
     *
     * 位置、按键、帧计数这些每帧都在变的东西放在 ref 里（不进 React state），
     * 只有 HUD 文案限流回写 state——否则 60fps 的重渲染会把界面拖垮。
     */




    /**
     * 「选择本地视频」：一个包着隐藏 `<input type="file">` 的标签按钮。
     *
     * 为什么是 `<label>` 而不是 button + ref：文件选择框必须由**用户手势**打开，
     * 而 label 天然把点击转给内部的 input，不需要 useRef / useState——少一个 Hook
     * 就少一处「渲染顺序变了」的坑（这个模块的界面测试按住 Hook 顺序）。
     */


    /**
     * 一张中间产物的「保存」。
     *
     * 用 `<a download>` 而不是按钮：下载本来就是浏览器的事（同源静态路由直接给文件），
     * 宿主不必为它多开一个方法；产物就在眼前时，「保存」应该是一个链接而不是又一次调用。
     */

    /**
     * 选用一段本地视频（「选择本地视频」/ 拖进来之后走这里）。
     *
     * 两条链路共用：`key === "turn"` 是转圈视频（宿主导入后会**立刻**抽候选帧并切出
     * 八个方向），其余 key 是某个方向的行走视频（之后照旧到第 3 步抽帧）。
     * 文件字节走和源图同一条 base64 通道——插件零运行时依赖，不为它另开上传接口。
     */


    /** 一份任务/项目列表（左侧栏）。 */
    /**
     * 把一段文本复制到剪贴板。
     *
     * 浏览器半区可能跑在 Electron / 普通网页 / 自检桩里：优先用 Clipboard API，
     * 失败再退回旧式 `execCommand("copy")`。返回是否成功，界面据此显示「已复制 / 复制失败」。
     */

    /**
     * 「复制项目 ID」按钮。
     *
     * 所有模块的项目 / 任务共用它：把当前 id 一键复制给 agent，省得用户从日志或
     * 回复里翻 ID。`inline` 用在侧栏项目行里（span，避免 button 套 button）。
     */


    // ── 模块六 · 地图编辑器（单屏 · 零术语）────────────────────────────────
    //
    // 界面只做一件事：把宿主下发的绘制计划执行出来。
    // 「哪一格用哪一块、画在哪个像素、动起来是哪几块」全在宿主算好，这里连坐标变换
    // 都不做，只把计划里的 x / y 交给 canvas。
    //
    // 唯一被允许复刻的宿主逻辑是命中测试（下面四个坐标函数），那是鼠标必需；
    // 宿主真实现见 `src/mapgeom.ts`，自检拿它做黄金对照逐点比对。
    //
    // ⚠️ 变体挑选 / 自动连接 / 计划分块 / 绘制顺序**都不在这里**：多写一套口径，
    // 就是「预览好看、导出位移」的老路。

    /**
     * 宿主绘制计划里「一批绘制条目」的字段名。
     *
     * 只是个协议字段名（界面上不会出现这个词）。术语黑名单自检按**词边界**判，
     * 所以这里可以照实写 —— 别为了骗过自检去拼字符串。
     */
    const MAP_PLAN_LIST = "chunks";

    /** 取模到 0..size-1（负数也对）：与宿主 `mapgeom` 的环绕口径一致。 */
    function MAP_wrapIndex(value, size) {
      if (!(size > 0)) return value;
      const rest = value % size;
      return rest < 0 ? rest + size : rest;
    }

    /** 像素 → 格子。**与宿主 `mapgeom.pointToCell` 同构**（环绕时取模，且恒算在图内）。 */
    function MAP_pointToCell(layout, x, y) {
      const c = Math.floor(x / layout.stepX);
      const r = Math.floor(y / layout.stepY);
      if (layout.wrap === true) {
        return { r: MAP_wrapIndex(r, layout.rows), c: MAP_wrapIndex(c, layout.cols), inMap: true };
      }
      return { r, c, inMap: r >= 0 && c >= 0 && r < layout.rows && c < layout.cols };
    }

    /** 格子锚点 = 单元格底边中点。**与宿主 `mapgeom.cellAnchor` 同构**。 */
    function MAP_cellAnchor(layout, r, c) {
      return { x: c * layout.stepX + layout.grid.tileWidth / 2, y: (r + 1) * layout.stepY };
    }

    /** 贴图左上角。**与宿主 `mapgeom.cellTopLeft` 同构**。 */
    function MAP_cellTopLeft(layout, r, c, width, height, anchorX = 0.5, anchorY = 1) {
      const anchor = MAP_cellAnchor(layout, r, c);
      return { x: anchor.x - width * anchorX, y: anchor.y - height * anchorY };
    }

    /**
     * 两格之间的直线（拖动补间不能漏格）。
     * **与宿主 `mapdoc.lineCells` 同构**，黄金对照同样覆盖它。
     */
    function MAP_lineCells(r0, c0, r1, c1) {
      const out = [];
      let r = Math.round(r0);
      let c = Math.round(c0);
      const rEnd = Math.round(r1);
      const cEnd = Math.round(c1);
      const dr = Math.abs(rEnd - r);
      const dc = Math.abs(cEnd - c);
      const sr = r < rEnd ? 1 : -1;
      const sc = c < cEnd ? 1 : -1;
      let err = dr - dc;
      for (;;) {
        out.push({ r, c });
        if (r === rEnd && c === cEnd) break;
        const e2 = 2 * err;
        if (e2 > -dc) {
          err -= dc;
          r += sr;
        }
        if (e2 < dr) {
          err += dr;
          c += sc;
        }
        if (out.length > 20000) break;
      }
      return out;
    }


    // MAP_GUIDE_ART:BEGIN
    /**
     * 「素材说明」窗口里的三张示例图（普通图块 / 整格自动连接 / 拼块自动连接）。
     *
     * ⚠️ **整块由 `node scripts/make-map-guide-art.mjs` 生成**（`--check` 会断言它是新的）。
     * 手改这里没有意义：下次生成会被整块覆盖。
     *
     * 图全部来自本机的内置示例素材生成器：普通 / 整格两张是现画的，拼块那张就是内置草地
     * —— 说明与用户真能拿到的东西同源。界面按 `cols` / `rows` / `sub` 现算网格线的位置，
     * 所以不存在「图改了、网格线还在老位置」这种错位。
     */
    const MAP_GUIDE_ART = {
      "plain": {
        // 128×64：4 列 × 2 行，每块 32px
        src:
          "data:image/png;base64," +
          "iVBORw0KGgoAAAANSUhEUgAAAIAAAABACAYAAADS1n9/AAAEJklEQVR4nO2cv24UMRDG/RzUKaIUlBQInSJKRE11xVWIAlGmTJWSEqWiQpQp" +
          "KHgEFFHyDFRU1IhmkU9MGBz/G8+M17s7nzQ66fbWdvL9PLZ31+ucyWQymUwmE1G7y8fT6f7hNHc7TB3lTU+Fh8GAWKnA5MPHZ0kADISVCowP" +
          "wyDYgLyJMfNLEAAABsHCler9o2SBH6+vDTAtlXr/nFnAGx+GdB1z6s3zs0kymhrhjZPIANIAYNN/ffq6Sgi8abfvDyLRDACe+bcAoDUMYPN/" +
          "fzv8B4FkPTU6HF6p1OlN+3DxdILPlsBlNDUCMkDLKkArA4TmQ/SAwJsdxtXV23vfSUCBjW+BIDyf3AAwLjS1xvgYAJoQaJuPjb25+Xw0PRcS" +
          "IISmUyCIndvUiBgAlFjDHAAbH0YtCC31xgyHCV3O+NR5TX98KgvM2ftBPVYBOM23AMCBoGR0zXerBgCknfZT5mtDUEr5lDkCGwAqBKH5WgCc" +
          "XzyafGiUjQHgZAAtAGqGBDYALoCgBELMeM3erw0ANpEDAEBAqX9YAEIYcseXCkC4zAtBoBjfuioYYggA1Zjc23zXeQjghPQQ0G0SiDWa+S4A" +
          "QBqEXBbQ7v1ulGVgTCMYD+qRATgQcK4ODnEhKKfzsweTD2/4fndyDPFKUnWjXq8FgMtc+qUaz70OMMul4JIAADC/JwB3bVAGwCUgqLkXwL0c" +
          "PMTNoJy2AoCrgEDafDfK8wA5bQkAUA/jF6MRABhBmzA7JgNgvXqiHFb/2PWbTCaTyWQymUwmk8l0Ty9f7KZ3l/u7mLs9S5B/gmruNojJAKAJ" +
          "Pzs5d1uyqjVW+ndLUYuBsQdodVonoKUB8GXX724gx0BN8/0zCWKFjQzA9enJ5A0vhf8dp56YOL0YbpZJmp97QplV8IgAYON/fr+tgkADBGx+" +
          "7d1Pjbul4T4FEQi8UT2jpk3ewNB8CAoEkiCA+TWGYvMh/C10bhtqNqmQCx0VgJj5OQhi30tngppeHTNfCoBNZICw99dkgNRx6SzgkMG5YzHz" +
          "uQBQdik1VTDKHCA14asxPwVBy/8jpVQWyBkv0ftdAIGo+W4QAKDH1s76azOAdhbQNB4/e7h6AFxiCKjJCKk5gMbSsJTqOcbn9h9sCoAcBDWr" +
          "Aq3e7wrpnlMud0+i+7tSaKp8FAAcAYLe5muO81TjcXbIvcmk+Pj6aKsAFwBAmRPEzuOYgqU9zrcAUDK/CoIRAQDFDMVA5I5zTQFpz+xdQ+9v" +
          "ASAJwcgAgHJG9zJeapwP1boVvdZ80lAwyhwgJ5j8ebP9p1S5oB7r+VBUADA0lAxQHAqWBACEVLmuU7qPifIugvC37CEAZAD8A6CX8Vic9xCw" +
          "e78zAI6aw3gs6jb0FAxN29YNgDFEfQeBvbNg5aIaaIabmjX3/nSr394PYOqlPxFQg/NnCrR2AAAAAElFTkSuQmCC",
        cols: 4,
        rows: 2,
        cell: 32,
        sub: 0
      },
      "corner16": {
        // 128×128：4 列 × 4 行，每块 32px
        src:
          "data:image/png;base64," +
          "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",
        cols: 4,
        rows: 4,
        cell: 32,
        sub: 0
      },
      "a2quad": {
        // 64×160：2 列 × 5 行，每块 32px，每块再分 2×2 小格
        src:
          "data:image/png;base64," +
          "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",
        cols: 2,
        rows: 5,
        cell: 32,
        sub: 2
      }
    };
    // MAP_GUIDE_ART:END


    /**
     * 工具格的图标：内联 SVG 自绘（形状语义对齐 AsLib）。
     *
     * 纯函数、不碰 state：面板重渲染时重建这几个图标，代价可以忽略。
     */
    function MapToolIcon(props) {
      const name = props.name;
      const box: any = { viewBox: "0 0 24 24", width: 20, height: 20, "aria-hidden": "true", focusable: "false", fill: "currentColor" };
      const path = (d: string, extra?: any) => h("path", { d, ...(extra || {}) });
      const arrow = "M9 4.6 2.8 10.5 9 16.4v-3.7h4.1a4.4 4.4 0 0 1 0 8.8H7.6v3.2h5.5a7.6 7.6 0 0 0 0-15.2H9V4.6Z";
      if (name === "undo") return h("svg", box, path(arrow));
      if (name === "redo") return h("svg", box, h("g", { transform: "translate(24 0) scale(-1 1)" }, path(arrow)));
      if (name === "pen") return h("svg", box, path("M3.4 20.6l1-4.7L15.6 4.7a2.7 2.7 0 0 1 3.8 3.8L8.1 19.6l-4.7 1Z"));
      if (name === "eraser") {
        return h("svg", box, path("M13.4 3.6 4.2 12.8a2.4 2.4 0 0 0 0 3.4l3.6 3.6h6l8.1-8.1a2.4 2.4 0 0 0 0-3.4l-5.1-5.1a2.4 2.4 0 0 0-3.4 0Zm1.2 3.4 4 4-2.6 2.6-4-4 2.6-2.6Z"));
      }
      if (name === "bucket") {
        return h(
          "svg",
          box,
          path("M11.2 2.6 3.9 9.9a2.2 2.2 0 0 0 0 3.1l4.7 4.7a2.2 2.2 0 0 0 3.1 0l7.3-7.3-7.8-7.8Z"),
          path("M19.4 13.6s2.5 3 2.5 4.5a2.5 2.5 0 1 1-5 0c0-1.5 2.5-4.5 2.5-4.5Z")
        );
      }
      if (name === "pipette") return h("svg", box, path("M15.6 3.4 20.6 8.4 18 11 13 6l2.6-2.6Z"), path("M11.9 7.1 3 16v5h5l8.9-8.9-5-5Z"));
      if (name === "hand") {
        return h("svg", box, path("M7.6 11V6.4a1.6 1.6 0 0 1 3.2 0V11h1V4.4a1.6 1.6 0 0 1 3.2 0V11h1V6.4a1.6 1.6 0 0 1 3.2 0V14a6.6 6.6 0 0 1-6.6 6.6h-1.1A5.7 5.7 0 0 1 5.4 15v-2.3a1.7 1.7 0 0 1 3-1l-.8-.7Z"));
      }
      if (name === "single") {
        return h(
          "svg",
          box,
          path("M3 4h18v5H3z", { fillOpacity: 0.42 }),
          path("M3 10h18v5H3z"),
          path("M3 16h18v4H3z", { fillOpacity: 0.42 })
        );
      }
      if (name === "grid") return h("svg", box, path("M8.4 3h2.5v18H8.4zM13.1 3h2.5v18h-2.5zM3 8.4h18v2.5H3zM3 13.1h18v2.5H3z"));
      if (name === "magic") {
        return h(
          "svg",
          box,
          path("M3.3 20.7 13.1 10.9l-1.9-1.9L1.4 18.8l1.9 1.9Z"),
          path("M17.6 1.8 19 5.3l3.5 1.4L19 8.1 17.6 11.6 16.2 8.1 12.7 6.7 16.2 5.3 17.6 1.8Z")
        );
      }
      if (name === "settings") {
        return h(
          "svg",
          box,
          h("rect", { x: 3, y: 4.6, width: 18, height: 2.2, rx: 1.1 }),
          h("rect", { x: 6, y: 2.4, width: 4.4, height: 6.6, rx: 2.2 }),
          h("rect", { x: 3, y: 10.9, width: 18, height: 2.2, rx: 1.1 }),
          h("rect", { x: 13.6, y: 8.7, width: 4.4, height: 6.6, rx: 2.2 }),
          h("rect", { x: 3, y: 17.2, width: 18, height: 2.2, rx: 1.1 }),
          h("rect", { x: 8.4, y: 15, width: 4.4, height: 6.6, rx: 2.2 })
        );
      }
      if (name === "up") return h("svg", { viewBox: "0 0 10 6", width: 11, height: 7, "aria-hidden": "true", fill: "currentColor" }, path("M5 0 10 6H0z"));
      if (name === "down") return h("svg", { viewBox: "0 0 10 6", width: 11, height: 7, "aria-hidden": "true", fill: "currentColor" }, path("M0 0h10L5 6z"));
      // 标记：圆圈里一个数字（画布上标记点就是长这样的，工具图标照它画，用户一眼能对上）。
      if (name === "marker") {
        return h(
          "svg",
          box,
          h("circle", { cx: 12, cy: 12, r: 8.4, fill: "none", stroke: "currentColor", strokeWidth: 2 }),
          h("text", { x: 12, y: 16.1, textAnchor: "middle", fontSize: 11.5, fontWeight: 700, fill: "currentColor" }, "1")
        );
      }
      return null;
    }

    /**
     * 模块六：单屏零术语地图编辑器。
     *
     * 一屏三块：顶栏（项目名 / 素材 / 导出 / 保存状态）、左列（素材调色板 + 12 个工具格）、
     * 画布。没有步骤条，也没有长说明 —— 名词解释一律贴着控件写一行小字。
     */
    const MapModule = createMapModule({ React, h, activeLang, fill, T, useLocaleTick, deriveAssetName, ASSET_FRAMES_MIN, ASSET_FRAMES_MAX, stampLimits, clampStampSpan, ASSET_SHAPES, assetShapeLabel, buildAssetRequestPrompt, useHiddenModules, OPEN_SHAPES, useStudioIntent, msg, Btn, NumField, CopyIdButton, MAP_PLAN_LIST, MAP_pointToCell, MAP_cellTopLeft, MAP_lineCells, MAP_GUIDE_ART, MapToolIcon, openAssetChat });
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

    /**
     * 音乐产物的地址。
     *
     * 宿主给的 `url` 是**绝对地址**，而绝对地址的 origin 依赖浏览器上报的
     * `location.origin`；插件重载 / 新宿主刚起来时这个上报可能还没到，
     * 宿主会退化成 `http://localhost` —— 页面在 127.0.0.1:xxxxx 上时
     * 封面、播放器、下载全部指向 localhost，表现就是「图裂了、播放键没反应」。
     * 产物本身都在 `job.assetBase` 下，所以界面**优先用相对路径**，只有拿不到
     * `file`（例如只有平台远程地址）时才退回宿主给的绝对地址。
     */
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

    const MusicModule = createMusicModule({ React, h, activeLang, T, useLocaleTick, buildMusicRequestPrompt, buildComposeRequestPrompt, deriveMusicName, MUSIC_ENGINES, MUSIC_FORMATS, MUSIC_EDIT_LIMITS, useStudioIntent, msg, Chip, Btn, NumField, BusyBtn, BusyBadge, ReviewModeBar, CopyIdButton, musicFmtTime, musicAssetUrl, musicDownloadUrl, makeMusicOps, musicOpsText, musicStatusChip, MusicWave, openMusicChat });

    // ── 模块八：音效生成（火山引擎 Seed-Audio）────────────────────────────
    //
    // 与音乐模块不同：这里不派给对话，界面上直接「生成」→ 后台任务 → 轮询。
    // 每次生成新增一条 take（永不覆盖），旧 take 保留；失败不自动重试。



    /** 格式名由客户端翻，不用宿主回传的中文 label（切英文会露中文）。 */
    function sfxFormatLabel(id) {
      if (id === "mp3") return T("MP3（体积小）");
      if (id === "ogg_opus") return T("Ogg Opus（体积更小）");
      return T("WAV（无损，游戏引擎常用）");
    }

    const SfxModule = createSfxModule({ React, h, T, useLocaleTick, useStudioIntent, msg, mergeDrafts, Chip, Btn, NumField, LoadingOverlay, BusyBtn, CopyIdButton, musicAssetUrl, musicDownloadUrl, sfxFormatLabel });

    // ── 模块②：图片生成 ─────────────────────────────────────────────────
    /** 模块②的 pending key：整批生成、单张重生成、抠像、上传、新建任务。 */
    const K_IMG_JOB = "img:job";
    const K_IMG_ITEM = (index) => `img:item:${index}`;
    const K_IMG_KEY = "img:key";
    const K_IMG_UPLOAD = "img:upload";
    const K_IMG_CREATE = "img:create";

    // ── 模块五 · 45° 地图编辑器（iso）──────────────────────────────────────
    //
    // 与模块六同样的纪律：宿主下发绘制计划，客户端只 drawImage / 按 z 排序；
    // 客户端唯一复刻的是命中测试用的四个坐标函数（黄金对照盯着）。

    /** 「新增素材」物件大小的上下限（与宿主 `isotiles.parseIsoObjectScale` 同口径）。 */
    const ISO_OBJECT_SCALE_MIN = 0.1;
    const ISO_OBJECT_SCALE_MAX = 4;

    function ISO_pointToCellRaw(layout, x, y) {
      const cReal = (x / layout.stepX + y / layout.stepY) / 2;
      const rReal = (y / layout.stepY - x / layout.stepX) / 2;
      const c = Math.floor(cReal + 0.5);
      const r = Math.floor(rReal + 0.5);
      return { r, c, inMap: r >= 0 && c >= 0 && r < layout.rows && c < layout.cols };
    }

    function ISO_wrapIndex(value, size) {
      if (!(size > 0)) return value;
      const rest = value % size;
      return rest < 0 ? rest + size : rest;
    }

    function ISO_pointToCell(layout, x, y) {
      const raw = ISO_pointToCellRaw(layout, x, y);
      if (layout.wrap !== true) return raw;
      return { r: ISO_wrapIndex(raw.r, layout.rows), c: ISO_wrapIndex(raw.c, layout.cols), inMap: true };
    }

    function ISO_cellCenter(layout, r, c) {
      return { x: (c - r) * layout.stepX, y: (c + r) * layout.stepY };
    }

    function ISO_cellTopLeft(layout, r, c, width, height) {
      const center = ISO_cellCenter(layout, r, c);
      return { x: center.x - width / 2, y: center.y - height / 2 };
    }

    function ISO_lineCells(r0, c0, r1, c1) {
      const out = [];
      let r = Math.round(r0);
      let c = Math.round(c0);
      const rEnd = Math.round(r1);
      const cEnd = Math.round(c1);
      const dr = Math.abs(rEnd - r);
      const dc = Math.abs(cEnd - c);
      const sr = r < rEnd ? 1 : -1;
      const sc = c < cEnd ? 1 : -1;
      let err = dr - dc;
      for (;;) {
        out.push({ r, c });
        if (r === rEnd && c === cEnd) break;
        const e2 = 2 * err;
        if (e2 > -dc) {
          err -= dc;
          r += sr;
        }
        if (e2 < dr) {
          err += dr;
          c += sc;
        }
        if (out.length > 20000) break;
      }
      return out;
    }

    /**
     * 「新增素材」预览的场景几何（纯函数，黄金对照会拿宿主 `isogeom` 验它）。
     *
     * 返回的是**地图像素**坐标：物件底面中心在 (0,0)，地格与图片都相对它摆。
     * 物件：图片宽度 = 占格总宽 × scale，底边中点按 anchor 对齐 (0,0)；
     * 地面：整张源图按项目格子铺开，每一格里画一个 2:1 菱形。
     */
    function ISO_addPreviewScene(input) {
      const cell = input.cell ?? { width: 64, height: 96 };
      const stepX = cell.width / 2;
      const stepY = cell.width / 4;
      const halfW = cell.width / 2;
      const halfH = cell.width / 4;
      const frames = Math.max(1, Math.round(Number(input.frames) || 1));
      const nw = Math.max(0, Number(input.naturalWidth) || 0);
      const nh = Math.max(0, Number(input.naturalHeight) || 0);
      const isObject = input.object === true;
      const cols = isObject
        ? Math.max(1, Math.round(Number(input.cols) || 1))
        : Math.max(1, Math.floor((nw || 1) / Math.max(1, Number(input.sourceW) || 1)));
      const rows = isObject
        ? Math.max(1, Math.round(Number(input.rows) || 1))
        : Math.max(1, Math.floor((nh || 1) / Math.max(1, Number(input.sourceH) || 1)));
      const cells = [];
      let imageWidth = 0;
      let imageHeight = 0;
      let frameHeight = 0;
      let imageX = 0;
      let imageY = 0;
      if (isObject) {
        const scale = Math.max(ISO_OBJECT_SCALE_MIN, Math.min(ISO_OBJECT_SCALE_MAX, Number(input.scale) || 1));
        const anchor = input.anchor ?? { x: 0.5, y: 1 };
        // 与宿主 `objectSheet` 同一口径：宽度 / 帧高都取整，预览才和导入后的存图逐像素对得上。
        imageWidth = Math.max(1, Math.round(cols * cell.width * scale));
        frameHeight = nw > 0 && nh > 0 ? Math.max(1, Math.round((nh / frames) * (imageWidth / nw))) : cell.height;
        imageHeight = frameHeight * frames;
        imageX = -imageWidth * anchor.x;
        imageY = -frameHeight * anchor.y - (frames - 1) * frameHeight;
        // 底面中心在 (0,0)：每个占格的中心相对它排开。
        const ox = ((cols - rows) / 2) * stepX;
        const oy = ((cols + rows - 2) / 2) * stepY;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) cells.push({ x: (c - r) * stepX - ox, y: (c + r) * stepY - oy });
        }
      } else {
        imageWidth = cols * cell.width;
        imageHeight = rows * cell.height;
        frameHeight = imageHeight;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) cells.push({ x: (c + 0.5) * cell.width, y: (r + 0.5) * cell.height });
        }
      }
      const xs = [imageX, imageX + imageWidth];
      const ys = [imageY, imageY + imageHeight];
      for (const point of cells) {
        xs.push(point.x - halfW, point.x + halfW);
        ys.push(point.y - halfH, point.y + halfH);
      }
      const pad = Math.max(2, cell.width * 0.08);
      const x0 = Math.min(...xs) - pad;
      const y0 = Math.min(...ys) - pad;
      return {
        cell,
        cols,
        rows,
        stepX,
        stepY,
        halfW,
        halfH,
        cells,
        base: isObject ? { x: 0, y: 0 } : null,
        image: { x: imageX, y: imageY, width: imageWidth, height: imageHeight },
        imageWidth,
        frameHeight,
        viewBox: `${x0} ${y0} ${Math.max(1, Math.max(...xs) + pad - x0)} ${Math.max(1, Math.max(...ys) + pad - y0)}`
      };
    }

    const IsoModule = createIsoModule({ React, h, fill, T, useLocaleTick, deriveAssetName, ASSET_FRAMES_MIN, ASSET_FRAMES_MAX, buildIsoAssetRequestPrompt, useHiddenModules, useStudioIntent, Btn, NumField, readFileBase64, CopyIdButton, MapToolIcon, ISO_OBJECT_SCALE_MIN, ISO_OBJECT_SCALE_MAX, ISO_pointToCellRaw, ISO_cellCenter, ISO_lineCells, ISO_addPreviewScene, openIsoAssetChat });

    const ImageModule = createImageModule({ React, h, T, useLocaleTick, useStudioIntent, msg, mergeDrafts, askNewName, Chip, StatusChip, Btn, NumField, useGlobalConfig, GlobalModelField, usePendingTasks, MediaBox, BusyBtn, BusyBadge, ReviewModeBar, ApproveBtn, readFileBase64, UploadBox, KeyingFields, CopyIdButton, JobSidebar, K_IMG_JOB, K_IMG_ITEM, K_IMG_KEY, K_IMG_UPLOAD, K_IMG_CREATE, JobLogPanel , scheduler: gmmScheduler });

    // ── 模块③：序列帧生成 ───────────────────────────────────────────────
    /** 模块③的 pending key：视频、抽帧、抠像、合成、上传、新建任务。 */
    const K_SEQ_VIDEO = "seq:video";
    const K_SEQ_FRAMES = "seq:frames";
    const K_SEQ_KEY = "seq:key";
    const K_SEQ_COMPOSE = "seq:compose";
    const K_SEQ_UPLOAD = "seq:upload";
    const K_SEQ_CREATE = "seq:create";
    const K_SEQ_POLL = "seq:poll";

    const SequenceModule = createSequenceModule({ React, h, T, useLocaleTick, useStudioIntent, msg, mergeDrafts, askNewName, Chip, StatusChip, Btn, NumField, useGlobalConfig, GlobalModelField, ZoomableImage, usePendingTasks, LoadingOverlay, MediaBox, BusyBtn, BusyBadge, ReviewModeBar, ApproveBtn, readFileBase64, UploadBox, KeyingFields, CopyIdButton, JobSidebar, K_SEQ_VIDEO, K_SEQ_FRAMES, K_SEQ_KEY, K_SEQ_COMPOSE, K_SEQ_UPLOAD, K_SEQ_CREATE, K_SEQ_POLL, RefRow, SequencePlayer, JobLogPanel , scheduler: gmmScheduler });

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

    /**
     * 任务日志面板。
     *
     * 从「一条平铺的日志」升级成结构化视图，加了两件真正省时间的事：
     *
     *  1. **把「开始 X」与它之后的「X 完成 / 失败」配成一条**，并附上耗时。
     *     原样平铺时，一次生图会刷出两三条互不相邻的记录（中间夹着别的阶段），
     *     「这一步到底跑了多久、成没成」要靠人自己拼时间戳——实测排查一次拆件失败时
     *     就是这么来回翻的。
     *  2. **级别筛选 + 关键字**。日志里绝大多数是 info，出问题时真正要看的是
     *     那几条 warn/error；40 条一屏根本翻不到。
     */
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

    // ── 模块④：骨骼动画生成 ──────────────────────────────────────────────
    //
    // 四个阶段各自独立可重跑，和八方向图的手感一致：
    //   ① 拆件   —— 生图模型把角色拆成部件（**唯一花钱的一步**），也可以直接上传部件
    //   ② 装配   —— 多尺度模板匹配把部件摆回参考姿态，出对比图供肉眼验收、可拖动微调
    //   ③ 骨骼   —— 自动推骨骼层级 + 六个动画预设，出 skeleton.json 与可播放预览
    //   ④ 图集   —— 打包 Spine 纹理图集
    //
    // 设计上刻意让「重跑」便宜：②③④ 全是本地计算，失败一两个部件只重跑那几个。

    /**
     * 语义角色与中文名（与宿主 src/rigsemantics.ts 的 RIG_ROLES / ROLE_LABELS 一致）。
     *
     * 浏览器半区是经典脚本、不能 import，所以这里必然是**一份拷贝**。
     * `scripts/verify-tools.mjs` 有一条契约把两边逐项比对，防止悄悄漂移——
     * 这正是 RIG_ANIMATIONS 已经在用的做法。
     */
    // ── 手动装配编辑器 ──────────────────────────────────────────────────
    //
    // 自动定位只保证「大致对」，收尾必须靠人。这里把装配页做成一个真正的分层编辑器：
    //
    //   · **拖拽**：画布上直接拖部件；四角/四边手柄缩放；部件栏里的部件拖进画布即放置
    //   · **键盘**：方向键微调 1px（Shift = 10px），Delete 收回部件，Esc 取消选中
    //   · **吸附**：拖动时自动吸附到其它部件的边/中线与画布中线，并画出参考线
    //   · **图层**：置顶/置底/上移/下移，画出层级列表
    //   · **撤销/重做**：每一次落位都进历史栈（Ctrl+Z / Ctrl+Shift+Z）
    //   · **配置**：选中部件的 x/y/宽/高/旋转/层级数值精调，宽高可锁等比
    //
    // 关键实现选择：画布是**客户端自己叠出来的**（每层一个 <img>），不是等宿主回传
    // 合成图。拖动时只有本地 state 变化，松手才提交一次批量改动——否则每拖一帧都要
    // 一次往返 + 一次重出合成图（要解码参考图与全部部件），手感会烂掉。

    /**
     * 语义编辑面板（阶段①.5）。
     *
     * 为什么它必须存在：骨架的**父级与锚点**以前完全由「部件叫什么名字」隐式决定
     * （宿主按名字查固定表）。这让「名字」承担了它承担不起的责任——模型没按网格摆、
     * 或者角色不是标准人形时，用户只能靠改名来间接影响骨架，而改名又会连带动画、
     * 甚至让已经摆好的装配失效。
     *
     * 现在语义是显式数据：这里改一次角色/父级/锚点，骨架立刻跟着变，
     * 而**已经做好的装配不会被作废**（宿主只作废骨骼与图集）。
     *
     * 表里只列 ready 的部件；每个字段改了就打一次 `setRigSemantics`，并把来源记成
     * `human`——这样「这块人看过」是数据事实，而不是靠人记。
     */
    /**
     * 骨骼编辑器（阶段③）——三通道模型的界面。
     *
     * 这里改的是**手工偏移 `offset`**，不是绑定姿势 `origin`：
     *   - `origin` 由②的装配位置 + 语义层的锚点算出来，每次重跑②或改语义都会被重算；
     *   - `offset` 只属于人，**任何自动重跑都不碰它**。
     *
     * 所以「重新推骨骼」不会丢掉这里调过的偏置，而「清除偏移」就是回到
     * AI/几何推出来的姿势——这正是方案里「AI 重新想一遍不会抹掉人的工作」那条。
     *
     * 三根数字：位移 x/y（部件像素）与旋转（度）。全零的条目宿主会自动删掉，
     * 所以「改回 0」等于「没调过」，不需要额外的开关。
     */
    /**
     * 动画参数面板（阶段③）。
     *
     * v1 的六个预设把每一帧的角度写死在宿主源码里，「走路幅度小一点」只能改代码。
     * 这里给出两个旋钮——**幅度**（统一缩放旋转与位移）与**时长**（一个循环多久）——
     * 它们覆盖了绝大多数真实诉求，而且比一整套 K 帧编辑器便宜得多。
     *
     * 参数作用在**简写**上（归一化 curve 的阶段），时间与数值一起缩放之后再绝对化，
     * 所以控制点仍然落在正确的区间里；这个顺序在宿主侧有注释与测试盯着。
     */
    /**
     * 时间轴与关键帧编辑器（阶段⑥：动画从「参数」变成「数据」）。
     *
     * 三个取舍值得说明：
     *  1. **逐台取、整份存**。取一台动画走 `getRigAnimation`，改完整份写回
     *     `saveRigAnimation`。不做逐帧 patch——时间轴的增删改互相牵连
     *     （删一帧会同时改两个段的缓动归属），服务端再解析一遍 patch
     *     等于把同一套语义实现两遍。
     *  2. **落地时机跟着鼠标**。拖动关键帧时只改本地草稿，松手才提交；
     *     文字框失焦才提交。这与装配台一致（拖动跟手、提交少而完整）。
     *  3. **浏览器半区不自己求值**。预览仍在宿主生成的 iframe 里（它自带
     *     贝塞尔插值与骨骼叠加）。编辑提交后靠给 iframe 换一个 `?v=` 强制重载，
     *     而不是在客户端重写一套求值器——那正是方案里点名要避免的「两套实现」。
     */
    /**
     * 拆件质检面板（阶段①②之间）。
     *
     * 它解决的问题是「拆件看起来成功了，但其实不可用」：实测同一部位会被画进多个
     * 网格格子（4 段大腿、4 只鞋、3 条袖子），而网格位置决定部件名——名字错了，
     * 靠名字推的骨架从第一根骨头起就是错的。这件事原本要等到装配完、看见
     * 「头长在脚上」才发现，那时已经花掉一次生图调用和一轮手工排查。
     *
     * 放在所有阶段之前：它同时管「拆件可不可信」与「装配准不准」，而这两件事
     * 分属①②两个阶段，塞进任一个阶段里都会让另一处看不到。
     */
    /**
     * IK 约束编辑器（M5）。
     *
     * 「把一只手约束到目标点，拖动目标点时手跟随」——约束本身在这里设，
     * 而**拖动在预览页里做**（那里有真实的求值器，改一个数字看不出来对不对）。
     * 所以这个面板刻意做得很薄：选链末端、起个目标名、调弯曲方向与软 IK 权重，
     * 剩下的事交给上面那个预览的拖拽。
     */
    /**
     * 蒙皮网格与 FFD 变形面板（M5 的 L1 / L3）。
     *
     * 面板刻意做得很薄：网格密度、摆幅、循环时长、固定端四个旋钮 + 一个「给裙摆加飘动」
     * 的快捷键。**逐帧拖顶点**的编辑器不在这里——那要在对齐了网格的画布上做，
     * 而画布在预览 iframe 里；先让「裙摆飘起来」有个一键入口，比先做全套编辑器更有用。
     */
    /**
     * Path 约束面板（M5）。
     *
     * 「沿一条折线铺开一串骨」的用户想的是「让尾巴/辫子沿着这条曲线」，不是「给我
     * 一串坐标」。所以这里不让人手输点：选一根**末端骨** + 链长，默认路径就沿着
     * 这些部件的近端锚点生成；要更细的形状再走脚本/对话入口改 points。
     */
    /**
     * 贴图变体面板（阶段①，服务阶段②之后的一切）。
     *
     * 参考项目 reskin-app 把「回退原图」做成了一个特例（一个小 JSON + 重打包时查表），
     * 而且它的滑杆只存在内存里、**画布上看不到变化**（只在 export 时才烘焙）。
     * 这里做成通用机制：
     *   - 每一次换色 / 上传替换都**新增一个版本**，永不覆盖原图；
     *   - 「换回原版」就是切 `activeTexture`，成本为零；
     *   - 拖动滑杆时缩略图用 CSS filter **即时预览**，点「应用」才落成新版本。
     *
     * 之所以最终是「烤成新版本」而不是每次渲染实时算：渲染发生在浏览器（预览）
     * 与宿主（合成图/图集）两处，各自实现一遍着色只会让两边漂移。
     */
    /**
     * 版本说明的后缀。
     *
     * ⚠️ 宿主视图对可选字符串写的是 `?? null`，所以这里**必须同时容忍 null 与
     * undefined**。只判 `=== undefined` 的话，界面上会原样显示「v1 · null」——
     * 这类「字段存在但值为 null」的坑在本项目踩过不止一次。
     */
    /**
     * 「本次会话不再提示」的选择（**按模块各记一份**）。
     *
     * 刻意放在 React 状态之外：切模块时组件会卸载重建，只有闭包变量才跨挂载
     * 记得住这次选择。刷新页面即恢复提示（会话级，不落盘、不写进任务数据）。
     *
     * ⚠️ 必须**按模块分开**：共用一个标志的话，用户在骨骼动画那边勾了
     * 「不再提示」，进 45° 地图地块时弹窗就再也不出现了 —— 两个模块的
     * 实验性说明内容完全不同，那样等于静默漏掉一次告知。
     *
     * 只有 `rig` / `tile` 两格：模块⑥「地图编辑器」已经不是实验性功能，
     * 它没有弹窗，也就不需要这一格。
     */
    /**
     * 实验性说明弹窗（模块④ / ⑤ 共用）。
     *
     * 只解释现状 + 给共建入口，没有「继续 / 取消」这类功能性按钮——功能本身照常可用，
     * 这里拦的只是「不知情地把它当稳定功能用」。
     */
    // 模块⑥「俯视地图编辑器」已经没有实验性弹窗了（它不是实验性功能）。

    /**
     * 模块④的主体界面。
     *
     * 阶段之间用标签切换（和八方向图一致），但**每个阶段都自带状态、验收与重跑
     * 入口**：`parts` 逐件通过/隐藏/删除，`layout` 逐件拖动/重定位，`rig` 逐个动画
     * 播放，`atlas` 整体验收。深链接（`?dsh-gmm=1&module=rig&job=…&stage=…`）会直接
     * 落到对应阶段。
     */
    // ── 模块④：骨骼动画（feature 切片，见 src/client/features/rig/）─────────────
    const rig = createRig({
      T,
      React,
      h,
      Btn,
      StatusChip,
      NumField,
      BusyBtn,
      Chip,
          useLocaleTick,
      useStudioIntent,
      msg,
      mergeDrafts,
      askNewName,
      useGlobalConfig,
      usePendingTasks,
      LoadingOverlay,
      BusyBadge,
      ReviewModeBar,
      readFileBase64,
      UploadBox,
      CopyIdButton,
      JobLogPanel,
    });
    const { RigModule, RigSemanticsPanel } = rig;

    // ── 设置页 ───────────────────────────────────────────────────────────
    const ConfigSection = createConfigSection({ React, h, T, useLocaleTick, MODULES, MUSIC_ENGINES, normalizeHiddenKeys, publishHiddenModules, msg, Btn, NumField, BusyBtn, sfxFormatLabel });

    // ── cordis 插件体 ────────────────────────────────────────────────────
    const inject = ["slots", "remote"];

    const ModuleIcon = createModuleIcon({ h });

    // StudioPanel 引用所有面板模块的 const —— 必须等它们都初始化完再构造。
    // （以前 `function StudioPanel` 靠函数提升，读的是调用期的值，所以放前面也没事。）
    // ── 错误隔离：每个功能模块套一层边界 ────────────────────────────────
    // 单模块渲染抛错时只降级这一块（外壳与其它模块照常可用），并且计入 perf。
    const wrapFeature = (name: string, Component: any) => {
      const Boundary = createFeatureBoundary({ name });
      return function FeatureBoundary(props: any) {
        return h(Boundary, null, h(Component, props));
      };
    };
    const MapModuleBound = wrapFeature("map", MapModule);
    const MusicModuleBound = wrapFeature("music", MusicModule);
    const SfxModuleBound = wrapFeature("sfx", SfxModule);
    const IsoModuleBound = wrapFeature("iso", IsoModule);
    const ImageModuleBound = wrapFeature("image", ImageModule);
    const SequenceModuleBound = wrapFeature("sequence", SequenceModule);
    // ── 模块①：八方向图（feature 切片，见 src/client/features/sprite/）────────
    const sprite = createSprite({
      T,
      DIRECTION_KEYS,
      LABEL_OF,
      h,
      React,
      assetUrl,
      hostJob,
      Btn,
      BusyBtn,
      LocalVideoPick,
      pickLocalVideo,
      NumField,
      SaveLink,
      BusyBadge,
      MediaBox,
      fileLabel,
      jobCovers,
      Chip,
      StatusChip,
      DIRECTIONS,
      ZoomableImage,
      LoadingOverlay,
      directionKeyFor,
      COMPASS_OF,
      KEY_AXIS,
      // 依赖逐项补齐（由 tsc 报告漏项后自动追加）
    });
    let IMAGE_MODES = sprite.IMAGE_MODES();
    const { renderImageStage, renderVideoStage, renderFrameStage, renderSheetStage, WalkPreview, KEY_EXPORT_IMAGES, ImageModeBar, TurnAxis, TurnImageStage, FramePickAxis, FramePickPanel, FrameStage } = sprite;
    const StudioPanel = createStudioPanel({ React, h, T, useLocaleTick, DIRECTION_KEYS, STAGES, useHiddenModules, visibleModulesOf, useStudioIntent, msg, mergeDrafts, askNewName, Btn, assetUrl, usePendingTasks, BusyBtn, ReviewModeBar, stageHint, stageDone, KEY_EXPORT_IMAGES, renderImageStage, renderVideoStage, renderFrameStage, renderSheetStage, WalkPreview, fileLabel, CopyIdButton, MapModule: MapModuleBound, MusicModule: MusicModuleBound, SfxModule: SfxModuleBound, IsoModule: IsoModuleBound, ImageModule: ImageModuleBound, SequenceModule: SequenceModuleBound, renderLog, RigModule, ModuleIcon, StudioGlyphIcon , scheduler: gmmScheduler });

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

      const call = async (method, payload?: any) => {
        await mount;
        const remote = ctx.get(`remote.${SERVICE}`);
        if (remote === undefined) throw new Error(T("gameStudio 远程服务不可用，请确认插件已启用"));
        const result = payload === undefined ? await remote[method]() : await remote[method](payload);
        if (result === null || typeof result !== "object" || result.ok !== true) {
          const detail = result?.error;
          throw new Error(detail === undefined ? T("{n0} 调用失败", { n0: method }) : `${detail.code ?? "ERROR"}: ${detail.message ?? ""}`);
        }
        return result.value;
      };

      const api = {
        getConfig: () => call("getConfig"),
        saveConfig: (payload) => call("saveConfig", payload),
        testArk: () => call("testArk"),
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
        runImage: (payload) => call("runImage", payload),
        runImages: (payload) => call("runImages", payload),
        setImageMode: (payload) => call("setImageMode", payload),
        runTurnVideo: (payload) => call("runTurnVideo", payload),
        runTurnFrames: (payload) => call("runTurnFrames", payload),
        setTurnPick: (payload) => call("setTurnPick", payload),
        setTurnPicks: (payload) => call("setTurnPicks", payload),
        resetTurnPicks: (payload) => call("resetTurnPicks", payload),
        cutTurnFrames: (payload) => call("cutTurnFrames", payload),
        runVideos: (payload) => call("runVideos", payload),
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
        runImageJob: (payload) => call("runImageJob", payload),
        keyImageJob: (payload) => call("keyImageJob", payload),

        listSequenceJobs: () => call("listSequenceJobs"),
        createSequenceJob: (payload) => call("createSequenceJob", payload),
        getSequenceJob: (jobId) => call("getSequenceJob", { jobId }),
        deleteSequenceJob: (payload) => call("deleteSequenceJob", payload),
        saveSequenceJob: (payload) => call("saveSequenceJob", payload),
        uploadSequenceRef: (payload) => call("uploadSequenceRef", payload),
        removeSequenceRef: (payload) => call("removeSequenceRef", payload),
        runSequenceVideo: (payload) => call("runSequenceVideo", payload),
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
    runRigRedraw: (payload) => call("runRigRedraw", payload),
        runRigSheet: (payload) => call("runRigSheet", payload),
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
        submitMusicScoreToSuno: (payload) => call("submitMusicScoreToSuno", payload),
        saveMusicJob: (payload) => call("saveMusicJob", payload),
        deleteMusicJob: (payload) => call("deleteMusicJob", payload),
        setMusicApproved: (payload) => call("setMusicApproved", payload),
        revealMusicJob: (payload) => call("revealMusicJob", payload),
        runMusicGeneration: (payload) => call("runMusicGeneration", payload),
        cancelMusicGeneration: (payload) => call("cancelMusicGeneration", payload),
        refreshMusicJob: (payload) => call("refreshMusicJob", payload),
        getMusicWav: (payload) => call("getMusicWav", payload),
        getMusicLrc: (payload) => call("getMusicLrc", payload),
        listMusicHistory: (payload) => call("listMusicHistory", payload ?? {}),
        listMusicStemInstruments: () => call("listMusicStemInstruments"),
        runMusicTool: (payload) => call("runMusicTool", payload),
        musicPeaks: (payload) => call("musicPeaks", payload),
        renderMusicEdit: (payload) => call("renderMusicEdit", payload),
        saveMusicVersion: (payload) => call("saveMusicVersion", payload),
        deleteMusicVersion: (payload) => call("deleteMusicVersion", payload),
        exportMusic: (payload) => call("exportMusic", payload),
        // 音效生成（模块八）
        testSfx: () => call("testSfx"),
        listSfxJobs: () => call("listSfxJobs"),
        createSfxJob: (payload) => call("createSfxJob", payload),
        getSfxJob: (payload) => call("getSfxJob", payload),
        saveSfxJob: (payload) => call("saveSfxJob", payload),
        deleteSfxJob: (payload) => call("deleteSfxJob", payload),
        uploadSfxRef: (payload) => call("uploadSfxRef", payload),
        removeSfxRef: (payload) => call("removeSfxRef", payload),
        runSfxGeneration: (payload) => call("runSfxGeneration", payload),
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
          pendingIntent = null;
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
            label: () => T("游戏素材大师"),
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
            label: () => T("游戏素材大师"),
            inject: () => ({ api })
          },
          ConfigSection
        )
      );
    }

    bundleModule.exports.apply = apply;
    bundleModule.exports.inject = inject;
    bundleModule.exports.GAME_STUDIO_PANEL_ID = GAME_STUDIO_PANEL_ID;
    // 仅测试用把手：三个模块组件在工厂闭包里，脚本要能拿出来单独渲染
    // （见 scripts/verify-feedback.mjs）。运行时没有任何调用点。
    /**
     * 给自检用的把手。
     *
     * `MAP_*` 那几个是**只读的坐标函数**：`verify-map-client.mjs` 拿宿主
     * `mapgeom` / `mapdoc` 的真实现做黄金对照逐点比对 —— 界面复刻的那部分几何
     * 必须有守门的，否则「预览与导出错位」会以静默的方式回来。
     */
    bundleModule.exports.__test = { StudioPanel, IsoModule, ImageModule, SequenceModule, mergeDrafts, RigSemanticsPanel, MapModule, MusicModule, SfxModule, ISO_pointToCell, ISO_cellCenter, ISO_cellTopLeft, ISO_lineCells, MAP_pointToCell, MAP_cellAnchor, MAP_cellTopLeft, MAP_lineCells, usePendingTasks, LoadingOverlay, MediaBox, BusyBtn, BusyBadge, NumField, ZoomableImage, CSS, subscribeIntent, parseIntents, openStudioIntent, OPEN_QUERY_KEY, StudioGlyph, StudioGlyphIcon, publishHiddenModules, useHiddenModules, visibleModulesOf, normalizeHiddenKeys, ConfigSection, attachSessionBridge, openAssetChat, openMusicChat, buildAssetRequestPrompt, buildIsoAssetRequestPrompt, buildMusicRequestPrompt, buildComposeRequestPrompt, openIsoAssetChat, deriveAssetName, deriveMusicName, ASSET_FRAMES_MIN, ASSET_FRAMES_MAX };
    return bundleModule.exports;
  }
});


