import { plusTrackEvent, type TrackingEventDto } from "@soundx/services";
import { useSettingsStore } from "../store/settings";

let memberUserIdCache: string | null | undefined = undefined;

const resolveMemberUserId = () => {
  if (memberUserIdCache !== undefined) return memberUserIdCache;
  try {
    const raw = localStorage.getItem("plus_user_id");
    if (!raw) {
      memberUserIdCache = null;
      return memberUserIdCache;
    }
    let parsed: any = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // stored as raw string
    }
    const normalized = String(parsed).trim();
    memberUserIdCache = normalized ? normalized : null;
  } catch (error) {
    console.warn("[Tracking] Failed to resolve member user id", error);
    memberUserIdCache = null;
  }
  return memberUserIdCache;
};

export const trackEvent = async (
  payload: Omit<TrackingEventDto, "platform"> & { platform?: TrackingEventDto["platform"] },
) => {
  try {
    const enabled = useSettingsStore.getState().general.experienceProgramEnabled;
    if (enabled === false) return;
    const memberUserId = resolveMemberUserId();
    await plusTrackEvent({
      platform: payload.platform ?? "desktop",
      ...payload,
      userId: memberUserId ?? null,
    });
  } catch (error) {
    console.warn("[Tracking] Failed to report event", error);
  }
};
