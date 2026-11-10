import { getServiceConfig } from "@soundx/services";
import { getMappedSourceType, isFnosRelayAddress } from "../constants/sources";
import { getBaseURL, getCurrentSourceType } from "../https";

/**
 * 媒体请求头（封面 / 音频）。
 *
 * 飞牛音乐的 `/static/cover`、`/track/stream` **只认 `Authorization` 头**：
 * 实测 query 传 `?token=` / `?userToken=` / `?access_token=`、以及
 * `Cookie: music-token=` 全部 401（见 docs/fnos-music-api.md 4.7）。
 * 而 `<Image>` / RNTP 队列只能在 source / track 上挂 headers，
 * 所以这里统一给出「当前源需要的媒体请求头」。
 *
 * 另外 FN Connect 中继（`*.fnos.net` / `*.5ddd.com`）还必须带
 * `Cookie: mode=relay`，否则媒体接口和业务接口一样会 302 到登录页
 * （适配器内部的 `FnosClient.buildHeaders` 已经在做这件事，
 * 端侧自己拼 URL 的媒体请求要在这里补齐）。
 *
 * 其它数据源（AudioDock / Subsonic / Emby）的媒体地址自带凭据，
 * 不需要额外头，返回空对象即可。
 */
export const getMediaHeaders = (): Record<string, string> => {
  if (getMappedSourceType(getCurrentSourceType()) !== "fnos") return {};

  const headers: Record<string, string> = {};

  // 飞牛的会话 token 就是登录接口返回的 userToken，
  // 登录时由 FnosAuthAdapter 写进 serviceConfig，重启后由 AuthContext 还原。
  const token = getServiceConfig().token;
  if (token) headers.Authorization = token;

  // 中继模式：mode=relay 是网关放行的必要条件，
  // music-token 与官方客户端保持一致（带上更保险）。
  if (isFnosRelayAddress(getBaseURL())) {
    headers.Cookie = token
      ? `mode=relay; music-token=${encodeURIComponent(token)}`
      : "mode=relay";
  }

  return headers;
};

/** 媒体请求头是否为空（空则调用方不必传 headers 字段） */
export const hasMediaHeaders = (headers: Record<string, string>): boolean =>
  Object.keys(headers).length > 0;
