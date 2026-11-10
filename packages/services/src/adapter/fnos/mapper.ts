import { getServiceConfig } from "../../config";
import { Album, Artist, Playlist, Track, TrackType, User } from "../../models";
import type { FnosClient } from "./client";
import type {
  FnosAlbum,
  FnosArtist,
  FnosPlaylist,
  FnosTrack,
  FnosUser,
} from "./types";

/** 飞牛时间戳是秒，统一转成 ISO 字符串（AudioDock 侧 Date 字段） */
export const fnosSecondsToIso = (value?: number | null): string => {
  if (!value) return new Date().toISOString();
  // 兼容误传毫秒的情况
  const ms = value > 1e12 ? value : value * 1000;
  return new Date(ms).toISOString();
};

/** 飞牛 duration 是毫秒，AudioDock 用秒 */
export const fnosDurationToSeconds = (ms?: number | null): number => {
  if (!ms || ms <= 0) return 0;
  return Math.round(ms / 1000);
};

/** 当前登录用户在飞牛的 guid（登录后写入 config.userId） */
const currentUserGuid = (): string => String(getServiceConfig().userId || "fnos-user");

const artistNames = (track: FnosTrack): string => {
  const names = (track.artists || []).map((a) => a.name).filter(Boolean);
  if (names.length) return names.join(" / ");
  return track.album?.artists?.map((a) => a.name).filter(Boolean).join(" / ") || "Unknown Artist";
};

const pickYear = (releaseDate?: string | null): string | null => {
  if (!releaseDate) return null;
  const matched = String(releaseDate).match(/\d{4}/);
  return matched ? matched[0] : String(releaseDate);
};

/**
 * 有效的封面 ID 形如 `track_<hex>` / `album_<hex>` / `artist_<hex>`。
 *
 * 部分接口（如歌单详情）会把裸的 32 位 hex（其实是曲目 GUID）塞进 coverId，
 * `/static/cover` 对它会返回 400，必须丢掉 —— 规则来自 fn-music-player 的 cleanCover。
 */
export const cleanFnosCoverId = (value?: string | null): string | null => {
  const text = String(value ?? "").trim();
  return /^[a-z]+_/i.test(text) ? text : null;
};

/**
 * 曲目映射。
 *
 * 注意两点：
 * 1. 封面/音频地址需要签名，所以这里是 async；批量时由调用方并发处理。
 * 2. `audioSpec.path` 是 NAS 绝对路径，不下发。
 */
export const mapFnosTrack = async (
  raw: FnosTrack,
  client: FnosClient,
  options?: { lyrics?: string | null },
): Promise<Track> => {
  const artist = artistNames(raw);
  const artistEntityRaw = raw.artists?.[0] || raw.album?.artists?.[0];
  const album = raw.album || undefined;
  const [cover, streamUrl, albumCover] = await Promise.all([
    client.getCoverUrl(cleanFnosCoverId(raw.coverId)),
    client.getStreamUrl(raw.guid),
    client.getCoverUrl(cleanFnosCoverId(album?.coverId)),
  ]);

  const userId = currentUserGuid();
  const likedByUsers = raw.isFavorite
    ? [
        {
          id: `${raw.guid}:favorite`,
          userId,
          trackId: raw.guid,
          createdAt: fnosSecondsToIso(raw.updatedAt || raw.createdAt),
        },
      ]
    : [];

  return {
    id: raw.guid,
    name: raw.title,
    path: streamUrl,
    artist,
    artistEntity: {
      id: artistEntityRaw?.guid || "",
      name: artistEntityRaw?.name || artist,
      avatar: null,
      type: TrackType.MUSIC,
    },
    album: album?.name || "Unknown Album",
    albumEntity: {
      id: album?.guid || "",
      name: album?.name || "Unknown Album",
      artist,
      cover: albumCover,
      year: pickYear(album?.releaseDate),
      type: TrackType.MUSIC,
    },
    cover,
    duration: fnosDurationToSeconds(raw.duration ?? raw.audioSpec?.duration),
    lyrics: options?.lyrics ?? null,
    index: raw.trackNo ?? null,
    type: TrackType.MUSIC,
    createdAt: fnosSecondsToIso(raw.createdAt),
    artistId: artistEntityRaw?.guid || undefined,
    albumId: album?.guid || undefined,
    likedByUsers,
    listenedByUsers: [],
    likedAsAudiobookByUsers: [],
    listenedAsAudiobookByUsers: [],
    playlists: [],
    progress: 0,
  };
};

