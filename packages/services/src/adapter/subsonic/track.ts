import type {
  ISuccessResponse,
  Track
} from "../../models";
import { ITrackAdapter } from "../interface";
import { SubsonicClient } from "./client";
import { mapSubsonicSongToTrack } from "./mapper";
import { SubsonicChild, SubsonicRandomSongs } from "./types";

export class SubsonicTrackAdapter implements ITrackAdapter {
  constructor(private client: SubsonicClient) {}

  private response<T>(data: T): ISuccessResponse<T> {
      return {
          code: 200,
          message: "success",
          data
      };
  }

  private formatLyrics(lyricsRes: any): string | null {
    if (!lyricsRes) return null;
    
    // Check for OpenSubsonic structuredLyrics
    const structured = lyricsRes.lyricsList?.structuredLyrics?.[0];
    if (structured && structured.line) {
        return structured.line.map((l: any) => {
            const totalMs = l.start || 0;
            const minutes = Math.floor(totalMs / 60000);
            const seconds = Math.floor((totalMs % 60000) / 1000);
            const ms = totalMs % 1000;
            // Format: [mm:ss.SS]
            const timestamp = `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}]`;
            return `${timestamp}${l.value || ''}`;
        }).join('\n');
    }
    
    // Check for plain lyrics (older Subsonic)
    const lyricsData = lyricsRes.lyrics;
    return lyricsData?.value || lyricsData?.["$"] || (typeof lyricsData === 'string' ? lyricsData : null);
  }

  private async mapTracksWithLyrics(songs: SubsonicChild[]): Promise<Track[]> {
    return Promise.all(songs.map(async s => {
        let lyrics = null;
        try {
            // Only try if artist and title exist
            if (s.artist && s.title) {
                const lyricsRes = await this.client.get<any>("getLyricsBySongId", { 
                    id: s.id,
                }).catch(() => null);
                
                if (lyricsRes) {
                    lyrics = this.formatLyrics(lyricsRes);
                }
            }
        } catch (e) {
            // Ignore error for lyrics, return track anyway
        }
        return mapSubsonicSongToTrack(s, (id) => this.client.getCoverUrl(id), (id) => this.client.getStreamUrl(id), lyrics);
    }));
  }

  async getTrackList() {
    // Subsonic doesn't have a direct "get all tracks" efficiently.
    // We'll return random songs as a default list.
    const res = await this.client.get<SubsonicRandomSongs>("getRandomSongs", { size: 50 });
    const tracks = await this.mapTracksWithLyrics(res.randomSongs?.song || []);
    return this.response(tracks);
  }

  async getAllTracks() {
      // Assuming backend supports getAllTracks or similar, or we use a large search
      // The user stated "backend already has it", implying a direct endpoint or capability
      // falling back to search3 with empty query which works on some servers (Navidrome) to return all
      const res = await this.client.get<{searchResult3: { song: SubsonicChild[] }}>("search3", { query: '', songCount: 50000 });
      console.log(res, 'res');
      const tracks = await this.mapTracksWithLyrics(res.searchResult3?.song || []);
      console.log(res, 'res');
      console.log(tracks, 'tracks');
      return this.response(tracks);
  }

  async getTrackTableList(params: {
    pageSize: number;
    current: number;
  }) {
    // Use search as a proxy for list, or random if search not viable for "all".
    // Subsonic 1.8.0+ has search3.
    // Using empty query might not return all.
    // Fallback: Random for now, or just empty list if we can't iterate all.
    // Better: getStarred?
    // Let's assume we can't easily pagination ALL tracks in Subsonic without traversing everything.
    // We returns a empty list or random.
    return this.response({
        pageSize: params.pageSize,
        current: params.current,
        list: [],
        total: 0
    });
  }

  async loadMoreTrack(params: {
    pageSize: number;
    loadCount: number;
    type?: string;
  }) {
      const tracks = await this.getAllTracks();
     // Similar limitation.
     return this.response({
         pageSize: params.pageSize,
         loadCount: params.loadCount,
         list: tracks.data,
         total: tracks.data.length,
         hasMore: false
     });
  }

  async createTrack(data: Omit<Track, "id">): Promise<ISuccessResponse<Track>> {
    throw new Error("Creation not supported in Subsonic Adapter");
  }

  async updateTrack(id: number | string, data: Partial<Track>): Promise<ISuccessResponse<Track>> {
     // Subsonic supports star/unstar, but editing metadata is limited.
     // star: star.view?id=...
     throw new Error("Update not supported fully in Subsonic Adapter");
  }

  async deleteTrack(id: number | string, deleteAlbum: boolean = false): Promise<ISuccessResponse<boolean>> {
     throw new Error("Delete not supported in Subsonic Adapter");
  }

  async getDeletionImpact(id: number | string) {
     return this.response({ isLastTrackInAlbum: false, albumName: null });
  }

  async batchCreateTracks(data: Omit<Track, "id">[]): Promise<ISuccessResponse<boolean>> {
     throw new Error("Batch create not supported");
  }

  async batchDeleteTracks(ids: (number | string)[]): Promise<ISuccessResponse<boolean>> {
     throw new Error("Batch delete not supported");
  }

  async getLatestTracks(type?: string, random?: boolean, pageSize?: number) {
      // type is often "music" or "audiobook".
      const res = await this.client.get<SubsonicRandomSongs>("getRandomSongs", { size: pageSize || 20 });
      const tracks = await this.mapTracksWithLyrics(res.randomSongs?.song || []);
      return this.response(tracks);
  }

  async getRecommendedTracks(type?: string, pageSize?: number, likeRatio?: number) {
      return this.getLatestTracks(type, true, pageSize);
  }

  async getTracksByArtist(artist: string) {
    // search3
    const res = await this.client.get<{searchResult3: { song: SubsonicChild[] }}>("search3", { query: artist, songCount: 50 });
    const tracks = await this.mapTracksWithLyrics(res.searchResult3?.song || []);
    return this.response(tracks);
  }

  async toggleLike(id: number | string, userId: number | string) {
    await this.client.get("star", { id: id.toString() });
    return this.response(null);
  }

  async toggleUnLike(id: number | string, userId: number | string) {
    await this.client.get("unstar", { id: id.toString() });
    return this.response(null);
  }

  async getFavoriteTracks(userId: number | string, loadCount: number, pageSize: number, type?: string) {
    const res = await this.client.get<{ starred: { song: SubsonicChild[] } }>("getStarred");
    const songs = (res.starred?.song || []).slice(loadCount, loadCount + pageSize);
    const tracks = await this.mapTracksWithLyrics(songs);
    
    const list = tracks.map((track, index) => {
        const song = songs[index];
        return {
            track,
            createdAt: song.starred || song.created || new Date().toISOString()
        };
    });
    
    return this.response({
        pageSize,
        loadCount: loadCount + tracks.length,
        list: list,
        total: res.starred?.song?.length || 0,
        hasMore: loadCount + tracks.length < (res.starred?.song?.length || 0)
    });
  }

  async getLyrics(id: number | string) {
    const res = await this.client.get<{ song: SubsonicChild }>("getSong", { id: id.toString() });
    const song = res.song;
    if (!song) return this.response(null);
    
    // Subsonic getLyrics typically uses artist and title.
    const lyricsRes = await this.client.get<any>("getLyricsBySongId", {
      id: song.id
    });
    
    return this.response(this.formatLyrics(lyricsRes));
  }
}
