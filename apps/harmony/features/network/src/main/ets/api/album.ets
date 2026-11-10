import { common } from '@kit.AbilityKit';
import request from '@ohos.request';
import { httpClient } from '../HarmonyHttpClient';
import { fnosAdapter, isFnosSource } from '../fnos';
import type { LoadMoreResp } from '../types';
import type { TrackDto } from './track';

/**
 * 字段名对齐后端 Prisma model Album（packages/db/prisma/schema.prisma）:
 * id / name / artist / cover / year / type。
 * 后端不返回 coverUrl / releaseDate / description / trackCount。
 * progress 等字段仅在带 userId 的 load-more 响应里出现。
 */
export interface AlbumDto {
  id: string; name: string; artist?: string; cover?: string;
  year?: string; type?: string; description?: string; trackCount?: number;
  progress?: number; resumeTrackId?: string; resumeProgress?: number;
}

/**
 * GET /album/{id}/tracks 的返回形状（services/api/src/controllers/album.ts:425）。
 */
export interface AlbumTracksResp { list: TrackDto[]; total: number }

export interface AlbumListResp { data: AlbumDto[]; total: number }

export interface AlbumLoadMoreParams {
  pageSize: number;
  loadCount: number;
  type: string;
  sortBy?: string;
}

export interface AlbumLatestParams {
  type: string;
  pageSize?: number;
  random?: boolean;
}

export interface AlbumRecommendParams {
  type: string;
  pageSize?: number;
  likeRatio?: number;
}

export interface AlbumApi {
  list(): Promise<AlbumDto[]>;
  loadMore(params: AlbumLoadMoreParams): Promise<LoadMoreResp<AlbumDto>>;
  /** GET /album/{id} 只返回专辑本身，不含 tracks —— 曲目要另调 getTracks。 */
  getById(id: string): Promise<AlbumDto>;
  getTracks(id: string, pageSize: number, skip: number, sort: string, sortBy?: string): Promise<AlbumTracksResp>;
  byArtist(artist: string): Promise<AlbumDto[]>;
  collaborativeByArtist(artist: string): Promise<AlbumDto[]>;
  latest(params: AlbumLatestParams): Promise<AlbumDto[]>;
  recommend(params: AlbumRecommendParams): Promise<AlbumDto[]>;
  search(keyword: string, limit: number): Promise<AlbumDto[]>;
  /** POST /album/{id}/cover 上传专辑封面，返回更新后的专辑。 */
  uploadCover(id: string, fileUri: string, mimeType?: string): Promise<AlbumDto>;
}

class AlbumApiImpl implements AlbumApi {
  async list(): Promise<AlbumDto[]> {
    if (isFnosSource()) return fnosAdapter.albumList();
    return httpClient.get<AlbumDto[]>('/album/list');
  }

  async loadMore(params: AlbumLoadMoreParams): Promise<LoadMoreResp<AlbumDto>> {
    if (isFnosSource()) {
      return fnosAdapter.albumLoadMore(params.pageSize, params.loadCount, params.sortBy ?? '');
    }
    const q: Record<string, string | number | boolean> = {};
    q['pageSize'] = params.pageSize;
    q['loadCount'] = params.loadCount;
    q['type'] = params.type;
    if (params.sortBy !== undefined) q['sortBy'] = params.sortBy;
    return httpClient.get<LoadMoreResp<AlbumDto>>('/album/load-more', q);
  }

  async getById(id: string): Promise<AlbumDto> {
    if (isFnosSource()) return fnosAdapter.albumById(id);
    return httpClient.get<AlbumDto>(`/album/${id}`);
  }

  async getTracks(id: string, pageSize: number, skip: number, sort: string, sortBy?: string): Promise<AlbumTracksResp> {
    if (isFnosSource()) {
      return fnosAdapter.albumTracks(id, pageSize, skip, sort, sortBy ?? '');
    }
    const q: Record<string, string | number | boolean> = {};
    q['pageSize'] = pageSize;
    q['skip'] = skip;
    q['sort'] = sort;
    if (sortBy !== undefined) q['sortBy'] = sortBy;
    return httpClient.get<AlbumTracksResp>(`/album/${id}/tracks`, q);
  }

