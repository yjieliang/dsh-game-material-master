/**
 * 浏览器半区 · 组合根（shell/bootstrap）。
 *
 * 原来这些装配代码整个塞在 src/client.ts 的 __ModuleLoader__ 回调里。现在 client.ts
 * 只留「注册插件 + 取 React」的十几行，装配顺序、依赖注入、导出与自检把手都在本文件：
 *
 *   React → i18n（T）→ platform 运行时 → 远程方法 → 模块表 → 功能管理 → 意图
 *   → 提示词 → 新对话桥 → 图标 → ui kit → 组合（各 feature + 面板）→ apply
 *
 * 顺序有意义：T 必须先有（所有表要用），ui kit 要晚于 T，面板要晚于各 feature。
 */

import { CSS } from "../styles.js";
import { createUiKit } from "../ui.js";
import { installRuntime } from "../platform/runtime.js";
import { perf } from "../platform/perf.js";
import { createStudioStateStore } from "../platform/store.js";
import { provideRuntime } from "../platform/runtime.js";
import { createRemote } from "../platform/remote.js";
import { createI18n } from "../platform/i18n.js";
import { createMeta } from "../platform/meta.js";
import { createSessionBridge } from "../platform/session-bridge.js";
import { createHiddenModules } from "../platform/hidden.js";
import { createIntents } from "../platform/intents.js";
import { createFeatureBoundary } from "../platform/errors.js";
import { createPollScheduler } from "../platform/scheduler.js";
import { createSprite } from "../features/sprite/index.js";
import { createRig } from "../features/rig/index.js";
import { createPrompts } from "../infra/prompts.js";
import { createComposition } from "../shell/composition.js";
import { createChrome } from "../shell/chrome.js";
import { createApply } from "../shell/apply.js";
import { createMusic } from "../features/music/index.js";
import { createSfx } from "../features/sfx/index.js";
import { createSequence } from "../features/sequence/index.js";
import { createImage } from "../features/image/index.js";
import { createMap } from "../features/map/index.js";
import { createIso } from "../features/iso/index.js";
import { EN } from "../i18n-en.js";
import { createSfxModule } from "../sfx-module.js";
import { createConfigSection } from "../config-section.js";
import { createImageModule } from "../image-module.js";
import { createSequenceModule } from "../sequence-module.js";
import { createMusicModule } from "../music-module.js";
import { createIsoModule } from "../iso-module.js";
import { createMapModule } from "../map-module.js";
import { createStudioPanel } from "../studio-panel.js";
import { createModuleIcon } from "../module-icon.js";

export interface BootstrapInput {
  React: any;
  module: any;
}

