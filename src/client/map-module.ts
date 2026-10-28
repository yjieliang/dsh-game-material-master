/**
 * MapModule：面板实现。
 *
 * 拆成工厂函数的原因：面板要用宿主 `require("react")` 提供的 React，而 `require` 只在
 * `__ModuleLoader__.load` 的 factory 里可用 —— 模块顶层不能直接抓 React。所以共享物
 * （React / h / T / api 辅助 / 公共组件）由入口显式传进来，这里只构造一次组件。
 */

import { markRender } from "./platform/perf.js";
import { onceTimer } from "./platform/lifecycle.js";

export interface MapRuntime {
  React: any;
  h: any;
  activeLang: any;
  fill: any;
  T: any;
  useLocaleTick: any;
  deriveAssetName: any;
  ASSET_FRAMES_MIN: any;
  ASSET_FRAMES_MAX: any;
  stampLimits: any;
  clampStampSpan: any;
  ASSET_SHAPES: any;
  assetShapeLabel: any;
  buildAssetRequestPrompt: any;
  useHiddenModules: any;
  OPEN_SHAPES: any;
  useStudioIntent: any;
  msg: any;
  Btn: any;
  NumField: any;
  CopyIdButton: any;
  MAP_PLAN_LIST: any;
  MAP_pointToCell: any;
  MAP_cellTopLeft: any;
  MAP_lineCells: any;
  MAP_GUIDE_ART: any;
  MapToolIcon: any;
  openAssetChat: any;
  /** 集中轮询调度器（platform/scheduler；组合根注入） */
  scheduler: any;
}

