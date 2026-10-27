/**
 * P0 基线测量：把「一次挂载渲染了多少、一次数据变更重渲染了多少」量出来。
 *
 *   node scripts/perf-baseline.mjs
 *
 * 做法：用假 React 加载 lib/client.js（与 verify-feedback 同一套路），
 * 统计 createElement 调用 —— 每一次「组件函数被调用」记一笔，按组件名聚合。
 * 这不是浏览器帧率，但足以对比「改前 / 改后」的重渲染面，避免凭感觉优化。
 *
 * 输出：挂载期渲染表 + 一个 JSON 摘要（可存档当基线）。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = process.argv[2] ?? fileURLToPath(new URL("../lib/client.js", import.meta.url));
const code = readFileSync(target, "utf8");

// ── 渲染计数：包一层 createElement，记录每次组件函数调用 ──────────────────
const renders = new Map();
let totalRenders = 0;
const HOOK = { slots: [], cursor: 0 };

const ReactStub = {
  Fragment: Symbol.for("react.fragment"),
  createElement(type, props, ...children) {
    if (typeof type === "function") {
      totalRenders++;
      const name = type.name || "(anonymous)";
      renders.set(name, (renders.get(name) ?? 0) + 1);
    }
    return { type, props: props ?? {}, children };
  },
  useState(initial) {
    const index = HOOK.cursor++;
    const value = HOOK.slots[index];
    return [value === undefined ? (typeof initial === "function" ? initial() : initial) : value, () => {}];
  },
  useRef(initial) {
    HOOK.cursor++;
    return { current: initial };
  },
  useEffect() {},
  useLayoutEffect() {},
  useMemo(factory) {
    return factory();
  },
  useCallback(fn) {
    return fn;
  },
  useContext() {
    return {};
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot();
  },
  createContext() {
    return { Provider: Symbol.for("ctx.provider"), Consumer: Symbol.for("ctx.consumer") };
  },
  memo(component) {
    return component;
  },
  forwardRef(fn) {
    return fn;
  },
  Component: class Component {
    constructor(props) {
      this.props = props ?? {};
      this.state = {};
    }
    setState(patch) {
      this.state = { ...this.state, ...(typeof patch === "function" ? patch(this.state) : patch) };
    }
  }
};

// ── 假模块加载器：抓住插件体，不真的挂到 DOM ──────────────────────────────
let captured = null;
globalThis.window = globalThis;
globalThis.__ModuleLoader__ = {
  load(definition) {
    captured = definition;
  }
};
globalThis.setTimeout = globalThis.setTimeout;
globalThis.clearTimeout = globalThis.clearTimeout;
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
globalThis.document = {
  visibilityState: "visible",
  addEventListener() {},
  removeEventListener() {}
};

const run = new Function("require", "globalThis", code + "\nreturn undefined;");
run((id) => {
  if (id === "react") return ReactStub;
  throw new Error("perf-baseline: 未预期的 require(" + id + ")");
}, globalThis);

if (captured === null) {
  console.error("perf-baseline: 没能抓住插件体（__ModuleLoader__.load 未调用）");
  process.exit(1);
}

const exported = captured.factory((id) => {
  if (id === "react") return ReactStub;
  throw new Error("perf-baseline: 未预期的 require(" + id + ")");
});
const test = exported?.__test ?? {};
const names = Object.keys(test).filter((key) => typeof test[key] === "function");

// ── 挂载：渲染 StudioPanel（工作台根组件）一次，统计渲染面 ─────────────────
const tick = (label) => {
  HOOK.cursor = 0;
  renders.clear();
  totalRenders = 0;
  const before = Date.now();
  let ok = true;
  let error = "";
  try {
    const Panel = test.StudioPanel;
    if (typeof Panel !== "function") throw new Error("__test 里没有 StudioPanel");
    // 先建 renderTree（函数声明提升；定义在下方也没问题）
    renderTree(ReactStub.createElement(Panel, {
      api: {
        getConfig: async () => ({}),
        listProjects: async () => [],
        getProject: async () => ({}),
        removeListener: () => {}
      },
      ctx: { remote: {} }
    }));
  } catch (caught) {
    ok = false;
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const ms = Date.now() - before;
  console.log("\n[" + label + "] 渲染组件调用 " + totalRenders + " 次，耗时 " + ms + " ms" + (ok ? "" : "（抛错：" + error + "）"));
  const top = [...renders].sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [name, count] of top) console.log("   " + name.padEnd(28) + count);
  return { label, totalRenders, ms, ok, error, top };
};

const mount = tick("mount");

// 渲染计数接线自检：面板每次渲染都会记一笔（真机看 __GMM_PERF__）。
const panelRenders = globalThis.__GMM_PERF__ ? globalThis.__GMM_PERF__.renderCount("StudioPanel") : -1;
console.log("StudioPanel 渲染计数 = " + panelRenders);

// 再逐个渲染各模块根组件：得到「每个模块挂载一次的渲染面」基线
const apiStub = {
  getConfig: async () => ({}),
  saveConfig: async () => ({}),
  listProjects: async () => [],
  listMapProjects: async () => [],
  listIsoProjects: async () => [],
  listMusicJobs: async () => [],
  listSfxJobs: async () => [],
  listSequenceJobs: async () => [],
  listRigJobs: async () => [],
  getProject: async () => ({}),
  getMapProject: async () => ({}),
  getIsoProject: async () => ({}),
  getMusicJob: async () => ({}),
  getSfxJob: async () => ({}),
  getSequenceJob: async () => ({}),
  getRigJob: async () => ({}),
  removeListener: () => {}
};
/**
 * 递归渲染：模拟 React 真正做的事 —— 遇到函数组件就调用它，继续往下走。
 * 假 React 的 createElement 只返回对象，不递归，所以这里补上；否则量到的
 * 只是第一层，数字没意义。
 * @param node - createElement 返回值
 * @param depth - 递归深度上限（防止坏组件无限展开）
 */
