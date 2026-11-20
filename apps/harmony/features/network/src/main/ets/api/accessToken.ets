import { httpClient } from '../HarmonyHttpClient';

/**
 * API 访问令牌管理。
 * 字段与返回结构对齐 packages/services/src/accessToken.ts（desktop/mobile/mini 共用）：
 * 完整令牌明文仅创建时返回一次，列表只含前缀。
 */
export interface AccessToken {
  id: number;
  name: string;
  tokenPrefix: string;
  enabled: boolean;
  lastUsedAt?: string | null;
  createdAt: string;
  userId: number;
}

export interface AccessTokenWithSecret extends AccessToken {
  token: string;
}

export interface UpdateAccessTokenDto {
  name?: string;
  enabled?: boolean;
}

export interface AccessTokenApi {
  /** 当前用户的令牌列表 */
  list(): Promise<AccessToken[]>;
  /** 创建令牌：返回的 token 为完整明文，仅此一次可见，需立即保存 */
  create(name: string): Promise<AccessTokenWithSecret>;
  /** 更新令牌（改名 / 启用停用） */
  update(id: number, dto: UpdateAccessTokenDto): Promise<AccessToken>;
  /** 删除令牌 */
  remove(id: number): Promise<boolean>;
}

class AccessTokenApiImpl implements AccessTokenApi {
  private readonly BASE: string = '/access-tokens';

  async list(): Promise<AccessToken[]> {
    return httpClient.get<AccessToken[]>(this.BASE);
  }

  async create(name: string): Promise<AccessTokenWithSecret> {
    const body: UpdateAccessTokenDto = { name };
    return httpClient.post<AccessTokenWithSecret>(this.BASE, body);
  }

  async update(id: number, dto: UpdateAccessTokenDto): Promise<AccessToken> {
    return httpClient.put<AccessToken>(`${this.BASE}/${id}`, dto);
  }

  async remove(id: number): Promise<boolean> {
    return httpClient.del<boolean>(`${this.BASE}/${id}`);
  }
}

export const accessTokenApi: AccessTokenApi = new AccessTokenApiImpl();
