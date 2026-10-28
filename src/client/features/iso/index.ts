/**
 * 模块五 45° 地图编辑器（iso） —— feature 切片。
 *
 * 从 client.ts 搬出该模块的几何/常量/图标，以及 createIso 的装配调用。行为不变（纯搬运）。
 */

import { createIsoModule } from "../../iso-module.js";
import { createFeatureBoundary } from "../../platform/errors.js";

export function createIso(deps: any) {
  // 依赖：组合根注入（先按需展开，由 tsc 报错驱动补齐）
  const {
    store, // P9：组合根注入的共享 store；本模块内部暂未直接使用，不再往下透传。
    React,
    h,
    fill,
    T,
    useLocaleTick,
    deriveAssetName,
    ASSET_FRAMES_MIN,
    ASSET_FRAMES_MAX,
    buildIsoAssetRequestPrompt,
    useHiddenModules,
    useStudioIntent,
    Btn,
    NumField,
    readFileBase64,
    CopyIdButton,
    MapToolIcon,
    openIsoAssetChat,
  } = deps;

    /** 「新增素材」物件大小的上下限（与宿主 `isotiles.parseIsoObjectScale` 同口径）。 */
    const ISO_OBJECT_SCALE_MIN = 0.1;

    const ISO_OBJECT_SCALE_MAX = 4;

    function ISO_pointToCellRaw(layout, x, y) {
      const cReal = (x / layout.stepX + y / layout.stepY) / 2;
      const rReal = (y / layout.stepY - x / layout.stepX) / 2;
      const c = Math.floor(cReal + 0.5);
      const r = Math.floor(rReal + 0.5);
      return { r, c, inMap: r >= 0 && c >= 0 && r < layout.rows && c < layout.cols };
    }

    function ISO_wrapIndex(value, size) {
      if (!(size > 0)) return value;
      const rest = value % size;
      return rest < 0 ? rest + size : rest;
    }

    function ISO_pointToCell(layout, x, y) {
      const raw = ISO_pointToCellRaw(layout, x, y);
      if (layout.wrap !== true) return raw;
      return { r: ISO_wrapIndex(raw.r, layout.rows), c: ISO_wrapIndex(raw.c, layout.cols), inMap: true };
    }

    function ISO_cellCenter(layout, r, c) {
      return { x: (c - r) * layout.stepX, y: (c + r) * layout.stepY };
    }

    function ISO_cellTopLeft(layout, r, c, width, height) {
      const center = ISO_cellCenter(layout, r, c);
      return { x: center.x - width / 2, y: center.y - height / 2 };
    }

    function ISO_lineCells(r0, c0, r1, c1) {
      const out = [];
      let r = Math.round(r0);
      let c = Math.round(c0);
      const rEnd = Math.round(r1);
      const cEnd = Math.round(c1);
      const dr = Math.abs(rEnd - r);
      const dc = Math.abs(cEnd - c);
      const sr = r < rEnd ? 1 : -1;
      const sc = c < cEnd ? 1 : -1;
      let err = dr - dc;
      for (;;) {
        out.push({ r, c });
        if (r === rEnd && c === cEnd) break;
        const e2 = 2 * err;
        if (e2 > -dc) {
          err -= dc;
          r += sr;
        }
        if (e2 < dr) {
          err += dr;
          c += sc;
        }
        if (out.length > 20000) break;
      }
      return out;
    }

    function ISO_addPreviewScene(input) {
      const cell = input.cell ?? { width: 64, height: 96 };
      const stepX = cell.width / 2;
      const stepY = cell.width / 4;
      const halfW = cell.width / 2;
      const halfH = cell.width / 4;
      const frames = Math.max(1, Math.round(Number(input.frames) || 1));
      const nw = Math.max(0, Number(input.naturalWidth) || 0);
      const nh = Math.max(0, Number(input.naturalHeight) || 0);
      const isObject = input.object === true;
      const cols = isObject
        ? Math.max(1, Math.round(Number(input.cols) || 1))
        : Math.max(1, Math.floor((nw || 1) / Math.max(1, Number(input.sourceW) || 1)));
      const rows = isObject
        ? Math.max(1, Math.round(Number(input.rows) || 1))
        : Math.max(1, Math.floor((nh || 1) / Math.max(1, Number(input.sourceH) || 1)));
      const cells = [];
      let imageWidth = 0;
      let imageHeight = 0;
      let frameHeight = 0;
      let imageX = 0;
      let imageY = 0;
      if (isObject) {
        const scale = Math.max(ISO_OBJECT_SCALE_MIN, Math.min(ISO_OBJECT_SCALE_MAX, Number(input.scale) || 1));
        const anchor = input.anchor ?? { x: 0.5, y: 1 };
        // 与宿主 `objectSheet` 同一口径：宽度 / 帧高都取整，预览才和导入后的存图逐像素对得上。
        imageWidth = Math.max(1, Math.round(cols * cell.width * scale));
        frameHeight = nw > 0 && nh > 0 ? Math.max(1, Math.round((nh / frames) * (imageWidth / nw))) : cell.height;
        imageHeight = frameHeight * frames;
        imageX = -imageWidth * anchor.x;
        imageY = -frameHeight * anchor.y - (frames - 1) * frameHeight;
        // 底面中心在 (0,0)：每个占格的中心相对它排开。
        const ox = ((cols - rows) / 2) * stepX;
        const oy = ((cols + rows - 2) / 2) * stepY;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) cells.push({ x: (c - r) * stepX - ox, y: (c + r) * stepY - oy });
        }
      } else {
        imageWidth = cols * cell.width;
        imageHeight = rows * cell.height;
        frameHeight = imageHeight;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) cells.push({ x: (c + 0.5) * cell.width, y: (r + 0.5) * cell.height });
        }
      }
      const xs = [imageX, imageX + imageWidth];
      const ys = [imageY, imageY + imageHeight];
      for (const point of cells) {
        xs.push(point.x - halfW, point.x + halfW);
        ys.push(point.y - halfH, point.y + halfH);
      }
      const pad = Math.max(2, cell.width * 0.08);
      const x0 = Math.min(...xs) - pad;
      const y0 = Math.min(...ys) - pad;
      return {
        cell,
        cols,
        rows,
        stepX,
        stepY,
        halfW,
        halfH,
        cells,
        base: isObject ? { x: 0, y: 0 } : null,
        image: { x: imageX, y: imageY, width: imageWidth, height: imageHeight },
        imageWidth,
        frameHeight,
        viewBox: `${x0} ${y0} ${Math.max(1, Math.max(...xs) + pad - x0)} ${Math.max(1, Math.max(...ys) + pad - y0)}`
      };
    }

    const RawModule = createIsoModule({ React, h, fill, T, useLocaleTick, deriveAssetName, ASSET_FRAMES_MIN, ASSET_FRAMES_MAX, buildIsoAssetRequestPrompt, useHiddenModules, useStudioIntent, Btn, NumField, readFileBase64, CopyIdButton, MapToolIcon, ISO_OBJECT_SCALE_MIN, ISO_OBJECT_SCALE_MAX, ISO_pointToCellRaw, ISO_cellCenter, ISO_lineCells, ISO_addPreviewScene, openIsoAssetChat });

  // 错误隔离：整个模块挂一层边界（单模块故障只降级这一块）
  const Boundary = createFeatureBoundary({ name: "iso" });

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
    ISO_OBJECT_SCALE_MIN, ISO_OBJECT_SCALE_MAX, ISO_pointToCellRaw, ISO_wrapIndex, ISO_pointToCell, ISO_cellCenter, ISO_cellTopLeft, ISO_lineCells, ISO_addPreviewScene, IsoModule: (props: any) => h(Boundary, null, h(MemoRaw, props)),
    IsoModuleRaw: RawModule,
  };
}
