import type {
    Album,
    ILoadMoreData,
    ISuccessResponse,
    ITableData,
} from "../../models";
import request from "../../request";
import { IAlbumAdapter } from "../interface";

export class NativeAlbumAdapter implements IAlbumAdapter {
  getAlbumList() {
    return request.get<any, ISuccessResponse<Album[]>>("/album/list");
  }

  getAlbumTableList(params: {
    pageSize: number;
    current: number;
  }) {
    return request.get<any, ISuccessResponse<ITableData<Album[]>>>(
      "/album/table-list",
      { params }
    );
  }

  loadMoreAlbum(params: {
    pageSize: number;
    loadCount: number;
    type?: string;
  }) {
    return request.get<any, ISuccessResponse<ILoadMoreData<Album>>>(
      "/album/load-more",
      { params }
    );
  }

  createAlbum(data: Omit<Album, "id">) {
    return request.post<any, ISuccessResponse<Album>>("/album", data);
  }

  updateAlbum(id: number | string, data: Partial<Album>) {
    return request.put<any, ISuccessResponse<Album>>(`/album/${id}`, data);
  }

  deleteAlbum(id: number | string) {
    return request.delete<any, ISuccessResponse<boolean>>(`/album/${id}`);
  }

  batchCreateAlbums(data: Omit<Album, "id">[]) {
    return request.post<any, ISuccessResponse<boolean>>(
      "/album/batch-create",
      data
    );
  }

  batchDeleteAlbums(ids: (number | string)[]) {
    return request.delete<any, ISuccessResponse<boolean>>(
      "/album/batch-delete",
      { data: ids }
    );
  }

  getRecommendedAlbums(type?: string, random?: boolean, pageSize?: number) {
    return request.get<any, ISuccessResponse<Album[]>>("/album/recommend", {
      params: { type, random, pageSize },
    });
  }

  getRecentAlbums(type?: string, random?: boolean, pageSize?: number) {
    return request.get<any, ISuccessResponse<Album[]>>("/album/latest", {
      params: { type, random, pageSize },
    });
  }

  getAlbumById(id: number | string) {
    return request.get<any, ISuccessResponse<Album>>(`/album/${id}`);
  }

  getAlbumTracks(
    id: number | string,
    pageSize: number,
    skip: number,
    sort: "asc" | "desc" = "asc",
    keyword?: string,
    userId?: number | string,
    sortBy?: string,
  ) {
    return request.get<any, ISuccessResponse<{ list: any[]; total: number }>>(
      `/album/${id}/tracks`,
      {
        params: { pageSize, skip, sort, keyword, userId, sortBy },
      }
    );
  }

  getAlbumsByArtist(artist: string) {
    return request.get<any, ISuccessResponse<Album[]>>(`/album/artist/${artist}`);
  }

  getCollaborativeAlbumsByArtist(artist: string) {
    return request.get<any, ISuccessResponse<Album[]>>(`/album/collaborative/${artist}`);
  }

  toggleLike(id: number | string, userId: number | string) {
    return request.post<any, ISuccessResponse<any>>("/user-album-likes", {
      albumId: id,
      userId,
    });
  }

  toggleUnLike(id: number | string, userId: number | string) {
    return request.delete<any, ISuccessResponse<any>>("/user-album-likes/unlike", {
      params: { albumId: id, userId },
    });
  }

  getFavoriteAlbums(userId: number | string, loadCount: number, pageSize: number, type?: string): Promise<ISuccessResponse<ILoadMoreData<{ album: Album, createdAt: string | Date }>>> {
    return request.get<any, ISuccessResponse<ILoadMoreData<{ album: Album, createdAt: string | Date }>>>("/user-album-likes/list", {
      params: { userId, loadCount, pageSize, type }
    });
  }
}
