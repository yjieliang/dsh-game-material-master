/**
 * 浏览器半区 · 外壳图标（shell/chrome）。
 *
 * 侧栏入口与快捷菜单用的纯展示组件 —— 没有状态、没有远程调用。
 */

export function createChrome(deps: any) {
  // 依赖：组合根注入（先按需展开，由 tsc 报错驱动补齐）
  const {
    h, React, T,
    useHiddenModules,
    visibleModulesOf,
    openStudioIntent,
  } = deps;

    function StudioGlyphIcon(props) {
      const size = props?.size ?? 18;
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
        h("rect", { x: 3.2, y: 3.2, width: 17.6, height: 17.6, rx: 3, stroke: "currentColor", strokeWidth: 1.6 }),
        h("rect", { x: 5.6, y: 5.6, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }),
        h("rect", { x: 10.2, y: 5.6, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 14.8, y: 5.6, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }),
        h("rect", { x: 5.6, y: 10.2, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 10.2, y: 10.2, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.28 }),
        h("rect", { x: 14.8, y: 10.2, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 5.6, y: 14.8, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 }),
        h("rect", { x: 10.2, y: 14.8, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 14.8, y: 14.8, width: 3.6, height: 3.6, rx: 1, fill: "currentColor", opacity: 0.9 })
      );
    }

    /** 菜单按钮上的小折角箭头。 */
    function ChevronGlyph() {
      return h(
        "svg",
        { width: 8, height: 8, viewBox: "0 0 8 8", fill: "none", "aria-hidden": "true" },
        h("path", { d: "M1.4 2.6 L4 5.4 L6.6 2.6", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" })
      );
    }

    function StudioGlyph(props) {
      const size = props?.size ?? 18;
      const api = props?.api;
      const studioCtx = props?.studioCtx;
      const hidden = useHiddenModules(api);
      const [open, setOpen] = React.useState(false);
      const [anchor, setAnchor] = React.useState(null);
      const rootRef = React.useRef(null);
      const menuRef = React.useRef(null);

      const entries = visibleModulesOf(hidden);

      // 菜单开着时：点外面 / 按 Esc 关掉。监听挂在 document 上，
      // 用捕获阶段，避免被宿主自己的处理吞掉。
      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const root = rootRef.current;
          if (root !== null && root !== undefined && typeof root.contains === "function" && root.contains(event.target)) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
          document.removeEventListener("mousedown", onPointerDown, true);
          document.removeEventListener("keydown", onKeyDown);
        };
      }, [open]);

      const toggle = (event) => {
        // 两下都要拦：宿主 `<button>` 的 onClick 也在这条冒泡路径上。
        event.preventDefault();
        event.stopPropagation();
        if (open) {
          setOpen(false);
          return;
        }
        const target = event.currentTarget;
        if (target !== null && target !== undefined && typeof target.getBoundingClientRect === "function") {
          const rect = target.getBoundingClientRect();
          setAnchor({ left: rect.right + 8, top: rect.top - 4, bottom: rect.bottom });
        } else {
          setAnchor(null);
        }
        setOpen(true);
      };

      const pick = (key) => {
        setOpen(false);
        openStudioIntent(studioCtx, { module: key });
      };

      // 菜单从按钮右上角展开；超出视口下沿时整体上移，别让它跑到屏幕外。
      let menuStyle = { left: 0, top: 0 };
      if (anchor !== null) {
        const viewportHeight = typeof window !== "undefined" && Number.isFinite(window.innerHeight) ? window.innerHeight : 0;
        const estimated = 96 + entries.length * 52;
        const top = viewportHeight > 0 ? Math.max(8, Math.min(anchor.top, viewportHeight - estimated - 12)) : anchor.top;
        menuStyle = { left: anchor.left, top };
      }

      return h(
        "span",
        { className: "SPR_railGlyph", ref: rootRef },
        h(StudioGlyphIcon, { size }),
        h(
          "span",
          {
            className: "SPR_railMenuBtn",
            role: "button",
            tabIndex: 0,
            "aria-haspopup": "menu",
            "aria-expanded": open ? "true" : "false",
            "aria-label": T("功能菜单"),
            title: T("功能菜单"),
            "data-testid": "gmm-rail-menu-btn",
            onClick: toggle,
            onKeyDown: (event) => {
              if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") toggle(event);
            }
          },
          h(ChevronGlyph, null)
        ),
        open
          ? h(
              "div",
              {
                className: "SPR_railMenu",
                role: "menu",
                ref: menuRef,
                style: menuStyle,
                "data-testid": "gmm-rail-menu",
                onClick: (event) => event.stopPropagation(),
                onMouseDown: (event) => event.stopPropagation()
              },
              h("div", { className: "SPR_railMenuHead" }, T("快捷进入功能")),
              entries.length === 0
                ? h("p", { className: "SPR_railMenuEmpty" }, T("所有功能都已被隐藏，请到「设置 → 游戏素材大师 → 功能管理」里打开至少一个。"))
                : entries.map((entry) =>
                    h(
                      "button",
                      {
                        key: entry.key,
                        type: "button",
                        role: "menuitem",
                        className: "SPR_railMenuItem",
                        "data-module": entry.key,
                        onClick: () => pick(entry.key)
                      },
                      h(
                        "span",
                        { className: "SPR_railMenuItemTitle" },
                        entry.title,
                        entry.experimental === true ? h("span", { className: "SPR_expTag" }, T("实验性")) : null
                      ),
                      h("span", { className: "SPR_railMenuItemHint" }, entry.hint)
                    )
                  ),
              hidden.length > 0
                ? h("div", { className: "SPR_railMenuFoot" }, T("已隐藏 {n0} 个功能（设置 → 游戏素材大师 → 功能管理）", { n0: hidden.length }))
                : null
            )
          : null
      );
    }

  return {
    StudioGlyphIcon, ChevronGlyph, StudioGlyph
  };
}
