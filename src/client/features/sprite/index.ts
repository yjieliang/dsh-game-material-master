/**
 * 模块① 动画帧工具盒（sprite）—— 浏览器半区第一块 feature 切片。
 *
 * 从 src/client.ts 里整块搬出来：阶段①生图 / 阶段②视频 / 阶段③抽帧 / 阶段④合图，
 * 以及 ⑤ 行走预览。行为与拆分前一致（P3a：纯搬运），P3b 再把轮询换成
 * platform/scheduler、状态搬进 feature store。
 *
 * 约定：
 *   · 只 import platform（runtime/store/scheduler/api/errors/ui 的方向）；
 *   · 不 import 其它 features；
 *   · 依赖由组合根通过 deps 注入（与既有 createXxxModule 同形态）。
 */

import { createFeatureBoundary } from "../../platform/errors.js";
import { markRender } from "../../platform/perf.js";
import type { FeatureDeps } from "../../platform/deps.js";

export function createSprite(deps: FeatureDeps) {
  // 依赖：组合根注入（P3a 纯搬运阶段先按需展开；P3b 再收窄签名）
  const {
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
  } = deps;

  /**
   * 面板共享 store（组合根注入）：项目快照与草稿都在这里，组件按 selector 订阅。
   * 组合根的 P9 之前是面板 useState + 组件 props 下传，轮询一变就重渲染整棵子树。
   */
  const studioStore = deps.store;
  const storeActions = studioStore.actions;

  /**
   * 只比较项目快照里与「本阶段」相关的几段字段。
   *
   * selector 返回的还是同一个 project 对象，但用这个比较器把「与我没关系的变化」判成相等，
   * store 就把旧引用还回来、组件不重渲染——这就是轮询只重渲染 ≤3 个组件的关键。
   * @param a - 上一次的 project
   * @param b - 新的 project
   * @param fields - 本阶段关心的顶层字段
   */
  function projectFieldsEqual(a: any, b: any, fields: string[]): boolean {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) return false;
    for (const field of fields) {
      if (!Object.is(a[field], b[field])) return false;
    }
    return true;
  }

  /** 模块级文案表：语言切换时由 rebuildStaticText 重算。 */
  let IMAGE_MODES = make_IMAGE_MODES();

    // ── 阶段 1：八方向绿幕图 ─────────────────────────────────────────────
    /** 阶段①的 pending key：单方向、批量、整批重新生成、重置提示词。 */
    const KEY_IMG_ONE = (key) => `image:${key}`;

    const KEY_IMG_ALL = "image:*all";

    const KEY_IMG_REGENERATE = "image:*regenerate";

    const KEY_PROMPT_RESET = "prompt:*reset";

    const KEY_TURN_VIDEO = "turn:*video";

    const KEY_TURN_FRAMES = "turn:*frames";

    const KEY_TURN_PICK = (key) => `turn:pick:${key}`;

    /** 「保存全部图片（zip）」的 pending key（这条工具栏是各阶段共用的）。 */
    const KEY_EXPORT_IMAGES = "images:*zip";

    // 与宿主 src/directions.ts 的 TURN_FRAME_COUNT_MIN / _MAX 保持一致：
    // 上限是条带（单行拼图，一格 96px）的物理极限，不是产品偏好。
    const TURN_FRAME_MIN = 8;

    const TURN_FRAME_MAX = 512;

    // ── 阶段 2：视频 ─────────────────────────────────────────────────────
    const KEY_VIDEO_ONE = (key) => `video:${key}`;

    const KEY_VIDEO_ALL = "video:*all";

    const KEY_VIDEO_POLL = "video:*poll";

    // ── 阶段 3：抽帧 ─────────────────────────────────────────────────────
    const KEY_FRAMES_ONE = (key) => `frames:${key}`;

    const KEY_FRAMES_ALL = "frames:*all";

    const KEY_FRAMES_PICK = (key) => `frames:pick:${key}`;

    // ── 阶段 4：合成整图 ─────────────────────────────────────────────────
    const KEY_SHEET_COMPOSE = "sheet:compose";

    const KEY_SHEET_REKEY = "sheet:rekey";

    const KEY_SHEET_SAVE = "sheet:save";

    // ── ⑤ 行走预览：WASD / 方向键操控角色在白色区域里走 ────────────────────
    const STAGE_W = 960;

    const STAGE_H = 520;

    // ── 阶段①的另一种生成方式：转圈截帧 ──────────────────────────────────
    //
    // 逐方向生图是八次独立调用，模型每次都要重新「理解」角色，脸型/发色/服装
    // 容易在八个方向之间漂移。转圈截帧只生成**一段**「原地匀速转一整圈」的视频，
    // 八个方向是它时间轴上的八个截帧位置——八个方向天生同源，一致性最好。
    // 这条是默认路径，逐方向生图保留为备选（单张更清晰，但一致性看运气）。
    function make_IMAGE_MODES() {
      return [
      { key: "turn", title: T("转圈截帧"), hint: T("先生成一段「原地匀速转一整圈」的视频，再按时间截出八个方向（默认，一致性最好）") },
      { key: "direct", title: T("逐方向生图"), hint: T("每个方向单独生图（备选：单张更清晰，但八个方向容易不一致）") }
    ];
    }

    function imageModeOf(project) {
      if (project?.imageMode === "direct") return "direct";
      if (project?.imageMode === "turn") return "turn";
      const hasImages = DIRECTION_KEYS.some((key) => project?.images?.[key]?.file !== undefined);
      return hasImages ? "direct" : "turn";
    }

    /** 方向的短名（轴上的圆圈放不下「西南 · 四分之三正面」这种长标签）。 */
    function shortLabelOf(key) {
      const label = LABEL_OF[key] ?? key;
      return label.split(" · ")[0];
    }

    function clamp01(value) {
      return Math.min(1, Math.max(0, value));
    }

    /** 阶段①的生成方式切换条。 */
    function ImageModeBar({ api, start }) {
      markRender("SpriteImageModeBar");
      const mode = studioStore.use((state) => imageModeOf(state.project));
      const projectId = studioStore.use((state) => state.project?.id ?? null);
      return h(
        React.Fragment,
        null,
        // 设计稿：分段控件单独一行（浅色轨道 + 白色选中块）。
        h(
          "div",
          { className: "SPR_modeBar" },
          h("span", { className: "SPR_modeBarLabel" }, T("生成方式")),
          IMAGE_MODES.map((entry) =>
            h(
              "button",
              {
                key: entry.key,
                type: "button",
                className: "SPR_mode",
                "data-active": mode === entry.key ? "true" : "false",
                title: entry.hint,
                "data-testid": `image-mode-${entry.key}`,
                onClick: () =>
                  void start(() => api.setImageMode({ projectId, mode: entry.key }), { reload: true })
              },
              h("span", { className: "SPR_modeTitle" }, entry.title),
              entry.key === "turn" ? h("span", { className: "SPR_modeTag" }, T("默认")) : null
            )
          )
        ),
        // 说明文字另起一行（不塞在控件同一行里）。
        h("p", { className: "SPR_hint", style: { marginTop: 8 } }, (IMAGE_MODES.find((entry) => entry.key === mode) ?? IMAGE_MODES[0]).hint)
      );
    }

    function TurnAxis({ project, total, duration, picks, images, api, start, busy }) {
      const trackRef = React.useRef(null);
      // 拖动过程只改这份本地状态（圆圈跟着手走），松手才提交一次远程调用。
      const [drag, setDrag] = React.useState(null);
      const pickOf = (key) => {
        if (drag !== null && drag.key === key) return drag.index;
        return Math.min(total - 1, Math.max(0, Number(picks?.[key] ?? 0)));
      };
      const indexFromEvent = (event) => {
        const node = trackRef.current;
        if (node === null || total <= 0) return 0;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0) return 0;
        const fraction = clamp01((event.clientX - rect.left) / rect.width);
        return Math.min(total - 1, Math.max(0, Math.round(fraction * total - 0.5)));
      };
      const commit = (key, index) => {
        const current = Math.min(total - 1, Math.max(0, Number(picks?.[key] ?? 0)));
        if (index === current) return;
        void start(
          () => api.setTurnPick({ projectId: project.id, key, index }),
          { reload: true },
          { key: KEY_TURN_PICK(key), label: T("正在切出「{n0}」第 {n1} 帧…", { n0: LABEL_OF[key] ?? key, n1: index + 1 }) }
        );
      };
      const nudge = (key, delta) => {
        const next = Math.min(total - 1, Math.max(0, Number(picks?.[key] ?? 0) + delta));
        commit(key, next);
      };

      // 两个方向被拖到同一帧时会叠在一起，往上错一层；顺序不变，只是看起来分明。
      const lanes = {};
      const used = [];
      [...DIRECTION_KEYS]
        .map((key) => ({ key, index: pickOf(key) }))
        .sort((a, b) => a.index - b.index)
        .forEach((item) => {
          let lane = 0;
          while (used.some((slot) => slot.lane === lane && Math.abs(slot.index - item.index) < 2)) lane++;
          used.push({ lane, index: item.index });
          lanes[item.key] = lane;
        });

      return h(
        "div",
        { className: "SPR_axisWrap" },
        h(
          "div",
          {
            className: "SPR_axis",
            ref: trackRef,
            "data-dragging": drag === null ? undefined : "true",
            onPointerMove: (event) => {
              if (drag === null) return;
              const index = indexFromEvent(event);
              if (index !== drag.index) setDrag({ key: drag.key, index });
            },
            onPointerUp: (event) => {
              if (drag === null) return;
              const index = indexFromEvent(event);
              const key = drag.key;
              setDrag(null);
              commit(key, index);
            },
            onPointerLeave: () => {
              if (drag === null) return;
              setDrag(null);
            }
          },
          h("img", {
            className: "SPR_axisStrip",
            src: assetUrl(project, project.turn?.frames?.strip, project.turn?.frames?.updatedAt),
            alt: T("整圈候选帧"),
            draggable: false
          }),
          DIRECTION_KEYS.map((key) => {
            const index = pickOf(key);
            const approved = images?.[key]?.approved === true;
            const active = drag !== null && drag.key === key;
            const time = duration > 0 && total > 0 ? (index * duration) / total : 0;
            return h(
              "button",
              {
                key,
                type: "button",
                className: "SPR_axisDot",
                "data-active": active ? "true" : "false",
                "data-approved": approved ? "true" : "false",
                "data-dragging": busy === true ? "true" : undefined,
                "data-testid": `turn-dot-${key}`,
                style: { left: `${((index + 0.5) / Math.max(1, total)) * 100}%`, top: `${6 + (lanes[key] ?? 0) * 26}px` },
                title: T("{n0}：第 {n1}/{n2} 帧（{n3} 秒）— 拖动改位置，←/→ 微调", { n0: LABEL_OF[key] ?? key, n1: index + 1, n2: total, n3: time.toFixed(2) }),
                "aria-label": T("{n0} 第 {n1} 帧", { n0: LABEL_OF[key] ?? key, n1: index + 1 }),
                onPointerDown: (event) => {
                  event.preventDefault();
                  setDrag({ key, index });
                  try {
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                  } catch {
                    /* 指针捕获失败不影响拖动：move/up 挂在轴上 */
                  }
                },
                onKeyDown: (event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  nudge(key, event.key === "ArrowLeft" ? -1 : 1);
                }
              },
              h("span", { className: "SPR_axisDotLabel" }, shortLabelOf(key)),
              h("span", { className: "SPR_axisDotIndex" }, `${index + 1}`)
            );
          })
        ),
        h(
          "div",
          { className: "SPR_axisRuler" },
          h("span", null, T("0 秒")),
          h(
            "span",
            { className: "SPR_axisRulerMid" },
            total > 0
              ? T("共 {n0} 张候选帧 · 每张约 {n1} 秒 —— 拖动圆圈调整每个方向截在哪一帧", { n0: total, n1: (duration / total).toFixed(2) })
              : T("还没有候选帧：先点「生成转圈视频」，视频到手会自动抽帧")
          ),
          h("span", null, T("{n0} 秒", { n0: duration.toFixed(2) }))
        )
      );
    }

    /** 转圈截帧：转圈视频 → 候选帧 → 八圆圈时间轴 → 八张方向图。 */
    function TurnImageStage({ api, start, setNotice, tasks, savePrompts }) {
      markRender("SpriteTurnStage");
      // 只订阅转圈截帧用到的字段：别的阶段（视频/合图）变化不重渲染这一块。
      const project = studioStore.use(
        (state) => state.project,
        (a, b) => projectFieldsEqual(a, b, ["assetBase", "id", "images", "jobs", "name", "prompts", "settings", "turn", "updatedAt"])
      );
      const video = project.turn?.video ?? {};
      const frames = project.turn?.frames ?? {};
      const total = Array.isArray(frames.frames) ? frames.frames.length : 0;
      const duration = Number(frames.duration ?? 0);
      const picks = frames.picks ?? {};
      const [promptDraft, setPromptDraft] = React.useState(project.prompts?.turn ?? "");
      // 自动保存的「正在写回」标记（设计稿底注「默认提示词 · 已自动保存」的状态来源）。
      const [promptSaving, setPromptSaving] = React.useState(false);
      React.useEffect(() => {
        setPromptDraft(project.prompts?.turn ?? "");
      }, [project.prompts?.turn]);

      const videoRunning = video.status === "running" || tasks.has(KEY_TURN_VIDEO);
      const videoLabel = tasks.label(KEY_TURN_VIDEO) ?? (video.remoteStatus ?? T("正在生成转圈视频…"));
      // 「在切帧」= 本地刚点下去 / 宿主那批抽帧还在跑。抽帧是 kick 型调用，
      // 一提交就返回，真正的活（抽 32 张 + 切 8 张图）在后台，所以两者都要看。
      const hostFrames = hostJob(project, "turn:frames");
      const cutting = frames.status === "running" || tasks.has(KEY_TURN_FRAMES) || hostFrames !== undefined;
      const cutLabel = tasks.label(KEY_TURN_FRAMES) ?? (frames.status === "running" ? T("正在抽取候选帧…") : T("正在抽取候选帧并切出八个方向…"));
      const promptDirty = promptDraft !== (project.prompts?.turn ?? "");
      /**
       * 离开输入框时自动保存（设计稿底注「默认提示词 · 已自动保存」要真的成立才写）。
       * 走面板既有的 savePrompts：它会 reload，草稿和宿主值重新对齐。
       */
      const saveTurnPrompt = async () => {
        if (!promptDirty) return;
        setPromptSaving(true);
        try {
          await savePrompts({ turn: promptDraft });
        } finally {
          setPromptSaving(false);
        }
      };
      const allApproved = DIRECTION_KEYS.every((key) => project.images?.[key]?.approved);
      const readyImages = DIRECTION_KEYS.filter((key) => project.images?.[key]?.file !== undefined).length;
      const stale = frames.stale === true;

      return h(
        React.Fragment,
        null,
        // 设计稿：标题在左；输入框左侧带一条「默认提示词 · 已自动保存」的底注，离开输入框自动写回。
        h("h4", { className: "SPR_turnHeadTitle" }, T("转圈视频提示词")),
        h(
          "div",
          { className: "SPR_promptBox" },
          h("textarea", {
            className: "SPR_promptArea",
            value: promptDraft,
            "data-testid": "turn-prompt",
            onChange: (event) => setPromptDraft(event.target.value),
            onBlur: () => void saveTurnPrompt()
          }),
          h(
            "div",
            { className: "SPR_promptFoot" },
            h(
              "span",
              { className: "SPR_promptState", "data-dirty": promptDirty ? "true" : "false" },
              promptDirty ? (promptSaving ? T("正在自动保存…") : T("有未保存的改动")) : T("默认提示词 · 已自动保存")
            ),
            h(
              "button",
              {
                type: "button",
                className: "SPR_promptReset",
                onClick: () =>
                  void start(() => api.savePrompts({ projectId: project.id, resetTurnToDefault: true }), {
                    reload: true,
                    notice: T("转圈提示词已重置为默认模板"),
                    noticeKind: "ok"
                  })
              },
              T("重置为默认")
            )
          )
        ),
        // 设计稿：说明在左、两个动作右对齐。生成前先把还脏的提示词写回（否则视频会用旧提示词）。
        h(
          "div",
          { className: "SPR_turnFoot" },
          h("span", { className: "SPR_turnFootNote" }, T("预计 1 次视频调用 · 约 1–6 分钟")),
          h(
            "div",
            { className: "SPR_turnFootActions" },
            // 和远程生成**并列**的一条路：手上已经有一段原地转圈的绿幕视频时，
            // 直接选它就行——不用花那一次视频调用，导入后同样自动抽帧、切八个方向。
            h(LocalVideoPick, {
              label: T("选择本地视频"),
              title: T("用自己电脑上的一段原地转圈视频（绿幕）顶替远程生成；导入后会自动抽候选帧并切出八个方向"),
              disabled: videoRunning,
              testId: "turn-local-video",
              onFile: (file) => pickLocalVideo({ start, setNotice, api, project, key: "turn", file })
            }),
            h(
              BusyBtn,
              {
                primary: true,
                busy: tasks.has(KEY_TURN_VIDEO),
                busyText: T("正在提交…"),
                disabled: project.source === null || videoRunning,
                onClick: () =>
                  void start(
                    async () => {
                      await saveTurnPrompt();
                      return api.runTurnVideo({ projectId: project.id });
                    },
                    { reload: true },
                    { key: KEY_TURN_VIDEO, label: T("正在提交转圈视频任务…") }
                  )
              },
              video.file === undefined
                ? T("生成转圈视频（计费一次）")
                : videoRunning
                  ? T("转圈视频生成中…")
                  : T("重新生成转圈视频（计费一次）")
            )
          )
        ),
        video.file !== undefined
          ? h(
              "div",
              { className: "SPR_videoWrap" },
              h(MediaBox, {
                overlay: videoRunning,
                text: videoLabel,
                children: h("video", {
                  className: "SPR_video SPR_videoTurn",
                  src: assetUrl(project, video.file, video.updatedAt),
                  controls: true,
                  preload: "metadata",
                  "data-testid": "turn-video"
                })
              })
            )
          : h(
              "div",
              { className: "SPR_thumbEmpty", style: { aspectRatio: "16/9" } },
              videoRunning ? T("正在生成转圈视频…") : T("还没有转圈视频：点上面的「生成转圈视频」")
            ),
        video.error !== undefined ? h("p", { className: "SPR_error" }, video.error) : null,
        // 这一栏在界面上是「这段视频的来路」：本地选的视频没有输入首帧，
        // 照旧印「首帧用的是源图」会把人指向一张跟它无关的图。
        h(
          "div",
          { className: "SPR_refRow" },
          video.origin === "local"
            ? T("本地视频：{n0}（不花远程调用）", { n0: video.originalName ?? fileLabel(video.file) })
            : T("首帧用的是{n0}：{n1}", { n0: video.firstFrame !== undefined && String(video.firstFrame).startsWith("images/") ? T("已生成的正面绿幕图") : T("上传的源图"), n1: video.firstFrame ?? "—" })
        ),
        // 视频本身也是中间产物（远程生成的那次是真金白银），得能存下来。
        video.file !== undefined
          ? h(
              "div",
              { className: "SPR_btnRow", style: { marginTop: 0 } },
              h(SaveLink, {
                url: assetUrl(project, video.file, video.updatedAt),
                name: `${project.name}-turn.mp4`,
                label: T("保存视频")
              })
            )
          : null,
        // 视频到手之后才有意义的二级操作：重抽候选帧 / 重排八个圆圈 / 保存条带 / 批量通过。
        // 设计稿的首屏（还没视频）不显示这一排；换向按钮已经搬到右列「本步设置」的第二行。
        video.file !== undefined || total > 0
          ? h(
              "div",
              { className: "SPR_toolbar", style: { marginTop: 12 } },
              h(
                BusyBtn,
                {
                  busy: tasks.has(KEY_TURN_FRAMES),
                  busyText: T("正在抽帧…"),
                  disabled: video.file === undefined || cutting,
                  onClick: () =>
                    void start(() => api.runTurnFrames({ projectId: project.id }), { reload: true }, {
                      key: KEY_TURN_FRAMES,
                      label: T("正在抽取候选帧并切出八个方向…")
                    })
                },
                total > 0 ? T("重新抽帧（当前 {n0} 张）", { n0: total }) : T("抽取候选帧")
              ),
              h(
                Btn,
                {
                  disabled: total === 0 || cutting,
                  onClick: () =>
                    void start(() => api.resetTurnPicks({ projectId: project.id }), { reload: true, notice: T("八个圆圈已回到默认等分位置"), noticeKind: "ok" })
                },
                T("重置八个圆圈")
              ),
              // 条带本身就是「整圈候选帧」那张中间图，值得能单独存下来（对着它挑帧 / 发给别人看）。
              h(SaveLink, {
                url: frames.strip === undefined ? undefined : assetUrl(project, frames.strip, frames.updatedAt),
                name: `${project.name}-turn-strip.png`,
                label: T("保存条带")
              }),
              h(
                Btn,
                {
                  on: allApproved,
                  disabled: readyImages === 0,
                  onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "images", approved: !allApproved }), { reload: true })
                },
                allApproved ? T("取消全部通过") : T("全部标记通过")
              ),
              h(BusyBadge, { show: videoRunning || cutting, text: videoRunning ? videoLabel : cutLabel })
            )
          : null,
        total > 0
          ? h(TurnAxis, {
              project,
              total,
              duration,
              picks,
              images: project.images,
              api,
              start,
              busy: cutting
            })
          : h(
              "div",
              { className: "SPR_thumbEmpty", style: { marginTop: 10 } },
              cutting ? T("正在抽取候选帧…") : stale ? T("候选帧已过期（转圈视频换过了）：点「重新抽帧」") : T("还没有候选帧")
            ),
        frames.error !== undefined ? h("p", { className: "SPR_error" }, frames.error) : null,
        h(
          "div",
          { className: "SPR_grid", style: { marginTop: 12 } },
          DIRECTION_KEYS.map((key) => {
            const node = project.images?.[key];
            const index = Math.min(Math.max(0, total - 1), Math.max(0, Number(picks[key] ?? 0)));
            const queued = (tasks.has(KEY_TURN_FRAMES) || jobCovers(hostFrames, key)) && node?.status !== "error";
            const nodeBusy = node?.status === "running" || tasks.has(KEY_TURN_PICK(key)) || queued;
            const overlayText = tasks.label(KEY_TURN_PICK(key)) ?? (queued ? cutLabel : T("正在切出这一帧…"));
            return h(
              "div",
              { key, className: "SPR_node", "data-busy": nodeBusy ? "true" : undefined },
              h(
                "div",
                { className: "SPR_nodeTop" },
                h("span", { className: "SPR_nodeTitle" }, LABEL_OF[key] ?? key),
                nodeBusy ? h(Chip, { kind: "running", text: T("切帧中") }) : h(StatusChip, { node })
              ),
              node?.file !== undefined
                ? h(
                    MediaBox,
                    { overlay: nodeBusy, text: overlayText },
                    h("img", { className: "SPR_thumb", src: assetUrl(project, node.file, node.updatedAt ?? project.updatedAt), alt: LABEL_OF[key] ?? key })
                  )
                : h("div", { className: "SPR_thumbEmpty" }, nodeBusy ? T("正在切出这一帧…") : T("还没有这一方向的图")),
              node?.error !== undefined ? h("p", { className: "SPR_error" }, node.error) : null,
              h(
                "span",
                { className: "SPR_refRow" },
                total > 0
                  ? T("第 {n0}/{n1} 帧 · {n2} 秒", { n0: index + 1, n1: total, n2: ((index * duration) / Math.max(1, total)).toFixed(2) })
                  : T("等待候选帧")
              ),
              h(
                "div",
                { className: "SPR_btnRow" },
                h(
                  Btn,
                  {
                    disabled: node?.status !== "ready" || nodeBusy,
                    on: node?.approved === true,
                    onClick: () =>
                      void start(() =>
                        api.setApproved({
                          projectId: project.id,
                          stage: "images",
                          key,
                          approved: node?.approved !== true
                        }), { reload: true })
                  },
                  node?.approved === true ? T("已通过") : T("通过")
                ),
                h(SaveLink, {
                  url: node?.file === undefined ? undefined : assetUrl(project, node.file, node.updatedAt ?? project.updatedAt),
                  name: `${project.name}-${key}.png`,
                  label: T("保存"),
                  busy: nodeBusy
                })
              )
            );
          })
        )
      );
    }

    function renderImageStage(props) {
      markRender("SpriteImageStage");
      const { api, start, setNotice, savePrompts, tasks } = props;
      // 这一层只订阅「生成方式」：图片/视频产物变化不会重渲染它，只重渲染下面真正用到的那块。
      const mode = studioStore.use((state) => imageModeOf(state.project));
      return h(
        React.Fragment,
        null,
        h(ImageModeBar, { api, start }),
        // 转圈截帧（默认）：整条链路都在 TurnImageStage 里，产物同样是 images/<方向>.png。
        mode === "turn"
          ? h(TurnImageStage, { api, start, setNotice, tasks, savePrompts })
          : h(ImageDirectStage, props)
      );
    }

    /**
     * 阶段①「逐方向生图」主体：只订阅 images / prompts / source / jobs 这几段，
     * 视频阶段的字段变了不会把这块拖下水。
     */
    function ImageDirectStage(props) {
      markRender("SpriteImageDirectStage");
      const { api, start, setNotice, savePrompts, tasks } = props;
      const project = studioStore.use(
        (state) => state.project,
        (a, b) => projectFieldsEqual(a, b, ["assetBase", "id", "imageMode", "images", "jobs", "name", "prompts", "source", "updatedAt"])
      );
      const promptDraft = studioStore.use((state) => state.promptDraft);
      const promptOpen = studioStore.use((state) => state.promptOpen);
      const setPromptDraft = storeActions.setPromptDraft;
      const setPromptOpen = storeActions.setPromptOpen;
      const allApproved = DIRECTION_KEYS.every((key) => project.images?.[key]?.approved);
      // 「一键生成全部」/「全部重新生成」提交后，八个方向都可能要重出图，
      // 在宿主状态回来之前先整体盖住，别让用户以为按钮没生效。
      const batch = tasks.has(KEY_IMG_ALL) || tasks.has(KEY_IMG_REGENERATE);
      const batchLabel = tasks.label(KEY_IMG_REGENERATE) ?? tasks.label(KEY_IMG_ALL) ?? T("正在生成绿幕图…");
      // 宿主侧那批生成还在跑（一次两个方向地慢慢做）：本地 pending 只多留 700ms，
      // 撑不住整批，按钮的置灰与徽章要看宿主这张表。
      const hostAll = hostJob(project, "images:all");
      const batchBusy = batch || hostAll !== undefined;
      const resetting = tasks.has(KEY_PROMPT_RESET);

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "SPR_toolbar" },
          h(
            BusyBtn,
            {
              primary: true,
              busy: tasks.has(KEY_IMG_ALL),
              busyText: T("正在提交全部方向…"),
              // 宿主的这一批还在跑时按钮置灰：重复点只会被宿主拒绝，
              // 用户却会以为没反应（工具栏徽章已经写明在跑什么）。
              disabled: project.source === null || batchBusy,
              onClick: () =>
                void start(() => api.runImages({ projectId: project.id }), { reload: true }, {
                  key: KEY_IMG_ALL,
                  label: T("正在提交全部方向…")
                })
            },
            T("一键生成全部（跳过已通过的）")
          ),
          h(
            BusyBtn,
            {
              busy: tasks.has(KEY_IMG_REGENERATE),
              busyText: T("正在提交全部重做…"),
              disabled: batchBusy,
              onClick: () =>
                void start(() => api.runImages({ projectId: project.id, force: true }), { reload: true }, {
                  key: KEY_IMG_REGENERATE,
                  label: T("正在提交全部重做…")
                })
            },
            T("全部重新生成")
          ),
          h(
            Btn,
            {
              on: allApproved,
              disabled: batchBusy,
              onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "images", approved: !allApproved }), { reload: true })
            },
            allApproved ? T("取消全部通过") : T("全部标记通过")
          ),
          h(
            BusyBtn,
            {
              busy: resetting,
              busyText: T("正在重置…"),
              disabled: batchBusy,
              onClick: () => {
                if (typeof window !== "undefined" && !window.confirm(T("把八个方向的生图提示词和视频提示词都重置为当前默认模板？你手改过的内容会丢失。"))) return;
                void start(
                  () => api.savePrompts({ projectId: project.id, resetImagesToDefault: true, resetVideoToDefault: true }),
                  { reload: true, resetDrafts: true, notice: T("提示词已重置为默认模板"), noticeKind: "ok" },
                  { key: KEY_PROMPT_RESET, label: T("正在重置提示词…") }
                );
              }
            },
            T("重置提示词为默认")
          ),
          h(BusyBadge, { show: batchBusy, text: batchLabel }),
          project.source === null ? h("span", { className: "SPR_refRow" }, T("请先上传源图")) : null
        ),
        h(
          "div",
          { className: "SPR_grid" },
          DIRECTIONS.map((direction) => {
            const node = project.images?.[direction.key];
            const draft = promptDraft[direction.key] ?? project.prompts?.images?.[direction.key] ?? "";
            const dirty = draft !== (project.prompts?.images?.[direction.key] ?? "");
            const open = promptOpen[direction.key] === true;
            // 这个方向在跑：宿主已标 running，或刚点了按钮、状态还没轮询回来。
            const taskKey = KEY_IMG_ONE(direction.key);
            // 批量提交时，**还没轮到的方向也要盖住**——否则旧图看着像「点了没反应」。
            // 两条路：本地刚点下去（批量 key），或宿主那批任务还在跑且覆盖了这个方向。
            const waiting =
              (batch && node?.status !== "running" && !tasks.has(taskKey)) ||
              (jobCovers(hostAll, direction.key) && node?.status !== "error");
            const nodeBusy = node?.status === "running" || tasks.has(taskKey) || waiting;
            const withPromptKey = `${taskKey}:prompt`;
            const overlayText = tasks.label(taskKey) ?? (waiting ? batchLabel : T("正在生成…"));
            return h(
              "div",
              { key: direction.key, className: "SPR_node", "data-stale": node?.stale === true ? "true" : "false", "data-busy": nodeBusy ? "true" : undefined },
              h(
                "div",
                { className: "SPR_nodeTop" },
                h("span", { className: "SPR_nodeTitle" }, direction.label),
                nodeBusy ? h(Chip, { kind: "running", text: T("生成中") }) : h(StatusChip, { node })
              ),
              node?.file !== undefined
                ? h(
                    MediaBox,
                    { overlay: nodeBusy, text: overlayText },
                    h("img", {
                      className: "SPR_thumb",
                      src: assetUrl(project, node.file, node.updatedAt ?? project.updatedAt),
                      alt: direction.label
                    })
                  )
                : h(
                    "div",
                    { className: "SPR_thumbEmpty" },
                    nodeBusy ? T("正在生成…") : T("参考：{n0}", { n0: direction.refs.join(" + ") })
                  ),
              nodeBusy ? h(BusyBadge, { show: true, text: overlayText }) : null,
              node?.error !== undefined ? h("p", { className: "SPR_error" }, node.error) : null,
              node?.status === "ready" && node.elapsedMs !== undefined
                ? h("span", { className: "SPR_refRow" }, T("用时 {n0} 秒 · {n1}", { n0: (node.elapsedMs / 1000).toFixed(1), n1: node.model ?? "" }))
                : h("span", { className: "SPR_refRow" }, T("参考：{n0}", { n0: direction.refs.join(" + ") })),
              h(
                "button",
                {
                  type: "button",
                  className: "SPR_miniBtn",
                  onClick: () => setPromptOpen({ ...promptOpen, [direction.key]: !open })
                },
                open ? T("收起提示词 ▲") : T("编辑提示词 ▼")
              ),
              open
                ? h(
                    React.Fragment,
                    null,
                    h("textarea", {
                      className: "SPR_area",
                      value: draft,
                      onChange: (event) => setPromptDraft({ ...promptDraft, [direction.key]: event.target.value })
                    }),
                    h(
                      "div",
                      { className: "SPR_btnRow" },
                      h(
                        Btn,
                        {
                          disabled: !dirty,
                          onClick: () => void savePrompts({ images: { [direction.key]: draft } })
                        },
                        dirty ? T("保存改动") : T("已保存")
                      ),
                      h(
                        BusyBtn,
                        {
                          busy: tasks.has(withPromptKey),
                          busyText: T("正在提交…"),
                          onClick: () =>
                            void start(
                              () => api.runImage({ projectId: project.id, key: direction.key, prompt: draft }),
                              { reload: true },
                              { key: withPromptKey, label: T("正在用这段提示词生成「{n0}」…", { n0: direction.label }) }
                            )
                        },
                        T("用这段提示词生成")
                      )
                    )
                  )
                : null,
              h(
                "div",
                { className: "SPR_btnRow" },
                h(
                  BusyBtn,
                  {
                    primary: node?.file === undefined,
                    busy: tasks.has(taskKey),
                    busyText: T("正在提交…"),
                    onClick: () =>
                      void start(() => api.runImage({ projectId: project.id, key: direction.key }), { reload: true }, {
                        key: taskKey,
                        label: T("正在生成「{n0}」…", { n0: direction.label })
                      })
                  },
                  node?.file === undefined ? T("生成") : T("重新生成")
                ),
                h(
                  Btn,
                  {
                    on: node?.approved === true,
                    disabled: node?.status !== "ready",
                    onClick: () =>
                      void start(() =>
                        api.setApproved({
                          projectId: project.id,
                          stage: "images",
                          key: direction.key,
                          approved: node?.approved !== true
                        }), { reload: true })
                  },
                  node?.approved === true ? T("已通过") : T("通过")
                ),
                // 绿幕图是这一阶段唯一看得见的产物，直接存下来（拖进别的工具 / 存档）。
                h(SaveLink, {
                  url: node?.file === undefined ? undefined : assetUrl(project, node.file, node.updatedAt ?? project.updatedAt),
                  name: `${project.name}-${direction.key}.png`,
                  label: T("保存"),
                  busy: nodeBusy
                })
              )
            );
          })
        )
      );
    }

    function renderVideoStage(props) {
      markRender("SpriteVideoStage");
      const { savePrompts, start, setNotice, api, tasks } = props;
      const project = studioStore.use(
        (state) => state.project,
        (a, b) => projectFieldsEqual(a, b, ["assetBase", "id", "images", "jobs", "name", "prompts", "updatedAt", "videos"])
      );
      const videoPromptDraft = studioStore.use((state) => state.videoPromptDraft);
      const setVideoPromptDraft = storeActions.setVideoPromptDraft;
      const readyImages = DIRECTION_KEYS.filter((key) => project.images?.[key]?.file !== undefined);
      const promptDirty = videoPromptDraft !== (project.prompts?.video ?? "");
      const running = DIRECTION_KEYS.filter((key) => project.videos?.[key]?.status === "running");
      const allApproved = DIRECTION_KEYS.every((key) => project.videos?.[key]?.approved);
      // 宿主侧那次提交覆盖了哪些方向（批量提交是逐个方向提交的）；
      // 本地 pending 只多留 700ms，还没轮到的方向要靠它撑着。
      const hostSubmit = hostJob(project, "videos:submit");
      const submitting = tasks.any("video:*") || hostSubmit !== undefined;
      // 批量提交视频时八个方向都会重新出片，提交阶段先把预览整体盖住。
      const allBusy = tasks.has(KEY_VIDEO_ALL);
      const allLabel = tasks.label(KEY_VIDEO_ALL) ?? T("正在提交 8 个方向的视频任务…");

      return h(
        React.Fragment,
        null,
        h("p", { className: "SPR_hint" }, T("提示词要求「固定镜头、固定背景、原地走三步」。Hailuo 一段通常要 1~6 分钟，提交后可以离开这个页面。") + T("某一个方向已经有现成的行走视频（自己电脑上的文件）时，点那一格的「选择本地视频」直接用它，不必走远程生成。")),
        h("textarea", {
          className: "SPR_area",
          value: videoPromptDraft,
          onChange: (event) => setVideoPromptDraft(event.target.value)
        }),
        h(
          "div",
          { className: "SPR_toolbar" },
          h(Btn, { disabled: !promptDirty, onClick: () => void savePrompts({ video: videoPromptDraft }) }, promptDirty ? T("保存视频提示词") : T("视频提示词已保存")),
          h(
            BusyBtn,
            {
              primary: true,
              busy: tasks.has(KEY_VIDEO_ALL),
              busyText: T("正在提交 8 个方向…"),
              disabled: readyImages.length === 0 || submitting,
              onClick: () =>
                void start(() => api.runVideos({ projectId: project.id }), { reload: true }, {
                  key: KEY_VIDEO_ALL,
                  label: T("正在提交全部方向…")
                })
            },
            T("生成全部视频（{n0}/8 张绿幕图就绪）", { n0: readyImages.length })
          ),
          h(
            BusyBtn,
            {
              busy: tasks.has(KEY_VIDEO_POLL),
              busyText: T("正在查询…"),
              onClick: () =>
                void start(() => api.pollVideos({ projectId: project.id }), { reload: true }, {
                  key: KEY_VIDEO_POLL,
                  label: T("正在查询远端视频进度…")
                })
            },
            T("立即刷新进度")
          ),
          h(
            Btn,
            {
              on: allApproved,
              disabled: submitting,
              onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "videos", approved: !allApproved }), { reload: true })
            },
            allApproved ? T("取消全部通过") : T("全部标记通过")
          ),
          h(
            Btn,
            {
              danger: true,
              disabled: submitting,
              onClick: () => {
                if (typeof window !== "undefined" && !window.confirm(T("清空所有视频与已抽的帧？绿幕图会保留。"))) return;
                void start(() => api.clearVideos({ projectId: project.id }), { reload: true, notice: T("已清空视频与序列帧"), noticeKind: "ok" });
              }
            },
            T("清空视频重来")
          ),
          running.length > 0 ? h("span", { className: "SPR_refRow" }, T("{n0} 个任务进行中，界面会自动刷新", { n0: running.length })) : null
        ),
        h(
          "div",
          { className: "SPR_grid" },
          DIRECTIONS.map((direction) => {
            const video = project.videos?.[direction.key];
            const image = project.images?.[direction.key];
            const taskKey = KEY_VIDEO_ONE(direction.key);
            // 还没轮到的方向：本地批量提交（allBusy），或宿主那批提交覆盖了它。
            const waiting =
              (allBusy && video?.status !== "running" && !tasks.has(taskKey)) ||
              (jobCovers(hostSubmit, direction.key) && video?.status !== "error");
            const nodeBusy = video?.status === "running" || tasks.has(taskKey) || waiting;
            const overlayText = tasks.label(taskKey) ?? (waiting ? allLabel : T("正在生成视频…"));
            return h(
              "div",
              { key: direction.key, className: "SPR_node", "data-busy": nodeBusy ? "true" : undefined },
              h(
                "div",
                { className: "SPR_nodeTop" },
                h("span", { className: "SPR_nodeTitle" }, direction.label),
                nodeBusy ? h(Chip, { kind: "running", text: T("生成中") }) : h(StatusChip, { node: video })
              ),
              video?.file !== undefined
                ? h(
                    MediaBox,
                    { overlay: nodeBusy || waiting, text: overlayText },
                    h("video", {
                      className: "SPR_video",
                      src: assetUrl(project, video.file, video.updatedAt ?? project.updatedAt),
                      controls: true,
                      preload: "metadata"
                    })
                  )
                : image?.file !== undefined
                  ? h(
                      MediaBox,
                      { overlay: nodeBusy || waiting, text: overlayText },
                      h("img", { className: "SPR_thumb", src: assetUrl(project, image.file, image.updatedAt), alt: direction.label })
                    )
                  : h("div", { className: "SPR_thumbEmpty" }, T("还没有绿幕图")),
              nodeBusy || waiting ? h(BusyBadge, { show: true, text: overlayText }) : null,
              video?.origin === "local"
                ? h("span", { className: "SPR_refRow" }, T("本地视频：{n0}（不花远程调用）", { n0: video.originalName ?? fileLabel(video.file) }))
                : video?.remoteStatus !== undefined
                  ? h("span", { className: "SPR_refRow" }, T("远端状态：{n0}", { n0: video.remoteStatus }))
                  : null,
              video?.error !== undefined ? h("p", { className: "SPR_error" }, video.error) : null,
              h(
                "div",
                { className: "SPR_btnRow" },
                h(
                  BusyBtn,
                  {
                    primary: video?.file === undefined && image?.file !== undefined,
                    busy: tasks.has(taskKey),
                    busyText: T("正在提交…"),
                    disabled: image?.file === undefined,
                    onClick: () =>
                      void start(
                        () =>
                          api.runVideos({
                            projectId: project.id,
                            keys: [direction.key],
                            // 已经有成片时，这一次点击是「重新生成」：必须显式告诉宿主
                            // 作废旧视频与它抽出来的帧再提交。不带这个标记时宿主会把
                            // ready 的方向当成「已完成」跳过，界面只看到转一圈就结束，
                            // 真正的失败原因只留在日志里。
                            regenerate: video?.file !== undefined
                          }),
                        { reload: true },
                        {
                          key: taskKey,
                          label: T("正在生成「{n0}」视频…", { n0: direction.label })
                        }
                      )
                  },
                  video?.file === undefined ? T("生成视频") : T("重新生成")
                ),
                // 本地自选视频：和「生成视频」并列，落在**这一格**的槽位上。
                h(LocalVideoPick, {
                  label: T("选择本地视频"),
                  title: T("用自己电脑上的一段「固定镜头 + 原地走」视频顶替这一方向的远程生成；之后照旧到第 3 步抽帧"),
                  disabled: nodeBusy === true,
                  testId: `local-video-${direction.key}`,
                  onFile: (file) =>
                    pickLocalVideo({ start, setNotice, api, project, key: direction.key, file, label: direction.label })
                }),
                h(
                  Btn,
                  {
                    on: video?.approved === true,
                    disabled: video?.status !== "ready",
                    onClick: () =>
                      void start(() =>
                        api.setApproved({
                          projectId: project.id,
                          stage: "videos",
                          key: direction.key,
                          approved: video?.approved !== true
                        }), { reload: true })
                  },
                  video?.approved === true ? T("已通过") : T("通过")
                ),
                h(SaveLink, {
                  url: video?.file === undefined ? undefined : assetUrl(project, video.file, video.updatedAt ?? project.updatedAt),
                  name: `${project.name}-${direction.key}.mp4`,
                  label: T("保存视频"),
                  busy: nodeBusy
                })
              )
            );
          })
        )
      );
    }

    function FramePickAxis({ project, directionKey, total, duration, picks, api, start, busy }) {
      const trackRef = React.useRef(null);
      const [drag, setDrag] = React.useState(null);
      const pickOf = (slot) => {
        if (drag !== null && drag.slot === slot) return drag.index;
        return Math.min(total - 1, Math.max(0, Number(picks?.[slot] ?? 0)));
      };
      const indexFromEvent = (event) => {
        const node = trackRef.current;
        if (node === null || total <= 0) return 0;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0) return 0;
        const fraction = clamp01((event.clientX - rect.left) / rect.width);
        return Math.min(total - 1, Math.max(0, Math.round(fraction * total - 0.5)));
      };
      const commit = (slot, index) => {
        const current = Math.min(total - 1, Math.max(0, Number(picks?.[slot] ?? 0)));
        if (index === current) return;
        void start(
          () => api.setFramePick({ projectId: project.id, key: directionKey, slot, index }),
          { reload: true },
          { key: `frames:slot:${directionKey}:${slot}`, label: T("正在切出第 {n0} 帧…", { n0: slot + 1 }) }
        );
      };
      const nudge = (slot, delta) => {
        const next = Math.min(total - 1, Math.max(0, Number(picks?.[slot] ?? 0) + delta));
        commit(slot, next);
      };
      const lanes = {};
      const used = [];
      picks.forEach((_, slot) => {
        const index = pickOf(slot);
        let lane = 0;
        while (used.some((item) => item.lane === lane && Math.abs(item.index - index) < 2)) lane++;
        used.push({ lane, index });
        lanes[slot] = lane;
      });
      const candidates = project.frames?.[directionKey]?.candidates ?? {};
      return h(
        "div",
        { className: "SPR_axisWrap" },
        h(
          "div",
          {
            className: "SPR_axis",
            ref: trackRef,
            "data-dragging": drag === null ? undefined : "true",
            onPointerMove: (event) => {
              if (drag === null) return;
              const index = indexFromEvent(event);
              if (index !== drag.index) setDrag({ slot: drag.slot, index });
            },
            onPointerUp: (event) => {
              if (drag === null) return;
              const index = indexFromEvent(event);
              const slot = drag.slot;
              setDrag(null);
              commit(slot, index);
            },
            onPointerLeave: () => {
              if (drag === null) return;
              setDrag(null);
            }
          },
          h("img", {
            className: "SPR_axisStrip",
            src: assetUrl(project, candidates.strip, candidates.updatedAt),
            alt: T("候选帧"),
            draggable: false
          }),
          picks.map((_, slot) => {
            const index = pickOf(slot);
            const active = drag !== null && drag.slot === slot;
            const time = duration > 0 && total > 0 ? (index * duration) / total : 0;
            return h(
              "button",
              {
                key: slot,
                type: "button",
                className: "SPR_axisDot",
                "data-active": active ? "true" : "false",
                "data-testid": `frame-dot-${directionKey}-${slot}`,
                style: { left: `${((index + 0.5) / Math.max(1, total)) * 100}%`, top: `${6 + (lanes[slot] ?? 0) * 26}px` },
                title: T("第 {n0} 帧：候选第 {n1}/{n2}（{n3} 秒）— 拖动改位置，←/→ 微调", { n0: slot + 1, n1: index + 1, n2: total, n3: time.toFixed(2) }),
                "aria-label": T("第 {n0} 帧，候选第 {n1}", { n0: slot + 1, n1: index + 1 }),
                onPointerDown: (event) => {
                  if (busy === true) return;
                  event.preventDefault();
                  setDrag({ slot, index });
                  try {
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                  } catch {
                    /* 指针捕获失败不影响拖动 */
                  }
                },
                onKeyDown: (event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  nudge(slot, event.key === "ArrowLeft" ? -1 : 1);
                }
              },
              h("span", { className: "SPR_axisDotLabel" }, String(slot + 1)),
              h("span", { className: "SPR_axisDotIndex" }, String(index + 1))
            );
          })
        ),
        h(
          "div",
          { className: "SPR_axisRuler" },
          h("span", null, T("0 秒")),
          h(
            "span",
            { className: "SPR_axisRulerMid" },
            T("共 {n0} 张候选帧 · {n1} 个圆圈 —— 拖动圆圈决定每一张输出帧截在哪", { n0: total, n1: picks.length })
          ),
          h("span", null, T("{n0} 秒", { n0: duration.toFixed(2) }))
        )
      );
    }

    /**
     * 自动选帧（步态 / 周期分析）的建议卡片。
     *
     * 数据来自宿主写进候选帧的 `candidates.selection`（不是界面自己算的）：置信度、
     * 回退原因、建议帧下标都在里面。建议帧缩略图直接用候选帧原图（就是圆圈对着拖的
     * 那条条带里的格子），所以「建议」和「手改」看到的是同一批图。
     */
    function AutoPickBlock({ project, direction, api, start, tasks, candidates, total, cutting }) {
      const selection = candidates?.selection;
      if (selection === undefined || selection === null) return null;
      const picks = Array.isArray(selection.picks) ? selection.picks : [];
      const current = Array.isArray(candidates?.picks) ? candidates.picks : [];
      const applied = picks.length > 0 && picks.length === current.length && picks.every((value, index) => value === current[index]);
      const confidence = Math.round(Math.max(0, Math.min(1, Number(selection.confidence ?? 0))) * 100);
      const applyKey = `frames:auto:${direction.key}:apply`;
      const reasonText =
        selection.reason === undefined || selection.reason === ""
          ? null
          : ({
              too_few_frames: T("候选帧太少（少于 4 帧），无法分析步态"),
              empty_frames: T("多数候选帧里没有角色（alpha 为空），无法分析步态"),
              no_stride_signal: T("帧里左右脚几乎没有分开过（原地站立 / 滑步 / 单人剪影），找不到步幅信号"),
              no_period: T("自相关没有可用周期（帧数不足或步幅没有重复）"),
              low_period_confidence: T("周期相关性太低（< 0.5），不认为存在可信周期"),
              insufficient_period_pairs: T("重叠采样对不足（少于 15 对），周期不可信"),
              no_full_period: T("候选锚点后面放不下一个完整周期（视频太短 / 周期太长）"),
              phase_iou_below_min: T("相位自证不过（循环首尾姿态差得太多，不是闭合循环）"),
              half_period_not_witnessed: T("半周期没有换相位（可能是两倍周期 / 素材本来没有左右交替）"),
              period_ambiguous: T("周期不明确（疑似两倍周期，折半后也无法自证）"),
              no_valid_cycle: T("没有找到合格的循环窗口")
            } as Record<string, string>)[selection.reason] ?? T("自动选帧没有找到可信周期，已回退等分");
      return h(
        "div",
        { className: "SPR_autoPick", "data-testid": `auto-pick-${direction.key}` },
        h(
          "div",
          { className: "SPR_autoPickHead" },
          h("span", { className: "SPR_nodeTitle" }, T("自动选帧建议")),
          h(Chip, {
            kind: selection.fallback === true ? "stale" : "ready",
            text: selection.fallback === true ? T("已回退等分") : T("置信度 {n0}%", { n0: confidence })
          }),
          selection.fallback === true || !(Number(selection.period) > 0)
            ? null
            : h("span", { className: "SPR_refRow" }, T("周期 {n0} 帧 · 从第 {n1} 帧起", { n0: selection.period, n1: Number(selection.cycleStart ?? 0) + 1 }))
        ),
        reasonText === null ? null : h("p", { className: "SPR_note", "data-kind": "warn" }, reasonText),
        picks.length === 0 ? null : h("p", { className: "SPR_hint" }, T("建议帧（候选帧序号）：{n0}", { n0: picks.map((value) => value + 1).join(" / ") })),
        picks.length === 0 || total === 0
          ? null
          : h(
              "div",
              { className: "SPR_autoPickThumbs" },
              picks.map((value, slot) => {
                const file = Array.isArray(candidates.frames) ? candidates.frames[value] : undefined;
                return h(
                  "figure",
                  { className: "SPR_autoPickThumb", key: slot },
                  file === undefined ? null : h("img", { src: assetUrl(project, file, candidates.updatedAt), alt: T("建议第 {n0} 帧", { n0: slot + 1 }), loading: "lazy" }),
                  h("figcaption", null, T("第 {n0} 帧", { n0: slot + 1 }) + " · " + T("候选 {n0}", { n0: value + 1 }))
                );
              })
            ),
        h(
          "div",
          { className: "SPR_toolbar" },
          h(
            BusyBtn,
            {
              primary: applied !== true,
              busy: tasks.has(applyKey),
              busyText: T("正在按建议切帧…"),
              disabled: picks.length === 0 || applied === true || cutting === true,
              onClick: () =>
                void start(
                  () => api.applyAutoPicks({ projectId: project.id, key: direction.key, picks }),
                  { reload: true, notice: T("已按自动选帧切出 {n0} 帧", { n0: picks.length }), noticeKind: "ok" },
                  { key: applyKey, label: T("正在按建议「{n0}」切帧…", { n0: direction.label }) }
                )
            },
            applied === true ? T("已应用") : T("应用建议")
          ),
          h("span", { className: "SPR_refRow" }, applied === true ? T("当前圆圈就是这个建议，仍可拖动微调") : T("应用后仍可拖动圆圈手改；重跑视频会自动作废"))
        ),
        Array.isArray(selection.notes) && selection.notes.length > 0
          ? h(
              "ul",
              { className: "SPR_autoPickNotes" },
              selection.notes.map((line, index) => h("li", { key: index }, line))
            )
          : null
      );
    }

    function FramePickPanel({ project, direction, api, start, tasks, countDraft, setCountDraft }) {
      const node = project.frames?.[direction.key] ?? {};
      const candidates = node.candidates ?? {};
      const total = Array.isArray(candidates.frames) ? candidates.frames.length : 0;
      const duration = Number(candidates.duration ?? node.duration ?? 0);
      const picks = Array.isArray(candidates.picks) ? candidates.picks : [];
      const frameCount = Number(countDraft ?? candidates.rawFrameCount ?? 32);
      const taskKey = `frames:pick:${direction.key}`;
      const hostPick = hostJob(project, taskKey);
      const cutting = candidates.status === "running" || tasks.has(taskKey) || hostPick !== undefined;
      const video = project.videos?.[direction.key];
      return h(
        "div",
        { className: "SPR_pickPanel", "data-testid": `frame-pick-${direction.key}` },
        h(
          "div",
          { className: "SPR_pickHead" },
          h("span", { className: "SPR_nodeTitle" }, T("手动选帧 · {n0}", { n0: direction.label })),
          h("span", { className: "SPR_refRow" }, T("只影响这一段视频。圆圈个数跟「每段视频抽帧数」走，拖到哪一格就截哪一格。"))
        ),
        video?.file !== undefined
          ? h("video", {
              className: "SPR_video",
              src: assetUrl(project, video.file, video.updatedAt),
              controls: true,
              preload: "metadata"
            })
          : null,
        h(
          "div",
          { className: "SPR_toolbar" },
          h(NumField, {
            label: T("候选帧数（8~512）"),
            value: frameCount,
            min: TURN_FRAME_MIN,
            max: TURN_FRAME_MAX,
            onChange: (value) => setCountDraft(value)
          }),
          h(
            BusyBtn,
            {
              busy: tasks.has(taskKey),
              busyText: T("正在抽候选帧…"),
              disabled: cutting && !tasks.has(taskKey),
              onClick: () =>
                void start(
                  () => api.prepareFramePick({ projectId: project.id, key: direction.key, count: frameCount }),
                  { reload: true, notice: T("已按 {n0} 张候选帧重抽「{n1}」", { n0: frameCount, n1: direction.label }), noticeKind: "ok" },
                  { key: taskKey, label: T("正在抽取「{n0}」的候选帧…", { n0: direction.label }) }
                )
            },
            total > 0 ? T("重新抽取候选帧") : T("抽取候选帧")
          ),
          h(
            BusyBtn,
            {
              busy: tasks.has(`frames:slot:${direction.key}:reset`),
              busyText: T("正在重置…"),
              disabled: total === 0 || cutting,
              onClick: () =>
                void start(
                  () => api.resetFramePicks({ projectId: project.id, key: direction.key }),
                  { reload: true, notice: T("圆圈已回到等分位置"), noticeKind: "ok" },
                  { key: `frames:slot:${direction.key}:reset`, label: T("正在重置「{n0}」的选帧…", { n0: direction.label }) }
                )
            },
            T("重置为等分")
          ),
          h(
            BusyBtn,
            {
              busy: tasks.has(`frames:auto:${direction.key}`),
              busyText: T("正在分析步态…"),
              disabled: total === 0 || cutting,
              onClick: () =>
                void start(
                  () => api.autoPickFrames({ projectId: project.id, key: direction.key }),
                  { reload: true, notice: T("自动选帧完成：{n0}", { n0: direction.label }), noticeKind: "ok" },
                  { key: `frames:auto:${direction.key}`, label: T("正在分析「{n0}」的步态…", { n0: direction.label }) }
                )
            },
            T("自动选帧")
          ),
          h(BusyBadge, { show: cutting, text: tasks.label(taskKey) ?? T("正在抽取候选帧…") })
        ),
        h(AutoPickBlock, { project, direction, api, start, tasks, candidates, total, cutting }),
        total > 0
          ? h(FramePickAxis, {
              project,
              directionKey: direction.key,
              total,
              duration,
              picks,
              api,
              start,
              busy: cutting
            })
          : h("div", { className: "SPR_thumbEmpty" }, cutting ? T("正在抽取候选帧…") : T("还没有候选帧")),
        candidates.error !== undefined ? h("p", { className: "SPR_error" }, candidates.error) : null
      );
    }

    function renderFrameStage(props) {
      markRender("SpriteFrameStageRoot");
      const { start, api, saveSettings, tasks } = props;
      const project = studioStore.use(
        (state) => state.project,
        (a, b) => projectFieldsEqual(a, b, ["assetBase", "frames", "id", "jobs", "name", "settings", "updatedAt", "videos"])
      );
      const settingsDraft = studioStore.use((state) => state.settingsDraft);
      // 选帧草稿必须放在独立组件里（FrameStage）：这一层是订阅壳，只负责把
      // project / settingsDraft 这两段快照交给下面的界面。
      return h(FrameStage, { project, start, api, settingsDraft, saveSettings, tasks });
    }

    function FrameStage({ project, start, api, settingsDraft, saveSettings, tasks }) {
      markRender("SpriteFrameStage");
      const readyVideos = DIRECTION_KEYS.filter((key) => project.videos?.[key]?.file !== undefined);
      const allApproved = DIRECTION_KEYS.every((key) => project.frames?.[key]?.approved);
      const draft = settingsDraft ?? project.settings ?? {};
      // 宿主侧那次抽帧任务盖住了哪些方向。批量抽帧是「一次两个方向」慢慢做的，
      // 本地 pending 表只多留 700ms，盖不住还没轮到的那六个方向——只看它就会
      // 出现「先转圈、紧接着变回尚未抽帧、过一阵才出结果」。
      const [pickKey, setPickKey] = React.useState(null);
      const [pickCount, setPickCount] = React.useState(null);
      const hostExtract = hostJob(project, "frames:extract");
      const hostPicking = Array.isArray(project.jobs) && project.jobs.some((job) => typeof job?.key === "string" && job.key.startsWith("frames:pick:"));
      const extracting = tasks.any("frames:*") || tasks.any("frames:pick:") || hostExtract !== undefined || hostPicking;
      const batchLabel = tasks.label(KEY_FRAMES_ALL) ?? T("正在抽取全部序列帧…");

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "SPR_fields" },
          h(NumField, {
            label: T("单格宽（px）"),
            value: draft.cellWidth ?? 256,
            min: 16,
            max: 2048,
            onChange: (value) => saveSettings({ cellWidth: value })
          }),
          h(NumField, {
            label: T("单格高（px）"),
            value: draft.cellHeight ?? 256,
            min: 16,
            max: 2048,
            onChange: (value) => saveSettings({ cellHeight: value })
          }),
          h(NumField, {
            label: T("每段视频抽帧数"),
            value: draft.frameCount ?? 8,
            min: 1,
            max: 64,
            onChange: (value) => saveSettings({ frameCount: value })
          }),
          h(NumField, {
            label: T("抽帧工作尺寸（长边 px）"),
            value: draft.workingLongEdge ?? 768,
            min: 128,
            max: 2048,
            onChange: (value) => saveSettings({ workingLongEdge: value })
          }),
          h(NumField, {
            label: T("并发数"),
            value: draft.concurrency ?? 3,
            min: 1,
            max: 8,
            onChange: (value) => saveSettings({ concurrency: value })
          })
        ),
        h(
          "p",
          { className: "SPR_hint" },
          T("抽帧抽到的是「工作尺寸」（长边上限），不是最终格子尺寸。自动裁剪、统一缩放和像素量化都在第 4 步做，这样八个方向才能共享同一个裁剪框、脚底对齐同一条基线。改完这里需要重新抽帧。") +
            T("「提取全部」对每一段视频用同一套等分；要某一段单独挑帧，点那张卡片上的「手动选帧」，拖圆圈即可（和转圈截帧一样）。") +
            T("预览带是**双击看大图**：格子尺寸只有 256px，看不清动作和抠像质量。")
        ),
        h(
          "div",
          { className: "SPR_toolbar" },
          h(
            BusyBtn,
            {
              primary: true,
              busy: tasks.has(KEY_FRAMES_ALL),
              busyText: T("正在抽取全部序列帧…"),
              disabled: readyVideos.length === 0 || extracting,
              onClick: () =>
                void start(() => api.runFrames({ projectId: project.id }), { reload: true }, {
                  key: KEY_FRAMES_ALL,
                  label: T("正在抽取全部序列帧…")
                })
            },
            T("提取全部序列帧（{n0}/8 段视频就绪）", { n0: readyVideos.length })
          ),
          h(
            Btn,
            {
              on: allApproved,
              disabled: extracting,
              onClick: () => void start(() => api.setApproved({ projectId: project.id, stage: "frames", approved: !allApproved }), { reload: true })
            },
            allApproved ? T("取消全部通过") : T("全部标记通过")
          ),
          h(BusyBadge, { show: extracting, text: tasks.label(KEY_FRAMES_ALL) ?? T("正在抽帧…") })
        ),
        h(
          "div",
          { className: "SPR_grid" },
          DIRECTIONS.flatMap((direction) => {
            const node = project.frames?.[direction.key];
            const taskKey = KEY_FRAMES_ONE(direction.key);
            // 这一批还没轮到 / 产物还没出来的方向也要盖着。两条路：本地刚点下去
            // （批量 key 在远程调用返回后还会多留 700ms，覆盖「下一次轮询还没回来」
            // 的那一下），以及宿主任务表（整段任务都在）。已经报错的方向不盖，
            // 否则失败原因被遮罩挡住，看着像还在跑。
            const hostPick = hostJob(project, KEY_FRAMES_PICK(direction.key));
            const queued =
              (tasks.has(KEY_FRAMES_ALL) || jobCovers(hostExtract, direction.key) || jobCovers(hostPick, direction.key)) && node?.status !== "error";
            const nodeBusy = node?.status === "running" || tasks.has(taskKey) || tasks.has(KEY_FRAMES_PICK(direction.key)) || tasks.any(`frames:slot:${direction.key}:`) || queued;
            const overlayText = tasks.label(taskKey) ?? (queued ? batchLabel : undefined) ?? T("正在抽取序列帧…");
            return [
              h(
              "div",
              { key: direction.key, className: "SPR_node", "data-busy": nodeBusy ? "true" : undefined },
              h(
                "div",
                { className: "SPR_nodeTop" },
                h("span", { className: "SPR_nodeTitle" }, direction.label),
                nodeBusy ? h(Chip, { kind: "running", text: T("抽帧中") }) : h(StatusChip, { node })
              ),
              node?.strip !== undefined
                ? h(
                    MediaBox,
                    { overlay: nodeBusy, text: overlayText },
                    h(ZoomableImage, {
                      className: "SPR_thumb",
                      src: assetUrl(project, node.strip, node.updatedAt),
                      alt: T("{n0} 序列帧", { n0: direction.label }),
                      caption: T("{n0} · {n1} 帧 · 视频 {n2} 秒（点「×」/ 背景 / Esc 关闭）", { n0: direction.label, n1: node.frames?.length ?? 0, n2: (node.duration ?? 0).toFixed(2) })
                    })
                  )
                : h(
                    "div",
                    { className: "SPR_thumbEmpty" },
                    nodeBusy ? T("正在抽帧…") : T("尚未抽帧")
                  ),
              nodeBusy ? h(BusyBadge, { show: true, text: overlayText }) : null,
              node?.duration !== undefined
                ? h("span", { className: "SPR_refRow" }, T("{n0} 帧 · 视频 {n1} 秒", { n0: node.frames?.length ?? 0, n1: node.duration.toFixed(2) }))
                : null,
              (node?.candidates?.frames?.length ?? 0) > 0
                ? h("span", { className: "SPR_refRow" }, T("手动选帧 · {n0} 个圆圈 / {n1} 张候选", { n0: node.candidates.picks?.length ?? 0, n1: node.candidates.frames.length }))
                : null,
              node?.error !== undefined ? h("p", { className: "SPR_error" }, node.error) : null,
              h(
                "div",
                { className: "SPR_btnRow" },
                h(
                  BusyBtn,
                  {
                    primary: node?.status !== "ready",
                    busy: tasks.has(taskKey),
                    busyText: T("正在抽帧…"),
                    disabled: project.videos?.[direction.key]?.file === undefined || tasks.has(KEY_FRAMES_PICK(direction.key)) || hostPick !== undefined,
                    onClick: () =>
                      void start(() => api.runFrames({ projectId: project.id, keys: [direction.key] }), { reload: true }, {
                        key: taskKey,
                        label: T("正在抽取「{n0}」序列帧…", { n0: direction.label })
                      })
                  },
                  node?.status === "ready" ? T("重新抽帧") : T("抽取")
                ),
                h(
                  BusyBtn,
                  {
                    busy: tasks.has(KEY_FRAMES_PICK(direction.key)),
                    busyText: T("正在抽候选帧…"),
                    disabled: project.videos?.[direction.key]?.file === undefined || (nodeBusy && !tasks.has(KEY_FRAMES_PICK(direction.key))),
                    onClick: () => {
                      if (pickKey === direction.key) {
                        setPickKey(null);
                        return;
                      }
                      setPickKey(direction.key);
                      setPickCount(null);
                      const ready = (project.frames?.[direction.key]?.candidates?.frames?.length ?? 0) > 0;
                      if (!ready) {
                        void start(() => api.prepareFramePick({ projectId: project.id, key: direction.key }), { reload: true }, {
                          key: KEY_FRAMES_PICK(direction.key),
                          label: T("正在抽取「{n0}」的候选帧…", { n0: direction.label })
                        });
                      }
                    }
                  },
                  pickKey === direction.key ? T("收起选帧") : (node?.candidates?.frames?.length ?? 0) > 0 ? T("调整选帧") : T("手动选帧")
                ),
                h(
                  Btn,
                  {
                    on: node?.approved === true,
                    disabled: node?.status !== "ready",
                    onClick: () =>
                      void start(() =>
                        api.setApproved({
                          projectId: project.id,
                          stage: "frames",
                          key: direction.key,
                          approved: node?.approved !== true
                        }), { reload: true })
                  },
                  node?.approved === true ? T("已通过") : T("通过")
                ),
                // 预览带就是这一段的全部帧（绿幕原帧）；要一张一张地拿，用底部的
                // 「保存全部图片（zip）」——那里连抠像帧和候选帧一起打进去。
                h(SaveLink, {
                  url: node?.strip === undefined ? undefined : assetUrl(project, node.strip, node.updatedAt),
                  name: `${project.name}-${direction.key}-strip.png`,
                  label: T("保存预览带"),
                  busy: nodeBusy
                })
              )
            ),
            pickKey === direction.key
              ? h(FramePickPanel, {
                  key: `${direction.key}-pick`,
                  project,
                  direction,
                  api,
                  start,
                  tasks,
                  countDraft: pickCount,
                  setCountDraft: setPickCount
                })
              : null
          ].filter(Boolean);
          })
        )
      );
    }

    /**
     * 产物体检（QA）卡片：徽标 + 可展开指标表 + 报告 JSON 导出 + 重新体检。
     *
     * 数据来自宿主写在整图节点上的完整报告（project.sheet.qa）。报告里的指标
     * label 是中文（宿主日志 / 工具面用），界面这里按 key 重新映射 T()，
     * 切英文时不会露出中文。
     */
    function QACard(props) {
      markRender("SpriteQACard");
      const { qa, api, owner, assetBase, onReload } = props;
      const [open, setOpen] = React.useState(false);
      const [report, setReport] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      if (qa === undefined || qa === null) return null;
      const metrics = report !== null && Array.isArray(report.metrics) ? report.metrics : null;
      const warnCount = Number(qa.warnCount ?? 0);
      const failCount = Number(qa.failCount ?? 0);
      const verdict = qa.verdict === "fail" ? "fail" : qa.verdict === "warn" ? "warn" : "pass";
      const chipKind = verdict === "fail" ? "error" : verdict === "warn" ? "stale" : "ready";
      const badge = verdict === "fail"
        ? T("QA 失败 · {n0} 项失败", { n0: failCount })
        : verdict === "warn"
          ? T("QA · {n0} 项警告", { n0: warnCount })
          : T("QA 通过");
      const attention = Array.isArray(qa.issues) ? qa.issues : [];
      const summary = verdict === "pass"
        ? T("透明像素比例 / 边缘彩边 / 帧间一致性 / 循环缝都正常")
        : T("{n0} 项需要关注：{n1}", { n0: warnCount + failCount, n1: attention.map((issue) => qaMetricLabel(issue.code)).join("、") });
      const reportUrl = typeof assetBase === "string" && assetBase !== "" ? assetBase + "qa/report.json?download=1" : undefined;
      // 摘要里没有指标明细（设计只回 verdict + issues 前 5），展开 / 重新体检时
      // 才走 runQA 复算一次 —— 本地同步、毫秒级，不花钱。
      const loadReport = async (reloadOwner) => {
        if (typeof api?.runQA !== "function") return;
        setBusy(true);
        setError(null);
        try {
          const result = await api.runQA(owner);
          setReport(result?.report ?? null);
          if (reloadOwner === true && typeof onReload === "function") await onReload();
        } catch (failure) {
          setError(msg(failure));
        } finally {
          setBusy(false);
        }
      };
      const toggle = () => {
        const next = !open;
        setOpen(next);
        if (next && report === null && busy === false) void loadReport(false);
      };
      return h(
        "div",
        { className: "SPR_card", "data-testid": "qa-card" },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
          h("span", { className: "SPR_fieldLabel" }, T("产物体检（QA）")),
          h("span", { className: "SPR_chip", "data-kind": chipKind, "data-testid": "qa-badge" }, badge),
          h("span", { className: "SPR_hint", style: { flex: 1, minWidth: 160, margin: 0 } }, summary),
          Number(qa.sampled ?? 1) > 1 ? h("span", { className: "SPR_chip" }, T("长边降采样 ×{n0}", { n0: qa.sampled })) : null,
          h(Btn, { "data-testid": "qa-toggle", on: open, onClick: toggle }, open ? T("收起指标") : T("展开指标")),
          h(BusyBtn, { busy, busyText: T("体检中…"), disabled: busy, onClick: () => void loadReport(true), "data-testid": "qa-refresh" }, T("重新体检")),
          reportUrl === undefined ? null : h("a", { className: "SPR_btn", href: reportUrl, download: "qa-report.json", style: { textDecoration: "none" }, "data-testid": "qa-export" }, T("导出报告 JSON"))
        ),
        qa.blocked === true
          ? h("p", { className: "SPR_error" }, T("已开启「QA 不通过就阻断」：修复产物后再打通过。"))
          : null,
        open && metrics === null
          ? h("p", { className: "SPR_hint" }, busy ? T("正在计算指标…") : T("还没有指标数据，点「重新体检」重算一份"))
          : null,
        open && metrics !== null
          ? h(
              "table",
              { className: "SPR_qaTable", style: { width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 12 } },
              h(
                "thead",
                null,
                h(
                  "tr",
                  null,
                  h("th", { style: { textAlign: "left", padding: "4px 6px", color: "var(--gmm-text-3)" } }, T("指标")),
                  h("th", { style: { textAlign: "right", padding: "4px 6px", color: "var(--gmm-text-3)" } }, T("数值")),
                  h("th", { style: { textAlign: "right", padding: "4px 6px", color: "var(--gmm-text-3)" } }, T("阈值")),
                  h("th", { style: { textAlign: "right", padding: "4px 6px", color: "var(--gmm-text-3)" } }, T("判定"))
                )
              ),
              h(
                "tbody",
                null,
                metrics.map((metric, index) =>
                  h(
                    "tr",
                    { key: metric.key + "-" + index, "data-verdict": metric.verdict, style: { borderTop: "1px solid var(--gmm-line-2)" } },
                    h("td", { style: { padding: "4px 6px" } }, qaMetricLabel(metric.key)),
                    h("td", { style: { padding: "4px 6px", textAlign: "right" } }, qaMetricValueText(metric)),
                    h("td", { style: { padding: "4px 6px", textAlign: "right", color: "var(--gmm-text-3)" } }, qaMetricThresholdText(metric)),
                    h(
                      "td",
                      {
                        style: {
                          padding: "4px 6px",
                          textAlign: "right",
                          color:
                            metric.verdict === "fail"
                              ? "var(--gmm-bad)"
                              : metric.verdict === "warn"
                                ? "var(--gmm-warn, #a06a00)"
                                : "var(--gmm-text-3)"
                        }
                      },
                      qaVerdictLabel(metric.verdict)
                    )
                  )
                )
              )
            )
          : null,
        error === null ? null : h("p", { className: "SPR_error" }, error)
      );
    }

    /** 指标 key → 界面文案（报告里的中文 label 只给宿主日志 / 工具面用）。 */
    function qaMetricLabel(key) {
      switch (key) {
        case "transparentRatio": return T("透明像素占比");
        case "fringeRatio": return T("边缘彩边比例");
        case "bboxCv": return T("包围盒宽度 CV");
        case "heightCv": return T("身高 CV");
        case "headWidthCv": return T("头宽 CV");
        case "loopSeamIou": return T("循环缝 IoU");
        case "loopSeamDiff": return T("循环缝 RGB 差");
        case "centroidJitter": return T("相邻帧质心位移最大值");
        case "centroidJitterMedian": return T("相邻帧质心位移中位数");
        default: return key;
      }
    }

    /** 指标值格式化（比例转百分比、CV 带 %、IoU 三位小数）。 */
    function qaMetricValueText(metric) {
      const key = metric.key;
      if (key === "transparentRatio" || key === "fringeRatio") return (Number(metric.value) * 100).toFixed(1) + "%";
      if (key === "bboxCv" || key === "heightCv" || key === "headWidthCv") return String(metric.value) + "%";
      if (key === "loopSeamIou") return Number(metric.value).toFixed(3);
      if (key === "loopSeamDiff") return String(metric.value);
      return String(metric.value) + "px";
    }

    /** 阈值文案：上限 / 下限 / 双边区间。 */
    function qaMetricThresholdText(metric) {
      if (metric.key === "transparentRatio") {
        return T("{n0}~{n1}", { n0: (Number(metric.threshold) * 100).toFixed(0) + "%", n1: (Number(metric.thresholdMax) * 100).toFixed(0) + "%" });
      }
      if (metric.threshold === undefined || metric.threshold === null) return "—";
      if (metric.key === "fringeRatio") return T("≤ {n0}", { n0: (Number(metric.threshold) * 100).toFixed(1) + "%" });
      if (metric.comparison === "min") return T("≥ {n0}", { n0: String(metric.threshold) });
      if (metric.key === "bboxCv" || metric.key === "heightCv" || metric.key === "headWidthCv") return T("≤ {n0}", { n0: String(metric.threshold) + "%" });
      return T("≤ {n0}", { n0: String(metric.threshold) });
    }

    /** 判定文案。 */
    function qaVerdictLabel(verdict) {
      if (verdict === "fail") return T("失败");
      if (verdict === "warn") return T("警告");
      if (verdict === "pass") return T("通过");
      return T("记录");
    }

    function renderSheetStage(props) {
      markRender("SpriteSheetStage");
      const { saveSettings, start, api, tasks } = props;
      const project = studioStore.use(
        (state) => state.project,
        (a, b) => projectFieldsEqual(a, b, ["assetBase", "frames", "id", "jobs", "name", "settings", "sheet", "updatedAt"])
      );
      const settingsDraft = studioStore.use((state) => state.settingsDraft);
      const setSettingsDraft = storeActions.setSettingsDraft;
      const draft = settingsDraft ?? project.settings ?? {};
      // 用户会问「第 3 步不是已经抠过了吗」，所以这里把两处抠像的分工讲清楚：
      // 第 3 步抠的是**每个方向的预览带**（顺手把整图也合出来），第 4 步在同样的
      // 帧缓存上重抠一遍，只是为了让上面那十个参数改完立刻生效、不必重新抽帧。
      // 两处读的是同一份 raw.bin、同一套参数，所以结果永远一致。
      const rowOrder = Array.isArray(draft.rowOrder) && draft.rowOrder.length > 0 ? draft.rowOrder : DIRECTION_KEYS;
      const framesReady = DIRECTION_KEYS.filter((key) => project.frames?.[key]?.status === "ready").length;
      // 合成整图是本地 CPU 重活，宿主侧会标 running；重抠像同样走这个状态。
      const composing = project.sheet?.status === "running" || tasks.has(KEY_SHEET_COMPOSE) || tasks.has(KEY_SHEET_REKEY);
      const keyed = project.sheet?.backgroundFraction;
      const composeLabel = tasks.label(KEY_SHEET_REKEY) ?? tasks.label(KEY_SHEET_COMPOSE) ?? T("正在抠绿幕并合成整图…");

      const moveRow = (index, delta) => {
        const next = [...rowOrder];
        const target = index + delta;
        if (target < 0 || target >= next.length) return;
        const tmp = next[index];
        next[index] = next[target];
        next[target] = tmp;
        setSettingsDraft({ ...draft, rowOrder: next });
        void saveSettings({ rowOrder: next });
      };

      return h(
        React.Fragment,
        null,
        h(
          "p",
          { className: "SPR_hint" },
          T("抠像在这里会**再跑一次**：第 3 步那次抠的是每个方向的预览带（顺便把整图合出来），这里重抠是为了让下面这些参数改完立刻生效——两次读的是同一份帧缓存（raw.bin）、同一套参数，所以结果一致。") +
            T("改完参数会自动重新抠像并合成整图，不需要重新抽帧。")
        ),
        h(
          "div",
          { className: "SPR_fields" },
          h(NumField, {
            label: T("整图单格宽（px）"),
            value: draft.cellWidth ?? 256,
            min: 16,
            max: 2048,
            onChange: (value) => {
              setSettingsDraft({ ...draft, cellWidth: value });
              void saveSettings({ cellWidth: value });
            }
          }),
          h(NumField, {
            label: T("整图单格高（px）"),
            value: draft.cellHeight ?? 256,
            min: 16,
            max: 2048,
            onChange: (value) => {
              setSettingsDraft({ ...draft, cellHeight: value });
              void saveSettings({ cellHeight: value });
            }
          }),
          h(NumField, {
            label: T("像素块边长（0/1 = 关闭）"),
            value: draft.pixelSize ?? 0,
            min: 0,
            max: 32,
            onChange: (value) => setSettingsDraft({ ...draft, pixelSize: value })
          }),
          h(NumField, {
            label: T("背景分割容差（0 = 只认绿色）"),
            value: draft.bgTolerance ?? 90,
            min: 0,
            max: 120,
            onChange: (value) => setSettingsDraft({ ...draft, bgTolerance: value })
          }),
          h(NumField, {
            label: T("抠像下限（绿色优势）"),
            value: draft.keyLow ?? 14,
            min: 0,
            max: 255,
            onChange: (value) => setSettingsDraft({ ...draft, keyLow: value })
          }),
          h(NumField, {
            label: T("抠像上限（绿色优势）"),
            value: draft.keyHigh ?? 80,
            min: 1,
            max: 255,
            onChange: (value) => setSettingsDraft({ ...draft, keyHigh: value })
          }),
          h(NumField, {
            label: T("去绿溢出 0~1"),
            value: draft.despill ?? 0.65,
            min: 0,
            max: 1,
            step: 0.05,
            onChange: (value) => setSettingsDraft({ ...draft, despill: value })
          }),
          h(NumField, {
            label: T("边缘收缩（px）"),
            value: draft.edgeShrink ?? 0,
            min: 0,
            max: 8,
            onChange: (value) => setSettingsDraft({ ...draft, edgeShrink: value })
          }),
          h(NumField, {
            label: T("自动裁剪填充比例 0.5~1"),
            value: draft.fillRatio ?? 0.94,
            min: 0.5,
            max: 1,
            step: 0.02,
            onChange: (value) => setSettingsDraft({ ...draft, fillRatio: value })
          }),
          h(NumField, {
            label: T("底部留白（px）"),
            value: draft.bottomMargin ?? 2,
            min: 0,
            max: 64,
            onChange: (value) => setSettingsDraft({ ...draft, bottomMargin: value })
          }),
          h(
            "label",
            { className: "SPR_field" },
            h("span", { className: "SPR_fieldLabel" }, T("自动裁剪到角色包围盒")),
            h(
              "select",
              {
                className: "SPR_input",
                value: draft.autoCrop === false ? "off" : "on",
                onChange: (event) => {
                  const autoCrop = event.target.value === "on";
                  setSettingsDraft({ ...draft, autoCrop });
                  void saveSettings({ autoCrop });
                }
              },
              h("option", { value: "on" }, T("开启（推荐：角色填满格子，八个方向缩放一致）")),
              h("option", { value: "off" }, T("关闭（用整帧画面）"))
            )
          )
        ),
        h(
          "div",
          { className: "SPR_toolbar" },
          h(
            BusyBtn,
            {
              busy: tasks.has(KEY_SHEET_SAVE),
              busyText: T("正在保存并合成…"),
              disabled: framesReady === 0 || composing,
              onClick: () =>
                void start(
                  () => saveSettings({
                    keyLow: draft.keyLow,
                    keyHigh: draft.keyHigh,
                    despill: draft.despill,
                    bgTolerance: draft.bgTolerance,
                    edgeShrink: draft.edgeShrink,
                    pixelSize: draft.pixelSize,
                    autoCrop: draft.autoCrop !== false,
                    fillRatio: draft.fillRatio,
                    bottomMargin: draft.bottomMargin,
                    cellWidth: draft.cellWidth,
                    cellHeight: draft.cellHeight
                  }),
                  { reload: true },
                  { key: KEY_SHEET_SAVE, label: T("正在保存并重新合成…") }
                )
            },
            T("保存并重新合成")
          ),
          h(
            BusyBtn,
            {
              busy: tasks.has(KEY_SHEET_REKEY),
              busyText: T("正在重跑抠像…"),
              disabled: framesReady === 0 || composing,
              onClick: () =>
                void start(() => api.rekey({ projectId: project.id }), { reload: true }, {
                  key: KEY_SHEET_REKEY,
                  label: T("正在重跑抠像并重新合成…")
                })
            },
            T("只重跑抠像并重新合成")
          ),
          h(
            BusyBtn,
            {
              primary: true,
              busy: tasks.has(KEY_SHEET_COMPOSE),
              busyText: T("正在合成整图…"),
              disabled: framesReady === 0 || composing,
              onClick: () =>
                void start(() => api.compose({ projectId: project.id }), { reload: true }, {
                  key: KEY_SHEET_COMPOSE,
                  label: T("正在抠绿幕并合成整图…")
                })
            },
            T("合成整图（{n0}/8 组帧就绪）", { n0: framesReady })
          ),
          h(BusyBadge, { show: composing, text: composeLabel }),
          project.sheet?.file !== undefined
            ? h(
                "a",
                {
                  className: "SPR_btn",
                  href: assetUrl(project, project.sheet.file, project.sheet.generatedAt),
                  download: `${project.name}-8dir.png`,
                  style: { textDecoration: "none" },
                  "aria-disabled": composing ? "true" : undefined,
                  onClick: composing ? (event) => event.preventDefault() : undefined
                },
                T("下载整图")
              )
            : null,
          h(
            Btn,
            {
              on: project.sheet?.approved === true,
              disabled: project.sheet?.status !== "ready" || composing,
              onClick: () =>
                void start(() =>
                  api.setApproved({ projectId: project.id, stage: "sheet", approved: project.sheet?.approved !== true }), { reload: true })
            },
            project.sheet?.approved === true ? T("整图已通过") : T("整图通过")
          )
        ),
        project.sheet?.error !== undefined ? h("p", { className: "SPR_error" }, project.sheet.error) : null,
        project.qa === undefined || project.qa === null
          ? null
          : h(QACard, {
              qa: project.qa,
              api,
              owner: { projectId: project.id },
              assetBase: project.assetBase,
              onReload: () => (typeof props.loadProject === "function" ? props.loadProject(project.id) : undefined)
            }),
        h(
          "div",
          { style: { display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" } },
          h(
            "div",
            { className: "SPR_rowOrder" },
            h("span", { className: "SPR_fieldLabel" }, T("行序（第 1 行在最上方）")),
            rowOrder.map((key, index) =>
              h(
                "div",
                { key: `${key}-${index}`, className: "SPR_rowOrderItem" },
                h("span", { className: "SPR_rowOrderIdx" }, String(index + 1)),
                h("span", { className: "SPR_rowOrderName" }, LABEL_OF[key] ?? key),
                h("button", { type: "button", className: "SPR_miniBtn", disabled: index === 0 || composing, onClick: () => moveRow(index, -1) }, "↑"),
                h("button", { type: "button", className: "SPR_miniBtn", disabled: index === rowOrder.length - 1 || composing, onClick: () => moveRow(index, 1) }, "↓")
              )
            )
          ),
          h(
            "div",
            { style: { flex: 1, minWidth: 300 } },
            project.sheet?.file !== undefined
              ? h(
                  React.Fragment,
                  null,
                  h(
                    "p",
                    { className: "SPR_hint" },
                    T("输出 {n0}×{n1} 像素 · 单格 {n2}×{n3} · 每行 {n4} 帧", { n0: project.sheet.width, n1: project.sheet.height, n2: draft.cellWidth, n3: draft.cellHeight, n4: draft.frameCount ?? 8 }) +
                      (keyed === undefined ? "" : T(" · 抠掉的背景占 {n0}%", { n0: (keyed * 100).toFixed(1) })) +
                      ((project.sheet?.borderSamplesDropped ?? 0) > 0
                        ? T(" · 边框采样排除了 {n0} 个不属于背景主色的点（角色贴边）", { n0: project.sheet.borderSamplesDropped })
                        : "")
                  ),
                  h(
                    "div",
                    { className: "SPR_sheetWrap", style: { position: "relative" } },
                    h(ZoomableImage, {
                      className: "SPR_sheet",
                      src: assetUrl(project, project.sheet.file, project.sheet.generatedAt),
                      alt: T("整图"),
                      style: { visibility: composing ? "hidden" : undefined },
                      caption: T("整图 {n0}×{n1} · 单格 {n2}×{n3}（点「×」/ 背景 / Esc 关闭）", { n0: project.sheet.width, n1: project.sheet.height, n2: draft.cellWidth, n3: draft.cellHeight })
                    }),
                    h(LoadingOverlay, { show: composing, text: composeLabel, sub: T("本地抠像 + 合成，不上传") })
                  )
                )
              : h(
                  "div",
                  { style: { position: "relative", minHeight: 160 } },
                  h("p", { className: "SPR_empty" }, composing ? T("正在生成第一张整图…") : framesReady === 0 ? T("请先完成第 3 步的抽帧") : T("还没有合成整图")),
                  h(LoadingOverlay, { show: composing, text: composeLabel })
                )
          )
        )
      );
    }

    function WalkPreview(props) {
      markRender("SpriteWalkPreview");
      const project = studioStore.use(
        (state) => state.project,
        (a, b) => projectFieldsEqual(a, b, ["assetBase", "id", "name", "settings", "sheet", "updatedAt"])
      );
      const tasks = props.tasks;
      const canvasRef = React.useRef(null);
      const boxRef = React.useRef(null);
      const imgRef = React.useRef(null);
      const rafRef = React.useRef(0);
      const keysRef = React.useRef({ up: false, down: false, left: false, right: false });
      const posRef = React.useRef({ x: STAGE_W / 2, y: STAGE_H - 8, dirKey: "front", frame: 0, acc: 0 });
      const liveRef = React.useRef({ scale: 1.6, speed: 170, grid: true });
      const hudAtRef = React.useRef(0);

      const [scale, setScale] = React.useState(1.6);
      const [speed, setSpeed] = React.useState(170);
      const [animSpeed, setAnimSpeed] = React.useState(1);
      const [grid, setGrid] = React.useState(true);
      const [focused, setFocused] = React.useState(false);
      const [hud, setHud] = React.useState({ compass: "S", moving: false });

      const settings = project?.settings ?? {};
      const sheet = project?.sheet;
      const ready = sheet?.status === "ready" && typeof sheet.file === "string";

      /**
       * 切图必须按**整图自己记录的**行序与格子参数，不能按当前 settings。
       *
       * 用户改了行序（或格子尺寸）而整图还没重新合成时，两者会不一致；
       * 那时按 settings 去查行号就会切到错误的方向——表现出来正是
       * 「向北走却画了正面的图」。宿主现在会在设置变更后自动重新合成，
       * 但预览仍以整图记录为准，这样即使中途也能切对。
       */
      const sheetOrder = Array.isArray(sheet?.rowOrder) && sheet.rowOrder.length > 0 ? sheet.rowOrder.map(String) : null;
      const settingsOrder = Array.isArray(settings.rowOrder) && settings.rowOrder.length > 0 ? settings.rowOrder : DIRECTION_KEYS;
      const rowOrder = sheetOrder ?? settingsOrder;
      const cellWidth = Number.isFinite(sheet?.cellWidth) ? sheet.cellWidth : settings.cellWidth ?? 256;
      const cellHeight = Number.isFinite(sheet?.cellHeight) ? sheet.cellHeight : settings.cellHeight ?? 256;
      const frameCount = Math.max(1, Number.isFinite(sheet?.frameCount) ? sheet.frameCount : settings.frameCount ?? 8);
      const sheetUrl = ready ? `${project.assetBase}${sheet.file}?v=${sheet.generatedAt ?? 0}` : null;
      const rowKey = rowOrder.join(",");
      // 整图的行序和当前设置对不上 → 说明刚改过、正在重新合成
      const orderStale = sheetOrder !== null && sheetOrder.join(",") !== settingsOrder.join(",");
      // 整图正在重新合成 / 正在换新图：预览上的画面已经不是当前设置的了。
      const rebuilding =
        sheet?.status === "running" ||
        tasks?.has(KEY_SHEET_COMPOSE) === true ||
        tasks?.has(KEY_SHEET_REKEY) === true ||
        tasks?.has(KEY_SHEET_SAVE) === true;
      const rebuildingText = tasks?.label(KEY_SHEET_REKEY) ?? tasks?.label(KEY_SHEET_COMPOSE) ?? T("正在重新合成整图…");
      const [sheetLoaded, setSheetLoaded] = React.useState(false);

      liveRef.current.scale = scale;
      liveRef.current.speed = speed;
      liveRef.current.animSpeed = animSpeed;
      liveRef.current.grid = grid;

      // 整图加载（带版本号，重新合成后自动换新图）
      React.useEffect(() => {
        setSheetLoaded(false);
        if (sheetUrl === null) {
          imgRef.current = null;
          return undefined;
        }
        let cancelled = false;
        const image = new Image();
        image.onload = () => {
          if (cancelled) return;
          imgRef.current = image;
          setSheetLoaded(true);
        };
        image.src = sheetUrl;
        return () => {
          cancelled = true;
          imgRef.current = null;
        };
      }, [sheetUrl]);

      // 主循环
      React.useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas === null) return undefined;
        const g = canvas.getContext("2d");
        let last = performance.now();

        const tick = (now) => {
          rafRef.current = requestAnimationFrame(tick);
          const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
          last = now;

          const live = liveRef.current;
          const keys = keysRef.current;
          const pos = posRef.current;
          const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
          const dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
          const moving = dx !== 0 || dy !== 0;

          const spriteW = Math.max(16, cellWidth * live.scale);
          const spriteH = Math.max(16, cellHeight * live.scale);

          if (moving) {
            const next = directionKeyFor(dx, dy);
            if (next !== null) pos.dirKey = next;
            const length = Math.hypot(dx, dy);
            const distance = live.speed * dt;
            pos.x += (dx / length) * distance;
            pos.y += (dy / length) * distance;
            // 帧推进按**走过的距离**而不是时间，步频才和移动速度对得上。
            // 「播放速度」只缩放这个阈值——值越大，同样距离里翻过的帧越多，
            // 也就是步子迈得更快，但角色本身的移动速度完全不受影响。
            pos.acc += distance;
            const perFrame = Math.max(2, (cellWidth * 0.16) / Math.max(0.1, live.animSpeed));
            while (pos.acc >= perFrame) {
              pos.acc -= perFrame;
              pos.frame = (pos.frame + 1) % frameCount;
            }
          } else {
            pos.frame = 0;
            pos.acc = 0;
          }

          // 以「脚底中心」为锚点，限制在白色区域里
          pos.x = Math.min(STAGE_W - spriteW / 2, Math.max(spriteW / 2, pos.x));
          pos.y = Math.min(STAGE_H - 4, Math.max(spriteH, pos.y));

          g.fillStyle = "#ffffff";
          g.fillRect(0, 0, STAGE_W, STAGE_H);
          if (live.grid) {
            g.strokeStyle = "rgba(0,0,0,0.06)";
            g.lineWidth = 1;
            g.beginPath();
            for (let x = 0; x <= STAGE_W; x += 40) {
              g.moveTo(x + 0.5, 0);
              g.lineTo(x + 0.5, STAGE_H);
            }
            for (let y = 0; y <= STAGE_H; y += 40) {
              g.moveTo(0, y + 0.5);
              g.lineTo(STAGE_W, y + 0.5);
            }
            g.stroke();
          }

          const image = imgRef.current;
          const row = rowOrder.indexOf(pos.dirKey);
          if (image !== null && row >= 0) {
            g.imageSmoothingEnabled = false;
            g.drawImage(
              image,
              pos.frame * cellWidth,
              row * cellHeight,
              cellWidth,
              cellHeight,
              Math.round(pos.x - spriteW / 2),
              Math.round(pos.y - spriteH),
              spriteW,
              spriteH
            );
          }

          if (now - hudAtRef.current > 150) {
            hudAtRef.current = now;
            setHud({ compass: COMPASS_OF[pos.dirKey] ?? pos.dirKey, moving });
          }
        };

        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
      }, [sheetUrl, rowKey, cellWidth, cellHeight, frameCount]);

      const handleKey = (down) => (event) => {
        const axis = KEY_AXIS[event.key.toLowerCase()];
        if (axis === undefined) return;
        event.preventDefault();
        keysRef.current[axis] = down;
      };

      const reset = () => {
        posRef.current = { x: STAGE_W / 2, y: STAGE_H - 8, dirKey: "front", frame: 0, acc: 0 };
        keysRef.current = { up: false, down: false, left: false, right: false };
      };

      if (!ready) {
        return h(
          "p",
          { className: "SPR_empty" },
          T("还没有可播放的整图。先完成第 ④ 步合成，再回到这里用 WASD 走一走。")
        );
      }

      return h(
        React.Fragment,
        null,
        h(
          "div",
          { className: "SPR_fields" },
          h(NumField, {
            label: T("角色缩放倍率"),
            value: scale,
            min: 0.3,
            max: 4,
            step: 0.1,
            onChange: setScale
          }),
          h(NumField, {
            label: T("移动速度（像素/秒）"),
            value: speed,
            min: 40,
            max: 600,
            step: 10,
            onChange: setSpeed
          }),
          h(NumField, {
            label: T("播放速度（倍，只影响步频）"),
            value: animSpeed,
            min: 0.25,
            max: 4,
            step: 0.25,
            onChange: setAnimSpeed
          }),
          h(
            "label",
            { className: "SPR_field" },
            h("span", { className: "SPR_fieldLabel" }, T("背景参考网格")),
            h(
              "select",
              { className: "SPR_input", value: grid ? "on" : "off", onChange: (event) => setGrid(event.target.value === "on") },
              h("option", { value: "on" }, T("显示（更容易看出在移动）")),
              h("option", { value: "off" }, T("关闭（纯白）"))
            )
          )
        ),
        h(
          "div",
          { className: "SPR_toolbar" },
          h(Btn, { onClick: reset }, T("回到中间")),
          h(
            "span",
            { className: "SPR_refRow" },
            T("当前朝向：{n0}（{n1}） · {n2}", { n0: hud.compass, n1: LABEL_OF[posRef.current.dirKey] ?? "", n2: hud.moving ? T("行走中") : T("站立") })
          ),
          orderStale
            ? h("span", { className: "SPR_refRow" }, T("· 整图是按旧行序生成的，正在重新合成…"))
            : null,
          h("span", { className: "SPR_spacer" }),
          h("span", { className: "SPR_refRow" }, focused ? T("已获得键盘焦点") : T("点击画面后即可操控"))
        ),
        h(
          "div",
          {
            ref: boxRef,
            className: "SPR_stage",
            "data-focused": focused ? "true" : "false",
            tabIndex: 0,
            onClick: () => {
              if (boxRef.current !== null) boxRef.current.focus();
            },
            onFocus: () => setFocused(true),
            onBlur: () => {
              setFocused(false);
              keysRef.current = { up: false, down: false, left: false, right: false };
            },
            onKeyDown: handleKey(true),
            onKeyUp: handleKey(false)
          },
          h("canvas", { ref: canvasRef, className: "SPR_canvas", width: STAGE_W, height: STAGE_H }),
          focused ? null : h("div", { className: "SPR_stageHint" }, T("点击这里，然后用 WASD 或 ↑↓←→ 操控角色")),
          h(LoadingOverlay, {
            show: rebuilding || (ready && !sheetLoaded),
            text: rebuilding ? rebuildingText : T("正在载入整图…")
          }),
          h(
            "div",
            { className: "SPR_hud" },
            h("span", { className: "SPR_hudDir" }, hud.compass),
            h("span", null, hud.moving ? T("行走") : T("站立"))
          )
        ),
        h(
          "p",
          { className: "SPR_hint" },
          T("方向按屏幕方位映射：按 ↑ 向北走（背对镜头）、↓ 向南走（正对镜头）、← 向西、→ 向东；斜向同时按两个键。"),
          h("br"),
          T("「播放速度」只改步频快慢，不影响角色移动速度；「移动速度」只改走得多快，不影响动画帧率。切图用的是整图自己记录的行序，所以改完行序即使还没重新合成，预览也不会取错方向。")
        )
      );
    }


  /** 语言切换时重算本模块的模块级文案表（由 client.ts 的 staticTextRebuilders 调用）。 */
  function rebuildStaticText(): any {
    IMAGE_MODES = make_IMAGE_MODES();
    return IMAGE_MODES;
  }

  // 错误隔离：四个阶段的渲染结果都套一层边界，单阶段抛错时只降级这一块。
  const SpriteBoundary = createFeatureBoundary({ name: "sprite" });
  const protect = (render: any) => (ctx: any) => h(SpriteBoundary, null, render(ctx));

  return {
    rebuildStaticText,
    IMAGE_MODES: () => IMAGE_MODES,
    KEY_IMG_ONE, KEY_IMG_ALL, KEY_IMG_REGENERATE, KEY_PROMPT_RESET, KEY_TURN_VIDEO, KEY_TURN_FRAMES, KEY_TURN_PICK, KEY_EXPORT_IMAGES, TURN_FRAME_MIN, TURN_FRAME_MAX, KEY_VIDEO_ONE, KEY_VIDEO_ALL, KEY_VIDEO_POLL, KEY_FRAMES_ONE, KEY_FRAMES_ALL, KEY_FRAMES_PICK, KEY_SHEET_COMPOSE, KEY_SHEET_REKEY, KEY_SHEET_SAVE, STAGE_W, STAGE_H, imageModeOf, shortLabelOf, clamp01, ImageModeBar, TurnAxis, TurnImageStage, renderImageStage, renderVideoStage, FramePickAxis, FramePickPanel, renderFrameStage, FrameStage, renderSheetStage, WalkPreview
  };
}
