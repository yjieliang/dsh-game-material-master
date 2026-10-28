/**
 * 浏览器半区 · 极简可订阅 store（platform/store）。
 *
 * 解决什么问题：以前 task 状态放在 StudioPanel 的 useState 里，每 2.5 秒一次的轮询
 * 回包 setState 就会重渲染整棵模块子树（地图/骨骼这种大组件首当其冲）。
 * 状态搬进 store、组件按 selector 订阅之后，一次轮询只重渲染真正用到
 * 那个字段的组件。
 *
 * 不引第三方状态库（客户端禁止 import 第三方）；这里只做四件事：
 *   · 极小的 setState + 订阅（同步通知、无中间件）
 *   · batch(fn) —— 一次轮询里的多处写入合并成一次通知
 *   · store.use(selector) —— 基于 useSyncExternalStore 的精确订阅
 *   · selector 结果用 Object.is（或传入的 isEqual）比较，没变就不重渲染
 *
 * 约定：store 里放「渲染要用的数据」；高频播放/画布位置这类每帧都变的值
 * 留在 ref + requestAnimationFrame 里，不要进 store。
 *
 * React 由创建方（组合根 shell/bootstrap）注入：platform 不许在模块顶层 import react，
 * 而自检桩（scripts/verify-feedback.mjs）也需要拿自己的假 React 创建 store。
 */

/** 最小 store 接口。 */
export interface StudioStore<T extends object> {
  /** 当前状态（引用稳定，变更时整体替换） */
  getState(): T;
  /**
   * 合并式更新：浅合并到当前状态（传函数时先算增量）。
   * @param patch - 部分状态或产生部分状态的函数
   * @returns 更新后的状态
   */
  setState(patch: Partial<T> | ((state: T) => Partial<T>)): T;
  /** 订阅变更；返回取消订阅函数 */
  subscribe(listener: () => void): () => void;
  /** 批量写入：块内多次 setState 只通知一次（轮询回包的多处写入必须走它） */
  batch(fn: () => void): void;
  /** 订阅者数量（泄漏排查用） */
  listenerCount(): number;
}

/** 创建 store 的可选项。 */
export interface CreateStoreOptions {
  /** 名字，仅用于调试与性能埋点 */
  name?: string;
  /** 宿主注入的 React（store.use 需要它；只做 getState/setState 时可省） */
  React?: any;
}

/**
 * 创建 store。
 * @param initial - 初始状态
 * @param options - { name, React }
 * @returns store 实例（附带 React 引用，供 useStore 使用）
 */
export function createStore<T extends object>(initial: T, options: CreateStoreOptions = {}): StudioStore<T> & { name: string; React?: any } {
  let gmmState = initial;
  const gmmListeners: Set<() => void> = new Set();
  const gmmName = options.name ?? "store";
  let gmmBatchDepth = 0;
  let gmmBatchDirty = false;

  const emit = (): void => {
    for (const listener of [...gmmListeners]) listener();
  };

  return {
    name: gmmName,
    React: options.React,
    getState(): T {
      return gmmState;
    },
    setState(patch: Partial<T> | ((current: T) => Partial<T>)): T {
      const delta = typeof patch === "function" ? (patch as (current: T) => Partial<T>)(gmmState) : patch;
      if (delta === null || typeof delta !== "object") return gmmState;
      const keys = Object.keys(delta) as Array<keyof T>;
      if (keys.length === 0) return gmmState;
      const next = { ...gmmState } as T;
      let changed = false;
      for (const key of keys) {
        const nextValue = delta[key];
        if (!Object.is(next[key], nextValue)) {
          next[key] = nextValue as T[keyof T];
          changed = true;
        }
      }
      if (!changed) return gmmState;
      gmmState = next;
      if (gmmBatchDepth > 0) gmmBatchDirty = true;
      else emit();
      return gmmState;
    },
    batch(fn: () => void): void {
      gmmBatchDepth++;
      try {
        fn();
      } finally {
        gmmBatchDepth--;
        if (gmmBatchDepth === 0 && gmmBatchDirty) {
          gmmBatchDirty = false;
          emit();
        }
      }
    },
    subscribe(listener: () => void): () => void {
      gmmListeners.add(listener);
      return () => {
        gmmListeners.delete(listener);
      };
    },
    listenerCount(): number {
      return gmmListeners.size;
    }
  };
}

