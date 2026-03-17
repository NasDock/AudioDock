import { ISuccessResponse, Playlist, TrackType } from "../../models";
import { IPlaylistAdapter } from "../interface";
import { EmbyClient } from "./client";
import { mapEmbyItemToTrack } from "./mapper";
import { sanitizeUserId } from "./media";
import { EmbyItemsResponse } from "./types";

export class EmbyPlaylistAdapter implements IPlaylistAdapter {
  constructor(private client: EmbyClient) {}

  private normalizeUserId(userId?: number | string): string | undefined {
    return sanitizeUserId(userId);
  }

  private getPersistedUserId(): string | undefined {
    if (typeof localStorage === "undefined") return undefined;
    try {
      const baseUrl = String((this.client.getConfig() as any)?.baseUrl || localStorage.getItem("serverAddress") || "").trim();
      if (!baseUrl) return undefined;
      const rawUser = localStorage.getItem(`user_${baseUrl}`);
      if (!rawUser) return undefined;
      const parsed = JSON.parse(rawUser);
      return sanitizeUserId(parsed?.id || parsed?.user?.id);
    } catch {
      return undefined;
    }
  }

  private async ensureUserId(userId?: number | string): Promise<string> {
    const config = this.client.getConfig() as any;
    const finalUserId =
      this.normalizeUserId(userId) ||
      this.normalizeUserId(config?.userId) ||
      this.getPersistedUserId();
    if (finalUserId) return finalUserId;
    throw new Error("Emby userId is required for playlist request");
  }

  private mapPlaylistType(type?: "MUSIC" | "AUDIOBOOK"): TrackType {
    return type === TrackType.AUDIOBOOK ? TrackType.AUDIOBOOK : TrackType.MUSIC;
  }

  private mapPlaylistItem(item: any, type?: "MUSIC" | "AUDIOBOOK", userId?: number | string): Playlist {
    return {
      id: item.Id,
      name: item.Name,
      type: this.mapPlaylistType(type),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      userId: userId || "",
      _count: { tracks: item.ChildCount || item.TotalItemCount || 0 },
    } as Playlist;
  }

  async createPlaylist(name: string, type: "MUSIC" | "AUDIOBOOK", userId: number | string): Promise<ISuccessResponse<Playlist>> {
    const finalUserId = await this.ensureUserId(userId);
    const created = await this.client.request<any>(
      "POST",
      "Playlists",
      {
        Name: name,
        userId: finalUserId,
      },
      undefined
    );

    if (created?.Id) {
      return this.getPlaylistById(created.Id);
    }

    const list = await this.getPlaylists(type, finalUserId);
    const matched = [...(list.data || [])].reverse().find((p) => p.name === name);
    return {
      code: 200,
      message: "success",
      data: matched || {
        id: "",
        name,
        type: this.mapPlaylistType(type),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        userId: finalUserId,
      } as Playlist,
    };
  }

  async getPlaylists(type?: "MUSIC" | "AUDIOBOOK", userId?: number | string): Promise<ISuccessResponse<Playlist[]>> {
    const finalUserId = await this.ensureUserId(userId);
    const response = await this.client.get<EmbyItemsResponse>(`Users/${finalUserId}/Items`, {
      IncludeItemTypes: "Playlist",
      Recursive: true,
      SortBy: "SortName",
      SortOrder: "Ascending",
      Fields: "BasicSyncInfo,CanDelete,CanDownload,PrimaryImageAspectRatio",
    });
    return {
      code: 200,
      message: "success",
      data: response.Items.map((item) => this.mapPlaylistItem(item, type, finalUserId)),
    };
  }

