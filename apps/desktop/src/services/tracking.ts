import { plusTrackEvent, type TrackingEventDto } from "@soundx/services";
import { useSettingsStore } from "../store/settings";

export const trackEvent = async (
  payload: Omit<TrackingEventDto, "platform"> & { platform?: TrackingEventDto["platform"] },
) => {
  try {
    const enabled = useSettingsStore.getState().general.experienceProgramEnabled;
    if (enabled === false) return;
    await plusTrackEvent({
      platform: payload.platform ?? "desktop",
      ...payload,
    });
  } catch (error) {
    console.warn("[Tracking] Failed to report event", error);
  }
};
