/**
 * 可重复执行的体检入口：类型检查 → 构建 → 产物体检 → 一组自检脚本。
 *
 *   node scripts/gate.mjs                       # 核心 6 个脚本
 *   node scripts/gate.mjs --full                # 全部 verify-*.mjs
 *   node scripts/gate.mjs --except=a.mjs,b.mjs  # 显式豁免本机跑不了的脚本（会计入汇总）
 *   node scripts/gate.mjs --record              # 顺手把本次结果记成基线
 *   node scripts/gate.mjs --compare             # 与上次基线比检查项数
 *   node scripts/gate.mjs --release             # 追加「构建产物与提交版本一致」
 *
 * 缺依赖时 typecheck / build 标 SKIP；被 `--except` 豁免的脚本标 EXCLUDED。
 * 三种都不是通过：跑不了就说跑不了，不冒充绿。基线写在 `.verify/`（已 gitignore）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASELINE = join(ROOT, ".verify", "gate-baseline.json");
const argv = process.argv.slice(2);
const FULL = argv.includes("--full");
const RELEASE = argv.includes("--release");
const RECORD = argv.includes("--record");
const COMPARE = argv.includes("--compare");
const EXCEPT = new Set(
  argv
    .filter((arg) => arg.startsWith("--except="))
    .flatMap((arg) => arg.slice("--except=".length).split(","))
    .map((name) => name.trim())
    .filter((name) => name !== "")
);

/** 核心脚本：不联网、不花钱，覆盖协议 / 宿主 / 浏览器半区 / 词条 / 流水线。 */
const CORE_SCRIPTS = [
  "verify-host.mjs",
  "verify-tools.mjs",
  "verify-client.mjs",
  "verify-feedback.mjs",
  "verify-i18n.mjs",
  "verify-pipeline.mjs",
  "verify-arch.mjs"
];

const results = [];
const record = (name, status, detail) => {
  results.push({ name, status, detail: detail ?? "" });
  const mark = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : status === "WARN" ? "!" : "–";
  console.log(`${mark} ${name}${detail === "" ? "" : `  ${detail}`}`);
};

function run(args, shell = false) {
  const started = Date.now();
  const result = spawnSync(args[0], args.slice(1), {
    cwd: ROOT,
    encoding: "utf8",
    shell,
    timeout: 15 * 60 * 1000
  });
  return {
    ok: result.status === 0,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    ms: Date.now() - started
  };
}

/** 自检脚本自己打印项数，写法各家不同，这里只认三种。 */
function checksOf(out) {
  for (const pattern of [/共\s*(\d+)\s*项检查/, /(\d+)\s*checks passed/, /(\d+)\s*项检查/]) {
    const match = pattern.exec(out);
    if (match !== null) return Number(match[1]);
  }
  return undefined;
}

/** 失败原因取「最像根因」的那一行，而不是输出末尾的堆栈点缀。 */
function firstError(out) {
  const lines = out.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  // 自检脚本自己的 ✗ 断言最贴近现场；其次是抛出的 Error；最后才退到通用关键字。
  const own = lines.filter((line) => line.startsWith("✗"));
  const picked =
    own[own.length - 1] ??
    lines.find((line) => /^(Error|TypeError|RangeError|AssertionError)\b/.test(line)) ??
    lines.find((line) => /failed|失败|not found|cannot|无法/.test(line)) ??
    lines[lines.length - 1] ??
    "";
  return picked.length > 180 ? `${picked.slice(0, 177)}…` : picked;
}

