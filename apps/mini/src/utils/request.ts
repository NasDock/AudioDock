import { setPlatformAdapter, setRequestInstance, plusRequest } from '@soundx/services';
import Taro from '@tarojs/taro';
import axios, { AxiosAdapter, AxiosError, AxiosResponse } from 'axios';

// H5 同源部署时默认指向 nginx 代理的 /api（与 Docker 里的后端同源）；
// 小程序端保持 localhost:3000，由用户在登录页填写实际服务端地址。
const DEFAULT_BASE_URL =
  process.env.TARO_ENV === "h5" && typeof window !== "undefined" && window.location
    ? `${window.location.origin}/api`
    : "http://localhost:3000";

let activeBaseURL = DEFAULT_BASE_URL;

// Custom Adapter to ensure headers are handled correctly
const taroAdapter: AxiosAdapter = (config) => {
  return new Promise((resolve, reject) => {
    const url = config.baseURL 
      ? (config.url?.startsWith('http') ? config.url : `${config.baseURL}${config.url}`) 
      : config.url;

    // Ensure headers are a plain object
    let headers: any = config.headers || {};
    if (typeof headers.toJSON === 'function') {
      headers = headers.toJSON();
    }
    
    // Extract params correctly, axios config.data might be a stringified JSON
    let requestData = config.data;
    if (typeof requestData === 'string') {
      try {
        requestData = JSON.parse(requestData);
      } catch (e) {
        // Not JSON string
      }
    }

    // For non-GET methods, Taro treats `data` as the request body, so query params
    // must be appended to the URL explicitly to match axios/REST conventions.
    // For GET, Taro serializes `data` into the query string, so params stay there.
    const method = (config.method?.toUpperCase() || 'GET');
    let finalUrl: string = url!;
    if (method !== 'GET' && method !== 'HEAD' && config.params && typeof config.params === 'object') {
      const queryString = Object.keys(config.params)
        .filter((key) => config.params[key] !== undefined && config.params[key] !== null)
        .map((key) => {
          const value = config.params[key];
          return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
        })
        .join('&');
      if (queryString) {
        finalUrl = finalUrl.includes('?') ? `${finalUrl}&${queryString}` : `${finalUrl}?${queryString}`;
      }
    }

    // creating a union of data and params, as Taro uses 'data' for both body and query params depending on method
    const requestConfig: Taro.request.Option = {
      url: finalUrl,
      method: method as any,
      header: headers, // Taro uses 'header' not 'headers'
      data: method === 'GET' || method === 'HEAD' ? (requestData || config.params) : requestData,
      responseType: config.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
      dataType: config.responseType === 'json' ? 'json' : undefined,
      success: (res) => {
        const response: AxiosResponse = {
          data: res.data,
          status: res.statusCode,
          statusText: res.errMsg,
          headers: res.header,
          config: config,
          request: null
        };
        resolve(response);
      },
      fail: (err) => {
        const error = new Error(err.errMsg) as any;
        error.config = config;
        error.request = null;
        error.response = null; 
        error.isTaroError = true;
        reject(error);
      }
    };

    Taro.request(requestConfig);
  });
};

export function getBaseURL(): string {
  return activeBaseURL;
}

export function setBaseURL(url: string) {
  activeBaseURL = url;
  instance.defaults.baseURL = url;
}

const instance = axios.create({
  adapter: taroAdapter, // Use our custom adapter
  timeout: 10000,
  baseURL: activeBaseURL
})

const messageContent: { [key in number]: string } = {
  0: "未知错误",
  201: "创建成功",
  401: "验证失败",
  403: "禁止访问",
  404: "接口不存在",
  500: "服务器错误",
  413: "Payload Too Large"
};

instance.interceptors.request.use(
  async (config) => {
    // Strip undefined values so they don't get serialized as "undefined" in URLs
    if (config.params) {
      Object.keys(config.params).forEach(key => {
        if (config.params[key] === undefined) {
          delete config.params[key];
        }
      });
    }

    try {
      const token = Taro.getStorageSync("token");

      if (token) {
        console.log("Token found:", token);
        if (!config.headers) {
          config.headers = {} as any
        }
        // Direct assignment to the headers object
        config.headers['Authorization'] = `Bearer ${token}`;
      }
      
      return config;
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
plusRequest.defaults.adapter = taroAdapter;
// 平台服务通道（第三方音乐源下的设备列表/播放流转）同样没有 XHR，必须走 Taro 请求
setPlatformAdapter(taroAdapter);

export default instance;
