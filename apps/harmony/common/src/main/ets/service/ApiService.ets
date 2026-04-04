/**
 * API Service for AudioDock HarmonyOS App.
 * Provides typed API methods for all backend endpoints.
 */
import { httpClient, HttpResponse, HttpError, ApiResponse } from '../utils/HttpClient';
import { storage, StorageKeys } from '../utils/StorageHelper';

export { ApiResponse };

// ==================== API Endpoints ====================
interface ApiEndpointsType {
  AUTH_LOGIN: string;
  AUTH_REGISTER: string;
  AUTH_LOGOUT: string;
  AUTH_REFRESH: string;
  AUTH_CHECK: string;
  MEMBER_LOGIN: string;
  MEMBER_INFO: string;
  MEMBER_BENEFITS: string;
  MEMBER_VIP_STATUS: string;
  FORGOT_PASSWORD: string;
  RESET_PASSWORD: string;
  TRACKS: string;
  TRACK_DETAIL: string;
  TRACK_LATEST: string;
  TRACK_SEARCH: string;
  TRACK_HISTORY: string;
  PLAYLISTS: string;
  PLAYLIST_DETAIL: string;
  PLAYLIST_TRACKS: string;
  ALBUMS: string;
  ALBUM_DETAIL: string;
  ALBUM_TRACKS: string;
  ALBUM_HISTORY: string;
  ARTISTS: string;
  ARTIST_DETAIL: string;
  ARTIST_TRACKS: string;
  ARTIST_ALBUMS: string;
  COLLECTIONS: string;
  COLLECTION_DETAIL: string;
  SEARCH_ALL: string;
  SEARCH_TRACKS: string;
  SEARCH_ALBUMS: string;
  SEARCH_ARTISTS: string;
  SEARCH_PLAYLISTS: string;
  SETTINGS: string;
  SETTINGS_UPDATE: string;
  SOURCES: string;
  SOURCE_ADD: string;
  SOURCE_SCAN: string;
  WIDGET_DATA: string;
  PAYMENT_CREATE: string;
  PAYMENT_STATUS: string;
  ASR_BASE: string;
}

const API_ENDPOINTS: ApiEndpointsType = {
  // Auth
  AUTH_LOGIN: '/auth/login',
  AUTH_REGISTER: '/auth/register',
  AUTH_LOGOUT: '/auth/logout',
  AUTH_REFRESH: '/auth/refresh',
  AUTH_CHECK: '/auth/check',

  // Member
  MEMBER_LOGIN: '/member/login',
  MEMBER_INFO: '/member/info',
  MEMBER_BENEFITS: '/member/benefits',
  MEMBER_VIP_STATUS: '/member/vip-status',

  // Password
  FORGOT_PASSWORD: '/password/forgot',
  RESET_PASSWORD: '/password/reset',

  // Tracks
  TRACKS: '/tracks',
  TRACK_DETAIL: '/tracks/:id',
  TRACK_LATEST: '/tracks/latest',
  TRACK_SEARCH: '/tracks/search',
  TRACK_HISTORY: '/tracks/history',

  // Playlist
  PLAYLISTS: '/playlists',
  PLAYLIST_DETAIL: '/playlists/:id',
  PLAYLIST_TRACKS: '/playlists/:id/tracks',

  // Album
  ALBUMS: '/albums',
  ALBUM_DETAIL: '/albums/:id',
  ALBUM_TRACKS: '/albums/:id/tracks',
  ALBUM_HISTORY: '/albums/history',

  // Artist
  ARTISTS: '/artists',
  ARTIST_DETAIL: '/artists/:id',
  ARTIST_TRACKS: '/artists/:id/tracks',
  ARTIST_ALBUMS: '/artists/:id/albums',

  // Collection
  COLLECTIONS: '/collections',
  COLLECTION_DETAIL: '/collections/:id',

  // Search
  SEARCH_ALL: '/search',
  SEARCH_TRACKS: '/search/tracks',
  SEARCH_ALBUMS: '/search/albums',
  SEARCH_ARTISTS: '/search/artists',
  SEARCH_PLAYLISTS: '/search/playlists',

  // Settings
  SETTINGS: '/settings',
  SETTINGS_UPDATE: '/settings/update',

  // Sources
  SOURCES: '/sources',
  SOURCE_ADD: '/sources/add',
  SOURCE_SCAN: '/sources/scan',

  // Widget
  WIDGET_DATA: '/widget/data',

  // Payments
  PAYMENT_CREATE: '/payments/create',
  PAYMENT_STATUS: '/payments/status',

  // ASR (Speech Recognition)
  ASR_BASE: '/asr',
};

