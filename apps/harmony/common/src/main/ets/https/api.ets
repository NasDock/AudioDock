/**
 * API 接口定义层
 * 对应 mobile/packages/services/src/ 的所有接口
 * 提供统一的 API 调用入口
 */

import { request, get, post, put, del } from './request';
import type {
  ApiResponse,
  PaginationParams,
  PaginatedResponse
} from './types';
import type {
  Track,
  TrackType,
  Album,
  Artist,
  User,
  Playlist,
  Folder,
  Device,
  UserTrackLike,
  UserAlbumLike,
  UserTrackHistory,
  UserAlbumHistory,
  UserAudiobookLike,
  UserAudiobookHistory
} from './models';

// ============ 通用响应类型 ============

export interface SuccessResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface TableData<T> {
  pageSize: number;
  current: number;
  list: T[];
  total: number;
}

export interface LoadMoreData<T> {
  pageSize: number;
  loadCount: number;
  list: T[];
  total: number;
  hasMore: boolean;
}

// ============ Auth API ============

export interface LoginParams {
  username: string;
  password: string;
  deviceName?: string;
}

export interface RegisterParams {
  username: string;
  password: string;
  deviceName?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export const AuthApi = {
  /**
   * 用户登录
   */
  login: (params: LoginParams) =>
    post<SuccessResponse<AuthResponse>>('/auth/login', params),

  /**
   * 用户注册
   */
  register: (params: RegisterParams) =>
    post<SuccessResponse<AuthResponse>>('/auth/register', params),

  /**
   * 检查登录状态
   */
  check: () =>
    get<SuccessResponse<User>>('/auth/check'),

  /**
   * 验证设备
   */
  verifyDevice: (username: string, deviceName: string) =>
    post<SuccessResponse<AuthResponse>>('/auth/verify-device', { username, deviceName }),

  /**
   * 重置密码
   */
  resetPassword: (username: string, deviceName: string, newPassword: string) =>
    post<SuccessResponse<void>>('/auth/reset-password', { username, deviceName, newPassword }),

  /**
   * 获取服务器信息
   */
  hello: () =>
    get<SuccessResponse<{ version: string; name: string }>>('/auth/hello'),
};

// ============ Track API ============

export interface TrackListParams extends PaginationParams {
  type?: string;
}

export interface LoadMoreTrackParams {
  pageSize: number;
  loadCount: number;
  type?: string;
}

export const TrackApi = {
  /**
   * 获取所有曲目
   */
  getTrackList: () =>
    get<SuccessResponse<Track[]>>('/tracks'),

  /**
   * 获取曲目列表（分页）
   */
  getTrackTableList: (params: { pageSize: number; current: number }) =>
    get<SuccessResponse<TableData<Track>>>('/tracks/table', params),

  /**
   * 加载更多曲目
   */
  loadMoreTrack: (params: LoadMoreTrackParams) =>
    get<SuccessResponse<LoadMoreData<Track>>>('/tracks/load-more', params),

  /**
   * 创建曲目
   */
  createTrack: (data: Omit<Track, 'id'>) =>
    post<SuccessResponse<Track>>('/tracks', data),

  /**
   * 更新曲目
   */
  updateTrack: (id: number | string, data: Partial<Track>) =>
    put<SuccessResponse<Track>>(`/tracks/${id}`, data),

  /**
   * 删除曲目
   */
  deleteTrack: (id: number | string, deleteAlbum = false) =>
    del<SuccessResponse<void>>(`/tracks/${id}?deleteAlbum=${deleteAlbum}`),

  /**
   * 获取删除影响
   */
  getDeletionImpact: (id: number | string) =>
    get<SuccessResponse<{ affectedPlaylists: number; affectedAlbums: number }>>(`/tracks/${id}/impact`),

  /**
   * 批量创建曲目
   */
  batchCreateTracks: (data: Omit<Track, 'id'>[]) =>
    post<SuccessResponse<Track[]>>('/tracks/batch', data),

  /**
   * 批量删除曲目
   */
  batchDeleteTracks: (ids: (number | string)[]) =>
    post<SuccessResponse<void>>('/tracks/batch-delete', { ids }),

  /**
   * 获取最新曲目
   */
  getLatestTracks: (type?: TrackType, random?: boolean, pageSize = 20) =>
    get<SuccessResponse<Track[]>>('/tracks/latest', { type, random, pageSize }),

  /**
   * 获取艺术家曲目
   */
  getTracksByArtist: (artist: string) =>
    get<SuccessResponse<Track[]>>(`/tracks/artist/${encodeURIComponent(artist)}`),

  /**
   * 收藏曲目
   */
  toggleTrackLike: (id: number | string, userId: number | string) =>
    post<SuccessResponse<UserTrackLike>>(`/tracks/${id}/like`, { userId }),

  /**
   * 取消收藏曲目
   */
  toggleTrackUnLike: (id: number | string, userId: number | string) =>
    post<SuccessResponse<void>>(`/tracks/${id}/unlike`, { userId }),

  /**
   * 获取用户收藏的曲目
   */
  getFavoriteTracks: (userId: number | string, loadCount: number, pageSize: number, type?: string) =>
    get<SuccessResponse<Track[]>>(`/users/${userId}/favorite-tracks`, { loadCount, pageSize, type }),

  /**
   * 获取曲目歌词
   */
  getTrackLyrics: (id: number | string) =>
    get<SuccessResponse<{ lyrics: string | null }>>(`/tracks/${id}/lyrics`),
};

// ============ Album API ============

export interface AlbumListParams extends PaginationParams {
  type?: string;
}

export const AlbumApi = {
  /**
   * 获取所有专辑
   */
  getAlbumList: () =>
    get<SuccessResponse<Album[]>>('/albums'),

  /**
   * 获取专辑列表（分页）
   */
  getAlbumTableList: (params: { pageSize: number; current: number; type?: string }) =>
    get<SuccessResponse<TableData<Album>>>('/albums/table', params),

  /**
   * 获取专辑详情
   */
  getAlbumById: (id: number | string) =>
    get<SuccessResponse<Album>>(`/albums/${id}`),

  /**
   * 获取专辑曲目
   */
  getAlbumTracks: (id: number | string) =>
    get<SuccessResponse<Track[]>>(`/albums/${id}/tracks`),

  /**
   * 收藏专辑
   */
  toggleAlbumLike: (id: number | string, userId: number | string) =>
    post<SuccessResponse<UserAlbumLike>>(`/albums/${id}/like`, { userId }),

  /**
   * 取消收藏专辑
   */
  toggleAlbumUnLike: (id: number | string, userId: number | string) =>
    post<SuccessResponse<void>>(`/albums/${id}/unlike`, { userId }),

  /**
   * 获取最新专辑
   */
  getLatestAlbums: (type?: TrackType, random?: boolean, pageSize = 20) =>
    get<SuccessResponse<Album[]>>('/albums/latest', { type, random, pageSize }),

  /**
   * 搜索专辑
   */
  searchAlbums: (keyword: string, page = 1, pageSize = 20) =>
    get<SuccessResponse<Album[]>>('/albums/search', { keyword, page, pageSize }),
};

// ============ Artist API ============

export const ArtistApi = {
  /**
   * 获取所有艺术家
   */
  getArtistList: () =>
    get<SuccessResponse<Artist[]>>('/artists'),

  /**
   * 获取艺术家详情
   */
  getArtistById: (id: number | string) =>
    get<SuccessResponse<Artist>>(`/artists/${id}`),

  /**
   * 获取艺术家曲目
   */
  getArtistTracks: (id: number | string) =>
    get<SuccessResponse<Track[]>>(`/artists/${id}/tracks`),

  /**
   * 获取艺术家专辑
   */
  getArtistAlbums: (id: number | string) =>
    get<SuccessResponse<Album[]>>(`/artists/${id}/albums`),

  /**
   * 搜索艺术家
   */
  searchArtists: (keyword: string, page = 1, pageSize = 20) =>
    get<SuccessResponse<Artist[]>>('/artists/search', { keyword, page, pageSize }),
};

// ============ Playlist API ============

export interface PlaylistParams {
  name: string;
  type?: TrackType;
  trackIds?: (number | string)[];
}

export const PlaylistApi = {
  /**
   * 获取用户的所有歌单
   */
  getPlaylistList: (userId?: number | string) =>
    get<SuccessResponse<Playlist[]>>('/playlists', { userId }),

  /**
   * 获取歌单详情
   */
  getPlaylistById: (id: number | string) =>
    get<SuccessResponse<Playlist>>(`/playlists/${id}`),

  /**
   * 获取歌单曲目
   */
  getPlaylistTracks: (id: number | string) =>
    get<SuccessResponse<Track[]>>(`/playlists/${id}/tracks`),

  /**
   * 创建歌单
   */
  createPlaylist: (data: PlaylistParams) =>
    post<SuccessResponse<Playlist>>('/playlists', data),

  /**
   * 更新歌单
   */
  updatePlaylist: (id: number | string, data: Partial<PlaylistParams>) =>
    put<SuccessResponse<Playlist>>(`/playlists/${id}`, data),

  /**
   * 删除歌单
   */
  deletePlaylist: (id: number | string) =>
    del<SuccessResponse<void>>(`/playlists/${id}`),

  /**
   * 添加曲目到歌单
   */
  addTrackToPlaylist: (playlistId: number | string, trackId: number | string) =>
    post<SuccessResponse<void>>(`/playlists/${playlistId}/tracks`, { trackId }),

  /**
   * 从歌单移除曲目
   */
  removeTrackFromPlaylist: (playlistId: number | string, trackId: number | string) =>
    del<SuccessResponse<void>>(`/playlists/${playlistId}/tracks/${trackId}`),

  /**
   * 批量添加曲目到歌单
   */
  batchAddTracksToPlaylist: (playlistId: number | string, trackIds: (number | string)[]) =>
    post<SuccessResponse<void>>(`/playlists/${playlistId}/tracks/batch`, { trackIds }),
};

// ============ User API ============

export const UserApi = {
  /**
   * 获取用户信息
   */
  getUserById: (id: number | string) =>
    get<SuccessResponse<User>>(`/users/${id}`),

  /**
   * 获取当前用户信息
   */
  getCurrentUser: () =>
    get<SuccessResponse<User>>('/users/me'),

  /**
   * 更新用户信息
   */
  updateUser: (id: number | string, data: Partial<User>) =>
    put<SuccessResponse<User>>(`/users/${id}`, data),

  /**
   * 获取用户收藏的专辑
   */
  getFavoriteAlbums: (userId: number | string, page = 1, pageSize = 20) =>
    get<SuccessResponse<Album[]>>(`/users/${userId}/favorite-albums`, { page, pageSize }),

  /**
   * 获取用户收藏的有声书
   */
  getFavoriteAudiobooks: (userId: number | string, page = 1, pageSize = 20) =>
    get<SuccessResponse<Track[]>>(`/users/${userId}/favorite-audiobooks`, { page, pageSize }),

  /**
   * 获取用户播放历史
   */
  getUserHistory: (userId: number | string, page = 1, pageSize = 20) =>
    get<SuccessResponse<Track[]>>(`/users/${userId}/history`, { page, pageSize }),

  /**
   * 获取用户设备列表
   */
  getUserDevices: (userId: number | string) =>
    get<SuccessResponse<Device[]>>(`/users/${userId}/devices`),
};

// ============ Folder API ============

export const FolderApi = {
  /**
   * 获取所有文件夹
   */
  getFolderList: () =>
    get<SuccessResponse<Folder[]>>('/folders'),

  /**
   * 获取文件夹详情
   */
  getFolderById: (id: number | string) =>
    get<SuccessResponse<Folder>>(`/folders/${id}`),

  /**
   * 获取文件夹下的曲目
   */
  getFolderTracks: (id: number | string) =>
    get<SuccessResponse<Track[]>>(`/folders/${id}/tracks`),

  /**
   * 获取文件夹下的子文件夹
   */
  getFolderChildren: (id: number | string) =>
    get<SuccessResponse<Folder[]>>(`/folders/${id}/children`),

  /**
   * 创建文件夹
   */
  createFolder: (data: Omit<Folder, 'id'>) =>
    post<SuccessResponse<Folder>>('/folders', data),

  /**
   * 更新文件夹
   */
  updateFolder: (id: number | string, data: Partial<Folder>) =>
    put<SuccessResponse<Folder>>(`/folders/${id}`, data),

  /**
   * 删除文件夹
   */
  deleteFolder: (id: number | string) =>
    del<SuccessResponse<void>>(`/folders/${id}`),
};

// ============ Search API ============

export interface SearchResult {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
}

export const SearchApi = {
  /**
   * 全局搜索
   */
  search: (keyword: string, type?: string) =>
    get<SuccessResponse<SearchResult>>('/search', { keyword, type }),

  /**
   * 搜索曲目
   */
  searchTracks: (keyword: string, page = 1, pageSize = 20) =>
    get<SuccessResponse<Track[]>>('/search/tracks', { keyword, page, pageSize }),

  /**
   * 搜索专辑
   */
  searchAlbums: (keyword: string, page = 1, pageSize = 20) =>
    get<SuccessResponse<Album[]>>('/search/albums', { keyword, page, pageSize }),

  /**
   * 搜索艺术家
   */
  searchArtists: (keyword: string, page = 1, pageSize = 20) =>
    get<SuccessResponse<Artist[]>>('/search/artists', { keyword, page, pageSize }),

  /**
   * 搜索歌单
   */
  searchPlaylists: (keyword: string, page = 1, pageSize = 20) =>
    get<SuccessResponse<Playlist[]>>('/search/playlists', { keyword, page, pageSize }),
};

// ============ Admin API ============

export interface AdminStats {
  totalTracks: number;
  totalAlbums: number;
  totalArtists: number;
  totalUsers: number;
  totalPlaylists: number;
  totalStorageSize: number;
}

export const AdminApi = {
  /**
   * 获取统计数据
   */
  getStats: () =>
    get<SuccessResponse<AdminStats>>('/admin/stats'),

  /**
   * 获取所有用户
   */
  getAllUsers: (params?: PaginationParams) =>
    get<SuccessResponse<User[]>>('/admin/users', params as Record<string, string | number>),

  /**
   * 创建用户
   */
  createUser: (data: Partial<User> & { password: string }) =>
    post<SuccessResponse<User>>('/admin/users', data),

  /**
   * 更新用户
   */
  updateUser: (id: number | string, data: Partial<User>) =>
    put<SuccessResponse<User>>(`/admin/users/${id}`, data),

  /**
   * 删除用户
   */
  deleteUser: (id: number | string) =>
    del<SuccessResponse<void>>(`/admin/users/${id}`),

  /**
   * 获取待导入文件列表
   */
  getImportQueue: () =>
    get<SuccessResponse<{ path: string; size: number }[]>>('/admin/import-queue'),

  /**
   * 执行导入
   */
  triggerImport: () =>
    post<SuccessResponse<{ jobId: string }>>('/admin/import/trigger'),

  /**
   * 获取导入状态
   */
  getImportStatus: (jobId?: string) =>
    get<SuccessResponse<{ status: string; progress?: number; message?: string }>>('/admin/import/status', { jobId }),
};

// ============ Config API ============

export interface AppConfig {
  skipIntroDuration: number;
  skipOutroDuration: number;
  autoPlayNext: boolean;
  defaultPlaybackSpeed: number;
  serverVersion: string;
}

export const ConfigApi = {
  /**
   * 获取应用配置
   */
  getConfig: () =>
    get<SuccessResponse<AppConfig>>('/config'),

  /**
   * 保存用户配置
   */
  saveConfig: (config: Partial<AppConfig>) =>
    post<SuccessResponse<void>>('/config', config),

  /**
   * 获取播放模式
   */
  getPlaybackMode: () =>
    get<SuccessResponse<{ mode: string }>>('/config/playback-mode'),

  /**
   * 保存播放模式
   */
  savePlaybackMode: (mode: string) =>
    post<SuccessResponse<void>>('/config/playback-mode', { mode }),
};

// ============ 默认导出 ============

export default {
  Auth: AuthApi,
  Track: TrackApi,
  Album: AlbumApi,
  Artist: ArtistApi,
  Playlist: PlaylistApi,
  User: UserApi,
  Folder: FolderApi,
  Search: SearchApi,
  Admin: AdminApi,
  Config: ConfigApi,
};
