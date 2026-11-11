import http from '@ohos.net.http';
import { Logger } from 'audiodock_common';
import { HttpError, safeStringify } from './HttpError';
import type {
  RequestConfig, HttpResponse,
  BackendEnvelope, RequestInterceptor, ResponseInterceptor, ErrorInterceptor,
} from './types';

const DEFAULT_TIMEOUT = 30_000;
const RETRY_DELAY_MS = 800;

export class HarmonyHttpClient {
  private baseURL: string = '';
  private defaultHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  private authToken: string | null = null;
  private reqInterceptors: RequestInterceptor[] = [];
  private resInterceptors: ResponseInterceptor[] = [];
  private errInterceptors: ErrorInterceptor[] = [];

  setBaseURL(url: string): void {
    this.baseURL = url.replace(/\/+$/, '');
    Logger.i('HttpClient', `baseURL=${this.baseURL}`);
  }

  getBaseURL(): string { return this.baseURL; }

  setAuthToken(token: string | null): void { this.authToken = token; }

  getAuthToken(): string | null { return this.authToken; }

  addRequestInterceptor(i: RequestInterceptor): void { this.reqInterceptors.push(i); }
  addResponseInterceptor(i: ResponseInterceptor): void { this.resInterceptors.push(i); }
  addErrorInterceptor(i: ErrorInterceptor): void { this.errInterceptors.push(i); }

  private mergeConfig(cfg: RequestConfig, timeoutMs: number): RequestConfig {
    return {
      method: cfg.method,
      url: cfg.url,
      baseURL: cfg.baseURL,
      headers: cfg.headers,
      params: cfg.params,
      data: cfg.data,
      timeoutMs: timeoutMs,
      retry: cfg.retry,
    };
  }

  private mergeHeaders(base: Record<string, string>, extra: Record<string, string> | undefined): Record<string, string> {
    const result: Record<string, string> = {};
    const baseKeys = Object.keys(base);
    for (let i = 0; i < baseKeys.length; i++) {
      const key = baseKeys[i];
      result[key] = base[key];
    }
    if (extra !== undefined) {
      const extraKeys = Object.keys(extra);
      for (let i = 0; i < extraKeys.length; i++) {
        const key = extraKeys[i];
        result[key] = extra[key];
      }
    }
    return result;
  }