// ==================== User Types ====================
export interface User {
  id: number;
  username: string;
  email: string;
  avatar?: string;
  vipTier?: string;
  createdAt?: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface PlusLoginResponse {
  plusToken: string;
  user: User;
}

// ==================== Track Types ====================
export interface Track {
  id: number;
  title: string;
  artist: string;
  album?: string;
  albumId?: number;
  duration: number;
  url: string;
  coverUrl?: string;
  lyricsUrl?: string;
  liked?: boolean;
}

export interface TrackListResponse {
  list: Track[];
  total: number;
  page: number;
  pageSize: number;
}

// ==================== Playlist Types ====================
export interface Playlist {
  id: number;
  name: string;
  description?: string;
  coverUrl?: string;
  trackCount: number;
  createdAt: string;
  updatedAt?: string;
  tracks?: Track[];
}

export interface PlaylistDetailResponse extends Playlist {
  tracks: Track[];
}

// ==================== Album Types ====================
export interface Album {
  id: number;
  name: string;
  artist: string;
  artistId?: number;
  coverUrl?: string;
  trackCount: number;
  releaseDate?: string;
}

export interface AlbumDetailResponse extends Album {
  tracks: Track[];
}

// ==================== Artist Types ====================
export interface Artist {
  id: number;
  name: string;
  avatarUrl?: string;
  bio?: string;
  trackCount?: number;
  albumCount?: number;
}

// ==================== Search Types ====================
export interface SearchResult {
  tracks?: Track[];
  albums?: Album[];
  artists?: Artist[];
  playlists?: Playlist[];
}

// ==================== API Service ====================
interface GeneratedTypeLiteralInterface_2 {
  track: Track;
  progress?: number;
}

interface GeneratedTypeLiteralInterface_1 {
  list: Array<GeneratedTypeLiteralInterface_2>;
}

interface GeneratedTypeLiteralInterface_4 {
  trackId: number;
  album: Album;
  progress?: number;
}

interface GeneratedTypeLiteralInterface_3 {
  list: Array<GeneratedTypeLiteralInterface_4>;
}

interface GeneratedTypeLiteralInterface_6 {
  trackId: number;
  album: Album;
  progress?: number;
}

interface GeneratedTypeLiteralInterface_5 {
  list: Array<GeneratedTypeLiteralInterface_6>;
}

export class ApiService {
  private static instance: ApiService;

  private constructor() {
  }

