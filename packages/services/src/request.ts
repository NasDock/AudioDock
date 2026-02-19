import type { AxiosInstance } from "axios";

let requestInstance: AxiosInstance | null = null;
let asrBaseURL = "http://localhost:3300";

import axios from "axios";
export const asrRequest = axios.create({
  baseURL: asrBaseURL,
  timeout: 60000,
});

export const setAsrBaseURL = (url: string) => {
  asrBaseURL = url;
  asrRequest.defaults.baseURL = url;
};


import { mockData } from "./mockUtils";

export const setRequestInstance = (instance: AxiosInstance) => {
  requestInstance = instance;
  
  // Add response interceptor for mocking
  requestInstance.interceptors.response.use((response) => {
    if (response.data) {
        response.data = mockData(response.data);
    }
    return response;
  });
};

export const getRequestInstance = () => {
  if (!requestInstance) {
    throw new Error("Request instance not initialized. Please call setRequestInstance first.");
  }
  return requestInstance;
};

export const getBaseURL = () => {
    if (requestInstance) {
        return requestInstance.defaults.baseURL || "";
    }
    return "";
};

// Facade to match typical axios usage: request.get, request.post etc.
export const request = {
  get: <T = any, R = any, D = any>(url: string, config?: any) => getRequestInstance().get<T, R, D>(url, config),
  delete: <T = any, R = any, D = any>(url: string, config?: any) => getRequestInstance().delete<T, R, D>(url, config),
  head: <T = any, R = any, D = any>(url: string, config?: any) => getRequestInstance().head<T, R, D>(url, config),
  options: <T = any, R = any, D = any>(url: string, config?: any) => getRequestInstance().options<T, R, D>(url, config),
  post: <T = any, R = any, D = any>(url: string, data?: D, config?: any) => getRequestInstance().post<T, R, D>(url, data, config),
  put: <T = any, R = any, D = any>(url: string, data?: D, config?: any) => getRequestInstance().put<T, R, D>(url, data, config),
  patch: <T = any, R = any, D = any>(url: string, data?: D, config?: any) => getRequestInstance().patch<T, R, D>(url, data, config),
  postForm: <T = any, R = any, D = any>(url: string, data?: D, config?: any) => getRequestInstance().postForm<T, R, D>(url, data, config),
  putForm: <T = any, R = any, D = any>(url: string, data?: D, config?: any) => getRequestInstance().putForm<T, R, D>(url, data, config),
  patchForm: <T = any, R = any, D = any>(url: string, data?: D, config?: any) => getRequestInstance().patchForm<T, R, D>(url, data, config),
};

export default request;
