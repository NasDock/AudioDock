import Taro from '@tarojs/taro';

/**
 * 数据源能力开关。
 *
 * 飞牛音乐（fnOS trim.music）没有 MV 能力：服务层的 FnosMvAdapter 全部返回空实现，
 * 所以飞牛模式下所有 MV 入口（tab / 卡片 / 播放按钮 / 详情页）都要隐藏。
 *
 * mini 的当前数据源落在 storage 的 `currentSourceType`，存的是 SOURCEMAP 的展示 key
 * （"AudioDock" / "Subsonic" / "Emby" / "Feiniu"）。页面若已有该值可直接传入，
 * 避免重复读 storage。
 */
export const FNOS_SOURCE_TYPE = 'Feiniu';

export const isFnosSource = (sourceType?: string | null): boolean => {
  const current = sourceType || Taro.getStorageSync('currentSourceType') || 'AudioDock';
  return current === FNOS_SOURCE_TYPE;
};

/** 当前数据源是否支持 MV（其它端同名同语义） */
export const isMvSupported = (sourceType?: string | null): boolean =>
  !isFnosSource(sourceType);
