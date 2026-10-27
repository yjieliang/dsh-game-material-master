/**
 * 浏览器半区 —— 通用小工具与基础组件。
 *
 * 这些函数原来直接写在 `src/client.ts` 的工厂闭包里；拆出来之后由 client.ts 的
 * `createUiKit({ React, h, T })` 注入三个依赖并取回组件表，其余模块再从 client.ts
 * 拿到的同一份引用使用（模块工厂的入参形态与既有 createXxxModule 一致）。
 *
 * 约束：
 *   · 只用 React.createElement（没有 JSX），React 由宿主 require 提供；
 *   · 文案一律走 T()，以中文原文作为词条 key，不要在这里拼字符串；
 *   · 只做展示与纯函数，不直接发远程调用。
 */

/**
 * @param deps.React - 宿主注入的 react
 * @param deps.h - deps.React.createElement 的简写
 * @param deps.T - 词条翻译函数（中文原文 → 当前语言）
 */
export function createUiKit({ React, h, T }: any) {
    // ── 小工具 ───────────────────────────────────────────────────────────
    function cls(...parts) {
      return parts.filter(Boolean).join(" ");
    }

    /** 从 unknown 的 catch 参数里取一条可读消息。 */
    function msg(error) {
      if (error instanceof Error) return error.message;
      if (error !== null && typeof error === "object" && typeof (error as any).message === "string") return (error as any).message;
      return String(error);
    }

    /** 两个草稿值是否相同：草稿都是宿主回包里的纯 JSON，对象按序列化结果比。 */
    function sameDraft(a, b) {
      if (a === b) return true;
      if (a === undefined || b === undefined || a === null || b === null) return false;
      if (typeof a !== "object" || typeof b !== "object") return false;
      return JSON.stringify(a) === JSON.stringify(b);
    }

    /**
     * 把「界面草稿」和「宿主刚拉回来的值」合起来，**只更新用户没动过的字段**。
     *
     * 为什么需要：有任务在跑时界面会轮询（模块①每 2.5 秒、视频阶段固定每 5 秒；
     * 模块②③④ 每 2.5~5 秒），每次都调一次 `load()` / `loadProject()`。之前它们
     * 无条件拿宿主的值整份覆盖草稿 —— 用户正在长文本框里替换提示词时，刚打进去的
     * 内容会在一两秒内被打回原形（真机反馈：「这个提示词是无法替换的呀，我替换的
     * 时候它一秒钟又换回来」）。
     *
     * 判定标准：草稿 === 上一次从宿主读到的值 ⇒ 没改过，跟着宿主走（切语言、
     * 重置为默认、别处改了这一条都能同步）；不相等 ⇒ 用户改过，留着，直到他自己
     * 保存或点「重置为默认」。
     *
     * @param force - 换项目 / 换任务 / 明确要重置时传 true：整份换成宿主的值。
     */
    function mergeDrafts(current, previous, next, force) {
      if (force === true) return next;
      if (next === null || typeof next !== "object") {
        // 标量（提示词这种一整段文本）：没改过才跟着宿主走。
        return current === undefined || current === previous ? next : current;
      }
      const merged = {};
      for (const key of Object.keys(next)) {
        const drafted = current !== null && typeof current === "object" ? current[key] : undefined;
        merged[key] = drafted === undefined || sameDraft(drafted, previous?.[key]) ? next[key] : drafted;
      }
      return merged;
    }

    /**
     * 新建项目 / 任务时问一个名字（与「重命名」同一套 `window.prompt` 交互）。
     *
     * 返回值语义是**三态**，调用方必须照着写：
     *   · `null`      —— 用户点了取消 → **不要创建**（点了取消却多出一个项目，会被当成 bug）
     *   · 空串/全空白 —— 用 `fallback`（默认名）
     *   · 其余        —— 用户输入的名字（已 trim）
     * 没有 `window.prompt` 的宿主退回默认名，不阻断创建。
     */
    function askNewName(title, fallback) {
      if (typeof window === "undefined" || typeof window.prompt !== "function") return fallback;
      /**
       * ⚠️ `typeof window.prompt === "function"` **不足以判断能用**：Electron（DSH 桌面端）
       * 里这个函数存在，但一调用就抛「prompt() is and will not be supported」。抛出去的话
       * 调用方的 async 处理器直接变成未处理拒绝 —— 界面表现是「点了新建什么都没发生」。
       * 这里兜住并退回默认名：至少把项目建出来，用户随后改名即可。
       * （模块六的「新建项目」已经改成自带对话框，不再走这里。）
       */
      let value = null;
      try {
        value = window.prompt(title, fallback);
      } catch {
        return fallback;
      }
      if (value === null) return null;
      const trimmed = String(value).trim();
      return trimmed === "" ? fallback : trimmed;
    }

    function statusKind(node) {
      if (node === undefined) return { kind: "empty", text: T("未生成") };
      if (node.approved) return { kind: "approved", text: T("已通过") };
      if (node.status === "running") return { kind: "running", text: T("进行中") };
      if (node.status === "error") return { kind: "error", text: T("失败") };
      if (node.status === "ready") {
        if (node.stale) return { kind: "stale", text: T("需重做") };
        return { kind: "ready", text: T("已完成") };
      }
      return { kind: "empty", text: T("未生成") };
    }

    function Chip({ kind, text }) {
      return h("span", { className: "SPR_chip", "data-kind": kind }, text);
    }

    function StatusChip({ node }) {
      const info = statusKind(node);
      return h(Chip, { kind: info.kind, text: info.text });
    }

    /**
     * 基础按钮。
     *
     * `...rest` 透传到 `<button>`：主要是让调用点能挂 `data-testid`——
     * 界面测试（Playwright）靠它定位，而按可见文字定位在中文文案改动时很脆。
     * 之前不透传，结果是「明明写了 data-testid 但测试找不到元素」。
     */
    function Btn({ children, onClick, disabled, primary, on, danger, title, busy, ...rest }) {
      return h(
        "button",
        {
          type: "button",
          className: "SPR_btn",
          ...rest,
          onClick,
          disabled: disabled === true,
          title,
          "data-primary": primary === true ? "true" : undefined,
          "data-on": on === true ? "true" : undefined,
          "data-danger": danger === true ? "true" : undefined,
          "data-busy": busy === true ? "true" : undefined,
          "aria-busy": busy === true ? "true" : undefined
        },
        children
      );
    }


    function NumField({ label, value, onChange, min, max, step, hint, disabled, testId }) {
      const [text, setText] = React.useState(String(value ?? ""));
      const [focused, setFocused] = React.useState(false);
      // 外部值变了（宿主回包、切换项目）而用户没在输入时，同步过来。
      React.useEffect(() => {
        if (!focused) setText(String(value ?? ""));
      }, [value, focused]);
      /**
       * ⚠️ 必须传 `onChange`（不是 `onCommit`）。
       *
       * 曾经有 5 个调用点写成 `onCommit`，而这里解构的是 `onChange` ——
       * 于是 `onChange` 是 `undefined`，一失焦就抛 `onChange is not a function`，
       * **值永远同步不进草稿**：用户改了「变体数 / 占格」，点保存看着成功，
       * 实际提交的还是旧值（真机表现：「改了变体数保存后还是 2」）。
       *
       * 这里主动校验一次并把错误说清楚 —— 静默失败比直接报错难查得多。
       */
      if (onChange === undefined) {
        throw new Error(`NumField「${label ?? ""}」缺少 onChange —— 是不是写成了 onCommit？`);
      }
      const commit = () => {
        const parsed = Number(text);
        if (text.trim() === "" || !Number.isFinite(parsed)) {
          setText(String(value ?? ""));
          return;
        }
        const clamped = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, parsed));
        setText(String(clamped));
        if (clamped !== value) onChange(clamped);
      };
      return h(
        "label",
        { className: "SPR_field", "data-num-field": "1" },
        h("span", { className: "SPR_fieldLabel" }, label),
        h("input", {
          className: "SPR_input",
          type: "number",
          inputMode: "decimal",
          value: text,
          min,
          max,
          step: step === undefined ? 1 : step,
          ...(testId === undefined ? {} : { "data-testid": testId }),
          // 不能用的字段要**看得出来**：整格没有动画，帧数锁在 1（见 AI 对话框）。
          disabled: disabled === true ? true : undefined,
          "data-disabled": disabled === true ? "true" : undefined,
          "data-dirty": focused && text !== String(value ?? "") ? "true" : undefined,
          onChange: (event) => setText(event.target.value),
          onFocus: (event) => {
            setFocused(true);
            // 光标落进来就全选：改参数基本都是整份替换，省一次三击。
            try {
              event.target.select?.();
            } catch {
              /* 个别浏览器对 number 输入框的 select 有限制，忽略即可 */
            }
          },
          onBlur: () => {
            setFocused(false);
            commit();
          },
          onKeyDown: (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }
        }),
        hint === undefined ? null : h("span", { className: "SPR_fieldLabel" }, hint)
      );
    }

    function useGlobalConfig(api) {
      const [value, setValue] = React.useState(null);
      React.useEffect(() => {
        let alive = true;
        void (async () => {
          try {
            const next = await api.getConfig();
            if (alive) setValue(next);
          } catch {
            /* 取不到就退回任务里记录的值 */
          }
        })();
        return () => {
          alive = false;
        };
      }, [api]);
      return value;
    }

    /** 只读展示当前生效的全局模型：模型只在设置里改，模块内不允许覆盖。 */
    function GlobalModelField({ label, value }) {
      return h(
        "label",
        { className: "SPR_field" },
        h("span", { className: "SPR_fieldLabel" }, label),
        h("input", { className: "SPR_input", value: value ?? "", readOnly: true, disabled: true }),
        h("span", { className: "SPR_fieldLabel" }, T("跟随即「设置 → 游戏素材大师」"))
      );
    }

    function assetUrl(project, relative, version) {
      if (project === null || relative === undefined || relative === null) return undefined;
      const base = project.assetBase ?? "";
      const suffix = version === undefined ? "" : `?v=${version}`;
      return `${base}${relative}${suffix}`;
    }

    function ZoomableImage({ src, alt, className, caption, style }) {
      const [open, setOpen] = React.useState(false);
      React.useEffect(() => {
        if (!open) return undefined;
        const onKey = (event) => {
          if (event.key === "Escape") setOpen(false);
        };
        if (typeof window !== "undefined") window.addEventListener("keydown", onKey);
        return () => {
          if (typeof window !== "undefined") window.removeEventListener("keydown", onKey);
        };
      }, [open]);
      const openImage = (event) => {
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
      };
      return h(
        React.Fragment,
        null,
        h("img", {
          className,
          src,
          alt,
          style,
          title: T("双击看大图"),
          "data-zoomable": "true",
          onDoubleClick: openImage
        }),
        open
          ? h(
              "div",
              {
                className: "SPR_zoomMask",
                role: "dialog",
                "aria-modal": "true",
                "data-testid": "zoom-mask",
                onClick: () => setOpen(false)
              },
              h(
                "button",
                {
                  type: "button",
                  className: "SPR_zoomClose",
                  "aria-label": T("关闭大图"),
                  title: T("关闭（Esc）"),
                  "data-testid": "zoom-close",
                  onClick: (event) => {
                    event.stopPropagation();
                    setOpen(false);
                  }
                },
                "×"
              ),
              h("img", {
                className: "SPR_zoomImg",
                src,
                alt,
                onClick: (event) => event.stopPropagation()
              }),
              caption !== undefined && caption !== null ? h("div", { className: "SPR_zoomCaption" }, caption) : null
            )
          : null
      );
    }

    const TASK_HOLD_MS = 700;

    function usePendingTasks() {
      // React 经由 require 拿到，是 any，不能写泛型实参（TS2347）。
      const [map, setMap] = React.useState({});
      const aliveRef = React.useRef(true);
      const timersRef = React.useRef([]);

      React.useEffect(() => {
        aliveRef.current = true;
        const timers = timersRef.current;
        return () => {
          aliveRef.current = false;
          for (const id of timers) clearTimeout(id);
          timers.length = 0;
        };
      }, []);

      const release = React.useCallback((key) => {
        const id = setTimeout(() => {
          if (!aliveRef.current) return;
          setMap((current) => {
            if (current[key] === undefined) return current;
            const next = { ...current };
            delete next[key];
            return next;
          });
        }, TASK_HOLD_MS);
        timersRef.current.push(id);
      }, []);

      const run = React.useCallback(
        (key, label, fn) => {
          if (!aliveRef.current) return Promise.resolve(undefined);
          setMap((current) => (current[key] === label ? current : { ...current, [key]: label }));
          return Promise.resolve()
            .then(fn)
            .then(
              (value) => {
                release(key);
                return value;
              },
              (error) => {
                release(key);
                throw error;
              }
            );
        },
        [release]
      );

      const has = React.useCallback((key) => map[key] !== undefined, [map]);
      const label = React.useCallback((key) => map[key], [map]);
      const any = React.useCallback((prefix) => Object.keys(map).some((key) => key.startsWith(prefix)), [map]);
      const keys = React.useCallback((prefix) => Object.keys(map).filter((key) => key.startsWith(prefix)), [map]);
      const active = Object.keys(map).length > 0;
      // 第一条 pending 的文案，用作「总有一个在跑」时的兜底显示。
      const firstLabel = Object.values(map)[0];

      return { map, run, has, label, any, keys, active, firstLabel };
    }

    function LoadingOverlay({ show, text, sub }) {
      if (show !== true) return null;
      return h(
        "div",
        { className: "SPR_ovl", role: "status", "aria-live": "polite", "aria-busy": "true" },
        h("span", { className: "SPR_spin" }),
        h("span", { className: "SPR_ovlText" }, text ?? T("处理中…")),
        sub === undefined || sub === null ? null : h("span", { className: "SPR_ovlSub" }, sub)
      );
    }

    function MediaBox({ overlay, text, className, children }) {
      return h(
        "div",
        { className: cls("SPR_thumbBox", className) },
        h("div", { style: { visibility: overlay === true ? "hidden" : undefined } }, children),
        h(LoadingOverlay, { show: overlay === true, text: text ?? T("正在生成…") })
      );
    }

    /** 按钮级别的「正在跑」：转圈 + 文案，并把按钮本身置灰防重复点击。 */
    function BusyBtn({ busy, busyText, children, onClick, ...rest }) {
      return h(
        Btn,
        { ...rest, onClick, disabled: busy === true || rest.disabled === true, busy: busy === true },
        busy === true ? h("span", { className: "SPR_spinSm" }) : null,
        busy === true ? busyText ?? T("处理中…") : children
      );
    }

    /** 工具栏上的状态徽章：有任务在跑时显示，同时兼作按钮区的位置占位。 */
    function BusyBadge({ show, text }) {
      if (show !== true) return null;
      return h(
        "span",
        { className: "SPR_busyBadge", role: "status", "aria-live": "polite" },
        h("span", { className: "SPR_spinSm" }),
        text ?? T("正在处理…")
      );
    }

    function ReviewModeBar({ api, module, id, mode, onChanged }) {
      const [busy, setBusy] = React.useState(false);
      const change = async (next) => {
        if (busy || next === "" || id === null || id === undefined) return;
        setBusy(true);
        try {
          await api.setReviewMode({ module, id, reviewMode: next });
          if (onChanged !== undefined) onChanged(next);
        } catch {
          // 失败就保持原值；下一次轮询会把宿主上的真实值带回来。
        } finally {
          setBusy(false);
        }
      };
      return h(
        "div",
        { className: "SPR_toolbar" },
        h("span", { className: "SPR_refRow" }, T("审核模式")),
        h(
          "select",
          {
            className: "SPR_input",
            style: { width: 210 },
            value: mode ?? "",
            disabled: busy || id === null || id === undefined,
            onChange: (event) => void change(event.target.value)
          },
          h("option", { value: "" }, T("未设置（对话里会先问）")),
          h("option", { value: "auto" }, T("自动审核")),
          h("option", { value: "manual" }, T("每一步人工审核"))
        ),
        h(
          "span",
          { className: "SPR_refRow" },
          mode === "manual"
            ? T("每一步产出后 agent 会贴出验收链接并停下来等你确认")
            : mode === "auto"
              ? T("agent 自己检查每步产出后继续推进")
              : T("还没定：对话里 agent 会先问你要哪种")
        )
      );
    }

    /** 单个产物的「通过 / 取消通过」。与对话里的 game_material({action:'approve'}) 同一份数据。 */
    function ApproveBtn(props) {
      const { approved, disabled, onToggle, idleText } = props;
      return h(
        Btn,
        { on: approved === true, disabled: disabled === true, onClick: onToggle },
        approved === true ? T("已通过") : idleText ?? T("通过")
      );
    }

    // ── 公共小工具 ──────────────────────────────────────────────────────
    /** 把 File 读成不带 data: 前缀的 base64。 */
    function readFileBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result ?? "");
          resolve(text.slice(text.indexOf(",") + 1));
        };
        reader.onerror = () => reject(new Error(T("读取文件失败")));
        reader.readAsDataURL(file);
      });
    }

    /** 一个「拖进来或点按钮选文件」的上传区。 */
    function UploadBox({ label, accept, multiple, onFiles, busy }) {
      const [over, setOver] = React.useState(false);
      const inputRef = React.useRef(null);
      const handle = (files) => {
        const list = Array.from(files ?? []);
        if (list.length > 0) void onFiles(list);
      };
      return h(
        React.Fragment,
        null,
        h(
          "div",
          {
            className: "SPR_drop",
            "data-over": over ? "true" : "false",
            "data-busy": busy === true ? "true" : undefined,
            onDragOver: (event) => {
              event.preventDefault();
              setOver(true);
            },
            onDragLeave: () => setOver(false),
            onDrop: (event) => {
              event.preventDefault();
              setOver(false);
              handle(event.dataTransfer?.files);
            }
          },
          busy === true
            ? h(
                "span",
                { style: { display: "inline-flex", alignItems: "center", gap: 7, justifyContent: "center" } },
                h("span", { className: "SPR_spinSm" }),
                T("正在上传…")
              )
            : label
        ),
        h(
          "div",
          { className: "SPR_toolbar" },
          h(BusyBtn, { onClick: () => inputRef.current?.click(), busy: busy === true, busyText: T("正在上传…") }, T("选择文件")),
          h("input", {
            ref: inputRef,
            type: "file",
            accept,
            multiple: multiple === true,
            style: { display: "none" },
            onChange: (event) => {
              handle(event.target.files);
              event.target.value = "";
            }
          })
        )
      );
    }

    function LocalVideoPick({ label, title, onFile, disabled, testId }) {
      return h(
        "label",
        {
          className: "SPR_btn SPR_fileBtn",
          "data-disabled": disabled === true ? "true" : undefined,
          title,
          "data-testid": testId
        },
        label,
        h("input", {
          type: "file",
          accept: "video/*",
          disabled: disabled === true,
          style: { display: "none" },
          "data-testid": testId === undefined ? undefined : `${testId}-input`,
          onChange: (event) => {
            const file = event.target.files?.[0];
            // 先清空 value：同一个文件连选两次也要能触发 change。
            event.target.value = "";
            if (file !== undefined && file !== null) void onFile(file);
          }
        })
      );
    }

    /** `download` 属性要的是**文件名**：带上目录浏览器会当非法名丢掉。 */
    function fileLabel(relative) {
      const name = String(relative ?? "").split("/").pop() ?? "";
      return name === "" ? "asset.png" : name;
    }

    function SaveLink({ url, name, label, busy, title }) {
      if (url === undefined || url === null) return null;
      return h(
        "a",
        {
          className: "SPR_btn SPR_fileBtn",
          href: url,
          download: name,
          title,
          style: { textDecoration: "none" },
          "aria-disabled": busy === true ? "true" : undefined,
          onClick: busy === true ? (event) => event.preventDefault() : undefined
        },
        label ?? T("保存")
      );
    }

    const KEY_LOCAL_VIDEO = (key) => `local-video:${key}`;

    function pickLocalVideo({ start, setNotice, api, project, key, file, label }: any) {
      if (project === null || file === undefined || file === null) return;
      void start(
        async () => {
          const data = await readFileBase64(file);
          const result = await api.uploadVideo({ projectId: project.id, key, name: file.name, data });
          setNotice({
            kind: "ok",
            text:
              key === "turn"
                ? result?.extractStarted === true
                  ? T("已选用本地视频，正在抽候选帧并切出八个方向…")
                  : T("已选用本地视频（抽帧没有自动开始，点「抽取候选帧」即可）")
                : T("已选用「{n0}」的本地视频，接着到第 3 步抽取序列帧", { n0: label ?? key })
          });
          return result;
        },
        { reload: true },
        { key: KEY_LOCAL_VIDEO(key), label: T("正在导入本地视频…") }
      );
    }

    /** 抠像参数表单（三个模块共用同一套字段）。 */
    function KeyingFields({ draft, onChange }) {
      return h(
        "div",
        { className: "SPR_fields" },
        h(NumField, { label: T("抠像下限（绿色优势）"), value: draft.keyLow ?? 14, min: 0, max: 255, onChange: (v) => onChange({ keyLow: v }) }),
        h(NumField, { label: T("抠像上限（绿色优势）"), value: draft.keyHigh ?? 80, min: 1, max: 255, onChange: (v) => onChange({ keyHigh: v }) }),
        h(NumField, { label: T("去绿溢出 0~1"), value: draft.despill ?? 0.65, min: 0, max: 1, step: 0.05, onChange: (v) => onChange({ despill: v }) }),
        h(NumField, { label: T("背景分割容差（0 = 只认绿色）"), value: draft.bgTolerance ?? 90, min: 0, max: 160, onChange: (v) => onChange({ bgTolerance: v }) }),
        h(NumField, { label: T("边缘收缩（px）"), value: draft.edgeShrink ?? 0, min: 0, max: 8, onChange: (v) => onChange({ edgeShrink: v }) })
      );
    }

    async function copyIdText(text) {
      if (typeof navigator !== "undefined" && navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === "function") {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          /* 剪贴板权限被拒时走下面的兜底 */
        }
      }
      try {
        if (typeof document === "undefined" || document.body === undefined || document.body === null) return false;
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "readonly");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        area.style.top = "0";
        document.body.appendChild(area);
        area.select();
        const ok = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
        document.body.removeChild(area);
        return ok === true;
      } catch {
        return false;
      }
    }

    function CopyIdButton({ id, inline = false, className = "" }) {
      const [state, setState] = React.useState("idle");
      const timer = React.useRef(null);
      React.useEffect(() => () => {
        if (timer.current !== null) clearTimeout(timer.current);
      }, []);
      if (id === null || id === undefined || id === "") return null;
      const text = String(id);
      const copy = async (event) => {
        if (event !== null && event !== undefined && typeof event.stopPropagation === "function") event.stopPropagation();
        const ok = await copyIdText(text);
        setState(ok ? "ok" : "failed");
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          setState("idle");
        }, 1600);
      };
      const label = state === "ok" ? T("已复制") : state === "failed" ? T("复制失败") : inline ? "⧉" : T("复制 ID");
      const tag = inline ? "span" : "button";
      return h(
        tag,
        {
          ...(inline ? { role: "button", tabIndex: 0 } : { type: "button" }),
          className: `SPR_copyId${inline ? " SPR_copyIdInline" : ""}${className === "" ? "" : ` ${className}`}`,
          "data-copied": state === "ok" ? "true" : undefined,
          "data-failed": state === "failed" ? "true" : undefined,
          title: T("复制项目 ID：{n0}", { n0: text }),
          "aria-label": T("复制项目 ID"),
          onClick: copy,
          onKeyDown: inline
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void copy(event);
                }
              }
            : undefined
        },
        label
      );
    }

    function JobSidebar({ title, items, activeId, onSelect, onCreate, renderMeta }) {
      return h(
        "div",
        { className: "SPR_side" },
        h("div", { className: "SPR_sideTitle" }, T("{n0}（{n1}）", { n0: title, n1: items.length })),
        items.length === 0 ? h("p", { className: "SPR_hint" }, T("还没有内容，点右上角新建一个。")) : null,
        items.map((item) =>
          h(
            "button",
            {
              key: item.id,
              type: "button",
              className: "SPR_projItem",
              "data-active": item.id === activeId ? "true" : "false",
              onClick: () => onSelect(item.id)
            },
            h("span", { className: "SPR_projNameRow" },
              h("span", { className: "SPR_projName" }, item.name),
              h(CopyIdButton, { id: item.id, inline: true })
            ),
            h("span", { className: "SPR_projMeta" }, renderMeta(item))
          )
        ),
        items.length === 0 ? h(Btn, { onClick: onCreate, primary: true }, T("新建")) : null
      );
    }
  return { cls, msg, sameDraft, mergeDrafts, askNewName, statusKind, Chip, StatusChip, Btn, NumField, useGlobalConfig, GlobalModelField, assetUrl, ZoomableImage, TASK_HOLD_MS, usePendingTasks, LoadingOverlay, MediaBox, BusyBtn, BusyBadge, ReviewModeBar, ApproveBtn, readFileBase64, UploadBox, LocalVideoPick, fileLabel, SaveLink, pickLocalVideo, KeyingFields, copyIdText, CopyIdButton, JobSidebar };
}
