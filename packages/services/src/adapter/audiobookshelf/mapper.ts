import type { Album, Artist, Track } from "../../models";
import { TrackType } from "../../models";
import type { AudiobookshelfClient } from "./client";
import type { AbsAudioFile, AbsLibraryItem } from "./types";

/** 一本书的标题（列表/详情结构差异都兼容） */
export const absTitle = (item: AbsLibraryItem): string =>
  item?.media?.metadata?.title ||
  item?.media?.metadata?.titleIgnorePrefix ||
  "未命名有声书";

/** 作者名：老版本直接 authorName，新版本 authors[] */
export const absAuthorName = (item: AbsLibraryItem): string =>
  item?.media?.metadata?.authorName ||
  item?.media?.metadata?.authors?.[0]?.name ||
  "未知作者";

export const absAuthorId = (item: AbsLibraryItem): string =>
  item?.media?.metadata?.authors?.[0]?.id || absAuthorName(item);

export const toDate = (ms?: number): string =>
  ms ? new Date(ms).toISOString() : new Date(0).toISOString();

export const mapAbsItemToAlbum = (
  item: AbsLibraryItem,
  client: AudiobookshelfClient,
): Album => {
  const cover = item?.media?.coverPath ? client.getCoverUrl(item.id) : null;
  return {
    id: item.id,
    name: absTitle(item),
    artist: absAuthorName(item),
    cover,
    year: item?.media?.metadata?.publishedYear || null,
    type: TrackType.AUDIOBOOK,
    likedByUsers: [],
    listenedByUsers: [],
    progress: 0,
    resumeTrackId: null,
    resumeProgress: null,
  };
};

/**
 * 一个音频文件映射成一条 Track。
 *
 * ABS 的音频在 `media.audioFiles[]`。流地址按优先级：
 * 1. `/api/items/{id}/file/{ino}` —— v2.38 的原始文件路由，鉴权 + Range 支持
 * 2. `media.tracks[].contentUrl` —— 服务端给的静态直链（部分响应才有 tracks）
 * 3. `/api/items/{id}/stream?file=` —— 旧服务端遗留（v2.38 已 404，仅兜底）
 */
export const mapAbsAudioFileToTrack = (
  item: AbsLibraryItem,
  file: AbsAudioFile,
  client: AudiobookshelfClient,
  chapterTitle?: string,
  streamIndex?: number,
): Track => {
  const id = `${item.id}:${file.index}`;
  const name = chapterTitle || file?.metadata?.filename || `音轨 ${file.index + 1}`;
  const author = absAuthorName(item);
  const cover = item?.media?.coverPath ? client.getCoverUrl(item.id) : null;
  const contentUrl = item?.media?.tracks?.find((track) => track.index === file.index)?.contentUrl;
  const stream =
    file.ino !== undefined && file.ino !== null
      ? client.getFileUrl(item.id, file.ino)
      : contentUrl
        ? client.getMediaUrl(contentUrl)
        : client.getStreamUrl(item.id, streamIndex ?? file.index);

  return {
    id,
    name,
    path: stream,
    artist: author,
    artistEntity: {
      id: absAuthorId(item),
      name: author,
      avatar: cover,
      type: TrackType.AUDIOBOOK,
    },
    album: absTitle(item),
    albumEntity: {
      id: item.id,
      name: absTitle(item),
      artist: author,
      cover,
      year: item?.media?.metadata?.publishedYear || null,
      type: TrackType.AUDIOBOOK,
    },
    cover,
    duration: file?.duration || item?.media?.duration || 0,
    lyrics: null,
    index: file.index + 1,
    type: TrackType.AUDIOBOOK,
    createdAt: toDate(item?.addedAt),
    artistId: undefined,
    albumId: undefined,
    folderId: undefined,
    likedByUsers: [],
    listenedByUsers: [],
    likedAsAudiobookByUsers: [],
    listenedAsAudiobookByUsers: [],
    playlists: [],
    progress: 0,
  } as Track;
};

export const mapAbsItemToTracks = (
  item: AbsLibraryItem,
  client: AudiobookshelfClient,
): Track[] => {
  const audioFiles = item?.media?.audioFiles || [];
  if (audioFiles.length) {
    // 实测 index 从 1 开始；老版本可能从 0 开始，按首条自适应
    const oneBased = audioFiles[0]?.index === 1;
    // 有章节时用章节名作为音轨名，听感上更接近有声书
    const chapters = item?.media?.chapters || [];
    return audioFiles.map((file, i) =>
      mapAbsAudioFileToTrack(
        item,
        file,
        client,
        chapters[i]?.title,
        oneBased ? file.index - 1 : file.index,
      ),
    );
  }
  // 只有 tracks（精简响应）时按同样规则构造
  const tracks = item?.media?.tracks || [];
  const oneBased = tracks[0]?.index === 1;
  return tracks.map((track) =>
    mapAbsAudioFileToTrack(
      item,
      { index: track.index, duration: track.duration, mimeType: track.mimeType },
      client,
      track.title,
      oneBased ? track.index - 1 : track.index,
    ),
  );
};

export const mapAbsItemToArtist = (
  item: AbsLibraryItem,
  client: AudiobookshelfClient,
): Artist => ({
  id: absAuthorId(item),
  name: absAuthorName(item),
  avatar: item?.media?.coverPath ? client.getCoverUrl(item.id) : null,
  type: TrackType.AUDIOBOOK,
  bg_cover: null,
  description: item?.media?.metadata?.description || null,
});
