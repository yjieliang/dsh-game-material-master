# 去背：绿幕 / BiRefNet / 自动（模块①②③ 共用）

> 这是「去背后端」的产品与工程说明。算法细节（洪水填充、贴边误抠）见
> [ENGINEERING.md](ENGINEERING.md) 的「抠像是怎么做的」；本文讲**怎么选后端、失败怎么办、怎么验收**。

## 一句话

插件原来只会绿幕抠像。现在多了一个可选的 **BiRefNet** 后端（跑在本机 ComfyUI 上，免费），
按任务/项目切换；模型不可用时**自动回退绿幕**并在任务日志里写明原因，绝不静默产出黑底或脏边。
**默认仍是绿幕**，升级不会改变既有行为。

## 三个后端

| 后端 | 做什么 | 什么时候用 |
|---|---|---|
| `keygreen`（默认） | 现有绿幕算法：边界洪水填充 + 绿色优势值 | 纯色 / 渐变干净的绿幕、洋红幕 |
| `birefnet` | 本机 ComfyUI 的 BiRefNet 工作流（`127.0.0.1:8188`，免费） | 手绘、照片、非纯色 / 复杂背景 |
| `auto` | 先跑绿幕，判据不成立才改用模型 | 不确定素材背景是否干净 |

**auto 判据**（`src/matte.ts` 的 `assessAutoBackend`）：

- 背景占比 < **5%**：画面里几乎没有被判为背景的像素 → 不是绿幕图，改用模型；
- 前景「明显偏绿」> **2%**：抠掉了大面，但角色边缘一圈绿边 → 改用模型；
- 其余情况认为绿幕可信（省一次推理，也避免模型把绿幕图裁坏）。

## 调用链（BiRefNet）

```
RGBA → PNG ─ POST /upload/image ─→ LoadImage 文件名
      ─ POST /prompt（内置工作流） ─→ prompt_id
      ─ 轮询 GET /history/<id>（没进 history 时看 /queue 区分排队/执行）
      ─ GET /view 取回 PNG
      ─ 校验尺寸必须与原图一致（不一致直接报错）
      ─ 有 alpha 直接用；只输出 mask（RGB 灰度）→ 用亮度与原图合成 RGBA
```

内置工作流 = 本机 `ComfyUI\user\default\workflows\游戏素材_抠图透明化_BiRefNet.json` 的 API 格式转写：

```
LoadImage ─┬─→ RemoveBackground ←─ LoadBackgroundRemovalModel(birefnet.safetensors)
           │        └→ InvertMask ─┐
           └──────────────────────→ JoinImageWithAlpha → SaveImage
```

两个**必须照抄**的细节：

1. `RemoveBackground` 输出的 mask **方向是反的（背景 = 1）**，必须接 `InvertMask`
   再交给 `JoinImageWithAlpha`，否则角色变透明、背景留下。
2. `LoadBackgroundRemovalModel` 的 API 输入名是 `bg_removal_name`，**不是**界面上显示的
   `bg_model`；写错会被 ComfyUI 拒绝。

## 回退语义（为什么不会静默坏）

| 情况 | 行为 |
|---|---|
| ComfyUI 没开 / 地址不对 | 回退绿幕，`fallbackReason` = 无法连接本地 ComfyUI… |
| 工作流执行报错 | 回退绿幕，原因 = ComfyUI 执行失败：节点 / 异常 / 消息 |
| 输出尺寸与原图不一致 | **直接报错**并回退（不静默用小图覆盖原图） |
| 单帧超过 120 秒 | 回退绿幕，原因 = BiRefNet 去背超时（120 秒） |
| 输出里没有图片文件 | 回退绿幕，原因 = 输出里没有图片文件（检查终点是不是 SaveImage） |
| `matteFallback: false` | **不降级**，直接抛错（把问题暴露给调用方） |

回退结果与「直接用绿幕」逐像素一致（`verify-matte.mjs` 有断言），并且：
- `project.json` 的 `sheet.matte` / `frames[<方向>].matte`、
  图片任务 `item.matte`、序列帧 `frames.matte` 都记 `{ backend, fallbackReason?, elapsedMs, frames, fallbackCount, cachedCount, workflowId }`；
- 项目 / 任务的日志里有一行「去背后端：… / 回退 N 帧（原因：…）」；
- 模块② 每张图下方显示「去背：BiRefNet · 回退原因：…」。

## 缓存与并发

- **内容哈希缓存**：键 = 工作流正文 + 宽高 + RGBA 像素的 SHA-256，落
  `<DSH_HOME>/inkbox/matte-cache/<hash>.rgba`（+ `.json` 元数据）。同图同参数重跑（例如改完合成参数点「重新抠像」）
  不会再提交 ComfyUI；换工作流 / 改节点会自动失效。`INKBOX_MATTE_CACHE=0` 可关。
- **并发默认 2**：批量上传 / 轮询 / 下载并行两路，ComfyUI 自己排队；本地能力走 local lane，**不建 receipt**。
- **内嵌 PNG 解码**：为了不每帧 spawn 一次 ffmpeg，`src/matte.ts` 自带 8 位、非隔行 PNG 解码
  （`zlib.inflateSync` + 五种行过滤），并能区分「带 alpha」与「只有 mask」。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `matteBackend` | `keygreen` | `keygreen` / `birefnet` / `auto` |
