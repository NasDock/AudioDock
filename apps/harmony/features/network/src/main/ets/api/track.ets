import { httpClient } from '../HarmonyHttpClient';
import type { LoadMoreResp } from '../types';

/**
 * 字段名对齐后端 Prisma model Track（packages/db/prisma/schema.prisma）:
 * id / name / artist / album / cover / duration / index / type。
 * 后端不返回 title / coverUrl / trackNumber。
 */
export interface TrackDto {
  id: string; name: string; artist?: string; album?: string;
  duration?: number; cover?: string; ext?: string;
  source?: string; index?: number; type?: string;
  lyrics?: string;
  /** 外部源曲目是 http(s) 直链；本地曲目是服务器上的相对/绝对文件路径 */
  path?: string;
  likedByUsers?: LikedByUser[];
}

export interface LikedByUser { userId: string }

/**
 * 音质档位（对齐后端 TrackPlaybackQualityOption + 其他端 AudioQualityOption）。
 * 后端 GET /track/:id/playback-qualities 返回 { defaultQuality, options }。
 */
export interface PlaybackQualityOption { quality: string; label: string; codec: string; bitrate: string }

export interface PlaybackQualityProfile { defaultQuality: string; options: PlaybackQualityOption[] }

/** 注意：后端 track 的分页在裸路由 `/load-more` 上（@Controller() 空前缀）。 */
export interface TrackLoadMoreParams {
  pageSize: number;
  loadCount: number;
  type?: string;
  sortBy?: string;
}

export interface TrackSearchParams {
  keyword: string;
  type?: string;
  limit?: number;
}

export interface TrackLatestParams {
  type?: string;
  random?: boolean;
  pageSize?: number;
}

export interface TrackApi {
  list(): Promise<TrackDto[]>;
  loadMore(params: TrackLoadMoreParams): Promise<LoadMoreResp<TrackDto>>;
  getById(id: string): Promise<TrackDto>;
  /** GET /track/artist?artist= —— 按艺人「名字」查，不是 id。 */
  byArtist(artist: string): Promise<TrackDto[]>;
  search(params: TrackSearchParams): Promise<TrackDto[]>;
  latest(params: TrackLatestParams): Promise<TrackDto[]>;
  recommend(params: TrackLatestParams): Promise<TrackDto[]>;
  playbackQualities(id: string): Promise<PlaybackQualityProfile>;
  streamUrl(id: string, quality: string): string;
}

class TrackApiImpl implements TrackApi {
  async list(): Promise<TrackDto[]> {
    return httpClient.get<TrackDto[]>('/track/list');
  }

  async loadMore(params: TrackLoadMoreParams): Promise<LoadMoreResp<TrackDto>> {
    const q: Record<string, string | number | boolean> = {};
    q['pageSize'] = params.pageSize;
    q['loadCount'] = params.loadCount;
    if (params.type !== undefined) q['type'] = params.type;
    if (params.sortBy !== undefined) q['sortBy'] = params.sortBy;
    return httpClient.get<LoadMoreResp<TrackDto>>('/load-more', q);
  }

  async getById(id: string): Promise<TrackDto> {
    return httpClient.get<TrackDto>(`/track/${id}`);
  }

  async byArtist(artist: string): Promise<TrackDto[]> {
    const q: Record<string, string | number | boolean> = {};
    q['artist'] = artist;
    return httpClient.get<TrackDto[]>('/track/artist', q);
  }

  async search(params: TrackSearchParams): Promise<TrackDto[]> {
    const q: Record<string, string | number | boolean> = {};
    q['keyword'] = params.keyword;
    if (params.type !== undefined) q['type'] = params.type;
    if (params.limit !== undefined) q['limit'] = params.limit;
    return httpClient.get<TrackDto[]>('/track/search', q);
  }

  async latest(params: TrackLatestParams): Promise<TrackDto[]> {
    const q: Record<string, string | number | boolean> = {};
    if (params.type !== undefined) q['type'] = params.type;
    if (params.random !== undefined) q['random'] = params.random;
    if (params.pageSize !== undefined) q['pageSize'] = params.pageSize;
    return httpClient.get<TrackDto[]>('/track/latest', q);
  }

  async recommend(params: TrackLatestParams): Promise<TrackDto[]> {
    const q: Record<string, string | number | boolean> = {};
    if (params.type !== undefined) q['type'] = params.type;
    if (params.pageSize !== undefined) q['pageSize'] = params.pageSize;
    return httpClient.get<TrackDto[]>('/track/recommend', q);
  }

  async playbackQualities(id: string): Promise<PlaybackQualityProfile> {
    return httpClient.get<PlaybackQualityProfile>(`/track/${id}/playback-qualities`);
  }

  streamUrl(id: string, quality: string): string {
    const base = httpClient.getBaseURL();
    return `${base}/track/stream/${id}?quality=${encodeURIComponent(quality)}`;
  }
}

export const trackApi: TrackApi = new TrackApiImpl();
