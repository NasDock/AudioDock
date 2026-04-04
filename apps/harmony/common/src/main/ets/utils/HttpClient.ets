/**
 * HTTP Client for AudioDock HarmonyOS App.
 * Wraps HarmonyOS @ohos.net.http API with axios-like interface.
 */
import { http } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';

// ==================== Types ====================
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export interface HttpRequestConfig {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean>;
  data?: object | string | ArrayBuffer;
  timeout?: number;
  contentType?: string;
}
export interface HttpResponse<T> {
  data: T;
  status: number;
  headers: Record<string, string>;
  message?: string;
}

export interface ApiResponse<T> {
  code: number;
  data: T;
  message?: string;
  msg?: string;
}

// ==================== Constants ====================
const DEFAULT_TIMEOUT: number = 30000;
const DEFAULT_CONTENT_TYPE: string = 'application/json';

// ==================== HTTP Client ====================
export class HttpClient {
  private baseURL: string = '';
  private token: string = '';
  private plusToken: string = '';

  /**
   * Set base URL for all requests
   */
  public setBaseURL(url: string): void {
    this.baseURL = url.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Get current base URL
   */
  public getBaseURL(): string {
    return this.baseURL;
  }

  /**
   * Set authentication token
   */
  public setToken(token: string): void {
    this.token = token;
  }

  /**
   * Set plus (VIP) token
   */
  public setPlusToken(plusToken: string): void {
    this.plusToken = plusToken;
  }

  /**
   * Clear all tokens
   */
  public clearTokens(): void {
    this.token = '';
    this.plusToken = '';
  }

  /**
   * Build full URL with query params
   */
  private buildUrl(config: HttpRequestConfig): string {
    let url = config.url;
    
    // Handle relative URLs
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `${this.baseURL}${url.startsWith('/') ? '' : '/'}${url}`;
    }

    // Append query params
    if (config.params) {
      const queryParams = Object.entries(config.params)
        .filter((entry) => entry[1] !== null && entry[1] !== undefined)
        .map((entry) => `${encodeURIComponent(entry[0])}=${encodeURIComponent(String(entry[1]))}`)
        .join('&');
      
      if (queryParams) {
        url += (url.includes('?') ? '&' : '?') + queryParams;
      }
    }

    return url;
  }
  /**
   * Build headers for request
   */
  private buildHeaders(config: HttpRequestConfig): Record<string, string> {
    const headers: Record<string, string> = {};
    
    // Set content type
    headers['Content-Type'] = config.contentType || DEFAULT_CONTENT_TYPE;
    
    // Merge custom headers
    if (config.headers) {
      const headerKeys = Object.keys(config.headers);
      headerKeys.forEach((key: string) => {
        const headerValue = config.headers[key];
        if (headerValue !== undefined) {
          headers[key] = headerValue;
        }
      });
    }

    // Add auth token if available
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // Add plus token if available
    if (this.plusToken) {
      headers['X-Plus-Token'] = this.plusToken;
    }

    return headers;
  }

  /**
   * Convert data to string or ArrayBuffer
   */
  private serializeData(data: object | string | ArrayBuffer | undefined): string | ArrayBuffer | undefined {
    if (!data) {
      return undefined;
    }

    if (typeof data === 'string' || data instanceof ArrayBuffer) {
      return data;
    }

    // Object will be serialized to JSON string
    return JSON.stringify(data);
  }

  /**
   * Parse response data
   */
  private parseResponse<T>(response: http.HttpResponse): HttpResponse<T> {
    const headerObj = response.header as Record<string, string>;
    const contentType = headerObj['content-type'] || '';
    let data: T = response.result as T;

    // Try to parse JSON if content-type indicates JSON
    if (typeof response.result === 'string' && contentType.includes('application/json')) {
      try {
        data = JSON.parse(response.result) as T;
      } catch (e) {
        // Keep as string if parsing fails
      }
    }

    return {
      data,
      status: response.responseCode,
      headers: headerObj,
      message: ''
    };
  }
  /**
   * Main request method
   */
  public async request<T>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    const url = this.buildUrl(config);
    const headers = this.buildHeaders(config);
    const timeout = config.timeout || DEFAULT_TIMEOUT;

