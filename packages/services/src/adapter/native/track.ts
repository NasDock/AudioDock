import type {
    ILoadMoreData,
    ISuccessResponse,
    ITableData,
    Track,
} from "../../models";
import request from "../../request";
import { ITrackAdapter } from "../interface";

export class NativeTrackAdapter implements ITrackAdapter {
  getTrackList() {
    return request.get<any, ISuccessResponse<Track[]>>("/track/list");
  }

  getAllTracks() {
    return request.get<any, ISuccessResponse<Track[]>>("/track/list");
  }

  getTrackTableList(params: {
    pageSize: number;
    current: number;
  }) {
    return request.get<any, ISuccessResponse<ITableData<Track[]>>>(
      "/table-list",
      { params }
    );
  }

  loadMoreTrack(params: {
    pageSize: number;
    loadCount: number;
    type?: string;
  }) {
    return request.get<any, ISuccessResponse<ILoadMoreData<Track>>>(
      "/load-more",
      { params }
    );
  }

  createTrack(data: Omit<Track, "id">) {
    return request.post<any, ISuccessResponse<Track>>("/track", data);
  }

  updateTrack(id: number | string, data: Partial<Track>) {
    return request.put<any, ISuccessResponse<Track>>(`/track/${id}`, data);
  };

  deleteTrack(id: number | string, deleteAlbum: boolean = false) {
    return request.delete<any, ISuccessResponse<boolean>>(`/track/${id}`, {
      params: { deleteAlbum },
    });
  }

  getDeletionImpact(id: number | string) {
    return request.get<
      any,
      ISuccessResponse<{ isLastTrackInAlbum: boolean; albumName: string | null }>
    >(`/track/${id}/deletion-impact`);
  }

  batchCreateTracks(data: Omit<Track, "id">[]) {
    return request.post<any, ISuccessResponse<boolean>>(
      "/track/batch-create",
      data
    );
  }

  batchDeleteTracks(ids: (number | string)[]) {
    return request.delete<any, ISuccessResponse<boolean>>(
      "/track/batch-delete",
      { data: ids }
    );
  }

  getLatestTracks(type?: string, random?: boolean, pageSize?: number) {
    return request.get<any, ISuccessResponse<Track[]>>("/track/latest", {
      params: { type, random, pageSize },
    });
  }

  getRecommendedTracks(type?: string, pageSize?: number, likeRatio?: number) {
    return request.get<any, ISuccessResponse<Track[]>>("/track/recommend", {
      params: { type, pageSize, likeRatio },
    });
  }

  getTracksByArtist(artist: string) {
    return request.get<any, ISuccessResponse<Track[]>>("/track/artist", {
      params: { artist },
    });
  }

  toggleLike(id: number | string, userId: number | string) {
    return request.post<any, ISuccessResponse<any>>("/user-track-likes/create", {
      trackId: id,
      userId,
    });
  }

  toggleUnLike(id: number | string, userId: number | string) {
    return request.delete<any, ISuccessResponse<any>>("/user-track-likes/unlike", {
      params: { trackId: id, userId },
    });
  }

  getFavoriteTracks(userId: number | string, loadCount: number, pageSize: number, type?: string): Promise<ISuccessResponse<ILoadMoreData<{ track: Track, createdAt: string | Date }>>> {
    return request.get<any, ISuccessResponse<ILoadMoreData<{ track: Track, createdAt: string | Date }>>>("/user-track-likes/load-more", {
      params: { pageSize, loadCount: loadCount, userId, lastId: loadCount, type },
    });
  }

  getLyrics(id: number | string) {
    return request.get<any, ISuccessResponse<string | null>>(`/track/${id}/lyrics`);
  }
}
