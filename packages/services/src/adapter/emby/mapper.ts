import { Album, Artist, Track, TrackType } from "../../models";
import { EmbyItem } from "./types";
import { inferTrackTypeFromItem } from "./media";

export const mapEmbyItemToTrack = (
  item: EmbyItem,
  coverUrlBuilder: (id: string, tag?: string) => string,
  streamUrlBuilder: (id: string) => string,
  type?: TrackType
): Track => {
  const resolvedType = type || inferTrackTypeFromItem(item, TrackType.MUSIC);
  const artistName = item.Artists?.[0] || item.ArtistItems?.[0]?.Name || "Unknown Artist";
  const artistId = item.ArtistItems?.[0]?.Id || "0";
  const primaryImageTag = item.ImageTags?.Primary || item.PrimaryImageTag;
  const primaryImageId = item.PrimaryImageItemId || (item.ItemIds && item.ItemIds.length > 0 ? item.ItemIds[0] : item.Id);
  
  return {
    id: item.Id,
    name: item.Name,
    path: streamUrlBuilder(item.Id),
    artist: artistName,
    artistEntity: {
      id: artistId,
      name: artistName,
      avatar: null,
      type: resolvedType,
    },
    album: item.Album || "Unknown Album",
    albumEntity: {
      id: item.AlbumId || "0",
      name: item.Album || "Unknown Album",
      artist: artistName,
      cover: item.AlbumId ? coverUrlBuilder(item.AlbumId, item.AlbumPrimaryImageTag) : null,
      year: item.ProductionYear?.toString() || null,
      type: resolvedType,
    },
    cover: (primaryImageTag || item.PrimaryImageItemId)
      ? coverUrlBuilder(primaryImageId, primaryImageTag)
      : (item.AlbumPrimaryImageTag ? coverUrlBuilder(item.AlbumId!, item.AlbumPrimaryImageTag) : null),
    duration: item.RunTimeTicks ? Math.floor(item.RunTimeTicks / 10000000) : 0, // Emby ticks are 100ns
    lyrics: null,
    index: item.IndexNumber || null,
    type: resolvedType,
    createdAt: new Date().toISOString(),
    artistId: artistId,
    albumId: item.AlbumId,
    likedByUsers: [],
    listenedByUsers: [],
    likedAsAudiobookByUsers: [],
    listenedAsAudiobookByUsers: [],
    playlists: [],
    progress: 0,
  };
};

export const mapEmbyItemToAlbum = (
  item: EmbyItem,
  coverUrlBuilder: (id: string, tag?: string) => string,
  type?: TrackType
): Album => {
  const resolvedType = type || inferTrackTypeFromItem(item, TrackType.MUSIC);
  const primaryImageTag = item.ImageTags?.Primary || item.PrimaryImageTag;
  const primaryImageId = item.PrimaryImageItemId || (item.ItemIds && item.ItemIds.length > 0 ? item.ItemIds[0] : item.Id);

  return {
    id: item.Id,
    name: item.Name,
    artist: item.Artists?.[0] || item.ArtistItems?.[0]?.Name || "Unknown Artist",
    cover: (primaryImageTag || item.PrimaryImageItemId) ? coverUrlBuilder(primaryImageId, primaryImageTag) : null,
    year: item.ProductionYear?.toString() || null,
    type: resolvedType,
    likedByUsers: [],
    listenedByUsers: [],
    progress: 0,
    resumeTrackId: null,
    resumeProgress: null,
  };
};

export const mapEmbyItemToArtist = (
  item: EmbyItem,
  coverUrlBuilder: (id: string, tag?: string) => string,
  type?: TrackType
): Artist => {
  const resolvedType = type || inferTrackTypeFromItem(item, TrackType.MUSIC);
  const primaryImageTag = item.ImageTags?.Primary || item.PrimaryImageTag;
  const primaryImageId = item.PrimaryImageItemId || (item.ItemIds && item.ItemIds.length > 0 ? item.ItemIds[0] : item.Id);

  return {
    id: item.Id,
    name: item.Name,
    avatar: (primaryImageTag || item.PrimaryImageItemId) ? coverUrlBuilder(primaryImageId, primaryImageTag) : null,
    type: resolvedType,
    bg_cover: null,
    description: null,
  };
};
