/**
 * 绿联音乐（UGOS Pro com.ugreen.music）接口数据结构。
 *
 * 网关：`<baseURL>/ugreen/v1`，统一信封 `{ code, msg, data }`，`code === 200` 成功。
 * 鉴权：登录拿到 api_token 后，所有接口（含媒体地址）都以 query 参数 `token=` 携带。
 * 字段口径见 docs/ugreen-music-api.md（UGOS Pro 1.15.1.0127 实测）。
 */

/** 统一信封 */
export interface UgreenEnvelope<T> {
  code: number;
  msg: string;
  data: T;
  debug?: string;
  time?: number;
}

/** 通用分页负载：列表字段名随接口变（file_arr / album_arr / singer_arr / songlist_arr） */
export interface UgreenPageBase {
  total_num: number;
  is_last_page: boolean;
}

export interface UgreenTrackPage extends UgreenPageBase {
  file_arr: UgreenTrack[];
}

export interface UgreenAlbumPage extends UgreenPageBase {
  album_arr: UgreenAlbum[];
}

export interface UgreenArtistPage extends UgreenPageBase {
  singer_arr: UgreenArtist[];
}

export interface UgreenPlaylistListData {
  songlist_arr: UgreenPlaylist[];
}

export interface UgreenSearchPage extends UgreenPageBase {
  file_arr?: UgreenTrack[];
  album_arr?: UgreenAlbum[];
  singer_arr?: UgreenArtist[];
  songlist_arr?: UgreenPlaylist[];
  highlight_words?: string[];
}

export interface UgreenSingerRef {
  singer_id: number;
  singer_name: string;
}

/** 曲目 VO（file_arr 元素）；duration / file_move_time / update_time 单位都是秒 */
export interface UgreenTrack {
  audio_id: number;
  resource_id?: string;
  source?: number;
  song_title: string;
  audio_cover_url?: string;
  duration?: number;
  file_move_time?: number;
  file_path: string;
  file_size?: string;
  file_size_byte?: number;
  file_extension?: string;
  serial_number?: number;
  singer_id?: number;
  singer_name?: string;
  singer_arr?: UgreenSingerRef[];
  album_id?: number;
  album_name?: string;
  year?: string;
  bit_rate?: string;
  audio_type?: number;
  /** 1 = 有效，其他 = 文件已失效 */
  validity?: number;
  collected?: boolean;
  update_time?: number;
  pinyin_first?: string;
  /** song/info 返回里可能有歌词文件路径（get_file_with_token 的 file_path） */
  lyric_url?: string;
}

/** 专辑 VO（album_arr 元素） */
export interface UgreenAlbum {
  album_id: number;
  album_name: string;
  album_cover_url?: string;
  singer_id?: number;
  singer_name?: string;
  singer_arr?: UgreenSingerRef[];
  year?: string;
  default_cover_id?: number;
  total_num?: number;
  collected?: boolean;
}

/** 歌手 VO（singer_arr 元素）；没有头像字段 */
export interface UgreenArtist {
  singer_id: number;
  singer_name: string;
  pinyin_first?: string;
  create_time?: string;
  total_num?: number;
  album_total_num?: number;
}

/** 歌单 VO（songlist_arr 元素）；create_time 是 ISO 字符串，update_time 是秒 */
export interface UgreenPlaylist {
  songlist_id: number;
  uid?: number;
  title: string;
  cover_url?: string;
  intro?: string;
  create_time?: string;
  update_time?: number;
  total_num?: number;
  with_valid_song?: boolean;
}

/** 歌单详情（songlist/by_id/v2）：曲目全量返回，无分页参数 */
export interface UgreenPlaylistDetail extends UgreenPageBase {
  songlist_info: UgreenPlaylist;
  user_info?: { uid: number; username: string; head_pic?: string };
  file_arr: UgreenTrack[];
  has_invalid_song?: boolean;
}

/** 专辑详情（album/v2） */
export interface UgreenAlbumDetail extends UgreenPageBase {
  album_info: UgreenAlbum;
  file_arr: UgreenTrack[];
}

/** 歌手详情（singer，split_version_flag=true 时曲目按专辑拆分） */
export interface UgreenArtistDetail extends UgreenPageBase {
  singer_info: UgreenArtist;
  album_arr: UgreenAlbum[];
  file_arr: UgreenTrack[];
  split_version_flag?: boolean;
}

/** 单曲信息（song/info） */
export interface UgreenSongInfo {
  music_file: UgreenTrack;
  split_version_flag?: boolean;
}

/** 最近播放 */
export interface UgreenRecentlyPlayed extends UgreenPageBase {
  cover_url?: string;
  file_arr: UgreenTrack[];
}

/** 登录返回（verify/login 的 data） */
export interface UgreenLoginResult {
  token: string;
  static_token?: string;
  third_token?: string;
  token_id?: string;
  uid: number;
  username: string;
  role?: string;
  nas_name?: string;
  is_ugk?: boolean;
  model?: string;
  sn?: string;
  system_version?: string;
  public_key?: string;
  [key: string]: unknown;
}

/** 当前用户（user/current/user 的 data） */
export interface UgreenCurrentUser {
  uid: number;
  username: string;
  role?: string;
  fullname?: string;
  ugreen_no?: number;
  [key: string]: unknown;
}
