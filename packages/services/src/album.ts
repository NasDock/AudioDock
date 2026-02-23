import { getAdapter } from "./adapter/manager";
import type {
    Album
} from "./models";
  
  export const getAlbumList = () => {
    return getAdapter().album.getAlbumList();
  };
  
  export const getAlbumTableList = (params: {
    pageSize: number;
    current: number;
  }) => {
    return getAdapter().album.getAlbumTableList(params);
  };
  
  export const loadMoreAlbum = (params: {
    pageSize: number;
    loadCount: number;
    type?: string;
  }) => {
    return getAdapter().album.loadMoreAlbum(params);
  };
  
  export const createAlbum = (data: Omit<Album, "id">) => {
    return getAdapter().album.createAlbum(data);
  };
  
  export const updateAlbum = (id: number | string, data: Partial<Album>) => {
    return getAdapter().album.updateAlbum(id, data);
  };
  
  export const deleteAlbum = (id: number | string) => {
    return getAdapter().album.deleteAlbum(id);
  };
  
  export const batchCreateAlbums = (data: Omit<Album, "id">[]) => {
    return getAdapter().album.batchCreateAlbums(data);
  };
  
  export const batchDeleteAlbums = (ids: (number | string)[]) => {
    return getAdapter().album.batchDeleteAlbums(ids);
  };
  
  // Get recommended albums (8 random unlistened albums)
  export const getRecommendedAlbums = (type?: string, random?: boolean, pageSize?: number) => {
    return getAdapter().album.getRecommendedAlbums(type, random, pageSize);
  };
  
  // Get recent albums (8 latest albums)
  export const getRecentAlbums = (type?: string, random?: boolean, pageSize?: number) => {
    return getAdapter().album.getRecentAlbums(type, random, pageSize);
  };
  
  // Get album details by ID
  export const getAlbumById = (id: number | string) => {
    return getAdapter().album.getAlbumById(id);
  };
  
  // Get album tracks with pagination
  export const getAlbumTracks = (
    id: number | string,
    pageSize: number,
    skip: number,
    sort: "asc" | "desc" = "asc",
    keyword?: string,
    userId?: number | string,
    sortBy?: string,
  ) => {
    return getAdapter().album.getAlbumTracks(id, pageSize, skip, sort, keyword, userId, sortBy);
  };
  
  export const getAlbumsByArtist = (artist: string) => {
    return getAdapter().album.getAlbumsByArtist(artist);
  };
  
  export const getCollaborativeAlbumsByArtist = (artist: string) => {
    return getAdapter().album.getCollaborativeAlbumsByArtist(artist);
  };
  
  export const toggleAlbumLike = (id: number | string, userId: number | string) => {
    return getAdapter().album.toggleLike(id, userId);
  };
  
  export const toggleAlbumUnLike = (id: number | string, userId: number | string) => {
    return getAdapter().album.toggleUnLike(id, userId);
  };

  export const getFavoriteAlbums = (userId: number | string, loadCount: number, pageSize: number, type?: string) => {
    return getAdapter().album.getFavoriteAlbums(userId, loadCount, pageSize, type);
  };
