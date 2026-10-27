/**
 * 浏览器半区 · 运行时依赖容器（platform/runtime）。
 *
 * 为什么需要它：现在每个模块工厂都要收 16–37 个参数（React / h / T / ui 组件…），
 * 加一个共享件就要改 N 处签名。这里把「插件实例级、创建后不再变化」的依赖
 * 在 apply() 的最早一次性装进来，模块按需取用：
 *
 *   installRuntime({ React, h, T, api, ui, perf })   // 组合根执行一次
 *   const { T, h } = useStudio()                      // 组件内
 *   const { T } = studio()                            // 非组件代码
 *
 * 取舍：这是 Service Locator（隐式依赖），换来的是签名归零与迁移成本最低。
 * 只允许放**不可变**依赖；会变的状态一律进 feature store，不要塞进这里。
 * 若将来需要多实例/嵌套工作台，可把 useStudio 换成读 React Context，
 * 调用点不用改（这是刻意留的口子）。
 */

/** 平台级依赖：创建后不可变。 */
export interface StudioRuntime {
  /** 宿主注入的 react */
  React: any;
  /** React.createElement 的简写 */
  h: (type: any, props?: any, ...children: any[]) => any;
  /** 词条翻译：中文原文 → 当前语言 */
  T: (key: string, params?: Record<string, unknown>) => string;
  /** 远程调用句柄（platform/api 的客户端）；P1 阶段先不接 */
  api?: any;
  /** 基础组件表（platform/ui）；P2 阶段接入 */
  ui?: any;
  /** 集中轮询调度器（platform/scheduler）；P3b 起所有轮询都走它 */
  scheduler?: any;
  /** 性能与错误计数（platform/perf） */
  perf?: any;
  /** 宿主 ctx（保留给确实需要的场景，勿滥用） */
  ctx?: any;
}

let gmmRuntime: StudioRuntime | null = null;

/**
 * 装入运行时依赖。组合根（client.ts 的 factory 开头）调用且只调用一次。
 * @param next - 依赖集合；同一份引用会被所有模块共享
 * @returns 装入的依赖
 */
export function installRuntime(next: StudioRuntime): StudioRuntime {
  gmmRuntime = next;
  return next;
}

/**
 * 补装/覆盖运行时依赖（组合根分两步装：先 React/h/T，等 ui 组件表就绪后再补 ui）。
 * 只用于「创建期先后顺序」问题，不要在运行中反复改。
 * @param patch - 要合并进运行时的依赖
 * @returns 合并后的依赖
 */
export function provideRuntime(patch: Partial<StudioRuntime>): StudioRuntime {
  if (gmmRuntime === null) {
    throw new Error("platform/runtime: provideRuntime() 之前必须先 installRuntime()");
  }
  gmmRuntime = { ...gmmRuntime, ...patch };
  return gmmRuntime;
}

/** 是否已经装入依赖（自检 / 降级路径用）。 */
export function hasRuntime(): boolean {
  return gmmRuntime !== null;
}

/**
 * 取运行时依赖（非组件代码用）。
 * @returns 已装入的依赖
 * @throws 未装入时抛错——这属于编码错误，不去猜默认值
 */
export function studio(): StudioRuntime {
  if (gmmRuntime === null) {
    throw new Error("platform/runtime: installRuntime() 还没执行，不能取运行时依赖");
  }
  return gmmRuntime;
}

/** 组件内取运行时依赖（与 studio() 同源；改名只是为了读代码时一眼看出上下文）。 */
export function useStudio(): StudioRuntime {
  return studio();
}

/** 仅测试用：清空运行时，避免用例之间互相污染。 */
export function resetRuntimeForTest(): void {
  gmmRuntime = null;
}