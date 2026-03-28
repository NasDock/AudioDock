import { plusCreatePayment, setPlusToken } from '@soundx/services';
import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import MiniPlayer from '../../../components/MiniPlayer';
import './index.scss';

type PaymentPlan = 'annual' | 'lifetime';

const comparisonData = [
  { feature: '基础功能', free: true, member: true },
  { feature: '设备接力', free: true, member: true },
  { feature: '同步控制', free: false, member: true },
  { feature: 'TTS生成有声书', free: false, member: true },
  { feature: 'TV版', free: false, member: true },
  { feature: '车机版', free: false, member: true },
];

export default function MemberBenefits() {
  const [selectedPlan, setSelectedPlan] = useState<PaymentPlan>('lifetime');
  const [loading, setLoading] = useState(false);

  const handlePayment = async (method: 'WECHAT' | 'ALIPAY') => {
    const userIdStr = wx.getStorageSync('plus_user_id');
    if (!userIdStr) {
      Taro.showModal({
        title: '提示',
        content: '请先登录会员账号',
        confirmText: '去登录',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            Taro.navigateTo({ url: '/pages/member/login/index' });
          }
        },
      });
      return;
    }

    setLoading(true);
    try {
      const res = await plusCreatePayment({
        userId: userIdStr,
        amount: selectedPlan === 'annual' ? 20 : 60,
        currency: 'CNY',
        method,
        forVip: true,
        vipTier: selectedPlan === 'annual' ? 'BASIC' : 'LIFETIME',
        forPoints: false,
        pointsAmount: 0,
      });

      if (res.data.code === 201 || res.data.code === 200) {
        const { paymentUrl, wechatPay, alipayPay, orderId } = res.data.data || {};

        if (method === 'WECHAT') {
          if (wechatPay) {
            // WeChat payment - in mini program would use wx.requestPayment
            Taro.showToast({ title: '微信支付暂不支持', icon: 'none' });
          } else if (paymentUrl) {
            Taro.showToast({ title: '订单已创建，请在网页端完成支付', icon: 'none' });
          } else {
            Taro.showToast({ title: '支付参数获取失败', icon: 'none' });
          }
          return;
        }

        if (method === 'ALIPAY') {
          if (alipayPay?.orderString) {
            Taro.showToast({ title: '支付宝支付暂不支持', icon: 'none' });
          } else if (paymentUrl) {
            Taro.showToast({ title: '订单已创建，请在网页端完成支付', icon: 'none' });
          } else {
            Taro.showToast({ title: '支付参数获取失败', icon: 'none' });
          }
          return;
        }
      } else {
        Taro.showToast({ title: res.data.message || '请求失败', icon: 'none' });
      }
    } catch (e: any) {
      Taro.showToast({ title: e.response?.data?.message || '网络请求失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    Taro.showModal({
      title: '退出会员账号',
      content: '确定要退出会员账号吗？',
      confirmText: '确定',
      cancelText: '取消',
      success: async (res) => {
        if (res.confirm) {
          wx.removeStorageSync('plus_user_id');
          wx.removeStorageSync('plus_token');
          Taro.redirectTo({ url: '/pages/member/login/index' });
        }
      },
    });
  };

  return (
    <View className='member-benefits-container'>
      <View className='header'>
        <View className='back-btn' onClick={() => Taro.navigateBack()}>
          <Text className='back-icon'>←</Text>
        </View>
        <Text className='header-title'>会员权益</Text>
        <View style={{ width: '80rpx' }} />
      </View>

      <View className='scroll-content'>
        {/* Comparison Table */}
        <View className='table-card'>
          <View className='table-header'>
            <Text className='table-header-text flex-2'>权益功能</Text>
            <Text className='table-header-text flex-1 center'>非会员</Text>
            <Text className='table-header-text flex-1 center'>会员</Text>
          </View>
          {comparisonData.map((item, index) => (
            <View
              key={item.feature}
              className={`table-row ${index > 0 ? 'border-top' : ''}`}
            >
              <Text className='feature-text flex-2'>{item.feature}</Text>
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
          <Text className='divider-text'>会员方案</Text>
        </View>

        <View className='plans-container'>
          <View
            className={`plan-card ${selectedPlan === 'annual' ? 'active' : ''}`}
            onClick={() => setSelectedPlan('annual')}
          >
            <Text className='plan-name'>年卡</Text>
            <View className='price-container'>
              <Text className='currency'>¥</Text>
              <Text className='price-amount'>20</Text>
              <Text className='unit'>/年</Text>
            </View>
          </View>

          <View
            className={`plan-card ${selectedPlan === 'lifetime' ? 'active' : ''}`}
            onClick={() => setSelectedPlan('lifetime')}
          >
            {selectedPlan === 'lifetime' && (
              <View className='recommend-badge'>
                <Text className='recommend-text'>推荐</Text>
              </View>
            )}
            <Text className='plan-name'>永久卡</Text>
            <View className='price-container'>
              <Text className='currency'>¥</Text>
              <Text className='price-amount'>60</Text>
              <Text className='unit'>/永久</Text>
            </View>
          </View>
        </View>

        {/* Payment Methods */}
        <View className='divider-container'>
          <Text className='divider-text'>支付方式</Text>
        </View>

        <View className='payment-methods'>
          <View
            className={`payment-item ${loading ? 'disabled' : ''}`}
            onClick={() => handlePayment('WECHAT')}
          >
            <Text className='payment-icon'>💳</Text>
            <Text className='payment-text'>微信支付</Text>
          </View>
          <View
            className={`payment-item ${loading ? 'disabled' : ''}`}
            onClick={() => handlePayment('ALIPAY')}
          >
            <Text className='payment-icon'>💰</Text>
            <Text className='payment-text'>支付宝</Text>
          </View>
        </View>

        <View className='logout-button' onClick={handleLogout}>
          <Text className='logout-icon'>🚪</Text>
          <Text className='logout-text'>退出会员账号</Text>
        </View>
      </View>

      <MiniPlayer />
    </View>
  );
}