function renderTree(node, depth = 0) {
  if (node === null || node === undefined || node === false) return;
  if (typeof node === "string" || typeof node === "number") return;
  if (Array.isArray(node)) {
    for (const child of node) renderTree(child, depth);
    return;
  }
  if (depth > 40) return;
  const { type, props, children } = node;
  if (typeof type === "function") {
    HOOK.cursor = 0;
    let out;
    try {
      out = type(props ?? {});
    } catch {
      return;
    }
    renderTree(out, depth + 1);
    return;
  }
  for (const child of children ?? []) renderTree(child, depth + 1);
}

const moduleNames = ["ImageModule", "SequenceModule", "RigModule", "IsoModule", "MapModule", "MusicModule", "SfxModule", "ConfigSection"];
const modules = [];
for (const name of moduleNames) {
  const component = test[name];
  if (typeof component !== "function") { modules.push({ name, missing: true }); continue; }
  HOOK.cursor = 0;
  renders.clear();
  totalRenders = 0;
  const started = Date.now();
  let error = "";
  try {
    const element = ReactStub.createElement(component, { api: apiStub, ctx: { remote: {} } });
    renderTree(element);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const row = { name, renders: totalRenders, ms: Date.now() - started, error };
  modules.push(row);
}
console.log("\n[modules] 各模块根组件挂载一次");
for (const row of modules) {
  if (row.missing) { console.log("   " + row.name.padEnd(20) + "（未导出）"); continue; }
  console.log("   " + row.name.padEnd(20) + String(row.renders).padStart(4) + " 次" + (row.error === "" ? "" : "  抛错：" + row.error));
}

const summary = {
  bundle: target,
  bundleBytes: Buffer.byteLength(code),
  componentsExposed: names.length,
  mount,
  modules
};
console.log("\n=== 摘要 ===");
console.log(JSON.stringify({ bundleBytes: summary.bundleBytes, componentsExposed: names.length, mount: { totalRenders: mount.totalRenders, ms: mount.ms, ok: mount.ok, top: mount.top } }, null, 1));