import { httpClient } from '../HarmonyHttpClient';
import { fnosAdapter, isFnosSource } from '../fnos';
import type { LoadMoreResp } from '../types';
import type { TrackDto } from './track';
import type { AlbumDto } from './album';

/**
 * 用户维度数据：收藏（likes）与播放历史（histories）。
 *
 * 后端这几个控制器都带前缀（services/api/src/controllers/）:
 *   /user-track-likes, /user-album-likes, /user-track-histories, /user-album-histories
 * userId 一律从 JWT 解析，查询参数里的 userId 会被忽略，因此这里不再传 userId。
 */

/** /user-track-likes/load-more 的元素：include track。 */
export interface TrackLikeItem {
  id: string; trackId: string; createdAt?: string; track?: TrackDto;
}

/** /user-album-likes/load-more 的元素：include album。 */
export interface AlbumLikeItem {
  id: string; albumId: string; createdAt?: string; album?: AlbumDto;
}

/** /user-track-histories/load-more 的元素：include track。 */
export interface TrackHistoryItem {
  id: string; trackId: string; listenedAt?: string; progress?: number; track?: TrackDto;
}

/** /user-album-histories/load-more 的元素：include album（含续听进度）。 */
export interface AlbumHistoryItem {
  id: string; albumId: string; listenedAt?: string; album?: AlbumDto;
}

export interface LoadMoreQuery {
  pageSize: number;
  loadCount: number;
  type?: string;
}

interface TrackLikePayload { trackId: string }
interface AlbumLikePayload { albumId: string }
interface TrackHistoryPayload { trackId: string; progress?: number }
interface AlbumHistoryPayload { albumId: string }

export interface UserDataApi {
  likeTrack(trackId: string): Promise<void>;
  unlikeTrack(trackId: string): Promise<void>;
  likedTracks(params: LoadMoreQuery): Promise<LoadMoreResp<TrackLikeItem>>;

  likeAlbum(albumId: string): Promise<void>;
  unlikeAlbum(albumId: string): Promise<void>;
  likedAlbums(params: LoadMoreQuery): Promise<LoadMoreResp<AlbumLikeItem>>;

  recordTrackPlay(trackId: string, progress?: number): Promise<void>;
  trackHistory(params: LoadMoreQuery): Promise<LoadMoreResp<TrackHistoryItem>>;
  latestTrackHistory(): Promise<TrackHistoryItem | null>;

  recordAlbumPlay(albumId: string): Promise<void>;
  albumHistory(params: LoadMoreQuery): Promise<LoadMoreResp<AlbumHistoryItem>>;
}

function loadMoreQuery(params: LoadMoreQuery): Record<string, string | number | boolean> {
  const q: Record<string, string | number | boolean> = {};
  q['pageSize'] = params.pageSize;
  q['loadCount'] = params.loadCount;
  if (params.type !== undefined && params.type.length > 0) q['type'] = params.type;
  return q;
}

/** 外部数据源（飞牛）没有专辑收藏能力，返回空列表而不是抛错 */
function emptyAlbumLikes(params: LoadMoreQuery): LoadMoreResp<AlbumLikeItem> {
  const empty: LoadMoreResp<AlbumLikeItem> = {
    pageSize: params.pageSize,
    loadCount: params.loadCount,
    total: 0,
    list: [],
  };
  return empty;
}

class UserDataApiImpl implements UserDataApi {
  // ---- track likes ----
  async likeTrack(trackId: string): Promise<void> {
    if (isFnosSource()) return fnosAdapter.likeTrack(trackId);
    const payload: TrackLikePayload = { trackId: trackId };
    return httpClient.post<void>('/user-track-likes/create', payload);
  }

  async unlikeTrack(trackId: string): Promise<void> {
    if (isFnosSource()) return fnosAdapter.unlikeTrack(trackId);
    return httpClient.del<void>(`/user-track-likes/unlike?trackId=${encodeURIComponent(trackId)}`);
  }

  async likedTracks(params: LoadMoreQuery): Promise<LoadMoreResp<TrackLikeItem>> {
    if (isFnosSource()) return fnosAdapter.favoriteTracks(params.loadCount, params.pageSize);
    return httpClient.get<LoadMoreResp<TrackLikeItem>>('/user-track-likes/load-more', loadMoreQuery(params));
  }

  // ---- album likes（飞牛没有专辑收藏，静默成功，避免页面报错） ----
  async likeAlbum(albumId: string): Promise<void> {
    if (isFnosSource()) return;
    const payload: AlbumLikePayload = { albumId: albumId };
    return httpClient.post<void>('/user-album-likes', payload);
  }

  async unlikeAlbum(albumId: string): Promise<void> {
    if (isFnosSource()) return;
    return httpClient.del<void>(`/user-album-likes/unlike?albumId=${encodeURIComponent(albumId)}`);
  }

  async likedAlbums(params: LoadMoreQuery): Promise<LoadMoreResp<AlbumLikeItem>> {
    if (isFnosSource()) return emptyAlbumLikes(params);
    return httpClient.get<LoadMoreResp<AlbumLikeItem>>('/user-album-likes/load-more', loadMoreQuery(params));
  }

  // ---- track history ----
  async recordTrackPlay(trackId: string, progress?: number): Promise<void> {
    if (isFnosSource()) return fnosAdapter.reportPlay(trackId, progress ?? 0);
    const payload: TrackHistoryPayload = { trackId: trackId, progress: progress };
    return httpClient.post<void>('/user-track-histories', payload);
  }

  async trackHistory(params: LoadMoreQuery): Promise<LoadMoreResp<TrackHistoryItem>> {
    if (isFnosSource()) return fnosAdapter.trackHistory(params.loadCount, params.pageSize);
    return httpClient.get<LoadMoreResp<TrackHistoryItem>>('/user-track-histories/load-more', loadMoreQuery(params));
  }

  async latestTrackHistory(): Promise<TrackHistoryItem | null> {
    if (isFnosSource()) return fnosAdapter.latestHistory();
    return httpClient.get<TrackHistoryItem | null>('/user-track-histories/latest');
  }

  // ---- album history（飞牛没有专辑维度历史） ----
  async recordAlbumPlay(albumId: string): Promise<void> {
    if (isFnosSource()) return;
    const payload: AlbumHistoryPayload = { albumId: albumId };
    return httpClient.post<void>('/user-album-histories', payload);
  }

  async albumHistory(params: LoadMoreQuery): Promise<LoadMoreResp<AlbumHistoryItem>> {
    if (isFnosSource()) {
      const empty: LoadMoreResp<AlbumHistoryItem> = {
        pageSize: params.pageSize,
        loadCount: params.loadCount,
        total: 0,
        list: [],
      };
      return empty;
    }
    return httpClient.get<LoadMoreResp<AlbumHistoryItem>>('/user-album-histories/load-more', loadMoreQuery(params));
  }
}

export const userDataApi: UserDataApi = new UserDataApiImpl();
