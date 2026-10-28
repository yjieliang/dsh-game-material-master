/**
 * 外壳（shell）样式：应用框架 = 左 232 侧栏 + 顶栏 64 + 内容区。
 *
 * 对应设计稿：侧栏（品牌 38 图标 / 新建项目 / 创作工具导航 / 底部当前项目卡）→
 * 顶栏（面包屑 + 本地处理状态 + 设置）→ 内容（页标题 + 步骤条整卡 + 双列）。
 * 类名只在本文件与 studio-panel.ts / shell/*.ts 里成对出现，改一处必须改另一处。
 */
export const CSS_SHELL = `
.SPR_root{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden}
.SPR_app{display:flex;flex:1;min-height:0;background:var(--gmm-bg)}
.SPR_sidebar{width:var(--gmm-side-w);flex:none;display:flex;flex-direction:column;gap:14px;padding:16px 16px 14px;background:var(--gmm-bg-side);border-right:1px solid var(--gmm-line-2);overflow:auto;min-height:0}
.SPR_brand{display:flex;align-items:center;gap:11px;min-width:0}
.SPR_brandMark{width:38px;height:38px;flex:none;border-radius:10px;background:var(--gmm-accent);display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:2px;padding:8px}
.SPR_brandMark i{display:block;border-radius:1.5px;background:var(--gmm-on-accent)}
.SPR_brandMark i:nth-child(2),.SPR_brandMark i:nth-child(3){opacity:.62}
.SPR_brandText{display:flex;flex-direction:column;min-width:0}
.SPR_brandTitle{font-size:17px;font-weight:700;line-height:22px;color:var(--gmm-text);white-space:nowrap}
.SPR_brandSub{font-size:11px;line-height:16px;color:var(--gmm-text-3);white-space:nowrap}
.SPR_newProject{flex:none;height:40px;border:0;border-radius:var(--gmm-r-panel);background:var(--gmm-accent);color:var(--gmm-on-accent);font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:var(--gmm-motion)}
.SPR_newProject:hover{background:var(--gmm-accent-hover)}
.SPR_sideGroup{font-size:11px;line-height:16px;color:var(--gmm-text-4);padding:2px 4px 0;letter-spacing:.02em}
.SPR_nav{display:flex;flex-direction:column;gap:3px;min-height:0}
.SPR_navItem{display:flex;flex-direction:column;justify-content:center;gap:3px;width:100%;min-height:44px;text-align:left;font:inherit;border:0;background:transparent;border-radius:var(--gmm-r-panel);padding:8px 12px;cursor:pointer;color:var(--gmm-text-2);transition:var(--gmm-motion)}
.SPR_navItem:hover{background:var(--gmm-hover)}
.SPR_navItem[data-active="true"]{background:var(--gmm-accent-soft);color:var(--gmm-accent-ink)}
.SPR_navTitleRow{display:flex;align-items:center;gap:6px;min-width:0}
.SPR_navTitle{font-size:13px;line-height:18px;font-weight:500;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SPR_navItem[data-active="true"] .SPR_navTitle{font-weight:600}
.SPR_navHint{display:none;font-size:10.5px;line-height:14px;color:var(--gmm-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SPR_navItem[data-active="true"] .SPR_navHint{display:block}
.SPR_navItem[data-active="true"] .SPR_navHint{color:var(--gmm-accent)}
.SPR_navFlag{flex:none;font-size:10.5px;line-height:18px;color:var(--gmm-text-4);font-weight:400;white-space:nowrap}
.SPR_sideProject{flex:none;margin-top:auto;display:flex;flex-direction:column;gap:3px;text-align:left;font:inherit;border:1px solid var(--gmm-line-3);background:var(--gmm-surface-2);border-radius:var(--gmm-r-panel);padding:11px 12px 12px;cursor:pointer;color:var(--gmm-text);transition:var(--gmm-motion)}
.SPR_sideProject:hover{background:var(--gmm-surface);border-color:var(--gmm-accent-line)}
.SPR_sideProjectLabel{font-size:10.5px;line-height:15px;color:var(--gmm-text-4)}
.SPR_sideProjectName{font-size:14px;line-height:20px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SPR_sideProjectMeta{font-size:11px;line-height:16px;color:var(--gmm-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SPR_sideProjectState{font-size:11px;line-height:16px;color:var(--gmm-accent)}
.SPR_sideProject-empty .SPR_sideProjectName{color:var(--gmm-text-3);font-weight:500}
.SPR_projPop{position:absolute;z-index:40;width:264px;max-height:320px;overflow:auto;background:var(--gmm-surface);border:1px solid var(--gmm-line-2);border-radius:var(--gmm-r-card);box-shadow:var(--gmm-shadow-pop);padding:6px}
.SPR_projPopHead{font-size:10.5px;color:var(--gmm-text-4);padding:6px 8px 4px;letter-spacing:.02em}
.SPR_projPop .SPR_projItem{border-color:transparent}
.SPR_projPop .SPR_projItem:hover{background:var(--gmm-hover)}
.SPR_projPop .SPR_projItem[data-active="true"]{background:var(--gmm-accent-tint);border-color:var(--gmm-accent-line)}
.SPR_mainCol{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.SPR_topbar{height:var(--gmm-top-h);flex:none;display:flex;align-items:center;gap:12px;padding:0 24px;background:var(--gmm-bg-top);border-bottom:1px solid var(--gmm-line-2)}
.SPR_crumb{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--gmm-text-3);min-width:0}
.SPR_crumbSep{color:var(--gmm-text-4)}
.SPR_crumb b{font-weight:500;color:var(--gmm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SPR_topSpacer{flex:1}
.SPR_topStatus{display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--gmm-text-3);white-space:nowrap}
.SPR_topStatus i{width:6px;height:6px;border-radius:50%;background:#538177;flex:none}
.SPR_topStatus[data-off="true"] i{background:var(--gmm-text-4)}
.SPR_scroll{flex:1;min-height:0;overflow:auto;padding:22px 24px 36px;display:flex;flex-direction:column}
.SPR_scroll>*{flex:0 0 auto}
.SPR_pageHead{display:flex;align-items:flex-start;gap:16px;margin-bottom:18px;min-width:0}
.SPR_pageHeadMain{min-width:0}
.SPR_pageTitle{font-size:28px;line-height:36px;font-weight:700;letter-spacing:.01em;color:var(--gmm-text)}
.SPR_pageSub{margin-top:7px!important;font-size:12px;line-height:18px;color:var(--gmm-text-3)}
.SPR_pageActions{margin-left:auto;flex:none;display:flex;align-items:center;gap:8px}
.SPR_stepBar{display:flex;gap:0;align-items:stretch;background:var(--gmm-surface);border:1px solid var(--gmm-line-2);border-radius:var(--gmm-r-card);padding:12px 10px;margin-bottom:16px;box-shadow:var(--gmm-shadow-1);overflow:hidden}
.SPR_stepCard{flex:1 1 0;min-width:0;display:flex;align-items:center;gap:10px;background:transparent;border:0;font:inherit;color:var(--gmm-text-2);padding:9px 12px;border-radius:var(--gmm-r-panel);cursor:pointer;text-align:left;transition:var(--gmm-motion)}
.SPR_stepCard:hover{background:var(--gmm-hover)}
.SPR_stepCard[data-active="true"]{background:var(--gmm-accent-tint);color:var(--gmm-accent-ink)}
.SPR_stepNum{width:28px;height:28px;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:var(--gmm-surface-3);color:var(--gmm-text-4);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
.SPR_stepCard[data-active="true"] .SPR_stepNum{background:var(--gmm-accent);color:var(--gmm-on-accent)}
.SPR_stepCard[data-done="true"] .SPR_stepNum{background:var(--gmm-accent-soft);color:var(--gmm-accent-ink)}
.SPR_stepCard[data-error="true"] .SPR_stepNum{background:color-mix(in srgb,var(--gmm-bad) 18%,transparent);color:var(--gmm-bad)}
.SPR_stepLabel{font-size:12px;line-height:18px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.SPR_cols{display:grid;grid-template-columns:minmax(0,1fr) 298px;gap:16px;align-items:start}
.SPR_cols[data-single="true"]{grid-template-columns:minmax(0,1fr)}
@media (max-width:1180px){.SPR_cols{grid-template-columns:minmax(0,1fr)}}
.SPR_col{display:flex;flex-direction:column;gap:16px;min-width:0}
.SPR_panel{background:var(--gmm-surface);border:1px solid var(--gmm-line-2);border-radius:var(--gmm-r-card);box-shadow:var(--gmm-shadow-1);min-width:0}
.SPR_panelHead{display:flex;align-items:flex-start;gap:10px;padding:18px 20px 0;min-width:0}
.SPR_panelHeadMain{min-width:0}
.SPR_panelTitle{font-size:17px;line-height:24px;font-weight:600;color:var(--gmm-text);margin:0}
.SPR_panelSub{margin-top:6px!important;font-size:11.5px;line-height:17px;color:var(--gmm-text-3)}
.SPR_panelHeadAside{margin-left:auto;flex:none;display:flex;align-items:center;gap:8px}
.SPR_panelBody{padding:16px 20px 20px;min-width:0}
.SPR_panelBody-tight{padding:12px 20px 16px}
.SPR_panelFoot{display:flex;align-items:center;gap:10px;padding:0 20px 20px;min-width:0}
.SPR_panelFootNote{font-size:10.5px;line-height:15px;color:var(--gmm-text-3);min-width:0}
.SPR_panelFootActions{margin-left:auto;flex:none;display:flex;align-items:center;gap:8px}
.SPR_railCard{background:var(--gmm-surface);border:1px solid var(--gmm-line-2);border-radius:var(--gmm-r-card);box-shadow:var(--gmm-shadow-1);padding:16px 18px 18px}
.SPR_railHead{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.SPR_railTitle{font-size:14px;line-height:20px;font-weight:600;color:var(--gmm-text);margin:0}
.SPR_railAside{margin-left:auto;font-size:10.5px;color:var(--gmm-text-4);white-space:nowrap}
.SPR_railRow{display:flex;align-items:center;gap:10px;min-height:34px}
.SPR_railRow+.SPR_railRow{margin-top:2px}
.SPR_railLabel{font-size:11px;color:var(--gmm-text-3);white-space:nowrap;flex:none}
.SPR_railValue{margin-left:auto;font-size:11.5px;color:var(--gmm-text);font-variant-numeric:tabular-nums;white-space:nowrap}
.SPR_railValue-accent{color:var(--gmm-accent)}
.SPR_railChip{display:inline-flex;align-items:center;justify-content:flex-end;min-height:32px;padding:0 12px;border-radius:var(--gmm-r-ctl);background:var(--gmm-surface-3);color:var(--gmm-text);font:inherit;font-size:11.5px;border:0;cursor:pointer;font-variant-numeric:tabular-nums}
.SPR_railChip:hover{background:var(--gmm-hover-solid)}
.SPR_railHint{font-size:11px;line-height:17px;color:var(--gmm-text-3);margin-top:10px}
.SPR_previewBox{position:relative;margin-top:2px;border-radius:var(--gmm-r-panel);background:#e4e6e3;min-height:190px;display:flex;align-items:center;justify-content:center;color:#9aa0a8;font-size:15px;letter-spacing:.06em;overflow:hidden}
[data-gmm-theme="dark"] .SPR_previewBox,.SPR_root[data-gmm-theme="dark"] .SPR_previewBox{background:#2a2e29;color:#7d8480}
.SPR_previewBox img{width:100%;height:100%;object-fit:contain;display:block}
.SPR_previewCaption{margin-top:10px!important;font-size:11px;line-height:17px;color:var(--gmm-text-3)}
.SPR_previewFoot{margin-top:8px!important;font-size:10px;line-height:15px;color:var(--gmm-text-4)}

.SPR_sideProjWrap{position:relative;margin-top:auto;flex:none}
.SPR_sideProjWrap>summary{list-style:none;cursor:pointer}
.SPR_sideProjWrap>summary::-webkit-details-marker{display:none}
.SPR_sideProjWrap>summary::marker{content:""}
.SPR_sideProjWrap[open]>summary{border-color:var(--gmm-accent-line);background:var(--gmm-surface)}
.SPR_sideProjWrap>.SPR_projPop{position:absolute;left:0;right:0;bottom:calc(100% + 8px);width:auto}
.SPR_sourceBlock{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;margin-bottom:18px}
.SPR_dropZone{width:220px;min-height:150px;flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:16px;border:1px dashed var(--gmm-line-3);border-radius:var(--gmm-r-panel);background:var(--gmm-surface-2);color:var(--gmm-text-2);font:inherit;cursor:pointer;transition:var(--gmm-motion);box-sizing:border-box}
.SPR_dropZone:hover,.SPR_dropZone[data-over="true"]{border-color:var(--gmm-accent);background:var(--gmm-accent-tint)}
.SPR_dropZone[data-has="true"]{border-style:solid;border-color:var(--gmm-line-3);background:var(--gmm-surface-2);gap:5px}
.SPR_dropThumb{width:100%;height:86px;object-fit:contain;border-radius:var(--gmm-r-tiny);background:var(--gmm-surface)}
.SPR_dropIcon{width:38px;height:38px;border-radius:11px;display:inline-flex;align-items:center;justify-content:center;background:var(--gmm-accent-soft);color:var(--gmm-accent)}
.SPR_dropTitle{font-size:12.5px;line-height:18px;font-weight:600;color:var(--gmm-text)}
.SPR_dropSub{font-size:10.5px;line-height:15px;color:var(--gmm-text-4);text-align:center}
.SPR_dropPick{margin-top:4px;display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 14px;border-radius:var(--gmm-r-ctl);border:1px solid var(--gmm-line-3);background:var(--gmm-surface);color:var(--gmm-accent);font-size:11.5px;font-weight:500}
.SPR_dropZone:hover .SPR_dropPick{border-color:var(--gmm-accent)}
.SPR_tips{flex:1 1 260px;min-width:220px;display:flex;flex-direction:column;gap:6px}
.SPR_tipsTitle{font-size:12.5px;line-height:18px;font-weight:600;color:var(--gmm-text);margin:0}
.SPR_tipsText{font-size:11.5px;line-height:17px;color:var(--gmm-text-3);margin:0}
.SPR_tipsList{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.SPR_tip{display:flex;align-items:flex-start;gap:8px}
.SPR_tipNo{flex:none;font-size:10px;line-height:16px;color:var(--gmm-text-4);font-variant-numeric:tabular-nums}
.SPR_tipText{font-size:11.5px;line-height:17px;color:var(--gmm-text-2)}

.SPR_scroll>.SPR_fill,.SPR_fill{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.SPR_fillScroll{flex:1 1 auto;min-height:0;overflow:auto}
.SPR_inlineHead{display:flex;align-items:center;gap:10px;margin-bottom:12px;min-width:0}
.SPR_inlineHeadTitle{font-size:15px;line-height:22px;font-weight:600;color:var(--gmm-text);margin:0}
.SPR_inlineHeadAside{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}

.SPR_headPill{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:2px 4px 2px 10px;border:1px solid var(--gmm-line-2);border-radius:999px;background:var(--gmm-surface);box-shadow:var(--gmm-shadow-1)}
.SPR_headPill .SPR_toolbar{gap:6px;flex-wrap:nowrap}
.SPR_headPill .SPR_refRow{font-size:11.5px;color:var(--gmm-text-3)}
.SPR_headPill .SPR_toolbar>.SPR_refRow:last-child{display:none}
.SPR_headPill .SPR_input{width:auto!important;min-width:132px;max-width:170px}
.SPR_headPill .SPR_input{height:28px;border:0;background:transparent;color:var(--gmm-text);font-size:11.5px;padding:0 22px 0 4px;appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--gmm-text-3) 50%),linear-gradient(135deg,var(--gmm-text-3) 50%,transparent 50%);background-position:calc(100% - 11px) 12px,calc(100% - 7px) 12px;background-size:4px 4px,4px 4px;background-repeat:no-repeat}
.SPR_headPill .SPR_input:focus{box-shadow:none;border:0}
`;
