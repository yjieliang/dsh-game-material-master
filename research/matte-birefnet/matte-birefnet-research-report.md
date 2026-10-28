# BiRefNet 去背接入 · 调研与真实联调记录

## 结论

- 本机 ComfyUI（0.43.0）已经具备**可用的通用去背**：内置工作流
  `游戏素材_抠图透明化_BiRefNet.json`（`RemoveBackground → InvertMask → JoinImageWithAlpha → SaveImage`），
  模型 `background_removal/birefnet.safetensors` 已在位；768×1152 单帧约 1.9 s（模型常驻后）。
- 与绿幕算法相比：同一张**洋红幕**立绘，两种后端抠掉的面积接近（BiRefNet 83.83% vs 绿幕 82.86% 透明），
  但**轮廓彩边差 3 倍**（洋红残留 0.481% vs 1.455%）——绿幕只对绿色通道去溢色，洋红幕的边留给它处理不了。
- 因此插件把它做成**可选后端**（默认仍是绿幕）而不是替换：纯色背景走绿幕更快、结果也稳；
  手绘 / 照片 / 复杂背景再切 BiRefNet。

## 接入要点（踩过 / 确认过的）

1. **mask 方向反了**：`RemoveBackground` 输出「背景 = 1」的 mask，必须 `InvertMask` 再上
   `JoinImageWithAlpha`；照抄界面工作流即可，但自己重写节点图时最容易漏。
2. **输入名以 `/object_info` 为准**：`LoadBackgroundRemovalModel` 的 API 输入名是
   `bg_removal_name`（界面上显示的是 `bg_model`），写错会被 ComfyUI 拒绝。
3. **尺寸必须校验**：工作流里任何人都可能塞缩放节点；去背结果比原图小一号时不能静默覆盖原图。
4. **可以只输出 mask**：`SaveImage` 只收 IMAGE，只出 MASK 的工作流一定经过 `MaskToImage`（RGB 灰度图），
   插件按亮度与原图合成 RGBA —— 不要求用户的工作流必须包含 `JoinImageWithAlpha`。
5. **缓存值得做**：改合成参数会触发「重新抠像」，同一批帧重复推理纯属浪费；按内容哈希缓存后
   第二次整条链路几十毫秒（本次实测 2 帧 147 ms / 3 帧 78 ms，全部缓存命中）。

## 实测数据（2026-10-29）

环境：本机 `http://127.0.0.1:8188`，ComfyUI 0.43.0，`birefnet.safetensors`；
源图 `_envtest.png`（768×1152 洋红背景角色立绘）缩到长边 384 → **256×384**。

三条链路都走**真实代码路径**（不是直接调 ComfyUI）：

| 链路 | 入口 | 后端 | 耗时 | 透明 | 半透明 | 洋红残留 |
|---|---|---|---|---|---|---|
| 源图 | — | — | — | 0.00% | 0.00% | 84.31% |
| ② 图片生成 | `imagegen.rekeyImageJob` | `birefnet` | 5.49 s（含首次加载模型） | **83.83%** | 0.98% | **0.481%** |
| ① 八方向图（2 帧） | `pipeline.startRekey` | `birefnet` | 147 ms（缓存 2/2） | **83.83%** | 0.98% | **0.481%** |
| ③ 序列帧（3 帧） | `seqgen.keySequenceFrames` | `birefnet` | 78 ms（缓存 3/3） | **83.83%** | 0.98% | **0.481%** |
| 对照（同日同图） | `matteOne(backend:"keygreen")` | `keygreen` | 10 ms | 82.86% | 0.00% | **1.455%** |

- 单帧原尺寸 768×1152 实测 1.9 s（模型已加载；见第一次探针）。
- 产物：`out/source.png`、`out/birefnet-keyed.png`、`out/keygreen-control.png`、
  `out/comparison.png`（灰底并排：源图 / BiRefNet / 绿幕）。
- `job.json` / `project.json` 里都能读回 `matte` 节点（`backend` / `elapsedMs` / `frames` / `cachedCount`）。

## 复跑方式

1. 确认 ComfyUI 在跑且队列空闲：`Invoke-RestMethod http://127.0.0.1:8188/queue`；
2. 跑真实三条链路脚本（临时 DSH_HOME 落在 `.verify/real-matte/`，不动真实数据）：

```bash
node scripts/tmp/matte-real-e2e.mjs
```

> 该脚本属于一次性联调工具（`scripts/tmp/` 已 gitignore），入册的是它的**输出数据**与本报告。
> 自动化回归在 `scripts/verify-matte.mjs`（80 项，mock ComfyUI、纯本地、零付费）。

## 与其它 skill 的关系

工作流结构、模型位置、mask 反向这些坑来自本机 skill
`G:\image\.agents\skills\comfyui-2d-assets`（只参考其文档与工作流，未搬运代码）。
