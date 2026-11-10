import { common } from '@kit.AbilityKit';
import request from '@ohos.request';
import { httpClient } from '../HarmonyHttpClient';
import { fnosAdapter, isFnosSource } from '../fnos';
import type { LoadMoreResp } from '../types';

/**
 * 字段名对齐后端 Prisma model Artist（packages/db/prisma/schema.prisma）:
 * id / name / avatar / type / bg_cover / description。
 * 后端不返回 avatarUrl。
 */
export interface ArtistDto {
  id: string; name: string; avatar?: string; type?: string;
  bg_cover?: string; description?: string;
}

/**
 * 注意：GET /artist/{id} 返回的是裸 Artist 对象（services/api/src/services/artist.ts:39），
 * 不带 albums / tracks。艺人的专辑与曲目要分别调
 * albumApi.byArtist / albumApi.collaborativeByArtist / trackApi.byArtist，
 * 且它们用的是艺人「名字」而不是 id。
 */
export interface ArtistLoadMoreParams {
  pageSize: number;
  loadCount: number;
  type?: string;
  sortBy?: string;
}

export interface ArtistLatestParams {
  type: string;
  pageSize?: number;
  random?: boolean;
}

export interface ArtistApi {
  list(): Promise<ArtistDto[]>;
  loadMore(params: ArtistLoadMoreParams): Promise<LoadMoreResp<ArtistDto>>;
  getById(id: string): Promise<ArtistDto>;
  latest(params: ArtistLatestParams): Promise<ArtistDto[]>;
  search(keyword: string, limit: number): Promise<ArtistDto[]>;
  /** POST /artist/{id}/avatar 上传艺人头像，返回更新后的 Artist。 */
  uploadAvatar(id: string, fileUri: string, mimeType?: string): Promise<ArtistDto>;
}

class ArtistApiImpl implements ArtistApi {
  async list(): Promise<ArtistDto[]> {
    if (isFnosSource()) return fnosAdapter.artistList();
    return httpClient.get<ArtistDto[]>('/artist/list');
  }

  async loadMore(params: ArtistLoadMoreParams): Promise<LoadMoreResp<ArtistDto>> {
    if (isFnosSource()) {
      return fnosAdapter.artistLoadMore(params.pageSize, params.loadCount, params.sortBy ?? '');
    }
    const q: Record<string, string | number | boolean> = {};
    q['pageSize'] = params.pageSize;
    q['loadCount'] = params.loadCount;
    if (params.type !== undefined) q['type'] = params.type;
    if (params.sortBy !== undefined) q['sortBy'] = params.sortBy;
    return httpClient.get<LoadMoreResp<ArtistDto>>('/artist/load-more', q);
  }

  async getById(id: string): Promise<ArtistDto> {
    if (isFnosSource()) return fnosAdapter.artistById(id);
    return httpClient.get<ArtistDto>(`/artist/${id}`);
  }

  async latest(params: ArtistLatestParams): Promise<ArtistDto[]> {
    if (isFnosSource()) return fnosAdapter.artistLatest(params.pageSize ?? 0);
    const q: Record<string, string | number | boolean> = {};
    q['type'] = params.type;
    if (params.pageSize !== undefined) q['pageSize'] = params.pageSize;
    if (params.random !== undefined) q['random'] = params.random;
    return httpClient.get<ArtistDto[]>('/artist/latest', q);
  }

  async search(keyword: string, limit: number): Promise<ArtistDto[]> {
    if (isFnosSource()) return fnosAdapter.artistSearch(keyword, limit);
    const q: Record<string, string | number | boolean> = {};
    q['keyword'] = keyword;
    q['limit'] = limit;
    return httpClient.get<ArtistDto[]>('/artist/search', q);
  }

  /**
   * 上传艺人头像：multipart/form-data，字段名 'file'。
   * 对齐 mobile uploadArtistAvatar（packages/services adapter/native/artist.ts），
   * 返回结构 { code, message, data: Artist }。
   */
  async uploadAvatar(id: string, fileUri: string, mimeType?: string): Promise<ArtistDto> {
    if (isFnosSource()) throw new Error('飞牛音乐数据源不支持上传歌手头像');
    const context = getContext() as common.UIAbilityContext;
    const fileName = fileUri.split('/').pop() || `artist-${id}.jpg`;
    const url = `${httpClient.getBaseURL()}/artist/${id}/avatar`;

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
        reject(new Error(`artist avatar upload failed: ${JSON.stringify(err)}`));
      });
    });

    if (raw.length === 0) {
      throw new Error('artist avatar upload returned empty response');
    }
    const parsed: Record<string, Object> = JSON.parse(raw) as Record<string, Object>;
    const data: Object | undefined = parsed['data'];
    if (data === undefined || data === null) {
      throw new Error('artist avatar upload returned missing data');
    }
    return data as ArtistDto;
  }
}

export const artistApi: ArtistApi = new ArtistApiImpl();
