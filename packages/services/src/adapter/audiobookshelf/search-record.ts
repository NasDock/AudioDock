import { FnosSearchRecordAdapter } from "../fnos/search-record";

/**
 * Audiobookshelf 没有 `/search-record/*`，复用端侧本地存储，
 * 存储桶为 `audiobookshelf_search_history::<baseUrl>`。
 */
export class AudiobookshelfSearchRecordAdapter extends FnosSearchRecordAdapter {
  constructor() {
    super("audiobookshelf");
  }
}
