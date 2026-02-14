import AsyncStorage from "@react-native-async-storage/async-storage";
import { setAsrBaseURL, setRequestInstance } from "@soundx/services";
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
      setAsrBaseURL(savedAddress + "/asr");
    }
  } catch (e) {
    console.error("Failed to init base URL:", e);
  }
}

// Set base URL manually (e.g. after login)
export function setBaseURL(url: string) {
  activeBaseURL = url;
  instance.defaults.baseURL = url;
  setAsrBaseURL(url + "/asr");
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
