#!/usr/bin/env node
/**
 * 真实 DOM 视觉预览（UI 重设计验收用，sprite 一个模块）。
 *
 *   node scripts/preview-real.mjs              # 生成 .preview/real-light.html / real-dark.html
 *   node scripts/preview-real.mjs --shot       # 再用 Playwright + 本机 Edge 出 2 张 2x 截图
 *   node scripts/preview-real.mjs --project=empty   # 换「新项目空态」数据（对齐设计稿第一屏）
 *
 * 做法：把 scripts/verify-feedback.mjs 里那套桩**复制**过来（原脚本一行不改）：
 * 假 window.__ModuleLoader__ 抓插件体、假 React 把 createElement 变成普通对象树、
 * Hook 按槽位喂值、假 document 只要求不炸；CSS 由本脚本用 esbuild 打包
 * src/client/styles.ts 后内联。渲染出的是 StudioPanel 的真实元素树。
 *
 * 序列化规则：字符串 type = 标签；className → class；style 对象 → 内联 style；
 * 文本节点转义；其余 props 只保留 data-* / title / aria-* / role。
 * 两处「为了预览不失真」的例外（本文件显式列出，可删）：
 *   - SVG 几何属性（viewBox / d / stroke…），否则图标全空白；
 *   - 表单控件的可见内容（value / placeholder / type / checked / disabled…），
 *     否则输入框与滑块在截图里和设计稿对不上。
 *
 * 只读 src/ 与 lib/；产物只写 .preview/。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { build } from "esbuild";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PREVIEW = join(ROOT, ".preview");
mkdirSync(PREVIEW, { recursive: true });

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const hit = argv.find((item) => item === "--" + name || item.startsWith("--" + name + "="));
  if (hit === undefined) return fallback;
  const eq = hit.indexOf("=");
  return eq < 0 ? true : hit.slice(eq + 1);
}
const projectKind = String(arg("project", "ready"));
const tag = String(arg("tag", ""));
const MODULE_KEYS = ["sprite", "image", "sequence", "rig", "iso", "map", "music", "sfx"];
const moduleKey = String(arg("module", "sprite"));
if (!MODULE_KEYS.includes(moduleKey)) {
  console.error("--module 只能是 " + MODULE_KEYS.join(" / "));
  process.exit(2);
}
const stageKey = String(arg("stage", "images"));
const bundlePath = String(arg("bundle", join(ROOT, "lib/client.js")));
const doShot = argv.includes("--shot");
const panelKind = String(arg("panel", "studio"));

// ── 假 React / 假 window / 假 document（复制自 scripts/verify-feedback.mjs）──
const HOOK = { slots: [], cursor: 0 };

const ReactStub = {
  Fragment: Symbol.for("react.fragment"),
  createElement(type, props) {
    const children = Array.prototype.slice.call(arguments, 2);
    return { type, props: props === null || props === undefined ? {} : props, children };
  },
  useState(initial) {
    const index = HOOK.cursor++;
    const value = HOOK.slots[index];
    return [value === undefined ? (typeof initial === "function" ? initial() : initial) : value, function () {}];
  },
  useRef(initial) {
    HOOK.cursor++;
    return { current: initial };
  },
  useEffect() {},
  useLayoutEffect() {},
  useCallback(fn) {
    return fn;
  },
  useMemo(fn) {
    return fn();
  },
  useContext() {
    return undefined;
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    HOOK.cursor++;
    return getSnapshot();
  }
};

const source = readFileSync(bundlePath, "utf8");
const LOADED = [];
const windowStub = {
  __ModuleLoader__: {
    load(registration) {
      LOADED.push(registration);
    }
  },
  location: { origin: "http://127.0.0.1:43120", search: "", href: "http://127.0.0.1:43120/" },
  history: { replaceState() {} },
  setTimeout(fn) {
    fn();
    return 0;
  },
  clearTimeout() {},
  setInterval() {
    return 0;
  },
  clearInterval() {},
  addEventListener() {},
  removeEventListener() {}
};
globalThis.document = {
  head: { appendChild() {}, removeChild() {} },
  body: { appendChild() {}, removeChild() {} },
  createElement() {
    return { setAttribute() {}, remove() {}, style: {}, textContent: "", click() {} };
  },
  addEventListener() {},
  removeEventListener() {}
};

function fail(label, error) {
  console.error("✗ " + label + "：" + (error && error.stack ? error.stack : error));
  process.exit(1);
}

try {
  new Function("window", "require", source)(windowStub, function (name) {
    if (name === "react") return ReactStub;
    throw new Error("未预期的 require(" + name + ")");
  });
  if (LOADED.length !== 1) throw new Error("期望 1 个 load()，实际 " + LOADED.length);
} catch (error) {
  fail("加载 " + bundlePath, error);
}

let bundle;
try {
  bundle = LOADED[0].factory(function (name) {
    if (name === "react") return ReactStub;
    throw new Error("未预期的 require(" + name + ")");
  });
} catch (error) {
  fail("执行插件 factory", error);
}

const REGISTERED = {};
const fakeCtx = {
  effect(fn) {
    return fn();
  },
  get() {
    return undefined;
  },
  slots: {
    inject(name, fn) {
      return fn();
    },
    register(options, component) {
      REGISTERED[options.name] = component;
      return function () {};
    }
  },
  remote: {
    $mount() {
      return Promise.resolve();
    }
  }
};
try {
  bundle.apply(fakeCtx);
} catch (error) {
  fail("执行 plugin.apply", error);
}
const panel = REGISTERED.main;
if (typeof panel !== "function") fail("抓 main 面板组件", new Error("没有挂上 main"));

// ── 桩数据（复制自 verify-feedback.mjs）────────────────────────────────────
const COMPASSES = ["front", "back", "downLeft", "downRight", "upLeft", "upRight", "left", "right"];
const api = new Proxy({}, { get: function () { return function () { return Promise.resolve({}); }; } });
const DEFAULT_TURN_PROMPT =
  "角色原地匀速旋转一整圈（360°），固定机位，绿幕背景。保持角色五官、发型、服装、配色与源图一致；不出现行走、抬手、点头等额外动作。";

function makeTasks(activeKeys) {
  const labels = {};
  for (const key of activeKeys || []) labels[key] = "正在处理 " + key + "…";
  return {
    map: Object.assign({}, labels),
    run: function () { return Promise.resolve(); },
    has: function (key) { return labels[key] !== undefined; },
    label: function (key) { return labels[key]; },
    any: function (prefix) { return Object.keys(labels).some(function (key) { return key.indexOf(prefix) === 0; }); },
    keys: function (prefix) { return Object.keys(labels).filter(function (key) { return key.indexOf(prefix) === 0; }); },
    active: Object.keys(labels).length > 0,
    firstLabel: Object.values(labels)[0]
  };
}

function makeProject(overrides) {
  const images = {};
  const videos = {};
  const frames = {};
  for (const compass of COMPASSES) {
    images[compass] = { file: "images/" + compass + ".png", status: "ready", updatedAt: 1 };
    videos[compass] = { file: "videos/" + compass + ".mp4", status: "ready", updatedAt: 1, remoteStatus: "Success" };
    frames[compass] = { strip: "frames/" + compass + ".png", status: "ready", updatedAt: 1, duration: 4, frames: ["a.png"] };
  }
  return Object.assign(
    {
      id: "p1",
      name: "测试 1",
      assetBase: "/dsh-inkbox/assets/p1/",
      updatedAt: 1,
      source: { file: "source/hero.png", name: "hero.png" },
      images: images,
      videos: videos,
      frames: frames,
      sheet: { file: "out/sheet.png", status: "ready", approved: false, generatedAt: 1, width: 1024, height: 1024, rowOrder: null },
      prompts: { images: {}, video: "", turn: DEFAULT_TURN_PROMPT },
      settings: { frames: 8, turnFrameCount: 32 },
      reviewMode: "auto",
      log: [],
      jobs: []
    },
    overrides || {}
  );
}

/** 「带源图 + 八方向图」的转圈截帧项目（默认场景）。 */
function makeReadyTurnProject() {
  const images = {};
  const picks = {};
  COMPASSES.forEach(function (key, index) {
    images[key] = { file: "images/" + key + ".png", status: "ready", updatedAt: 1, model: "转圈截帧", approved: index % 3 === 0 };
    picks[key] = Math.round((index * 32) / 8);
  });
  return makeProject({
    imageMode: "turn",
    images: images,
    turn: {
      direction: "ccw",
      video: { status: "ready", file: "videos/turn.mp4", updatedAt: 1, firstFrame: "source/hero.png", approved: true },
      frames: {
        status: "ready",
        frames: Array.from({ length: 32 }, function (_value, i) { return "turn/frames/f" + String(i) + ".png"; }),
        times: Array.from({ length: 32 }, function (_value, i) { return (i * 2) / 32; }),
        raw: "turn/raw.bin",
        rawWidth: 960,
        rawHeight: 960,
        rawFrameCount: 32,
        duration: 2,
        picks: picks,
        strip: "turn/strip.png",
        approved: true,
        updatedAt: 2
      }
    }
  });
}

