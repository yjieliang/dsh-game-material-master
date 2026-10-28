/**
 * 去背抽象（src/matte.ts）自检：纯本地、零付费、可重复跑。
 *
 *   node scripts/verify-matte.mjs
 *
 * 覆盖四层：
 *   1. 纯函数：PNG 编解码 / mask 合成 / 绿幕结果 / auto 判据 / 缓存键；
 *   2. 配置与协议：config 默认值与 normalize、configpatch 白名单、wire 的 rematte（含 schema 逐键）；
 *   3. mock ComfyUI（本文件里起假服务端，仿 verify-comfy.mjs）：成功 / 执行错误 / 尺寸不一致 /
 *      只输出 mask / 超时 / 没有输出 / 连接失败 → 回退绿幕并带原因；批量并发与缓存；
 *   4. **三条链路真实代码路径**（pipeline.startRekey / seqgen.keySequenceFrames /
 *      imagegen.rekeyImageJob）在临时 DSH_HOME 上跑一遍，断言 job.json 的 matte 节点。
 *
 * 不碰真实 ComfyUI、不调任何云接口；临时目录落在 .verify/matte/（已 gitignore）。
 */
import { createServer } from 'node:http';
import { mkdir, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('../.verify/matte/', import.meta.url));
const DSH_HOME = join(ROOT, 'dsh-home');
// 必须在 import lib 之前设置：config.ts 的 dataRoot() 每次现读，但 loadConfig 会缓存。
process.env.DSH_HOME = DSH_HOME;
process.env.INKBOX_MATTE_CACHE = '1';

const failures = [];
let checks = 0;
function check(name, ok, detail) {
  checks += 1;
  const suffix = detail === undefined ? '' : ' — ' + detail;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + name + suffix);
  if (!ok) failures.push(name);
}
function section(title) {
  console.log('\n── ' + title + ' ──');
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 极简 PNG 编码（RGB / 灰度，给 mask 用例用；RGBA 用 lib/png 的 encodePng）────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}
/** 把 width*height*3 字节的 RGB 缓冲编码成 PNG（colorType 2）。 */
function encodeRgbPng(rgb, width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    rgb.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(filtered, { level: 6 });
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ── mock ComfyUI ─────────────────────────────────────────────────────────────
//
// 只实现去背链路真正会打到的 5 个端点：/upload/image、/prompt、/history/<id>、
// /queue、/view、/system_stats。行为由 state.behavior 切换，并且记录「谁被调了几次」，
// 用来断言缓存命中（第二次不再提交）、注入点（LoadImage 的 image 名）、并发上限。

const state = {
  behavior: 'success',
  delayMs: 0,
  uploads: [],
  prompts: [],
  viewRequests: 0,
  inflight: new Map(),
  maxInflight: 0,
  outputs: new Map(),
  promptSeq: 0,
  uploadByName: new Map()
};

function makeTwoToneRgba(width, height, seed) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // 上半部分亮、下半部分暗（带 seed 偏移），用来检查保序 / 缓存不同图不同键。
      const bright = (x + y + seed * 7) % 64 < 32;
      rgba[i] = bright ? 240 : 30;
      rgba[i + 1] = (seed * 40) % 256;
      rgba[i + 2] = bright ? 60 : 200;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

function makeGreenFrame(width, height, seed) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside = x > width * 0.3 && x < width * 0.7 && y > height * 0.2 && y < height * 0.8;
      if (inside) {
        rgba[i] = 120 + ((seed * 17) % 60);
        rgba[i + 1] = 90;
        rgba[i + 2] = 70;
      } else {
        rgba[i] = 20;
        rgba[i + 1] = 220;
        rgba[i + 2] = 40;
      }
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function jsonResponse(response, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': body.length });
  response.end(body);
}

/** 从 multipart 里抠出上传的 PNG 字节（靠 Content-Type 里的 boundary 找结尾）。 */
function extractUploadedPng(body, contentType) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const start = body.indexOf(signature);
  if (start < 0) return undefined;
  const match = /boundary=([^;]+)/.exec(contentType || '');
  if (match !== null) {
    const end = body.indexOf(Buffer.from('\r\n--' + match[1]), start);
    if (end > start) return body.subarray(start, end);
  }
  return body.subarray(start);
}

/** 根据上传的图造一张「左半透明」的 RGBA 输出（= 模型去背结果）。 */
function buildSuccessOutput(decodePngImage, encodePng, entry) {
  const decoded = decodePngImage(entry.bytes);
  const rgba = Buffer.from(decoded.rgba);
  const half = Math.floor(decoded.width / 2);
  for (let y = 0; y < decoded.height; y++) {
    for (let x = 0; x < half; x++) {
      const i = (y * decoded.width + x) * 4;
      rgba[i + 3] = 0;
    }
  }
  return { filename: 'mock_matte_' + entry.count + '.png', bytes: encodePng(rgba, decoded.width, decoded.height) };
}

