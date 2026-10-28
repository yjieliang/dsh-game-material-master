/**
 * 素材互操作 · **真机素材**导入验收（req_7180b0d06a）。
 *
 *   node scripts/e2e-interop-real.mjs
 *
 * 与 verify-interop.mjs 的分工：那个脚本自带夹具、可在任何机器上跑（进 gate --full 候选）；
 * 这个脚本专门用本机已有的真实素材（G:\image 的交付帧 / 视频，ComfyUI 的 9 个工作流），
 * 验「真实产物能不能顺进来」。只读外部文件、不联网、不花钱，产物落在 temp DSH_HOME 下，
 * 跑完即删。本机没有 G:\image 时脚本会 SKIP（不伪装成通过）。
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = await mkdtemp(join(tmpdir(), "dsh-inkbox-interop-real-"));
process.env.DSH_HOME = HOME;

const { Context } = await import("@deepseek-ai/cordis");
const plugin = await import("../lib/index.js");

const IMAGE = "G:\\image";
const WORKFLOWS = "E:\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI (1)\\ComfyUI\\user\\default\\workflows";
const REAL_IMAGE = join(IMAGE, "deliverables", "_archive", "han-general-attack_v1", "frames", "frame_01_src.png");
const REAL_FRAMES_DIR = join(IMAGE, "deliverables", "_archive", "han-general-attack_v1", "frames");
const REAL_VIDEO = join(IMAGE, "work", "sprite-walk", "_scratch_817583dfa3", "runs", "chain_final", "preview_raw", "chain_raw.mp4");
const REAL_WORKFLOW = join(WORKFLOWS, "游戏素材_透明精灵_Turbo.json");
const MATTE_WORKFLOW = join(WORKFLOWS, "游戏素材_抠图透明化_BiRefNet.json");

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
}

async function main() {
  const missing = [REAL_IMAGE, REAL_VIDEO, REAL_WORKFLOW].filter((path) => !existsSync(path));
  if (missing.length > 0) {
    console.log("SKIP：本机缺少真实素材，跳过真机导入验收：\n- " + missing.join("\n- "));
    process.exit(0);
  }
  console.log(`临时 DSH_HOME: ${HOME}\n`);

  const ctx = new Context();
  ctx.provide("typert", { register: () => () => {} });
  ctx.provide("webServer", { register: () => () => {} });
  plugin.apply(ctx);
  const studio = ctx.get("gameStudio");

  // 1) 真实 ComfyUI 工作流文件（界面格式）→ 解析 + 静态绑定
  console.log("1) 真实工作流文件");
  for (const [label, path, expect] of [
    ["透明精灵 Turbo", REAL_WORKFLOW, { prompt: true, image: false }],
    ["BiRefNet 去背", MATTE_WORKFLOW, { prompt: false, image: true }]
  ]) {
    const imported = await studio.importWorkflowFile({ path });
    const wf = imported.workflow;
    record(`${label}：解析成功（${wf.protocol} 格式，${wf.nodeCount} 节点，联网精确转换=${wf.live}）`, imported.ok === true && wf.nodeCount > 0);
    record(
      `${label}：${expect.prompt ? "识别到" : "正确地没有"}提示词绑定`,
      expect.prompt ? typeof wf.bindings.prompt === "string" : wf.bindings.prompt === undefined,
      String(wf.bindings.prompt ?? "无")
    );
    record(
      `${label}：提示词文本${expect.prompt ? "已写进正文（不是空壳转换）" : "确实不存在（去背工作流没有文本节点）"}`,
      expect.prompt
        ? Object.values(wf.json).some((node) => ["text", "prompt"].some((key) => typeof node.inputs?.[key] === "string" && node.inputs[key] !== ""))
        : Object.values(wf.json).every((node) => typeof node.inputs?.text !== "string")
    );
    record(`${label}：模型清单非空`, wf.requiredModels.length > 0, wf.requiredModels.slice(0, 3).join(", "));
    record(`${label}：正文可直接提交（节点带 class_type）`, Object.values(wf.json).every((node) => typeof node.class_type === "string"));
    record(
      `${label}：${expect.image ? "识别到" : "无"}图像输入绑定`,
      expect.image ? typeof wf.bindings.image === "string" : true,
      String(wf.bindings.image ?? "无")
    );
    record(`${label}：没有缺节点（/object_info 校验通过）`, wf.unknownNodes.length === 0, wf.unknownNodes.map((item) => item.classType).join("、"));
  }

  // 2) 真实 PNG → 项目源图
  console.log("\n2) 真实 PNG 作为项目源图");
  const project = await studio.createProject({ name: "互操作真机验收" });
  const projectId = project.projectId ?? project.id;
  const saved = await studio.importLocalPath({ target: "project-source", projectId, path: REAL_IMAGE });
  record("真实 PNG 导入成功", saved.imported.length === 1, saved.imported[0]?.name);
  const projectView = await studio.getProject({ projectId });
  const onDisk = await readFile(join(HOME, "inkbox", "projects", projectId, projectView.source.file));
  const source = await readFile(REAL_IMAGE);
  record("落盘字节与真实源文件一致", onDisk.equals(source), `${onDisk.length} B`);

  // 3) 真实帧目录 → 图片任务产物批量导入
  console.log("\n3) 真实帧目录批量导入（图片任务）");
  const imageJob = await studio.createImageJob({ name: "互操作真机批量" });
  const imageJobId = imageJob.jobId ?? imageJob.id;
  const batch = await studio.importLocalPath({ target: "image-item", jobId: imageJobId, path: REAL_FRAMES_DIR });
  record("目录批量导入真实帧", batch.imported.length >= 5, `导入 ${batch.imported.length} 张，跳过 ${batch.skipped.length} 个`);
  const imageJobView = await studio.getImageJob({ jobId: imageJobId });
  record("图片任务产物列表已增长", imageJobView.items.length >= 5, String(imageJobView.items.length));

  // 4) 真实 MP4 → 某个方向的行走视频槽位（不触发生成 / 不抽帧，只验落盘与作废）
  console.log("\n4) 真实 MP4 导入方向视频槽位");
  const videoSaved = await studio.importLocalPath({ target: "project-video", projectId, key: "front", path: REAL_VIDEO });
  record("真实 MP4 导入成功", videoSaved.imported.length === 1, videoSaved.imported[0]?.name);
  const projectAfter = await studio.getProject({ projectId });
  record("项目视频槽位指向本地视频", typeof projectAfter.videos?.front?.file === "string", projectAfter.videos?.front?.file);
  record("来路标注为本地视频", projectAfter.videos?.front?.origin === "local", projectAfter.videos?.front?.remoteStatus);

  await rm(HOME, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  console.log(`\n共 ${results.length} 项，失败 ${failed.length} 项`);
  if (failed.length > 0) {
    console.error("失败项：\n- " + failed.map((r) => r.name).join("\n- "));
    process.exit(1);
  }
  console.log("全部通过（真实素材导入可用）");
}

await main();
