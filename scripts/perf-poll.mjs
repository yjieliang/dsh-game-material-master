#!/usr/bin/env node
/**
 * 「一次轮询引发的组件重渲染」测量脚本（改前 / 改后同一份 harness）。
 *
 *   node scripts/perf-poll.mjs [bundle.js] [--label=改前] [--json=路径] [--scenarios=changed,idle]
 *   node scripts/perf-poll.mjs <改前.js> <改后.js> --labels=改前,改后
 *
 * 为什么需要它：scripts/perf-baseline.mjs 只能量「挂载一次渲染了多少」，证明不了
 * 「轮询回来之后有多少组件被重新调用」。这里把假 React 升级成一个能真正驱动重渲染的
 * 迷你渲染器，再用假时钟 + 假 setInterval 手动触发**一次调度器 tick**（等价于一次
 * 2.5 秒轮询到点），统计这一轮里被调用的组件函数次数。
 *
 * 假 React 覆盖了产物会用到的那部分语义：
 *   createElement / Fragment / memo（含自定义比较）/ forwardRef / createContext + Provider
 *   / useState（可用的 setter，标记脏 + 触发该实例重渲染）/ useRef（跨渲染保持）
 *   / useEffect / useLayoutEffect（挂载后执行、cleanup、依赖数组比较）
 *   / useCallback / useMemo / useSyncExternalStore（订阅 + 快照比较）/ Component 类组件
 *   / 错误边界（getDerivedStateFromError + componentDidCatch，只降级该子树）
 *
 * 组件实例按「父实例 + key/位置」保存 Hook 槽位；父组件重渲染时，子组件会重新渲染
 * （除非 memo 相等），而某个组件自己的 setState 只重渲染它自己 —— 这两条正是
 * 「改前整棵树 / 改后精确订阅」差异的来源。
 *
 * 两个场景（各自挂载一次，互相隔离）：
 *   1. changed —— 有任务在跑时轮询回来的数据**有变**（images.upLeft: running -> ready）
 *   2. idle    —— 同一份数据轮询 3 次，1 字节没变（验「没变就不重渲染」）
 *
 * 输出：控制台表格 + JSON（默认写到 scripts/tmp/perf-poll-<label>.json，可 --json 覆盖）。
 * 传两个 bundle 时额外打印并排对比表，直接可粘进文档。
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TMP_DIR = join(ROOT, "scripts", "tmp");

// ══════════════════════════════════════════════════════════════════════════
// 0. 基础工具
// ══════════════════════════════════════════════════════════════════════════

/** 浅比较（React.memo 默认比较用）。 */
function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

/** Hook 依赖数组比较：长度相同且逐项 Object.is。 */
function depsEqual(prev, next) {
  if (prev === undefined || next === undefined) return false;
  if (prev.length !== next.length) return false;
  for (let index = 0; index < prev.length; index++) {
    if (!Object.is(prev[index], next[index])) return false;
  }
  return true;
}

/** 把 children 摊平成一维数组（跳过 null / boolean；字符串与数字是文本叶子）。 */
function toChildArray(children, out = []) {
  if (children === null || children === undefined || typeof children === "boolean") return out;
  if (Array.isArray(children)) {
    for (const item of children) toChildArray(item, out);
    return out;
  }
  out.push(children);
  return out;
}

const CLONE = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const padEnd = (text, width) => String(text).padEnd(width, " ");
const padStart = (text, width) => String(text).padStart(width, " ");
const messageOf = (error) => (error instanceof Error ? error.stack ?? error.message : String(error));
/** 真实时钟（Date.now 之后会被换成假时钟，报告里的耗时用它）。 */
const REAL_DATE_NOW = Date.now.bind(Date);
const realNow = () => REAL_DATE_NOW();

// ══════════════════════════════════════════════════════════════════════════
// 1. 假 React：元素 / Hook / 实例树 / 重渲染驱动
// ══════════════════════════════════════════════════════════════════════════

const SYM = {
  ELEMENT: Symbol.for("gmm.react.element"),
  FRAGMENT: Symbol.for("gmm.react.fragment"),
  MEMO: Symbol.for("gmm.react.memo"),
  FORWARD_REF: Symbol.for("gmm.react.forwardRef"),
  CONTEXT: Symbol.for("gmm.react.context"),
  PROVIDER: Symbol.for("gmm.react.provider")
};

const KIND = {
  FUNCTION: "function",
  CLASS: "class",
  MEMO: "memo",
  FORWARD: "forward",
  HOST: "host",
  FRAGMENT: "fragment",
  PROVIDER: "provider"
};

/**
 * 渲染器运行时状态。
 *
 * dirty 是待重渲染的组件实例集合（setState 只标自己，不标祖先）；
 * layoutQueue / passiveQueue 是待执行的 effect；measuring 打开时统计组件调用。
 */
const RT = {
  dirty: new Set(),
  layoutQueue: [],
  passiveQueue: [],
  current: null,
  context: null,
  measuring: false,
  renderCounts: new Map(),
  renderTotal: 0,
  classCounts: new Map(),
  classTotal: 0,
  allRenderTotal: 0,
  /** 产品组件（有 markRender 埋点）在窗口内的渲染次数，键是埋点名。 */
  productCounts: new Map(),
  errors: [],
  warnings: [],
  depthLimit: 300
};

/**
 * 验收口径：产品组件（StudioPanel / Sprite* / 8 个模块根 / ConfigSection）。
 * 展示型原子组件（Btn / Chip / MediaBox / SaveLink / BusyBtn / StatusChip / LoadingOverlay …）
 * 由父组件驱动，不是订阅单元，不计入。
 */
const PRODUCT_COMPONENT_RE = /^(StudioPanel|Sprite[A-Z]|ConfigSection|ImageModule|SequenceModule|MusicModule|SfxModule|MapModule|IsoModule|RigModule)/;

/** 组件函数名不一定等于埋点名（例：函数 ImageDirectStage -> markRender("SpriteImageDirectStage")）。 */
function productNameOf(node) {
  const markName = node.markName;
  if (typeof markName === "string" && PRODUCT_COMPONENT_RE.test(markName)) return markName;
  if (typeof node.name === "string" && PRODUCT_COMPONENT_RE.test(node.name)) return node.name;
  return null;
}

function resetEngine() {
  RT.dirty = new Set();
  RT.layoutQueue = [];
  RT.passiveQueue = [];
  RT.current = null;
  RT.context = null;
  RT.measuring = false;
  RT.renderCounts = new Map();
  RT.renderTotal = 0;
  RT.classCounts = new Map();
  RT.classTotal = 0;
  RT.allRenderTotal = 0;
  RT.productCounts = new Map();
  RT.errors = [];
  RT.warnings = [];
}

function markDirty(node) {
  if (node === null || node === undefined || node.mounted !== true) return;
  RT.dirty.add(node);
}

/** 记录一次组件调用（函数组件调用 / 类组件 render）。 */
function recordRenderCall(node) {
  RT.allRenderTotal++;
  if (RT.measuring !== true) return;
  const name = node.name ?? "(anonymous)";
  RT.renderTotal++;
  RT.renderCounts.set(name, (RT.renderCounts.get(name) ?? 0) + 1);
  if (node.kind === KIND.CLASS) {
    RT.classTotal++;
    RT.classCounts.set(name, (RT.classCounts.get(name) ?? 0) + 1);
  }
}

/** 读取当前组件实例的 Hook 槽位（按调用顺序递增）。 */
function nextHookSlot(node) {
  const index = node.hookIndex++;
  if (node.hooks === undefined) node.hooks = [];
  return { index, slot: node.hooks[index] };
}

