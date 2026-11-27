import { IMusicAdapter } from "../interface";
import { EmbyAlbumAdapter } from "./album";
import { EmbyArtistAdapter } from "./artist";
import { EmbyClient, EmbyConfig } from "./client";
import { EmbyCollectionAdapter } from "./collection";
import { EmbyPlaylistAdapter } from "./playlist";
import { EmbyTrackAdapter } from "./track";
import { EmbyAuthAdapter, EmbyUserAdapter } from "./user-auth";
import { EmbyMvAdapter } from "./mv";
import { EmbySearchAdapter } from "./search";
import { EmbySearchRecordAdapter } from "./search-record";

export class EmbyMusicAdapter implements IMusicAdapter {
  track: EmbyTrackAdapter;
  album: EmbyAlbumAdapter;
  artist: EmbyArtistAdapter;
  playlist: EmbyPlaylistAdapter;
  collection: EmbyCollectionAdapter;
  user: EmbyUserAdapter;
  auth: EmbyAuthAdapter;
  mv: EmbyMvAdapter;
  search: EmbySearchAdapter;
  searchRecord: EmbySearchRecordAdapter;
  client: EmbyClient;

  constructor(config?: EmbyConfig) {
    this.client = new EmbyClient(config);
    this.track = new EmbyTrackAdapter(this.client);
    this.album = new EmbyAlbumAdapter(this.client);
    this.artist = new EmbyArtistAdapter(this.client);
    this.playlist = new EmbyPlaylistAdapter(this.client);
    this.collection = new EmbyCollectionAdapter();
    this.user = new EmbyUserAdapter(this.client);
    this.auth = new EmbyAuthAdapter(this.client);
    this.mv = new EmbyMvAdapter();
    this.search = new EmbySearchAdapter(this.client);
    this.searchRecord = new EmbySearchRecordAdapter();
  }
}

export * from "./client";
export * from "./types";
