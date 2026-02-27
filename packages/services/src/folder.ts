import { Folder, ISuccessResponse, TrackType } from "./models";
import { getServiceConfig } from "./config";
import { request } from "./request";
import { getAdapter } from "./adapter/manager";
import { EmbyClient } from "./adapter/emby/client";
import { mapEmbyItemToTrack } from "./adapter/emby/mapper";
import { getModeParentId, mediaModeToTrackType, sanitizeUserId } from "./adapter/emby/media";
import { EmbyItemsResponse } from "./adapter/emby/types";

export interface FolderContents extends Folder {
  breadcrumbs: Folder[];
  children: Folder[];
  tracks: any[];
  name: string;
}

const isEmbySource = (): boolean => {
  const adapterName = getAdapter()?.constructor?.name || "";
  if (adapterName.includes("Emby")) return true;
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem("selectedSourceType") === "Emby";
};

const embyClient = new EmbyClient();

const resolveEmbyUserId = (): string => {
  const config = getServiceConfig() as any;
  const fromConfig = sanitizeUserId(config?.userId);
  if (fromConfig) return fromConfig;

  if (typeof localStorage !== "undefined") {
    const baseUrl = String(config?.baseUrl || localStorage.getItem("serverAddress") || "").trim();
    if (baseUrl) {
      try {
        const rawUser = localStorage.getItem(`user_${baseUrl}`);
        if (rawUser) {
          const parsed = JSON.parse(rawUser);
          const fromStorage = sanitizeUserId(parsed?.id || parsed?.user?.id);
          if (fromStorage) return fromStorage;
        }
      } catch {}
    }
  }

  throw new Error("Emby userId is required");
};

const mapEmbyItemToFolder = (item: any, type: TrackType): Folder => ({
  id: item.Id,
  name: item.Name,
  path: item.Path || "",
  parentId: item.ParentId || null,
  type,
});

const getEmbyFolderItems = async (parentId: number | string, mode: TrackType): Promise<FolderContents> => {
  const userId = resolveEmbyUserId();
  const response = await embyClient.get<EmbyItemsResponse>(`Users/${userId}/Items`, {
    Fields: "BasicSyncInfo,CanDelete,CanDownload,PrimaryImageAspectRatio,ProductionYear,Status,EndDate,Artists,Album,AlbumId,RunTimeTicks,IndexNumber,ParentIndexNumber,ImageTags,AlbumPrimaryImageTag,PrimaryImageTag,PrimaryImageItemId,ItemIds",
    StartIndex: 0,
    SortBy: "IsFolder,Filename",
    ParentId: String(parentId),
    EnableImageTypes: "Primary,Backdrop,Thumb",
    ImageTypeLimit: 1,
    Limit: 50,
  });

  const children = (response.Items || [])
    .filter((item: any) => item.IsFolder)
    .map((item: any) => mapEmbyItemToFolder(item, mode));
  const tracks = (response.Items || [])
    .filter((item: any) => !item.IsFolder)
    .map((item: any) =>
      mapEmbyItemToTrack(
        item as any,
        embyClient.getImageUrl.bind(embyClient),
        embyClient.getStreamUrl.bind(embyClient),
        mode
      )
    );

  return {
    id: String(parentId),
    name: "",
    path: "",
    parentId: null,
    type: mode,
    breadcrumbs: [],
    children,
    tracks,
  };
};

export const getFolderRoots = (type: TrackType) => {
  if (isEmbySource()) {
    return (async () => {
      const mode = mediaModeToTrackType(type);
      const userId = resolveEmbyUserId();
      const parentId = await getModeParentId(embyClient, type, userId);
      if (!parentId) {
        return { code: 200, message: "success", data: [] } as ISuccessResponse<Folder[]>;
      }
      const root = await getEmbyFolderItems(parentId, mode);
      return { code: 200, message: "success", data: root.children } as ISuccessResponse<Folder[]>;
    })();
  }
  return request.get<Folder[]>(`/folders/roots`, { params: { type } });
};

export const getFolderContents = (id: number | string) => {
  if (isEmbySource()) {
    return (async () => {
      const mode = mediaModeToTrackType();
      const data = await getEmbyFolderItems(id, mode);
      return { code: 200, message: "success", data } as ISuccessResponse<FolderContents>;
    })();
  }
  return request.get<FolderContents>(`/folders/${id}/contents`);
};

export const getFolderStats = (id: number | string) => {
  return request.get<any>(`/folders/${id}/stats`);
};

export const deleteFolder = (id: number | string) => {
  return request.delete<any>(`/folders/${id}`);
};

export const batchDeleteItems = (data: { folderIds: (number | string)[]; trackIds: (number | string)[] }) => {
  return request.post<any>(`/folders/batch-delete`, data);
};
