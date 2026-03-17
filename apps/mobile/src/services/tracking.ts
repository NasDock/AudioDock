import AsyncStorage from "@react-native-async-storage/async-storage";
import { plusTrackEvent, type TrackingEventDto } from "@soundx/services";

let trackingEnabledCache: boolean | null = null;

export const setTrackingEnabled = (enabled: boolean) => {
  trackingEnabledCache = enabled;
};

const resolveTrackingEnabled = async () => {
  if (trackingEnabledCache !== null) return trackingEnabledCache;
  try {
    const saved = await AsyncStorage.getItem("mobile-settings");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed?.experienceProgramEnabled === "boolean") {
        trackingEnabledCache = parsed.experienceProgramEnabled;
        return trackingEnabledCache;
      }
    }
  } catch (error) {
    console.warn("[Tracking] Failed to resolve tracking setting", error);
  }
  trackingEnabledCache = true;
  return trackingEnabledCache;
};

export const trackEvent = async (
  payload: Omit<TrackingEventDto, "platform"> & { platform?: TrackingEventDto["platform"] },
) => {
  try {
    const enabled = await resolveTrackingEnabled();
    if (!enabled) return;
    await plusTrackEvent({
      platform: payload.platform ?? "mobile",
      ...payload,
    });
  } catch (error) {
    console.warn("[Tracking] Failed to report event", error);
  }
};
