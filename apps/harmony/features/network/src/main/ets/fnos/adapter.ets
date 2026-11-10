import { Logger } from 'audiodock_common';
import type { LoadMoreResp } from '../types';
import type { TrackDto, PlaybackQualityProfile, PlaybackQualityOption } from '../api/track';
import type { AlbumDto, AlbumTracksResp } from '../api/album';
import type { ArtistDto } from '../api/artist';
import type { PlaylistDto } from '../api/playlist';
import type { TrackLikeItem, TrackHistoryItem } from '../api/userData';
import { fnosClient, FnosQuery } from './client';
import type { FnosClient } from './client';
import {
  extractLyricText, fnosSecondsToIso, mapFnosAlbums, mapFnosArtists, mapFnosPlaylists, mapFnosTracks,
} from './mapper';
import type {
  FnosAlbum, FnosArtist, FnosArtistRef, FnosEventItem, FnosEventPayload, FnosEventReportBody,
  FnosLyricPayload, FnosPage, FnosPlaylist, FnosPlaylistGuidBody, FnosPlaylistNameBody,
  FnosPlaylistTracksBody, FnosPlaylistUpdateBody, FnosTrack, FnosTrackGuidBody,
} from './types';

/** 拉全量的哨兵值（飞牛约定 size=-1 返回全部） */
const FNOS_ALL: number = -1;

/** AudioDock 用 skip + pageSize，飞牛用 page(1 起) + size */
function skipToPage(skip: number, pageSize: number): number {
  const safeSize: number = Math.max(1, pageSize);
  const safeSkip: number = Math.max(0, skip);
  return Math.floor(safeSkip / safeSize) + 1;
}

const LIST_SORT: Record<string, string> = {
  'name': 'name',
  'createdAt': 'createdAt',
  'updatedAt': 'updatedAt',
  'year': 'year',
  'trackCount': 'trackCount',
  'albumCount': 'albumCount',
};

/** 列表排序：UI 传 'name'/'createdAt' 这类语义字段，也允许直接传飞牛原生写法（'name,desc'） */
function listSortToFnos(sortBy: string, fallback: string): string {
  if (sortBy.length === 0) return fallback;
  if (sortBy.indexOf(',') >= 0) return sortBy;
  const field: string | undefined = LIST_SORT[sortBy];
  return field !== undefined ? `${field},desc` : fallback;
}

const ALBUM_TRACK_SORT: Record<string, string> = {
  'index': 'trackNo',
  'id': 'trackNo',
  'fileName': 'trackNo',
  'episodeNumber': 'trackNo',
  'fileCreatedAt': 'createdAt',
  'fileModifiedAt': 'createdAt',
  'scanOrder': 'createdAt',
};

function albumTrackSortToFnos(sortBy: string, sort: string): string {
  const field: string | undefined = sortBy.length > 0 ? ALBUM_TRACK_SORT[sortBy] : undefined;
  const resolved: string = field !== undefined ? field : 'trackNo';
  return `${resolved},${sort === 'desc' ? 'desc' : 'asc'}`;
}

/** 响应里的 total 缺失时用当前页长度兜底 */
function pageTotal<T>(page: FnosPage<T> | null): number {
  if (page === null || page === undefined) return 0;
  if (page.total !== undefined && page.total !== null) return page.total;
  return page.list !== undefined && page.list !== null ? page.list.length : 0;
}

/**
 * 飞牛音乐数据源适配器（hm 侧）。
 *
 * 方法签名刻意对齐 features_network 里 trackApi / albumApi / artistApi / playlistApi /
 * userDataApi 的读接口，这样各 API 实现只要在入口判一次数据源就能直接转调，
 * 页面调用点完全不用改。
 *
 * 只读为主：飞牛没有「新建曲目/专辑/歌手、上传封面、设备列表、播放流转」这些能力，
 * 对应方法一律返回空结果或抛可读错误，不做硬崩溃（否则整页会白掉）。
 */
