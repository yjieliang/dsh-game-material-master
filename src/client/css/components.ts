/**
 * 基础组件（v2）：把历史遗留的共享类统一到新设计语言。
 *
 * 尺寸口径（设计稿实测）：控件高 32（紧凑 28）、圆角 8（小控件 6）、卡片 12；
 * 主按钮 = 墨绿实心，次按钮 = 白底 1px 描边，危险 = 红字描边；焦点环统一 2px 主色。
 * 这些规则都在 tokens 之后拼接，因此同特异性下覆盖历史样式。
 */
export const CSS_COMPONENTS = `
.SPR_btn{height:var(--gmm-ctl-h);padding:0 14px;border:1px solid var(--gmm-line-3);border-radius:var(--gmm-r-ctl);background:var(--gmm-surface);color:var(--gmm-text-2);font:inherit;font-size:12px;line-height:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;white-space:nowrap;text-decoration:none;transition:var(--gmm-motion)}
.SPR_btn:hover:not(:disabled){background:var(--gmm-hover-solid);color:var(--gmm-text)}
.SPR_btn[data-primary="true"]{background:var(--gmm-accent);border-color:var(--gmm-accent);color:var(--gmm-on-accent);font-weight:500}
.SPR_btn[data-primary="true"]:hover:not(:disabled){background:var(--gmm-accent-hover);border-color:var(--gmm-accent-hover);color:var(--gmm-on-accent)}
.SPR_btn[data-on="true"]{background:var(--gmm-accent-soft);border-color:var(--gmm-accent-line);color:var(--gmm-accent-ink)}
.SPR_btn[data-danger="true"]{color:var(--gmm-bad);border-color:color-mix(in srgb,var(--gmm-bad) 42%,var(--gmm-line-3));background:var(--gmm-surface)}
.SPR_btn[data-danger="true"]:hover:not(:disabled){background:color-mix(in srgb,var(--gmm-bad) 8%,var(--gmm-surface))}
.SPR_btn:disabled,.SPR_btn[data-disabled="true"]{opacity:.45;cursor:not-allowed}
.SPR_btn[data-busy="true"]{cursor:progress}
.SPR_btn-sm,.SPR_fileBtn{height:var(--gmm-ctl-h-sm);padding:0 11px;font-size:11.5px}
.SPR_miniBtn{height:24px;padding:0 9px;border:1px solid var(--gmm-line-3);border-radius:var(--gmm-r-tiny);background:var(--gmm-surface);color:var(--gmm-text-2);font:inherit;font-size:11px;cursor:pointer;transition:var(--gmm-motion)}
.SPR_miniBtn:hover{background:var(--gmm-hover-solid);color:var(--gmm-text)}
.SPR_modeBar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:4px;background:var(--gmm-surface-3);border-radius:var(--gmm-r-panel);width:fit-content;max-width:100%;box-sizing:border-box}
.SPR_modeBarLabel{font-size:11px;color:var(--gmm-text-3);padding:0 8px 0 6px}
.SPR_mode{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:0;border-radius:var(--gmm-r-ctl);background:transparent;color:var(--gmm-text-3);font:inherit;font-size:11.5px;cursor:pointer;transition:var(--gmm-motion);box-sizing:border-box}
.SPR_mode:hover{color:var(--gmm-text)}
.SPR_mode[data-active="true"]{background:var(--gmm-surface);color:var(--gmm-accent-ink);font-weight:600;box-shadow:0 1px 2px rgba(32,39,36,.10)}
.SPR_modeTitle{white-space:nowrap}
.SPR_modeTag{flex:none;font-size:9.5px;line-height:1;padding:3px 6px;border-radius:999px;background:var(--gmm-accent-soft);color:var(--gmm-accent-ink);font-weight:500}
.SPR_modeBarHint{flex:1 0 100%;padding:2px 8px 4px;font-size:11px;line-height:17px;color:var(--gmm-text-3)}
.SPR_input{height:var(--gmm-ctl-h);padding:0 10px;border:1px solid var(--gmm-line-3);border-radius:var(--gmm-r-ctl);background:var(--gmm-surface);color:var(--gmm-text);font:inherit;font-size:12px;transition:var(--gmm-motion);box-sizing:border-box;min-width:0}
.SPR_input:hover{border-color:color-mix(in srgb,var(--gmm-text-3) 55%,var(--gmm-line-3))}
.SPR_input:focus,.SPR_input:focus-visible{outline:none;border-color:var(--gmm-accent);box-shadow:var(--gmm-ring)}
.SPR_root textarea.SPR_input,.SPR_root textarea{font-size:12px;line-height:1.65;padding:10px 12px;height:auto;resize:vertical}
.SPR_field{display:flex;flex-direction:column;gap:6px;min-width:0}
.SPR_fieldLabel{font-size:11px;line-height:16px;color:var(--gmm-text-3)}
.SPR_field-inline{flex-direction:row;align-items:center;gap:10px}
.SPR_fields{display:flex;flex-wrap:wrap;gap:12px 14px}
.SPR_card{background:var(--gmm-surface);border:1px solid var(--gmm-line-2);border-radius:var(--gmm-r-card);box-shadow:var(--gmm-shadow-1);padding:18px 20px;min-width:0}
.SPR_cardHead{display:flex;align-items:center;gap:10px;margin-bottom:8px;min-width:0}
.SPR_cardHead h3{font-size:15px;line-height:22px;font-weight:600;margin:0;color:var(--gmm-text)}
.SPR_hint{font-size:11.5px;line-height:17px;color:var(--gmm-text-3);margin:0}
.SPR_chip{display:inline-flex;align-items:center;gap:4px;min-height:22px;padding:0 10px;border-radius:999px;background:var(--gmm-surface-3);color:var(--gmm-text-2);font-size:10.5px;line-height:1;white-space:nowrap}
.SPR_chip[data-kind="ok"]{background:color-mix(in srgb,var(--gmm-ok) 14%,transparent);color:var(--gmm-ok)}
.SPR_chip[data-kind="warn"]{background:color-mix(in srgb,var(--gmm-warn) 15%,transparent);color:var(--gmm-warn)}
.SPR_chip[data-kind="error"]{background:color-mix(in srgb,var(--gmm-bad) 14%,transparent);color:var(--gmm-bad)}
.SPR_chip[data-kind="running"]{background:var(--gmm-accent-tint);color:var(--gmm-accent-ink)}
.SPR_badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;line-height:1;padding:3px 7px;border-radius:999px;background:var(--gmm-surface-3);color:var(--gmm-text-3);white-space:nowrap}
.SPR_expTag{margin-left:2px;font-size:9.5px;line-height:1;padding:3px 5px;border-radius:999px;border:1px solid currentColor;color:var(--gmm-warn);background:transparent;font-weight:500;white-space:nowrap}
.SPR_toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.SPR_btnRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.SPR_refRow{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--gmm-text-3);min-width:0}
.SPR_spacer{flex:1;min-width:0}
.SPR_hr{height:1px;background:var(--gmm-line-2);border:0;margin:14px 0}
.SPR_drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;border:1px dashed var(--gmm-line-3);border-radius:var(--gmm-r-panel);background:var(--gmm-surface-2);padding:18px;text-align:center;cursor:pointer;transition:var(--gmm-motion)}
.SPR_drop:hover,.SPR_drop[data-over="true"]{border-color:var(--gmm-accent);background:var(--gmm-accent-tint)}
.SPR_note{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--gmm-r-panel);border:1px solid var(--gmm-line-2);background:var(--gmm-surface-2);font-size:11.5px;line-height:17px;color:var(--gmm-text-2);margin-bottom:12px}
.SPR_note[data-kind="ok"]{border-color:color-mix(in srgb,var(--gmm-ok) 34%,var(--gmm-line-2));background:color-mix(in srgb,var(--gmm-ok) 8%,var(--gmm-surface))}
.SPR_note[data-kind="error"]{border-color:color-mix(in srgb,var(--gmm-bad) 34%,var(--gmm-line-2));background:color-mix(in srgb,var(--gmm-bad) 8%,var(--gmm-surface))}
.SPR_note[data-kind="info"]{border-color:var(--gmm-accent-line);background:var(--gmm-accent-tint)}
.SPR_empty{color:var(--gmm-text-3);font-size:12px;line-height:18px;padding:20px 0;text-align:center}
.SPR_emptyHero{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:44px 20px;text-align:center}
.SPR_emptyHeroMark{width:54px;height:54px;border-radius:16px;display:inline-flex;align-items:center;justify-content:center;background:var(--gmm-accent-soft);color:var(--gmm-accent)}
.SPR_emptyHeroTitle{font-size:17px;line-height:24px;font-weight:600;color:var(--gmm-text)}
.SPR_emptyHeroDesc{font-size:12px;line-height:19px;color:var(--gmm-text-3);max-width:460px}
.SPR_thumbBox,.SPR_thumb{border-radius:var(--gmm-r-ctl);background:var(--gmm-surface-3);border:1px solid var(--gmm-line-2);overflow:hidden}
.SPR_thumb-pending,.SPR_thumb-empty,.SPR_thumbEmpty{border-radius:var(--gmm-r-ctl);border:1px dashed var(--gmm-line-3);background:var(--gmm-surface-2);color:var(--gmm-text-4)}
.SPR_ovl{border-radius:var(--gmm-r-panel);background:color-mix(in srgb,var(--gmm-accent) 92%,#000);color:var(--gmm-on-accent);font-size:12px}
.SPR_spin,.SPR_spinSm{border-color:color-mix(in srgb,currentColor 26%,transparent);border-top-color:currentColor}
.SPR_progressTrack{background:var(--gmm-surface-3);border-radius:999px;overflow:hidden}
.SPR_progressFill{background:var(--gmm-accent);border-radius:999px}
.SPR_zoomMask,.SPR_mapEdDlgMask,.SPR_isoDlgMask,.SPR_gateMask{background:color-mix(in srgb,#101310 78%,transparent);backdrop-filter:blur(3px)}
.SPR_gate,.SPR_isoDlg,.SPR_mapEdDlg{border-radius:var(--gmm-r-card);border:1px solid var(--gmm-line-2);background:var(--gmm-surface);box-shadow:var(--gmm-shadow-pop)}
.SPR_projItem{border-radius:var(--gmm-r-ctl);border:1px solid transparent;padding:8px 10px;transition:var(--gmm-motion)}
.SPR_sideTitle{font-size:10.5px;letter-spacing:.03em;color:var(--gmm-text-4)}
.SPR_side{background:var(--gmm-surface-2);border-right:1px solid var(--gmm-line-2)}
.SPR_link,.SPR_saveLink{color:var(--gmm-accent);font:inherit;font-size:11.5px;background:none;border:0;cursor:pointer;padding:0;text-decoration:none}
.SPR_link:hover{color:var(--gmm-accent-hover);text-decoration:underline}

.SPR_settings{max-width:820px;gap:14px;font-size:13px;line-height:20px;color:var(--gmm-text)}
.SPR_settingsGroup{background:var(--gmm-surface);border:1px solid var(--gmm-line-2);border-radius:var(--gmm-r-card);box-shadow:var(--gmm-shadow-1);padding:18px 20px}
.SPR_settingsGroup h3{margin:0 0 6px;font-size:15px;line-height:22px;font-weight:600;color:var(--gmm-text)}
.SPR_settingsGroup p{margin:0 0 10px;color:var(--gmm-text-3);font-size:11.5px;line-height:17px}
.SPR_settings .SPR_btn{height:32px}
.SPR_settings .SPR_input{height:32px}
.SPR_settings .SPR_featureRow{border-radius:var(--gmm-r-panel);padding:10px 12px}
.SPR_settings .SPR_featureRow:hover{background:var(--gmm-hover)}
.SPR_settings .SPR_featureTitle{font-size:12.5px;font-weight:600;color:var(--gmm-text)}
.SPR_settings .SPR_featureHint{font-size:11px;line-height:16px;color:var(--gmm-text-3)}
`;
