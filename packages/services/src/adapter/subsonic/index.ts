import { IMusicAdapter } from "../interface";
import { SubsonicAlbumAdapter } from "./album";
import { SubsonicArtistAdapter } from "./artist";
import { SubsonicClient, SubsonicConfig } from "./client";
import { SubsonicCollectionAdapter } from "./collection";
import { SubsonicPlaylistAdapter } from "./playlist";
import { SubsonicTrackAdapter } from "./track";
import { SubsonicAuthAdapter, SubsonicUserAdapter } from "./user-auth";
import { SubsonicMvAdapter } from "./mv";
import { SubsonicSearchAdapter } from "./search";
import { SubsonicSearchRecordAdapter } from "./search-record";

export class SubsonicMusicAdapter implements IMusicAdapter {
  track: SubsonicTrackAdapter;
  album: SubsonicAlbumAdapter;
  artist: SubsonicArtistAdapter;
  playlist: SubsonicPlaylistAdapter;
  collection: SubsonicCollectionAdapter;
  user: SubsonicUserAdapter;
  auth: SubsonicAuthAdapter;
  mv: SubsonicMvAdapter;
  search: SubsonicSearchAdapter;
  searchRecord: SubsonicSearchRecordAdapter;
  client: SubsonicClient;

  constructor(config?: SubsonicConfig) {
      this.client = new SubsonicClient(config);
      this.track = new SubsonicTrackAdapter(this.client);
      this.album = new SubsonicAlbumAdapter(this.client);
      this.artist = new SubsonicArtistAdapter(this.client);
      this.playlist = new SubsonicPlaylistAdapter(this.client);
      this.collection = new SubsonicCollectionAdapter();
      this.user = new SubsonicUserAdapter(this.client);
      this.auth = new SubsonicAuthAdapter(this.client);
      this.mv = new SubsonicMvAdapter();
      // Navidrome 等 Subsonic 服务端的搜索走 search3；历史走端侧本地存储
      this.search = new SubsonicSearchAdapter(this.client);
      this.searchRecord = new SubsonicSearchRecordAdapter();
  }
}

export { SubsonicSearchAdapter } from "./search";
export { SubsonicSearchRecordAdapter } from "./search-record";
