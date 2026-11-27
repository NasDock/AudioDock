import { getServiceConfig } from "../../config";
import { Album, Artist, Playlist, Track, TrackType, User } from "../../models";
import type { UgreenClient } from "./client";
import type {
  UgreenAlbum,
  UgreenArtist,
  UgreenPlaylist,
  UgreenTrack,
} from "./types";

/** 绿联时间戳是秒，统一转成 ISO 字符串（AudioDock 侧 Date 字段） */
export const ugreenSecondsToIso = (value?: number | null): string => {
  if (!value) return new Date().toISOString();
  const ms = value > 1e12 ? value : value * 1000;
  return new Date(ms).toISOString();
};

/** 绿联 duration 本身就是秒，无需换算，只做防御 */
export const ugreenDurationToSeconds = (value?: number | null): number => {
  if (!value || value <= 0) return 0;
  return Math.round(value);
};

/** 当前登录用户的 uid（登录后写入 config.userId） */
const currentUserId = (): string => String(getServiceConfig().userId || "ugreen-user");

const artistNames = (track: UgreenTrack): string => {
  const names = (track.singer_arr || []).map((a) => a.singer_name).filter(Boolean);
  if (names.length) return names.join(" / ");
  return track.singer_name || "Unknown Artist";
};

const pickYear = (year?: string | null): string | null => {
  if (!year) return null;
  const matched = String(year).match(/\d{4}/);
  return matched ? matched[0] : String(year);
};

/**
 * 曲目映射（同步——封面/音频地址都是 token query 拼接，不需要异步签名）。
 *
 * - 封面：`audio_cover_url` 是 get_file 的 file_path，空时留 null（端侧用默认图）
 * - 播放地址：`file_path` 直链，支持 Range
 * - 歌词：列表接口不带，靠切歌时 `getLyrics()` 懒加载（同飞牛）
 */
export const mapUgreenTrack = (
  raw: UgreenTrack,
  client: UgreenClient,
  options?: { lyrics?: string | null },
): Track => {
  const artist = artistNames(raw);
  const singer = raw.singer_arr?.[0];
  const userId = currentUserId();
  const likedByUsers = raw.collected
    ? [
        {
          id: `${raw.audio_id}:favorite`,
          userId,
          trackId: String(raw.audio_id),
          createdAt: ugreenSecondsToIso(raw.update_time || raw.file_move_time),
        },
      ]
    : [];

  return {
    id: String(raw.audio_id),
    name: raw.song_title,
    path: client.getStreamUrl(raw.file_path),
    artist,
    artistEntity: {
      id: String(singer?.singer_id ?? raw.singer_id ?? ""),
      name: singer?.singer_name || raw.singer_name || artist,
      avatar: null,
      type: TrackType.MUSIC,
    },
    album: raw.album_name || "Unknown Album",
    albumEntity: {
      id: String(raw.album_id ?? ""),
      name: raw.album_name || "Unknown Album",
      artist,
      cover: client.getCoverUrl(raw.audio_cover_url, raw.update_time),
      year: pickYear(raw.year),
      type: TrackType.MUSIC,
    },
    cover: client.getCoverUrl(raw.audio_cover_url, raw.update_time),
    duration: ugreenDurationToSeconds(raw.duration),
    lyrics: options?.lyrics ?? null,
    index: raw.serial_number || null,
    type: TrackType.MUSIC,
    createdAt: ugreenSecondsToIso(raw.file_move_time),
    artistId: String(singer?.singer_id ?? raw.singer_id ?? "") || undefined,
    albumId: String(raw.album_id ?? "") || undefined,
    likedByUsers,
    listenedByUsers: [],
    likedAsAudiobookByUsers: [],
    listenedAsAudiobookByUsers: [],
    playlists: [],
    progress: 0,
  };
};

/** 批量曲目映射 */
export const mapUgreenTracks = (
  list: UgreenTrack[],
  client: UgreenClient,
): Track[] => list.map((raw) => mapUgreenTrack(raw, client));

export const mapUgreenAlbum = (raw: UgreenAlbum, client: UgreenClient): Album => {
  const artist =
    (raw.singer_arr || [])
      .map((a) => a.singer_name)
      .filter(Boolean)
      .join(" / ") ||
    raw.singer_name ||
    "Unknown Artist";
  return {
    id: String(raw.album_id),
    name: raw.album_name,
    artist,
    cover: client.getCoverUrl(raw.album_cover_url),
    year: pickYear(raw.year),
    type: TrackType.MUSIC,
    likedByUsers: [],
    listenedByUsers: [],
    progress: 0,
    resumeTrackId: null,
    resumeProgress: null,
  };
};

export const mapUgreenAlbums = (
  list: UgreenAlbum[],
  client: UgreenClient,
): Album[] => list.map((raw) => mapUgreenAlbum(raw, client));

export const mapUgreenArtist = (raw: UgreenArtist): Artist => {
  return {
    id: String(raw.singer_id),
    name: raw.singer_name,
    // 绿联歌手没有头像字段，留空让端侧用默认图
    avatar: null,
    type: TrackType.MUSIC,
    bg_cover: null,
    description: null,
  };
};

export const mapUgreenArtists = (list: UgreenArtist[]): Artist[] =>
  list.map((raw) => mapUgreenArtist(raw));

export const mapUgreenPlaylist = (
  raw: UgreenPlaylist,
  client: UgreenClient,
): Playlist => {
  const createdAt = raw.create_time || ugreenSecondsToIso(raw.update_time);
  return {
    id: String(raw.songlist_id),
    name: raw.title,
    type: TrackType.MUSIC,
    createdAt,
    updatedAt: raw.update_time ? ugreenSecondsToIso(raw.update_time) : createdAt,
    userId: currentUserId(),
    cover: client.getCoverUrl(raw.cover_url),
    tracks: [],
    _count: { tracks: raw.total_num || 0 },
  } as Playlist;
};

export const mapUgreenPlaylists = (
  list: UgreenPlaylist[],
  client: UgreenClient,
): Playlist[] => list.map((raw) => mapUgreenPlaylist(raw, client));

export const mapUgreenUser = (raw: {
  uid: number;
  username: string;
  role?: string;
}): User => {
  return {
    id: String(raw.uid),
    username: raw.username,
    avatar: null,
    is_admin: raw.role === "admin",
    createdAt: new Date().toISOString(),
  };
};
