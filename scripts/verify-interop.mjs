/**
 * 素材互操作（req_7180b0d06a）：本机路径导入 + ComfyUI 工作流文件导入。
 *
 *   node scripts/verify-interop.mjs
 *
 * 纯本地、零付费：真挂一个 temp DSH_HOME + 真 cordis Context，**走网关方法**（不是只测模块函数），
 * 所以「路径 → 网关 → 落盘 → 项目/任务状态」整条链都在断言范围内。
 * 夹具全部现场生成（PNG 用 lib/png.js 编码；视频只造文件头，用来验文件头嗅探），
 * 不依赖 G:\image（真机素材的导入在 docs 里有手工验收记录）。
 */

import { mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = await mkdtemp(join(tmpdir(), "dsh-inkbox-interop-"));
process.env.DSH_HOME = HOME;

const { Context } = await import("@deepseek-ai/cordis");
const plugin = await import("../lib/index.js");
const { encodePng } = await import("../lib/png.js");
const interop = await import("../lib/interop.js");

const failures = [];
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
}
async function expectError(name, run, pattern) {
  try {
    await run();
    check(name, false, "应当抛错但没有");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, pattern === undefined || pattern.test(message), message.slice(0, 120));
  }
}

const WORK = join(HOME, "_interop-fixtures");
await mkdir(WORK, { recursive: true });

function pngBuffer(color) {
  const width = 2;
  const height = 2;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = 255;
  }
  return encodePng(rgba, width, height);
}
/** 造一个最小 MP4 头（第 4..8 字节 "ftyp" 就足以被文件头嗅探认出）。 */
function mp4Buffer() {
  return Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(64, 0)]);
}

const PNG_A = join(WORK, "a.png");
const PNG_B = join(WORK, "b.png");
const MP4 = join(WORK, "clip.mp4");
const FAKE_PNG = join(WORK, "fake.png");
await writeFile(PNG_A, pngBuffer([255, 0, 0]));
await writeFile(PNG_B, pngBuffer([0, 0, 255]));
await writeFile(MP4, mp4Buffer());
await writeFile(FAKE_PNG, Buffer.from("this is not a png"));