/** 浅比较：selector 返回数组 / 小对象时用它，避免每次新建引用导致的重渲染。 */
export function shallowEqual(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

/**
 * 组件内精确订阅 store 的一个切片。
 *
 * @param store - 目标 store（创建时注入了 React）
 * @param selector - 从状态里取切片（返回值要尽量是原始值或稳定引用）
 * @param isEqual - 切片比较函数，默认 Object.is；返回数组/对象时传 shallowEqual
 * @returns 切片值；切片没变时组件不重渲染
 */
export function useStore<T extends object, S>(
  store: StudioStore<T> & { React?: any },
  selector: (state: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is
): S {
  const React = store.React;
  if (React === undefined || typeof React.useSyncExternalStore !== "function") {
    throw new Error("platform/store: store 创建时没有注入 React（createStore 需传 { React }）");
  }
  const cache = React.useRef({ has: false as boolean, value: undefined as any });
  const getSnapshot = (): S => {
    const next = selector(store.getState());
    if (cache.current.has && isEqual(cache.current.value, next)) return cache.current.value;
    cache.current = { has: true, value: next };
    return next;
  };
  return React.useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** 面板 / 八模块共享的状态：项目快照 + 编辑草稿。 */
export interface StudioState {
  /** 项目列表（侧栏） */
  projects: any[];
  /** 当前项目 id */
  projectId: string | null;
  /** 当前项目快照（宿主 getProject 的完整回包） */
  project: any | null;
  /** 八个方向的生图提示词草稿 */
  promptDraft: any;
  /** 行走视频提示词草稿 */
  videoPromptDraft: any;
  /** 参数草稿 */
  settingsDraft: any;
  /** 哪些方向的提示词编辑区是展开的 */
  promptOpen: any;
}

/** 面板状态写入动作。草稿用内容比较做短路：内容没变就不通知（避免每轮询都重渲染）。 */
export interface StudioStateActions {
  setProjects(next: any[]): void;
  setProjectId(next: string | null): void;
  setProject(next: any | null): void;
  setPromptDraft(next: any | ((current: any) => any)): void;
  setVideoPromptDraft(next: any | ((current: any) => any)): void;
  setSettingsDraft(next: any | ((current: any) => any)): void;
  setPromptOpen(next: any | ((current: any) => any)): void;
  /** 只清空当前项目快照（切到「没有项目」时用） */
  clearProject(): void;
}

/** 共享 store：getState/setState + use + actions。 */
export interface StudioStateStore extends StudioStore<StudioState> {
  use<S>(selector: (state: StudioState) => S, isEqual?: (a: S, b: S) => boolean): S;
  actions: StudioStateActions;
}

/**
 * 创建面板共享 store（项目快照 + 草稿）。
 *
 * @param options.React - 宿主注入的 React（组件订阅要用）
 * @param options.sameDraft - 草稿内容比较（ui.ts 的 sameDraft；platform 不能 import ui）
 * @param options.initial - 覆盖初始状态（自检桩用）
 * @returns store（含 use 与 actions）
 */
export function createStudioStateStore(options: {
  React: any;
  sameDraft: (a: any, b: any) => boolean;
  initial?: Partial<StudioState>;
}): StudioStateStore {
  const gmmSameDraft = options.sameDraft;
  const gmmInitial: StudioState = {
    projects: [],
    projectId: null,
    project: null,
    promptDraft: {},
    videoPromptDraft: "",
    settingsDraft: {},
    promptOpen: {},
    ...(options.initial ?? {})
  };
  const gmmStore = createStore(gmmInitial, { name: "studio", React: options.React });

  /** 草稿写入：函数式更新 + 内容比较短路（内容没变就不 setState、不通知）。 */
  const writeDraft = (key: keyof StudioState, next: any | ((current: any) => any)): void => {
    const current = gmmStore.getState()[key];
    const value = typeof next === "function" ? (next as (current: any) => any)(current) : next;
    if (gmmSameDraft(current, value)) return;
    gmmStore.setState({ [key]: value } as Partial<StudioState>);
  };

  const actions: StudioStateActions = {
    setProjects(next: any[]): void {
      gmmStore.setState({ projects: next });
    },
    setProjectId(next: string | null): void {
      gmmStore.setState({ projectId: next });
    },
    setProject(next: any | null): void {
      gmmStore.setState({ project: next });
    },
    setPromptDraft(next: any): void {
      writeDraft("promptDraft", next);
    },
    setVideoPromptDraft(next: any): void {
      writeDraft("videoPromptDraft", next);
    },
    setSettingsDraft(next: any): void {
      writeDraft("settingsDraft", next);
    },
    setPromptOpen(next: any): void {
      writeDraft("promptOpen", next);
    },
    clearProject(): void {
      gmmStore.setState({ project: null });
    }
  };

  return {
    ...gmmStore,
    use<S>(selector: (state: StudioState) => S, isEqual?: (a: S, b: S) => boolean): S {
      return useStore(gmmStore, selector, isEqual);
    },
    actions
  };
}
