/**
 * Common Module - AudioDock HarmonyOS App
 * Main entry point for @ohos/common imports
 */

// Export HTTP utilities and request functions
export { request, get, post, put, del as delete, patch, downloadFile } from './https/request';
export type { HttpResponse, HttpError, ApiResponse, RequestOptions, PaginationParams } from './https/types';
export { AuthApi, TrackApi, AlbumApi, ArtistApi, PlaylistApi, UserApi, FolderApi, SearchApi, AdminApi, ConfigApi } from './https/api';
export type { SearchResult } from './https/api';

// Export data models
export type {
  Track,
  Album,
  Artist,
  User,
  Playlist,
  Folder,
  Device,
  TrackType,
  UserTrackLike,
  UserTrackHistory,
  UserAlbumLike,
  UserAlbumHistory,
  UserAudiobookLike,
  UserAudiobookHistory
} from './https/models';
export { TrackType } from './https/models';

// Export utilities
export { StorageHelper, storage, StorageKeys } from './utils/StorageHelper';
export { BreakpointSystem } from './utils/BreakpointSystem';
export { Logger } from './utils/Logger';
export { HttpClient, httpClient } from './utils/HttpClient';

// Export services
export { ApiService, apiService } from './service/ApiService';
