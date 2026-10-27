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

  return {
    K_IMG_JOB, K_IMG_ITEM, K_IMG_KEY, K_IMG_UPLOAD, K_IMG_CREATE, ImageModule: (props: any) => h(Boundary, null, h(RawModule, props)),
    ImageModuleRaw: RawModule,
  };
}