  async byArtist(artist: string): Promise<AlbumDto[]> {
    if (isFnosSource()) return fnosAdapter.albumsByArtist(artist);
    return httpClient.get<AlbumDto[]>(`/album/artist/${encodeURIComponent(artist)}`);
  }

  async collaborativeByArtist(artist: string): Promise<AlbumDto[]> {
    if (isFnosSource()) return fnosAdapter.albumsByArtist(artist);
    return httpClient.get<AlbumDto[]>(`/album/collaborative/${encodeURIComponent(artist)}`);
  }

  async latest(params: AlbumLatestParams): Promise<AlbumDto[]> {
    if (isFnosSource()) return fnosAdapter.albumLatest(params.pageSize ?? 20);
    const q: Record<string, string | number | boolean> = {};
    q['type'] = params.type;
    if (params.pageSize !== undefined) q['pageSize'] = params.pageSize;
    if (params.random !== undefined) q['random'] = params.random;
    return httpClient.get<AlbumDto[]>('/album/latest', q);
  }

  async recommend(params: AlbumRecommendParams): Promise<AlbumDto[]> {
    if (isFnosSource()) return fnosAdapter.albumLatest(params.pageSize ?? 20);
    const q: Record<string, string | number | boolean> = {};
    q['type'] = params.type;
    if (params.pageSize !== undefined) q['pageSize'] = params.pageSize;
    if (params.likeRatio !== undefined) q['likeRatio'] = params.likeRatio;
    return httpClient.get<AlbumDto[]>('/album/recommend', q);
  }

  async search(keyword: string, limit: number): Promise<AlbumDto[]> {
    if (isFnosSource()) return fnosAdapter.albumSearch(keyword, limit);
    const q: Record<string, string | number | boolean> = {};
    q['keyword'] = keyword;
    q['limit'] = limit;
    return httpClient.get<AlbumDto[]>('/album/search', q);
  }

  /**
   * 上传专辑封面：multipart/form-data，字段名 'file'。
   * 对齐 mobile uploadAlbumCover（packages/services adapter/native/album.ts），
   * 返回结构 { code, message, data: Album }，用 @ohos.request.uploadFile 实现（参考 userApi.uploadAvatar）。
   */
  async uploadCover(id: string, fileUri: string, mimeType?: string): Promise<AlbumDto> {
    if (isFnosSource()) throw new Error('飞牛音乐数据源不支持上传专辑封面');
    const context = getContext() as common.UIAbilityContext;
    const fileName = fileUri.split('/').pop() || `album-${id}.jpg`;
    const url = `${httpClient.getBaseURL()}/album/${id}/cover`;

    const headers: Record<string, string> = { 'Content-Type': 'multipart/form-data' };
    const token = httpClient.getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const uploadConfig: request.UploadConfig = {
      url: url,
      header: headers,
      method: 'POST',
      files: [{
        filename: fileName,
        name: 'file',
        uri: fileUri,
        type: mimeType ?? 'image/jpeg',
      }],
      data: [],
    };

    const uploadTask = await request.uploadFile(context, uploadConfig);
    const raw = await new Promise<string>((resolve, reject) => {
      uploadTask.on('complete', (data: Object): void => {
        try {
          const obj: Record<string, Object> = data as Record<string, Object>;
          if (obj['result'] !== undefined && typeof obj['result'] === 'string') {
            resolve(obj['result']);
            return;
          }
          if (obj['data'] !== undefined && typeof obj['data'] === 'string') {
            resolve(obj['data']);
            return;
          }
          resolve('');
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
      uploadTask.on('fail', (err: request.TaskState[]): void => {
        reject(new Error(`album cover upload failed: ${JSON.stringify(err)}`));
      });
    });

    if (raw.length === 0) {
      throw new Error('album cover upload returned empty response');
    }
    const parsed: Record<string, Object> = JSON.parse(raw) as Record<string, Object>;
    const data: Object | undefined = parsed['data'];
    if (data === undefined || data === null) {
      throw new Error('album cover upload returned missing data');
    }
    return data as AlbumDto;
  }
}

export const albumApi: AlbumApi = new AlbumApiImpl();
