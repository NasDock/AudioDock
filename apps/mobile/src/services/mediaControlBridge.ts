import { EventEmitter, requireNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

type BridgeAction =
  | "play"
  | "pause"
  | "toggle"
  | "next"
  | "previous"
  | "seek"
  | "jumpForward"
  | "jumpBackward";

export interface MediaControlBridgeEvent {
  action: BridgeAction;
  position?: number;
  interval?: number;
}

// 使用 requireNativeModule 获取 Expo 模块
const moduleRef = Platform.OS === "android" ? requireNativeModule("MediaControlBridge") : null;
const emitter = moduleRef ? new EventEmitter(moduleRef) : null;

export const isMediaControlBridgeAvailable = (): boolean => {
  return Platform.OS === "android" && !!moduleRef;
};

export const startMediaControlBridge = async (): Promise<void> => {
  if (!isMediaControlBridgeAvailable()) return;
  try {
    await moduleRef.startListening();
  } catch (e) {
    console.warn("[MediaControlBridge] startListening failed:", e);
  }
};

export const stopMediaControlBridge = async (): Promise<void> => {
  if (!isMediaControlBridgeAvailable()) return;
  try {
    await moduleRef.stopListening();
  } catch (e) {
    console.warn("[MediaControlBridge] stopListening failed:", e);
  }
};

export const subscribeMediaControlBridgeEvents = (
  callback: (event: MediaControlBridgeEvent) => void
) => {
  if (!emitter) return { remove: () => {} };
  return emitter.addListener("MediaControlBridgeEvent", callback);
};
