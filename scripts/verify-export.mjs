#!/usr/bin/env node
/**
 * 引擎导出自检（req_b70a5d20bb）。**纯本地、不联网、不花钱。**
 *
 * 这一层测的是 lib/exportman.js 的**真实现**：在临时 DSH_HOME 里用真正的
 * chroma.composeSheet 合成一张 8 方向 × 4 帧的整图（不是手搓的假图），然后
 * 走完整的 exportSprite：manifest v1 → 逐帧对齐校验 → Godot SpriteFrames →
 * Aseprite JSON → 逐帧 PNG → zip，并逐字节 / 逐像素核对产物。
 *
 * ## 为什么每条「对不上」都要单独造一个反例
 *
 * 设计 §7.1 的要求是「不一致**直接报错**」。只测正例的话，校验函数里少写一条
 * return 也照样全绿；所以数量 / 顺序 / 矩形 / 尺寸 / 重叠 / 方向数 / fps / 时长
 * 每一类都造一份坏 manifest，断言抛出的 code —— 顺便钉死错误码本身
 * （界面与文档都按 code 说话，改了就说明契约变了）。
 *
 * ## 隔离
 *
 * 整个脚本跑在 mkdtemp 出来的临时 DSH_HOME 里，结束连项目一起删掉，
 * 不碰用户真实的 ~/.dsh/inkbox/。
 *
 * 用法：node scripts/verify-export.mjs
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = await mkdtemp(join(tmpdir(), "dsh-export-"));
process.env.DSH_HOME = HOME;

let passed = 0;
const failures = [];
function check(label, ok, detail) {
  const tail = detail === undefined || detail === "" ? "" : " — " + detail;
  if (ok) {
    passed++;
    console.log("  ✓ " + label + tail);
  } else {
    failures.push(label + tail);
    console.log("  ✗ " + label + tail);
  }
}
function section(title) {
  console.log("\n── " + title + " ──");
}

const EXPORT = await import("../lib/exportman.js");
const STORE = await import("../lib/store.js");
const SEQ = await import("../lib/seqgen.js");
const CHROMA = await import("../lib/chroma.js");
const PNG = await import("../lib/png.js");
const CONFIG = await import("../lib/config.js");
const DIRS = await import("../lib/directions.js");

// ── ZIP 读取器（只给自检用；与 verify-map-pipeline 同一套做法）────────────
const ZIP_CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function zipCrc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = ZIP_CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** 真解包：中央目录 → 本地头 → inflateRaw → 校验长度与 CRC。 */
function readZip(buffer) {
  const EOCD = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (EOCD < 0) throw new Error("不是 zip：找不到 EOCD");
  const count = buffer.readUInt16LE(EOCD + 10);
  let offset = buffer.readUInt32LE(EOCD + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("中央目录签名不对");
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compSize = buffer.readUInt32LE(offset + 20);
    const rawSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localAt = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLen);
    if (buffer.readUInt32LE(localAt) !== 0x04034b50) throw new Error("本地头签名不对：" + name);
    const start = localAt + 30 + buffer.readUInt16LE(localAt + 26) + buffer.readUInt16LE(localAt + 28);
    const payload = buffer.subarray(start, start + compSize);
    const data = method === 0 ? Buffer.from(payload) : inflateRawSync(payload);
    if (data.length !== rawSize) throw new Error("解出来的长度不对：" + name);
    if (zipCrc32(data) !== crc) throw new Error("CRC 不对：" + name);
    out.set(name, data);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 期望抛特定 code 的辅助：没抛 / code 不对都算失败。 */
async function expectCode(label, code, run) {
  try {
    await run();
    check(label, false, "没有抛错（期望 " + code + "）");
  } catch (error) {
    check(label, error !== null && error !== undefined && error.code === code, "code=" + String(error?.code ?? error?.message ?? error));
  }
}

/** 深拷贝（反例会在真 manifest 上改坏，不能污染后面的用例）。 */
const clone = (value) => JSON.parse(JSON.stringify(value));

// ── 夹具：真合成一张 8×4 整图 ─────────────────────────────────────────────
const CELL_W = 64;
const CELL_H = 96;
const COLUMNS = 4;
const BOTTOM_MARGIN = 6;
const ROWS = DIRS.DIRECTION_KEYS.length;
const STEM = "导出测试";

/** 每格一个可辨颜色（顺序错、行列错都会露馅）。 */
function cellColor(row, col) {
  return [40 + ((row * 37) % 160), 60 + ((col * 53) % 160), 220 - ((row * 17 + col * 29) % 150)];
}

/** 源帧：80×120 透明底，中间一块纯色矩形（bbox 40×90，合成时统一裁剪缩放）。 */
function sourceFrame(row, col) {
  const width = 80;
  const height = 120;
  const rgba = Buffer.alloc(width * height * 4);
  const color = cellColor(row, col);
  for (let y = 20; y < 110; y++) {
    for (let x = 20; x < 60; x++) {
      const at = (y * width + x) * 4;
      rgba[at] = color[0];
      rgba[at + 1] = color[1];
      rgba[at + 2] = color[2];
      rgba[at + 3] = 255;
    }
  }
  return { rgba, width, height };
}

section("0) 夹具：真合成一张整图");

const project = await STORE.createProject(STEM);
await STORE.patchProject(project.id, (draft) => {
  draft.settings.cellWidth = CELL_W;
  draft.settings.cellHeight = CELL_H;
  draft.settings.frameCount = COLUMNS;
  draft.settings.bottomMargin = BOTTOM_MARGIN;
});
const rows = DIRS.DIRECTION_KEYS.map((key, rowIndex) => ({
  key,
  width: 80,
  height: 120,
  frames: Array.from({ length: COLUMNS }, (_value, col) => sourceFrame(rowIndex, col).rgba)
}));
const composed = CHROMA.composeSheet(rows, {
  cellWidth: CELL_W,
  cellHeight: CELL_H,
  frameCount: COLUMNS,
  autoCrop: true,
  fillRatio: 0.94,
  pixelSize: 0,
  fitMode: "contain",
  bottomMargin: BOTTOM_MARGIN
});
const sheetPng = PNG.encodePng(composed.rgba, composed.width, composed.height);
const sheetRelative = "out/sheet.png";
await mkdir(STORE.assetPath(project.id, "out"), { recursive: true });
await writeFile(STORE.assetPath(project.id, sheetRelative), sheetPng);
await STORE.patchProject(project.id, (draft) => {
  draft.sheet = {
    status: "ready",
    file: sheetRelative,
    approved: false,
    width: composed.width,
    height: composed.height,
    cellWidth: CELL_W,
    cellHeight: CELL_H,
    frameCount: COLUMNS,
    rowOrder: [...DIRS.DIRECTION_KEYS],
    generatedAt: Date.now()
  };
});

check("临时 DSH_HOME 在系统临时目录下（不碰真实数据）", HOME.startsWith(tmpdir()), HOME);
check(
  "整图尺寸 = " + COLUMNS + " 列 × " + ROWS + " 行 × 单格 " + CELL_W + "×" + CELL_H,
  composed.width === CELL_W * COLUMNS && composed.height === CELL_H * ROWS,
  composed.width + "×" + composed.height
);
let hasOpaque = false;
for (let i = 3; i < composed.rgba.length; i += 4) {
  if (composed.rgba[i] > 0) {
    hasOpaque = true;
    break;
  }
}
check("整图有真实内容（不是全透明）", hasOpaque);

section("1) PNG 解码（自己产物的最小解码器，不依赖 ffmpeg）");
{
  const decoded = EXPORT.decodePng(sheetPng);
  check("解码尺寸与编码一致", decoded.width === composed.width && decoded.height === composed.height, decoded.width + "×" + decoded.height);
  check("解码像素与原始 RGBA 逐字节一致", decoded.rgba.equals(composed.rgba), decoded.rgba.length + " B");
  const tiny = PNG.encodePng(Buffer.from([1, 2, 3, 4, 250, 251, 252, 253]), 2, 1);
  const tinyDecoded = EXPORT.decodePng(tiny);
  check(
    "2×1 小图的 alpha 与颜色都保留",
    tinyDecoded.rgba[0] === 1 && tinyDecoded.rgba[3] === 4 && tinyDecoded.rgba[4] === 250 && tinyDecoded.rgba[7] === 253
  );
  await expectCode("不是 PNG 的文件报 png-invalid", "png-invalid", () => EXPORT.decodePng(Buffer.from("not a png at all")));
  const badDepth = Buffer.from(sheetPng);
  badDepth[24] = 16; // IHDR 的 bitDepth 字节
  await expectCode("16 位 PNG 报 png-unsupported", "png-unsupported", () => EXPORT.decodePng(badDepth));
}

// ── 解析出来的来源（与宿主 exportSprite 内部同一份算出来的东西）────────────
const source = await EXPORT.resolveSpriteExportSource(project.id, { fps: 12 });
check("解析来源时读到的列数 = 整图帧数", source.columns === COLUMNS, String(source.columns));
check("解析来源时读到的行数 = 方向数", source.rows === ROWS, String(source.rows));
check("解析来源时行序取整图记录的 rowOrder", source.directions.join(",") === DIRS.DIRECTION_KEYS.join(","));
const manifest = EXPORT.buildManifest(source);
const tresFrames = manifest.frameLayout.length;

section("2) manifest v1 字段（设计 §7.1）");
{
  const frame5 = manifest.frameLayout[5];
  const last = manifest.frameLayout[manifest.frameLayout.length - 1];
  check("format = inkbox-sprite@1", manifest.format === "inkbox-sprite@1", manifest.format);
  check("name 取项目名", manifest.name === STEM, manifest.name);
  check("cell = 单格尺寸", manifest.cell.width === CELL_W && manifest.cell.height === CELL_H, JSON.stringify(manifest.cell));
  check("columns / rows", manifest.columns === COLUMNS && manifest.rows === ROWS, manifest.columns + "×" + manifest.rows);
  check("fps 取传入值", manifest.fps === 12, String(manifest.fps));
  check("loop 默认开", manifest.loop === true);
  check(
    "pivot 是脚底线（cellHeight - bottomMargin）/ cellHeight",
    Math.abs(manifest.pivot.x - 0.5) < 1e-9 && Math.abs(manifest.pivot.y - (CELL_H - BOTTOM_MARGIN) / CELL_H) < 1e-9,
    JSON.stringify(manifest.pivot)
  );
  check("directions 是整图的行序", JSON.stringify(manifest.directions) === JSON.stringify([...DIRS.DIRECTION_KEYS]));
  check("frameLayout 数量 = columns × rows", tresFrames === COLUMNS * ROWS, String(tresFrames));
  check(
    "行优先：index 5 → row 1 / column 1 / (64, 96)",
    frame5.index === 5 && frame5.row === 1 && frame5.column === 1 && frame5.x === CELL_W && frame5.y === CELL_H,
    JSON.stringify(frame5)
  );
  check(
    "最后一帧 = 第 7 行第 3 列",
    last.index === COLUMNS * ROWS - 1 &&
      last.row === ROWS - 1 &&
      last.column === COLUMNS - 1 &&
      last.x === (COLUMNS - 1) * CELL_W &&
      last.y === (ROWS - 1) * CELL_H,
    JSON.stringify(last)
  );
  let durationOk = true;
  for (const frame of manifest.frameLayout) {
    if (frame.durationMs !== Math.round(1000 / 12)) durationOk = false;
  }
  check("每帧时长 = round(1000 / fps)", durationOk, String(manifest.frameLayout[0].durationMs));
  check(
    "source 带 projectId 与整图相对路径",
    manifest.source.projectId === project.id && manifest.source.sheet === sheetRelative,
    JSON.stringify({ projectId: manifest.source.projectId, sheet: manifest.source.sheet })
  );
  check("source.settings 是脱敏快照（不含任何 Key）", !/apikey|apiKey|arkApiKey|musicApiKey|sfxApiKey/u.test(JSON.stringify(manifest.source.settings)));
  check("generatedAt 是合法 ISO 时间", Number.isFinite(Date.parse(manifest.generatedAt)), manifest.generatedAt);
  const slices = EXPORT.sliceSheetFrames(EXPORT.decodePng(sheetPng).rgba, composed.width, composed.height, manifest);
  const firstSlice = slices[0];
  const lastSlice = slices[slices.length - 1];
  check("切帧数量 = frameLayout 数量", slices.length === tresFrames, String(slices.length));
  check(
    "切帧方向 / 帧号按行优先编号",
    firstSlice.direction === DIRS.DIRECTION_KEYS[0] && firstSlice.frame === 0 && lastSlice.direction === DIRS.DIRECTION_KEYS[ROWS - 1] && lastSlice.frame === COLUMNS - 1,
    firstSlice.direction + "/" + lastSlice.direction
  );
  check("切出来的帧尺寸 = 单格尺寸", firstSlice.w === CELL_W && firstSlice.h === CELL_H);
}

section("3) 逐帧对齐校验：正例 + 每一类反例");
{
  const sheet = { width: composed.width, height: composed.height };
  let ok = true;
  try {
    EXPORT.assertFrameAlignment(manifest, sheet);
  } catch {
    ok = false;
  }
  check("正例：真整图 + 真 manifest 不抛错", ok);

  const count = clone(manifest);
  count.frameLayout.pop();
  await expectCode("少一帧 → frame-count-mismatch", "frame-count-mismatch", () => EXPORT.assertFrameAlignment(count, sheet));

  const order = clone(manifest);
  order.frameLayout[1].index = 99;
  await expectCode("index 不连续 → frame-order-mismatch", "frame-order-mismatch", () => EXPORT.assertFrameAlignment(order, sheet));

  const placement = clone(manifest);
  placement.frameLayout[1].column = 2;
  await expectCode("row/column 与 index 对不上 → frame-order-mismatch", "frame-order-mismatch", () => EXPORT.assertFrameAlignment(placement, sheet));

  // 注意：不能靠「把 x 挪 1」造这一条 —— 整图里格子是紧挨着的，挪 1 会先撞上
  // 右边那一格触发 frame-rect-overlap。这里造一份「格子之间有缝」的两列布局，
  // 矩形互不重叠、也没越界，只有 x 与 column 对不上。
  const layout = clone(manifest);
  layout.columns = 2;
  layout.rows = 1;
  layout.directions = ["front"];
  layout.frameLayout = [
    { index: 0, row: 0, column: 0, x: 0, y: 0, w: CELL_W, h: CELL_H, durationMs: 83 },
    { index: 1, row: 0, column: 1, x: 100, y: 0, w: CELL_W, h: CELL_H, durationMs: 83 }
  ];
  await expectCode("x 与 column 对不上 → frame-layout-mismatch", "frame-layout-mismatch", () => EXPORT.assertFrameAlignment(layout, sheet));

  const cell = clone(manifest);
  cell.frameLayout[1].w -= 1;
  await expectCode("帧宽 ≠ 单格宽 → frame-cell-mismatch", "frame-cell-mismatch", () => EXPORT.assertFrameAlignment(cell, sheet));

  const outside = clone(manifest);
  outside.frameLayout[1].x = composed.width;
  await expectCode("矩形越界 → frame-rect-out-of-bounds", "frame-rect-out-of-bounds", () => EXPORT.assertFrameAlignment(outside, sheet));

  const overlap = clone(manifest);
  overlap.frameLayout[1].x = 0;
  overlap.frameLayout[1].y = 0;
  overlap.frameLayout[1].column = 0;
  await expectCode("两帧矩形重叠 → frame-rect-overlap", "frame-rect-overlap", () => EXPORT.assertFrameAlignment(overlap, sheet));

  await expectCode(
    "整图尺寸与 cell×行列不符 → sheet-size-mismatch",
    "sheet-size-mismatch",
    () => EXPORT.assertFrameAlignment(clone(manifest), { width: composed.width + 8, height: composed.height })
  );

  const directions = clone(manifest);
  directions.directions.pop();
  await expectCode("方向数与行数不符 → direction-count-mismatch", "direction-count-mismatch", () => EXPORT.assertFrameAlignment(directions, sheet));

  const fps = clone(manifest);
  fps.fps = 0;
  await expectCode("fps 非法 → fps-invalid", "fps-invalid", () => EXPORT.assertFrameAlignment(fps, sheet));

  const duration = clone(manifest);
  duration.frameLayout[3].durationMs = 0;
  await expectCode("帧时长为 0 → duration-invalid", "duration-invalid", () => EXPORT.assertFrameAlignment(duration, sheet));

  const cols = clone(manifest);
  cols.columns = COLUMNS + 1;
  await expectCode("columns 与实际帧数不符 → frame-count-mismatch", "frame-count-mismatch", () => EXPORT.assertFrameAlignment(cols, sheet));
}

section("4) Godot SpriteFrames（.tres，format=3）");
const texturePath = "res://inkbox/" + STEM + "/sprite-sheet.png";
const tres = EXPORT.buildGodotSpriteFrames(manifest, { texturePath });
const animationNames = manifest.directions.map((direction) => EXPORT.animationNameOf("sprite", direction));
{
  check("头部是 SpriteFrames + format=3", tres.startsWith('[gd_resource type="SpriteFrames"') && tres.includes("format=3"), tres.split("\n")[0]);
  check("load_steps = 帧数 + 2", tres.includes("load_steps=" + (tresFrames + 2)), "期望 " + (tresFrames + 2));
  check("外链整图资源路径写对", tres.includes('[ext_resource type="Texture2D" path="' + texturePath + '" id="1_sheet"]'));
  check("每帧一个 AtlasTexture 子资源", (tres.match(/\[sub_resource type="AtlasTexture"/gu) ?? []).length === tresFrames);
  check("每帧一个 region 矩形", (tres.match(/region = Rect2\(/gu) ?? []).length === tresFrames);
  check("首帧 region = Rect2(0, 0, 64, 96)", tres.includes("region = Rect2(0, 0, 64, 96)"));
  check("末帧 region = Rect2(192, 672, 64, 96)", tres.includes("region = Rect2(192, 672, 64, 96)"));
  check("每个方向一个动画（frames 数组 = 行数）", (tres.match(/"frames": \[\{/gu) ?? []).length === ROWS, String((tres.match(/"frames": \[\{/gu) ?? []).length));
  let namesOk = true;
  for (const name of animationNames) {
    if (!tres.includes('"name": &"' + name + '"')) namesOk = false;
  }
  check("动画名按 <方向>_walk", namesOk, animationNames.join("、"));
  check("speed = fps、loop = true", tres.includes('"speed": 12') && (tres.match(/"loop": true/gu) ?? []).length === ROWS, "speed 12");
  check("每帧都有 duration", (tres.match(/"duration": 1\.0000/gu) ?? []).length === tresFrames);
  check("每帧都指向自己的 SubResource", (tres.match(/"texture": SubResource\("AtlasTexture_/gu) ?? []).length === tresFrames);
  check("metadata/autoplay 指向第一行动画", tres.includes('metadata/autoplay = "' + animationNames[0] + '"'));
  check("metadata/pivot 写的是归一化脚底线", tres.includes("metadata/pivot = Vector2(0.5, " + manifest.pivot.y + ")"), "pivot=" + manifest.pivot.y);
  // 结构自证：花括号 / 方括号配平（参考实现踩过「frames 数组缺开括号」的 P0）
  let depthCurly = 0;
  let depthSquare = 0;
  let balanced = true;
  for (const char of tres) {
    if (char === "{") depthCurly++;
    else if (char === "}") depthCurly--;
    else if (char === "[") depthSquare++;
    else if (char === "]") depthSquare--;
    if (depthCurly < 0 || depthSquare < 0) balanced = false;
  }
  check("结构配平（花括号 / 方括号都闭合）", balanced && depthCurly === 0 && depthSquare === 0, "{ }=" + depthCurly + " [ ]=" + depthSquare);
}

section("5) Aseprite JSON（frames + frameTags）");
const aseprite = JSON.parse(EXPORT.buildAsepriteJson(manifest, { image: "../sprite-sheet.png" }));
{
  const keys = Object.keys(aseprite.frames);
  check("frames 是全局连续数字键", keys.length === tresFrames && keys[0] === "0" && keys[tresFrames - 1] === String(tresFrames - 1), keys.slice(0, 3).join(",") + "…");
  check(
    "首帧矩形 = 首格",
    JSON.stringify(aseprite.frames["0"].frame) === JSON.stringify({ x: 0, y: 0, w: CELL_W, h: CELL_H }),
    JSON.stringify(aseprite.frames["0"].frame)
  );
  check("帧时长 = manifest 的 durationMs", aseprite.frames["0"].duration === manifest.frameLayout[0].durationMs, String(aseprite.frames["0"].duration));
  check("sourceSize = 单格尺寸", aseprite.frames["0"].sourceSize.w === CELL_W && aseprite.frames["0"].sourceSize.h === CELL_H);
  check("meta.image 指向整图", aseprite.meta.image === "../sprite-sheet.png", aseprite.meta.image);
  check(
    "meta.size = 整图尺寸、格式 RGBA8888",
    aseprite.meta.size.w === composed.width && aseprite.meta.size.h === composed.height && aseprite.meta.format === "RGBA8888"
  );
  check("frameTags 每个方向一段", aseprite.meta.frameTags.length === ROWS, String(aseprite.meta.frameTags.length));
  check(
    "首段 tag = front_walk / 0..3",
    aseprite.meta.frameTags[0].name === "front_walk" && aseprite.meta.frameTags[0].from === 0 && aseprite.meta.frameTags[0].to === COLUMNS - 1,
    JSON.stringify(aseprite.meta.frameTags[0])
  );
  check("末段 tag 覆盖到最后一帧", aseprite.meta.frameTags[ROWS - 1].to === tresFrames - 1, String(aseprite.meta.frameTags[ROWS - 1].to));
}

section("6) 真实整图端到端导出（模块①）");
const exportDir = () => STORE.assetPath(project.id, "out/engine/" + STEM);
{
  const pack = await EXPORT.exportSprite({
    projectId: project.id,
    formats: ["sheet", "frames", "manifest", "godot", "aseprite", "zip"],
    fps: 12
  });
  check(
    "返回 files / manifest / warnings / zip",
    Array.isArray(pack.files) && pack.manifest.format === "inkbox-sprite@1" && Array.isArray(pack.warnings) && typeof pack.zip === "string"
  );
  const withoutTime = (value) => {
    const copy = clone(value);
    delete copy.generatedAt;
    return JSON.stringify(copy);
  };
  check("manifest 与直接生成的完全一致（generatedAt 除外）", withoutTime(pack.manifest) === withoutTime(manifest));
  check("导出目录落在 out/engine/<名字>/", pack.root === "out/engine/" + STEM, pack.root);
  check(
    "文件数 = 整图 + manifest + tres + aseprite + README + " + tresFrames + " 帧 + zip",
    pack.files.length === 5 + tresFrames + 1,
    String(pack.files.length)
  );
  check("磁盘上 " + ROWS + " 个方向目录", (await readdir(join(exportDir(), "frames"))).sort().join(",") === [...DIRS.DIRECTION_KEYS].sort().join(","));
  const frontFrames = (await readdir(join(exportDir(), "frames", "front"))).sort();
  check("每方向 " + COLUMNS + " 张帧 PNG，编号 f00…f0" + (COLUMNS - 1), frontFrames.join(",") === "f00.png,f01.png,f02.png,f03.png", frontFrames.join(","));
  check("整图在包里逐字节不变", (await readFile(join(exportDir(), "sprite-sheet.png"))).equals(sheetPng));
  const manifestOnDisk = JSON.parse(await readFile(join(exportDir(), "manifest.json"), "utf8"));
  check("磁盘 manifest.json 与返回值一致", JSON.stringify(manifestOnDisk) === JSON.stringify(pack.manifest));
  check("godot/<名字>.tres 写出来了", existsSync(join(exportDir(), "godot", STEM + ".tres")));
  check("aseprite/<名字>.json 写出来了", existsSync(join(exportDir(), "aseprite", STEM + ".json")));
  check("README.txt 写出来了", existsSync(join(exportDir(), "README.txt")));

  // 逐帧像素核对：磁盘上的帧 PNG == 整图对应矩形（矩形按行列独立算，不复用切片函数）
  const sheetDecoded = EXPORT.decodePng(sheetPng);
  let sizeOk = true;
  let pixelOk = true;
  let colorOk = true;
  const problems = [];
  for (let index = 0; index < tresFrames; index++) {
    const row = Math.floor(index / COLUMNS);
    const col = index % COLUMNS;
    const direction = DIRS.DIRECTION_KEYS[row];
    const frameBytes = await readFile(join(exportDir(), "frames", direction, "f" + String(col).padStart(2, "0") + ".png"));
    const frameDecoded = EXPORT.decodePng(frameBytes);
    if (frameDecoded.width !== CELL_W || frameDecoded.height !== CELL_H) {
      sizeOk = false;
      problems.push(direction + "#" + col + " 尺寸 " + frameDecoded.width + "×" + frameDecoded.height);
      continue;
    }
    for (let y = 0; y < CELL_H; y++) {
      const from = ((row * CELL_H + y) * composed.width + col * CELL_W) * 4;
      if (!frameDecoded.rgba.subarray(y * CELL_W * 4, (y + 1) * CELL_W * 4).equals(sheetDecoded.rgba.subarray(from, from + CELL_W * 4))) {
        pixelOk = false;
        problems.push(direction + "#" + col + " 第 " + y + " 行");
        break;
      }
    }
    const center = ((CELL_H >> 1) * CELL_W + (CELL_W >> 1)) * 4;
    const expected = cellColor(row, col);
    const got = frameDecoded.rgba.subarray(center, center + 4);
    const near =
      Math.abs(got[0] - expected[0]) <= 2 && Math.abs(got[1] - expected[1]) <= 2 && Math.abs(got[2] - expected[2]) <= 2 && got[3] === 255;
    if (!near) {
      colorOk = false;
      problems.push(direction + "#" + col + " 中心色 " + Array.from(got).join(",") + " ≠ " + expected.join(","));
    }
  }
  check("每帧 PNG 尺寸 = 单格尺寸", sizeOk, problems.slice(0, 3).join("；"));
  check("每帧像素 = 整图对应矩形（逐字节）", pixelOk, problems.slice(0, 3).join("；"));
  check("帧顺序按行优先（每格中心色 = 该行列的颜色）", colorOk, problems.slice(0, 3).join("；"));

  const zipBytes = await readFile(STORE.assetPath(project.id, pack.zip));
  const entries = readZip(zipBytes);
  check("zip 打出来了且能真解包", entries.size > 0, entries.size + " 个条目");
  check("zip 条目数 = 整图 + manifest + tres + aseprite + README + " + tresFrames + " 帧", entries.size === 5 + tresFrames, String(entries.size));
  check("zip 条目都挂在 <名字>/ 下", [...entries.keys()].every((name) => name.startsWith(STEM + "/")), [...entries.keys()].slice(0, 3).join(", "));
  check("zip 里的整图与盘上逐字节一致", entries.get(STEM + "/sprite-sheet.png").equals(sheetPng));
  check(
    "zip 里的 manifest.json 与盘上一致",
    entries.get(STEM + "/manifest.json").equals(await readFile(join(exportDir(), "manifest.json")))
  );
  check(
    "zip 里的 .tres 与盘上一致",
    entries.get(STEM + "/godot/" + STEM + ".tres").equals(await readFile(join(exportDir(), "godot", STEM + ".tres")))
  );
  check(
    "zip 里的帧路径是 frames/<方向>/f0N.png",
    entries.has(STEM + "/frames/front/f00.png") && entries.has(STEM + "/frames/downRight/f03.png")
  );
  const freshProject = await STORE.readProject(project.id);
  check(
    "project.json 记下上次导出（文件数 / 格式 / 时间）",
    freshProject.export !== undefined &&
      Array.isArray(freshProject.export.files) &&
      freshProject.export.files.length === pack.files.length &&
      freshProject.export.formats.length === 6,
    JSON.stringify(freshProject.export?.formats ?? null)
  );

  // 再导出一次：同名覆盖，不残留上一次的旧文件
  const again = await EXPORT.exportSprite({ projectId: project.id, formats: ["manifest"], fps: 12 });
  const leftover = (await readdir(exportDir())).sort();
  check("同名再导出会清掉上次的产物目录", leftover.join(",") === "README.txt,manifest.json,sprite-sheet.png", leftover.join(","));
  check("再导出只写勾选的内容", again.files.length === 3, again.files.join(", "));
}

section("7) 模块③：单行条图导出（jobId）");
{
  const job = await SEQ.createSequenceJob("序列导出测试");
  const jobDraft = await SEQ.readSequenceJob(job.id);
  jobDraft.settings.cellWidth = 40;
  jobDraft.settings.cellHeight = 48;
  jobDraft.settings.frameCount = 4;
  await SEQ.writeSequenceJob(jobDraft);

  const stripWidth = 40 * 4;
  const stripHeight = 48;
  const strip = Buffer.alloc(stripWidth * stripHeight * 4);
  for (let col = 0; col < 4; col++) {
    const color = cellColor(col, 2);
    for (let y = 0; y < stripHeight; y++) {
      for (let x = col * 40; x < (col + 1) * 40; x++) {
        const at = (y * stripWidth + x) * 4;
        strip[at] = color[0];
        strip[at + 1] = color[1];
        strip[at + 2] = color[2];
        strip[at + 3] = 255;
      }
    }
  }
  const stripRelative = "out/sequence-strip.png";
  await mkdir(SEQ.sequenceAssetPath(job.id, "out"), { recursive: true });
  await writeFile(SEQ.sequenceAssetPath(job.id, stripRelative), PNG.encodePng(strip, stripWidth, stripHeight));
  const freshJob = await SEQ.readSequenceJob(job.id);
  freshJob.sheet = { status: "ready", file: stripRelative, width: stripWidth, height: stripHeight, updatedAt: Date.now() };
  await SEQ.writeSequenceJob(freshJob);

  const pack = await EXPORT.exportSprite({ jobId: job.id, formats: ["manifest", "godot", "aseprite", "frames", "zip"], fps: 10 });
  check(
    "单行 manifest：rows = 1 / directions = [action]",
    pack.manifest.rows === 1 && pack.manifest.directions.length === 1 && pack.manifest.directions[0] === "action"
  );
  check("单行 manifest：columns 由条图宽度反推", pack.manifest.columns === 4, String(pack.manifest.columns));
  check(
    "单行 manifest 的 source 带 jobId / module=sequence",
    pack.manifest.source.jobId === job.id && pack.manifest.source.module === "sequence",
    JSON.stringify({ jobId: pack.manifest.source.jobId, module: pack.manifest.source.module })
  );
  const seqOut = "out/engine/序列导出测试";
  const seqTres = await readFile(SEQ.sequenceAssetPath(job.id, seqOut + "/godot/序列导出测试.tres"), "utf8");
  check("单行 .tres 只有一个动画，名字是 action", (seqTres.match(/"frames": \[\{/gu) ?? []).length === 1 && seqTres.includes('"name": &"action"'));
  check("单行 .tres 引用的纹理路径带任务名", seqTres.includes("res://inkbox/序列导出测试/sprite-sheet.png"));
  const seqAseprite = JSON.parse(await readFile(SEQ.sequenceAssetPath(job.id, seqOut + "/aseprite/序列导出测试.json"), "utf8"));
  check(
    "单行 Aseprite：一个 tag 覆盖 0..3",
    seqAseprite.meta.frameTags.length === 1 && seqAseprite.meta.frameTags[0].from === 0 && seqAseprite.meta.frameTags[0].to === 3,
    JSON.stringify(seqAseprite.meta.frameTags)
  );
  check("单行帧序列落在 frames/action/", existsSync(SEQ.sequenceAssetPath(job.id, seqOut + "/frames/action/f03.png")));
  const freshSeq = await SEQ.readSequenceJob(job.id);
  check("任务 job.json 记下上次导出", freshSeq.export !== undefined && freshSeq.export.formats.length === 5, JSON.stringify(freshSeq.export?.formats ?? null));
  check("单行导出默认 10 fps（未显式给 fps 时的兜底）", pack.manifest.fps === 10, String(pack.manifest.fps));
}

section("8) 边界与错误（每条都要有明确 code）");
{
  const empty = await STORE.createProject("空项目");
  await expectCode("没有整图 → sheet-missing", "sheet-missing", () => EXPORT.exportSprite({ projectId: empty.id }));
  await expectCode("未知导出内容 → format-invalid", "format-invalid", () => EXPORT.exportSprite({ projectId: project.id, formats: ["exe"] }));
  await expectCode("一个内容都不勾 → export-empty", "export-empty", () => EXPORT.exportSprite({ projectId: project.id, formats: [] }));
  await expectCode("不给目标 → target-missing", "target-missing", () => EXPORT.exportSprite({}));
  await expectCode("同时给 projectId 与 jobId → target-ambiguous", "target-ambiguous", () =>
    EXPORT.exportSprite({ projectId: project.id, jobId: "sabcdef" })
  );
  await expectCode("项目不存在 → project-not-found", "project-not-found", () => EXPORT.exportSprite({ projectId: "pdeadbeef" }));
  await expectCode("任务不存在 → job-not-found", "job-not-found", () => EXPORT.exportSprite({ jobId: "sdeadbeef" }));

  // 单格尺寸改过但没重新合成整图：必须拦下来，不许导出一张切歪的图
  // 整图记录里的单格尺寸被改过（例如手改了 project.json）→ 与整图实际尺寸对不上
  await STORE.patchProject(project.id, (draft) => {
    draft.sheet.cellWidth = CELL_W + 16;
  });
  await expectCode("单格尺寸与整图不符 → sheet-size-mismatch", "sheet-size-mismatch", () => EXPORT.exportSprite({ projectId: project.id }));
  await STORE.patchProject(project.id, (draft) => {
    draft.sheet.cellWidth = CELL_W;
  });

  // 只勾 zip：按「全部内容」兜底，并给出 warning
  const onlyZip = await EXPORT.exportSprite({ projectId: project.id, formats: ["zip"], fps: 12 });
  check(
    "只勾 zip 时按全部内容打包",
    onlyZip.manifest.format === "inkbox-sprite@1" && onlyZip.warnings.some((text) => text.includes("只勾了 zip")),
    onlyZip.warnings.join(" | ")
  );
  check(
    "只勾 zip 时包里也有 manifest / tres / aseprite",
    onlyZip.files.some((file) => file.endsWith("manifest.json")) && onlyZip.files.some((file) => file.endsWith(".tres"))
  );
}

section("9) 配置 exportDefaults（设计 §9.1）");
{
  check("DEFAULT_CONFIG.exportDefaults = [manifest]", JSON.stringify(CONFIG.DEFAULT_CONFIG.exportDefaults) === JSON.stringify(["manifest"]));
  const saved = await CONFIG.saveConfig({ exportDefaults: ["zip", "manifest", "bogus", "manifest"] });
  check(
    "保存时收敛成已知 id、去重、固定顺序",
    JSON.stringify(saved.exportDefaults) === JSON.stringify(["manifest", "zip"]),
    JSON.stringify(saved.exportDefaults)
  );
  const emptyDefaults = await CONFIG.saveConfig({ exportDefaults: [] });
  check("空数组回落到默认", JSON.stringify(emptyDefaults.exportDefaults) === JSON.stringify(["manifest"]), JSON.stringify(emptyDefaults.exportDefaults));
  const fallback = await CONFIG.saveConfig({ exportDefaults: ["nope"] });
  check("全是非法值也回落到默认", JSON.stringify(fallback.exportDefaults) === JSON.stringify(["manifest"]), JSON.stringify(fallback.exportDefaults));
}

section("10) 协议 / 接线契约（新方法必须 wire + 客户端清单 + 工具面 + 不进付费清单）");
{
  const WIRE = await import("../lib/wire.js");
  const spec = WIRE.METHODS.find((entry) => entry.method === "exportSprite");
  check("wire METHODS 里注册了 exportSprite", spec !== undefined);
  check("exportSprite 带 payload schema", spec !== undefined && spec.payload !== undefined);
  const parsed = spec.payload.parse({ projectId: "p1", formats: ["manifest", "zip"], name: "hero", fps: 12, loop: false });
  check(
    "payload 的六个键都被保留（typert 不会静默丢键）",
    parsed.projectId === "p1" &&
      Array.isArray(parsed.formats) &&
      parsed.formats.join(",") === "manifest,zip" &&
      parsed.name === "hero" &&
      parsed.fps === 12 &&
      parsed.loop === false,
    JSON.stringify(parsed)
  );
  const jobParsed = spec.payload.parse({ jobId: "s1", formats: ["godot"] });
  check("jobId 也能过 schema（模块③）", jobParsed.jobId === "s1", JSON.stringify(jobParsed));
  let rejected = false;
  try {
    spec.payload.parse({ projectId: "p1", formats: ["exe"] });
  } catch {
    rejected = true;
  }
  check("未知 formats 被 schema 拒绝", rejected);

  const readText = (relative) => readFileSync(new URL("../" + relative, import.meta.url), "utf8");
  const remoteSource = readText("src/client/platform/remote.ts");
  check("客户端远程清单登记了 exportSprite（收 payload）", /\["exportSprite",\s*true\]/u.test(remoteSource));
  const applySource = readText("src/client/shell/apply.ts");
  check("客户端 api 有 exportSprite 入口", /exportSprite:\s*\(payload\)\s*=>\s*call\("exportSprite"/u.test(applySource));
  const toolsSource = readText("src/tools.ts");
  check("工具面把 exportSprite 归到模块（隐藏模块能拦住）", /exportSprite:\s*"sprite"/u.test(toolsSource));
  const guidesSource = readText("src/toolguides.ts");
  check("guide 手册写了 exportSprite（① 与 ③ 各一处）", guidesSource.split("exportSprite").length - 1 >= 2, (guidesSource.split("exportSprite").length - 1) + " 处");
  const indexSource = readText("src/index.ts");
  const paidAt = indexSource.indexOf("PAID_METHODS");
  const paidBlockEnd = indexSource.indexOf("]", paidAt);
  const paidBlock = paidAt < 0 ? "" : indexSource.slice(paidAt, paidBlockEnd);
  check("本地能力不进付费清单 PAID_METHODS", paidBlock !== "" && !paidBlock.includes("exportSprite"), paidBlock.slice(0, 60).replace(/\n/gu, " "));
  const configPatchSource = readText("src/configpatch.ts");
  check("exportDefaults 在 saveConfig 白名单里", configPatchSource.includes('"exportDefaults"'));
  const bundleText = readText("lib/client.js");
  check("构建产物里带引擎导出卡文案", bundleText.includes("引擎导出") && bundleText.includes("导出到引擎"));
}

await rm(HOME, { recursive: true, force: true });

console.log("");
if (failures.length > 0) {
  console.error("失败 " + failures.length + " 项：");
  for (const item of failures) console.error("  - " + item);
  process.exit(1);
}
console.log("共 " + passed + " 项检查，全部通过。");
process.exit(0);


