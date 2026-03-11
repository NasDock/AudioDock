import { NativeModules } from "react-native";

type WidgetUpdatePayload = {
  title: string;
  artist: string;
  coverPath?: string | null;
  isPlaying: boolean;
};

type WidgetBridgeModule = {
  updateWidget: (payload: WidgetUpdatePayload) => Promise<void>;
};

const NativeWidgetBridge = NativeModules.WidgetBridge as WidgetBridgeModule | undefined;

export const updateWidget = async (payload: WidgetUpdatePayload): Promise<void> => {
  if (!NativeWidgetBridge?.updateWidget) return;

  const safePayload: WidgetUpdatePayload = {
    title: payload.title,
    artist: payload.artist,
    coverPath: payload.coverPath ?? null,
    isPlaying: payload.isPlaying,
  };

  try {
    await NativeWidgetBridge.updateWidget(safePayload);
  } catch (error) {
    if (__DEV__) {
      console.warn("[WidgetBridge] updateWidget failed", error);
    }
  }
};
