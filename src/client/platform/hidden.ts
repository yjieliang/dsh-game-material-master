/**
 * 浏览器半区 · 功能管理（platform/hidden）。
 */

export function createHiddenModules(deps: any) {
  // 依赖：组合根注入（先按需展开，由 tsc 报错驱动补齐）
  const {
    T,
    // ⚠️ 这里的 MODULES 是**按引用**抓的：`platform/meta.ts` 语言切换时用
    // `replaceArray` 原地换内容（数组身份不变），所以本工厂拿着旧引用也能读到新标题。
    // 别为了「拿最新的」在这里再复制一份快照 —— 那样切语言后页签会永远停在旧语言。
    MODULES,
    React,
  } = deps;

    // ── 功能管理（被隐藏的模块）──────────────────────────────────────────
    //
    // 设置页「功能管理」写、工作台页签与侧栏菜单读，所以状态放在工厂闭包里共享
    // 一份，而不是各自去 `getConfig()`。
    //
    // 「隐藏」是**双向**的：这里只管界面，对话工具面由宿主 `src/tools.ts` 再拦
    // 一次（`hiddenModules` 存在宿主配置里，两侧读的是同一份）。只藏界面不拦
    // 工具等于没藏——模型照样能调生成类方法，真实计费。
    const hiddenModulesState = { keys: [] as string[], listeners: new Set<(keys: string[]) => void>() };

    /** 收敛成合法且顺序固定的 key 数组（与宿主 `normalizeHiddenModules` 同口径）。 */
    function normalizeHiddenKeys(value) {
      if (!Array.isArray(value)) return [];
      return MODULES.map((entry) => entry.key).filter((key) => value.includes(key));
    }

    /** 写入并通知订阅者；内容没变就不通知（避免无谓重渲染）。 */
    function publishHiddenModules(value) {
      const next = normalizeHiddenKeys(value);
      if (next.length === hiddenModulesState.keys.length && next.every((key, index) => key === hiddenModulesState.keys[index])) return;
      hiddenModulesState.keys = next;
      for (const listener of [...hiddenModulesState.listeners]) {
        try {
          listener(next);
        } catch {
          // 单个订阅者出错不该拖垮别的。
        }
      }
    }

    /** 从宿主读一次当前可见性。读失败就当作「全部可见」，不要因此白屏。 */
    async function refreshHiddenModules(api) {
      if (api === undefined) return;
      try {
        const config = await api.getConfig();
        publishHiddenModules(config?.hiddenModules);
      } catch {
        // 配置读不到不是致命错误：界面照常，工具面仍然会拦。
      }
    }

    function useHiddenModules(api) {
      const [hidden, setHidden] = React.useState(hiddenModulesState.keys);
      React.useEffect(() => {
        hiddenModulesState.listeners.add(setHidden);
        // 订阅之前可能已经有值了（设置页先加载完），补一次对齐。
        setHidden(hiddenModulesState.keys);
        return () => {
          hiddenModulesState.listeners.delete(setHidden);
        };
      }, []);
      React.useEffect(() => {
        void refreshHiddenModules(api);
      }, [api]);
      return hidden;
    }

    /** 可见的模块（页签、侧栏菜单都按它渲染）。 */
    function visibleModulesOf(hidden) {
      return MODULES.filter((entry) => !hidden.includes(entry.key));
    }

  return {
    hiddenModulesState, normalizeHiddenKeys, publishHiddenModules, refreshHiddenModules, useHiddenModules, visibleModulesOf
  };
}
