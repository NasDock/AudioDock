import { resolveFnosServer, SOURCEMAP } from "@soundx/services";

const logo = require("../../assets/images/logo.webp");
const subsonicLogo = require("../../assets/images/subsonic.webp");
const embyLogo = require("../../assets/images/emby.webp");
const fnosLogo = require("../../assets/images/fnos.png");

/**
 * 数据源展示名。
 *
 * SOURCEMAP 的 key 是技术标识（Feiniu），这里负责本地化成用户看得懂的「飞牛」。
 */
export const SOURCE_LABELS: Record<string, string> = {
  AudioDock: "AudioDock",
  Subsonic: "Subsonic",
  Emby: "Emby",
  Feiniu: "飞牛",
};

/** 飞牛音乐 logo（128×128 官方图标：深底 + 红色圆 + 白色音符） */
export const FNOS_LOGO = fnosLogo;

/** 按数据源 key 取 logo（找不到时回落到 AudioDock logo） */
export const getSourceLogo = (key: string) => {
  switch (key) {
    case "Emby":
      return embyLogo;
    case "Subsonic":
      return subsonicLogo;
    case "Feiniu":
      return fnosLogo;
    default:
      return logo;
  }
};

/** 当前数据源映射到的协议标识（audiodock / subsonic / emby / fnos） */
export const getMappedSourceType = (sourceType: string): string =>
  SOURCEMAP[sourceType as keyof typeof SOURCEMAP] || "audiodock";

/** 是否飞牛数据源（媒体接口只认 Authorization 头，播放/封面都要单独带） */
export const isFnosSource = (sourceType: string): boolean =>
  getMappedSourceType(sourceType) === "fnos";

/**
 * 是否 FN Connect 中继地址（`*.fnos.net` / `*.5ddd.com`）。
 *
 * 中继网关**必须**带 `Cookie: mode=relay`，否则直接 302 到 FN Connect 登录页。
 * 适配器内部（`FnosClient.buildHeaders`）会自动补，
 * 但端侧自己发的裸请求（比如连通性探测）要手动带上。
 */
export const isFnosRelayAddress = (raw: string): boolean => {
  try {
    return resolveFnosServer(String(raw || "").trim()).relayMode;
  } catch {
    return false;
  }
};

/**
 * 飞牛地址归一化。
 *
 * 直接复用 `@soundx/services` 的 `resolveFnosServer`，保证「探测用的地址」和
 * 「适配器实际请求的地址」是同一个口径：
 * - 缺协议补 http://（中继域名 *.fnos.net / *.5ddd.com 补 https://）；
 * - 裸地址补默认端口 5666（显式写了 http:// 的按 80 走，和服务端一致）；
 * - 去掉尾部斜杠与误粘的 /music、/api/v1 路径。
 *
 * 注意：这里不能自己用 `new URL()` 解析 —— React Native 的全局 URL 是
 * `Libraries/Blob/URL` 存根，protocol / port 只有 getter，赋值会抛 TypeError。
 */
export const normalizeFnosAddress = (raw: string): string => {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    return resolveFnosServer(value).origin;
  } catch {
    // 地址不合法时原样返回，交给上层的「必须以 http 开头」校验去报错
    return value;
  }
};

