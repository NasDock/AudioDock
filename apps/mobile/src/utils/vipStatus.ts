import AsyncStorage from "@react-native-async-storage/async-storage";
import { plusGetMe } from "@soundx/services";
import { syncWidgetMembership } from "../native/WidgetBridge";

export type VipStatusSnapshot = {
  isVip: boolean;
  vipData: any | null;
  updatedAt: number | null;
};

type RefreshVipStatusOptions = {
  setPlusToken?: (token: string) => Promise<unknown> | unknown;
  syncWidget?: boolean;
};

const VIP_STATUS_KEY = "plus_vip_status";
const VIP_DATA_KEY = "plus_vip_data";
const VIP_UPDATED_AT_KEY = "plus_vip_updated_at";

export const getCachedVipStatus = async (): Promise<VipStatusSnapshot> => {
  const status = await AsyncStorage.getItem(VIP_STATUS_KEY);
  const data = await AsyncStorage.getItem(VIP_DATA_KEY);
  const updatedAt = await AsyncStorage.getItem(VIP_UPDATED_AT_KEY);

  let vipData: any | null = null;
  let isVip = status === "true";

  if (data) {
    try {
      vipData = JSON.parse(data);
      isVip = !!(vipData?.vipTier && vipData.vipTier !== "NONE");
    } catch {
      vipData = null;
    }
  }

  return {
    isVip,
    vipData,
    updatedAt: updatedAt ? Number(updatedAt) || null : null,
  };
};

export const persistVipStatus = async (
  vipData: any | null,
  isVip?: boolean,
): Promise<VipStatusSnapshot> => {
  const resolvedIsVip = isVip ?? !!(vipData?.vipTier && vipData?.vipTier !== "NONE");

  await AsyncStorage.setItem(VIP_STATUS_KEY, resolvedIsVip ? "true" : "false");

  if (vipData) {
    await AsyncStorage.setItem(VIP_DATA_KEY, JSON.stringify(vipData));
  } else {
    await AsyncStorage.removeItem(VIP_DATA_KEY);
  }

  const now = Date.now();
  await AsyncStorage.setItem(VIP_UPDATED_AT_KEY, String(now));

  return {
    isVip: resolvedIsVip,
    vipData,
    updatedAt: now,
  };
};

export const refreshVipStatus = async (
  options: RefreshVipStatusOptions = {},
): Promise<VipStatusSnapshot> => {
  const plusToken = await AsyncStorage.getItem("plus_token");
  const plusUserId = await AsyncStorage.getItem("plus_user_id");

  if (!plusToken || !plusUserId) {
    const cleared = await persistVipStatus(null, false);
    if (options.syncWidget) {
      await syncWidgetMembership(false);
    }
    return cleared;
  }

  if (options.setPlusToken) {
    await options.setPlusToken(plusToken);
  }

  let id: any = plusUserId;
  try {
    id = JSON.parse(plusUserId);
  } catch {
    // Keep original string when it is not JSON encoded.
  }

  const res = await plusGetMe(id);
  const nextVipData = res?.data?.data || null;
  const nextStatus = await persistVipStatus(nextVipData);

  if (options.syncWidget) {
    await syncWidgetMembership(nextStatus.isVip);
  }

  return nextStatus;
};
