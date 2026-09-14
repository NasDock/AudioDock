import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    getCurrentUser,
    login as loginApi,
    removePlusToken as removePlusServiceToken,
    register as registerApi,
    setPlusToken as setPlusServiceToken,
    setPlusUnauthorizedHandler,
    setServiceConfig,
    SOURCEMAP,
    useEmbyAdapter,
    useNativeAdapter,
    useSubsonicAdapter
} from "@soundx/services";
import * as Device from 'expo-device';
import { addNetworkStateListener } from 'expo-network';
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { getBaseURL, initBaseURL, setBaseURL } from "../https";
import { refreshNetworkMode } from "../utils/networkMode";
import { User } from "../models";
import { selectBestServer } from "../utils/networkUtils";
import { getDevicePlatform, getOrCreateDeviceId } from "../utils/platform";

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (user: Partial<User>) => Promise<void>;
  register: (user: Partial<User>) => Promise<void>;
  logout: () => Promise<void>;
  device: any | null;
  sourceType: string;
  setSourceType: (type: string) => void;
  switchServer: (url: string, type?: string, skipToken?: boolean) => Promise<void>;
  plusToken: string | null;
  setPlusToken: (token: string | null) => Promise<void>;
  updateUser: (user: User) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isLoading: true,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  device: null,
  sourceType: "AudioDock",
  setSourceType: () => {},
  switchServer: async () => {},
  plusToken: null,
  setPlusToken: async () => {},
  updateUser: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [device, setDevice] = useState<any | null>(null);
  const [sourceType, setSourceTypeDirectly] = useState<string>("AudioDock");
  const [plusToken, setPlusTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const setSourceType = (type: string) => {
    setSourceTypeDirectly(type);
  };

  const normalizeUserPayload = (payload: any): User | null => {
    if (!payload) return null;
    if (payload.user?.id) return payload.user as User;
    if (payload.id) return payload as User;
    return null;
  };

  const getUserId = (payload: any): string | undefined => {
    const user = normalizeUserPayload(payload);
    if (!user?.id) return undefined;
    const id = String(user.id).trim();
    return id && id !== "undefined" ? id : undefined;
  };

  const refreshCurrentUser = async (savedAddress: string, currentToken?: string | null) => {
    try {
      const res = await getCurrentUser();
      if (res.code !== 200 || !res.data) return;
      const normalizedUser = normalizeUserPayload(res.data);
      if (!normalizedUser) return;

      setUser(normalizedUser);
      await AsyncStorage.setItem(`user_${savedAddress}`, JSON.stringify(normalizedUser));
      setServiceConfig({
        token: currentToken || undefined,
        userId: getUserId(normalizedUser),
        baseUrl: savedAddress,
        clientName: "SoundX Mobile",
      });
    } catch (error) {
      console.warn("Failed to refresh current user:", error);
    }
  };

  const autoSwitchServer = async () => {
    try {
      const savedAddress = getBaseURL();
      const savedType = await AsyncStorage.getItem("selectedSourceType") || "AudioDock";
      const configKey = `sourceConfig_${savedType}`;
      const configStr = await AsyncStorage.getItem(configKey);
      if (!configStr) return;

      const parsed = JSON.parse(configStr);
      const configList = Array.isArray(parsed) ? parsed : [parsed];
      const matchedConfig = configList.find(
        (c: any) => c.internal === savedAddress || c.external === savedAddress
      ) || configList[0];

      if (!matchedConfig || (!matchedConfig.internal && !matchedConfig.external)) return;

      const bestAddress = await selectBestServer(
        matchedConfig.internal || "",
        matchedConfig.external || "",
        savedType
      );
      if (!bestAddress || bestAddress === savedAddress) return;

      console.log(`[AutoSwitch] Switching from ${savedAddress} to ${bestAddress}`);

      const oldToken = await AsyncStorage.getItem(`token_${savedAddress}`);
      const oldUser = await AsyncStorage.getItem(`user_${savedAddress}`);
      const oldDevice = await AsyncStorage.getItem(`device_${savedAddress}`);
      const oldCreds = await AsyncStorage.getItem(`creds_${savedType}_${savedAddress}`);

      const newToken = await AsyncStorage.getItem(`token_${bestAddress}`);
      if (!newToken && oldToken) {
        await AsyncStorage.setItem(`token_${bestAddress}`, oldToken);
        if (oldUser) await AsyncStorage.setItem(`user_${bestAddress}`, oldUser);
        if (oldDevice) await AsyncStorage.setItem(`device_${bestAddress}`, oldDevice);
        if (oldCreds) await AsyncStorage.setItem(`creds_${savedType}_${bestAddress}`, oldCreds);
      }

      setBaseURL(bestAddress);
      await AsyncStorage.setItem("serverAddress", bestAddress);
      await AsyncStorage.setItem(`serverAddress_${savedType}`, bestAddress);
      // 切了服务器就重新判定内网/外网，否则封面会继续用旧网络环境下的 URL
      await refreshNetworkMode();
    } catch (e) {
      console.warn("[AutoSwitch] Failed:", e);
    }
  };

  useEffect(() => {
    loadAuthData();
  }, []);

  // 监听 App 从后台切回前台，自动切换内网/外网
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") {
        console.log("[AutoSwitch] App became active, checking network...");
        autoSwitchServer();
      }
    });
    return () => subscription.remove();
  }, []);

  // 监听 WiFi/流量 切换，自动切换内网/外网
  useEffect(() => {
    const networkSubscription = addNetworkStateListener((state) => {
      console.log("[AutoSwitch] Network changed:", state.type, state.isConnected);
      autoSwitchServer();
    });
    return () => networkSubscription.remove();
  }, []);

  useEffect(() => {
    setPlusUnauthorizedHandler(() => {
      void setPlusToken(null);
    });

    return () => {
      setPlusUnauthorizedHandler(null);
    };
  }, []);

  const loadAuthData = async () => {
    try {
      await initBaseURL(); // Initialize base URL first
      let savedAddress = getBaseURL();
      const savedType = (await AsyncStorage.getItem("selectedSourceType")) || "AudioDock";
      setSourceTypeDirectly(savedType);

      // --- Auto Switch Data Source (Internal/External) on Startup ---
      await autoSwitchServer();
      savedAddress = getBaseURL();
      // --------------------------------------------------------------

      // 启动即判定一次内网/外网（autoSwitchServer 可能没发生切换，但地址已由 initBaseURL 确定）
      await refreshNetworkMode();

      const savedToken = await AsyncStorage.getItem(`token_${savedAddress}`);
      const savedUser = await AsyncStorage.getItem(`user_${savedAddress}`);
      const parsedSavedUser = savedUser ? normalizeUserPayload(JSON.parse(savedUser)) : null;

      if (savedToken) {
        setToken(savedToken);
      }
      if (parsedSavedUser) {
        setUser(parsedSavedUser);
      }
      const savedDevice = await AsyncStorage.getItem(`device_${savedAddress}`);
      if (savedDevice) {
        setDevice(JSON.parse(savedDevice));
      }
      const savedPlusToken = await AsyncStorage.getItem("plus_token");
      if (savedPlusToken) {
        setPlusTokenState(savedPlusToken);
        setPlusServiceToken(savedPlusToken);
      }

      // Configure adapter on load
      const mappedType = SOURCEMAP[savedType as keyof typeof SOURCEMAP] || "audiodock";
      const credsKey = `creds_${savedType}_${savedAddress}`;
      const savedCreds = await AsyncStorage.getItem(credsKey);
      let username = undefined;
      let password = undefined;
      if (savedCreds) {
        const creds = JSON.parse(savedCreds);
        username = creds.username;
        password = creds.password;
      }
      setServiceConfig({
        username,
        password,
        token: savedToken || undefined,
        userId: parsedSavedUser?.id ? String(parsedSavedUser.id) : undefined,
        clientName: "SoundX Mobile",
        baseUrl: savedAddress,
      });

      if (mappedType === "subsonic") {
        useSubsonicAdapter();
      } else if (mappedType === "emby") {
        useEmbyAdapter();
      } else {
        useNativeAdapter();
      }

      if (savedToken) {
        await refreshCurrentUser(savedAddress, savedToken);
      }
    } catch (error) {
      console.error("Failed to load auth data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (credentials: Partial<User>) => {
    try {
      const deviceName = Device.modelName || 'Mobile Device';
      const deviceId = await getOrCreateDeviceId();
      const platform = getDevicePlatform();
      console.log("credentials", credentials);
      console.log("deviceName", deviceName);
      const res = await loginApi({ ...credentials, deviceName, deviceId, platform });
      if (res.code === 200 && res.data) {
        const { token: newToken, device } = res.data;
        const normalizedUser = normalizeUserPayload(res.data);
        if (!normalizedUser) {
          throw new Error("Invalid user payload from server");
        }
        const savedAddress = getBaseURL();
        
        setToken(newToken);
        setUser(normalizedUser);
        setServiceConfig({
          token: newToken,
          userId: getUserId(normalizedUser),
          baseUrl: savedAddress,
          clientName: "SoundX Mobile",
        });
        await AsyncStorage.setItem(`token_${savedAddress}`, newToken);
        await AsyncStorage.setItem(`user_${savedAddress}`, JSON.stringify(normalizedUser));
        if (device) {
          setDevice(device);
          await AsyncStorage.setItem(`device_${savedAddress}`, JSON.stringify(device));
        }
      } else {
        throw new Error(res.message || "Login failed");
      }
    } catch (error) {
      throw error;
    }
  };

  const register = async (credentials: Partial<User>) => {
    try {
      const deviceName = Device.modelName || 'Mobile Device';
      const deviceId = await getOrCreateDeviceId();
      const platform = getDevicePlatform();
      const res = await registerApi({ ...credentials, deviceName, deviceId, platform });
      if (res.code === 200 && res.data) {
        const { token: newToken, device } = res.data;
        const normalizedUser = normalizeUserPayload(res.data);
        if (!normalizedUser) {
          throw new Error("Invalid user payload from server");
        }
        const savedAddress = getBaseURL();

        setToken(newToken);
        setUser(normalizedUser);
        setServiceConfig({
          token: newToken,
          userId: getUserId(normalizedUser),
          baseUrl: savedAddress,
          clientName: "SoundX Mobile",
        });
        await AsyncStorage.setItem(`token_${savedAddress}`, newToken);
        await AsyncStorage.setItem(`user_${savedAddress}`, JSON.stringify(normalizedUser));
        if (device) {
          setDevice(device);
          await AsyncStorage.setItem(`device_${savedAddress}`, JSON.stringify(device));
        }
      } else {
        throw new Error(res.message || "Registration failed");
      }
    } catch (error) {
      throw error;
    }
  };

  const logout = async () => {
    try {
      const savedAddress = getBaseURL();
      setToken(null);
      setUser(null);
      setDevice(null);
      await AsyncStorage.removeItem(`token_${savedAddress}`);
      await AsyncStorage.removeItem(`user_${savedAddress}`);
      await AsyncStorage.removeItem(`device_${savedAddress}`);
    } catch (error) {
      console.error("Failed to logout:", error);
    }
  };

  const switchServer = async (url: string, type?: string, skipToken: boolean = false) => {
    try {
      setIsLoading(true);
      const targetType = type || sourceType;
      const mappedType = SOURCEMAP[targetType as keyof typeof SOURCEMAP] || "audiodock";

      // IMPORTANT: Update baseURL first so subsequent calls use the correct endpoint
      setBaseURL(url);
      await AsyncStorage.setItem("serverAddress", url);
      await AsyncStorage.setItem(`serverAddress_${targetType}`, url);
      await AsyncStorage.setItem("selectedSourceType", targetType);
      setSourceTypeDirectly(targetType);
      // 手动切换服务器也要重新判定内网/外网
      await refreshNetworkMode();

      // Configure adapter for the new server
      const credsKey = `creds_${targetType}_${url}`;
      const savedCreds = await AsyncStorage.getItem(credsKey);
      let username = undefined;
      let password = undefined;
      if (savedCreds) {
        const creds = JSON.parse(savedCreds);
        username = creds.username;
        password = creds.password;
      }

      // Ensure baseUrl is passed to ServiceConfig for Subsonic etc.
      setServiceConfig({ username, password, clientName: "SoundX Mobile", baseUrl: url });
      if (mappedType === "subsonic") {
        useSubsonicAdapter();
      } else if (mappedType === "emby") {
        useEmbyAdapter();
      } else {
        useNativeAdapter();
      }

      if (skipToken) {
        setToken(null);
        setUser(null);
        setDevice(null);
        return;
      }

      const savedToken = await AsyncStorage.getItem(`token_${url}`);
      const savedUser = await AsyncStorage.getItem(`user_${url}`);
      const savedDevice = await AsyncStorage.getItem(`device_${url}`);
      const parsedSavedUser = savedUser ? normalizeUserPayload(JSON.parse(savedUser)) : null;

      setToken(savedToken || null);
      setUser(parsedSavedUser);
      setDevice(savedDevice ? JSON.parse(savedDevice) : null);
      setServiceConfig({
        token: savedToken || undefined,
        userId: parsedSavedUser?.id ? String(parsedSavedUser.id) : undefined,
        baseUrl: url,
        clientName: "SoundX Mobile",
      });
      if (savedToken) {
        await refreshCurrentUser(url, savedToken);
      }
    } catch (error) {
      console.error("Failed to switch server:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const setPlusToken = async (pToken: string | null) => {
    setPlusTokenState(pToken);
    if (pToken) {
      setPlusServiceToken(pToken);
      await AsyncStorage.setItem("plus_token", pToken);
    } else {
      removePlusServiceToken();
      await AsyncStorage.removeItem("plus_token");
      await AsyncStorage.removeItem("plus_vip_status");
      await AsyncStorage.removeItem("plus_vip_data");
      await AsyncStorage.removeItem("plus_vip_updated_at");
      await AsyncStorage.removeItem("plus_user_id");
    }
  };

  const updateUser = async (newUser: User) => {
    setUser(newUser);
    const savedAddress = getBaseURL();
    await AsyncStorage.setItem(`user_${savedAddress}`, JSON.stringify(newUser));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        register,
        logout,
        device,
        sourceType,
        setSourceType,
        switchServer,
        plusToken,
        setPlusToken,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
