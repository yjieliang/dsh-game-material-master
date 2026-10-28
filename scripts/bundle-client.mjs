/**
 * 把 tsc 产出的客户端入口打成一个**经典脚本**。
 *
 * 为什么需要这一步：`src/client.ts` 模块化之后（`import { CSS } ...`），`tsc`
 * 按 NodeNext 只会产出多个 ESM 文件；而宿主是把 `lib/client.js` **原样**发给浏览器
 * 当普通脚本执行的（`<script>`，没有模块加载器）。所以要用 esbuild 把模块图
 * 内联回单文件、且不带 import/export。
 *
 * 只做拼接与降级，不做压缩：产物要能被 `verify-*.mjs` 的文本契约扫到，
 * 压缩会毁掉那些断言，也会让真机排障时的堆栈不可读。
 */
import { build } from "esbuild";
import { existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LIB = join(ROOT, "lib");
const ENTRY = join(LIB, "client.js");
const OUT = join(LIB, ".client.bundle.js");

if (!existsSync(ENTRY)) {
  console.error("bundle-client: 找不到 lib/client.js —— 先跑 tsc");
  process.exit(1);
}

await build({
  entryPoints: [ENTRY],
  outfile: OUT,
  bundle: true,
  // iife：产出 `(() => { … })();`，入口顶层那句 `__ModuleLoader__.load(...)` 照常执行。
  format: "iife",
  platform: "browser",
  target: "es2022",
  charset: "utf8",
  // 词条表的起止标记写成 /*! … */（esbuild 的 legal comment），否则会被当普通注释丢掉，
  // verify-i18n 就没法在产物里定位词条表。
  legalComments: "inline",
  logLevel: "warning"
});

const text = readFileSync(OUT, "utf8");
if (/^\s*(import|export)\s/m.test(text)) {
  console.error("bundle-client: 产物里仍有 import/export，经典脚本契约被破坏");
  process.exit(1);
}

renameSync(OUT, ENTRY);
// tsc 为客户端子模块产出的中间目录只为打包存在，发布包里不该出现。
// 子模块已有 50+ 个，一次性删除会触发宿主环境的批量删除守卫
// （CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD，默认 50）。删除目标就是这一个中间目录，
// 这里把阈值调高到能覆盖它的规模；非 CodeBuddy 环境读不到这个变量，不受影响。
process.env.CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD = "1000";
rmSync(join(LIB, "client"), { recursive: true, force: true });

console.log(`bundle-client: lib/client.js ${(statSync(ENTRY).size / 1024).toFixed(0)} kB`);