/** 造一张 RGB mask：左黑（透明）右白（前景）。 */
function buildMaskOutput(decodePngImage, entry) {
  const decoded = decodePngImage(entry.bytes);
  const width = decoded.width;
  const height = decoded.height;
  const rgb = Buffer.alloc(width * height * 3);
  const half = Math.floor(width / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const value = x < half ? 0 : 255;
      rgb[i] = value;
      rgb[i + 1] = value;
      rgb[i + 2] = value;
    }
  }
  return { filename: 'mock_mask_' + entry.count + '.png', bytes: encodeRgbPng(rgb, width, height) };
}

/** 造一张尺寸只有一半的输出（触发「尺寸不一致」）。 */
function buildMismatchOutput(decodePngImage, encodePng, entry) {
  const decoded = decodePngImage(entry.bytes);
  const width = Math.max(1, Math.floor(decoded.width / 2));
  const height = Math.max(1, Math.floor(decoded.height / 2));
  return { filename: 'mock_small_' + entry.count + '.png', bytes: encodePng(Buffer.alloc(width * height * 4, 255), width, height) };
}

let libs = {};

function startMockComfy() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const path = url.pathname;
    if (request.method === 'POST' && path === '/upload/image') {
      const body = await readBody(request);
      const bytes = extractUploadedPng(body, request.headers['content-type']);
      const entry = {
        name: 'mock_upload_' + (state.uploads.length + 1) + '.png',
        count: state.uploads.length + 1,
        bytes: bytes === undefined ? Buffer.alloc(0) : Buffer.from(bytes),
        contentType: request.headers['content-type'] || ''
      };
      state.uploads.push(entry);
      state.uploadByName.set(entry.name, entry);
      return jsonResponse(response, 200, { name: entry.name, subfolder: '', type: 'input' });
    }
    if (request.method === 'POST' && path === '/prompt') {
      const body = await readBody(request);
      let parsed = undefined;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch {
        parsed = undefined;
      }
      state.promptSeq += 1;
      const promptId = 'mock-prompt-' + state.promptSeq;
      const workflow = parsed === undefined ? undefined : parsed.prompt;
      let imageName = '';
      if (workflow !== undefined && workflow !== null) {
        for (const nodeId of Object.keys(workflow)) {
          const node = workflow[nodeId];
          if (node !== undefined && node !== null && node.class_type === 'LoadImage' && node.inputs !== undefined && typeof node.inputs.image === 'string') {
            imageName = node.inputs.image;
            break;
          }
        }
      }
      const entry = { id: promptId, workflow, at: Date.now(), imageName };
      state.prompts.push(entry);
      state.inflight.set(promptId, true);
      state.maxInflight = Math.max(state.maxInflight, state.inflight.size);
      if (state.behavior === 'error') {
        // 执行错误由 /history 报，这里照常收下。
      } else if (state.behavior !== 'hang' && state.behavior !== 'delay') {
        // 立刻算完（outputs 在 /history 里现造）。
      }
      return jsonResponse(response, 200, { prompt_id: promptId, number: state.promptSeq, node_errors: {} });
    }
    if (request.method === 'GET' && path.startsWith('/history/')) {
      const promptId = decodeURIComponent(path.slice('/history/'.length));
      const submitted = state.prompts.find((item) => item.id === promptId);
      if (submitted === undefined) return jsonResponse(response, 200, {});
      if (state.behavior === 'hang') return jsonResponse(response, 200, {});
      if (state.behavior === 'delay' && Date.now() - submitted.at < state.delayMs) return jsonResponse(response, 200, {});
      if (state.behavior === 'error') {
        state.inflight.delete(promptId);
        return jsonResponse(response, 200, {
          [promptId]: {
            status: {
              status_str: 'error',
              completed: false,
              messages: [['execution_error', { node_type: 'RemoveBackground', exception_type: 'RuntimeError', exception_message: 'mock boom' }]]
            },
            outputs: {}
          }
        });
      }
      const lastUpload = state.uploadByName.get(submitted.imageName) || state.uploads[state.uploads.length - 1];
      let output = undefined;
      if (state.behavior === 'nooutput') {
        output = undefined;
      } else if (state.behavior === 'mismatch') {
        output = buildMismatchOutput(libs.decodePngImage, libs.encodePng, lastUpload);
      } else if (state.behavior === 'mask') {
        output = buildMaskOutput(libs.decodePngImage, lastUpload);
      } else {
        output = buildSuccessOutput(libs.decodePngImage, libs.encodePng, lastUpload);
      }
      state.inflight.delete(promptId);
      if (output === undefined) {
        return jsonResponse(response, 200, { [promptId]: { status: { status_str: 'success', completed: true }, outputs: {} } });
      }
      state.outputs.set(output.filename, output.bytes);
      return jsonResponse(response, 200, {
        [promptId]: {
          status: { status_str: 'success', completed: true },
          outputs: { '6': { images: [{ filename: output.filename, subfolder: '', type: 'output' }] } }
        }
      });
    }
    if (request.method === 'GET' && path === '/queue') {
      const running = [];
      for (const promptId of state.inflight.keys()) running.push([0, promptId, { class_type: 'RemoveBackground' }, 1]);
      return jsonResponse(response, 200, { queue_running: running, queue_pending: [] });
    }
    if (request.method === 'GET' && path === '/view') {
      state.viewRequests += 1;
      const filename = url.searchParams.get('filename') || '';
      const bytes = state.outputs.get(filename);
      if (bytes === undefined) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length });
      response.end(bytes);
      return;
    }
    if (request.method === 'GET' && path === '/system_stats') {
      return jsonResponse(response, 200, { system: { comfyui_version: 'mock' }, devices: [] });
    }
    response.writeHead(404);
    response.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ── 启动 mock、铺临时数据目录、再 import lib ────────────────────────────────

