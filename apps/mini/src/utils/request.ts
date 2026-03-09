import { setAsrBaseURL, setRequestInstance } from '@soundx/services';
import Taro from '@tarojs/taro';
import axios, { AxiosAdapter, AxiosError, AxiosResponse } from 'axios';

let activeBaseURL = "http://localhost:3000";

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
    
    // Explicitly merge generic headers if needed, though Axios usually does this.
    // In strict environments, we might need to be very explicit.
    const requestConfig: Taro.request.Option = {
      url: url!,
      method: (config.method?.toUpperCase() || 'GET') as any,
      header: headers, // Taro uses 'header' not 'headers'
      // creating a union of data and params, as Taro uses 'data' for both body and query params depending on method
      data: config.data || config.params, 
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
  setAsrBaseURL(`${url}/asr`);
}

const instance = axios.create({
  adapter: taroAdapter, // Use our custom adapter
  timeout: 10000,
  baseURL: activeBaseURL
})
setAsrBaseURL(`${activeBaseURL}/asr`);

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

export default instance;
