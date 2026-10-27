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
import { createComposition } from "./client/shell/composition.js";
import { createApply } from "./client/shell/apply.js";
import { createMusic } from "./client/features/music/index.js";
import { createSfx } from "./client/features/sfx/index.js";
import { createSequence } from "./client/features/sequence/index.js";
import { createImage } from "./client/features/image/index.js";
import { createMap } from "./client/features/map/index.js";
import { createIso } from "./client/features/iso/index.js";
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

    /** 消费掉待处理意图（apply 里消费 URL 意图后调用）。 */
    function clearPendingIntent() {
      pendingIntent = null;
    }

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
    // ── shell：模块装配（见 src/client/shell/composition.ts）─────────────────
    const composition = createComposition({
          h,
      React,
      activeLang,
      fill,
      T,
      useLocaleTick,
      deriveAssetName,
      ASSET_FRAMES_MIN,
      ASSET_FRAMES_MAX,
      stampLimits,
      clampStampSpan,
      ASSET_SHAPES,
      assetShapeLabel,
      buildAssetRequestPrompt,
      useHiddenModules,
      OPEN_SHAPES,
      useStudioIntent,
      msg,
      Btn,
      NumField,
      CopyIdButton,
      openAssetChat,
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
      JobSidebar,
      gmmScheduler,
      buildMusicRequestPrompt,
      buildComposeRequestPrompt,
      deriveMusicName,
      MUSIC_ENGINES,
      MUSIC_FORMATS,
      MUSIC_EDIT_LIMITS,
      openMusicChat,
      buildIsoAssetRequestPrompt,
      openIsoAssetChat,
      MODULES,
      normalizeHiddenKeys,
      publishHiddenModules,
      createFeatureBoundary,
      DIRECTION_KEYS,
      LABEL_OF,
      assetUrl,
      hostJob,
      LocalVideoPick,
      pickLocalVideo,
      SaveLink,
      fileLabel,
      jobCovers,
      DIRECTIONS,
      directionKeyFor,
      COMPASS_OF,
      KEY_AXIS,
      STAGES,
      visibleModulesOf,
      stageHint,
      stageDone,
      StudioGlyphIcon,
    });
    const { map, MapModule, MAP_PLAN_LIST, MAP_wrapIndex, MAP_pointToCell, MAP_cellAnchor, MAP_cellTopLeft, MAP_lineCells, MAP_GUIDE_ART, MapToolIcon, MapModuleRaw, sequence, SequenceModule, RefRow, SequencePlayer, JobLogPanel, renderLog, K_SEQ_VIDEO, K_SEQ_FRAMES, K_SEQ_KEY, K_SEQ_COMPOSE, K_SEQ_UPLOAD, K_SEQ_CREATE, K_SEQ_POLL, SequenceModuleRaw, music, MusicModule, musicFmtTime, musicAssetUrl, musicDownloadUrl, makeMusicOps, musicOpsText, musicStatusChip, MusicWave, MusicModuleRaw, sfx, SfxModule, sfxFormatLabel, SfxModuleRaw, image, ImageModule, K_IMG_JOB, K_IMG_ITEM, K_IMG_KEY, K_IMG_UPLOAD, K_IMG_CREATE, ImageModuleRaw, iso, IsoModule, ISO_OBJECT_SCALE_MIN, ISO_OBJECT_SCALE_MAX, ISO_pointToCell, ISO_cellCenter, ISO_cellTopLeft, ISO_lineCells, ISO_addPreviewScene, IsoModuleRaw, rig, RigModule, RigSemanticsPanel, ConfigSection, inject, ModuleIcon, wrapFeature, sprite, renderImageStage, renderVideoStage, renderFrameStage, renderSheetStage, WalkPreview, KEY_EXPORT_IMAGES, ImageModeBar, TurnAxis, TurnImageStage, FramePickAxis, FramePickPanel, FrameStage, StudioPanel } = composition;
    let IMAGE_MODES = composition.IMAGE_MODES;

    const apply = createApply({
          attachI18n,
      attachSessionBridge,
      PACKAGE,
      CONTRIBUTION,
      SERVICE,
      T,
      activeLang,
      installIntentInterceptor,
      intentListeners,
      pendingIntent,
      reportClientOrigin,
      consumeUrlIntent,
      GAME_STUDIO_PANEL_ID,
      StudioGlyph,
      StudioPanel,
      ConfigSection,
          clearPendingIntent,
          CSS,
    });

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
    bundleModule.exports.__test = { StudioPanel, IsoModule: IsoModuleRaw, ImageModule: ImageModuleRaw, SequenceModule: SequenceModuleRaw, mergeDrafts, RigSemanticsPanel, MapModule: MapModuleRaw, MusicModule: MusicModuleRaw, SfxModule: SfxModuleRaw, ISO_pointToCell, ISO_cellCenter, ISO_cellTopLeft, ISO_lineCells, MAP_pointToCell, MAP_cellAnchor, MAP_cellTopLeft, MAP_lineCells, usePendingTasks, LoadingOverlay, MediaBox, BusyBtn, BusyBadge, NumField, ZoomableImage, CSS, subscribeIntent, parseIntents, openStudioIntent, OPEN_QUERY_KEY, StudioGlyph, StudioGlyphIcon, publishHiddenModules, useHiddenModules, visibleModulesOf, normalizeHiddenKeys, ConfigSection, attachSessionBridge, openAssetChat, openMusicChat, buildAssetRequestPrompt, buildIsoAssetRequestPrompt, buildMusicRequestPrompt, buildComposeRequestPrompt, openIsoAssetChat, deriveAssetName, deriveMusicName, ASSET_FRAMES_MIN, ASSET_FRAMES_MAX };
    return bundleModule.exports;
  }
});


