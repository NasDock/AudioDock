import AsyncStorage from "@react-native-async-storage/async-storage";
import { setSearchRecordStorage } from "@soundx/services";

/**
 * 搜索历史的端侧存储（飞牛音乐没有搜索历史接口，适配器用端侧存储实现）。
 *
 * `SearchRecordStorage` 是同步接口，而 AsyncStorage 是异步的，
 * 所以这里做一层「内存 + 落盘」：
 * - 启动时把整份历史读进内存（模块 import 即触发，搜索发生前早已就绪）；
 * - 写入时先更新内存（同步可见），再异步落盘。
 *
 * 存储 key 与适配器生成的一致（`soundx_search_history::<数据源地址>`），
 * 这里整体打包成一个 JSON 存，避免 AsyncStorage 里散落大量 key。
 */
const STORAGE_KEY = "soundx_search_history_store";

type Store = Record<string, string>;

let store: Store = {};
let ready: Promise<void> = Promise.resolve();

const persist = () => {
  ready = ready.then(() =>
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store)).catch((error) => {
      console.warn("[SearchRecord] 写入搜索历史失败", error);
    }),
  );
};

export const initSearchRecordStorage = () => {
  ready = AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") store = parsed as Store;
      } catch {
        // 存储被写坏：重置为空，不影响搜索本身
        store = {};
      }
    })
    .catch((error) => {
      console.warn("[SearchRecord] 读取搜索历史失败", error);
    });

  setSearchRecordStorage({
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => {
      store[key] = value;
      persist();
    },
  });
};
