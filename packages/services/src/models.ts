export interface ISuccessResponse<T> {
  code: number;
  message: string;
  data: T;
}

export enum TrackType {
  MUSIC = "MUSIC",
  AUDIOBOOK = "AUDIOBOOK",
}

export interface IErrorResponse {
  code: number;
  message: string;
}

export interface ITableData<T> {
  pageSize: number;
  current: number;
  list: T;
  total: number;
}

export interface ILoadMoreData<T> {
  pageSize: number;
  loadCount: number;
  list: T[];
  total: number;
  hasMore: boolean;
}

export interface RecommendedItem {
  title: string
  id: string
  items: Album[]
}

export interface TimelineItem {
  id: string
  time: number
  items: (Album | Track)[]
}

// Prisma Models

export interface Track {
  id: number | string;
  name: string;
  path: string;
  artist: string;
  artistEntity: Artist;
  album: string;
  albumEntity: Album;
  cover: string | null;
  duration: number | null;
  lyrics: string | null;
  index: number | null;
  type: TrackType;
  createdAt: string | Date; // DateTime in Prisma maps to Date object or ISO string in JSON
  artistId?: number | string;
  albumId?: number | string;
  folderId?: number | string;
  likedByUsers?: UserTrackLike[];
  listenedByUsers?: UserTrackHistory[];
  likedAsAudiobookByUsers?: UserAudiobookLike[];
  listenedAsAudiobookByUsers?: UserAudiobookHistory[];
  playlists?: Playlist[];
  progress?: number;
}

export interface Album {
  id: number | string;
  name: string;
  artist: string;
  cover: string | null;
  year: string | null;
  type: TrackType;
  likedByUsers?: UserAlbumLike[];
  listenedByUsers?: UserAlbumHistory[];
  progress?: number;
  resumeTrackId?: number | string | null;
  resumeProgress?: number | null;
}

export interface Artist {
  id: number | string;
  name: string;
  avatar: string | null;
  type: TrackType;
  bg_cover?: string | null;
  description?: string | null;
}

export interface UserTrackLike {
  id: number | string;
  userId: number | string;
  trackId: number | string;
  createdAt: string | Date;
  user?: User;
  track?: Track;
}

export interface UserTrackHistory {
  id: number | string;
  userId: number | string;
  trackId: number | string;
  listenedAt: string | Date;
  user?: User;
  track?: Track;
}

export interface UserAlbumLike {
  id: number | string;
  userId: number | string;
  albumId: number | string;
  createdAt: string | Date;
  user?: User;
  album?: Album;
}

export interface UserAlbumHistory {
  id: number | string;
  userId: number | string;
  albumId: number | string;
  listenedAt: string | Date;
  user?: User;
  album?: Album;
}

export interface UserAudiobookLike {
  id: number | string;
  userId: number | string;
  trackId: number | string;
  createdAt: string | Date;
  user?: User;
  track?: Track;
}

export interface UserAudiobookHistory {
  id: number | string;
  userId: number | string;
  trackId: number | string;
  listenedAt: string | Date;
  progress: number;
  user?: User;
  track?: Track;
}

export interface User {
  id: number | string;
  username: string;
  password?: string;
  avatar?: string | null;
  is_admin: boolean;
  expiresAt?: string | Date | null;
  createdAt?: string | Date;
  likedTracks?: UserTrackLike[];
  listenedTracks?: UserTrackHistory[];
  likedAlbums?: UserAlbumLike[];
  listenedAlbums?: UserAlbumHistory[];
  likedAudiobooks?: UserAudiobookLike[];
  listenedAudiobooks?: UserAudiobookHistory[];
  playlists?: Playlist[];
}

export interface Playlist {
  id: number | string;
  name: string;
  type: TrackType;
  createdAt: string | Date;
  updatedAt: string | Date;
  userId: number | string;
  user?: User;
  tracks?: Track[];
  _count?: {
    tracks: number;
  };
}
export interface Device {
  id: number | string;
  name: string;
  userId: number | string;
  isOnline: boolean;
  lastSeen?: string | Date;
  createdAt: Date;
  updatedAt: Date;
}
export interface Folder {
  id: number | string;
  path: string;
  name: string;
  parentId: number | string | null;
  type: TrackType;
  children?: Folder[];
  tracks?: Track[];
}
