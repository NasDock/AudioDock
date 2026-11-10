import { SOURCEMAP as BASE_SOURCEMAP, SOURCETIPSMAP as BASE_TIPSMAP } from "@soundx/services";
import fnosLogo from "../assets/fnos.png";

/**
 * desktop 支持的数据源清单。
 *
 * 之所以在端侧扩展而不是直接改 `@soundx/services` 的 SOURCEMAP：
 * mobile / mini 都是用 `Object.keys(SOURCEMAP)` 渲染数据源列表的，
 * 公共常量里一加，那两个端就会出现「能选但没有对应适配器」的选项。
 * 等飞牛适配器在移动端也接上之后，再把这条挪回公共常量。
 */
export const SOURCEMAP = {
  ...BASE_SOURCEMAP,
  Feiniu: "fnos",
} as const;

export const SOURCETIPSMAP = {
  ...BASE_TIPSMAP,
  Feiniu: "飞牛 fnOS 自带的音乐应用（trim.music），地址填 NAS，如 http://192.168.1.10:5666",
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

