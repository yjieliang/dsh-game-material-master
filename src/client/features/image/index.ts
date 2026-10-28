/**
 * 模块② 图片生成 —— feature 切片。
 *
 * 从 client.ts 搬出该模块的常量 / 辅助组件，以及 createImage 的装配调用。行为不变（纯搬运）。
 */

import { createImageModule } from "../../image-module.js";
import { createFeatureBoundary } from "../../platform/errors.js";

export function createImage(deps: any) {
  // 依赖：组合根注入（先按需展开，由 tsc 报错驱动补齐）
  const {
    store, // P9：组合根注入的共享 store；本模块内部暂未直接使用，不再往下透传。
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
  } = deps;

    // ── 模块②：图片生成 ─────────────────────────────────────────────────
    /** 模块②的 pending key：整批生成、单张重生成、抠像、上传、新建任务。 */
    const K_IMG_JOB = "img:job";

    const K_IMG_ITEM = (index) => `img:item:${index}`;

    const K_IMG_KEY = "img:key";

    const K_IMG_UPLOAD = "img:upload";

    const K_IMG_CREATE = "img:create";

    const RawModule = createImageModule({ React, h, T, useLocaleTick, useStudioIntent, msg, mergeDrafts, askNewName, Chip, StatusChip, Btn, NumField, useGlobalConfig, GlobalModelField, usePendingTasks, MediaBox, BusyBtn, BusyBadge, ReviewModeBar, ApproveBtn, readFileBase64, UploadBox, KeyingFields, CopyIdButton, JobSidebar, K_IMG_JOB, K_IMG_ITEM, K_IMG_KEY, K_IMG_UPLOAD, K_IMG_CREATE, JobLogPanel , scheduler: gmmScheduler });

  // 错误隔离：整个模块挂一层边界（单模块故障只降级这一块）
  const Boundary = createFeatureBoundary({ name: "image" });

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
    K_IMG_JOB, K_IMG_ITEM, K_IMG_KEY, K_IMG_UPLOAD, K_IMG_CREATE, ImageModule: (props: any) => h(Boundary, null, h(MemoRaw, props)),
    ImageModuleRaw: RawModule,
  };
}