const hasDeps = existsSync(join(ROOT, "node_modules", "typescript")) && existsSync(join(ROOT, "node_modules", "@deepseek-ai", "cordis"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

console.log(`\n== 体检：${ROOT}`);
console.log(`== 开发依赖：${hasDeps ? "已安装" : "缺失（typecheck / build 会跳过）"}`);
if (EXCEPT.size > 0) console.log(`== 显式豁免：${[...EXCEPT].join("、")}`);
console.log("");

// ── 1. 类型检查 ───────────────────────────────────────────────────────────
if (hasDeps) {
  const typed = run([npm, "run", "typecheck"], true);
  record("typecheck", typed.ok ? "PASS" : "FAIL", typed.ok ? `${typed.ms}ms` : firstError(typed.out));
} else {
  record("typecheck", "SKIP", "缺少 node_modules（先 npm install）");
}

// ── 2. 构建 ───────────────────────────────────────────────────────────────
if (hasDeps) {
  const built = run([npm, "run", "build"], true);
  record("build", built.ok ? "PASS" : "FAIL", built.ok ? `${built.ms}ms` : firstError(built.out));
} else {
  record("build", "SKIP", "缺少 node_modules（先 npm install）");
}

// ── 3. 产物体检 ───────────────────────────────────────────────────────────
{
  // `src/client/**` 是客户端源码，被 bundle-client.mjs 内联进 lib/client.js，不单独产出。
  const srcFiles = readdirSync(join(ROOT, "src"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name)
    .sort();
  const libFiles = new Set(readdirSync(join(ROOT, "lib")).filter((name) => name.endsWith(".js")));
  const missing = srcFiles.map((name) => `${name.slice(0, -3)}.js`).filter((name) => !libFiles.has(name));
  record(
    "artifacts: src→lib 一一对应",
    missing.length === 0 ? "PASS" : "FAIL",
    missing.length === 0 ? `${srcFiles.length} 个顶层模块` : `缺 ${missing.join("、")}`
  );

  // 客户端子模块只为打包存在，发布包里不该出现目录形态。
  const strayModuleDir = existsSync(join(ROOT, "lib", "client"));
  record(
    "artifacts: 客户端中间产物已清理",
    strayModuleDir ? "FAIL" : "PASS",
    strayModuleDir ? "lib/client/ 还在：bundle-client 没跑完" : "lib/client.js 单文件"
  );

  const bundle = readFileSync(join(ROOT, "lib", "client.js"), "utf8");
  // 体积按字节算，不能用字符串长度：产物里中文注释多，字符数比字节数小一成以上。
  const bundleBytes = Buffer.byteLength(bundle);
  // 经典脚本：浏览器拿到的必须是普通脚本，不能有模块语法残留。
  const strayImport = /^\s*import\s/m.test(bundle);
  const strayExport = /^\s*export\s/m.test(bundle);
  const strayTail = /export\s*\{\s*\}\s*;?\s*$/.test(bundle);
  const clean = !strayImport && !strayExport && !strayTail;
  record(
    "artifacts: client.js 是经典脚本",
    clean ? "PASS" : "FAIL",
    clean ? `${bundleBytes} 字节` : `${strayImport ? "有 import；" : ""}${strayExport ? "有 export；" : ""}${strayTail ? "残留 export {};" : ""}`
  );

  // 体积预算（docs/客户端架构方案 §3；2026-10-29 重构设计 §15 裁决上调为 ≤1.3 MB raw）。
  // 越过预警线提前亮出来，否则要等某次改动直接顶穿、产物发不出去才发现。
  const BUDGET_BYTES = 1.3 * 1024 * 1024;
  // 预警线设在硬线的 96%：2026-10-29 合并 skill 能力后已达到 1,263,177 B（93%），
  // 按旧比例（1.05/1.2 ≈ 87.5%）会立刻误报——预警线的意义是「离硬线只剩一两次改动的余量」。
  const WARN_BYTES = 1.25 * 1024 * 1024;
  const sizeStatus = bundleBytes > BUDGET_BYTES ? "FAIL" : bundleBytes > WARN_BYTES ? "WARN" : "PASS";
  record(
    "artifacts: client.js 体积",
    sizeStatus,
    `${bundleBytes} 字节 · 已用 ${Math.round((bundleBytes / BUDGET_BYTES) * 100)}% / ${(BUDGET_BYTES / 1024 / 1024).toFixed(1)} MB`
  );

  const entry = readFileSync(join(ROOT, "lib", "index.js"), "utf8");
  const entryOk = entry.includes("class GameStudioGateway") && entry.includes("export function apply");
  record("artifacts: 入口导出面完整", entryOk ? "PASS" : "FAIL", entryOk ? "GameStudioGateway / apply" : "缺少导出");
}

// ── 4. 自检脚本 ───────────────────────────────────────────────────────────
const scripts = FULL
  ? readdirSync(join(ROOT, "scripts")).filter((name) => /^verify-.*\.mjs$/.test(name)).sort()
  : CORE_SCRIPTS;

console.log("");
const amounts = {};
for (const name of scripts) {
  if (!existsSync(join(ROOT, "scripts", name))) {
    record(name, "SKIP", "脚本不存在");
    continue;
  }
  if (EXCEPT.has(name)) {
    record(name, "EXCLUDED", "本次显式豁免，未跑");
    continue;
  }
  const ran = run([process.execPath, join("scripts", name)]);
  const checks = checksOf(ran.out);
  if (checks !== undefined) amounts[name] = checks;
  const needsDeps = /ERR_MODULE_NOT_FOUND/.test(ran.out) && !hasDeps;
  record(
    name,
    ran.ok ? "PASS" : needsDeps ? "SKIP" : "FAIL",
    ran.ok
      ? `${checks === undefined ? "?" : checks} 项 / ${ran.ms}ms`
      : needsDeps
        ? "缺少 node_modules"
        : firstError(ran.out)
  );
}

// ── 5. 发布前追加：构建产物必须与提交版本一致 ─────────────────────────────
if (RELEASE) {
  const diff = run(["git", "diff", "--quiet", "--", "lib"]);
  record(
    "release: lib 与 src 同步",
    diff.ok ? "PASS" : "FAIL",
    diff.ok ? "构建产物无未提交差异" : "lib/ 与已提交版本不一致：先 build 并一并提交"
  );
}

// ── 汇总 ─────────────────────────────────────────────────────────────────
const failed = results.filter((row) => row.status === "FAIL");
const warned = results.filter((row) => row.status === "WARN");
const passed = results.filter((row) => row.status === "PASS").length;
const skipped = results.filter((row) => row.status === "SKIP").length;
const excluded = results.filter((row) => row.status === "EXCLUDED");
const warnPart = warned.length > 0 ? ` / WARN ${warned.length}` : "";
console.log(`\n== 结果：PASS ${passed}${warnPart} / SKIP ${skipped} / EXCLUDED ${excluded.length} / FAIL ${failed.length}`);
if (excluded.length > 0) console.log(`== 未验证（换环境或去掉 --except 后需补跑）：${excluded.map((row) => row.name).join("、")}`);

if (RECORD) {
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, `${JSON.stringify({ generatedAt: new Date().toISOString(), scripts: amounts }, null, 2)}\n`, "utf8");
  console.log(`== 基线已写入 ${BASELINE}`);
}

if (COMPARE) {
  if (!existsSync(BASELINE)) {
    console.log("== 没有基线可比较（先跑一次 --record）");
  } else {
    const base = JSON.parse(readFileSync(BASELINE, "utf8")).scripts ?? {};
    console.log(`\n== 与基线（${Object.keys(base).length} 个脚本）比较检查项数：`);
    for (const [name, was] of Object.entries(base)) {
      const now = amounts[name];
      console.log(`  ${name}: ${now === undefined ? "本次未跑" : now === was ? "持平" : `${was} → ${now}`}`);
    }
    for (const [name, now] of Object.entries(amounts)) {
      if (base[name] === undefined) console.log(`  ${name}: 基线里没有，本次 ${now} 项`);
    }
  }
}

// WARN 与 FAIL 一样让本次体检失败：预警项不处理，下一次改动就会直接顶穿。
if (failed.length > 0 || warned.length > 0) {
  if (failed.length > 0) console.error(`\n失败项：${failed.map((row) => row.name).join("、")}`);
  if (warned.length > 0) console.error(`\n需处理（WARN）：${warned.map((row) => row.name).join("、")}`);
  process.exit(1);
}
console.log("\n体检通过（不含未跑项）。");
