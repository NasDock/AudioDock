import { ILoadMoreData, ISuccessResponse } from "../../models";
import request from "../../request";
import { IUserAdapter } from "../interface-user-auth";

export class NativeUserAdapter implements IUserAdapter {
  addToHistory(trackId: number | string, userId: number | string, progress: number = 0, deviceName?: string, deviceId?: number | string, isSyncMode?: boolean) {
    return request.post<any, ISuccessResponse<any>>("/user-track-histories", {
      trackId,
      userId,
      progress,
      deviceName,
      deviceId,
      isSyncMode,
    });
  }

  getLatestHistory(userId: number | string) {
      return request.get<any, ISuccessResponse<any>>("/user-track-histories/latest", {
          params: { userId }
      });
  }

  addAlbumToHistory(albumId: number | string, userId: number | string) {
    return request.post<any, ISuccessResponse<any>>("/user-album-histories", {
      albumId,
      userId,
    });
  }

  getAlbumHistory(userId: number | string, loadCount: number, pageSize: number, type?: string) {
    return request.get<any, ISuccessResponse<ILoadMoreData<any>>>("/user-album-histories/load-more", {
      params: { pageSize, loadCount, userId, type },
    });
  }


  getTrackHistory(userId: number | string, loadCount: number, pageSize: number, type?: string) {
    return request.get<any, ISuccessResponse<ILoadMoreData<any>>>("/user-track-histories/load-more", {
      params: { pageSize, loadCount: loadCount, userId, type },
    });
  }

  getUserList() {
    return request.get<any, ISuccessResponse<any[]>>("/user/list");
  }

  getCurrentUser() {
    return request.get<any, ISuccessResponse<any>>("/auth/me");
  }

  uploadUserAvatar(id: number | string, file: any) {
    const formData = new FormData();
    formData.append("file", file as any);
    return request.post<any, ISuccessResponse<any>>(`/user/${id}/avatar`, formData);
  }
}
