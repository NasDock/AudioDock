import { Album, AlbumTrackSortBy, Artist, AudiobookCollection, AudiobookCollectionAlbum, ILoadMoreData, ISuccessResponse, ITableData, Playlist, Track, Mv } from "../models";

export interface IMvAdapter {
  getMvList(pageSize: number, skip: number, keyword?: string): Promise<{ list: Mv[]; total: number }>;
  getMvById(id: number | string): Promise<Mv | null>;
  getMvsByArtist(artist: string): Promise<Mv[]>;
  getMvsByAlbum(album: string, artist: string): Promise<Mv[]>;
  getMvByTrackId(trackId: number | string): Promise<Mv | null>;
  getRandomMvs(limit: number): Promise<Mv[]>;
}

export interface ITrackAdapter {
  getTrackList(): Promise<ISuccessResponse<Track[]>>;
  getAllTracks(): Promise<ISuccessResponse<Track[]>>;
  getTrackTableList(params: { pageSize: number; current: number }): Promise<ISuccessResponse<ITableData<Track[]>>>;
  loadMoreTrack(params: { pageSize: number; loadCount: number; type?: string; sortBy?: string }): Promise<ISuccessResponse<ILoadMoreData<Track>>>;
  createTrack(data: Omit<Track, "id">): Promise<ISuccessResponse<Track>>;
  updateTrack(id: number | string, data: Partial<Track>): Promise<ISuccessResponse<Track>>;
  deleteTrack(id: number | string, deleteAlbum?: boolean): Promise<ISuccessResponse<boolean>>;
  getDeletionImpact(id: number | string): Promise<ISuccessResponse<{ isLastTrackInAlbum: boolean; albumName: string | null }>>;
  batchCreateTracks(data: Omit<Track, "id">[]): Promise<ISuccessResponse<boolean>>;
  batchDeleteTracks(ids: (number | string)[]): Promise<ISuccessResponse<boolean>>;
  getLatestTracks(type?: string, random?: boolean, pageSize?: number): Promise<ISuccessResponse<Track[]>>;
  getRecommendedTracks(type?: string, pageSize?: number, likeRatio?: number): Promise<ISuccessResponse<Track[]>>;
  /**
   * 不传 skip/pageSize 时返回全量 Track[]（向后兼容）；
   * 传了则返回 ILoadMoreData<Track> 给 useLoadMore 接入。
   * 用 overloads 让两种调用方各自得到精确的返回类型。
   */
  getTracksByArtist(artist: string): Promise<ISuccessResponse<Track[]>>;
  getTracksByArtist(artist: string, opts: { skip?: number; pageSize?: number }): Promise<ISuccessResponse<ILoadMoreData<Track>>>;
  toggleLike(id: number | string, userId: number | string): Promise<ISuccessResponse<any>>;
  toggleUnLike(id: number | string, userId: number | string): Promise<ISuccessResponse<any>>;
  getFavoriteTracks(userId: number | string, loadCount: number, pageSize: number, type?: string): Promise<ISuccessResponse<ILoadMoreData<{ track: Track, createdAt: string | Date }>>>;
  getLyrics(id: number | string): Promise<ISuccessResponse<string | null>>;
}

