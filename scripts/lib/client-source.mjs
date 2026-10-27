/**
 * 浏览器半区的**源码集合**。
 *
 * 现状是单文件 `src/client.ts`；模块化之后会变成 `src/client/**\/*.ts`。
 * 所有自检脚本一律经这里读源码，不要各自拼路径 —— 这些静态断言是仓库里唯一的
 * 浏览器半区护栏，拆分当天一起失效的代价太高。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根（本文件在 `scripts/lib/` 下）。 */
export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * 源码文件清单（相对仓库根的 POSIX 风格路径，稳定排序）。
 *
 * 同时支持两种布局：单文件 `src/client.ts`，或目录 `src/client/`。
 * 拆分过程中两者会短暂共存，这里按“单文件在前、目录内按路径排序”拼接。
 */
export function clientSourceFiles() {
  const single = join(ROOT, "src", "client.ts");
  const dir = join(ROOT, "src", "client");
  const files = [];
  if (existsSync(single)) files.push(relative(ROOT, single).replaceAll("\\", "/"));
  if (existsSync(dir)) {
    files.push(...walk(dir).map((file) => relative(ROOT, file).replaceAll("\\", "/")).sort());
  }
  return files;
}

/** 全部源码拼成一份文本（给只做正则 / 切片断言的检查用）。 */
export function clientSourceText() {
  return clientSourceFiles()
    .map((file) => readFileSync(join(ROOT, file), "utf8"))
    .join("\n");
}