export function createMapModule(rt: MapRuntime) {
  const { React, h, activeLang, fill, T, useLocaleTick, deriveAssetName, ASSET_FRAMES_MIN, ASSET_FRAMES_MAX, stampLimits, clampStampSpan, ASSET_SHAPES, assetShapeLabel, buildAssetRequestPrompt, useHiddenModules, OPEN_SHAPES, useStudioIntent, msg, Btn, NumField, CopyIdButton, MAP_PLAN_LIST, MAP_pointToCell, MAP_cellTopLeft, MAP_lineCells, MAP_GUIDE_ART, MapToolIcon, openAssetChat, scheduler } = rt;

function MapModule(props) {
  markRender("MapModule");
  useLocaleTick();
  const api = props.api;

  // ── 项目与视图 ───────────────────────────────────────────────────────
  const [projects, setProjects] = React.useState([]);
  const [view, setView] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const [openCard, setOpenCard] = React.useState(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  /** 素材卡片里正在看的那一张素材（只有一张时用不到）。 */
  const [tsIndex, setTsIndex] = React.useState(0);
  const [busyKey, setBusyKey] = React.useState(null);

  // ── 画布：缩放 / 平移 / 绘制计划 ──────────────────────────────────────
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [viewport, setViewport] = React.useState({ w: 900, h: 520 });
  /** 画布尺寸量过一次没有：量之前不发计划请求（否则第一帧按默认尺寸算，白拉一遍）。 */
  const [measured, setMeasured] = React.useState(false);
  /** 计划缓存：key → 绘制条目。`have` 直接由它派发。 */
  const planRef = React.useRef(new Map());
  const [planOps, setPlanOps] = React.useState(new Map());
  /**
   * 视口里的标记点（宿主每次查询整份回）。
   *
   * ⚠️ **故意不进 `planRef` 那份按块缓存**：编号是连续的，删掉第 2 个之后第 3 个
   * 就变成第 2 个 —— 缓存住的号码会留在屏幕上。所以它是独立的一份状态，
   * 每次查询覆盖（数量级是几十个）。
   */
  const [planMarkers, setPlanMarkers] = React.useState([]);
  const [visibleKeys, setVisibleKeys] = React.useState([]);
  const visibleRef = React.useRef([]);
  /** 自增一次＝「重新问一遍宿主缺哪些块」（补拉用）。 */
  const [planEpoch, setPlanEpoch] = React.useState(0);
  const [planMeta, setPlanMeta] = React.useState({ fps: 1, fpsMax: 1, frameCount: 1 });
  /** 动画速度：null = 跟宿主的 `fps` 走；选了慢 / 中 / 快就是用户指定。 */
  /**
   * 「新增素材」对话框的草稿。
   *
   * 产品约定：**素材属性在新增这一刻定下来，之后只能删掉重来** —— 所以形态、格子、
   * 会动吗这些都放进这个对话框，一次定死；列表里不再提供任何修改入口（内置素材更是
   * 连对话框都进不来）。
   */
  const [addDraft, setAddDraft] = React.useState(null);
  const addFileRef = React.useRef(null);
  /**
   * 「AI 生成素材」对话框的草稿（`null` = 没打开）。
   *
   * 与「新增素材」不同：这里**不导入任何东西**，只是收集需求（提示词 / 名字 /
   * 帧数 / 方式），然后把活派给一个**新对话**——真正生成的是对话里的 agent。
   */
  const [aiDraft, setAiDraft] = React.useState(null);
  /** 「AI 生成素材」正在建会话 / 发提示词（几百毫秒级，但按钮要立刻有反应）。 */
  const [aiBusy, setAiBusy] = React.useState(false);
  /** 功能管理里被隐藏的模块：被隐藏的必需模块（图片 / 序列帧）不能派活。 */
  const hiddenModules = useHiddenModules(api);
  /**
   * 「素材说明」当前翻到第几页（`null` = 没打开）。
   *
   * 它**只跟着草稿存在**：草稿一没（取消 / 提交 / 关掉「新增素材」）它就一起消失，
   * 不需要在四个关对话框的地方各写一次复位。
   */
  const [guidePage, setGuidePage] = React.useState(null);
  /**
   * 预览节拍：一笔进行中每隔 ~80ms 自增一次，触发下面那个计划查询带上 `pending` ——
   * 宿主只**算**这份计划（盖在克隆上），不落盘、不进撤销栈。
   *
   * 用户要的是「画的过程中格子要显示出来，但别一边画一边存」：所以显示走预览查询，
   * 真正的提交仍然只在 `pointerup` / 离开 / 取消时发生一次。
   */
  const [previewTick, setPreviewTick] = React.useState(0);
  /** 预览取回来的块号：这些内容只反映了**当时那一部分 op**，提交后必须重拉。 */
  const previewKeys = React.useRef(new Set());
  const previewTimer = React.useRef(null);
  const [animFps, setAnimFps] = React.useState(null);
  /**
   * 动画**时钟节拍**（`floor(经过秒数 × clockFps)`）—— 整份计划共用一个时间源。
   *
   * ⚠️ 不要再另外存一个「elapsed ref」：那样画面按 ref 算、`__mapDrawStats.frame` 按状态算，
   * 两者会对不上（自检里就是「明明计划换了、画出来的还是上一帧」这种假失败）。
   */
  const [animTick, setAnimTick] = React.useState(0);
  const [truncated, setTruncated] = React.useState(false);
  const [planWarnings, setPlanWarnings] = React.useState([]);
  /** 整图的通行区域（`mapPlan({pass:true})` 回的格；只在「区域」开关打开时才算）。 */
  const [passCells, setPassCells] = React.useState([]);
  /** 「区域」叠加开关（设置卡里，和「网格线」并列）。 */
  const [showPass, setShowPass] = React.useState(false);
  const [imagesReady, setImagesReady] = React.useState(0);

  // ── 工具 / 笔刷 / 图层 / 显示开关 ─────────────────────────────────────
  const [tool, setTool] = React.useState("pen");
  /** 当前笔刷（图例里的全局序号 + 它属于哪张素材 —— 整图要靠素材 id 下 op）。 */
  const [brush, setBrush] = React.useState(null);
  /**
   * 整图的旋转档（0/1/2/3 = 0°/90°/180°/270°，顺时针）。
   *
   * **右键转**（用户定的规矩：右键不再是橡皮，橡皮只能点工具）。换笔刷时归零 ——
   * 上一张图的朝向不该莫名其妙带到下一张。
   */
  const [stampRot, setStampRot] = React.useState(0);
  /**
   * 当前笔刷对应的整图规格 —— **只在「画笔」工具下才生效**，其它工具一律单格。
   *
   * 整图一次占 N×M 格，所以画笔的悬停框 / 右键旋转 / 落笔都按整张算。但标记、橡皮、
   * 油漆桶、吸管、抓手都只作用在**一格**上：它们不该继承上一张整图的 3×2 框 ——
   * 真机反馈「切到标记 / 橡皮后笔刷还是多个格子的样子」。把工具一起收进这里，
   * 非画笔时返回 null，下游（悬停框 / 右键 / 落笔）自然全回到 1×1。
   */
  const brushStamp = React.useMemo(() => {
    if (tool !== "pen" || brush === null || view === null || view === undefined) return null;
    const owner = view.tilesets.find((entry) => entry.id === brush.tilesetId);
    if (owner === undefined || owner.stamp === undefined) return null;
    return { tilesetId: owner.id, cols: owner.stamp.cols, rows: owner.stamp.rows, frames: owner.stamp.frames };
  }, [brush, view, tool]);
  /** 多选（供「一键生成」取用）。 */
  const [multi, setMulti] = React.useState([]);
  const [layerIndex, setLayerIndex] = React.useState(0);
  const [single, setSingle] = React.useState(false);
  const [showGrid, setShowGrid] = React.useState(false);
  const [hover, setHover] = React.useState(null);
  /** 选中 / 正在改名的标记 id（画布上那个圈描红、标记卡里高亮）。 */
  const [markerSel, setMarkerSel] = React.useState(null);
  /** 图层改名的就地草稿：`{ id, value }`；null = 没有在改。 */
  const [layerDraft, setLayerDraft] = React.useState(null);
  /** 标记改名的就地草稿：`{ id, value }`。 */
  const [markerDraft, setMarkerDraft] = React.useState(null);

  // ── 保存状态 / 生成草稿 / 导出 ────────────────────────────────────────
  const [genKind, setGenKind] = React.useState("random");
  const [genSeed, setGenSeed] = React.useState(20261005);
  const [exportScale, setExportScale] = React.useState(1);
  /**
   * 导出内容（三个复选框），与宿主的 `formats` 一一对应。
   *
   * ⚠️ 这里刻意**只存选择、不执行**：以前是「点哪个按钮就导哪一份」，于是
   * 「导出图片 PNG」看起来像个被选中的页签、「导出存档 JSON」却是立即执行的动作 ——
   * 同一行里两个按钮一半是选择一半是提交。现在选择归复选框、执行归唯一的「导出」。
   */
  const [exportFormats, setExportFormats] = React.useState({ png: true, json: true, tilesets: false });

  const imageRefs = React.useRef({});
  const canvasRef = React.useRef(null);
  /**
   * 画布的 ref 回调：顺手挂一个 `{ passive: false }` 的滚轮监听。
   *
   * ⚠️ **不能只写 React 的 `onWheel`**：它是被动注册的，在里面 `preventDefault()`
   * 只会在控制台留一条「Unable to preventDefault inside passive event listener」
   * 并且**照旧滚动面板** —— 真机上就是「滚轮缩放地图的同时整块面板也在滚」。
   * 用 ref 回调而不是 `useEffect(..., [])`：空态时画布还不存在，空依赖的 effect
   * 不会在它后来出现时再跑一次，监听就永远挂不上。
   */
  const wheelOff = React.useRef(null);
  const zoomAtRef = React.useRef(null);
  const bindCanvas = React.useCallback((node) => {
    if (typeof wheelOff.current === "function") {
      wheelOff.current();
      wheelOff.current = null;
    }
    canvasRef.current = node === undefined ? null : node;
    if (node === null || node === undefined) return;
    const handler = (event) => {
      event.preventDefault();
      const zoom = zoomAtRef.current;
      if (typeof zoom === "function") zoom(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    node.addEventListener("wheel", handler, { passive: false });
    wheelOff.current = () => node.removeEventListener("wheel", handler);
  }, []);
  const stageRef = React.useRef(null);
  /**
   * 工具格上方那张小标签（名称 + 介绍 + 快捷键）。
   *
   * ⚠️ 位置用 `position:fixed` 而不是 `absolute`：工具栏的祖先里有 `overflow` 容器，
   * `absolute` 会让「按钮正上方」那一段被裁掉——和侧栏菜单踩的是同一个坑。
   * 坐标在 hover 时用 `getBoundingClientRect()` 现算，并夹在视口内（第一列的按钮
   * 居中后左半边会出界）。
   */
  const [toolTip, setToolTip] = React.useState(null);
  /** 当前悬浮的那个按钮（滚动 / 改窗口大小时靠它把标签重新锚回去）。 */
  const toolTipAnchor = React.useRef(null);
  /** 横向夹在视口内：半宽上限 = CSS max-width 236 + 内边距，防止第一列按钮的标签出界。 */
  const toolTipX = (rect) => {
    const half = 124;
    const viewWidth = typeof window === "undefined" ? 0 : window.innerWidth || 0;
    const center = rect.left + rect.width / 2;
    return Math.round(viewWidth > 0 ? Math.max(half, Math.min(center, viewWidth - half)) : center);
  };
  const showToolTip = (name, desc, shortcut) => (event) => {
    const node = event === undefined ? null : event.currentTarget;
    if (node === null || node === undefined || typeof node.getBoundingClientRect !== "function") return;
    toolTipAnchor.current = node;
    const rect = node.getBoundingClientRect();
    setToolTip({
      name,
      desc,
      shortcut: shortcut === undefined ? null : shortcut,
      x: toolTipX(rect),
      y: Math.round(rect.top - 8)
    });
  };
  const hideToolTip = () => {
    toolTipAnchor.current = null;
    setToolTip((current) => (current === null ? current : null));
  };
  /**
   * 滚动 / 改窗口大小时**把标签重新锚回按钮**，而不是直接收起来。
   *
   * 收起看着更省事，但真机上很难受：面板一滚（或窗口一缩）标签就没了，而鼠标还停在
   * 按钮上、`mouseenter` 不会再触发，用户得先把鼠标移开再挪回来才重新看到说明。
   * 依赖只取「有没有标签」这个布尔量：依赖 `toolTip` 本身的话，每次重新定位都会
   * 重新挂监听。
   */
  React.useEffect(() => {
    if (toolTip === null || typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
    const reanchor = () => {
      const node = toolTipAnchor.current;
      if (node === null || node === undefined || typeof node.getBoundingClientRect !== "function" || node.isConnected === false) {
        hideToolTip();
        return;
      }
      const rect = node.getBoundingClientRect();
      setToolTip((current) => (current === null ? current : { ...current, x: toolTipX(rect), y: Math.round(rect.top - 8) }));
    };
    window.addEventListener("scroll", reanchor, true);
    window.addEventListener("resize", reanchor);
    return () => {
      window.removeEventListener("scroll", reanchor, true);
      window.removeEventListener("resize", reanchor);
    };
  }, [toolTip === null]);
  const fileRef = React.useRef(null);
  const pointersRef = React.useRef(new Map());
  const strokeRef = React.useRef(null);
  const strokeSeq = React.useRef(0);
  const currentStroke = React.useRef(null);
  const pendingOps = React.useRef([]);
  const fittedRef = React.useRef(null);
  const spaceRef = React.useRef(false);
  const intent = useStudioIntent();

  const viewId = view === null ? null : view.id;
  const layers = view === null ? [] : view.layers || [];
  const safeLayerIndex = layers.length === 0 ? 0 : Math.min(Math.max(0, layerIndex), layers.length - 1);
  const activeLayer = layers.length === 0 ? null : layers[safeLayerIndex];
  const tilesets = view === null ? [] : view.tilesets || [];
  const safeTsIndex = tilesets.length === 0 ? 0 : Math.min(Math.max(0, tsIndex), tilesets.length - 1);
  const tileset = tilesets.length === 0 ? null : tilesets[safeTsIndex];
  const legend = view === null ? [] : view.legend || [];
  const assetBase = view === null ? "" : view.assetBase;
  const exportFiles = view === null ? [] : view.exportFiles || [];

  /** 与宿主 `layoutOf` 同形的一份布局：坐标函数要用它的步长与环绕开关。 */
  const layout = React.useMemo(() => {
    if (view === null) return null;
    const grid = view.grid;
    const cols = view.cols;
    const rows = view.rows;
    return {
      grid,
      cols,
      rows,
      stepX: grid.tileWidth,
      stepY: grid.tileHeight,
      width: cols * grid.tileWidth,
      height: rows * grid.tileHeight,
      wrap: grid.wrap === true
    };
  }, [view]);

  /** 图例：全局序号 → { 素材, 源矩形 }。 */
  const legendMap = React.useMemo(() => {
    const map = new Map();
    for (const entry of legend) map.set(entry.index, entry);
    return map;
  }, [legend]);

  const tilesetReason = tileset === null ? "" : tileset.reason || "";
  const activeFps = animFps === null ? (planMeta.fps > 0 ? planMeta.fps : 1) : animFps;
  /**
   * 动画时钟的频率：取「全局速度」与「计划里最快的那条素材速度」的较大者。
   *
   * ⚠️ 只按全局速度推时钟的话，一张 8 帧/秒的素材在 1 帧/秒的时钟下**每秒才重画一次**，
   * 表现就是「设了速度却没变快」。时钟只决定**多久重画一次**，每一格画第几帧仍由它
   * 自己的速度算（见 `draw` 里的 `opFps`）。
   */
  const clockFps = Math.max(activeFps, planMeta.fpsMax > 0 ? planMeta.fpsMax : 1);
  /** 时钟节拍 → 经过秒数：每一格再 × 自己的速度算帧号（见 `draw`）。 */
  const animElapsed = clockFps > 0 ? animTick / clockFps : 0;

  /** 当前缩放 / 平移的最新值：捏合与滚轮要在同一次事件里读到，不能靠 state。 */
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;
  const panRef = React.useRef(pan);
  panRef.current = pan;
  const viewportRef = React.useRef(viewport);
  viewportRef.current = viewport;

  const withApi = React.useCallback(
    async (fn, options) => {
      if (api === undefined) {
        setNotice({ kind: "error", text: T("远程服务尚未挂载完成，请稍候再试") });
        return undefined;
      }
      try {
        const value = await fn();
        if (options !== undefined && options.notice !== undefined) setNotice({ kind: "info", text: options.notice });
        return value;
      } catch (error) {
        setNotice({ kind: "error", text: msg(error) });
        return undefined;
      }
    },
    [api]
  );

  /**
   * 每个缓存条目是**按哪次请求的视口**取回来的（键 → 视口矩形）。
   *
   * ⚠️ 宿主回的是「覆盖这个视口的那批条目」，所以一个键的内容取决于当时问的
   * 视口大小。只按 key 判断「我有没有」会让**视口变大后新露出来的格子一直空着**
   * （键还在缓存里，宿主就不重发了 —— 实测踩过）。这里只比较**客户端自己发出去的
   * 两个矩形**，不碰任何格 / 块的可见范围计算。
   */
  const fetchedRef = React.useRef(new Map());

  /**
   * 「内容可能已经过期、正等着重拉」的那几个块。
   *
   * ⚠️ 这里**故意不把 key 从 `planRef` 里删掉**。删掉的话，从「提交完」到「增量计划
   * 回来」之间这段时间里这一块是**没有内容的** —— 画布会整块变空再变回来。
   * 一块可能覆盖很大一片（块边长见 `mapgeom.MAP_CHUNK_SIZE`；地图不比块大多少时
   * 一块就是整张地图），于是拖动笔刷期间每 40ms 就闪一次，真机表现就是「画布一直闪烁」。
   * 现在改成：旧内容继续画，只是**不再向宿主声明「我有」**（`have` 里剔掉），
   * 于是宿主会把新内容重发一次，`applyQuery` 收到后把这个 key 移出集合。
   */
  const staleRef = React.useRef(new Set());

  /** 换项目 / 换层 / 大改之后：把计划整份作废（下次渲染重新问宿主）。 */
  const clearPlan = React.useCallback(() => {
    planRef.current = new Map();
    fetchedRef.current = new Map();
    staleRef.current = new Set();
    visibleRef.current = [];
    setPlanOps(new Map());
    setPlanMarkers([]);
    setVisibleKeys([]);
  }, []);

  /**
   * 读一次项目视图。
   *
   * `keep` = 保留画布上的选择（图层 / 面板 / 缩放）：验收打勾、导出回读这类
   * 「只是刷新一下状态」的调用不该把用户正在画的层顶掉。
   */
  const loadSeq = React.useRef(0);
  const loadProject = React.useCallback(
    async (id, keep) => {
      if (api === undefined || id === null || id === undefined || id === "") return;
      /**
       * ⚠️ 并发读盘要**按最后一次发起的请求收口**（丢弃迟到的旧响应）。
       *
       * 同一个项目可能同时在读好几次（挂载时那次、点导出后那次、`busy` 期间的 1.5s 轮询、
       * 打勾后的回读）。它们各自 await 一次读盘，**回来的顺序不保证与发出的一致** ——
       * 迟到的旧响应会把新状态顶回去。真机上的表现是「导出完了、文件也在盘上，
       * 但导出卡片一直写着『还没有导出过』」，而且重新点一次才好 —— 查起来像随机。
       */
      const seq = ++loadSeq.current;
      try {
        const next = await api.getMapProject({ projectId: id, lang: activeLang() });
        if (seq !== loadSeq.current) return;
        if (keep !== true) {
          clearPlan();
          setLayerIndex(0);
          setTsIndex(0);
          setPlanMeta({ fps: 1, fpsMax: 1, frameCount: 1 });
          setAnimFps(null);
          setTruncated(false);
          setPlanWarnings([]);
        }
        setView(next);
        // 返回值给深链接用：`dialog=add` 要拿刚回来的这份视图的 `assetBase` / `grid`。
        return next;
      } catch (error) {
        setNotice({ kind: "error", text: msg(error) });
        return undefined;
      }
    },
    [api, clearPlan]
  );

  /** Blob → 能交给「新增素材」的那份文件（老环境没有 `File` 时给它挂一个 `name`）。 */
  function fileFromBlob(blob, name) {
    const type = typeof blob.type === "string" && blob.type !== "" ? blob.type : "image/png";
    if (typeof File === "function") return new File([blob], name, { type });
    try {
      return Object.assign(blob, { name });
    } catch {
      return blob;
    }
  }

  /**
   * 「AI 生成素材」回链的落点：打开「新增素材」并把刚生成的那张图预选好。
   *
   * 「这块素材怎么用」按回链里的 `shape` 预选（`composeMapAsset` 就是按它规整的
   * 几何）—— **不能写死 plain**：拼块 / 整格的图被当成普通素材导入，画出来是一堆
   * 碎块，而且不报错。「会动吗」只在普通形态下有意义（多张 = 翻页图）；拼块的动画
   * 走变体、整格没有帧这一维。
   *
   * 图取不回来（项目删了 / 文件被清）也照样打开对话框 —— 那时它是一张**空**的
   * 「新增素材」，用户自己选图即可；什么都不说的话用户只会觉得「链接没反应」。
   */
  const openAiAssetDraft = async (target, loaded) => {
    const grid = (loaded !== null && loaded !== undefined && loaded.grid) || (view !== null && view.grid) || { tileWidth: 32, tileHeight: 32 };
    const frames = typeof target.frames === "number" && Number.isFinite(target.frames) && target.frames > 0 ? Math.round(target.frames) : 1;
    const relative = typeof target.asset === "string" ? target.asset : "";
    const stem = relative === "" ? "" : String(relative).split("/").pop().replace(/\.[^.]+$/u, "");
    const shape = typeof target.shape === "string" && OPEN_SHAPES.has(target.shape) ? target.shape : "plain";
    const draft = {
      file: null,
      name: stem,
      cellW: String(grid.tileWidth),
      cellH: String(grid.tileHeight),
      shape,
      animRows: shape === "plain" && frames > 1,
      // 速度留空 = 跟全局那条走（对话里没法知道该多快，交给用户在「确定」前自己挑）。
      fps: "",
      // 循环方式默认正放（AI 那条路不指定，用户在「确定」前自己挑）。
      loop: "forward",
      // 清晰度：宿主默认就是「平滑」，用户可以在「确定」前换。
      clarity: "smooth",
      // 这张 AI 素材图是几倍分辨率（回链里的 `scale`）：>1 时界面会显示「清晰度」与说明。
      scale: typeof target.scale === "number" && Number.isInteger(target.scale) && target.scale > 1 ? target.scale : 1,
      /**
       * 整图：回链带了 `cols/rows/frames` 就按它预填（占格是**生图前就定好**的计划，
       * 用户点「确定」前还能改；区域永远留给用户点，AI 猜不准）。
       */
      stampCols: String(typeof target.cols === "number" && Number.isFinite(target.cols) ? Math.max(1, Math.min(512, Math.round(target.cols))) : 3),
      stampRows: String(typeof target.rows === "number" && Number.isFinite(target.rows) ? Math.max(1, Math.min(512, Math.round(target.rows))) : 3),
      stampFrames: String(shape === "stamp" && frames > 1 ? frames : 1),
      stampPass: new Array(9).fill(0),
      /**
       * 回链带 `keyed=1` = 整理时**已经抠过绿幕**：这里要取消勾选，
       * 否则会抠第二遍（画面里已经没有绿了，第二遍只会按错误的背景色误伤像素）。
       */
      stampKey: target.keyed !== 1
    };
    setOpenCard("assets");
    const base = (loaded !== null && loaded !== undefined && loaded.assetBase) || (view !== null && view.assetBase) || "";
    if (relative === "" || base === "") {
      setAddDraft(draft);
      return;
    }
    try {
      const response = await fetch(`${base}${relative}`);
      if (response === undefined || response.ok !== true) throw new Error(String(response?.status ?? "fetch failed"));
      const blob = await response.blob();
      setAddDraft({ ...draft, file: fileFromBlob(blob, `${stem === "" ? "ai-asset" : stem}.png`) });
    } catch (error) {
      setAddDraft(draft);
      setNotice({ kind: "error", text: T("没取到刚生成的那张图（{n0}）。你可以自己选一张，或者回对话里再要一次。", { n0: msg(error) }) });
    }
  };

  /**
   * 最近一次深链接意图（给挂载时那条「默认打开第一个项目」的 effect 用）。
   *
   * ⚠️ 两个 effect 都是异步的，**谁后发起谁赢**（`loadSeq` 是按发起顺序收口的）：
   * 挂载那条要等 `listMapProjects` 回来才 `loadProject(list[0])`，天然晚于深链接
   * 那条 —— 不管一下的话，带 `module=map&job=…` 的链接会先切到目标项目、再被
   * 「第一个项目」顶掉（表现是链接看起来随机失效）。有 map 意图时就让位。
   */
  const intentRef = React.useRef(intent);
  intentRef.current = intent;

  React.useEffect(() => {
    void (async () => {
      if (api === undefined) return;
      try {
        const result = await api.listMapProjects();
        const list = result.projects || [];
        setProjects(list);
        const pending = intentRef.current;
        const pendingId = pending !== null && pending !== undefined && pending.module === "map" ? (pending.jobId || pending.projectId) : undefined;
        if (typeof pendingId === "string" && pendingId !== "") return;
        if (list.length > 0) await loadProject(list[0].id);
      } catch (error) {
        setNotice({ kind: "error", text: msg(error) });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  /**
   * 深链接：`?dsh-gmm=1&module=map&job=<项目 id>&stage=assets|rules|paint|export`
   * 外加「AI 生成素材」的回链：`&dialog=add&asset=ai/<名字>.png&frames=<帧数>`。
   *
   * 带 `dialog=add` 时，把刚生成的那张图取回来、打开「新增素材」并**预填**：
   * 名字 / 格子大小（= 地图网格）/ 用法（普通）/ 会动吗（帧数 > 1 才对）。
   *
   * 用法刻意写死 `plain` 而不是 `auto`：`32×(32×N)` 这种竖条在帧数正好是 5 的
   * 倍数时会命中「高 = 5 × 格子」的判据，自动识别会把翻页图认成拼块 —— 那是个
   * 不报错、只是画不对的错。
   */
  React.useEffect(() => {
    if (intent === null || intent.module !== "map") return;
    const id = typeof intent.jobId === "string" && intent.jobId !== "" ? intent.jobId : intent.projectId;
    void (async () => {
      const loaded = typeof id === "string" && id !== "" ? await loadProject(id) : undefined;
      if (intent.stage === "assets") setOpenCard("assets");
      else if (intent.stage === "export") setOpenCard("export");
      if (intent.dialog === "add") await openAiAssetDraft(intent, loaded);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  // ── 绘制计划：什么时候问、怎么合并 ───────────────────────────────────
  const applyQuery = React.useCallback((result, view) => {
    const incoming = Array.isArray(result?.[MAP_PLAN_LIST]) ? result[MAP_PLAN_LIST] : [];
    const next = new Map(planRef.current);
    const previewing = currentStroke.current !== null && pendingOps.current.length > 0;
    for (const entry of incoming) {
      next.set(entry.key, Array.isArray(entry.ops) ? entry.ops : []);
      // 预览期间取回来的块：内容只反映「当时那一部分 op」，提交后要按真实数据重拉
      if (previewing) previewKeys.current.add(entry.key);
      // 这一份已经是新的了：不用再重拉
      staleRef.current.delete(entry.key);
      // 记下这一份是「按哪个视口」取回来的：视口再变大时它就不够画了
      if (view !== undefined) fetchedRef.current.set(entry.key, view);
    }
    const keys = Array.isArray(result?.visibleKeys) ? result.visibleKeys : [];
    /** 缓存上限：先丢「已经不在可见范围里」的键，免得看久了内存无限涨。 */
    if (next.size > 384) {
      const keep = new Set(keys);
      for (const key of [...next.keys()]) {
        if (next.size <= 256) break;
        if (!keep.has(key)) next.delete(key);
      }
    }
    planRef.current = next;
    visibleRef.current = keys;
    setPlanOps(next);
    // 标记**整份覆盖**（不进那份按块缓存）：编号会随删除整体前移，缓存住的号码会留在屏幕上。
    setPlanMarkers(Array.isArray(result?.markers) ? result.markers : []);
    setVisibleKeys(keys);
    const fps = Number(result?.fps);
    const frames = Number(result?.frameCount);
    const fpsMax = Number(result?.fpsMax);
    setPlanMeta({
      fps: Number.isFinite(fps) && fps > 0 ? fps : 1,
      // 计划里最快的那条速度：动画时钟按它推，慢速的素材不会被拖慢、快速的也不会被拖住。
      fpsMax: Number.isFinite(fpsMax) && fpsMax > 0 ? Math.max(Number.isFinite(fps) && fps > 0 ? fps : 1, fpsMax) : Number.isFinite(fps) && fps > 0 ? fps : 1,
      frameCount: Number.isFinite(frames) && frames > 1 ? Math.floor(frames) : 1
    });
    setTruncated(result?.truncated === true);
    setPlanWarnings(Array.isArray(result?.warnings) ? result.warnings : []);
    // 区域格子**整份覆盖**（不进按块缓存：它是整图级别的信息，不是某一格的内容）。
    setPassCells(Array.isArray(result?.pass) ? result.pass : []);
  }, []);

  /** 计划的「身份」：这张图变了（换项目 / 换层 / 换网格 / 换尺寸）就整份重来。 */
  /**
   * 素材的**动画属性**签名（速度 / 帧数 / 逐行动画开关）。
   *
   * ⚠️ 少了它，改一张素材的播放速度之后缓存里的 op 还带着旧 `fps`，画面上就是
   * 「改了没反应」——块缓存只按视口和文档失效，认不出「素材本身变了」。
   */
  const tilesetSig = ((view === null || view === undefined ? [] : view.tilesets) ?? [])
    .map((entry) => `${entry.id}:${entry.shape}:${entry.animRows === true ? "a" : "-"}:${entry.variants}:${entry.fps === undefined ? "-" : entry.fps}`)
    .join(",");
  const planKey =
    viewId === null || layout === null
      ? null
      : `${viewId}|${single === true ? safeLayerIndex : "all"}|${layout.wrap === true ? "w" : "n"}|${layout.stepX}x${layout.stepY}|${layout.cols}x${layout.rows}|${tilesetSig}`;

  // 身份变了 → 旧计划一律作废（不同层的块里条目本来就不同）
  const planKeyRef = React.useRef(null);
  React.useEffect(() => {
    if (planKeyRef.current === planKey) return;
    planKeyRef.current = planKey;
    if (planKey === null) return;
    clearPlan();
    setPlanEpoch((value) => value + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  /** 外框矩形是否盖住内框（只用来判断「这一份计划还够不够画当前视口」）。 */
  const viewCovers = (outer, inner) =>
    outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;

  React.useEffect(() => {
    if (api === undefined || viewId === null || layout === null || measured !== true) return undefined;
    let cancelled = false;
    const cancel = onceTimer(() => {
      void (async () => {
        const strokeAtQuery = currentStroke.current;
        try {
          const size = viewportRef.current;
          const currentView = { x: pan.x, y: pan.y, width: size.w / zoom, height: size.h / zoom };
          const pending = currentStroke.current === null ? undefined : [...pendingOps.current];
          /**
           * ⚠️ **预览查询一律不带 `have`**（说自己什么都没有）。
           *
           * 真机踩过：预览改的格子往往落在**已经缓存过的块**里，宿主一看「你有这一块」
           * 就不回传 —— 于是拖动期间一片空白，松手提交后靠 `dropKeys` 重拉才出现。
           * 客户端又不许自己算「这一笔碰到哪些块」（那是宿主的几何），所以预览时
           * 干脆要一整份可视块：多传几十块，换「拖着就能看见」，值。
           * （宿主那边另有强制回传，见 `mapgen.mapPlan` 的 `forced`。）
           */
          const have = pending !== undefined ? [] : [...planRef.current.keys()].filter((key) => {
            // 待重拉的键不算「我有」：宿主据此把新内容发回来
            if (staleRef.current.has(key)) return false;
            // 预览块同理：它只反映「当时那一部分 op」，这一笔还在长，必须重新算
            if (previewKeys.current.has(key)) return false;
            const fetched = fetchedRef.current.get(key);
            return fetched !== undefined && viewCovers(fetched, currentView);
          });
          const result = await api.mapPlan({
            projectId: viewId,
            view: currentView,
            have,
            pending: Array.isArray(pending) && pending.length > 0 ? pending : undefined,
            layerIds: single === true ? [safeLayerIndex] : undefined,
            pass: showPass === true
          });
          if (cancelled === true) return;
          /**
           * 预览响应回来时这一笔可能已经提交（或换了）：它算的是**过时**的那部分 op，
           * 应用它会让缓存停在预览上（提交后的真实数据就补不进来了）。直接丢掉，
           * 交给提交后那次查询重发这几块。
           */
          if (strokeAtQuery !== null && strokeAtQuery !== currentStroke.current) return;
          applyQuery(result, currentView);
        } catch (error) {
          if (cancelled === true) return;
          setNotice({ kind: "error", text: msg(error) });
        }
      })();
    }, 32);
    return () => {
      cancelled = true;
      cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, viewId, planKey, planEpoch, previewTick, pan, zoom, viewport, single, safeLayerIndex, measured, showPass]);

  // 视图尺寸变了（面板宽窄、窗口缩放）：重新量一次
  React.useEffect(() => {
    const element = stageRef.current;
    if (element === null || element === undefined) return undefined;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setViewport({ w: Math.max(160, Math.round(rect.width)), h: Math.max(120, Math.round(rect.height)) });
      setMeasured(true);
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId]);

  // 换项目 / 改尺寸后把整张地图摆回视野中央（用户自己平移过就不再动）
  React.useEffect(() => {
    if (view === null || layout === null) return;
    const key = `${view.id}:${layout.cols}x${layout.rows}:${layout.stepX}`;
    if (fittedRef.current === key) return;
    fittedRef.current = key;
    const scale = Math.min(1, viewport.w / Math.max(1, layout.width), viewport.h / Math.max(1, layout.height));
    const next = Math.min(8, Math.max(0.25, Number.isFinite(scale) && scale > 0 ? scale : 1));
    setZoom(next);
    // 摆回视野：地图比视口小的方向会被夹到 0（左上角对齐），大的方向居中
    setPan(clampPan({ x: (layout.width - viewport.w / next) / 2, y: (layout.height - viewport.h / next) / 2 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, layout === null ? "" : `${layout.cols}x${layout.rows}x${layout.stepX}`, viewport.w, viewport.h]);

  // ── 画布绘制 ─────────────────────────────────────────────────────────
  const draw = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null || canvas === undefined || layout === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null || ctx === undefined) return;
    const width = Math.max(1, Math.round(viewport.w));
    const height = Math.max(1, Math.round(viewport.h));
    /**
     * 按 devicePixelRatio 放大 backing store。
     *
     * 不放大时每个地图像素只占 1 个物理像素 → 像素画在 Retina 上发糊。
     * 坐标仍按 CSS 像素记，倍率进 transform，所以计划里的目标坐标一个都不用改。
     */
    const dpr = Math.max(1, Math.min(3, (typeof window !== "undefined" && window.devicePixelRatio) || 1));
    const backingWidth = Math.round(width * dpr);
    const backingHeight = Math.round(height * dpr);
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, backingWidth, backingHeight);
    ctx.imageSmoothingEnabled = false;
    const scale = zoom * dpr;
    ctx.setTransform(scale, 0, 0, scale, -pan.x * scale, -pan.y * scale);
    // 单层预览：底铺绿。层过滤由宿主的计划做，这里一条条目都不筛。
    if (single === true) {
      ctx.fillStyle = "rgb(56,170,68)";
      ctx.fillRect(pan.x, pan.y, width / zoom, height / zoom);
    }
    const debug = typeof window !== "undefined" && (window as any).__mapDebug === true;
    const stats: any = debug ? { keys: [], cached: 0, drawn: 0, noLegend: 0, noImage: 0, first: null, frame: 0 } : null;
    for (const key of visibleRef.current) {
      if (stats !== null) stats.keys.push(key);
      const ops = planOps.get(key);
      if (ops === undefined) continue;
      if (stats !== null) stats.cached += ops.length;
      for (const op of ops) {
        /**
         * 每一格的帧号：**用这一格自己的速度**（op.fps = 素材自己设的），没设就跟着全局。
         * 时钟（`animElapsed`）只决定多久重画一次，每格的帧号一律从同一个时间源算 ——
         * 这样不同速度的素材各走各的，改速度也不会跳帧。
         */
        const opFps = typeof op.fps === "number" && op.fps > 0 ? op.fps : activeFps;
        const opFrame = Math.floor(animElapsed * opFps);
        const index = op.cycle === undefined || op.cycle.length === 0 ? op.t : op.cycle[opFrame % op.cycle.length];
        const entry = legendMap.get(index);
        if (entry === undefined) {
          if (stats !== null) stats.noLegend++;
          continue;
        }
        const image = imageRefs.current[entry.tilesetId];
        if (image === undefined || image === null) {
          if (stats !== null) stats.noImage++;
          continue;
        }
        if (stats !== null) {
          stats.drawn++;
          if (stats.first === null) stats.first = { t: index, x: op.x, y: op.y, ts: entry.tilesetId };
        }
        ctx.globalAlpha = op.a === undefined ? 1 : op.a;
        ctx.drawImage(
          image,
          entry.rect.x,
          entry.rect.y,
          entry.rect.width,
          entry.rect.height,
          op.x,
          op.y,
          entry.rect.width,
          entry.rect.height
        );
      }
    }
    ctx.globalAlpha = 1;
    // 网格线：只是对位用的装饰，不参与任何绘制计划
    if (showGrid === true) {
      const stepX = layout.grid.tileWidth;
      const stepY = layout.grid.tileHeight;
      const thin = 1 / zoom;
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      const right = pan.x + width / zoom;
      const bottom = pan.y + height / zoom;
      let count = 0;
      for (let x = Math.floor(pan.x / stepX) * stepX; x <= right && count < 800; x += stepX) {
        ctx.fillRect(x, pan.y, thin, height / zoom);
        count++;
      }
      for (let y = Math.floor(pan.y / stepY) * stepY; y <= bottom && count < 1600; y += stepY) {
        ctx.fillRect(pan.x, y, width / zoom, thin);
        count++;
      }
    }
    /**
     * 标记点：圆 + 圆圈里的数字。
     *
     * 圆心、半径、字号、数字**全在宿主给的计划里** —— 界面只负责 `arc` 与 `fillText`。
     * 绘制放在图块与格线**之后**，所以标记永远压在地图上；环绕接缝处同一个标记会出现
     * 多份（宿主按像素位置各发一条），这里照单全画。
     */
    for (const marker of planMarkers) {
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, marker.radius, 0, Math.PI * 2);
      ctx.fillStyle = marker.id === markerSel ? "rgba(210,59,44,0.92)" : "rgba(20,22,30,0.86)";
      ctx.fill();
      ctx.lineWidth = Math.max(1, marker.radius * 0.16);
      ctx.strokeStyle = "#f0c040";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${marker.font}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(marker.n), marker.x, marker.y);
    }
    /**
     * **区域叠加**：「区域」开关打开时，把整图每格的通行性涂成半透明色。
     *
     * 编辑器不画角色，所以「能不能走 / 谁挡谁」只能靠这个看 —— 没有它，
     * 区域点错了要等导出之后才可能发现。
     */
    if (showPass === true && passCells.length > 0) {
      const colors = ["rgba(226,59,43,0.34)", "rgba(52,120,246,0.34)", "rgba(52,190,120,0.34)"];
      for (const cell of passCells) {
        const topLeft = MAP_cellTopLeft(layout, cell.r, cell.c, layout.grid.tileWidth, layout.grid.tileHeight);
        ctx.fillStyle = colors[cell.kind] ?? colors[0];
        ctx.fillRect(topLeft.x, topLeft.y, layout.grid.tileWidth, layout.grid.tileHeight);
      }
    }
    // 悬停格：2px 红框（四条细矩形，不用 stroke，免得被 DPR 影响粗细）
    // ⚠️ 用**未取模**的坐标定位：环绕时同一格在屏幕上有多份，红框必须画在指针
    // 所在的那一份上。拿取模后的 r/c 去算，指针在地图外那一份时红框会跳一整张地图。
    if (hover !== null && hover !== undefined) {
      const rawC = Math.floor(hover.x / layout.stepX);
      const rawR = Math.floor(hover.y / layout.stepY);
      const topLeft = MAP_cellTopLeft(layout, rawR, rawC, layout.grid.tileWidth, layout.grid.tileHeight);
      const thickness = 2 / zoom;
      /**
       * 悬停框跟**笔刷**一样大：整图是 N×M 格（转 90° 时长宽互换），
       * 其它素材是 1×1 —— 只画一格的话用户看不出「一印就是一大块」。
       */
      const spanCols = brushStamp === null ? 1 : stampRot % 2 === 1 ? brushStamp.rows : brushStamp.cols;
      const spanRows = brushStamp === null ? 1 : stampRot % 2 === 1 ? brushStamp.cols : brushStamp.rows;
      const w = layout.grid.tileWidth * spanCols;
      const hh = layout.grid.tileHeight * spanRows;
      ctx.fillStyle = "#e23b2b";
      ctx.fillRect(topLeft.x, topLeft.y, w, thickness);
      ctx.fillRect(topLeft.x, topLeft.y + hh - thickness, w, thickness);
      ctx.fillRect(topLeft.x, topLeft.y + thickness, thickness, hh - thickness * 2);
      ctx.fillRect(topLeft.x + w - thickness, topLeft.y + thickness, thickness, hh - thickness * 2);
    }
    /**
     * 悬停到标记上：把**名字**写在圆圈旁边。
     *
     * 名字不常驻画布（几十个名字会糊成一片），只有指针停上去才出现。
     * 「停到了哪个」按**指针到圆心的距离**判：环绕时同一个标记在屏幕上有好几份，
     * 只看格号会挑到地图另一头那一份（红框当年就是这个坑）。圆心与半径都是宿主给的。
     */
    if (hover !== null && hover !== undefined) {
      let found: any = undefined;
      let best = Infinity;
      for (const marker of planMarkers) {
        const distance = Math.hypot(marker.x - hover.x, marker.y - hover.y);
        if (distance <= marker.radius * 2.5 && distance < best) {
          best = distance;
          found = marker;
        }
      }
      if (found !== undefined) {
        const label = found.name === "" ? T("标记 {n0}", { n0: String(found.n) }) : `${found.n} · ${found.name}`;
        // 缩得很小时文字会跟着变小到看不清，所以字号有个下限（只影响这个浮层，不影响圆）。
        const font = Math.max(12 / zoom, found.font * 0.85);
        ctx.font = `600 ${font}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const padding = 4 / zoom;
        const boxWidth = ctx.measureText(label).width + padding * 2;
        const boxHeight = font + padding * 2;
        const left = found.x + found.radius + 3 / zoom;
        const top = found.y - boxHeight / 2;
        ctx.fillStyle = "rgba(20,22,30,0.9)";
        ctx.fillRect(left, top, boxWidth, boxHeight);
        ctx.fillStyle = "#f3e7d3";
        ctx.fillText(label, left + padding, found.y);
      }
    }
    if (stats !== null && typeof window !== "undefined") {
      /**
       * 全局帧号（`frame`）与时钟秒数（`clock`）都暴露给调试 / 自检：和每格自己的帧号
       * **同一个时间源**，只是按全局速度算 —— 分开存两份时间就会「计划换了、画面没换」。
       */
      stats.frame = Math.floor(animElapsed * activeFps) % planMeta.frameCount;
      stats.clock = animElapsed;
      (window as any).__mapDrawStats = stats;
      /**
       * 顺手把**当前相机**暴露出来（同样只在 `__mapDebug` 打开时）。
       *
       * 自检里要按格坐标去点画布，而「格 → 客户端像素」必须用**此刻**的 pan/zoom；
       * 靠「最近一次计划查询的 view」推会读到过期的相机（切项目 / 自适应缩放之后），
       * 于是点到了地图外、断言莫名其妙地失败。就摆在绘制里，永远不会过期。
       */
      (window as any).__mapCamera = { pan: { x: pan.x, y: pan.y }, zoom, viewport: { w: viewport.w, h: viewport.h } };
    }
  }, [layout, viewport, zoom, pan, planOps, planMarkers, markerSel, legend, legendMap, single, showGrid, hover, animElapsed, activeFps, planMeta.frameCount, brushStamp, stampRot, passCells, showPass]);

  React.useEffect(() => {
    draw();
  }, [draw, imagesReady]);

  /** 停帧条件：系统开了「减少动态效果」或页面被切到后台 → 永远停在第一帧。 */
  const stillFrame =
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches === true) ||
    (typeof document !== "undefined" && document !== null && document.hidden === true);

  React.useEffect(() => {
    if (stillFrame === true || planMeta.frameCount <= 1) {
      setAnimTick(0);
      return undefined;
    }
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return undefined;
    const started = Date.now();
    let handle = 0;
    const tick = () => {
      const elapsed = (Date.now() - started) / 1000;
      /**
       * 节拍按**最快的那条速度**推进（速度慢的素材在这中间不动，因为它的帧号只在
       * 整数个 1/fps 秒时才变）。这里推的是节拍不是帧号：帧号在 `draw` 里按各自的速度算。
       */
      setAnimTick(Math.round(elapsed * clockFps));
      handle = window.requestAnimationFrame(tick);
    };
    handle = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(handle);
  }, [stillFrame, planMeta.frameCount, clockFps]);

  // ── 编辑：op 批量提交 ────────────────────────────────────────────────
  const applyResult = React.useCallback((result) => {
    if (result === undefined || result === null) return;
    const drop = Array.isArray(result.dropKeys) ? result.dropKeys : [];
    // 只标记「待重拉」，**不删缓存**：删除会让这一块在重拉回来之前没有内容，
    // 拖动时就是整块闪一下（详见 staleRef 的注释）。画面本身不用重画。
    for (const key of drop) staleRef.current.add(key);
    setView((prev) => (prev === null ? prev : { ...prev, canUndo: result.canUndo === true, canRedo: result.canRedo === true }));
    if (Array.isArray(result.skipped) && result.skipped.length > 0) {
      setNotice({ kind: "error", text: result.skipped.slice(0, 2).join("；") });
    }
    /**
     * 整图被整张摘掉时说一句：用户只点了一格（甚至只是橡皮划过去），
     * 实际整块都没了 —— 不说明会以为是 bug。
     */
    const removedStamps = Number(result.stamps);
    if (Number.isFinite(removedStamps) && removedStamps > 0 && (Array.isArray(result.skipped) ? result.skipped.length === 0 : true)) {
      setNotice({ kind: "info", text: T("动到了 {n0} 张整图：它们是一整块，碰一格就整张摘掉了（撤销可以整张还原）。", { n0: String(removedStamps) }) });
    }
    setPlanEpoch((value) => value + 1);
  }, []);

  const flushOps = React.useCallback(async () => {
    if (previewTimer.current !== null) {
      previewTimer.current();
      previewTimer.current = null;
    }
    /**
     * 这一笔要真正提交了：先把它期间预览出来的块标成「待重拉」——
     * 那些内容是按**当时那一部分 op** 算的，最后几个格子可能还没进去。
     * 标记之后宿主会按真实数据把这几块重发一遍，画面不会停在预览上。
     */
    for (const key of previewKeys.current) staleRef.current.add(key);
    previewKeys.current = new Set();
    const ops = pendingOps.current;
    if (ops.length === 0) return;
    if (api === undefined || viewId === null) {
      // ⚠️ 这里**必须**把队列清掉再返回：服务还没挂上 / 项目已被切换时提交不了，
      // 留下的话它们会带着**上一笔的 stroke** 等到下一次 flush，被
      // `stroke: ops[0]?.stroke` 整批盖成一个 id —— 两笔不同的涂抹会被并成
      // 一条撤销；项目已删除时还会往旧 viewId 提交。
      pendingOps.current = [];
      return;
    }
    pendingOps.current = [];
    try {
      const result = await api.applyMapOps({ projectId: viewId, ops, stroke: ops[0]?.stroke, have: [...planRef.current.keys()] });
      applyResult(result);
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
    }
  }, [api, viewId, applyResult]);

  /**
   * 把相机**夹在地图里**：地图比视口大的方向可以滚（`视口-地图 .. 0`），
   * 比视口小的方向钉在 0 —— 也就是「地图左上角贴着画布左上角」。
   *
   * ⚠️ 真机反馈两条都出在这里：拖到右下角时地图会「复位」、而且复位后左上角对不齐，
   * 于是「靠拖动很难把地图拖到左上角」。环绕地图上相机本来可以无限拖，视口越过
   * 地图边界后宿主只能回**折回来的那一份**，画面在「一份地图」的边界上整体跳一格，
   * 看起来就是复位；而 0 这个位置既没有参照物、又不在吸附点上，自然对不齐、也难拖到。
   * 夹住之后 `pan = 0` 就是「地图左上角 = 画布左上角」，拖到头就停，不再有跳变。
   */
  const clampPan = React.useCallback(
    (next) => {
      if (layout === null) return next;
      const viewW = viewportRef.current.w / Math.max(0.01, zoomRef.current);
      const viewH = viewportRef.current.h / Math.max(0.01, zoomRef.current);
      /**
       * `pan` 的定义是「画布左上角落在地图的哪个像素」——所以取值范围是
       * `0 .. max(0, 地图 - 视口)`：
       * · `pan = 0`：地图左上角贴着画布左上角（用户要的「对齐」就是这里）；
       * · `pan = 地图 - 视口`：滚到地图的右下角（地图比视口大时才滚得动）；
       * · 地图比视口小 → 上界为 0 → 钉死在左上角，不会拖出空白。
       *
       * ⚠️ 别把符号想反（我第一版就写成了负区间）：那样小图能拖进空白、大图反而一步不动，
       * 真机上「拖了地图纹丝不动 / 复位后又对不齐」就是这么来的。
       */
      const maxX = Math.max(0, layout.width - viewW);
      const maxY = Math.max(0, layout.height - viewH);
      return { x: Math.min(maxX, Math.max(0, next.x)), y: Math.min(maxY, Math.max(0, next.y)) };
    },
    [layout]
  );

  /**
   * 入队一批 op。
   *
   * 一次按下 → 抬起算**一笔**：拖动期间每 40ms 提交一次，但都带同一个 `stroke`，
   * 宿主才会并成一条历史；否则一次拖拽要按好几次撤销才回得去。
   */
  const queueOps = React.useCallback(
    (ops, immediate) => {
      const stroke = currentStroke.current === null ? `s${++strokeSeq.current}` : currentStroke.current;
      currentStroke.current = immediate === true ? null : stroke;
      pendingOps.current = pendingOps.current.concat(ops.map((op) => ({ ...op, stroke })));
      /**
       * ⚠️ 拖动期间**不再按 40ms 分批提交**，只攒着，等这一笔结束（pointerup /
       * 指针离开 / 被系统取消）一次性提交。用户要求「一笔画完再自动保存，不要一边画
       * 一边保存」—— 顺带也把拖动时的往返次数从每秒 25 次降到一笔一次。
       * 一步完成的编辑（油漆桶 / 一键生成之类）走 `immediate`，立刻提交。
       */
      if (immediate === true) {
        void flushOps();
        return;
      }
      // 节流预览：让这一笔**看得见**（宿主只算不存），真正的提交仍在 pointerup
      if (previewTimer.current === null) {
        previewTimer.current = onceTimer(() => {
          previewTimer.current = null;
          setPreviewTick((value) => value + 1);
        }, 80);
      }
    },
    [flushOps]
  );

  const doUndo = async () => {
    if (api === undefined || viewId === null) return;
    try {
      applyResult(await api.mapUndo({ projectId: viewId, have: [...planRef.current.keys()] }));
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
    }
  };

  const doRedo = async () => {
    if (api === undefined || viewId === null) return;
    try {
      applyResult(await api.mapRedo({ projectId: viewId, have: [...planRef.current.keys()] }));
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
    }
  };

  // ── 画布命中测试与交互 ───────────────────────────────────────────────
  const cellFromEvent = React.useCallback(
    (event) => {
      const canvas = canvasRef.current;
      if (canvas === null || canvas === undefined || layout === null) return null;
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / zoom + pan.x;
      const y = (event.clientY - rect.top) / zoom + pan.y;
      const hit = MAP_pointToCell(layout, x, y);
      if (hit.inMap !== true) return null;
      /**
       * ⚠️ 只认**地图自己那一份**（未取模坐标落在 0..cols/rows 之内）。
       *
       * 环绕地图上，`pointToCell` 会把边界外的位置折回图内，于是「画超过右边缘」会点亮相
       * 反的左边缘、「超过下边缘」会点亮上边缘 —— 用户报的就是这个。画布上超出地图的那片
       * 区域本来就是空白，不该有落笔、也不该有红框。
       */
      const rawR = Math.floor(y / layout.stepY);
      const rawC = Math.floor(x / layout.stepX);
      if (rawR < 0 || rawC < 0 || rawR >= layout.rows || rawC >= layout.cols) return null;
      /**
       * ⚠️ 把**未取模**的地图坐标一起带出去，两个地方都要用：
       *
       * 1. 红框：环绕模式下同一格会在屏幕上出现好几次（地图比画布小的时候最常见）。
       *    只留取模后的 `r/c`，红框就画在「地图内的那一份」上 —— 真机表现是鼠标在左边、
       *    红框跑到右边一整张地图之外（实测偏差 ≈ 353.6px = 一张地图宽）。
       * 2. **补间**：`paintCells` 必须按未取模的格号插值。用取模后的格号时，指针跨过
       *    接缝（右边界那一份的 c=31 → 下一份的 c=0，屏幕上只差十几像素）会被算成
       *    「从第 31 列走到第 0 列」→ **整行被填满**。真机复现：清空图层后横扫一笔，
       *    整行 32 格全亮。
       */
      return { r: hit.r, c: hit.c, x, y, rawR, rawC };
    },
    [layout, zoom, pan]
  );

  /**
   * 画笔从一个格拖到另一个格：把中间漏掉的格补上。
   *
   * ⚠️ 补间用**未取模**的格号（`rawR` / `rawC`），发出去的也允许越界 —— 宿主
   * `applyOps` 自己会取模。用取模后的格号补间的话，指针跨过地图接缝时会被算成
   * 「从第 31 列走到第 0 列」，一笔就把整行填满（真机复现过；横向扫一笔 → 整行 32 格）。
   * 没有 raw 的（理论上不会，防御式兜底）退回取模格号。
   */
  const paintCells = (from, to, tile) => {
    if (activeLayer === null) return;
    const rawOf = (cell) => ({ r: cell.rawR === undefined ? cell.r : cell.rawR, c: cell.rawC === undefined ? cell.c : cell.rawC });
    const end = rawOf(to);
    const cells = from === null || from === undefined ? [end] : MAP_lineCells(rawOf(from).r, rawOf(from).c, end.r, end.c);
    queueOps([{ kind: "paint", layerId: activeLayer.id, cells: cells.map((cell) => ({ r: cell.r, c: cell.c, tile })) }]);
  };

  const warnNoBrush = () => {
    if (brush === null) {
      setNotice({ kind: "error", text: T("先在左边点一块图当笔刷。") });
      return true;
    }
    return false;
  };

  /** 吸管：从宿主给的绘制条目里读「这一格最上面是哪一块」。 */
  const pickAt = (cell) => {
    let found = null;
    for (const key of visibleRef.current) {
      const ops = planOps.get(key);
      if (ops === undefined) continue;
      for (const op of ops) {
        if (op.r !== cell.r || op.c !== cell.c) continue;
        if (single === true && op.l !== safeLayerIndex) continue;
        if (found === null || (op.l ?? 0) >= (found.l ?? 0)) found = op;
      }
    }
    if (found === null) return;
    // ⚠️ 吸管吸到的是**这一格实际贴的那一块**。对拼块素材来说那是一个 16px 小格，
    // 而调色板里只有该素材的**一个代表笔刷** —— 直接 setBrush(小格) 的话红框找不到
    // 对应的格子，用户会看到「当前笔刷」凭空消失（真机实测：吸海面后红框没了）。
    // 所以这里把它归到「拥有它的那个调色板条目」上；普通素材每格都有条目，等于原样。
    const owner = legendMap.get(found.t);
    const entries = view === null || view === undefined ? [] : view.tilesets;
    let index = found.t;
    if (owner !== undefined) {
      const tileset = entries.find((entry) => entry.id === owner.tilesetId);
      const palette = tileset === undefined ? [] : tileset.palette;
      if (palette.length > 0 && !palette.some((entry) => entry.index === found.t)) index = palette[0].index;
    }
    setBrush({ index, tilesetId: owner === undefined ? undefined : owner.tilesetId });
    setStampRot(0);
    setMulti([index]);
  };

  const zoomAt = (clientX, clientY, factor) => {
    const canvas = canvasRef.current;
    if (canvas === null || canvas === undefined) return;
    const rect = canvas.getBoundingClientRect();
    const prev = zoomRef.current;
    const next = Math.min(8, Math.max(0.25, prev * factor));
    const mapX = (clientX - rect.left) / prev + panRef.current.x;
    const mapY = (clientY - rect.top) / prev + panRef.current.y;
    setZoom(next);
    setPan((prev) => clampPan({ x: mapX - (clientX - rect.left) / next, y: mapY - (clientY - rect.top) / next }));
  };
  // 原生滚轮监听要在事件到来时拿到**最新**的 zoomAt（它闭包了 zoom/pan），
  // 所以用 ref 转发，而不是把 zoomAt 塞进 effect 依赖（那会每帧重新挂监听）。
  zoomAtRef.current = zoomAt;

  const onPointerDown = (event) => {
    if (layout === null) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    const canvas = canvasRef.current;
    if (canvas !== null && canvas !== undefined && typeof canvas.setPointerCapture === "function" && event.pointerId !== undefined) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // 捕获失败不影响画图，只是拖出画布后会断线。
      }
    }
    const pointerId = event.pointerId === undefined ? 1 : event.pointerId;
    pointersRef.current.set(pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      strokeRef.current = null;
      currentStroke.current = null;
      pointersRef.current.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    const hit = cellFromEvent(event);
    if (hit === null) return;
    if (tool === "hand" || event.button === 1 || spaceRef.current === true) {
      strokeRef.current = { mode: "pan", clientX: event.clientX, clientY: event.clientY, pan: { ...pan } };
      return;
    }
    if (tool === "marker") {
      const existing = markerAtCell(hit.r, hit.c);
      if (event.button === 2) {
        if (existing !== undefined) void markerOp({ kind: "marker", op: "remove", id: existing.id }, true);
        return;
      }
      if (existing !== undefined) {
        // 点已有标记 = 选中它（图层卡里就能改名）；按住拖到别的格就是挪位置。
        setMarkerSel(existing.id);
        strokeRef.current = { mode: "marker", id: existing.id, from: { r: hit.r, c: hit.c } };
        return;
      }
      void markerOp({ kind: "marker", op: "add", r: hit.r, c: hit.c }, true);
      return;
    }
    if (event.button === 2 && tool === "pen") {
      /**
       * **右键 = 旋转**（用户定的：右键不再是橡皮，擦除只能点「橡皮」工具）。
       * 只有整图笔刷有朝向可变；别的素材转它没有意义，但仍然 swallow（不擦）。
       *
       * ⚠️ 只有**画笔**走这里：橡皮 / 油漆桶 / 吸管选了哪个工具，右键就做那个工具的事
       * （橡皮右键也是擦一格）。以前这一条不分工具，结果「整图笔刷 + 橡皮」右键还会转整图。
       */
      if (brushStamp !== null) setStampRot((current) => (current + 1) % 4);
      else setNotice({ kind: "info", text: T("右键是旋转整图用的；这种素材一格一块，不用转。擦除请点左边的「橡皮」。") });
      return;
    }
    if (tool === "eraser") {
      currentStroke.current = null;
      strokeRef.current = { mode: "paint", from: hit, tile: 0 };
      paintCells(null, hit, 0);
      return;
    }
    if (tool === "pipette") {
      pickAt(hit);
      return;
    }
    if (tool === "bucket") {
      if (warnNoBrush() || activeLayer === null) return;
      queueOps([{ kind: "fill", layerId: activeLayer.id, r: hit.r, c: hit.c, tile: brush.index }], true);
      return;
    }
    if (warnNoBrush()) return;
    /**
     * **整图**：点一次印一整张（一次 `stampPlace` 就是 6/9 格），**拖动不连印** ——
     * 一拖就是几十张叠在一起，撤销还只能一张一张退。
     */
    if (brushStamp !== null) {
      currentStroke.current = null;
      strokeRef.current = { mode: "stamp" };
      queueOps([{ kind: "stampPlace", layerId: activeLayer === null ? "" : activeLayer.id, tilesetId: brushStamp.tilesetId, r: hit.r, c: hit.c, rot: stampRot }], true);
      return;
    }
    currentStroke.current = null;
    strokeRef.current = { mode: "paint", from: hit, tile: brush.index };
    paintCells(null, hit, brush.index);
  };

  const onPointerMove = (event) => {
    if (layout === null) return;
    const pointerId = event.pointerId === undefined ? 1 : event.pointerId;
    if (pointersRef.current.has(pointerId)) pointersRef.current.set(pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pointersRef.current.pinch;
    if (pinch !== undefined && pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.distance > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, distance / pinch.distance);
      pinch.distance = distance;
      return;
    }
    const stroke = strokeRef.current;
    if (stroke !== null && stroke !== undefined && stroke.mode === "pan") {
      setPan(
        clampPan({
          x: stroke.pan.x - (event.clientX - stroke.clientX) / zoom,
          y: stroke.pan.y - (event.clientY - stroke.clientY) / zoom
        })
      );
      return;
    }
    const hit = cellFromEvent(event);
    if (hit === null) {
      setHover((prev) => (prev === null ? prev : null));
      return;
    }
    /**
     * ⚠️ 同一格内移动**不要**换新对象。`hover` 是绘制回调的依赖，换对象 = 整幅重画；
     * 拖动时每秒几十个 `pointermove`，一格又往往走上好几个事件，于是每秒几十次
     * 「清屏 + 重画所有条目」——真机表现就是画布一直在闪、CPU 一直满。
     * 红框是按格对齐的，格号没变画面就没变，返回同一个对象让 React 直接跳过这次渲染。
     */
    setHover((prev) => (prev !== null && prev.r === hit.r && prev.c === hit.c ? prev : hit));
    if (stroke !== null && stroke !== undefined && stroke.mode === "marker") {
      // 每跨一格提交一次（挪位置不改编号，所以**不重读视图**；松手时补一次）。
      if (stroke.from.r !== hit.r || stroke.from.c !== hit.c) {
        stroke.from = { r: hit.r, c: hit.c };
        void markerOp({ kind: "marker", op: "move", id: stroke.id, r: hit.r, c: hit.c }, false);
      }
      return;
    }
    if (stroke !== null && stroke !== undefined && stroke.mode === "paint") {
      if (stroke.from.r !== hit.r || stroke.from.c !== hit.c) {
        paintCells(stroke.from, hit, stroke.tile);
        stroke.from = hit;
      }
    }
  };

  const onPointerUp = (event) => {
    const pointerId = event.pointerId === undefined ? 1 : event.pointerId;
    pointersRef.current.delete(pointerId);
    if (pointersRef.current.size < 2) delete pointersRef.current.pinch;
    const stroke = strokeRef.current;
    strokeRef.current = null;
    currentStroke.current = null;
    void flushOps();
    // 拖完标记补读一次视图：拖动期间刻意没读（每格读一次太吵），列表里的坐标要跟上。
    if (stroke !== null && stroke !== undefined && stroke.mode === "marker" && api !== undefined && viewId !== null) {
      void loadProject(viewId, true);
    }
  };

  // 快捷键：B/E/G/I/H/V 与撤销重做；焦点在输入框里时全部失效
  React.useEffect(() => {
    const editable = (target) => target !== null && target !== undefined && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || "");
    const onKeyDown = (event) => {
      if (String(event.key) === " ") {
        spaceRef.current = true;
        if (editable(event.target) !== true && typeof event.preventDefault === "function") event.preventDefault();
        return;
      }
      const meta = event.metaKey === true || event.ctrlKey === true;
      if (meta === true) {
        if (editable(event.target) === true) return;
        const key = String(event.key).toLowerCase();
        if (key === "z" && event.shiftKey === true) {
          event.preventDefault();
          void doRedo();
          return;
        }
        if (key === "z" || key === "y") {
          event.preventDefault();
          void doUndo();
        }
        return;
      }
      if (editable(event.target) === true) return;
      const key = String(event.key).toLowerCase();
      if (key === "b") setTool("pen");
      else if (key === "e") setTool("eraser");
      else if (key === "g") setTool("bucket");
      else if (key === "i") setTool("pipette");
      else if (key === "h") setTool("hand");
      else if (key === "m") setTool("marker");
      else if (key === "v") setSingle((value) => value !== true);
    };
    const onKeyUp = (event) => {
      if (String(event.key) === " ") spaceRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  // ── 项目与素材的动作 ─────────────────────────────────────────────────
  const ensureTwoLayers = async (projectId) => {
    const next = await api.getMapProject({ projectId });
    if (((next.layers || []).length) < 2) await api.saveMapDoc({ projectId, addLayer: { name: T("图层 2") } });
  };

  /** 没有项目就地建一个：32×32、两层，建完就能画。 */
  const ensureProject = async () => {
    if (viewId !== null) return viewId;
    const created = await api.createMapProject({ name: T("我的地图"), cols: 32, rows: 32 });
    setProjects((prev) => [{ id: created.id, name: created.name }, ...prev]);
    await ensureTwoLayers(created.id);
    return created.id;
  };

  const readBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error(T("读文件失败")));
      reader.readAsDataURL(file);
    });

  const startWithFile = async (file) => {
    if (file === undefined || file === null || api === undefined) return;
    setBusyKey("upload");
    try {
      const projectId = await ensureProject();
      const base64 = await readBase64(file);
      const imported = await api.importMapTileset({ projectId, name: file.name, data: base64 });
      if (imported !== undefined && Array.isArray(imported.warnings) && imported.warnings.length > 0) {
        setNotice({ kind: "info", text: imported.warnings.join("；") });
      } else {
        setNotice({ kind: "info", text: T("已导入 {n0}", { n0: file.name }) });
      }
      await loadProject(projectId);
      const result = await api.listMapProjects();
      setProjects(result.projects || []);
      setOpenCard("assets");
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const startWithSample = async () => {
    if (api === undefined) return;
    setBusyKey("sample");
    try {
      const projectId = await ensureProject();
      await api.importSampleTileset({ projectId });
      await loadProject(projectId);
      const result = await api.listMapProjects();
      setProjects(result.projects || []);
      setOpenCard("assets");
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setBusyKey(null);
    }
  };

  /** 打开「新增素材」：草稿全空 = 一切都走自动识别。 */
  /**
   * 改「占几格」时把区域格子重排：**按行列位置尽量保留**已经点过的状态，
   * 新多出来的格默认「不可通过」（安全默认：宁可挡住，也别让角色走进墙里）。
   */
  /**
   * 整图预览图：把选中的那张图变成一个 blob URL，铺在「区域」那个框的底层 ——
   * 用户可以**直接在图上点格子**，不用再把「第几行第几列」和画面对一遍。
   *
   * 用 `createObjectURL`（**同步**）而不是 `FileReader`：预览只在“还没导入”的那一刻用，
   * 同步拿到 URL 就不会在 effect 里反复 setState（那会让界面每帧重渲染一轮）。
   * blob URL 不复制像素，回收交给浏览器：它指向的就是草稿里那个 File。
   */
  const addCurrentFile = addDraft === null ? null : addDraft.file;
  const stampPreviewUrl = React.useMemo(() => {
    if (addCurrentFile === null || addCurrentFile === undefined) return undefined;
    const create = typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL.createObjectURL : undefined;
    if (create === undefined) return undefined;
    try {
      return create(addCurrentFile);
    } catch {
      return undefined;
    }
  }, [addCurrentFile]);

  /** 当前项目的地图有多大（整图的上限就是它）。 */
  const mapLimits = stampLimits(view === null || view === undefined ? undefined : view.cols, view === null || view === undefined ? undefined : view.rows);
  const resizeStampPass = (current, nextCols, nextRows) => {
    if (current === null) return current;
    const cols = clampStampSpan(nextCols === undefined ? Number(current.stampCols) || 3 : nextCols, mapLimits.maxCols);
    const rows = clampStampSpan(nextRows === undefined ? Number(current.stampRows) || 3 : nextRows, mapLimits.maxRows);
    const oldCols = clampStampSpan(Number(current.stampCols) || 3, mapLimits.maxCols);
    const oldRows = clampStampSpan(Number(current.stampRows) || 3, mapLimits.maxRows);
    const pass = new Array(cols * rows).fill(0);
    for (let r = 0; r < Math.min(rows, oldRows); r++) {
      for (let c = 0; c < Math.min(cols, oldCols); c++) pass[r * cols + c] = current.stampPass[r * oldCols + c] ?? 0;
    }
    return { ...current, stampCols: String(cols), stampRows: String(rows), stampPass: pass };
  };

  const openAddTileset = () =>
    setAddDraft({
      file: null,
      name: "",
      cellW: "",
      cellH: "",
      shape: "auto",
      animRows: false,
      fps: "",
      loop: "forward",
      clarity: "smooth",
      scale: 1,
      // 整图：占几格 / 几帧 / 每格通行性（0 不可通过 / 1 可通过·被人物遮挡 / 2 可通过·遮挡人物）
      stampCols: "3",
      stampRows: "3",
      stampFrames: "1",
      stampPass: new Array(9).fill(0),
      // 整图默认抠绿幕（AI 那条路生成的就是绿幕图）；回链带 keyed=1 时说明已经抠过。
      stampKey: true
    });

  /**
   * 提交新增：把「图片 + 名字 + 属性」一次性交给宿主。
   *
   * 留空的项不发（宿主按自动识别处理）；只有用户真的填了才带上，避免用空值把识别结果顶掉。
   */
  const submitAddTileset = async () => {
    const draft = addDraft;
    if (draft === null || api === undefined) return;
    if (draft.file === null) {
      setNotice({ kind: "error", text: T("先选一张素材图。") });
      return;
    }
    const projectId = await ensureProject();
    if (projectId === null) return;
    setBusyKey("upload");
    try {
      const base64 = await readBase64(draft.file);
      const cell = draft.cellW !== "" && draft.cellH !== "" ? { width: Number(draft.cellW), height: Number(draft.cellH) } : undefined;
      const imported = await api.importMapTileset({
        projectId,
        name: draft.name.trim() === "" ? draft.file.name : draft.name.trim(),
        data: base64,
        cell,
        shape: draft.shape === "auto" ? undefined : draft.shape,
        animRows: draft.animRows === true,
        // 留空 = 不填这一项（跟全局速度走）；填了就是这块素材自己的帧率。
        fps: draft.fps === undefined || draft.fps === "" ? undefined : Number(draft.fps),
        /**
         * 清晰度与倍数一起发：`scale > 1` 时宿主会先按 `clarity` 把图缩到格子大小，
         * `scale = 1` 时这两个字段宿主都不理会（手动导格子大小的图，一个像素都不动）。
         */
        clarity: draft.clarity === undefined ? undefined : draft.clarity,
        scale: draft.scale === undefined ? 1 : draft.scale,
        // 循环方式：正放 / 倒放 / 来回（只影响帧序怎么展开）。
        loop: draft.loop === undefined ? undefined : draft.loop,
        /**
         * 整图：占几格 / 几帧 / 每格通行性。给了 `stamp` 宿主就把形态锁成整图、
         * 格子锁成地图网格（界面上「格子大小」那块也就不必填）。
         */
        stamp:
          draft.shape === "stamp"
            ? {
                cols: clampStampSpan(Number(draft.stampCols) || 3, mapLimits.maxCols),
                rows: clampStampSpan(Number(draft.stampRows) || 3, mapLimits.maxRows),
                frames: Math.max(1, Math.min(16, Number(draft.stampFrames) || 1)),
                pass: draft.stampPass
              }
            : undefined,
        /**
         * 导入时抠绿幕（只对整图有意义）：AI 那条路在整理时已经抠过，回链会把它关掉，
         * 免得抠第二遍把画面里本就很少的绿误伤掉。
         */
        stampKey: draft.shape === "stamp" ? draft.stampKey !== false : undefined
      });
      setAddDraft(null);
      setNotice({ kind: "info", text: T("已新增素材 {n0}", { n0: draft.name.trim() === "" ? draft.file.name : draft.name.trim() }) });
      if (imported !== undefined && Array.isArray(imported.warnings) && imported.warnings.length > 0) {
        setNotice({ kind: "info", text: imported.warnings.join("；") });
      }
      await loadProject(projectId);
      const list = await api.listMapProjects();
      setProjects(list.projects || []);
      setOpenCard("assets");
      // 新加的那张直接选上（列表最后一张）
      const fresh = await api.listMapProjects();
      void fresh;
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setBusyKey(null);
    }
  };

  /** 删掉列表里的某一张（内置也能删）。 */
  /**
   * 「这块素材怎么用」的四个选项：`[值, 按钮短标签, 悬停小标签标题, 解释]`。
   *
   * ⚠️ 原来是个 `<select>`，而原生 `<option>` **挂不了 tooltip** —— 可「自动 / 普通图块 /
   * 整格自动连接 / 拼块自动连接」这四个词对非专业用户等于没说（用户原话：意义不明）。
   * 换成四个按钮 + 悬停小标签：鼠标移上去就把这一项讲清楚（和工具格同一套标签）。
   */
  const shapeOptions = [
    ["auto", T("自动"), T("自动"), T("让程序看图片大小，自己决定下面几种里该用哪种。拿不准就选它（它只会选普通 / 整格 / 拼块 —— 整图要填占几格，得自己选）。注意：这一项定下来就不能改了，想换只能删掉重新加一张。")],
    ["plain", T("普通"), T("普通图块"), T("一格贴一块图，边角不会自己接上。适合树、房子、道具这种一块一块单独摆的图。")],
    ["corner16", T("整格"), T("整格自动连接"), T("一格贴一块图，同时看上下左右有没有同样的格子，自动从 16 块里挑最合适的一块：边缘、拐角会自己接上。适合墙、路、篱笆这种要连成一条的图。图片要排成 4×4 = 16 块。")],
    ["a2quad", T("拼块"), T("拼块自动连接"), T("每个格子再拆成 2×2 四个小块，按周围的格子自动拼成一大片。适合草地、水面、沙地这类成片铺开的地面。图片要按「一格 = 2×2 小块」的方式排。")],
    ["stamp", T("整图"), T("整图（占好几格的一张图）"), T("一张图一次印满 N×M 格：雕像、壁画、地毯这类占好几格的建筑与装饰。选它之后填「占几格」与「帧数」，再把每格能不能走点一遍。印的时候右键可以转 90°。")]
  ];
  /**
   * 一段「几个按钮里选一个」的控件（用法、会动吗都用它）。
   *
   * 对话框里的选择只改**草稿**，点「确定」才交给宿主 —— 属性一旦定下来就不能改了，
   * 不该边点边写。
   */
  const segPicker = (attr, options, current, onPick) =>
    h(
      "div",
      { className: "SPR_mapEdSeg" },
      options.map(([value, short, title, desc]) =>
        h(
          "button",
          {
            key: value,
            type: "button",
            className: "SPR_mapEdSegBtn",
            [attr]: value,
            "data-on": current === value ? "true" : undefined,
            "aria-label": `${title}：${desc}`,
            onMouseEnter: showToolTip(title, desc, null),
            onFocus: showToolTip(title, desc, null),
            onMouseLeave: hideToolTip,
            onBlur: hideToolTip,
            onClick: () => onPick(value)
          },
          short
        )
      )
    );

  /**
   * 「清晰度」：把大图缩到地图格子时用哪种重采样。
   *
   * 只在**图比格子大**的时候才有意义（AI 生成的那条路会带 `scale` 进来），
   * 所以 `scale = 1` 时这整块不显示 —— 显示一个什么都不做的下拉框只会让人以为没生效。
   * `[值, 短标签, 悬停标题, 解释]`，跟「这块素材怎么用」同一套形状。
   */
  const clarityOptions = [
    ["smooth", T("平滑"), T("平滑（面积平均）"), T("把每个格子覆盖到的像素全部平均掉：细节保留、边缘柔和、没有锯齿。AI 画的那种金属 / 霓虹 / 渐变的图，选这个最清楚。")],
    ["sharp", T("锐利"), T("锐利（最近邻）"), T("每个格子只取一个像素：边缘硬、像素风，但大图缩小时会丢细节、出锯齿。本来就画成像素画的图选这个。")],
    ["crisp", T("清晰"), T("清晰（平均 + 锐化）"), T("先面积平均，再做一次轻锐化：轮廓更利落、细节更抓眼，适合细节特别密的图（电路、纹理、文字状花纹）。")]
  ];

  const animOptions = [
    ["off", T("不动"), T("不动"), T("这些图块都是静止的，画上去不会动。")],
    ["rows", T("翻页图"), T("翻页图"), T("会动的图：同一列的几行从上往下依次显示，看起来就像手翻书。适合水面波光、火苗、瀑布。画的时候点哪一行都行，整片会一起动。")]
  ];

  /**
   * 「循环方式」：会动的素材怎么循环。
   *
   * 三者都是**把帧序展开**（宿主做），客户端一行不用改：
   * 正放 0→1→2→3→0…；倒放 3→2→1→0→3…；来回 0→1→2→3→2→1→0…（接缝处不跳，像呼吸灯）。
   */
  const loopOptions = [
    ["forward", T("正放"), T("正放循环"), T("从头放到尾，再接回开头：0 → 1 → 2 → 3 → 0 …。最常见的循环。")],
    ["reverse", T("倒放"), T("倒放循环"), T("从尾放到头：3 → 2 → 1 → 0 → 3 …。看起来就是倒着播还一直循环。")],
    ["pingpong", T("来回"), T("来回播放"), T("正着放到尾再从尾倒回来：0 → 1 → 2 → 3 → 2 → 1 → 0 …。首尾接得最顺，像呼吸灯、旗帜、水面起伏。")]
  ];

  /**
   * 这块素材**自己的动画播放速度**（帧/秒）。
   *
   * 默认「跟设置里的动画速度」—— 那是一条全局速度，慢 / 中 / 快三档；这里选了具体数字
   * 就只影响这一张素材（一片水该慢、一排霓虹灯该快，同一个速度套不住两种）。
   * `[值, 显示文字, 悬停说明]`，值 `""` = 跟全局。
   */
  const fpsOptions = [
    ["", T("跟设置里的动画速度"), T("跟全局速度走"), T("用「设置」里的那条动画速度，慢 / 中 / 快都跟着变。拿不准就选它。")],
    ["1", T("1 帧/秒"), T("每秒 1 帧"), T("一秒换一帧，很慢：适合呼吸灯、缓慢起伏的水面。")],
    ["2", T("2 帧/秒"), T("每秒 2 帧"), T("两秒走完一轮（按 2 帧算），适合水波、旗帜这类慢动作。")],
    ["4", T("4 帧/秒"), T("每秒 4 帧"), T("常见的动画速度：水面波光、篝火、流水。")],
    ["6", T("6 帧/秒"), T("每秒 6 帧"), T("偏快：瀑布、闪烁的霓虹灯。")],
    ["8", T("8 帧/秒"), T("每秒 8 帧"), T("很快：电流、喷泉、快速闪烁。")],
    ["12", T("12 帧/秒"), T("每秒 12 帧"), T("最快的一档：要靠逐帧动画硬撑的连续动作。")]
  ];

  /**
   * 整图的「哪些格子能走」：素材图铺满那个框，格子用 CSS grid 严丝合缝地叠上去 ——
   * 点的是「图上那一块」，不用再把格子编号与画面位置在心里对一遍。
   *
   * 两个入口共用（「新增素材」的草稿 / 「素材属性」改已有素材）：三态颜色、图例、两个快捷按钮
   * 与测试 id 前缀都走同一份，免得两处慢慢长成不一样的说法。
   *
   * `sheetWidthCells`：素材图**一行有多少格**。新增时贴的是原始图（= cols）；
   * 已有素材贴的是**烘过 4 个旋转**的成品图（= max(cols, rows)）—— 非方形整图（4×3）
   * 若不按真实行宽算铺图比例，格子与画面就会错位，用户点错格还看不出来。
   */
  const stampPassGrid = (options) => {
    const cols = Math.max(1, Math.round(Number(options.cols) || 1));
    const rows = Math.max(1, Math.round(Number(options.rows) || 1));
    const frames = Math.max(1, Math.round(Number(options.frames) || 1));
    const pass = Array.isArray(options.pass) ? options.pass : [];
    const sheetWidth = Math.max(cols, Math.round(Number(options.sheetWidthCells) || cols));
    const image = typeof options.image === "string" && options.image !== "" ? options.image : undefined;
    const backgroundSize =
      options.sheetWidthCells === undefined
        ? frames > 1
          ? `100% ${frames * 100}%`
          : "100% 100%"
        : `${(sheetWidth * 100) / cols}% ${(frames * 2 * (cols + rows) * 100) / rows}%`;
    const prefix = options.prefix;
    /**
     * `onChange` 收到的是**更新函数** `(上一次的 pass) => 新的 pass`，不是算好的数组。
     *
     * 为什么：两下点击之间如果还没重渲染（连续点、或一次粘贴式操作），用渲染时捕获的
     * `pass` 去算会让第二下从旧值出发 —— 用户看到「点了两下只前进一步」。交给 setState
     * 的函数式更新，每一次都在最新值上累加。
     */
    const change = (update) => {
      if (typeof options.onChange === "function") options.onChange(update);
    };
    const passOf = (source) =>
      Array.from({ length: cols * rows }, (_item, index) => Number(source?.[index]) || 0);
    return h(
      "div",
      { "data-testid": `${prefix}-stamp-block` },
      h("div", { className: "SPR_mapEdDlgLabel" }, T("哪些格子能走（在图上点格子）")),
      h(
        "div",
        {
          className: "SPR_mapEdStamp",
          "data-testid": `${prefix}-stamp-preview`,
          style: {
            aspectRatio: `${cols} / ${rows}`,
            backgroundImage: image === undefined ? "none" : `url("${image}")`,
            backgroundSize,
            backgroundPosition: "0% 0%"
          }
        },
        h(
          "div",
          {
            className: "SPR_mapEdStampGrid",
            style: { gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }
          },
          Array.from({ length: rows }, (_unused, r) =>
            Array.from({ length: cols }, (_ignored, c) => {
              const index = r * cols + c;
              const kind = Number(pass[index]) || 0;
              return h("button", {
                key: `cell${r}-${c}`,
                type: "button",
                className: "SPR_mapEdStampCell",
                "data-pass": String(kind),
                "data-testid": `${prefix}-pass-${r}-${c}`,
                title: T("第 {n0} 行第 {n1} 列：不可通过 / 可通过（被人物遮挡）/ 可通过（遮挡人物）", { n0: String(r + 1), n1: String(c + 1) }),
                onClick: () =>
                  change((previous) => {
                    const next = passOf(previous);
                    next[index] = (next[index] + 1) % 3;
                    return next;
                  })
              });
            })
          )
        )
      ),
      h(
        "div",
        { className: "SPR_mapEdLegend" },
        h("span", null, h("i", { style: { background: "rgba(226,59,43,.75)" } }), T("墙 · 不可通过")),
        h("span", null, h("i", { style: { background: "rgba(52,120,246,.75)" } }), T("走·前 · 角色盖住它")),
        h("span", null, h("i", { style: { background: "rgba(52,190,120,.75)" } }), T("走·后 · 它盖住角色"))
      ),
      h(
        "div",
        { className: "SPR_mapEdDlgRow" },
        h(Btn, { "data-testid": `${prefix}-pass-none`, onClick: () => change(() => new Array(cols * rows).fill(0)) }, T("全部不可通过")),
        h(Btn, { "data-testid": `${prefix}-pass-walk`, onClick: () => change(() => new Array(cols * rows).fill(1)) }, T("全部可通过"))
      ),
      h(
        "p",
        { className: "SPR_mapEdHint" },
        T("点格子换状态：墙 = 不可通过；走·前 = 能走、角色画在它上面（地毯）；走·后 = 能走、它画在角色上面（雕像上身，绕后）。")
      )
    );
  };

  /**
   * 「素材说明」的三页：一张示例图 + 几句人话，讲清每种素材图该**怎么排**。
   *
   * 为什么要有它：图排错了不会报错，只会「画上去不对」—— 用户拿着自己画的图卡在这里，
   * 光靠「这块素材怎么用」那四个按钮悬停里的两行字说不清「几列几行、第几块是哪一种」。
   *
   * 示例图不是手画的（见 `scripts/make-map-guide-art.mjs`）：普通 / 整格两张由内置素材
   * 生成器现画，拼块那张就是内置草地本身 —— 说明与用户点「恢复默认素材」真能拿到的
   * 东西同一份来源。图上的网格按 `MAP_GUIDE_ART` 里的 cols / rows / sub **现算**百分比，
   * 所以改了图也不会有「网格线还在老位置」的错位。
   */
  const guidePages = [
    {
      key: "plain",
      label: T("普通图块"),
      title: T("普通图块：一格贴一块图"),
      cap: (art) => T("示例：{n0} 列 × {n1} 行，共 {n2} 块，每块 {n3}×{n3}。", { n0: String(art.cols), n1: String(art.rows), n2: String(art.cols * art.rows), n3: String(art.cell) }),
      points: [
        T("把要用的东西一个个画出来，每块一样大（常用 32×32）。"),
        T("横平竖直排成一张 PNG：想排几列几行都行，只要格子一样大。"),
        T("块与块之间别留缝、别留白边 —— 留了也会被当成图的一部分。"),
        T("存成 PNG，在「新增素材」里选它；格子大小留空就自动认，认错了再自己填。")
      ],
      fit: T("适合：树、房子、道具这类一块一块单独摆的东西。"),
      warn: T("提醒：涂几格就是几块，各画各的，块与块之间不会自己接上。")
    },
    {
      key: "corner16",
      label: T("整格自动连接"),
      title: T("整格自动连接：16 块拼成一条"),
      cap: (art) => T("示例：{n0} 列 × {n1} 行，正好 {n2} 块，每块 {n3}×{n3}；每块画的是「上下左右有谁」的一种接法。", { n0: String(art.cols), n1: String(art.rows), n2: String(art.cols * art.rows), n3: String(art.cell) }),
      points: [
        T("一张 PNG，4 列 × 4 行，正好 16 块，每块一样大。"),
        T("顺序是固定的：从左到右、从上到下。上 = 1、右 = 2、下 = 4、左 = 8，四个方向加起来是几，就用第几块（第一块算 0）。"),
        T("所以第 1 块是四周都没有邻居，最后一块是四周都有；中间照这个顺序一个个排下去。"),
        T("存成 PNG，在「新增素材」里选它，再把「这块素材怎么用」选成「整格」。")
      ],
      fit: T("适合：墙、路、篱笆、水渠这类要连成一条的东西。"),
      warn: T("提醒：块数不是 16 就不会自动挑，画出来会全用第一块。")
    },
    {
      key: "a2quad",
      label: T("拼块自动连接"),
      title: T("拼块自动连接：一格再分四小块"),
      cap: (art) =>
        T("示例：{n0} 列 × {n1} 行，每块 {n3}×{n3}；一格里面再分成 2×2 个 {n4}×{n4} 的小块。", {
          n0: String(art.cols),
          n1: String(art.rows),
          n3: String(art.cell),
          n4: String(art.cell / (art.sub > 0 ? art.sub : 1))
        }),
      points: [
        T("一张 PNG：竖着正好 5 行，每行是一种接法的样子；一格多大自己定，示例里是 32×32。"),
        T("竖向第 1 行是四周都不接的样子，往下一直到第 5 行四周都接；一格里四个小块各挑各的行。"),
        T("横向每一列是同一种样子的另一种画法：多放几列，铺一大片时不会呆板，它们还会按顺序显示出来 —— 那就是会动。"),
        T("存成 PNG，在「新增素材」里选它，再把「这块素材怎么用」选成「拼块」。")
      ],
      fit: T("适合：草地、水面、沙地这类成片铺开的地面。"),
      warn: T("提醒：竖向要正好 5 行；边上不足一格的会被裁掉。")
    }
  ];

  /** 打开「素材说明」。草稿里已经选过哪种用法，就直接翻到那一页（自动识别则从头看）。 */
  const openGuide = () => {
    const wanted = addDraft === null ? "" : addDraft.shape;
    const found = guidePages.findIndex((page) => page.key === wanted);
    setGuidePage(found < 0 ? 0 : found);
  };

  /**
   * 「素材说明」窗口：三页，图上盖一层网格，网格循环藏起来又显出来。
   *
   * 它只跟着「新增素材」一起出现（草稿没了就一起关），遮罩比「新增素材」那层更高，
   * 点外面关掉的只有它自己 —— 看完接着填那张表，不用重新点一遍。
   */
  const guideDialog =
    addDraft === null || guidePage === null
      ? null
      : (() => {
          const pageIndex = Math.min(Math.max(0, guidePage), guidePages.length - 1);
          const page = guidePages[pageIndex];
          const art = MAP_GUIDE_ART[page.key];
          if (art === undefined) return null;
          const cell = { width: 100 / art.cols, height: 100 / art.rows };
          /**
           * 示例图按原始像素比放大到一列宽（小图也能看清），但高度不超过 262：
           * 容器宽度就是「这张图能长到多大」，网格的百分比铺在容器上，正好落在真格子上。
           */
          const boxWidth = Math.round(Math.min(236, (262 * (art.cols * art.cell)) / (art.rows * art.cell)));
          return h(
            "div",
            { className: "SPR_mapEdDlgMask SPR_mapEdGuideMask", "data-testid": "map-guide-mask", onClick: () => setGuidePage(null) },
            h(
              "div",
              {
                className: "SPR_mapEdGuide",
                role: "dialog",
                "aria-label": T("素材说明"),
                "data-testid": "map-guide-dialog",
                onClick: (event) => {
                  if (typeof event.stopPropagation === "function") event.stopPropagation();
                }
              },
              h(
                "div",
                { className: "SPR_mapEdGuideHead" },
                h("div", { className: "SPR_mapEdDlgTitle" }, T("素材说明")),
                h(Btn, { "data-testid": "map-guide-close", onClick: () => setGuidePage(null) }, T("关闭"))
              ),
              h(
                "div",
                { className: "SPR_mapEdGuideTabs" },
                guidePages.map((entry, index) =>
                  h(
                    "button",
                    {
                      key: entry.key,
                      type: "button",
                      className: "SPR_mapEdGuideTab",
                      "data-guide-tab": entry.key,
                      "data-on": index === pageIndex ? "true" : undefined,
                      onClick: () => setGuidePage(index)
                    },
                    entry.label
                  )
                )
              ),
              h(
                "div",
                { className: "SPR_mapEdGuideBody" },
                h(
                  "div",
                  { className: "SPR_mapEdGuideArtWrap" },
                  h(
                    "div",
                    { className: "SPR_mapEdGuideArt", "data-guide-art": page.key, style: { width: `${boxWidth}px` } },
                    h("img", { className: "SPR_mapEdGuideImg", src: art.src, alt: page.label }),
                    // 白线＝一格；金线＝格内再分的小块（只有拼块那张有）。
                    h("div", { className: "SPR_mapEdGuideGrid", style: { backgroundSize: `${cell.width}% ${cell.height}%` } }),
                    art.sub > 0
                      ? h("div", {
                          className: "SPR_mapEdGuideSubGrid",
                          style: { backgroundSize: `${cell.width / art.sub}% ${cell.height / art.sub}%` }
                        })
                      : null
                  ),
                  h("p", { className: "SPR_mapEdGuideCap" }, page.cap({ cols: art.cols, rows: art.rows, cell: art.cell, sub: art.sub }))
                ),
                h(
                  "div",
                  { className: "SPR_mapEdGuideText" },
                  h("h4", { className: "SPR_mapEdGuideTitle" }, page.title),
                  h(
                    "ol",
                    { className: "SPR_mapEdGuideList" },
                    page.points.map((text, index) => h("li", { key: index }, text))
                  ),
                  h("p", { className: "SPR_mapEdGuideNote" }, page.fit),
                  h("p", { className: "SPR_mapEdGuideNote", "data-kind": "warn" }, page.warn)
                )
              ),
              h(
                "div",
                { className: "SPR_mapEdGuideFoot" },
                h(Btn, { "data-testid": "map-guide-prev", disabled: pageIndex === 0, onClick: () => setGuidePage(pageIndex - 1) }, T("上一页")),
                h(Btn, { "data-testid": "map-guide-next", disabled: pageIndex === guidePages.length - 1, onClick: () => setGuidePage(pageIndex + 1) }, T("下一页")),
                h("span", { className: "SPR_mapEdGuidePage" }, T("第 {n0} 页 / 共 {n1} 页", { n0: String(pageIndex + 1), n1: String(guidePages.length) })),
                h("span", { className: "SPR_mapEdSpacer" }),
                h("span", { className: "SPR_mapEdGuidePage" }, T("照着排好图，回到左边选它就行。"))
              )
            )
          );
        })();

  /** 「新增素材」对话框：图片 + 名字 + 属性一次填完，之后只能删。 */
  const addDialog =
    addDraft === null
      ? null
      : h(
          "div",
          { className: "SPR_mapEdDlgMask", "data-testid": "map-add-mask", onClick: () => setAddDraft(null) },
          h(
            "div",
            {
              className: "SPR_mapEdDlg",
              role: "dialog",
              "aria-label": T("新增素材"),
              "data-testid": "map-add-dialog",
              onClick: (event) => {
                if (typeof event.stopPropagation === "function") event.stopPropagation();
              }
            },
            h(
              "div",
              { className: "SPR_mapEdDlgHead" },
              h("div", { className: "SPR_mapEdDlgTitle" }, T("新增素材")),
              // 「这图该怎么排」是这张表里唯一说不清的一件事，所以给它一颗专门的按钮。
              h(Btn, { "data-testid": "map-guide-open", onClick: openGuide }, T("素材说明"))
            ),
            h("div", { className: "SPR_mapEdDlgLabel" }, T("素材图")),
            h(
              "div",
              { className: "SPR_mapEdDlgRow" },
              h(Btn, { onClick: () => addFileRef.current?.click() }, T("选择图片")),
              h("span", { className: "SPR_mapEdHint" }, addDraft.file === null ? T("还没选") : addDraft.file.name)
            ),
            h("div", { className: "SPR_mapEdDlgLabel" }, T("叫什么")),
            h("input", {
              className: "SPR_mapEdDlgInput",
              "data-testid": "map-add-name",
              value: addDraft.name,
              placeholder: T("留空就用文件名"),
              onChange: (event) => setAddDraft((current) => (current === null ? current : { ...current, name: event.target.value }))
            }),
            /**
             * 「格子大小」：整图不需要（它的格子**锁死**为地图网格 —— 一次占 N×M 格，
             * 格子比网格大或小都必然错位），所以选整图时整块隐藏。
             */
            addDraft.shape === "stamp"
              ? null
              : h("div", { className: "SPR_mapEdDlgLabel" }, T("格子大小（留空就自动认）")),
            addDraft.shape === "stamp"
              ? null
              : h(
              "div",
              { className: "SPR_mapEdPair" },
              h(NumField, {
                label: T("宽"),
                value: addDraft.cellW === "" ? "" : Number(addDraft.cellW),
                min: 1,
                max: 1024,
                onChange: (value) => setAddDraft((current) => (current === null ? current : { ...current, cellW: String(value) }))
              }),
              h("span", { className: "SPR_mapEdTimes" }, "×"),
              h(NumField, {
                label: T("高"),
                value: addDraft.cellH === "" ? "" : Number(addDraft.cellH),
                min: 1,
                max: 1024,
                onChange: (value) => setAddDraft((current) => (current === null ? current : { ...current, cellH: String(value) }))
              })
            ),
            h("div", { className: "SPR_mapEdDlgLabel" }, T("这块素材怎么用")),
            segPicker("data-shape", shapeOptions, addDraft.shape, (value) => setAddDraft((current) => (current === null ? current : { ...current, shape: value }))),
            addDraft.shape === "stamp"
              ? null
              : h("div", { className: "SPR_mapEdDlgLabel" }, T("会动吗")),
            addDraft.shape === "stamp"
              ? null
              : segPicker("data-anim", animOptions, addDraft.animRows ? "rows" : "off", (value) => setAddDraft((current) => (current === null ? current : { ...current, animRows: value === "rows" }))),
            /**
             * 「清晰度」：**只有图比格子大时才显示**（AI 生成的那条路会带 `scale` 进来）。
             *
             * 它在「确定」那一刻生效 —— 宿主按这里选的算法把图缩到地图格子。图本来就是
             * 格子大小（自己导的 32px 素材）时这块不出现，免得用户以为改了个没用的开关。
             */
            /**
             * 整图专属：占几格 / 帧数 / **每格通行性**。
             *
             * 区域格子的数量跟着「占几格」走（`cols × rows`），点一下循环三态；
             * 另有「全部不可通过 / 全部可通过」两键 —— 雕像这种大部分不可走的图
             * 一格一格点太累（整块 3×3 只有底座要改）。
             */
            addDraft.shape === "stamp"
              ? h(
                  "div",
                  { "data-testid": "map-add-stamp" },
                  h("div", { className: "SPR_mapEdDlgLabel" }, T("占几格（一整张图印满这么多格）")),
                  h(
                    "div",
                    { className: "SPR_mapEdPair" },
                    h(NumField, {
                      label: T("宽"),
                      value: Number(addDraft.stampCols) || 3,
                      min: 1,
                      max: mapLimits.maxCols,
                      onChange: (value) => setAddDraft((current) => resizeStampPass(current, value, undefined))
                    }),
                    h("span", { className: "SPR_mapEdTimes" }, "×"),
                    h(NumField, {
                      label: T("高"),
                      value: Number(addDraft.stampRows) || 3,
                      min: 1,
                      max: mapLimits.maxRows,
                      onChange: (value) => setAddDraft((current) => resizeStampPass(current, undefined, value))
                    })
                  ),
                  h("div", { className: "SPR_mapEdDlgLabel" }, T("帧数（一整张图会动的话，每帧一张）")),
                  h(NumField, {
                    label: T("帧数"),
                    value: Number(addDraft.stampFrames) || 1,
                    min: 1,
                    max: 16,
                    onChange: (value) =>
                      setAddDraft((current) => (current === null ? current : { ...current, stampFrames: String(Math.max(1, Math.min(16, Math.round(value) || 1))) }))
                  }),
                  h("div", { className: "SPR_mapEdDlgLabel" }, T("背景")),
                  h(
                    "label",
                    { className: "SPR_mapEdCheck" },
                    h("input", {
                      type: "checkbox",
                      "data-testid": "map-add-stamp-key",
                      checked: addDraft.stampKey !== false,
                      onChange: (event) => setAddDraft((current) => (current === null ? current : { ...current, stampKey: event.target.checked }))
                    }),
                    T("抠掉绿幕背景（只留建筑本体）")
                  ),
                  h(
                    "p",
                    { className: "SPR_mapEdHint" },
                    T("整图是「立在格子上的物件」：背景该是透明的，不然地图上会多出一块绿框。AI 生成的图请在提示词里要**纯绿背景**，这里勾上就会自动抠掉；自己导的透明 PNG 也可以勾着（没有绿就什么都不做）。")
                  ),
                  stampPassGrid({
                    cols: clampStampSpan(Number(addDraft.stampCols) || 3, mapLimits.maxCols),
                    rows: clampStampSpan(Number(addDraft.stampRows) || 3, mapLimits.maxRows),
                    frames: Number(addDraft.stampFrames) || 1,
                    pass: addDraft.stampPass,
                    image: stampPreviewUrl,
                    prefix: "map-add",
                    onChange: (update) =>
                      setAddDraft((current) =>
                        current === null
                          ? current
                          : { ...current, stampPass: typeof update === "function" ? update(current.stampPass) : update }
                      )
                  })
                )
              : null,
            /**
             * 「循环方式」：跟「动画速度」一样，**只有会动的素材才显示**。
             * 静态素材显示它只会让人以为自己设了动画。
             */
            addDraft.animRows === true || addDraft.shape === "a2quad" || (addDraft.shape === "stamp" && (Number(addDraft.stampFrames) || 1) > 1)
              ? h(
                  "div",
                  null,
                  h("div", { className: "SPR_mapEdDlgLabel" }, T("循环方式")),
                  segPicker("data-loop", loopOptions, addDraft.loop === undefined ? "forward" : addDraft.loop, (value) =>
                    setAddDraft((current) => (current === null ? current : { ...current, loop: value }))
                  )
                )
              : null,
            (addDraft.scale === undefined ? 1 : addDraft.scale) > 1
              ? h(
                  "div",
                  null,
                  h("div", { className: "SPR_mapEdDlgLabel" }, T("清晰度")),
                  segPicker("data-clarity", clarityOptions, addDraft.clarity === undefined ? "smooth" : addDraft.clarity, (value) =>
                    setAddDraft((current) => (current === null ? current : { ...current, clarity: value }))
                  ),
                  h(
                    "p",
                    { className: "SPR_mapEdHint" },
                    T("这张图每格 {n0}px（{n1} 倍分辨率），点「确定」时会按上面的方式缩到 {n2}px 一格 —— 选哪种缩法，出来的细节差挺多。", {
                      n0: String((addDraft.scale === undefined ? 1 : addDraft.scale) * (Number(addDraft.cellW) || 32)),
                      n1: String(addDraft.scale === undefined ? 1 : addDraft.scale),
                      n2: String(Number(addDraft.cellW) || 32)
                    })
                  )
                )
              : null,
            /**
             * 「动画速度」：**会动的素材才显示**（拼块的变体就是帧，所以拼块也要显示；
             * 普通形态得勾了「翻页图」才算会动）。静态素材显示它只会让人以为没生效。
             */
            /**
             * 整图的帧数 > 1 时它**也会动**（整张图同步播同一帧），所以速度 / 循环方式也要给 ——
             * 少了这两项就只剩「按全局速度放」，用户会以为整图不能调速度（真机反馈过）。
             */
            addDraft.animRows === true || addDraft.shape === "a2quad" || (addDraft.shape === "stamp" && (Number(addDraft.stampFrames) || 1) > 1)
              ? h(
                  "div",
                  null,
                  h("div", { className: "SPR_mapEdDlgLabel" }, T("动画速度")),
                  h(
                    "select",
                    {
                      className: "SPR_mapEdSelect",
                      "data-testid": "map-add-fps",
                      value: addDraft.fps === undefined ? "" : addDraft.fps,
                      onChange: (event) => setAddDraft((current) => (current === null ? current : { ...current, fps: event.target.value }))
                    },
                    fpsOptions.map(([value, label, , desc]) =>
                      h("option", { key: value === "" ? "global" : value, value, title: desc }, label)
                    )
                  ),
                  h(
                    "p",
                    { className: "SPR_mapEdHint" },
                    addDraft.fps === undefined || addDraft.fps === ""
                      ? T("这块素材跟「设置」里的动画速度走（慢 / 中 / 快）。想让它自己一个速度，就在上面选一个 —— 同一张地图上不同的素材可以各走各的。")
                      : T("这块素材自己按 {n0} 帧/秒 播放，不受「设置」里的动画速度影响。", { n0: String(addDraft.fps) })
                  )
                )
              : null,
            h(
              "div",
              { className: "SPR_mapEdDlgRow SPR_mapEdDlgActions", "data-testid": "map-add-actions" },
              h(Btn, { "data-testid": "map-add-cancel", onClick: () => setAddDraft(null) }, T("取消")),
              h(Btn, { "data-testid": "map-add-ok", primary: true, busy: busyKey === "upload", onClick: () => void submitAddTileset() }, T("确定"))
            )
          )
        );

  // ── 「AI 生成素材」：不自己生成，开一个新对话把活派出去 ──────────────────
  //
  // 用户填的只有五件事：提示词、名字、动画帧数、动画生成方式、这块素材怎么用。
  // 点「生成」后：建一个**不挂靠项目**的新对话 → 切到对话界面 → 把拼好的需求发进去。
  // 生成完成由对话里的 agent 负责，它会把 `composeMapAsset` 返回的 openUrl 贴出来；
  // 用户点那条链接回来时，这里再把图与「这块素材怎么用」一起预填进「新增素材」。
  const aiModeOptions = [
    ["image", T("生图模型"), T("生图模型"), T("用生图模型出图：帧数为 1 时出一张静态图；大于 1 时按同一个提示词出多张（动作连贯性不如视频模型）。")],
    ["video", T("视频模型"), T("视频模型"), T("先出一张静态首帧图，再让它动起来并按帧抽出来：动作连贯，但比生图模型多一次计费。")]
  ];
  /**
   * 「这块素材怎么用」：默认**自动判断**（由对话里的 agent 按提示词里的判据定），
   * 也可以在这里替它拍板 —— 形态决定「生图前怎么排布」和「生成后怎么规整」，
   * 判错了那一版图就得重花钱，所以留一个能提前改的口子。
   */
  const aiShapeOptions = [
    ["auto", T("自动判断"), T("自动判断"), T("让对话里的 agent 看提示词自己定：成片铺开（草地 / 水面 / 岩浆）→ 拼块；连成一条（墙 / 路 / 栅栏）→ 整格；单独摆（树 / 箱子 / 道具）→ 普通。")],
    ["plain", T("普通"), T("普通图块"), T("一块一块单独摆、不跟邻居接：树 / 箱子 / 道具 / 装饰。每张图 = 一格内容；帧数 > 1 时竖排成翻页图。")],
    ["corner16", T("整格"), T("整格自动连接"), T("要连成一条、拐角要对上：墙 / 路 / 栅栏 / 桥。生成一张 4×4 共 16 块的图，按「上1 右2 下4 左8」的位序画 16 种接法；没有动画（帧数按 1 处理）。")],
    ["a2quad", T("拼块"), T("拼块自动连接"), T("成片铺开、边缘自动接上：草地 / 水面 / 沙地 / 岩浆。每张图 = 一列 5 行（自上而下 5 种接法），帧数 = 变体数（拼块的动画就是换变体）。")],
    ["stamp", T("整图"), T("整图（一张画占好几格）"), T("多格建筑 / 装饰：雕像、壁画、喷泉、大门、地毯。每张图 = 一整张完整的画（不要分格），插件按「占几格」切成格子；哪些格能走导入时你自己点。")]
  ];

  const openAiAsset = () =>
    setAiDraft({
      prompt: "",
      name: "",
      frames: 1,
      mode: "image",
      shape: "auto",
      // 整图：占几格（只有选「整图」时才用得上；默认 3×3 是雕像 / 大门最常见的尺寸）。
      stampCols: "3",
      stampRows: "3"
    });

  /** 把草稿交给 `openAssetChat`：建会话 + 发提示词。失败时对话框留着，用户能重试。 */
  const submitAiAsset = async () => {
    const draft = aiDraft;
    if (draft === null || api === undefined) return;
    const prompt = draft.prompt.trim();
    if (prompt === "") {
      setNotice({ kind: "error", text: T("先写一段提示词。") });
      return;
    }
    // 帧数为 1 只用生图模型（视频模型那条路本来也要求帧数大于 1）；整格没有帧这一维。
    const shape = ASSET_SHAPES.includes(draft.shape) ? draft.shape : "auto";
    const stampCols = Math.max(1, Math.min(512, Math.round(Number(draft.stampCols) || 3)));
    const stampRows = Math.max(1, Math.min(512, Math.round(Number(draft.stampRows) || 3)));
    const frames = shape === "corner16" ? ASSET_FRAMES_MIN : Math.min(ASSET_FRAMES_MAX, Math.max(ASSET_FRAMES_MIN, Math.round(Number(draft.frames) || 1)));
    const mode = frames <= 1 ? "image" : draft.mode === "video" ? "video" : "image";
    // 派活要用到的模块被「功能管理」隐藏了就直说：对话里的工具面同样会拒绝，白跑一趟。
    if (hiddenModules.includes("image")) {
      setNotice({ kind: "error", text: T("「图片生成」被隐藏了，去「设置 → 墨盒 → 功能管理」打开再试。") });
      return;
    }
    if (mode === "video" && hiddenModules.includes("sequence")) {
      setNotice({ kind: "error", text: T("「序列帧生成」被隐藏了，去「设置 → 墨盒 → 功能管理」打开再试。") });
      return;
    }
    setAiBusy(true);
    try {
      const projectId = await ensureProject();
      if (projectId === null) return;
      const loaded = await api.getMapProject({ projectId, lang: activeLang() });
      const grid = (loaded !== null && loaded !== undefined && loaded.grid) || { tileWidth: 32, tileHeight: 32 };
      const name = draft.name.trim() === "" ? deriveAssetName(prompt) : draft.name.trim();
      const text = buildAssetRequestPrompt({
        projectId,
        projectName: (loaded !== null && loaded !== undefined && loaded.name) || "",
        cell: { width: grid.tileWidth, height: grid.tileHeight },
        name,
        prompt,
        frames,
        mode,
        shape,
        ...(shape === "stamp" ? { stampCols, stampRows } : {})
      });
      await openAssetChat(text);
      setAiDraft(null);
      setNotice({
        kind: "info",
        text:
          shape === "auto"
            ? T("已在新对话里开始生成：素材「{n0}」（用哪种由对话判断）", { n0: name })
            : T("已在新对话里开始生成：素材「{n0}」（{n1}）", { n0: name, n1: assetShapeLabel(shape) })
      });
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setAiBusy(false);
    }
  };

  const aiDialog =
    aiDraft === null
      ? null
      : h(
          "div",
          { className: "SPR_mapEdDlgMask", "data-testid": "map-ai-mask", onClick: () => (aiBusy ? undefined : setAiDraft(null)) },
          h(
            "div",
            {
              className: "SPR_mapEdDlg",
              role: "dialog",
              "aria-label": T("AI 生成素材"),
              "data-testid": "map-ai-dialog",
              onClick: (event) => {
                if (typeof event.stopPropagation === "function") event.stopPropagation();
              }
            },
            h("div", { className: "SPR_mapEdDlgHead" }, h("div", { className: "SPR_mapEdDlgTitle" }, T("AI 生成素材"))),
            h(
              "p",
              { className: "SPR_mapEdHint" },
              T("说明一句：它会开一个新对话，让对话里的 agent 按这段需求去生成；做完贴一条链接，点回来这张图就已经填在「新增素材」里了。")
            ),
            h("div", { className: "SPR_mapEdDlgLabel" }, T("提示词")),
            h("textarea", {
              className: "SPR_mapEdDlgInput",
              "data-testid": "map-ai-prompt",
              rows: 4,
              value: aiDraft.prompt,
              placeholder: T("想要什么素材？例如「一片冰蓝色的水面，波纹缓慢起伏」"),
              onChange: (event) => setAiDraft((current) => (current === null ? current : { ...current, prompt: event.target.value }))
            }),
            h("div", { className: "SPR_mapEdDlgLabel" }, T("素材名字")),
            h("input", {
              className: "SPR_mapEdDlgInput",
              "data-testid": "map-ai-name",
              value: aiDraft.name,
              placeholder: T("留空就用提示词开头几个字"),
              onChange: (event) => setAiDraft((current) => (current === null ? current : { ...current, name: event.target.value }))
            }),
            h("div", { className: "SPR_mapEdDlgLabel" }, T("动画帧数（1 = 静态）")),
            h(
              "div",
              { className: "SPR_mapEdPair" },
              h(NumField, {
                label: T("帧"),
                value: aiDraft.frames,
                min: ASSET_FRAMES_MIN,
                max: ASSET_FRAMES_MAX,
                // 整格没有帧这一维：字段直接灰掉，别让用户以为设了就会动。
                disabled: aiDraft.shape === "corner16",
                // 帧数掉回 1 时把方式也拉回生图模型：帧数为 1 只有生图模型这条路。
                onChange: (value) => setAiDraft((current) => (current === null ? current : { ...current, frames: value, mode: value <= 1 ? "image" : current.mode }))
              })
            ),
            h("div", { className: "SPR_mapEdDlgLabel" }, T("动画生成方式")),
            segPicker("data-ai-mode", aiModeOptions, aiDraft.mode, (value) =>
              setAiDraft((current) => {
                if (current === null) return current;
                // 帧数为 1 时视频模型那格点不动（帧数为 1 只用生图模型）。
                if (value === "video" && current.frames <= 1) return current;
                // 整格没有动画：视频模型也点不动（出来还是一张静态图，白多一次计费）。
                if (value === "video" && current.shape === "corner16") return current;
                return { ...current, mode: value };
              })
            ),
            h(
              "p",
              { className: "SPR_mapEdHint" },
              aiDraft.shape === "corner16"
                ? T("整格没有动画，帧数固定 1、生成方式固定生图模型（设了也不会动，只是白多一次计费）。想要会动的自动连接素材，把「这块素材怎么用」改成「拼块」。")
                : aiDraft.frames <= 1
                  ? T("帧数为 1 时只用生图模型：出一张静态素材。想要会动的，把帧数改成大于 1。")
                  : aiDraft.mode === "video"
                    ? T("视频模型：先出一张静态首帧，再让它动起来并抽出这些帧。比生图模型多一次计费，但动作连贯。")
                    : T("生图模型：按同一个提示词出多张图。动作没有视频模型连贯，但更省。")
            ),
            h("div", { className: "SPR_mapEdDlgLabel" }, T("这块素材怎么用")),
            segPicker("data-ai-shape", aiShapeOptions, aiDraft.shape, (value) =>
              setAiDraft((current) => {
                if (current === null) return current;
                /**
                 * 整格没有「帧」这一维（4×4 全是接法，动画行也是接法行）：
                 * 一选整格就把帧数与生成方式拉回静态，别让用户配出一个**做不到**的组合
                 * —— 真机踩过：选了视频模型 + 8 帧，结果出来的还是静态图，而且没人告诉他。
                 */
                if (value === "corner16") return { ...current, shape: value, frames: ASSET_FRAMES_MIN, mode: "image" };
                return { ...current, shape: value };
              })
            ),
            aiDraft.shape === "stamp"
              ? h(
                  "div",
                  { "data-testid": "map-ai-stamp" },
                  h("div", { className: "SPR_mapEdLblSmall" }, T("占几格")),
                  h(
                    "div",
                    { className: "SPR_mapEdPair" },
                    h(NumField, {
                      label: T("宽"),
                      value: Number(aiDraft.stampCols) || 3,
                      min: 1,
                      max: 512,
                      onChange: (value) => setAiDraft((current) => (current === null ? current : { ...current, stampCols: String(Math.max(1, Math.min(512, Math.round(value) || 3))) }))
                    }),
                    h("span", { className: "SPR_mapEdTimes" }, "×"),
                    h(NumField, {
                      label: T("高"),
                      value: Number(aiDraft.stampRows) || 3,
                      min: 1,
                      max: 512,
                      onChange: (value) => setAiDraft((current) => (current === null ? current : { ...current, stampRows: String(Math.max(1, Math.min(512, Math.round(value) || 3))) }))
                    })
                  )
                )
              : null,
            h(
              "p",
              { className: "SPR_mapEdHint" },
              aiDraft.shape === "stamp"
                ? T("整图：让模型画**一整张**画（不要分格），插件按「占几格」把它切成 N×M 格，印到地图上一次占这么多格。帧数 > 1 时每帧都是一整张画。哪些格能走（地毯 / 雕像上身）在导入时由你自己点。")
                : aiDraft.shape === "auto"
                ? T("由对话里的 agent 看提示词自己定：成片铺开（草地 / 水面 / 岩浆）→ 拼块；连成一条（墙 / 路 / 栅栏）→ 整格；单独摆（树 / 箱子 / 道具）→ 普通；一整栋多格建筑（雕像 / 壁画 / 大门）→ 整图。它会在生图前把排布规划好，生成后按这个规则切成地图能用的图。")
                : aiDraft.shape === "corner16"
                  ? T("整格：只让模型画**一块**无缝墙砖（四边都能接上自己），插件用同一块砖拼出 16 种接法、断口由它加收口 —— 不要让它画 16 个各自独立的格子，那样拼到地图上全是缝。⚠️ 整格**没有动画**（它就是 16 种接法），所以帧数与生成方式锁在静态；想要「会动的自动连接」素材，把用法改成「拼块」——拼块的帧数就是变体，动画靠换变体。")
                  : aiDraft.shape === "a2quad"
                    ? T("拼块：每个变体只让模型画**一块**无缝材质（四边都能接上自己），插件拼成 N 列 × 5 行（N = 帧数）。帧数大于 1 时地图上按变体循环播放 —— 这是三种用法里唯一「既自动连接、又会动」的。")
                    : T("普通：每张图 = 一格内容；帧数大于 1 时竖排成翻页图（地图上逐帧播放）。")
            ),
            h(
              "div",
              { className: "SPR_mapEdDlgRow" },
              h(Btn, { "data-testid": "map-ai-cancel", onClick: () => (aiBusy ? undefined : setAiDraft(null)) }, T("取消")),
              h(Btn, { "data-testid": "map-ai-ok", primary: true, busy: aiBusy, onClick: () => void submitAiAsset() }, T("生成"))
            )
          )
        );

  const removeTilesetById = async (tilesetId, tilesetName) => {
    if (view === null || api === undefined) return;
    // eslint-disable-next-line no-alert
    if (typeof window !== "undefined" && !window.confirm(T("确定删除素材「{n0}」？它切出来的块会一起删掉，无法撤销。", { n0: tilesetName }))) return;
    const result = await withApi(() => api.removeMapTileset({ projectId: view.id, tilesetId }), { notice: T("已删除素材") });
    if (result === undefined) return;
    await loadProject(view.id, true);
  };

  /**
   * 「素材属性」窗口：点素材列表里的一行就打开。
   *
   * 放开的是**不动几何 / 不动图块序号**的属性：名字 / 播放速度 / 循环方式 / 整图的逐格通行区域。
   * 这几样改完，地图上已经画好的格子不受影响（整图的新区域下一次 `mapPlan` 就生效）。
   * 形态 / 格子尺寸仍然一次定死（那会重切图块、把画过的格子整体错位）。
   */
  const [tsEdit, setTsEdit] = React.useState(null);
  const openTilesetEditor = (entry) => {
    const stamp = entry.stamp;
    setTsEdit({
      tilesetId: entry.id,
      name: entry.name,
      // `undefined` = 跟全局速度（下拉里用空串表示）。
      fps: entry.fps === undefined ? "" : String(entry.fps),
      loop: entry.loop === undefined ? "forward" : entry.loop,
      animated: frameCountOf(entry) > 0,
      builtin: entry.builtin === true,
      // 素材图 + 版本号：整图的区域编辑要在**真素材图**上点格子。
      file: entry.file,
      rev: entry.rev,
      /**
       * 仅整图：占几格 / 几帧 / 每格通行区域。
       * `undefined` = 这不是整图，窗口里不出现「哪些格子能走」。
       */
      stampCols: stamp === undefined ? undefined : stamp.cols,
      stampRows: stamp === undefined ? undefined : stamp.rows,
      stampFrames: stamp === undefined ? 1 : stamp.frames,
      stampPass:
        stamp === undefined
          ? undefined
          : Array.isArray(stamp.pass) && stamp.pass.length === stamp.cols * stamp.rows
            ? [...stamp.pass]
            : new Array(stamp.cols * stamp.rows).fill(0)
    });
  };
  const saveTilesetEditor = async () => {
    if (tsEdit === null || api === undefined || view === null) return;
    setBusyKey("tileset");
    try {
      const name = tsEdit.name.trim() === "" ? undefined : tsEdit.name.trim();
      const result = await api.saveMapTileset({
        projectId: view.id,
        tilesetId: tsEdit.tilesetId,
        name,
        // 空串 = 清掉自己的速度，回到跟「设置」里的动画速度走。
        fps: tsEdit.fps === "" ? null : Number(tsEdit.fps),
        loop: tsEdit.loop,
        // 仅整图：逐格通行区域（不动几何 / 序号，已经印在地图上的整图下一次就生效）。
        stampPass: tsEdit.stampCols === undefined ? undefined : tsEdit.stampPass
      });
      if (result !== undefined && Array.isArray(result.warnings) && result.warnings.length > 0) {
        setNotice({ kind: "info", text: result.warnings.join("；") });
      } else {
        setNotice({ kind: "info", text: T("已保存素材属性") });
      }
      setTsEdit(null);
      await loadProject(view.id, true);
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setBusyKey(null);
    }
  };

  /** 一键恢复默认素材：把缺的内置素材补回来（已有的同名会跳过，不会变成两份）。 */
  const restoreSamples = async () => {
    if (api === undefined) return;
    setBusyKey("sample");
    try {
      const projectId = await ensureProject();
      if (projectId === null) return;
      const restored = await api.importSampleTileset({ projectId });
      const added = Array.isArray(restored?.tilesets) ? restored.tilesets.length : 0;
      setNotice({ kind: "info", text: added > 0 ? T("已恢复 {n0} 张默认素材", { n0: String(added) }) : T("默认素材都在。") });
      await loadProject(projectId, true);
      const list = await api.listMapProjects();
      setProjects(list.projects || []);
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setBusyKey(null);
    }
  };

  /**
   * 新建 / 重命名项目：**自己弹一个窗口**，不用 `window.prompt`。
   *
   * ⚠️ 真机踩过：DSH 桌面端是 Electron，而 Electron **不实现 `window.prompt`**
   * （函数在、调用直接抛错）。原来「新建项目」点了什么都不发生，就是因为名字拿不到 ——
   * 而且 `typeof window.prompt === "function"` 这个判断完全看不出来。
   * 所以这里改成本地渲染的对话框：输入框 + 取消 / 确定，回车确认、Esc 取消。
   */
  const [nameAsk, setNameAsk] = React.useState(null);
  /**
   * 新建项目时的「一格多大」：**这一下就定了**，之后不能改（改了整个项目的素材都要重切）。
   *
   * 为什么要它：AI 生成的图是 2K 的，32px 一格时细节必然被压扁；48 / 64 一格能留下更多细节，
   * 代价是同样屏幕大小里能放的地图格数变少。默认 32（和以前一致）。
   */
  const [newGridCell, setNewGridCell] = React.useState(32);
  const askProjectName = (mode) =>
    setNameAsk({
      mode,
      title: mode === "create" ? T("新建项目") : T("重命名项目"),
      label: mode === "create" ? T("新项目的名字") : T("新的项目名"),
      value: mode === "create" ? T("我的地图") : view === null ? "" : view.name
    });
  const submitNameAsk = async () => {
    const ask = nameAsk;
    if (ask === null) return;
    const trimmed = String(ask.value).trim();
    // 新建：空名用默认名（用户的意图是「建一个」，不该被空字符串卡住）；
    // 重命名：空名等于没改，直接关掉。
    if (ask.mode === "rename" && trimmed === "") {
      setNameAsk(null);
      return;
    }
    setNameAsk(null);
    if (ask.mode === "create") await createProject(trimmed === "" ? T("我的地图") : trimmed, newGridCell);
    else await renameProject(trimmed);
  };

  /** 名字对话框。`position:fixed` 居中，不用原生 prompt / confirm。 */
  const nameDialog =
    nameAsk === null
      ? null
      : h(
          "div",
          { className: "SPR_mapEdDlgMask", "data-testid": "map-name-mask", onClick: () => setNameAsk(null) },
          h(
            "div",
            {
              className: "SPR_mapEdDlg",
              role: "dialog",
              "aria-label": nameAsk.title,
              "data-testid": "map-name-dialog",
              onClick: (event) => {
                if (typeof event.stopPropagation === "function") event.stopPropagation();
              }
            },
            h("div", { className: "SPR_mapEdDlgTitle" }, nameAsk.title),
            h("label", { className: "SPR_mapEdDlgLabel" }, nameAsk.label),
            h("input", {
              className: "SPR_mapEdDlgInput",
              "data-testid": "map-name-input",
              value: nameAsk.value,
              autoFocus: true,
              onChange: (event) =>
                setNameAsk((current) => (current === null ? current : { ...current, value: event.target.value })),
              onKeyDown: (event) => {
                if (event.key === "Enter") {
                  if (typeof event.preventDefault === "function") event.preventDefault();
                  void submitNameAsk();
                } else if (event.key === "Escape") {
                  setNameAsk(null);
                }
              }
            }),
            /**
             * 「一格多大」只对**新建**有意义：格子是项目级的，建完就不能改（改了整个项目的
             * 素材都要重切）。所以重命名那条路不显示它。
             */
            nameAsk.mode === "create"
              ? h(
                  "div",
                  null,
                  h("label", { className: "SPR_mapEdDlgLabel" }, T("一格多大")),
                  h(
                    "select",
                    {
                      className: "SPR_mapEdSelect",
                      "data-testid": "map-create-grid",
                      value: String(newGridCell),
                      onChange: (event) => setNewGridCell(Number(event.target.value) || 32)
                    },
                    [16, 32, 48, 64].map((size) => h("option", { key: size, value: String(size) }, T("{n0}×{n0} 像素", { n0: String(size) })))
                  ),
                  h(
                    "p",
                    { className: "SPR_mapEdHint" },
                    T("这一下就定了、之后不能改。想让 AI 生成的素材更清楚就用 48 / 64（一格能留下更多细节），代价是同样屏幕上能放的地图格数变少。")
                  )
                )
              : null,
            h(
              "div",
              { className: "SPR_mapEdDlgRow" },
              h(Btn, { "data-testid": "map-name-cancel", onClick: () => setNameAsk(null) }, T("取消")),
              h(Btn, { "data-testid": "map-name-ok", primary: true, onClick: () => void submitNameAsk() }, T("确定"))
            )
          )
        );

  const removeTileset = async () => {
    if (view === null || tileset === null || api === undefined) return;
    // eslint-disable-next-line no-alert
    if (typeof window !== "undefined" && !window.confirm(T("确定删除素材「{n0}」？它切出来的块会一起删掉，无法撤销。", { n0: tileset.name }))) return;
    const result = await withApi(() => api.removeMapTileset({ projectId: view.id, tilesetId: tileset.id }), { notice: T("已删除素材") });
    if (result === undefined) return;
    await loadProject(view.id);
  };

  /**
   * 新建项目。**建完就把内置素材装进列表**（用户要求：内置素材默认在素材列表里）——
   * 装的是本机现算的那套，零成本；同名已存在会跳过。
   */
  const createProject = async (name, gridCell = 32) => {
    if (api === undefined) return;
    const cell = Math.max(8, Math.min(128, Math.round(Number(gridCell) || 32)));
    const created = await withApi(() => api.createMapProject({ name, cols: 32, rows: 32, grid: { tileWidth: cell, tileHeight: cell, wrap: true } }));
    if (created === undefined) return;
    await ensureTwoLayers(created.id);
    const result = await api.listMapProjects();
    setProjects(result.projects || []);
    await loadProject(created.id);
    // 新项目默认就带上内置素材（同名会跳过），装完再刷一次列表
    await api.importSampleTileset({ projectId: created.id }).catch(() => undefined);
    await loadProject(created.id, true);
    setOpenCard("assets");
  };

  const renameProject = async (name) => {
    if (view === null || api === undefined) return;
    const ok = await withApi(() => api.saveMapProject({ projectId: view.id, name }), { notice: T("已重命名") });
    if (ok === undefined) return;
    await loadProject(view.id, true);
  };

  const deleteProject = async () => {
    if (view === null || api === undefined) return;
    // eslint-disable-next-line no-alert
    if (typeof window !== "undefined" && !window.confirm(T("确定删除项目「{n0}」？项目目录会被整个移除，无法撤销。", { n0: view.name }))) return;
    const done = await withApi(() => api.deleteMapProject({ projectId: view.id }), { notice: T("已删除项目") });
    if (done === undefined) return;
    const result = await api.listMapProjects();
    const rest = result.projects || [];
    setProjects(rest);
    if (rest.length > 0) await loadProject(rest[0].id);
    else {
      clearPlan();
      setView(null);
    }
  };

  const saveDoc = async (patch, note) => {
    if (view === null || api === undefined) return undefined;
    const result = await withApi(() => api.saveMapDoc({ projectId: view.id, ...patch }), note === undefined ? undefined : { notice: note });
    if (result === undefined) return undefined;
    const warnings = result.warnings;
    if (Array.isArray(warnings) && warnings.length > 0) setNotice({ kind: "info", text: warnings.join("；") });
    await loadProject(view.id, true);
    return result;
  };

  /**
   * 改地图尺寸：**宽高各自独立**（不再只给正方形）。
   *
   * 上限 512 与宿主 `MAX_MAP_DIM` 一致：超了宿主会拒绝并给出原因，这里先挡一道。
   */
  const applyMapSize = async (cols, rows) => {
    if (view === null) return;
    const nextCols = Math.round(Number(cols));
    const nextRows = Math.round(Number(rows));
    if (!Number.isFinite(nextCols) || !Number.isFinite(nextRows) || nextCols < 1 || nextRows < 1) {
      setNotice({ kind: "error", text: T("地图大小要是 1 以上的整数。") });
      return;
    }
    if (nextCols > 512 || nextRows > 512) {
      setNotice({ kind: "error", text: T("地图最大 512×512 格。") });
      return;
    }
    if (nextCols === view.cols && nextRows === view.rows) return;
    const shrinking = nextCols < view.cols || nextRows < view.rows;
    // eslint-disable-next-line no-alert
    if (shrinking === true && typeof window !== "undefined" && !window.confirm(T("改小地图会丢掉范围外的格子（可以撤销）。继续？"))) return;
    await saveDoc({ cols: nextCols, rows: nextRows }, T("已改地图尺寸"));
  };

  const clearLayer = async () => {
    if (view === null || activeLayer === null) return;
    // eslint-disable-next-line no-alert
    if (typeof window !== "undefined" && !window.confirm(T("清掉这一层上已经画的格子？"))) return;
    await saveDoc({ clearLayerId: activeLayer.id }, T("已清空这一层"));
  };

  // ── 标记点：放 / 改名 / 挪走 / 删掉 ──────────────────────────────────
  /**
   * 标记改动走的是**和画笔同一条 op 通道**：撤销栈、脏块（`dropKeys`）全是现成的，
   * 界面不需要自己算「这一下让哪几块失效」。
   *
   * `refresh`：增删会改变编号（删掉第 2 个，第 3 个就变成第 2 个），所以要把视图
   * 重读一遍让列表跟上；拖动挪位置不影响编号，拖完再读一次就够。
   */
  const markerOp = async (op, refresh) => {
    if (api === undefined || viewId === null) return;
    try {
      applyResult(await api.applyMapOps({ projectId: viewId, ops: [op], have: [...planRef.current.keys()] }));
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
      return;
    }
    if (refresh === true) await loadProject(viewId, true);
  };

  /** 这一格的标记（没有就 undefined）。格号是**规范坐标**，与命中测试同一套。 */
  const markerAtCell = (r, c) => {
    const list = view === null || view.markers === undefined ? [] : view.markers;
    return list.find((marker) => marker.r === r && marker.c === c);
  };

  /** 把视图挪到某一格（标记列表里的「定位」）。用允许复刻的那份坐标函数，不新算几何。 */
  const centerOnCell = (r, c) => {
    if (layout === null) return;
    const topLeft = MAP_cellTopLeft(layout, r, c, layout.grid.tileWidth, layout.grid.tileHeight);
    const center = { x: topLeft.x + layout.grid.tileWidth / 2, y: topLeft.y + layout.grid.tileHeight / 2 };
    setPan(clampPan({ x: center.x - viewport.w / (2 * zoom), y: center.y - viewport.h / (2 * zoom) }));
  };

  /** 图层改名：空名字**本地就拦住**（宿主对空名字是静默 no-op，会让人以为改成功了）。 */
  const commitLayerName = async (id, value) => {
    setLayerDraft(null);
    const name = String(value ?? "").trim();
    if (name === "") {
      setNotice({ kind: "error", text: T("图层名字不能为空") });
      return;
    }
    const current = layers.find((layer) => layer.id === id);
    if (current !== undefined && current.name === name) return;
    await saveDoc({ layers: [{ id, name }] }, T("已重命名这一层"));
  };

  /** 标记改名：空名字是合法的（界面按「标记 N」显示）。 */
  const commitMarkerName = async (id, value) => {
    setMarkerDraft(null);
    await markerOp({ kind: "marker", op: "rename", id, name: String(value ?? "") }, true);
  };

  const runGenerate = async () => {
    if (view === null || api === undefined) return;
    const tiles = multi.length > 0 ? multi : brush === null ? [] : [brush.index];
    if (tiles.length === 0) {
      setNotice({ kind: "error", text: T("先选至少一块图：在左边点一下，按住 Shift 或 Ctrl 可以多选。") });
      return;
    }
    setBusyKey("gen");
    try {
      const result = await api.runMapGenerate({
        projectId: view.id,
        kind: genKind,
        tiles,
        seed: genSeed,
        layerId: activeLayer === null ? undefined : activeLayer.id
      });
      if (result !== undefined && Number.isFinite(Number(result.seed)) && Number(result.seed) !== genSeed) {
        setGenSeed(Number(result.seed));
      }
      if (result !== undefined && Array.isArray(result.warnings) && result.warnings.length > 0) {
        setNotice({ kind: "info", text: result.warnings.join("；") });
      }
      // 一次生成可能动到整张图：计划整份作废，重新问宿主
      clearPlan();
      setPlanEpoch((value) => value + 1);
      } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setBusyKey(null);
    }
  };

  /**
   * 导出：**按当前勾选导一次**。
   *
   * 打不打 zip 由宿主决定（产物超过一个就自动打），界面不自己判断 ——
   * 「几个文件算多」只有一处口径，免得界面显示的和盘上的对不上。
   */
  const runExport = async () => {
    if (view === null || api === undefined) return;
    if (exportFormats.png !== true && exportFormats.json !== true && exportFormats.tilesets !== true) {
      setNotice({ kind: "error", text: T("至少勾一项要导出的内容。") });
      return;
    }
    setBusyKey("export");
    try {
      const started = await api.runMapExport({
        projectId: view.id,
        scale: exportScale,
        formats: { png: exportFormats.png === true, json: exportFormats.json === true, tilesets: exportFormats.tilesets === true }
      });
      if (started !== undefined && started.started !== true && typeof started.reason === "string") {
        setNotice({ kind: "info", text: started.reason });
      }
      await loadProject(view.id, true);
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setBusyKey(null);
    }
  };

  /** 导出产物的可点 URL（同源静态路由；zip 与单文件走同一条）。 */
  const exportUrlOf = (file) => `${assetBase}${view.exportBase}${file}`;
  /** `download` 属性要的是文件名，不是路径（`tilesets/x.png` 直接写上去浏览器会当非法文件名）。 */
  const baseNameOf = (file) => String(file).split("/").pop() ?? file;
  const isZip = (file) => /\.zip$/i.test(String(file));

  /**
   * 「另存为…」：浏览器原生的保存位置选择框（File System Access API）。
   *
   * ⚠️ 顺序不能反：`showSaveFilePicker` 必须在**用户手势**里调用，先 `await fetch`
   * 下载大文件会把手势耗掉，Chromium 直接抛「Must be handling a user gesture」。
   * 所以是「先弹框拿句柄 → 再取字节 → 再写盘」；用户取消（AbortError）什么都不提示。
   */
  const saveAsExport = async (file) => {
    /**
     * ⚠️ 用 `any` 取这个 API：它是 File System Access 的较新成员，
     * TS 自带的 `Window` 类型里不一定有；而它**存在与否必须运行时判**（Electron 壳、
     * 老浏览器、跨源 iframe 里都没有），写进类型当成一定有会在真机上直接抛。
     */
    const picker = typeof window === "undefined" ? undefined : (window as any).showSaveFilePicker;
    if (typeof picker !== "function") {
      setNotice({ kind: "info", text: T("这个浏览器不支持「另存为」，请用下载（位置由浏览器的下载设置决定）。") });
      return;
    }
    try {
      const handle: any = await picker({ suggestedName: baseNameOf(file) });
      const response = await fetch(exportUrlOf(file));
      if (response.ok !== true) throw new Error(`HTTP ${response.status}`);
      const writable = await handle.createWritable();
      await writable.write(await response.blob());
      await writable.close();
      setNotice({ kind: "ok", text: T("已保存到 {n0}", { n0: String(handle.name ?? baseNameOf(file)) }) });
    } catch (error) {
      // 用户在保存框里按了取消：不是错误，不要弹红字
      if (error !== null && typeof error === "object" && (error as any).name === "AbortError") return;
      setNotice({ kind: "error", text: T("另存为失败：{n0}", { n0: msg(error) }) });
    }
  };

  /** 「打开导出目录」：打开**导出目录本身**（宿主按与导出同一处口径算路径，没导出过就退回项目目录）。 */
  const openExportFolder = async () => {
    if (view === null || api === undefined) return;
    const result = await withApi(() => api.revealMapProject({ projectId: view.id, target: "export" }));
    if (result === undefined) return;
    if (result.fallback === true) {
      setNotice({ kind: "info", text: T("还没有导出过，先点「导出」。现在打开的是项目目录。") });
      return;
    }
    setNotice({ kind: "ok", text: T("已打开 {n0}", { n0: String(result.dir ?? "") }) });
  };

  /**
   * 「整个模块看过了」：一次把四步全打（宿主按「`stage` 省略 = 四阶段全打」处理）。
   *
   * 界面上**只剩这一条**改阶段标记的路 —— 卡片里那颗「确定」已经删掉了（用户：
   * 「和右上角的 x 没区别」），单阶段的标记仍可由验收流程 / 对话面 `setMapApproved` 改。
   * 已经打过再点一次是幂等的（宿主那边只是把 approved 再写成 true）。
   */
  const markWholeModuleSeen = async () => {
    if (view === null || api === undefined) return;
    const done = await withApi(() => api.setMapApproved({ projectId: view.id, approved: true }));
    if (done === undefined) return;
    await loadProject(view.id, true);
  };

  const approvedOf = (stage) => {
    if (view === null) return false;
    const node = (view.stages || {})[stage];
    return node !== undefined && node.approved === true;
  };
  const approvedAll = ["assets", "rules", "paint", "export"].every((stage) => approvedOf(stage));

  // 作业进行中就轮询：验收预览 / 导出是宿主上的异步任务，提交那次读到的还是「进行中」。
  // 走集中调度器（同 key 去重 / 失败退避 / 页面隐藏暂停）。
  const projectBusy = view !== null && view.busy === true;
  React.useEffect(() => {
    if (projectBusy !== true || viewId === null || api === undefined) return undefined;
    const handle = scheduler.watch({
      key: "map:" + String(viewId) + ":busy",
      intervalMs: 1500,
      immediate: false,
      run: () => loadProject(viewId, true)
    });
    return () => handle.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectBusy, viewId, loadProject, scheduler]);

  /**
   * 「素材属性」窗口：点素材列表里的一行打开。
   *
   * 只放三样**表现层**属性（名字 / 播放速度 / 循环方式）—— 它们不动图块、不动序号，
   * 改完地图上已经画好的格子一格都不用重画。形态与格子尺寸不在这里（那要重切图块，
   * 会把画过的格子整体错位），仍然是「删掉重新新增」。
   */
  const tsEditDialog =
    tsEdit === null
      ? null
      : h(
          "div",
          { className: "SPR_mapEdDlgMask", "data-testid": "map-tsedit-mask", onClick: () => setTsEdit(null) },
          h(
            "div",
            {
              className: "SPR_mapEdDlg",
              role: "dialog",
              "aria-label": T("素材属性"),
              "data-testid": "map-tsedit-dialog",
              onClick: (event) => {
                if (typeof event.stopPropagation === "function") event.stopPropagation();
              }
            },
            h(
              "div",
              { className: "SPR_mapEdDlgHead" },
              h("div", { className: "SPR_mapEdDlgTitle" }, T("素材属性")),
              tsEdit.builtin === true ? h("span", { className: "SPR_mapEdTsBadge" }, T("自带")) : null
            ),
            h("div", { className: "SPR_mapEdDlgLabel" }, T("叫什么")),
            h("input", {
              className: "SPR_mapEdDlgInput",
              "data-testid": "map-tsedit-name",
              value: tsEdit.name,
              placeholder: T("留空就用原来的名字"),
              onChange: (event) => setTsEdit((current) => (current === null ? current : { ...current, name: event.target.value }))
            }),
            /**
             * 整图：**在真素材图上点格子**改通行区域。
             *
             * 贴的是烘过 4 个旋转的成品图（第 1 帧 rot0 那块在最上面），所以铺图比例要按
             * `max(cols, rows)` 的真实行宽算；只改数据、不动几何与序号，已印在地图上的整图
             * 下一次 `mapPlan` 就换成新区域。
             */
            tsEdit.stampCols === undefined
              ? null
              : stampPassGrid({
                  cols: tsEdit.stampCols,
                  rows: tsEdit.stampRows,
                  frames: tsEdit.stampFrames,
                  pass: tsEdit.stampPass,
                  sheetWidthCells: Math.max(tsEdit.stampCols, tsEdit.stampRows),
                  image: `${assetBase}${tsEdit.file}${tsEdit.rev === undefined ? "" : `?v=${tsEdit.rev}`}`,
                  prefix: "map-tsedit",
                  onChange: (update) =>
                    setTsEdit((current) =>
                      current === null
                        ? current
                        : { ...current, stampPass: typeof update === "function" ? update(current.stampPass) : update }
                    )
                }),
            tsEdit.stampCols === undefined
              ? null
              : h(
                  "p",
                  { className: "SPR_mapEdHint" },
                  T("改完点「保存」：地图上这张素材的所有整图都会立刻改用新区域，不用重新印一遍。")
                ),
            h("div", { className: "SPR_mapEdDlgLabel" }, T("动画速度")),
            h(
              "select",
              {
                className: "SPR_mapEdSelect",
                "data-testid": "map-tsedit-fps",
                disabled: tsEdit.animated !== true,
                value: tsEdit.fps,
                onChange: (event) => setTsEdit((current) => (current === null ? current : { ...current, fps: event.target.value }))
              },
              fpsOptions.map(([value, label, , desc]) => h("option", { key: value === "" ? "global" : value, value, title: desc }, label))
            ),
            h("div", { className: "SPR_mapEdDlgLabel" }, T("循环方式")),
            h(
              "div",
              { "data-testid": "map-tsedit-loop", style: tsEdit.animated === true ? undefined : { opacity: 0.45, pointerEvents: "none" } },
              segPicker("data-loop", loopOptions, tsEdit.loop, (value) => setTsEdit((current) => (current === null ? current : { ...current, loop: value })))
            ),
            tsEdit.animated === true
              ? h("p", { className: "SPR_mapEdHint" }, T("这两项只影响它自己：改完立刻生效，地图上已经画好的格子不用重画。想让它跟「设置」里那条全局速度走，播放速度选第一项。"))
              : h("p", { className: "SPR_mapEdHint" }, T("这块素材不会动（没有多帧），所以播放速度与循环方式对它没有意义。")),
            h(
              "div",
              { className: "SPR_mapEdDlgRow SPR_mapEdDlgActions", "data-testid": "map-tsedit-actions" },
              h(Btn, { "data-testid": "map-tsedit-cancel", onClick: () => setTsEdit(null) }, T("取消")),
              h(Btn, { "data-testid": "map-tsedit-ok", primary: true, busy: busyKey === "tileset", onClick: () => void saveTilesetEditor() }, T("保存"))
            )
          )
        );

  // ⚠️ 所有 Hook 都在上面；下面才开始早退（React #310，整个面板白屏）
  const fileInput = h("input", {
    ref: fileRef,
    type: "file",
    accept: "image/*",
    "data-testid": "map-tileset-input",
    style: { display: "none" },
    onChange: (event) => {
      void startWithFile(event.target.files?.[0]);
      event.target.value = "";
    }
  });

  const addFileInput = h("input", {
    ref: addFileRef,
    type: "file",
    accept: "image/*",
    "data-testid": "map-add-input",
    style: { display: "none" },
    onChange: (event) => {
      const file = event.target.files?.[0];
      if (file !== undefined && file !== null) setAddDraft((current) => (current === null ? current : { ...current, file }));
      event.target.value = "";
    }
  });

  const shell = (inner) =>
    h(
      "div",
      { className: "SPR_moduleBody SPR_fill", "data-module": "map" },
      inner,
      fileInput,
      addFileInput,
      addDialog,
      tsEditDialog,
      // 「AI 生成素材」与「新增素材」是**兄弟**：两者不会同时开（点 AI 这颗时
      // 用户是在找素材、不是在填表），同一层就够了。
      aiDialog,
      // 说明窗口是「新增素材」的**兄弟**而不是子节点：遮罩不叠在一起，
      // 点外面关掉的只有说明窗口自己（看完接着填那张表）。
      guideDialog
    );

  if (view === null || layout === null) {
    return shell(
      h(
        "div",
        { className: "SPR_mapEdRoot" },
        h(
          "div",
          { className: "SPR_mapEdEmpty" },
          h("p", { className: "SPR_mapEdEmptyText" }, T("还没有地图项目。")),
          h("p", { className: "SPR_mapEdHint" }, T("选一张素材图开始，或者先用自带素材试试。建出来就是 32×32、两层，可以直接画。")),
          h(
            "div",
            { className: "SPR_mapEdEmptyRow" },
            h(Btn, { onClick: () => askProjectName("create") }, T("新建项目")),
            h(Btn, { primary: true, onClick: () => fileRef.current?.click(), busy: busyKey === "upload" }, T("选一张素材图开始")),
            h(Btn, { onClick: () => void startWithSample(), busy: busyKey === "sample" }, T("用自带素材试试"))
          ),
          notice === null ? null : h("div", { className: `SPR_notice SPR_notice-${notice.kind}` }, notice.text)
        ),
        nameDialog
      )
    );
  }

  // ── 顶栏 ─────────────────────────────────────────────────────────────
  const menu = h(
    "div",
    { className: "SPR_mapEdMenu", role: "menu" },
    h(
      "button",
      {
        type: "button",
        className: "SPR_mapEdMenuItem",
        onClick: () => {
          setMenuOpen(false);
          askProjectName("create");
        }
      },
      T("新建项目")
    ),
    h(
      "button",
      {
        type: "button",
        className: "SPR_mapEdMenuItem",
        onClick: () => {
          setMenuOpen(false);
          askProjectName("rename");
        }
      },
      T("重命名")
    ),
    h(
      "button",
      {
        type: "button",
        className: "SPR_mapEdMenuItem",
        "data-danger": "true",
        onClick: () => {
          setMenuOpen(false);
          void deleteProject();
        }
      },
      T("删除项目")
    ),
    h("div", { className: "SPR_mapEdMenuLabel" }, T("切换项目")),
    projects.map((entry) =>
      h(
        "button",
        {
          key: entry.id,
          type: "button",
          className: "SPR_mapEdMenuItem",
          "data-on": entry.id === view.id ? "true" : undefined,
          onClick: () => {
            setMenuOpen(false);
            void loadProject(entry.id);
          }
        },
        h("span", { className: "SPR_projNameRow" },
          h("span", { className: "SPR_projName" }, entry.name),
          h(CopyIdButton, { id: entry.id, inline: true })
        )
      )
    )
  );

  const topBar = h(
    "div",
    { className: "SPR_mapEdTop" },
    h(
      "div",
      { className: "SPR_mapEdProjWrap" },
      h(
        "button",
        {
          type: "button",
          className: "SPR_mapEdProj",
          "data-open": menuOpen === true ? "true" : undefined,
          "aria-expanded": menuOpen === true ? "true" : "false",
          onClick: () => setMenuOpen(menuOpen !== true)
        },
        h("span", { className: "SPR_mapEdProjName" }, view.name),
        h("span", { className: "SPR_mapEdCaret" }, "▾")
      ),
      menuOpen === true ? menu : null
    ),
    h(CopyIdButton, { id: view.id }),
    h("span", { className: "SPR_mapEdSpacer" }),
    h(
      "button",
      {
        type: "button",
        className: "SPR_mapEdTopBtn",
        "data-on": openCard === "assets" ? "true" : undefined,
        onClick: () => setOpenCard(openCard === "assets" ? null : "assets")
      },
      T("素材")
    ),
    h(
      "button",
      {
        type: "button",
        className: "SPR_mapEdTopBtn",
        "data-on": openCard === "export" ? "true" : undefined,
        onClick: () => setOpenCard(openCard === "export" ? null : "export")
      },
      T("导出")
    ),
    /**
     * ⚠️ 这里原来有个「正在保存… / 已自动保存 HH:MM」的状态文字。
     * 用户反馈：画的时候它一直闪，不需要 —— 而且保存现在改成**一笔结束才提交**
     * （见 `queueOps`），本来也没什么可显示的。整块拿掉，连带 `savedAt` / `saving`。
     */
    null
  );

  // ── 左列：素材调色板 + 12 个工具格 ────────────────────────────────────
  /**
   * 可点的笔刷清单。
   *
   * ⚠️ 必须读宿主给的 `palette`，**不要自己从 `legend` 里推**：绘制图例是按
   * 「一格一块」列出来的（拼块素材还含 16px 小格），照它做调色板会让用户点到
   * 半个草地。A2 拼块在 `palette` 里只有一个条目（点它 = 用自动连接笔刷）。
   */
  const brushes = [];
  for (const owner of tilesets) {
    const list = Array.isArray(owner.palette) && owner.palette.length > 0 ? owner.palette : legend.filter((entry) => entry.tilesetId === owner.id);
    for (const item of list) brushes.push({ tilesetId: owner.id, index: item.index, rect: item.rect });
  }

  const paletteTile = (entry) => {
    const owner = tilesets.find((item) => item.id === entry.tilesetId);
    if (owner === undefined) return null;
    /**
     * 缩放基准是**条目自己的矩形**（不是「一格」）：
     * 普通 / 整格 / 拼块的条目本来就等于一格；整图那条是**整张**（N×M 格），
     * 用格子当基准只会缩进左下角的一格，用户看到的是半张图。
     */
    const cellW = entry.rect.width > 0 ? entry.rect.width : owner.cell.width;
    const cellH = entry.rect.height > 0 ? entry.rect.height : owner.cell.height;
    const scaleX = 32 / Math.max(1, cellW);
    const scaleY = 32 / Math.max(1, cellH);
    /**
     * 悬停就说清「这是什么、点它能干什么」。
     *
     * ⚠️ 这里原来挂的是原生 `title: "第 N 块"`：等一秒才出来，而且对新手等于没说 ——
     * 他看到的是一格草地，不是「第 33 块」。改成和工具格同一张自绘小标签，
     * 顺带把「自动连接」「会动」这两件看不见的事讲出来（点之前就该知道）。
     */
    const paletteName = owner.name;
    const paletteDesc =
      T("点一下选中它，然后在右边地图上按住鼠标左键涂。按住 Shift 或 Ctrl 点可以多选几块 —— 那几块是给「一键生成」随机挑着用的。") +
      (owner.shape === "corner16" || owner.shape === "a2quad" ? T("它是自动连接的图：涂上去边缘会自己接上。") : "") +
      (owner.animRows === true ? T("这张图会动。") : "") +
      (owner.stamp === undefined ? "" : T("这是 {n0}×{n1} 的整图：点一下在地图上印一整张，右键可以转 90°。", { n0: String(owner.stamp.cols), n1: String(owner.stamp.rows) }));
    return h("button", {
      key: `${entry.tilesetId}:${entry.index}`,
      type: "button",
      className: "SPR_mapEdTile",
      "data-on": brush !== null && brush.index === entry.index ? "true" : undefined,
      "data-index": String(entry.index),
      "aria-label": `${paletteName}：${paletteDesc}`,
      onMouseEnter: showToolTip(paletteName, paletteDesc, null),
      onFocus: showToolTip(paletteName, paletteDesc, null),
      onMouseLeave: hideToolTip,
      onBlur: hideToolTip,
      style: {
        backgroundImage: `url(${assetBase}${owner.file}${owner.rev === undefined ? "" : `?v=${owner.rev}`})`,
        backgroundSize: `${owner.imageWidth * scaleX}px ${owner.imageHeight * scaleY}px`,
        backgroundPosition: `${-entry.rect.x * scaleX}px ${-entry.rect.y * scaleY}px`
      },
      onClick: (event) => {
        const additive = event.shiftKey === true || event.ctrlKey === true || event.metaKey === true;
        setBrush({ index: entry.index, tilesetId: entry.tilesetId });
        // 换笔刷 → 旋转归零（上一张的朝向不该带到下一张）。
        setStampRot(0);
        setMulti((prev) =>
          additive === true
            ? prev.includes(entry.index)
              ? prev.filter((value) => value !== entry.index)
              : prev.concat([entry.index])
            : [entry.index]
        );
      }
    });
  };

  const palette = h(
    "div",
    { className: "SPR_mapEdPalette" },
    brushes.length === 0
      ? h("p", { className: "SPR_mapEdHint" }, T("还没有素材，点上面的「素材」上传一张。"))
      : h("div", { className: "SPR_mapEdPaletteGrid" }, brushes.map(paletteTile))
  );

  /**
   * 一个工具格。
   *
   * ⚠️ **不要用 `title` 做说明**：原生 tooltip 要等一秒、样式不受控，还和我们自己那张
   * 小标签**同时出现**（两个框叠在一起）。所以这里 `aria-label` 承担无障碍名字，
   * 视觉说明交给 `SPR_mapEdTip` —— 鼠标悬浮 / 键盘聚焦时显示在按钮**正上方**。
   */
  const toolButton = (key, name, desc, config) => {
    const options = config === undefined ? {} : config;
    const shortcut = options.shortcut === undefined ? null : options.shortcut;
    return h(
      "button",
      {
        key,
        type: "button",
        className: "SPR_mapEdTool",
        "aria-label":
          shortcut === null
            ? T("{n0}：{n1}", { n0: name, n1: desc })
            : T("{n0}：{n1}（{n2}）", { n0: name, n1: desc, n2: shortcut }),
        "data-tool": key,
        "data-on": options.on === true ? "true" : undefined,
        disabled: options.disabled === true,
        onMouseEnter: showToolTip(name, desc, shortcut),
        onFocus: showToolTip(name, desc, shortcut),
        onMouseLeave: hideToolTip,
        onBlur: hideToolTip,
        onPointerDown: hideToolTip,
        onClick: options.onClick
      },
      options.icon === undefined ? null : h(MapToolIcon, { name: options.icon })
    );
  };

  const tools = h(
    "div",
    { className: "SPR_mapEdTools" },
    toolButton("undo", T("撤销"), T("退回上一步。画错、擦错就点它。"), { icon: "undo", shortcut: "⌘Z", onClick: () => void doUndo(), disabled: view.canUndo !== true }),
    toolButton("redo", T("重做"), T("把刚退回的那一步再做回来。撤销点多了就用它。"), { icon: "redo", shortcut: "⇧⌘Z", onClick: () => void doRedo(), disabled: view.canRedo !== true }),
    toolButton("pen", T("画笔"), T("最常用的工具：按住鼠标左键在格子上拖，就画上左边选中的那块图。"), { icon: "pen", shortcut: "B", on: tool === "pen", onClick: () => setTool("pen") }),
    toolButton("eraser", T("橡皮"), T("把格子擦成空的。不切工具也行：按住鼠标右键拖，就是在擦（标记工具下右键是删标记）。"), { icon: "eraser", shortcut: "E", on: tool === "eraser", onClick: () => setTool("eraser") }),
    toolButton("bucket", T("油漆桶"), T("点一下，把和这一格连成一片的相同图块一次填满 —— 比如一整片草地。只影响当前这一层。"), { icon: "bucket", shortcut: "G", on: tool === "bucket", onClick: () => setTool("bucket") }),
    toolButton("pipette", T("吸管"), T("点地图上的某一格，把那一格用的图块取过来当画笔 —— 接着画同样的东西，不用再回左边找。"), { icon: "pipette", shortcut: "I", on: tool === "pipette", onClick: () => setTool("pipette") }),
    toolButton("hand", T("抓手"), T("按住鼠标左键拖动，看地图的其它部分。不想切工具时：按住空格拖，或按住中键拖，也一样。"), { icon: "hand", shortcut: "H", on: tool === "hand", onClick: () => setTool("hand") }),
    toolButton("marker", T("标记"), T("在地图上做记号：点一格放一个圆圈，里面是编号。点已有的标记可以改名，按住可以拖到别处，右键删掉。适合标出生点、宝箱、出口。"), { icon: "marker", shortcut: "M", on: tool === "marker", onClick: () => setTool("marker") }),
    h(
      "div",
      {
        key: "layer",
        className: "SPR_mapEdTool SPR_mapEdLayerBtn",
        onMouseEnter: showToolTip(T("图层"), T("地图是好几层叠出来的（默认：地理层 / 装饰层 / 建筑层），你只画在当前这一层。点中间的数字打开图层列表（改名 / 换顺序 / 删掉）；上面箭头切到上一层，下面箭头切到下一层。"), null),
        onMouseLeave: hideToolTip
      },
      h(
        "button",
        {
          type: "button",
          className: "SPR_mapEdLayerHalf",
          "data-dir": "up",
          "aria-label": T("上一层"),
          disabled: safeLayerIndex >= layers.length - 1,
          onClick: () => setLayerIndex(Math.min(layers.length - 1, safeLayerIndex + 1))
        },
        h(MapToolIcon, { name: "up" })
      ),
      h(
        "button",
        {
          type: "button",
          className: "SPR_mapEdLayerNum",
          "aria-label": T("图层"),
          "data-testid": "map-open-layers",
          onClick: () => setOpenCard(openCard === "layers" ? null : "layers")
        },
        String(safeLayerIndex + 1)
      ),
      h(
        "button",
        {
          type: "button",
          className: "SPR_mapEdLayerHalf",
          "data-dir": "down",
          "aria-label": T("下一层"),
          disabled: safeLayerIndex <= 0,
          onClick: () => setLayerIndex(Math.max(0, safeLayerIndex - 1))
        },
        h(MapToolIcon, { name: "down" })
      )
    ),
    toolButton("grid", T("网格线"), T("开关格子边框。对齐格子、数格子时打开，看整体效果时关掉。"), { icon: "grid", on: showGrid === true, onClick: () => setShowGrid(showGrid !== true) }),
    toolButton("gen", T("一键生成"), T("不想一格一格画时用它：随机铺满 / 迷宫 / 大陆三种铺法，把整层一次铺好，铺完还能手动改，也能撤销。"), { icon: "magic", on: openCard === "gen", onClick: () => setOpenCard(openCard === "gen" ? null : "gen") }),
    toolButton("settings", T("设置"), T("改地图多大（几行几列）、管理图层，也是这个面板的说明入口。"), { icon: "settings", on: openCard === "settings", onClick: () => setOpenCard(openCard === "settings" ? null : "settings") })
  );

  const side = h(
    "div",
    { className: "SPR_mapEdSide" },
    h("div", { className: "SPR_mapEdSideTitle" }, T("素材调色板")),
    palette,
    tools
  );

  // ── 卡片：素材 / 导出 / 设置 / 一键生成 ──────────────────────────────
  const cardHead = (title) =>
    h(
      "div",
      { className: "SPR_mapEdCardHead" },
      h("h4", null, title),
      h("span", { className: "SPR_mapEdSpacer" }),
      h("button", { type: "button", className: "SPR_mapEdCardClose", "aria-label": T("关闭"), onClick: () => setOpenCard(null) }, "×")
    );

  const row = (label, control, hint?: any) =>
    h(
      "div",
      { className: "SPR_mapEdRow" },
      h("span", { className: "SPR_mapEdLabel" }, label),
      control,
      hint === undefined || hint === "" ? null : h("span", { className: "SPR_mapEdRowHint" }, hint)
    );

  /**
   * ⚠️ 卡片里**不再有「确定」按钮**（它曾经是「标记这一步看过了 + 收起卡片」）。
   *
   * 用户的判断很直接：「确定键可以删了，和右上角的 x 没区别」。这是对的 ——
   * 阶段标记在界面上**完全不可见**（上一版为了去掉「取消确认」把它做成了普通按钮，
   * 于是按与不按看起来一模一样），那么这颗按钮对用户就只剩「关掉卡片」这一个作用，
   * 和右上角那个 × 重复。
   *
   * 所以：关卡片只剩 ×；阶段标记仍可由验收流程 / 对话面（`setMapApproved`）改；
   * 界面上唯一还暴露它的地方是设置卡片里的「整个模块看过了」（那是一颗有状态按钮）。
   */

  const speedOptions = [
    ["0.5", T("慢")],
    ["1", T("中")],
    ["2", T("快")]
  ];
  const speedValue = String(animFps === null ? planMeta.fps : animFps);

  /**
   * 素材卡片 = **列表 + 新增 + 恢复默认**。
   *
   * 产品约定（用户定的）：属性在「新增素材」那一刻填完就定死，之后**只能删掉重来** ——
   * 所以这张卡里没有任何「改格子 / 改形态 / 改动不动」的入口；内置素材同样在列表里、
   * 也能删，想拿回来点「恢复默认素材」（同名会跳过，不会变成两份）。
   */
  /**
   * 这张素材有几帧（列表上的徽章用）。
   *
   * 三种会动的情形都算进来：`a2quad` 的**变体就是帧**、`animRows`（翻页图）的**行数就是帧**、
   * 整图的 `stamp.frames` 就是帧 —— 宿主算好的 `variants` 在前两种情形下都正好是帧数。
   */
  const frameCountOf = (entry) =>
    entry.stamp !== undefined && (entry.stamp.frames ?? 1) > 1
      ? entry.stamp.frames
      : entry.animRows === true
        ? entry.variants
        : entry.shape === "a2quad" && entry.variants > 1
          ? entry.variants
          : 0;

  const assetsCard = h(
    "div",
    { className: "SPR_mapEdCard", "data-testid": "map-assets-card" },
    cardHead(T("素材")),
    h(
      "div",
      { className: "SPR_mapEdCardRow" },
      h(Btn, { "data-testid": "map-add-open", primary: true, onClick: openAddTileset }, T("新增素材")),
      // 「AI 生成素材」：不在这里生成，开一个新对话把需求发过去（见 aiDialog）。
      h(Btn, { "data-testid": "map-ai-open", onClick: openAiAsset }, T("AI 生成素材")),
      h(Btn, { onClick: () => void restoreSamples(), busy: busyKey === "sample" }, T("恢复默认素材"))
    ),
    tilesets.length === 0
      ? h("p", { className: "SPR_mapEdHint" }, T("还没有素材。点「新增素材」加一张自己的，或者点「恢复默认素材」拿到自带的那套。"))
      : h(
          "ul",
          { className: "SPR_mapEdTsList", "data-testid": "map-tileset-list" },
          tilesets.map((entry, index) =>
            h(
              "li",
              { key: entry.id, className: "SPR_mapEdTsRow", "data-on": index === safeTsIndex ? "true" : undefined },
              h(
                "button",
                {
                  type: "button",
                  className: "SPR_mapEdTsPick",
                  "data-tileset": entry.id,
                  title: T("点一下改它的名字 / 播放速度 / 循环方式 / 整图的通行区域"),
                  onClick: () => {
                    // 点一下 = 选中它（当笔刷用）+ 打开属性窗口（改名 / 速度 / 循环方式）
                    setTsIndex(index);
                    openTilesetEditor(entry);
                  }
                },
                h("span", { className: "SPR_mapEdTsName" }, entry.name),
                h(
                  "span",
                  { className: "SPR_mapEdTsMeta" },
                  T("{n0}×{n1} · {n2} 块", { n0: String(entry.cell.width), n1: String(entry.cell.height), n2: String(entry.tileCount) })
                ),
                frameCountOf(entry) > 0
                  ? h(
                      "span",
                      { className: "SPR_mapEdTsBadge", "data-anim": "true" },
                      entry.fps === undefined
                        ? T("会动 {n0} 帧", { n0: String(frameCountOf(entry)) })
                        : T("会动 {n0} 帧 · {n1} 帧/秒", { n0: String(frameCountOf(entry)), n1: String(entry.fps) })
                    )
                  : null,
                entry.builtin === true ? h("span", { className: "SPR_mapEdTsBadge" }, T("自带")) : null
              ),
              h(Btn, { danger: true, onClick: () => void removeTilesetById(entry.id, entry.name) }, T("删除"))
            )
          )
        ),
    h(
      "p",
      { className: "SPR_mapEdHint" },
      T("点素材那一行可以改**名字 / 播放速度 / 循环方式 / 整图的通行区域**（这些都不动图块，随时能改）。形态与格子大小在新增时就定下来了 —— 要换只能删掉重新新增。")
    )
  );

  /**
   * 导出卡片 = **一次选完 → 一次导出 → 一次下载**。
   *
   * 老版本的坏处（用户原话：「导出功能窗口意味不明」）：两个按钮并排，一个看着像
   * 页签、另一个点下去却是立即执行；导完给一堆文件链接却没有「存到哪」这件事；
   * 三个文件还得一个一个点。现在：
   *
   * 1. 内容用复选框选（勾几项都行），倍率只在勾了 PNG 时出现；
   * 2. 唯一的「导出」按钮执行；多份产物由宿主打成一个 zip，一次下载；
   * 3. 结果区写清「文件在哪」（本机绝对路径）+ 下载 / 另存为 / 打开导出目录。
   */
  const exportRows = [
    ["png", T("地图图片 PNG"), T("地图长什么样，直接能放进游戏")],
    ["json", T("存档数据 JSON"), T("每一格是什么，给引擎和工具读")],
    ["tilesets", T("素材原图"), T("把素材图一起拷进包里，换台机器也能用")]
  ];
  const exportNothingChosen = exportFormats.png !== true && exportFormats.json !== true && exportFormats.tilesets !== true;
  const zipFile = exportFiles.find((file) => isZip(file));
  const mainFile = zipFile ?? exportFiles.find((file) => file === "map.png") ?? exportFiles[0];
  // 排一下序：zip 在最前（它是「一次拿走全部」那一个），其余按产出顺序
  const listedFiles = exportFiles.slice().sort((a, b) => (isZip(a) === isZip(b) ? 0 : isZip(a) ? -1 : 1));
  const canSaveAs = typeof window !== "undefined" && typeof (window as any).showSaveFilePicker === "function";

  const exportCard = h(
    "div",
    { className: "SPR_mapEdCard", "data-testid": "map-export-card" },
    cardHead(T("导出")),
    h("span", { className: "SPR_mapEdLabel" }, T("导出内容")),
    h(
      "div",
      { className: "SPR_mapEdRows" },
      exportRows.map(([key, label, hint]) =>
        h(
          "label",
          { key, className: "SPR_mapEdCheck", "data-testid": `map-export-row-${key}` },
          h("input", {
            type: "checkbox",
            "data-testid": `map-export-${key}`,
            checked: exportFormats[key] === true,
            onChange: (event) => setExportFormats((current) => ({ ...current, [key]: event.target.checked }))
          }),
          label,
          h("span", { className: "SPR_mapEdTsMeta" }, hint)
        )
      )
    ),
    exportFormats.png === true
      ? row(
          T("倍率"),
          h(
            "select",
            {
              className: "SPR_mapEdSelect",
              "data-testid": "map-export-scale",
              value: String(exportScale),
              onChange: (event) => setExportScale(Number(event.target.value))
            },
            [1, 2, 3, 4].map((value) => h("option", { key: value, value: String(value) }, `${value}×`))
          ),
          T("只影响 PNG 的尺寸，不影响存档数据")
        )
      : null,
    h("p", { className: "SPR_mapEdHint" }, T("产出不止一个文件时自动打成一个 ZIP；只有一个文件时就直接给你那个文件。")),
    h(
      "div",
      { className: "SPR_mapEdCardRow" },
      h(
        Btn,
        {
          primary: true,
          busy: busyKey === "export",
          disabled: exportNothingChosen,
          "data-testid": "map-export-run",
          onClick: () => void runExport()
        },
        T("导出")
      ),
      h(Btn, { onClick: () => void openExportFolder() }, T("打开导出目录"))
    ),
    exportFiles.length === 0
      ? h("p", { className: "SPR_mapEdHint", "data-testid": "map-export-empty" }, T("还没有导出过。"))
      : h(
          "div",
          { className: "SPR_mapEdExportResult", "data-testid": "map-export-result" },
          h("span", { className: "SPR_mapEdLabel" }, T("最近一次导出：{n0} 个文件", { n0: String(exportFiles.length) })),
          mainFile === undefined
            ? null
            : h(
                "div",
                { className: "SPR_mapEdCardRow" },
                h(
                  "a",
                  {
                    className: "SPR_btn",
                    "data-primary": "true",
                    "data-testid": "map-export-download",
                    href: exportUrlOf(mainFile),
                    download: baseNameOf(mainFile),
                    // 与别处的「下载」按钮同款：`<a>` 当按钮用，去掉下划线
                    style: { textDecoration: "none" }
                  },
                  T("下载 {n0}", { n0: baseNameOf(mainFile) })
                ),
                canSaveAs
                  ? h(
                      Btn,
                      { "data-testid": "map-export-save-as", onClick: () => void saveAsExport(mainFile) },
                      T("另存为…")
                    )
                  : null
              ),
          h(
            "p",
            { className: "SPR_mapEdHint" },
            canSaveAs
              ? T("下载走浏览器（默认进它的下载目录）；想自己挑位置就点「另存为…」。")
              : T("下载走浏览器：文件会进它的下载目录（想每次都自己挑位置，在浏览器里打开「下载前询问保存位置」）。")
          ),
          h(
            "ul",
            { className: "SPR_mapEdFiles", "data-testid": "map-export-files" },
            listedFiles.map((file) =>
              h(
                "li",
                { key: file },
                h("a", { href: exportUrlOf(file), download: baseNameOf(file), "data-testid": `map-export-file-${baseNameOf(file)}` }, file),
                isZip(file) ? h("span", { className: "SPR_mapEdTsBadge", "data-anim": "true" }, T("打包，含全部内容")) : null
              )
            )
          ),
          h("p", { className: "SPR_mapEdHint", "data-testid": "map-export-path" }, T("文件都在 {n0}", { n0: view.exportPath === "" ? "—" : String(view.exportPath) }))
        )
  );

  /**
   * 图层卡：一张列表管三件事 —— 改名字、换顺序、删掉；最上面一行固定是「标记层」。
   *
   * 名字是宿主的字段（`saveMapDoc({ layers: [{ id, name }] })`），所以改名走一次结构补丁、
   * 回来重读视图。标记列表放在同一张卡里：点一行就能改名 / 定位 / 删掉。
   *
   * 列表**从上往下列**（最后添加的层在最上）：画布上就是这个叠放顺序，反向列会让人点错。
   */
  const layerRows = [...layers].map((layer, index) => ({ layer, index })).reverse();
  const markers = view === null || view.markers === undefined ? [] : view.markers;
  const smallBtn = (key, label, title, onClick, disabled) =>
    h(
      "button",
      { key, type: "button", className: "SPR_mapEdMiniBtn", title, "aria-label": title, disabled: disabled === true, onClick },
      label
    );
  const layersCard = h(
    "div",
    { className: "SPR_mapEdCard", "data-testid": "map-layers-card" },
    cardHead(T("图层")),
    h("p", { className: "SPR_mapEdHint" }, T("点名字可以改名，右边可以换顺序或删掉")),
    h(
      "div",
      { className: "SPR_mapEdLayerList" },
      h(
        "div",
        { className: "SPR_mapEdLayerRow", "data-testid": "map-marker-layer-row" },
        h("span", { className: "SPR_mapEdLayerIdx" }, "●"),
        h("span", { className: "SPR_mapEdLayerName", style: { cursor: "default" } }, T("标记层")),
        h("span", { className: "SPR_mapEdMarkerAt" }, T("{n0} 个标记", { n0: String(markers.length) })),
        smallBtn("marker", T("标记"), T("标记"), () => setTool("marker"), false)
      ),
      layerRows.map(({ layer, index }) => {
        const editing = layerDraft !== null && layerDraft.id === layer.id;
        return h(
          "div",
          { key: layer.id, className: "SPR_mapEdLayerRow", "data-on": index === safeLayerIndex ? "true" : undefined },
          h("span", { className: "SPR_mapEdLayerIdx" }, String(index + 1)),
          editing
            ? h("input", {
                className: "SPR_mapEdLayerNameInput",
                autoFocus: true,
                value: layerDraft.value,
                "data-testid": `map-layer-name-${index}`,
                onChange: (event) => setLayerDraft({ id: layer.id, value: event.target.value }),
                onBlur: () => void commitLayerName(layer.id, layerDraft.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    setLayerDraft(null);
                  }
                }
              })
            : h(
                "button",
                {
                  type: "button",
                  className: "SPR_mapEdLayerName",
                  "data-testid": `map-layer-pick-${index}`,
                  title: T("点名字可以改名，右边可以换顺序或删掉"),
                  onClick: () => setLayerIndex(index),
                  onDoubleClick: () => setLayerDraft({ id: layer.id, value: layer.name })
                },
                layer.name
              ),
          smallBtn("up", "↑", T("上移一层"), () => void saveDoc({ moveLayer: { id: layer.id, toIndex: index + 1 } }, T("已换图层顺序")), index >= layers.length - 1),
          smallBtn("down", "↓", T("下移一层"), () => void saveDoc({ moveLayer: { id: layer.id, toIndex: index - 1 } }, T("已换图层顺序")), index <= 0),
          smallBtn("remove", "×", T("删掉当前这一层"), () => void saveDoc({ removeLayerId: layer.id }, T("已删掉这一层")), layers.length <= 1)
        );
      })
    ),
    h(
      "div",
      { className: "SPR_mapEdCardRow" },
      h(Btn, { onClick: () => void saveDoc({ addLayer: { name: T("图层 {n0}", { n0: String(layers.length + 1) }) } }, T("已加一层")) }, T("加一层")),
      h(Btn, { onClick: () => void clearLayer() }, T("清空当前图层")),
      h(
        "label",
        { className: "SPR_mapEdCheck" },
        h("input", { type: "checkbox", "data-testid": "map-single-layer", checked: single === true, onChange: (event) => setSingle(event.target.checked) }),
        T("只看这一层")
      )
    ),
    h(
      "div",
      { className: "SPR_mapEdMarkerList", "data-testid": "map-marker-list" },
      markers.length === 0
        ? h("p", { className: "SPR_mapEdHint" }, T("还没有标记。选「标记」工具，在地图上点一格。"))
        : markers.map((marker) =>
            h(
              "div",
              { key: marker.id, className: "SPR_mapEdMarkerRow", "data-on": marker.id === markerSel ? "true" : undefined, "data-testid": `map-marker-${marker.n}` },
              h("span", { className: "SPR_mapEdMarkerDot" }, String(marker.n)),
              h("input", {
                className: "SPR_mapEdMarkerName",
                "aria-label": T("标记名字"),
                placeholder: T("标记 {n0}", { n0: String(marker.n) }),
                value: markerDraft !== null && markerDraft.id === marker.id ? markerDraft.value : marker.name,
                onFocus: () => setMarkerSel(marker.id),
                onChange: (event) => setMarkerDraft({ id: marker.id, value: event.target.value }),
                onBlur: () => {
                  if (markerDraft !== null && markerDraft.id === marker.id) void commitMarkerName(marker.id, markerDraft.value);
                },
                onKeyDown: (event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }
              }),
              h("span", { className: "SPR_mapEdMarkerAt" }, `(${marker.r},${marker.c})`),
              smallBtn("go", T("定位"), T("定位"), () => {
                setMarkerSel(marker.id);
                centerOnCell(marker.r, marker.c);
              }, false),
              smallBtn("drop", T("删掉"), T("删掉"), () => void markerOp({ kind: "marker", op: "remove", id: marker.id }, true), false)
            )
          )
    )
  );

  const settingsCard = h(
    "div",
    { className: "SPR_mapEdCard" },
    cardHead(T("设置")),
    row(
      T("地图大小"),
      h(
        "div",
        { className: "SPR_mapEdPair" },
        h(NumField, { label: T("宽"), value: view.cols, min: 1, max: 512, onChange: (value) => void applyMapSize(value, view.rows) }),
        h("span", { className: "SPR_mapEdTimes" }, "×"),
        h(NumField, { label: T("高"), value: view.rows, min: 1, max: 512, onChange: (value) => void applyMapSize(view.cols, value) })
      ),
      T("单位是格。改大只是多出空地；改小会丢掉范围外的格子（可撤销）")
    ),
    row(
      T("一格多大"),
      h("span", { className: "SPR_mapEdValue", "data-testid": "map-grid-cell" }, T("{n0}×{n1} 像素", { n0: String(view.grid.tileWidth), n1: String(view.grid.tileHeight) })),
      T("新建项目时定的，之后不能改。AI 生成的素材会按这个尺寸出块；想让素材更清楚就新建一个 48 / 64 的项目。")
    ),
    row(
      T("动画速度"),
      h(
        "select",
        {
          className: "SPR_mapEdSelect",
          "data-testid": "map-anim-speed",
          value: speedValue,
          onChange: (event) => setAnimFps(Number(event.target.value))
        },
        speedOptions.map(([value, label]) => h("option", { key: value, value }, `${label} · ${value} 帧/秒`))
      ),
      T("只影响会动的素材（水、翻页图这类）。哪张素材在「新增素材」里单独设过速度，就按它自己的走，不跟着这里变。")
    ),
    h(
      "label",
      { className: "SPR_mapEdCheck" },
      h("input", { type: "checkbox", checked: showGrid === true, onChange: (event) => setShowGrid(event.target.checked) }),
      T("网格线")
    ),
    h(
      "label",
      { className: "SPR_mapEdCheck" },
      h("input", {
        type: "checkbox",
        "data-testid": "map-show-pass",
        checked: showPass === true,
        onChange: (event) => setShowPass(event.target.checked)
      }),
      T("区域（整图能不能走）")
    ),
    h(
      "div",
      { className: "SPR_mapEdHelp" },
      h("h5", null, T("帮助")),
      h("p", null, T("左键拖动＝用当前工具画；空格拖动或中键拖动＝平移；滚轮＝缩放；右键＝旋转整图；擦除点「橡皮」工具。")),
      h("p", null, T("调色板里点一下选一块图当笔刷，按住 Shift 或 Ctrl 可以多选，「一键生成」会用这些图块。")),
      h("p", null, T("地图四周是接上的：自动连接会把上下、左右两边接起来。画布拖不出地图 —— 拖到边就停，地图左上角对齐后不会再乱动；图外那片空白画不上。"))
    ),
    h(
      "div",
      { className: "SPR_mapEdCardRow" },
      h(Btn, { onClick: () => void withApi(() => api.revealMapProject({ projectId: view.id })) }, T("在访达中打开项目目录")),
      h(Btn, { primary: true, on: approvedAll === true, onClick: () => void markWholeModuleSeen() }, T("整个模块看过了"))
    )
  );

  const genTiles = multi.length > 0 ? multi : brush === null ? [] : [brush.index];
  const genCard = h(
    "div",
    { className: "SPR_mapEdCard" },
    cardHead(T("一键生成")),
    h(
      "div",
      { className: "SPR_mapEdRadios" },
      [
        ["random", T("随机铺满")],
        ["maze", T("迷宫")],
        ["continent", T("大陆")]
      ].map(([value, label]) =>
        h(
          "label",
          { key: value, className: "SPR_mapEdRadio" },
          h("input", { type: "radio", name: "map-gen-kind", checked: genKind === value, onChange: () => setGenKind(value) }),
          label
        )
      )
    ),
    h(
      "p",
      { className: "SPR_mapEdHint" },
      genTiles.length === 0
        ? T("用的图块：还没选。在左边点一下选一块，按住 Shift 或 Ctrl 可以多选。")
        : T("用的图块：{n0}", { n0: genTiles.join("、") })
    ),
    h(
      "p",
      { className: "SPR_mapEdHint" },
      genKind === "maze"
        ? T("迷宫：按顺序取两块，第一块当墙，第二块当路。")
        : genKind === "continent"
          ? T("大陆：按顺序取最多四块当四种地貌（水下 / 海面 / 草地 / 雪地）。")
          : T("随机铺满：在选中的图块里均匀随机。")
    ),
    h(
      "div",
      { className: "SPR_mapEdCardRow" },
      h(NumField, { label: T("种子"), value: genSeed, onChange: (value) => setGenSeed(value) }),
      h(Btn, { onClick: () => setGenSeed(Math.floor(Math.random() * 1000000)) }, T("换一组")),
      h(Btn, { primary: true, busy: busyKey === "gen", onClick: () => void runGenerate() }, T("生成"))
    )
  );

  const openCardNode =
    openCard === "assets"
      ? assetsCard
      : openCard === "export"
        ? exportCard
        : openCard === "layers"
          ? layersCard
          : openCard === "settings"
            ? settingsCard
            : openCard === "gen"
              ? genCard
              : null;

  const canvas = h("canvas", {
    ref: bindCanvas,
    className: "SPR_mapEdCanvas",
    "data-testid": "map-canvas",
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave: () => {
      strokeRef.current = null;
      currentStroke.current = null;
      setHover(null);
      void flushOps();
    },
    // ⚠️ 少了 onPointerCancel：指针被系统取消（触摸 / 手写笔被打断、指针捕获丢失）
    // 时 `strokeRef` 不清，之后**在没按键的情况下**一次普通 pointermove 就会继续涂抹，
    // 而且每段还各算一步撤销。`onPointerLeave` 兜不住「留在画布内被取消」这种。
    onPointerCancel: () => {
      strokeRef.current = null;
      currentStroke.current = null;
      setHover(null);
      void flushOps();
    },
    onContextMenu: (event) => event.preventDefault()
  });

  // 工具小标签：挂在面板根节点下、`position:fixed`，所以不会被任何祖先的 overflow 裁掉。
  const toolTipNode =
    toolTip === null
      ? null
      : h(
          "div",
          {
            className: "SPR_mapEdTip",
            role: "tooltip",
            "data-tip": toolTip.name,
            style: { left: `${toolTip.x}px`, top: `${toolTip.y}px` }
          },
          h(
            "div",
            { className: "SPR_mapEdTipName" },
            toolTip.name,
            toolTip.shortcut === null ? null : h("span", { className: "SPR_mapEdTipKey" }, toolTip.shortcut)
          ),
          h("div", { className: "SPR_mapEdTipDesc" }, toolTip.desc)
        );

  return shell(
    h(
      "div",
      { className: "SPR_mapEdRoot" },
      topBar,
      openCardNode === null ? null : h("div", { className: "SPR_mapEdCardWrap" }, openCardNode),
      h(
        "div",
        { className: "SPR_mapEdBody" },
        side,
        h(
          "div",
          { className: "SPR_mapEdStage", ref: stageRef },
          canvas,
          truncated === true ? h("div", { className: "SPR_mapEdToast" }, T("缩得太小，放大一点。")) : null,
          view.busy === true ? h("div", { className: "SPR_mapEdToast", "data-busy": "true" }, T("任务进行中…")) : null
        )
      ),
      h(
        "div",
        { className: "SPR_mapEdFoot" },
        notice === null ? null : h("div", { className: `SPR_notice SPR_notice-${notice.kind}` }, notice.text),            planWarnings.length === 0
          ? null
          : h(
              "ul",
              { className: "SPR_mapEdWarnings" },
              planWarnings.map((text, index) => h("li", { key: index }, text))
            ),
        h("span", { className: "SPR_mapEdSpacer" }),
        single === true || activeLayer === null
          ? null
          : h("span", { className: "SPR_mapEdFootText" }, T("第 {n0} 层 / 共 {n1} 层", { n0: String(safeLayerIndex + 1), n1: String(layers.length) }))
      ),
      // 隐藏的图源：canvas 拿它们当 drawImage 的源（避免再建一份缓存）
      h(
        "div",
        { style: { display: "none" } },
        tilesets.map((entry) =>
          h("img", {
            key: entry.id,
            "data-tileset": entry.id,
            ref: (node) => {
              imageRefs.current[entry.id] = node;
            },
            src: `${assetBase}${entry.file}${entry.rev === undefined ? "" : `?v=${entry.rev}`}`,
            alt: "",
            onLoad: () => setImagesReady((value) => value + 1),
            // ⚠️ 只挂 onLoad 不挂 onError 的话，素材图 404 / 解码失败时
            // `imagesReady` 永远不递增，这张素材的格子**一条都不画**：
            // 画布静默空白、界面零提示（只有调试钩子的 noImage 看得到）。
            onError: () => {
              setImagesReady((value) => value + 1);
              setNotice({ kind: "error", text: T("素材图加载失败：{n0}（试试重新上传这张图）", { n0: entry.name }) });
            }
          })
        )
      ),
      toolTipNode,
      nameDialog
    )
  );
}

  return MapModule;
}
