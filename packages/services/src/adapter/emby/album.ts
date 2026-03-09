import { Album, ILoadMoreData, ISuccessResponse, ITableData, TrackType } from "../../models";
import { IAlbumAdapter } from "../interface";
import { EmbyClient } from "./client";
import { mapEmbyItemToAlbum, mapEmbyItemToTrack } from "./mapper";
import { albumItemTypesForMode, getModeParentId, inferTrackTypeFromItem, mediaModeToTrackType, sanitizeUserId } from "./media";
import { EmbyItem, EmbyItemsResponse } from "./types";

export class EmbyAlbumAdapter implements IAlbumAdapter {
  constructor(private client: EmbyClient) {}

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

  private normalizeUserId(userId?: number | string): string | undefined {
    return sanitizeUserId(userId);
  }

  private async ensureUserId(userId?: number | string): Promise<string> {
    const config = this.client.getConfig() as any;
    const finalUserId =
      this.normalizeUserId(userId) ||
      this.normalizeUserId(config.userId) ||
      this.getPersistedUserId();
    if (finalUserId) return finalUserId;
    throw new Error("Emby userId is required for user-scoped request");
  }

  private resolveTrackSortBy(sortBy?: string): string {
    if (!sortBy) return "IndexNumber";

    // Frontend sort keys are local-domain names; map them to Emby-supported keys.
    const mapped = {
      id: "SortName",
      index: "IndexNumber",
      episodeNumber: "ParentIndexNumber",
    }[sortBy];

    const candidate = mapped || sortBy;
    const allowed = new Set([
      "IndexNumber",
      "ParentIndexNumber",
      "SortName",
      "Name",
      "DateCreated",
      "ProductionYear",
      "PremiereDate",
      "Random",
    ]);

    return allowed.has(candidate) ? candidate : "IndexNumber";
  }

  async getAlbumList(): Promise<ISuccessResponse<Album[]>> {
    const response = await this.client.get<EmbyItemsResponse>("Items", {
      IncludeItemTypes: "MusicAlbum",
      Recursive: true,
      Fields: "Artists,ProductionYear,ImageTags,PrimaryImageTag,PrimaryImageItemId,ItemIds",
      Limit: 100,
    });
    return {
      code: 200,
      message: "success",
      data: response.Items.map((item) => mapEmbyItemToAlbum(item, this.client.getImageUrl.bind(this.client))),
    };
  }

  async getAlbumTableList(params: { pageSize: number; current: number }): Promise<ISuccessResponse<ITableData<Album[]>>> {
    const response = await this.client.get<EmbyItemsResponse>("Items", {
      IncludeItemTypes: "MusicAlbum",
      Recursive: true,
      Fields: "Artists,ProductionYear,ImageTags,PrimaryImageTag,PrimaryImageItemId,ItemIds",
      Limit: params.pageSize,
      StartIndex: (params.current - 1) * params.pageSize,
    });
    return {
      code: 200,
      message: "success",
      data: {
        pageSize: params.pageSize,
        current: params.current,
        list: response.Items.map((item) => mapEmbyItemToAlbum(item, this.client.getImageUrl.bind(this.client))),
        total: response.TotalRecordCount,
      },
    };
  }

  async loadMoreAlbum(params: { pageSize: number; loadCount: number; type?: string; sortBy?: string }): Promise<ISuccessResponse<ILoadMoreData<Album>>> {
    const startIndex = params.loadCount * params.pageSize;
    const mode = mediaModeToTrackType(params.type);
    const finalUserId = this.normalizeUserId((this.client.getConfig() as any).userId);
    const parentId = await getModeParentId(this.client, params.type);
    if (finalUserId && !parentId) {
      return {
        code: 200,
        message: "success",
        data: { pageSize: params.pageSize, loadCount: params.loadCount, list: [], total: 0, hasMore: false },
      };
    }
    const endpoint = finalUserId ? `Users/${finalUserId}/Items` : "Items";
    const response = await this.client.get<EmbyItemsResponse>(endpoint, {
      IncludeItemTypes: "MusicAlbum",
      // Match Emby web list query shape to avoid mixed results.
      Fields: "BasicSyncInfo,CanDelete,CanDownload,PrimaryImageAspectRatio,Artists,ProductionYear,ImageTags,PrimaryImageTag,PrimaryImageItemId,ItemIds",
      SortBy: "SortName",
      SortOrder: "Ascending",
      EnableImageTypes: "Primary,Backdrop,Thumb",
      ImageTypeLimit: 1,
      Recursive: true,
      Limit: params.pageSize,
      StartIndex: startIndex,
      ParentId: parentId || undefined,
      userId: finalUserId || undefined,
    });
    return {
      code: 200,
      message: "success",
      data: {
        pageSize: params.pageSize,
        loadCount: params.loadCount,
        list: response.Items.map((item) => mapEmbyItemToAlbum(item, this.client.getImageUrl.bind(this.client), mode)),
        total: response.TotalRecordCount,
        hasMore: startIndex + response.Items.length < response.TotalRecordCount,
      },
    };
  }

