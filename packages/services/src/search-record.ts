import { getAdapter } from "./adapter/manager";
import type { ISuccessResponse } from "./models";
import request from "./request";

/**
 * 搜索历史。
 *
 * 官方服务端有 `/search-record/*` 三件套；飞牛和 Subsonic（Navidrome）没有这类接口
 * （官方前端把历史存在本地），所以这两个适配器用端侧存储实现了同样的签名 —— 这里
 * 按适配器分发，没实现搜索历史的源（native / emby）保持原行为直接走 request。
 */
const recordImpl = () => getAdapter().searchRecord;

export const addSearchRecord = async (
  keyword: string,
): Promise<ISuccessResponse<any>> => {
  const impl = recordImpl();
  if (impl) return impl.addSearchRecord(keyword);
  return request.post<any, ISuccessResponse<any>>("/search-record", { keyword });
};

export const getSearchHistory = async (): Promise<ISuccessResponse<string[]>> => {
  const impl = recordImpl();
  if (impl) return impl.getSearchHistory();
  return request.get<any, ISuccessResponse<string[]>>("/search-record/history");
};

export const getHotSearches = async (): Promise<
  ISuccessResponse<{ keyword: string; count: number }[]>
> => {
  const impl = recordImpl();
  if (impl) return impl.getHotSearches();
  return request.get<any, ISuccessResponse<{ keyword: string; count: number }[]>>(
    "/search-record/hot"
  );
};

export const clearSearchHistory = async (): Promise<ISuccessResponse<any>> => {
  const impl = recordImpl();
  if (impl) return impl.clearSearchHistory();
  return request.delete<any, ISuccessResponse<any>>("/search-record/history");
};
