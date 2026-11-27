export interface SubsonicResponse<T> {
  "subsonic-response": {
    status: "ok" | "failed";
    version: string;
    type?: string;
    serverVersion?: string;
    error?: {
      code: number;
      message: string;
    };
  } & T;
}

export interface SubsonicChild {
  id: string;
  parent?: string;
  isDir: boolean;
  title: string;
  album?: string;
  artist?: string;
  track?: number;
  year?: number;
  genre?: string;
  coverArt?: string;
  size?: number;
  contentType?: string;
  suffix?: string;
  duration?: number;
  bitRate?: number;
  path?: string;
  isVideo?: boolean;
  playCount?: number;
  created?: string;
  albumId?: string;
  artistId?: string;
  type?: string;
  starred?: string;
}

export interface SubsonicAlbum {
  id: string;
  name: string;
  artist: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  duration?: number;
  playCount?: number;
  created?: string;
  year?: number;
  genre?: string;
  starred?: string;
}

export interface SubsonicArtist {
  id: string;
  name: string;
  coverArt?: string;
  albumCount?: number;
}

export interface SubsonicDirectory {
  id: string;
  parent?: string;
  name: string;
  star?: string; // date
  child?: SubsonicChild[];
}

export interface SubsonicAlbumList {
  albumList2: {
    album: SubsonicAlbum[];
  };
  albumList: {
    album: SubsonicAlbum[];
  };
}

export interface SubsonicRandomSongs {
  randomSongs: {
    song: SubsonicChild[];
  };
}

export interface SubsonicArtistList {
  artists: {
    index: {
      name: string;
      artist: SubsonicArtist[];
    }[];
  };
}

export interface SubsonicArtistInfo {
   artist: SubsonicArtist;
}

export interface SubsonicAlbumInfo {
    album: SubsonicAlbum & { song: SubsonicChild[] };
}

/**
 * Subsonic search3 响应（Navidrome 支持）。
 *
 * 一次请求同时返回 artist / album / song 三组结果，老服务端可能只有 search2，
 * 两个结构一致，这里一起声明以便回退。
 */
export interface SubsonicSearchResult {
  searchResult3?: {
    artist?: SubsonicArtist[];
    album?: SubsonicAlbum[];
    song?: SubsonicChild[];
  };
  searchResult2?: {
    artist?: SubsonicArtist[];
    album?: SubsonicAlbum[];
    song?: SubsonicChild[];
  };
}

export interface SubsonicPlaylistList {
  playlists?: {
    playlist?: Array<{
      id: string;
      name: string;
      created?: string;
      changed?: string;
      songCount?: number;
    }>;
  };
}
