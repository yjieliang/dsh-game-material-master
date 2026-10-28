/**
 * 模块②–⑧（图片 / 序列帧 / 骨骼 / 45° 地图 / 俯视地图 / 音乐 / 音效）的适配样式。
 *
 * 它们的内容区在 v2 外壳里统一走 .SPR_scroll + .SPR_panel/.SPR_card，
 * 这里只处理「模块自己的容器与旧深色编辑器皮肤」和令牌之间的接缝。
 *
 * 拼接顺序（见 styles.ts 末尾）：
 *   令牌 → 历史样式(CSS_LEGACY) → 外壳 → 组件 → 模块① → 本文件
 * 所以下面这些规则都晚于 styles.ts 的历史规则，同特异性直接覆盖；
 * 需要压过 `.SPR_moduleBody[data-module="map"]`（0,2,0）这类选择器时多带一层 `.SPR_scroll>`。
 *
 * ⚠️ 色值一律不写死：编辑器皮肤全部从 css/tokens.ts 的 --gmm-* 推导（见 C 段）。
 */
export const CSS_MODULES = `
/* ═══════════════════════════════════════════════════════════════════════
 * A. 容器适配：外层 .SPR_scroll 是唯一的页面滚动容器
 *
 * v2 外壳把模块内容放进 .SPR_scroll（padding 22/24/36，overflow:auto）。
 * 旧实现里每个模块自己又声明了 height:100% / flex:1 + overflow:auto，叠在
 * 外层滚动容器里就会「双滚动条」或「内层高度塌成 0」。这里一律改成：
 * 模块根自适应高度；只有 ⑤⑥ 的编辑器要撑满一屏，用外壳给的 .SPR_fill。
 * ═══════════════════════════════════════════════════════════════════════ */

/* A1. 带任务列表的模块（②图片 / ③序列帧 / ⑦音乐 / ⑧音效）
   根节点原为 flex:1 + 正文列 .SPR_main 自带 overflow:auto；现在两栏随内容长高，
   页面只留外层一条滚动条，内边距交给 .SPR_scroll（模块不再自己加一层 padding）。
   列表栏从「一条竖分隔线」改成卡片：旧的 border-right 贴在新外壳的纸面上像没做完。 */
.SPR_pageBody{display:flex;align-items:flex-start;gap:18px;flex:none;min-height:0;width:100%;box-sizing:border-box}
.SPR_pageBody>.SPR_side{width:204px;flex:none;box-sizing:border-box;overflow:visible;padding:12px;border:1px solid var(--gmm-line-2);border-radius:var(--gmm-r-card);background:var(--gmm-surface)}
.SPR_pageBody>.SPR_main{flex:1;min-width:0;overflow:visible;padding:0}

/* A2. 骨骼动画（④）：历史样式把面板根写成「定高 flex 列 + overflow:auto」。
   v2 里外层已经是滚动容器，再自滚就是两片都能滚、滚轮到底还要换一个。 */
.SPR_pagePane{display:flex;flex-direction:column;gap:14px;flex:none;min-height:0;padding:0;overflow:visible;overscroll-behavior:auto}

/* A3. 地图编辑器（⑤ 45° / ⑥ 俯视）：要「撑满一屏 + 画布吃掉剩余高度」。
   外层 .SPR_scroll 是 flex 列（子项 flex:0 0 auto），外壳的 .SPR_fill 自带
   flex:1 1 auto + min-height:0，所以模块根挂上 .SPR_fill 就能吃掉页头以外的剩余高度；
   这里只把历史 .SPR_moduleBody 的 height:100% 与 padding:16px 18px 40px 清掉。
   不用 height:100%：内容再长也只多一条外层滚动条，不会被裁掉。 */
.SPR_scroll>.SPR_moduleBody.SPR_fill{height:auto;min-height:0;padding:0;min-width:0}
.SPR_scroll>.SPR_moduleBody.SPR_fill>.SPR_mapEdRoot,
.SPR_scroll>.SPR_moduleBody.SPR_fill>.SPR_isoRoot{flex:1 1 auto;min-height:0}
.SPR_mapEdStage,.SPR_isoStage{min-height:420px}

/* ═══════════════════════════════════════════════════════════════════════
 * B. 页头去重
 *
 * 外壳的 .SPR_pageHead 已显示模块名 + 一句说明，模块不再重复同一行标题：
 * ②③⑦⑧ 的「图片任务（N）」是任务列表名、⑤⑥ 顶栏里的项目名是数据，都不删；
 * 模块级操作按钮留在内容第一行的 .SPR_toolbar 里（页头右侧属于外壳）。
 * ═══════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════
 * C. 模块⑤⑥ 的深色编辑器皮肤（深炭灰 + 墨绿强调）
 *
 * 画布要保证像素画的对比度，所以编辑器保持深色；但不再走 AsLib 的木质棕
 * （#6b4a22 / #e6bd7d / #f3e7d3）与深蓝（#8ab4f8 / #14161e），而是从设计令牌
 * 推导一套「深炭灰面 + 墨绿强调」的编辑器变量：
 *   · 浅色主题：深色值由 --gmm-text（墨色）与 --gmm-bg（纸色）混出来；
 *   · 深色主题：直接用深色令牌本身。
 * 所有色值只经 var(--gmm-*) 组合，模块里不出现新的写死色值。
 * ═══════════════════════════════════════════════════════════════════════ */
.SPR_root{
  --gmm-ed-0:color-mix(in srgb,var(--gmm-text) 96%,var(--gmm-bg));
  --gmm-ed-1:color-mix(in srgb,var(--gmm-text) 88%,var(--gmm-bg));
  --gmm-ed-2:color-mix(in srgb,var(--gmm-text) 80%,var(--gmm-bg));
  --gmm-ed-3:color-mix(in srgb,var(--gmm-text) 90%,var(--gmm-bg));
  --gmm-ed-line:color-mix(in srgb,var(--gmm-text) 62%,var(--gmm-bg));
  --gmm-ed-line-soft:color-mix(in srgb,var(--gmm-text) 74%,var(--gmm-bg));
  --gmm-ed-text:var(--gmm-bg);
  --gmm-ed-text-2:color-mix(in srgb,var(--gmm-bg) 78%,var(--gmm-text));
  --gmm-ed-text-3:color-mix(in srgb,var(--gmm-bg) 56%,var(--gmm-text));
  --gmm-ed-accent:color-mix(in srgb,var(--gmm-accent) 48%,var(--gmm-accent-line));
  --gmm-ed-accent-hi:color-mix(in srgb,var(--gmm-accent) 34%,var(--gmm-bg));
  --gmm-ed-accent-soft:color-mix(in srgb,var(--gmm-accent) 26%,var(--gmm-ed-0));
  --gmm-ed-on-accent:var(--gmm-bg);
  --gmm-ed-ok:color-mix(in srgb,var(--gmm-ok) 48%,var(--gmm-ed-text));
  --gmm-ed-warn:color-mix(in srgb,var(--gmm-warn) 52%,var(--gmm-ed-text));
  --gmm-ed-bad:color-mix(in srgb,var(--gmm-bad) 52%,var(--gmm-ed-text));
  --gmm-ed-panel-shadow:0 12px 32px -12px rgba(0,0,0,.55);
}
[data-gmm-theme="dark"] .SPR_root,.SPR_root[data-gmm-theme="dark"]{
  --gmm-ed-0:var(--gmm-bg);
  --gmm-ed-1:var(--gmm-bg-top);
  --gmm-ed-2:var(--gmm-surface);
  --gmm-ed-3:var(--gmm-surface-3);
  --gmm-ed-line:var(--gmm-line-1);
  --gmm-ed-line-soft:var(--gmm-line-3);
  --gmm-ed-text:var(--gmm-text);
  --gmm-ed-text-2:var(--gmm-text-2);
  --gmm-ed-text-3:var(--gmm-text-3);
  --gmm-ed-accent:var(--gmm-accent);
  --gmm-ed-accent-hi:var(--gmm-accent-hover);
  --gmm-ed-accent-soft:var(--gmm-accent-soft);
  --gmm-ed-on-accent:var(--gmm-on-accent);
  --gmm-ed-ok:var(--gmm-ok);
  --gmm-ed-warn:var(--gmm-warn);
  --gmm-ed-bad:var(--gmm-bad);
}

.SPR_root :is(.SPR_mapEdRoot,.SPR_isoRoot){position:relative;background:var(--gmm-ed-0);color:var(--gmm-ed-text);border:1px solid var(--gmm-ed-line-soft)}
.SPR_root :is(.SPR_mapEdTop,.SPR_isoTop){background:var(--gmm-ed-1);border-bottom:1px solid var(--gmm-ed-line)}
.SPR_root :is(.SPR_mapEdProj,.SPR_isoProj){color:var(--gmm-ed-text)}
.SPR_root :is(.SPR_mapEdProj,.SPR_isoProj):hover{background:var(--gmm-ed-2)}
.SPR_root .SPR_mapEdProj[data-open="true"]{background:var(--gmm-ed-2);border-color:var(--gmm-ed-line)}
.SPR_root .SPR_mapEdCaret{color:var(--gmm-ed-text-3)}
.SPR_root :is(.SPR_mapEdMenu,.SPR_isoMenu){background:var(--gmm-ed-1);border:1px solid var(--gmm-ed-line);box-shadow:var(--gmm-ed-panel-shadow)}
.SPR_root :is(.SPR_mapEdMenuItem,.SPR_isoMenuItem){color:var(--gmm-ed-text)}
.SPR_root :is(.SPR_mapEdMenuItem,.SPR_isoMenuItem):hover{background:var(--gmm-ed-2)}
.SPR_root :is(.SPR_mapEdMenuItem,.SPR_isoMenuItem)[data-on="true"]{background:var(--gmm-ed-3);color:var(--gmm-ed-accent)}
.SPR_root .SPR_mapEdMenuItem[data-danger="true"]{color:var(--gmm-ed-bad)}
.SPR_root :is(.SPR_mapEdMenuLabel,.SPR_isoMenuLabel){color:var(--gmm-ed-text-3)}
.SPR_root :is(.SPR_mapEdSide,.SPR_isoSide){background:var(--gmm-ed-2);border-right:1px solid var(--gmm-ed-line)}
.SPR_root :is(.SPR_mapEdSideTitle,.SPR_isoSideTitle){color:var(--gmm-ed-text-3)}
.SPR_root :is(.SPR_mapEdPalette,.SPR_isoPalette){background:var(--gmm-ed-0);border:1px solid var(--gmm-ed-line)}
.SPR_root :is(.SPR_mapEdTile,.SPR_isoTile){border:1px solid var(--gmm-ed-line-soft);background-color:var(--gmm-ed-0)}
.SPR_root :is(.SPR_mapEdTile,.SPR_isoTile):hover{border-color:var(--gmm-ed-accent)}
.SPR_root :is(.SPR_mapEdTile,.SPR_isoTile)[data-on="true"]{outline:2px solid var(--gmm-ed-accent);outline-offset:-2px;border-color:var(--gmm-ed-accent)}
.SPR_root :is(.SPR_mapEdTool,.SPR_isoTool){color:var(--gmm-ed-text-2);background:var(--gmm-ed-3);border:1px solid var(--gmm-ed-line)}
.SPR_root :is(.SPR_mapEdTool,.SPR_isoTool):hover{background:var(--gmm-ed-2);color:var(--gmm-ed-text)}
.SPR_root :is(.SPR_mapEdTool,.SPR_isoTool)[data-on="true"]{background:var(--gmm-ed-accent-soft);border-color:var(--gmm-ed-accent);color:var(--gmm-ed-accent);box-shadow:inset 0 0 0 1px var(--gmm-ed-accent)}
.SPR_root :is(.SPR_mapEdChip,.SPR_mapEdTool,.SPR_isoTool):focus-visible{outline:2px solid var(--gmm-ed-accent);outline-offset:2px}
.SPR_root :is(.SPR_mapEdStage,.SPR_isoStage){background:var(--gmm-ed-0)}
.SPR_root :is(.SPR_mapEdHint,.SPR_isoHint){color:var(--gmm-ed-text-3)}
.SPR_root :is(.SPR_mapEdEmpty,.SPR_isoEmpty){background:var(--gmm-ed-0);border:1px solid var(--gmm-ed-line-soft)}
.SPR_root :is(.SPR_mapEdEmptyText,.SPR_isoEmptyTitle){color:var(--gmm-ed-text)}
.SPR_root .SPR_isoWarn{color:var(--gmm-ed-warn)}
.SPR_root :is(.SPR_mapEdWarnings,.SPR_mapEdFootText){color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdMark{color:var(--gmm-ed-ok)}
.SPR_root .SPR_mapEdSave{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdSave[data-busy="true"]{color:var(--gmm-ed-warn)}
.SPR_root .SPR_mapEdFoot{background:var(--gmm-ed-1);border-top:1px solid var(--gmm-ed-line)}
.SPR_root :is(.SPR_mapEdTop,.SPR_isoTop) .SPR_copyId{color:var(--gmm-ed-text-2);border-color:var(--gmm-ed-line);background:var(--gmm-ed-2)}
.SPR_root :is(.SPR_mapEdTop,.SPR_isoTop) .SPR_copyId:hover{background:var(--gmm-ed-3);color:var(--gmm-ed-text)}
.SPR_root :is(.SPR_mapEdTop,.SPR_isoTop) .SPR_copyId[data-copied="true"]{border-color:var(--gmm-ed-ok);color:var(--gmm-ed-ok)}
.SPR_root :is(.SPR_mapEdMenu,.SPR_isoMenu) .SPR_copyIdInline{color:var(--gmm-ed-text-3)}
.SPR_root :is(.SPR_mapEdMenu,.SPR_isoMenu) .SPR_copyIdInline:hover{color:var(--gmm-ed-text)}

/* ── C2. 编辑器内的通用控件（按钮 / 输入 / 提示条）走深色皮肤 ─────────
   这两个模块的卡片、弹窗里大量用共享组件；不覆盖的话，浅色主题下会出现
   「白色按钮贴在深色卡片上」，跟深色编辑器不是一套。 */
.SPR_moduleBody[data-module] .SPR_btn{background:var(--gmm-ed-3);border-color:var(--gmm-ed-line);color:var(--gmm-ed-text)}
.SPR_moduleBody[data-module] .SPR_btn:hover:not(:disabled){background:var(--gmm-ed-2);border-color:var(--gmm-ed-line);color:var(--gmm-ed-text)}
.SPR_moduleBody[data-module] .SPR_btn[data-primary="true"]{background:var(--gmm-ed-accent);border-color:var(--gmm-ed-accent);color:var(--gmm-ed-on-accent)}
.SPR_moduleBody[data-module] .SPR_btn[data-primary="true"]:hover:not(:disabled){background:var(--gmm-ed-accent-hi);border-color:var(--gmm-ed-accent-hi);color:var(--gmm-ed-on-accent)}
.SPR_moduleBody[data-module] .SPR_btn[data-danger="true"]{color:var(--gmm-ed-bad);border-color:color-mix(in srgb,var(--gmm-ed-bad) 44%,var(--gmm-ed-line));background:var(--gmm-ed-3)}
.SPR_moduleBody[data-module] .SPR_btn[data-on="true"]{background:var(--gmm-ed-accent-soft);border-color:var(--gmm-ed-accent);color:var(--gmm-ed-accent)}
.SPR_moduleBody[data-module] :is(.SPR_input,.SPR_area){background:var(--gmm-ed-3);border-color:var(--gmm-ed-line);color:var(--gmm-ed-text)}
.SPR_moduleBody[data-module] :is(.SPR_input,.SPR_area):focus{border-color:var(--gmm-ed-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--gmm-ed-accent) 24%,transparent)}
.SPR_moduleBody[data-module] :is(.SPR_fieldLabel,.SPR_hint){color:var(--gmm-ed-text-3)}
.SPR_moduleBody[data-module] .SPR_chip{background:var(--gmm-ed-3);color:var(--gmm-ed-text-2)}
.SPR_moduleBody[data-module] :is(.SPR_notice,.SPR_note){color:var(--gmm-ed-text-2)}
.SPR_moduleBody[data-module] .SPR_notice{display:block;border-radius:var(--gmm-r-ctl);background:var(--gmm-ed-3);padding:6px 10px;font-size:11px;line-height:1.7}
.SPR_moduleBody[data-module] .SPR_notice-error{color:var(--gmm-ed-bad)}
.SPR_moduleBody[data-module] .SPR_notice-ok{color:var(--gmm-ed-ok)}
.SPR_moduleBody[data-module] .SPR_notice-info{color:var(--gmm-ed-accent)}

.SPR_root .SPR_mapEdTopBtn{color:var(--gmm-ed-text);background:var(--gmm-ed-2);border:1px solid var(--gmm-ed-line)}
.SPR_root .SPR_mapEdTopBtn:hover{background:var(--gmm-ed-3)}
.SPR_root .SPR_mapEdTopBtn[data-on="true"]{background:var(--gmm-ed-accent-soft);border-color:var(--gmm-ed-accent);color:var(--gmm-ed-accent)}
.SPR_root .SPR_mapEdLayerBtn{background:var(--gmm-ed-3)}
.SPR_root :is(.SPR_mapEdLayerHalf,.SPR_mapEdLayerNum){color:var(--gmm-ed-text-2)}
.SPR_root :is(.SPR_mapEdLayerHalf,.SPR_mapEdLayerNum):hover:not(:disabled){background:color-mix(in srgb,var(--gmm-ed-text) 18%,transparent)}
.SPR_root .SPR_mapEdTip{background:var(--gmm-ed-1);border:1px solid var(--gmm-ed-line);color:var(--gmm-ed-text);box-shadow:var(--gmm-ed-panel-shadow)}
.SPR_root .SPR_mapEdTip::after{border-top-color:var(--gmm-ed-1)}
.SPR_root .SPR_mapEdTipKey{background:var(--gmm-ed-3);color:var(--gmm-ed-text-2)}
.SPR_root .SPR_mapEdTipDesc{color:var(--gmm-ed-text-3)}
.SPR_root :is(.SPR_mapEdDlgMask,.SPR_isoDlgMask){background:color-mix(in srgb,var(--gmm-ed-0) 72%,transparent)}
.SPR_root :is(.SPR_mapEdDlg,.SPR_isoDlg){background:var(--gmm-ed-1);border:1px solid var(--gmm-ed-line);color:var(--gmm-ed-text);box-shadow:var(--gmm-ed-panel-shadow)}
.SPR_root :is(.SPR_mapEdDlgHead,.SPR_mapEdDlgActions){background:var(--gmm-ed-1)}
.SPR_root .SPR_mapEdDlgLabel{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdDlgInput{background:var(--gmm-ed-3);border:1px solid var(--gmm-ed-line);color:var(--gmm-ed-text)}
.SPR_root .SPR_mapEdDlgInput:focus{border-color:var(--gmm-ed-accent)}
.SPR_root .SPR_mapEdStamp{background:var(--gmm-ed-0);border:1px solid var(--gmm-ed-line)}
.SPR_root .SPR_mapEdStampCell{border:1px solid color-mix(in srgb,var(--gmm-ed-text) 26%,transparent)}
.SPR_root .SPR_mapEdStampCell[data-pass="0"]{background:color-mix(in srgb,var(--gmm-ed-bad) 12%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--gmm-ed-bad) 46%,transparent)}
.SPR_root .SPR_mapEdStampCell[data-pass="1"]{background:color-mix(in srgb,var(--gmm-ed-accent) 18%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--gmm-ed-accent) 60%,transparent)}
.SPR_root .SPR_mapEdStampCell[data-pass="2"]{background:color-mix(in srgb,var(--gmm-ed-ok) 18%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--gmm-ed-ok) 60%,transparent)}
.SPR_root .SPR_mapEdStampCell:hover{outline:2px solid var(--gmm-ed-accent);outline-offset:-2px}
.SPR_root .SPR_mapEdLegend{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdGuideMask{background:color-mix(in srgb,var(--gmm-ed-0) 78%,transparent)}
.SPR_root .SPR_mapEdGuide{background:var(--gmm-ed-1);border:1px solid var(--gmm-ed-line);color:var(--gmm-ed-text);box-shadow:var(--gmm-ed-panel-shadow)}
.SPR_root .SPR_mapEdGuideTab{background:var(--gmm-ed-3);border:1px solid var(--gmm-ed-line);color:var(--gmm-ed-text-2)}
.SPR_root .SPR_mapEdGuideTab:hover{border-color:var(--gmm-ed-accent)}
.SPR_root .SPR_mapEdGuideTab[data-on="true"]{border-color:var(--gmm-ed-accent);background:var(--gmm-ed-accent-soft);color:var(--gmm-ed-accent)}
.SPR_root .SPR_mapEdGuideArt{background:var(--gmm-ed-0);border:1px solid var(--gmm-ed-line)}
.SPR_root .SPR_mapEdGuideCap{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdGuideGrid{color:color-mix(in srgb,var(--gmm-ed-text) 62%,transparent)}
.SPR_root .SPR_mapEdGuideSubGrid{color:color-mix(in srgb,var(--gmm-ed-accent) 85%,transparent)}
.SPR_root .SPR_mapEdGuideTitle{color:var(--gmm-ed-accent)}
.SPR_root .SPR_mapEdGuideList{color:var(--gmm-ed-text-2)}
.SPR_root .SPR_mapEdGuideNote{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdGuideNote[data-kind="warn"]{color:var(--gmm-ed-warn)}
.SPR_root .SPR_mapEdGuideFoot{border-top:1px solid var(--gmm-ed-line)}
.SPR_root .SPR_mapEdGuidePage{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdLayerRow{background:color-mix(in srgb,var(--gmm-ed-0) 55%,transparent);border:1px solid var(--gmm-ed-line)}
.SPR_root .SPR_mapEdLayerRow[data-on="true"]{background:var(--gmm-ed-accent-soft);border-color:var(--gmm-ed-accent)}
.SPR_root .SPR_mapEdLayerIdx{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdLayerName{color:var(--gmm-ed-text)}
.SPR_root .SPR_mapEdLayerName:hover{border-color:var(--gmm-ed-line)}
.SPR_root .SPR_mapEdLayerNameInput{background:var(--gmm-ed-3);border:1px solid var(--gmm-ed-accent);color:var(--gmm-ed-text)}
.SPR_root .SPR_mapEdMiniBtn{background:var(--gmm-ed-3);border:1px solid var(--gmm-ed-line);color:var(--gmm-ed-text-2)}
.SPR_root .SPR_mapEdMiniBtn:hover:not(:disabled){background:var(--gmm-ed-2);color:var(--gmm-ed-text)}
.SPR_root .SPR_mapEdMarkerRow{background:color-mix(in srgb,var(--gmm-ed-0) 55%,transparent);border:1px solid var(--gmm-ed-line)}
.SPR_root .SPR_mapEdMarkerRow[data-on="true"]{background:color-mix(in srgb,var(--gmm-ed-bad) 16%,transparent);border-color:var(--gmm-ed-bad)}
.SPR_root .SPR_mapEdMarkerDot{border:1.5px solid var(--gmm-ed-warn);background:var(--gmm-ed-0);color:var(--gmm-ed-text)}
.SPR_root .SPR_mapEdMarkerName{color:var(--gmm-ed-text)}
.SPR_root .SPR_mapEdMarkerName:hover{border-color:var(--gmm-ed-line)}
.SPR_root .SPR_mapEdMarkerName:focus{background:var(--gmm-ed-3);border-color:var(--gmm-ed-accent)}
.SPR_root .SPR_mapEdMarkerAt{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdToast{background:color-mix(in srgb,var(--gmm-ed-0) 82%,transparent);color:var(--gmm-ed-text)}
.SPR_root .SPR_mapEdToast[data-busy="true"]{color:var(--gmm-ed-warn)}
.SPR_root .SPR_mapEdCard{background:var(--gmm-ed-1);border:1px solid var(--gmm-ed-line);box-shadow:var(--gmm-ed-panel-shadow)}
.SPR_root .SPR_mapEdCardHead>h4{color:var(--gmm-ed-text)}
.SPR_root .SPR_mapEdCardClose{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdCardClose:hover{background:var(--gmm-ed-2);color:var(--gmm-ed-text)}
.SPR_root .SPR_mapEdLabel{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdRowHint{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdTsRow[data-on="true"]{background:var(--gmm-ed-accent-soft);border-color:var(--gmm-ed-accent)}
.SPR_root .SPR_mapEdTsPick{color:var(--gmm-ed-text)}
.SPR_root .SPR_mapEdTsPick:hover{color:var(--gmm-ed-accent)}
.SPR_root .SPR_mapEdTsMeta{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdTsBadge{background:var(--gmm-ed-3);color:var(--gmm-ed-text-2)}
.SPR_root .SPR_mapEdTsBadge[data-anim="true"]{background:var(--gmm-ed-accent-soft);color:var(--gmm-ed-accent)}
.SPR_root :is(.SPR_mapEdTimes,.SPR_mapEdLblSmall){color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdValue{color:var(--gmm-ed-text-2)}
.SPR_root .SPR_mapEdPassCell{background:var(--gmm-ed-3);border:1px solid var(--gmm-ed-line);color:var(--gmm-ed-text-2)}
.SPR_root .SPR_mapEdPassCell[data-pass="0"]{background:color-mix(in srgb,var(--gmm-ed-bad) 22%,var(--gmm-ed-3));border-color:color-mix(in srgb,var(--gmm-ed-bad) 60%,var(--gmm-ed-line));color:var(--gmm-ed-bad)}
.SPR_root .SPR_mapEdPassCell[data-pass="1"]{background:color-mix(in srgb,var(--gmm-ed-accent) 22%,var(--gmm-ed-3));border-color:color-mix(in srgb,var(--gmm-ed-accent) 60%,var(--gmm-ed-line));color:var(--gmm-ed-accent-hi)}
.SPR_root .SPR_mapEdPassCell[data-pass="2"]{background:color-mix(in srgb,var(--gmm-ed-ok) 22%,var(--gmm-ed-3));border-color:color-mix(in srgb,var(--gmm-ed-ok) 60%,var(--gmm-ed-line));color:var(--gmm-ed-ok)}
.SPR_root .SPR_mapEdSegBtn{background:var(--gmm-ed-3);border:1px solid var(--gmm-ed-line);color:var(--gmm-ed-text-2)}
.SPR_root .SPR_mapEdSegBtn:hover{border-color:var(--gmm-ed-accent);color:var(--gmm-ed-text)}
.SPR_root .SPR_mapEdSegBtn[data-on="true"]{border-color:var(--gmm-ed-accent);background:var(--gmm-ed-accent-soft);color:var(--gmm-ed-accent)}
.SPR_root .SPR_mapEdSelect{background:var(--gmm-ed-3);border:1px solid var(--gmm-ed-line);color:var(--gmm-ed-text)}
.SPR_root .SPR_mapEdChip{background:var(--gmm-ed-3);border:1px solid var(--gmm-ed-line);color:var(--gmm-ed-text-2)}
.SPR_root .SPR_mapEdChip[data-on="true"]{border-color:var(--gmm-ed-accent);color:var(--gmm-ed-accent)}
.SPR_root :is(.SPR_mapEdCheck,.SPR_mapEdRadio){color:var(--gmm-ed-text-2)}
.SPR_root .SPR_mapEdHelp{background:var(--gmm-ed-3)}
.SPR_root .SPR_mapEdHelp>h5{color:var(--gmm-ed-text)}
.SPR_root .SPR_mapEdHelp>p{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdFiles{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_mapEdFiles a{color:var(--gmm-ed-accent)}
.SPR_root .SPR_mapEdExportResult{background:var(--gmm-ed-3);border:1px solid var(--gmm-ed-line)}

.SPR_root .SPR_isoCard{background:var(--gmm-ed-1);border:1px solid var(--gmm-ed-line);box-shadow:var(--gmm-ed-panel-shadow);color:var(--gmm-ed-text)}
.SPR_root .SPR_isoCardHead{color:var(--gmm-ed-accent)}
.SPR_root .SPR_isoClose{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_isoClose:hover{background:var(--gmm-ed-2);color:var(--gmm-ed-text)}
.SPR_root .SPR_isoLabel{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_isoInput{background:var(--gmm-ed-3);border:1px solid var(--gmm-ed-line);color:var(--gmm-ed-text)}
.SPR_root .SPR_isoInput:focus{border-color:var(--gmm-ed-accent)}
.SPR_root .SPR_isoCheck{color:var(--gmm-ed-text-2)}
.SPR_root .SPR_isoPreview{background:var(--gmm-ed-0);border:1px solid var(--gmm-ed-line)}
.SPR_root .SPR_isoPreviewStage{background-color:var(--gmm-ed-0);background-image:linear-gradient(45deg,var(--gmm-ed-1) 25%,transparent 25%,transparent 75%,var(--gmm-ed-1) 75%),linear-gradient(45deg,var(--gmm-ed-1) 25%,transparent 25%,transparent 75%,var(--gmm-ed-1) 75%);border:1px solid var(--gmm-ed-line)}
.SPR_root .SPR_isoPreviewCell{fill:color-mix(in srgb,var(--gmm-ed-accent) 12%,transparent);stroke:color-mix(in srgb,var(--gmm-ed-accent) 85%,transparent)}
.SPR_root .SPR_isoPreviewBase circle{fill:color-mix(in srgb,var(--gmm-ed-text) 18%,transparent);stroke:var(--gmm-ed-text-2)}
.SPR_root .SPR_isoPreviewBase line{stroke:var(--gmm-ed-text-2)}
.SPR_root .SPR_isoRange{accent-color:var(--gmm-ed-accent)}
.SPR_root .SPR_isoPreviewSizeLabel{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_isoScaleValue{color:var(--gmm-ed-text-2)}
.SPR_root .SPR_isoPreviewHint{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_isoAssetRow{background:color-mix(in srgb,var(--gmm-ed-0) 55%,transparent);border:1px solid var(--gmm-ed-line)}
.SPR_root .SPR_isoAssetName{color:var(--gmm-ed-accent)}
.SPR_root .SPR_isoAssetMeta{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_isoBadge{border:1px solid var(--gmm-ed-line);color:var(--gmm-ed-text-3)}
.SPR_root .SPR_isoMini{background:var(--gmm-ed-3);border:1px solid var(--gmm-ed-line);color:var(--gmm-ed-text-2)}
.SPR_root .SPR_isoMini:hover:not(:disabled){background:var(--gmm-ed-2);color:var(--gmm-ed-text)}
.SPR_root .SPR_isoLayerRow{background:color-mix(in srgb,var(--gmm-ed-0) 55%,transparent);border:1px solid var(--gmm-ed-line)}
.SPR_root .SPR_isoLayerRow[data-on="true"]{background:var(--gmm-ed-accent-soft);border-color:var(--gmm-ed-accent)}
.SPR_root .SPR_isoLayerIdx{color:var(--gmm-ed-text-3)}
.SPR_root .SPR_isoLayerName{color:var(--gmm-ed-text)}
.SPR_root .SPR_isoLayerName:hover{border-color:var(--gmm-ed-line)}
.SPR_root .SPR_isoMarkerRow{background:color-mix(in srgb,var(--gmm-ed-0) 55%,transparent);border:1px solid var(--gmm-ed-line)}
.SPR_root .SPR_isoMarkerDot{border:1.5px solid var(--gmm-ed-warn);background:var(--gmm-ed-0);color:var(--gmm-ed-text)}
.SPR_root .SPR_isoMarkerName{color:var(--gmm-ed-text)}
.SPR_root .SPR_isoFile{color:var(--gmm-ed-accent)}
`;
