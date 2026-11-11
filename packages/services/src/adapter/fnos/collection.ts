import {
  AudiobookCollection,
  AudiobookCollectionAlbum,
  ISuccessResponse,
} from "../../models";
import { IAudioCollectionAdapter } from "../interface";

/** 飞牛音乐没有有声书分类，收藏位统一返回不支持 */
const notSupported = <T>(): ISuccessResponse<T> => ({
  code: 500,
  message: "飞牛音乐数据源不支持有声书收藏",
  data: [] as unknown as T,
});

export class FnosCollectionAdapter implements IAudioCollectionAdapter {
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
