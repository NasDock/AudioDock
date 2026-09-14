import Taro from '@tarojs/taro';
import { useState } from 'react';
import { plusGetVipCurrentLowestPrice, type VipCurrentLowestPriceData } from '@soundx/services';

/** Taro Storage key：用户主动忽略的活动 ID（同一活动不再弹窗） */
const IGNORED_PROMOTION_KEY = 'ignored_promotion_activity_id';

/**
 * 优惠活动检查 Hook
 *
 * 启动时（AuthGuard 内 token 就绪后）静默调用一次：
 *   const { promotion, checkPromotion, dismissPromotion, ignorePromotion } =
 *     useCheckPromotion();
 *   useEffect(() => { if (!isLoading && token) checkPromotion(); }, [token, isLoading]);
 *
 * 弹窗：
 *   <PromotionModal
 *     visible={!!promotion}
 *     promotion={promotion}
 *     onClose={dismissPromotion}   // 下次再说（不忽略）
 *     onIgnore={ignorePromotion}   // 勾选忽略后的关闭（写入 Taro Storage）
 *   />
 */
export const useCheckPromotion = () => {
  const [promotion, setPromotion] = useState<VipCurrentLowestPriceData | null>(null);
  const [checking, setChecking] = useState(false);

  /**
   * 执行一次优惠活动检查
   * @returns 检测到的活动数据，若无活动/已忽略/接口异常则返回 null
   */
  const checkPromotion = async (): Promise<VipCurrentLowestPriceData | null> => {
    setChecking(true);
    try {
      const res = await plusGetVipCurrentLowestPrice();
      const body = res?.data;
      if (!body || body.code !== 200) return null;

      const pricing = body.data;
      // 无活动（activityId 为 null）→ 不弹
      if (!pricing?.activityId) return null;

      // 已被用户忽略 → 不弹
      const ignored = Taro.getStorageSync(IGNORED_PROMOTION_KEY);
      if (pricing.activityId === ignored) {
        console.log(`[useCheckPromotion] activity ${pricing.activityId} is ignored`);
        return null;
      }

      setPromotion(pricing);
      return pricing;
    } catch (e) {
      console.warn('[useCheckPromotion] checkPromotion error:', e);
      return null;
    } finally {
      setChecking(false);
    }
  };

  /** 忽略当前活动（勾选「忽略此活动」后关闭时调用，写入 Taro Storage） */
  const ignorePromotion = () => {
    if (promotion?.activityId) {
      Taro.setStorageSync(IGNORED_PROMOTION_KEY, promotion.activityId);
    }
    setPromotion(null);
  };

  /** 关闭弹窗（「下次再说」，不忽略，下次启动仍会再询问） */
  const dismissPromotion = () => {
    setPromotion(null);
  };

  return {
    checking,
    promotion,
    checkPromotion,
    ignorePromotion,
    dismissPromotion,
  };
};