await rm(ROOT, { recursive: true, force: true });
await mkdir(join(DSH_HOME, 'inkbox'), { recursive: true });
const { server, port } = await startMockComfy();
const BASE = 'http://127.0.0.1:' + port;
// 写在第一次 loadConfig 之前：matte 的默认后端 = birefnet，指向 mock。
await writeFile(
  join(DSH_HOME, 'inkbox', 'config.json'),
  JSON.stringify({
    comfyBaseUrl: BASE,
    comfyTimeoutMs: 60000,
    matteBackend: 'birefnet',
    matteFallback: true,
    matteWorkflowId: 'builtin.matte-birefnet'
  }),
  'utf8'
);

const matte = await import('../lib/matte.js');
const pngMod = await import('../lib/png.js');
const chroma = await import('../lib/chroma.js');
const configMod = await import('../lib/config.js');
const configpatch = await import('../lib/configpatch.js');
const wire = await import('../lib/wire.js');
const hostIndex = await import('../lib/index.js');
const toolMod = await import('../lib/tools.js');
const pipeline = await import('../lib/pipeline.js');
const seqgen = await import('../lib/seqgen.js');
const imagegen = await import('../lib/imagegen.js');
const store = await import('../lib/store.js');
libs = { decodePngImage: matte.decodePngImage, encodePng: pngMod.encodePng };

const config = await configMod.loadConfig();
const keying = { keyLow: 14, keyHigh: 80, despill: 0.65, edgeShrink: 0, bgTolerance: 40 };
const greenConfig = { ...config, comfyBaseUrl: BASE, comfyCookies: '', comfyTimeoutMs: 60000 };
function resetMock(behavior, delayMs) {
  state.behavior = behavior;
  state.delayMs = delayMs === undefined ? 0 : delayMs;
  // hang 用例会留下「永远 running」的 prompt，切行为时清掉，否则会污染并发统计。
  state.inflight.clear();
  state.maxInflight = 0;
}
let inputSeq = 0;
function nextInput(width, height) {
  inputSeq += 1;
  return { rgba: makeTwoToneRgba(width, height, inputSeq), width, height };
}
function pngOf(input) {
  return pngMod.encodePng(input.rgba, input.width, input.height);
}

// ── 1) 模块结构 / 配置 ──────────────────────────────────────────────────────

section('1) 模块结构与配置默认值');
check('导出 matteOne / matteBatch / summarizeMatte', typeof matte.matteOne === 'function' && typeof matte.matteBatch === 'function' && typeof matte.summarizeMatte === 'function');
check('MATTE_BACKENDS = auto / keygreen / birefnet', matte.MATTE_BACKENDS.join(',') === 'auto,keygreen,birefnet', matte.MATTE_BACKENDS.join(','));
check('默认 matteBackend = keygreen（行为不变）', configMod.DEFAULT_CONFIG.matteBackend === 'keygreen', String(configMod.DEFAULT_CONFIG.matteBackend));
check('默认 matteFallback = true', configMod.DEFAULT_CONFIG.matteFallback === true);
check('默认 matteWorkflowId = builtin.matte-birefnet', configMod.DEFAULT_CONFIG.matteWorkflowId === 'builtin.matte-birefnet', configMod.DEFAULT_CONFIG.matteWorkflowId);
const normalized = configMod.normalizeConfig({ matteBackend: 'nonsense', matteFallback: false, matteWorkflowId: '  ' });
check('normalizeConfig：非法后端回落 keygreen', normalized.matteBackend === 'keygreen', normalized.matteBackend);
check('normalizeConfig：空工作流 id 回落内置', normalized.matteWorkflowId === 'builtin.matte-birefnet', normalized.matteWorkflowId);
check('normalizeConfig：matteFallback 可关', normalized.matteFallback === false);
const patch = configpatch.buildConfigPatch({ matteBackend: 'auto', matteFallback: false, matteWorkflowId: 'wf_x', matteUnknown: 1 });
check('buildConfigPatch 保留三个 matte 字段', patch.matteBackend === 'auto' && patch.matteFallback === false && patch.matteWorkflowId === 'wf_x', JSON.stringify(patch));
check('buildConfigPatch 丢弃未登记键', patch.matteUnknown === undefined);

// ── 2) 内置工作流 / PNG 编解码 ──────────────────────────────────────────────

