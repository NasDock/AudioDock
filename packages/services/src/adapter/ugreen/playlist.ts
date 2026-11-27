import type { ILoadMoreData, ISuccessResponse, Playlist, Track } from "../../models";
import { IPlaylistAdapter } from "../interface";
import { UgreenClient } from "./client";
import { mapUgreenPlaylist, mapUgreenPlaylists, mapUgreenTracks } from "./mapper";
import { UGREEN_SORT } from "./query";
import type { UgreenPlaylistDetail, UgreenPlaylistListData } from "./types";

/**
 * 歌单写接口 payload（实测）：
 *   add          { songlist: { title } } → { songlist_id }
 *   modify       { songlist: { ...整个歌单对象, title: 新名 } }
 *   del          { del_type: 2, songlist_id_arr: [id] }
 *   content/add  { songlist_id_arr: [pid], audio_id_arr: [...] }
 *   content/del  { songlist_id: pid, del_type: 2, audio_id_arr: [...] }
 */
export class UgreenPlaylistAdapter implements IPlaylistAdapter {
  constructor(private client: UgreenClient) {}

  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  async createPlaylist(name: string, type: "MUSIC" | "AUDIOBOOK", userId: number | string) {
    await this.client.post<{ songlist_id?: number }>("/music/songlist/add", {
      songlist: { title: name },
    });
    // 创建后再查一次，拿到完整对象
    const list = await this.getPlaylists(type, userId);
    const created = list.data.find((item) => item.name === name);
    if (created) return this.response(created);
    return this.response(
      mapUgreenPlaylist(
        { songlist_id: Date.now(), title: name, create_time: new Date().toISOString() },
        this.client,
      ),
    );
  }

  async getPlaylists(_type?: "MUSIC" | "AUDIOBOOK", _userId?: number | string) {
    const data = await this.client.get<UgreenPlaylistListData>("/music/songlist/all", {
      has_invalid_song: true,
    });
    const list = mapUgreenPlaylists(data?.songlist_arr || [], this.client);
    return this.response(list);
  }

  async getPlaylistById(id: number | string) {
    const detail = await this.fetchDetail(id);
    const playlist = mapUgreenPlaylist(
      { ...detail.songlist_info, total_num: detail.total_num ?? detail.file_arr?.length },
      this.client,
    );
    return this.response(playlist);
  }

  /**
   * 歌单详情（by_id/v2）：sort_type 不能为 0（报 1005/9405），用名称(1)。
   * 接口无分页参数，曲目全量返回，这里端侧切片。
   */
  private fetchDetail(id: number | string): Promise<UgreenPlaylistDetail> {
    return this.client.get<UgreenPlaylistDetail>("/music/songlist/by_id/v2", {
      songlist_id: Number(id),
      sort_type: UGREEN_SORT.name,
      asc: 1,
      has_invalid_song: true,
    });
  }

  async getPlaylistTracksPaged(
    id: number | string,
    skip: number,
    pageSize: number,
  ): Promise<ISuccessResponse<ILoadMoreData<Track>>> {
    const safeSize = Math.max(1, pageSize || 50);
    const safeSkip = Math.max(0, skip || 0);
    const detail = await this.fetchDetail(id);
    const raws = detail?.file_arr || [];
    const total = detail?.total_num ?? raws.length;
    const list = mapUgreenTracks(raws.slice(safeSkip, safeSkip + safeSize), this.client);
    return this.response({
      pageSize: safeSize,
      loadCount: safeSkip + list.length,
      list,
      total,
      hasMore: safeSkip + list.length < total,
    });
  }

  async updatePlaylist(id: number | string, name: string) {
    // modify 要嵌套整个歌单对象（实测契约），先取详情再改名
    const detail = await this.fetchDetail(id);
    const info = detail?.songlist_info;
    if (!info) throw new Error("绿联音乐中找不到该歌单");
    await this.client.post("/music/songlist/modify", {
      songlist: { ...info, title: name },
    });
    return this.getPlaylistById(id);
  }

  async deletePlaylist(id: number | string) {
    await this.client.post("/music/songlist/del", {
      del_type: 2,
      songlist_id_arr: [Number(id)],
    });
    return this.response(true);
  }

  async addTrackToPlaylist(playlistId: number | string, trackId: number | string) {
    return this.addTracksToPlaylist(playlistId, [trackId]);
  }

  async addTracksToPlaylist(playlistId: number | string, trackIds: (number | string)[]) {
    await this.client.post("/music/songlist/content/add", {
      songlist_id_arr: [Number(playlistId)],
      audio_id_arr: trackIds.map((id) => Number(id)),
    });
    return this.response(true);
  }

  async removeTrackFromPlaylist(playlistId: number | string, trackId: number | string) {
    await this.client.post("/music/songlist/content/del", {
      songlist_id: Number(playlistId),
      del_type: 2,
      audio_id_arr: [Number(trackId)],
    });
    return this.response(true);
  }
}
