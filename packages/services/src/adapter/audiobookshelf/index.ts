import type { IMusicAdapter } from "../interface";
import { AudiobookshelfAlbumAdapter } from "./album";
import { AudiobookshelfArtistAdapter } from "./artist";
import { AudiobookshelfAuthAdapter, AudiobookshelfUserAdapter } from "./auth";
import { AudiobookshelfClient, type AudiobookshelfConfig } from "./client";
import { AudiobookshelfCollectionAdapter } from "./collection";
import { AbsItemStore } from "./items";
import { AudiobookshelfMvAdapter } from "./mv";
import { AudiobookshelfPlaylistAdapter } from "./playlist";
import { AudiobookshelfSearchAdapter } from "./search";
import { AudiobookshelfSearchRecordAdapter } from "./search-record";
import { AudiobookshelfTrackAdapter } from "./track";

/**
 * Audiobookshelf 数据源适配器（有声书模式）。
 *
 * 与 Subsonic/Navidrome 不同，它使用自有 REST API `/api` + Bearer token；
 * 所有映射出来的 Track/Album/Artist 都是 `TrackType.AUDIOBOOK`。
 */
export class AudiobookshelfMusicAdapter implements IMusicAdapter {
  track: AudiobookshelfTrackAdapter;
  album: AudiobookshelfAlbumAdapter;
  artist: AudiobookshelfArtistAdapter;
  playlist: AudiobookshelfPlaylistAdapter;
  collection: AudiobookshelfCollectionAdapter;
  user: AudiobookshelfUserAdapter;
  auth: AudiobookshelfAuthAdapter;
  mv: AudiobookshelfMvAdapter;
  search: AudiobookshelfSearchAdapter;
  searchRecord: AudiobookshelfSearchRecordAdapter;
  client: AudiobookshelfClient;
  store: AbsItemStore;

  constructor(config?: AudiobookshelfConfig) {
    this.client = new AudiobookshelfClient(config);
    this.store = new AbsItemStore(this.client);
    this.track = new AudiobookshelfTrackAdapter(this.client, this.store);
    this.album = new AudiobookshelfAlbumAdapter(this.client, this.store);
    this.artist = new AudiobookshelfArtistAdapter(this.client, this.store);
    this.playlist = new AudiobookshelfPlaylistAdapter();
    this.collection = new AudiobookshelfCollectionAdapter(this.client, this.store);
    this.user = new AudiobookshelfUserAdapter(this.client);
    this.auth = new AudiobookshelfAuthAdapter(this.client);
    this.mv = new AudiobookshelfMvAdapter();
    this.search = new AudiobookshelfSearchAdapter(this.client, this.store);
    this.searchRecord = new AudiobookshelfSearchRecordAdapter();
  }
}

export { AudiobookshelfClient } from "./client";
export { AudiobookshelfSearchAdapter } from "./search";
export { AudiobookshelfSearchRecordAdapter } from "./search-record";
export { AbsItemStore } from "./items";
export type { AudiobookshelfConfig } from "./client";
