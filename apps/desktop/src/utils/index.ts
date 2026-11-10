import { SOURCEMAP } from "@soundx/services";
import { resolveArtworkUri } from "../services/trackResolver";

/**
 * 封面 / 头像 URL。
 *
 * @param width 目标设备像素宽度（非 CSS 尺寸，按显示尺寸 ×2 估算），默认 300。
 *   默认 300 落在「恒压缩」档，即未显式标注尺寸的调用点一律拿到缩略图 —— 这是安全默认值。
 *   详见 `./imageBucket.ts`。
 */
export const getCoverUrl = (
  path?: string | null | any,
  id?: number | string,
  width = 300,
) => {
  if (typeof path === "object" && path !== null) {
    return (
      resolveArtworkUri(path, { width }) ||
      `https://picsum.photos/seed/${path.id || id}/300/300`
    );
  }
  return resolveArtworkUri(path, { width }) || `https://picsum.photos/seed/${id}/300/300`;
};

export const isSubsonicSource = () => {
  const sourceName = localStorage.getItem("selectedSourceType") as keyof typeof SOURCEMAP;
  const sourceType = SOURCEMAP[sourceName];
  return sourceType === SOURCEMAP.Subsonic;
};

export const isEmbySource = () => {
  const sourceName = localStorage.getItem("selectedSourceType") as keyof typeof SOURCEMAP;
  const sourceType = SOURCEMAP[sourceName];
  return sourceType === SOURCEMAP.Emby;
};

/** 飞牛音乐（fnOS trim.music）：desktop 端独有，见 constants/sources.ts */
export const isFnosSource = () => {
  return localStorage.getItem("selectedSourceType") === "Feiniu";
};

/**
 * 当前数据源是否支持 MV。
 * 飞牛音乐（fnOS trim.music）没有 MV 能力，适配器全部返回空实现，
 * 因此飞行模式下所有 MV 入口（tab / 卡片 / 播放按钮 / 路由）都要隐藏。
 */
export const isMvSupported = () => !isFnosSource();

/** 外部数据源（非 AudioDock 官方服务端）：扫描/整理/文件夹/有声书等能力都不可用 */
export const isThirdPartySource = () =>
  isSubsonicSource() || isEmbySource() || isFnosSource();
