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
  } = deps;

    /** 格式名由客户端翻，不用宿主回传的中文 label（切英文会露中文）。 */
    function sfxFormatLabel(id) {
      if (id === "mp3") return T("MP3（体积小）");
      if (id === "ogg_opus") return T("Ogg Opus（体积更小）");
      return T("WAV（无损，游戏引擎常用）");
    }

    const RawModule = createSfxModule({ React, h, T, useLocaleTick, useStudioIntent, msg, mergeDrafts, Chip, Btn, NumField, LoadingOverlay, BusyBtn, CopyIdButton, musicAssetUrl, musicDownloadUrl, sfxFormatLabel });

  // 错误隔离：整个模块挂一层边界（单模块故障只降级这一块）
  const Boundary = createFeatureBoundary({ name: "sfx" });

  return {
    sfxFormatLabel, SfxModule: (props: any) => h(Boundary, null, h(RawModule, props)),
    SfxModuleRaw: RawModule,
  };
}

