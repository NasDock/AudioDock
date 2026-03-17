import type { ISuccessResponse } from "./models";
import request from "./request";

export enum TaskStatus {
  INITIALIZING = 'INITIALIZING',
  PREPARING = 'PREPARING',
  PARSING = 'PARSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export interface ImportTask {
  id: string;
  status: TaskStatus;
  message?: string;
  mode?: 'incremental' | 'full' | 'compact';
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
  mode?: 'incremental' | 'full' | 'compact';
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

// 创建精简数据任务
export const createCompactTask = (serverAddress?: string) => {
  return createImportTask({
    mode: "compact",
    serverAddress,
  });
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