export function createBootstrap(input: BootstrapInput): any {
  const { React, module: bundleModule } = input;
  const h = React.createElement;

    const PACKAGE = "dsh-game-material-master";
    const SERVICE = "gameStudio";
    const GAME_STUDIO_PANEL_ID = "gameStudio";

    // ── 多语言（platform/i18n）────────────────────────────────────────────
    const i18n = createI18n({

          PACKAGE,
      rebuildStaticText,
      React,
    });
    const { T, activeLang, installI18n, useLocaleTick, attachI18n , fill } = i18n;
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

    /**
     * 工作台在 `main` 槽里的 key，也是侧栏 `sidebar.panellist` 的 id。
     * 深链接要切到的就是它（宿主 src/links.ts 的 PANEL_KEY 必须与它一致）。
     */

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

    /**
     * 语言切换后必须重算的模块级文案表。
     *
     * 这些表在模块加载时就求了值（`T()` 是纯函数，模块级调用不会自己变），
     * 不重算的话语言切了它们还停在旧语言——页签标题、方向名这类就属于此列。
     */
    const staticTextRebuilders: Array<() => void> = [
      () => {
        meta.rebuildStaticText();
      },
      () => {
        IMAGE_MODES = sprite.rebuildStaticText();
      },
      () => {
        rig.rebuildStaticText();
      },
    ];

    /** 重算全部模块级文案表（幂等；语言切换与首次挂载都会走一次）。 */
    function rebuildStaticText(): void {
      for (const rebuild of staticTextRebuilders) rebuild();
    }

    /**
     * 中文表是恒等映射。必须写全：locale 服务的回退链是「当前语言 → en」，
     * 只注册 en 的话中文界面会一路落到英文。
     */
    /**
     * 当前界面语言，规整成宿主认识的两个值。
     *
     * 内置默认提示词（八方向生图 / 行走视频 / 转圈视频）存在宿主侧，
     * 宿主没有 locale 服务，所以每次读写提示词都把它带过去。
     * 服务不在时按中文算——那也正是界面当时的语言。
     */
    /**
     * 挂上 DSH 的 locale 服务。
     *
     * locale 是**可选**依赖：服务不在（或注册失败）时界面继续用中文原文，
     * 插件不会因为缺这一个服务就整块不挂载。
     * @returns 是否挂上了。
     */
    /**
     * 把 locale 服务接进来。立刻不是它的锅（服务可能比插件后挂载），
     * 所以先试一次，没成就等它可用——用 ctx.inject 而不是把它写进 inject 列表：
     * 写进去会让整个插件卡在这个服务上，缺了它就整个不挂载。
     */

    /**
     * 开一个新对话并把提示词发进去（音乐 / 地图素材等自动任务共用）。
     *
     * `sessions.create({})` **不给 workspaceId、也不给 cwd** —— 这就是「不挂靠项目」：
     * 会话落在侧栏的未分组里，不占任何项目 / 工作区。建好先 `openSession` 把主列切到
     * 对话界面（`uiWorkspace.openSession` 内部会 `layout.selectPanel(null)`），
     * 再用 `beginSubmission` + `prompt` 把那句话作为第一轮发出去。
     */
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
    // ── 远程方法清单（platform/remote）────────────────────────────────────
    const remoteSpec = createRemote({ PACKAGE, SERVICE });
    const { codec, REMOTE_METHODS, CONTRIBUTION } = remoteSpec;

    // ── 模块表 / 方向元数据 / 文案表（platform/meta）─────────────────────────
    const meta = createMeta({

          T,
    });
    const { DIRECTIONS, DIRECTION_KEYS, LABEL_OF, COMPASS_OF, directionKeyFor, KEY_AXIS, hostJob, jobCovers, MODULES, STAGES, MUSIC_ENGINES, MUSIC_PHASES, MUSIC_FORMATS, MUSIC_EDIT_LIMITS, musicEngineOf } = meta;

    // ── 宿主侧后台任务的覆盖面（与宿主 src/pipeline.ts 的 JobInfo.targets 对应）──
    /**
     * 找一个正在跑的后台任务。
     *
     * `getProject` 会把宿主的运行表一起带回来（`project.jobs`），这是「正在跑什么」
     * 的唯一真相：本地那张 pending 表只活到远程调用返回（批量提交是 kick 型调用，
     * 一提交就返回 `{started:true}`，真正的活还在后台），撑不住整段任务。
     */
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

    // ── 提示词构建器（infra/prompts）──────────────────────────────────────
    const prompts = createPrompts({ T, MUSIC_ENGINES });
    const { buildAssetRequestPrompt, buildIsoAssetRequestPrompt, buildMusicRequestPrompt, buildComposeRequestPrompt, deriveMusicName, deriveAssetName, ASSET_FRAMES_MIN, ASSET_FRAMES_MAX, ASSET_SHAPES, assetShapeLabel, stampLimits, clampStampSpan } = prompts;

    // ── 功能管理：隐藏模块状态（platform/hidden）───────────────────────────
    const hiddenModules = createHiddenModules({

          MODULES,
      React,
          T,
    });

    // ── 新对话桥（platform/session-bridge）────────────────────────────────
    const sessionBridge = createSessionBridge({

          T,
    });
    const { attachSessionBridge, openStudioTaskChat, openAssetChat, openIsoAssetChat, openMusicChat } = sessionBridge;
    const { normalizeHiddenKeys, publishHiddenModules, refreshHiddenModules, useHiddenModules, visibleModulesOf } = hiddenModules;

    /**
     * 组件里用：当前被隐藏的模块 key 数组。
     *
     * `api` 可省略（那时只订阅、不主动拉取）——设置页自己会 `load()` 并 publish。
     */

    // ── 意图 / 深链接（platform/intents）─────────────────────────────────
    const intents = createIntents({

          React,
      GAME_STUDIO_PANEL_ID,
          T,
    });
    const { subscribeIntent, useStudioIntent, parseIntents, openStudioIntent, installIntentInterceptor, consumeUrlIntent, reportClientOrigin, clearPendingIntent, OPEN_SHAPES, OPEN_QUERY_KEY, intentListeners } = intents;

    /**
     * 切到工作台面板并广播意图。
     *
     * `layout.selectPanel` 在面板还没注册时会抛错（插件 apply 与页面启动有先后），
     * 所以这里带重试；重试期间意图已经广播出去了，组件挂载后会自己接上。
     */
    /**
     * 直接以 `/?dsh-gmm=…` 打开时的兜底路径（中键、Ctrl+点击、或用户手动贴链接）：
     * 应用正常启动，这里读一次查询参数、把它从地址栏清掉、再切面板。
     */
    /**
     * 把真实 origin 与应用路径前缀报给宿主：宿主不知道对外地址（可能被反代改写），
     * 而模型要在回复里贴出可点的绝对链接。`path` 让 DSH 0.2.1 的
     * `--public-url https://host/prefix/` 部署也能拼对回链与产物地址。
     * 失败不影响任何功能。
     */
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
    // ── 共享状态（platform/store）：项目快照 + 草稿 ─────────────────────────
    // 以前这些是 StudioPanel 的 useState，轮询回包 setState 就重渲染整棵模块子树；
    // 现在写进 store，面板与各模块组件按 selector 精确订阅（P9）。
    // React 从组合根注入（platform 不许在模块顶层 import react；自检桩也要用自己的假 React）。
    const studioStore = createStudioStateStore({ React, sameDraft });
    // ui 组件表挂到运行时：后续模块可直接 studio().ui.Btn 取用（P3 起）
    provideRuntime({ scheduler: gmmScheduler, perf, store: studioStore, ui: { cls, msg, sameDraft, mergeDrafts, askNewName, statusKind, Chip, StatusChip, Btn, NumField, useGlobalConfig, GlobalModelField, assetUrl, ZoomableImage, TASK_HOLD_MS, usePendingTasks, LoadingOverlay, MediaBox, BusyBtn, BusyBadge, ReviewModeBar, ApproveBtn, readFileBase64, UploadBox, LocalVideoPick, fileLabel, SaveLink, pickLocalVideo, KeyingFields, copyIdText, CopyIdButton, JobSidebar } });

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
    // ── 外壳图标（shell/chrome）────────────────────────────────────────────
    const chrome = createChrome({

          useHiddenModules,
      visibleModulesOf,
      openStudioIntent,
          h,
      React,
      T,
    });
    const { StudioGlyphIcon, ChevronGlyph, StudioGlyph } = chrome;

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
      store: studioStore,
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
    bundleModule.exports.__test = { StudioPanel, installI18n, IsoModule: IsoModuleRaw, studioStore, ImageModule: ImageModuleRaw, SequenceModule: SequenceModuleRaw, mergeDrafts, RigSemanticsPanel, MapModule: MapModuleRaw, MusicModule: MusicModuleRaw, SfxModule: SfxModuleRaw, ISO_pointToCell, ISO_cellCenter, ISO_cellTopLeft, ISO_lineCells, MAP_pointToCell, MAP_cellAnchor, MAP_cellTopLeft, MAP_lineCells, usePendingTasks, LoadingOverlay, MediaBox, BusyBtn, BusyBadge, NumField, ZoomableImage, CSS, subscribeIntent, parseIntents, openStudioIntent, OPEN_QUERY_KEY, StudioGlyph, StudioGlyphIcon, publishHiddenModules, useHiddenModules, visibleModulesOf, normalizeHiddenKeys, ConfigSection, attachSessionBridge, openAssetChat, openMusicChat, buildAssetRequestPrompt, buildIsoAssetRequestPrompt, buildMusicRequestPrompt, buildComposeRequestPrompt, openIsoAssetChat, deriveAssetName, deriveMusicName, ASSET_FRAMES_MIN, ASSET_FRAMES_MAX };
    return bundleModule.exports;
}