export class FnosAdapter {
  private client: FnosClient;
  /** getById 的兜底缓存：列表已经映射过的 DTO 直接复用，避免为拿 path/lyrics 再打一次接口 */
  private cache: Map<string, TrackDto> = new Map<string, TrackDto>();

  constructor(client: FnosClient) {
    this.client = client;
  }

  isReady(): boolean {
    return this.client.isReady();
  }

  getClient(): FnosClient {
    return this.client;
  }

  private userId(): string {
    return this.client.userGuid.length > 0 ? this.client.userGuid : 'fnos-user';
  }

  private remember(list: TrackDto[]): TrackDto[] {
    for (let i = 0; i < list.length; i++) {
      this.cache.set(list[i].id, list[i]);
    }
    if (this.cache.size > 800) {
      // 简单裁剪：Map 保持插入序，删最早的一批
      const keys: string[] = [];
      this.cache.forEach((value: TrackDto, key: string): void => {
        keys.push(key);
      });
      const drop: number = keys.length - 600;
      for (let i = 0; i < drop; i++) this.cache.delete(keys[i]);
    }
    return list;
  }

  private mapTracks(list: FnosTrack[]): TrackDto[] {
    return this.remember(mapFnosTracks(list, this.client, this.userId()));
  }

  private paged<T>(pageSize: number, loadCount: number, list: T[], total: number): LoadMoreResp<T> {
    const resp: LoadMoreResp<T> = {
      pageSize: pageSize,
      loadCount: loadCount,
      total: total,
      list: list,
    };
    return resp;
  }

  // -------------------------------------------------------------------- 曲目

  private async fetchTracks(params: Record<string, string | number | boolean>): Promise<FnosTrack[]> {
    const page: FnosPage<FnosTrack> = await this.client.get<FnosPage<FnosTrack>>('/track/list', params);
    const list: FnosTrack[] = page === null || page === undefined ? [] : page.list;
    return list ?? [];
  }

  async trackList(): Promise<TrackDto[]> {
    const raws: FnosTrack[] = await this.fetchTracks(
      new FnosQuery().set('page', 1).set('size', 200).set('sort', 'createdAt,desc').build(),
    );
    return this.mapTracks(raws);
  }

  async trackLoadMore(pageSize: number, loadCount: number, sortBy: string): Promise<LoadMoreResp<TrackDto>> {
    const size: number = Math.max(1, pageSize);
    const skip: number = Math.max(0, loadCount);
    const page: FnosPage<FnosTrack> = await this.client.get<FnosPage<FnosTrack>>(
      '/track/list',
      new FnosQuery()
        .set('page', skipToPage(skip, size))
        .set('size', size)
        .set('sort', listSortToFnos(sortBy, 'createdAt,desc'))
        .build(),
    );
    const list: TrackDto[] = this.mapTracks(page === null || page === undefined ? [] : page.list ?? []);
    const total: number = pageTotal(page);
    return this.paged(size, skip + list.length, list, total);
  }

  /**
   * 单曲：优先用列表阶段缓存下来的 DTO。
   * 飞牛的 `/track/metadata` 文档标的是「待确认」，命中不了就走缓存，
   * 拿不到再抛错（真机上绝大多数场景是「从列表点进来」，缓存一定能命中）。
   */
  async trackById(id: string): Promise<TrackDto> {
    const hit: TrackDto | undefined = this.cache.get(id);
    if (hit !== undefined) return hit;
    try {
      const raw: FnosTrack = await this.client.get<FnosTrack>(
        '/track/metadata',
        new FnosQuery().set('guid', id).build(),
      );
      if (raw !== null && raw !== undefined && raw.guid !== undefined) {
        const mapped: TrackDto = mapFnosTracks([raw], this.client, this.userId())[0];
        this.remember([mapped]);
        return mapped;
      }
    } catch (e) {
      Logger.w('FnosAdapter', `track metadata 不可用 guid=${id}: ${String(e)}`);
    }
    throw new Error('飞牛音乐中找不到该曲目');
  }

