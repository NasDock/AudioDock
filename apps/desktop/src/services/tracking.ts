import { plusTrackEvent, type TrackingEventDto } from "@soundx/services";

export const trackEvent = async (
  payload: Omit<TrackingEventDto, "platform"> & { platform?: TrackingEventDto["platform"] },
) => {
  try {
    await plusTrackEvent({
      platform: payload.platform ?? "desktop",
      ...payload,
    });
  } catch (error) {
    console.warn("[Tracking] Failed to report event", error);
  }
};
