import type {
  AccessToken,
  AccessTokenWithSecret,
  ISuccessResponse,
} from "./models";
import request from "./request";

/**
 * API 访问令牌管理。
 * 令牌用于第三方/远程脚本调用接口（如修改元数据）：
 * 请求携带 `X-Access-Token: <token>` 即可访问除用户/账号相关接口外的所有接口。
 */
export const getAccessTokens = async () => {
  return request.get<ISuccessResponse<AccessToken[]>>("/access-tokens");
};

/** 创建令牌：返回的 data.token 为完整明文，仅此一次可见，需立即保存 */
export const createAccessToken = async (name: string) => {
  return request.post<ISuccessResponse<AccessTokenWithSecret>>(
    "/access-tokens",
    { name },
  );
};

/** 更新令牌（改名 / 启用停用） */
export const updateAccessToken = async (
  id: number,
  data: { name?: string; enabled?: boolean },
) => {
  return request.put<ISuccessResponse<AccessToken>>(
    `/access-tokens/${id}`,
    data,
  );
};

export const deleteAccessToken = async (id: number) => {
  return request.delete<ISuccessResponse<boolean>>(`/access-tokens/${id}`);
};