  async trackLatest(pageSize: number): Promise<TrackDto[]> {
    const size: number = Math.max(1, pageSize);
    const raws: FnosTrack[] = await this.fetchTracks(
      new FnosQuery().set('page', 1).set('size', size).set('sort', 'createdAt,desc').build(),
    );
    return this.mapTracks(raws);
  }

  async trackSearch(keyword: string, limit: number): Promise<TrackDto[]> {
    const q: string = (keyword || '').trim();
    // 飞牛对空 q 的处理是「返回全库」，搜索框清空时不应该把曲库拉回来
    if (q.length === 0) return [];
    const size: number = Math.min(500, Math.max(1, limit));
    const page: FnosPage<FnosTrack> = await this.client.get<FnosPage<FnosTrack>>(
      '/search/track',
      new FnosQuery().set('q', q).set('page', 1).set('size', size).build(),
    );
    return this.mapTracks(page === null || page === undefined ? [] : page.list ?? []);
  }

  /** 用名字反查歌手 guid：飞牛「歌手内曲目」接口只认 guid */
  private async resolveArtistGuid(name: string): Promise<string> {
    const keyword: string = (name || '').trim();
    if (keyword.length === 0) return '';
    try {
      const page: FnosPage<FnosArtist> = await this.client.get<FnosPage<FnosArtist>>(
        '/search/artist',
        new FnosQuery().set('q', keyword).set('page', 1).set('size', 10).build(),
      );
      const list: FnosArtist[] = page === null || page === undefined ? [] : page.list ?? [];
      for (let i = 0; i < list.length; i++) {
        if (list[i].name === keyword) return list[i].guid;
      }
      return list.length > 0 ? list[0].guid : '';
    } catch (e) {
      Logger.w('FnosAdapter', `歌手名转 guid 失败 ${keyword}: ${String(e)}`);
      return '';
    }
  }

  async tracksByArtist(artist: string, skip: number, pageSize: number): Promise<LoadMoreResp<TrackDto>> {
    const guid: string = await this.resolveArtistGuid(artist);
    if (guid.length === 0) {
      // 找不到歌手实体时退化为按名字搜曲目，避免整个页面空掉
      const list: TrackDto[] = await this.trackSearch(artist, pageSize > 0 ? pageSize : 100);
      return this.paged(Math.max(1, pageSize), list.length, list, list.length);
    }
    const size: number = Math.max(1, pageSize);
    const safeSkip: number = Math.max(0, skip);
    const page: FnosPage<FnosTrack> = await this.client.get<FnosPage<FnosTrack>>(
      '/track/artist-detail/list',
      new FnosQuery()
        .set('artistGUID', guid)
        .set('page', skipToPage(safeSkip, size))
        .set('size', size)
        .set('sort', 'trackNo,asc')
        .build(),
    );
    const list: TrackDto[] = this.mapTracks(page === null || page === undefined ? [] : page.list ?? []);
    const total: number = pageTotal(page);
    return this.paged(size, safeSkip + list.length, list, total);
  }

  /** 专辑内曲目（供 albumApi.getTracks 复用） */
  async albumTracks(
    albumGuid: string,
    pageSize: number,
    skip: number,
    sort: string,
    sortBy: string,
  ): Promise<AlbumTracksResp> {
    const size: number = Math.max(1, pageSize);
    const safeSkip: number = Math.max(0, skip);
    const page: FnosPage<FnosTrack> = await this.client.get<FnosPage<FnosTrack>>(
      '/track/album-detail/list',
      new FnosQuery()
        .set('albumGUID', albumGuid)
        .set('page', skipToPage(safeSkip, size))
        .set('size', size)
        .set('sort', albumTrackSortToFnos(sortBy, sort))
        .build(),
    );
    const list: TrackDto[] = this.mapTracks(page === null || page === undefined ? [] : page.list ?? []);
    const resp: AlbumTracksResp = {
      list: list,
      total: pageTotal(page),
    };
    return resp;
  }

