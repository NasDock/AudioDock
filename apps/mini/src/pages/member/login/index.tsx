import { plusGetMe, plusLogin, plusSendCode, setPlusToken, TrackingEvent as TE, TrackingFeature as TF } from '@soundx/services';
import { Image, Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './index.scss';
import logoImg from '../../../assets/images/logo.png';
import { trackEvent } from '../../../utils/tracking';

export default function MemberLogin() {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const loginPageOpenedRef = useRef(false);

  useEffect(() => {
    if (loginPageOpenedRef.current) return;
    loginPageOpenedRef.current = true;
    void trackEvent({ feature: TF.LOGIN, eventName: TE.LOGIN_PAGE_OPEN });
  }, []);

  const handleSendCode = async () => {
    if (!phone) {
      Taro.showToast({ title: t('member.enterPhone'), icon: 'none' });
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
        Taro.showToast({ title: res.data.message || t('member.getCodeFailed'), icon: 'none' });
      }
    } catch (e: any) {
      Taro.showToast({ title: e.response?.data?.message || t('member.networkError'), icon: 'none' });
    } finally {
      setSendingCode(false);
    }
  };

  const handleLogin = async () => {
    if (!phone || !code) {
      Taro.showToast({ title: t('member.enterPhoneAndCode'), icon: 'none' });
      return;
    }
    void trackEvent({ feature: TF.LOGIN, eventName: TE.LOGIN_SUBMIT });

    setLoading(true);
    try {
      const res = await plusLogin({ phone, code });
      if (res.data.code === 201 || res.data.code === 200) {
        const { token: plusToken, userId } = res.data.data;

        void trackEvent({ feature: TF.LOGIN, eventName: TE.LOGIN_SUCCESS });

        // 保存 Plus Token
        Taro.setStorageSync('plus_token', plusToken);
        Taro.setStorageSync('plus_user_id', JSON.stringify(userId));
        setPlusToken(plusToken);

        // Fetch VIP status after login
        try {
          const profileRes = await plusGetMe(userId);
          const vipTier = profileRes?.data?.data?.vipTier;
          const isVipUser = vipTier && vipTier !== 'NONE';
          Taro.setStorageSync('plus_vip_status', isVipUser ? 'true' : 'false');
          Taro.setStorageSync('plus_vip_data', JSON.stringify(profileRes?.data?.data || {}));
          Taro.setStorageSync('plus_vip_updated_at', Date.now().toString());
        } catch (profileErr) {
          console.warn('Failed to fetch vip status after login', profileErr);
        }

        Taro.showToast({ title: t('member.loginSuccess'), icon: 'success' });
        setTimeout(() => {
          Taro.navigateBack();
        }, 1500);
      } else {
        void trackEvent({ feature: TF.LOGIN, eventName: TE.LOGIN_FAILED });
        Taro.showToast({ title: res.data.message || t('member.codeError'), icon: 'none' });
      }
    } catch (e: any) {
      void trackEvent({ feature: TF.LOGIN, eventName: TE.LOGIN_FAILED });
      Taro.showToast({ title: e.response?.data?.message || t('member.loginFailedRetry'), icon: 'none' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className='member-login-container'>
      <View className='content'>
        <View className='logo-container'>
          <Image src={logoImg} className='logo-image' mode='aspectFit' />
          <Text className='title'>{t('member.loginTitle')}</Text>
          <Text className='subtitle'>{t('loginForm.appSlogan')}</Text>
        </View>

        <View className='form'>
          <Text className='label'>{t('login.phone')}</Text>
          <View className='input-wrapper'>
            <Input
              className='input'
              placeholder={t('member.enterPhone')}
              placeholderClass='input-placeholder'
              value={phone}
              onInput={(e) => setPhone(e.detail.value)}
              type='number'
              maxlength={11}
            />
          </View>

          <Text className='label'>{t('login.verificationCode')}</Text>
          <View className='code-row'>
            <View className='input-wrapper' style={{ flex: 1 }}>
              <Input
                className='input'
                placeholder={t('member.enterPhoneAndCode')}
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
                {countdown > 0 ? `${countdown}s` : t('login.sendCode')}
              </Text>
            </View>
          </View>

          <View
            className={`button ${loading ? 'disabled' : ''}`}
            onClick={handleLogin}
          >
            <Text className='button-text'>{t('login.loginButton')}</Text>
          </View>

          <View className='footer-links'>
            <Text className='footer-text'>{t('member.loginAgreement')} </Text>
            <Text className='link-text' onClick={() => Taro.setClipboardData({ data: 'https://www.audiodock.cn/docs/privacy-policy/', success: () => Taro.showToast({ title: t('member.linkCopied'), icon: 'none' }) })}>{t('member.privacyPolicy')}</Text>
            <Text className='footer-text'> {t('common.and')} </Text>
            <Text className='link-text' onClick={() => Taro.setClipboardData({ data: 'https://www.audiodock.cn/docs/user-agreement/', success: () => Taro.showToast({ title: t('member.linkCopied'), icon: 'none' }) })}>{t('member.userAgreement')}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
