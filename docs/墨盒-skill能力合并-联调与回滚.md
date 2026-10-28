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
- **真实出图**（工作流库同一条链路，本地免费）：用转换后的「透明精灵 Turbo」注入提示词并提交 8188 →
  成功产出 `sprite_00006_.png`：**1024×1024，pix_fmt = rgba**（1,102,322 B）。证据文件：
  `.verify/comfy-real-sprite.png`（本机临时证据，不入库）。
- **自检**：`/system_stats` + `/object_info` 节点类型与模型文件存在性检查；本机 9 个工作流无缺节点。

### 1.2 BiRefNet 模型去背（req_59a3b50652）

（实施后补：真实去背前后透明比例、回退证据）

### 1.3 产物 QA（req_aee289460b）

（实施后补：合格 / 不合格两套产物的报告读数）

### 1.4 引擎导出（req_b70a5d20bb）

（实施后补：真实整图导出的 manifest / Godot / Aseprite / zip 内容，逐帧对齐校验正反用例）

### 1.5 自动选帧（req_2e421741df）

（实施后补：G:\image 真实走循环素材的 picks 与 make_cycle.py 对比）

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
- 体积预算：`lib/client.js` ≤ 1.3 MB / gzip 340 KB（§15 裁决，`verify-arch` 与 `gate.mjs` 同步上调）。
- wire 方法数：188 → **201**（工作流库 6 + 互操作 2 + 去背 1 + QA 1 + 导出 1 + 选帧 2）。

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