  async playlistTracks(playlistGuid: string, skip: number, pageSize: number): Promise<LoadMoreResp<TrackDto>> {
    const size: number = Math.max(1, pageSize);
    const safeSkip: number = Math.max(0, skip);
    const page: FnosPage<FnosTrack> = await this.client.get<FnosPage<FnosTrack>>(
      '/track/playlist-detail/list',
      new FnosQuery()
        .set('playlistGUID', playlistGuid)
        .set('page', skipToPage(safeSkip, size))
        .set('size', size)
        .build(),
    );
    const list: TrackDto[] = this.mapTracks(page === null || page === undefined ? [] : page.list ?? []);
    const total: number = pageTotal(page);
    return this.paged(size, safeSkip + list.length, list, total);
  }

  /** 音质档位：飞牛没有转码接口，只给「原音质」一项 */
  playbackQualities(): PlaybackQualityProfile {
    const option: PlaybackQualityOption = {
      quality: 'lossless',
      label: '原音质',
      codec: '',
      bitrate: '',
    };
    const profile: PlaybackQualityProfile = {
      defaultQuality: 'lossless',
      options: [option],
    };
    return profile;
  }

  streamUrl(id: string): string {
    return this.client.streamUrl(id);
  }

  /** 歌词：`/lyric/list?trackGUID=`；guid 是历史写法，仅在第一次失败时回退 */
  async lyrics(id: string): Promise<string> {
    try {
      const payload: FnosLyricPayload = await this.client.get<FnosLyricPayload>(
        '/lyric/list',
        new FnosQuery().set('trackGUID', id).build(),
      );
      return extractLyricText(payload);
    } catch (e) {
      try {
        const payload: FnosLyricPayload = await this.client.get<FnosLyricPayload>(
          '/lyric/list',
          new FnosQuery().set('guid', id).build(),
        );
        return extractLyricText(payload);
      } catch (e2) {
        return '';
      }
    }
  }

  // ---------------------------------------------------------------- 收藏/历史

  async likeTrack(id: string): Promise<void> {
    const body: FnosTrackGuidBody = { trackGUID: id };
    await this.client.post<Object>('/favorite-track/create', body);
  }

  async unlikeTrack(id: string): Promise<void> {
    const body: FnosTrackGuidBody = { trackGUID: id };
    await this.client.post<Object>('/favorite-track/delete', body);
  }

  async favoriteTracks(loadCount: number, pageSize: number): Promise<LoadMoreResp<TrackLikeItem>> {
    const size: number = Math.max(1, pageSize);
    const skip: number = Math.max(0, loadCount);
    const page: FnosPage<FnosTrack> = await this.client.get<FnosPage<FnosTrack>>(
      '/favorite-track/list',
      new FnosQuery()
        .set('page', skipToPage(skip, size))
        .set('size', size)
        .set('sort', 'favoriteAt,desc')
        .build(),
    );
    const raws: FnosTrack[] = page === null || page === undefined ? [] : page.list ?? [];
    const tracks: TrackDto[] = this.mapTracks(raws);
    const items: TrackLikeItem[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const raw: FnosTrack | undefined = raws[i];
      const createdAt: string = raw !== undefined
        ? fnosSecondsToIso(raw.updatedAt !== undefined ? raw.updatedAt : raw.createdAt)
        : new Date().toISOString();
      const item: TrackLikeItem = {
        id: `${tracks[i].id}:favorite`,
        trackId: tracks[i].id,
        createdAt: createdAt,
        track: tracks[i],
      };
      items.push(item);
    }
    const total: number = pageTotal(page);
    return this.paged(size, skip + items.length, items, total);
  }

  /** 播放上报：飞牛用 event/report 写历史，payload 复用 track_play 事件 */
  async reportPlay(trackId: string, progress: number): Promise<void> {
    try {
      const payload: FnosEventPayload = { trackGUID: trackId, progress: progress };
      const item: FnosEventItem = { eventType: 'track_play', payload: payload };
      const body: FnosEventReportBody = { events: [item] };
      await this.client.post<Object>('/event/report', body);
    } catch (e) {
      // 历史写入失败不能影响播放
      Logger.w('FnosAdapter', `上报播放历史失败: ${String(e)}`);
    }
  }

