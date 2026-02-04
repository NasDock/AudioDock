import { setRequestInstance, setServiceConfig, SOURCEMAP, useNativeAdapter, useSubsonicAdapter } from "@soundx/services";
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
    if (savedCreds) {
      const { username, password } = JSON.parse(savedCreds);
      setServiceConfig({ username, password });
    }
    // 还原适配器类型
    if (mappedType === "subsonic") {
      useSubsonicAdapter();
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
