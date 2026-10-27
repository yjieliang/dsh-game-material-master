/**
 * dsh-game-material-master —— 浏览器半区入口。
 *
 * 只做一件事：把插件注册给宿主的经典脚本加载器，取出 React，其余交给
 * shell/bootstrap.ts（组合根）。产品仍是单文件经典脚本 —— scripts/bundle-client.mjs
 * 会把整张模块图内联进来。
 */

import { createBootstrap } from "./client/shell/bootstrap.js";

(window as any).__ModuleLoader__.load({
  id: "dsh-game-material-master",
  factory: (require: any) => {
    const bundleModule = { exports: {} as any };
    Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: "Module" });
    return createBootstrap({ React: require("react"), module: bundleModule });
  }
});