  public static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }
    return ApiService.instance;
  }

  /**
   * Initialize API with stored tokens
   */
  public async init(): Promise<void> {
    const baseUrl = await storage.getString(StorageKeys.BASE_URL);
    if (baseUrl) {
      httpClient.setBaseURL(baseUrl);
    }

    const token = await storage.getString(StorageKeys.TOKEN);
    if (token) {
      httpClient.setToken(token);
    }

    const plusToken = await storage.getString(StorageKeys.PLUS_TOKEN);
    if (plusToken) {
      httpClient.setPlusToken(plusToken);
    }
  }

  /**
   * Set base URL and persist
   */
  public async setBaseURL(url: string): Promise<void> {
    httpClient.setBaseURL(url);
    await storage.setString(StorageKeys.BASE_URL, url);
  }

  /**
   * Set token and persist
   */
  public async setToken(token: string): Promise<void> {
    httpClient.setToken(token);
    await storage.setString(StorageKeys.TOKEN, token);
  }

  /**
   * Set plus token and persist
   */
  public async setPlusToken(plusToken: string): Promise<void> {
    httpClient.setPlusToken(plusToken);
    await storage.setString(StorageKeys.PLUS_TOKEN, plusToken);
  }

  /**
   * Clear all tokens
   */
  public async clearTokens(): Promise<void> {
    httpClient.clearTokens();
    await storage.delete(StorageKeys.TOKEN);
    await storage.delete(StorageKeys.PLUS_TOKEN);
  }

  /**
   * Handle API error response
   */
  private handleError(error: Object): never {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError('UNKNOWN', String(error));
  }

  // ==================== Auth APIs ====================

  /**
   * Login with username/email and password
   */
  public async login(username: string, password: string): Promise<ApiResponse<LoginResponse>> {
    try {
      const response = await httpClient.post<ApiResponse<LoginResponse>>(
        API_ENDPOINTS.AUTH_LOGIN,
        { username, password }
      );

      if (response.data.code === 200) {
        await this.setToken(response.data.data.token);
      }

      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  /**
   * Check authentication status
   */
  public async check(): Promise<ApiResponse<User>> {
    try {
      const response = await httpClient.get<ApiResponse<User>>(API_ENDPOINTS.AUTH_CHECK);
      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  /**
   * Logout
   */
  public async logout(): Promise<void> {
    try {
      await httpClient.post(API_ENDPOINTS.AUTH_LOGOUT);
    } catch (e) {
      // Ignore logout errors
    } finally {
      await this.clearTokens();
    }
  }

  // ==================== Member APIs ====================

  /**
   * Login with plus token
   */
  public async memberLogin(plusToken: string): Promise<ApiResponse<PlusLoginResponse>> {
    try {
      const response = await httpClient.post<ApiResponse<PlusLoginResponse>>(
        API_ENDPOINTS.MEMBER_LOGIN,
        { plusToken }
      );

      if (response.data.code === 200) {
        await this.setPlusToken(response.data.data.plusToken);
      }

      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  /**
   * Get member info
   */
  public async getMemberInfo(): Promise<ApiResponse<User>> {
    try {
      const response = await httpClient.get<ApiResponse<User>>(API_ENDPOINTS.MEMBER_INFO);
      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  /**
   * Get member benefits
   */
  public async getMemberBenefits(): Promise<ApiResponse<string[]>> {
    try {
      const response = await httpClient.get<ApiResponse<string[]>>(API_ENDPOINTS.MEMBER_BENEFITS);
      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  // ==================== Password APIs ====================

  /**
   * Request password reset
   */
  public async forgotPassword(email: string): Promise<ApiResponse<Object>> {
    try {
      const response = await httpClient.post<ApiResponse<Object>>(API_ENDPOINTS.FORGOT_PASSWORD, { email });
      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  /**
   * Reset password with token
   */
  public async resetPassword(token: string, newPassword: string): Promise<ApiResponse<Object>> {
    try {
      const response = await httpClient.post<ApiResponse<Object>>(API_ENDPOINTS.RESET_PASSWORD, { token, newPassword });
      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  // ==================== Track APIs ====================

  /**
   * Get latest tracks
   */
  public async getLatestTracks(category: string = 'MUSIC', includeUser: boolean = false,
    limit: number = 50): Promise<ApiResponse<Track[]>> {
    try {
      const response = await httpClient.get<ApiResponse<Track[]>>(API_ENDPOINTS.TRACK_LATEST, {
        "category",
        "includeUser",
        "limit"
      });
      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  /**
   * Search tracks
   */
  public async searchTracks(query: string, page: number = 0,
    pageSize: number = 20): Promise<ApiResponse<TrackListResponse>> {
    try {
      const response = await httpClient.get<ApiResponse<TrackListResponse>>(API_ENDPOINTS.TRACK_SEARCH, {
        "q": query,
        "page",
        "pageSize"
      });
      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  /**
   * Get track history
   */
  public async getTrackHistory(userId: number, page: number = 0, pageSize: number = 50,
    category: string = 'MUSIC'): Promise<ApiResponse<GeneratedTypeLiteralInterface_1>> {
    try {
      const response = await httpClient.get<ApiResponse<GeneratedTypeLiteralInterface_1>>(
        API_ENDPOINTS.TRACK_HISTORY,
        {
          "userId",
          "page",
          "pageSize",
          "category"
        }
      );
      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  // ==================== Playlist APIs ====================

  /**
   * Get playlist detail with tracks
   */
  public async getPlaylistById(id: number): Promise<ApiResponse<PlaylistDetailResponse>> {
    try {
      const url = API_ENDPOINTS.PLAYLIST_DETAIL.replace(':id', String(id));
      const response = await httpClient.get<ApiResponse<PlaylistDetailResponse>>(url);
      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  // ==================== Album APIs ====================

  /**
   * Get album detail with tracks
   */
  public async getAlbumById(id: number): Promise<ApiResponse<AlbumDetailResponse>> {
    try {
      const url = API_ENDPOINTS.ALBUM_DETAIL.replace(':id', String(id));
      const response = await httpClient.get<ApiResponse<AlbumDetailResponse>>(url);
      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  /**
   * Get album tracks
   */
  public async getAlbumTracks(albumId: number, pageSize: number = 1000,
    page: number = 0): Promise<ApiResponse<TrackListResponse>> {
    try {
      const url = API_ENDPOINTS.ALBUM_TRACKS.replace(':id', String(albumId));
      const response = await httpClient.get<ApiResponse<TrackListResponse>>(url, { "pageSize", "page" });
      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  /**
   * Get album history
   */
  public async getAlbumHistory(userId: number, page: number = 0, pageSize: number = 50,
    category: string = 'AUDIOBOOK'): Promise<ApiResponse<GeneratedTypeLiteralInterface_3>> {
    try {
      const response = await httpClient.get<ApiResponse<GeneratedTypeLiteralInterface_5>>(
        API_ENDPOINTS.ALBUM_HISTORY,
        {
          "userId",
          "page",
          "pageSize",
          "category"
        }
      );
      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  // ==================== Search APIs ====================

  /**
   * Search all content
   */
  public async search(query: string): Promise<ApiResponse<SearchResult>> {
    try {
      const response = await httpClient.get<ApiResponse<SearchResult>>(API_ENDPOINTS.SEARCH_ALL, { "q": query });
      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  // ==================== Like/Unlike ====================

  /**
   * Like a track
   */
  public async likeTrack(trackId: number, userId: number): Promise<ApiResponse<Object>> {
    try {
      const url = `/tracks/${trackId}/like`;
      const response = await httpClient.post<ApiResponse<Object>>(url, { userId });
      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }

  /**
   * Unlike a track
   */
  public async unlikeTrack(trackId: number, userId: number): Promise<ApiResponse<Object>> {
    try {
      const url = `/tracks/${trackId}/unlike`;
      const response = await httpClient.post<ApiResponse<Object>>(url, { userId });
      return response.data;
    } catch (e) {
      this.handleError(e);
    }
  }
}

// ==================== Singleton Export ====================
export const apiService = ApiService.getInstance();