/** 设计稿同款：新项目 + 转圈截帧 + 还没产物。 */
function makeEmptyTurnProject() {
  const images = {};
  const picks = {};
  for (const key of COMPASSES) {
    images[key] = { status: "empty" };
    picks[key] = 0;
  }
  return makeProject({
    source: null,
    imageMode: "turn",
    images: images,
    videos: {},
    frames: {},
    sheet: { status: "empty" },
    turn: {
      direction: "ccw",
      video: { status: "empty", approved: false },
      frames: { status: "empty", frames: [], times: [], picks: picks, approved: false }
    }
  });
}

function seedStudio(project) {
  const store = bundle && bundle.__test ? bundle.__test.studioStore : undefined;
  if (store === undefined) throw new Error("__test 里没有 studioStore");
  store.setState({
    projects: project === null ? [] : [{ id: "p1", name: project.name || "测试 1", imageReady: 8, videoReady: 8, framesReady: 8, sheetReady: true }],
    projectId: project === null ? null : "p1",
    project: project,
    promptDraft: {},
    videoPromptDraft: "",
    settingsDraft: {},
    promptOpen: {}
  });
  return store;
}

// ── 其它模块的假任务 / Hook 槽位 ────────────────────────────────────────────
// 槽位 = 组件里 useState / useRef / useSyncExternalStore 的调用顺序（useCallback /
// useMemo / useEffect 在桩里不占位）。照 verify-feedback.mjs 里 renderModule 的造法抄：
// 一个模块 = 一份槽位数组，数组里就是它各个 useState 想读到的值。
function makeImageJob() {
  return {
    id: "i1", name: "图片任务", assetBase: "/dsh-inkbox/image-assets/i1/", updatedAt: 2,
    prompt: "一只猫", suffix: "", refs: [], settings: { count: 2 }, keying: { enabled: false }, log: [],
    items: [
      { status: "ready", source: "generated", file: "out/1.png", updatedAt: 2 },
      { status: "ready", source: "generated", file: "out/2.png", updatedAt: 2, keyedFile: "keyed/2.png", backgroundFraction: 0.4 }
    ]
  };
}
function makeSequenceJob() {
  return {
    id: "s1", name: "序列帧任务", assetBase: "/dsh-inkbox/sequence-assets/s1/", updatedAt: 3,
    mode: "frames", prompt: "走路", suffix: "", settings: { duration: 5, resolution: "768P", frameCount: 4 }, keying: {},
    refs: { firstFrame: { file: "refs/first.png", name: "first.png" }, referenceImages: [], referenceVideos: [] },
    video: { status: "ready", file: "videos/out.mp4", updatedAt: 3, remoteStatus: "Success" },
    frames: { status: "ready", files: ["frames/1.png", "frames/2.png", "frames/3.png"], keyed: ["keyed/1.png", "keyed/2.png", "keyed/3.png"], duration: 5, updatedAt: 3 },
    sheet: { status: "ready", file: "out/strip.png", updatedAt: 3 }, log: []
  };
}
const MUSIC_CONFIG = {
  musicBlocker: null, musicApiKeySet: true, musicBaseUrl: "https://api.yourmusic.fun", musicModel: "chirp-v6",
  musicTimeoutMs: 120000, musicPollTimeoutMs: 900000, musicEngines: [],
  musicDocsUrl: "https://api.yourmusic.fun/docs", musicConsoleUrl: "https://api.yourmusic.fun/dashboard", ffmpeg: { ok: true }
};
const MUSIC_JOB = {
  module: "music", id: "a1", name: "测试音乐", assetBase: "/dsh-inkbox/music-assets/a1/", busy: false,
  reviewMode: "auto", updatedAt: 1, songsReady: 1, songsTotal: 1,
  source: { kind: "prompt", prompt: "8-bit battle loop", lyrics: "", note: "90 秒", title: "Battle", tags: "8-bit", instrumental: true },
  settings: { engine: "suno", mode: "prompt", model: "chirp-v6" },
  stages: { generate: { status: "done" }, edit: { status: "idle" }, export: { status: "idle" } },
  songs: [{
    id: "song1", status: "succeeded", title: "Battle Take", engine: "suno", modelName: "chirp-v6", duration: 3, tags: "8-bit",
    approved: false, localFile: "songs/song-song1.mp3", file: "songs/song-song1.mp3",
    url: "http://localhost/dsh-inkbox/music-assets/a1/songs/song-song1.mp3",
    coverFile: "songs/cover-song1.jpg", coverUrl: "http://localhost/dsh-inkbox/music-assets/a1/songs/cover-song1.jpg",
    wavUrl: null, lrcUrl: null, lyric: "[Verse]\nla la"
  }],
  versions: [{ id: "v1", songId: "song1", label: "裁剪", status: "ready", format: "mp3", duration: 2, size: 1234, preview: false, by: "human", createdAt: 1, file: "versions/v1.mp3", url: "http://localhost/dsh-inkbox/music-assets/a1/versions/v1.mp3" }],
  tools: [], exports: [], log: [{ at: 1, level: "info", message: "hello" }]
};
const SFX_CONFIG = {
  sfxBlocker: null, sfxApiKeySet: true, sfxBaseUrl: "https://openspeech.bytedance.com", sfxModel: "seed-audio-1.0",
  sfxFormat: "wav", sfxSampleRate: 24000,
  sfxFormats: [{ id: "wav", label: "WAV（无损，游戏引擎常用）" }, { id: "mp3", label: "MP3（体积小）" }, { id: "ogg_opus", label: "Ogg Opus（体积更小）" }],
  sfxSampleRates: [16000, 24000, 44100, 48000], sfxLimits: { promptChars: 2048, maxSeconds: 120 }
};
const SFX_JOB = {
  module: "sfx", id: "f1", name: "测试音效", assetBase: "/dsh-inkbox/sfx-assets/f1/", busy: false,
  status: "ready", reviewMode: "auto", blocker: null, prompt: "金属撞击，短促，约 1 秒",
  settings: { format: "wav", sampleRate: 24000, speechRate: 0, loudnessRate: 0, pitchRate: 0, watermark: false },
  refs: {
    image: { file: "refs/image.png", name: "角色.png", bytes: 72, ext: "png", url: "http://localhost/dsh-inkbox/sfx-assets/f1/refs/image.png" },
    audios: [{ file: "refs/a.wav", name: "a.wav", bytes: 144, ext: "wav", duration: 3, url: "http://localhost/dsh-inkbox/sfx-assets/f1/refs/a.wav" }]
  },
  takes: [{ id: "k1", file: "takes/k1.wav", bytes: 144078, format: "wav", duration: 3, originalDuration: 3, prompt: "金属撞击，短促，约 1 秒", settings: { format: "wav", sampleRate: 24000 }, createdAt: 1, url: "http://localhost/dsh-inkbox/sfx-assets/f1/takes/k1.wav" }],
  stages: { generate: { status: "done", approved: false }, export: { status: "idle", approved: false } },
  exports: [], log: [{ at: 1, level: "info", message: "hello" }]
};
const MODULE_SLOTS = {
  ImageModule: function () {
    return [0, [makeImageJob()], "i1", makeImageJob(), null, false, "一只猫", "", { count: 2 }, {}, undefined, {}, null];
  },
  SequenceModule: function () {
    return [0, [makeSequenceJob()], "s1", makeSequenceJob(), null, false, "走路", "", { duration: 5, resolution: "768P", frameCount: 4 }, {}, undefined, {}, null];
  },
  MusicModule: function () {
    return [
      0, null, MUSIC_CONFIG, [{ id: "a1", name: "测试音乐", songsReady: 1, songsTotal: 1, versions: 1, updatedAt: 1, busy: false }], "a1", MUSIC_JOB,
      null, false, false, "generate", "prompt", "", "", "", "", "", true, "", "auto", false, "song1", null, null, false, false,
      { start: 0, end: 3, gainDb: 0, fadeIn: 0, fadeOut: 0, normalize: false, lufs: -14, truePeak: -1, format: "mp3", bitrate: 192 },
      [0.12, 0.4, 0.85, 0.6, 0.22], "", false, false, null, null, null, false, false
    ];
  },
  SfxModule: function () {
    return [
      0, null, SFX_CONFIG, [{ id: "f1", name: "测试音效", takes: 1, latestDuration: 3, busy: false }], "f1", SFX_JOB, null, false, false,
      { name: "", prompt: "", format: "wav", sampleRate: 24000 }, "auto", false, SFX_JOB.prompt,
      { format: "wav", sampleRate: 24000, speechRate: 0, loudnessRate: 0, pitchRate: 0, watermark: false }, false, false, null, null, false, null, null, false
    ];
  },
  // 模块④：__test 没导出 RigModule，但面板会渲染它；按源码顺序手工列槽位，只关掉
  // 「实验性进入弹窗」与「正在读取任务」，保持空态。
  //   0 locale / 1 jobs / 2 jobId / 3 job / 4 stage / 5 notice / 6 loading / 7 uploading /
  //   8 selected / 9 showReference / 10 gateOpen / 11 anim / 12 prompt / 13 suffix /
  //   14 settings / 15 globalConfig / 16..18 usePendingTasks / 19 intent / 20 ref / 21 settleUntil
  RigModule: function () {
    const slots = new Array(22).fill(undefined);
    slots[0] = 0;
    slots[6] = false;
    slots[10] = false;
    slots[16] = {};
    return slots;
  }
  // iso / map：用组件自身初值（view === null → 「还没有…项目」空态），不需要槽位。
};

