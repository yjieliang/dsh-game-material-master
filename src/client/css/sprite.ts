/**
 * 模块①（动画帧工具盒）的专属样式。阶段①：右列「本步设置」四行 /「产出预览」占位块 /
 * 转圈视频提示词框 + 右对齐动作区。颜色一律 --gmm-*。
 */
export const CSS_SPRITE = `
.SPR_railCard[data-card="settings"]{padding-bottom:12px}
.SPR_railCard[data-card="settings"] .SPR_railHead{margin-bottom:4px}
.SPR_railCard .SPR_railRow{min-height:46px}
.SPR_railCard .SPR_railRow+.SPR_railRow{margin-top:0}
.SPR_railValueWrap{margin-left:auto;display:inline-flex;align-items:center;flex:none}
.SPR_railNum{width:62px;height:32px;box-sizing:border-box;border:0;border-radius:var(--gmm-r-ctl);background:var(--gmm-surface-3);color:var(--gmm-text);font:inherit;font-size:11.5px;text-align:center}
.SPR_railNum:focus{outline:none;background:var(--gmm-surface);box-shadow:var(--gmm-ring)}
.SPR_railNum::-webkit-inner-spin-button,.SPR_railNum::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.SPR_railCard .SPR_railChip{margin-left:auto;min-width:82px;padding:0 16px;justify-content:center;font-size:11.5px}
.SPR_railError{margin-top:6px!important;font-size:10.5px;line-height:15px;color:var(--gmm-bad)}
.SPR_railCard[data-card="preview"]{display:flex;flex-direction:column;min-height:407px}
.SPR_railCard[data-card="preview"] .SPR_previewBox{width:100%;height:190px;min-height:190px;background:#e5e7ea;color:#9aa0a8;font-size:15px;letter-spacing:.06em}
[data-gmm-theme="dark"] .SPR_railCard[data-card="preview"] .SPR_previewBox,.SPR_root[data-gmm-theme="dark"] .SPR_railCard[data-card="preview"] .SPR_previewBox{background:#1c1f1b;color:#7d8480}
.SPR_turnHeadTitle{margin:14px 0 8px!important;font-size:12.5px;line-height:18px;font-weight:600;color:var(--gmm-text)}
.SPR_turnFoot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px;min-width:0}
.SPR_turnFootNote{font-size:10.5px;line-height:16px;color:var(--gmm-text-3)}
.SPR_turnFootActions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}
.SPR_promptBox{display:flex;flex-direction:column;box-sizing:border-box;padding:12px 16px 10px;border:1px solid var(--gmm-line-2);border-radius:var(--gmm-r-panel);background:var(--gmm-surface-2)}
.SPR_promptBox:focus-within{border-color:var(--gmm-accent-line);background:var(--gmm-surface)}
.SPR_promptArea{flex:1 1 auto;min-height:150px;width:100%;box-sizing:border-box;margin:0;padding:0;border:0;background:transparent;color:var(--gmm-text-2);font:inherit;font-size:12px;line-height:20px;resize:vertical;outline:none}
.SPR_promptFoot{display:flex;align-items:center;gap:8px;margin-top:8px}
.SPR_promptState{font-size:10px;line-height:15px;color:var(--gmm-text-4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SPR_promptState[data-dirty="true"]{color:var(--gmm-warn)}
.SPR_promptReset{margin-left:auto;flex:none;padding:0;border:0;background:none;color:var(--gmm-text-3);font:inherit;font-size:10px;line-height:15px;cursor:pointer}
.SPR_promptReset:hover{color:var(--gmm-accent);text-decoration:underline}
.SPR_autoPick{margin-top:10px;padding:10px 12px;box-sizing:border-box;border:1px solid var(--gmm-line-2);border-radius:var(--gmm-r-panel);background:var(--gmm-surface-2)}
.SPR_autoPickHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.SPR_autoPickThumbs{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px}
.SPR_autoPickThumb{margin:0;width:64px;display:flex;flex-direction:column;gap:2px}
.SPR_autoPickThumb img{width:64px;height:64px;object-fit:contain;box-sizing:border-box;background:var(--gmm-surface-3);border:1px solid var(--gmm-line-2);border-radius:var(--gmm-r-ctl)}
.SPR_autoPickThumb figcaption{font-size:10px;line-height:14px;color:var(--gmm-text-3);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SPR_autoPickNotes{margin:6px 0 0!important;padding-left:16px;font-size:10.5px;line-height:16px;color:var(--gmm-text-3)}
`;