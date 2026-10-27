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

  return { cls, msg, sameDraft, mergeDrafts, askNewName, statusKind, Chip, StatusChip, Btn };
}
