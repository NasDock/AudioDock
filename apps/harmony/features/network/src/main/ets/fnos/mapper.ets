import type { TrackDto, LikedByUser } from '../api/track';
import type { AlbumDto } from '../api/album';
import type { ArtistDto } from '../api/artist';
import type { PlaylistDto } from '../api/playlist';
import type {
  FnosAlbum, FnosArtist, FnosTrack, FnosPlaylist, FnosArtistRef, FnosCoverResolver,
  FnosLyricPayload, FnosLyricItem,
} from './types';

/**
 * 飞牛 VO → hm DTO 的映射。
 *
 * 对齐 desktop 的 packages/services/src/adapter/fnos/mapper.ts，差异：
 * - AudioDock 的 Track 模型在 hm 侧叫 TrackDto（字段 name/cover/path，没有 artistEntity 等嵌套）；
 * - 封面与音频流地址由 FnosClient 直接拼绝对地址（不需要签名时是字符串拼接，同步即可）。
 */

/** 飞牛时间戳是秒，统一转成 ISO 字符串 */
export function fnosSecondsToIso(value?: number): string {
  if (value === undefined || value === null || value === 0) {
    return new Date().toISOString();
  }
  // 兼容误传毫秒的情况
  const ms: number = value > 1e12 ? value : value * 1000;
  return new Date(ms).toISOString();
}

/** 飞牛 duration 是毫秒，AudioDock 用秒 */
export function fnosDurationToSeconds(ms?: number): number {
  if (ms === undefined || ms === null || ms <= 0) return 0;
  return Math.round(ms / 1000);
}

const COVER_PREFIX: RegExp = /^[a-z]+_/i;

/**
 * 有效的封面 ID 形如 `track_<hex>` / `album_<hex>` / `artist_<hex>`。
 *
 * 部分接口（如歌单详情）会把裸的 32 位 hex（其实是曲目 GUID）塞进 coverId，
 * `/static/cover` 对它会返回 400，必须丢掉 —— 规则来自 fn-music-player 的 cleanCover。
 */
export function cleanFnosCoverId(value?: string): string {
  const text: string = (value === undefined || value === null ? '' : value).trim();
  return COVER_PREFIX.test(text) ? text : '';
}

function artistNames(track: FnosTrack): string {
  const names: string[] = [];
  const artists: FnosArtistRef[] = track.artists === undefined ? [] : track.artists;
  for (let i = 0; i < artists.length; i++) {
    if (artists[i].name !== undefined && artists[i].name.length > 0) names.push(artists[i].name);
  }
  if (names.length > 0) return names.join(' / ');
  const album = track.album;
  if (album !== undefined && album !== null && album.artists !== undefined) {
    const albumNames: string[] = [];
    for (let i = 0; i < album.artists.length; i++) {
      if (album.artists[i].name !== undefined && album.artists[i].name.length > 0) {
        albumNames.push(album.artists[i].name);
      }
    }
    if (albumNames.length > 0) return albumNames.join(' / ');
  }
  return 'Unknown Artist';
}

function pickYear(releaseDate?: string): string {
  if (releaseDate === undefined || releaseDate === null || releaseDate.length === 0) return '';
  const matched: RegExpMatchArray | null = releaseDate.match(/\d{4}/);
  if (matched !== null) return matched[0];
  return releaseDate;
}

/** 封面地址：拿到干净的 coverId 才拼，否则留空让 UI 走占位图 */
export function resolveCover(client: FnosCoverResolver, coverId: string | undefined, size: number): string {
  const clean: string = cleanFnosCoverId(coverId);
  if (clean.length === 0) return '';
  return client.coverUrl(clean, size);
}

/** 批量曲目映射（封面/音频地址是同步拼接，无需并发） */
export function mapFnosTracks(list: FnosTrack[], client: FnosCoverResolver, userId: string): TrackDto[] {
  const out: TrackDto[] = [];
  for (let i = 0; i < list.length; i++) {
    out.push(mapFnosTrack(list[i], client, userId, ''));
  }
  return out;
}

