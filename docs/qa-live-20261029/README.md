# 产物 QA 真实联调报告（2026-10-28）

数据来自本机 G:/image/deliverables 的真实交付物（只读复制到临时 DSH_HOME，不动原目录）；
报告由插件自己的 runProjectQA（src/qa.ts）算出，JSON 与本文件同目录。

| 产物 | 尺寸 | 帧数 | QA 结论 | 需要关注 | 说明 |
|---|---|---|---|---|---|
| p3-walk_v11 | 2048×384 | 8 | warn | bboxCv: warn | 走循环（生产定稿，期望 QA 通过或仅轻微警告） |
| noblewoman-walk_v1 | 2048×384 | 8 | warn | headWidthCv: warn、loopSeamDiff: warn | 另一角色走循环 |
| knight-attack_v1 | 3072×384 | 12 | warn | bboxCv: warn、headWidthCv: warn、loopSeamDiff: warn | 一次性攻击动作（不是循环，首尾帧本来就不同 —— 期望循环缝指标暴露这一点） |

## p3-walk_v11 — warn

走循环（生产定稿，期望 QA 通过或仅轻微警告）。整图 8 帧（8 列 × 1 行），降采样系数 1。

| 指标 | 数值 | 阈值 | 判定 |
|---|---|---|---|
| 透明像素占比（transparentRatio） | 72.1% | 0.05~0.95 | pass |
| 边缘彩边比例（fringeRatio） | 0.0% | 0.15 | pass |
| 包围盒宽度 CV（bboxCv） | 13.04% | 5 | warn |
| 身高 CV（heightCv） | 0% | 1 | pass |
| 头宽 CV（headWidthCv） | 1.69% | 2 | pass |
| 循环缝 IoU（loopSeamIou） | 0.619 | 0.35 | pass |
| 循环缝 RGB 差（loopSeamDiff） | 22.4 | 24 | pass |
| 相邻帧质心位移最大值（centroidJitter） | 15.31px | — | info |
| 相邻帧质心位移中位数（centroidJitterMedian） | 12.94px | — | info |

问题：
- [warn] bboxCv：包围盒宽度 CV 13.04% 超过 5%：各帧角色胖瘦 / 朝向差异偏大

## noblewoman-walk_v1 — warn

另一角色走循环。整图 8 帧（8 列 × 1 行），降采样系数 1。

| 指标 | 数值 | 阈值 | 判定 |
|---|---|---|---|
| 透明像素占比（transparentRatio） | 65.0% | 0.05~0.95 | pass |
| 边缘彩边比例（fringeRatio） | 0.0% | 0.15 | pass |
| 包围盒宽度 CV（bboxCv） | 4.88% | 5 | pass |
| 身高 CV（heightCv） | 0% | 1 | pass |
| 头宽 CV（headWidthCv） | 4.85% | 2 | warn |
| 循环缝 IoU（loopSeamIou） | 0.846 | 0.35 | pass |
| 循环缝 RGB 差（loopSeamDiff） | 31.4 | 24 | warn |
| 相邻帧质心位移最大值（centroidJitter） | 8.22px | — | info |
| 相邻帧质心位移中位数（centroidJitterMedian） | 3.64px | — | info |

问题：
- [warn] headWidthCv：头宽 CV 4.85% 超过 2%：头部大小在帧间变化偏大
- [warn] loopSeamDiff：循环缝位置平均 RGB 差 31.4 超过 24：首尾帧颜色不一致（打光 / 色偏漂移）

## knight-attack_v1 — warn

一次性攻击动作（不是循环，首尾帧本来就不同 —— 期望循环缝指标暴露这一点）。整图 12 帧（12 列 × 1 行），降采样系数 1。

| 指标 | 数值 | 阈值 | 判定 |
|---|---|---|---|
| 透明像素占比（transparentRatio） | 66.3% | 0.05~0.95 | pass |
| 边缘彩边比例（fringeRatio） | 0.0% | 0.15 | pass |
| 包围盒宽度 CV（bboxCv） | 15.91% | 5 | warn |
| 身高 CV（heightCv） | 0.89% | 1 | pass |
| 头宽 CV（headWidthCv） | 42.28% | 2 | warn |
| 循环缝 IoU（loopSeamIou） | 0.617 | 0.35 | pass |
| 循环缝 RGB 差（loopSeamDiff） | 60.6 | 24 | warn |
| 相邻帧质心位移最大值（centroidJitter） | 29.02px | — | info |
| 相邻帧质心位移中位数（centroidJitterMedian） | 19.49px | — | info |

问题：
- [warn] bboxCv：包围盒宽度 CV 15.91% 超过 5%：各帧角色胖瘦 / 朝向差异偏大
- [warn] headWidthCv：头宽 CV 42.28% 超过 2%：头部大小在帧间变化偏大
- [warn] loopSeamDiff：循环缝位置平均 RGB 差 60.6 超过 24：首尾帧颜色不一致（打光 / 色偏漂移）
