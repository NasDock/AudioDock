import type { IMvAdapter } from "../interface";
import type { Mv } from "../../models";

/** Audiobookshelf 没有 MV，返回空避免 UI 报错 */
export class AudiobookshelfMvAdapter implements IMvAdapter {
  async getMvList(): Promise<{ list: Mv[]; total: number }> {
    return { list: [], total: 0 };
  }
  async getMvById(): Promise<Mv | null> {
    return null;
  }
  async getMvsByArtist(): Promise<Mv[]> {
    return [];
  }
  async getMvsByAlbum(): Promise<Mv[]> {
    return [];
  }
  async getMvByTrackId(): Promise<Mv | null> {
    return null;
  }
  async getRandomMvs(): Promise<Mv[]> {
    return [];
  }
}