// ── tree → HTML ─────────────────────────────────────────────────────────
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const UNITLESS_STYLE = new Set([
  "animationIterationCount", "aspectRatio", "borderImageOutset", "borderImageSlice", "borderImageWidth", "boxFlex",
  "columnCount", "columns", "flex", "flexGrow", "flexShrink", "fontWeight", "lineClamp", "lineHeight", "opacity",
  "order", "orphans", "scale", "tabSize", "widows", "zIndex", "zoom", "fillOpacity", "stopOpacity", "strokeOpacity"
]);
const SVG_RENAME = {
  strokeWidth: "stroke-width",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  strokeDasharray: "stroke-dasharray",
  fillRule: "fill-rule",
  clipRule: "clip-rule",
  clipPath: "clip-path",
  fillOpacity: "fill-opacity",
  strokeOpacity: "stroke-opacity",
  vectorEffect: "vector-effect"
};
const SVG_ATTRS = new Set([
  "viewBox", "preserveAspectRatio", "d", "fill", "stroke", "cx", "cy", "r", "x", "y", "rx", "ry", "x1", "y1", "x2", "y2",
  "points", "width", "height", "opacity", "transform", "fill-rule", "clip-rule", "clip-path", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-opacity", "fill-opacity", "vector-effect"
]);
const FORM_ATTRS = new Set(["value", "placeholder", "type", "checked", "selected", "disabled", "rows", "cols", "readOnly", "multiple"]);
const RENDER_ERRORS = [];

