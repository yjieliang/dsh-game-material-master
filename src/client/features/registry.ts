/**
 * 浏览器半区 · feature 注册表（features/registry）。
 *
 * 这是「有哪些功能模块」的唯一真源：每个 features/<m>/descriptor.ts 提供 key / 顺序 / 文案，
 * 这里按顺序汇总。新增模块 = 新增一个 features/<m>/ 目录 + 在下面加一行 import。
 *
 * 现在它只做两件事：给 shell 提供顺序，并在启动时和面板的 MODULES 表做一致性自检
 * （两处清单漂移是这类多模块界面的老毛病，用断言钉住比靠记忆靠谱）。
 */

import { SPRITE_DESCRIPTOR } from "./sprite/descriptor.js";
import { IMAGE_DESCRIPTOR } from "./image/descriptor.js";
import { SEQUENCE_DESCRIPTOR } from "./sequence/descriptor.js";
import { RIG_DESCRIPTOR } from "./rig/descriptor.js";
import { ISO_DESCRIPTOR } from "./iso/descriptor.js";
import { MAP_DESCRIPTOR } from "./map/descriptor.js";
import { MUSIC_DESCRIPTOR } from "./music/descriptor.js";
import { SFX_DESCRIPTOR } from "./sfx/descriptor.js";

/** 全部 feature 描述符（按 order 升序）。 */
export const FEATURES = [
  SPRITE_DESCRIPTOR,
  IMAGE_DESCRIPTOR,
  SEQUENCE_DESCRIPTOR,
  RIG_DESCRIPTOR,
  ISO_DESCRIPTOR,
  MAP_DESCRIPTOR,
  MUSIC_DESCRIPTOR,
  SFX_DESCRIPTOR
].sort((left, right) => left.order - right.order);

/** feature key 顺序（自检 / 面板对齐用）。 */
export function featureKeys() {
  return FEATURES.map((feature) => feature.key);
}