| `matteFallback` | `true` | 模型失败时是否回退绿幕 |
| `matteWorkflowId` | `builtin.matte-birefnet` | 去背工作流；也可填工作流库 id 或本机 `.json` 路径 |

设置页：「墨盒 → 设置 → 去背后端」。
**一次性换后端**（不改配置）：`game_material({action:"call", method:"rematte", payload:{projectId|jobId, backend}})`。

## 自检

```bash
node scripts/verify-matte.mjs     # 80 项，纯本地、零付费（起 mock ComfyUI）
```

覆盖：内置工作流结构（含上面两个细节）、PNG 编解码、mask 合成、auto 判据、成功路径
（multipart 上传 / LoadImage 注入 / /view 取回 / 缓存命中）、执行错误 / 超时 / 尺寸不一致 /
没有输出 / 连不上 → 回退、并发 ≤ 2、`rematte` schema 逐键不丢、三处付费清单不含它、
以及**三条链路真实代码路径**（pipeline.startRekey / seqgen.keySequenceFrames / imagegen.rekeyImageJob）。

## 真实联调记录（2026-10-29，本机 ComfyUI 0.43.0）

环境：本机 `http://127.0.0.1:8188`，模型 `background_removal/birefnet.safetensors`；
源图 = 768×1152 洋红背景角色立绘（`_envtest.png`），缩到长边 384（256×384）后作为三条链路的输入。
三条链路分别走**真实** `pipeline.startRekey` / `imagegen.rekeyImageJob` / `seqgen.keySequenceFrames`，
每一项产物都逐像素统计 alpha。原始数据在 `research/matte-birefnet/out/`（对比图 `comparison.png`）。

| 链路 | 后端 | 耗时 | 透明像素 | 半透明像素 | 洋红残留（彩边） |
|---|---|---|---|---|---|
| **源图**（未去背） | — | — | 0.00% | 0.00% | 84.31% |
| ② 图片生成 | `birefnet` | 5.49 s（含首次加载模型） | **83.83%** | 0.98% | **0.481%** |
| ① 八方向图（2 帧） | `birefnet` | 147 ms（2 帧缓存命中） | **83.83%** | 0.98% | **0.481%** |
| ③ 序列帧（3 帧） | `birefnet` | 78 ms（3 帧缓存命中） | **83.83%** | 0.98% | **0.481%** |
| 对照：同一张图走绿幕 | `keygreen` | 10 ms | 82.86% | 0.00% | **1.455%** |

- 透明比例：源图 0% → BiRefNet 去背后 **83.83%**（角色本体约 16% 不透明，符合立绘构图）。
- 同一张图两种后端「抠掉的面积」接近，但**彩边差 3 倍**：绿幕算法只对绿色做去溢色，
  洋红幕在轮廓上留下 1.455% 的洋红色像素；BiRefNet 是 **0.481%**（且这 0.48% 基本落在角色内部
  本来就偏洋红的衣物上）。这就是「非纯色 / 非绿幕背景该用模型」的量化理由。
- 首次一帧 ~5.5 s（含 BiRefNet 模型加载），模型常驻后单帧 ~1.9 s（另一次 768×1152 原尺寸实测）。
  缓存命中后重跑整条链只要几十毫秒。
- 每条链路的日志都出现「去背后端：BiRefNet / N 帧 / … 秒」，
  `project.json` / `image-jobs/<id>/job.json` / `sequence-jobs/<id>/job.json` 的 `matte` 节点逐一可读回。
- **服务不可用回退**：把 `comfyBaseUrl` 指到死端口实测 → 回退绿幕、`fallbackReason` =
  「无法连接本地 ComfyUI（http://127.0.0.1:1）：fetch failed。请确认 ComfyUI 正在运行。」，
  回退结果与纯绿幕逐像素一致（`verify-matte.mjs` 第 5 节）。

### 复跑

真实联调用 `.verify/real-matte/` 作为临时 DSH_HOME（不进库）：

```bash
# 1) 确认本机 ComfyUI 在跑、队列空闲（别打断用户在跑的任务）
curl -s http://127.0.0.1:8188/queue
# 2) 三条链路真实跑一遍（免费；脚本在 scripts/tmp/，不入库）
node scripts/tmp/matte-real-e2e.mjs
# 3) 出对比图（source | birefnet | keygreen，灰底看透明边）
```

## 局限 / 排障

- **不打包模型、不引 Python**：BiRefNet 模型与节点必须装在用户自己的 ComfyUI 里
  （`background_removal/birefnet.safetensors` + 核心节点 `LoadBackgroundRemovalModel` /
  `RemoveBackground` / `InvertMask` / `JoinImageWithAlpha`）。
- **尺寸必须一致**：工作流里若有缩放节点会直接报「尺寸不一致」——去背不允许改尺寸。
- **单帧 120 秒**：超大图（4K+）在 16GB 显存上可能超时；可以先在 ComfyUI 侧限制尺寸，或关掉回退让错误暴露。
- 自定义工作流没有「注入点」时报错会写清需要 `LoadImage` 或 `first/image` 类 IMAGE 输入。
- 设置页改了 `matteBackend` / `matteWorkflowId` **不需要重启 DSH**（配置每次读缓存，保存即生效）；
  但 `src/matte.ts` 这类宿主代码改动要重启 DSH。
