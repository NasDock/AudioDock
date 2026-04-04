/**
 * HTTP 请求封装模块
 * 基于 HarmonyOS http.createHttp() 实现
 * 功能对标: mobile/src/https/index.ts
 *
 * 支持特性:
 * - 自动 Token 注入
 * - 超时控制
 * - 重试机制
 * - 统一错误处理
 * - 请求/响应拦截器
 */

import http from '@ohos.net.http';
import { BusinessError } from '@kit.BasicServicesKit';
import { preferences } from '@kit.ArkData';
import { promptAction } from '@kit.ArkUI';
import {
  HttpMethod,
  RequestOptions,
  HttpResponse,
  HttpError,
  HTTP_ERROR_MESSAGES,
  NETWORK_ERROR_CODES
} from './types';
import { Logger } from '../utils/Logger';

const TAG = 'HttpRequest';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRY_COUNT = 0;
const DEFAULT_RETRY_DELAY = 1000;

// 全局配置
let globalBaseURL = 'http://localhost:3000';
let isInitialized = false;

// Preferences 实例缓存
let preferencesInstance: preferences.Preferences | null = null;

/**
 * 获取 Preferences 实例（Token 存储）
 */
async function getPreferences(): Promise<preferences.Preferences> {
  if (preferencesInstance) {
    return preferencesInstance;
  }
  preferencesInstance = await preferences.getPreferences(getContext(), {
    name: 'http_config'
  });
  return preferencesInstance;
}

/**
 * 获取当前 Token
 */
async function getToken(): Promise<string | null> {
  try {
    const prefs = await getPreferences();
    return prefs.getSync(`token_${globalBaseURL}`, '') as string || null;
  } catch (e) {
    Logger.warn(TAG, `Failed to get token: ${e}`);
    return null;
  }
}

/**
 * 设置 Token
 */
async function setToken(token: string): Promise<void> {
  try {
    const prefs = await getPreferences();
    await prefs.put(`token_${globalBaseURL}`, token);
    await prefs.flush();
  } catch (e) {
    Logger.error(TAG, `Failed to set token: ${e}`);
  }
}

/**
 * 设置全局 BaseURL
 */
export function setBaseURL(url: string): void {
  globalBaseURL = url;
}

/**
 * 获取全局 BaseURL
 */
export function getBaseURL(): string {
  return globalBaseURL;
}

/**
 * 初始化 HTTP 模块
 * 恢复持久化的 BaseURL 和 Token
 */
export async function initHttpModule(): Promise<void> {
  if (isInitialized) {
    return;
  }
  try {
    const prefs = await getPreferences();
    const savedBaseURL = prefs.getSync('serverAddress', '') as string;
    if (savedBaseURL) {
      globalBaseURL = savedBaseURL;
    }
    isInitialized = true;
    Logger.info(TAG, `HTTP module initialized. BaseURL: ${globalBaseURL}`);
  } catch (e) {
    Logger.error(TAG, `Failed to init HTTP module: ${e}`);
  }
}

/**
 * 保存服务器地址到本地
 */
export async function saveServerAddress(address: string): Promise<void> {
  try {
    const prefs = await getPreferences();
    await prefs.put('serverAddress', address);
    await prefs.flush();
    globalBaseURL = address;
    Logger.info(TAG, `Server address saved: ${address}`);
  } catch (e) {
    Logger.error(TAG, `Failed to save server address: ${e}`);
  }
}

/**
 * 清除所有持久化数据
 */
export async function clearHttpStorage(): Promise<void> {
  try {
    const prefs = await getPreferences();
    await prefs.clear();
    await prefs.flush();
    Logger.info(TAG, 'HTTP storage cleared');
  } catch (e) {
    Logger.error(TAG, `Failed to clear HTTP storage: ${e}`);
  }
}

/**
 * 构建完整的请求 URL
 */
function buildUrl(url: string, baseURL?: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  const base = baseURL || globalBaseURL;
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedUrl = url.startsWith('/') ? url : `/${url}`;
  return `${normalizedBase}${normalizedUrl}`;
}

/**
 * 解析响应头为 Record<string, string>
 */