function escapeText(text) {
  return String(text).split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");
}
function escapeAttr(text) {
  return String(text).split("&").join("&amp;").split('"').join("&quot;").split("<").join("&lt;").split(">").join("&gt;");
}
function styleToCss(style) {
  if (style === null || style === undefined || typeof style !== "object") return "";
  const parts = [];
  for (const key of Object.keys(style)) {
    const value = style[key];
    if (value === null || value === undefined || value === "") continue;
    let prop = key;
    if (key.indexOf("--") !== 0) {
      prop = key.replace(/[A-Z]/g, function (char) { return "-" + char.toLowerCase(); });
    }
    const cssValue = typeof value === "number" ? (UNITLESS_STYLE.has(key) ? String(value) : value + "px") : String(value);
    parts.push(prop + ":" + cssValue);
  }
  return parts.length === 0 ? "" : 'style="' + escapeAttr(parts.join(";")) + '"';
}
function attrsToHtml(props, inSvg) {
  const out = [];
  const keys = Object.keys(props || {});
  for (const key of keys) {
    const value = props[key];
    if (value === null || value === undefined || value === false) continue;
    if (key === "className") {
      const classText = Array.isArray(value) ? value.filter(Boolean).join(" ") : String(value);
      if (classText !== "") out.push('class="' + escapeAttr(classText) + '"');
      continue;
    }
    if (key === "style") {
      const css = styleToCss(value);
      if (css !== "") out.push(css);
      continue;
    }
    if (key === "children" || key === "key" || key === "ref" || key === "dangerouslySetInnerHTML") continue;
    if (key.indexOf("data-") === 0 || key.indexOf("aria-") === 0 || key === "title" || key === "role") {
      out.push(key + '="' + escapeAttr(String(value)) + '"');
      continue;
    }
    if (inSvg) {
      const name = SVG_RENAME[key] || key;
      if (!SVG_ATTRS.has(name)) continue;
      out.push(value === true ? name : name + '="' + escapeAttr(String(value)) + '"');
      continue;
    }
    if (FORM_ATTRS.has(key)) {
      out.push(value === true ? key : key + '="' + escapeAttr(String(value)) + '"');
    }
    // <details open>：布尔属性，静态 HTML 里必须保留，否则折叠分组在截图里全是收起态。
    if (key === "open" && value === true) out.push("open");
  }
  return out.length === 0 ? "" : " " + out.join(" ");
}

