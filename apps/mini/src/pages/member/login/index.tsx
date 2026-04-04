import { plusLogin, plusSendCode, setPlusToken } from '@soundx/services';
import { Image, Text, Textarea, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import './index.scss';

// Logo placeholder - using emoji
const LogoImage = () => <Text className='logo-emoji'>🎵</Text>;

export default function MemberLogin() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const handleSendCode = async () => {
    if (!phone) {
      Taro.showToast({ title: '请输入手机号', icon: 'none' });
      return;
    }
    setSendingCode(true);
    try {
      const res = await plusSendCode({ phone });
      if (res.data.code === 201 || res.data.code === 200) {
        setCountdown(60);
        const timer = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(timer);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        Taro.showToast({ title: res.data.message || '获取验证码失败', icon: 'none' });
      }
    } catch (e: any) {
      Taro.showToast({ title: e.response?.data?.message || '网络请求失败', icon: 'none' });
    } finally {
      setSendingCode(false);
    }
  };

  const handleLogin = async () => {
    if (!phone || !code) {
      Taro.showToast({ title: '请输入手机号和验证码', icon: 'none' });
      return;
    }
    setLoading(true);
    try {
      const res = await plusLogin({ phone, code });
      if (res.data.code === 201 || res.data.code === 200) {
        const { token: plusToken, userId } = res.data.data;

        // 保存 Plus Token
        wx.setStorageSync('plus_token', plusToken);
        wx.setStorageSync('plus_user_id', JSON.stringify(userId));
        setPlusToken(plusToken);

        Taro.showToast({ title: '登录成功', icon: 'success' });
        setTimeout(() => {
          Taro.navigateBack();
        }, 1500);
      } else {
        Taro.showToast({ title: res.data.message || '手机号或验证码错误', icon: 'none' });
      }
    } catch (e: any) {
      Taro.showToast({ title: e.response?.data?.message || '登录失败，请重试', icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className='member-login-container'>
      <View className='content'>
        <View className='logo-container'>
          <LogoImage />
          <Text className='title'>用户登录</Text>
          <Text className='subtitle'>AudioDock 听见你的声音</Text>
        </View>

        <View className='form'>
          <Text className='label'>手机号</Text>
          <View className='input-wrapper'>
            <Textarea
              className='input'
              placeholder='请输入手机号'
              placeholderClass='input-placeholder'
              value={phone}
              onInput={(e) => setPhone(e.detail.value)}
              type='number'
              maxlength={11}
            />
          </View>

          <Text className='label'>验证码</Text>
          <View className='code-row'>
            <View className='input-wrapper' style={{ flex: 1 }}>
              <Textarea
                className='input'
                placeholder='请输入验证码'
                placeholderClass='input-placeholder'
                value={code}
                onInput={(e) => setCode(e.detail.value)}
                type='number'
                maxlength={6}
              />
            </View>
            <View
              className={`code-button ${countdown > 0 || sendingCode ? 'disabled' : ''}`}
              onClick={handleSendCode}
            >
              <Text className='code-button-text'>
                {countdown > 0 ? `${countdown}s` : '获取验证码'}
              </Text>
            </View>
          </View>

          <View
            className={`button ${loading ? 'disabled' : ''}`}
            onClick={handleLogin}
          >
            <Text className='button-text'>登录</Text>
          </View>

          <View className='footer-links'>
            <Text className='footer-text'>登录即代表同意 </Text>
            <Text className='link-text' onClick={() => window.location.href = 'https://www.audiodock.cn/docs/privacy-policy/'}>《隐私政策》</Text>
            <Text className='footer-text'> 和 </Text>
            <Text className='link-text' onClick={() => window.location.href = 'https://www.audiodock.cn/docs/user-agreement/'}>《用户协议》</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
