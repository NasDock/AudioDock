import type { ILoadMoreData, ISuccessResponse, Playlist, Track } from "../../models";
import { IPlaylistAdapter } from "../interface";
import { FnosClient } from "./client";
import { mapFnosPlaylist, mapFnosPlaylists, mapFnosTracks } from "./mapper";
import { FNOS_ALL, pageTotal, skipToPage } from "./query";
import type { FnosPage, FnosPlaylist, FnosTrack } from "./types";

/**
 * 歌单写入接口（已按 fn-music-player 的实际调用确认）：
 *   create      { name }
 *   update      { guid, name }
 *   delete      { guid }
 *   add-track   { guid, trackGUIDs: [] }
 *   remove-track{ guid, trackGUIDs: [] }
 */
const ACTION_CREATE = "/playlist/create";
const ACTION_UPDATE = "/playlist/update";
const ACTION_DELETE = "/playlist/delete";

export class FnosPlaylistAdapter implements IPlaylistAdapter {
  constructor(private client: FnosClient) {}

  private response<T>(data: T): ISuccessResponse<T> {
    return { code: 200, message: "success", data };
  }

  async createPlaylist(name: string, type: "MUSIC" | "AUDIOBOOK", userId: number | string) {
    // 返回值形态未确认，统一「创建后再查一次」兜底，拿不到就构造一个临时对象
    await this.client.post(ACTION_CREATE, { name }).catch((error) => {
      console.warn("[Fnos] 新建歌单失败", error);
      throw error;
    });
    const list = await this.getPlaylists(type, userId);
    const created = list.data.find((item) => item.name === name);
    if (created) return this.response(created);
    return this.response(
      await mapFnosPlaylist(
        { guid: `pending-${Date.now()}`, name, createdAt: Math.floor(Date.now() / 1000) },
        this.client,
      ),
    );
  }

  async getPlaylists(type?: "MUSIC" | "AUDIOBOOK", userId?: number | string) {
    const page = await this.client.get<FnosPage<FnosPlaylist>>("/playlist/list", {
      page: 1,
      size: FNOS_ALL,
    });
    const list = await mapFnosPlaylists(page?.list || [], this.client);
    return this.response(list);
  }

  async getPlaylistById(id: number | string) {
    const raw = await this.client.get<FnosPlaylist>("/playlist/detail", { guid: String(id) });
    const playlist = await mapFnosPlaylist(raw, this.client);
    return this.response(playlist);
  }

  async getPlaylistTracksPaged(
    id: number | string,
    skip: number,
    pageSize: number,
  ): Promise<ISuccessResponse<ILoadMoreData<Track>>> {
    const safeSize = Math.max(1, pageSize || 50);
    const safeSkip = Math.max(0, skip || 0);
    const page = await this.client.get<FnosPage<FnosTrack>>("/track/playlist-detail/list", {
      playlistGUID: String(id),
      page: skipToPage(safeSkip, safeSize),
      size: safeSize,
    });
    const list = await mapFnosTracks(page?.list || [], this.client);
    const total = pageTotal(page);
    return this.response({
      pageSize: safeSize,
      loadCount: safeSkip + list.length,
      list,
      total,
      hasMore: safeSkip + list.length < total,
    });
  }

  async updatePlaylist(id: number | string, name: string) {
    await this.client.post(ACTION_UPDATE, { guid: String(id), name });
    return this.getPlaylistById(id);
  }

  async deletePlaylist(id: number | string) {
    await this.client.post(ACTION_DELETE, { guid: String(id) });
    return this.response(true);
  }

  /** 官方契约是批量：{ guid: 歌单, trackGUIDs: [] } */
  async addTrackToPlaylist(playlistId: number | string, trackId: number | string) {
    return this.addTracksToPlaylist(playlistId, [trackId]);
  }

  async addTracksToPlaylist(playlistId: number | string, trackIds: (number | string)[]) {
    await this.client.post("/playlist/add-track", {
      guid: String(playlistId),
      trackGUIDs: trackIds.map((id) => String(id)),
    });
    return this.response(true);
  }

  async removeTrackFromPlaylist(playlistId: number | string, trackId: number | string) {
    await this.client.post("/playlist/remove-track", {
      guid: String(playlistId),
      trackGUIDs: [String(trackId)],
    });
    return this.response(true);
  }
}
