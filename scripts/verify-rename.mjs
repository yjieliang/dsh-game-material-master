/**
 * 改名回归（0.12.0：游戏素材大师 → 墨盒 / dsh-inkbox；模块① 八方向图生成 → 动画帧工具盒）。
 *
 * 为什么单独一个脚本：这次改名把**包名 / bundle id / 资源路由 / 数据目录**一起换了，
 * 而这四处漏一处都**不报错**——路由漏了只是图片 404，数据目录漏了只是「项目全没了」。
 * 另外旧目录迁移是「一次性」的，以后没人会再跑到，必须有回归钉住它。
 *
 * 纯本地、不联网、不花钱、不依赖 ffmpeg。
 */
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const failures = [];
let total = 0;
const check = (name, ok, detail = "") => {
  total += 1;
  if (!ok) failures.push(name);
  console.log(`${ok ? "✓" : "✗"} ${name}${detail === "" ? "" : " — " + detail}`);
};
const readText = (rel) => readFile(join(ROOT, rel), "utf8");
const exists = (p) => stat(p).then(() => true).catch(() => false);

console.log("\n── 1) 标识一致性 ──");
const pkg = JSON.parse(await readText("package.json"));
check("package.json 的包名是 dsh-inkbox", pkg.name === "dsh-inkbox", pkg.name);
check("package.json 的仓库指向 dsh-inkbox", String(pkg.repository?.url ?? "").includes("dsh-inkbox"), pkg.repository?.url);

const wire = await readText("lib/wire.js");
check("宿主 PACKAGE_NAME = dsh-inkbox", /export const PACKAGE_NAME = "dsh-inkbox"/.test(wire));
const assets = await readText("lib/assets.js");
check("资源路由前缀 = /dsh-inkbox", /export const ROUTE_PREFIX = "\/dsh-inkbox"/.test(assets));
const client = await readText("lib/client.js");
check("浏览器束里的 PACKAGE = dsh-inkbox", /const PACKAGE = "dsh-inkbox"/.test(client));
check("浏览器束里注册的插件 id = dsh-inkbox", /id: "dsh-inkbox"/.test(client));

const patch = await readText("cordis.patch.yml");
check("cordis.patch.yml 的 bundle id = inkbox", /- id: inkbox/.test(patch));
check("cordis.patch.yml 的插件名 = dsh-inkbox", /name: dsh-inkbox/.test(patch));

const manifest = JSON.parse(await readText("package.json")).dsh;
check("package.json 仍以 cordis.patch.yml 为 bundle patch", manifest?.bundle?.patch === "./cordis.patch.yml");

console.log("\n── 2) 文案与词条 ──");
const i18n = await readText("src/client/i18n-en.ts");
check("英文词条表有「墨盒」→ Inkbox", /"墨盒":\s*"Inkbox"/.test(i18n));
check(
  "英文词条表有「动画帧工具盒」→ Animation frame toolbox",
  /"动画帧工具盒":\s*"Animation frame toolbox"/.test(i18n)
);
const meta = await readText("src/client/platform/meta.ts");
check("模块表里 sprite 的标题是 动画帧工具盒", /key: "sprite", title: T\("动画帧工具盒"\)/.test(meta));
const tools = await readText("src/tools.ts");
check("对话模块名表里 sprite = 动画帧工具盒", /sprite: "动画帧工具盒"/.test(tools));

console.log("\n── 3) 源码里没有旧名字残留 ──");
const srcFiles = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.ts$/.test(entry.name)) srcFiles.push(full);
  }
}
await walk(join(ROOT, "src"));
const allowed = new Set(["src/config.ts", "src/index.ts"]); // 这两处是迁移逻辑 / 注释，必须提到旧名
const strays = [];
for (const file of srcFiles) {
  const rel = file.slice(ROOT.length).replace(/\\/g, "/");
  const text = await readFile(file, "utf8");
  for (const token of ["游戏素材大师", "Game Material Master", "dsh-game-material-master"]) {
    if (text.includes(token) && !allowed.has(rel)) strays.push(`${rel}: ${token}`);
  }
}
check("src/ 里没有旧名字残留（迁移代码除外）", strays.length === 0, strays.slice(0, 5).join(" | "));

