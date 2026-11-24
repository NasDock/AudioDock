import { plusCreatePayment, plusGetVipCurrentLowestPrice, plusWechatMpSession, setPlusToken, VipCurrentLowestPriceData, VipCurrentLowestPricePlan, TrackingEvent as TE, TrackingFeature as TF } from '@soundx/services';
import { Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MiniPlayer from '../../../components/MiniPlayer';
import wechatIcon from '../../../assets/images/wechat.png';
import { trackEvent } from '../../../utils/tracking';
import './index.scss';

type PaymentPlan = 'annual' | 'lifetime';

const DEFAULT_PRICES: Record<PaymentPlan, number> = {
  annual: 20,
  lifetime: 60,
};

const comparisonData = [
  { feature: 'memberFeature.basicFeatures', free: true, member: true },
  { feature: 'memberFeature.deviceRelay', free: true, member: true },
  { feature: 'memberFeature.syncControlFeature', free: false, member: true },
  { feature: 'memberFeature.ttsAudiobookFeature', free: false, member: true },
  { feature: 'memberFeature.tvVersionFeature', free: false, member: true },
  { feature: 'memberFeature.carVersionFeature', free: false, member: true },
];

export default function MemberBenefits() {
  const { t } = useTranslation();
  const [selectedPlan, setSelectedPlan] = useState<PaymentPlan>('lifetime');
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState<VipCurrentLowestPriceData | null>(null);
  const benefitsOpenedRef = useRef(false);

  useEffect(() => {
    if (!benefitsOpenedRef.current) {
      benefitsOpenedRef.current = true;
      void trackEvent({ feature: TF.VIP, eventName: TE.VIP_BENEFITS_OPEN });
    }
    let mounted = true;
    const loadPricing = async () => {
      try {
        const res = await plusGetVipCurrentLowestPrice();
        if (!mounted) return;
        if (res.data.code === 200) {
          setPricing(res.data.data ?? null);
        }
      } catch (e) {
        console.warn('Failed to fetch VIP pricing', e);
      }
    };
    void loadPricing();
    return () => {
      mounted = false;
    };
  }, []);

  const formatPrice = (price: number | null | undefined) => {
    if (typeof price !== 'number' || Number.isNaN(price)) return '--';
    return Number.isInteger(price) ? String(price) : price.toFixed(2);
  };

  const hasDiscount = (plan: VipCurrentLowestPricePlan | null | undefined) =>
    !!plan && plan.discountPercent > 0 && plan.originalPrice > plan.currentPrice;

  const getPrice = (plan: PaymentPlan) =>
    pricing?.[plan]?.currentPrice ?? DEFAULT_PRICES[plan];

  const getOriginalPrice = (plan: PaymentPlan) => pricing?.[plan]?.originalPrice;

  const getMiniProgramOpenId = async (): Promise<string | null> => {
    const cached = Taro.getStorageSync('plus_open_id');
    if (cached) return cached;
    try {
      const loginRes = await Taro.login();
      if (!loginRes.code) return null;
      const res = await plusWechatMpSession(loginRes.code);
      const openId = res.data.data?.openId;
      if (res.data.code === 200 && openId) {
        Taro.setStorageSync('plus_open_id', openId);
        return openId;
      }
      return null;
    } catch (e) {
      console.warn('Failed to get mini program openId', e);
      return null;
    }
  };

  const handlePayment = async () => {
    const userIdRaw = Taro.getStorageSync('plus_user_id');
    let userIdStr: string = userIdRaw;
    try {
      userIdStr = JSON.parse(userIdRaw);
    } catch {}
    if (!userIdStr) {
      Taro.showModal({
        title: t('member.tip'),
        content: t('member.loginFirst'),
        confirmText: t('member.goLogin'),
        cancelText: t('member.cancelBtn'),
        success: (res) => {
          if (res.confirm) {
            Taro.navigateTo({ url: '/pages/member/login/index' });
          }
        },
      });
      return;
    }

    void trackEvent({
      feature: TF.VIP,
      eventName: TE.VIP_PAY_SUBMIT,
      metadata: { plan: selectedPlan },
    });

    setLoading(true);
    try {
      const openId = await getMiniProgramOpenId();
      if (!openId) {
        Taro.showToast({ title: t('common.error'), icon: 'none' });
        return;
      }

      const res = await plusCreatePayment({
        userId: userIdStr,
        amount: getPrice(selectedPlan),
        currency: 'CNY',
        method: 'WECHAT',
        clientType: 'miniprogram',
        openId,
        forVip: true,
        vipTier: selectedPlan === 'annual' ? 'BASIC' : 'LIFETIME',
        forPoints: false,
        pointsAmount: 0,
      });

      if (res.data.code === 201 || res.data.code === 200) {
        const { wechatPay, orderId } = res.data.data || {};
        console.log('[member] create payment resp data:', JSON.stringify(res.data.data));

        if (wechatPay) {
          // 小程序 JSAPI 支付：直接调起 wx.requestPayment
          const payParams = {
            timeStamp: wechatPay.timeStamp,
            nonceStr: wechatPay.nonceStr,
            package: wechatPay.package || `prepay_id=${wechatPay.prepayId}`,
            signType: (wechatPay.signType as 'RSA' | 'MD5') || 'RSA',
            paySign: wechatPay.paySign || wechatPay.sign,
          };
          console.log('[member] requestPayment params:', JSON.stringify(payParams));
          try {
            await Taro.requestPayment(payParams);
            const tradeNo = encodeURIComponent(orderId || '');
            Taro.redirectTo({
              url: `/pages/member/success/index?tradeNo=${tradeNo}&paidAt=${Date.now()}`,
            });
          } catch (payErr: any) {
            console.warn('[member] requestPayment fail:', payErr);
            if (payErr?.errMsg?.includes('cancel')) {
              Taro.showToast({ title: t('member.cancelBtn'), icon: 'none' });
            } else {
              Taro.showToast({
                title: payErr?.errMsg || t('common.error'),
                icon: 'none',
              });
            }
          }
        } else {
          Taro.showToast({ title: t('common.error'), icon: 'none' });
        }
      } else {
        Taro.showToast({ title: res.data.message || t('common.error'), icon: 'none' });
      }
    } catch (e: any) {
      Taro.showToast({ title: e.response?.data?.message || t('member.networkError'), icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    Taro.showModal({
      title: t('member.logoutSwitchAccount'),
      content: t('member.logoutConfirm'),
      confirmText: t('member.confirmBtn'),
      cancelText: t('member.cancelBtn'),
      success: async (res) => {
        if (res.confirm) {
          Taro.removeStorageSync('plus_user_id');
          Taro.removeStorageSync('plus_token');
          Taro.redirectTo({ url: '/pages/member/login/index' });
        }
      },
    });
  };

  const renderPlanCard = (plan: PaymentPlan) => {
    const planPricing = pricing?.[plan];
    const discounted = hasDiscount(planPricing);
    return (
      <View
        className={`plan-card ${selectedPlan === plan ? 'active' : ''}`}
        onClick={() => setSelectedPlan(plan)}
      >
        {selectedPlan === plan && plan === 'lifetime' && (
          <View className='recommend-badge'>
            <Text className='recommend-text'>{t('member.recommend')}</Text>
          </View>
        )}
        <Text className='plan-name'>
          {plan === 'annual' ? t('member.annual') : t('member.permanent')}
        </Text>
        <View className='price-container'>
          <Text className='currency'>¥</Text>
          <Text className='price-amount'>{formatPrice(getPrice(plan))}</Text>
          <Text className='unit'>
            /{plan === 'annual' ? t('member.annualMember') : t('member.permanentValid')}
          </Text>
        </View>
        {discounted && (
          <View className='original-price-container'>
            <Text className='original-price-text'>
              ¥{formatPrice(getOriginalPrice(plan))}
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View className='member-benefits-container'>
      <View className='header'>
        <View className='back-btn' onClick={() => Taro.navigateBack()}>
          <Text className='back-icon'>←</Text>
        </View>
        <Text className='header-title'>{t('member.benefitsTitle')}</Text>
        <View style={{ width: '80rpx' }} />
      </View>

      <View className='scroll-content'>
        {/* Comparison Table */}
        <View className='table-card'>
          <View className='table-header'>
            <Text className='table-header-text flex-2'>{t('member.rightsDescription')}</Text>
            <Text className='table-header-text flex-1 center'>{t('scanConfirm.nonMember')}</Text>
            <Text className='table-header-text flex-1 center'>{t('scanConfirm.memberLabel')}</Text>
          </View>
          {comparisonData.map((item, index) => (
            <View
              key={item.feature}
              className={`table-row ${index > 0 ? 'border-top' : ''}`}
            >
              <Text className='feature-text flex-2'>{t(item.feature)}</Text>
              <View className='flex-1 center'>
                <Text className={`check-icon ${item.free ? 'active' : 'inactive'}`}>
                  {item.free ? '✓' : '✗'}
                </Text>
              </View>
              <View className='flex-1 center'>
                <Text className='check-icon gold'>✓</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Pricing Plans */}
        <View className='divider-container'>
          <Text className='divider-text'>{t('member.memberPlan')}</Text>
        </View>

        <View className='plans-container'>
          {renderPlanCard('annual')}
          {renderPlanCard('lifetime')}
        </View>

        {/* Payment Methods */}
        <View className='divider-container'>
          <Text className='divider-text'>{t('member.paymentMethod')}</Text>
        </View>

        <View className='payment-methods'>
          <View
            className={`payment-item ${loading ? 'disabled' : ''}`}
            onClick={handlePayment}
          >
            <Image className='payment-icon-img' src={wechatIcon} />
            <Text className='payment-text'>{t('member.wechatPay')}</Text>
          </View>
        </View>

        <View className='logout-button' onClick={handleLogout}>
          <Text className='logout-icon'>🚪</Text>
          <Text className='logout-text'>{t('member.logoutSwitchAccount')}</Text>
        </View>
      </View>

      <MiniPlayer />
    </View>
  );
}
