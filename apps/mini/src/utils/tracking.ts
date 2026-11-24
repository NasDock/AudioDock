import Taro from "@tarojs/taro";
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
    const saved = Taro.getStorageSync("mini-settings");
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
    const saved = Taro.getStorageSync("plus_user_id");
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
      platform: payload.platform ?? "mini",
      ...payload,
      // 调用方显式传入的 userId 优先（如登录成功事件带的是刚拿到的 id），
      // 否则回退本地缓存的 plus_user_id。旧实现无条件覆盖，导致调用方传值全部丢失。
      userId: payload.userId ?? memberUserId ?? null,
    });
  } catch (error) {
    console.warn("[Tracking] Failed to report event", error);
  }
};
