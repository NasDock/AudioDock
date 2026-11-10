import { httpClient } from '../HarmonyHttpClient';
import type { AlbumDto } from './album';
import { isFnosSource } from '../fnos';

/**
 * 后端控制器前缀是 @Controller("collections")（services/api/src/controllers/audiobook-collection.ts），
 * 不是 /audiobook-collection。字段名对齐 Prisma model AudiobookCollection: id / name / cover / type。
 */
/** /collections/:id 返回 items，每项 include album。 */
export interface CollectionAlbumItem {
  id: string; order?: number; album?: AlbumDto;
}

export interface CollectionDto {
  id: string; name: string; cover?: string; type?: string;
  /**
   * GET /collections 也会带 items（services/api/src/services/audiobook-collection.ts:49），
   * 但只取前 4 条（take: 4）。
   */
  items?: CollectionAlbumItem[];
}

export interface CollectionDetailResp extends CollectionDto {
  items?: CollectionAlbumItem[];
}

export interface CollectionCreatePayload { name: string }
export interface CollectionReorderPayload { albumIds: string[] }
export interface CollectionAddAlbumPayload { albumId: string }

export interface CollectionApi {
  list(userId?: string): Promise<CollectionDto[]>;
  getById(id: string): Promise<CollectionDetailResp>;
  create(name: string): Promise<CollectionDto>;
  rename(id: string, name: string): Promise<CollectionDto>;
  remove(id: string): Promise<void>;
  reorder(id: string, albumIds: string[]): Promise<void>;
  addAlbum(id: string, albumId: string): Promise<void>;
  removeAlbum(id: string, albumId: string): Promise<void>;
}

class CollectionApiImpl implements CollectionApi {
  /**
   * 有声书合集是 AudioDock 服务端的能力，飞牛音乐源下没有；
   * 而且此源下 AudioDock 的 baseURL 为空，直连会抛 http 2300003「Invalid URL format」。
   * 读接口返空、写接口抛可读错误。
   */
  private unsupported(): Error {
    return new Error('飞牛音乐源不支持有声书合集');
  }

  async list(userId?: string): Promise<CollectionDto[]> {
    if (isFnosSource()) return [];
    const q: Record<string, string | number | boolean> = {};
    // userId 可省略，后端会回退到 JWT 里的用户
    if (userId !== undefined && userId.length > 0) q['userId'] = userId;
    return httpClient.get<CollectionDto[]>('/collections', q);
  }

  async getById(id: string): Promise<CollectionDetailResp> {
    if (isFnosSource()) throw this.unsupported();
    return httpClient.get<CollectionDetailResp>(`/collections/${id}`);
  }

  async create(name: string): Promise<CollectionDto> {
    if (isFnosSource()) throw this.unsupported();
    const payload: CollectionCreatePayload = { name: name };
    return httpClient.post<CollectionDto>('/collections', payload);
  }

  async rename(id: string, name: string): Promise<CollectionDto> {
    if (isFnosSource()) throw this.unsupported();
    const payload: CollectionCreatePayload = { name: name };
    return httpClient.put<CollectionDto>(`/collections/${id}`, payload);
  }

  async remove(id: string): Promise<void> {
    if (isFnosSource()) throw this.unsupported();
    return httpClient.del<void>(`/collections/${id}`);
  }

  async reorder(id: string, albumIds: string[]): Promise<void> {
    if (isFnosSource()) throw this.unsupported();
    const payload: CollectionReorderPayload = { albumIds: albumIds };
    return httpClient.put<void>(`/collections/${id}/order`, payload);
  }

  async addAlbum(id: string, albumId: string): Promise<void> {
    if (isFnosSource()) throw this.unsupported();
    const payload: CollectionAddAlbumPayload = { albumId: albumId };
    return httpClient.post<void>(`/collections/${id}/albums`, payload);
  }

  async removeAlbum(id: string, albumId: string): Promise<void> {
    if (isFnosSource()) throw this.unsupported();
    return httpClient.del<void>(`/collections/${id}/albums/${albumId}`);
  }
}

export const collectionApi: CollectionApi = new CollectionApiImpl();
