import { IMusicAdapter } from "../interface";
import { SubsonicAlbumAdapter } from "./album";
import { SubsonicArtistAdapter } from "./artist";
import { SubsonicClient, SubsonicConfig } from "./client";
import { SubsonicCollectionAdapter } from "./collection";
import { SubsonicPlaylistAdapter } from "./playlist";
import { SubsonicTrackAdapter } from "./track";
import { SubsonicAuthAdapter, SubsonicUserAdapter } from "./user-auth";

export class SubsonicMusicAdapter implements IMusicAdapter {
  track: SubsonicTrackAdapter;
  album: SubsonicAlbumAdapter;
  artist: SubsonicArtistAdapter;
  playlist: SubsonicPlaylistAdapter;
  collection: SubsonicCollectionAdapter;
  user: SubsonicUserAdapter;
  auth: SubsonicAuthAdapter;
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
  }
}
