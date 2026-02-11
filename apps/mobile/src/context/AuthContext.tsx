import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  login as loginApi,
  register as registerApi,
  setServiceConfig,
  SOURCEMAP,
  useNativeAdapter,
  useSubsonicAdapter,
} from "@soundx/services";
import * as Device from 'expo-device';
import React, { createContext, useContext, useEffect, useState } from "react";
import { getBaseURL, initBaseURL, setBaseURL } from "../https";
import { User } from "../models";

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

  useEffect(() => {
    loadAuthData();
  }, []);

  const loadAuthData = async () => {
    try {
      await initBaseURL(); // Initialize base URL first
      const savedAddress = getBaseURL();
      const savedType = (await AsyncStorage.getItem("selectedSourceType")) || "AudioDock";
      setSourceTypeDirectly(savedType);

      const savedToken = await AsyncStorage.getItem(`token_${savedAddress}`);
      const savedUser = await AsyncStorage.getItem(`user_${savedAddress}`);

      if (savedToken) {
        setToken(savedToken);
      }
      if (savedUser) {
        setUser(JSON.parse(savedUser));
      }
      const savedDevice = await AsyncStorage.getItem(`device_${savedAddress}`);
      if (savedDevice) {
        setDevice(JSON.parse(savedDevice));
      }
      const savedPlusToken = await AsyncStorage.getItem("plus_token");
      if (savedPlusToken) {
        setPlusTokenState(savedPlusToken);
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
      setServiceConfig({ username, password, clientName: "SoundX Mobile", baseUrl: savedAddress });

      if (mappedType === "subsonic") {
        useSubsonicAdapter();
      } else {
        useNativeAdapter();
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
      console.log("credentials", credentials);
      console.log("deviceName", deviceName);
      const res = await loginApi({ ...credentials, deviceName });
      if (res.code === 200 && res.data) {
        const { token: newToken, device, ...userData } = res.data;
        const savedAddress = getBaseURL();
        
        setToken(newToken);
        setUser(userData);
        await AsyncStorage.setItem(`token_${savedAddress}`, newToken);
        await AsyncStorage.setItem(`user_${savedAddress}`, JSON.stringify(userData));
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
      const res = await registerApi({ ...credentials, deviceName });
      if (res.code === 200 && res.data) {
        const { token: newToken, device, ...userData } = res.data;
        const savedAddress = getBaseURL();

        setToken(newToken);
        setUser(userData);
        await AsyncStorage.setItem(`token_${savedAddress}`, newToken);
        await AsyncStorage.setItem(`user_${savedAddress}`, JSON.stringify(userData));
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
      await AsyncStorage.removeItem("plus_token");
      await AsyncStorage.removeItem("plus_user_id");
      setPlusTokenState(null);
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

      setToken(savedToken || null);
      setUser(savedUser ? JSON.parse(savedUser) : null);
      setDevice(savedDevice ? JSON.parse(savedDevice) : null);
    } catch (error) {
      console.error("Failed to switch server:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const setPlusToken = async (pToken: string | null) => {
    setPlusTokenState(pToken);
    if (pToken) {
      await AsyncStorage.setItem("plus_token", pToken);
    } else {
      await AsyncStorage.removeItem("plus_token");
    }
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