function createElement(type, config, ...children) {
  const props = {};
  let key = null;
  let ref = null;
  if (config !== null && config !== undefined) {
    for (const name of Object.keys(config)) {
      if (name === "key") key = config[name];
      else if (name === "ref") ref = config[name];
      else props[name] = config[name];
    }
  }
  if (children.length === 1) props.children = children[0];
  else if (children.length > 1) props.children = children;
  return { $$typeof: SYM.ELEMENT, type, key, ref, props };
}

class BaseComponent {
  constructor(props) {
    this.props = props;
    this.state = {};
    this.__node = null;
  }
  setState(patch) {
    if (this.__node === null || this.__node.mounted !== true) return;
    const next = typeof patch === "function" ? patch(this.state, this.props) : patch;
    if (next === null || next === undefined) return;
    this.state = { ...this.state, ...next };
    markDirty(this.__node);
  }
  forceUpdate() {
    if (this.__node !== null) markDirty(this.__node);
  }
}

function isClassComponent(type) {
  return typeof type === "function" && (type.prototype instanceof BaseComponent || typeof type.prototype?.render === "function");
}

/** 组件名（聚合口径）。 */
function componentName(type) {
  if (typeof type === "function") return type.displayName || type.name || "(anonymous)";
  if (type !== null && typeof type === "object") {
    if (type.$$typeof === SYM.MEMO) return componentName(type.type);
    if (type.$$typeof === SYM.FORWARD_REF) return type.render?.displayName || type.render?.name || "(forwardRef)";
  }
  return "(anonymous)";
}

// ── Hook 实现 ──────────────────────────────────────────────────────────────

function useState(initial) {
  const node = RT.current;
  if (node === null) throw new Error("useState 在组件外被调用");
  const { index, slot } = nextHookSlot(node);
  if (slot === undefined) {
    const value = typeof initial === "function" ? initial() : initial;
    const created = {
      kind: "state",
      value,
      set: (next) => {
        const computed = typeof next === "function" ? next(created.value) : next;
        if (Object.is(computed, created.value)) return;
        created.value = computed;
        markDirty(node);
      }
    };
    node.hooks[index] = created;
    return [created.value, created.set];
  }
  return [slot.value, slot.set];
}

function useRef(initial) {
  const node = RT.current;
  if (node === null) throw new Error("useRef 在组件外被调用");
  const { index, slot } = nextHookSlot(node);
  if (slot === undefined) {
    const created = { kind: "ref", ref: { current: initial } };
    node.hooks[index] = created;
    return created.ref;
  }
  return slot.ref;
}

function useEffectImpl(fn, deps, phase) {
  const node = RT.current;
  if (node === null) throw new Error("useEffect 在组件外被调用");
  const { index, slot } = nextHookSlot(node);
  const created = slot === undefined;
  const entry = created ? { kind: "effect", cleanup: null, deps: undefined, fn } : slot;
  const changed = created || !depsEqual(entry.deps, deps);
  entry.fn = fn;
  entry.deps = deps;
  if (changed) {
    if (node.pendingEffects === undefined) node.pendingEffects = [];
    node.pendingEffects.push({ node, slot: entry, phase });
  }
  if (created) node.hooks[index] = entry;
}

function useEffect(fn, deps) {
  return useEffectImpl(fn, deps, "passive");
}

function useLayoutEffect(fn, deps) {
  return useEffectImpl(fn, deps, "layout");
}

function useCallback(fn, deps) {
  const node = RT.current;
  if (node === null) throw new Error("useCallback 在组件外被调用");
  const { index, slot } = nextHookSlot(node);
  if (slot !== undefined && depsEqual(slot.deps, deps)) return slot.fn;
  const created = { kind: "callback", fn, deps };
  node.hooks[index] = created;
  return fn;
}

function useMemo(factory, deps) {
  const node = RT.current;
  if (node === null) throw new Error("useMemo 在组件外被调用");
  const { index, slot } = nextHookSlot(node);
  if (slot !== undefined && depsEqual(slot.deps, deps)) return slot.value;
  const created = { kind: "memo", value: factory(), deps };
  node.hooks[index] = created;
  return created.value;
}

function useContext(context) {
  const node = RT.current;
  if (node === null) throw new Error("useContext 在组件外被调用");
  const value = RT.context instanceof Map ? RT.context.get(context) : undefined;
  return value === undefined ? context?.defaultValue : value;
}

function useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
  const node = RT.current;
  if (node === null) throw new Error("useSyncExternalStore 在组件外被调用");
  const { index, slot } = nextHookSlot(node);
  const snapshot = getSnapshot();
  if (slot === undefined) {
    const created = {
      kind: "sync",
      value: snapshot,
      subscribe,
      getSnapshot,
      unsubscribe: null,
      needsSubscribe: true
    };
    node.hooks[index] = created;
    return created.value;
  }
  slot.value = snapshot;
  slot.getSnapshot = getSnapshot;
  if (slot.subscribe !== subscribe) {
    slot.subscribe = subscribe;
    slot.needsSubscribe = true;
  }
  return snapshot;
}

function createContext(defaultValue) {
  const context = { $$typeof: SYM.CONTEXT, defaultValue };
  context.Provider = { $$typeof: SYM.PROVIDER, context };
  return context;
}

function memo(type, compare) {
  return { $$typeof: SYM.MEMO, type, compare: typeof compare === "function" ? compare : undefined };
}

function forwardRef(render) {
  return { $$typeof: SYM.FORWARD_REF, render };
}

const ReactStub = {
  Fragment: SYM.FRAGMENT,
  createElement,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useContext,
  useSyncExternalStore,
  createContext,
  memo,
  forwardRef,
  Component: BaseComponent,
  StrictMode: SYM.FRAGMENT,
  Children: {
    toArray: (children) => toChildArray(children),
    map: (children, fn) => toChildArray(children).map(fn)
  }
};

// ── 实例树：创建 / 渲染 / 协调 / 卸载 ──────────────────────────────────────

function isSameNodeType(node, element) {
  const type = element.type;
  switch (node.kind) {
    case KIND.HOST:
      return node.tag === type;
    case KIND.FRAGMENT:
      return type === SYM.FRAGMENT;
    case KIND.FUNCTION:
    case KIND.CLASS:
      return node.type === type;
    case KIND.MEMO:
      return type !== null && typeof type === "object" && type.$$typeof === SYM.MEMO && node.memoType === type;
    case KIND.FORWARD:
      return type !== null && typeof type === "object" && type.$$typeof === SYM.FORWARD_REF && node.memoType === type;
    case KIND.PROVIDER:
      return type !== null && typeof type === "object" && type.$$typeof === SYM.PROVIDER && node.providerType === type;
    default:
      return false;
  }
}

function createNode(element, parent, context) {
  const type = element.type;
  const base = {
    element,
    key: element.key ?? null,
    props: element.props ?? {},
    parent,
    context,
    depth: (parent?.depth ?? 0) + 1,
    mounted: true,
    children: new Map(),
    hooks: undefined,
    hookIndex: 0,
    pendingEffects: undefined,
    name: componentName(type)
  };
  if (typeof type === "string") {
    return { ...base, kind: KIND.HOST, tag: type };
  }
  if (type === SYM.FRAGMENT) {
    return { ...base, kind: KIND.FRAGMENT };
  }
  if (type !== null && typeof type === "object" && type.$$typeof === SYM.PROVIDER) {
    return { ...base, kind: KIND.PROVIDER, providerType: type, contextObject: type.context };
  }
  if (type !== null && typeof type === "object" && type.$$typeof === SYM.MEMO) {
    return {
      ...base,
      kind: KIND.MEMO,
      memoType: type,
      innerType: type.type,
      compare: type.compare,
      hasRendered: false,
      prevProps: undefined
    };
  }
  if (type !== null && typeof type === "object" && type.$$typeof === SYM.FORWARD_REF) {
    return { ...base, kind: KIND.FORWARD, memoType: type, innerType: type.render, hasRendered: false };
  }
  if (typeof type === "function") {
    if (isClassComponent(type)) {
      const node = { ...base, kind: KIND.CLASS, type, instance: null, hasRendered: false, lastProps: null, lastState: null, pendingCatch: null };
      let instance = null;
      try {
        instance = new type(node.props);
      } catch (error) {
        try {
          instance = Object.create(type.prototype);
          instance.props = node.props;
          instance.state = {};
        } catch {
          instance = null;
        }
      }
      if (instance !== null) {
        instance.__node = node;
        node.instance = instance;
      }
      return node;
    }
    return { ...base, kind: KIND.FUNCTION, type, hasRendered: false };
  }
  RT.warnings.push("无法识别的元素类型：" + String(type));
  return null;
}