function childrenOf(node) {
  let children = Array.isArray(node.children) ? node.children : [];
  const propChildren = node.props ? node.props.children : undefined;
  if (propChildren !== undefined && propChildren !== null && children.length === 0) {
    children = Array.isArray(propChildren) ? propChildren : [propChildren];
  }
  return children;
}

function serializeChildren(children, ctx) {
  if (!Array.isArray(children) || children.length === 0) return "";
  let out = "";
  for (const child of children) out += serializeNode(child, ctx);
  return out;
}

function serializeNode(node, ctx) {
  if (node === null || node === undefined || node === true || node === false) return "";
  if (typeof node === "string") return escapeText(node);
  if (typeof node === "number") return escapeText(String(node));
  if (Array.isArray(node)) return node.map(function (child) { return serializeNode(child, ctx); }).join("");
  if (typeof node !== "object") return "";

  const type = node.type;
  const props = node.props || {};
  if (typeof type === "symbol") return serializeChildren(childrenOf(node), ctx);
  if (typeof type === "function") {
    const children = Array.isArray(node.children) ? node.children.filter(function (child) { return child !== null && child !== undefined; }) : [];
    const callProps = Object.assign({}, props);
    if (children.length === 1) callProps.children = children[0];
    else if (children.length > 1) callProps.children = children;
    const slotsFactory = MODULE_SLOTS[type.name];
    if (slotsFactory === undefined) {
      try {
        return serializeNode(type(callProps), ctx);
      } catch (error) {
        RENDER_ERRORS.push((type.name || "组件") + ": " + (error && error.message ? error.message : error));
        return "<!-- render error: " + escapeText(type.name || "?") + " -->";
      }
    }
    // 模块根组件：临时换成「这个模块自己的」Hook 槽位，渲染完原样换回来。
    const saved = { slots: HOOK.slots, cursor: HOOK.cursor };
    HOOK.slots = slotsFactory();
    HOOK.cursor = 0;
    try {
      return serializeNode(type(callProps), ctx);
    } catch (error) {
      RENDER_ERRORS.push((type.name || "组件") + ": " + (error && error.message ? error.message : error));
      return "<!-- render error: " + escapeText(type.name || "?") + " -->";
    } finally {
      HOOK.slots = saved.slots;
      HOOK.cursor = saved.cursor;
    }
  }
  if (typeof type !== "string") return "";

  const tag = type;
  const inSvg = ctx.inSvg === true || tag === "svg";
  const attrs = attrsToHtml(props, inSvg);
  let inner = serializeChildren(childrenOf(node), { inSvg: inSvg });
  if (tag === "textarea" && inner === "" && typeof props.value === "string") inner = escapeText(props.value);
  if (VOID_TAGS.has(tag)) return "<" + tag + attrs + ">";
  return "<" + tag + attrs + ">" + inner + "</" + tag + ">";
}