export function mapFnosTrack(
  raw: FnosTrack,
  client: FnosCoverResolver,
  userId: string,
  lyrics: string,
): TrackDto {
  const artist: string = artistNames(raw);
  const album = raw.album;
  const albumName: string = album !== undefined && album !== null && album.name !== undefined
    ? album.name : 'Unknown Album';

  const liked: LikedByUser[] = [];
  if (raw.isFavorite === true) {
    const item: LikedByUser = { userId: userId };
    liked.push(item);
  }

  const duration: number = raw.duration !== undefined
    ? fnosDurationToSeconds(raw.duration)
    : fnosDurationToSeconds(raw.audioSpec !== undefined ? raw.audioSpec.duration : undefined);

  const dto: TrackDto = {
    id: raw.guid,
    name: raw.title,
    artist: artist,
    album: albumName,
    cover: resolveCover(client, raw.coverId, 300),
    path: client.streamUrl(raw.guid),
    duration: duration,
    index: raw.trackNo,
    type: 'MUSIC',
    lyrics: lyrics.length > 0 ? lyrics : undefined,
    likedByUsers: liked,
  };
  return dto;
}

export function mapFnosAlbum(raw: FnosAlbum, client: FnosCoverResolver): AlbumDto {
  const names: string[] = [];
  const artists: FnosArtistRef[] = raw.artists === undefined ? [] : raw.artists;
  for (let i = 0; i < artists.length; i++) {
    if (artists[i].name !== undefined && artists[i].name.length > 0) names.push(artists[i].name);
  }
  const dto: AlbumDto = {
    id: raw.guid,
    name: raw.name,
    artist: names.length > 0 ? names.join(' / ') : 'Unknown Artist',
    cover: resolveCover(client, raw.coverId, 300),
    year: pickYear(raw.releaseDate),
    type: 'MUSIC',
    trackCount: raw.trackCount,
  };
  return dto;
}

export function mapFnosAlbums(list: FnosAlbum[], client: FnosCoverResolver): AlbumDto[] {
  const out: AlbumDto[] = [];
  for (let i = 0; i < list.length; i++) out.push(mapFnosAlbum(list[i], client));
  return out;
}

export function mapFnosArtist(raw: FnosArtist, client: FnosCoverResolver): ArtistDto {
  const dto: ArtistDto = {
    id: raw.guid,
    name: raw.name,
    avatar: resolveCover(client, raw.coverId, 300),
    type: 'MUSIC',
  };
  return dto;
}

export function mapFnosArtists(list: FnosArtist[], client: FnosCoverResolver): ArtistDto[] {
  const out: ArtistDto[] = [];
  for (let i = 0; i < list.length; i++) out.push(mapFnosArtist(list[i], client));
  return out;
}

export function mapFnosPlaylist(raw: FnosPlaylist, userId: string): PlaylistDto {
  const count: number = raw.trackCount === undefined ? 0 : raw.trackCount;
  const dto: PlaylistDto = {
    id: raw.guid,
    name: raw.name,
    type: 'MUSIC',
    createdAt: fnosSecondsToIso(raw.createdAt),
    _count: { tracks: count },
    trackCount: count,
  };
  return dto;
}

export function mapFnosPlaylists(list: FnosPlaylist[], userId: string): PlaylistDto[] {
  const out: PlaylistDto[] = [];
  for (let i = 0; i < list.length; i++) out.push(mapFnosPlaylist(list[i], userId));
  return out;
}

/**
 * 歌词接口（`GET /lyric/list?trackGUID=<guid>`）实测返回：
 *
 * ```json
 * { "list": [{ "guid": "...", "content": "[00:15.21]...", "isLRC": true }],
 *   "preferred": "<guid>" }
 * ```
 *
 * 一首歌可能挂多份歌词（不同来源/翻译），`preferred` 指官方选中的那份；
 * 拿不到 `preferred` 时退回第一份非空内容。
 */
export function extractLyricText(payload: FnosLyricPayload): string {
  const preferred: string = payload.preferred === undefined ? '' : payload.preferred;
  const list: FnosLyricItem[] = payload.list === undefined ? [] : payload.list;
  if (list.length > 0) {
    if (preferred.length > 0) {
      for (let i = 0; i < list.length; i++) {
        const item: FnosLyricItem = list[i];
        if (item.guid === preferred) {
          const text: string = pickLyric(item);
          if (text.length > 0) return text;
        }
      }
    }
    for (let i = 0; i < list.length; i++) {
      const text: string = pickLyric(list[i]);
      if (text.length > 0) return text;
    }
  }
  // 历史形态：纯字符串 / { content } / { lyric }
  if (payload.content !== undefined && payload.content.trim().length > 0) return payload.content;
  if (payload.lyric !== undefined && payload.lyric.trim().length > 0) return payload.lyric;
  return '';
}

function pickLyric(item: FnosLyricItem): string {
  if (item.content !== undefined && item.content.trim().length > 0) return item.content;
  if (item.lyric !== undefined && item.lyric.trim().length > 0) return item.lyric;
  return '';
}
