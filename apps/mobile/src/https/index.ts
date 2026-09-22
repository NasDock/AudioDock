import AsyncStorage from "@react-native-async-storage/async-storage";
import { setRequestInstance } from "@soundx/services";
import axios, { AxiosError, type AxiosResponse } from "axios";

let activeBaseURL = "http://localhost:3000";

// Get base URL synchronously for UI rendering
export function getBaseURL(): string {
  return activeBaseURL;
}

const instance = axios.create({
  baseURL: activeBaseURL,
  timeout: 30000,
});

// Initialize base URL from storage
export async function initBaseURL() {
  try {
    const savedAddress = await AsyncStorage.getItem("serverAddress");
    if (savedAddress) {
      activeBaseURL = savedAddress;
      instance.defaults.baseURL = savedAddress;
    }
  } catch (e) {
    console.error("Failed to init base URL:", e);
  }
}

// Set base URL manually (e.g. after login)
export function setBaseURL(url: string) {
  activeBaseURL = url;
  instance.defaults.baseURL = url;
}

/**
 * 当前数据源的稳定标识（用于本地缓存按源隔离）。
 *
 * 背景：mobile 音频缓存只按 track_id 存（{trackId}.{ext}），多数据源下 track_id
 * 撞车会串歌（A 源缓存的歌，切到 B 源同 track_id 被误命中）。把 baseURL 归一化后
 * 哈希成 sourceKey，缓存文件与离线元数据按源隔离，不同源互不命中。
 *
 * 同步返回：基于内存态 activeBaseURL（initBaseURL/setBaseURL 时已写入），
 * 无需 await AsyncStorage，可用于起播的同步缓存索引。
 */
export function getSourceKey(): string {
  const raw = activeBaseURL.trim().toLowerCase().replace(/\/+$/, "");
  if (raw === "" ) return "default";
  // FNV-1a 简易稳定哈希，仅作源区分，不需要密码学强度
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const messageContent: { [key in number]: string } = {
  0: "未知错误",
  201: "创建成功",
  401: "验证失败",
  403: "禁止访问",
  404: "接口不存在",
  500: "服务器错误",
};

instance.interceptors.request.use(
  async (config) => {
    try {
      // Tokens are stored per baseURL
      const tokenKey = `token_${activeBaseURL}`;
      const token = await AsyncStorage.getItem(tokenKey);
      if (token) {
        config.headers.set("Authorization", `Bearer ${token}`);
      }
      // Ensure baseURL is up to date
      config.baseURL = activeBaseURL;
    } catch (e) {
      console.error("Failed to get token:", e);
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

instance.interceptors.response.use(
  (response: AxiosResponse) => {
    return response.data;
  },
  (error: AxiosError) => {
    const status = error.response?.status ?? 0;
    const isNetworkError = !error.response || status === 0;
    const msg = isNetworkError ? "Connection lost or server unreachable" : (messageContent[status] || error.message);
    
    if (isNetworkError) {
      console.warn(`[Network] ${error.config?.method?.toUpperCase()} ${error.config?.url} failed. BaseURL: ${error.config?.baseURL}`);
    } else {
      console.warn(`API Error (${status}): ${msg}`);
    }
    
    return Promise.reject(error);
  }
);

setRequestInstance(instance);

export default instance;
