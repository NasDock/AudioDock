import type { ISuccessResponse, User } from "./models";
import request from "./request";

export const getAdminUsers = async () => {
  return request.get<ISuccessResponse<User[]>>("/admin/users");
};

export const createAdminUser = async (data: Partial<User>) => {
  return request.post<ISuccessResponse<User>>("/admin/users", data);
};

export const deleteAdminUser = async (id: number | string) => {
  return request.delete<ISuccessResponse<boolean>>(`/admin/users/${id}`);
};

export const setAdminUserExpiration = async (id: number | string, days: number | null) => {
  return request.post<ISuccessResponse<User>>(`/admin/users/${id}/expiration`, { days });
};

export const getRegistrationSetting = async () => {
  return request.get<ISuccessResponse<boolean>>("/admin/settings/registration");
};

export const toggleRegistrationSetting = async (allowed: boolean) => {
  return request.post<ISuccessResponse<boolean>>("/admin/settings/registration", { allowed });
};
