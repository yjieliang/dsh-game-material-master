/**
 * 从 src/client.ts 里抽出所有 T("…") 的原文，找出**还没进词条表**的那些。
 *
 * 漏译在界面上只表现为「这一条一直是中文」，不会报错，所以必须靠工具抓。
 * 输出格式直接可以贴进 src/client.ts 的词条表。
 */
import { clientSourceText } from "./lib/client-source.mjs";

const text = clientSourceText();
const found = new Map();
for (const match of text.matchAll(/\bT\(\s*"((?:[^"\\]|\\.)*)"/g)) {
  found.set(match[1], (found.get(match[1]) ?? 0) + 1);
}

/** 词条表边界用起止标记，不依赖「下一个顶层 const」（表已搬到 src/client/i18n-en.ts）。 */
const start = text.indexOf("i18n-ignore-start");
const end = text.indexOf("i18n-ignore-end", start);
if (start < 0 || end < 0) throw new Error("找不到词条表 EN 的起止标记");
const table = text.slice(start, end);

const missing = [...found.keys()].filter((key) => !table.includes(JSON.stringify(key) + ":"));
console.log(`T() 原文共 ${found.size} 条；词条表里没有的 ${missing.length} 条`);
if (missing.length > 0) {
  console.log("\n// ── 待补词条（填上英文后贴进 EN）──");
  for (const key of missing) console.log(`  ${JSON.stringify(key)}: "",`);
}
const withPlaceholder = [...found.keys()].filter((key) => /\{\w+\}/.test(key));
if (withPlaceholder.length > 0) {
  console.log("\n// ── 带占位符的（英文里必须保留同名占位符）──");
  for (const key of withPlaceholder) console.log(`  ${JSON.stringify(key)}`);
}
