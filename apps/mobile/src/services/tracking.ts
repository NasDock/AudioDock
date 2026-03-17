import AsyncStorage from "@react-native-async-storage/async-storage";
import { plusTrackEvent, type TrackingEventDto } from "@soundx/services";

let trackingEnabledCache: boolean | null = null;
let memberUserIdCache: string | null | undefined = undefined;

export const setTrackingEnabled = (enabled: boolean) => {
  trackingEnabledCache = enabled;
};

export const setMemberUserId = (userId: string | null) => {
  memberUserIdCache = userId;
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

const resolveMemberUserId = async () => {
  if (memberUserIdCache !== undefined) return memberUserIdCache;
  try {
    const saved = await AsyncStorage.getItem("plus_user_id");
    if (!saved) {
      memberUserIdCache = null;
      return memberUserIdCache;
    }
    let parsed: any = saved;
    try {
      parsed = JSON.parse(saved);
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
    const enabled = await resolveTrackingEnabled();
    if (!enabled) return;
    const memberUserId = await resolveMemberUserId();
    await plusTrackEvent({
      platform: payload.platform ?? "mobile",
      ...payload,
      userId: memberUserId ?? null,
    });
  } catch (error) {
    console.warn("[Tracking] Failed to report event", error);
  }
};
