import { FnosSearchRecordAdapter } from "../fnos/search-record";

/**
 * Subsonic / Navidrome 没有搜索历史接口（官方 Web 前端也是自己本地存），
 * 复用与飞牛同一套端侧存储实现，仅用独立前缀隔离存储桶：
 * `subsonic_search_history::<baseUrl>`。
 *
 * 不实现的话 services/search-record.ts 会回退去打 `<navidrome>/search-record/*`，
 * 该路径不存在，搜索面板的历史/热词会一直为空。
 */
export class SubsonicSearchRecordAdapter extends FnosSearchRecordAdapter {
  constructor() {
    super("subsonic");
  }
}
