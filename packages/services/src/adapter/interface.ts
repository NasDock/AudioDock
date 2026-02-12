import { Album, Artist, ILoadMoreData, ISuccessResponse, ITableData, Playlist, Track } from "../models";

export interface ITrackAdapter {
  getTrackList(): Promise<ISuccessResponse<Track[]>>;
  getAllTracks(): Promise<ISuccessResponse<Track[]>>;
  getTrackTableList(params: { pageSize: number; current: number }): Promise<ISuccessResponse<ITableData<Track[]>>>;
  loadMoreTrack(params: { pageSize: number; loadCount: number; type?: string }): Promise<ISuccessResponse<ILoadMoreData<Track>>>;
  createTrack(data: Omit<Track, "id">): Promise<ISuccessResponse<Track>>;
  updateTrack(id: number | string, data: Partial<Track>): Promise<ISuccessResponse<Track>>;
  deleteTrack(id: number | string, deleteAlbum?: boolean): Promise<ISuccessResponse<boolean>>;
  getDeletionImpact(id: number | string): Promise<ISuccessResponse<{ isLastTrackInAlbum: boolean; albumName: string | null }>>;
  batchCreateTracks(data: Omit<Track, "id">[]): Promise<ISuccessResponse<boolean>>;
  batchDeleteTracks(ids: (number | string)[]): Promise<ISuccessResponse<boolean>>;
  getLatestTracks(type?: string, random?: boolean, pageSize?: number): Promise<ISuccessResponse<Track[]>>;
  getTracksByArtist(artist: string): Promise<ISuccessResponse<Track[]>>;
  toggleLike(id: number | string, userId: number | string): Promise<ISuccessResponse<any>>;
  toggleUnLike(id: number | string, userId: number | string): Promise<ISuccessResponse<any>>;
  getFavoriteTracks(userId: number | string, loadCount: number, pageSize: number, type?: string): Promise<ISuccessResponse<ILoadMoreData<{ track: Track, createdAt: string | Date }>>>;
  getLyrics(id: number | string): Promise<ISuccessResponse<string | null>>;
}

export interface IAlbumAdapter {
  getAlbumList(): Promise<ISuccessResponse<Album[]>>;
  getAlbumTableList(params: { pageSize: number; current: number }): Promise<ISuccessResponse<ITableData<Album[]>>>;
  loadMoreAlbum(params: { pageSize: number; loadCount: number; type?: string }): Promise<ISuccessResponse<ILoadMoreData<Album>>>;
  createAlbum(data: Omit<Album, "id">): Promise<ISuccessResponse<Album>>;
  updateAlbum(id: number | string, data: Partial<Album>): Promise<ISuccessResponse<Album>>;
  deleteAlbum(id: number | string): Promise<ISuccessResponse<boolean>>;
  batchCreateAlbums(data: Omit<Album, "id">[]): Promise<ISuccessResponse<boolean>>;
  batchDeleteAlbums(ids: (number | string)[]): Promise<ISuccessResponse<boolean>>;
  getRecommendedAlbums(type?: string, random?: boolean, pageSize?: number): Promise<ISuccessResponse<Album[]>>;
  getRecentAlbums(type?: string, random?: boolean, pageSize?: number): Promise<ISuccessResponse<Album[]>>;
  getAlbumById(id: number | string): Promise<ISuccessResponse<Album>>;
  getAlbumTracks(id: number | string, pageSize: number, skip: number, sort?: "asc" | "desc", keyword?: string, userId?: number | string, sortBy?: string): Promise<ISuccessResponse<{ list: any[]; total: number }>>;
  getAlbumsByArtist(artist: string): Promise<ISuccessResponse<Album[]>>;
  getCollaborativeAlbumsByArtist(artist: string): Promise<ISuccessResponse<Album[]>>;
  toggleLike(id: number | string, userId: number | string): Promise<ISuccessResponse<any>>;
  toggleUnLike(id: number | string, userId: number | string): Promise<ISuccessResponse<any>>;
  getFavoriteAlbums(userId: number | string, loadCount: number, pageSize: number, type?: string): Promise<ISuccessResponse<ILoadMoreData<{ album: Album, createdAt: string | Date }>>>;
}

export interface IArtistAdapter {
  getArtistList(pageSize: number, loadCount: number, type?: string): Promise<ISuccessResponse<ILoadMoreData<Artist>>>;
  getArtistTableList(params: { pageSize: number; current: number }): Promise<ISuccessResponse<ITableData<Artist[]>>>;
  loadMoreArtist(params: { pageSize: number; loadCount: number }): Promise<ISuccessResponse<ILoadMoreData<Artist>>>;
  createArtist(data: Omit<Artist, "id">): Promise<ISuccessResponse<Artist>>;
  updateArtist(id: number | string, data: Partial<Artist>): Promise<ISuccessResponse<Artist>>;
  deleteArtist(id: number | string): Promise<ISuccessResponse<boolean>>;
  batchCreateArtists(data: Omit<Artist, "id">[]): Promise<ISuccessResponse<boolean>>;
  batchDeleteArtists(ids: (number | string)[]): Promise<ISuccessResponse<boolean>>;
  getArtistById(id: number | string): Promise<ISuccessResponse<Artist>>;
  getLatestArtists(type: string, random?: boolean, pageSize?: number): Promise<ISuccessResponse<Artist[]>>;
}

export interface IPlaylistAdapter {
  createPlaylist(name: string, type: "MUSIC" | "AUDIOBOOK", userId: number | string): Promise<ISuccessResponse<Playlist>>;
  getPlaylists(type?: "MUSIC" | "AUDIOBOOK", userId?: number | string): Promise<ISuccessResponse<Playlist[]>>;
  getPlaylistById(id: number | string): Promise<ISuccessResponse<Playlist>>;
  updatePlaylist(id: number | string, name: string): Promise<ISuccessResponse<Playlist>>;
  deletePlaylist(id: number | string): Promise<ISuccessResponse<boolean>>;
  addTrackToPlaylist(playlistId: number | string, trackId: number | string): Promise<ISuccessResponse<boolean>>;
  addTracksToPlaylist(playlistId: number | string, trackIds: (number | string)[]): Promise<ISuccessResponse<boolean>>;
  removeTrackFromPlaylist(playlistId: number | string, trackId: number | string): Promise<ISuccessResponse<boolean>>;
}

import { IAuthAdapter, IUserAdapter } from "./interface-user-auth";

// ... existing code ...

export interface IMusicAdapter {
  track: ITrackAdapter;
  album: IAlbumAdapter;
  artist: IArtistAdapter;
  playlist: IPlaylistAdapter;
  user: IUserAdapter;
  auth: IAuthAdapter;
}

