import { Device, ILoadMoreData, ISuccessResponse, User } from "../models";

/** 登录时上报的设备信息 */
export interface DeviceLoginInfo {
  deviceName?: string;
  deviceId?: string;
  platform?: string;
}

/** 播放流转 payload（HTTP 版，供无常驻 WS 的端使用） */
export interface TransferSessionPayload {
  targetDeviceId: string;
  currentTrack?: any;
  playlist?: any;
  progress?: number;
  fromDeviceName?: string;
}

export interface IUserAdapter {
  addToHistory(trackId: number | string, userId: number | string, progress?: number, deviceName?: string, deviceId?: number | string, isSyncMode?: boolean): Promise<ISuccessResponse<any>>;
  getLatestHistory(userId: number | string): Promise<ISuccessResponse<any>>;
  addAlbumToHistory(albumId: number | string, userId: number | string): Promise<ISuccessResponse<any>>;
  getAlbumHistory(userId: number | string, loadCount: number, pageSize: number, type?: string): Promise<ISuccessResponse<ILoadMoreData<any>>>;
  getTrackHistory(userId: number | string, loadCount: number, pageSize: number, type?: string): Promise<ISuccessResponse<ILoadMoreData<any>>>;
  getUserList(): Promise<ISuccessResponse<any[]>>;
  getCurrentUser(): Promise<ISuccessResponse<User>>;
  getUserDevices(): Promise<ISuccessResponse<Device[]>>;
  transferSession(payload: TransferSessionPayload): Promise<ISuccessResponse<{ delivered: boolean }>>;
  uploadUserAvatar(id: number | string, file: any): Promise<ISuccessResponse<any>>;
}

export interface IAuthAdapter {
    login(user: Partial<User> & DeviceLoginInfo): Promise<ISuccessResponse<any>>;
    register(user: Partial<User> & DeviceLoginInfo): Promise<ISuccessResponse<any>>;
    check(): Promise<ISuccessResponse<boolean>>;
    hello(): Promise<ISuccessResponse<string>>;
    verifyDevice(username: string, deviceName: string): Promise<ISuccessResponse<boolean>>;
    resetPassword(username: string, deviceName: string, newPassword: string): Promise<ISuccessResponse<any>>;
}