function syncChildren(parentNode, elements, context) {
  if (parentNode.children === null || parentNode.children === undefined) parentNode.children = new Map();
  const previous = parentNode.children;
  const next = new Map();
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    if (element === null || element === undefined || typeof element === "boolean") continue;
    if (typeof element === "string" || typeof element === "number") continue;
    const key = element.key !== null && element.key !== undefined ? "#" + String(element.key) : "@" + index;
    const old = previous.get(key);
    if (old !== undefined && isSameNodeType(old, element)) {
      old.element = element;
      old.props = element.props ?? {};
      old.context = context;
      old.parent = parentNode;
      // 父组件重渲染会顺带重渲染这个子组件：把它从待办里摘掉，别重复计数。
      RT.dirty.delete(old);
      next.set(key, old);
      renderNode(old);
    } else {
      if (old !== undefined) unmountNode(old);
      const created = createNode(element, parentNode, context);
      if (created !== null) {
        next.set(key, created);
        renderNode(created);
      }
    }
  }
  for (const [key, old] of previous) {
    if (!next.has(key)) unmountNode(old);
  }
  parentNode.children = next;
}

/** 渲染一个已存在的实例节点（首次挂载与后续更新走同一条路）。 */
function renderNode(node) {
  if (node === null || node === undefined || node.mounted !== true) return;
  if (node.depth > RT.depthLimit) {
    RT.warnings.push("渲染深度超过上限：疑似无限展开（" + (node.name ?? node.kind) + "）");
    return;
  }
  const savedCurrent = RT.current;
  const savedContext = RT.context;
  RT.current = null;
  RT.context = null;
  try {
    switch (node.kind) {
      case KIND.HOST:
        syncChildren(node, toChildArray(node.props.children), node.context);
        break;
      case KIND.FRAGMENT:
        syncChildren(node, toChildArray(node.props.children), node.context);
        break;
      case KIND.PROVIDER: {
        const childContext = new Map(node.context ?? []);
        childContext.set(node.contextObject, node.props.value);
        syncChildren(node, toChildArray(node.props.children), childContext);
        break;
      }
      case KIND.FUNCTION:
        renderFunctionNode(node, node.type);
        break;
      case KIND.MEMO:
        renderMemoNode(node);
        break;
      case KIND.FORWARD:
        renderFunctionNode(node, node.innerType, node.element.ref);
        break;
      case KIND.CLASS:
        renderClassNode(node);
        break;
      default:
        break;
    }
  } catch (error) {
    RT.current = savedCurrent;
    RT.context = savedContext;
    handleRenderError(node, error);
    return;
  }
  RT.current = savedCurrent;
  RT.context = savedContext;
}

function beginFunctionRender(node) {
  RT.current = node;
  RT.context = node.context;
  node.hookIndex = 0;
  node.pendingEffects = undefined;
  node.markName = undefined;
  recordRenderCall(node);
}

function finishFunctionRender(node, output) {
  const effects = node.pendingEffects ?? [];
  node.pendingEffects = undefined;
  // 产品组件：渲染期里 markRender() 会经 perf 探针把埋点名写到 node.markName。
  if (RT.measuring === true) {
    const productName = productNameOf(node);
    if (productName !== null) RT.productCounts.set(productName, (RT.productCounts.get(productName) ?? 0) + 1);
  }
  RT.current = null;
  RT.context = null;
  subscribeSyncSlots(node);
  for (const entry of effects) {
    if (entry.phase === "layout") RT.layoutQueue.push(entry);
    else RT.passiveQueue.push(entry);
  }
  syncChildren(node, toChildArray(output), node.context);
}

function renderFunctionNode(node, type, ref) {
  beginFunctionRender(node);
  const output = ref === undefined ? type(node.props) : type(node.props, ref);
  finishFunctionRender(node, output);
}

function renderMemoNode(node) {
  if (node.hasRendered === true) {
    const equal = typeof node.compare === "function" ? node.compare(node.prevProps, node.props) : shallowEqual(node.prevProps, node.props);
    if (equal === true) return; // memo 相等：整棵子树跳过（不调函数、不碰子实例）
  }
  node.hasRendered = true;
  node.prevProps = node.props;
  beginFunctionRender(node);
  const output = node.innerType(node.props);
  finishFunctionRender(node, output);
}

function renderClassNode(node) {
  const instance = node.instance;
  if (instance === null || typeof instance.render !== "function") return;
  instance.props = node.props;
  RT.current = null;
  RT.context = null;
  recordRenderCall(node);
  const output = instance.render();
  if (node.hasRendered === true) {
    if (typeof instance.componentDidUpdate === "function") {
      const prevProps = node.lastProps;
      const prevState = node.lastState;
      RT.passiveQueue.push({ node, fn: () => instance.componentDidUpdate(prevProps, prevState) });
    }
  } else {
    node.hasRendered = true;
    if (typeof instance.componentDidMount === "function") {
      RT.passiveQueue.push({ node, fn: () => instance.componentDidMount() });
    }
  }
  node.lastProps = node.props;
  node.lastState = instance.state;
  syncChildren(node, toChildArray(output), node.context);
}

/** 组件 render 抛错：找最近的错误边界，降级它，并把 componentDidCatch 排进提交期。 */
function handleRenderError(node, error) {
  const detail = messageOf(error);
  RT.errors.push({ component: node.name ?? node.kind, message: detail });
  let cursor = node.parent;
  while (cursor !== null && cursor !== undefined) {
    if (cursor.kind === KIND.CLASS && cursor.instance !== null && cursor.instance !== undefined && typeof cursor.type.getDerivedStateFromError === "function") {
      try {
        const patch = cursor.type.getDerivedStateFromError(error);
        if (patch !== null && patch !== undefined && typeof patch === "object") {
          cursor.instance.state = { ...cursor.instance.state, ...patch };
        }
      } catch (derivedError) {
        RT.warnings.push("getDerivedStateFromError 自己抛错：" + messageOf(derivedError));
      }
      cursor.pendingCatch = { error };
      markDirty(cursor);
      return;
    }
    cursor = cursor.parent;
  }
  RT.warnings.push("未捕获的渲染错误（" + (node.name ?? node.kind) + "）：" + detail.split("\n")[0]);
}

/** 钩子订阅：useSyncExternalStore 的 subscribe 在提交期调用一次；快照变化才标脏。 */
function subscribeSyncSlots(node) {
  for (const slot of node.hooks ?? []) {
    if (slot === null || slot === undefined || slot.kind !== "sync" || slot.needsSubscribe !== true) continue;
    slot.needsSubscribe = false;
    if (typeof slot.unsubscribe === "function") {
      try {
        slot.unsubscribe();
      } catch {
        /* 取消订阅失败不影响新订阅 */
      }
    }
    try {
      slot.unsubscribe = slot.subscribe(() => {
        if (node.mounted !== true) return;
        let next;
        try {
          next = slot.getSnapshot();
        } catch (error) {
          RT.errors.push({ component: node.name, message: "getSnapshot 抛错：" + messageOf(error) });
          return;
        }
        if (!Object.is(next, slot.value)) {
          slot.value = next;
          markDirty(node);
        }
      });
    } catch (error) {
      RT.errors.push({ component: node.name, message: "subscribe 抛错：" + messageOf(error) });
    }
    // 订阅完之后补一次快照比较：覆盖「渲染与订阅之间 store 又变了」的窗口。
    try {
      const latest = slot.getSnapshot();
      if (!Object.is(latest, slot.value)) {
        slot.value = latest;
        markDirty(node);
      }
    } catch {
      /* 快照读不出来就等下一次通知 */
    }
  }
}

