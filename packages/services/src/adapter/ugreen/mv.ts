import { Mv } from "../../models";
import { IMvAdapter } from "../interface";

/** 绿联音乐没有 MV 能力，全部返回空实现 */
export class UgreenMvAdapter implements IMvAdapter {
  async getMvList(_pageSize: number, _skip: number, _keyword?: string): Promise<{ list: Mv[]; total: number }> {
    return { list: [], total: 0 };
  }

  async getMvById(_id: number | string): Promise<Mv | null> {
    return null;
  }

  async getMvsByArtist(_artist: string): Promise<Mv[]> {
    return [];
  }

  async getMvsByAlbum(_album: string, _artist: string): Promise<Mv[]> {
    return [];
  }

  async getMvByTrackId(_trackId: number | string): Promise<Mv | null> {
    return null;
  }

  async getRandomMvs(_limit: number): Promise<Mv[]> {
    return [];
  }
}
