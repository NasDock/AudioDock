import { FnosSearchRecordAdapter } from "../fnos/search-record";

/**
 * Emby 没有搜索历史接口，复用端侧本地存储实现，用独立前缀隔离：
 * `emby_search_history::<baseUrl>`。
 *
 * 不实现的话 services/search-record.ts 会回退去打 `<emby>/search-record/*`，
 * 该路径不存在，搜索面板的历史/热词会一直为空。
 */
export class EmbySearchRecordAdapter extends FnosSearchRecordAdapter {
  constructor() {
    super("emby");
  }
}
