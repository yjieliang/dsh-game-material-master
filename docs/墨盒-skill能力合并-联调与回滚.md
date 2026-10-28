# 墨盒 × 本机 skill 能力合并 · 真实联调与回滚说明

> 需求：总控 `req_dfd6949fc0`｜设计：`docs/墨盒-skill能力合并-重构设计.md`（§15 裁决）｜版本：0.12.0
> 本文记录**本机真实联调证据**与**回滚步骤**，是总控需求的验收材料（设计 §12 验收矩阵）。

## 0. 联调环境（本机实测）

| 项 | 值 |
|---|---|
| 操作系统 / Shell | Windows 11 · PowerShell 7.6.7 |
| 本机 ComfyUI | `http://127.0.0.1:8188`（0.43.0，1022 种节点，本地免费） |
| ComfyUI 工作流目录 | `E:\Comfy-Desktop\ComfyUI-Installs\ComfyUI (1)\ComfyUI\user\default\workflows\`（11 份 JSON，9 份游戏素材工作流） |
| 模型目录 | `E:\Comfy-Desktop\ComfyUI-Shared\models` |
| 素材来源（只读） | `G:\image`（comfyui-2d-assets / minimax-h3-walk-cycle / sprite-gen） |
| ffmpeg / ffprobe | 自检用 `%LOCALAPPDATA%\dsh-verify-ffmpeg\node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe`（`FFMPEG_PATH` / `FFPROBE_PATH`） |
| 计费 | 本轮联调**零付费**：全部调用本地 ComfyUI + 本机 JS 计算；未调用 ark / ToAPIs / MiniMax / 音乐 / 音效 |

## 1. 联调记录

### 1.1 本地 ComfyUI 工作流库（req_e395dcba0d）

- **界面格式精确转换**：本机 workflows 目录的 JSON 同时带 `widgets_values` 与 `widgets_values_named`
  （后者是「控件名 → 值」），转换器按它精确映射；对没有 named 字段的旧格式，用 `/object_info`
  按节点定义顺序消费 `widgets_values`。实测「透明精灵 Turbo」13 节点转换后：
  `5.TextEncodeQwenImage21.prompt / negative_prompt`、`6.EmptyLatentImage.width / height / batch_size`、
  `7.ManualSigmas.sigmas`、`8.KSamplerSelect.sampler_name`、`9.RandomNoise.noise_seed`、
  `10.CFGGuider.cfg` 全部正确。
- **真实出图**（插件网关 → imageprovider → workflowlib → ComfyUI，本地免费）：透明精灵 Turbo 注入
  `5.prompt` / `6.width` / `9.noise_seed` 提交 8188 → 产出 `transparent-qwen-real.png`：
  **1024×1024 RGBA**、473,846 B、透明比例 **80.44%**、63.2 s（含模型加载）；本地后端 receipts **0 条**。
  证据：`docs/assets/workflow-lib/transparent-qwen-real.png`（入库）。
- **自检**：`/system_stats` + `/object_info` 节点类型与模型文件存在性检查；本机 9 个工作流无缺节点。

### 1.2 BiRefNet 模型去背（req_59a3b50652）

- 三条链路（① 阶段①/③/④ 抠像、② 图片生成抠像、③ 序列帧抠像）各真实跑一次（256×384 洋红背景立绘）：
  源图透明 **0% → 83.83%**；洋红边缘彩边 **0.481%（BiRefNet）vs 1.455%（绿幕）**，对比图肉眼可辨。
- 单帧 ~1.9 s（首次含模型加载 5.49 s），内容哈希缓存命中后 2 帧 147 ms / 3 帧 78 ms；
  ComfyUI 死端口实测**自动回退绿幕并带 `fallbackReason`**，与纯绿幕结果逐像素一致。
- 证据：`docs/去背-BiRefNet.md`、`research/matte-birefnet/`（报告 + 真实产物 + 对比图）。

### 1.3 产物 QA（req_aee289460b）

- 用真实交付精灵表（只读复制到临时 DSH_HOME）跑 `runProjectQA`：
  - p3-walk_v11（8 帧走循环）→ warn：heightCv 0%、缝 IoU 0.619、缝 RGB 差 22.4、bboxCv 13.0（摆臂）；
  - noblewoman-walk_v1 → warn：heightCv 0%、缝 IoU 0.846；
  - knight-attack_v1（12 帧一次性攻击）→ warn：headWidthCv 42.3%、缝 RGB 差 60.6 —— **正确地暴露「不是循环」**。
- 指标读数与人工判断一致；报告落 `<目标>/qa/report.json`。证据：`docs/qa-live-20261029/`（README + 3 份报告 JSON）。

### 1.4 引擎导出（req_b70a5d20bb）

- 临时 DSH_HOME 里用真 `chroma.composeSheet` 合成 8 方向 × 4 帧整图 → 导出全部格式：
  37 条 zip 条目逐字节核对、32 张帧 PNG 与整图矩形逐字节一致；逐帧对齐校验有 11 类反例逐 code 断言。
- 另用对话工具面 `game_material({action:'call',method:'exportSprite'})` 真走「插件 apply → 工具面 → 网关 →
  exportman」，导出 30 个文件、`assetBase=/dsh-inkbox/assets/<projectId>/` 正确。
- 本机 `~/.dsh/inkbox/projects` 当前没有已合成整图的真实项目，已在格式文档写明口径。
- 证据：`docs/引擎导出-格式说明.md`。

### 1.5 自动选帧（req_2e421741df）

- 算法对照（本机现跑 `make_cycle.py --select-only`）：p1 周期 26 / c0=23 / picks [23,26,29,33,36,39,43,46]；
  p3 周期 33 / c0=36 / picks [36,40,44,48,53,57,61,65]；八度样本 p3s42 周期 29（自相关主峰 59 折半）/
  c0=34 / picks [34,38,41,45,49,52,56,59] —— 三者与参考实现**逐帧一致（±0 帧）**，置信度 0.8133/0.8155/0.6005。
- 真实链路：p1 的 90 张真实 cut 帧合成绿幕 mp4 → 插件「导入本地视频 → 抽 90 张候选帧 → 自动选帧 →
  写 picks → 切 8 帧」全通：周期 26 / 置信度 0.8677 / picks 61,64,68,71,74,77,80,84 / 8 张帧文件都在；
  手动 `applyAutoPicks` 写等分也走同一条 picks 通道。
- 证据：`docs/自动选帧-算法与阈值.md`。

### 1.6 素材互操作（req_7180b0d06a）

- `node scripts/verify-interop.mjs`：**55 项**全绿（临时 DSH_HOME，真挂 cordis 网关）。
- `node scripts/e2e-interop-real.mjs`：**21 项**全绿（真实素材）：透明精灵 Turbo 界面格式 13 节点
  联网精确转换（提示词 `5.prompt`、模型 3 个、无缺节点）；BiRefNet 6 节点（图像输入 `1.image`、
  模型 `birefnet.safetensors`）；真实 PNG 落盘逐字节一致；真实帧目录 16 张批量导入；
  真实 MP4 导入方向视频槽位（`videos/front.mp4`、`origin: "local"`）。

## 2. 回归门禁（合并后统一执行）

```bash
npm run build                 # tsc + 客户端单文件打包
node scripts/gate.mjs         # 核心 7 个自检 + 产物体检
node scripts/gate.mjs --full  # 全部 verify-*（本机既有红见 §4）
```

- 新增脚本：`verify-workflow-lib` / `verify-matte` / `verify-qa` / `verify-export` /
  `verify-selection` / `verify-interop`；`e2e-interop-real` 为真机素材验收（缺素材 SKIP）。
- **2026-10-29 合并后复跑结果**：`gate.mjs` **PASS 14 / FAIL 0**；`verify-host` **387** ·
  `verify-tools` **197** · `verify-client` **368** · `verify-feedback` **233** · `verify-i18n` **9** ·
  `verify-pipeline` **35** · `verify-arch` **18** · `verify-workflow-lib` **126** · `verify-matte` **80** ·
  `verify-qa` **102** · `verify-export` **125** · `verify-selection` **108** · `verify-interop` **55** ·
  `verify-jobs` **55** · `verify-comfy` **124** · `verify-custom-image` **68** · `verify-toapis` **43** ·
  `verify-rename` **23**，全部通过。
- 体积预算：`lib/client.js` **1,263,177 B（93% / 1.3 MB）**、gzip ≤ 340 KB（§15 裁决，`verify-arch` 与
  `gate.mjs` 同步上调；`gate.mjs` 预警线按硬线的 96% 设为 1.25 MB）。
- wire 方法数：188 → **201**（工作流库 6 + 互操作 2 + 去背 1 + QA 1 + 导出 1 + 选帧 2），全部本地方法、
  不进 `PAID_METHODS`、不建 receipt。

## 3. 回滚

**逐层开关**（任何一层都能单独关掉回到旧行为，见设计 §11）：

| 能力 | 开关 | 关掉后的行为 |
|---|---|---|
| 本地 ComfyUI 生图 | `imageProvider` 改回 `ark` / `custom`；`imageBackendPolicy` 改回 `manual` | 完全走旧云端链路 |
| 工作流目录 | 不使用工作流（不选 `imageWorkflowId`） | 旧「自定义 ComfyUI」单工作流路径照常 |
| BiRefNet 去背 | `matteBackend: "keygreen"`（默认） | 绿幕算法，行为与 0.11.0 一致 |
| 产物 QA | `qaEnabled: false`；`qaFailClosed` 默认 false | 不体检、不阻断 |
| 引擎导出 | 不勾选新格式 | 只导出原来的 PNG / zip |
| 自动选帧 | `autoSelectFrames: false`；不点按钮 | 等分 + 手选，行为不变 |
| 素材互操作 | 不调用 `importLocalPath` / `importWorkflowFile` | 旧 `upload*` 通道不受影响 |

**代码回滚**：

- 合并顺序为「工作流库 → 去背 → QA → 导出 → 选帧 → 互操作」，每个能力在合并提交里可单独 revert；
- 新增文件（`src/imagebackend.ts` / `workflowlib.ts` / `workflowbuiltin.ts` / `matte.ts` /
  `qa.ts` / `exportman.ts` / `cycle.ts` / `interop.ts`）删除即回到旧行为；
- 共享文件（`config.ts` / `wire.ts` / `index.ts` / 客户端）的改动全部是**增量**：新字段 optional、
  新方法只增不改、旧方法语义未变。

**数据回滚**：

- 数据目录只**新增**子目录（`workflows/`、`qa/`），旧数据不迁移、不改写；
- 旧任务缺新字段时读取侧补默认值（不写回）；
- `receipts/` 只加不删——删凭证等于把「可能已付费」抹掉；
- 本地能力**不产生 receipt**、不进 `PAID_METHODS`，回滚不影响历史任务与计费记录。

**部署回滚**：

- 宿主半区（`src/index.ts` / `jobs.ts` / `receipts.ts` 等）改动需**重启 DSH** 才生效；
  浏览器半区（`lib/client.js`）刷新即可；
- 回退到 0.11.0：`git checkout 0.11.0` 后重新 `npm run build`（`lib/` 入库，无需现场编译）。

## 4. 本机既有红（与本次改动无关，记录以免误判）

`verify-music-score` / `verify-music-gateway`（缺 Python 3）、`verify-iso-pipeline`（本机 zip 解包依赖）、
`verify-live-bundle`（需要真实 DSH 宿主在 43120）、`verify-map-gateway` 1 项（Windows 路径断言）、
`verify-map-client` 14 项（UI 重设计前旧断言）。以上均在本轮改动前复现。
