# 产物 QA（体检报告）设计

> 需求：req_aee289460b「产物 QA 报告（透明/彩边/一致性/循环缝指标 + 界面）」
> 设计依据：docs/墨盒-skill能力合并-重构设计.md §6（报告结构 / 指标口径 / 触发与展示）、§9.1（config）、§9.2（job.json）、§9.3（wire）、§15（裁决：默认只警告）
> 分支：feature/qa（worktree _inkbox-wt/qa）
> 指标阈值来源：本机技能 minimax-h3-walk-cycle（scripts/qa_walk.py 与 SKILL.md §7 验收指标；只参考口径，不搬代码）

## 1. 目标

以前合图完只有「背景占比」一个数字，好不好全靠肉眼。这一步把 skill 里被反复验证过的硬指标移植进插件：

- 每个阶段（合图 / 条图 / 抠像）完成后自动算一份报告，落在产物的 qa/report.json；
- 界面用徽标 + 可展开指标表展示，不通过项一眼可见，报告 JSON 可下载；
- 默认只警告（qaFailClosed=false），只有用户显式开启 fail-closed 才阻断「打通过」。

**不做什么**：不自动修图、不引入模型、不调用任何云端接口（全本地、零计费）。

## 2. 指标口径（src/qa.ts）

全部在 RGBA 缓冲区上算，零第三方依赖。alpha < 8 视为透明（QA_ALPHA_MIN）。

| 指标 key | 口径 | 默认阈值 | 判定 |
|---|---|---|---|
| transparentRatio | alpha<8 的像素占比；报告取逐帧平均，同时检查逐帧极值 | 0.05 ~ 0.95 | 越界 warn |
| fringeRatio | alpha 边缘像素（8 ≤ alpha ≤ 247，或前景里与全透明像素 4 邻接的那一圈）中，绿色优势 g - max(r,b) > 40 的占比 | ≤ 0.15 | 超阈 warn |
| bboxCv | 逐帧 alpha 包围盒**宽度**的变异系数（%，总体标准差/均值） | ≤ 5% | 超阈 warn |
| heightCv | 逐帧 alpha 包围盒**高度**的 CV（%） | ≤ 1% | 超阈 **fail** |
| headWidthCv | 顶部 15% 行段最大行宽（span，与 qa_walk.py 同口径）的 CV（%） | ≤ 2% | 超阈 warn |
| loopSeamIou | 循环组「末帧 ↔ 首帧」alpha 掩码 IoU | ≥ 0.35 | 低于 **fail** |
| loopSeamDiff | 循环组末帧与首帧在**前景并集**上的平均 RGB 差 | ≤ 24 | 超阈 warn |
| centroidJitter | 相邻帧（含循环首尾）alpha 质心位移最大值（px） | — | info |
| centroidJitterMedian | 同上，中位数（px） | — | info |

口径说明：

- **bboxCv 为什么只取宽口径**：设计 §6.2 的 bboxCv 一行写了「宽 ≤5%、高 ≤1%」，而 heightCv 又是「≤1% fail」。
  同一个高度数值若同时以 warn 与 fail 两条判定出现，界面上会看到自相矛盾的两行。这里把「宽」放进 bboxCv（warn）、
  「高」并入 heightCv（fail，更严），在报告与文档里写清，验证脚本也按这个口径断言。
- **帧间一致性只统计有前景的帧**：空帧（整格全透明）由 transparentRatio 的极值负责报，不参与 CV 计算，
  否则一个缺帧会把 CV 抬到离谱的值。
- **循环组**：八方向整图每行一组（行=方向、列=帧）；序列帧条图整条一组；单张图片任务没有循环组。
- **交替指标（左右脚交替 Δ）**：设计 §6.2 注明依赖 src/cycle.ts 的脚位/步幅读数，而自动选帧是另一条分支
  （feature/selection）。本分支**不 import cycle.ts**（避免跨分支编译依赖），报告里不出现该指标；
  该指标并入选帧模块的验收（skill 里门禁为 脚真相位 Δ ≥ 0.20）。
- **CV 定义**：std/mean×100，std 取总体标准差（ddof=0），与 qa_walk.py 的 numpy std 默认一致。

## 3. 降采样