export interface IAlbumAdapter {
  getAlbumList(): Promise<ISuccessResponse<Album[]>>;
  getAlbumTableList(params: { pageSize: number; current: number }): Promise<ISuccessResponse<ITableData<Album[]>>>;
  loadMoreAlbum(params: { pageSize: number; loadCount: number; type?: string; sortBy?: string }): Promise<ISuccessResponse<ILoadMoreData<Album>>>;
  createAlbum(data: Omit<Album, "id">): Promise<ISuccessResponse<Album>>;
  updateAlbum(id: number | string, data: Partial<Album>): Promise<ISuccessResponse<Album>>;
  deleteAlbum(id: number | string): Promise<ISuccessResponse<boolean>>;
  batchCreateAlbums(data: Omit<Album, "id">[]): Promise<ISuccessResponse<boolean>>;
  batchDeleteAlbums(ids: (number | string)[]): Promise<ISuccessResponse<boolean>>;
  getRecommendedAlbums(type?: string, random?: boolean, pageSize?: number, likeRatio?: number): Promise<ISuccessResponse<Album[]>>;
  getRecentAlbums(type?: string, random?: boolean, pageSize?: number): Promise<ISuccessResponse<Album[]>>;
  getAlbumById(id: number | string): Promise<ISuccessResponse<Album>>;
  getAlbumTracks(id: number | string, pageSize: number, skip: number, sort?: "asc" | "desc", keyword?: string, userId?: number | string, sortBy?: AlbumTrackSortBy): Promise<ISuccessResponse<{ list: any[]; total: number }>>;
  getAlbumsByArtist(artist: string): Promise<ISuccessResponse<Album[]>>;
  getCollaborativeAlbumsByArtist(artist: string): Promise<ISuccessResponse<Album[]>>;
  uploadAlbumCover(id: number | string, file: any): Promise<ISuccessResponse<Album>>;
  toggleLike(id: number | string, userId: number | string): Promise<ISuccessResponse<any>>;
  toggleUnLike(id: number | string, userId: number | string): Promise<ISuccessResponse<any>>;
  getFavoriteAlbums(userId: number | string, loadCount: number, pageSize: number, type?: string): Promise<ISuccessResponse<ILoadMoreData<{ album: Album, createdAt: string | Date }>>>;
}

export interface IArtistAdapter {
  getArtistList(pageSize: number, loadCount: number, type?: string, sortBy?: string): Promise<ISuccessResponse<ILoadMoreData<Artist>>>;
  getArtistTableList(params: { pageSize: number; current: number }): Promise<ISuccessResponse<ITableData<Artist[]>>>;
  loadMoreArtist(params: { pageSize: number; loadCount: number }): Promise<ISuccessResponse<ILoadMoreData<Artist>>>;
  createArtist(data: Omit<Artist, "id">): Promise<ISuccessResponse<Artist>>;
  updateArtist(id: number | string, data: Partial<Artist>): Promise<ISuccessResponse<Artist>>;
  deleteArtist(id: number | string): Promise<ISuccessResponse<boolean>>;
  batchCreateArtists(data: Omit<Artist, "id">[]): Promise<ISuccessResponse<boolean>>;
  batchDeleteArtists(ids: (number | string)[]): Promise<ISuccessResponse<boolean>>;
  getArtistById(id: number | string): Promise<ISuccessResponse<Artist>>;
  getLatestArtists(type: string, random?: boolean, pageSize?: number): Promise<ISuccessResponse<Artist[]>>;
  uploadArtistAvatar(id: number | string, file: any): Promise<ISuccessResponse<Artist>>;
}

export interface IPlaylistAdapter {
  createPlaylist(name: string, type: "MUSIC" | "AUDIOBOOK", userId: number | string): Promise<ISuccessResponse<Playlist>>;
  getPlaylists(type?: "MUSIC" | "AUDIOBOOK", userId?: number | string): Promise<ISuccessResponse<Playlist[]>>;
  getPlaylistById(id: number | string): Promise<ISuccessResponse<Playlist>>;
  /**
   * 分页加载 playlist 内的 tracks；返回 ILoadMoreData<Track>，与 useLoadMore 配套。
   */
  getPlaylistTracksPaged(id: number | string, skip: number, pageSize: number): Promise<ISuccessResponse<ILoadMoreData<Track>>>;
  updatePlaylist(id: number | string, name: string): Promise<ISuccessResponse<Playlist>>;
  deletePlaylist(id: number | string): Promise<ISuccessResponse<boolean>>;
  addTrackToPlaylist(playlistId: number | string, trackId: number | string): Promise<ISuccessResponse<boolean>>;
  addTracksToPlaylist(playlistId: number | string, trackIds: (number | string)[]): Promise<ISuccessResponse<boolean>>;
  removeTrackFromPlaylist(playlistId: number | string, trackId: number | string): Promise<ISuccessResponse<boolean>>;
}

