import { Artist, ILoadMoreData, ISuccessResponse, ITableData } from "../../models";
import { IArtistAdapter } from "../interface";
import { EmbyClient } from "./client";
import { mapEmbyItemToArtist } from "./mapper";
import { getModeParentId, mediaModeToTrackType, sanitizeUserId } from "./media";
import { EmbyItemsResponse } from "./types";

export class EmbyArtistAdapter implements IArtistAdapter {
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
    throw new Error("Emby userId is required for user-scoped request");
  }

  async getArtistList(pageSize: number, loadCount: number, type?: string, sortBy?: string): Promise<ISuccessResponse<ILoadMoreData<Artist>>> {
    const startIndex = loadCount * pageSize;
    const artistType = mediaModeToTrackType(type);
    const userId = sanitizeUserId((this.client.getConfig() as any).userId);
    const parentId = await getModeParentId(this.client, type, userId);
    if (userId && !parentId) {
      return {
        code: 200,
        message: "success",
        data: { pageSize, loadCount, list: [], total: 0, hasMore: false },
      };
    }
    const response = await this.client.get<EmbyItemsResponse>("Artists", {
      Fields: "BasicSyncInfo,CanDelete,CanDownload,PrimaryImageAspectRatio,PrimaryImageTag,ImageTags,PrimaryImageItemId,ItemIds",
      SortBy: "SortName",
      SortOrder: "Ascending",
      EnableImageTypes: "Primary,Backdrop,Thumb",
      ImageTypeLimit: 1,
      Recursive: true,
      ArtistType: "Artist,AlbumArtist",
      Limit: pageSize,
      StartIndex: startIndex,
      ParentId: parentId || undefined,
      userId: userId || undefined,
    });
    return {
      code: 200,
      message: "success",
      data: {
        pageSize,
        loadCount,
        list: response.Items.map((item) => mapEmbyItemToArtist(item, this.client.getImageUrl.bind(this.client), artistType)),
        total: response.TotalRecordCount,
        hasMore: startIndex + response.Items.length < response.TotalRecordCount,
      },
    };
  }

  async getArtistTableList(params: { pageSize: number; current: number }): Promise<ISuccessResponse<ITableData<Artist[]>>> {
    const artistType = mediaModeToTrackType();
    const response = await this.client.get<EmbyItemsResponse>("Artists", {
      Recursive: true,
      Fields: "PrimaryImageTag,ImageTags,PrimaryImageItemId,ItemIds",
      Limit: params.pageSize,
      StartIndex: (params.current - 1) * params.pageSize,
    });
    return {
      code: 200,
      message: "success",
      data: {
        pageSize: params.pageSize,
        current: params.current,
        list: response.Items.map((item) => mapEmbyItemToArtist(item, this.client.getImageUrl.bind(this.client), artistType)),
        total: response.TotalRecordCount,
      },
    };
  }

  async loadMoreArtist(params: { pageSize: number; loadCount: number }): Promise<ISuccessResponse<ILoadMoreData<Artist>>> {
    return this.getArtistList(params.pageSize, params.loadCount);
  }

  async createArtist(data: Omit<Artist, "id">): Promise<ISuccessResponse<Artist>> {
    throw new Error("Not supported for remote source");
  }

  async updateArtist(id: number | string, data: Partial<Artist>): Promise<ISuccessResponse<Artist>> {
    throw new Error("Not supported for remote source");
  }

  async deleteArtist(id: number | string): Promise<ISuccessResponse<boolean>> {
    throw new Error("Not supported for remote source");
  }

  async batchCreateArtists(data: Omit<Artist, "id">[]): Promise<ISuccessResponse<boolean>> {
    throw new Error("Not supported for remote source");
  }

  async batchDeleteArtists(ids: (number | string)[]): Promise<ISuccessResponse<boolean>> {
    throw new Error("Not supported for remote source");
  }

  async getArtistById(id: number | string): Promise<ISuccessResponse<Artist>> {
    const artistType = mediaModeToTrackType();
    const userId = await this.ensureUserId();
    const item = await this.client.get<any>(`Users/${userId}/Items/${encodeURIComponent(String(id))}`, {
      fields: "ShareLevel",
      ExcludeFields: "VideoChapters,VideoMediaSources,MediaStreams",
      Fields: "PrimaryImageTag,ImageTags,PrimaryImageItemId,ItemIds,Type,CollectionType",
    });
    return {
      code: 200,
      message: "success",
      data: mapEmbyItemToArtist(item, this.client.getImageUrl.bind(this.client), artistType),
    };
  }

  async getLatestArtists(type: string, random?: boolean, pageSize?: number): Promise<ISuccessResponse<Artist[]>> {
    const artistType = mediaModeToTrackType(type);
    const userId = sanitizeUserId((this.client.getConfig() as any).userId);
    const parentId = await getModeParentId(this.client, type, userId);
    if (userId && !parentId) {
      return { code: 200, message: "success", data: [] };
    }
    const response = await this.client.get<EmbyItemsResponse>("Artists", {
      Recursive: true,
      Fields: "PrimaryImageTag,ImageTags,PrimaryImageItemId,ItemIds",
      SortBy: random ? "Random" : "Name",
      Limit: pageSize || 10,
      ParentId: parentId || undefined,
    });
    return {
      code: 200,
      message: "success",
      data: response.Items.map((item) => mapEmbyItemToArtist(item, this.client.getImageUrl.bind(this.client), artistType)),
    };
  }

  async uploadArtistAvatar(id: number | string, file: any): Promise<ISuccessResponse<Artist>> {
    return {
      code: 501,
      message: "Emby adapter does not support cover upload.",
      data: null as unknown as Artist,
    };
  }
}
