/**
 * 浏览器半区 · 组合（shell/composition）。
 *
 * 这里是「把零件装成整台机器」的地方：基础组件表（ui kit）、各 feature 的创建、
 * 设置页、模块图标、错误边界包装、以及最终的工作台面板 StudioPanel。
 *
 * 它只被 composition root（src/client.ts）调用一次；具体每个 feature 内部怎么实现，
 * shell 一概不关心 —— 依赖从 deps 注入，返回值平铺给调用方。
 */

import { featureKeys } from "../features/registry.js";
import { createMap } from "../features/map/index.js";
import { createIso } from "../features/iso/index.js";
import { createMusic } from "../features/music/index.js";
import { createSfx } from "../features/sfx/index.js";
import { createSequence } from "../features/sequence/index.js";
import { createImage } from "../features/image/index.js";
import { createSprite } from "../features/sprite/index.js";
import { createRig } from "../features/rig/index.js";
import { createConfigSection } from "../config-section.js";
import { createModuleIcon } from "../module-icon.js";
import { createStudioPanel } from "../studio-panel.js";
import { createTheme } from "../platform/theme.js";
import type { CompositionDeps } from "../platform/deps.js";

export function createComposition(deps: CompositionDeps) {
  // 依赖：组合根注入的键由 platform/deps 的 CompositionDeps 钉住，解构这里按需展开。
  const {
    h,
    React,
    store,
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
  } = deps;
    // ── 模块六 · 地图编辑器（feature 切片，见 src/client/features/map/）────────────────
    const map = createMap({
      store,

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
      gmmScheduler,
    });
    const { MapModule, MAP_PLAN_LIST, MAP_wrapIndex, MAP_pointToCell, MAP_cellAnchor, MAP_cellTopLeft, MAP_lineCells, MAP_GUIDE_ART, MapToolIcon, MapModuleRaw } = map;

    /**
     * 两格之间的直线（拖动补间不能漏格）。
     * **与宿主 `mapdoc.lineCells` 同构**，黄金对照同样覆盖它。
     */

    /**
     * 工具格的图标：内联 SVG 自绘（形状语义对齐 AsLib）。
     *
     * 纯函数、不碰 state：面板重渲染时重建这几个图标，代价可以忽略。
     */
    /**
     * 模块六：单屏零术语地图编辑器。
     *
     * 一屏三块：顶栏（项目名 / 素材 / 导出 / 保存状态）、左列（素材调色板 + 12 个工具格）、
     * 画布。没有步骤条，也没有长说明 —— 名词解释一律贴着控件写一行小字。
     */
    // ── 模块③：序列帧生成（feature 切片，见 src/client/features/sequence/）──────────
    const sequence = createSequence({
      store,

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
    });
    const { SequenceModule, RefRow, SequencePlayer, JobLogPanel, renderLog, K_SEQ_VIDEO, K_SEQ_FRAMES, K_SEQ_KEY, K_SEQ_COMPOSE, K_SEQ_UPLOAD, K_SEQ_CREATE, K_SEQ_POLL, SequenceModuleRaw } = sequence;

    // ── 模块七：音乐生成编辑（feature 切片，见 src/client/features/music/）────────────
    const music = createMusic({
      store,
          T,
      h,
      Chip,
      React,
      activeLang,
      useLocaleTick,
      buildMusicRequestPrompt,
      buildComposeRequestPrompt,
      deriveMusicName,
      MUSIC_ENGINES,
      MUSIC_FORMATS,
      MUSIC_EDIT_LIMITS,
      useStudioIntent,
      msg,
      Btn,
      NumField,
      BusyBtn,
      BusyBadge,
      ReviewModeBar,
      CopyIdButton,
      openMusicChat,
      gmmScheduler,
    });
    const { MusicModule, musicFmtTime, musicAssetUrl, musicDownloadUrl, makeMusicOps, musicOpsText, musicStatusChip, MusicWave, MusicModuleRaw } = music;

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
    // ── 模块八：音效生成（火山引擎 Seed-Audio）────────────────────────────
    //
    // 与音乐模块不同：这里不派给对话，界面上直接「生成」→ 后台任务 → 轮询。
    // 每次生成新增一条 take（永不覆盖），旧 take 保留；失败不自动重试。



    // ── 模块八：音效生成（feature 切片，见 src/client/features/sfx/）────────────
    const sfx = createSfx({
      store,

          T,
      React,
      h,
      useLocaleTick,
      useStudioIntent,
      msg,
      mergeDrafts,
      Chip,
      Btn,
      NumField,
      LoadingOverlay,
      BusyBtn,
      CopyIdButton,
      musicAssetUrl,
      musicDownloadUrl,
      gmmScheduler,
    });
    const { SfxModule, sfxFormatLabel, SfxModuleRaw } = sfx;

    // ── 模块②：图片生成（feature 切片，见 src/client/features/image/）──────────────
    const image = createImage({
      store,

          React,
      h,
      T,
      useLocaleTick,
      useStudioIntent,
      msg,
      mergeDrafts,
      askNewName,
      Chip,
      StatusChip,
      Btn,
      NumField,
      useGlobalConfig,
      GlobalModelField,
      usePendingTasks,
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
      JobLogPanel,
      gmmScheduler,
    });
    const { ImageModule, K_IMG_JOB, K_IMG_ITEM, K_IMG_KEY, K_IMG_UPLOAD, K_IMG_CREATE, ImageModuleRaw } = image;

    // ── 模块五 · 45° 地图编辑器（iso）──────────────────────────────────────
    //
    // 与模块六同样的纪律：宿主下发绘制计划，客户端只 drawImage / 按 z 排序；
    // 客户端唯一复刻的是命中测试用的四个坐标函数（黄金对照盯着）。

    // ── 模块五 · 45° 地图编辑器（iso，feature 切片，见 src/client/features/iso/）──────────
    const iso = createIso({
      store,

          React,
      h,
      fill,
      T,
      useLocaleTick,
      deriveAssetName,
      ASSET_FRAMES_MIN,
      ASSET_FRAMES_MAX,
      buildIsoAssetRequestPrompt,
      useHiddenModules,
      useStudioIntent,
      Btn,
      NumField,
      readFileBase64,
      CopyIdButton,
      MapToolIcon,
      openIsoAssetChat,
      gmmScheduler,
    });
    const { IsoModule, ISO_OBJECT_SCALE_MIN, ISO_OBJECT_SCALE_MAX, ISO_pointToCell, ISO_cellCenter, ISO_cellTopLeft, ISO_lineCells, ISO_addPreviewScene, IsoModuleRaw } = iso;

    /**
     * 「新增素材」预览的场景几何（纯函数，黄金对照会拿宿主 `isogeom` 验它）。
     *
     * 返回的是**地图像素**坐标：物件底面中心在 (0,0)，地格与图片都相对它摆。
     * 物件：图片宽度 = 占格总宽 × scale，底边中点按 anchor 对齐 (0,0)；
     * 地面：整张源图按项目格子铺开，每一格里画一个 2:1 菱形。
     */

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
      store,
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
      gmmScheduler,
    });
    const { RigModule, RigSemanticsPanel } = rig;

    // ── 设置页 ───────────────────────────────────────────────────────────
    const ConfigSection = createConfigSection({ React, h, T, useLocaleTick, MODULES, MUSIC_ENGINES, normalizeHiddenKeys, publishHiddenModules, msg, Btn, NumField, BusyBtn, sfxFormatLabel });

    // ── cordis 插件体 ────────────────────────────────────────────────────
    const inject = ["slots", "remote"];

    const ModuleIcon = createModuleIcon({ h });

    // ── 宿主明暗探测（platform/theme）：插件自带设计令牌，深浅色要跟着宿主走 ──
    const theme = createTheme({
      window: typeof window === "undefined" ? null : window,
      document: typeof document === "undefined" ? null : document
    });
    // 立即同步一次并把 data-gmm-theme 写到 <html>；之后宿主换肤由 MutationObserver 跟进。
    try {
      theme.start();
    } catch {
      /* 主题探测失败按浅色渲染 */
    }

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
    // ── 模块①：八方向图（feature 切片，见 src/client/features/sprite/）────────
    const sprite = createSprite({
      store,
      T,
      DIRECTION_KEYS,
      LABEL_OF,
      h,
      React,
      assetUrl,
      hostJob,
      msg,
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
    const StudioPanel = createStudioPanel({ React, h, T, store, useLocaleTick, DIRECTION_KEYS, STAGES, useHiddenModules, visibleModulesOf, useStudioIntent, msg, mergeDrafts, askNewName, Btn, assetUrl, usePendingTasks, BusyBtn, ReviewModeBar, stageHint, stageDone, KEY_EXPORT_IMAGES, renderImageStage, renderVideoStage, renderFrameStage, renderSheetStage, WalkPreview, fileLabel, CopyIdButton, MapModule, MusicModule, SfxModule, IsoModule, ImageModule, SequenceModule, renderLog, RigModule, ModuleIcon, StudioGlyphIcon, scheduler: gmmScheduler });

    /**
     * 宿主明暗订阅层：Hook 只在包装组件里调，StudioPanel 本身的 Hook 槽位保持不变
     * （verify-feedback 按「每个组件的 Hook 数量与顺序」喂桩数据，槽位一变整片断言就错位）。
     */

  // 启动自检：面板的模块表顺序必须和 feature registry 一致（两处清单不许漂移）。
  try {
    const expected = featureKeys().join(",");
    const actual = (MODULES ?? []).map((module: any) => module.key).join(",");
    if (expected !== actual) console.warn("[inkbox] MODULES 与 features/registry 顺序不一致：" + actual + " ≠ " + expected);
  } catch {
    /* 自检失败不影响界面 */
  }

  return {
    map, MapModule, MAP_PLAN_LIST, MAP_wrapIndex, MAP_pointToCell, MAP_cellAnchor, MAP_cellTopLeft, MAP_lineCells, MAP_GUIDE_ART, MapToolIcon, MapModuleRaw, sequence, SequenceModule, RefRow, SequencePlayer, JobLogPanel, renderLog, K_SEQ_VIDEO, K_SEQ_FRAMES, K_SEQ_KEY, K_SEQ_COMPOSE, K_SEQ_UPLOAD, K_SEQ_CREATE, K_SEQ_POLL, SequenceModuleRaw, music, MusicModule, musicFmtTime, musicAssetUrl, musicDownloadUrl, makeMusicOps, musicOpsText, musicStatusChip, MusicWave, MusicModuleRaw, sfx, SfxModule, sfxFormatLabel, SfxModuleRaw, image, ImageModule, K_IMG_JOB, K_IMG_ITEM, K_IMG_KEY, K_IMG_UPLOAD, K_IMG_CREATE, ImageModuleRaw, iso, IsoModule, ISO_OBJECT_SCALE_MIN, ISO_OBJECT_SCALE_MAX, ISO_pointToCell, ISO_cellCenter, ISO_cellTopLeft, ISO_lineCells, ISO_addPreviewScene, IsoModuleRaw, rig, RigModule, RigSemanticsPanel, ConfigSection, inject, ModuleIcon, theme, wrapFeature, sprite, IMAGE_MODES, renderImageStage, renderVideoStage, renderFrameStage, renderSheetStage, WalkPreview, KEY_EXPORT_IMAGES, ImageModeBar, TurnAxis, TurnImageStage, FramePickAxis, FramePickPanel, FrameStage, StudioPanel
  };
}
