import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
import { open } from "@tauri-apps/plugin-shell";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const isTauri = () => {
  return typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined;
};

export const getPlatform = () => {
  if (typeof window !== "undefined" && isTauri()) {
    try {
      return platform();
    } catch (e) {
      return "web";
    }
  }
  return "web";
};

export const isMac = () => {
  return getPlatform() === "macos";
};

export const isWindows = () => {
  return getPlatform() === "windows";
};

export const isLinux = () => {
  return getPlatform() === "linux";
};

export const isWeb = () => {
  return !isTauri();
};

// Tauri IPC helpers
export const tauriInvoke = async (cmd: string, ...args: any[]): Promise<any> => {
  if (!isTauri()) return null;
  try {
    return await invoke(cmd, args.length > 0 ? args[0] : undefined);
  } catch (e) {
    console.error(`Tauri invoke error (${cmd}):`, e);
    return null;
  }
};

export const tauriListen = async (event: string, handler: (payload: any) => void): Promise<() => void> => {
  if (!isTauri()) return () => {};
  try {
    const unlisten = await listen(event, (event) => {
      handler(event.payload);
    });
    return unlisten;
  } catch (e) {
    console.error(`Tauri listen error (${event}):`, e);
    return () => {};
  }
};

export const tauriOpenExternal = async (url: string): Promise<void> => {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    await open(url);
  } catch (e) {
    console.error("Tauri openExternal error:", e);
    window.open(url, "_blank", "noopener,noreferrer");
  }
};

export const tauriSelectDirectory = async (): Promise<string | null> => {
  if (!isTauri()) return null;
  try {
    const result = await openDialog({ directory: true });
    return result as string | null;
  } catch (e) {
    console.error("Tauri selectDirectory error:", e);
    return null;
  }
};

export const tauriMinimizeWindow = async (): Promise<void> => {
  if (!isTauri()) return;
  try {
    const window = getCurrentWindow();
    await window.minimize();
  } catch (e) {
    console.error("Tauri minimizeWindow error:", e);
  }
};

export const tauriMaximizeWindow = async (): Promise<void> => {
  if (!isTauri()) return;
  try {
    const window = getCurrentWindow();
    if (await window.isMaximized()) {
      await window.unmaximize();
    } else {
      await window.maximize();
    }
  } catch (e) {
    console.error("Tauri maximizeWindow error:", e);
  }
};

export const tauriCloseWindow = async (): Promise<void> => {
  if (!isTauri()) return;
  try {
    const window = getCurrentWindow();
    await window.close();
  } catch (e) {
    console.error("Tauri closeWindow error:", e);
  }
};

export const tauriGetDeviceName = async (): Promise<string> => {
  if (!isTauri()) return resolveWebDeviceName();
  try {
    return await invoke("get_device_name") as string;
  } catch (e) {
    console.error("Tauri getDeviceName error:", e);
    return resolveWebDeviceName();
  }
};

/**
 * 纯 web 环境下把 navigator.userAgent 解析成友好设备名。
 * 直接存整段 UA 会让其他端的在线设备列表显示一串不可读字符串（甚至兜底成 unknown device）。
 */
export const resolveWebDeviceName = (): string => {
  try {
    const ua = window.navigator.userAgent;
    // 浏览器
    let browser = "Browser";
    const edgeMatch = ua.match(/Edg(?:e|A|iOS)?\/([\d.]+)/);
    const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
    const firefoxMatch = ua.match(/Firefox\/([\d.]+)/);
    const safariMatch = ua.match(/Version\/([\d.]+).*Safari/);
    if (edgeMatch) browser = `Edge ${edgeMatch[1].split(".")[0]}`;
    else if (chromeMatch) browser = `Chrome ${chromeMatch[1].split(".")[0]}`;
    else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1].split(".")[0]}`;
    else if (safariMatch) browser = `Safari ${safariMatch[1].split(".")[0]}`;
    // 操作系统
    let os = "Web";
    if (/Windows NT 10/.test(ua)) os = "Windows";
    else if (/Windows NT/.test(ua)) os = "Windows";
    else if (/Mac OS X/.test(ua)) os = "macOS";
    else if (/Android/.test(ua)) os = "Android";
    else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
    else if (/Linux/.test(ua)) os = "Linux";
    else if (/HarmonyOS/.test(ua)) os = "HarmonyOS";
    return `${browser} on ${os}`;
  } catch (e) {
    return "Web Browser";
  }
};

/**
 * 设备平台标识（用于在线设备列表 / 播放流转）。
 * desktop=Tauri 桌面端，web=浏览器端
 */
export const getDevicePlatform = (): "desktop" | "web" => {
  return isTauri() ? "desktop" : "web";
};

const DEVICE_ID_KEY = "audiodock_device_id";

/**
 * 获取稳定唯一设备标识。首次调用生成 UUID 并持久化到 localStorage。
 */
export const getOrCreateDeviceId = (): string => {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = `desktop_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch (e) {
    // localStorage 不可用（隐私模式等）时退化为内存态
    return `desktop_ephemeral_${Math.random().toString(36).slice(2, 12)}`;
  }
};
