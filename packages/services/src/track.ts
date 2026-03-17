import { getAdapter } from "./adapter/manager";
import type {
    Track
} from "./models";
  
  export const getTrackList = () => {
    return getAdapter().track.getTrackList();
  };
  
  export const getTrackTableList = (params: {
    pageSize: number;
    current: number;
  }) => {
    return getAdapter().track.getTrackTableList(params);
  };
  
  export const loadMoreTrack = (params: {
    pageSize: number;
    loadCount: number;
    type?: string;
    sortBy?: string;
  }) => {
    return getAdapter().track.loadMoreTrack(params);
  };
  
  export const createTrack = (data: Omit<Track, "id">) => {
    return getAdapter().track.createTrack(data);
  };
  
  export const updateTrack = (id: number | string, data: Partial<Track>) => {
    return getAdapter().track.updateTrack(id, data);
  };
  
  export const deleteTrack = (id: number | string, deleteAlbum: boolean = false) => {
    return getAdapter().track.deleteTrack(id, deleteAlbum);
  };
  
  export const getDeletionImpact = (id: number | string) => {
    return getAdapter().track.getDeletionImpact(id);
  };
  
  export const batchCreateTracks = (data: Omit<Track, "id">[]) => {
    return getAdapter().track.batchCreateTracks(data);
  };
  
  export const batchDeleteTracks = (ids: (number | string)[]) => {
    return getAdapter().track.batchDeleteTracks(ids);
  };
  
  export const getLatestTracks = (type?: string, random?: boolean, pageSize?: number) => {
    return getAdapter().track.getLatestTracks(type, random, pageSize);
  };

  export const getRecommendedTracks = (type?: string, pageSize?: number, likeRatio?: number) => {
    return getAdapter().track.getRecommendedTracks(type, pageSize, likeRatio);
  };
  
  export const getTracksByArtist = (artist: string) => {
    return getAdapter().track.getTracksByArtist(artist);
  };
  
  export const toggleTrackLike = (id: number | string, userId: number | string) => {
    return getAdapter().track.toggleLike(id, userId);
  };
  
  export const toggleTrackUnLike = (id: number | string, userId: number | string) => {
    return getAdapter().track.toggleUnLike(id, userId);
  };

  export const getFavoriteTracks = (userId: number | string, loadCount: number, pageSize: number, type?: string) => {
    return getAdapter().track.getFavoriteTracks(userId, loadCount, pageSize, type);
  };
  
  export const getTrackLyrics = (id: number | string) => {
    return getAdapter().track.getLyrics(id);
  };
