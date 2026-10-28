import { CSS_COMPONENTS } from "./css/components.js";
import { CSS_SETTINGS } from "./css/settings.js";
import { CSS_SHELL } from "./css/shell.js";
import { CSS_MODULES } from "./css/modules.js";
import { CSS_SPRITE } from "./css/sprite.js";
import { CSS_TOKENS } from "./css/tokens.js";
/**
 * 工作台样式表：以字符串注入 `<style data-plugin>`，随插件 fiber 生命周期挂载 / 移除。
 *
 * 浏览器半区没有 CSS 构建步骤，所以这里就是一整段纯文本；改样式改这一处。
 */
export const CSS_LEGACY = `
/*
 * 设计基线（全模块共用）
 *
 * 交互控件统一 28px 高、圆角 8；卡片圆角 12；焦点环统一 2px 主题色 + 2px 留白。
 * 各模块只管排版，控件外观一律走这几个变量，避免「每个模块自己一套圆角/高度」。
 */
.SPR_root{display:flex;flex-direction:column;height:100%;min-height:0;overflow-y:auto;overflow-x:hidden;color:var(--gmm-text);font-size:13px;line-height:20px;
  --spr-r-sm:6px;--spr-r-md:8px;--spr-r-lg:12px;
  --spr-ctl:28px;--spr-ctl-sm:22px;
  --spr-gap:8px;--spr-pad:14px;
  --spr-ring:0 0 0 3px color-mix(in srgb, var(--gmm-accent) 22%, transparent);
  --spr-motion:background-color .12s ease,border-color .12s ease,color .12s ease,box-shadow .12s ease}
.SPR_root :is(button,a,summary,input,textarea,select,[role=button]):focus-visible{outline:2px solid var(--gmm-accent);outline-offset:2px}
/*
 * 六号模块（地图编辑器）自己的正文容器。
 *
 * ⚠️ 以前**一条 CSS 都没有**：卡片与文字紧贴面板左右边缘，看着像没做完（真机反馈
 * 「这个界面离左边没有 padding」）。这里对齐模块①②③用的 .SPR_main（16px 18px 40px）。
 */
.SPR_moduleBody{display:flex;flex-direction:column;flex:1;min-height:0;height:100%;box-sizing:border-box;padding:16px 18px 40px}
.SPR_head>.SPR_btn,.SPR_head>.SPR_copyId{flex:none}
.SPR_spacer{flex:1}
.SPR_body{display:flex;flex:1;min-height:0}
.SPR_side{width:220px;flex:none;border-right:1px solid var(--gmm-line-2);padding:12px;overflow:auto;display:flex;flex-direction:column;gap:8px}
.SPR_sideTitle{font-size:11px;font-weight:600;letter-spacing:.4px;line-height:16px;color:var(--gmm-text-3);padding:2px 4px}
.SPR_sideEmpty{margin:0;padding:14px 12px;border:1px dashed var(--gmm-line-2);border-radius:10px;color:var(--gmm-text-3);font-size:12px;line-height:18px;text-align:center}
.SPR_projItem{display:flex;flex-direction:column;gap:2px;text-align:left;width:100%;font:inherit;cursor:pointer;background:transparent;border:1px solid transparent;border-radius:8px;padding:7px 9px;color:var(--gmm-text)}
.SPR_projItem:hover{background:var(--gmm-hover)}
.SPR_projItem[data-active=true]{background:var(--gmm-surface-3);border-color:var(--gmm-line-1)}
.SPR_copyId{display:inline-flex;align-items:center;justify-content:center;gap:4px;font:inherit;font-size:11px;line-height:1;white-space:nowrap;cursor:pointer;padding:4px 7px;border-radius:6px;border:1px solid var(--gmm-line-2);background:transparent;color:var(--gmm-text-2)}
.SPR_copyId:hover{background:var(--gmm-hover);color:var(--gmm-text)}
.SPR_copyId[data-copied=true]{border-color:var(--gmm-ok);color:var(--gmm-ok)}
.SPR_copyId[data-failed=true]{border-color:var(--gmm-bad);color:var(--gmm-bad)}
.SPR_copyIdInline{padding:0 3px;border:0;background:transparent;color:var(--gmm-text-3);font-size:12px;line-height:16px}
.SPR_copyIdInline:hover{background:transparent;color:var(--gmm-text)}
.SPR_projNameRow{display:flex;align-items:center;gap:6px;min-width:0}
.SPR_projNameRow>.SPR_projName{flex:1;min-width:0}
.SPR_mapEdTop .SPR_copyId,.SPR_isoTop .SPR_copyId{color:#f7f3ec;border-color:#232323;background:linear-gradient(#5d5d5d,#4b4b4b)}
.SPR_mapEdTop .SPR_copyId:hover,.SPR_isoTop .SPR_copyId:hover{background:linear-gradient(#6a6a6a,#555);color:#fff}
.SPR_mapEdTop .SPR_copyId[data-copied=true],.SPR_isoTop .SPR_copyId[data-copied=true]{border-color:#5bd08a;color:#b8ffd0}
.SPR_mapEdMenu .SPR_copyIdInline,.SPR_isoMenu .SPR_copyIdInline{color:#c9c4bb}
.SPR_mapEdMenu .SPR_copyIdInline:hover,.SPR_isoMenu .SPR_copyIdInline:hover{color:#fff}
.SPR_mapEdMenu .SPR_projNameRow,.SPR_isoMenu .SPR_projNameRow{width:100%}
.SPR_projName{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SPR_projMeta{font-size:11px;color:var(--gmm-text-3);font-variant-numeric:tabular-nums}
.SPR_main{flex:1;min-width:0;overflow:auto;padding:16px 18px 40px}
.SPR_steps{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.SPR_step{font:inherit;font-size:12px;cursor:pointer;background:var(--gmm-surface);border:1px solid var(--gmm-line-2);border-radius:999px;padding:5px 12px;color:var(--gmm-text-2);display:inline-flex;align-items:center;gap:6px}
.SPR_step[data-active=true]{color:var(--gmm-text);border-color:var(--gmm-accent);box-shadow:0 0 0 1px color-mix(in srgb, var(--gmm-accent) 28%, transparent)}
/* ── 地图地块生成（模块五）─────────────────────────────────────────────
   地块卡片要能一眼看出「几何对不对」：缩略图按 2:3 显示（单元格 64×96），
   下面跟一枚几何角标（2:1 · 实测比例）。角标是这一屏最有信息量的东西。 */
.SPR_tileThumb .SPR_thumb{aspect-ratio:2/3;max-height:150px}
.SPR_thumb-empty{display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--gmm-text-3);border:1px dashed var(--gmm-line-2);border-radius:8px;min-height:100px}
.SPR_tileEditorRow .SPR_field{flex:1;min-width:130px}
.SPR_thumb-pending{display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1;color:var(--gmm-text-3);background:var(--gmm-surface-2);border:1px dashed var(--gmm-line-2);border-radius:8px;min-width:96px;min-height:96px;box-sizing:border-box}
/* 装饰与建筑层同理，都必须是绝对定位 —— 少了 position 它们会退回文档流，
   top/left 完全不生效，表现是「所有装饰挤在画布左上角」（实测踩过）。 */
/* ── 地图编辑器（模块六）· AsLib RPG Map Maker 同款一屏布局 ─────────────
   外层仍然走 DSH 变量（浅色 / 深色都不吃亏），编辑器内部沿用 AsLib 配色：
   深灰 #424242、木质按钮、红框选中、单层预览绿底 rgb(56,170,68)。 */
.SPR_moduleBody[data-module="map"]{padding:0;height:100%;box-sizing:border-box;display:flex;flex-direction:column;min-height:0}
.SPR_mapEdRoot{display:flex;flex-direction:column;flex:1;min-height:0;border-radius:12px;overflow:hidden;background:#424242;color:#f2efe9;border:1px solid var(--gmm-line-2)}
.SPR_mapEdSpacer{flex:1;min-width:0}
.SPR_mapEdHint{font-size:11px;line-height:1.7;color:#c9c4bb;margin:0}
.SPR_mapEdTop{display:flex;align-items:center;gap:8px;padding:6px 10px;background:#383838;border-bottom:1px solid #232323;flex:none}
.SPR_mapEdProjWrap{position:relative;min-width:0}
.SPR_mapEdProj{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;font-weight:600;max-width:280px;cursor:pointer;color:#f7f3ec;background:transparent;border:1px solid transparent;border-radius:8px;padding:4px 8px}
.SPR_mapEdProj:hover{background:#4a4a4a}
.SPR_mapEdProj[data-open="true"]{background:#4a4a4a;border-color:#6d6d6d}
.SPR_mapEdProjName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SPR_mapEdCaret{font-size:10px;color:#c9c4bb}
.SPR_mapEdMenu{position:absolute;top:calc(100% + 4px);left:0;z-index:30;min-width:200px;max-height:60vh;overflow:auto;display:flex;flex-direction:column;padding:4px;background:#2f2f2f;border:1px solid #1c1c1c;border-radius:10px;box-shadow:0 10px 26px rgba(0,0,0,.45)}
.SPR_mapEdMenuItem{font:inherit;font-size:12px;text-align:left;cursor:pointer;color:#ece7df;background:transparent;border:none;border-radius:6px;padding:6px 9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SPR_mapEdMenuItem:hover{background:#454545}
.SPR_mapEdMenuItem[data-on="true"]{background:#4d4d4d;color:var(--gmm-accent, #8ab4f8)}
.SPR_mapEdMenuItem[data-danger="true"]{color:var(--gmm-bad, #ff8b7a)}
.SPR_mapEdMenuLabel{font-size:10px;color:#9d968c;padding:8px 9px 2px}
.SPR_mapEdTopBtn{font:inherit;font-size:12px;cursor:pointer;color:#f7f3ec;background:linear-gradient(#5d5d5d,#4b4b4b);border:1px solid #232323;border-radius:8px;padding:5px 14px}
.SPR_mapEdTopBtn:hover{background:linear-gradient(#6a6a6a,#555)}
.SPR_mapEdTopBtn[data-on="true"]{background:linear-gradient(#7d6a4a,#5f5038);border-color:#d9a95f}
.SPR_mapEdSave{font-size:11px;color:#b9b3a8;white-space:nowrap;font-variant-numeric:tabular-nums}
.SPR_mapEdSave[data-busy="true"]{color:var(--gmm-warn, #ffc400)}
.SPR_mapEdBody{display:flex;flex:1;min-height:0}
.SPR_mapEdSide{width:28.5%;min-width:240px;max-width:340px;flex:none;display:flex;flex-direction:column;gap:6px;padding:8px;box-sizing:border-box;background:#3b3b3b;border-right:1px solid #232323;min-height:0}
.SPR_mapEdSideTitle{font-size:11px;color:#a9a29a;padding-left:2px}
.SPR_mapEdPalette{flex:1;min-height:120px;overflow:auto;background:#2d2d2d;border:1px solid #232323;border-radius:6px;padding:4px}
.SPR_mapEdPaletteGrid{display:grid;grid-template-columns:repeat(8,32px);gap:2px}
.SPR_mapEdTile{width:32px;height:32px;padding:0;border:1px solid #262626;border-radius:3px;background-color:#1f1f1f;background-repeat:no-repeat;image-rendering:pixelated;cursor:pointer}
.SPR_mapEdTile:hover{border-color:#d9a95f}
.SPR_mapEdTile[data-on="true"]{outline:2px solid #e23b2b;outline-offset:-2px;border-color:#e23b2b}
.SPR_mapEdTools{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;flex:none}
.SPR_mapEdTool{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;color:#3a2a12;background:linear-gradient(#e6bd7d,#c9974f);border:1px solid #6b4a22;border-radius:4px}
.SPR_mapEdTool:hover{background:linear-gradient(#f2d29a,#d6a761)}
.SPR_mapEdTool[data-on="true"]{background:linear-gradient(#fbe3ad,#e0b268);box-shadow:inset 0 0 0 2px #d23b2c}
.SPR_mapEdTool:disabled{opacity:.4;cursor:default}
.SPR_mapEdLayerBtn{flex-direction:column;gap:0;padding:1px;background:linear-gradient(#e6bd7d,#c9974f)}
/* 工具格上方的小标签（名称 + 快捷键 + 介绍）。
   position:fixed —— 祖先里有 overflow 容器，absolute 会被裁掉「按钮正上方」那一段。
   z-index 必须**高于**对话框遮罩（.SPR_mapEdDlgMask = 70）与看图遮罩（.SPR_zoomMask = 80）：
   「新增素材」对话框里的「用法 / 会动吗」按钮也挂这套小标签，而标签节点是遮罩的**兄弟**
   （挂在面板根节点下、不在对话框里），z-index 比遮罩小就会被整片蒙层盖住 —— 真机表现是
   「鼠标移上去说明跑到窗口后面去了」，而自检（jsdom 不算绘制顺序）全绿。 */
.SPR_mapEdTip{position:fixed;z-index:90;pointer-events:none;transform:translate(-50%,-100%);max-width:236px;padding:6px 8px;border-radius:6px;border:1px solid #6b4a22;background:#2b2b2b;color:#f3e7d3;box-shadow:0 6px 16px rgba(0,0,0,.4);font-size:11px;line-height:1.5;text-align:left}
.SPR_mapEdTip::after{content:"";position:absolute;left:50%;bottom:-6px;margin-left:-5px;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid #2b2b2b}
.SPR_mapEdTipName{display:flex;align-items:center;gap:6px;font-weight:600}
.SPR_mapEdTipKey{padding:0 4px;border-radius:3px;background:#4a4a4a;font-size:10px;font-weight:400;color:#e8d7bb}
.SPR_mapEdTipDesc{margin-top:2px;color:#c9bda8}
/* 新建 / 重命名项目的名字对话框。fixed 居中：祖先里有 overflow 容器，
   absolute 会被裁掉（和工具小标签、侧栏菜单同一个坑）。 */
.SPR_mapEdDlgMask{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.42)}
/* 固定高度 + 内部滚动：整图的选项（占格 / 帧数 / 区域格子）一多，窗口会长到出屏，
   底下的「确定」根本点不到。标题与底部按钮吸住，中间那块自己滚。 */
.SPR_mapEdDlg{width:300px;max-width:calc(100vw - 32px);max-height:calc(100vh - 96px);padding:12px;box-sizing:border-box;border:1px solid #6b4a22;border-radius:8px;background:#2f2f2f;color:#f3e7d3;box-shadow:0 10px 30px rgba(0,0,0,.5);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}
.SPR_mapEdDlgHead{position:sticky;top:-12px;z-index:2;background:#2f2f2f;padding-top:2px}
.SPR_mapEdDlgActions{position:sticky;bottom:0;z-index:2;background:#2f2f2f;padding:8px 0 2px;margin-top:12px}
.SPR_mapEdStamp{position:relative;width:100%;box-sizing:border-box;margin:6px 0 4px;border:1px solid #4a443c;border-radius:6px;overflow:hidden;background:#1b1b1b;background-repeat:no-repeat;background-position:center;background-size:100% 100%}
.SPR_mapEdStampGrid{position:absolute;inset:0;display:grid;gap:0}
.SPR_mapEdStampCell{padding:0;border:1px solid rgba(255,255,255,.28);background:transparent;cursor:pointer;transition:background .08s}
.SPR_mapEdStampCell[data-pass="0"]{background:rgba(226,59,43,.1);box-shadow:inset 0 0 0 1px rgba(226,59,43,.4)}
.SPR_mapEdStampCell[data-pass="1"]{background:rgba(52,120,246,.16);box-shadow:inset 0 0 0 1px rgba(52,120,246,.6)}
.SPR_mapEdStampCell[data-pass="2"]{background:rgba(52,190,120,.16);box-shadow:inset 0 0 0 1px rgba(52,190,120,.6)}
.SPR_mapEdStampCell:hover{outline:2px solid #f0c040;outline-offset:-2px}
.SPR_mapEdLegend{display:flex;gap:8px;flex-wrap:wrap;font-size:10px;color:#cfc7ba;margin-bottom:4px}
.SPR_mapEdLegend>span{display:inline-flex;align-items:center;gap:3px}
.SPR_mapEdLegend i{width:9px;height:9px;border-radius:2px;display:inline-block}
.SPR_mapEdDlgTitle{font-size:13px;font-weight:600;margin-bottom:8px}
.SPR_mapEdDlgLabel{display:block;font-size:11px;color:#c9bda8;margin-bottom:4px}
.SPR_mapEdDlgInput{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #6b4a22;border-radius:4px;background:#1f1f1f;color:#f3e7d3;font-size:12px;outline:none}
.SPR_mapEdDlgInput:focus{border-color:#d9a95f}
.SPR_mapEdDlgRow{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.SPR_mapEdDlgHead{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.SPR_mapEdDlgHead>.SPR_mapEdDlgTitle{margin:0;flex:1;min-width:0}
.SPR_mapEdGuideMask{z-index:75;background:rgba(0,0,0,.62)}
.SPR_mapEdGuide{display:flex;flex-direction:column;gap:10px;width:620px;max-width:calc(100vw - 32px);max-height:calc(100vh - 48px);overflow:auto;padding:14px;border:1px solid #6b4a22;border-radius:10px;background:#2f2f2f;color:#f3e7d3;box-shadow:0 14px 40px rgba(0,0,0,.55)}
.SPR_mapEdGuideHead{display:flex;align-items:center;gap:8px}
.SPR_mapEdGuideHead>.SPR_mapEdDlgTitle{margin:0;flex:1;min-width:0}
.SPR_mapEdGuideTabs{display:flex;gap:6px;flex-wrap:wrap}
.SPR_mapEdGuideTab{font:inherit;font-size:12px;cursor:pointer;color:#f2efe9;background:#242424;border:1px solid #565656;border-radius:999px;padding:4px 14px}
.SPR_mapEdGuideTab:hover{border-color:#d9a95f}
.SPR_mapEdGuideTab[data-on="true"]{border-color:#d9a95f;background:#3a2f1d;color:#ffd79a;font-weight:600}
.SPR_mapEdGuideBody{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap}
/* 左列：示例图 + 一行小字。图按原始像素比缩放（image-rendering:pixelated 不糊），
   网格是**盖在图上的另一层**，位置由生成器给的 cols / rows / sub 现算。
   ⚠️ 面板被拖窄时（对话框比面板宽也一样）**文字自动折到图下面**：容器允许换行、
   文字列的最小宽度 260px 让它放不下就换行，而不是把文字挤成一列单字。 */
.SPR_mapEdGuideArtWrap{display:flex;flex-direction:column;align-items:center;gap:6px;flex:0 0 236px;width:236px}
.SPR_mapEdGuideArt{position:relative;display:inline-block;max-width:236px;max-height:262px;line-height:0;border:1px solid #4a4a4a;border-radius:6px;background:#1f1f1f;overflow:hidden}
/* 图按容器宽度铺满（宽高比不变）：容器宽度是**按这张图的像素比例现算**的
   （见 guideDialog 里的 boxWidth），所以小图也能放大到看得清，而网格的百分比
   仍然落在真正的格子边界上。 */
.SPR_mapEdGuideImg{display:block;width:100%;height:auto;image-rendering:pixelated}
.SPR_mapEdGuideCap{margin:0;font-size:11px;line-height:1.6;color:#9d968c;text-align:center}
/* 网格线的两层：白线＝一格，金线＝格内再分的小块。两条循环一隐一现，交替出现 ——
   「图是横平竖直一块块排出来的」这件事，靠它自己说，不用用户盯着文字想。 */
.SPR_mapEdGuideGrid,.SPR_mapEdGuideSubGrid{position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(to right,currentColor 0 1px,transparent 1px),linear-gradient(to bottom,currentColor 0 1px,transparent 1px);animation:SPR_mapEdGuidePulse 3.6s ease-in-out infinite}
.SPR_mapEdGuideGrid{color:rgba(255,255,255,.62)}
.SPR_mapEdGuideSubGrid{color:rgba(255,215,154,.85);animation-delay:1.8s}
@keyframes SPR_mapEdGuidePulse{0%{opacity:0}22%{opacity:1}58%{opacity:1}80%{opacity:0}100%{opacity:0}}
@media (prefers-reduced-motion: reduce){.SPR_mapEdGuideGrid,.SPR_mapEdGuideSubGrid{animation:none;opacity:1}}
.SPR_mapEdGuideText{flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:6px}
.SPR_mapEdGuideTitle{margin:0;font-size:13px;color:#ffd79a}
.SPR_mapEdGuideList{margin:0;padding-left:18px;font-size:12px;line-height:1.8;color:#e6e1d8}
.SPR_mapEdGuideNote{margin:0;font-size:11px;line-height:1.7;color:#c9c4bb}
.SPR_mapEdGuideNote[data-kind="warn"]{color:var(--gmm-warn, #ffc400)}
.SPR_mapEdGuideFoot{display:flex;align-items:center;gap:8px;border-top:1px solid #454545;padding-top:8px}
.SPR_mapEdGuidePage{font-size:11px;color:#9d968c;font-variant-numeric:tabular-nums}
.SPR_mapEdLayerHalf{flex:1;width:100%;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;color:#4a3416;background:transparent;border:none;border-radius:3px}
.SPR_mapEdLayerHalf:hover:not(:disabled){background:rgba(255,255,255,.28)}
.SPR_mapEdLayerHalf:disabled{opacity:.3;cursor:default}
.SPR_mapEdLayerNum{width:100%;padding:0;border:none;background:transparent;cursor:pointer;font-family:inherit;font-size:10px;line-height:1;font-weight:700;color:#4a3416;font-variant-numeric:tabular-nums}
.SPR_mapEdLayerNum:hover{background:rgba(255,255,255,.28);border-radius:3px}
/* 图层卡：一行一层（点名字就地改名，右边换顺序 / 删掉）。
   最上面一行固定是「标记层」，它不是图层数组里的成员 —— 标记有自己的位置与名字。 */
.SPR_mapEdLayerList{display:flex;flex-direction:column;gap:3px;margin:6px 0}
.SPR_mapEdLayerRow{display:flex;align-items:center;gap:5px;padding:3px 5px;border:1px solid #6b4a22;border-radius:4px;background:rgba(0,0,0,.18)}
.SPR_mapEdLayerRow[data-on="true"]{border-color:#e6bd7d;background:rgba(230,189,125,.18)}
.SPR_mapEdLayerIdx{width:15px;flex:none;text-align:center;font-size:11px;color:#c9bda8;font-variant-numeric:tabular-nums}
.SPR_mapEdLayerName{flex:1;min-width:0;text-align:left;padding:2px 4px;border:1px dashed transparent;border-radius:3px;background:transparent;color:#f3e7d3;font-family:inherit;font-size:12px;cursor:text;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SPR_mapEdLayerName:hover{border-color:#6b4a22}
.SPR_mapEdLayerNameInput{flex:1;min-width:0;padding:2px 4px;border:1px solid #e6bd7d;border-radius:3px;background:#1f1f1f;color:#f3e7d3;font-family:inherit;font-size:12px;outline:none}
.SPR_mapEdMiniBtn{padding:1px 5px;border:1px solid #6b4a22;border-radius:3px;background:rgba(0,0,0,.25);color:#e8d7bb;font-family:inherit;font-size:11px;line-height:16px;cursor:pointer}
.SPR_mapEdMiniBtn:hover:not(:disabled){background:rgba(230,189,125,.25)}
.SPR_mapEdMiniBtn:disabled{opacity:.35;cursor:default}
.SPR_mapEdMarkerRow{display:flex;align-items:center;gap:6px;padding:3px 5px;border:1px solid #6b4a22;border-radius:4px;background:rgba(0,0,0,.18)}
.SPR_mapEdMarkerRow[data-on="true"]{border-color:#e23b2b;background:rgba(226,59,43,.14)}
.SPR_mapEdMarkerDot{width:18px;height:18px;flex:none;display:flex;align-items:center;justify-content:center;border:1.5px solid #f0c040;border-radius:50%;background:#14161e;color:#fff;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}
.SPR_mapEdMarkerName{flex:1;min-width:0;padding:2px 4px;border:1px solid transparent;border-radius:3px;background:transparent;color:#f3e7d3;font-family:inherit;font-size:12px;outline:none}
.SPR_mapEdMarkerName:hover{border-color:#6b4a22}
.SPR_mapEdMarkerName:focus{border-color:#e6bd7d;background:#1f1f1f}
.SPR_mapEdMarkerAt{flex:none;font-size:11px;color:#b9b3a8;font-variant-numeric:tabular-nums}
.SPR_mapEdMarkerList{display:flex;flex-direction:column;gap:3px;max-height:216px;overflow:auto;margin-top:4px}
.SPR_mapEdStage{position:relative;flex:1;min-width:0;min-height:360px;background:#3a3a3a;overflow:hidden}
.SPR_mapEdCanvas{display:block;width:100%;height:100%;image-rendering:pixelated;touch-action:none;cursor:crosshair}
.SPR_mapEdToast{position:absolute;left:10px;bottom:10px;font-size:11px;padding:4px 10px;border-radius:999px;background:rgba(0,0,0,.62);color:#ffe9a8}
.SPR_mapEdToast[data-busy="true"]{color:var(--gmm-warn, #ffc400)}
.SPR_mapEdCardWrap{position:absolute;top:44px;right:12px;z-index:20;max-width:min(520px,92%)}
.SPR_mapEdCard{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:10px;background:#2f2f2f;border:1px solid #1c1c1c;box-shadow:0 12px 30px rgba(0,0,0,.5)}
.SPR_mapEdCardHead{display:flex;align-items:center;gap:8px}
.SPR_mapEdCardHead>h4{margin:0;font-size:13px;color:#f7f3ec}
.SPR_mapEdCardClose{font:inherit;font-size:14px;line-height:1;cursor:pointer;color:#c9c4bb;background:transparent;border:none;border-radius:6px;padding:2px 6px}
.SPR_mapEdCardClose:hover{background:#454545;color:#fff}
.SPR_mapEdCardRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.SPR_mapEdRows{display:flex;flex-direction:column;gap:6px}
.SPR_mapEdRow{display:flex;flex-direction:column;gap:3px}
.SPR_mapEdLabel{font-size:11px;color:#bfb8ae}
.SPR_mapEdRowHint{font-size:11px;line-height:1.6;color:#9d968c}
.SPR_mapEdTsList{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;max-height:220px;overflow:auto}
.SPR_mapEdTsRow{display:flex;align-items:center;gap:6px;padding:3px 4px;border:1px solid transparent;border-radius:6px}
.SPR_mapEdTsRow[data-on="true"]{border-color:#d9a95f;background:#3a2f1d}
.SPR_mapEdTsPick{flex:1;display:flex;align-items:baseline;gap:8px;min-width:0;padding:2px 4px;font:inherit;font-size:12px;color:#f2efe9;text-align:left;background:none;border:0;cursor:pointer}
.SPR_mapEdTsPick:hover{color:#ffd79a}
.SPR_mapEdTsName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SPR_mapEdTsMeta{flex:none;font-size:11px;color:#9a9a9a}
.SPR_mapEdTsBadge{flex:none;padding:0 4px;border-radius:3px;background:#4a4a4a;font-size:10px;color:#e8d7bb}
.SPR_mapEdTsBadge[data-anim="true"]{background:#2f4a2f;color:#bfe6bf}
.SPR_mapEdPair{display:flex;align-items:center;gap:6px}
.SPR_mapEdTimes{color:#9a9a9a;font-size:12px}
.SPR_mapEdValue{color:#e7dcc8;font-size:12px;font-variant-numeric:tabular-nums}
.SPR_mapEdLblSmall{font-size:11px;color:#9d968c;margin:4px 0 2px}
.SPR_mapEdPassCell{width:34px;height:26px;padding:0;border-radius:5px;border:1px solid #4a443c;background:#2a2622;color:#cfc7ba;font-size:11px;cursor:pointer}
.SPR_mapEdPassCell[data-pass="0"]{background:#3a2320;border-color:#7d3a31;color:#f0b0a6}
.SPR_mapEdPassCell[data-pass="1"]{background:#1f2f42;border-color:#3d6fa8;color:#a9d0f5}
.SPR_mapEdPassCell[data-pass="2"]{background:#1f3a2c;border-color:#3f8f63;color:#a8e6c3}
.SPR_mapEdSeg{display:flex;gap:4px;flex-wrap:wrap}
.SPR_mapEdSegBtn{font:inherit;font-size:12px;padding:4px 10px;border:1px solid #565656;border-radius:6px;background:#242424;color:#f2efe9;cursor:pointer}
.SPR_mapEdSegBtn:hover{border-color:#d9a95f}
.SPR_mapEdSegBtn[data-on="true"]{border-color:#d9a95f;background:#3a2f1d;color:#ffd79a;font-weight:600}
.SPR_mapEdSelect{font:inherit;font-size:12px;color:#f2efe9;background:#242424;border:1px solid #565656;border-radius:6px;padding:4px 8px;max-width:100%}
.SPR_mapEdChip{font:inherit;font-size:11px;line-height:16px;cursor:pointer;color:#ded8cf;background:#3b3b3b;border:1px solid #565656;border-radius:999px;padding:3px 10px;transition:var(--spr-motion)}
.SPR_mapEdChip:focus-visible,.SPR_isoTool:focus-visible,.SPR_mapEdTool:focus-visible{outline:2px solid #d9a95f;outline-offset:2px}
.SPR_mapEdChip[data-on="true"]{border-color:#d9a95f;color:#ffd89a}
.SPR_mapEdCheck{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#e6e1d8}
.SPR_mapEdHelp{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:8px;background:#383838}
.SPR_mapEdHelp>h5{margin:0;font-size:12px;color:#f7f3ec}
.SPR_mapEdHelp>p{margin:0;font-size:11px;line-height:1.7;color:#c9c4bb}
.SPR_mapEdRadios{display:flex;gap:12px;flex-wrap:wrap}
.SPR_mapEdRadio{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#e6e1d8;cursor:pointer}
.SPR_mapEdFiles{margin:0;padding-left:18px;font-size:12px;line-height:1.9;color:#c9c4bb}
.SPR_mapEdFiles li{display:flex;align-items:center;gap:6px}
.SPR_mapEdFiles a{color:var(--gmm-accent, #8ab4f8)}
.SPR_mapEdExportResult{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border:1px solid #4a4a4a;border-radius:8px;background:#383838}
.SPR_mapEdMark{color:var(--gmm-ok, #7ee08a);font-weight:700}
.SPR_mapEdWarnings{margin:0;padding-left:18px;font-size:11px;line-height:1.7;color:#d8d2c8}
.SPR_mapEdFoot{display:flex;align-items:center;gap:10px;padding:5px 10px;background:#383838;border-top:1px solid #232323;flex:none;flex-wrap:wrap}
.SPR_mapEdFoot .SPR_notice{margin:0}
.SPR_mapEdFootText{font-size:11px;color:#b9b3a8;font-variant-numeric:tabular-nums}
.SPR_mapEdEmpty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;flex:1;min-height:320px;padding:30px 20px;text-align:center;background:#424242;border-radius:var(--spr-r-lg);border:1px solid #4a4a4a}
.SPR_mapEdEmptyText{margin:0;font-size:15px;font-weight:600;color:#f7f3ec}
.SPR_mapEdEmptyRow{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}

/* ⚠️ 面板的 .SPR_module 是 display:flex;flex-direction:column，所以 .SPR_row
   作为 flex item 会被算成 display:block —— 这会把 .SPR_field-inline 的
   inline-flex 压掉，四个数字输入框就**竖着排**（实测踩过，看着像样式坏了）。
   这里显式把行声明成 flex，让行内的 field 横向排。 */
.SPR_field-inline{display:inline-flex;align-items:center;gap:6px}
.SPR_card{border:1px solid var(--gmm-line-2);background:var(--gmm-surface-3);border-radius:var(--spr-r-lg);padding:var(--spr-pad);margin-bottom:var(--spr-pad)}
.SPR_cardHead{display:flex;align-items:baseline;gap:8px;margin-bottom:6px;flex-wrap:wrap}
.SPR_cardHead h3{margin:0;font-size:13.5px;font-weight:600;line-height:20px;letter-spacing:.2px}
.SPR_hint{color:var(--gmm-text-3);font-size:12px;line-height:18px;margin:0 0 10px}
.SPR_toolbar{display:flex;gap:var(--spr-gap);align-items:center;flex-wrap:wrap;row-gap:6px;margin:10px 0;min-height:var(--spr-ctl)}
.SPR_grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:10px}
.SPR_node{border:1px solid var(--gmm-line-2);border-radius:10px;background:var(--gmm-surface);padding:10px;display:flex;flex-direction:column;gap:8px;min-width:0}
.SPR_node[data-stale=true]{border-color:color-mix(in srgb, var(--gmm-warn, #d9930d) 55%, transparent)}
.SPR_nodeTop{display:flex;align-items:center;gap:7px}
.SPR_nodeTitle{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SPR_thumb{width:100%;aspect-ratio:1/1;object-fit:contain;border-radius:8px;display:block;background-color:var(--gmm-surface-3);background-image:linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%),linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%);background-size:16px 16px;background-position:0 0,8px 8px}
.SPR_thumbEmpty{width:100%;aspect-ratio:1/1;border-radius:8px;border:1px dashed var(--gmm-line-2);display:flex;align-items:center;justify-content:center;color:var(--gmm-text-3);font-size:12px;text-align:center;padding:8px;box-sizing:border-box}
.SPR_refRow{color:var(--gmm-text-3);font-size:11px}
.SPR_error{color:var(--gmm-bad);font-size:12px;white-space:pre-wrap;word-break:break-word;margin:0}
.SPR_chip{font-size:11px;line-height:16px;padding:1px 7px;border-radius:999px;background:var(--gmm-surface-3);color:var(--gmm-text-2);white-space:nowrap;flex:none}
.SPR_chip[data-kind=ready]{background:color-mix(in srgb, var(--gmm-ok) 14%, transparent);color:var(--gmm-ok)}
.SPR_chip[data-kind=running]{background:color-mix(in srgb, var(--gmm-accent) 14%, transparent);color:var(--gmm-accent)}
.SPR_chip[data-kind=error]{background:color-mix(in srgb, var(--gmm-bad) 14%, transparent);color:var(--gmm-bad)}
.SPR_chip[data-kind=approved]{background:color-mix(in srgb, var(--gmm-ok) 22%, transparent);color:var(--gmm-ok)}
.SPR_chip[data-kind=stale]{background:color-mix(in srgb, var(--gmm-warn, #d9930d) 16%, transparent);color:var(--gmm-warn, #a06a00)}
.SPR_btn{font:inherit;font-size:12px;line-height:18px;min-height:var(--spr-ctl);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px;background:var(--gmm-surface);border:1px solid var(--gmm-line-2);border-radius:var(--spr-r-md);padding:4px 11px;color:var(--gmm-text);white-space:nowrap;transition:var(--spr-motion)}
.SPR_btn:hover:not(:disabled){background:var(--gmm-hover-solid);border-color:var(--gmm-line-1)}
.SPR_btn:active:not(:disabled){transform:translateY(.5px)}
.SPR_btn:disabled{cursor:default;opacity:.5}
.SPR_btn[data-primary=true]:hover:not(:disabled){background:color-mix(in srgb, var(--gmm-accent) 88%, #fff)}
.SPR_btn[data-primary=true]{background:var(--gmm-accent);border-color:transparent;color:var(--gmm-on-accent, #fff);font-weight:500}
.SPR_btn[data-on=true]{border-color:var(--gmm-ok);color:var(--gmm-ok)}
.SPR_btn[data-danger=true]{color:var(--gmm-bad)}
/* 标签当按钮用：包着隐藏 <input type=file> 的 label（选择本地视频）与下载链接。
   label 默认是行内元素，直接套 .SPR_btn 的对齐会跟旁边的按钮错开一行。 */
.SPR_fileBtn{display:inline-flex;align-items:center;justify-content:center;gap:4px}
.SPR_fileBtn[data-disabled=true]{cursor:default;opacity:.5}
.SPR_fileBtn[data-disabled=true] input{pointer-events:none}
.SPR_btnRow{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto}
.SPR_area{width:100%;box-sizing:border-box;min-height:96px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-size:12px;line-height:18px;color:var(--gmm-text);background:var(--gmm-surface-3, var(--gmm-surface));border:1px solid var(--gmm-line-2);border-radius:var(--spr-r-md);padding:8px 10px;transition:var(--spr-motion)}
.SPR_area:focus{outline:none;border-color:var(--gmm-accent);box-shadow:var(--spr-ring)}
.SPR_input{box-sizing:border-box;font:inherit;font-size:12px;line-height:18px;min-height:var(--spr-ctl);color:var(--gmm-text);background:var(--gmm-surface);border:1px solid var(--gmm-line-2);border-radius:var(--spr-r-md);padding:4px 9px;width:100%;transition:var(--spr-motion)}
.SPR_input:hover:not(:disabled){border-color:var(--gmm-line-1)}
.SPR_input:focus{outline:none;border-color:var(--gmm-accent);box-shadow:var(--spr-ring)}
select.SPR_input{appearance:none;-webkit-appearance:none;cursor:pointer;padding-right:28px;background-repeat:no-repeat;background-position:right 9px center;background-size:12px 12px;background-image:url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 12 12%27><path d=%27M2.5 4.5 6 8l3.5-3.5%27 fill=%27none%27 stroke=%27%238a8a94%27 stroke-width=%271.5%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/></svg>")}
select.SPR_input:hover:not(:disabled){border-color:var(--gmm-line-1)}
select.SPR_input option{background:var(--gmm-surface-2);color:var(--gmm-text)}
input[type=checkbox],input[type=radio]{accent-color:var(--gmm-accent);width:14px;height:14px;margin:0;cursor:pointer;flex:none}
.SPR_musicCheck{display:inline-flex;align-items:center;gap:7px;font-size:12px;line-height:18px;color:var(--gmm-text-2);cursor:pointer}
.SPR_musicCheck:hover{color:var(--gmm-text)}
.SPR_field{display:flex;flex-direction:column;gap:4px;min-width:0}
.SPR_fieldLabel{font-size:11px;color:var(--gmm-text-3)}
.SPR_fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:10px 0}
.SPR_note{border-radius:8px;padding:8px 11px;font-size:12px;margin:0 0 10px;border:1px solid transparent;white-space:pre-wrap}
.SPR_note[data-kind=error]{border-color:color-mix(in srgb, var(--gmm-bad) 40%, transparent);background:color-mix(in srgb, var(--gmm-bad) 8%, transparent);color:var(--gmm-bad)}
.SPR_note[data-kind=info]{border-color:color-mix(in srgb, var(--gmm-accent) 32%, transparent);background:color-mix(in srgb, var(--gmm-accent) 8%, transparent)}
.SPR_note[data-kind=ok]{border-color:color-mix(in srgb, var(--gmm-ok) 35%, transparent);background:color-mix(in srgb, var(--gmm-ok) 8%, transparent);color:var(--gmm-ok)}
.SPR_sheetWrap{border:1px solid var(--gmm-line-2);border-radius:12px;padding:10px;background-color:var(--gmm-surface);background-image:linear-gradient(45deg,rgba(128,128,128,.16) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.16) 75%),linear-gradient(45deg,rgba(128,128,128,.16) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.16) 75%);background-size:20px 20px;background-position:0 0,10px 10px;overflow:auto;max-height:70vh}
.SPR_sheet{display:block;width:100%;image-rendering:pixelated}
.SPR_log{margin-top:14px;border-top:1px solid var(--gmm-line-2);padding-top:10px}
.SPR_logList{margin:0;padding:0;list-style:none;max-height:180px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-size:11px;line-height:18px;color:var(--gmm-text-2)}
.SPR_logList li{display:flex;gap:8px;white-space:pre-wrap;word-break:break-word}
.SPR_logTime{color:var(--gmm-text-3);flex:none}
.SPR_logHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.SPR_logFilters{display:flex;align-items:center;gap:6px;margin-left:auto}
.SPR_logElapsed{color:var(--gmm-text-3);flex:none}
.SPR_logList li[data-level=error]{color:var(--gmm-bad)}
.SPR_logList li[data-level=warn]{color:var(--gmm-warn, #a06a00)}
.SPR_empty{color:var(--gmm-text-3);font-size:13px;line-height:22px;max-width:520px;margin:0 auto;padding:30px 0;text-align:center;text-wrap:pretty}
.SPR_drop{border:1px dashed var(--gmm-line-2);border-radius:10px;padding:14px;text-align:center;color:var(--gmm-text-3);font-size:12px}
.SPR_drop[data-over=true]{border-color:var(--gmm-accent);color:var(--gmm-accent)}
.SPR_rowOrder{display:flex;flex-direction:column;gap:5px;max-width:260px}
.SPR_rowOrderItem{display:flex;align-items:center;gap:6px;border:1px solid var(--gmm-line-2);border-radius:8px;padding:4px 8px;background:var(--gmm-surface)}
.SPR_rowOrderIdx{color:var(--gmm-text-3);font-size:11px;width:16px;font-variant-numeric:tabular-nums}
.SPR_rowOrderName{flex:1}
.SPR_miniBtn{font:inherit;font-size:11px;cursor:pointer;background:transparent;border:1px solid var(--gmm-line-2);border-radius:6px;padding:1px 6px;color:var(--gmm-text-2)}
.SPR_miniBtn:disabled{opacity:.4;cursor:default}
.SPR_settings{max-width:760px;display:flex;flex-direction:column;gap:var(--spr-pad)}
.SPR_settingsGroup{border:1px solid var(--gmm-line-2);border-radius:12px;padding:14px;background:var(--gmm-surface-3)}
.SPR_settingsGroup h3{margin:0 0 4px;font-size:13px;font-weight:600}
.SPR_settingsGroup p{margin:0 0 10px;color:var(--gmm-text-3);font-size:12px}
.SPR_featureList{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.SPR_featureRow{display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:10px;border:1px solid var(--gmm-line-2);background:var(--gmm-surface);cursor:pointer}
.SPR_featureRow[data-hidden=true]{opacity:.62}
.SPR_featureCheck{margin:2px 0 0;width:15px;height:15px;flex:none;accent-color:var(--gmm-accent);cursor:pointer}
.SPR_featureText{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.SPR_featureTitle{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;line-height:18px;color:var(--gmm-text)}
.SPR_featureHint{font-size:11px;line-height:16px;color:var(--gmm-text-3)}
.SPR_featureState{font-size:11px;line-height:18px;flex:none;padding:0 8px;border-radius:999px;background:var(--gmm-surface-3);color:var(--gmm-text-3)}
.SPR_keyRow{display:flex;gap:8px;align-items:flex-end}
.SPR_keyRow .SPR_field{flex:1}
.SPR_badge{font-size:11px;padding:1px 7px;border-radius:999px;background:var(--gmm-surface);color:var(--gmm-text-3)}
.SPR_videoWrap{position:relative;width:100%}
.SPR_video{width:100%;border-radius:8px;display:block;background:#000}
/* 转圈视频多半是竖屏（角色立绘比例）：按 width:100% 铺开会有上千像素高，把下面的
   时间轴与八个方向图全顶出屏幕，所以改成按高度封顶、水平居中。 */
.SPR_videoTurn{width:auto;max-width:100%;max-height:360px;margin:0 auto}
.SPR_zoomMask{position:fixed;inset:0;z-index:80;background:rgba(10,12,16,.84);display:flex;align-items:center;justify-content:center;padding:28px;box-sizing:border-box;cursor:zoom-out}
.SPR_zoomImg{max-width:92vw;max-height:82vh;object-fit:contain;image-rendering:pixelated;border-radius:8px;background-color:var(--gmm-surface);cursor:default;box-shadow:0 14px 44px rgba(0,0,0,.5)}
.SPR_zoomClose{position:absolute;top:16px;right:20px;width:36px;height:36px;border-radius:999px;border:1px solid rgba(255,255,255,.34);background:rgba(28,32,40,.86);color:#fff;font-size:20px;line-height:1;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;padding:0}
.SPR_zoomClose:hover{background:rgba(64,70,82,.96)}
.SPR_zoomCaption{position:absolute;left:20px;right:20px;bottom:16px;text-align:center;color:#e9ebf1;font-size:12px}
.SPR_input[data-dirty=true]{border-color:var(--gmm-accent)}
.SPR_modeBar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 10px}
.SPR_modeBarLabel{font-size:12px;color:var(--gmm-text-3)}
.SPR_mode{font:inherit;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:var(--gmm-surface);border:1px solid var(--gmm-line-2);border-radius:999px;padding:4px 12px;color:var(--gmm-text-2)}
.SPR_mode[data-active=true]{color:var(--gmm-text);border-color:var(--gmm-accent);box-shadow:0 0 0 1px color-mix(in srgb, var(--gmm-accent) 28%, transparent)}
.SPR_modeTag{font-size:10px;line-height:14px;padding:0 5px;border-radius:999px;background:var(--gmm-accent);color:#fff}
.SPR_modeBarHint{font-size:11px;color:var(--gmm-text-3)}
.SPR_axisWrap{margin:12px 0 4px}
.SPR_axis{position:relative;border:1px solid var(--gmm-line-2);border-radius:10px;background:var(--gmm-surface);padding:34px 0 8px;touch-action:none;user-select:none}
.SPR_axis[data-dragging=true]{cursor:ew-resize}
.SPR_axisStrip{display:block;width:100%;border-radius:6px;pointer-events:none;-webkit-user-drag:none}
.SPR_axisDot{position:absolute;transform:translateX(-50%);min-width:30px;padding:2px 6px;display:flex;flex-direction:column;align-items:center;gap:0;font:inherit;font-size:11px;line-height:14px;cursor:grab;border:1px solid var(--gmm-accent);border-radius:999px;background:var(--gmm-surface-3);color:var(--gmm-text);box-shadow:0 1px 3px rgba(0,0,0,.22)}
.SPR_axisDot:active{cursor:grabbing}
.SPR_axisDot[data-active=true]{box-shadow:0 0 0 2px color-mix(in srgb, var(--gmm-accent) 40%, transparent)}
.SPR_axisDot[data-approved=true]{border-color:var(--gmm-ok)}
.SPR_axisDot[data-approved=true] .SPR_axisDotIndex{color:var(--gmm-ok)}
.SPR_axisDotLabel{font-weight:600;white-space:nowrap}
.SPR_axisDotIndex{font-size:10px;color:var(--gmm-text-3);font-variant-numeric:tabular-nums}
.SPR_axisRuler{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;color:var(--gmm-text-3);margin-top:6px}
.SPR_axisRulerMid{text-align:center}
.SPR_pickPanel{grid-column:1 / -1;border:1px solid var(--gmm-line-2);border-radius:12px;padding:12px;background:var(--gmm-surface)}
.SPR_pickHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap}
/* 页签条是等宽网格，列数由界面按可见模块数算好（--spr-module-cols：≤4 个排一行，
   更多时均分两行，8 个就是 4+4），不会出现最后一张卡单独掉到下一行。
   面板够宽（≥1500px）时全部排成一行；很窄（<720px）时退到两列。 */
.SPR_root{container-type:inline-size;container-name:spr-root}
.SPR_modules{display:grid;grid-template-columns:repeat(var(--spr-module-cols,4),minmax(0,1fr));grid-auto-rows:minmax(0,1fr);gap:8px;padding:10px 18px 12px;border-bottom:1px solid var(--gmm-line-2);flex:none}
@container spr-root (min-width:1500px){.SPR_modules{grid-template-columns:repeat(var(--spr-module-count,8),minmax(0,1fr))}}
@container spr-root (max-width:720px){.SPR_modules{grid-template-columns:repeat(2,minmax(0,1fr))}}
.SPR_modulesHiddenNote{grid-column:1 / -1;justify-self:end;font-size:11px;color:var(--gmm-text-3);white-space:nowrap}
.SPR_module{font:inherit;cursor:pointer;text-align:left;min-width:0;display:grid;grid-template-columns:30px minmax(0,1fr);grid-template-rows:auto auto;column-gap:10px;row-gap:2px;align-items:start;padding:9px 12px 9px 10px;border-radius:10px;border:1px solid var(--gmm-line-2);background:var(--gmm-surface);color:var(--gmm-text-2);transition:background-color .12s ease,border-color .12s ease,color .12s ease}
.SPR_module:hover{background:var(--gmm-hover-solid);color:var(--gmm-text)}
.SPR_module:focus-visible{outline:2px solid var(--gmm-accent);outline-offset:2px}
.SPR_module[data-active=true]{border-color:var(--gmm-accent);background:color-mix(in srgb, var(--gmm-accent) 9%, var(--gmm-surface));color:var(--gmm-text);box-shadow:0 0 0 1px color-mix(in srgb, var(--gmm-accent) 30%, transparent)}
.SPR_module[data-active=true] .SPR_moduleIcon{color:var(--gmm-accent);background:color-mix(in srgb, var(--gmm-accent) 16%, transparent)}
.SPR_moduleTitle{font-size:13px;font-weight:600;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.SPR_moduleHint{font-size:11.5px;line-height:16px;color:var(--gmm-text-3);min-width:0;text-wrap:pretty;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.SPR_module[data-active=true] .SPR_moduleHint{color:var(--gmm-text-2)}
@media (prefers-reduced-motion: reduce){.SPR_module{transition:none}}
.SPR_emptyHero{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;min-height:min(440px,100%);padding:20px 8px 8px;box-sizing:border-box}
.SPR_emptyHeroMark{width:56px;height:56px;border-radius:16px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:4px;color:var(--gmm-accent);background:color-mix(in srgb, var(--gmm-accent) 12%, transparent);border:1px solid color-mix(in srgb, var(--gmm-accent) 26%, transparent)}
.SPR_emptyHeroTitle{margin:0;font-size:16px;font-weight:600;line-height:24px;color:var(--gmm-text)}
.SPR_emptyHeroDesc{margin:0;max-width:520px;font-size:13px;line-height:20px;color:var(--gmm-text-2);text-wrap:balance}
.SPR_emptySteps{list-style:none;margin:10px 0 6px;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;width:100%;max-width:900px;text-align:left}
.SPR_emptyStep{display:flex;flex-direction:column;gap:3px;padding:10px 12px;border-radius:10px;border:1px solid var(--gmm-line-2);background:var(--gmm-surface)}
.SPR_emptyStepTitle{font-size:12.5px;font-weight:600;line-height:18px;color:var(--gmm-text)}
.SPR_emptyStepHint{font-size:11.5px;line-height:16px;color:var(--gmm-text-3);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.SPR_emptyHero .SPR_btn{padding:7px 18px;font-size:13px}
.SPR_thumbMd{width:104px;height:104px;object-fit:contain;border-radius:8px;border:1px solid var(--gmm-line-2);flex:none;background-color:var(--gmm-surface);background-image:linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%),linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%);background-size:16px 16px;background-position:0 0,8px 8px}
.SPR_player{border:1px solid var(--gmm-line-2);border-radius:12px;background:#fff;padding:10px;display:flex;justify-content:center;overflow:auto;max-height:60vh}
.SPR_canvasPlayer{display:block;max-width:100%;image-rendering:pixelated}
.SPR_frames{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
.SPR_frame{width:64px;height:64px;object-fit:contain;border:1px solid var(--gmm-line-2);border-radius:5px;background-color:var(--gmm-surface);background-image:linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%),linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%);background-size:12px 12px;background-position:0 0,6px 6px}
.SPR_stage{position:relative;outline:none;border:1px solid var(--gmm-line-2);border-radius:12px;overflow:hidden;background:#fff;cursor:pointer;line-height:0}
.SPR_stage[data-focused=true]{border-color:var(--gmm-accent);box-shadow:0 0 0 2px color-mix(in srgb, var(--gmm-accent) 25%, transparent)}
.SPR_canvas{display:block;width:100%;height:auto;image-rendering:pixelated}
.SPR_stageHint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.74);color:#333;font-size:13px;line-height:20px;font-family:inherit}
.SPR_hud{position:absolute;left:10px;top:10px;display:flex;align-items:center;gap:8px;background:rgba(0,0,0,.62);color:#fff;border-radius:999px;padding:3px 12px;font-size:12px;line-height:18px;pointer-events:none;font-family:inherit}
.SPR_hudDir{font-weight:600;letter-spacing:.5px}

.SPR_link{color:var(--gmm-accent);font-size:12px;text-decoration:none;align-self:center}
.SPR_link:hover{text-decoration:underline}
/* 面板根必须自己是滚动容器：SPR_root 是定高 flex 列，子元素默认不滚动，
   内容一多就被裁掉（实测表现是「这一页没法下滑」）。另外两个模块靠
   SPR_main 滚动，这里因为任务选择器放在顶部工具条而不是左侧栏，
   直接让面板根承担滚动。 */
.SPR_rigPanel{display:flex;flex-direction:column;gap:14px;padding:14px 18px 24px;flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
.SPR_rigStage{border:1px solid var(--gmm-line-2);border-radius:12px;background:var(--gmm-surface-3);padding:12px}
.SPR_rigStageHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.SPR_rigStageTitle{font-size:13px;font-weight:600}
.SPR_rigStageHint{font-size:12px;color:var(--gmm-text-3);flex:1;min-width:180px}
.SPR_rigGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px;margin-top:10px}
.SPR_rigCard{border:1px solid var(--gmm-line-2);border-radius:10px;padding:8px;background:var(--gmm-surface);display:flex;flex-direction:column;gap:6px;min-width:0}
.SPR_rigCard[data-approved=true]{border-color:var(--gmm-accent)}
.SPR_rigCard[data-hidden=true]{opacity:.45}
.SPR_rigCardName{font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;justify-content:space-between}
.SPR_rigCardMeta{font-size:11px;color:var(--gmm-text-3);font-variant-numeric:tabular-nums}
.SPR_rigCardImg{width:100%;height:88px;object-fit:contain;border-radius:6px;background-color:var(--gmm-surface);background-image:linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%),linear-gradient(45deg,rgba(128,128,128,.18) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.18) 75%);background-size:14px 14px;background-position:0 0,7px 7px}
.SPR_rigCardBtns{display:flex;gap:4px;flex-wrap:wrap}
.SPR_rigCanvasWrap{position:relative;margin-top:10px;border:1px solid var(--gmm-line-2);border-radius:10px;overflow:hidden;background:#fff;line-height:0;max-width:100%}
.SPR_rigCanvasWrap img{display:block;width:100%;height:auto}
.SPR_rigCanvasWrap[data-drag=true]{cursor:grabbing}
.SPR_rigBox{position:absolute;border:1.5px solid rgba(63,111,255,.85);border-radius:3px;box-sizing:border-box;cursor:grab;background:rgba(63,111,255,.10)}
.SPR_rigBox[data-selected=true]{border-color:#ff9f2e;background:rgba(255,159,46,.18);box-shadow:0 0 0 1px rgba(255,159,46,.6)}
.SPR_asm{display:flex;flex-direction:column;gap:10px}
.SPR_asmBar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--gmm-line-2);border-radius:10px;background:var(--gmm-surface)}
.SPR_asmGroup{display:flex;align-items:center;gap:5px}
.SPR_asmHint{font-size:11px;color:var(--gmm-text-3)}
/* ── 时间轴（阶段⑥）────────────────────────────────────────────────────
   轨道条用**百分比定位**而不是 canvas：关键帧数量在几十的量级，DOM 足够，
   而且选中/拖拽/无障碍全都白拿。 */
.SPR_tlWrap{margin-top:8px;border:1px solid var(--gmm-line-2);border-radius:10px;overflow:hidden}
.SPR_tlRuler{position:relative;height:18px;background:var(--gmm-surface-2);border-bottom:1px solid var(--gmm-line-2)}
.SPR_tlTick{position:absolute;top:2px;transform:translateX(-50%);font-size:10px;color:var(--gmm-text-3);white-space:nowrap}
.SPR_tlRow{display:flex;align-items:center;gap:8px;padding:3px 8px;border-bottom:1px solid var(--gmm-line-2)}
.SPR_tlRow:last-child{border-bottom:none}
.SPR_tlName{flex:0 0 132px;display:flex;flex-direction:column;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SPR_tlKind{font-style:normal;font-size:10px;color:var(--gmm-text-3)}
.SPR_tlLane{position:relative;flex:1;min-width:0;height:20px;background:var(--gmm-surface-2);border-radius:5px;cursor:crosshair}
.SPR_tlKey{position:absolute;top:50%;width:11px;height:11px;margin:-6px 0 0 -6px;padding:0;border-radius:2px;transform:rotate(45deg);
  border:1px solid var(--gmm-line-3, rgba(0,0,0,.3));background:var(--gmm-surface);cursor:grab}
.SPR_tlKey[data-first=true]{border-radius:50%;transform:none;background:var(--gmm-text-3)}
.SPR_tlKey[data-selected=true]{background:#3b82f6;border-color:#1d4ed8;z-index:1}
.SPR_tlEdit{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-top:8px;padding:8px 10px;border:1px solid var(--gmm-line-2);border-radius:10px;background:var(--gmm-surface)}
.SPR_qaList{margin:8px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:6px}
.SPR_qaList li{font-size:12px;line-height:1.5}
.SPR_qaList li[data-level=error]{color:var(--gmm-bad, #b91c1c)}
.SPR_qaList li[data-level=warning]{color:var(--gmm-warn, #b45309)}
.SPR_qaMsg{display:block}
.SPR_qaFix{display:block;margin-top:2px;opacity:.85}
.SPR_asmBody{display:flex;gap:12px;align-items:flex-start}
/* 高度必须**固定**：早先用 max-height 让它被内容撑着，结果一缩放面板就跟着长高
   （100% 时 605px、176% 时 681px），画面会抽动，光标锚点也算不准。
   固定 70vh 之后它才是一个真正的「视口」。 */
.SPR_asmStage{flex:1;min-width:0;height:70vh;overflow:auto;border:1px solid var(--gmm-line-2);border-radius:10px;background:#fff;padding:8px;display:flex;align-items:flex-start}
.SPR_asmStage[data-pan=true]{cursor:grab}
.SPR_asmStage[data-panning=true]{cursor:grabbing}
/* 画布用 margin:auto 居中，而不是靠父级 justify-content:center——
   后者在「内容比容器宽」时会裁掉左侧且滚不到（flexbox 的经典问题），
   一放大就出现「左边那块够不着」。 */
.SPR_asmCanvas{position:relative;flex:none;margin:auto;background:#fff;background-image:linear-gradient(45deg,rgba(128,128,128,.12) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.12) 75%),linear-gradient(45deg,rgba(128,128,128,.12) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.12) 75%);background-size:20px 20px;background-position:0 0,10px 10px;user-select:none}
.SPR_asmRef{position:absolute;left:0;top:0;width:100%;height:100%;opacity:.3;pointer-events:none;object-fit:fill}
.SPR_asmLayer{position:absolute;transform-origin:center center;pointer-events:none;image-rendering:auto}
.SPR_asmGuide{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,159,46,.9);pointer-events:none}
.SPR_asmHandle{position:absolute;width:9px;height:9px;margin:-5px 0 0 -5px;border:1.5px solid #ff9f2e;background:#fff;border-radius:2px;cursor:pointer}
.SPR_asmHandle[data-handle=nw],.SPR_asmHandle[data-handle=se]{cursor:nwse-resize}
.SPR_asmHandle[data-handle=ne],.SPR_asmHandle[data-handle=sw]{cursor:nesw-resize}
.SPR_asmHandle[data-handle=n],.SPR_asmHandle[data-handle=s]{cursor:ns-resize}
.SPR_asmHandle[data-handle=e],.SPR_asmHandle[data-handle=w]{cursor:ew-resize}
.SPR_asmSide{width:292px;flex:none;display:flex;flex-direction:column;gap:10px;max-height:70vh;overflow:auto}
.SPR_asmPalette{display:flex;flex-wrap:wrap;gap:6px;min-height:36px;padding:6px;border:1px dashed var(--gmm-line-2);border-radius:8px;background:var(--gmm-surface)}
.SPR_asmChip{display:flex;flex-direction:column;align-items:center;gap:2px;width:62px;padding:4px;border:1px solid var(--gmm-line-2);border-radius:8px;background:var(--gmm-surface-3);cursor:grab;font-size:10px;line-height:12px;text-align:center;overflow:hidden}
.SPR_asmChip img{width:52px;height:52px;object-fit:contain;pointer-events:none}
.SPR_asmChip span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SPR_asmPanel{border:1px solid var(--gmm-line-2);border-radius:10px;padding:10px;background:var(--gmm-surface);display:flex;flex-direction:column;gap:8px}
.SPR_asmFields{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.SPR_asmFields .SPR_field{max-width:none}
.SPR_asmRow{display:flex;gap:6px;flex-wrap:wrap}
.SPR_asmLayers{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px;max-height:220px;overflow:auto}
.SPR_asmLayers li{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:6px;border:1px solid var(--gmm-line-2);background:var(--gmm-surface-3);font-size:11px;cursor:pointer}
.SPR_asmLayers li[data-active=true]{border-color:var(--gmm-accent);background:var(--gmm-surface)}
.SPR_asmLayerBtns{margin-left:auto;display:flex;gap:3px}
.SPR_rigBoxLabel{position:absolute;left:0;top:-15px;font-size:10px;line-height:14px;padding:0 4px;border-radius:4px;background:rgba(20,22,30,.72);color:#fff;white-space:nowrap;pointer-events:none;font-family:inherit}
.SPR_rigPreview{width:100%;height:620px;border:1px solid var(--gmm-line-2);border-radius:10px;background:#12121c;margin-top:10px}
.SPR_rigEditorRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
.SPR_rigEditorRow .SPR_field{max-width:104px}
.SPR_rigAtlasWrap{margin-top:10px;border:1px solid var(--gmm-line-2);border-radius:10px;overflow:auto;max-height:52vh;background-color:var(--gmm-surface);background-image:linear-gradient(45deg,rgba(128,128,128,.14) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.14) 75%),linear-gradient(45deg,rgba(128,128,128,.14) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.14) 75%);background-size:20px 20px;background-position:0 0,10px 10px}
.SPR_rigAtlasWrap img{display:block;max-width:100%;height:auto}

/* ── 调用接口时的视觉反馈 ───────────────────────────────────────────────
   所有会「出素材」的远程调用（生图 / 生视频 / 抽帧 / 抠像 / 合成 / 上传）
   都必须让人一眼看见「正在跑」。分两层：
     1. LoadingOverlay —— 盖在预览图（缩略图 / 视频 / 整图 / 播放器）上的遮罩；
     2. BusyBadge/SPR_btn[data-busy] —— 按钮与工具栏级别的轻量反馈。 */
.SPR_ovl{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;background:rgba(16,18,22,.58);border-radius:8px;color:#fff;font-size:12px;line-height:16px;text-align:center;padding:8px;box-sizing:border-box;z-index:2;font-family:inherit;pointer-events:auto;backdrop-filter:blur(1px)}
.SPR_ovlText{max-width:100%;word-break:break-word;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.SPR_ovlSub{font-size:10px;opacity:.78;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.SPR_progressTrack{height:4px;border-radius:999px;background:color-mix(in srgb, currentColor 14%, transparent);overflow:hidden}
.SPR_progressFill{height:100%;border-radius:999px;background:var(--gmm-accent,#4a7dff);transition:width .25s ease}
.SPR_spin{width:26px;height:26px;flex:none;border-radius:50%;border:2.5px solid rgba(255,255,255,.26);border-top-color:#fff;animation:SPR_spin .8s linear infinite}
.SPR_spinSm{width:13px;height:13px;flex:none;border-radius:50%;border:2px solid color-mix(in srgb, currentColor 30%, transparent);border-top-color:currentColor;animation:SPR_spin .8s linear infinite}
@keyframes SPR_spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.SPR_spin,.SPR_spinSm{animation-duration:2.4s}}
@media (prefers-reduced-motion: reduce){.SPR_btn,.SPR_input,.SPR_area,.SPR_mapEdChip{transition:none}}
.SPR_thumbBox{position:relative}
.SPR_btn[data-busy=true]{display:inline-flex;align-items:center;gap:6px;cursor:progress}
.SPR_busyBadge{display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:16px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb, var(--gmm-accent) 14%, transparent);color:var(--gmm-accent);white-space:nowrap;flex:none}
.SPR_busyBadge .SPR_spinSm{border-color:color-mix(in srgb, currentColor 26%, transparent);border-top-color:currentColor}
.SPR_drop[data-busy=true]{border-color:var(--gmm-accent);color:var(--gmm-accent)}

/* ── 实验性标记：模块④「骨骼动画生成」───────────────────────────────────
   三处共用同一种观感：页签角标、进入时的说明弹窗、模块内常驻提示条。
   角标只在 MODULES 里带 experimental 的模块上出现。 */
.SPR_expTag{font-size:10px;line-height:15px;padding:0 6px;border-radius:999px;white-space:nowrap;flex:none;background:color-mix(in srgb, var(--gmm-warn, #d9930d) 16%, transparent);border:1px solid color-mix(in srgb, var(--gmm-warn, #d9930d) 45%, transparent);color:var(--gmm-warn, #a06a00)}
.SPR_expBar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;line-height:18px;padding:7px 11px;border-radius:8px;border:1px solid color-mix(in srgb, var(--gmm-warn, #d9930d) 35%, transparent);background:color-mix(in srgb, var(--gmm-warn, #d9930d) 8%, transparent);color:var(--gmm-text-2)}
.SPR_expBar .SPR_link{font-size:12px;align-self:auto}
.SPR_gateMask{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(8,10,14,.52);backdrop-filter:blur(2px)}
.SPR_gate{width:min(560px,100%);max-height:80vh;overflow:auto;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:18px 20px;border-radius:14px;border:1px solid var(--gmm-line-2);background:var(--gmm-surface);box-shadow:0 18px 48px rgba(0,0,0,.32)}
.SPR_gateHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.SPR_gateTitle{font-size:15px;font-weight:600}
.SPR_gateBody{margin:0;font-size:13px;line-height:20px;color:var(--gmm-text-2)}
.SPR_gateFoot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:2px}
.SPR_gateMute{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--gmm-text-3);cursor:pointer;margin-right:auto}
.SPR_gate a.SPR_btn{text-decoration:none;display:inline-flex;align-items:center}
.SPR_gate .SPR_link{align-self:flex-start}

/* ── 侧栏入口上的菜单按钮 ───────────────────────────────────────────────
   宿主把这一坨渲染在它自己的 <button class=…panelRow> 里面，所以：
   · 图标本体保持原尺寸，右下角叠一个 14px 的折角触发器（命中区靠 padding 撑）；
   · 菜单用 position:fixed —— 祖先里有 overflow:hidden 的容器，
     absolute 定位在某些窗口布局下会被裁掉。 */
.SPR_railGlyph{position:relative;display:inline-flex;align-items:center;justify-content:center}
.SPR_railMenuBtn{position:absolute;right:-9px;bottom:-7px;width:14px;height:14px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;cursor:pointer;color:var(--gmm-text-2);background:var(--gmm-surface);border:1px solid var(--gmm-line-3);box-shadow:0 1px 3px rgba(0,0,0,.18)}
.SPR_railMenuBtn:hover{background:var(--gmm-hover-solid);color:var(--gmm-text)}
.SPR_railMenuBtn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--gmm-accent));outline-offset:1px}
.SPR_railMenu{position:fixed;z-index:70;width:264px;max-height:min(70vh,420px);overflow:auto;box-sizing:border-box;display:flex;flex-direction:column;gap:2px;padding:8px;border-radius:12px;border:1px solid var(--gmm-line-2);background:var(--gmm-surface);box-shadow:0 16px 40px rgba(0,0,0,.28);font-size:13px;line-height:20px;color:var(--gmm-text)}
.SPR_railMenuHead{font-size:11px;color:var(--gmm-text-3);padding:2px 8px 6px}
.SPR_railMenuEmpty{margin:0;padding:2px 8px 6px;font-size:12px;color:var(--gmm-text-3)}
.SPR_railMenuItem{font:inherit;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:1px;padding:6px 8px;border-radius:8px;border:none;background:transparent;color:inherit}
.SPR_railMenuItem:hover{background:var(--gmm-hover)}
.SPR_railMenuItem:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--gmm-accent));outline-offset:-2px}
.SPR_railMenuItemTitle{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600}
.SPR_railMenuItemHint{font-size:11px;line-height:16px;color:var(--gmm-text-3)}
.SPR_railMenuFoot{margin-top:4px;padding:6px 8px 2px;border-top:1px solid var(--gmm-line-2);font-size:11px;line-height:16px;color:var(--gmm-text-3)}

.SPR_musicBody{align-items:stretch}
.SPR_musicCard{display:flex;flex-direction:column;gap:10px;padding:var(--spr-pad);margin-bottom:12px;border:1px solid var(--gmm-line-2);border-radius:var(--spr-r-lg);background:var(--gmm-surface)}
.SPR_musicCard h3{margin:0;font-size:14px;font-weight:600}
.SPR_musicJobHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.SPR_musicMeta{font-size:11px;line-height:16px;color:var(--gmm-text-3);font-variant-numeric:tabular-nums}
.SPR_musicTabs{display:flex;gap:6px;flex-wrap:wrap}
.SPR_musicText{width:100%;box-sizing:border-box;resize:vertical;font:inherit;line-height:19px}
.SPR_musicGrid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.SPR_musicCheck{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--gmm-text-2);cursor:pointer}
.SPR_musicSource{display:flex;flex-direction:column;gap:5px;padding:10px;border:1px solid var(--gmm-line-1);border-radius:9px;background:var(--gmm-surface-3)}
.SPR_musicSourceText{margin:0;max-height:180px;overflow:auto;white-space:pre-wrap;font:inherit;font-size:12px;line-height:18px;color:var(--gmm-text-2)}
.SPR_musicSongs{display:flex;flex-direction:column;gap:9px}
.SPR_musicSong{display:flex;gap:10px;padding:9px;border:1px solid var(--gmm-line-2);border-radius:10px;background:var(--gmm-surface-3)}
.SPR_musicSong[data-active=true]{border-color:var(--gmm-accent);box-shadow:0 0 0 1px color-mix(in srgb, var(--gmm-accent) 28%, transparent)}
.SPR_musicCover{width:64px;height:64px;flex:none;border-radius:8px;overflow:hidden;background:var(--gmm-surface);display:flex;align-items:center;justify-content:center;color:var(--gmm-text-3)}
.SPR_musicCover img{width:100%;height:100%;object-fit:cover}
.SPR_musicCoverPh{font-size:26px;opacity:.6}
.SPR_musicSongBody{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.SPR_musicSongHead{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.SPR_musicAudio{width:100%;height:34px}
.SPR_musicWave{position:relative;display:flex;flex-direction:column;gap:3px;padding:8px;border:1px solid var(--gmm-line-2);border-radius:9px;background:var(--gmm-surface-3);overflow:hidden}
.SPR_musicBars{display:flex;align-items:flex-end;gap:1px;height:54px}
.SPR_musicBar{flex:1;min-width:1px;background:color-mix(in srgb, var(--gmm-accent) 55%, transparent);border-radius:1px 1px 0 0}
.SPR_musicWaveEmpty{font-size:11px;color:var(--gmm-text-3);align-self:center;margin:auto}
.SPR_musicSel{position:absolute;top:0;bottom:0;background:color-mix(in srgb, var(--gmm-accent) 18%, transparent);border-left:2px solid var(--gmm-accent);border-right:2px solid var(--gmm-accent);pointer-events:none}
.SPR_musicVersions{display:flex;flex-direction:column;gap:8px}
.SPR_musicVersion{display:flex;flex-direction:column;gap:5px;padding:9px;border:1px solid var(--gmm-line-2);border-radius:9px;background:var(--gmm-surface-3)}
.SPR_musicTool{display:flex;flex-direction:column;gap:5px;padding:8px 0;border-bottom:1px dashed var(--gmm-line-2)}
.SPR_musicLog{margin-top:4px;font-size:11px;color:var(--gmm-text-3)}
.SPR_musicLog summary{cursor:pointer}
.SPR_musicLog ul{margin:6px 0 0;padding-left:16px;display:flex;flex-direction:column;gap:3px}
.SPR_musicGuide{max-height:420px;overflow:auto;padding:10px;border:1px solid var(--gmm-line-2);border-radius:9px;background:var(--gmm-surface-3)}
.SPR_musicGuideText{margin:0;white-space:pre-wrap;font:inherit;font-size:12px;line-height:18px;color:var(--gmm-text-2)}
.SPR_musicLyrics{margin-top:2px;font-size:12px;color:var(--gmm-text-2)}
.SPR_musicLyrics summary{cursor:pointer}
.SPR_musicLyrics pre{margin:5px 0 0;max-height:180px;overflow:auto;white-space:pre-wrap;font:inherit;font-size:12px;line-height:18px;color:var(--gmm-text-2)}
.SPR_scorePlan{display:flex;flex-direction:column;gap:7px;padding:10px;border:1px solid var(--gmm-line-1);border-radius:9px;background:var(--gmm-surface-3)}
.SPR_scoreStructure{display:flex;flex-wrap:wrap;gap:5px}
.SPR_chip{display:inline-flex;align-items:center;padding:2px 7px;border:1px solid var(--gmm-line-2);border-radius:999px;font-size:11px;line-height:16px;color:var(--gmm-text-2);background:var(--gmm-surface)}
.SPR_scoreScript{margin-top:2px;font-size:12px;color:var(--gmm-text-2)}
.SPR_scoreScript summary{cursor:pointer}
.SPR_scoreScript pre{margin:5px 0 0;max-height:260px;overflow:auto;white-space:pre-wrap;font:inherit;font-size:12px;line-height:18px;color:var(--gmm-text-2)}
@media (max-width:720px){.SPR_musicGrid2{grid-template-columns:1fr}}
.SPR_isoRoot{display:flex;flex-direction:column;flex:1;min-height:0;border-radius:12px;overflow:hidden;background:#424242;color:#f2efe9;border:1px solid var(--gmm-line-2)}
.SPR_isoTop{display:flex;align-items:center;gap:8px;padding:6px 10px;background:#383838;border-bottom:1px solid #232323;flex:none}
.SPR_isoProjWrap{position:relative;min-width:0}
.SPR_isoProj{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;font-weight:600;max-width:280px;cursor:pointer;color:#f7f3ec;background:transparent;border:1px solid transparent;border-radius:8px;padding:4px 8px}
.SPR_isoProj:hover{background:#4a4a4a}
.SPR_isoProjName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SPR_isoMenu{position:absolute;top:calc(100% + 4px);left:0;z-index:30;min-width:200px;max-height:60vh;overflow:auto;display:flex;flex-direction:column;padding:4px;background:#2f2f2f;border:1px solid #1c1c1c;border-radius:10px;box-shadow:0 10px 26px rgba(0,0,0,.45)}
.SPR_isoMenuItem{font:inherit;font-size:12px;text-align:left;cursor:pointer;color:#ece7df;background:transparent;border:none;border-radius:6px;padding:6px 9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SPR_isoMenuItem:hover{background:#454545}
.SPR_isoMenuItem[data-on="true"]{background:#4d4d4d;color:#8ab4f8}
.SPR_isoMenuLabel{font-size:10px;color:#9d968c;padding:8px 9px 2px}
.SPR_isoBody{display:flex;flex:1;min-height:0}
.SPR_isoSide{width:28.5%;min-width:240px;max-width:340px;flex:none;display:flex;flex-direction:column;gap:6px;padding:8px;box-sizing:border-box;background:#3b3b3b;border-right:1px solid #232323;min-height:0}
.SPR_isoSideTitle{font-size:11px;color:#a9a29a;padding-left:2px}
.SPR_isoPalette{flex:1;min-height:120px;overflow:auto;background:#2d2d2d;border:1px solid #232323;border-radius:6px;padding:4px}
.SPR_isoPaletteGrid{display:grid;grid-template-columns:repeat(6,1fr);gap:4px}
.SPR_isoTile{aspect-ratio:1/1.2;padding:0;border:1px solid #262626;border-radius:4px;background-color:#1f1f1f;background-repeat:no-repeat;cursor:pointer}
.SPR_isoTile:hover{border-color:#d9a95f}
.SPR_isoTile[data-on="true"]{outline:2px solid #e23b2b;outline-offset:-2px;border-color:#e23b2b}
.SPR_isoTools{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;flex:none}
.SPR_isoTool{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;color:#3a2a12;background:linear-gradient(#e6bd7d,#c9974f);border:1px solid #6b4a22;border-radius:4px}
.SPR_isoTool:hover{background:linear-gradient(#f2d29a,#d6a761)}
.SPR_isoTool[data-on="true"]{background:linear-gradient(#fbe3ad,#e0b268);box-shadow:inset 0 0 0 2px #d23b2c}
.SPR_isoTool:disabled{opacity:.4;cursor:default}
.SPR_isoLayerBtn{flex-direction:column;gap:0;padding:1px;font:inherit;font-size:11px;line-height:1.1}
.SPR_isoLayerBtn small{font-size:8px;font-weight:400}
.SPR_isoStage{position:relative;flex:1;min-width:0;min-height:360px;background:#3a3a3a;overflow:hidden}
.SPR_isoCanvas{display:block;width:100%;height:100%;image-rendering:pixelated;touch-action:none;cursor:crosshair}
.SPR_isoEmpty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;flex:1;min-height:320px;padding:30px 20px;text-align:center;background:#424242;border-radius:var(--spr-r-lg);border:1px solid #4a4a4a}
.SPR_isoEmptyTitle{margin:0;font-size:15px;font-weight:600}
.SPR_isoHint{margin:0;font-size:11px;line-height:1.7;color:#c9c4bb}
.SPR_isoWarn{margin:0;font-size:11px;line-height:1.7;color:#ffc400}
.SPR_isoRow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.SPR_isoCardWrap{position:absolute;right:18px;top:58px;z-index:40;max-height:calc(100vh - 120px);overflow:auto}
.SPR_isoCard{width:340px;max-width:calc(100vw - 48px);box-sizing:border-box;padding:12px;background:#2f2f2f;border:1px solid #6b4a22;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:8px}
.SPR_isoCardHead{display:flex;align-items:center;gap:8px;font-size:13px;color:#ffd79a}
.SPR_isoClose{width:24px;height:24px;padding:0;border:none;border-radius:4px;background:transparent;color:#c9bda8;font-size:18px;line-height:1;cursor:pointer}
.SPR_isoClose:hover{background:#4a4a4a;color:#fff}
.SPR_isoDlgMask{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.42)}
.SPR_isoDlg{width:380px;max-width:calc(100vw - 32px);max-height:calc(100vh - 96px);overflow:auto;padding:12px;box-sizing:border-box;background:#2f2f2f;border:1px solid #6b4a22;border-radius:8px;color:#f3e7d3;display:flex;flex-direction:column;gap:8px}
.SPR_isoDlg textarea.SPR_isoInput{min-height:120px;height:120px;flex:0 0 auto;resize:vertical}
.SPR_isoDlgHead{display:flex;align-items:center;gap:8px}
.SPR_isoLabel{display:block;font-size:11px;color:#c9bda8;margin-top:4px}
.SPR_isoInput{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #6b4a22;border-radius:4px;background:#1f1f1f;color:#f3e7d3;font:inherit;font-size:12px;outline:none}
.SPR_isoInput:focus{border-color:#d9a95f}
.SPR_isoCheck{display:flex;align-items:center;gap:6px;font-size:12px;color:#e6e1d8}
.SPR_isoPreview{max-width:100%;max-height:160px;object-fit:contain;background:#1b1b1b;border:1px solid #4a443c;border-radius:6px}
.SPR_isoPreviewWrap{display:flex;flex-direction:column;gap:4px;align-items:center;min-width:0;width:100%}
.SPR_isoPreviewStage{position:relative;width:100%;height:230px;box-sizing:border-box;line-height:0;background-color:#1b1b1b;background-image:linear-gradient(45deg,#242424 25%,transparent 25%,transparent 75%,#242424 75%),linear-gradient(45deg,#242424 25%,transparent 25%,transparent 75%,#242424 75%);background-size:16px 16px;background-position:0 0,8px 8px;border:1px solid #4a443c;border-radius:6px;overflow:hidden;touch-action:none;user-select:none;cursor:default}
.SPR_isoPreviewStage[data-draggable="true"]{cursor:grab}
.SPR_isoPreviewStage[data-dragging="true"]{cursor:grabbing}
.SPR_isoPreviewSizer{position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none}
.SPR_isoPreviewSvg{display:block;width:100%;height:100%}
.SPR_isoPreviewCell{fill:rgba(120,180,255,.10);stroke:rgba(160,215,255,.9);stroke-width:1.5;vector-effect:non-scaling-stroke}
.SPR_isoPreviewBase circle{fill:rgba(255,200,120,.22);stroke:#ffc878;stroke-width:1.5;vector-effect:non-scaling-stroke}
.SPR_isoPreviewBase line{stroke:#ffc878;stroke-width:1.5;vector-effect:non-scaling-stroke}
.SPR_isoRange{flex:1;min-width:0;accent-color:#e6bd7d;cursor:pointer}
.SPR_isoPreviewSizeRow{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:0 1px}
.SPR_isoPreviewSizeLabel{flex:none;font-size:11px;color:#c9bda8}
.SPR_isoScaleValue{width:44px;flex:none;text-align:right;font-size:11px;color:#ffd79a;font-variant-numeric:tabular-nums}
.SPR_isoPreviewHintRow{display:flex;gap:6px;align-items:center;width:100%;justify-content:space-between}
.SPR_isoPreviewHint{font-size:10px;line-height:1.5;color:#b9b3a8;flex:1;min-width:0}
.SPR_isoAssetList{display:flex;flex-direction:column;gap:4px;max-height:420px;overflow:auto}
.SPR_isoAssetRow{display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid #4a443c;border-radius:6px;background:rgba(0,0,0,.18)}
.SPR_isoAssetName{flex:none;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:transparent;border:none;color:#ffd79a;font:inherit;font-size:12px;cursor:pointer}
.SPR_isoAssetMeta{flex:1;min-width:0;font-size:10px;color:#b9b3a8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SPR_isoBadge{font-size:10px;padding:0 5px;border-radius:999px;border:1px solid #6b4a22;color:#c9bda8}
.SPR_isoMini{padding:1px 6px;border:1px solid #6b4a22;border-radius:4px;background:rgba(0,0,0,.25);color:#e8d7bb;font:inherit;font-size:11px;line-height:18px;cursor:pointer}
.SPR_isoMini:hover:not(:disabled){background:rgba(230,189,125,.25)}
.SPR_isoMini:disabled{opacity:.35;cursor:default}
.SPR_isoLayerRow{display:flex;align-items:center;gap:4px;padding:3px 5px;border:1px solid #6b4a22;border-radius:4px;background:rgba(0,0,0,.18)}
.SPR_isoLayerRow[data-on="true"]{border-color:#e6bd7d;background:rgba(230,189,125,.18)}
.SPR_isoLayerIdx{width:15px;flex:none;text-align:center;font-size:11px;color:#c9bda8}
.SPR_isoLayerName{flex:1;min-width:0;text-align:left;background:transparent;border:1px dashed transparent;border-radius:3px;color:#f3e7d3;font:inherit;font-size:12px;cursor:text;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 4px}
.SPR_isoLayerName:hover{border-color:#6b4a22}
.SPR_isoMarkerRow{display:flex;align-items:center;gap:5px;padding:3px 5px;border:1px solid #6b4a22;border-radius:4px;background:rgba(0,0,0,.18)}
.SPR_isoMarkerDot{width:18px;height:18px;flex:none;display:flex;align-items:center;justify-content:center;border:1.5px solid #f0c040;border-radius:50%;background:#14161e;color:#fff;font-size:11px;font-weight:700}
.SPR_isoMarkerName{flex:1;min-width:0;text-align:left;background:transparent;border:none;color:#f3e7d3;font:inherit;font-size:12px;cursor:text;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SPR_isoFile{display:block;font-size:11px;color:#8ab4f8;word-break:break-all}
.SPR_isoGuide{width:420px}

`;

/** 拼接顺序有意义：历史样式在前，新基线在后（同特异性后者胜）。 */
export const CSS = CSS_TOKENS + CSS_LEGACY + CSS_SHELL + CSS_COMPONENTS + CSS_SPRITE + CSS_MODULES + CSS_SETTINGS;
