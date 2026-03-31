import { plusGetMe } from '@soundx/services';
import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import MiniPlayer from '../../../components/MiniPlayer';
import './index.scss';

interface VipData {
  vipTier: string;
  vipExpiresAt?: string;
}

const comparisonData = [
  { feature: '基础功能', free: true, member: true },
  { feature: '设备接力', free: true, member: true },
  { feature: '同步控制', free: false, member: true },
  { feature: 'TTS生成有声书', free: false, member: true },
  { feature: 'TV版', free: false, member: true },
  { feature: '车机版', free: false, member: true },
];

export default function MemberDetail() {
  const [loading, setLoading] = useState(true);
  const [vipData, setVipData] = useState<VipData | null>(null);

  useEffect(() => {
    fetchVipStatus();
  }, []);

  const fetchVipStatus = async () => {
    try {
      const plusUserId = wx.getStorageSync('plus_user_id');
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
      title: '退出/切换会员账号',
      content: '确定要退出/切换会员账号吗？',
      confirmText: '确定',
      cancelText: '取消',
      success: async (res) => {
        if (res.confirm) {
          wx.removeStorageSync('plus_token');
          wx.removeStorageSync('plus_user_id');
          Taro.redirectTo({ url: '/pages/member/login/index' });
        }
      },
    });
  };

  const isVip = vipData?.vipTier && vipData?.vipTier !== 'NONE';
  const tierName = vipData?.vipTier === 'LIFETIME' ? '永久会员' : '年度会员';
  const expiryDate =
    vipData?.vipTier === 'LIFETIME'
      ? '永久有效'
      : vipData?.vipExpiresAt
        ? new Date(vipData.vipExpiresAt).toLocaleDateString()
        : '未知';

  return (
    <View className='member-detail-container'>
      <View className='header'>
        <View className='back-btn' onClick={() => Taro.navigateBack()}>
          <Text className='back-icon'>←</Text>
        </View>
        <Text className='header-title'>会员详情</Text>
        <View style={{ width: '80rpx' }} />
      </View>

      {loading ? (
        <View className='loading-container'>
          <Text className='loading-text'>加载中...</Text>
        </View>
      ) : (
        <View className='content'>
          <View className='card'>
            <View className='vip-info'>
              <Text className='vip-icon'>{isVip ? '👑' : '💤'}</Text>
              <Text className='vip-status'>
                {isVip ? '您的会员状态：已激活' : '您的会员状态：未激活'}
              </Text>
            </View>

            {isVip && (
              <View className='details'>
                <View className='detail-row'>
                  <Text className='detail-label'>会员等级</Text>
                  <Text className='detail-value'>{tierName}</Text>
                </View>
                <View className='detail-row'>
                  <Text className='detail-label'>到期时间</Text>
                  <Text className='detail-value'>{expiryDate}</Text>
                </View>
              </View>
            )}

            {!isVip && (
              <View
                className='action-button'
                onClick={() => Taro.navigateTo({ url: '/pages/member/benefits/index' })}
              >
                <Text className='action-button-text'>了解会员权益</Text>
              </View>
            )}
          </View>

          <View className='benefits-card'>
            <View className='benefits-header'>
              <Text className='benefits-header-text flex-2'>权益功能</Text>
              <Text className='benefits-header-text flex-1'>非会员</Text>
              <Text className='benefits-header-text flex-1'>会员</Text>
            </View>
            {comparisonData.map((item, index) => (
              <View
                key={item.feature}
                className={`benefits-row ${index > 0 ? 'border-top' : ''}`}
              >
                <Text className='benefits-feature flex-2'>{item.feature}</Text>
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
            <Text className='logout-text'>退出/切换会员账号</Text>
          </View>
        </View>
      )}

      <MiniPlayer />
    </View>
  );
}