function unmountNode(node) {
  if (node === null || node === undefined || node.mounted !== true) return;
  node.mounted = false;
  RT.dirty.delete(node);
  if (node.kind === KIND.CLASS && node.instance !== null) {
    if (typeof node.instance.componentWillUnmount === "function") {
      try {
        node.instance.componentWillUnmount();
      } catch (error) {
        RT.warnings.push("componentWillUnmount 抛错：" + messageOf(error));
      }
    }
  }
  for (const slot of node.hooks ?? []) {
    if (slot === null || slot === undefined) continue;
    if (slot.kind === "effect" && typeof slot.cleanup === "function") {
      try {
        slot.cleanup();
      } catch (error) {
        RT.warnings.push("effect cleanup 抛错：" + messageOf(error));
      }
      slot.cleanup = null;
    }
    if (slot.kind === "sync" && typeof slot.unsubscribe === "function") {
      try {
        slot.unsubscribe();
      } catch {
        /* 忽略 */
      }
      slot.unsubscribe = null;
    }
  }
  for (const child of [...(node.children?.values() ?? [])]) unmountNode(child);
  if (node.children) node.children.clear();
}

/** 执行一条 effect；cleanup 先跑，返回值是新的 cleanup。 */
function runEffectEntry(entry) {
  const { node, slot } = entry;
  if (node.mounted !== true) return;
  if (slot.cleanup !== null && typeof slot.cleanup === "function") {
    try {
      slot.cleanup();
    } catch (error) {
      RT.warnings.push("effect cleanup 抛错：" + messageOf(error));
    }
    slot.cleanup = null;
  }
  try {
    const result = slot.fn();
    if (typeof result === "function") slot.cleanup = result;
  } catch (error) {
    RT.errors.push({ component: node.name ?? "(effect)", message: messageOf(error) });
  }
}

/** 把待办（脏组件 + effect）跑到没有为止。 */
function flushWork(maxRounds = 200) {
  let rounds = 0;
  while (rounds++ < maxRounds) {
    const hasDirty = RT.dirty.size > 0;
    const hasEffects = RT.layoutQueue.length > 0 || RT.passiveQueue.length > 0;
    if (!hasDirty && !hasEffects) return true;
    if (hasDirty) {
      // 按深度从浅到深：父组件先渲染，子组件若有自己的 state 变更会在父渲染时一起消化。
      const dirty = [...RT.dirty].sort((a, b) => a.depth - b.depth);
      RT.dirty.clear();
      for (const node of dirty) {
        if (node.mounted !== true) continue;
        renderNode(node);
      }
      for (const node of dirty) {
        if (node.pendingCatch !== null && node.pendingCatch !== undefined) {
          const { error } = node.pendingCatch;
          node.pendingCatch = null;
          try {
            node.instance?.componentDidCatch?.(error, { componentStack: "" });
          } catch (catchError) {
            RT.warnings.push("componentDidCatch 抛错：" + messageOf(catchError));
          }
        }
      }
    }
    const layout = RT.layoutQueue.splice(0);
    for (const entry of layout) runEffectEntry(entry);
    const passive = RT.passiveQueue.splice(0);
    for (const entry of passive) runEffectEntry(entry);
  }
  RT.warnings.push("flushWork 超过 " + maxRounds + " 轮：疑似 setState/effect 循环");
  return false;
}

function pendingWork() {
  return RT.dirty.size + RT.layoutQueue.length + RT.passiveQueue.length;
}

/** 等微任务/宏任务跑完一轮（Promise.then 链都在这轮落地）。 */
function drainTurn() {
  return new Promise((resolveTurn) => setImmediate(resolveTurn));
}

/**
 * 反复 flush + 等异步回调落地，直到没有待办、且连续两轮都是「无待办」。
 * 返回是否真的稳定下来（false = 疑似无限更新）。
 */
async function settle(maxRounds = 80) {
  let idleStreak = 0;
  for (let round = 0; round < maxRounds; round++) {
    flushWork();
    await drainTurn();
    if (pendingWork() === 0) {
      idleStreak++;
      if (idleStreak >= 2) return true;
    } else {
      idleStreak = 0;
    }
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════════════
// 2. 浏览器环境桩：window / document / 定时器 / 假时钟
// ══════════════════════════════════════════════════════════════════════════

const CLOCK = { now: 1_700_000_000_000 };

/** 用假时钟替换 Date.now：调度器的 now() 读的是 Date.now，推进它就能让轮询到期。 */
Date.now = () => CLOCK.now;

let TIMERS = [];
let timerSeq = 0;

function makeDocumentStub() {
  return {
    visibilityState: "visible",
    hidden: false,
    head: { appendChild() {}, removeChild() {} },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({
      style: {},
      setAttribute() {},
      removeChild() {},
      remove() {},
      appendChild() {},
      click() {},
      select() {},
      value: "",
      textContent: ""
    }),
    addEventListener() {},
    removeEventListener() {},
    execCommand: () => false
  };
}

function makeWindowStub(timersCapture) {
  const setIntervalStub = (fn, ms) => {
    const handle = { id: ++timerSeq, fn, ms, active: true };
    timersCapture.push(handle);
    return handle;
  };
  const clearIntervalStub = (handle) => {
    if (handle !== null && typeof handle === "object") handle.active = false;
  };
  const location = {
    origin: "http://127.0.0.1:43120",
    search: "",
    href: "http://127.0.0.1:43120/",
    pathname: "/",
    toString() {
      return location.href;
    }
  };
  return {
    __ModuleLoader__: {
      load(registration) {
        CAPTURED = registration;
      }
    },
    document: makeDocumentStub(),
    location,
    history: {
      state: null,
      pushState() {},
      replaceState() {}
    },
    navigator: { userAgent: "perf-poll", clipboard: undefined },
    setTimeout: (fn, ms, ...args) => setTimeout(fn, ms, ...args),
    clearTimeout: (handle) => clearTimeout(handle),
    setInterval: setIntervalStub,
    clearInterval: clearIntervalStub,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    addEventListener() {},
    removeEventListener() {},
    confirm: () => true,
    prompt: () => "角色",
    alert() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 900,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "" })
  };
}

/** 当前场景捕获到的插件注册（__ModuleLoader__.load 的那一份）。 */
let CAPTURED = null;

/** 安装全局环境（每个场景重装：setInterval 桩按场景捕获，document 也换新的）。 */
function installEnvironment(timers, windowStub) {
  TIMERS = timers;
  CAPTURED = null;
  globalThis.window = windowStub;
  globalThis.document = windowStub.document;
  globalThis.setInterval = windowStub.setInterval;
  globalThis.clearInterval = windowStub.clearInterval;
  globalThis.setTimeout = windowStub.setTimeout;
  globalThis.clearTimeout = windowStub.clearTimeout;
  globalThis.requestAnimationFrame = windowStub.requestAnimationFrame;
  globalThis.cancelAnimationFrame = windowStub.cancelAnimationFrame;
  globalThis.location = windowStub.location;
  globalThis.history = windowStub.history;
  globalThis.confirm = windowStub.confirm;
  globalThis.prompt = windowStub.prompt;
  globalThis.alert = windowStub.alert;
  globalThis.devicePixelRatio = windowStub.devicePixelRatio;
  globalThis.innerWidth = windowStub.innerWidth;
  globalThis.innerHeight = windowStub.innerHeight;
  globalThis.matchMedia = windowStub.matchMedia;
}