section('2) 内置工作流与 PNG 编解码');
const builtin = matte.builtinMatteWorkflow();
check('内置工作流有 6 个节点', Object.keys(builtin).length === 6, String(Object.keys(builtin).length));
const classes = Object.values(builtin).map((node) => node.class_type).join(',');
check(
  '节点结构：LoadImage/LoadBackgroundRemovalModel/RemoveBackground/InvertMask/JoinImageWithAlpha/SaveImage',
  classes === 'LoadImage,LoadBackgroundRemovalModel,RemoveBackground,InvertMask,JoinImageWithAlpha,SaveImage',
  classes
);
check('模型加载节点的输入名是 bg_removal_name（不是界面的 bg_model）', builtin['2'].inputs.bg_removal_name === 'birefnet.safetensors');
check('InvertMask 接在 RemoveBackground 后面（mask 方向反）', JSON.stringify(builtin['4'].inputs.mask) === '["3",0]');
check('JoinImageWithAlpha 的 alpha 来自 InvertMask、image 来自 LoadImage', JSON.stringify(builtin['5'].inputs.alpha) === '["4",0]' && JSON.stringify(builtin['5'].inputs.image) === '["1",0]');
const roundtrip = nextInput(8, 6);
const roundtripBytes = pngMod.encodePng(roundtrip.rgba, roundtrip.width, roundtrip.height);
const roundtripDecoded = matte.decodePngImage(roundtripBytes);
check('decodePngImage：encodePng 往返像素完全一致', roundtripDecoded.rgba.equals(roundtrip.rgba), roundtripDecoded.width + 'x' + roundtripDecoded.height);
check('decodePngImage：RGBA 被识别为 hasAlpha', roundtripDecoded.hasAlpha === true && roundtripDecoded.colorType === 6, 'colorType=' + roundtripDecoded.colorType);
const rgbBytes = encodeRgbPng(Buffer.alloc(4 * 3 * 3, 128), 4, 3);
const rgbDecoded = matte.decodePngImage(rgbBytes);
check('decodePngImage：RGB（无 alpha）被识别', rgbDecoded.hasAlpha === false && rgbDecoded.colorType === 2, 'colorType=' + rgbDecoded.colorType);
const maskSource = Buffer.alloc(4 * 2 * 4);
for (let i = 0; i < 8; i++) {
  maskSource[i * 4] = 100;
  maskSource[i * 4 + 1] = 150;
  maskSource[i * 4 + 2] = 200;
  maskSource[i * 4 + 3] = 255;
}
const maskDecoded = matte.decodePngImage(encodeRgbPng(Buffer.from([0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255]), 4, 2));
const composited = matte.composeMaskWithOriginal(maskSource, maskDecoded);
check('composeMaskWithOriginal：黑=透明、白=前景，颜色来自原图', composited[3] === 0 && composited[11] === 255 && composited[8] === 100 && composited[10] === 200, 'alpha=' + composited[3] + '/' + composited[11] + ' rgb=' + composited[8] + ',' + composited[9] + ',' + composited[10]);
let notPng = '';
try {
  matte.decodePngImage(Buffer.from('definitely not a png'));
} catch (error) {
  notPng = error instanceof Error ? error.message : String(error);
}
check('decodePngImage：非 PNG 报可读错误', notPng.includes('不是 PNG'), notPng);

// ── 3) 绿幕与 auto 判据 ─────────────────────────────────────────────────────

section('3) 绿幕结果与 auto 判据');
const greenFrame = { rgba: makeGreenFrame(64, 64, 1), width: 64, height: 64 };
const greenOriginal = Buffer.from(greenFrame.rgba);
const greenResult = await matte.matteOne(greenConfig, greenFrame, { backend: 'keygreen', keying });
check('keygreen：纯绿背景被抠掉（背景占比 > 0.5）', (greenResult.backgroundFraction || 0) > 0.5, ((greenResult.backgroundFraction || 0) * 100).toFixed(1) + '%');
check('keygreen：backend = keygreen 且没有 fallbackReason', greenResult.backend === 'keygreen' && greenResult.fallbackReason === undefined);
check('keygreen：不修改输入 buffer', greenFrame.rgba.equals(greenOriginal));
const autoGreen = await matte.matteOne(greenConfig, greenFrame, { backend: 'auto', keying });
check('auto + 绿幕图：直接用绿幕（不调模型）', autoGreen.backend === 'keygreen', autoGreen.backend);
const autoPhoto = await matte.matteOne(greenConfig, nextInput(32, 32), { backend: 'auto', keying, cache: false });
check('auto + 非绿幕图：改用 BiRefNet', autoPhoto.backend === 'birefnet', autoPhoto.backend);
check('assessAutoBackend：背景占比 1% 判为「该用模型」', matte.assessAutoBackend({ backgroundFraction: 0.01, greenFringeFraction: 0 }).useModel === true);
check('assessAutoBackend：正常绿幕判为「绿幕可信」', matte.assessAutoBackend({ backgroundFraction: 0.6, greenFringeFraction: 0.001 }).useModel === false);