  async request<T>(cfg: RequestConfig): Promise<T> {
    let config: RequestConfig = this.mergeConfig(cfg, cfg.timeoutMs ?? DEFAULT_TIMEOUT);
    for (const i of this.reqInterceptors) config = await i.intercept(config);

    if (config.baseURL === undefined) config.baseURL = this.baseURL;
    if (this.authToken && config.headers?.['Authorization'] === undefined) {
      config.headers = this.mergeHeaders(config.headers ?? {}, { 'Authorization': `Bearer ${this.authToken}` });
    }

    let attempts = 0;
    let lastError: HttpError | null = null;
    while (attempts < (config.retry ? 2 : 1)) {
      let response: HttpResponse<Object> | null = null;
      try {
        response = await this.attempt(config);
      } catch (e) {
        // e 可能是 Error、HttpError、字符串，也可能是普通对象。
        // String(普通对象) === "[object Object]"，会让 UI 渲染炸了。
        let err: HttpError;
        if (e instanceof HttpError) {
          err = e;
        } else {
          err = new HttpError(0, safeStringify(e, 'request failed'));
        }
        for (const i of this.errInterceptors) err = await i.intercept(err);
        lastError = err;
        attempts += 1;
        if (config.retry && err.status === 0 && attempts < (config.retry ? 2 : 1)) {
          await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw err;
      }

      if (response === null) break;

      if (config.retry && response.status >= 500 && attempts < 1) {
        attempts += 1;
        await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        const httpErr = HttpError.fromStatus(response.status, response.data as object | null);
        let finalErr = httpErr;
        for (const i of this.errInterceptors) finalErr = await i.intercept(finalErr);
        Logger.w('LoginDiag', `http fail url=${this.buildUrl(config)} status=${response.status} err=${finalErr.message}`);
        throw finalErr;
      }

      const env = response.data as BackendEnvelope<T>;
      if (env && typeof env === 'object') {
        // 后端所有响应都带 code（含错误响应，错误时无 data 字段）
        if (env.code !== undefined) {
          const code = env.code;
          Logger.i('LoginDiag', `http ok url=${this.buildUrl(config)} status=${response.status} env.code=${code}`);
          // 后端成功约定是 code: 200（services/api/src/common/const.ts ISuccessResponse）
          if (code !== 200) {
            // env.message 形参类型是 string，但运行时可能是对象/数组（部分旧后端把
            // 多语言文案塞成 { zh: '...', en: '...' } 或错误码对象），必须先用
            // safeStringify 兜底，否则 HttpError.message 会变 [object Object]。
            const message: string = env.message !== undefined && env.message !== null
              ? safeStringify(env.message, `code=${code}`)
              : `code=${code}`;
            const envErr = new HttpError(response.status, message, env);
            let finalErr = envErr;
            for (const i of this.errInterceptors) finalErr = await i.intercept(finalErr);
            throw finalErr;
          }
          return env.data as T;
        }
      }
      return response.data as T;
    }

    if (lastError) throw lastError;
    throw new HttpError(0, 'request failed without response');
  }

  private async attempt(config: RequestConfig): Promise<HttpResponse<Object>> {
    const httpReq = http.createHttp();
    const fullUrl = this.buildUrl(config);
    // 外部数据源（飞牛音乐等）下 baseURL 为空，误走 AudioDock 接口时 URL 会拼成 `/xxx`，
    // 系统 http 只报 2300003「Invalid URL format」，看不出是哪个接口。
    // 这里提前拦截，报错里带上路径，便于定位该补 isFnosSource() 分发的位置。
    if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
      httpReq.destroy();
      throw new HttpError(0, `请求地址无效（当前数据源没有服务端地址）：${fullUrl}`);
    }
    try {
      const mergedHeaders: Record<string, string> = this.mergeHeaders(this.defaultHeaders, config.headers);
      const opts: http.HttpRequestOptions = {
        method: config.method as http.RequestMethod,
        header: mergedHeaders,
        readTimeout: config.timeoutMs,
        connectTimeout: config.timeoutMs,
        extraData: typeof config.data === 'string' ? config.data
          : config.data ? JSON.stringify(config.data) : undefined,
      };
      const resp = await httpReq.request(fullUrl, opts);
      let parsed: Object = resp.result;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { /* keep as string */ }
      }
      const out: HttpResponse<Object> = {
        status: resp.responseCode,
        data: parsed,
        headers: resp.header as Record<string, string>,
      };
      let final: HttpResponse<Object> = out;
      for (const i of this.resInterceptors) final = await i.intercept(final);
      return final;
    } finally {
      httpReq.destroy();
    }
  }

  async get<T>(url: string, params?: Record<string, string | number | boolean>): Promise<T> {
    return this.request<T>({ method: 'GET', url, params, retry: true });
  }
  async post<T>(url: string, data?: object): Promise<T> {
    return this.request<T>({ method: 'POST', url, data });
  }
  async put<T>(url: string, data?: object): Promise<T> {
    return this.request<T>({ method: 'PUT', url, data });
  }
  async del<T>(url: string): Promise<T> {
    return this.request<T>({ method: 'DELETE', url });
  }

  private buildUrl(cfg: RequestConfig): string {
    const base = cfg.baseURL ?? this.baseURL;
    let path = cfg.url.startsWith('/') ? cfg.url : `/${cfg.url}`;
    let full = `${base}${path}`;
    if (cfg.params && Object.keys(cfg.params).length > 0) {
      const entries = Object.entries(cfg.params);
      const parts: string[] = [];
      for (let i = 0; i < entries.length; i++) {
        const k = entries[i][0];
        const v = entries[i][1];
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
      }
      const qs = parts.join('&');
      full += `${full.includes('?') ? '&' : '?'}${qs}`;
    }
    return full;
  }
}

export const httpClient = new HarmonyHttpClient();