async function main() {
  console.log(`临时 DSH_HOME: ${HOME}\n`);

  // ── 1. 模块级：文件头嗅探 ──────────────────────────────────────────────
  console.log("1) 文件头嗅探（不看扩展名）");
  check("PNG 被识别为 image/png", interop.sniffLocalMedia(await readFile(PNG_A))?.ext === "png");
  check("MP4 被识别为 video/mp4", interop.sniffLocalMedia(mp4Buffer())?.kind === "video" && interop.sniffLocalMedia(mp4Buffer())?.ext === "mp4");
  check("JPEG 头被识别", interop.sniffLocalMedia(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.ext === "jpg");
  check("WebP 头被识别", interop.sniffLocalMedia(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))?.ext === "webp");
  check("GIF 头被识别", interop.sniffLocalMedia(Buffer.from("GIF89a"))?.ext === "gif");
  check("BMP 头被识别", interop.sniffLocalMedia(Buffer.from("BM"))?.ext === "bmp");
  check("WebM（EBML）被识别为视频", interop.sniffLocalMedia(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))?.kind === "video");
  check("乱码字节返回 undefined", interop.sniffLocalMedia(Buffer.from("????")) === undefined);

  // ── 2. 模块级：路径校验与目录批量 ──────────────────────────────────────
  console.log("\n2) 路径校验 / 目录批量");
  const single = await interop.describeLocalPath(PNG_A);
  check("单文件路径返回 file", single.kind === "file" && single.file.kind === "image" && single.file.bytes > 0);
  const dir = await interop.describeLocalPath(WORK);
  check("目录路径返回 directory", dir.kind === "directory");
  check("目录批量收图片与视频", dir.files.some((f) => f.name === "a.png") && dir.files.some((f) => f.name === "clip.mp4"));
  check("目录批量跳过不可识别文件并给原因", dir.skipped.some((s) => s.reason.includes("不是可识别的图片")));
  check("目录批量不递归子目录", dir.files.every((f) => !f.path.includes("sub")));
  await expectError("空路径直接报错", () => interop.describeLocalPath(""), /路径为空/);
  await expectError("不存在的路径报错（不静默）", () => interop.describeLocalPath(join(WORK, "nope.png")));
  await expectError("改了后缀的假 PNG 被文件头拦下", () => interop.describeLocalPath(FAKE_PNG), /无法识别的文件格式/);
  await expectError(
    "目标要图片但给的是视频",
    () => interop.readLocalMediaFile(MP4, "image"),
    /这里是要的|是视频|目标槽位/
  );
  const sparse = join(WORK, "huge.png");
  await writeFile(sparse, Buffer.alloc(4));
  await truncate(sparse, interop.LOCAL_IMAGE_MAX_BYTES + 8);
  await expectError("超过图片体积上限报错（不截断）", () => interop.readLocalMediaFile(sparse, "image"), /超过上限/);

  // ── 3. 模块级：工作流文件解析 ─────────────────────────────────────────
  console.log("\n3) 工作流文件解析（API / 界面两种格式）");
  const apiWorkflow = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "a knight", clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: "blurry", clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "5": { class_type: "KSampler", inputs: { seed: 42, steps: 8, cfg: 7, sampler_name: "euler", denoise: 1, model: ["1", 0] } },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "LoadImage", inputs: { image: "ref.png" } },
    "8": { class_type: "SaveImage", inputs: { filename_prefix: "out", images: ["6", 0] } }
  };
  const apiPath = join(WORK, "api.json");
  await writeFile(apiPath, JSON.stringify(apiWorkflow, null, 2));
  const preview = await interop.readWorkflowFile(apiPath);
  check("API 格式原样读入（protocol=api）", preview.protocol === "api", preview.protocol);
  check("节点数与正文一致", preview.nodeCount === Object.keys(apiWorkflow).length, String(preview.nodeCount));
  check("静态识别提示词绑定", preview.bindings.prompt === "2.text", String(preview.bindings.prompt));
  check("第二个文本节点识别为负向提示词", preview.bindings.negative === "3.text", String(preview.bindings.negative));
  check("识别尺寸 / 种子 / 步数 / 采样器", preview.bindings.width === "4.width" && preview.bindings.seed === "5.seed" && preview.bindings.steps === "5.steps" && preview.bindings.sampler === "5.sampler_name");
  check("识别图像输入（LoadImage）", preview.bindings.image === "7.image", String(preview.bindings.image));
  check("识别模型文件名清单", preview.requiredModels.includes("sd_xl_base_1.0.safetensors"));
  check("节点类型清单非空", preview.classTypes.includes("KSampler") && preview.classTypes.includes("CheckpointLoaderSimple"));

  const uiWorkflow = {
    nodes: [
      { id: 1, type: "CheckpointLoaderSimple", widgets_values: ["sd_xl_base_1.0.safetensors"], inputs: [] },
      {
        id: 2,
        type: "CLIPTextEncode",
        widgets_values: ["hello"],
        inputs: [
          { name: "text", type: "STRING", widget: { name: "text" }, link: null },
          { name: "clip", type: "CLIP", link: 1 }
        ]
      },
      { id: 3, type: "KSampler", widgets_values: [1, "fixed", 8, 7, "euler", "normal", 1], inputs: [{ name: "model", type: "MODEL", link: 2 }] },
      { id: 4, type: "SaveImage", widgets_values: ["out"], inputs: [] }
    ],
    links: [[1, 1, 1, 2, 0, "CLIP"], [2, 1, 0, 3, 0, "MODEL"]]
  };
  const uiPath = join(WORK, "ui.json");
  await writeFile(uiPath, JSON.stringify(uiWorkflow, null, 2));
  const uiPreview = await interop.readWorkflowFile(uiPath);
  check("界面格式被自动转成 API（protocol=ui）", uiPreview.protocol === "ui", uiPreview.protocol);
  check("转换后节点数与源一致", uiPreview.nodeCount === 4, String(uiPreview.nodeCount));
  check("界面格式也识别到提示词", uiPreview.bindings.prompt === "2.text", String(uiPreview.bindings.prompt));
  check(
    "离线转换带「控件值可能丢失」说明（转换质量不静默）",
    uiPreview.notes.some((note) => note.includes("离线") && note.includes("控件值")) || uiPreview.warnings.some((w) => w.includes("离线"))
  );

  const brokenPath = join(WORK, "broken.json");
  await writeFile(brokenPath, "{ not json ");
  await expectError("非法 JSON 报错并带原因", () => interop.readWorkflowFile(brokenPath), /工作流解析失败/);
  await expectError("工作流路径是目录时报错", () => interop.readWorkflowFile(WORK), /不是文件/);
  await expectError("空路径的工作流导入直接报错", () => interop.readWorkflowFile(""), /路径为空/);

  // ── 4. 网关级：真挂插件，走 studio.importLocalPath ─────────────────────
  console.log("\n4) 网关：本机路径导入（真挂插件）");
  const ctx = new Context();
  ctx.provide("typert", { register: () => () => {} });
  ctx.provide("webServer", { register: () => () => {} });
  plugin.apply(ctx);
  const studio = ctx.get("gameStudio");
  check("gameStudio 服务可用", studio !== undefined && typeof studio.importLocalPath === "function");
  check("wire 方法清单里有两个新方法", [
    ...((await import("../lib/wire.js")).METHODS.map((m) => m.method))
  ].includes("importLocalPath") && (await import("../lib/wire.js")).METHODS.some((m) => m.method === "importWorkflowFile"));

  const created = await studio.createProject({ name: "互操作验收" });
  const projectId = created.id ?? created.projectId ?? created.project?.id;
  check("创建测试项目", typeof projectId === "string" && projectId.length > 1, String(projectId));

  const saved = await studio.importLocalPath({ target: "project-source", projectId, path: PNG_A });
  check("路径导入源图成功", saved.imported.length === 1 && saved.imported[0].name === "a.png");
  const project = await studio.getProject({ projectId });
  check("项目源图已落盘并指向新文件", typeof project.source?.file === "string" && project.source.file.startsWith("source/"), project.source?.file);
  const hostPath = join(HOME, "inkbox", "projects", projectId, project.source.file);
  const onDisk = await readFile(hostPath);
  const original = await readFile(PNG_A);
  check("落盘字节与源文件逐字节一致", onDisk.equals(original));

  await expectError(
    "槽位要图片但给了视频：网关报错",
    () => studio.importLocalPath({ target: "project-source", projectId, path: MP4 }),
    /只接受图片/
  );
  await expectError(
    "目录批量不支持单槽位（防覆盖）",
    () => studio.importLocalPath({ target: "project-source", projectId, path: WORK }),
    /一次只能导入一个文件/
  );
  await expectError("不存在的路径：网关报错", () => studio.importLocalPath({ target: "project-source", projectId, path: join(WORK, "ghost.png") }));

  const imageJob = await studio.createImageJob({ name: "互操作图片任务" });
  const imageJobId = imageJob.id ?? imageJob.jobId ?? imageJob.job?.id;
  check("创建测试图片任务", typeof imageJobId === "string", String(imageJobId));
  const refDir = join(WORK, "refs");
  await mkdir(refDir, { recursive: true });
  await writeFile(join(refDir, "r1.png"), pngBuffer([0, 255, 0]));
  await writeFile(join(refDir, "r2.png"), pngBuffer([0, 0, 0]));
  const refsImported = await studio.importLocalPath({ target: "image-ref", jobId: imageJobId, path: refDir });
  check("目录批量导入参考图（2 张）", refsImported.imported.length === 2, String(refsImported.imported.length));
  const imageJobView = await studio.getImageJob({ jobId: imageJobId });
  check("图片任务状态里能看到两张参考图", imageJobView.refs?.length === 2, String(imageJobView.refs?.length));

  const mixedDir = join(WORK, "mixed");
  await mkdir(mixedDir, { recursive: true });
  await writeFile(join(mixedDir, "ok.png"), pngBuffer([1, 2, 3]));
  await writeFile(join(mixedDir, "bad.png"), Buffer.from("nope"));
  const mixed = await studio.importLocalPath({ target: "image-item", jobId: imageJobId, path: mixedDir });
  check("混合目录：可识别的导入、坏文件进 skipped", mixed.imported.length === 1 && mixed.skipped.some((s) => s.reason.includes("不是可识别的图片")));

  await expectError(
    "一个文件都没导入成功时明确报错",
    () => studio.importLocalPath({ target: "image-item", jobId: imageJobId, path: join(mixedDir, "bad.png") })
  );

  // ── 5. 网关级：工作流文件导入 ─────────────────────────────────────────
  console.log("\n5) 网关：工作流文件导入");
  const importedWorkflow = await studio.importWorkflowFile({ path: apiPath });
  check("网关返回 ok + 工作流正文", importedWorkflow.ok === true && typeof importedWorkflow.workflow?.json === "object");
  check("网关返回的正文可直接提交（节点 class_type 齐全）", importedWorkflow.workflow.json["2"]?.class_type === "CLIPTextEncode");
  check("网关返回静态绑定与警告", importedWorkflow.workflow.bindings.prompt === "2.text" && Array.isArray(importedWorkflow.workflow.warnings));
  await expectError("网关：非法工作流文件报错", () => studio.importWorkflowFile({ path: brokenPath }), /工作流解析失败/);

  // ── 6. 安全边界 ───────────────────────────────────────────────────────
  console.log("\n6) 安全边界");
  const sub = join(WORK, "sub", "deep.png");
  await mkdir(join(WORK, "sub"), { recursive: true });
  await writeFile(sub, pngBuffer([9, 9, 9]));
  const dirAgain = await interop.describeLocalPath(WORK);
  check("目录批量不递归进子目录（不会擅自扩大读取范围）", !dirAgain.files.some((f) => f.name === "deep.png"));
  check("目录批量有 200 个文件上限（常量存在且为正）", interop.LOCAL_DIR_MAX_FILES === 200);
  check("工作流体积上限 2MB 存在", interop.LOCAL_WORKFLOW_MAX_BYTES === 2 * 1024 * 1024);
  check("图片 / 视频上限分别 30MB / 100MB", interop.LOCAL_IMAGE_MAX_BYTES === 30 * 1024 * 1024 && interop.LOCAL_VIDEO_MAX_BYTES === 100 * 1024 * 1024);

  await rm(HOME, { recursive: true, force: true });

  console.log(`\n共 ${checks} 项检查，失败 ${failures.length} 项`);
  if (failures.length > 0) {
    console.error("失败项：\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("全部通过");
}

await main();
