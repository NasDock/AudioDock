import axios, { AxiosInstance } from "axios";
import { getServiceConfig, setServiceConfig } from "../../config";
import { getBaseURL } from "../../request";
import type { AbsLoginResponse, AbsMeResponse } from "./types";

export interface AudiobookshelfConfig {
  baseUrl?: string;
  username?: string;
  password?: string;
  /** 已持久化的 API token（二次登录/冷启动恢复） */
  token?: string;
  clientName?: string;
}

/**
 * Audiobookshelf REST 客户端。
 *
 * 与 Subsonic 不同，它不用 u/t/s 签名，而是 `Authorization: Bearer <token>`；
 * token 来自 `POST /api/auth/login`（旧服务端为 `POST /login`）返回的 `user.token`。
 * 图片/音频这类 `<img>/<audio>` 无法带自定义头，用 GET 的 `?token=` 形式。
 *
 * 部署路径有两种：根路径和 `/audiobookshelf` 子路径（用户给的链接就是后者），
 * 这里自动探测并记住命中的那个，UI 里地址只填域名即可。
 */
export class AudiobookshelfClient {
  private axios: AxiosInstance;
  /** 探测成功后记住的base，避免每次请求都试两遍 */
  private resolvedBase: string | null = null;

  constructor(config?: AudiobookshelfConfig) {
    this.axios = axios.create({ timeout: 30000 });
    const patch: Partial<AudiobookshelfConfig> = {};
    if (config?.baseUrl) patch.baseUrl = config.baseUrl;
    if (config?.username) patch.username = config.username;
    if (config?.password) patch.password = config.password;
    if (config?.token) patch.token = config.token;
    if (Object.keys(patch).length) setServiceConfig(patch);
  }

  /**
   * 候选 base：用户填的地址本身 + 补上 /audiobookshelf 子路径。
   * 用纯字符串处理，不在 RN 里依赖 URL 构造函数。
   */
  private candidateBases(): string[] {
    const raw = String(getServiceConfig().baseUrl || getBaseURL() || "")
      .trim()
      .replace(/\/+$/, "");
    if (!raw) return [];
    const bases = [raw];
    if (!/\/audiobookshelf$/.test(raw)) bases.push(`${raw}/audiobookshelf`);
    return bases;
  }

  private token(): string {
    return String(getServiceConfig().token || "");
  }

  /** 登录并把 token 写回全局配置，冷启动后其它接口直接可用 */
  async login(): Promise<AbsLoginResponse> {
    const { username, password } = getServiceConfig();
    if (!username || !password) throw new Error("Audiobookshelf 缺少账号或密码");

    const errors: string[] = [];
    for (const base of this.candidateBases()) {
      for (const path of ["/api/auth/login", "/login"]) {
        try {
          const res = await this.axios.post<AbsLoginResponse>(
            `${base}${path}`,
            { username, password },
            { headers: { "Content-Type": "application/json" } },
          );
          const token = res.data?.user?.token;
          if (!token) throw new Error("登录响应缺少 user.token");
          setServiceConfig({ token });
          this.resolvedBase = base;
          return res.data;
        } catch (error: any) {
          // 404 表示这个路径/子路径不存在，继续试下一个
          errors.push(`${base}${path}: ${error?.message || String(error)}`);
        }
      }
    }
    throw new Error(`Audiobookshelf 登录失败（${errors.slice(0, 2).join("；")}）`);
  }

  /** 连通性检查：有 token 走 /api/authorize，没有则直接尝试登录 */
  async check(): Promise<boolean> {
    if (!this.token()) {
      await this.login();
      return true;
    }
    const errors: string[] = [];
    for (const base of this.candidateBases()) {
      for (const path of ["/api/authorize", "/api/me"]) {
        try {
          await this.axios.get<AbsMeResponse>(`${base}${path}`, {
            headers: { Authorization: `Bearer ${this.token()}` },
          });
          this.resolvedBase = base;
          return true;
        } catch (error: any) {
          errors.push(`${base}${path}: ${error?.message || String(error)}`);
        }
      }
    }
    // token 过期时重新登录一次，避免用户被卡在登录页
    try {
      await this.login();
      return true;
    } catch {
      throw new Error(`Audiobookshelf 鉴权失败（${errors.slice(0, 2).join("；")}）`);
    }
  }

  private base(): string {
    return this.resolvedBase || this.candidateBases()[0] || "";
  }

  async get<T>(path: string, params: Record<string, any> = {}): Promise<T> {
    const bases = this.resolvedBase
      ? [this.resolvedBase]
      : this.candidateBases();
    let lastError: any;
    for (const base of bases) {
      try {
        const response = await this.axios.get<T>(`${base}${path}`, {
          params,
          headers: this.token() ? { Authorization: `Bearer ${this.token()}` } : {},
        });
        this.resolvedBase = base;
        return response.data;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Audiobookshelf 请求失败");
  }

  /** 媒体资源用 query token，供 <img>/<audio> 直接加载 */
  getMediaUrl(path: string, params: Record<string, any> = {}): string {
    const query = new URLSearchParams();
    const token = this.token();
    if (token) query.set("token", token);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.set(key, String(value));
      }
    });
    const suffix = query.toString();
    return `${this.base()}${path}${suffix ? `?${suffix}` : ""}`;
  }

  getCoverUrl(itemId: string): string {
    return this.getMediaUrl(`/api/items/${encodeURIComponent(itemId)}/cover`);
  }

  /**
   * 音频文件直链：/api/items/{id}/file/{ino}。
   * v2.38 里没有 /api/items/{id}/stream（实测 404），原始文件走这条带鉴权的
   * sendFile 路由（支持 Range），GET 允许 `?token=` 供 <audio> 直接加载。
   */
  getFileUrl(itemId: string, fileIno: string | number): string {
    return this.getMediaUrl(
      `/api/items/${encodeURIComponent(itemId)}/file/${encodeURIComponent(String(fileIno))}`,
    );
  }

  /** @deprecated v2.38 无此路由，仅兼容旧服务端/分支，勿在新代码使用 */
  getStreamUrl(itemId: string, fileIndex?: number): string {
    return this.getMediaUrl(`/api/items/${encodeURIComponent(itemId)}/stream`, {
      ...(fileIndex !== undefined ? { file: fileIndex } : {}),
    });
  }

  /** 进度上报：Audiobookshelf 用 /api/items/{id}/progress（PUT） */
  async updateProgress(itemId: string, currentTime: number, duration: number): Promise<void> {
    const bases = this.resolvedBase ? [this.resolvedBase] : this.candidateBases();
    for (const base of bases) {
      try {
        await this.axios.put(
          `${base}/api/items/${encodeURIComponent(itemId)}/progress`,
          {
            currentTime,
            duration,
            progress: duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0,
            isFinished: false,
          },
          { headers: this.token() ? { Authorization: `Bearer ${this.token()}` } : {} },
        );
        return;
      } catch {
        // 进度同步失败不影响播放
      }
    }
  }
}