console.log("\n── 4) 数据目录：默认位置与旧目录迁移 ──");

// 先 import 宿主入口（它会按正确顺序求值 config ↔ sfxapi 的循环依赖），再单独取 config 模块。
// 直接先 import lib/config.js 会踩到那对循环依赖的 TDZ（config → sfxapi → config），
// 这是既有的模块图顺序问题，与改名无关。
const defaultHome = await mkdtemp(join(tmpdir(), "inkbox-default-"));
process.env.DSH_HOME = defaultHome;
await import("../lib/index.js");
process.env.DSH_HOME = defaultHome;
const configModule = await import("../lib/config.js");
check("默认数据目录是 inkbox", configModule.dataRoot() === join(defaultHome, "inkbox"), configModule.dataRoot());
check("全新安装不创建多余目录", !(await exists(join(defaultHome, "inkbox"))));

async function makeLegacyHome({ emptyNew = false, contentfulNew = false } = {}) {
  const home = await mkdtemp(join(tmpdir(), "inkbox-migrate-"));
  const legacy = join(home, "game-material-master");
  await mkdir(join(legacy, "projects", "p1234567890ab"), { recursive: true });
  await writeFile(join(legacy, "config.json"), JSON.stringify({ arkApiKey: "sk-legacy", concurrency: 5 }), "utf8");
  await writeFile(join(legacy, "projects", "p1234567890ab", "project.json"), JSON.stringify({ id: "p1234567890ab", name: "旧项目" }), "utf8");
  if (emptyNew || contentfulNew) {
    await mkdir(join(home, "inkbox"), { recursive: true });
    if (contentfulNew) await writeFile(join(home, "inkbox", "config.json"), JSON.stringify({ arkApiKey: "sk-new" }), "utf8");
  }
  return home;
}

/** 迁移在 apply() 第一行同步执行；这里直接调那个同步函数（import 本身不动盘）。 */
function migrate(home) {
  process.env.DSH_HOME = home;
  return configModule.migrateLegacyDataRootSync();
}

{
  const home = await makeLegacyHome();
  check("旧目录名被迁移函数识别", migrate(home) === "game-material-master");
  check("旧目录 game-material-master/ 被改名成 inkbox/", !(await exists(join(home, "game-material-master"))) && (await exists(join(home, "inkbox"))));
  const cfg = JSON.parse(await readFile(join(home, "inkbox", "config.json"), "utf8"));
  check("迁移后 config.json（API Key）没丢", cfg.arkApiKey === "sk-legacy" && cfg.concurrency === 5, JSON.stringify(cfg));
  check("迁移后项目目录一起过来", (await readdir(join(home, "inkbox", "projects"))).includes("p1234567890ab"));
}
{
  const home = await makeLegacyHome({ emptyNew: true });
  migrate(home);
  const cfg = JSON.parse(await readFile(join(home, "inkbox", "config.json"), "utf8"));
  check("空 inkbox/ 残壳不会挡住迁移", !(await exists(join(home, "game-material-master"))) && cfg.arkApiKey === "sk-legacy");
}
{
  const home = await makeLegacyHome({ contentfulNew: true });
  migrate(home);
  const cfg = JSON.parse(await readFile(join(home, "inkbox", "config.json"), "utf8"));
  check("inkbox/ 已有内容时不覆盖，旧目录原样保留", cfg.arkApiKey === "sk-new" && (await exists(join(home, "game-material-master"))));
}
check("没有旧目录时迁移函数返回 null（不反复搬）", migrate(await mkdtemp(join(tmpdir(), "inkbox-fresh-"))) === null);

console.log(failures.length === 0 ? `\n共 ${total} 项检查，全部通过。\n改名回归全部通过。` : `\n有失败：${total - failures.length} 项通过，失败 ${failures.length} 项：${failures.join("、")}`);
process.exit(failures.length === 0 ? 0 : 1);
