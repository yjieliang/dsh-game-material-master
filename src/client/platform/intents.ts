/**
 * 浏览器半区 · 意图与深链接（platform/intents）。
 */

export function createIntents(deps: any) {
  // 依赖：组合根注入（先按需展开，由 tsc 报错驱动补齐）
  const {
    T,
    React,
    GAME_STUDIO_PANEL_ID,
  } = deps;

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

  return {
    OPEN_QUERY_KEY, OPEN_MODULES, OPEN_DIALOGS, OPEN_SHAPES, OPEN_ISO_SHAPES, OPEN_PARAM_KEYS, intentListeners, pendingIntent, clearPendingIntent, subscribeIntent, useStudioIntent, parseIntents, openStudioIntent, intentOfAnchor, installIntentInterceptor, consumeUrlIntent, reportClientOrigin
  };
}