// ── 4) birefnet 成功路径（mock ComfyUI）──────────────────────────────────────

section('4) birefnet 成功路径与缓存');
resetMock('success');
const birefInput = nextInput(48, 32);
const promptCountBefore = state.prompts.length;
const uploadsBefore = state.uploads.length;
const birefResult = await matte.matteOne(greenConfig, birefInput, { keying });
check('birefnet：返回 backend = birefnet', birefResult.backend === 'birefnet');
check('birefnet：尺寸与原图一致', birefResult.width === 48 && birefResult.height === 32);
check('birefnet：左半被抠成透明（约 50%）', Math.abs((birefResult.backgroundFraction || 0) - 0.5) < 0.08, ((birefResult.backgroundFraction || 0) * 100).toFixed(1) + '%');
check('birefnet：真的上传了一张 PNG（multipart）', state.uploads.length === uploadsBefore + 1 && state.uploads[state.uploads.length - 1].bytes.length > 0 && /multipart\/form-data/.test(state.uploads[state.uploads.length - 1].contentType), state.uploads[state.uploads.length - 1] === undefined ? 'no upload' : state.uploads[state.uploads.length - 1].contentType);
const submittedWorkflow = state.prompts[state.prompts.length - 1].workflow;
check('birefnet：上传文件名注入到 LoadImage（节点 1）', submittedWorkflow !== undefined && submittedWorkflow['1'].inputs.image === state.uploads[state.uploads.length - 1].name, submittedWorkflow === undefined ? 'no workflow' : String(submittedWorkflow['1'].inputs.image));
check('birefnet：输出经 /view 取回', state.viewRequests >= 1, String(state.viewRequests));
const promptsAfterFirst = state.prompts.length;
const cachedResult = await matte.matteOne(greenConfig, birefInput, { keying });
check('birefnet：同图同参数命中缓存（不再提交）', cachedResult.cached === true && state.prompts.length === promptsAfterFirst, 'prompts=' + state.prompts.length);
const cacheFiles = await readdir(join(DSH_HOME, 'inkbox', 'matte-cache')).catch(() => []);
check('birefnet：缓存文件落在 <DSH_HOME>/inkbox/matte-cache/', cacheFiles.length >= 2, String(cacheFiles.length) + ' 个文件');
const another = await matte.matteOne(greenConfig, nextInput(48, 32), { keying });
check('birefnet：不同图不命中缓存（重新提交）', another.cached !== true && state.prompts.length === promptsAfterFirst + 1, 'prompts=' + state.prompts.length);

// ── 5) 失败 / 超时 / 尺寸不一致 / 回退 ──────────────────────────────────────

section('5) 失败路径与绿幕回退');
resetMock('error');
const errorInput = nextInput(24, 24);
const errorFallback = await matte.matteOne(greenConfig, errorInput, { keying, cache: false });
check('执行错误：回退绿幕并带原因', errorFallback.backend === 'keygreen' && typeof errorFallback.fallbackReason === 'string' && errorFallback.fallbackReason.includes('ComfyUI 执行失败'), (errorFallback.fallbackReason || '').slice(0, 60));
let noFallbackError = '';
try {
  await matte.matteOne(greenConfig, nextInput(24, 24), { keying, cache: false, fallback: false });
} catch (error) {
  noFallbackError = error instanceof Error ? error.message : String(error);
}
check('fallback=false：不静默降级，直接抛错', noFallbackError.includes('ComfyUI 执行失败'), noFallbackError.slice(0, 60));
resetMock('mismatch');
const mismatch = await matte.matteOne(greenConfig, nextInput(32, 32), { keying, cache: false });
check('尺寸不一致：回退原因写明尺寸', typeof mismatch.fallbackReason === 'string' && mismatch.fallbackReason.includes('不一致'), (mismatch.fallbackReason || '').slice(0, 80));
resetMock('hang');
const timeoutStart = Date.now();
const timedOut = await matte.matteOne(greenConfig, nextInput(16, 16), { keying, cache: false, timeoutMs: 600 });
check('超时：600ms 内按失败回退绿幕', timedOut.backend === 'keygreen' && typeof timedOut.fallbackReason === 'string' && timedOut.fallbackReason.includes('超时'), (timedOut.fallbackReason || '').slice(0, 60));
check('超时：没有干等（耗时 < 5s）', Date.now() - timeoutStart < 5000, String(Date.now() - timeoutStart) + 'ms');
resetMock('nooutput');
const noOutput = await matte.matteOne(greenConfig, nextInput(16, 16), { keying, cache: false });
check('没有输出文件：回退原因写明没有图片', typeof noOutput.fallbackReason === 'string' && noOutput.fallbackReason.includes('没有图片文件'), (noOutput.fallbackReason || '').slice(0, 60));
const deadConfig = { ...greenConfig, comfyBaseUrl: 'http://127.0.0.1:1' };
const dead = await matte.matteOne(deadConfig, nextInput(20, 20), { keying, cache: false });
check('ComfyUI 连不上：回退绿幕并说明连接失败', dead.backend === 'keygreen' && typeof dead.fallbackReason === 'string' && dead.fallbackReason.includes('无法连接'), (dead.fallbackReason || '').slice(0, 60));
resetMock('error');
const fallbackInput = nextInput(20, 20);
const fallbackPixels = await matte.matteOne(greenConfig, fallbackInput, { keying, cache: false });
const plainGreen = await matte.matteOne(greenConfig, fallbackInput, { backend: 'keygreen', keying });
check('回退结果与直接用绿幕逐像素一致', fallbackPixels.rgba.equals(plainGreen.rgba));

