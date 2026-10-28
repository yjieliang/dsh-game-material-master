# 本地 ComfyUI 工作流库 · 真实联调记录（2026-10-29）

> 需求：`req_e395dcba0d`（本地 ComfyUI 工作流库：设置页目录 + 任务级选择 + 参数注入 + 环境自检）
> 设计：`docs/墨盒-skill能力合并-重构设计.md` §3 / §4 / §9.1 / §9.3（§15 裁决 3：内置 3 份正文 + 6 条目录条目）
> 自检：`node scripts/verify-workflow-lib.mjs` → **126 项全绿**（自起 mock ComfyUI，纯本地零付费）

## 1. 环境

| 项 | 值 |
|---|---|
| ComfyUI | 0.43.0（Desktop 管理的主实例，`http://127.0.0.1:8188`） |
| GPU | AMD Radeon RX 7800 XT（17.2 GB VRAM，CUDA/HIP 后端） |
| GPU 型号字符串 | `cuda:0 AMD Radeon RX 7800 XT : native` |
| 工作流来源 | `E:\Comfy-Desktop\ComfyUI-Installs\ComfyUI (1)\ComfyUI\user\default\workflows\`（界面格式导出） |
| 转换方式 | **按 `/object_info` 的节点定义精确转换**（required → optional 的输入顺序消费 `widgets_values`；有 `widgets_values_named` 时按名字映射；连线查 `links`） |
| 提交前队列 | `running=0 pending=0`（没打断任何人的任务） |

## 2. 内置 3 份工作流（随包正文）

| 条目 id | 名称 | 节点数 | 关键绑定（实测识别） | 依赖模型（自检逐个核对） |
|---|---|---|---|---|
| `builtin.transparent-qwen` | 透明精灵 Turbo | 13 | `prompt=5.prompt`、`negative=5.negative_prompt`、`width=6.width`、`height=6.height`、`seed=9.noise_seed` | qwen_image_2.1_turbo_int8_convrot / qwen3vl_8b_int8_convrot / qwen_image_2.1_vae_bf16 |
| `builtin.pixel-sdxl` | 像素风 SDXL | 18 | `prompt=3.text`、`negative=4.text`（采样器正负连线反查）、`width=5.width`、`height=5.height`、`seed=6.seed`、`steps=6.steps`、`cfg=6.cfg`、`sampler=6.sampler_name` | sd_xl_base_1.0 / pixel-art-xl / birefnet |
| `builtin.matte-birefnet` | BiRefNet 去背（post） | 6 | `image=1.image` | birefnet.safetensors |

> 转换后用真实 `/object_info` 校验：**节点类型 0 缺失、模型文件 0 缺失**。
> 像素风 SDXL 的两个 `CLIPTextEncode` 输入名都是 `text`，靠 `KSampler.positive/negative` 的连线区分正负；
> 只按「名字像 text 取第一个」会把负面提示词当正面写进去（不报错、出图质量莫名变差）。

## 3. 目录 9 条（其余 6 条为「需导入」目录条目）

`builtin.pixel-sdxl-fast`（像素风 SDXL 极速）、`builtin.lineart-control`（线稿控制）、
`builtin.pose-frame`（角色动作帧）、`builtin.pixelize-post`（像素化后处理）、
`builtin.tile-seamless`（无缝地块）、`builtin.sprite-grid`（精灵表拼接）——
它们依赖的节点 / 模型版本耦合太强，随包只放**目录元数据**（用途 / 依赖模型 / 推荐绑定），
正文用设置页「导入工作流」从本机 `user/default/workflows/*.json` 导入（界面格式与 API 格式都收）。

## 4. 真实出图证据（本机 8188，纯本地免费）

| 项 | 值 |
|---|---|
| 工作流 | `builtin.transparent-qwen`（透明精灵 Turbo） |
| 提示词 | a single cute green slime monster game asset sprite, top-down 3/4 view, clean thick cartoon outlines, flat cel shading, centered, full body, no ground shadow, no text, isolated on transparent background |
| 注入结果 | `5.prompt` = 上述提示词、`6.width/height` = 1024/1024、`9.noise_seed` = 20261029 |
| prompt_id | `3b1bca01-ce3b-4400-aef0-987058a117bd` |
| ComfyUI 输出文件 | `sprite_00008_.png`（落在 ComfyUI 自己的 output 目录，插件用 `/view` 取回） |
| 产物（入库） | [docs/assets/workflow-lib/transparent-qwen-real.png](assets/workflow-lib/transparent-qwen-real.png) |
| 尺寸 / 像素格式 | **1024 × 1024 / rgba**（ffprobe） |
| 字节数 | 473,846 B |
| 透明比例（alpha < 8 的像素占比） | **80.44 %**（843,480 / 1,048,576；全透明 843,480、全不透明 202,058、半透明边缘 3,038） |
| 端到端耗时 | 63.2 s（含模型加载；同一会话第二次约 31 s） |
| 计费 | 0（本地后端走 `local` 并发通道，**receipts 目录 0 条**） |

复现（`DSH_HOME` 指到临时目录，避免污染用户配置）：

```bash
DSH_HOME=/tmp/dsh-wf-real node --input-type=module -e '
import { generateComfyImage } from "./lib/imagebackend.js";
import { normalizeConfig } from "./lib/config.js";
const cfg = normalizeConfig({ comfyBaseUrl: "http://127.0.0.1:8188", comfyTimeoutMs: 600000, imageProvider: "comfy", imageWorkflowId: "builtin.transparent-qwen" });
const r = await generateComfyImage(cfg, { prompt: "a single cute green slime monster sprite, transparent background", images: [], size: "1024x1024", watermark: false, workflowId: "builtin.transparent-qwen", seed: 20261029 });
console.log(r.usage, r.bytes.length);
'
```

## 5. 自检实测（设置页「自检」按钮 / `testWorkflow`）

- `/system_stats` 可达：ComfyUI **0.43.0**；
- 节点类型：13 / 13 都在（透明精灵）；
- 模型文件：3 / 3 都在（按 `UNETLoader.unet_name` / `CLIPLoader.clip_name` / `VAELoader.vae_name` 的选项列表核对）；
- 绑定识别：`prompt → 5.prompt`、`negative → 5.negative_prompt`、`width → 6.width`、`height → 6.height`、`seed → 9.noise_seed`；
- 可选真出图（`generate:true`）：拿到 1024×1024 PNG，与上表一致。

缺模型 / 缺节点 / 服务不可达三种失败路径由 `verify-workflow-lib.mjs` 的 mock 服务逐条覆盖
（`missingModels` 列出文件名、`missingNodeTypes` 列出 class_type、不可达时报「不可达」而不是
「所有节点都缺」——`fetchComfyObjectInfo` 对单类型失败是静默的，所以顺序上先确认可达）。

## 6. 选择策略与回退（verify 覆盖，纯本地）

| 场景 | 结果 |
|---|---|
| `manual`（默认） | 完全按 `imageProvider`，**不探测**本地 ComfyUI（不发 /system_stats） |
| `local-first` + 本地可用 | 用本地 `comfy` |
| `local-first` + 本地不可达 + 回退 `ark` | 回退 ark，`fallbackReason` 记录「无法连接本地 ComfyUI…」并回传界面 |
| `local-first` + 回退 `custom` | 回退自定义服务 |
| `local-first` + 回退 `none` | 直接报错（宁可失败也不悄悄花钱） |
| 探测缓存 | 30 秒内第二次探测不再打 `/system_stats`（verify 断言） |

## 7. 边界与已知限制

- 内置 3 份正文换机器后模型不同：自检会逐条列出缺失模型与缺失节点，不会静默失败；
- 界面格式在 ComfyUI 不可达时只能离线近似转换：控件值可能丢，notes 里会明确警告；启动 ComfyUI 后重新导入即可精确转换；
- 本地后端只做**生图**；去背 / 像素化这类 `kind=post` 工作流不能当生图后端（会报错并提示换工作流）；
- 参考图给了但工作流没有图像注入点 → **直接报错**（不静默丢掉参考图）；
- 本轮不做视频工作流库（视频仍走 `comfyVideo` 那条既有链路）。