// ══════════════════════════════════════════════════════════════════════════
// 3. 场景数据：有任务在跑的 sprite 工作台（v1 -> v2 只差一个方向的状态）
// ══════════════════════════════════════════════════════════════════════════

const DIRECTION_KEYS = ["front", "back", "downLeft", "downRight", "upLeft", "upRight", "left", "right"];

/** 一份尽量贴近宿主 getProject 回包形状的项目快照（字段见 src/store.ts 的 Project）。 */
function makeProjectFixture() {
  const images = {};
  const videos = {};
  const frames = {};
  const prompts = {};
  for (const key of DIRECTION_KEYS) {
    images[key] = {
      status: "ready",
      approved: true,
      file: "images/" + key + ".png",
      updatedAt: 1,
      elapsedMs: 42000,
      model: "doubao-seedream-4-0"
    };
    videos[key] = { status: "empty", approved: false };
    frames[key] = { status: "empty", frames: [], keyed: [], approved: false };
    prompts[key] = "以源图为唯一参考，生成「" + key + "」方向的纯绿幕全身图，像素风。";
  }
  return {
    id: "p1",
    name: "角色",
    createdAt: 1,
    updatedAt: 1,
    source: { file: "source/hero.png", name: "hero.png" },
    prompts: {
      images: prompts,
      video: "固定镜头、固定背景，让角色朝原方位原地走三步。",
      turn: "角色原地匀速转一整圈的正侧面绿幕视频。",
      videoPerDirection: {},
      suffix: ""
    },
    images,
    videos,
    frames,
    sheet: { status: "empty", approved: false },
    settings: {
      cellWidth: 128,
      cellHeight: 128,
      frameCount: 8,
      fitMode: "contain",
      workingLongEdge: 1024,
      pixelSize: 4,
      autoCrop: true,
      fillRatio: 0.86,
      bottomMargin: 0.06,
      cropInset: 0,
      keyLow: 14,
      keyHigh: 80,
      despill: 0.65,
      bgTolerance: 90,
      edgeShrink: 0,
      rowOrder: [...DIRECTION_KEYS],
      rowOrderVersion: 1,
      concurrency: 2,
      turnFrameCount: 32
    },
    imageMode: "direct",
    turn: {
      video: { status: "empty", approved: false },
      frames: { status: "empty", frames: [], times: [], picks: {}, approved: false },
      direction: "cw"
    },
    reviewMode: "auto",
    log: [{ at: 1, level: "info", text: "已创建项目" }],
    jobs: [{ key: "images:all", label: "批量生成八方向绿幕图", startedAt: 2 }],
    assetBase: "/dsh-game-material-master/assets/p1/"
  };
}

/** v1：upLeft / upRight 正在生成（running）。 */
function makeV1() {
  const project = makeProjectFixture();
  project.images.upLeft = { status: "running", approved: false, updatedAt: 1 };
  project.images.upRight = { status: "running", approved: false, updatedAt: 1 };
  return project;
}

/** v2：一次轮询后 upLeft 完成（running -> ready），其余不变；仍然是 busy（批量任务还在跑）。 */
function makeV2(v1) {
  const project = CLONE(v1);
  project.images.upLeft = {
    status: "ready",
    approved: false,
    file: "images/upLeft.png",
    updatedAt: 2,
    elapsedMs: 51000,
    model: "doubao-seedream-4-0"
  };
  project.updatedAt = 2;
  project.log.push({ at: 2, level: "info", text: "upLeft 生成完成" });
  return project;
}

/**
 * 列出两份项目快照之间的差异叶子路径（最多 limit 条），给报告写「这次轮询变了什么」。
 */
function diffProject(before, after, limit = 12) {
  const out = [];
  const walk = (left, right, path) => {
    if (out.length >= limit) return;
    if (left !== null && right !== null && typeof left === "object" && typeof right === "object") {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
      for (const key of keys) walk(left[key], right[key], path === "" ? key : path + "." + key);
      return;
    }
    if (!Object.is(left, right)) out.push({ path, before: left, after: right });
  };
  walk(before, after, "");
  return out;
}

const SUMMARY = {
  id: "p1",
  name: "角色",
  createdAt: 1,
  updatedAt: 1,
  hasSource: true,
  imageMode: "direct",
  imageReady: 6,
  videoReady: 0,
  framesReady: 0,
  sheetReady: false
};

/**
 * mock 远程 API：只实现挂载与轮询真正会调的那几个，其余方法一律回空对象
 * （并记进 calls，方便核对「这次轮询到底发了几个请求」）。
 */
function createApi({ v1, v2 }) {
  const state = { phase: "v1", calls: [], getProjectCalls: 0 };
  const methods = {
    getConfig: async () => ({ hiddenModules: [] }),
    listProjects: async () => ({ projects: [CLONE(SUMMARY)] }),
    getProject: async () => {
      state.getProjectCalls++;
      const payload = state.phase === "v2" ? v2 : v1;
      // 宿主每次回包都是新的对象（从磁盘读回来），这里也深拷贝，避免被界面原地改到。
      return CLONE(payload);
    },
    saveConfig: async () => ({ ok: true }),
    setReviewMode: async () => ({ ok: true }),
    listImageJobs: async () => ({ jobs: [] }),
    listSequenceJobs: async () => ({ jobs: [] }),
    listRigJobs: async () => ({ jobs: [] }),
    listMapProjects: async () => ({ projects: [] }),
    listIsoProjects: async () => ({ projects: [] }),
    listMusicJobs: async () => ({ jobs: [] }),
    listSfxJobs: async () => ({ jobs: [] })
  };
  const api = new Proxy(methods, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== "string") return undefined;
      return async (...args) => {
        state.calls.push(prop);
        return {};
      };
    }
  });
  return { api, state };
}

// ══════════════════════════════════════════════════════════════════════════
// 4. 单个场景：挂载 -> 稳定 -> 触发轮询 -> 统计
// ══════════════════════════════════════════════════════════════════════════

function getPanel(bundle) {
  const test = bundle?.__test ?? {};
  if (typeof test.StudioPanel === "function") return { panel: test.StudioPanel, source: "__test.StudioPanel" };
  // 兜底：有些产物可能只保留 apply 注册的 main 面板（与 verify-feedback 同一套路）。
  const registered = {};
  const ctx = {
    effect(fn) {
      return fn();
    },
    get() {
      return undefined;
    },
    inject(_names, fn) {
      return fn();
    },
    slots: {
      inject(_name, fn) {
        return fn();
      },
      register(options, component) {
        registered[options.name] = component;
        return () => {};
      }
    },
    remote: { $mount: async () => {} }
  };
  try {
    bundle.apply(ctx);
  } catch (error) {
    throw new Error("__test.StudioPanel 不存在，且 apply() 失败：" + messageOf(error));
  }
  if (typeof registered.main === "function") return { panel: registered.main, source: "apply->main" };
  throw new Error("产物里找不到 StudioPanel（__test 与 apply 都没有）");
}

/**
 * 给 __GMM_PERF__.recordRender 装探针：组件渲染期调用 markRender(name) 时，
 * 把埋点名记到当前组件实例上，这样「产品组件口径」不会因为函数名与埋点名不同而漏算。
 */
function installPerfProbe() {
  const perf = globalThis.__GMM_PERF__;
  if (perf === undefined || perf === null || typeof perf.recordRender !== "function") return false;
  if (perf.__perfPollPatched === true) return true;
  const original = perf.recordRender.bind(perf);
  perf.recordRender = (name) => {
    if (RT.current !== null && RT.current !== undefined) RT.current.markName = name;
    original(name);
  };
  perf.__perfPollPatched = true;
  return true;
}

function readPerf(name) {
  const perf = globalThis.__GMM_PERF__;
  if (perf === undefined || typeof perf.renderCount !== "function") return -1;
  return perf.renderCount(name);
}

