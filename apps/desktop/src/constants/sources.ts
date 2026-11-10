import { SOURCEMAP as BASE_SOURCEMAP, SOURCETIPSMAP as BASE_TIPSMAP } from "@soundx/services";
import fnosLogo from "../assets/fnos.png";

/**
 * desktop 支持的数据源清单。
 *
 * 飞牛适配器接入 mobile 后，`Feiniu` 已挪回 `@soundx/services` 的公共常量
 * （mobile / mini 用 `Object.keys(SOURCEMAP)` 渲染数据源列表，mini 侧有自己的
 * 本地清单不含飞牛，所以公共常量里加这一项是安全的）。
 * 这里保留一份别名导出，避免历史引用散落各处时找不到。
 */
export const SOURCEMAP = {
  ...BASE_SOURCEMAP,
} as const;

export const SOURCETIPSMAP = {
  ...BASE_TIPSMAP,
} as const;

/** 数据源展示名（SOURCEMAP 的 key 是技术标识，这里负责本地化） */
export const SOURCE_LABELS: Record<string, string> = {
  AudioDock: "AudioDock",
  Subsonic: "Subsonic",
  Emby: "Emby",
  Feiniu: "飞牛",
};

/**
 * 飞牛音乐 logo。
 * 128×128 的官方图标（深底 + 红色圆 + 白色音符），走 vite 资源导入，
 * `<img src>` 与「按字符串返回 logo」两种用法都能复用同一个值。
 */
export const FNOS_LOGO = fnosLogo;

