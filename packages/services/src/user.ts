import { getAdapter } from "./adapter/manager";
  
  export const addToHistory = (trackId: number | string, userId: number | string, progress: number = 0, deviceName?: string, deviceId?: number | string, isSyncMode?: boolean) => {
    return getAdapter().user.addToHistory(trackId, userId, progress, deviceName, deviceId, isSyncMode);
  };
  
  export const getLatestHistory = (userId: number | string) => {
    return getAdapter().user.getLatestHistory(userId);
  };
  
  export const addAlbumToHistory = (albumId: number | string, userId: number | string) => {
    return getAdapter().user.addAlbumToHistory(albumId, userId);
  };
  
  export const getAlbumHistory = (userId: number | string, loadCount: number, pageSize: number, type?: string) => {
    return getAdapter().user.getAlbumHistory(userId, loadCount, pageSize, type);
  };
  
  export const getTrackHistory = (userId: number | string, loadCount: number, pageSize: number, type?: string) => {
    return getAdapter().user.getTrackHistory(userId, loadCount, pageSize, type);
  };
  
  export const getUserList = () => {
    return getAdapter().user.getUserList();
  };

  export const uploadUserAvatar = (id: number | string, file: any) => {
    return getAdapter().user.uploadUserAvatar(id, file);
  };
