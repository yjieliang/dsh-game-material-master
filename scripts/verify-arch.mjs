/**
 * 架构适配度自检（fitness functions）。
 *
 * 光把规则写进文档，一年后必然失效；这里把「可自动拦住的规则」变成构建门禁。
 * 迁移期用**棘轮（ratchet）**：允许历史遗留先存在，但数量只许降、不许涨。
 *
 *   node scripts/verify-arch.mjs
 *
 * 退出码：0 = 全通过（含跳过项），1 = 有 FAIL。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = ROOT + "src";
const CLIENT = SRC + "/client";
const PLATFORM = CLIENT + "/platform";
const FEATURES = CLIENT + "/features";
const SHELL = CLIENT + "/shell";
const BUNDLE = ROOT + "lib/client.js";

/** 迁移期棘轮：历史遗留允许存在，但不得增长（每迁一个模块就把数字往下调）。 */
const BASELINE = {
  /**
   * 非 platform 客户端源码里的 setInterval/setTimeout 计数。
   * P10 已把最后一批裸定时器收编：周期轮询 → platform/scheduler.watch，
   * 防抖 / 节流 / 延时刷新 → platform/lifecycle.onceTimer（repeatTimer 只给动画钟）。
   * 所以这里是 0 —— 新代码不许再出现裸定时器（注释里提及也会被数到）。
   */
  legacyTimers: 0,
  /** 非 platform 客户端源码里的裸 fetch( 计数 */
  legacyFetch: 3,
  /** 非 platform 客户端源码里的 addEventListener 计数（走 lifecycle 之前允许存在） */
  legacyListeners: 30,
  /**
   * feature 把根目录旧 `*-module.ts` 原样转发一层的数量（迁移期遗留）。
   * 8 个模块里 sprite 已真正下沉，其余 7 个仍是壳；每迁一个就把这里减 1。
   * 新增模块**不许**再加壳：新代码直接写在 feature 里。
   */
  legacyFeatureShellImports: 7
};

/** 体积预算。 */
const BUDGET = { rawBytes: 1_200_000, gzipBytes: 320 * 1024 };

const failures = [];
const skips = [];
let checks = 0;
const check = (name, ok, detail) => {
  checks++;
  console.log("  " + (ok ? "✓" : "✗") + " " + name + (detail === undefined ? "" : " — " + detail));
  if (!ok) failures.push(name);
};
const skip = (name, why) => {
  skips.push(name);
  console.log("  – " + name + "（跳过：" + why + "）");
};
const section = title => console.log("\n" + title);

const exists = path => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};
const fileExists = path => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};
const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const path = dir + "/" + entry;
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
};
const rel = path => path.slice(SRC.length + 1).replace(/\\/g, "/");
const source = path => readFileSync(path, "utf8");
const importsOf = text => [...text.matchAll(/from\s+["']([^"']+)["']/g)].map(match => match[1]);

const clientFiles = [SRC + "/client.ts"];
if (exists(CLIENT)) clientFiles.push(...walk(CLIENT));

