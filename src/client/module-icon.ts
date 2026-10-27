/**
 * 模块图标：单色线性 SVG（stroke 跟随 currentColor），24×24 视窗、1.6 线宽。
 *
 * 和侧栏入口图标 `StudioGlyphIcon` 同一套笔触规格，所以页签、顶栏、空态里的图标
 * 视觉重量一致。未知 key 回落到通用的「方块」图形。
 */
export function createModuleIcon(rt: { h: any }) {
  const { h } = rt;

  const STROKE = { stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" };

  /** key → 图形主体（若干 SVG 子元素）。 */
  const SHAPES: Record<string, () => any[]> = {
    // 八方向：中心点 + 八条放射线
    sprite: () => [
      h("circle", { key: "c", cx: 12, cy: 12, r: 2.4, ...STROKE }),
      h("path", { key: "p", d: "M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.8 2.8M15.2 15.2 18 18M18 6l-2.8 2.8M8.8 15.2 6 18", ...STROKE })
    ],
    // 图片：画框 + 山 + 太阳
    image: () => [
      h("rect", { key: "r", x: 3.5, y: 5, width: 17, height: 14, rx: 2.5, ...STROKE }),
      h("circle", { key: "c", cx: 9, cy: 10, r: 1.6, ...STROKE }),
      h("path", { key: "p", d: "M4 17.5l5-4.5 3.5 3 3-2.5 4.5 4", ...STROKE })
    ],
    // 序列帧：胶片条
    sequence: () => [
      h("rect", { key: "r", x: 3.5, y: 5, width: 17, height: 14, rx: 2, ...STROKE }),
      h("path", { key: "p", d: "M8 5v14M16 5v14M3.5 9H8M3.5 15H8M16 9h4.5M16 15h4.5", ...STROKE })
    ],
    // 骨骼：三节骨链
    rig: () => [
      h("circle", { key: "a", cx: 6, cy: 6, r: 2, ...STROKE }),
      h("circle", { key: "b", cx: 12, cy: 13, r: 2, ...STROKE }),
      h("circle", { key: "c", cx: 18, cy: 18, r: 2, ...STROKE }),
      h("path", { key: "p", d: "M7.4 7.6l3.2 3.8M13.6 14.4l2.9 2.3", ...STROKE })
    ],
    // 45° 地图：菱形地块
    iso: () => [
      h("path", { key: "p", d: "M12 4l8 4.5-8 4.5-8-4.5z", ...STROKE }),
      h("path", { key: "q", d: "M4 12.5l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5", ...STROKE })
    ],
    // 俯视地图：网格
    map: () => [
      h("rect", { key: "r", x: 4, y: 4, width: 16, height: 16, rx: 2, ...STROKE }),
      h("path", { key: "p", d: "M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16", ...STROKE })
    ],
    // 音乐：八分音符
    music: () => [
      h("path", { key: "p", d: "M9 17.5V6l10-2v11.5", ...STROKE }),
      h("circle", { key: "a", cx: 6.8, cy: 17.5, r: 2.2, ...STROKE }),
      h("circle", { key: "b", cx: 16.8, cy: 15.5, r: 2.2, ...STROKE })
    ],
    // 音效：声波
    sfx: () => [
      h("path", { key: "p", d: "M4 12h1.5M7.5 8.5v7M11 5.5v13M14.5 9v6M18 11v2M20 12h.5", ...STROKE })
    ]
  };

  const FALLBACK = () => [h("rect", { key: "r", x: 4.5, y: 4.5, width: 15, height: 15, rx: 3, ...STROKE })];

  /**
   * @param props.name 模块 key（sprite / image / sequence / rig / iso / map / music / sfx）
   * @param props.size 像素边长，默认 18
   */
  function ModuleIcon(props: { name: string; size?: number }) {
    const size = props.size ?? 18;
    const shape = SHAPES[props.name] ?? FALLBACK;
    return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" }, ...shape());
  }

  return ModuleIcon;
}