  async trackHistory(loadCount: number, pageSize: number): Promise<LoadMoreResp<TrackHistoryItem>> {
    const size: number = Math.max(1, pageSize);
    const skip: number = Math.max(0, loadCount);
    const page: FnosPage<FnosTrack> = await this.client.get<FnosPage<FnosTrack>>(
      '/play-history/list',
      new FnosQuery().set('page', skipToPage(skip, size)).set('size', size).build(),
    );
    const raws: FnosTrack[] = page === null || page === undefined ? [] : page.list ?? [];
    const tracks: TrackDto[] = this.mapTracks(raws);
    const items: TrackHistoryItem[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const raw: FnosTrack | undefined = raws[i];
      const item: TrackHistoryItem = {
        id: `${tracks[i].id}-${skip + i}`,
        trackId: tracks[i].id,
        listenedAt: raw !== undefined
          ? fnosSecondsToIso(raw.updatedAt !== undefined ? raw.updatedAt : raw.createdAt)
          : undefined,
        track: tracks[i],
      };
      items.push(item);
    }
    const total: number = pageTotal(page);
    return this.paged(size, skip + items.length, items, total);
  }

  async latestHistory(): Promise<TrackHistoryItem | null> {
    try {
      const page: FnosPage<FnosTrack> = await this.client.get<FnosPage<FnosTrack>>(
        '/play-history/list',
        new FnosQuery().set('page', 1).set('size', 1).build(),
      );
      const raws: FnosTrack[] = page === null || page === undefined ? [] : page.list ?? [];
      if (raws.length === 0) return null;
      const tracks: TrackDto[] = this.mapTracks(raws);
      const item: TrackHistoryItem = {
        id: `${tracks[0].id}-latest`,
        trackId: tracks[0].id,
        listenedAt: fnosSecondsToIso(raws[0].updatedAt !== undefined ? raws[0].updatedAt : raws[0].createdAt),
        track: tracks[0],
      };
      return item;
    } catch (e) {
      Logger.w('FnosAdapter', `获取最近播放失败: ${String(e)}`);
      return null;
    }
  }

  // -------------------------------------------------------------------- 专辑

  async albumLoadMore(pageSize: number, loadCount: number, sortBy: string): Promise<LoadMoreResp<AlbumDto>> {
    const size: number = Math.max(1, pageSize);
    const skip: number = Math.max(0, loadCount);
    const page: FnosPage<FnosAlbum> = await this.client.get<FnosPage<FnosAlbum>>(
      '/album/list',
      new FnosQuery()
        .set('page', skipToPage(skip, size))
        .set('size', size)
        .set('sort', listSortToFnos(sortBy, 'createdAt,desc'))
        .build(),
    );
    const raws: FnosAlbum[] = page === null || page === undefined ? [] : page.list ?? [];
    const list: AlbumDto[] = mapFnosAlbums(raws, this.client);
    const total: number = pageTotal(page);
    return this.paged(size, skip + list.length, list, total);
  }

  async albumList(): Promise<AlbumDto[]> {
    const page: FnosPage<FnosAlbum> = await this.client.get<FnosPage<FnosAlbum>>(
      '/album/list',
      new FnosQuery().set('page', 1).set('size', 100).set('sort', 'createdAt,desc').build(),
    );
    const raws: FnosAlbum[] = page === null || page === undefined ? [] : page.list ?? [];
    return mapFnosAlbums(raws, this.client);
  }

  async albumById(id: string): Promise<AlbumDto> {
    const raw: FnosAlbum = await this.client.get<FnosAlbum>(
      '/album/detail',
      new FnosQuery().set('guid', id).build(),
    );
    const list: AlbumDto[] = mapFnosAlbums(raw !== null && raw !== undefined ? [raw] : [], this.client);
    if (list.length === 0) throw new Error('飞牛音乐中找不到该专辑');
    return list[0];
  }

