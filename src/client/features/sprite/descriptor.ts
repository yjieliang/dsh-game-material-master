/**
 * 模块① 八方向图生成 —— feature 描述符。
 *
 * 将来 shell/registry.ts 只读这里（key / 图标 / 顺序 / 可见性开关），
 * 新增模块 = 新增一个 features/<m>/ 目录 + 在 registry 里加一行，不改 shell。
 */

/** feature 元数据（registry 的唯一真源）。 */
export const SPRITE_DESCRIPTOR = {
  /** 与宿主 STUDIO_MODULES / 深链接参数 module 一致 */
  key: "sprite",
  /** 页签顺序（数字小的在前） */
  order: 0,
  /** 侧栏菜单项文案（中文原文，走 T()） */
  label: "八方向图生成",
  /** 图标由 module-icon.ts 提供 */
  icon: "sprite"
} as const;
