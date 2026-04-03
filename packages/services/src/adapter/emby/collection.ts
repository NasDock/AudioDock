import { AudiobookCollection, AudiobookCollectionAlbum, ISuccessResponse } from "../../models";
import { IAudioCollectionAdapter } from "../interface";

const notSupported = <T>(): ISuccessResponse<T> => ({
  code: 500,
  message: "Collection not supported for Emby source",
  data: [] as unknown as T,
});

export class EmbyCollectionAdapter implements IAudioCollectionAdapter {
  async createCollection(): Promise<ISuccessResponse<AudiobookCollection>> {
    return notSupported();
  }
  async getCollections(): Promise<ISuccessResponse<AudiobookCollection[]>> {
    return notSupported();
  }
  async getCollectionById(): Promise<ISuccessResponse<AudiobookCollection>> {
    return notSupported();
  }
  async updateCollection(): Promise<ISuccessResponse<AudiobookCollection>> {
    return notSupported();
  }
  async uploadCollectionCover(): Promise<ISuccessResponse<AudiobookCollection>> {
    return notSupported();
  }
  async deleteCollection(): Promise<ISuccessResponse<boolean>> {
    return notSupported();
  }
  async addAlbumToCollection(): Promise<ISuccessResponse<AudiobookCollectionAlbum | boolean>> {
    return notSupported();
  }
  async removeAlbumFromCollection(): Promise<ISuccessResponse<boolean>> {
    return notSupported();
  }
  async reorderCollection(): Promise<ISuccessResponse<boolean>> {
    return notSupported();
  }
  async getCollectionMembership(): Promise<ISuccessResponse<number[]>> {
    return notSupported();
  }
}
