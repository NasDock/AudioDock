export interface EmbyItem {
  Name: string;
  ServerId: string;
  Id: string;
  CollectionType?: string;
  RunTimeTicks?: number;
  ProductionYear?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  IsFolder: boolean;
  Type: string;
  UserData?: {
    Played: boolean;
    PlaybackPositionTicks: number;
    PlayCount: number;
    IsFavorite: boolean;
  };
  Artists?: string[];
  ArtistItems?: { Name: string; Id: string }[];
  Album?: string;
  AlbumId?: string;
  AlbumPrimaryImageTag?: string;
  PrimaryImageTag?: string;
  PrimaryImageItemId?: string;
  ItemIds?: string[];
  ImageTags?: {
    Primary?: string;
  };
  MediaSources?: any[];
}

export interface EmbyItemsResponse {
  Items: EmbyItem[];
  TotalRecordCount: number;
}

export interface EmbyAuthResponse {
  User: {
    Name: string;
    Id: string;
  };
  AccessToken: string;
}
