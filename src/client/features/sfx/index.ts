/**
 * 模块八 音效生成 —— feature 切片。
 *
 * 从 client.ts 搬出该模块的常量 / 辅助组件，以及 createSfx 的装配调用。行为不变（纯搬运）。
 */

import { createSfxModule } from "../../sfx-module.js";
import { createFeatureBoundary } from "../../platform/errors.js";

export function createSfx(deps: any) {
  // 依赖：组合根注入（先按需展开，由 tsc 报错驱动补齐）
  const {
    store, // P9：组合根注入的共享 store；本模块内部暂未直接使用，不再往下透传。
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
  } = deps;

    /** 格式名由客户端翻，不用宿主回传的中文 label（切英文会露中文）。 */
    function sfxFormatLabel(id) {
      if (id === "mp3") return T("MP3（体积小）");
      if (id === "ogg_opus") return T("Ogg Opus（体积更小）");
      return T("WAV（无损，游戏引擎常用）");
    }

    const RawModule = createSfxModule({ React, h, T, useLocaleTick, useStudioIntent, msg, mergeDrafts, Chip, Btn, NumField, LoadingOverlay, BusyBtn, CopyIdButton, musicAssetUrl, musicDownloadUrl, sfxFormatLabel, scheduler: gmmScheduler });

  // 错误隔离：整个模块挂一层边界（单模块故障只降级这一块）
  const Boundary = createFeatureBoundary({ name: "sfx" });

  /**
   * 根组件包一层 memo：面板因为**别的原因**重渲染时（别的模块的轮询 / 外壳状态变化），
   * 活动模块的根组件不会被无关 props 拖着重画。
   *
   * 比较器只看两个稳定引用（`api` / `studioCtx`）——面板交给模块的就这两样。
   * ⚠️ 自检桩（verify-feedback / verify-sfx-client / perf-baseline）的假 React 没有 `memo`
   * （与 createFeatureBoundary 见过的 `Component` 缺失同一类问题）：缺了就退化为原组件，
   * 否则产物一加载就抛 `React.memo is not a function`，所有自检一起红。
   */
  const MemoRaw = typeof React.memo === "function"
    ? React.memo(RawModule, (a: any, b: any) => a?.api === b?.api && a?.studioCtx === b?.studioCtx)
    : RawModule;

  return {
    sfxFormatLabel, SfxModule: (props: any) => h(Boundary, null, h(MemoRaw, props)),
    SfxModuleRaw: RawModule,
  };
}

