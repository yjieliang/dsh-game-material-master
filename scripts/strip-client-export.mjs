// 构建后置校验：浏览器束必须是**普通脚本**（浏览器没有模块加载器）。
//
// 两步构建之后 `tsc` 追加的 `export {};` 一般已被 esbuild 丢掉；这里做的是
// 「不管前面怎么变，最后再确认一次」：有残留就剥掉并说明，同时任何 import/export
// 都视为契约被破坏 —— 静默带进浏览器只会得到一行 SyntaxError。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../lib/client.js", import.meta.url));
const src = readFileSync(file, "utf8");

const stripped = src.replace(/\nexport \{\};\s*$/, "\n");
if (stripped !== src) {
  writeFileSync(file, stripped, "utf8");
  console.log("strip-client-export: 已剥掉结尾的 'export {};'");
}

const leftover = /^\s*(?:import|export)\s/m.exec(stripped);
if (leftover !== null) {
  console.error(`strip-client-export: 产物里仍有模块语法 —— ${leftover[0].trim()}（经典脚本契约被破坏）`);
  process.exit(1);
}
console.log("strip-client-export: lib/client.js 是经典脚本");
