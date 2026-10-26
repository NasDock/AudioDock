/**
 * 首页（Recommended）全局刷新事件。
 * Header 刷新按钮派发，Recommended 页监听后重新请求所有板块内容。
 * 模式参考 ./playMode.ts 的 CustomEvent 用法。
 */

const REFRESH_HOME_EVENT = "soundx:refresh-home";

/** 派发首页刷新请求（Header 刷新按钮调用） */
export const requestHomeRefresh = () => {
  window.dispatchEvent(new CustomEvent(REFRESH_HOME_EVENT));
};

/** 订阅首页刷新请求，返回取消订阅函数（Recommended 页使用） */
export const onHomeRefresh = (callback: () => void): (() => void) => {
  window.addEventListener(REFRESH_HOME_EVENT, callback);
  return () => window.removeEventListener(REFRESH_HOME_EVENT, callback);
};