// ── 面板渲染（StudioPanel 的 Hook 槽位，与 verify-feedback.mjs renderStage 同口径）──
function renderPanel(project) {
  seedStudio(project);
  HOOK.slots = [];
  HOOK.slots[0] = 0; // useLocaleTick
  HOOK.slots[3] = stageKey; // stage
  HOOK.slots[4] = moduleKey; // module
  HOOK.slots[5] = null; // notice
  HOOK.slots[6] = false; // loading
  HOOK.slots[7] = makeTasks().map; // usePendingTasks
  HOOK.slots[10] = null; // useStudioIntent
  HOOK.slots[11] = []; // useHiddenModules
  HOOK.cursor = 0;
  return panel({ api: api });
}

// ── CSS：esbuild 打包 src/client/styles.ts（与 preview-ui.mjs 同一套做法）──
const stylesEntry = join(ROOT, "src/client/styles.ts");
// 每次进程用独立的临时文件：多人 / 多进程同时跑时避免互相写坏（见文件头说明）。
const stylesOut = join(PREVIEW, "styles-real-" + process.pid + ".mjs");
await build({ entryPoints: [stylesEntry], bundle: true, format: "esm", platform: "node", outfile: stylesOut, logLevel: "error" });
const stylesModule = await import(pathToFileURL(stylesOut).href);
const CSS = stylesModule.CSS;

// ── 设置页（ConfigSection）预览 ─────────────────────────────────────────────
// --panel=settings 时渲染真实设置组件（折叠分组 / 状态条），而不是 StudioPanel。
function makeSettingsConfig() {
  return {
    imageProvider: "ark",
    imageProviderSummary: "火山方舟 · doubao-seedream-5-0-flash-260915",
    imageProviderBlocker: null,
    customProtocols: [
      { id: "openai", label: "OpenAI API", baseUrl: "https://api.openai.com/v1", hint: "POST {base}/images/generations" },
      { id: "comfyui", label: "ComfyUI API", baseUrl: "http://127.0.0.1:8188", hint: "POST {base}/prompt + /history + /view" },
      { id: "sdwebui", label: "Stable Diffusion WebUI API", baseUrl: "http://127.0.0.1:7860", hint: "POST {base}/sdapi/v1/txt2img" }
    ],
    customProtocol: "openai",
    customBaseUrl: "https://api.openai.com/v1",
    customModel: "gpt-image-1",
    customSize: "1024x1024",
    customApiKeySet: false,
    customApiKeyHint: "",
    customImageBlocker: null,
    customWorkflow: "",
    arkApiKeySet: true,
    arkApiKeyHint: "…c0ffee",
    arkModels: [
      { id: "doubao-seedream-5-0-flash-260915", label: "Seedream 5.0 Flash（默认·快且几何准）" },
      { id: "doubao-seedream-5-0-pro-260915", label: "Seedream 5.0 Pro" }
    ],
    arkModel: "doubao-seedream-5-0-flash-260915",
    arkRedrawModel: "",
    arkSize: "2K",
    arkBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    arkWatermark: false,
    ffmpeg: { ok: true, version: "6.1.1", error: undefined },
    minimaxApiKeySet: true,
    minimaxApiKeyHint: "…deadbeef",
    minimaxModel: "MiniMax-H3",
    minimaxModels: [{ id: "MiniMax-H3", label: "MiniMax-H3" }],
    minimaxHosts: [],
    minimaxDuration: 5,
    minimaxResolution: "2K",
    minimaxBaseUrl: "https://api.minimaxi.com",
    minimaxCapabilities: { protocol: "v2", resolutions: ["2K", "768P"], durationMin: 4, durationMax: 15, note: "" },
    minimaxCapabilitiesByModel: {},
    comfyVideo: false,
    comfyBaseUrl: "http://127.0.0.1:8188",
    comfyCookiesSet: false,
    comfyCookiesHint: "",
    comfyWorkflow: "{}",
    comfyPromptTarget: "",
    comfyFirstFrameTarget: "",
    comfyWidth: 0,
    comfyHeight: 0,
    comfySeconds: 0,
    comfySeed: 0,
    comfyTimeoutMs: 600000,
    toapisApiKeySet: false,
    toapisBaseUrl: "https://toapis.cn/v1",
    toapisImageModel: "gpt-image-2-vip",
    toapisImageSize: "1K",
    toapisImageQuality: "low",
    toapisImageBackground: "auto",
    toapisVideo: false,
    toapisVideoModel: "seedance-2-mini",
    toapisVideoDuration: 4,
    toapisVideoResolution: "480p",
    toapisVideoAspectRatio: "16:9",
    toapisTimeoutMs: 600000,
    musicApiKeySet: false,
    musicApiKeyHint: "",
    musicBaseUrl: "https://api.yourmusic.fun",
    musicModel: "chirp-v6",
    musicTimeoutMs: 120000,
    musicPollTimeoutMs: 900000,
    musicBlocker: null,
    musicScoreStatus: { blocker: null, python: { ok: true, path: "python", version: "3.13" }, scoremill: { ok: true }, fluidsynth: { ok: true }, soundfont: { ok: true }, ffmpeg: { ok: true }, renderer: "fluidsynth", warnings: [] },
    sfxApiKeySet: false,
    sfxApiKeyHint: "",
    sfxBaseUrl: "https://openspeech.bytedance.com",
    sfxModel: "seed-audio-1.0",
    sfxFormat: "wav",
    sfxSampleRate: 24000,
    sfxTimeoutMs: 300000,
    sfxBlocker: null,
    sfxFormats: [{ id: "wav" }, { id: "mp3" }, { id: "ogg_opus" }],
    sfxSampleRates: [16000, 24000, 44100, 48000],
    hiddenModules: [],
    cellWidth: 256,
    cellHeight: 256,
    frameCount: 8,
    concurrency: 3,
    keyLow: 14,
    keyHigh: 80,
    despill: 0.65,
    edgeShrink: 0,
    bgTolerance: 90,
    workingLongEdge: 768,
    pixelSize: 0,
    fillRatio: 0.94,
    bottomMargin: 2,
    dataRoot: "C:/Users/yunda/.dsh/inkbox"
  };
}

