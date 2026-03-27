import { AudiobookCollection, AudiobookCollectionAlbum, ISuccessResponse } from "../../models";
import request from "../../request";
import { IAudioCollectionAdapter } from "../interface";

export class NativeCollectionAdapter implements IAudioCollectionAdapter {
  async createCollection(
    userId: number | string,
    data: { name?: string; cover?: string | null; albumId?: number | string }
  ): Promise<ISuccessResponse<AudiobookCollection>> {
    return await request.post<any, ISuccessResponse<AudiobookCollection>>("/collections", { userId, ...data });
  }

  async getCollections(userId: number | string): Promise<ISuccessResponse<AudiobookCollection[]>> {
    return await request.get<any, ISuccessResponse<AudiobookCollection[]>>("/collections", { params: { userId } });
  }

  async getCollectionById(id: number | string): Promise<ISuccessResponse<AudiobookCollection>> {
    return await request.get<any, ISuccessResponse<AudiobookCollection>>(`/collections/${id}`);
  }

  async updateCollection(
    id: number | string,
    data: { name?: string; cover?: string | null }
  ): Promise<ISuccessResponse<AudiobookCollection>> {
    return await request.put<any, ISuccessResponse<AudiobookCollection>>(`/collections/${id}`, data);
  }

  async uploadCollectionCover(
    id: number | string,
    file: any
  ): Promise<ISuccessResponse<AudiobookCollection>> {
    const formData = new FormData();
    formData.append("file", file as any);
    return await request.post<any, ISuccessResponse<AudiobookCollection>>(
      `/collections/${id}/cover`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
  }

  async deleteCollection(id: number | string): Promise<ISuccessResponse<boolean>> {
    return await request.delete<any, ISuccessResponse<boolean>>(`/collections/${id}`);
  }

  async addAlbumToCollection(
    collectionId: number | string,
    albumId: number | string
  ): Promise<ISuccessResponse<AudiobookCollectionAlbum | boolean>> {
    return await request.post<any, ISuccessResponse<AudiobookCollectionAlbum | boolean>>(
      `/collections/${collectionId}/albums`,
      { albumId }
    );
  }

  async removeAlbumFromCollection(
    collectionId: number | string,
    albumId: number | string
  ): Promise<ISuccessResponse<boolean>> {
    return await request.delete<any, ISuccessResponse<boolean>>(`/collections/${collectionId}/albums/${albumId}`);
  }

  async reorderCollection(collectionId: number | string, albumIds: (number | string)[]): Promise<ISuccessResponse<boolean>> {
    return await request.put<any, ISuccessResponse<boolean>>(`/collections/${collectionId}/order`, { albumIds });
  }

  async getCollectionMembership(albumId: number | string, userId: number | string): Promise<ISuccessResponse<number[]>> {
    return await request.get<any, ISuccessResponse<number[]>>(`/collections/membership`, { params: { albumId, userId } });
  }
}
