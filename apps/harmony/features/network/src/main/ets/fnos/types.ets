/**
 * 飞牛音乐（fnOS trim.music）接口数据结构。
 *
 * 对应网关：`<NAS>/music/api/v1`，统一信封 `{ code, msg, data }`，
 * `code === 0` 表示成功，`119999/120001` 类表示会话失效。
 * 字段口径见仓库根目录 docs/fnos-music-api.md（desktop 接入时实测的样本）。
 *
 * 这里只声明适配器真正用到的字段，其余一律省略 —— ArkTS 不允许索引签名，
 * 用不到的字段声明出来反而要写一堆可选值兜底。
 */

/** 统一信封 */
export interface FnosEnvelope<T> {
  code: number;
  msg?: string;
  data: T;
}

/** 分页信封：没有 hasMore，只能靠 total 自己算 */
export interface FnosPage<T> {
  list: T[];
  total: number;
}

/** 音频规格。duration/bitrate 单位：ms / bps */
export interface FnosAudioSpec {
  bitDepth?: number;
  sampleRate?: number;
  bitrate?: number;
  codec?: string;
  container?: string;
  duration?: number;
}

export interface FnosArtistRef {
  guid: string;
  name: string;
}

/** 专辑 VO；作为曲目内嵌对象时没有 trackCount */
export interface FnosAlbum {
  guid: string;
  name: string;
  coverId?: string;
  releaseDate?: string;
  createdAt?: number;
  updatedAt?: number;
  artists?: FnosArtistRef[];
  trackCount?: number;
}

export interface FnosArtist {
  guid: string;
  name: string;
  coverId?: string;
  createdAt?: number;
  updatedAt?: number;
  trackCount?: number;
  albumCount?: number;
}

/** 曲目 VO。duration 单位毫秒，注意与 AudioDock 的秒制换算 */
export interface FnosTrack {
  guid: string;
  title: string;
  coverId?: string;
  year?: number;
  discNo?: number;
  trackNo?: number;
  duration?: number;
  createdAt?: number;
  updatedAt?: number;
  album?: FnosAlbum;
  artists?: FnosArtistRef[];
  genres?: string[];
  audioSpec?: FnosAudioSpec;
  size?: number;
  isFavorite?: boolean;
}

export interface FnosPlaylist {
  guid: string;
  name: string;
  coverId?: string;
  createdAt?: number;
  updatedAt?: number;
  trackCount?: number;
}

export interface FnosUser {
  guid: string;
  name: string;
  role?: string;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * 服务端配置（`GET /sys/config`，免登录）。
 * 官方客户端用它做「地址是否指向一台飞牛音乐」的判据。
 */
export interface FnosSystemConfig {
  serverGUID: string;
  serverName: string;
  serverVersion?: string;
  mediasrvVersion?: string;
}

/** 密码登录返回：token 字段叫 userToken，别写成 token */
export interface FnosLoginResult {
  userToken: string;
  user?: FnosUser;
}

/** 歌词接口返回形态之一：`{ list: [{ guid, content }], preferred }` */
export interface FnosLyricItem {
  guid?: string;
  content?: string;
  lyric?: string;
  isLRC?: boolean;
}

export interface FnosLyricPayload {
  list?: FnosLyricItem[];
  preferred?: string;
  content?: string;
  lyric?: string;
}

/**
 * 媒体地址解析能力（由 FnosClient 实现）。
 *
 * 抽成接口是为了让 mapper 不依赖 client 的具体实现 —— ArkTS 不支持结构化类型，
 * 必须显式 implements，否则「传 FnosClient 给要 FnosCoverResolver 的参数」会编译不过。
 */
export interface FnosCoverResolver {
  coverUrl(coverId: string, size: number): string;
  streamUrl(guid: string): string;
}

// ---------------------------------------------------------------- 请求体模型
// ArkTS 禁止无类型对象字面量（arkts-no-untyped-obj-literals），
// POST body 必须逐一声明成接口，不能像 TS 那样直接传 `{ trackGUID: id }`。

export interface FnosTrackGuidBody {
  trackGUID: string;
}

/** 密码登录 body：password 是 SHA-256(明文) 的小写十六进制 */
export interface FnosPasswordLoginBody {
  username: string;
  password: string;
  deviceId: string;
}

export interface FnosPlaylistNameBody {
  name: string;
}

export interface FnosPlaylistUpdateBody {
  guid: string;
  name: string;
}

export interface FnosPlaylistGuidBody {
  guid: string;
}

export interface FnosPlaylistTracksBody {
  guid: string;
  trackGUIDs: string[];
}

export interface FnosEventPayload {
  trackGUID: string;
  progress: number;
}

export interface FnosEventItem {
  eventType: string;
  payload: FnosEventPayload;
}

export interface FnosEventReportBody {
  events: FnosEventItem[];
}