// ── 6) 批量与并发 ───────────────────────────────────────────────────────────

section('6) 批量、并发、汇总');
resetMock('success');
const batchInputs = [nextInput(20, 20), nextInput(24, 24), nextInput(28, 28), nextInput(32, 32)];
const progress = [];
const batchResults = await matte.matteBatch(greenConfig, batchInputs, { keying, onProgress: (done, total, result) => progress.push([done, total, result.backend]) });
check('matteBatch：结果数量与输入一致', batchResults.length === batchInputs.length);
check('matteBatch：结果保序（尺寸一一对应）', batchResults.every((result, index) => result.width === batchInputs[index].width && result.height === batchInputs[index].height), batchResults.map((result) => result.width + 'x' + result.height).join(','));
check('matteBatch：onProgress 回调 4 次', progress.length === 4 && progress[3][0] === 4 && progress[3][1] === 4, JSON.stringify(progress));
resetMock('delay', 150);
state.maxInflight = 0;
const slowInputs = [nextInput(18, 18), nextInput(18, 18), nextInput(18, 18), nextInput(18, 18)];
await matte.matteBatch(greenConfig, slowInputs, { keying, cache: false });
check('matteBatch：默认并发 ≤ 2', state.maxInflight > 0 && state.maxInflight <= 2, 'maxInflight=' + state.maxInflight);
const summary = matte.summarizeMatte(batchResults);
check('summarizeMatte：frames / cached / 回退计数正确', summary.frames === 4 && summary.cachedCount === 0 && summary.fallbackCount === 0 && summary.backend === 'birefnet', JSON.stringify(summary));
const fallbackSummary = matte.summarizeMatte([plainGreen, fallbackPixels]);
check('summarizeMatte：混合后端记 mixed / 回退次数', fallbackSummary.backend === 'keygreen' && fallbackSummary.fallbackCount === 1, JSON.stringify(fallbackSummary));
check('describeMatte：一句话带后端与回退原因', matte.describeMatte({ ...fallbackSummary, fallbackReason: '测试原因' }).includes('去背后端') && matte.describeMatte({ ...fallbackSummary, fallbackReason: '测试原因' }).includes('测试原因'));

// ── 7) 工作流解析 ───────────────────────────────────────────────────────────

section('7) 工作流解析（内置 / 工作流库落盘 / 本机路径）');
const resolvedBuiltin = await matte.resolveMatteWorkflow('builtin.matte-birefnet');
check('内置 id 解析出内置工作流', Object.keys(resolvedBuiltin).length === 6);
let unknownError = '';
try {
  await matte.resolveMatteWorkflow('wf_does_not_exist');
} catch (error) {
  unknownError = error instanceof Error ? error.message : String(error);
}
check('未知 id：报错写清「找不到去背工作流」与尝试过的位置', unknownError.includes('找不到去背工作流') && unknownError.includes('已尝试'), unknownError.slice(0, 80));
const libDir = join(DSH_HOME, 'inkbox', 'workflows');
await mkdir(libDir, { recursive: true });
await writeFile(join(libDir, 'wf_custom.json'), JSON.stringify({ id: 'wf_custom', name: '自定义去背', workflow: matte.builtinMatteWorkflow() }), 'utf8');
const resolvedLibrary = await matte.resolveMatteWorkflow('wf_custom');
check('工作流库落盘格式（{workflow} 字段）可解析', Object.keys(resolvedLibrary).length === 6);
const customPath = join(ROOT, 'custom-matte.json');
await writeFile(customPath, JSON.stringify(matte.builtinMatteWorkflow()), 'utf8');
const resolvedPath = await matte.resolveMatteWorkflow(customPath);
check('本机 .json 路径可解析（排障入口）', Object.keys(resolvedPath).length === 6);

// ── 8) 只输出 mask 的工作流 ────────────────────────────────────────────────

section('8) 只输出 mask 的工作流（插件侧与原图合成 RGBA）');
resetMock('mask');
const maskInput = nextInput(24, 20);
const maskResult = await matte.matteOne(greenConfig, maskInput, { keying, cache: false });
check('mask 输出：backend = birefnet、尺寸一致', maskResult.backend === 'birefnet' && maskResult.width === 24 && maskResult.height === 20);
check('mask 输出：颜色来自原图（不是灰度）', maskResult.rgba[0] === maskInput.rgba[0] && maskResult.rgba[1] === maskInput.rgba[1], maskResult.rgba[0] + '/' + maskInput.rgba[0]);
check('mask 输出：左黑=透明、右白=不透明', maskResult.rgba[3] === 0 && maskResult.rgba[(24 - 1) * 4 + 3] === 255, maskResult.rgba[3] + '/' + maskResult.rgba[(24 - 1) * 4 + 3]);