  async getPlaylistById(id: number | string): Promise<ISuccessResponse<Playlist>> {
    const finalUserId = await this.ensureUserId();
    const item = await this.client.get<any>(`Users/${finalUserId}/Items/${id}`, {
      fields: "ShareLevel",
      ExcludeFields: "VideoChapters,VideoMediaSources,MediaStreams",
    });
    const tracksResponse = await this.client.get<EmbyItemsResponse>(`Users/${finalUserId}/Items`, {
      ParentId: id,
      IncludeItemTypes: "Audio",
      Recursive: true,
      Fields: "Artists,Album,AlbumId,RunTimeTicks,ProductionYear,IndexNumber,ParentIndexNumber,ImageTags,AlbumPrimaryImageTag,PrimaryImageTag,PrimaryImageItemId,ItemIds",
    });

    return {
      code: 200,
      message: "success",
      data: {
        id: item.Id,
        name: item.Name,
        type: TrackType.MUSIC,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        userId: finalUserId,
        tracks: tracksResponse.Items.map((t: any) => {
          const track = mapEmbyItemToTrack(t, this.client.getImageUrl.bind(this.client), this.client.getStreamUrl.bind(this.client)) as any;
          // Keep playlist entry id for remove API (EntryIds).
          track.playlistEntryId = t.PlaylistItemId || t.PlaylistItemIdList?.[0] || t.EntryId || t.PlaylistEntryId;
          return track;
        }),
      },
    };
  }

  async updatePlaylist(id: number | string, name: string): Promise<ISuccessResponse<Playlist>> {
    const itemId = encodeURIComponent(String(id));
    const userId = await this.ensureUserId();
    const current = await this.client.get<any>(`Users/${userId}/Items/${itemId}`, {
      fields: "ShareLevel",
      ExcludeFields: "VideoChapters,VideoMediaSources,MediaStreams",
    });

    const payload = {
      ...current,
      Id: String(id),
      Name: name,
    };

    await this.client.request(
      "POST",
      `Items/${itemId}`,
      {
        reqformat: "json",
      },
      payload
    );

    return this.getPlaylistById(id);
  }

  async deletePlaylist(id: number | string): Promise<ISuccessResponse<boolean>> {
    await this.client.request("POST", "Items/Delete", { Ids: id }, undefined);
    return { code: 200, message: "success", data: true };
  }

  async addTrackToPlaylist(playlistId: number | string, trackId: number | string): Promise<ISuccessResponse<boolean>> {
    const userId = await this.ensureUserId();
    try {
      await this.client.request(
        "POST",
        `Playlists/${playlistId}/AddToPlaylistInfo`,
        {
          Ids: trackId,
          userId,
        },
        undefined
      );
    } catch {
      // Compatibility fallback for servers expecting legacy playlist add endpoint.
      await this.client.request(
        "POST",
        `Playlists/${playlistId}/Items`,
        {
          Ids: trackId,
          UserId: userId,
        },
        undefined
      );
    }
    return { code: 200, message: "success", data: true };
  }

  async addTracksToPlaylist(playlistId: number | string, trackIds: (number | string)[]): Promise<ISuccessResponse<boolean>> {
    const userId = await this.ensureUserId();
    try {
      await this.client.request(
        "POST",
        `Playlists/${playlistId}/AddToPlaylistInfo`,
        {
          Ids: trackIds.join(","),
          userId,
        },
        undefined
      );
    } catch {
      await this.client.request(
        "POST",
        `Playlists/${playlistId}/Items`,
        {
          Ids: trackIds.join(","),
          UserId: userId,
        },
        undefined
      );
    }
    return { code: 200, message: "success", data: true };
  }

  async removeTrackFromPlaylist(playlistId: number | string, trackId: number | string): Promise<ISuccessResponse<boolean>> {
    const detail = await this.getPlaylistById(playlistId);
    const matched = (detail.data?.tracks || []).find((t: any) => String((t as any).id) === String(trackId)) as any;
    const entryId = matched?.playlistEntryId;
    if (!entryId) {
      return { code: 404, message: "playlist entry not found", data: false };
    }

    await this.client.request(
      "POST",
      `Playlists/${playlistId}/Items/Delete`,
      {
        EntryIds: entryId,
      },
      undefined
    );
    return { code: 200, message: "success", data: true };
  }
}
