/**
 * 桌面小部件共享数据模型（对齐 iOS AudioDockWidget UserDefaults schema）。
 *
 * 数据流：
 * - 主 App：playerStore / likesHistory 变化 → WidgetBridge.syncNowPlaying → 写 kvStore + formProvider.updateForm
 * - FormExtensionAbility.onAddForm / onUpdateForm：读 kvStore → FormBindingData → @LocalStorage 渲染
 *
 * 字段命名严格对齐 mobile apps/mobile/src/native/WidgetBridge.ts，
 * 这样 mobile 侧的解析逻辑也能复用（同一份 schema）。
 */

/** 卡片命名前缀（form_config.json 的 name + EntryFormAbility 内部 formKind 用），与 form_config.json 一一对应 */
export const enum WidgetKind {
  PLAYER = 'widget_player',          // 正在播放控制（S/M/L）
  PLAYLIST = 'widget_playlist',      // 播放列表（L）
  HISTORY = 'widget_history',        // 播放与听过（L）
  LATEST = 'widget_latest',          // 上新单曲（L）
}

/** 统一深度链接 scheme；与 mobile 侧 audiodock:// 对齐。 */
export const WIDGET_DEEP_LINK_SCHEME = 'audiodock://';

/** 单条播放状态（iOS widget_title/artist/is_playing/play_mode/is_liked 集合） */
export interface NowPlayingSnapshot {
  title: string;
  artist: string;
  /** 封面相对路径 /covers/xxx.jpg 或完整 URL；卡片用 getImageUrl 缩到 300。 */
  cover: string;
  /** 主色 hex，用于无封面渐变（iOS 封面 8x8 平均色）。 */
  colorPrimary: string;
  /** 副色 hex（darken 0.45 派生）。 */
  colorSecondary: string;
  isPlaying: boolean;
  playMode: 'SEQUENCE' | 'LOOP_LIST' | 'LOOP_SINGLE' | 'SHUFFLE';
  isLiked: boolean;
  /** 0=无内容；>0 表示快照有效。卡片在 isEmpty 时显示「未在播放」占位。 */
  updatedAt: number;
}

/** 播放列表（L 卡片用） */
export interface PlaylistSnapshotItem {
  id: string;
  name: string;
  cover: string;
  trackCount: number;
}

export interface PlaylistsSnapshot {
  items: PlaylistSnapshotItem[];
  /** Header play/pause control mirrors the shared now-playing state. */
  isPlaying: boolean;
  updatedAt: number;
}

/** 播放与听过（L 卡片用）：正在播放 + 3 条历史 */
export interface HistoryItemDto {
  id: string;
  title: string;
  artist: string;
  cover: string;
}

export interface HistorySnapshot {
  /** 顶部正在播放（独立于 nowPlaying） */
  nowPlaying: NowPlayingSnapshot | null;
  items: HistoryItemDto[];
  updatedAt: number;
}

/** 上新单曲（L 卡片用） */
export interface LatestTrackDto {
  id: string;
  title: string;
  artist: string;
  cover: string;
}

export interface LatestSnapshot {
  items: LatestTrackDto[];
  /** Header play/pause control mirrors the shared now-playing state. */
  isPlaying: boolean;
  updatedAt: number;
}

/** VIP 状态（锁定页判定） */
export interface VipSnapshot {
  isVip: boolean;
  expiresAt: string | null;
  updatedAt: number;
}

/** 卡片指令（call 事件 → onFormEvent） */
export interface WidgetCommandAction {
  /** play | pause | next | prev | mode | like | unlike | play_playlist | play_history | play_latest | refresh_latest */
  action: string;
  /** 可选参数（id 等） */
  payload?: Record<string, string>;
}

/** 播放模式 cycle（与 iOS AudioDockPlayerModeCycle 顺序一致） */
export type PlayModeName = 'SEQUENCE' | 'SHUFFLE' | 'LOOP_LIST' | 'LOOP_SINGLE';

export const PLAY_MODE_CYCLE: PlayModeName[] =
  ['SEQUENCE', 'SHUFFLE', 'LOOP_LIST', 'LOOP_SINGLE'];

/** KV 存储键常量（与 iOS widget_* 对齐） */
export class WIDGET_KV_KEYS {
  static readonly nowPlaying: string = 'widget_now_playing';
  static readonly playlists: string = 'widget_playlists';
  static readonly history: string = 'widget_history';
  static readonly latest: string = 'widget_latest';
  static readonly vip: string = 'widget_vip';
  static readonly playModeOverrideUntil: string = 'widget_play_mode_override_until';
  static readonly playModeOverride: string = 'widget_play_mode_override';
}
