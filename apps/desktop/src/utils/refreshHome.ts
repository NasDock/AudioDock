/**
 * 全局刷新事件。
 * Header 刷新按钮派发，Recommended（首页板块）、Category（专辑列表）、
 * ArtistList（艺术家列表）、Collections（合集类别）等页面监听后重新请求数据。
 * 模式参考 ./playMode.ts 的 CustomEvent 用法。
 */

const REFRESH_HOME_EVENT = "soundx:refresh-home";

/** 派发首页刷新请求（Header 刷新按钮调用） */
export const requestHomeRefresh = () => {
  window.dispatchEvent(new CustomEvent(REFRESH_HOME_EVENT));
};

/** 订阅刷新请求，返回取消订阅函数（各列表页使用） */
export const onHomeRefresh = (callback: () => void): (() => void) => {
  window.addEventListener(REFRESH_HOME_EVENT, callback);
  return () => window.removeEventListener(REFRESH_HOME_EVENT, callback);
};