长边 > 512 时先做**整数系数**盒式平均降采样：系数 = ceil(长边/512)，输出尺寸 = floor(宽/系数) × floor(高/系数)。
盒式平均按 alpha 预乘（sumRGB×alpha / sumAlpha），避免透明像素的 RGB 污染边缘，进而避免彩边比例被虚假抬高。

报告里的 sampled 就是本次系数（1 = 未降采样），界面上会显示「长边降采样 ×N」徽标。

## 4. 报告与摘要

落盘：<目标目录>/qa/report.json（目标目录 = projects/<id>、image-jobs/<id>、sequence-jobs/<id>）。

QAReport 结构：

- version（1）、scope（sprite / sequence / image）、frameCount、sampled
- metrics[]：key / label / value / threshold? / thresholdMax? / comparison?（max|min）/ verdict（pass|warn|fail|info）
- issues[]：code（= 指标 key）/ message（中文，给宿主日志与工具面）/ level?（warn|fail）
- verdict（pass|warn|fail）、thresholds（本次生效的完整阈值）、generatedAt、elapsedMs

回包摘要（getProject / getImageJob / getSequenceJob 的 qa 字段，以及 runQA 的 { report, qa }）：

- verdict、scope、issues（前 5 条）、warnCount、failCount、frameCount、sampled、generatedAt
- failClosed（当前配置是否开启）、blocked（failClosed 且 verdict=fail）、reportPath（qa/report.json）

界面展开指标表时调 runQA 复算（本地同步、毫秒级）：摘要只带 verdict + 前 5 条，不带完整 metrics，
避免每个 2.5 秒的轮询回包都拖着整张表。

## 5. 触发点与复算