    // Create HTTP request
    const httpRequest = http.createHttp();

    try {
      const options: http.HttpRequestOptions = {
        method: (config.method || 'GET') as http.RequestMethod,
        header: headers,
        expectDataType: http.HttpDataType.STRING,
        timeout: timeout
      };

      // Add request body for methods that support it
      if (config.data && ['POST', 'PUT', 'PATCH'].includes(config.method || 'GET')) {
        options.extraData = this.serializeData(config.data);
      }

      // Execute request
      const response = await httpRequest.request(url, options);

      // Parse and return response
      return this.parseResponse<T>(response);

    } catch (error) {
      const err = error as BusinessError;
      
      // Handle network errors
      if (err.code === 2300001 || err.code === 2300002) {
        throw new HttpError('NETWORK_ERROR', 'Network unavailable or server unreachable', err.code);
      }
      
      throw new HttpError('REQUEST_FAILED', err.message || 'Request failed', err.code);
    } finally {
      // Release the HTTP request
      httpRequest.destroy();
    }
  }
  /**
   * GET request
   */
  public get<T>(url: string, params?: Record<string, string | number | boolean>, config?: Partial<HttpRequestConfig>): Promise<HttpResponse<T>> {
    const requestConfig: HttpRequestConfig = {
      url,
      method: 'GET',
      params
    };
    
    // Merge config if provided
    if (config) {
      if (config.method) requestConfig.method = config.method;
      if (config.headers) requestConfig.headers = config.headers;
      if (config.data) requestConfig.data = config.data;
      if (config.timeout) requestConfig.timeout = config.timeout;
      if (config.contentType) requestConfig.contentType = config.contentType;
    }
    
    return this.request<T>(requestConfig);
  }
  /**
   * POST request
   */
  public post<T>(url: string, data?: object, config?: Partial<HttpRequestConfig>): Promise<HttpResponse<T>> {
    const requestConfig: HttpRequestConfig = {
      url,
      method: 'POST',
      data
    };
    
    // Merge config if provided
    if (config) {
      if (config.method) requestConfig.method = config.method;
      if (config.headers) requestConfig.headers = config.headers;
      if (config.data) requestConfig.data = config.data;
      if (config.timeout) requestConfig.timeout = config.timeout;
      if (config.contentType) requestConfig.contentType = config.contentType;
    }
    
    return this.request<T>(requestConfig);
  }

  /**
   * PUT request
   */
  public put<T = Object>(url: string, data?: object, config?: Partial<HttpRequestConfig>): Promise<HttpResponse<T>> {
    const reqConfig: HttpRequestConfig = {
      url: url,
      method: 'PUT',
      data: data
    };
    if (config) {
      if (config.headers) reqConfig.headers = config.headers;
      if (config.timeout) reqConfig.timeout = config.timeout;
      if (config.contentType) reqConfig.contentType = config.contentType;
    }
    return this.request<T>(reqConfig);
  }

  /**
   * DELETE request
   */
  public delete<T = Object>(url: string, config?: Partial<HttpRequestConfig>): Promise<HttpResponse<T>> {
    const reqConfig: HttpRequestConfig = {
      url: url,
      method: 'DELETE'
    };
    if (config) {
      if (config.headers) reqConfig.headers = config.headers;
      if (config.timeout) reqConfig.timeout = config.timeout;
      if (config.contentType) reqConfig.contentType = config.contentType;
    }
    return this.request<T>(reqConfig);
  }

  /**
   * PATCH request
   */
  public patch<T = Object>(url: string, data?: object, config?: Partial<HttpRequestConfig>): Promise<HttpResponse<T>> {
    const reqConfig: HttpRequestConfig = {
      url: url,
      method: 'PATCH',
      data: data
    };
    if (config) {
      if (config.headers) reqConfig.headers = config.headers;
      if (config.timeout) reqConfig.timeout = config.timeout;
      if (config.contentType) reqConfig.contentType = config.contentType;
    }
    return this.request<T>(reqConfig);
  }
}

// ==================== HTTP Error ====================
export class HttpError extends Error {
  public code: string;
  public status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'HttpError';
  }
}

// ==================== Singleton Instance ====================
export const httpClient: HttpClient = new HttpClient();