/** 批量曲目映射（并发解析封面/音频地址） */
export const mapFnosTracks = async (
  list: FnosTrack[],
  client: FnosClient,
  options?: { withLyrics?: boolean },
): Promise<Track[]> => {
  return Promise.all(
    list.map(async (raw) => {
      let lyrics: string | null = null;
      if (options?.withLyrics) {
        try {
          lyrics = await client.get<unknown>("/lyric/list", { trackGUID: raw.guid }).then((res) =>
            extractLyricText(res),
          );
        } catch {
          lyrics = null;
        }
      }
      return mapFnosTrack(raw, client, { lyrics });
    }),
  );
};

export const mapFnosAlbum = async (
  raw: FnosAlbum,
  client: FnosClient,
): Promise<Album> => {
  const cover = await client.getCoverUrl(cleanFnosCoverId(raw.coverId));
  return {
    id: raw.guid,
    name: raw.name,
    artist:
      raw.artists
        ?.map((a) => a.name)
        .filter(Boolean)
        .join(" / ") || "Unknown Artist",
    cover,
    year: pickYear(raw.releaseDate),
    type: TrackType.MUSIC,
    likedByUsers: [],
    listenedByUsers: [],
    progress: 0,
    resumeTrackId: null,
    resumeProgress: null,
  };
};

export const mapFnosAlbums = async (
  list: FnosAlbum[],
  client: FnosClient,
): Promise<Album[]> => Promise.all(list.map((raw) => mapFnosAlbum(raw, client)));

export const mapFnosArtist = async (
  raw: FnosArtist,
  client: FnosClient,
): Promise<Artist> => {
  const avatar = await client.getCoverUrl(cleanFnosCoverId(raw.coverId));
  return {
    id: raw.guid,
    name: raw.name,
    avatar,
    type: TrackType.MUSIC,
    bg_cover: null,
    description: null,
  };
};

export const mapFnosArtists = async (
  list: FnosArtist[],
  client: FnosClient,
): Promise<Artist[]> => Promise.all(list.map((raw) => mapFnosArtist(raw, client)));

export const mapFnosPlaylist = async (
  raw: FnosPlaylist,
  client: FnosClient,
): Promise<Playlist> => {
  const userId = currentUserGuid();
  return {
    id: raw.guid,
    name: raw.name,
    type: TrackType.MUSIC,
    createdAt: fnosSecondsToIso(raw.createdAt),
    updatedAt: fnosSecondsToIso(raw.updatedAt || raw.createdAt),
    userId,
    tracks: [],
    _count: { tracks: raw.trackCount || 0 },
  };
};

export const mapFnosPlaylists = async (
  list: FnosPlaylist[],
  client: FnosClient,
): Promise<Playlist[]> => Promise.all(list.map((raw) => mapFnosPlaylist(raw, client)));

export const mapFnosUser = (raw: FnosUser): User => {
  return {
    id: raw.guid,
    username: raw.name,
    avatar: null,
    is_admin: raw.role === "admin",
    createdAt: fnosSecondsToIso(raw.createdAt),
  };
};

/**
 * 歌词接口（`GET /lyric/list?trackGUID=<guid>`）实测返回：
 *
 * ```json
 * { "list": [{ "guid": "...", "source": 1, "content": "[00:15.21]...", "isLRC": true }],
 *   "preferred": "<guid>" }
 * ```
 *
 * 一首歌可能挂多份歌词（不同来源/翻译），`preferred` 指官方选中的那份；
 * 拿不到 `preferred` 时退回第一份非空内容。历史上返回过纯字符串与
 * `{ content }` 两种形态，一并兼容。
 */
export const extractLyricText = (payload: unknown): string | null => {
  if (!payload) return null;
  if (typeof payload === "string") return payload.trim() ? payload : null;
  if (typeof payload !== "object") return null;

  const record = payload as Record<string, any>;
  const pick = (item: any): string | null => {
    if (typeof item === "string") return item.trim() ? item : null;
    if (!item || typeof item !== "object") return null;
    if (typeof item.content === "string" && item.content.trim()) return item.content;
    if (typeof item.lyric === "string" && item.lyric.trim()) return item.lyric;
    return null;
  };

  if (Array.isArray(record.list) && record.list.length > 0) {
    const preferred = typeof record.preferred === "string" ? record.preferred : "";
    const chosen = preferred
      ? record.list.find((item: any) => item && item.guid === preferred)
      : null;
    const text = pick(chosen) ?? record.list.map(pick).find(Boolean) ?? null;
    if (text) return text;
  }

  return pick(record);
};
