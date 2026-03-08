import { ILoadMoreData, ISuccessResponse, ITableData, Track } from "../../models";
import { ITrackAdapter } from "../interface";
import { EmbyClient } from "./client";
import { mapEmbyItemToTrack } from "./mapper";
import { getModeParentId, mediaModeToTrackType, sanitizeUserId } from "./media";
import { EmbyItemsResponse } from "./types";

export class EmbyTrackAdapter implements ITrackAdapter {
  constructor(private client: EmbyClient) {}
  private readonly trackFields = "Artists,Album,AlbumId,RunTimeTicks,ProductionYear,IndexNumber,ParentIndexNumber,ImageTags,AlbumPrimaryImageTag,PrimaryImageTag,PrimaryImageItemId,ItemIds";

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
    throw new Error("Emby userId is required for user-scoped request");
  }

  private async buildModeScopedTrackParams(type?: string, userId?: number | string): Promise<any | null> {
    const scopedUserId = sanitizeUserId(userId) || sanitizeUserId((this.client.getConfig() as any).userId);
    const parentId = await getModeParentId(this.client, type, scopedUserId);
    if (scopedUserId && !parentId) return null;

    return {
      IncludeItemTypes: "Audio",
      Recursive: true,
      Fields: this.trackFields,
      ParentId: parentId || undefined,
    };
  }

  async getTrackList(): Promise<ISuccessResponse<Track[]>> {
    const trackType = mediaModeToTrackType();
    const modeParams = await this.buildModeScopedTrackParams(trackType);
    if (!modeParams) return { code: 200, message: "success", data: [] };
    const response = await this.client.get<EmbyItemsResponse>("Items", {
      ...modeParams,
      Limit: 100,
    });
    return {
      code: 200,
      message: "success",
      data: response.Items.map((item) =>
        mapEmbyItemToTrack(
          item,
          this.client.getImageUrl.bind(this.client),
          this.client.getStreamUrl.bind(this.client),
          trackType
        )
      ),
    };
  }

  async getAllTracks(): Promise<ISuccessResponse<Track[]>> {
    return this.getTrackList();
  }

  async getTrackTableList(params: { pageSize: number; current: number }): Promise<ISuccessResponse<ITableData<Track[]>>> {
    const trackType = mediaModeToTrackType();
    const modeParams = await this.buildModeScopedTrackParams(trackType);
    if (!modeParams) {
      return {
        code: 200,
        message: "success",
        data: { pageSize: params.pageSize, current: params.current, list: [], total: 0 },
      };
    }
    const response = await this.client.get<EmbyItemsResponse>("Items", {
      ...modeParams,
      Limit: params.pageSize,
      StartIndex: (params.current - 1) * params.pageSize,
    });
    return {
      code: 200,
      message: "success",
      data: {
        pageSize: params.pageSize,
        current: params.current,
        list: response.Items.map((item) =>
          mapEmbyItemToTrack(
            item,
            this.client.getImageUrl.bind(this.client),
            this.client.getStreamUrl.bind(this.client),
            trackType
          )
        ),
        total: response.TotalRecordCount,
      },
    };
  }

  async loadMoreTrack(params: { pageSize: number; loadCount: number; type?: string }): Promise<ISuccessResponse<ILoadMoreData<Track>>> {
    const trackType = mediaModeToTrackType(params.type);
    const modeParams = await this.buildModeScopedTrackParams(params.type);
    if (!modeParams) {
      return {
        code: 200,
        message: "success",
        data: { pageSize: params.pageSize, loadCount: params.loadCount, list: [], total: 0, hasMore: false },
      };
    }
    const response = await this.client.get<EmbyItemsResponse>("Items", {
      ...modeParams,
      Limit: params.pageSize,
      StartIndex: params.loadCount,
    });
    return {
      code: 200,
      message: "success",
      data: {
        pageSize: params.pageSize,
        loadCount: params.loadCount,
        list: response.Items.map((item) =>
          mapEmbyItemToTrack(
            item,
            this.client.getImageUrl.bind(this.client),
            this.client.getStreamUrl.bind(this.client),
            trackType
          )
        ),
        total: response.TotalRecordCount,
        hasMore: params.loadCount + response.Items.length < response.TotalRecordCount,
      },
    };
  }

  async createTrack(data: Omit<Track, "id">): Promise<ISuccessResponse<Track>> {
    throw new Error("Not supported for remote source");
  }

  async updateTrack(id: number | string, data: Partial<Track>): Promise<ISuccessResponse<Track>> {
    throw new Error("Not supported for remote source");
  }

  async deleteTrack(id: number | string, deleteAlbum?: boolean): Promise<ISuccessResponse<boolean>> {
    throw new Error("Not supported for remote source");
  }

  async getDeletionImpact(id: number | string): Promise<ISuccessResponse<{ isLastTrackInAlbum: boolean; albumName: string | null }>> {
    throw new Error("Not supported for remote source");
  }

  async batchCreateTracks(data: Omit<Track, "id">[]): Promise<ISuccessResponse<boolean>> {
    throw new Error("Not supported for remote source");
  }

  async batchDeleteTracks(ids: (number | string)[]): Promise<ISuccessResponse<boolean>> {
    throw new Error("Not supported for remote source");
  }

  async getLatestTracks(type?: string, random?: boolean, pageSize?: number): Promise<ISuccessResponse<Track[]>> {
    const trackType = mediaModeToTrackType(type);
    const modeParams = await this.buildModeScopedTrackParams(type);
    if (!modeParams) return { code: 200, message: "success", data: [] };
    const response = await this.client.get<EmbyItemsResponse>("Items", {
      ...modeParams,
      SortBy: random ? "Random" : "DateCreated",
      SortOrder: "Descending",
      Limit: pageSize || 10,
    });
    return {
      code: 200,
      message: "success",
      data: response.Items.map((item) =>
        mapEmbyItemToTrack(
          item,
          this.client.getImageUrl.bind(this.client),
          this.client.getStreamUrl.bind(this.client),
          trackType
        )
      ),
    };
  }

  async getRecommendedTracks(type?: string, pageSize?: number, likeRatio?: number): Promise<ISuccessResponse<Track[]>> {
    return this.getLatestTracks(type, true, pageSize);
  }

  async getTracksByArtist(artist: string): Promise<ISuccessResponse<Track[]>> {
    const trackType = mediaModeToTrackType();
    const userId = await this.ensureUserId();
    const collectionType = trackType === "AUDIOBOOK" ? "audiobooks" : "music";
    const response = await this.client.get<EmbyItemsResponse>(`Users/${userId}/Items`, {
      Recursive: true,
      IncludeItemTypes: "Audio",
      CollectionTypes: collectionType,
      ArtistIds: String(artist),
      SortBy: "PlayCount,SortName",
      SortOrder: "Descending,Ascending",
      ImageTypeLimit: 1,
      Fields: "BasicSyncInfo,CanDelete,CanDownload,PrimaryImageAspectRatio,Artists,Album,AlbumId,RunTimeTicks,ProductionYear,IndexNumber,ParentIndexNumber,ImageTags,AlbumPrimaryImageTag,PrimaryImageTag,PrimaryImageItemId,ItemIds",
      Limit: 1000,
    });
    return {
      code: 200,
      message: "success",
      data: response.Items.map((item) =>
        mapEmbyItemToTrack(
          item,
          this.client.getImageUrl.bind(this.client),
          this.client.getStreamUrl.bind(this.client),
          trackType
        )
      ),
    };
  }

  async toggleLike(id: number | string, userId: number | string): Promise<ISuccessResponse<any>> {
    await this.client.request("POST", `Users/${userId}/FavoriteItems/${id}`);
    return { code: 200, message: "success", data: true };
  }

  async toggleUnLike(id: number | string, userId: number | string): Promise<ISuccessResponse<any>> {
    await this.client.request("DELETE", `Users/${userId}/FavoriteItems/${id}`);
    return { code: 200, message: "success", data: true };
  }

  async getFavoriteTracks(userId: number | string, loadCount: number, pageSize: number, type?: string): Promise<ISuccessResponse<ILoadMoreData<{ track: Track, createdAt: string | Date }>>> {
    const trackType = mediaModeToTrackType(type);
    const modeParams = await this.buildModeScopedTrackParams(type, userId);
    if (!modeParams) {
      return {
        code: 200,
        message: "success",
        data: { pageSize, loadCount, list: [], total: 0, hasMore: false },
      };
    }
    const response = await this.client.get<EmbyItemsResponse>(`Users/${userId}/Items`, {
      ...modeParams,
      Filters: "IsFavorite",
      SortBy: "SortName",
      SortOrder: "Ascending",
      Limit: pageSize,
      StartIndex: loadCount,
    });
    return {
      code: 200,
      message: "success",
      data: {
        pageSize,
        loadCount,
        list: response.Items.map((item) => ({
          track: mapEmbyItemToTrack(item, this.client.getImageUrl.bind(this.client), this.client.getStreamUrl.bind(this.client), trackType),
          createdAt: new Date().toISOString()
        })),
        total: response.TotalRecordCount,
        hasMore: loadCount + response.Items.length < response.TotalRecordCount,
      }
    };
  }

  async getLyrics(id: number | string): Promise<ISuccessResponse<string | null>> {
    return { code: 0, message: "success", data: null };
  }
}