function renderSettings() {
  const config = makeSettingsConfig();
  const api = {
    getConfig: function () { return Promise.resolve(config); },
    saveConfig: function () { return Promise.resolve(config); },
    testArk: function () { return Promise.resolve({ model: "Seedream", bytes: 1024 }); },
    testCustomImage: function () { return Promise.resolve({ provider: "自定义", bytes: 512 }); },
    testMinimax: function () { return Promise.resolve({ model: "MiniMax-H3" }); },
    testComfy: function () { return Promise.resolve({ version: "0.3.40", device: "AMD RX 7800 XT", queueRunning: 0, queuePending: 0, nodes: 12, bindings: { prompt: "6.text", first: "10.image", width: "5.width", height: "5.height", seconds: "9.seconds", seed: "7.seed" }, notes: [] }); },
    testMusic: function () { return Promise.resolve({}); },
    testMusicScore: function () { return Promise.resolve({ ok: true }); },
    testSfx: function () { return Promise.resolve({ message: "ok" }); }
  };
  const component = bundle.__test && bundle.__test.ConfigSection;
  if (typeof component !== "function") fail("取 ConfigSection", new Error("bundle.__test.ConfigSection 不存在"));
  HOOK.slots = [];
  HOOK.slots[0] = 0; // useLocaleTick
  HOOK.slots[1] = config;
  HOOK.cursor = 0;
  return component({ api: api });
}

function pageFor(theme, body) {
  const dark = theme === "dark";
  const bg = dark ? "#161815" : "#f7f5f0";
  return (
    '<!doctype html>\n<html lang="zh-CN" data-gmm-theme="' + (dark ? "dark" : "light") + '"><head><meta charset="utf-8">\n' +
    "<title>墨盒 · 真实 DOM 预览（" + (dark ? "深色" : "浅色") + " / " + (panelKind === "settings" ? "设置页" : moduleKey + " / " + stageKey) + "）</title>\n<style>\n" +
    "html,body{margin:0;height:100%;background:" + bg + "}\n#root{height:100%}\n" + CSS +
    '\n</style></head>\n<body><div id="root">' + body + "</div></body></html>"
  );
}

