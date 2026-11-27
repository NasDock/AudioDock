import type { ILoadMoreData, ISuccessResponse, Playlist, Track } from "../../models";
import type { IPlaylistAdapter } from "../interface";

const response = <T>(data: T): ISuccessResponse<T> => ({
  code: 200,
  message: "success",
  data,
});

/** Audiobookshelf 的收藏不是可播放歌单，统一返回空，避免第三方源下 UI 报错 */
export class AudiobookshelfPlaylistAdapter implements IPlaylistAdapter {
  async createPlaylist(): Promise<ISuccessResponse<Playlist>> {
    return response(null as unknown as Playlist);
  }

  async getPlaylists(): Promise<ISuccessResponse<Playlist[]>> {
    return response([]);
  }

  async getPlaylistById(): Promise<ISuccessResponse<Playlist>> {
    return response(null as unknown as Playlist);
  }

  async getPlaylistTracksPaged(): Promise<ISuccessResponse<ILoadMoreData<Track>>> {
    return response({
      pageSize: 20,
      loadCount: 0,
      list: [],
      total: 0,
      hasMore: false,
    });
  }

  async updatePlaylist(): Promise<ISuccessResponse<Playlist>> {
    return response(null as unknown as Playlist);
  }

  async deletePlaylist(): Promise<ISuccessResponse<boolean>> {
    return response(false);
  }

  async addTrackToPlaylist(): Promise<ISuccessResponse<boolean>> {
    return response(false);
  }

  async addTracksToPlaylist(): Promise<ISuccessResponse<boolean>> {
    return response(false);
  }

  async removeTrackFromPlaylist(): Promise<ISuccessResponse<boolean>> {
    return response(false);
  }
}
