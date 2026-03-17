import {
  setServiceConfig,
  SOURCEMAP,
  useEmbyAdapter,
  useNativeAdapter,
  useSubsonicAdapter,
} from "@soundx/services";
import { create } from "zustand";
import type { User } from "../models";

const resolveStoredUser = (raw: string | null): User | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.id) return parsed as User;
    if (parsed?.user?.id) return parsed.user as User;
  } catch (e) {}
  return null;
};

const resolveStoredUserId = (raw: string | null): string | undefined => {
  const user = resolveStoredUser(raw);
  if (!user?.id) return undefined;
  const value = String(user.id).trim();
  return value && value !== "undefined" ? value : undefined;
};

// Helper to configure service adapter
const initService = (address: string, type: string) => {
  const credsKey = `creds_${type}_${address}`;
  const savedCreds = localStorage.getItem(credsKey);
  let username, password;
  if (savedCreds) {
    try {
      const c = JSON.parse(savedCreds);
      username = c.username;
      password = c.password;
    } catch (e) {}
  }

  const token = localStorage.getItem(`token_${address}`);
  const userStr = localStorage.getItem(`user_${address}`);
  const userId = resolveStoredUserId(userStr);

  setServiceConfig({
    username,
    password,
    token: token || undefined,
    userId,
    clientName: "SoundX Desktop",
    baseUrl: address,
  });

  const mappedType =
    SOURCEMAP[type as keyof typeof SOURCEMAP] || "audiodock";
  if (mappedType === "subsonic") useSubsonicAdapter();
  else if (mappedType === "emby") useEmbyAdapter();
  else useNativeAdapter();
};

// Initialize on load
const currentUrl =
  localStorage.getItem("serverAddress") || "http://localhost:3000";
const currentType = localStorage.getItem("selectedSourceType") || "AudioDock";
initService(currentUrl, currentType);

const initToken = localStorage.getItem(`token_${currentUrl}`);
const initUser = localStorage.getItem(`user_${currentUrl}`);
const initDevice = localStorage.getItem(`device_${currentUrl}`);
const initPlusToken = localStorage.getItem("plus_token");

interface AuthState {
  token: string | null;
  user: User | null;
  device: any | null;
  login: (token: string, user: User, device?: any) => void;
  logout: () => void;
  switchServer: (url: string) => void;
  plusToken: string | null;
  setPlusToken: (token: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: initToken || null,
  user: resolveStoredUser(initUser),
  device: initDevice ? JSON.parse(initDevice) : null,
  plusToken: initPlusToken || null,
  login: (token, user, device) => set({ token, user, device }),
  logout: () => {
    const url =
      localStorage.getItem("serverAddress") || "http://localhost:3000";
    localStorage.removeItem(`token_${url}`);
    localStorage.removeItem(`user_${url}`);
    localStorage.removeItem(`device_${url}`);
    set({ token: null, user: null, device: null });
  },
  switchServer: (url: string) => {
    localStorage.setItem("serverAddress", url);
    const type = localStorage.getItem("selectedSourceType") || "AudioDock";
    initService(url, type);

    const token = localStorage.getItem(`token_${url}`);
    const user = localStorage.getItem(`user_${url}`);
    const device = localStorage.getItem(`device_${url}`);

    set({
      token: token || null,
      user: resolveStoredUser(user),
      device: device ? JSON.parse(device) : null,
    });
  },
  setPlusToken: (token: string | null) => {
    if (token) {
      localStorage.setItem("plus_token", token);
    } else {
      localStorage.removeItem("plus_token");
      localStorage.removeItem("plus_user_id");
    }
    set({ plusToken: token });
  },
}));
