import type {
  Artist,
  ISuccessResponse
} from "../../models";
import { IArtistAdapter } from "../interface";
import { SubsonicClient } from "./client";
import { mapSubsonicArtistToArtist } from "./mapper";
import { SubsonicArtistInfo, SubsonicArtistList } from "./types";

export class SubsonicArtistAdapter implements IArtistAdapter {
  constructor(private client: SubsonicClient) { }

  private response<T>(data: T): ISuccessResponse<T> {
    return {
      code: 200,
      message: "success",
      data
    };
  }

  async getArtistList(
    pageSize: number,
    loadCount: number,
    type?: string,
    sortBy?: string
  ) {
    // getArtists returns indexed list.
    const res = await this.client.get<SubsonicArtistList>("getArtists");
    const allArtists: any[] = [];
    res.artists?.index?.forEach(i => {
      if (i.artist) allArtists.push(...i.artist);
    });
    // pagination
    const slice = allArtists.slice(loadCount, loadCount + pageSize);
    const list = slice.map(a => mapSubsonicArtistToArtist(a, (id) => this.client.getCoverUrl(id)));

    return this.response({
      pageSize,
      loadCount: loadCount + list.length,
      list,
      total: allArtists.length,
      hasMore: (loadCount + list.length) < allArtists.length
    });
  }

  async getArtistTableList(params: {
    pageSize: number;
    current: number;
  }) {
    const loadCount = (params.current - 1) * params.pageSize;
    const res = await this.client.get<SubsonicArtistList>("getArtists");
    const allArtists: any[] = [];
    res.artists?.index?.forEach(i => {
      if (i.artist) allArtists.push(...i.artist);
    });
    const slice = allArtists.slice(loadCount, loadCount + params.pageSize);
    const list = slice.map(a => mapSubsonicArtistToArtist(a, (id) => this.client.getCoverUrl(id)));

    return this.response({
      pageSize: params.pageSize,
      current: params.current,
      list,
      total: allArtists.length
    });
  }

  async loadMoreArtist(params: {
    pageSize: number;
    loadCount: number;
  }) {
    return this.getArtistList(params.pageSize, params.loadCount);
  }

  async createArtist(data: Omit<Artist, "id">): Promise<ISuccessResponse<Artist>> {
    throw new Error("Create Artist not supported");
  }

  async updateArtist(id: number | string, data: Partial<Artist>): Promise<ISuccessResponse<Artist>> {
    throw new Error("Update Artist not supported");
  }

  async deleteArtist(id: number | string): Promise<ISuccessResponse<boolean>> {
    throw new Error("Delete Artist not supported");
  }

  async batchCreateArtists(data: Omit<Artist, "id">[]): Promise<ISuccessResponse<boolean>> {
    throw new Error("Batch Create Artist not supported");
  }

  async batchDeleteArtists(ids: (number | string)[]): Promise<ISuccessResponse<boolean>> {
    throw new Error("Batch Delete Artist not supported");
  }

  async getArtistById(id: number | string) {
    const res = await this.client.get<SubsonicArtistInfo>("getArtist", { id: id.toString() });
    return this.response(mapSubsonicArtistToArtist(res.artist, (id) => this.client.getCoverUrl(id)));
  }

  async getLatestArtists(type: string, random?: boolean, pageSize?: number) {
    // 使用 getAlbumList2 请求随机专辑，将专辑的 artist 信息映射为 Artist 列表返回
    const size = 10;
    // 请求随机专辑
    const res = await this.client.get<any>("getAlbumList2", { type: "random", size });

    // 兼容不同返回结构，提取 albums 数组
    let albums: any[] = [];
    if (!res?.albumList2?.album?.length) {
      albums = [];
    } else {
      // 有些实现可能把结果直接放在 root
      albums = res?.albumList2?.album;
    }

    // 将 album 映射为 Artist（尽量从 album 中提取 artistId/artist/coverArt）
    const list = albums.map(album => {
      // 常见字段尝试顺序
      const artistId =
        album.artistId ??
        album.artistIdStr ??
        (album.artist && (album.artist.id ?? album.artistId)) ??
        album.artist; // 最后 fallback 为 artist 名称
      const name =
        typeof album.artist === "string"
          ? album.artist
          : album.artistName ?? album.artist?.name ?? album.artist; // 多种可能的字段名
      const coverId = album.coverArt ?? album.coverArtId ?? album.id ?? null;
      const cover = coverId ? this.client.getCoverUrl(coverId) : undefined;

      // 构造最小 Artist 对象（按前端通常需要的 id/name/cover）
      const artist: any = {
        id: artistId ?? name ?? "",
        name: name ?? "",
      };
      if (cover) artist.cover = cover;
      return artist;
    });

    // 根据 artist.id 去重（保留第一次出现的）
    const seen = new Set<string>();
    const uniqueList = list.filter(a => {
      const key = String(a.id ?? "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return this.response(uniqueList);
  }
}