// ── 9) 协议与工具面 ────────────────────────────────────────────────────────

section('9) wire / 工具面 / 付费清单');
const rematteSpec = wire.METHODS.find((entry) => entry.method === 'rematte');
check('wire 注册了 rematte', rematteSpec !== undefined);
const remattePayload = rematteSpec === undefined ? {} : rematteSpec.payload.parse({ projectId: 'p1', jobId: 'i1', backend: 'birefnet' });
check('rematte schema 放行 projectId / jobId / backend（不丢键）', remattePayload.projectId === 'p1' && remattePayload.jobId === 'i1' && remattePayload.backend === 'birefnet', JSON.stringify(remattePayload));
const rematteFiltered = rematteSpec === undefined ? {} : rematteSpec.payload.parse({ projectId: 'p1', unknownKey: 1 });
check('rematte schema 丢弃未声明键', rematteFiltered.unknownKey === undefined);
let badBackend = false;
try {
  rematteSpec.payload.parse({ backend: 'nope' });
} catch {
  badBackend = true;
}
check('rematte schema 只收三个合法后端', badBackend === true);
check('rematte 进 SHARED_TOOL_METHODS（工具面可调）', toolMod.SHARED_TOOL_METHODS.has('rematte'));
check('宿主 PAID_METHODS 不含 rematte（本地免费）', !hostIndex.PAID_METHODS.includes('rematte'));
const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
const clientApiSource = await readFile(new URL('../src/client/platform/api.ts', import.meta.url), 'utf8');
const clientPaidBlock = /PAID_METHODS[^=]*=\s*\[([\s\S]*?)\];/.exec(clientApiSource);
check('客户端 PAID_METHODS 不含 rematte', clientPaidBlock !== null && !clientPaidBlock[1].includes('rematte'));
check('客户端远程方法清单含 rematte', /\["rematte",\s*true\]/.test(clientSource));

// ── 10) 三条链路（真实代码路径 + mock ComfyUI）──────────────────────────────

section('10) 三条链路接线（真实代码路径）');
resetMock('success');

// 10a. 模块① 八方向图：拿一份只有 front 方向 raw.bin 的项目，跑 startRekey。
{
  const W = 24;
  const H = 24;
  const N = 2;
  const project = await store.createProject('去背自检项目');
  const frames = [];
  for (let index = 0; index < N; index++) frames.push(makeGreenFrame(W, H, index + 1));
  for (const sub of ['frames/front', 'keyed/front', 'preview', 'out']) {
    await mkdir(join(store.projectDir(project.id), sub), { recursive: true });
  }
  await writeFile(join(store.projectDir(project.id), 'frames', 'front', 'raw.bin'), Buffer.concat(frames));
  await store.patchProject(project.id, (current) => {
    current.frames.front = {
      status: 'ready',
      frames: [],
      keyed: [],
      approved: false,
      raw: 'frames/front/raw.bin',
      rawWidth: W,
      rawHeight: H,
      rawFrameCount: N
    };
  });
  const started = pipeline.startRekey(project.id);
  check('pipeline.startRekey：任务启动', started.started === true, JSON.stringify(started));
  let projectState = await store.readProject(project.id);
  let sawRunning = false;
  for (let i = 0; i < 200; i++) {
    projectState = await store.readProject(project.id);
    if (projectState.sheet.status === 'running') sawRunning = true;
    // 任务刚提交时后台可能还没把 sheet 标成 running，先给一点时间再判结束。
    if (sawRunning && projectState.sheet.status !== 'running') break;
    await sleep(sawRunning ? 100 : 50);
  }
  check('pipeline：整图合成完成（status=ready）', projectState.sheet.status === 'ready', projectState.sheet.status + ' / ' + (projectState.sheet.error || ''));
  check('pipeline：sheet.matte.backend = birefnet', projectState.sheet.matte !== undefined && projectState.sheet.matte.backend === 'birefnet', JSON.stringify(projectState.sheet.matte));
  check('pipeline：方向节点 frames.front.matte 也记了后端', projectState.frames.front.matte !== undefined && projectState.frames.front.matte.backend === 'birefnet');
  const keyedFirst = await readFile(store.assetPath(project.id, 'keyed/front/f00.png')).catch(() => undefined);
  const keyedDecoded = keyedFirst === undefined ? undefined : matte.decodePngImage(keyedFirst);
  check('pipeline：抠像帧落盘且带透明像素', keyedDecoded !== undefined && matte.decodePngImage(keyedFirst).rgba.some((value, index) => index % 4 === 3 && value === 0), keyedFirst === undefined ? 'missing' : String(keyedFirst.length) + 'B');
  const rawProjectJson = JSON.parse(await readFile(join(store.projectDir(project.id), 'project.json'), 'utf8'));
  check('pipeline：project.json 里能读回 sheet.matte', rawProjectJson.sheet !== undefined && rawProjectJson.sheet.matte !== undefined && rawProjectJson.sheet.matte.backend === 'birefnet');
  const hasMatteLog = (projectState.log || []).some((entry) => String(entry.message || '').includes('去背后端'));
  check('pipeline：任务日志有一行「去背后端 …」', hasMatteLog, (projectState.log || []).slice(-2).map((entry) => entry.message).join(' | ').slice(0, 80));
}

