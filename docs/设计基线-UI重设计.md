# 设计基线 · 整体 UI 重设计（v2「暖纸面 · 墨绿」）

> 来源：`游戏素材大师 · 整体 UI 重设计.pdf`（1440×960 单屏，文字已转曲；设计稿文件名早于插件改名为
> 「墨盒」/ Inkbox，保持原样不重命名）。
> 数值不是目测：PDF 里 112 个填充路径的坐标 / 色值 / 圆角是逐条解出来的（脚本见本次提交的
> `.tmp-design/render.mjs`，它把页面光栅成图并 dump 几何），下面的表就是那批实测值。

## 1. 令牌（唯一真源：`src/client/css/tokens.ts`）

| 令牌 | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--gmm-bg` | `#f7f5f0` | `#161815` | 页面底 |
| `--gmm-bg-side` | `#efede7` | `#1b1d19` | 左侧栏底 |
| `--gmm-bg-top` | `#fbfaf7` | `#1d1f1b` | 顶栏底 |
| `--gmm-surface` | `#ffffff` | `#212420` | 卡片 / 面板 |
| `--gmm-surface-2 / -3` | `#faf9f6` / `#f0eee9` | `#1c1f1b` / `#292c27` | 内凹 / 轨道底 |
| `--gmm-line-1 / -2 / -3` | `#deded6` / `#e3e3db` / `#cfd3c8` | `#34382f` / `#2e322c` / `#41463c` | 描边 |
| `--gmm-text` | `#202724` | `#ecebe4` | 标题 |
| `--gmm-text-2` | `#4b514d` | `#c2c6bb` | 正文 |
| `--gmm-text-3` | `#7d837e` | `#90958c` | 次要 |
| `--gmm-text-4` | `#929792` | `#767b73` | 弱 / 注脚 |
| `--gmm-accent` | `#2f6f68` | `#6fbfb2` | 主色（按钮底 / 选中） |
| `--gmm-accent-hover` | `#275f59` | `#8ad2c5` | 主色按下 |
| `--gmm-accent-soft` | `#dce9e5` | `#243530` | 选中项底（导航） |
| `--gmm-accent-tint` | `#e7f0ed` | `#1f2c28` | 选中项底（步骤条） |
| `--gmm-accent-line` | `#bfdcd5` | `#35564c` | 主色描边 |
| `--gmm-on-accent` | `#ffffff` | `#0e1412` | 主色上的字 |
| `--gmm-ok / warn / bad` | `#2e6b4f` / `#8a6314` / `#a83c30` | `#6fbf8f` / `#d9a85a` / `#e58377` | 状态 |

尺寸：卡片圆角 12、小卡 / 拖拽区 10、按钮 / 输入 / 分段 8、小控件 6；控件高 32（紧凑 28）；
侧栏 232、顶栏 64；主列 = 主卡 + 右列 298，间距 16。

字号：页标题 28/36 · 卡片标题 17/24 · 区块 15/22 · 正文 12/18 · 次要 11/17 · 注脚 10/15。

## 2. 结构（`src/client/css/shell.ts` + `studio-panel.ts`）

```
.SPR_root                        （--gmm-* 令牌挂在这里）
└ .SPR_app
  ├ aside.SPR_sidebar           232 宽：品牌（38 图标 + 标题 + 副标）/ 新建项目 / 创作工具导航 / 当前项目卡（details 弹层放项目列表）
  └ .SPR_mainCol
    ├ header.SPR_topbar         64 高：面包屑（工作台 / 模块名）+ 本地处理状态（「设置」按钮已按用户要求移除）
    └ .SPR_scroll               唯一滚动容器（22/24/36）
      ├ .SPR_pageHead           h1 28 + 一句说明 + 右上模块级操作
      ├ .SPR_stepBar            步骤条整卡（编号圆 28 + 标题，选中 = 浅绿胶囊）
      └ .SPR_cols               主卡 + 右列（≤1180px 自动单列）
        ├ .SPR_col > .SPR_panel（标题 17 + 副标 + 右上状态胶囊 + 正文 + 底栏）
        └ .SPR_col > .SPR_railCard（本步设置 / 产出预览）
```

## 3. 主题切换（`src/client/platform/theme.ts`）

插件不再直接吃宿主的 `--dsw-alias-*` 令牌（历史样式在迁移时已把 341 处引用换成 `--gmm-*`）。
宿主明暗由探测器读出来写到 `<html data-gmm-theme="dark|light">`：

- 探针元素背景取 `--dsw-alias-bg-layer-1`（宿主换肤它必变），读回 computed rgb 判亮度；
- 拿不到就退 body / html 背景色，再退 `prefers-color-scheme`；
- 监听从 `matchMedia` + `<html>/<body>` 属性 + `<head>` 子节点（宿主换主题是换 `<style>`）；
- 属性挂 `<html>` 而不是面板根节点：面板 Hook 槽位被 `verify-feedback` 逐槽喂桩，不该为换肤加 Hook；设置页也能跟着换。

## 4. 视觉验收脚手架（不参与插件运行）

两条路，**以第二条为准**：

1. `node scripts/preview-ui.mjs` —— 静态脚手架：esbuild 打包真实样式表 + 手写的「新版外壳 DOM」，
   生成 `.preview/ui-preview.html` / `-dark.html`。快，但**不跑 React**，只适合调外壳与令牌。
2. `node .preview/real-panel.mjs light out.png`（`dark` 同理）—— **真实渲染**：
   借用 `verify-feedback.mjs` 的假 React / 假 DOM / Hook 槽位，把 `lib/client.js` 里的面板真跑一遍，
   序列化成 HTML 再截图。它连阶段①正文、右列设置、提示词自动保存都一起渲染，并带交互断言
   （改候选帧数 → `saveSettings`、点换向 → `resetTurnPicks`、提示词失焦 → `savePrompts`）。
   产物：`.preview/real-light.png` / `real-dark.png`。

> DSH web 需要启动令牌（`dsh web` 打印的 URL），脚本拿不到，所以**最终真机验收仍需人工刷新页面**。
> 上面两条是给「改完立即看像素」用的。

## 5. 七个非八方向模块在外壳里的处理（`css/modules.ts`）

外壳只提供「唯一滚动容器 `.SPR_scroll` + 页头 + 卡片」，7 个模块按各自形态接：

| 模块 | 容器处理 |
|---|---|
| ②图片 / ③序列帧 / ⑦音乐 / ⑧音效 | 根加 `.SPR_pageBody`：左侧任务列固定 204、主列 `.SPR_main{overflow:visible;padding:0}`，滚动交给外层 |
| ④骨骼 | 根 `.SPR_pagePane`，覆盖历史 `.SPR_rigPanel` 的 flex/overflow/padding |
| ⑤45° / ⑥俯视地图 | 根 `.SPR_moduleBody.SPR_fill`：靠 `.SPR_scroll>.SPR_fill{flex:1 1 auto;min-height:0}` 吃掉剩余高度，编辑器画布撑满 |
| ⑤⑥ 深色编辑器皮肤 | 新增 `--gmm-ed-*` 变量：浅色主题由 `--gmm-text/--gmm-bg` 混出深炭灰，深色主题直接用 `--gmm-*`；棕色 / 木质渐变 / 深蓝全部替换，强调色统一墨绿。**画布 2D 绘制色不动**（`verify-map-client` 逐值钉死） |
