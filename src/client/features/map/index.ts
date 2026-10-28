/**
 * 模块六 地图编辑器 —— feature 切片。
 *
 * 从 client.ts 搬出该模块的几何/常量/图标，以及 createMap 的装配调用。行为不变（纯搬运）。
 */

import { createMapModule } from "../../map-module.js";
import { createFeatureBoundary } from "../../platform/errors.js";

export function createMap(deps: any) {
  // 依赖：组合根注入（先按需展开，由 tsc 报错驱动补齐）
  const {
    store, // P9：组合根注入的共享 store；本模块内部暂未直接使用，不再往下透传。
    h,
    React,
    activeLang,
    fill,
    T,
    useLocaleTick,
    deriveAssetName,
    ASSET_FRAMES_MIN,
    ASSET_FRAMES_MAX,
    stampLimits,
    clampStampSpan,
    ASSET_SHAPES,
    assetShapeLabel,
    buildAssetRequestPrompt,
    useHiddenModules,
    OPEN_SHAPES,
    useStudioIntent,
    msg,
    Btn,
    NumField,
    CopyIdButton,
    openAssetChat,
  } = deps;

    const MAP_PLAN_LIST = "chunks";

    /** 取模到 0..size-1（负数也对）：与宿主 `mapgeom` 的环绕口径一致。 */
    function MAP_wrapIndex(value, size) {
      if (!(size > 0)) return value;
      const rest = value % size;
      return rest < 0 ? rest + size : rest;
    }

    /** 像素 → 格子。**与宿主 `mapgeom.pointToCell` 同构**（环绕时取模，且恒算在图内）。 */
    function MAP_pointToCell(layout, x, y) {
      const c = Math.floor(x / layout.stepX);
      const r = Math.floor(y / layout.stepY);
      if (layout.wrap === true) {
        return { r: MAP_wrapIndex(r, layout.rows), c: MAP_wrapIndex(c, layout.cols), inMap: true };
      }
      return { r, c, inMap: r >= 0 && c >= 0 && r < layout.rows && c < layout.cols };
    }

    /** 格子锚点 = 单元格底边中点。**与宿主 `mapgeom.cellAnchor` 同构**。 */
    function MAP_cellAnchor(layout, r, c) {
      return { x: c * layout.stepX + layout.grid.tileWidth / 2, y: (r + 1) * layout.stepY };
    }

    /** 贴图左上角。**与宿主 `mapgeom.cellTopLeft` 同构**。 */
    function MAP_cellTopLeft(layout, r, c, width, height, anchorX = 0.5, anchorY = 1) {
      const anchor = MAP_cellAnchor(layout, r, c);
      return { x: anchor.x - width * anchorX, y: anchor.y - height * anchorY };
    }

    function MAP_lineCells(r0, c0, r1, c1) {
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

    const MAP_GUIDE_ART = {
      "plain": {
        // 128×64：4 列 × 2 行，每块 32px
        src:
          "data:image/png;base64," +
          "iVBORw0KGgoAAAANSUhEUgAAAIAAAABACAYAAADS1n9/AAAEJklEQVR4nO2cv24UMRDG/RzUKaIUlBQInSJKRE11xVWIAlGmTJWSEqWiQpQp" +
          "KHgEFFHyDFRU1IhmkU9MGBz/G8+M17s7nzQ66fbWdvL9PLZ31+ucyWQymUwmE1G7y8fT6f7hNHc7TB3lTU+Fh8GAWKnA5MPHZ0kADISVCowP" +
          "wyDYgLyJMfNLEAAABsHCler9o2SBH6+vDTAtlXr/nFnAGx+GdB1z6s3zs0kymhrhjZPIANIAYNN/ffq6Sgi8abfvDyLRDACe+bcAoDUMYPN/" +
          "fzv8B4FkPTU6HF6p1OlN+3DxdILPlsBlNDUCMkDLKkArA4TmQ/SAwJsdxtXV23vfSUCBjW+BIDyf3AAwLjS1xvgYAJoQaJuPjb25+Xw0PRcS" +
          "IISmUyCIndvUiBgAlFjDHAAbH0YtCC31xgyHCV3O+NR5TX98KgvM2ftBPVYBOM23AMCBoGR0zXerBgCknfZT5mtDUEr5lDkCGwAqBKH5WgCc" +
          "XzyafGiUjQHgZAAtAGqGBDYALoCgBELMeM3erw0ANpEDAEBAqX9YAEIYcseXCkC4zAtBoBjfuioYYggA1Zjc23zXeQjghPQQ0G0SiDWa+S4A" +
          "QBqEXBbQ7v1ulGVgTCMYD+qRATgQcK4ODnEhKKfzsweTD2/4fndyDPFKUnWjXq8FgMtc+qUaz70OMMul4JIAADC/JwB3bVAGwCUgqLkXwL0c" +
          "PMTNoJy2AoCrgEDafDfK8wA5bQkAUA/jF6MRABhBmzA7JgNgvXqiHFb/2PWbTCaTyWQymUwmk8l0Ty9f7KZ3l/u7mLs9S5B/gmruNojJAKAJ" +
          "Pzs5d1uyqjVW+ndLUYuBsQdodVonoKUB8GXX724gx0BN8/0zCWKFjQzA9enJ5A0vhf8dp56YOL0YbpZJmp97QplV8IgAYON/fr+tgkADBGx+" +
          "7d1Pjbul4T4FEQi8UT2jpk3ewNB8CAoEkiCA+TWGYvMh/C10bhtqNqmQCx0VgJj5OQhi30tngppeHTNfCoBNZICw99dkgNRx6SzgkMG5YzHz" +
          "uQBQdik1VTDKHCA14asxPwVBy/8jpVQWyBkv0ftdAIGo+W4QAKDH1s76azOAdhbQNB4/e7h6AFxiCKjJCKk5gMbSsJTqOcbn9h9sCoAcBDWr" +
          "Aq3e7wrpnlMud0+i+7tSaKp8FAAcAYLe5muO81TjcXbIvcmk+Pj6aKsAFwBAmRPEzuOYgqU9zrcAUDK/CoIRAQDFDMVA5I5zTQFpz+xdQ+9v" +
          "ASAJwcgAgHJG9zJeapwP1boVvdZ80lAwyhwgJ5j8ebP9p1S5oB7r+VBUADA0lAxQHAqWBACEVLmuU7qPifIugvC37CEAZAD8A6CX8Vic9xCw" +
          "e78zAI6aw3gs6jb0FAxN29YNgDFEfQeBvbNg5aIaaIabmjX3/nSr394PYOqlPxFQg/NnCrR2AAAAAElFTkSuQmCC",
        cols: 4,
        rows: 2,
        cell: 32,
        sub: 0
      },
      "corner16": {
        // 128×128：4 列 × 4 行，每块 32px
        src:
          "data:image/png;base64," +
          "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",
        cols: 4,
        rows: 4,
        cell: 32,
        sub: 0
      },
      "a2quad": {
        // 64×160：2 列 × 5 行，每块 32px，每块再分 2×2 小格
        src:
          "data:image/png;base64," +
          "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",
        cols: 2,
        rows: 5,
        cell: 32,
        sub: 2
      }
    };

    function MapToolIcon(props) {
      const name = props.name;
      const box: any = { viewBox: "0 0 24 24", width: 20, height: 20, "aria-hidden": "true", focusable: "false", fill: "currentColor" };
      const path = (d: string, extra?: any) => h("path", { d, ...(extra || {}) });
      const arrow = "M9 4.6 2.8 10.5 9 16.4v-3.7h4.1a4.4 4.4 0 0 1 0 8.8H7.6v3.2h5.5a7.6 7.6 0 0 0 0-15.2H9V4.6Z";
      if (name === "undo") return h("svg", box, path(arrow));
      if (name === "redo") return h("svg", box, h("g", { transform: "translate(24 0) scale(-1 1)" }, path(arrow)));
      if (name === "pen") return h("svg", box, path("M3.4 20.6l1-4.7L15.6 4.7a2.7 2.7 0 0 1 3.8 3.8L8.1 19.6l-4.7 1Z"));
      if (name === "eraser") {
        return h("svg", box, path("M13.4 3.6 4.2 12.8a2.4 2.4 0 0 0 0 3.4l3.6 3.6h6l8.1-8.1a2.4 2.4 0 0 0 0-3.4l-5.1-5.1a2.4 2.4 0 0 0-3.4 0Zm1.2 3.4 4 4-2.6 2.6-4-4 2.6-2.6Z"));
      }
      if (name === "bucket") {
        return h(
          "svg",
          box,
          path("M11.2 2.6 3.9 9.9a2.2 2.2 0 0 0 0 3.1l4.7 4.7a2.2 2.2 0 0 0 3.1 0l7.3-7.3-7.8-7.8Z"),
          path("M19.4 13.6s2.5 3 2.5 4.5a2.5 2.5 0 1 1-5 0c0-1.5 2.5-4.5 2.5-4.5Z")
        );
      }
      if (name === "pipette") return h("svg", box, path("M15.6 3.4 20.6 8.4 18 11 13 6l2.6-2.6Z"), path("M11.9 7.1 3 16v5h5l8.9-8.9-5-5Z"));
      if (name === "hand") {
        return h("svg", box, path("M7.6 11V6.4a1.6 1.6 0 0 1 3.2 0V11h1V4.4a1.6 1.6 0 0 1 3.2 0V11h1V6.4a1.6 1.6 0 0 1 3.2 0V14a6.6 6.6 0 0 1-6.6 6.6h-1.1A5.7 5.7 0 0 1 5.4 15v-2.3a1.7 1.7 0 0 1 3-1l-.8-.7Z"));
      }
      if (name === "single") {
        return h(
          "svg",
          box,
          path("M3 4h18v5H3z", { fillOpacity: 0.42 }),
          path("M3 10h18v5H3z"),
          path("M3 16h18v4H3z", { fillOpacity: 0.42 })
        );
      }
      if (name === "grid") return h("svg", box, path("M8.4 3h2.5v18H8.4zM13.1 3h2.5v18h-2.5zM3 8.4h18v2.5H3zM3 13.1h18v2.5H3z"));
      if (name === "magic") {
        return h(
          "svg",
          box,
          path("M3.3 20.7 13.1 10.9l-1.9-1.9L1.4 18.8l1.9 1.9Z"),
          path("M17.6 1.8 19 5.3l3.5 1.4L19 8.1 17.6 11.6 16.2 8.1 12.7 6.7 16.2 5.3 17.6 1.8Z")
        );
      }
      if (name === "settings") {
        return h(
          "svg",
          box,
          h("rect", { x: 3, y: 4.6, width: 18, height: 2.2, rx: 1.1 }),
          h("rect", { x: 6, y: 2.4, width: 4.4, height: 6.6, rx: 2.2 }),
          h("rect", { x: 3, y: 10.9, width: 18, height: 2.2, rx: 1.1 }),
          h("rect", { x: 13.6, y: 8.7, width: 4.4, height: 6.6, rx: 2.2 }),
          h("rect", { x: 3, y: 17.2, width: 18, height: 2.2, rx: 1.1 }),
          h("rect", { x: 8.4, y: 15, width: 4.4, height: 6.6, rx: 2.2 })
        );
      }
      if (name === "up") return h("svg", { viewBox: "0 0 10 6", width: 11, height: 7, "aria-hidden": "true", fill: "currentColor" }, path("M5 0 10 6H0z"));
      if (name === "down") return h("svg", { viewBox: "0 0 10 6", width: 11, height: 7, "aria-hidden": "true", fill: "currentColor" }, path("M0 0h10L5 6z"));
      // 标记：圆圈里一个数字（画布上标记点就是长这样的，工具图标照它画，用户一眼能对上）。
      if (name === "marker") {
        return h(
          "svg",
          box,
          h("circle", { cx: 12, cy: 12, r: 8.4, fill: "none", stroke: "currentColor", strokeWidth: 2 }),
          h("text", { x: 12, y: 16.1, textAnchor: "middle", fontSize: 11.5, fontWeight: 700, fill: "currentColor" }, "1")
        );
      }
      return null;
    }

    const RawModule = createMapModule({ React, h, activeLang, fill, T, useLocaleTick, deriveAssetName, ASSET_FRAMES_MIN, ASSET_FRAMES_MAX, stampLimits, clampStampSpan, ASSET_SHAPES, assetShapeLabel, buildAssetRequestPrompt, useHiddenModules, OPEN_SHAPES, useStudioIntent, msg, Btn, NumField, CopyIdButton, MAP_PLAN_LIST, MAP_pointToCell, MAP_cellTopLeft, MAP_lineCells, MAP_GUIDE_ART, MapToolIcon, openAssetChat });

  // 错误隔离：整个模块挂一层边界（单模块故障只降级这一块）
  const Boundary = createFeatureBoundary({ name: "map" });

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
    MAP_PLAN_LIST, MAP_wrapIndex, MAP_pointToCell, MAP_cellAnchor, MAP_cellTopLeft, MAP_lineCells, MAP_GUIDE_ART, MapToolIcon, MapModule: (props: any) => h(Boundary, null, h(MemoRaw, props)),
    MapModuleRaw: RawModule,
  };
}
