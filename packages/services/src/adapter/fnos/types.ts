/**
 * 飞牛音乐（fnOS trim.music）接口数据结构。
 *
 * 对应网关：`<baseURL>/music/api/v1`，所有业务接口统一信封 `{ code, msg, data }`，
 * `code === 0` 表示成功，`code === 120001` 表示会话失效。
 * 字段口径见 docs/fnos-music-api.md（实测样本）。
 */

/** 统一信封 */
export interface FnosEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

/** 分页信封：没有 hasMore，只能靠 total 自己算 */
export interface FnosPage<T> {
  list: T[];
  total: number;
  /** 官方会回显请求的 sort，例如 "createdAt,desc" */
  sort?: string;
}

/** 音频规格。duration/bitrate 单位：ms / bps */
export interface FnosAudioSpec {
  bitDepth?: number;
  sampleRate?: number;
  channel?: number;
  bitrate?: number;
  codec?: string;
  container?: string;
  duration?: number;
  format?: string;
  /** NAS 绝对路径，出于安全考虑不要下发给端侧 */
  path?: string;
}

export interface FnosArtistRef {
  guid: string;
  name: string;
}

/** 专辑 VO；作为曲目内嵌对象时没有 trackCount */
export interface FnosAlbum {
  guid: string;
  name: string;
  coverId?: string | null;
  releaseDate?: string | null;
  barcode?: string | null;
  createdAt?: number;
  updatedAt?: number;
  artists?: FnosArtistRef[];
  trackCount?: number;
}

export interface FnosArtist {
  guid: string;
  name: string;
  coverId?: string | null;
  createdAt?: number;
  updatedAt?: number;
  trackCount?: number;
  albumCount?: number;
}

/** 曲目 VO */
export interface FnosTrack {
  guid: string;
  title: string;
  coverId?: string | null;
  year?: number | null;
  discNo?: number | null;
  trackNo?: number | null;
  isCue?: boolean;
  /** 毫秒 */
  duration?: number;
  createdAt?: number;
  updatedAt?: number;
  album?: FnosAlbum | null;
  artists?: FnosArtistRef[];
  genres?: string[];
  audioSpec?: FnosAudioSpec;
  /** 文件字节数 */
  size?: number;
  isFavorite?: boolean;
  /** 搜索结果相关度 */
  score?: number;
}

export interface FnosPlaylist {
  guid: string;
  name: string;
  coverId?: string | null;
  createdAt?: number;
  updatedAt?: number;
  trackCount?: number;
}

export interface FnosUser {
  guid: string;
  name: string;
  role?: string;
  lastAccessedAt?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface FnosInitializationState {
  initialized: boolean;
}

/** 歌词接口返回：目前按 LRC 纯文本处理，兼容 { list: [{ content }] } 形态 */
export type FnosLyricResponse =
  | string
  | null
  | { content?: string; lyric?: string; list?: Array<{ content?: string; lyric?: string }> };

/**
 * 服务端配置（`GET /sys/config`，**免登录**）。
 * 官方客户端用它做「地址是否指向一台飞牛音乐」的判据。
 */
export interface FnosSystemConfig {
  serverGUID: string;
  serverName: string;
  serverVersion: string;
  mediasrvVersion: string;
  capabilities?: Record<string, boolean>;
  /** NAS 级 OAuth（走中继时才会出现，本适配器暂不使用） */
  nasOAuth?: { clientId?: string };
}

/** 密码登录入参：password 必须是 sha256(明文) 的小写十六进制 */
export interface FnosPasswordLoginRequest {
  username: string;
  password: string;
  deviceId: string;
}

/** 密码登录返回：token 字段叫 userToken，别写成 token */
export interface FnosLoginResult {
  userToken: string;
  user: FnosUser;
  [key: string]: unknown;
}
