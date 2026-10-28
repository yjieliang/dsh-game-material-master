/**
 * 设计基线（v2「暖纸面 · 墨绿」）—— 全部色值与尺寸的唯一出处。
 *
 * 2026-10 整体 UI 重设计：插件不再直接吃宿主的 --dsw-alias-* 主题令牌，
 * 而是自带一套设计语言（设计稿 1440×960，取色/取尺寸见 docs/设计基线-UI重设计.md）。
 * 这样做的代价：宿主换主题时插件不跟随；收益：浅/深两套值的对比度与层级可以按设计稿钉死。
 *
 * 深色由根节点的 data-gmm-theme="dark" 切换（platform/theme.ts 探测宿主当前明暗）。
 * 所有数值都在这里改，**不要在模块里写死颜色**。
 */
export const CSS_TOKENS = `
:root,.SPR_root{
  --gmm-bg:#f7f5f0;--gmm-bg-side:#efede7;--gmm-bg-top:#fbfaf7;
  --gmm-surface:#ffffff;--gmm-surface-2:#faf9f6;--gmm-surface-3:#f0eee9;
  --gmm-line-1:#deded6;--gmm-line-2:#e3e3db;--gmm-line-3:#cfd3c8;
  --gmm-text:#202724;--gmm-text-2:#4b514d;--gmm-text-3:#7d837e;--gmm-text-4:#929792;
  --gmm-accent:#2f6f68;--gmm-accent-hover:#275f59;--gmm-accent-soft:#dce9e5;
  --gmm-accent-tint:#e7f0ed;--gmm-accent-line:#bfdcd5;--gmm-on-accent:#ffffff;
  --gmm-accent-ink:#275f59;
  --gmm-ok:#2e6b4f;--gmm-warn:#8a6314;--gmm-bad:#a83c30;
  --gmm-hover:rgba(32,39,36,.055);--gmm-hover-solid:#ecebe4;
  --gmm-shadow-1:0 1px 2px rgba(32,39,36,.04),0 10px 26px -18px rgba(32,39,36,.28);
  --gmm-shadow-pop:0 14px 40px -12px rgba(32,39,36,.28);
  --gmm-r-card:12px;--gmm-r-panel:10px;--gmm-r-ctl:8px;--gmm-r-tiny:6px;
  --gmm-ctl-h:32px;--gmm-ctl-h-sm:28px;--gmm-gap:10px;--gmm-pad:16px;
  --gmm-side-w:232px;--gmm-top-h:64px;
  --gmm-font:"Segoe UI",-apple-system,"PingFang SC","Microsoft YaHei","Source Han Sans SC","Noto Sans CJK SC",sans-serif;
  --gmm-mono:"Cascadia Mono",Consolas,"SF Mono",monospace;
  --gmm-ring:0 0 0 3px color-mix(in srgb,var(--gmm-accent) 22%,transparent);
  --gmm-motion:background-color .12s ease,border-color .12s ease,color .12s ease,box-shadow .12s ease;
}
:root[data-gmm-theme="dark"],[data-gmm-theme="dark"] .SPR_root,.SPR_root[data-gmm-theme="dark"]{
  --gmm-bg:#161815;--gmm-bg-side:#1b1d19;--gmm-bg-top:#1d1f1b;
  --gmm-surface:#212420;--gmm-surface-2:#1c1f1b;--gmm-surface-3:#292c27;
  --gmm-line-1:#34382f;--gmm-line-2:#2e322c;--gmm-line-3:#41463c;
  --gmm-text:#ecebe4;--gmm-text-2:#c2c6bb;--gmm-text-3:#90958c;--gmm-text-4:#8b9087;
  --gmm-accent:#6fbfb2;--gmm-accent-hover:#8ad2c5;--gmm-accent-soft:#243530;
  --gmm-accent-tint:#1f2c28;--gmm-accent-line:#35564c;--gmm-on-accent:#0e1412;
  --gmm-accent-ink:#9ad8cc;
  --gmm-ok:#6fbf8f;--gmm-warn:#d9a85a;--gmm-bad:#e58377;
  --gmm-hover:rgba(236,235,228,.06);--gmm-hover-solid:#2b2e29;
  --gmm-shadow-1:0 1px 2px rgba(0,0,0,.35),0 12px 30px -20px rgba(0,0,0,.7);
  --gmm-shadow-pop:0 18px 44px -14px rgba(0,0,0,.75);
}
:root{--spr-r-sm:6px;--spr-r-md:8px;--spr-r-lg:12px;--spr-ctl:32px;--spr-ctl-sm:28px;--spr-gap:8px;--spr-pad:14px;--spr-ring:0 0 0 3px color-mix(in srgb,var(--gmm-accent) 22%,transparent);--spr-motion:background-color .12s ease,border-color .12s ease,color .12s ease,box-shadow .12s ease}
.SPR_root{background:var(--gmm-bg);color:var(--gmm-text);font-family:var(--gmm-font);-webkit-font-smoothing:antialiased}
.SPR_root{color-scheme:light}
[data-gmm-theme="dark"] .SPR_root,.SPR_root[data-gmm-theme="dark"]{color-scheme:dark}
.SPR_root *,.SPR_settings *{font-family:inherit}
.SPR_settings{color:var(--gmm-text);font-size:13px;line-height:20px}
.SPR_root :where(.SPR_app,.SPR_sidebar,.SPR_brand,.SPR_brandMark,.SPR_brandText,.SPR_newProject,.SPR_nav,.SPR_navItem,.SPR_sideProject,.SPR_projPop,.SPR_mainCol,.SPR_topbar,.SPR_scroll,.SPR_pageHead,.SPR_stepBar,.SPR_stepCard,.SPR_stepNum,.SPR_cols,.SPR_col,.SPR_panel,.SPR_panelHead,.SPR_panelHeadMain,.SPR_panelHeadAside,.SPR_panelBody,.SPR_panelFoot,.SPR_railCard,.SPR_railRow,.SPR_railChip,.SPR_previewBox,.SPR_sourceBlock,.SPR_dropZone,.SPR_tips,.SPR_sideProjWrap,.SPR_crumb){box-sizing:border-box}
.SPR_root h1,.SPR_root h2,.SPR_root h3,.SPR_root h4,.SPR_root p{margin:0}
.SPR_root :is(button,input,textarea,select){font-family:inherit}
.SPR_root :is(button,a,summary,input,textarea,select,[role=button]):focus-visible{outline:2px solid var(--gmm-accent);outline-offset:2px}
.SPR_root ::-webkit-scrollbar{width:10px;height:10px}
.SPR_root ::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--gmm-text-3) 34%,transparent);border-radius:999px;border:3px solid transparent;background-clip:content-box}
.SPR_root ::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--gmm-text-3) 55%,transparent);background-clip:content-box}
.SPR_root ::-webkit-scrollbar-track{background:transparent}
.SPR_root ::selection{background:color-mix(in srgb,var(--gmm-accent) 26%,transparent)}
.SPR_root :is(code,pre,kbd){font-family:var(--gmm-mono)}
`;
