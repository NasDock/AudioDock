/**
 * 数据源能力开关。
 *
 * 飞牛音乐（fnOS trim.music）没有 MV 能力：服务层的 FnosMvAdapter 全部返回空实现，
 * 所以飞牛模式下所有 MV 入口（tab / 卡片 / 播放按钮 / 详情页）都要隐藏。
 *
 * mobile 的当前数据源来自 `AuthContext` 的 `sourceType`（落盘 key `selectedSourceType`），
 * 存的是 SOURCEMAP 的展示 key："AudioDock" / "Subsonic" / "Emby" / "Feiniu"。
 * 这里做成纯函数判定，页面直接接 `useAuth().sourceType`，避免再异步读 AsyncStorage。
 */
export const FNOS_SOURCE_TYPE = "Feiniu";

export const isFnosSource = (sourceType?: string | null): boolean =>
  sourceType === FNOS_SOURCE_TYPE;

/** 当前数据源是否支持 MV（其它端同名同语义） */
export const isMvSupported = (sourceType?: string | null): boolean =>
  !isFnosSource(sourceType);
