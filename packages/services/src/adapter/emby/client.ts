import axios, { AxiosInstance } from "axios";
import { getServiceConfig } from "../../config";
import { getBaseURL } from "../../request";

export interface EmbyConfig {
  baseUrl?: string;
  token?: string;
  userId?: string;
}

export class EmbyClient {
  private axios: AxiosInstance;

  constructor(config?: EmbyConfig) {
    this.axios = axios.create({
      timeout: 30000,
    });
  }

  public getConfig() {
    return getServiceConfig();
  }

  public getAuthHeader() {
    const config = getServiceConfig();
    const token = config.token;
    const userId = (config as any).userId;

    let authHeader = `MediaBrowser Client="SoundX Desktop", Device="Desktop", DeviceId="soundx-desktop-id", Version="1.0.0", App="SoundX"`;
    if (userId) authHeader += `, UserId="${userId}"`;
    if (token) authHeader += `, Token="${token}"`;

    const headers: any = {
      "X-Emby-Authorization": authHeader,
    };

    if (token) {
      headers["X-Emby-Token"] = token;
    }

    return headers;
  }

  public getBaseUrl(): string {
    const config = getServiceConfig();
    let url = config.baseUrl || getBaseURL();
    if (url && !url.includes("/emby")) {
      url = url.replace(/\/+$/, "") + "/emby";
    }
    return url;
  }

  private getUserId(): string {
    const config = getServiceConfig() as any;
    return config.userId || "";
  }

  public getImageUrl(itemId: string, tag?: string) {
    const token = getServiceConfig().token;
    const encodedId = encodeURIComponent(itemId);
    const query = new URLSearchParams({
      maxHeight: "300",
      maxWidth: "300",
      quality: "90",
    });
    if (tag) {
      query.set("tag", tag);
    }
    if (token) {
      query.set("api_key", token);
    }
    return `${this.getBaseUrl().replace(/\/+$/, "")}/Items/${encodedId}/Images/Primary?${query.toString()}`;
  }

  public getStreamUrl(itemId: string) {
    const token = getServiceConfig().token;
    return `${this.getBaseUrl().replace(/\/+$/, "")}/Audio/${itemId}/stream?static=true&api_key=${token}`;
  }

  public async get<T>(endpoint: string, params: any = {}): Promise<T> {
    const baseURL = this.getBaseUrl();
    if (!baseURL) throw new Error("Base URL not set");

    const url = `${baseURL.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
    const headers = this.getAuthHeader();

    console.log(`[Emby Client] GET Request:`, { url, params, headers });

    try {
      const response = await this.axios.get<T>(url, {
        params,
        headers,
      });
      console.log(`[Emby Client] GET Success:`, { url, status: response.status });
      return response.data;
    } catch (error: any) {
      console.error(`[Emby Client] GET Error:`, { 
        url, 
        status: error.response?.status, 
        data: error.response?.data,
        message: error.message 
      });
      throw error;
    }
  }

  public async request<T>(method: "GET" | "POST" | "DELETE" | "PUT", endpoint: string, params: any = {}, body: any = undefined): Promise<T> {
    const baseURL = this.getBaseUrl();
    if (!baseURL) throw new Error("Base URL not set");

    const url = `${baseURL.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
    const headers = this.getAuthHeader();

    console.log(`[Emby Client] ${method} Request:`, { url, params, body, headers });

    try {
      const response = await this.axios.request<T>({
        method,
        url,
        params,
        data: body,
        headers,
      });
      console.log(`[Emby Client] ${method} Success:`, { url, status: response.status });
      return response.data;
    } catch (error: any) {
      console.error(`[Emby Client] ${method} Error:`, { 
        url, 
        status: error.response?.status, 
        data: error.response?.data,
        message: error.message 
      });
      throw error;
    }
  }
}
