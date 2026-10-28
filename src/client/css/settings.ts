/**
 * 设置页（ConfigSection）的信息架构样式：顶部状态条 + 原生 `<details>` 折叠分组。
 *
 * 折叠用浏览器原生元素，不引入 Hook / addEventListener（verify-arch 的监听器棘轮
 * 只许降不许涨）；样式一律走 `--gmm-*` 设计令牌，浅/深两套主题共用。
 */
export const CSS_SETTINGS = `
/* ── 顶部状态条 ─────────────────────────────────────────────────────── */
.SPR_statusBar{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;padding:12px 14px;border:1px solid var(--gmm-line-2);border-radius:var(--gmm-r-card);background:var(--gmm-surface-3)}
.SPR_statusMain{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 260px}
.SPR_statusTitle{font-size:11px;line-height:16px;color:var(--gmm-text-3)}
.SPR_statusValue{font-size:13px;line-height:18px;font-weight:600;color:var(--gmm-text);overflow-wrap:anywhere}
.SPR_statusRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.SPR_statusTag{font-size:11px;line-height:16px;padding:1px 8px;border-radius:999px;border:1px solid transparent;white-space:nowrap}
.SPR_statusTag[data-kind="ok"]{color:var(--gmm-ok);border-color:color-mix(in srgb, var(--gmm-ok) 35%, transparent);background:color-mix(in srgb, var(--gmm-ok) 8%, transparent)}
.SPR_statusTag[data-kind="bad"]{color:var(--gmm-bad);border-color:color-mix(in srgb, var(--gmm-bad) 40%, transparent);background:color-mix(in srgb, var(--gmm-bad) 8%, transparent)}
.SPR_statusHint{font-size:11.5px;line-height:17px;color:var(--gmm-text-3);overflow-wrap:anywhere}
.SPR_statusHint[data-kind="bad"]{color:var(--gmm-bad)}
.SPR_statusEnv{margin:0;padding:8px 10px;border-radius:8px;background:var(--gmm-surface);border:1px solid var(--gmm-line-1);font-size:11.5px;line-height:18px;color:var(--gmm-text-2);white-space:pre-wrap;flex:1 1 100%;font-family:var(--gmm-mono)}

/* ── 折叠分组 ───────────────────────────────────────────────────────── */
.SPR_settingsGroup>summary{display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none;outline:none;padding:1px 0}
.SPR_settingsGroup>summary::-webkit-details-marker{display:none}
.SPR_settingsGroup>summary::after{content:"▾";margin-left:auto;color:var(--gmm-text-3);font-size:11px;line-height:16px;transition:transform .15s ease}
.SPR_settingsGroup[open]>summary::after{transform:rotate(180deg)}
.SPR_settingsGroup>summary:hover .SPR_groupTitle{color:var(--gmm-accent)}
.SPR_groupTitle{font-size:13px;font-weight:600;color:var(--gmm-text);display:inline-flex;align-items:center;gap:8px;min-width:0}
.SPR_groupSub{margin-left:2px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--gmm-text-3)}
.SPR_settingsGroup[open]>summary{margin-bottom:10px}

/* ── 子分组（未使用的后端只留一行，点开再配置） ─────────────────────── */
.SPR_settingsSub{border:1px solid var(--gmm-line-1);border-radius:10px;padding:10px 12px;background:var(--gmm-surface-2);margin:0 0 10px}
.SPR_settingsSub>summary{display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none;outline:none;font-size:12px;line-height:18px;font-weight:600;color:var(--gmm-text-2)}
.SPR_settingsSub>summary::-webkit-details-marker{display:none}
.SPR_settingsSub>summary::after{content:"▾";margin-left:auto;color:var(--gmm-text-3);font-size:10px;transition:transform .15s ease}
.SPR_settingsSub[open]>summary::after{transform:rotate(180deg)}
.SPR_settingsSub[open]>summary{margin-bottom:8px}
`;