function parseHeaders(header: [string, string][]): Record<string, string> {
  const result: Record<string, string> = {};
  if (Array.isArray(header)) {
    for (const [key, value] of header) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 创建 HTTP 请求实例（每次请求创建新实例）
 */
function createHttpRequest(timeout: number): http.HttpRequest {
  return http.createHttp();
}

/**
 * 睡眠函数（用于重试间隔）
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 解析错误信息
 */
function parseErrorMessage(statusCode: number, responseMessage?: string): string {
  if (responseMessage) {
    return responseMessage;
  }
  return HTTP_ERROR_MESSAGES[statusCode] || `HTTP Error ${statusCode}`;
}

/**
 * 显示网络错误提示
 */
function showNetworkError(message: string): void {
  try {
    promptAction.showToast({
      message,
      duration: 2000
    });
  } catch (e) {
    // 如果在非UI上下文，忽略toast错误
  }
}

/**
 * 检查是否为网络错误
 */
function isNetworkError(code: number): boolean {
  return code === NETWORK_ERROR_CODES.CONNECTION_FAILED ||
         code === NETWORK_ERROR_CODES.TIMEOUT ||
         code === NETWORK_ERROR_CODES.NETWORK_UNAVAILABLE;
}

// ============ 核心请求方法 ============

/**
 * HTTP 请求（支持重试）
 * @param options 请求配置
 * @returns Promise<HttpResponse<T>>
 */
export async function request<T = object>(options: RequestOptions): Promise<HttpResponse<T>> {
  const {
    url,
    method = 'GET',
    headers = {},
    data,
    timeout = DEFAULT_TIMEOUT,
    autoToken = true,
    retryCount = DEFAULT_RETRY_COUNT,
    retryDelay = DEFAULT_RETRY_DELAY
  } = options;

  const fullUrl = buildUrl(url);
  let token: string | null = null;

  // 自动注入 Token
  if (autoToken) {
    token = await getToken();
  }

  let lastError: HttpError | null = null;
  let attempt = 0;

  while (attempt <= retryCount) {
    attempt++;
    const httpRequest = createHttpRequest(timeout);

    try {
      // 构建请求头
      const requestHeaders: Record<string, string> = { ...headers };
      if (token) {
        requestHeaders['Authorization'] = `Bearer ${token}`;
      }
      requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';

      Logger.info(TAG, `[${attempt}/${retryCount + 1}] ${method} ${fullUrl}`);

      // 发起请求
      const result = await new Promise<http.HttpResponse<T>>((resolve, reject) => {
        httpRequest.request(
          fullUrl,
          {
            method: http.RequestMethod[method as keyof typeof http.RequestMethod] || http.RequestMethod.GET,
            header: Object.entries(requestHeaders).map(([k, v]) => [k, v] as [string, string]),
            extraData: data,
            expectDataType: http.HttpDataType.OBJECT,
            connectTimeout: timeout,
            readTimeout: timeout,
          },
          (err: BusinessError, resp) => {
            if (err) {
              reject(err);
            } else {
              resolve(resp as http.HttpResponse);
            }
          }
        );
      });

      // 解析响应
      const statusCode = result.responseCode;
      const responseHeaders = parseHeaders(result.header as [string, string][]);
      const responseData = result.result as T;

      // 2xx 成功
      if (statusCode >= 200 && statusCode < 300) {
        httpRequest.destroy();
        return {
          data: responseData,
          statusCode,
          headers: responseHeaders
        };
      }

      // 4xx 客户端错误
      if (statusCode >= 400 && statusCode < 500) {
        httpRequest.destroy();
        const error: HttpError = {
          code: statusCode,
          message: parseErrorMessage(statusCode),
          options,
          response: { data: responseData, statusCode, headers: responseHeaders }
        };
        throw error;
      }

      // 5xx 服务器错误
      if (statusCode >= 500) {
        httpRequest.destroy();
        const error: HttpError = {
          code: statusCode,
          message: parseErrorMessage(statusCode),
          options,
          response: { data: responseData, statusCode, headers: responseHeaders }
        };
        throw error;
      }

      // 其他状态码
      httpRequest.destroy();
      return {
        data: responseData,
        statusCode,
        headers: responseHeaders
      };

    } catch (err) {
      const businessErr = err as BusinessError;
      const errorCode = businessErr.code ?? 0;
      const errorMessage = businessErr.message || '';

      // 网络层错误（连接失败、超时等）
      if (isNetworkError(errorCode) || errorCode === -1) {
        lastError = {
          code: errorCode,
          message: errorMessage || '网络连接失败，请检查网络',
          options
        };

        // 可重试的错误
        if (attempt <= retryCount) {
          Logger.warn(TAG, `Request failed, retrying in ${retryDelay}ms... (${attempt}/${retryCount + 1})`);
          await sleep(retryDelay);
          continue;
        }

        showNetworkError(lastError.message);
        httpRequest.destroy();
        throw lastError;
      }

      // 业务层抛出的 HttpError
      if (errorCode === 401 || errorCode === 403 || errorCode === 404 || errorCode >= 500) {
        httpRequest.destroy();
        throw lastError || {
          code: errorCode,
          message: parseErrorMessage(errorCode, errorMessage),
          options
        };
      }

      // 其他错误
      httpRequest.destroy();
      throw {
        code: errorCode,
        message: errorMessage || parseErrorMessage(statusCode || errorCode),
        options
      };

    } finally {
      httpRequest.destroy();
    }
  }

  throw lastError || {
    code: 0,
    message: '请求失败',
    options
  };
}

// ============ 便捷请求方法 ============

/**
 * GET 请求
 */
export async function get<T = object>(
  url: string,
  params?: Record<string, string | number | boolean>,
  options?: Partial<RequestOptions>
): Promise<HttpResponse<T>> {
  let queryString = '';
  if (params) {
    const entries = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    if (entries.length > 0) {
      queryString = '?' + entries.join('&');
    }
  }
  return request<T>({
    url: url + queryString,
    method: 'GET',
    ...options
  });
}

/**
 * POST 请求
 */
export async function post<T = object>(
  url: string,
  data?: object | string,
  options?: Partial<RequestOptions>
): Promise<HttpResponse<T>> {
  return request<T>({
    url,
    method: 'POST',
    data,
    ...options
  });
}

/**
 * PUT 请求
 */
export async function put<T = object>(
  url: string,
  data?: object | string,
  options?: Partial<RequestOptions>
): Promise<HttpResponse<T>> {
  return request<T>({
    url,
    method: 'PUT',
    data,
    ...options
  });
}

/**
 * DELETE 请求
 */
export async function del<T = object>(
  url: string,
  options?: Partial<RequestOptions>
): Promise<HttpResponse<T>> {
  return request<T>({
    url,
    method: 'DELETE',
    ...options
  });
}

/**
 * PATCH 请求
 */
export async function patch<T = object>(
  url: string,
  data?: object | string,
  options?: Partial<RequestOptions>
): Promise<HttpResponse<T>> {
  return request<T>({
    url,
    method: 'PATCH',
    data,
    ...options
  });
}

// ============ 文件下载 ============

/**
 * 文件下载（支持进度回调）
 */
export async function downloadFile(
  url: string,
  savePath: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<string> {
  const fullUrl = buildUrl(url);
  const httpRequest = createHttpRequest(DEFAULT_TIMEOUT);
  const token = await getToken();

  const requestHeaders: Record<string, string> = {};
  if (token) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  return new Promise((resolve, reject) => {
    httpRequest.downloadFile(
      savePath,
      {
        url: fullUrl,
        method: http.RequestMethod.GET,
        header: Object.entries(requestHeaders).map(([k, v]) => [k, v] as [string, string]),
      },
      (err: BusinessError, progress) => {
        if (err) {
          reject(err);
          return;
        }
        if (progress.status === 0 && onProgress) {
          onProgress(progress.receivedSize, progress.totalSize);
        }
        if (progress.status === 2) {
          // 下载完成
          httpRequest.destroy();
          resolve(savePath);
        }
      }
    );
  });
}

// ============ Token 管理 ============

/**
 * 设置登录 Token
 */
export async function setAuthToken(token: string): Promise<void> {
  await setToken(token);
}

/**
 * 清除登录 Token
 */
export async function clearAuthToken(): Promise<void> {
  try {
    const prefs = await getPreferences();
    await prefs.delete(`token_${globalBaseURL}`);
    await prefs.flush();
    Logger.info(TAG, 'Auth token cleared');
  } catch (e) {
    Logger.error(TAG, `Failed to clear auth token: ${e}`);
  }
}

/**
 * 检查是否已登录
 */
export async function isLoggedIn(): Promise<boolean> {
  const token = await getToken();
  return !!token;
}

// ============ 默认导出 ============

export default {
  init: initHttpModule,
  setBaseURL,
  getBaseURL,
  saveServerAddress,
  clearStorage: clearHttpStorage,
  setAuthToken,
  clearAuthToken,
  isLoggedIn,
  request,
  get,
  post,
  put,
  delete: del,
  patch,
  downloadFile,
};
