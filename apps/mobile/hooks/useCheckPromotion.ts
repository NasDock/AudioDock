import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useState } from 'react';
import { plusGetVipCurrentLowestPrice, type VipCurrentLowestPriceData } from '@soundx/services';

/** AsyncStorage key：用户主动忽略的活动 ID（同一活动不再弹窗） */
const IGNORED_PROMOTION_KEY = 'ignored_promotion_activity_id';

/** Hook 内部状态 */
interface UseCheckPromotionState {
  /** 是否正在检查中 */
  checking: boolean;
  /** 检测到的当前活动（null = 无活动 / 已忽略 / 接口异常） */
  promotion: VipCurrentLowestPriceData | null;
}

/**
 * 优惠活动检查 Hook
 *
 * 启动时静默调用一次：
 *   const { promotion, checkPromotion, dismissPromotion, ignorePromotion } =
 *     useCheckPromotion();
 *   useEffect(() => { void checkPromotion(); }, []);
 *
 * 弹窗：
 *   <PromotionDialog
 *     visible={!!promotion}
 *     promotion={promotion}
 *     onClose={dismissPromotion}   // 下次再说（不忽略）
 *     onIgnore={ignorePromotion}   // 勾选忽略后的关闭（写入存储）
 *   />
 */
export const useCheckPromotion = () => {
  const [state, setState] = useState<UseCheckPromotionState>({
    checking: false,
    promotion: null,
  });

  /**
   * 执行一次优惠活动检查
   *
   * @returns 检测到的活动数据，若无活动/已忽略/接口异常则返回 null
   */
  const checkPromotion = useCallback(async (): Promise<VipCurrentLowestPriceData | null> => {
    setState((s) => ({ ...s, checking: true }));
    try {
      const res = await plusGetVipCurrentLowestPrice();
      const body = res?.data;
      if (!body || body.code !== 200) return null;

      const pricing = body.data;
      // 无活动（activityId 为 null）→ 不弹
      if (!pricing?.activityId) return null;

      // 已被用户忽略 → 不弹
      const ignored = await AsyncStorage.getItem(IGNORED_PROMOTION_KEY);
      if (pricing.activityId === ignored) {
        console.log(`[useCheckPromotion] activity ${pricing.activityId} is ignored`);
        return null;
      }

      setState((s) => ({ ...s, promotion: pricing }));
      return pricing;
    } catch (e) {
      console.warn('[useCheckPromotion] checkPromotion error:', e);
      return null;
    } finally {
      setState((s) => ({ ...s, checking: false }));
    }
  }, []);

  /**
   * 忽略当前活动（勾选「忽略此活动」后关闭时调用，写入 AsyncStorage）
   */
  const ignorePromotion = useCallback(async () => {
    if (state.promotion?.activityId) {
      await AsyncStorage.setItem(IGNORED_PROMOTION_KEY, state.promotion.activityId);
    }
    setState((s) => ({ ...s, promotion: null }));
  }, [state.promotion]);

  /**
   * 关闭弹窗（「下次再说」，不忽略，下次启动仍会再询问）
   */
  const dismissPromotion = useCallback(() => {
    setState((s) => ({ ...s, promotion: null }));
  }, []);

  return {
    checking: state.checking,
    promotion: state.promotion,
    checkPromotion,
    ignorePromotion,
    dismissPromotion,
  };
};
