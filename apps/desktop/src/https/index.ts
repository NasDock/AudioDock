import { setRequestInstance, setServiceConfig, SOURCEMAP, useEmbyAdapter, useNativeAdapter, useSubsonicAdapter } from "@soundx/services";
import axios, { AxiosError, type AxiosResponse } from "axios";
import { useAuthStore } from "../store/auth";

// Get base URL based on environment
export function getBaseURL(): string {
  // In production, use server address from localStorage or default
  try {
    const serverAddress = localStorage.getItem("serverAddress");
    if (serverAddress) {
      return serverAddress;
    }
  } catch (e) {
    console.error("Failed to get server address from localStorage:", e);
  }

  // Default fallback
  return "/api";
}

/**
 * 当前数据源的稳定标识（用于本地缓存按源隔离）。
 *
 * 背景：desktop 的音频缓存只按 track_id 存，多数据源下 track_id 撞车会串歌
 * （A 源缓存的歌，切到 B 源同名 track_id 被误命中）。把 baseURL 归一化后哈希
 * 成 sourceKey，缓存元数据按 `sourceKey_trackId` 隔离，不同源互不命中。
 *
 * 归一化：去协议头差异之外的尾斜杠、转小写，避免 "http://A/" 与 "http://A" 算成两个源。
 */
export function getSourceKey(): string {
  const raw = getBaseURL().trim().toLowerCase().replace(/\/+$/, "");
  // 同源 web 部署（/api 相对路径）统一成一个固定 key，避免空串哈希歧义
  if (raw === "/api" || raw === "") return "sameorigin";
  // 动态 import 会打断缓存同步链路，这里用简易稳定哈希（FNV-1a），
  // 仅作源区分，不需要密码学强度
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const instance = axios.create({
  baseURL: getBaseURL(),
  timeout: 30000,
});

const messageContent: { [key in number]: string } = {
  0: "未知错误",
  201: "创建成功",
  401: "验证失败",
  403: "禁止访问",
  404: "接口不存在",
  500: "服务器错误",
};

instance.interceptors.request.use(
  (config) => {
    const baseURL = getBaseURL();
    const tokenKey = `token_${baseURL}`;
    const token = localStorage.getItem(tokenKey);
    if (token) {
      config.headers.set("Authorization", `Bearer ${token}`);
    }

    // Update baseURL dynamically for every request
    config.baseURL = baseURL;

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
    // 处理 HTTP 网络错误
    // HTTP 状态码
    const status = error.response?.status ?? 0;
    if (status === 401) {
      useAuthStore().logout();
    }
    // message.error(messageContent[status]);
    // Note: message.error cannot be used here as it's outside React context
    // Error handling should be done in components using try-catch
    console.error(`HTTP Error ${status}:`, messageContent[status]);
    return Promise.reject(error);
  }
);

// --- 新增初始化逻辑 ---
const initAdapter = () => {
  try {
    const sourceType = localStorage.getItem("selectedSourceType") || "AudioDock";
    const baseURL = getBaseURL();
    const mappedType = SOURCEMAP[sourceType as keyof typeof SOURCEMAP] || "audiodock";

    // 还原账号信息
    const credsKey = `creds_${sourceType}_${baseURL}`;
    const savedCreds = localStorage.getItem(credsKey);
    let username, password;
    if (savedCreds) {
      const c = JSON.parse(savedCreds);
      username = c.username;
      password = c.password;
    }

    const token = localStorage.getItem(`token_${baseURL}`);
    const userStr = localStorage.getItem(`user_${baseURL}`);
    let userId;
    if (userStr) {
      try {
        const parsed = JSON.parse(userStr);
        userId = parsed?.id || parsed?.user?.id;
      } catch (e) {}
    }

    setServiceConfig({
      username,
      password,
      token: token || undefined,
      userId: (userId && userId !== "undefined") ? userId : undefined,
      baseUrl: baseURL,
    });
    // 还原适配器类型
    if (mappedType === "subsonic") {
      useSubsonicAdapter();
    } else if (mappedType === "emby") {
      useEmbyAdapter();
    } else {
      useNativeAdapter();
    }
  } catch (e) {
    console.error("初始化适配器失败", e);
    useNativeAdapter();
  }
};
initAdapter(); // 立即执行初始化
setRequestInstance(instance);

export default instance;
