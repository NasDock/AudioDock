/**
 * HTTP 模块类型定义
 * 对应 mobile/src/https/index.ts 的类型体系
 */

// HTTP 请求方法
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

// 请求配置选项
export interface RequestOptions {
  /** 请求路径 */
  url: string;
  /** 请求方法 */
  method?: HttpMethod;
  /** 请求头 */
  headers?: Record<string, string>;
  /** 请求体数据 */
  data?: object | string | ArrayBuffer;
  /** 超时时间(ms)，默认 30000 */
  timeout?: number;
  /** 是否自动携带 Token，默认 true */
  autoToken?: boolean;
  /** 重试次数，默认 0 */
  retryCount?: number;
  /** 重试间隔(ms)，默认 1000 */
  retryDelay?: number;
}

// 响应数据结构
export interface HttpResponse<T = object> {
  /** 响应数据 */
  data: T;
  /** HTTP 状态码 */
  statusCode: number;
  /** 响应头 */
  headers: Record<string, string>;
}

// 错误数据结构
export interface HttpError {
  /** 错误码 */
  code: number;
  /** 错误信息 */
  message: string;
  /** 请求配置 */
  options?: RequestOptions;
  /** 原始响应（如果有） */
  response?: HttpResponse;
}

// API 响应包装器（后端通用响应格式）
export interface ApiResponse<T = object> {
  /** 业务状态码 */
  code: number;
  /** 响应消息 */
  message?: string;
  /** 响应数据 */
  data?: T;
  /** 时间戳 */
  timestamp?: number;
}

// 分页请求参数
export interface PaginationParams {
  /** 页码（从 1 开始） */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
  /** 排序字段 */
  sortBy?: string;
  /** 排序方向 asc/desc */
  sortOrder?: 'asc' | 'desc';
}

// 分页响应数据
export interface PaginatedResponse<T = object> {
  /** 当前页数据 */
  list: T[];
  /** 当前页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 总记录数 */
  total: number;
  /** 总页数 */
  totalPages: number;
}

// 文件上传进度
export interface UploadProgress {
  /** 已上传字节数 */
  loaded: number;
  /** 总字节数 */
  total: number;
  /** 上传进度百分比 0-100 */
  percent: number;
}

// 业务错误码映射
export const HTTP_ERROR_MESSAGES: Record<number, string> = {
  0: '未知错误',
  201: '创建成功',
  400: '请求参数错误',
  401: '验证失败，请重新登录',
  403: '禁止访问',
  404: '接口不存在',
  408: '请求超时',
  429: '请求过于频繁',
  500: '服务器错误',
  502: '网关错误',
  503: '服务不可用',
  504: '网关超时',
};

// 网络错误码
export const NETWORK_ERROR_CODES = {
  /** 连接失败 */
  CONNECTION_FAILED: -1,
  /** 请求超时 */
  TIMEOUT: -2,
  /** 网络不可用 */
  NETWORK_UNAVAILABLE: -3,
  /** 解析错误 */
  PARSE_ERROR: -4,
  /** 取消请求 */
  ABORTED: -5,
};
