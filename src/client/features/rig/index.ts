/**
 * 模块④ 骨骼动画（rig）—— 浏览器半区第二块 feature 切片。
 *
 * 从 src/client.ts 整块搬出：8 个面板（部件 / 语义 / 骨骼 / 动画 / 时间线 / QA / 约束 / 网格 / 路径 /
 * 贴图 / 装配）+ 实验性弹窗 + 若干模块级文案表与常量。P4a 是纯搬运，行为不变。
 *
 * 约定：只 import platform；不 import 其它 features；依赖由组合根注入。
 */

import { createRigModule } from "../../rig-module.js";
import { createFeatureBoundary } from "../../platform/errors.js";

export function createRig(deps: any) {
  // 依赖：组合根注入（P4a 纯搬运阶段先按需展开）
  const {
    T, React, h,
    Btn, StatusChip, NumField, BusyBtn, Chip,
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
  } = deps;

  /** 重算本模块的模块级文案表（语言切换时由 client.ts 的 staticTextRebuilders 调用）。 */
  function rebuildStaticText(): void {
    RIG_EXPERIMENTAL_POINTS = make_RIG_EXPERIMENTAL_POINTS();
    RIG_ROLES = make_RIG_ROLES();
    RIG_STAGES = make_RIG_STAGES();
    RIG_BUSY_LABEL = make_RIG_BUSY_LABEL();
    TRACK_LABELS = make_TRACK_LABELS();
    EASING_PRESETS = make_EASING_PRESETS();
  }

    /** 内置动画预设（与宿主 src/spine.ts 的 RIG_ANIMATIONS 一致）。 */
    const RIG_ANIMATIONS = ["idle", "walk", "run", "wave", "jump", "attack"];

    function make_RIG_ROLES() {
      return [
      { key: "head", label: T("头部") },
      { key: "neck", label: T("脖子") },
      { key: "torso", label: T("躯干") },
      { key: "hip", label: T("胯部") },
      { key: "upperArm", label: T("上臂") },
      { key: "lowerArm", label: T("小臂") },
      { key: "hand", label: T("手") },
      { key: "upperLeg", label: T("大腿") },
      { key: "lowerLeg", label: T("小腿") },
      { key: "foot", label: T("脚") },
      { key: "hair", label: T("头发") },
      { key: "cloth", label: T("衣料") },
      { key: "accessory", label: T("配饰") },
      { key: "weapon", label: T("武器") }
    ];
    }

    let RIG_ROLES = make_RIG_ROLES();

    function make_RIG_STAGES() {
      return [
      { key: "parts", title: T("① 拆件"), hint: T("生图模型把角色拆成独立部件（这一步花钱，只跑一次；也可以直接上传部件 PNG）") },
      { key: "layout", title: T("② 装配定位"), hint: T("把部件摆回参考姿态；本地计算，免费，可以逐件重跑或手工拖动") },
      { key: "rig", title: T("③ 骨骼与动画"), hint: T("自动推骨骼层级 + 待机/行走/奔跑/挥手/跳跃/攻击，直接播放验收") },
      { key: "atlas", title: T("④ 图集"), hint: T("打包成 Spine 纹理图集（.png + .atlas），可直接导入引擎") }
    ];
    }

    let RIG_STAGES = make_RIG_STAGES();

    const K_RIG_JOB = "rig:job";

    const K_RIG_SHEET = "rig:sheet";

    const K_RIG_SEGMENT = "rig:segment";

    /** 拆件质检：与分割共用一把锁（两者都在部件刚建出来之后跑）。 */
    const K_RIG_QA = K_RIG_SEGMENT;

    const K_RIG_LAYOUT = "rig:layout";

    const K_RIG_BONES = "rig:bones";

    const K_RIG_ATLAS = "rig:atlas";

    const K_RIG_CREATE = "rig:create";

    /** AI 逐部件重绘（花钱，几十秒）。 */
    const K_RIG_REDRAW = "rig:redraw";

    /** 后台任务的 pending 文案：宿主在跑什么，界面就直说什么。 */
    function make_RIG_BUSY_LABEL() {
      return {
      [K_RIG_JOB]: T("正在刷新…"),
      [K_RIG_SHEET]: T("正在拆件生图…"),
      [K_RIG_SEGMENT]: T("正在分割部件…"),
      [K_RIG_LAYOUT]: T("正在装配定位…"),
      [K_RIG_BONES]: T("正在生成骨骼…"),
      [K_RIG_ATLAS]: T("正在打包图集…"),
      [K_RIG_REDRAW]: T("正在重绘部件…"),
      [K_RIG_CREATE]: T("正在创建任务…")
    };
    }

    let RIG_BUSY_LABEL = make_RIG_BUSY_LABEL();

    function rigStageOf(job, key) {
      return (job.stages ?? []).find((entry) => entry.stage === key) ?? { stage: key, status: "empty" };
    }

    /** 关键帧里每种轨道要编辑哪些数值字段（简写里旋转叫 `angle`）。 */
    const TRACK_VALUE_KEYS = { rotate: ["angle"], translate: ["x", "y"], scale: ["x", "y"] };

    function make_TRACK_LABELS() {
      return { rotate: T("旋转"), translate: T("位移"), scale: T("缩放") };
    }

    let TRACK_LABELS = make_TRACK_LABELS();

    /** 缓动预设。控制点是**归一化**的 4 个数（首尾锚点隐含为 0,0 / 1,1）。 */
    function make_EASING_PRESETS() {
      return [
      { id: "linear", label: T("线性"), curve: null },
      { id: "ease", label: "Ease", curve: [0.25, 0, 0.75, 1] },
      { id: "in", label: "EaseIn", curve: [0.42, 0, 1, 1] },
      { id: "out", label: "EaseOut", curve: [0, 0, 0.58, 1] },
      { id: "fast", label: "EaseFast", curve: [0.4, 0, 0.2, 1] },
      { id: "step", label: T("阶跃"), curve: "stepped" }
    ];
    }

    let EASING_PRESETS = make_EASING_PRESETS();

    function easingNameOf(curve) {
      if (curve === "stepped") return "step";
      if (curve === null || curve === undefined) return "linear";
      const found = EASING_PRESETS.find(
        (preset) => Array.isArray(preset.curve) && preset.curve.length === 4 &&
          preset.curve.every((value, index) => Math.abs(value - curve[index]) < 1e-6)
      );
      return found === undefined ? "custom" : found.id;
    }

    /** 在一条时间轴上按线性插值取某一时刻的值（用于「在空处加帧」时的初值）。 */
    function sampleTrack(frames, time, keys) {
      if (frames.length === 0) return null;
      if (time <= frames[0].time) return { ...frames[0] };
      const last = frames[frames.length - 1];
      if (time >= last.time) return { ...last };
      for (let i = 0; i + 1 < frames.length; i++) {
        const a = frames[i];
        const b = frames[i + 1];
        if (time < a.time || time > b.time) continue;
        const span = b.time - a.time;
        const t = span <= 0 ? 0 : (time - a.time) / span;
        const frame = { time, curve: b.curve ?? null };
        for (const key of keys) frame[key] = Number(((a[key] ?? 0) + ((b[key] ?? 0) - (a[key] ?? 0)) * t).toFixed(4));
        return frame;
      }
      return { ...last };
    }

    /** 换色草稿的默认值（1 = 原样）。 */
    const IDENTITY_TINT = { hue: 0, saturation: 1, lightness: 0, brightness: 0, contrast: 1 };

    /** 把换色草稿表达成 CSS filter，用在缩略图上做**即时预览**。 */
    function tintToCssFilter(tint) {
      const parts = [];
      if (tint.hue) parts.push(`hue-rotate(${tint.hue}deg)`);
      if (tint.saturation !== 1) parts.push(`saturate(${tint.saturation})`);
      if (tint.brightness) parts.push(`brightness(${1 + tint.brightness})`);
      if (tint.contrast !== 1) parts.push(`contrast(${tint.contrast})`);
      return parts.length === 0 ? undefined : parts.join(" ");
    }

    /** 把草稿说成人话，写进版本的 note（回退时能看懂哪一版是什么）。 */
    function describeTint(tint) {
      const bits = [];
      if (tint.hue) bits.push(T("色相{n0}{n1}°", { n0: tint.hue > 0 ? "+" : "", n1: tint.hue }));
      if (tint.saturation !== 1) bits.push(T("饱和×{n0}", { n0: tint.saturation }));
      if (tint.lightness) bits.push(T("明度{n0}{n1}", { n0: tint.lightness > 0 ? "+" : "", n1: tint.lightness }));
      if (tint.brightness) bits.push(T("亮度{n0}{n1}", { n0: tint.brightness > 0 ? "+" : "", n1: tint.brightness }));
      if (tint.contrast !== 1) bits.push(T("对比×{n0}", { n0: tint.contrast }));
      return bits.join(" ") || T("换色");
    }

    function noteSuffix(note) {
      return typeof note === "string" && note.trim() !== "" ? ` · ${note}` : "";
    }

    /** 装配台的缩放范围与每档滚轮的倍率。 */
    const RIG_ZOOM_MIN = 0.25;

    const RIG_ZOOM_MAX = 6;

    const RIG_ZOOM_STEP = 1.12;

    const RIG_HANDLES = [      ["nw", 0, 0], ["n", 0.5, 0], ["ne", 1, 0],
      ["e", 1, 0.5], ["se", 1, 1], ["s", 0.5, 1],
      ["sw", 0, 1], ["w", 0, 0.5]
    ];

    const RIG_SNAP_PX = 6;

    /** 部件还没有任何摆放记录时，按它的原始像素尺寸 × 全局缩放先验给一个默认框。 */
    function defaultItemOf(part: any, hint: number): any {
      const width = Math.max(4, Math.round((part.width ?? 64) * hint));
      const height = Math.max(4, Math.round((part.height ?? 64) * hint));
      return { x: 0, y: 0, width, height, rotation: 0, z: 0, matched: true, manual: false };
    }

    const experimentalGateMuted = { rig: false, tile: false };

    function ExperimentalDialog({ moduleKey, title, ariaLabel, points, onClose }) {
      const [mute, setMute] = React.useState(false);
      const close = React.useCallback(() => {
        if (mute) experimentalGateMuted[moduleKey] = true;
        onClose();
      }, [mute, moduleKey, onClose]);

      // Esc 关闭：弹窗盖住整个工作台，键盘退出是最低限度的礼貌。
      React.useEffect(() => {
        if (typeof window === "undefined") return undefined;
        const onKey = (event) => {
          if (event.key === "Escape") close();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [close]);

      return h(
        "div",
        {
          className: "SPR_gateMask",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": ariaLabel,
          onClick: close
        },
        h(
          "div",
          { className: "SPR_gate", onClick: (event) => event.stopPropagation() },
          h(
            "div",
            { className: "SPR_gateHead" },
            h("span", { className: "SPR_expTag" }, T("实验性")),
            h("span", { className: "SPR_gateTitle" }, title)
          ),
          points.map((text, index) => h("p", { key: index, className: "SPR_gateBody" }, text)),
          h(
            "a",
            { className: "SPR_link", href: EXPERIMENTAL_REPO, target: "_blank", rel: "noreferrer" },
            EXPERIMENTAL_REPO
          ),
          h(
            "div",
            { className: "SPR_gateFoot" },
            h(
              "label",
              { className: "SPR_gateMute" },
              h("input", { type: "checkbox", checked: mute, onChange: (event) => setMute(event.target.checked) }),
              T("本次会话不再提示")
            ),
            h(
              "a",
              { className: "SPR_btn", href: EXPERIMENTAL_REPO, target: "_blank", rel: "noreferrer" },
              T("去 GitHub 仓库")
            ),
            h(Btn, { onClick: close, primary: true, "data-testid": "rig-experimental-ok" }, T("我知道了"))
          )
        )
      );
    }

    /** 模块内常驻的实验性提示条：弹窗关掉之后，标记不能跟着消失。 */
    function ExperimentalBar() {
      return h(
        "div",
        { className: "SPR_expBar" },
        h("span", { className: "SPR_expTag" }, T("实验性")),
        h("span", { className: "SPR_expBarText" }, T("该模块功能尚不完善，仍在开发中；若你需要它，欢迎到")),
        h(
          "a",
          { className: "SPR_link", href: EXPERIMENTAL_REPO, target: "_blank", rel: "noreferrer" },
          T("GitHub 仓库")
        ),
        h("span", { className: "SPR_expBarText" }, T("一起开发。"))
      );
    }

    /** 进入模块④时的实验性说明弹窗（骨骼动画）。 */
    function RigExperimentalDialog({ onClose }) {
      return h(ExperimentalDialog, {
        moduleKey: "rig",
        title: T("骨骼动画生成仍在开发中"),
        ariaLabel: T("骨骼动画生成（实验性）"),
        points: RIG_EXPERIMENTAL_POINTS,
        onClose
      });
    }

    const EXPERIMENTAL_REPO = "https://github.com/universe-st/dsh-game-material-master";

    /** 模块④「骨骼动画生成」的实验性说明。 */
    function make_RIG_EXPERIMENTAL_POINTS() {
      return [
      T("功能还不完善：拆件质量取决于生图模型，自动装配与骨骼推导对真实立绘经常需要人工校正，导出的 Spine / DragonBones 产物也还没经足够的引擎侧验证。"),
      T("流程本身能走通（拆件 → 装配 → 骨骼 → 图集，每一步都有手工兜底），但请预期会出现需要反复调整的情况，暂时别把它当成稳定功能用。"),
      T("发现问题或有改进想法，欢迎到 GitHub 仓库一起开发。")
    ];
    }

    let RIG_EXPERIMENTAL_POINTS = make_RIG_EXPERIMENTAL_POINTS();

    /** 部件卡片：逐件验收 / 隐藏 / 删除 / 重新定位。 */
    function RigPartCard({ part, busy, onApprove, onHide, onRemove, onRetry, onSelect, onRename, selected }) {
      return h(
        "div",
        { className: "SPR_rigCard", "data-approved": part.approved === true ? "true" : undefined, "data-hidden": part.hidden === true ? "true" : undefined },
        h(
          "div",
          { className: "SPR_rigCardName" },
          h("span", null, part.label ?? part.name),
          h(StatusChip, { node: part })
        ),
        part.url !== null && part.url !== undefined ? h("img", { className: "SPR_rigCardImg", src: part.url, alt: part.name }) : null,
        h(
          "div",
          { className: "SPR_rigCardMeta" },
          `${part.width ?? "?"}×${part.height ?? "?"}`,
          part.placed ? T(" · 已定位") : part.status === "ready" ? T(" · 未定位") : "",
          typeof part.score === "number" ? T(" · 相似度 {n0}", { n0: part.score }) : "",
          part.manual ? T(" · 手工调整") : ""
        ),
        // 低置信度必须一眼可见：平涂/低细节美术上，模板匹配很难分辨形状相同的
        // 部件（左右肢、同色衣料），自动结果只是初值，要提醒用户逐个核对。
        part.status === "ready" && (part.placed !== true || (typeof part.score === "number" && part.score < 0.5))
          ? h("div", { className: "SPR_rigCardMeta", style: { color: "var(--dsw-alias-state-warning-primary, #b45309)" } },
              part.placed !== true ? T("自动定位没找到，请手工拖到正确位置") : T("相似度偏低，建议核对或拖一下"))
          : null,
        part.error ? h("div", { className: "SPR_rigCardMeta", style: { color: "var(--dsw-alias-state-error-primary)" } }, part.error) : null,
        h(
          "div",
          { className: "SPR_rigCardBtns" },
          h(Btn, { onClick: onSelect, on: selected }, T("选中")),
          h(Btn, { onClick: onApprove, on: part.approved === true }, part.approved ? T("已通过") : T("通过")),
          h(Btn, { onClick: onRetry, disabled: busy || part.status !== "ready" }, T("重新定位")),
          h(Btn, { onClick: onRename }, T("改名")),
          h(Btn, { onClick: onHide }, part.hidden ? T("取消隐藏") : T("隐藏")),
          h(Btn, { onClick: onRemove, danger: true }, T("删除"))
        )
      );
    }

    function RigSemanticsPanel({ job, api, run, activeKey }) {
      const parts = (job.parts ?? []).filter((part) => part.status === "ready");
      if (parts.length === 0) return null;
      const sem = job.semantics ?? { errors: [], warnings: [], ok: true, ready: false, confirmed: false, count: 0 };
      const names = parts.map((part) => part.name);

      const patch = (name, fields) =>
        void run(
          async () => {
            const result = await api.setRigSemantics({ jobId: job.id, parts: [{ name, ...fields }], by: "human" });
            if (result?.ok === false) {
              throw new Error((result.errors ?? []).map((issue) => issue.message).join("；") || T("语义校验失败"));
            }
            return result;
          },
          T("已更新「{n0}」的语义", { n0: name }),
          activeKey
        );

      const anchorField = (part, key, index) =>
        h(NumField, {
          key: `${part.name}:${key}:${index}`,
          label: T("{n0}{n1}", { n0: key === "proximal" ? T("近端") : T("远端"), n1: index === 0 ? "x" : "y" }),
          value: (part[key] ?? [0, 0])[index],
          min: 0,
          max: 1,
          step: 0.05,
          onChange: (value) => {
            const next = [ (part[key] ?? [0, 0])[0], (part[key] ?? [0, 0])[1] ];
            next[index] = value;
            patch(part.name, { [key]: next });
          }
        });

      return h(
        "div",
        { className: "SPR_rigStage", "data-testid": "rig-semantics", style: { marginTop: 12 } },
        h(
          "div",
          { className: "SPR_rigStageHead" },
          h("span", { className: "SPR_rigStageHint", style: { flex: 1 } },
            T("语义（角色 / 父级 / 锚点）：决定骨骼挂在谁身上、骨骼从部件的哪一端伸到哪一端。改这里不会动②里已经摆好的位置，只会重算③骨骼。"))
        ),
        sem.errors.length > 0
          ? h("p", { className: "SPR_hint", style: { color: "var(--dsw-alias-state-error-primary)" } },
              T("语义有 {n0} 处错误：", { n0: sem.errors.length }) + sem.errors.map((e) => T("{n0} {n1}", { n0: e.name || T("整体"), n1: e.message })).join(T("；")))
          : null,
        sem.warnings.length > 0
          ? h("p", { className: "SPR_hint", style: { color: "var(--dsw-alias-state-warning-primary, #b45309)" } },
              T("提示：") + sem.warnings.map((w) => T("{n0} {n1}", { n0: w.name || T("整体"), n1: w.message })).join(T("；")))
          : null,
        sem.errors.length === 0 && sem.warnings.length === 0
          ? h("p", { className: "SPR_hint" }, sem.ready ? T("语义已就绪，无结构问题。") : T("还没有可用部件。"))
          : null,
        h(
          "div",
          { style: { marginTop: 8, overflowX: "auto" } },
          h(
            "table",
            { className: "SPR_table", style: { width: "100%", fontSize: 12, borderCollapse: "collapse" } },
            h("thead", null,
              h("tr", null,
                h("th", { style: { textAlign: "left" } }, T("部件")),
                h("th", { style: { textAlign: "left" } }, T("角色")),
                h("th", { style: { textAlign: "left" } }, T("父级")),
                h("th", { style: { textAlign: "left" } }, T("近端锚点")),
                h("th", { style: { textAlign: "left" } }, T("远端锚点")),
                h("th", { style: { textAlign: "left" } }, T("来源"))
              )
            ),
            h("tbody", null,
              parts.map((part) =>
                h(
                  "tr",
                  { key: part.name, "data-testid": `rig-sem-row-${part.name}` },
                  h("td", { style: { paddingRight: 8 } }, part.label ?? part.name),
                  h("td", { style: { paddingRight: 8 } },
                    h("select", {
                      className: "SPR_input",
                      "data-testid": `rig-sem-role-${part.name}`,
                      value: part.role ?? "accessory",
                      onChange: (event) => patch(part.name, { role: event.target.value })
                    }, RIG_ROLES.map((role) => h("option", { key: role.key, value: role.key }, role.label)))
                  ),
                  h("td", { style: { paddingRight: 8 } },
                    h("select", {
                      className: "SPR_input",
                      "data-testid": `rig-sem-parent-${part.name}`,
                      value: part.parent ?? "",
                      onChange: (event) => patch(part.name, { parent: event.target.value === "" ? null : event.target.value })
                    },
                      h("option", { value: "" }, T("（挂 root）")),
                      names.filter((name) => name !== part.name).map((name) => h("option", { key: name, value: name }, name))
                    )
                  ),
                  h("td", { style: { paddingRight: 8, whiteSpace: "nowrap" } },
                    anchorField(part, "proximal", 0), anchorField(part, "proximal", 1)
                  ),
                  h("td", { style: { paddingRight: 8, whiteSpace: "nowrap" } },
                    anchorField(part, "distal", 0), anchorField(part, "distal", 1)
                  ),
                  h("td", { style: { whiteSpace: "nowrap" } },
                    part.semanticsSource === "human" ? T("人工") : part.semanticsSource === "ai" ? "AI" : T("默认")
                  )
                )
              )
            )
          )
        )
      );
    }

    function RigBoneEditor({ job, api, run, busy, activeKey }) {
      const bones = job.rig?.boneList ?? [];
      const offsets = job.rig?.boneOffsets ?? {};
      if (bones.length === 0) {
        return h("p", { className: "SPR_hint", style: { marginTop: 10 } },
          T("还没有骨骼。先点上面的「生成骨骼与动画」——生成之后这里可以逐根微调。"));
      }
      const manualCount = Object.keys(offsets).length;

      const patch = (name, fields) =>
        void run(
          () => api.setRigBoneOffsets({ jobId: job.id, bones: [{ name, ...fields }], by: "human" }),
          T("已调整「{n0}」", { n0: name }),
          activeKey
        );

      return h(
        "div",
        { "data-testid": "rig-bone-editor", style: { marginTop: 12 } },
        h("h3", { style: { fontSize: 13, margin: "0 0 4px" } },
          T("骨骼手工偏移（{n0}）", { n0: manualCount > 0 ? T("已调 {n0} 根", { n0: manualCount }) : T("未调整") })),
        h("p", { className: "SPR_hint", style: { marginTop: 0 } },
          T("这里调的是「你相对绑定姿势改了多少」，不会被重新推骨骼覆盖。位移单位是参考图像素，旋转是度。全零即视为未调整。")),
        h(
          "div",
          { style: { marginTop: 8, maxHeight: 320, overflowY: "auto" } },
          h(
            "table",
            { className: "SPR_table", style: { width: "100%", fontSize: 12, borderCollapse: "collapse" } },
            h("thead", null,
              h("tr", null,
                h("th", { style: { textAlign: "left" } }, T("骨骼")),
                h("th", { style: { textAlign: "left" } }, T("父级")),
                h("th", { style: { textAlign: "left" } }, T("绑定姿势")),
                h("th", { style: { textAlign: "left" } }, T("手工位移 x")),
                h("th", { style: { textAlign: "left" } }, T("手工位移 y")),
                h("th", { style: { textAlign: "left" } }, T("手工旋转")),
                h("th", null, "")
              )
            ),
            h("tbody", null,
              bones.filter((bone) => bone.name !== "root").map((bone) => {
                const offset = offsets[bone.name] ?? {};
                return h(
                  "tr",
                  { key: bone.name, "data-testid": `rig-bone-row-${bone.name}` },
                  h("td", { style: { paddingRight: 8 } }, bone.name),
                  h("td", { style: { paddingRight: 8, opacity: 0.7 } }, bone.parent ?? "root"),
                  h("td", { style: { paddingRight: 8, opacity: 0.7, whiteSpace: "nowrap" } },
                    `${Math.round(bone.x)},${Math.round(bone.y)} · ${Math.round(bone.rotation)}°`),
                  h("td", { style: { paddingRight: 8 } },
                    h(NumField, {
                      label: "",
                      value: offset.x ?? 0,
                      step: 1,
                      onChange: (value) => patch(bone.name, { x: value })
                    })
                  ),
                  h("td", { style: { paddingRight: 8 } },
                    h(NumField, {
                      label: "",
                      value: offset.y ?? 0,
                      step: 1,
                      onChange: (value) => patch(bone.name, { y: value })
                    })
                  ),
                  h("td", { style: { paddingRight: 8 } },
                    h(NumField, {
                      label: "",
                      value: offset.rotation ?? 0,
                      step: 1,
                      onChange: (value) => patch(bone.name, { rotation: value })
                    })
                  ),
                  h("td", null,
                    offsets[bone.name] === undefined
                      ? h("span", { style: { opacity: 0.4 } }, "—")
                      : h("button", {
                          type: "button",
                          className: "SPR_miniBtn",
                          "data-testid": `rig-bone-reset-${bone.name}`,
                          onClick: () => void run(
                            () => api.resetRigBoneOffsets({ jobId: job.id, names: [bone.name] }),
                            T("已清除「{n0}」的手工偏移", { n0: bone.name }),
                            activeKey
                          )
                        }, T("清除"))
                  )
                );
              })
            )
          )
        ),
        manualCount > 0
          ? h(
              "div",
              { className: "SPR_toolbar", style: { marginTop: 8 } },
              h(
                BusyBtn,
                {
                  busy: busy,
                  busyText: T("清除中…"),
                  onClick: () => void run(
                    () => api.resetRigBoneOffsets({ jobId: job.id }),
                    T("已清除全部手工骨骼偏移"),
                    activeKey
                  )
                },
                T("清除全部手工偏移（{n0} 根）", { n0: manualCount })
              )
            )
          : null
      );
    }

    function RigAnimationPanel({ job, api, run, busy, activeKey }) {
      const presets = job.rig?.animationPresets ?? [];
      const settings = job.rig?.animationSettings ?? {};
      if (presets.length === 0) return null;
      const changed = Object.keys(settings).length;

      const patch = (id, fields) =>
        void run(
          () => api.setRigAnimationSettings({ jobId: job.id, animations: [{ id, ...fields }], by: "human" }),
          T("已调整「{n0}」的动画参数", { n0: id }),
          activeKey
        );

      return h(
        "div",
        { "data-testid": "rig-animation-panel", style: { marginTop: 12 } },
        h("h3", { style: { fontSize: 13, margin: "0 0 4px" } },
          T("动画参数（{n0}）", { n0: changed > 0 ? T("已调 {n0} 个", { n0: changed }) : T("全部为预设默认值") })),
        h("p", { className: "SPR_hint", style: { marginTop: 0 } },
          T("幅度统一缩放旋转与位移（1 = 预设原样）；时长是一个循环的秒数。改完点上面的「生成骨骼与动画」重算。")),
        h(
          "table",
          { className: "SPR_table", style: { width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 8 } },
          h("thead", null,
            h("tr", null,
              h("th", { style: { textAlign: "left" } }, T("动作")),
              h("th", { style: { textAlign: "left" } }, T("时长（秒）")),
              h("th", { style: { textAlign: "left" } }, T("幅度")),
              h("th", { style: { textAlign: "left" } }, T("状态")),
              h("th", null, "")
            )
          ),
          h("tbody", null,
            presets.map((preset) =>
              h(
                "tr",
                { key: preset.id, "data-testid": `rig-anim-row-${preset.id}` },
                h("td", { style: { paddingRight: 8 } }, T("{n0}（{n1}）", { n0: preset.label, n1: preset.id })),
                h("td", { style: { paddingRight: 8 } },
                  h(NumField, {
                    label: "",
                    value: preset.duration,
                    min: 0.1,
                    max: 10,
                    step: 0.1,
                    onChange: (value) => patch(preset.id, { duration: value })
                  })
                ),
                h("td", { style: { paddingRight: 8 } },
                  h(NumField, {
                    label: "",
                    value: preset.amplitude,
                    min: 0.1,
                    max: 4,
                    step: 0.1,
                    onChange: (value) => patch(preset.id, { amplitude: value })
                  })
                ),
                h("td", { style: { paddingRight: 8, opacity: 0.8 } },
                  (preset.enabled ? T("会生成") : T("未勾选")) +
                    (preset.duration !== preset.defaultDuration ? T(" · 预设 {n0}s", { n0: preset.defaultDuration }) : "")
                ),
                h("td", null,
                  settings[preset.id] === undefined
                    ? h("span", { style: { opacity: 0.4 } }, "—")
                    : h("button", {
                        type: "button",
                        className: "SPR_miniBtn",
                        "data-testid": `rig-anim-reset-${preset.id}`,
                        onClick: () => void run(
                          () => api.resetRigAnimationSettings({ jobId: job.id, ids: [preset.id] }),
                          T("已重置「{n0}」", { n0: preset.id }),
                          activeKey
                        )
                      }, T("重置"))
                )
              )
            )
          )
        ),
        changed > 0
          ? h(
              "div",
              { className: "SPR_toolbar", style: { marginTop: 8 } },
              h(
                BusyBtn,
                {
                  busy: busy,
                  busyText: T("重置中…"),
                  onClick: () => void run(
                    () => api.resetRigAnimationSettings({ jobId: job.id }),
                    T("已重置全部动画参数"),
                    activeKey
                  )
                },
                T("重置全部（{n0} 个）", { n0: changed })
              )
            )
          : null
      );
    }

    function RigTimelineEditor({ job, api, run, busy, activeKey, onRebuild }) {
      const presets = job.rig?.animationPresets ?? [];
      const customIds = job.rig?.customAnimations ?? [];
      const [animId, setAnimId] = React.useState(presets.length > 0 ? presets[0].id : "");
      const [draft, setDraft] = React.useState(null);
      const [selected, setSelected] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [autoRebuild, setAutoRebuild] = React.useState(true);
      const trackRef = React.useRef(null);
      const dragRef = React.useRef(null);

      const load = React.useCallback(
        async (id) => {
          if (id === "") return;
          setLoading(true);
          try {
            const data = await api.getRigAnimation({ jobId: job.id, id });
            setDraft(data);
            setSelected(null);
          } finally {
            setLoading(false);
          }
        },
        [api, job.id]
      );

      React.useEffect(() => {
        void load(animId);
      }, [animId, load, job.rig?.status]);

      /** 提交整份时间轴。`rebuild` 为真时顺带重算骨骼（本地、免费）以刷新预览。 */
      const commit = (next, label, rebuild) => {
        setDraft(next);
        void run(
          async () => {
            await api.saveRigAnimation({ jobId: job.id, id: next.id, animation: next });
            if (rebuild) await api.runRigBones({ jobId: job.id });
          },
          label,
          activeKey
        );
      };

      /** 复制一份可改的轨道表。 */
      const withBones = (mutate) => {
        const next = { ...draft, bones: JSON.parse(JSON.stringify(draft.bones)) };
        mutate(next.bones);
        next.updatedAt = undefined;
        return next;
      };

      const selectedFrame = (() => {
        if (selected === null || draft === null) return null;
        const frames = draft.bones[selected.bone]?.[selected.kind];
        if (frames === undefined || frames[selected.index] === undefined) return null;
        return { frames, frame: frames[selected.index] };
      })();

      const setFrame = (patch, label, rebuild) => {
        if (selected === null || draft === null) return;
        const next = withBones((bones) => {
          const frames = bones[selected.bone][selected.kind];
          const frame = { ...frames[selected.index], ...patch };
          frames[selected.index] = frame;
          if (patch.time !== undefined) {
            // 时间改了要重排，否则「时间递增」这条不变量当场就破了。
            frames.sort((a, b) => a.time - b.time);
            setSelected({ ...selected, index: frames.indexOf(frame) });
          }
        });
        commit(next, label, rebuild);
      };

      const addFrame = (bone, kind, time) => {
        if (draft === null) return;
        const keys = TRACK_VALUE_KEYS[kind];
        const frames = draft.bones[bone]?.[kind] ?? [];
        const base = sampleTrack(frames, time, keys) ?? { time, curve: null };
        const frame = { ...base, time: Number(time.toFixed(4)), curve: null };
        const next = withBones((bones) => {
          bones[bone] = bones[bone] ?? {};
          const list = bones[bone][kind] ?? [];
          list.push(frame);
          list.sort((a, b) => a.time - b.time);
          // 末帧永远不携带 curve（它描述的是「以本帧为起点」的那一段）。
          list[list.length - 1].curve = null;
          bones[bone][kind] = list;
        });
        setSelected({ bone, kind, index: next.bones[bone][kind].indexOf(frame) });
        commit(next, T("已在「{n0}/{n1}」加了一帧", { n0: bone, n1: TRACK_LABELS[kind] }), autoRebuild && onRebuild !== undefined);
      };

      const removeFrame = (bone, kind, index) => {
        if (draft === null) return;
        const frames = draft.bones[bone]?.[kind] ?? [];
        // 首帧（0 秒）是每条轨道的锚：没有它，0 → 首帧之间就是一段未定义的静默区。
        if (index === 0) return;
        if (frames.length <= 2) return;
        const next = withBones((bones) => {
          const list = bones[bone][kind];
          list.splice(index, 1);
          list[list.length - 1].curve = null;
        });
        setSelected(null);
        commit(next, T("已删除「{n0}/{n1}」的第 {n2} 帧", { n0: bone, n1: TRACK_LABELS[kind], n2: index + 1 }), autoRebuild && onRebuild !== undefined);
      };

      const addTrack = (bone, kind) => {
        if (draft === null) return;
        if (draft.bones[bone]?.[kind] !== undefined) return;
        const keys = TRACK_VALUE_KEYS[kind];
        const start = { time: 0, curve: null };
        for (const key of keys) start[key] = kind === "scale" ? 1 : 0;
        const end = { time: Number(draft.duration.toFixed(4)), curve: null };
        for (const key of keys) end[key] = start[key];
        const next = withBones((bones) => {
          bones[bone] = bones[bone] ?? {};
          bones[bone][kind] = [start, end];
        });
        commit(next, T("已为「{n0}」加一条{n1}轨道", { n0: bone, n1: TRACK_LABELS[kind] }), false);
      };

      const removeTrack = (bone, kind) => {
        if (draft === null) return;
        const next = withBones((bones) => {
          delete bones[bone][kind];
          if (Object.keys(bones[bone]).length === 0) delete bones[bone];
        });
        setSelected(null);
        commit(next, T("已删除「{n0}/{n1}」轨道", { n0: bone, n1: TRACK_LABELS[kind] }), autoRebuild && onRebuild !== undefined);
      };

      // 拖动关键帧：单击选中，拖动改时间，松手才提交。
      React.useEffect(() => {
        if (dragRef.current === null) return undefined;
        const move = (event) => {
          const node = trackRef.current;
          const drag = dragRef.current;
          if (node === null || drag === null) return;
          // **手抖不算拖动**。少了这个阈值，单击选中就会把关键帧的时间改到鼠标位置——
          // 实测：点一下 `walk` 里 0.6s 的帧，它当场变成 0.401s（那条轨道的 lane 与
          // 鼠标位置换算出来的值）。用户只是"选中想改数值"，结果位置先跑了。
          if (Math.abs(event.clientX - drag.startX) < 4) return;
          const rect = node.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
          setDraft((current) => {
            if (current === null) return current;
            const bones = JSON.parse(JSON.stringify(current.bones));
            const frames = bones[drag.bone][drag.kind];
            // 不能越过左右邻居：帧顺序变了，「哪一段携带哪个缓动」就全乱了。
            const lower = drag.index === 0 ? 0 : frames[drag.index - 1].time + 1e-3;
            const upper = drag.index === frames.length - 1 ? current.duration : frames[drag.index + 1].time - 1e-3;
            const time = Math.min(upper, Math.max(lower, ratio * current.duration));
            frames[drag.index] = { ...frames[drag.index], time: Number(time.toFixed(4)) };
            return { ...current, bones };
          });
        };
        const up = () => {
          const drag = dragRef.current;
          dragRef.current = null;
          if (drag === null) return;
          setDraft((current) => {
            if (current !== null) {
              void run(
                () => api.saveRigAnimation({ jobId: job.id, id: current.id, animation: current }),
                T("已移动「{n0}/{n1}」的关键帧", { n0: drag.bone, n1: TRACK_LABELS[drag.kind] }),
                activeKey
              );
            }
            return current;
          });
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        return () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
      }, [draft, api, job.id, run, activeKey]);

      if (presets.length === 0) return null;

      const tracks = draft === null
        ? []
        : Object.entries(draft.bones).flatMap(([bone, kinds]) =>
            Object.entries(kinds).map(([kind, frames]) => ({ bone, kind, frames }))
          );

      return h(
        "div",
        { "data-testid": "rig-timeline", style: { marginTop: 12 } },
        h("h3", { style: { fontSize: 13, margin: "0 0 4px" } }, T("时间轴与关键帧")),
        h("p", { className: "SPR_hint", style: { marginTop: 0 } },
          T("选一台动画后可以加/删/拖关键帧、改数值与缓动。提交后这台动画就以这份数据为准（参数滑杆不再影响它），") +
          T("「还原」可以退回预设。")),
        h(
          "div",
          { className: "SPR_rigEditorRow" },
          h("span", { className: "SPR_refRow" }, T("动作")),
          presets.map((preset) =>
            h(
              Btn,
              {
                key: preset.id,
                on: animId === preset.id,
                onClick: () => setAnimId(preset.id),
                "data-testid": `rig-tl-anim-${preset.id}`
              },
              T("{n0}{n1}", { n0: preset.label, n1: customIds.includes(preset.id) ? T(" ·已改") : "" })
            )
          )
        ),
        draft === null
          ? h("p", { className: "SPR_hint" }, loading ? T("读取中…") : T("选择一台动画开始编辑。"))
          : h(
              "div",
              null,
              h(
                "div",
                { className: "SPR_rigEditorRow" },
                h("label", { className: "SPR_field" },
                  h("span", { className: "SPR_fieldLabel" }, T("循环时长（秒）")),
                  h("input", {
                    className: "SPR_input",
                    type: "number",
                    min: 0.1,
                    max: 10,
                    step: 0.1,
                    value: draft.duration,
                    "data-testid": "rig-tl-duration",
                    onChange: (event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value) && value > 0) {
                        commit({ ...draft, duration: Math.min(10, value) }, T("已把「{n0}」的时长改为 {n1}s", { n0: animId, n1: value }), false);
                      }
                    }
                  })
                ),
                h(Btn, {
                  on: draft.loop === true,
                  "data-testid": "rig-tl-loop",
                  onClick: () => commit({ ...draft, loop: draft.loop !== true }, draft.loop === true ? T("已设为不循环") : T("已设为循环"), false)
                }, draft.loop === true ? T("循环") : T("一次性")),
                h(Chip, { kind: customIds.includes(animId) ? "ready" : "idle", text: customIds.includes(animId) ? T("已改为手工数据") : T("预设（改动后转为数据）") }),
                customIds.includes(animId)
                  ? h(Btn, {
                      "data-testid": "rig-tl-revert",
                      onClick: () => void run(async () => {
                        await api.resetRigAnimation({ jobId: job.id, id: animId });
                        const data = await api.getRigAnimation({ jobId: job.id, id: animId });
                        setDraft(data);
                        setSelected(null);
                        if (autoRebuild && onRebuild !== undefined) await api.runRigBones({ jobId: job.id });
                      }, T("已还原「{n0}」到预设", { n0: animId }), activeKey)
                    }, T("还原到预设"))
                  : null
              ),
              // ── 轨道 ────────────────────────────────────────────────
              tracks.length === 0
                ? h("p", { className: "SPR_hint" }, T("这台动画在当前部件集下没有任何轨道（预设依赖的骨骼都不存在）。"))
                : h(
                    "div",
                    { className: "SPR_tlWrap", "data-testid": "rig-tl-track" },
                    h("div", { className: "SPR_tlRuler" },
                      [0, 0.25, 0.5, 0.75, 1].map((ratio) =>
                        h("span", { key: ratio, className: "SPR_tlTick", style: { left: `${ratio * 100}%` } },
                          `${(ratio * draft.duration).toFixed(2)}s`)
                      )
                    ),
                    tracks.map((track, trackIndex) =>
                      h(
                        "div",
                        { key: `${track.bone}/${track.kind}`, className: "SPR_tlRow" },
                        h("span", { className: "SPR_tlName", title: `${track.bone} · ${TRACK_LABELS[track.kind]}` },
                          `${track.bone}`, h("em", { className: "SPR_tlKind" }, TRACK_LABELS[track.kind])),
                        h(
                          "div",
                          {
                            className: "SPR_tlLane",
                            ref: trackIndex === 0 ? trackRef : undefined,
                            onDoubleClick: (event) => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
                              addFrame(track.bone, track.kind, ratio * draft.duration);
                            }
                          },
                          track.frames.map((frame, index) => {
                            const isSelected = selected !== null && selected.bone === track.bone &&
                              selected.kind === track.kind && selected.index === index;
                            return h("button", {
                              key: index,
                              type: "button",
                              className: "SPR_tlKey",
                              "data-selected": isSelected ? "true" : undefined,
                              "data-first": index === 0 ? "true" : undefined,
                              style: { left: `${(frame.time / Math.max(0.0001, draft.duration)) * 100}%` },
                              title: `${frame.time.toFixed(2)}s`,
                              onMouseDown: (event) => {
                                event.preventDefault();
                                setSelected({ bone: track.bone, kind: track.kind, index });
                                if (index > 0) dragRef.current = { bone: track.bone, kind: track.kind, index, startX: event.clientX };
                              }
                            });
                          })
                        ),
                        h("button", {
                          type: "button",
                          className: "SPR_miniBtn",
                          title: T("删除这条轨道"),
                          "data-testid": `rig-tl-del-track-${track.bone}-${track.kind}`,
                          onClick: () => removeTrack(track.bone, track.kind)
                        }, "×")
                      )
                    )
                  ),
              // ── 选中帧的编辑 ────────────────────────────────────────
              selectedFrame === null
                ? h("p", { className: "SPR_hint", style: { marginTop: 8 } },
                    T("点一个关键帧来改它；在轨道空白处**双击**加一帧。首帧（0 秒）不能删——它是每条轨道的锚。"))
                : h(
                    "div",
                    { className: "SPR_tlEdit", "data-testid": "rig-tl-edit" },
                    h("strong", null, T("{n0} · {n1} · 第 {n2} 帧", { n0: selected.bone, n1: TRACK_LABELS[selected.kind], n2: selected.index + 1 })),
                    h(NumField, {
                      label: T("时间(s)"),
                      value: selectedFrame.frame.time,
                      min: 0,
                      max: draft.duration,
                      step: 0.01,
                      onChange: (value) => setFrame({ time: value }, T("已改「{n0}」的关键帧时间", { n0: selected.bone }), false)
                    }),
                    TRACK_VALUE_KEYS[selected.kind].map((key) =>
                      h(NumField, {
                        key,
                        label: key === "angle" ? T("角度") : key,
                        value: selectedFrame.frame[key] ?? 0,
                        step: 1,
                        onChange: (value) => setFrame({ [key]: value }, T("已改「{n0}/{n1}」的{n2}", { n0: selected.bone, n1: TRACK_LABELS[selected.kind], n2: key }), autoRebuild && onRebuild !== undefined)
                      })
                    ),
                    h("div", { className: "SPR_rigEditorRow" },
                      h("span", { className: "SPR_refRow" }, T("缓动")),
                      EASING_PRESETS.map((preset) =>
                        h(Btn, {
                          key: preset.id,
                          on: easingNameOf(selectedFrame.frame.curve) === preset.id,
                          "data-testid": `rig-tl-ease-${preset.id}`,
                          onClick: () => setFrame(
                            { curve: Array.isArray(preset.curve) ? [...preset.curve] : preset.curve },
                            T("已把「{n0}」的缓动改为 {n1}", { n0: selected.bone, n1: preset.label }),
                            autoRebuild && onRebuild !== undefined
                          )
                        }, preset.label)
                      )
                    ),
                    h("div", { className: "SPR_rigEditorRow" },
                      h(Btn, {
                        danger: true,
                        disabled: selected.index === 0 || selectedFrame.frames.length <= 2,
                        "data-testid": "rig-tl-del-frame",
                        onClick: () => removeFrame(selected.bone, selected.kind, selected.index)
                      }, T("删除这一帧")),
                      h("span", { className: "SPR_hint" },
                        selected.index === 0 ? T("首帧是轨道锚点，不能删") : (selectedFrame.frames.length <= 2 ? T("每条轨道至少留两帧") : ""))
                    )
                  ),
              // ── 加轨道 ──────────────────────────────────────────────
              h(
                "div",
                { className: "SPR_rigEditorRow", style: { marginTop: 8 } },
                h("span", { className: "SPR_refRow" }, T("加轨道")),
                h("select", {
                  className: "SPR_input",
                  "data-testid": "rig-tl-add-bone",
                  value: draft.__addBone ?? (draft.boneOrder?.[0] ?? ""),
                  onChange: (event) => setDraft({ ...draft, __addBone: event.target.value })
                }, (draft.boneOrder ?? []).map((name) => h("option", { key: name, value: name }, name))),
                ["rotate", "translate", "scale"].map((kind) =>
                  h(Btn, {
                    key: kind,
                    "data-testid": `rig-tl-add-${kind}`,
                    onClick: () => addTrack(draft.__addBone ?? (draft.boneOrder?.[0] ?? ""), kind)
                  }, `+ ${TRACK_LABELS[kind]}`)
                )
              ),
              h(
                "div",
                { className: "SPR_rigEditorRow", style: { marginTop: 8 } },
                h(Btn, {
                  on: autoRebuild,
                  "data-testid": "rig-tl-autorebuild",
                  onClick: () => setAutoRebuild(!autoRebuild)
                }, autoRebuild ? T("改完自动重算预览：开") : T("改完自动重算预览：关")),
                h(Btn, { onClick: () => void load(animId) }, T("重新读取")),
                h("span", { className: "SPR_hint" }, T("重算是本地计算，免费"))
              )
            )
      );
    }

    function RigQaPanel({ job, api, run, busy, activeKey }) {
      const qa = job.qa;
      if (qa === null || qa === undefined) return null;
      const errors = (qa.issues ?? []).filter((issue) => issue.level === "error");
      const warnings = (qa.issues ?? []).filter((issue) => issue.level !== "error");
      return h(
        "div",
        { className: "SPR_rigStage", "data-testid": "rig-qa", "data-ok": qa.ok ? "true" : "false" },
        h(
          "div",
          { className: "SPR_rigStageHead" },
          h("span", { className: "SPR_rigStageTitle" }, T("拆件质检")),
          h(Chip, { kind: qa.ok ? "ready" : "error", text: qa.ok ? T("可信度 {n0}%", { n0: Math.round(qa.score * 100) }) : T("不可信（{n0}%）", { n0: Math.round(qa.score * 100) }) }),
          h("span", { className: "SPR_rigStageHint" }, qa.summary)
        ),
        errors.length === 0 && warnings.length === 0
          ? h("p", { className: "SPR_hint" }, T("没有发现重复件，装配相似度也在正常范围。"))
          : h(
              "ul",
              { className: "SPR_qaList" },
              [...errors, ...warnings].map((issue, index) =>
                h(
                  "li",
                  { key: index, "data-level": issue.level, "data-code": issue.code },
                  h("span", { className: "SPR_qaMsg" }, issue.message),
                  issue.suggestion === undefined ? null : h("span", { className: "SPR_qaFix" }, `→ ${issue.suggestion}`)
                )
              )
            ),
        h(
          "div",
          { className: "SPR_rigEditorRow", style: { marginTop: 8 } },
          h(BusyBtn, {
            busy: busy,
            busyText: T("质检中…"),
            "data-testid": "rig-qa-rerun",
            onClick: () => void run(() => api.runRigQa({ jobId: job.id }), T("已重跑拆件质检"), activeKey)
          }, T("重新质检")),
          // 「参考图里大致有几个独立部位」只能靠看图判断，所以留成手填——给不出就不做这项判断。
          h("label", { className: "SPR_field" },
            h("span", { className: "SPR_fieldLabel" }, T("参考图里大约几个部位")),
            h("input", {
              className: "SPR_input",
              type: "number",
              min: 1,
              max: 200,
              "data-testid": "rig-qa-expected",
              defaultValue: qa.expectedParts ?? "",
              placeholder: T("看图填，可留空"),
              onBlur: (event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value) || value <= 0) return;
                void run(() => api.runRigQa({ jobId: job.id, expectedParts: value }), T("已按「{n0} 个部位」重新质检", { n0: value }), activeKey);
              }
            })
          ),
          h("span", { className: "SPR_hint" }, T("填了它就能判断「部件数是不是多出来了」——多出来的多半是重复件"))
        )
      );
    }

    function RigConstraintPanel({ job, api, run, busy, activeKey }) {
      const constraints = job.rig?.constraints ?? [];
      const boneChoices = (job.rig?.boneList ?? []).map((bone) => bone.name).filter((name) => name !== "root");
      const [bone, setBone] = React.useState("");
      const [chain, setChain] = React.useState(1);
      if (boneChoices.length === 0) return null;
      const currentBone = bone === "" ? boneChoices[boneChoices.length - 1] : bone;

      const write = (patches, label) =>
        void run(async () => {
          await api.setRigConstraints({ jobId: job.id, constraints: patches, by: "human" });
          // 约束是结构改动 → 骨架必须重算，否则预览里那个目标点根本不存在。
          await api.runRigBones({ jobId: job.id });
        }, label, activeKey);

      return h(
        "div",
        { "data-testid": "rig-constraints", style: { marginTop: 12 } },
        h("h3", { style: { fontSize: 13, margin: "0 0 4px" } }, T("IK 约束（{n0}）", { n0: constraints.length > 0 ? T("{n0} 条", { n0: constraints.length }) : T("无") })),
        h("p", { className: "SPR_hint", style: { marginTop: 0 } },
          T("把一条骨骼链约束到一个**可拖的目标点**：在下面的预览里拖那个青色菱形，手就跟着走。") +
          T("链长 1 = 末端骨 + 它的父级（两骨余弦定理）；权重小于 1 是软 IK。")),
        constraints.length > 0
          ? h(
              "table",
              { className: "SPR_table", style: { width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 8 } },
              h("thead", null,
                h("tr", null,
                  h("th", { style: { textAlign: "left" } }, T("名称")),
                  h("th", { style: { textAlign: "left" } }, T("链末端骨骼")),
                  h("th", { style: { textAlign: "left" } }, T("目标点")),
                  h("th", { style: { textAlign: "left" } }, T("链长")),
                  h("th", { style: { textAlign: "left" } }, T("弯曲")),
                  h("th", { style: { textAlign: "left" } }, T("权重")),
                  h("th", null, "")
                )
              ),
              h("tbody", null,
                constraints.map((entry) =>
                  h(
                    "tr",
                    { key: entry.name, "data-testid": `rig-ik-row-${entry.name}` },
                    h("td", null, entry.name),
                    h("td", null, entry.bone),
                    h("td", null, entry.target),
                    h("td", null,
                      h(NumField, {
                        label: "",
                        value: entry.chain,
                        min: 1,
                        max: 1,
                        step: 1,
                        onChange: (value) => write([{ name: entry.name, bone: entry.bone, target: entry.target, chain: value, bendPositive: entry.bendPositive, weight: entry.weight }], T("已改「{n0}」的链长", { n0: entry.name }))
                      })
                    ),
                    h("td", null,
                      h(Btn, {
                        on: entry.bendPositive === true,
                        "data-testid": `rig-ik-bend-${entry.name}`,
                        onClick: () => write([{ name: entry.name, bone: entry.bone, target: entry.target, chain: entry.chain, bendPositive: entry.bendPositive !== true, weight: entry.weight }], T("已切换弯曲方向"))
                      }, entry.bendPositive === true ? T("正向") : T("反向"))
                    ),
                    h("td", null,
                      h(NumField, {
                        label: "",
                        value: entry.weight,
                        min: 0,
                        max: 1,
                        step: 0.1,
                        onChange: (value) => write([{ name: entry.name, bone: entry.bone, target: entry.target, chain: entry.chain, bendPositive: entry.bendPositive, weight: value }], T("已把「{n0}」的权重改为 {n1}", { n0: entry.name, n1: value }))
                      })
                    ),
                    h("td", null,
                      h(Btn, {
                        danger: true,
                        "data-testid": `rig-ik-del-${entry.name}`,
                        onClick: () => void run(async () => {
                          await api.resetRigConstraints({ jobId: job.id, names: [entry.name] });
                          await api.runRigBones({ jobId: job.id });
                        }, T("已删除约束「{n0}」", { n0: entry.name }), activeKey)
                      }, T("删除"))
                    )
                  )
                )
              )
            )
          : null,
        h(
          "div",
          { className: "SPR_rigEditorRow", style: { marginTop: 8 } },
          h("span", { className: "SPR_refRow" }, T("加约束")),
          h("select", {
            className: "SPR_input",
            "data-testid": "rig-ik-bone",
            value: currentBone,
            onChange: (event) => setBone(event.target.value)
          }, boneChoices.map((name) => h("option", { key: name, value: name }, name))),
          h(NumField, { label: T("链长"), value: chain, min: 1, max: 4, step: 1, onChange: setChain }),
          h(Btn, {
            primary: true,
            "data-testid": "rig-ik-add",
            onClick: () => {
              const name = `ik-${currentBone}`;
              write([{ name, bone: currentBone, target: `${name}-target`, chain, bendPositive: true, weight: 1 }], T("已为「{n0}」加 IK 约束", { n0: currentBone }));
            }
          }, T("加到这条链上")),
          h("span", { className: "SPR_hint" }, T("目标点会自动补一根骨骼，位置就在链末端"))
        ),
        constraints.length > 0
          ? h("div", { className: "SPR_rigEditorRow" },
              h(Btn, {
                "data-testid": "rig-ik-clear",
                onClick: () => void run(async () => {
                  await api.resetRigConstraints({ jobId: job.id });
                  await api.runRigBones({ jobId: job.id });
                }, T("已清空全部 IK 约束"), activeKey)
              }, T("清空全部")))
          : null
      );
    }

    function RigMeshPanel({ job, api, run, busy, activeKey }) {
      const meshes = job.rig?.meshes ?? {};
      const deforms = job.rig?.deforms ?? {};
      const boneNames = (job.rig?.boneList ?? []).map((bone) => bone.name).filter((name) => name !== "root");
      const [pick, setPick] = React.useState("");
      if (boneNames.length === 0) return null;
      const targets = Object.keys(meshes);
      const current = pick === "" ? (targets[0] ?? boneNames[boneNames.length - 1]) : pick;
      const sizeOf = (name) => {
        const part = job.parts.find((entry) => entry.name === name);
        return Math.max(8, Math.round(Math.min(part?.width ?? 80, part?.height ?? 80) * 0.08));
      };

      const write = (name, patch) =>
        void run(async () => {
          await api.setRigMesh({ jobId: job.id, meshes: [{ name, ...patch }], by: "human" });
          // 网格会改变附件的**类型**（region → mesh），骨骼与图集都得重做。
          await api.runRigBones({ jobId: job.id });
        }, T("已更新「{n0}」的网格", { n0: name }), activeKey);

      return h(
        "div",
        { "data-testid": "rig-mesh", style: { marginTop: 12 } },
        h("h3", { style: { fontSize: 13, margin: "0 0 4px" } },
          T("蒙皮网格（{n0}）", { n0: targets.length > 0 ? T("{n0} 个部件已细分", { n0: targets.length }) : T("无") })),
        h("p", { className: "SPR_hint", style: { marginTop: 0 } },
          T("把部件切成网格之后就能对顶点做 FFD 变形——裙摆、披风、长发这类「上缘不动、下缘甩出去」") +
          T("用刚体骨骼是动不出来的。网格是规则三角化，密度越高越软，预览也越吃性能。")),
        targets.length > 0
          ? h(
              "table",
              { className: "SPR_table", style: { width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 8 } },
              h("thead", null,
                h("tr", null,
                  h("th", { style: { textAlign: "left" } }, T("部件")),
                  h("th", { style: { textAlign: "left" } }, T("列=行")),
                  h("th", { style: { textAlign: "left" } }, T("摆幅")),
                  h("th", { style: { textAlign: "left" } }, T("循环(s)")),
                  h("th", { style: { textAlign: "left" } }, T("固定端")),
                  h("th", null, "")
                )
              ),
              h("tbody", null,
                targets.map((name) => {
                  const spec = meshes[name];
                  const wave = deforms[name];
                  return h(
                    "tr",
                    { key: name, "data-testid": `rig-mesh-row-${name}` },
                    h("td", null, name),
                    h("td", null,
                      h(NumField, {
                        label: "", value: spec.cols, min: 1, max: 16, step: 1,
                        onChange: (value) => write(name, { cols: value, rows: value })
                      })
                    ),
                    h("td", null, wave === undefined
                      ? h("button", {
                          type: "button", className: "SPR_miniBtn",
                          "data-testid": `rig-mesh-wave-${name}`,
                          onClick: () => write(name, { deform: { amplitude: sizeOf(name) } })
                        }, T("加飘动"))
                      : h(NumField, {
                          label: "", value: wave.amplitude, min: 0, max: 200, step: 1,
                          onChange: (value) => write(name, { deform: { ...wave, amplitude: value } })
                        })
                    ),
                    h("td", null, wave === undefined ? h("span", { style: { opacity: 0.4 } }, "—")
                      : h(NumField, {
                          label: "", value: wave.duration, min: 0.2, max: 6, step: 0.1,
                          onChange: (value) => write(name, { deform: { ...wave, duration: value } })
                        })
                    ),
                    h("td", null, wave === undefined ? h("span", { style: { opacity: 0.4 } }, "—")
                      : h("select", {
                          className: "SPR_input",
                          "data-testid": `rig-mesh-anchor-${name}`,
                          value: wave.anchor,
                          onChange: (event) => write(name, { deform: { ...wave, anchor: event.target.value } })
                        },
                        h("option", { value: "top" }, T("上缘")),
                        h("option", { value: "bottom" }, T("下缘")),
                        h("option", { value: "none" }, T("整体")))
                    ),
                    h("td", null,
                      h(Btn, {
                        danger: true,
                        "data-testid": `rig-mesh-del-${name}`,
                        onClick: () => void run(async () => {
                          await api.resetRigMesh({ jobId: job.id, names: [name] });
                          await api.runRigBones({ jobId: job.id });
                        }, T("已取消「{n0}」的网格", { n0: name }), activeKey)
                      }, T("取消"))
                    )
                  );
                })
              )
            )
          : null,
        h(
          "div",
          { className: "SPR_rigEditorRow", style: { marginTop: 8 } },
          h("span", { className: "SPR_refRow" }, T("加网格")),
          h("select", {
            className: "SPR_input",
            "data-testid": "rig-mesh-pick",
            value: current,
            onChange: (event) => setPick(event.target.value)
          }, boneNames.map((name) => h("option", { key: name, value: name }, name))),
          h(Btn, {
            primary: true,
            "data-testid": "rig-mesh-add",
            onClick: () => write(current, { cols: 6, rows: 6 })
          }, T("细分这个部件")),
          // 一键入口：用户想的是「让裙摆飘起来」，不是「给我一个 6×6 网格」。
          h(Btn, {
            "data-testid": "rig-mesh-skirt",
            onClick: () => {
              const skirt = boneNames.find((name) => name === "hip") ?? boneNames[boneNames.length - 1];
              write(skirt, { cols: 6, rows: 6, deform: { amplitude: 12, cycles: 1, direction: 0, anchor: "top", duration: 1.6 } });
            }
          }, T("给裙摆加飘动")),
          h("span", { className: "SPR_hint" }, T("网格与变形都是本地计算，免费"))
        ),
        targets.length > 0
          ? h("div", { className: "SPR_rigEditorRow" },
              h(Btn, {
                "data-testid": "rig-mesh-clear",
                onClick: () => void run(async () => {
                  await api.resetRigMesh({ jobId: job.id });
                  await api.runRigBones({ jobId: job.id });
                }, T("已清除全部网格与变形"), activeKey)
              }, T("清空全部")))
          : null
      );
    }

    function RigPathPanel({ job, api, run, busy, activeKey }) {
      const paths = job.rig?.paths ?? {};
      const boneList = job.rig?.boneList ?? [];
      const boneNames = boneList.map((bone) => bone.name).filter((name) => name !== "root");
      const [tip, setTip] = React.useState("");
      const [depth, setDepth] = React.useState(2);
      const [spacing, setSpacing] = React.useState(0);
      if (boneNames.length === 0) return null;
      const currentTip = tip === "" ? boneNames[boneNames.length - 1] : tip;

      // 从末端骨沿父级往上取 count 根，再反转成「从根到末端」——Spine 与 DragonBones
      // 都按这个顺序理解骨链。
      const chainOf = (name, count) => {
        const out = [name];
        let cursor = name;
        for (let i = 0; i < count; i++) {
          const bone = boneList.find((entry) => entry.name === cursor);
          if (bone?.parent === undefined || bone.parent === "root") break;
          cursor = bone.parent;
          out.unshift(cursor);
        }
        return out;
      };
      // 路径点用部件的**近端锚点**（顶端中点）——骨骼原点就落在那里。
      //
      // 位置取自 `layout.items` 而**不是** `parts`：后者只有尺寸没有坐标，拿它算会得到
      // 一串 NaN，然后被 wire 的 z.number() 挡下（表现是「点了按钮没反应、也没报错」）。
      const pointsOf = (chain) =>
        chain.flatMap((name) => {
          const item = job.layout?.items?.[name];
          if (item === undefined) return [];
          return [Math.round(item.x + item.width / 2), Math.round(item.y)];
        });

      const write = (name, patch, label) =>
        void run(async () => {
          await api.setRigPath({ jobId: job.id, paths: [{ name, ...patch }], by: "human" });
          await api.runRigBones({ jobId: job.id });
        }, label, activeKey);

      const entries = Object.entries<any>(paths);

      return h(
        "div",
        { "data-testid": "rig-paths", style: { marginTop: 12 } },
        h("h3", { style: { fontSize: 13, margin: "0 0 4px" } },
          T("Path 约束（{n0}）", { n0: entries.length > 0 ? T("{n0} 条", { n0: entries.length }) : T("无") })),
        h("p", { className: "SPR_hint", style: { marginTop: 0 } },
          T("把一串骨骼沿折线按弧长铺开——尾巴、辫子这类「长度远超单根骨」的部件用它。") +
          T("间距 0 表示均匀铺满整条路径；大于 0 就是固定间距，骨骼只覆盖路径的一段。")),
        entries.length > 0
          ? h(
              "table",
              { className: "SPR_table", style: { width: "100%", fontSize: 12, borderCollapse: "collapse", marginTop: 8 } },
              h("thead", null,
                h("tr", null,
                  h("th", { style: { textAlign: "left" } }, T("名称")),
                  h("th", { style: { textAlign: "left" } }, T("骨链")),
                  h("th", { style: { textAlign: "left" } }, T("间距")),
                  h("th", { style: { textAlign: "left" } }, T("旋转混合")),
                  h("th", null, "")
                )
              ),
              h("tbody", null,
                entries.map(([name, entry]) =>
                  h(
                    "tr",
                    { key: name, "data-testid": `rig-path-row-${name}` },
                    h("td", null, name),
                    h("td", { style: { maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" } }, entry.bones.join(" → ")),
                    h("td", null,
                      h(NumField, {
                        label: "", value: entry.spacing, min: 0, max: 400, step: 1,
                        onChange: (value) => write(name, { points: entry.points, bones: entry.bones, spacing: value, translateMix: entry.translateMix, rotateMix: entry.rotateMix }, T("已改「{n0}」的间距", { n0: name }))
                      })
                    ),
                    h("td", null,
                      h(NumField, {
                        label: "", value: entry.rotateMix, min: 0, max: 1, step: 0.1,
                        onChange: (value) => write(name, { points: entry.points, bones: entry.bones, spacing: entry.spacing, translateMix: entry.translateMix, rotateMix: value }, T("已改「{n0}」的旋转混合", { n0: name }))
                      })
                    ),
                    h("td", null,
                      h(Btn, {
                        danger: true,
                        "data-testid": `rig-path-del-${name}`,
                        onClick: () => void run(async () => {
                          await api.resetRigPath({ jobId: job.id, names: [name] });
                          await api.runRigBones({ jobId: job.id });
                        }, T("已删除路径「{n0}」", { n0: name }), activeKey)
                      }, T("删除"))
                    )
                  )
                )
              )
            )
          : null,
        h(
          "div",
          { className: "SPR_rigEditorRow", style: { marginTop: 8 } },
          h("span", { className: "SPR_refRow" }, T("加路径")),
          h("select", {
            className: "SPR_input",
            "data-testid": "rig-path-tip",
            value: currentTip,
            onChange: (event) => setTip(event.target.value)
          }, boneNames.map((name) => h("option", { key: name, value: name }, name))),
          h(NumField, { label: T("链长"), value: depth, min: 1, max: 6, step: 1, onChange: setDepth }),
          h(NumField, { label: T("间距"), value: spacing, min: 0, max: 400, step: 1, onChange: setSpacing }),
          h(Btn, {
            primary: true,
            "data-testid": "rig-path-add",
            onClick: () => {
              const chain = chainOf(currentTip, depth);
              const points = pointsOf(chain);
              if (points.length < 4) return;
              write(`path-${currentTip}`, { points, bones: chain, spacing, translateMix: 1, rotateMix: 1 }, T("已沿「{n0}」加路径", { n0: chain.join(" → ") }));
            }
          }, T("沿这条链加路径")),
          h("span", { className: "SPR_hint" }, T("默认路径沿这些部件的近端锚点生成"))
        ),
        entries.length > 0
          ? h("div", { className: "SPR_rigEditorRow" },
              h(Btn, {
                "data-testid": "rig-path-clear",
                onClick: () => void run(async () => {
                  await api.resetRigPath({ jobId: job.id });
                  await api.runRigBones({ jobId: job.id });
                }, T("已清空全部路径约束"), activeKey)
              }, T("清空全部")))
          : null
      );
    }

    /** 一行滑杆（换色面板用）。 */
    function RangeRow({ label, value, min, max, step, onChange }) {      return h(
        "label",
        { className: "SPR_field", style: { minWidth: 150 } },
        h("span", { className: "SPR_fieldLabel" }, `${label} ${value}`),
        h("input", {
          type: "range",
          min,
          max,
          step: step === undefined ? 1 : step,
          value,
          style: { width: "100%" },
          onChange: (event) => onChange(Number(event.target.value))
        })
      );
    }

    function RigTexturePanel({ job, api, run, busy, activeKey, selected, onSelect, keyBusy }) {
      const parts = (job.parts ?? []).filter((part) => part.status === "ready");
      const [draft, setDraft] = React.useState(IDENTITY_TINT);
      const [target, setTarget] = React.useState(null);
      const [redrawPrompt, setRedrawPrompt] = React.useState("");
      if (parts.length === 0) return null;

      const current = target !== null && parts.some((part) => part.name === target)
        ? target
        : (selected !== null && parts.some((part) => part.name === selected) ? selected : parts[0].name);
      const part = parts.find((entry) => entry.name === current);
      const versions = part?.versions ?? [];
      const activeVersion = part?.activeTexture ?? versions[versions.length - 1]?.v ?? 1;
      const isIdentity = JSON.stringify(draft) === JSON.stringify(IDENTITY_TINT);

      const pick = (name) => {
        setTarget(name);
        if (onSelect !== undefined) onSelect(name);
      };

      const applyTint = () =>
        void run(
          () => api.tintRigParts({ jobId: job.id, names: [current], tint: draft, by: "human", note: describeTint(draft) }),
          T("已给「{n0}」换色（新增一版）", { n0: current }),
          activeKey
        );

      return h(
        "div",
        { className: "SPR_rigStage", "data-testid": "rig-texture-panel", style: { marginTop: 12 } },
        h("div", { className: "SPR_rigStageHead" },
          h("span", { className: "SPR_rigStageTitle" }, T("贴图变体")),
          h("span", { className: "SPR_rigStageHint", style: { flex: 1 } },
            T("每一次换色 / 上传替换都新增一个版本，永不覆盖原图；「换回原版」就是切版本。"))
        ),
        h(
          "div",
          { className: "SPR_rigEditorRow", style: { marginTop: 8 } },
          h("span", { className: "SPR_refRow" }, T("部件")),
          h(
            "select",
            {
              className: "SPR_input",
              "data-testid": "rig-texture-part",
              value: current,
              onChange: (event) => pick(event.target.value)
            },
            parts.map((entry) => h("option", { key: entry.name, value: entry.name }, entry.label ?? entry.name))
          ),
          h("span", { className: "SPR_hint" },
            T("当前 v{n0}{n1}", { n0: activeVersion, n1: noteSuffix(versions.find((v) => v.v === activeVersion)?.note) }))
        ),

        // 版本列表：点一下切过去，这就是「回退原版」。
        h(
          "div",
          { className: "SPR_rigEditorRow", "data-testid": "rig-texture-versions" },
          h("span", { className: "SPR_refRow" }, T("版本")),
          versions.map((version) =>
            h(
              "span",
              { key: version.v, className: "SPR_refRow", style: { display: "inline-flex", alignItems: "center", gap: 4 } },
              h(
                "button",
                {
                  type: "button",
                  className: "SPR_miniBtn",
                  "data-testid": `rig-tex-v${version.v}`,
                  "data-active": version.v === activeVersion ? "true" : "false",
                  style: version.v === activeVersion ? { borderColor: "var(--dsw-alias-state-business-primary)" } : undefined,
                  onClick: () =>
                    void run(
                      () => api.setRigTextureVersion({ jobId: job.id, name: current, version: version.v }),
                      T("已切到 v{n0}", { n0: version.v }),
                      activeKey
                    )
                },
                `v${version.v}${noteSuffix(version.note)}`
              ),
              versions.length > 1 && version.v !== activeVersion
                ? h("button", {
                    type: "button",
                    className: "SPR_miniBtn",
                    title: T("删除这一版"),
                    onClick: () =>
                      void run(
                        () => api.removeRigTextureVersion({ jobId: job.id, name: current, version: version.v }),
                        T("已删除 v{n0}", { n0: version.v }),
                        activeKey
                      )
                  }, "×")
                : null
            )
          )
        ),

        // 即时预览 + 换色滑杆
        h(
          "div",
          { className: "SPR_rigEditorRow", style: { alignItems: "flex-start", marginTop: 8 } },
          part?.url !== null && part?.url !== undefined
            ? h("img", {
                src: part.url,
                alt: current,
                "data-testid": "rig-texture-preview",
                style: {
                  width: 110,
                  height: 110,
                  objectFit: "contain",
                  border: "1px solid var(--dsw-alias-border-l2)",
                  borderRadius: 8,
                  filter: tintToCssFilter(draft)
                }
              })
            : null,
          h(
            "div",
            { style: { display: "flex", flexWrap: "wrap", gap: 8, flex: 1 } },
            h(RangeRow, { label: T("色相"), value: draft.hue, min: -180, max: 180, step: 5, onChange: (value) => setDraft({ ...draft, hue: value }) }),
            h(RangeRow, { label: T("饱和度"), value: draft.saturation, min: 0, max: 3, step: 0.1, onChange: (value) => setDraft({ ...draft, saturation: value }) }),
            h(RangeRow, { label: T("明度"), value: draft.lightness, min: -1, max: 1, step: 0.05, onChange: (value) => setDraft({ ...draft, lightness: value }) }),
            h(RangeRow, { label: T("亮度"), value: draft.brightness, min: -1, max: 1, step: 0.05, onChange: (value) => setDraft({ ...draft, brightness: value }) }),
            h(RangeRow, { label: T("对比"), value: draft.contrast, min: 0, max: 3, step: 0.1, onChange: (value) => setDraft({ ...draft, contrast: value }) })
          )
        ),
        h(
          "div",
          { className: "SPR_rigEditorRow" },
          h(BusyBtn, {
            busy: busy,
            busyText: T("换色中…"),
            primary: true,
            disabled: isIdentity,
            "data-testid": "rig-texture-apply",
            onClick: applyTint
          }, T("应用换色（新增一版）")),
          h(Btn, { onClick: () => setDraft(IDENTITY_TINT), disabled: isIdentity }, T("重置滑杆")),
          h("label", { className: "SPR_refRow", style: { display: "inline-flex", gap: 6, alignItems: "center" } },
            T("上传替换"),
            h("input", {
              type: "file",
              accept: "image/png,image/jpeg,image/webp",
              "data-testid": "rig-texture-upload",
              onChange: (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file === undefined) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const raw = String(reader.result ?? "");
                  const base64 = raw.slice(raw.indexOf(",") + 1);
                  void run(
                    () => api.uploadRigTexture({ jobId: job.id, name: current, data: base64, note: T("手工上传") }),
                    T("已上传「{n0}」的新贴图", { n0: current }),
                    activeKey
                  );
                };
                reader.readAsDataURL(file);
              }
            })
          ),
          h("span", { className: "SPR_hint" }, isIdentity ? "" : T("滑杆只是预览，点「应用换色」才落成新版本"))
        ),

        // AI 重绘：**花钱**，所以按钮文案直说，并且可以随时切回上一版。
        h(
          "div",
          { className: "SPR_rigEditorRow", style: { marginTop: 6 } },
          h("input", {
            className: "SPR_input",
            style: { flex: 1, minWidth: 180 },
            "data-testid": "rig-redraw-prompt",
            placeholder: T("想让这块变成什么样？（例如「换成深蓝色布料」「加上金属高光」）"),
            value: redrawPrompt,
            onChange: (event) => setRedrawPrompt(event.target.value)
          }),
          h(BusyBtn, {
            busy: keyBusy(K_RIG_REDRAW),
            busyText: T("正在重绘…"),
            disabled: redrawPrompt.trim() === "" || busy,
            "data-testid": "rig-redraw-run",
            onClick: () =>
              void run(
                () => api.runRigRedraw({ jobId: job.id, name: current, prompt: redrawPrompt.trim() }),
                T("已提交 AI 重绘（会花钱）"),
                K_RIG_REDRAW
              )
          }, T("AI 重绘这一块（会花钱）")),
          h("span", { className: "SPR_hint" }, T("重绘结果是一版新的贴图：轮廓按原样裁回，不满意切回上一版即可"))
        )
      );
    }

    function RigAssemblyEditor({ job, api, run, busy, activeKey }) {
      const canvasW = Math.max(1, job.canvas?.width ?? 1);
      const canvasH = Math.max(1, job.canvas?.height ?? 1);
      const serverItems = job.layout?.items ?? {};
      const scaleHint = job.layout?.hint ?? 0.5;

      const [draft, setDraft] = React.useState({} as any);
      const [selected, setSelected] = React.useState(null);
      const [drag, setDrag] = React.useState(null as any);
      const [zoom, setZoom] = React.useState(1);
      const [pan, setPan] = React.useState(null as any);
      const [spaceDown, setSpaceDown] = React.useState(false);
      const [stageWidth, setStageWidth] = React.useState(0);
      const [showReference, setShowReference] = React.useState(false);
      const [showBoxes, setShowBoxes] = React.useState(true);
      const [snapEnabled, setSnapEnabled] = React.useState(true);
      const [guides, setGuides] = React.useState([] as any[]);
      const [history, setHistory] = React.useState([] as any[]);
      const [future, setFuture] = React.useState([] as any[]);
      const [lockRatio, setLockRatio] = React.useState(true);
      const wrapRef = React.useRef(null);
      const stageRef = React.useRef(null);

      // 换了任务：本地草稿、撤销栈、重做栈一起清掉。
      React.useEffect(() => {
        setDraft({});
        setHistory([]);
        setFuture([]);
      }, [job.id]);

      // 服务器状态变了（提交完成）就把本地草稿清掉，以服务端结果为准。
      //
      // **但这里不能顺手清历史**：`commit()` 自己就会写盘并让 `updatedAt` 变化，
      // 早先把两个 effect 合成一个、依赖 [job.id, job.updatedAt]，结果是每提交一次
      // 就立刻清空撤销栈——「撤销」按钮永远是灰的，Ctrl+Z 也永远没反应。
      React.useEffect(() => {
        setDraft({});
      }, [job.updatedAt]);

      // 本地草稿里写的 `placed` 是「操作意图」，而决定图层显隐、已放置计数的是
      // `matched`（宿主也是读 `placed` 再写回 `matched` 的，见 riggen.saveRigLayoutItems）。
      // 不在合并时对齐这两个键，Delete 收回、从部件栏拖入这类**纯本地**改动就完全看不出效果：
      // commit 写了 placed，过滤条件读的却是 matched。宿主回包之前界面一动不动，
      // 而一旦通信失败（比如宿主半区还没重启）用户就会以为整个手动装配是坏的。
      const withLocalIntent = (local: any) =>
        local === undefined || local.placed === undefined ? local : { ...local, matched: local.placed !== false };

      /** 合并后的摆放表：服务器结果 + 本地未提交的改动。 */
      const items: any = React.useMemo(() => {
        const merged = {};
        for (const part of job.parts ?? []) {
          const base = serverItems[part.name];
          const local = withLocalIntent(draft[part.name]);
          if (base === undefined && local === undefined) continue;
          merged[part.name] = {
            x: 0, y: 0, width: 1, height: 1, rotation: 0, z: 0, matched: true, manual: false,
            ...(base ?? defaultItemOf(part, scaleHint)),
            ...(local ?? {})
          };
        }
        for (const [name, raw] of Object.entries(draft as Record<string, any>)) {
          if (merged[name] !== undefined) continue;
          const part = (job.parts ?? []).find((entry) => entry.name === name);
          if (part === undefined) continue;
          merged[name] = { ...defaultItemOf(part, scaleHint), ...withLocalIntent(raw) };
        }
        return merged;
      }, [job.parts, serverItems, draft, scaleHint]);

      const placedNames = Object.keys(items)
        .filter((name) => items[name].matched !== false)
        .sort((a, b) => (items[a].z ?? 0) - (items[b].z ?? 0) || a.localeCompare(b));
      const unplaced = (job.parts ?? []).filter((part) => part.status === "ready" && items[part.name]?.matched === false);
      const notYetPlaced = (job.parts ?? []).filter((part) => part.status === "ready" && items[part.name] === undefined);

      React.useEffect(() => {
        const measure = () => {
          if (stageRef.current !== null) setStageWidth(stageRef.current.clientWidth);
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
      }, []);

      // 「适应」要同时按宽和高算：只按宽的话，一张 550×978 的立绘在宽屏上会被放到
      // 两倍宽、远超舞台可见高度，用户看到的是「画布一半在屏幕外」，连部件栏拖进去
      // 都找不到落点。舞台的可见高度按视口估一个 62%（与 CSS 的 max-height 对齐）。
      const stageHeight = typeof window === "undefined" ? 0 : window.innerHeight * 0.62;
      const fitScale =
        stageWidth > 0 && canvasH > 0
          ? Math.min(stageWidth / canvasW, stageHeight > 0 ? stageHeight / canvasH : Number.POSITIVE_INFINITY)
          : 0;
      const scale = fitScale * zoom;
      const selectedItem = selected === null ? undefined : items[selected];
      const selectedPart = selected === null ? undefined : (job.parts ?? []).find((part) => part.name === selected);

      // ── 视图：滚轮以光标为锚缩放，空格/中键拖动平移 ──────────────────
      //
      // 平移**不引入额外的变换层**，而是直接用舞台自身的滚动：这样坐标系只有
      // 一个（`scale`），命中测试、对齐参考线、拖拽全都不用改；
      // 代价是要正确处理「缩放后把同一个画布点重新对齐回光标」。
      const zoomRef = React.useRef(1);
      zoomRef.current = zoom;
      const stageNode = () => stageRef.current as HTMLDivElement | null;

      /**
       * 待应用的「锚点滚动」。
       *
       * 缩放之后要把同一个内容点压回光标位置，但这必须**等 DOM 尺寸更新之后**再做。
       * 早先直接在 `setZoom` 后面排一个 `requestAnimationFrame`，结果 scrollTop 始终
       * 是 0：rAF 有可能跑在 React 提交之前，那时读到的还是旧尺寸，写进去的值被夹回 0。
       * 正确做法是把意图记在 ref 里，交给「提交之后」的 `useEffect([zoom])` 应用。
       */
      type PendingScroll =
        | { fit: true }
        | { localX: number; localY: number; offsetX: number; offsetY: number; ratio: number };
      const pendingScroll = React.useRef(null as PendingScroll | null);

      React.useEffect(() => {
        const node = stageNode();
        const pending = pendingScroll.current;
        if (node === null || pending === null) return;
        pendingScroll.current = null;
        if ("fit" in pending) {
          node.scrollLeft = (node.scrollWidth - node.clientWidth) / 2;
          node.scrollTop = (node.scrollHeight - node.clientHeight) / 2;
          return;
        }
        // 把同一个内容点重新压回光标位置——少了这一步，缩放会以左上角为
        // 锚点，光标底下的东西会跑掉。
        node.scrollLeft = pending.localX * pending.ratio - pending.offsetX;
        node.scrollTop = pending.localY * pending.ratio - pending.offsetY;
      }, [zoom]);

      const zoomAt = React.useCallback((factor: number, clientX: number, clientY: number) => {
        const stageEl = stageNode();
        const current = zoomRef.current;
        const next = Math.min(RIG_ZOOM_MAX, Math.max(RIG_ZOOM_MIN, current * factor));
        if (stageEl === null || Math.abs(next - current) < 1e-4) {
          zoomRef.current = next;
          setZoom(next);
          return;
        }
        const rect = stageEl.getBoundingClientRect();
        // 光标下的点在**可滚动内容**里的位置（含 padding）。
        pendingScroll.current = {
          localX: clientX - rect.left + stageEl.scrollLeft,
          localY: clientY - rect.top + stageEl.scrollTop,
          offsetX: clientX - rect.left,
          offsetY: clientY - rect.top,
          ratio: next / current
        };
        zoomRef.current = next;
        setZoom(next);
      }, []);

      /** 以舞台中心为锚缩放（给 +/− 按钮用；滚轮走 `zoomAt` 的光标锚点）。 */
      const zoomCenter = (factor: number) => {
        const stageEl = stageNode();
        if (stageEl === null) return;
        const rect = stageEl.getBoundingClientRect();
        zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
      };

      const fitView = React.useCallback(() => {
        pendingScroll.current = { fit: true };
        if (Math.abs(zoomRef.current - 1) < 1e-4) {
          // 已经在 100%：`setZoom` 不会产生状态变化，`useEffect([zoom])` 不会重跑，
          // 所以这里得自己把「居中」落地（拖着看过之后点适应窗口就靠它）。
          const node = stageNode();
          pendingScroll.current = null;
          if (node !== null) {
            node.scrollLeft = (node.scrollWidth - node.clientWidth) / 2;
            node.scrollTop = (node.scrollHeight - node.clientHeight) / 2;
          }
          return;
        }
        zoomRef.current = 1;
        setZoom(1);
      }, []);

      // 滚轮缩放：React 的 onWheel 是**被动**注册的，在里面 preventDefault 无效
      // （浏览器会警告且滚动照旧），所以这里手工挂一个 `{ passive: false }` 监听。
      React.useEffect(() => {
        const stageEl = stageNode();
        if (stageEl === null) return undefined;
        const onWheel = (event: WheelEvent) => {
          event.preventDefault();
          zoomAt(event.deltaY < 0 ? RIG_ZOOM_STEP : 1 / RIG_ZOOM_STEP, event.clientX, event.clientY);
        };
        stageEl.addEventListener("wheel", onWheel, { passive: false });
        return () => stageEl.removeEventListener("wheel", onWheel);
      }, [zoomAt]);

      // 空格按住 = 平移模式（与各家编辑器一致）。输入框里不能抢空格。
      React.useEffect(() => {
        const typing = () => {
          const el = document.activeElement as HTMLElement | null;
          return el !== null && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true);
        };
        const down = (event: KeyboardEvent) => {
          if (event.code !== "Space" || typing()) return;
          event.preventDefault();
          setSpaceDown(true);
        };
        const up = (event: KeyboardEvent) => {
          if (event.code === "Space") setSpaceDown(false);
        };
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        return () => {
          window.removeEventListener("keydown", down);
          window.removeEventListener("keyup", up);
        };
      }, []);

      React.useEffect(() => {
        if (pan === null) return undefined;
        const move = (event: MouseEvent) => {
          const node = stageNode();
          if (node === null) return;
          node.scrollLeft = pan.scrollLeft - (event.clientX - pan.clientX);
          node.scrollTop = pan.scrollTop - (event.clientY - pan.clientY);
        };
        const up = () => setPan(null);
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        return () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
      }, [pan]);

      /** 画布坐标（参考图像素）。 */
      const toCanvas = (clientX: number, clientY: number) => {
        const rect = wrapRef.current?.getBoundingClientRect();
        if (rect === undefined || rect === null || scale <= 0) return { x: 0, y: 0 };
        return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
      };

      /** 把一批部件「当前」的状态抓成一份快照（进历史栈 / 重做栈用）。 */
      const captureSnapshot = (names: string[]) => {
        const snapshot: any = {};
        for (const name of names) snapshot[name] = items[name] ?? null;
        return snapshot;
      };

      /** 提交一次改动：进历史栈 + 批量写回。 */
      const commit = (patches: any[], label: any) => {
        if (patches.length === 0) return;
        setHistory((stack) => [...stack.slice(-49), captureSnapshot(patches.map((patch) => patch.name))]);
        setFuture([]);
        const merged: any = {};
        for (const patch of patches) merged[patch.name] = { ...(draft[patch.name] ?? {}), ...patch };
        setDraft((current: any) => ({ ...current, ...merged }));
        void run(
          () => api.saveRigLayoutItems({ jobId: job.id, items: patches.map((patch) => ({ name: patch.name, ...patch })) }),
          label,
          activeKey
        );
      };

      /** 撤销 / 重做：把某一批部件的状态整体换回去。 */
      const applySnapshot = (snapshot: any, label: string) => {
        const patches: any[] = [];
        for (const [name, item] of Object.entries(snapshot as Record<string, any>)) {
          if (item === null || item === undefined) continue;
          patches.push({ name, x: item.x, y: item.y, width: item.width, height: item.height, rotation: item.rotation, z: item.z, placed: item.matched !== false });
        }
        if (patches.length === 0) return;
        const merged: any = {};
        for (const patch of patches) merged[patch.name] = { ...(draft[patch.name] ?? {}), ...patch };
        setDraft((current: any) => ({ ...current, ...merged }));
        void run(() => api.saveRigLayoutItems({ jobId: job.id, items: patches }), label, activeKey);
      };
      const undo = () => {
        if (history.length === 0) return;
        const last = history[history.length - 1];
        // 先把「现在这一刻」记进重做栈。历史栈里存的是**改动前**的快照，
        // 早先直接把 `last` 也塞进重做栈，重做时还原的还是改动前那一份
        // ——点重做等于又撤一次，表现就是重做按钮毫无反应。
        const current = captureSnapshot(Object.keys(last));
        setHistory((stack) => stack.slice(0, -1));
        setFuture((stack) => [...stack, current]);
        applySnapshot(last, T("已撤销"));
      };
      const redo = () => {
        if (future.length === 0) return;
        const next = future[future.length - 1];
        const current = captureSnapshot(Object.keys(next));
        setFuture((stack) => stack.slice(0, -1));
        setHistory((stack) => [...stack, current]);
        applySnapshot(next, T("已重做"));
      };

      // ── 拖动：移动 / 缩放 ───────────────────────────────────────────
      React.useEffect(() => {
        // 只处理「移动 / 缩放」。**不能把 "place" 也吃进来**：这个 effect 注册得更早，
        // 它的 mouseup 会先跑并把 drag 置空，React 随即同步重渲染、把后面那个
        // 「从部件栏拖进画布」的 mouseup 监听器当清理函数摘掉——于是拖放永远不生效。
        if (drag === null || (drag.kind !== "move" && drag.kind !== "resize")) return undefined;
        const onMove = (event: any) => {
          const point = toCanvas(event.clientX, event.clientY);
          setDrag((current) => {
            if (current === null) return current;
            const dx = point.x - current.startX;
            const dy = point.y - current.startY;
            const next = { ...current, dx, dy, shift: event.shiftKey };
            return next;
          });
          event.preventDefault();
        };
        const onUp = () => {
          const current = drag;
          setDrag(null);
          setGuides([]);
          const base = items[current.name];
          if (base === undefined) return;
          const patch = current.kind === "move" ? movePatch(base, current) : resizePatch(base, current);
          if (patch === null) return;
          commit([{ name: current.name, ...patch }], current.kind === "move" ? T("已移动「{n0}」", { n0: current.name }) : T("已缩放「{n0}」", { n0: current.name }));
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
      }, [drag, items, draft, selected, snapEnabled]);

      /** 拖动中的实时几何（未提交）。 */
      const geometryOf = (name: string): any => {
        const base = items[name];
        if (base === undefined) return undefined;
        if (drag === null || drag.name !== name) return base;
        if (drag.kind === "move") {
          let x = base.x + drag.dx;
          let y = base.y + drag.dy;
          if (drag.shift) {
            if (Math.abs(drag.dx) > Math.abs(drag.dy)) y = base.y;
            else x = base.x;
          }
          const snapped = snapEnabled ? applySnap({ ...base, x, y }, name, items) : { box: { ...base, x, y }, guides: [] };
          return { ...base, x: snapped.box.x, y: snapped.box.y };
        }
        const resized = resizeBox(base, drag);
        return resized;
      };

      // 拖动时算吸附参考线（放在 effect 里，避免在 render 中 setState）。
      React.useEffect(() => {
        if (drag === null || drag.kind !== "move" || !snapEnabled) {
          setGuides([]);
          return;
        }
        const base = items[drag.name];
        if (base === undefined) return;
        const candidate = { ...base, x: base.x + drag.dx, y: base.y + drag.dy };
        const snapped = applySnap(candidate, drag.name, items);
        setGuides(snapped.guides);
      }, [drag, items, snapEnabled]);

      // ── 键盘 ────────────────────────────────────────────────────────
      React.useEffect(() => {
        const onKey = (event: any) => {
          const tag = event.target?.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
          const meta = event.metaKey || event.ctrlKey;
          if (meta && event.key.toLowerCase() === "z") {
            event.preventDefault();
            if (event.shiftKey) redo();
            else undo();
            return;
          }
          // Ctrl/Cmd+0 = 适应窗口（与浏览器「重置缩放」同键位）。
          if (meta && event.key === "0") {
            event.preventDefault();
            fitView();
            return;
          }
          if (selected === null) return;
          const base = items[selected];
          if (base === undefined) return;
          const step = event.shiftKey ? 10 : 1;
          const move = (dx, dy) => {
            event.preventDefault();
            commit([{ name: selected, x: base.x + dx, y: base.y + dy }], T("已微调「{n0}」", { n0: selected }));
          };
          if (event.key === "ArrowLeft") move(-step, 0);
          else if (event.key === "ArrowRight") move(step, 0);
          else if (event.key === "ArrowUp") move(0, -step);
          else if (event.key === "ArrowDown") move(0, step);
          else if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            commit([{ name: selected, placed: false }], T("已收回「{n0}」", { n0: selected }));
          } else if (event.key === "Escape") setSelected(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [selected, items, draft, history, future, fitView]);

      // ── 部件栏拖进画布 ──────────────────────────────────────────────
      const startPaletteDrag = (part: any, event: any) => {
        event.preventDefault();
        setDrag({
          kind: "place",
          name: part.name,
          startX: 0,
          startY: 0,
          dx: 0,
          dy: 0,
          clientX: event.clientX,
          clientY: event.clientY
        });
      };
      React.useEffect(() => {
        if (drag === null || drag.kind !== "place") return undefined;
        const onUp = (event: any) => {
          setDrag(null);
          const rect = wrapRef.current?.getBoundingClientRect();
          if (rect === undefined || rect === null) return;
          const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
          if (!inside) return;
          const part = (job.parts ?? []).find((entry) => entry.name === drag.name);
          if (part === undefined) return;
          const existing = items[drag.name];
          const width = existing?.width ?? Math.max(4, Math.round((part.width ?? 64) * scaleHint));
          const height = existing?.height ?? Math.max(4, Math.round((part.height ?? 64) * scaleHint));
          const point = toCanvas(event.clientX, event.clientY);
          commit(
            [{ name: drag.name, x: Math.round(point.x - width / 2), y: Math.round(point.y - height / 2), width, height, placed: true }],
            T("已放置「{n0}」", { n0: drag.name })
          );
          setSelected(drag.name);
        };
        window.addEventListener("mouseup", onUp);
        return () => window.removeEventListener("mouseup", onUp);
      }, [drag, items, scaleHint, scale, draft]);

      // ── 缩放 / 图层 ────────────────────────────────────────────────
      const resizePatch = (base: any, current: any): any => {
        const box = resizeBox(base, current);
        if (Math.round(box.x) === base.x && Math.round(box.y) === base.y && Math.round(box.width) === base.width && Math.round(box.height) === base.height) return null;
        return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
      };
      function resizeBox(base: any, current: any): any {
        const handle = current.handle ?? "se";
        const [hx, hy] = handlePosition(handle);
        // 对角固定不动，被拖的那条边跟着走。
        const left = base.x;
        const top = base.y;
        const right = base.x + base.width;
        const bottom = base.y + base.height;
        const minSize = 6;
        let x0 = left;
        let y0 = top;
        let x1 = right;
        let y1 = bottom;
        if (hx === 0) x0 = left + current.dx;
        if (hx === 2) x1 = right + current.dx;
        if (hy === 0) y0 = top + current.dy;
        if (hy === 2) y1 = bottom + current.dy;
        if (x1 - x0 < minSize) {
          if (hx === 0) x0 = x1 - minSize;
          else x1 = x0 + minSize;
        }
        if (y1 - y0 < minSize) {
          if (hy === 0) y0 = y1 - minSize;
          else y1 = y0 + minSize;
        }
        let width = x1 - x0;
        let height = y1 - y0;
        if (lockRatio && current.kind === "resize" && handle.length === 2) {
          const ratio = base.height / Math.max(1, base.width);
          // 角手柄保持等比：以变化更大的一边为准。
          if (Math.abs(current.dx) > Math.abs(current.dy)) height = width * ratio;
          else width = height / ratio;
          if (hx === 0) x0 = x1 - width;
          else x1 = x0 + width;
          if (hy === 0) y0 = y1 - height;
          else y1 = y0 + height;
        }
        return { x: x0, y: y0, width, height };
      }
      function handlePosition(handle: string): [number, number] {
        const found: any = RIG_HANDLES.find((entry: any) => entry[0] === handle);
        const hx = found === undefined ? 1 : Math.round(found[1] * 2);
        const hy = found === undefined ? 1 : Math.round(found[2] * 2);
        return [hx, hy];
      }
      function movePatch(base: any, current: any): any {
        let x = base.x + current.dx;
        let y = base.y + current.dy;
        if (current.shift) {
          if (Math.abs(current.dx) > Math.abs(current.dy)) y = base.y;
          else x = base.x;
        }
        const snapped = snapEnabled ? applySnap({ ...base, x, y }, current.name, items) : { box: { x, y } };
        const nextX = Math.round(snapped.box.x);
        const nextY = Math.round(snapped.box.y);
        if (nextX === base.x && nextY === base.y) return null;
        return { x: nextX, y: nextY };
      }
      function applySnap(candidate: any, name: string, all: any): any {
        const threshold = RIG_SNAP_PX / Math.max(0.0001, scale);
        const targets: any[] = [];
        for (const [other, item] of Object.entries(all as Record<string, any>)) {
          if (other === name || item.matched === false) continue;
          targets.push({ x: [item.x, item.x + item.width / 2, item.x + item.width], y: [item.y, item.y + item.height / 2, item.y + item.height] });
        }
        targets.push({ x: [canvasW / 2], y: [canvasH / 2] });
        const lines: any[] = [];
        let best: any = { dx: null, dy: null, distX: threshold, distY: threshold };
        const mineX = [candidate.x, candidate.x + candidate.width / 2, candidate.x + candidate.width];
        const mineY = [candidate.y, candidate.y + candidate.height / 2, candidate.y + candidate.height];
        for (const target of targets as any[]) {
          for (const tx of target.x) {
            for (const mx of mineX) {
              const dist = Math.abs(mx - tx);
              if (dist < best.distX) best = { ...best, dx: tx - mx, distX: dist };
            }
          }
          for (const ty of target.y) {
            for (const my of mineY) {
              const dist = Math.abs(my - ty);
              if (dist < best.distY) best = { ...best, dy: ty - my, distY: dist };
            }
          }
        }
        const box: any = {
          ...candidate,
          x: best.dx === null ? candidate.x : candidate.x + best.dx,
          y: best.dy === null ? candidate.y : candidate.y + best.dy
        };
        if (best.dx !== null) lines.push({ axis: "x", at: box.x + (best.distX >= 0 ? 0 : 0) });
        return { box, guides: lines };
      }

      const changeZ = (name: string, mode: string) => {
        const ordered = Object.keys(items)
          .filter((key) => items[key].matched !== false)
          .sort((a, b) => (items[a].z ?? 0) - (items[b].z ?? 0));
        const index = ordered.indexOf(name);
        if (index < 0) return;
        const reordered = [...ordered];
        reordered.splice(index, 1);
        if (mode === "front") reordered.push(name);
        else if (mode === "back") reordered.unshift(name);
        else if (mode === "up") reordered.splice(Math.min(ordered.length - 1, index + 1), 0, name);
        else reordered.splice(Math.max(0, index - 1), 0, name);
        const patches = reordered.map((key, position) => ({ name: key, z: position }));
        commit(patches, T("已调整图层顺序"));
      };

      const patchSelected = (patch: any, label: any) => {
        if (selected === null) return;
        commit([{ name: selected, ...patch }], label);
      };

      if (placedNames.length === 0 && notYetPlaced.length === 0) {
        return h("p", { className: "SPR_hint" }, T("还没有可用部件，请先在第 ① 步拆件或上传部件 PNG。"));
      }

      return h(
        "div",
        { className: "SPR_asm" },
        // ── 工具条 ────────────────────────────────────────────────
        h(
          "div",
          { className: "SPR_asmBar" },
          h("span", { className: "SPR_asmGroup" },
            h("span", { className: "SPR_fieldLabel" }, T("缩放")),
            h(Btn, { onClick: () => zoomCenter(1 / RIG_ZOOM_STEP), title: T("缩小") }, "−"),
            h(Btn, { onClick: fitView, "data-testid": "rig-asm-fit", title: T("适应窗口（Ctrl/Cmd+0）") }, `${Math.round(zoom * 100)}%`),
            h(Btn, { onClick: () => zoomCenter(RIG_ZOOM_STEP), title: T("放大") }, "+")
          ),
          h("span", { className: "SPR_asmGroup" },
            h(Btn, { on: showReference, onClick: () => setShowReference((v) => !v), title: T("把参考图叠在下面，方便对位") }, T("参考图底图")),
            h(Btn, { on: showBoxes, onClick: () => setShowBoxes((v) => !v) }, T("显示边框")),
            h(Btn, { on: snapEnabled, onClick: () => setSnapEnabled((v) => !v), title: T("拖动时吸附到其它部件的边与中线") }, T("吸附")),
            h(Btn, { on: lockRatio, onClick: () => setLockRatio((v) => !v), title: T("拖角手柄时保持宽高比") }, T("锁等比"))
          ),
          h("span", { className: "SPR_asmGroup" },
            h(Btn, { onClick: undo, disabled: history.length === 0 }, T("撤销{n0}", { n0: history.length > 0 ? `(${history.length})` : "" })),
            h(Btn, { onClick: redo, disabled: future.length === 0 }, T("重做"))
          ),
          h("span", { className: "SPR_spacer" }),
          h("span", { className: "SPR_asmHint" },
            T("已放置 {n0}/{n1}　·　拖部件移动、拖角缩放、方向键微调 1px（Shift 10px）、Delete 收回、滚轮缩放、空格拖动平移", { n0: placedNames.length, n1: (job.parts ?? []).filter((part) => part.status === "ready").length }))
        ),

        h(
          "div",
          { className: "SPR_asmBody" },
          // ── 画布 ──────────────────────────────────────────────
          h(
            "div",
            {
              className: "SPR_asmStage",
              ref: stageRef,
              "data-pan": spaceDown ? "true" : undefined,
              "data-panning": pan !== null ? "true" : undefined,
              "data-testid": "rig-asm-stage",
              onMouseDown: (event: any) => {
                // 空格按住或中键 = 平移。平移期间不能让后面那些拖拽逻辑接手。
                if (spaceDown || event.button === 1) {
                  event.preventDefault();
                  const node = stageNode();
                  if (node === null) return;
                  setPan({ clientX: event.clientX, clientY: event.clientY, scrollLeft: node.scrollLeft, scrollTop: node.scrollTop });
                }
              }
            },
            h(
              "div",
              {
                className: "SPR_asmCanvas",
                ref: wrapRef,
                onMouseDown: (event: any) => {
                  if (event.target === event.currentTarget) setSelected(null);
                },
                style: { width: canvasW * scale, height: canvasH * scale }
              },
              showReference && job.sourceUrl !== null
                ? h("img", { className: "SPR_asmRef", src: job.sourceUrl, alt: "reference", draggable: false })
                : null,
              placedNames.map((name) => {
                const box = geometryOf(name) ?? items[name];
                const part = (job.parts ?? []).find((entry) => entry.name === name);
                if (part?.url === null || part?.url === undefined) return null;
                return h("img", {
                  key: `layer:${name}`,
                  className: "SPR_asmLayer",
                  src: part.url,
                  alt: name,
                  draggable: false,
                  style: {
                    left: box.x * scale,
                    top: box.y * scale,
                    width: Math.max(1, box.width * scale),
                    height: Math.max(1, box.height * scale),
                    transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
                    opacity: part.hidden === true ? 0.25 : 1
                  }
                });
              }),
              guides.map((guide, index) =>
                h("div", { key: `guide:${index}`, className: "SPR_asmGuide", style: { left: guide.at * scale } })
              ),
              showBoxes
                ? placedNames.map((name) => {
                    const box = geometryOf(name) ?? items[name];
                    const isSelected = selected === name;
                    return h(
                      "div",
                      {
                        key: `box:${name}`,
                        className: "SPR_rigBox",
                        "data-selected": isSelected ? "true" : undefined,
                        style: { left: box.x * scale, top: box.y * scale, width: Math.max(6, box.width * scale), height: Math.max(6, box.height * scale) },
                        onMouseDown: (event: any) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setSelected(name);
                          const point = toCanvas(event.clientX, event.clientY);
                          setDrag({ kind: "move", name, startX: point.x, startY: point.y, dx: 0, dy: 0 });
                        }
                      },
                      isSelected
                        ? RIG_HANDLES.map(([handle, fx, fy]: any) =>
                            h("span", {
                              key: handle,
                              className: "SPR_asmHandle",
                              "data-handle": handle,
                              style: { left: `${fx * 100}%`, top: `${fy * 100}%` },
                              onMouseDown: (event: any) => {
                                event.preventDefault();
                                event.stopPropagation();
                                const point = toCanvas(event.clientX, event.clientY);
                                setDrag({ kind: "resize", name, handle, startX: point.x, startY: point.y, dx: 0, dy: 0 });
                              }
                            })
                          )
                        : null,
                      h("span", { className: "SPR_rigBoxLabel" }, (job.parts ?? []).find((p) => p.name === name)?.label ?? name)
                    );
                  })
                : null
            )
          ),

          // ── 右侧：部件栏 + 参数 ─────────────────────────────────
          h(
            "div",
            { className: "SPR_asmSide" },
            h("div", { className: "SPR_sideTitle" }, T("未放置（{n0}）· 拖进画布", { n0: unplaced.length + notYetPlaced.length })),
            h(
              "div",
              { className: "SPR_asmPalette" },
              [...unplaced, ...notYetPlaced].map((part) =>
                h(
                  "div",
                  {
                    key: `palette:${part.name}`,
                    className: "SPR_asmChip",
                    onMouseDown: (event: any) => startPaletteDrag(part, event)
                  },
                  part.url !== null && part.url !== undefined ? h("img", { src: part.url, alt: part.name, draggable: false }) : null,
                  h("span", null, part.label ?? part.name)
                )
              ),
              unplaced.length + notYetPlaced.length === 0 ? h("p", { className: "SPR_hint" }, T("全部部件都已放置。")) : null
            ),

            selectedItem !== undefined && selected !== null
              ? h(
                  "div",
                  { className: "SPR_asmPanel" },
                  h("div", { className: "SPR_sideTitle" }, T("选中：{n0}", { n0: selectedPart?.label ?? selected })),
                  h(
                    "div",
                    { className: "SPR_asmFields" },
                    h(NumField, { label: "x", value: selectedItem.x, onChange: (value) => patchSelected({ x: value }, T("已修改 x")) }),
                    h(NumField, { label: "y", value: selectedItem.y, onChange: (value) => patchSelected({ y: value }, T("已修改 y")) }),
                    h(NumField, { label: T("宽"), value: selectedItem.width, min: 1, onChange: (value) => patchSelected(lockRatio ? { width: value, height: Math.round((value * selectedItem.height) / Math.max(1, selectedItem.width)) } : { width: value }, T("已修改宽度")) }),
                    h(NumField, { label: T("高"), value: selectedItem.height, min: 1, onChange: (value) => patchSelected(lockRatio ? { height: value, width: Math.round((value * selectedItem.width) / Math.max(1, selectedItem.height)) } : { height: value }, T("已修改高度")) }),
                    h(NumField, { label: T("旋转"), value: selectedItem.rotation, step: 5, onChange: (value) => patchSelected({ rotation: value }, T("已旋转")) }),
                    h(NumField, { label: T("层级"), value: selectedItem.z, onChange: (value) => patchSelected({ z: value }, T("已修改层级")) })
                  ),
                  h(
                    "div",
                    { className: "SPR_asmRow" },
                    h(Btn, { onClick: () => changeZ(selected, "front") }, T("置顶")),
                    h(Btn, { onClick: () => changeZ(selected, "up") }, T("上移")),
                    h(Btn, { onClick: () => changeZ(selected, "down") }, T("下移")),
                    h(Btn, { onClick: () => changeZ(selected, "back") }, T("置底"))
                  ),
                  h(
                    "div",
                    { className: "SPR_asmRow" },
                    h(Btn, { onClick: () => patchSelected({ width: selectedItem.height, height: selectedItem.width }, T("已交换宽高")) }, T("宽高互换")),
                    h(
                      BusyBtn,
                      {
                        busy: busy,
                        busyText: T("重定位中…"),
                        onClick: () => void run(() => api.runRigLayout({ jobId: job.id, names: [selected] }), T("已重新自动定位「{n0}」", { n0: selected }), activeKey)
                      },
                      T("这块重新自动定位")
                    ),
                    h(Btn, { onClick: () => commit([{ name: selected, placed: false }], T("已收回「{n0}」", { n0: selected })), danger: true }, T("收回部件"))
                  ),
                  selectedItem.matched === false
                    ? h("p", { className: "SPR_hint" }, T("这块目前是「未放置」状态：拖到画布上或点上面的数值确认即可放回。"))
                    : null
                )
              : h("div", { className: "SPR_asmPanel" }, h("p", { className: "SPR_hint" }, T("在画布上点一个部件，这里会出现它的精确参数与图层操作。"))),

            h(
              "div",
              { className: "SPR_asmPanel" },
              h("div", { className: "SPR_sideTitle" }, T("图层（从下到上）")),
              h(
                "ol",
                { className: "SPR_asmLayers" },
                placedNames.slice().reverse().map((name) =>
                  h(
                    "li",
                    {
                      key: `layer-row:${name}`,
                      "data-active": selected === name ? "true" : "false",
                      onClick: () => setSelected(name)
                    },
                    h("span", null, (job.parts ?? []).find((p) => p.name === name)?.label ?? name),
                    h(
                      "span",
                      { className: "SPR_asmLayerBtns" },
                      h("button", { type: "button", className: "SPR_miniBtn", onClick: (event) => { event.stopPropagation(); changeZ(name, "up"); } }, "↑"),
                      h("button", { type: "button", className: "SPR_miniBtn", onClick: (event) => { event.stopPropagation(); changeZ(name, "down"); } }, "↓")
                    )
                  )
                )
              )
            )
          )
        )
      );
    }

    const RigModuleRaw = createRigModule({ React, h, T, useLocaleTick, useStudioIntent, msg, mergeDrafts, askNewName, Chip, StatusChip, Btn, NumField, useGlobalConfig, usePendingTasks, LoadingOverlay, BusyBtn, BusyBadge, ReviewModeBar, readFileBase64, UploadBox, CopyIdButton, JobLogPanel, RIG_ANIMATIONS, RIG_STAGES, K_RIG_JOB, K_RIG_SHEET, K_RIG_SEGMENT, K_RIG_QA, K_RIG_LAYOUT, K_RIG_BONES, K_RIG_ATLAS, K_RIG_CREATE, RIG_BUSY_LABEL, rigStageOf, RigPartCard, RigSemanticsPanel, RigBoneEditor, RigAnimationPanel, RigTimelineEditor, RigQaPanel, RigConstraintPanel, RigMeshPanel, RigPathPanel, RigTexturePanel, RigAssemblyEditor, experimentalGateMuted, ExperimentalBar, RigExperimentalDialog });

  // 错误隔离：整个模块挂一层边界（单模块故障只降级这一块）
  const RigBoundary = createFeatureBoundary({ name: "rig" });

  return {
    rebuildStaticText,
    RIG_ANIMATIONS, make_RIG_ROLES, RIG_ROLES, make_RIG_STAGES, RIG_STAGES, K_RIG_JOB, K_RIG_SHEET, K_RIG_SEGMENT, K_RIG_QA, K_RIG_LAYOUT, K_RIG_BONES, K_RIG_ATLAS, K_RIG_CREATE, K_RIG_REDRAW, make_RIG_BUSY_LABEL, RIG_BUSY_LABEL, rigStageOf, TRACK_VALUE_KEYS, make_TRACK_LABELS, TRACK_LABELS, make_EASING_PRESETS, EASING_PRESETS, easingNameOf, sampleTrack, IDENTITY_TINT, tintToCssFilter, describeTint, noteSuffix, RIG_ZOOM_MIN, RIG_ZOOM_MAX, RIG_ZOOM_STEP, RIG_HANDLES, RIG_SNAP_PX, defaultItemOf, experimentalGateMuted, ExperimentalDialog, ExperimentalBar, RigExperimentalDialog, EXPERIMENTAL_REPO, make_RIG_EXPERIMENTAL_POINTS, RIG_EXPERIMENTAL_POINTS, RigPartCard, RigSemanticsPanel, RigBoneEditor, RigAnimationPanel, RigTimelineEditor, RigQaPanel, RigConstraintPanel, RigMeshPanel, RigPathPanel, RangeRow, RigTexturePanel, RigAssemblyEditor,
    RigModule: (props: any) => h(RigBoundary, null, h(RigModuleRaw, props))
  };
}