  /**
   * 飞牛没有「按歌手取专辑」的一等接口，用搜索兜底：
   * 搜专辑名 → 过滤 artists 里包含该歌手的结果。
   */
  async albumsByArtist(artist: string): Promise<AlbumDto[]> {
    const keyword: string = (artist || '').trim();
    if (keyword.length === 0) return [];
    const guid: string = await this.resolveArtistGuid(keyword);
    let raws: FnosAlbum[] = [];
    try {
      const page: FnosPage<FnosAlbum> = await this.client.get<FnosPage<FnosAlbum>>(
        '/search/album',
        new FnosQuery().set('q', keyword).set('page', 1).set('size', 100).build(),
      );
      raws = page === null || page === undefined ? [] : page.list ?? [];
    } catch (e) {
      raws = [];
    }
    const filtered: FnosAlbum[] = [];
    for (let i = 0; i < raws.length; i++) {
      const artists: FnosArtistRef[] = raws[i].artists ?? [];
      let matched: boolean = false;
      for (let j = 0; j < artists.length; j++) {
        if (guid.length > 0 ? artists[j].guid === guid : artists[j].name === keyword) {
          matched = true;
          break;
        }
      }
      if (matched) filtered.push(raws[i]);
    }
    return mapFnosAlbums(filtered, this.client);
  }

  async albumLatest(pageSize: number): Promise<AlbumDto[]> {
    const size: number = Math.max(1, pageSize);
    const page: FnosPage<FnosAlbum> = await this.client.get<FnosPage<FnosAlbum>>(
      '/album/list',
      new FnosQuery().set('page', 1).set('size', size).set('sort', 'createdAt,desc').build(),
    );
    const raws: FnosAlbum[] = page === null || page === undefined ? [] : page.list ?? [];
    return mapFnosAlbums(raws, this.client);
  }

  async albumSearch(keyword: string, limit: number): Promise<AlbumDto[]> {
    const q: string = (keyword || '').trim();
    if (q.length === 0) return [];
    const page: FnosPage<FnosAlbum> = await this.client.get<FnosPage<FnosAlbum>>(
      '/search/album',
      new FnosQuery().set('q', q).set('page', 1).set('size', Math.min(500, Math.max(1, limit))).build(),
    );
    const raws: FnosAlbum[] = page === null || page === undefined ? [] : page.list ?? [];
    return mapFnosAlbums(raws, this.client);
  }

  // -------------------------------------------------------------------- 歌手

  async artistLoadMore(pageSize: number, loadCount: number, sortBy: string): Promise<LoadMoreResp<ArtistDto>> {
    const size: number = Math.max(1, pageSize);
    const skip: number = Math.max(0, loadCount);
    const page: FnosPage<FnosArtist> = await this.client.get<FnosPage<FnosArtist>>(
      '/artist/list',
      new FnosQuery()
        .set('page', skipToPage(skip, size))
        .set('size', size)
        .set('sort', listSortToFnos(sortBy, 'name,asc'))
        .build(),
    );
    const raws: FnosArtist[] = page === null || page === undefined ? [] : page.list ?? [];
    const list: ArtistDto[] = mapFnosArtists(raws, this.client);
    const total: number = pageTotal(page);
    return this.paged(size, skip + list.length, list, total);
  }

  async artistList(): Promise<ArtistDto[]> {
    const page: FnosPage<FnosArtist> = await this.client.get<FnosPage<FnosArtist>>(
      '/artist/list',
      new FnosQuery().set('page', 1).set('size', FNOS_ALL).set('sort', 'name,asc').build(),
    );
    const raws: FnosArtist[] = page === null || page === undefined ? [] : page.list ?? [];
    return mapFnosArtists(raws, this.client);
  }