const baseName = "real" + (tag === "" ? "" : "-" + tag) + (moduleKey === "sprite" ? "" : "-" + moduleKey) + (projectKind === "empty" ? "-empty" : "") + (panelKind === "settings" ? "-settings" : "");
const files = {};
for (const theme of ["light", "dark"]) {
  RENDER_ERRORS.length = 0;
  const project = moduleKey !== "sprite" ? makeProject({}) : projectKind === "empty" ? makeEmptyTurnProject() : makeReadyTurnProject();
  if (panelKind === "settings") {
    const settingsTree = renderSettings();
    const settingsBody = '<div style="padding:24px;box-sizing:border-box;min-height:100%;background:var(--gmm-bg)">' + serializeNode(settingsTree, { inSvg: false }) + "</div>";
    const settingsHtml = pageFor(theme, settingsBody);
    const settingsFile = join(PREVIEW, baseName + "-" + theme + ".html");
    writeFileSync(settingsFile, settingsHtml, "utf8");
    files[theme] = { file: settingsFile, html: settingsHtml, errors: RENDER_ERRORS.slice() };
    console.log("✓ " + theme + "：" + settingsFile + "（" + settingsHtml.length + " 字符）" + (RENDER_ERRORS.length ? "　渲染错误：" + RENDER_ERRORS.join("；") : ""));
    continue;
  }
  const tree = renderPanel(project);
  const body = serializeNode(tree, { inSvg: false });
  const html = pageFor(theme, body);
  const file = join(PREVIEW, baseName + "-" + theme + ".html");
  writeFileSync(file, html, "utf8");
  files[theme] = { file: file, html: html, errors: RENDER_ERRORS.slice() };
  console.log("✓ " + theme + "：" + file + "（" + html.length + " 字符）" + (RENDER_ERRORS.length ? "　渲染错误：" + RENDER_ERRORS.join("；") : ""));
}

// ── 截图（Playwright + 本机 Edge，playwright 从 DSH 检出目录 require）────────
if (doShot) {
  const { createRequire } = await import("node:module");
  const require = createRequire("G:/code/deepseek-harness/");
  const { chromium } = require("playwright");
  const exe = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: panelKind === "settings" ? { width: 820, height: 920 } : { width: 1440, height: 960 }, deviceScaleFactor: 2 });
    const consoleErrors = [];
    page.on("pageerror", function (error) { consoleErrors.push(String(error && error.message ? error.message : error)); });
    await page.goto(pathToFileURL(files[theme].file).href, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(400);
    const shot = join(PREVIEW, baseName + "-" + theme + ".png");
    await page.screenshot({ path: shot });
    const metrics = await page.evaluate(function () {
      function rect(selector) {
        const node = document.querySelector(selector);
        if (node === null) return null;
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          rect: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
          scroll: [node.scrollWidth, node.scrollHeight],
          client: [node.clientWidth, node.clientHeight],
          overflowY: style.overflowY,
          background: style.backgroundColor,
          color: style.color,
          borderRadius: style.borderRadius
        };
      }
      const doc = document.documentElement;
      return {
        viewport: [window.innerWidth, window.innerHeight],
        documentScroll: [doc.scrollWidth, doc.scrollHeight],
        bodyScroll: [document.body.scrollWidth, document.body.scrollHeight],
        theme: doc.getAttribute("data-gmm-theme"),
        root: rect(".SPR_root"),
        sidebar: rect(".SPR_sidebar"),
        topbar: rect(".SPR_topbar"),
        scrollArea: rect(".SPR_scroll"),
        pageHead: rect(".SPR_pageHead"),
        stepBar: rect(".SPR_stepBar"),
        cols: rect(".SPR_cols"),
        panel: rect(".SPR_panel"),
        railCards: Array.from(document.querySelectorAll(".SPR_railCard")).map(function (node) {
          const box = node.getBoundingClientRect();
          return [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
        }),
        navItems: Array.from(document.querySelectorAll(".SPR_navItem")).map(function (node) {
          const box = node.getBoundingClientRect();
          return {
            module: node.getAttribute("data-module"),
            active: node.getAttribute("data-active"),
            y: Math.round(box.y),
            height: Math.round(box.height),
            scrollW: node.scrollWidth,
            clientW: node.clientWidth,
            background: getComputedStyle(node).backgroundColor
          };
        }),
        scrollables: Array.from(document.querySelectorAll(".SPR_root *"))
          .filter(function (node) { return node.scrollHeight > node.clientHeight + 2 && node.clientHeight > 40; })
          .slice(0, 12)
          .map(function (node) {
            return {
              tag: node.tagName.toLowerCase(),
              class: String(node.className).slice(0, 60),
              scroll: [node.scrollWidth, node.scrollHeight],
              client: [node.clientWidth, node.clientHeight],
              overflowY: getComputedStyle(node).overflowY
            };
          }),
        horizontalOverflow: Array.from(document.querySelectorAll(".SPR_root *"))
          .filter(function (node) { return node.scrollWidth > node.clientWidth + 2 && node.clientWidth > 80; })
          .slice(0, 20)
          .map(function (node) {
            return { tag: node.tagName.toLowerCase(), class: String(node.className).slice(0, 60), scrollW: node.scrollWidth, clientW: node.clientWidth };
          })
      };
    });
    console.log("✓ 截图：" + shot);
    if (consoleErrors.length > 0) console.log("  ⚠ 页面脚本错误：" + consoleErrors.join(" | "));
    console.log("  诊断（" + theme + "）：" + JSON.stringify(metrics));
    await page.close();
  }
  await browser.close();
}

// esbuild 的服务子进程会一直挂着事件循环，脚本跑完不退出（表现为「没有输出卡住」）。
// 产物已经落盘，这里显式退出，CLI 与后台任务都不会再挂住。
process.exit(0);
