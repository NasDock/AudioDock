import { ILoadMoreData, ISuccessResponse, User } from "../models";

export interface IUserAdapter {
  addToHistory(trackId: number | string, userId: number | string, progress?: number, deviceName?: string, deviceId?: number | string, isSyncMode?: boolean): Promise<ISuccessResponse<any>>;
  getLatestHistory(userId: number | string): Promise<ISuccessResponse<any>>;
  addAlbumToHistory(albumId: number | string, userId: number | string): Promise<ISuccessResponse<any>>;
  getAlbumHistory(userId: number | string, loadCount: number, pageSize: number, type?: string): Promise<ISuccessResponse<ILoadMoreData<any>>>;
  getTrackHistory(userId: number | string, loadCount: number, pageSize: number, type?: string): Promise<ISuccessResponse<ILoadMoreData<any>>>;
  getUserList(): Promise<ISuccessResponse<any[]>>;
}

export interface IAuthAdapter {
    login(user: Partial<User> & { deviceName?: string }): Promise<ISuccessResponse<any>>;
    register(user: Partial<User> & { deviceName?: string }): Promise<ISuccessResponse<any>>;
    check(): Promise<ISuccessResponse<boolean>>;
    hello(): Promise<ISuccessResponse<string>>;
    verifyDevice(username: string, deviceName: string): Promise<ISuccessResponse<boolean>>;
    resetPassword(username: string, deviceName: string, newPassword: string): Promise<ISuccessResponse<any>>;
}