  async createAlbum(data: Omit<Album, "id">): Promise<ISuccessResponse<Album>> {
    throw new Error("Not supported for remote source");
  }

  async updateAlbum(id: number | string, data: Partial<Album>): Promise<ISuccessResponse<Album>> {
    throw new Error("Not supported for remote source");
  }

  async deleteAlbum(id: number | string): Promise<ISuccessResponse<boolean>> {
    throw new Error("Not supported for remote source");
  }

  async batchCreateAlbums(data: Omit<Album, "id">[]): Promise<ISuccessResponse<boolean>> {
    throw new Error("Not supported for remote source");
  }

  async batchDeleteAlbums(ids: (number | string)[]): Promise<ISuccessResponse<boolean>> {
    throw new Error("Not supported for remote source");
  }

  async getRecommendedAlbums(type?: string, random?: boolean, pageSize?: number, likeRatio?: number): Promise<ISuccessResponse<Album[]>> {
    const mode = mediaModeToTrackType(type);
    const finalUserId = this.normalizeUserId((this.client.getConfig() as any).userId);
    const parentId = await getModeParentId(this.client, type);
    if (finalUserId && !parentId) {
      return { code: 200, message: "success", data: [] };
    }

    if (mode === TrackType.AUDIOBOOK && finalUserId && parentId) {
      const response = await this.client.get<EmbyItem[]>(`Users/${finalUserId}/Items/Latest`, {
        ParentId: parentId,
        GroupItems: true,
        Limit: pageSize || 10,
        Fields: "Artists,ProductionYear,ImageTags,PrimaryImageTag,PrimaryImageItemId,ItemIds,Type,CollectionType",
      });
      const list = (response || []).map((item) => mapEmbyItemToAlbum(item, this.client.getImageUrl.bind(this.client), mode));
      return {
        code: 200,
        message: "success",
        data: random ? [...list].sort(() => Math.random() - 0.5) : list,
      };
    }

    const albumType = mode;
    const response = await this.client.get<EmbyItemsResponse>("Items", {
      IncludeItemTypes: albumItemTypesForMode(type),
      Recursive: true,
      Fields: "Artists,ProductionYear,ImageTags,PrimaryImageTag,PrimaryImageItemId,ItemIds",
      SortBy: random ? "Random" : "DateCreated",
      SortOrder: "Descending",
      Limit: pageSize || 10,
      ParentId: parentId || undefined,
    });
    return {
      code: 200,
      message: "success",
      data: response.Items.map((item) => mapEmbyItemToAlbum(item, this.client.getImageUrl.bind(this.client), albumType)),
    };
  }

  async getRecentAlbums(type?: string, random?: boolean, pageSize?: number): Promise<ISuccessResponse<Album[]>> {
    return this.getRecommendedAlbums(type, random, pageSize);
  }

  async getAlbumById(id: number | string): Promise<ISuccessResponse<Album>> {
    const userId = await this.ensureUserId();
    const itemId = encodeURIComponent(String(id));
    const item = await this.client.get<any>(`Users/${userId}/Items/${itemId}`, {
      // Keep this endpoint aligned with Emby web album detail request.
      fields: "ShareLevel",
      ExcludeFields: "VideoChapters,VideoMediaSources,MediaStreams",
    });

    return {
      code: 200,
      message: "success",
      data: mapEmbyItemToAlbum(item, this.client.getImageUrl.bind(this.client), inferTrackTypeFromItem(item)),
    };
  }