export interface IAudioCollectionAdapter {
  createCollection(userId: number | string, data: { name?: string; cover?: string | null; albumId?: number | string }): Promise<ISuccessResponse<AudiobookCollection>>;
  getCollections(userId: number | string): Promise<ISuccessResponse<AudiobookCollection[]>>;
  getCollectionById(id: number | string): Promise<ISuccessResponse<AudiobookCollection>>;
  updateCollection(id: number | string, data: { name?: string; cover?: string | null }): Promise<ISuccessResponse<AudiobookCollection>>;
  uploadCollectionCover(id: number | string, file: any): Promise<ISuccessResponse<AudiobookCollection>>;
  deleteCollection(id: number | string): Promise<ISuccessResponse<boolean>>;
  addAlbumToCollection(collectionId: number | string, albumId: number | string): Promise<ISuccessResponse<AudiobookCollectionAlbum | boolean>>;
  removeAlbumFromCollection(collectionId: number | string, albumId: number | string): Promise<ISuccessResponse<boolean>>;
  reorderCollection(collectionId: number | string, albumIds: (number | string)[]): Promise<ISuccessResponse<boolean>>;
  getCollectionMembership(albumId: number | string, userId: number | string): Promise<ISuccessResponse<number[]>>;
}

/**
 * 搜索能力（可选）。
 *
 * 目前只有飞牛音乐实现了它：native / subsonic / emby 在对接时都没有做搜索，
 * 调用方（`services/search.ts`）拿不到实现时会回退到官方服务端的 request，
 * 所以这里是**可选成员**，不要求每个适配器都实现。
 */
export interface ISearchAdapter {
  /** 曲目搜索。`limit` 是期望条数（不是翻页步长），`type` 用于 MUSIC/AUDIOBOOK 分流，非官方源可忽略 */
  searchTracks(keyword: string, limit?: number, type?: string): Promise<ISuccessResponse<Track[]>>;
  searchAlbums(keyword: string, limit?: number, type?: string): Promise<ISuccessResponse<Album[]>>;
  searchArtists(keyword: string, limit?: number, type?: string): Promise<ISuccessResponse<Artist[]>>;
  /** 歌单搜索：不支持的源直接返回空数组，不要抛错（UI 会把空数组当成「没有歌单结果」） */
  searchPlaylists(keyword: string, limit?: number): Promise<ISuccessResponse<Playlist[]>>;
}

/**
 * 搜索历史能力（可选）。
 *
 * 官方服务端有 `/search-record/*` 三件套；飞牛没有这类接口，走端侧本地存储。
 * 未实现时调用方回退到 request，行为与改造前一致。
 */
export interface ISearchRecordAdapter {
  addSearchRecord(keyword: string): Promise<ISuccessResponse<any>>;
  getSearchHistory(): Promise<ISuccessResponse<string[]>>;
  getHotSearches(): Promise<ISuccessResponse<{ keyword: string; count: number }[]>>;
  clearSearchHistory(): Promise<ISuccessResponse<any>>;
}

import { IAuthAdapter, IUserAdapter } from "./interface-user-auth";

// ... existing code ...

export interface IMusicAdapter {
  track: ITrackAdapter;
  album: IAlbumAdapter;
  artist: IArtistAdapter;
  playlist: IPlaylistAdapter;
  collection: IAudioCollectionAdapter;
  user: IUserAdapter;
  auth: IAuthAdapter;
  mv: IMvAdapter;
  /** 可选：未实现时 services 层回退到官方服务端接口 */
  search?: ISearchAdapter;
  /** 可选：未实现时 services 层回退到官方服务端接口 */
  searchRecord?: ISearchRecordAdapter;
}