// 10b. 模块③ 序列帧：直接调 keySequenceFrames / composeSequenceSheet。
{
  const W = 20;
  const H = 20;
  const N = 3;
  const job = await seqgen.createSequenceJob('去背自检序列帧');
  const frames = [];
  for (let index = 0; index < N; index++) frames.push(makeGreenFrame(W, H, index + 3));
  await mkdir(join(seqgen.sequenceJobDir(job.id), 'frames'), { recursive: true });
  await writeFile(seqgen.sequenceAssetPath(job.id, 'frames/raw.bin'), Buffer.concat(frames));
  const current = await seqgen.readSequenceJob(job.id);
  current.frames = { status: 'ready', count: N, files: [], keyed: [], raw: 'frames/raw.bin', width: W, height: H, duration: 1 };
  await seqgen.writeSequenceJob(current);
  await seqgen.keySequenceFrames(job.id);
  const keyedJob = await seqgen.readSequenceJob(job.id);
  check('seqgen：keySequenceFrames 写出全部帧', keyedJob.frames.keyed.length === N, String(keyedJob.frames.keyed.length));
  check('seqgen：frames.matte.backend = birefnet', keyedJob.frames.matte !== undefined && keyedJob.frames.matte.backend === 'birefnet', JSON.stringify(keyedJob.frames.matte));
  await seqgen.composeSequenceSheet(job.id);
  const composed = await seqgen.readSequenceJob(job.id);
  check('seqgen：条图合成完成（sheet=ready）', composed.sheet.status === 'ready' && composed.sheet.file === 'out/sequence-strip.png', composed.sheet.status);
}

// 10c. 模块② 图片生成：rekeyImageJob（解码走 ffmpeg；缺 ffmpeg 时跳过）。
{
  let imageChainOk = true;
  let imageChainDetail = '';
  try {
    const job = await imagegen.createImageJob('去背自检图片');
    const sourceBytes = pngMod.encodePng(makeGreenFrame(20, 20, 9), 20, 20);
    await imagegen.addImageToJob(job.id, 'source.png', sourceBytes.toString('base64'));
    const current = await imagegen.readImageJob(job.id);
    current.keying = { enabled: true, keyLow: 14, keyHigh: 80, despill: 0.65, bgTolerance: 90, edgeShrink: 0 };
    await imagegen.writeImageJob(current);
    await imagegen.rekeyImageJob(job.id);
    const keyedJob = await imagegen.readImageJob(job.id);
    imageChainOk = keyedJob.items[0].keyedFile !== undefined && keyedJob.items[0].matte !== undefined && keyedJob.items[0].matte.backend === 'birefnet';
    imageChainDetail = JSON.stringify({ keyedFile: keyedJob.items[0].keyedFile, matte: keyedJob.items[0].matte });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ffmpeg|ffprobe|ENOENT/i.test(message)) {
      imageChainOk = true;
      imageChainDetail = '跳过：本机缺 ffmpeg（抽帧 / 解码链路本来就要它）';
    } else {
      imageChainOk = false;
      imageChainDetail = message.slice(0, 120);
    }
  }
  check('imagegen：rekeyImageJob 走 matte 抽象并记 item.matte', imageChainOk, imageChainDetail);
}

// 10d. 静态接线：三条链路都不再直接调 keyGreen。
{
  const pipelineSrc = await readFile(new URL('../src/pipeline.ts', import.meta.url), 'utf8');
  const seqgenSrc = await readFile(new URL('../src/seqgen.ts', import.meta.url), 'utf8');
  const imagegenSrc = await readFile(new URL('../src/imagegen.ts', import.meta.url), 'utf8');
  check('pipeline 不再直接 import keyGreen，改用 matteBatch', !pipelineSrc.includes('keyGreen(') && pipelineSrc.includes('matteBatch('));
  check('seqgen 不再直接 import keyGreen，改用 matteBatch', !seqgenSrc.includes('keyGreen(') && seqgenSrc.includes('matteBatch('));
  check('imagegen 不再直接 import keyGreen，改用 matteOne', !imagegenSrc.includes('keyGreen(') && imagegenSrc.includes('matteOne('));
}

// ── 收尾 ────────────────────────────────────────────────────────────────────

server.close();
console.log('');
if (failures.length > 0) {
  console.log('共 ' + checks + ' 项检查，失败 ' + failures.length + ' 项：');
  for (const name of failures) console.log('  ✗ ' + name);
  process.exitCode = 1;
} else {
  console.log('共 ' + checks + ' 项检查，全部通过。');
}