// ── 1. 依赖规则 ─────────────────────────────────────────────────────────
section("依赖规则");
const FEATURE_PREFIX = "client/features/";
const PLATFORM_PREFIX = "client/platform/";
const featureImports = [];
const legacyShellImports = [];
const platformReverse = [];
const platformFilesReverse = [];
const thirdParty = [];
for (const file of clientFiles) {
  const name = rel(file);
  const text = source(file);
  for (const spec of importsOf(text)) {
    if (!spec.startsWith(".") && !spec.startsWith("node:")) {
      thirdParty.push(name + " → " + spec);
      continue;
    }
    if (!name.startsWith(FEATURE_PREFIX)) continue;
    // registry 是 features 层的聚合点，职责就是收集各模块的 descriptor 元数据（不是实现）。
    // 只放行这一种形状：features/registry.ts → ./<feature>/descriptor.js
    if (name === FEATURE_PREFIX + "registry.ts" && /^\.\/[^/]+\/descriptor\.js$/.test(spec)) continue;
    const host = name.slice(FEATURE_PREFIX.length).split("/")[0];
    // 迁移期遗留：feature 把根目录旧 *-module.ts 原样转发一层。只许减少，不许新增。
    if (spec === "../../" + host + "-module.js") {
      legacyShellImports.push(name + " → " + spec);
      continue;
    }
    // features → platform 是允许的方向（platform 在上一级，所以是 ../../platform/）。
    if (spec.startsWith("../../platform/") || spec.startsWith("../platform/")) continue;
    featureImports.push(name + " → " + spec);
  }
  if (name.startsWith(PLATFORM_PREFIX) && /from\s+["']\.\.\/(features|shell)\//.test(text)) {
    platformReverse.push(name);
  }
  if (name.startsWith(PLATFORM_PREFIX) && /from\s+["']\.\.\/shell\//.test(text)) {
    platformFilesReverse.push(name);
  }
}
check("客户端源码没有 import 第三方包", thirdParty.length === 0, thirdParty.slice(0, 3).join("; ") || undefined);
if (exists(FEATURES)) {
  check("features 之间零跨模块 import", featureImports.length === 0, featureImports.slice(0, 3).join("; ") || undefined);
  check(
    "feature 转发根目录旧模块 ≤ " + BASELINE.legacyFeatureShellImports + "（当前 " + legacyShellImports.length + "）",
    legacyShellImports.length <= BASELINE.legacyFeatureShellImports,
    legacyShellImports.length > BASELINE.legacyFeatureShellImports
      ? "新增了「feature 只转发旧 module」的壳：" + legacyShellImports.slice(-3).join("; ")
      : legacyShellImports.length === 0
        ? undefined
        : "迁移完成后可把 BASELINE 调到 " + legacyShellImports.length + " 以下：" + legacyShellImports.map(entry => entry.split(" → ")[0]).join(", ")
  );
} else {
  skip("features 之间零跨模块 import", "features/ 还没建（P3 起生效）");
  skip("feature 转发根目录旧模块 ≤ 7", "features/ 还没建（P3 起生效）");
}
check("platform 不反向依赖 features / shell", platformReverse.length === 0, platformReverse.join(", ") || undefined);
check("platform 不依赖 shell（依赖只能单向：shell → features → platform）", platformFilesReverse.length === 0);

// 入口文件只剩「注册插件 + 取 React」；装配全在 shell/bootstrap.ts。
const clientEntryLineCount = source(SRC + "/client.ts").split("\n").length;
check(
  "client.ts（入口）≤ 400 行（当前 " + clientEntryLineCount + " 行）",
  clientEntryLineCount <= 400,
  clientEntryLineCount > 400 ? "装配代码应放到 shell/ 里" : undefined
);
check("platform 不在模块顶层 import react（必须由 runtime 注入）", clientFiles.filter(f => rel(f).startsWith("client/platform/") && /^import\s+.*from\s+["']react["']/m.test(source(f))).length === 0);

// 单文件 esbuild 打包会把跨模块重名的顶层标识符改名为 xxx2，而自检里有一批
// 「按源码文本钉住调用点」的契约（例如 mergeDrafts 的参数名），一旦被改名就变红。
// 已踩：runtime.ts 的模块级 current 让 mergeDrafts 的参数变成 current2。
const GENERIC_NAMES = new Set(["current", "next", "value", "state", "props", "data", "item", "items", "list", "listeners", "result", "index", "ref"]);
const genericHits = [];
for (const file of clientFiles) {
  if (!rel(file).startsWith("client/platform/")) continue;
  const lines = source(file).split("\n");
  for (const line of lines) {
    const match = /^(?:export )?(?:const|let|function|class)\s+([A-Za-z0-9_$]+)/.exec(line);
    if (match === null) continue;
    if (GENERIC_NAMES.has(match[1])) genericHits.push(rel(file) + " → " + match[1]);
  }
}
check("platform 顶层标识符避开通用名（避免打包重命名破坏文本契约）", genericHits.length === 0, genericHits.slice(0, 4).join("; ") || undefined);

// ── 2. 裸定时器 / 裸 fetch（棘轮）────────────────────────────────────────
section("资源与请求（棘轮：只许降不许涨）");
const legacy = clientFiles.filter(file => !rel(file).startsWith("client/platform/"));
const count = (files, pattern) => files.reduce((sum, file) => sum + (source(file).match(pattern) ?? []).length, 0);
const timers = count(legacy, /setInterval|setTimeout/g);
const fetches = count(legacy, /\bfetch\(/g);
const listeners = count(legacy, /addEventListener/g);
check(
  "非 platform 定时器 ≤ " + BASELINE.legacyTimers + "（当前 " + timers + "）",
  timers <= BASELINE.legacyTimers,
  timers > BASELINE.legacyTimers ? "新增了裸定时器：请改用 scheduler / lifecycle" : undefined
);
check(
  "非 platform 裸 fetch ≤ " + BASELINE.legacyFetch + "（当前 " + fetches + "）",
  fetches <= BASELINE.legacyFetch,
  fetches > BASELINE.legacyFetch ? "新增了裸 fetch：请改用 platform/api" : undefined
);
check(
  "非 platform addEventListener ≤ " + BASELINE.legacyListeners + "（当前 " + listeners + "）",
  listeners <= BASELINE.legacyListeners,
  listeners > BASELINE.legacyListeners ? "新增了裸监听：请改用 lifecycle.useResources()" : undefined
);

// ── 3. feature 结构（迁移期跳过）────────────────────────────────────────
section("feature 结构");
if (!exists(FEATURES)) {
  skip("每个 feature 有 descriptor.ts", "features/ 还没建（P3 起生效）");
  skip("registry 覆盖全部 features", "registry 在 P6 建立");
  skip("每个 feature 根组件被 FeatureBoundary 包裹", "P2 起生效");
} else {
  const dirs = readdirSync(FEATURES).filter(name => exists(FEATURES + "/" + name));
  const missing = dirs.filter(name => !fileExists(FEATURES + "/" + name + "/descriptor.ts"));
  check("每个 feature 有 descriptor.ts", missing.length === 0, missing.join(", ") || undefined);
  const registryPath = FEATURES + "/registry.ts";
  if (!fileExists(registryPath)) {
    skip("registry 覆盖全部 features", "registry.ts 还没建（P6）");
  } else {
    const registry = source(registryPath);
    const unregistered = dirs.filter(name => !registry.includes(name));
    check("registry 覆盖全部 features", unregistered.length === 0, unregistered.join(", ") || undefined);
  }
  const unwrapped = dirs.filter(name => {
    const index = FEATURES + "/" + name + "/index.ts";
    if (!fileExists(index)) return true;
    return !/createFeatureBoundary|FeatureBoundary/.test(source(index));
  });
  check("每个 feature 根组件被 FeatureBoundary 包裹", unwrapped.length === 0, unwrapped.join(", ") || undefined);
}

// ── 4. 产物体积预算 ─────────────────────────────────────────────────────
section("产物体积");
let bundle = null;
try {
  bundle = readFileSync(BUNDLE);
} catch {
  bundle = null;
}
check("lib/client.js 存在", bundle !== null);
if (bundle !== null) {
  const gz = gzipSync(bundle, { level: 9 }).length;
  check(
    "raw ≤ " + BUDGET.rawBytes + " B（当前 " + bundle.length + " B）",
    bundle.length <= BUDGET.rawBytes,
    bundle.length > BUDGET.rawBytes ? "超预算：删死代码或收敛重复实现" : undefined
  );
  check(
    "gzip ≤ " + BUDGET.gzipBytes + " B（当前 " + gz + " B）",
    gz <= BUDGET.gzipBytes,
    gz > BUDGET.gzipBytes ? "超预算" : undefined
  );
  check("产物是经典脚本（没有 import/export）", !/^\s*(import|export)\s/m.test(bundle.toString("utf8")));
}

// ── 汇总 ────────────────────────────────────────────────────────────────
console.log("");
if (failures.length === 0) {
  console.log("共 " + checks + " 项检查，全部通过" + (skips.length === 0 ? "" : "（" + skips.length + " 项迁移期跳过）") + "。");
  process.exit(0);
}
console.log("共 " + checks + " 项检查，失败 " + failures.length + " 项：" + failures.join("；"));
process.exit(1);