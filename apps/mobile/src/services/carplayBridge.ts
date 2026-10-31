import type { Track } from "../models";

/**
 * CarPlay 与 PlayerContext 之间的桥接注册表。
 *
 * CarPlay 模板构建在 React 树之外（模块级服务），不能直接消费 Context，
 * 因此 PlayerContext 挂载时把播控能力注册到这里，CarPlay 服务通过
 * getCarPlayController() 获取。
 */
export interface CarPlayController {
  /** 播放整列并从 index 开始 */
  playTrackList: (tracks: Track[], index: number) => Promise<void>;
  /** 播放/暂停切换 */
  togglePlay: () => Promise<void>;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  /** 当前登录用户 id（未登录返回 null），供拉取用户级数据 */
  getUserId: () => number | string | null;
}

let controller: CarPlayController | null = null;

export function registerCarPlayController(c: CarPlayController | null) {
  controller = c;
}

export function getCarPlayController(): CarPlayController | null {
  return controller;
}