  async artistById(id: string): Promise<ArtistDto> {
    const raw: FnosArtist = await this.client.get<FnosArtist>(
      '/artist/detail',
      new FnosQuery().set('guid', id).build(),
    );
    const list: ArtistDto[] = mapFnosArtists(raw !== null && raw !== undefined ? [raw] : [], this.client);
    if (list.length === 0) throw new Error('飞牛音乐中找不到该歌手');
    return list[0];
  }

  async artistLatest(pageSize: number): Promise<ArtistDto[]> {
    const size: number = pageSize > 0 ? pageSize : FNOS_ALL;
    const page: FnosPage<FnosArtist> = await this.client.get<FnosPage<FnosArtist>>(
      '/artist/list',
      new FnosQuery().set('page', 1).set('size', size).set('sort', 'name,asc').build(),
    );
    const raws: FnosArtist[] = page === null || page === undefined ? [] : page.list ?? [];
    return mapFnosArtists(raws, this.client);
  }

  async artistSearch(keyword: string, limit: number): Promise<ArtistDto[]> {
    const q: string = (keyword || '').trim();
    if (q.length === 0) return [];
    const page: FnosPage<FnosArtist> = await this.client.get<FnosPage<FnosArtist>>(
      '/search/artist',
      new FnosQuery().set('q', q).set('page', 1).set('size', Math.min(500, Math.max(1, limit))).build(),
    );
    const raws: FnosArtist[] = page === null || page === undefined ? [] : page.list ?? [];
    return mapFnosArtists(raws, this.client);
  }

  // -------------------------------------------------------------------- 歌单

  async playlists(): Promise<PlaylistDto[]> {
    const page: FnosPage<FnosPlaylist> = await this.client.get<FnosPage<FnosPlaylist>>(
      '/playlist/list',
      new FnosQuery().set('page', 1).set('size', FNOS_ALL).build(),
    );
    const raws: FnosPlaylist[] = page === null || page === undefined ? [] : page.list ?? [];
    return mapFnosPlaylists(raws, this.userId());
  }

  async playlistById(id: string): Promise<PlaylistDto> {
    const raw: FnosPlaylist = await this.client.get<FnosPlaylist>(
      '/playlist/detail',
      new FnosQuery().set('guid', id).build(),
    );
    const list: PlaylistDto[] = mapFnosPlaylists(raw !== null && raw !== undefined ? [raw] : [], this.userId());
    if (list.length === 0) throw new Error('飞牛音乐中找不到该歌单');
    return list[0];
  }

  async createPlaylist(name: string): Promise<PlaylistDto> {
    const body: FnosPlaylistNameBody = { name: name };
    await this.client.post<Object>('/playlist/create', body);
    const list: PlaylistDto[] = await this.playlists();
    for (let i = 0; i < list.length; i++) {
      if (list[i].name === name) return list[i];
    }
    const fallback: PlaylistDto = {
      id: `pending-${Date.now()}`,
      name: name,
      type: 'MUSIC',
      createdAt: new Date().toISOString(),
      _count: { tracks: 0 },
      trackCount: 0,
    };
    return fallback;
  }

  async renamePlaylist(id: string, name: string): Promise<PlaylistDto> {
    const body: FnosPlaylistUpdateBody = { guid: id, name: name };
    await this.client.post<Object>('/playlist/update', body);
    return this.playlistById(id);
  }

  async removePlaylist(id: string): Promise<void> {
    const body: FnosPlaylistGuidBody = { guid: id };
    await this.client.post<Object>('/playlist/delete', body);
  }

  async addTracks(playlistId: string, trackIds: string[]): Promise<void> {
    const body: FnosPlaylistTracksBody = {
      guid: playlistId,
      trackGUIDs: trackIds,
    };
    await this.client.post<Object>('/playlist/add-track', body);
  }

  async removeTrack(playlistId: string, trackId: string): Promise<void> {
    const body: FnosPlaylistTracksBody = {
      guid: playlistId,
      trackGUIDs: [trackId],
    };
    await this.client.post<Object>('/playlist/remove-track', body);
  }
}

/** 全局单例 */
export const fnosAdapter: FnosAdapter = new FnosAdapter(fnosClient);