  async getAlbumTracks(id: number | string, pageSize: number, skip: number, sort?: "asc" | "desc", keyword?: string, userId?: number | string, sortBy?: string): Promise<ISuccessResponse<{ list: any[]; total: number }>> {
    const finalUserId = await this.ensureUserId(userId);
    const endpoint = `Users/${finalUserId}/Items`;
    const searchTerm = keyword?.trim();
    const query: any = {
      ParentId: String(id),
      Fields: "BasicSyncInfo,CanDelete,CanDownload,PrimaryImageAspectRatio,Artists,Album,AlbumId,RunTimeTicks,ProductionYear,IndexNumber,ParentIndexNumber,ImageTags,AlbumPrimaryImageTag,PrimaryImageTag,PrimaryImageItemId,ItemIds",
      ImageTypeLimit: 1,
      EnableTotalRecordCount: false,
      Limit: pageSize,
      StartIndex: skip,
      SortBy: this.resolveTrackSortBy(sortBy),
      SortOrder: sort === "desc" ? "Descending" : "Ascending",
      SearchTerm: searchTerm || undefined,
    };
    const response = await this.client.get<EmbyItemsResponse>(endpoint, query);
    return {
      code: 200,
      message: "success",
      data: {
        list: response.Items.map((item) =>
          mapEmbyItemToTrack(
            item,
            this.client.getImageUrl.bind(this.client),
            this.client.getStreamUrl.bind(this.client)
          )
        ),
        total: response.TotalRecordCount ?? (skip + response.Items.length),
      },
    };
  }

  async getAlbumsByArtist(artist: string): Promise<ISuccessResponse<Album[]>> {
    const userId = await this.ensureUserId();
    const albumType = mediaModeToTrackType();
    const response = await this.client.get<EmbyItemsResponse>(`Users/${userId}/Items`, {
      IncludeItemTypes: "MusicAlbum",
      Recursive: true,
      SortBy: "ProductionYear,PremiereDate,SortName",
      SortOrder: "Descending,Descending,Ascending",
      ImageTypeLimit: 1,
      Fields: "BasicSyncInfo,CanDelete,CanDownload,PrimaryImageAspectRatio,Artists,ProductionYear,ImageTags,PrimaryImageTag,PrimaryImageItemId,ItemIds",
      Limit: 1000,
      AlbumArtistIds: String(artist),
    });
    return {
      code: 200,
      message: "success",
      data: response.Items.map((item) => mapEmbyItemToAlbum(item, this.client.getImageUrl.bind(this.client), albumType)),
    };
  }

  async getCollaborativeAlbumsByArtist(artist: string): Promise<ISuccessResponse<Album[]>> {
    return { code: 0, message: "success", data: [] };
  }

  async toggleLike(id: number | string, userId: number | string): Promise<ISuccessResponse<any>> {
    await this.client.request("POST", `Users/${userId}/FavoriteItems/${id}`);
    return { code: 200, message: "success", data: true };
  }

  async toggleUnLike(id: number | string, userId: number | string): Promise<ISuccessResponse<any>> {
    await this.client.request("DELETE", `Users/${userId}/FavoriteItems/${id}`);
    return { code: 200, message: "success", data: true };
  }

  async getFavoriteAlbums(userId: number | string, loadCount: number, pageSize: number, type?: string): Promise<ISuccessResponse<ILoadMoreData<{ album: Album, createdAt: string | Date }>>> {
    const parentId = await getModeParentId(this.client, type, userId);
    const albumType = mediaModeToTrackType(type);
    if (this.normalizeUserId(userId) && !parentId) {
      return {
        code: 200,
        message: "success",
        data: { pageSize, loadCount, list: [], total: 0, hasMore: false },
      };
    }
    const response = await this.client.get<EmbyItemsResponse>(`Users/${userId}/Items`, {
      IncludeItemTypes: albumItemTypesForMode(type),
      Recursive: true,
      Filters: "IsFavorite",
      Fields: "Artists,ProductionYear,ImageTags,PrimaryImageTag",
      SortBy: "SortName",
      SortOrder: "Ascending",
      Limit: pageSize,
      StartIndex: loadCount,
      ParentId: parentId || undefined,
    });
    return {
      code: 200,
      message: "success",
      data: {
        pageSize,
        loadCount,
        list: response.Items.map((item) => ({
          album: mapEmbyItemToAlbum(item, this.client.getImageUrl.bind(this.client), albumType),
          createdAt: new Date().toISOString()
        })),
        total: response.TotalRecordCount,
        hasMore: loadCount + response.Items.length < response.TotalRecordCount,
      }
    };
  }
}
