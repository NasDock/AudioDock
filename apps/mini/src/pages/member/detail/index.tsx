import { plusGetMe, TrackingEvent as TE, TrackingFeature as TF } from '@soundx/services';
import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MiniPlayer from '../../../components/MiniPlayer';
import { trackEvent } from '../../../utils/tracking';
import './index.scss';

interface VipData {
  vipTier: string;
  vipExpiresAt?: string;
}

const comparisonData = [
  { feature: 'memberFeature.basicFeatures', free: true, member: true },
  { feature: 'memberFeature.deviceRelay', free: true, member: true },
  { feature: 'memberFeature.syncControlFeature', free: false, member: true },
  { feature: 'memberFeature.ttsAudiobookFeature', free: false, member: true },
  { feature: 'memberFeature.tvVersionFeature', free: false, member: true },
  { feature: 'memberFeature.carVersionFeature', free: false, member: true },
];

export default function MemberDetail() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [vipData, setVipData] = useState<VipData | null>(null);
  const vipPageOpenedRef = useRef(false);

  useEffect(() => {
    if (!vipPageOpenedRef.current) {
      vipPageOpenedRef.current = true;
      void trackEvent({ feature: TF.VIP, eventName: TE.VIP_PAGE_OPEN });
    }
    fetchVipStatus();
  }, []);

  const fetchVipStatus = async () => {
    try {
      const plusUserId = Taro.getStorageSync('plus_user_id');
      if (plusUserId) {
        let id = plusUserId;
        try {
          id = JSON.parse(plusUserId);
        } catch (e) {}

        const res = await plusGetMe(id);
        if (res.data.code === 200 && res.data.data) {
          setVipData(res.data.data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch plus profile', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    Taro.showModal({
      title: t('member.logoutSwitch'),
      content: t('member.logoutSwitchConfirm'),
      confirmText: t('member.confirmBtn'),
      cancelText: t('member.cancelBtn'),
      success: async (res) => {
        if (res.confirm) {
          Taro.removeStorageSync('plus_token');
          Taro.removeStorageSync('plus_user_id');
          Taro.redirectTo({ url: '/pages/member/login/index' });
        }
      },
    });
  };

  const isVip = vipData?.vipTier && vipData?.vipTier !== 'NONE';
  const tierName = vipData?.vipTier === 'LIFETIME' ? t('member.permanentMember') : t('member.annualMember');
  const expiryDate =
    vipData?.vipTier === 'LIFETIME'
      ? t('member.permanentValid')
      : vipData?.vipExpiresAt
        ? new Date(vipData.vipExpiresAt).toLocaleDateString()
        : t('member.unknown');

  return (
    <View className='member-detail-container'>
      {loading ? (
        <View className='loading-container'>
          <Text className='loading-text'>{t('common.loading')}</Text>
        </View>
      ) : (
        <View className='content'>
          <View className='card'>
            <View className='vip-info'>
              <Text className='vip-icon'>{isVip ? '👑' : '💤'}</Text>
              <Text className='vip-status'>
                {isVip ? `${t('member.vipStatusLabel')}：${t('member.activated')}` : `${t('member.vipStatusLabel')}：${t('member.notActivated')}`}
              </Text>
            </View>

            {isVip && (
              <View className='details'>
                <View className='detail-row'>
                  <Text className='detail-label'>{t('member.memberLevel')}</Text>
                  <Text className='detail-value'>{tierName}</Text>
                </View>
                <View className='detail-row'>
                  <Text className='detail-label'>{t('member.expiryTime')}</Text>
                  <Text className='detail-value'>{expiryDate}</Text>
                </View>
              </View>
            )}

            {!isVip && (
              <View
                className='action-button'
                onClick={() => Taro.navigateTo({ url: '/pages/member/benefits/index' })}
              >
                <Text className='action-button-text'>{t('member.understandBenefits')}</Text>
              </View>
            )}
          </View>

          <View className='benefits-card'>
            <View className='benefits-header'>
              <Text className='benefits-header-text flex-2'>{t('member.rightsDescription')}</Text>
              <Text className='benefits-header-text flex-1'>{t('scanConfirm.nonMember')}</Text>
              <Text className='benefits-header-text flex-1'>{t('scanConfirm.memberLabel')}</Text>
            </View>
            {comparisonData.map((item, index) => (
              <View
                key={item.feature}
                className={`benefits-row ${index > 0 ? 'border-top' : ''}`}
              >
                <Text className='benefits-feature flex-2'>{t(item.feature)}</Text>
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

          <View className='logout-button' onClick={handleLogout}>
            <Text className='logout-icon'>🚪</Text>
            <Text className='logout-text'>{t('member.logoutSwitchAccount')}</Text>
          </View>
        </View>
      )}

      <MiniPlayer />
    </View>
  );
}