/** 读一份 __GMM_PERF__ 的渲染计数快照（组件名 -> 次数）；没有 perf 时返回 null。 */
function readPerfSnapshot() {
  const perf = globalThis.__GMM_PERF__;
  if (perf === undefined || typeof perf.snapshot !== "function") return null;
  try {
    return { ...(perf.snapshot().renders ?? {}) };
  } catch {
    return null;
  }
}

/** 逐组件列出 __GMM_PERF__ 的「改前 -> 改后 -> 增量」（含没涨的，方便看谁没被叫醒）。 */
function perfTable(before, after) {
  if (before === null || after === null) return null;
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return names
    .map((name) => ({ name, before: before[name] ?? 0, after: after[name] ?? 0, delta: (after[name] ?? 0) - (before[name] ?? 0) }))
    .sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name));
}

/** 两次 perf 快照之间「涨了」的产品组件（按增量降序）。 */
function perfDelta(before, after) {
  if (before === null || after === null) return null;
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const rows = names
    .map((name) => ({ name, count: (after[name] ?? 0) - (before[name] ?? 0) }))
    .filter((row) => row.count !== 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { changed: rows, total: rows.reduce((sum, row) => sum + row.count, 0) };
}

function snapshotScheduler(windowStub) {
  const scheduler = windowStub.__GMM_SCHEDULER__ ?? null;
  if (scheduler === null || typeof scheduler.stats !== "function") return null;
  try {
    return scheduler.stats();
  } catch {
    return null;
  }
}

/** 找调度器的主时钟（createPollScheduler 的 tickMs 默认 250ms）。 */
function findSchedulerTimer(timers) {
  const candidates = timers.filter((timer) => timer.active === true && timer.ms === 250);
  if (candidates.length > 0) return candidates[0];
  const fallback = timers.filter((timer) => timer.active === true).sort((a, b) => a.ms - b.ms);
  return fallback[0] ?? null;
}

/** 挂载：把面板元素挂到假根节点上。 */
function mount(panel, props) {
  const root = { kind: "root", children: new Map(), mounted: true, depth: 0, parent: null, context: new Map() };
  const element = createElement(panel, props);
  const node = createNode(element, root, new Map());
  if (node === null) throw new Error("面板元素无法创建组件实例");
  root.children.set("@0", node);
  renderNode(node);
  return root;
}

/**
 * 跑一个场景。
 * @param code - 产物源码
 * @param bundlePath - 产物路径（仅报告用）
 * @param scenario - "changed" | "idle"
 */
async function runScenario({ code, bundlePath, scenario }) {
  resetEngine();
  CLOCK.now = 1_700_000_000_000;
  const timers = [];
  const windowStub = makeWindowStub(timers);
  installEnvironment(timers, windowStub);

  // ① 加载产物 + 执行工厂（此时 createPollScheduler 会登记 250ms 的 setInterval 桩）
  const requireFn = (id) => {
    if (id === "react") return ReactStub;
    throw new Error("perf-poll: 未预期的 require(" + id + ")");
  };
  const runner = new Function("window", "require", code + "\n//# sourceURL=" + String(bundlePath).replace(/\\/g, "/"));
  runner(windowStub, requireFn);
  if (CAPTURED === null) throw new Error("没能抓住插件体（__ModuleLoader__.load 未调用）");
  const bundle = CAPTURED.factory(requireFn);
  installPerfProbe();
  const { panel, source: panelSource } = getPanel(bundle);

  const schedulerTimer = findSchedulerTimer(timers);
  const v1 = makeV1();
  const v2 = makeV2(v1);
  const { api, state: apiState } = createApi({ v1, v2 });

  // ② 挂载 + 稳定（这一段不计入轮询窗口，只记录挂载渲染规模作为参考）
  RT.measuring = true;
  RT.renderCounts = new Map();
  RT.renderTotal = 0;
  const mountStartedAt = realNow();
  mount(panel, { api, studioCtx: { remote: {} } });
  const stable = await settle();
  const mountRenders = RT.renderTotal;
  const mountUnique = RT.renderCounts.size;
  const mountByName = Object.fromEntries([...RT.renderCounts.entries()].sort((a, b) => b[1] - a[1]));
  RT.measuring = false;
  RT.renderCounts = new Map();
  RT.renderTotal = 0;

  // 挂载后必须真的静止：再跑一轮空 settle，应该 0 次组件调用。
  RT.measuring = true;
  await settle();
  const idleAfterMount = RT.renderTotal;
  RT.measuring = false;

  const schedulerStatsBefore = snapshotScheduler(windowStub);
  const schedulerTimerMs = schedulerTimer?.ms ?? null;
  if (schedulerTimer === null) {
    RT.warnings.push("没有捕获到调度器时钟（setInterval 250ms）——轮询可能没走 platform/scheduler");
  }

  // ③ 触发轮询：changed 场景先让下一次 getProject 回 v2，再把假时钟推过 2500ms 手动跑 tick
  if (scenario === "changed") apiState.phase = "v2";
  const apiCallsBefore = apiState.calls.length;
  const getProjectBefore = apiState.getProjectCalls;
  const perfBefore = readPerf("StudioPanel");
  const perfSnapshotBefore = readPerfSnapshot();
  const ticks = scenario === "idle" ? 3 : 1;

  RT.renderCounts = new Map();
  RT.renderTotal = 0;
  RT.classCounts = new Map();
  RT.classTotal = 0;
  RT.productCounts = new Map();
  RT.measuring = true;
  const polls = [];
  for (let index = 0; index < ticks; index++) {
    const before = apiState.getProjectCalls;
    CLOCK.now += 3000;
    const timer = schedulerTimer ?? findSchedulerTimer(timers);
    if (timer !== null) timer.fn();
    await settle();
    polls.push({ tick: index + 1, getProjectCalls: apiState.getProjectCalls - before, renders: RT.renderTotal });
  }
  const windowStable = await settle();
  RT.measuring = false;

  const rendersByName = Object.fromEntries([...RT.renderCounts.entries()].sort((a, b) => b[1] - a[1]));
  const classByName = Object.fromEntries([...RT.classCounts.entries()].sort((a, b) => b[1] - a[1]));
  const totalRenders = RT.renderTotal;
  const uniqueComponents = RT.renderCounts.size;
  // 验收口径：产品组件（有 markRender 埋点）的重渲染次数 / 个数。
  const productRenders = Object.fromEntries([...RT.productCounts.entries()].sort((a, b) => b[1] - a[1]));
  const productUnique = RT.productCounts.size;
  const productTotal = [...RT.productCounts.values()].reduce((sum, count) => sum + count, 0);
  const apiCalls = apiState.calls.slice(apiCallsBefore);
  const getProjectCalls = apiState.getProjectCalls - getProjectBefore;
  const perfAfter = readPerf("StudioPanel");
  const perfSnapshotAfter = readPerfSnapshot();
  const perfRenders = perfDelta(perfSnapshotBefore, perfSnapshotAfter);
  const perfCounts = perfTable(perfSnapshotBefore, perfSnapshotAfter);
  const schedulerStatsAfter = snapshotScheduler(windowStub);
  const errors = [...RT.errors];
  const warnings = [...RT.warnings];

  return {
    scenario,
    ok: stable === true && windowStable === true,
    stable,
    panelSource,
    ticks,
    apiRequests: getProjectCalls,
    apiCalls,
    polls,
    totalRenders,
    uniqueComponents,
    rendersByName,
    productRenders,
    productUnique,
    productTotal,
    classRenders: RT.classTotal,
    classByName,
    mountRenders,
    mountUnique,
    mountByName,
    idleAfterMount,
    studioPanelBefore: perfBefore,
    studioPanelAfter: perfAfter,
    studioPanelDelta: perfBefore >= 0 && perfAfter >= 0 ? perfAfter - perfBefore : null,
    perfRenders,
    perfCounts,
    schedulerBefore: schedulerStatsBefore,
    schedulerAfter: schedulerStatsAfter,
    schedulerTimerMs,
    watchers: schedulerStatsBefore?.registrations ?? null,
    errors,
    warnings,
    dataDelta: diffProject(v1, v2),
    mountMs: realNow() - mountStartedAt
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 5. 报告：控制台表格 + JSON
// ══════════════════════════════════════════════════════════════════════════

/** 打印一组「组件 × 次数」表格。 */
function printRenderTable(rows, columns, firstColumnTitle = "组件") {
  const nameWidth = Math.min(46, Math.max(firstColumnTitle.length, ...rows.map((row) => String(row.name).length)) + 2);
  const colWidths = columns.map((column) => Math.max(column.title.length, ...rows.map((row) => String(row[column.key] ?? "").length)) + 2);
  const header = padEnd(firstColumnTitle, nameWidth) + columns.map((column, index) => padStart(column.title, colWidths[index])).join("");
  const divider = "─".repeat(nameWidth + colWidths.reduce((sum, width) => sum + width, 0));
  const lines = [header, divider];
  for (const row of rows) {
    lines.push(padEnd(row.name, nameWidth) + columns.map((column, index) => padStart(String(row[column.key] ?? ""), colWidths[index])).join(""));
  }
  return lines.join("\n");
}

function scenarioTitle(scenario, dataNote) {
  if (scenario === "changed") return "一次轮询 · 数据有变（" + dataNote + "）";
  return "空闲轮询 x 3 · 数据 1 字节没变";
}

function describeScenario(result) {
  const lines = [];
  lines.push("  挂载：组件调用 " + result.mountRenders + " 次（" + result.mountUnique + " 个组件名）；挂载后静止检查 " + result.idleAfterMount + " 次");
  lines.push("  触发方式：假时钟前进 3000ms -> 手动执行调度器 tick（intervalMs=" + (result.schedulerTimerMs ?? "?") + "，共 " + result.ticks + " 次）");
  if (result.dataDelta !== undefined && result.dataDelta.length > 0) {
    lines.push("  数据差异（v1 -> v2）：" + result.dataDelta.map((item) => item.path + ": " + JSON.stringify(item.before) + " -> " + JSON.stringify(item.after)).join("；"));
  }
  lines.push("  轮询回调：getProject 调用 " + result.apiRequests + " 次；scheduler.watch 注册项 " + (result.watchers ?? "?") + " 个");
  lines.push("  重渲染（验收口径）：产品组件 " + result.productTotal + " 次（" + result.productUnique + " 个）" + (result.productTotal === 0 ? " —— 一个订阅单元都没被叫醒" : "：" + Object.entries(result.productRenders).map(([name, count]) => name + " +" + count).join("、")));
  lines.push("  原始口径（旁证）：全部组件函数调用 " + result.totalRenders + " 次（" + result.uniqueComponents + " 个组件名）；其中类组件 render " + result.classRenders + " 次");
  lines.push("  ⓘ 两个口径的差 = 展示型原子组件（Btn / Chip / MediaBox / SaveLink / BusyBtn / StatusChip / LoadingOverlay / BusyBadge …），它们由父组件驱动，不是订阅单元");
  lines.push("  StudioPanel __GMM_PERF__ 渲染计数：" + result.studioPanelBefore + " -> " + result.studioPanelAfter + "（Δ " + (result.studioPanelDelta ?? "—") + "）");
  if (result.perfRenders !== null && result.perfRenders !== undefined) {
    const changed = result.perfRenders.changed;
    lines.push(
      "  __GMM_PERF__ 里涨了的组件：" +
        (changed.length === 0
          ? "（一个都没有）"
          : changed.map((row) => row.name + " +" + row.count).join("、") + "（合计 +" + result.perfRenders.total + "）")
    );
  }
  if (result.schedulerBefore !== null && result.schedulerAfter !== null) {
    lines.push("  调度器统计：runs " + result.schedulerBefore.runs + " -> " + result.schedulerAfter.runs + "，registrations " + result.schedulerBefore.registrations + " -> " + result.schedulerAfter.registrations);
  }
  if (result.mountMs !== undefined) lines.push("  挂载耗时（真实时间）：" + result.mountMs + " ms");
  if (result.errors.length > 0) {
    lines.push("  ⚠ 渲染错误 " + result.errors.length + " 条：" + result.errors.slice(0, 3).map((item) => item.component + ": " + String(item.message).split("\n")[0]).join("；"));
  }
  if (result.warnings.length > 0) lines.push("  ⚠ 警告 " + result.warnings.length + " 条：" + result.warnings.slice(0, 3).join("；"));
  if (!result.ok) lines.push("  ⚠ 场景没有稳定下来（疑似更新循环），数字仅供参考");
  return lines.join("\n");
}

/** 两个 bundle 的并排对比：union 组件名，按改前次数降序。 */
function buildComparisonRows(beforeResult, afterResult) {
  const beforeRenders = beforeResult?.rendersByName ?? {};
  const afterRenders = afterResult?.rendersByName ?? {};
  const names = [...new Set([...Object.keys(beforeRenders), ...Object.keys(afterRenders)])];
  return names
    .map((name) => ({ name, before: beforeRenders[name] ?? 0, after: afterRenders[name] ?? 0 }))
    .sort((a, b) => b.before - a.before || b.after - a.after || a.name.localeCompare(b.name));
}

function printBundleReport(entry) {
  console.log("\n" + "═".repeat(78));
  console.log("产物：" + entry.label + "  " + entry.path);
  console.log("大小：" + entry.bytes + " B   sha256：" + entry.sha256.slice(0, 16) + "…");
  for (const scenario of ["changed", "idle"]) {
    const result = entry[scenario];
    if (result === null || result === undefined) continue;
    console.log("\n── " + scenarioTitle(scenario, "images.upLeft: running -> ready") + " ──");
    console.log(describeScenario(result));
    const rows = Object.entries(result.rendersByName).map(([name, count]) => ({ name, count }));
    if (rows.length === 0) {
      console.log("\n  （没有组件被重新调用）");
    } else {
      console.log("\n" + printRenderTable(rows, [{ key: "count", title: "次数" }]));
      console.log(padEnd("合计", 18) + padStart(String(result.totalRenders), 8));
    }
    if (result.perfCounts !== null && result.perfCounts !== undefined && result.perfCounts.length > 0) {
      console.log("\n  __GMM_PERF__ 产品组件渲染计数（窗口内）：");
      console.log(
        printRenderTable(
          result.perfCounts.map((row) => ({ name: row.name, before: row.before, after: row.after, delta: row.delta >= 0 ? "+" + row.delta : String(row.delta) })),
          [
            { key: "before", title: "改前" },
            { key: "after", title: "改后" },
            { key: "delta", title: "Δ" }
          ]
        )
      );
    }
  }
}

function printComparisonTable(entries) {
  if (entries.length < 2) return;
  const [first, second] = entries;
  console.log("\n" + "═".repeat(78));
  console.log("并排对比：" + first.label + " vs " + second.label + "（同一份 harness、同一组 v1/v2 数据、同一触发方式）");
  console.log("验收口径：产品组件（有 markRender 埋点：StudioPanel / Sprite* / 8 个模块根 / ConfigSection）一次轮询重渲染数；");
  console.log("展示型原子组件（Btn / Chip / MediaBox / SaveLink / BusyBtn / StatusChip / LoadingOverlay / BusyBadge …）不计入。");
  for (const scenario of ["changed", "idle"]) {
    const before = first[scenario];
    const after = second[scenario];
    if (before === null || before === undefined || after === null || after === undefined) continue;
    const productRows = [...new Set([...Object.keys(before.productRenders), ...Object.keys(after.productRenders)])]
      .map((name) => ({ name, before: before.productRenders[name] ?? 0, after: after.productRenders[name] ?? 0 }))
      .sort((a, b) => b.before - a.before || b.after - a.after || a.name.localeCompare(b.name));
    const tableRows = productRows.map((row) => ({ name: row.name, before: row.before, after: row.after }));
    tableRows.push({ name: "── 产品组件合计（验收口径）", before: before.productTotal, after: after.productTotal });
    tableRows.push({ name: "产品组件去重个数", before: before.productUnique, after: after.productUnique });
    tableRows.push({ name: "原始口径：全部组件函数调用", before: before.totalRenders, after: after.totalRenders });
    tableRows.push({ name: "原始口径：去重组件名", before: before.uniqueComponents, after: after.uniqueComponents });
    tableRows.push({ name: "StudioPanel 渲染计数 Δ", before: before.studioPanelDelta ?? "—", after: after.studioPanelDelta ?? "—" });
    console.log("\n── " + scenarioTitle(scenario, "images.upLeft: running -> ready") + " ──");
    console.log(printRenderTable(tableRows, [
      { key: "before", title: first.label ?? "改前" },
      { key: "after", title: second.label ?? "改后" }
    ]));
    if (scenario === "changed") {
      const pass = after.productTotal <= 3;
      console.log("\n  结论（验收口径）：一次数据有变的轮询，" + first.label + " 产品组件重渲染 " + before.productTotal + " 次；" + second.label + " 重渲染 " + after.productTotal + " 次（目标 <=3）-> " + (pass ? "达成 ✓" : "未达成 ✗"));
      console.log("  旁证（原始口径）：全部组件函数调用 " + before.totalRenders + " -> " + after.totalRenders + " 次；差额是展示型原子组件被父组件带着重画，不计入验收。");
      console.log("  ⓘ 改前的产品口径只有 1 个埋点（HEAD 上只有 StudioPanel 埋了 markRender），它的一次重渲染 = 整棵树重画；改后的 3 次是三个独立订阅单元，各自只重画自己那一小块。");
    } else {
      const pass = after.productTotal === 0;
      console.log("\n  结论（验收口径）：空闲轮询（数据 1 字节没变）" + first.label + " 产品组件重渲染 " + before.productTotal + " 次；" + second.label + " 重渲染 " + after.productTotal + " 次（期望 0）-> " + (pass ? "达成 ✓" : "未达成 ✗"));
      console.log("  旁证（原始口径）：全部组件函数调用 " + before.totalRenders + " -> " + after.totalRenders + " 次。");
    }
  }
}

function buildJson(entries, options) {
  return {
    tool: "scripts/perf-poll.mjs",
    generatedAt: new Date().toISOString(),
    scenes: {
      changed: "有任务在跑（jobs=[images:all]）时的一次轮询；getProject 回包从 v1 变 v2，差异只有 images.upLeft.status: running -> ready（仍是 busy）",
      idle: "同一份 v1 数据连续轮询 3 次，JSON 签名完全相同（1 字节没变）"
    },
    bundles: entries.map((entry) => ({
      label: entry.label,
      path: entry.path,
      bytes: entry.bytes,
      sha256: entry.sha256,
      scenarios: { changed: entry.changed, idle: entry.idle }
    })),
    comparison: entries.length >= 2 ? {
      /** 验收口径：产品组件（有 markRender 埋点）一次轮询重渲染数，目标 <= 3。 */
      metric: "product-components-with-markRender",
      productTarget: 3,
      productPass: (entries[1].changed?.productTotal ?? Infinity) <= 3,
      changed: {
        rawBefore: entries[0].changed?.totalRenders ?? null,
        rawAfter: entries[1].changed?.totalRenders ?? null,
        productBefore: entries[0].changed?.productTotal ?? null,
        productAfter: entries[1].changed?.productTotal ?? null,
        productTarget: 3,
        productPass: (entries[1].changed?.productTotal ?? Infinity) <= 3
      },
      idle: {
        rawBefore: entries[0].idle?.totalRenders ?? null,
        rawAfter: entries[1].idle?.totalRenders ?? null,
        productBefore: entries[0].idle?.productTotal ?? null,
        productAfter: entries[1].idle?.productTotal ?? null,
        productTarget: 0,
        productPass: (entries[1].idle?.productTotal ?? Infinity) === 0
      }
    } : undefined,
    options
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 6. 入口
// ══════════════════════════════════════════════════════════════════════════

const USAGE = [
  "用法：node scripts/perf-poll.mjs [bundle.js...] [选项]",
  "",
  "  bundle.js                产物路径（默认 lib/client.js）；传两个时打印并排对比表",
  "  --label=改前            单产物时的标签",
  "  --labels=改前,改后      多产物时逐个指定标签",
  "  --scenarios=changed,idle 要跑的场景（默认两个都跑）",
  "  --json=路径              JSON 输出路径（默认 scripts/tmp/perf-poll-<label>.json）",
  "  --help                  打印本说明"
].join("\n");

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  const bundles = [];
  const options = { labels: null, json: null, scenarios: ["changed", "idle"] };
  for (const arg of argv) {
    if (arg.startsWith("--label=")) options.labels = [arg.slice("--label=".length)];
    else if (arg.startsWith("--labels=")) options.labels = arg.slice("--labels=".length).split(",");
    else if (arg.startsWith("--json=")) options.json = arg.slice("--json=".length);
    else if (arg.startsWith("--scenarios=")) options.scenarios = arg.slice("--scenarios=".length).split(",").map((item) => item.trim()).filter(Boolean);
    else if (arg.startsWith("--")) throw new Error("未知参数：" + arg);
    else bundles.push(arg);
  }
  if (bundles.length === 0) bundles.push(join(ROOT, "lib", "client.js"));
  return { bundles: bundles.map((item) => resolve(item)), options };
}

async function main() {
  const { bundles: bundlePaths, options } = parseArgs(process.argv.slice(2));
  const entries = [];
  for (let index = 0; index < bundlePaths.length; index++) {
    const bundlePath = bundlePaths[index];
    const label = options.labels?.[index] ?? (bundlePaths.length === 1 ? "bundle" : index === 0 ? "改前" : index === 1 ? "改后" : "bundle" + (index + 1));
    const code = readFileSync(bundlePath, "utf8");
    const bytes = Buffer.byteLength(code);
    const sha256 = createHash("sha256").update(code).digest("hex");
    const entry = { label, path: bundlePath, bytes, sha256, changed: null, idle: null };
    console.log("\n加载产物：" + bundlePath + "（" + bytes + " B，" + sha256.slice(0, 12) + "…）");
    for (const scenario of options.scenarios) {
      if (scenario !== "changed" && scenario !== "idle") throw new Error("未知场景：" + scenario);
      const result = await runScenario({ code, bundlePath, scenario });
      entry[scenario] = result;
      console.log(
        "  ✓ " +
          scenario +
          "：产品组件重渲染 " +
          result.productTotal +
          " 次（" +
          result.productUnique +
          " 个）；原始组件调用 " +
          result.totalRenders +
          " 次（" +
          result.uniqueComponents +
          " 个名字）；StudioPanel Δ " +
          (result.studioPanelDelta ?? "—") +
          (result.ok ? "" : "（未稳定）")
      );
    }
    entries.push(entry);
  }

  for (const entry of entries) printBundleReport(entry);
  printComparisonTable(entries);

  const json = buildJson(entries, options);
  mkdirSync(TMP_DIR, { recursive: true });
  const defaultName = entries.length > 1 ? "perf-poll-compare.json" : "perf-poll-" + (entries[0]?.label ?? "result") + ".json";
  const jsonPath = options.json !== null ? resolve(options.json) : join(TMP_DIR, defaultName);
  writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  console.log("\nJSON：" + jsonPath);
  console.log(JSON.stringify(json, null, 2));
}

main().catch((error) => {
  console.error("\nperf-poll 失败：" + messageOf(error));
  process.exitCode = 1;
});