| 阶段 | 触发 | 数据来源 |
|---|---|---|
| ① 合图（sprite） | pipeline.renderSheet 写完整图后 | 内存里的 sheet.rgba（按 sheet.columns/rows 切格） |
| ③ 条图（sequence） | seqgen.composeSequenceSheet 写条图后 | 内存里的 sheet.rgba（1 行 × N 帧） |
| ② 抠像（image） | imagegen.refreshImageJobQA（生成/重新抠像/上传后） | 读 keyed/*.png，用内置 PNG 解码器解出 RGBA |

- 合图/条图把**完整报告**存在节点上（project.sheet.qa / sequenceJob.qa / imageJob.qa），
  同时写 qa/report.json；报告针对的是「用户看到的那张产物」。
- wire 方法 runQA({ projectId? , jobId? })：按已落盘的产物复算一次并重写报告。
  projectId → 整图；jobId 以 i 开头 → 图片任务；以 s 开头 → 序列帧任务。
  复算走解码 PNG（src/qa.ts 内置极简 RGBA8 解码器：node:zlib inflate + filter 0~4），
  不重跑抠像 + 合成，也不 spawn ffmpeg。
- 解码器只接受本插件产出的形态（8bit、非隔行、color type 6/2）；外部工具改写过的整图会明确报错，
  而不是拿半成品数据算出一份「看起来正常」的报告。

- 资源路由：src/assets.ts 的三个 scope 白名单（SERVABLE_DIRS / SERVABLE_IMAGE_DIRS /
  SERVABLE_SEQUENCE_DIRS）都加了 qa，界面才能直接下载 qa/report.json（否则「徽标有、导出 403」）。

## 6. 配置与阈值

src/config.ts 新增（都在 saveConfig 的 directKeys 白名单里，非凭据）：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| qaEnabled | boolean | true | 产物自动体检 |
| qaFailClosed | boolean | false | fail 时阻断验收（默认只警告） |
| qaThresholds | Record<string, number> | 见上表 | 阈值覆盖；读配置时由 normalizeQaThresholds 收敛成完整生效表 |

阈值覆盖规则：只认 8 个已知键；未知键丢弃；数值夹到安全区间（比例类 0~1，CV 类 0~100，
RGB 差 0~255）；透明比例上下界写反时回落默认。设置页「产物体检（QA）」分组可以逐项改，也能一键恢复默认。

## 7. fail-closed

- 默认 false：QA 只提示，永远不阻断（设计 §15 裁决）。
- 开启后：verdict=fail 时，以下「打通过」动作被宿主拒绝，并在错误里列出失败的指标：
  - sprite：setApproved({stage:"sheet", approved:true})
  - sequence：saveSequenceJob({step:"sheet"(或不带 step), approved:true})
  - image：saveImageJob({approved:true})
- 只拦「打通过」，不拦渲染/合成本身 —— 产物仍可正常生成、下载、修改参数后重跑。

## 8. 界面

- 模块①阶段④（合成整图）与模块③条图步骤内嵌同一套 QA 卡：徽标（QA 通过 / N 项警告 / N 项失败）、
  一句话摘要、长边降采样徽标、「展开指标」表格（指标/数值/阈值/判定）、「重新体检」、「导出报告 JSON」。
- 卡片数据来自回包 qa 摘要；展开时调 runQA 拿完整 metrics（本地、免费）。
- 设置页新增「产物体检（QA）」分组：自动体检开关、fail-closed 开关、8 项阈值、恢复默认。
- 文案全部 T() + i18n-en.ts；指标 label 由界面按 key 映射，报告里的中文 label 只给宿主日志/工具面用，
  切英文不会露出中文。

## 9. 真实联调（docs/qa-live-20261029/）

用 G:/image/deliverables 的真实交付精灵表（只读复制到临时 DSH_HOME，不动原目录）跑 runProjectQA：

| 产物 | 结论 | 关键读数 |
|---|---|---|
| p3-walk_v11（8 帧走循环，生产定稿） | warn | heightCv 0%、loopSeamIou 0.619、loopSeamDiff 22.4、bboxCv 13.0%（摆臂导致包围盒宽度变化） |
| noblewoman-walk_v1（8 帧走循环） | warn | heightCv 0%、loopSeamIou 0.846、loopSeamDiff 31.4、headWidthCv 4.85% |
| knight-attack_v1（12 帧一次性攻击） | warn | headWidthCv 42.3%、loopSeamDiff 60.6 —— 一次性动作首尾本来就不同，指标正确暴露了「它不是循环」 |

结论与人工判断一致：两个走循环的角色身高完全稳定（heightCv 0%），攻击动作被一致性/循环缝指标明显区分。
复现：node scripts/qa-live-report.mjs（会重写该目录下的 README 与各报告 JSON）。

## 10. 局限与后续

- 交替指标（脚位/步幅）在本分支省略，等 feature/selection 的 src/cycle.ts 合并后可作为 info 指标接入
  （接口留白：qaFrames 的 options 目前是 scope/loops/consistency/thresholds）。
- 图片任务只做单图指标（透明比例/彩边）：一个任务里的多张图是独立作品，跨帧一致性没有意义。
- loopSeamIou 只看 alpha 掩码重叠，动作类产物可能「形状重叠但内容不同」；这种情形由 loopSeamDiff 兜住
  （knight-attack 就是 IoU 0.617 通过、RGB 差 60.6 报警告）。文档与真实报告都保留这个对照。
- 报告不含「像素级可视化」（比如标出彩边像素位置）；后续可以加一份调试图，但首版不做。

## 11. 自检

scripts/verify-qa.mjs（102 项，纯本地、零付费）：

1. 降采样（系数、盒式平均、alpha 预乘）
2. 阈值覆盖（默认值、覆盖、未知键、越界夹取、上下界写反回落）
3. PNG 解码器（往返字节一致、非 PNG 拒绝）
4. 指标黄金值：合格 fixture（pass）、身高漂移（heightCv fail）、首尾错位（loopSeamIou fail）、
   整片绿边（fringeRatio warn）
5. 阈值边界（放宽/收紧后的判定翻转、降采样后读数不变）
6. 摘要 / fail-closed（blocked、qaBlockReason、结论文案）
7. 整图切帧 / 循环组 / qaComposedSheet
8. 接线与落盘（seqgen 条图、pipeline 整图、imagegen 图片任务 → qa/report.json + 节点报告）
9. 网关（runQA 三路分派、三个 get* 回包摘要、fail-closed 拦截与开关还原、saveConfig 阈值收敛、wire 189）
10. 资源路由（三个 scope 的 qa/report.json 200、目录穿越 400）

界面侧的真渲染断言补在 scripts/verify-feedback.mjs（阶段④ 与模块③ 的 QA 卡片：徽标文案、隐藏/展开按钮、
导出链接、失败态、没有报告时不渲染；+9 项 → 227 项）。

另外 node scripts/gate.mjs 全绿（verify-host 387 / verify-tools 197 / verify-client 368 / verify-feedback 227 /
verify-i18n 9 / verify-pipeline 35 / verify-arch 18）。
