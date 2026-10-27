/**
 * 浏览器半区 · 故障隔离（platform/errors）。
 *
 * 现状：全仓 0 个错误边界。任何一个模块渲染时抛错，React 会卸载整棵树 —— 用户
 * 看到的是整个工作台白屏，连「切到别的模块」都做不到。模块越多的将来，这越
 * 危险（第三方素材、坏档、宿主回包缺字段都可能触发）。
 *
 * 这里给每个 feature 一个边界：
 *   · 捕获渲染/生命周期异常（getDerivedStateFromError + componentDidCatch）
 *   · 只降级这一块，外壳与其它模块照常
 *   · 降级卡片提供「重试」（重置边界状态，重新挂载子树）
 *   · 错误进 perf 计数，便于验收「单模块故障不影响外壳」
 *
 * 注意：错误边界只兜渲染期错误；事件处理器/异步里的错误要自己 catch 后上报。
 */

import { studio } from "./runtime.js";

/** 边界配置。 */
export interface FeatureBoundaryOptions {
  /** feature 名（进 metadata 与错误计数） */
  name: string;
  /** 降级文案；默认「该模块暂时不可用，可切到其它模块或重试」 */
  degradeText?: string;
  /** 额外的错误回调 */
  onError?: (error: unknown, info: any) => void;
}

/**
 * 创建一个错误边界组件。
 * @param options - 配置
 * @returns React 类组件（可直接用于 h(Boundary, null, children)）
 */
export function createFeatureBoundary(options: FeatureBoundaryOptions) {
  const { React, h, T, perf } = studio();
  const degradeText = options.degradeText ?? "该模块暂时不可用，可以切到其它模块，或点重试";
  const fallbackText = T("模块渲染出错");

  // 自检用的假 React 不一定实现 class 组件；那种环境下退化成透传，
  // 保证「产物可加载」不被测试桩限制，真实浏览器永远走下面的完整边界。
  if (typeof React.Component !== "function") {
    return function PassthroughBoundary(props: any) {
      return props.children;
    };
  }

  class FeatureBoundary extends React.Component {
    constructor(props: any) {
      super(props);
      this.state = { failed: false, message: "" };
    }
    static getDerivedStateFromError(error: unknown) {
      return { failed: true, message: error instanceof Error ? error.message : String(error) };
    }
    componentDidCatch(error: unknown, info: any): void {
      try {
        perf?.recordError?.(options.name, error);
      } catch {
        /* 计数器自身不能影响降级 */
      }
      options.onError?.(error, info);
    }
    render() {
      if (this.state.failed === true) {
        return h(
          "div",
          { className: "SPR_featureError", "data-testid": "feature-error", "data-feature": options.name },
          h("span", { className: "SPR_featureErrorTitle" }, fallbackText),
          h("span", { className: "SPR_featureErrorText" }, degradeText),
          h(
            "button",
            {
              type: "button",
              className: "SPR_btn",
              "data-testid": "feature-retry",
              onClick: () => this.setState({ failed: false, message: "" })
            },
            T("重试")
          ),
          h("span", { className: "SPR_featureErrorDetail" }, this.state.message)
        );
      }
      return this.props.children;
    }
  }

  return FeatureBoundary;
}

/**
 * 全局兜底：把未捕获的异步错误记进 perf（不做 UI，避免与 DSH 自己的错误提示打架）。
 * @param perfRef - 计数器
 */
export function installGlobalErrorHook(perfRef: { recordError: (scope: string, error: unknown) => void }): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
  const onError = (event: any): void => {
    perfRef.recordError("window", event?.error ?? event?.message ?? "unknown");
  };
  const onRejection = (event: any): void => {
    perfRef.recordError("unhandledrejection", event?.reason ?? "unknown");
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}