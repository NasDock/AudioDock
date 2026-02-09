import type { ISuccessResponse } from "./models";
import request from "./request";

export enum TaskStatus {
  INITIALIZING = 'INITIALIZING',
  PARSING = 'PARSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export interface ImportTask {
  id: string;
  status: TaskStatus;
  message?: string;
  total?: number;
  current?: number;
  localTotal?: number;
  localCurrent?: number;
  webdavTotal?: number;
  webdavCurrent?: number;
  currentFileName?: string;
}

export interface CreateTaskParams {
  serverAddress?: string;
  musicPath?: string;
  audiobookPath?: string;
  cachePath?: string;
  mode?: 'incremental' | 'full';
}

export interface CreateTaskResponse {
  id: string;
}

// 创建导入任务
export const createImportTask = (data: CreateTaskParams) => {
  const { serverAddress, ...taskData } = data;
  return request.post<any, ISuccessResponse<CreateTaskResponse>>(
    "/import/task",
    taskData,
    {
      baseURL: serverAddress,
    }
  );
};

// 查询任务状态
export const getImportTask = (id: string, serverAddress?: string) => {
  return request.get<any, ISuccessResponse<ImportTask>>(
    `/import/task/${id}`,
    serverAddress ? { baseURL: serverAddress } : undefined
  );
};

// 获取当前正在运行的导入任务
export const getRunningImportTask = (serverAddress?: string) => {
  return request.get<any, ISuccessResponse<ImportTask>>(
    "/import/current-task",
    serverAddress ? { baseURL: serverAddress } : undefined
  );
};
