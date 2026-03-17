import type {
    Artist,
    ILoadMoreData,
    ISuccessResponse,
    ITableData,
} from "../../models";
import request from "../../request";
import { IArtistAdapter } from "../interface";

export class NativeArtistAdapter implements IArtistAdapter {
  getArtistList(
    pageSize: number,
    loadCount: number,
    type?: string,
    sortBy?: string,
  ) {
    return request.get<any, ISuccessResponse<ILoadMoreData<Artist>>>(
      "/artist/load-more",
      {
        params: {
          pageSize,
          loadCount,
          type,
          sortBy,
        },
      }
    );
  }

  getArtistTableList(params: {
    pageSize: number;
    current: number;
  }) {
    return request.get<any, ISuccessResponse<ITableData<Artist[]>>>(
      "/artist/table-list",
      { params }
    );
  }

  loadMoreArtist(params: {
    pageSize: number;
    loadCount: number;
  }) {
    return request.get<any, ISuccessResponse<ILoadMoreData<Artist>>>(
      "/artist/load-more",
      { params }
    );
  }

  createArtist(data: Omit<Artist, "id">) {
    return request.post<any, ISuccessResponse<Artist>>("/artist", data);
  }

  updateArtist(id: number | string, data: Partial<Artist>) {
    return request.put<any, ISuccessResponse<Artist>>(`/artist/${id}`, data);
  }

  deleteArtist(id: number | string) {
    return request.delete<any, ISuccessResponse<boolean>>(`/artist/${id}`);
  }

  batchCreateArtists(data: Omit<Artist, "id">[]) {
    return request.post<any, ISuccessResponse<boolean>>(
      "/artist/batch-create",
      data
    );
  }

  batchDeleteArtists(ids: (number | string)[]) {
    return request.delete<any, ISuccessResponse<boolean>>(
      "/artist/batch-delete",
      { data: ids }
    );
  }

  getArtistById(id: number | string) {
    return request.get<any, ISuccessResponse<Artist>>(`/artist/${id}`);
  }

  getLatestArtists(type: string, random?: boolean, pageSize?: number) {
    return request.get<any, ISuccessResponse<Artist[]>>("/artist/latest", { params: { type, random, pageSize } });
  }
}
