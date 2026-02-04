import { getAdapter } from "./adapter/manager";
import type { User } from "./models";
  
  export const login = async (user: Partial<User> & { deviceName?: string }) => {
    return getAdapter().auth.login(user);
  };
  
  export const register = (user: Partial<User> & { deviceName?: string }) => {
    return getAdapter().auth.register(user);
  };
  
  export const check = () => {
    return getAdapter().auth.check();
  };
  
  export const hello = () => {
    return getAdapter().auth.hello();
  };

  export const verifyDevice = (username: string, deviceName: string) => {
    return getAdapter().auth.verifyDevice(username, deviceName);
  };

  export const resetPassword = (username: string, deviceName: string, newPassword: string) => {
    return getAdapter().auth.resetPassword(username, deviceName, newPassword);
  };