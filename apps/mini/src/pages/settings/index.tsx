import { plusDeleteMe, plusParticipateInternalTest } from '@soundx/services';
import { ScrollView, Slider, Switch, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { useTheme } from '../../context/ThemeContext';
import { usePlayMode } from '../../utils/playMode';
import { trackEvent } from '../../utils/tracking';
import './index.scss';

export default function Settings() {
  const { t } = useTranslation();
  const { logout, user } = useAuth();
  const { mode, setMode } = usePlayMode();
  const {
    acceptRelay,
    acceptSync,
    cacheEnabled,
    autoOrientation,
    autoTheme,
    carLayoutMode,
    voiceAssistantEnabled,
    activityNotifyEnabled,
    recommendationLikeRatio,
    carModeEnabled,
    screenBottomInset,
    experienceProgramEnabled,
    externalPlaybackQuality,
    updateSetting,
  } = useSettings();
  const { theme, toggleTheme } = useTheme();

  const [showScreenInsetModal, setShowScreenInsetModal] = useState(false);
  const [redeemingInternalTestCode, setRedeemingInternalTestCode] = useState(false);
  const [isVip, setIsVip] = useState(false);

  useEffect(() => {
    const isVipStr = Taro.getStorageSync('plus_vip_status');
    setIsVip(isVipStr === 'true');
  }, []);

  const handleLogout = () => {
    Taro.showModal({
      title: t('settings.logout'),
      content: t('settings.logoutConfirm'),
      success: (res) => {
        if (res.confirm) {
          logout();
          Taro.reLaunch({ url: '/pages/login/index' });
        }
      }
    });
  };

  const handleToggleCarMode = (val: boolean) => {
    if (val && !isVip) {
      Taro.showModal({
        title: t('settings.vipOnly'),
        content: t('settings.carModeVipOnly'),
        confirmText: t('settings.goToMemberPage'),
        cancelText: t('common.cancel'),
        success: (res) => {
          if (res.confirm) {
            Taro.navigateTo({ url: '/pages/member/benefits/index' });
          }
        }
      });
      return;
    }
    updateSetting('carModeEnabled', val);
    updateSetting('carLayoutMode', val);
    if (val) {
      Taro.reLaunch({ url: '/pages/index/index' });
    }
  };

  const handleToggleVoiceAssistant = (val: boolean) => {
    if (val && !isVip) {
      Taro.showModal({
        title: t('settings.vipOnly'),
        content: t('settings.voiceAssistantVipOnly'),
        confirmText: t('settings.goToMemberPage'),
        cancelText: t('common.cancel'),
        success: (res) => {
          if (res.confirm) {
            Taro.navigateTo({ url: '/pages/member/benefits/index' });
          }
        }
      });
      return;
    }
    updateSetting('voiceAssistantEnabled', val);
  };


  const getPlaybackQualityLabel = (quality: string) => {
    switch (quality) {
      case 'lossless':
        return t('settings.playbackQualityLossless');
      case 'high':
        return t('settings.playbackQualityHigh');
      default:
        return t('settings.playbackQualityLow');
    }
  };

  const carModeActive = carLayoutMode || carModeEnabled;

  const handleRedeemInternalTestCode = async () => {
    if (isVip) {
      Taro.showToast({ title: t('settings.betaTestAlreadyHas'), icon: 'none' });
      return;
    }

    const plusUserId = Taro.getStorageSync('plus_user_id');
    if (!plusUserId) {
      Taro.showToast({ title: t('settings.loginFirst'), icon: 'none' });
      return;
    }

    try {
      setRedeemingInternalTestCode(true);
      const vipStartsAt = new Date();
      const vipEndsAt = new Date(vipStartsAt);
      vipEndsAt.setMonth(vipEndsAt.getMonth() + 1);

      let id = plusUserId;
      try { id = JSON.parse(plusUserId); } catch(e) {}

      const res = await plusParticipateInternalTest({
        vipStartsAt: vipStartsAt.toISOString(),
        vipEndsAt: vipEndsAt.toISOString(),
      });
      const payload = res.data?.data;

      if (res.data?.code !== 200 || !payload?.ok) {
        throw new Error(res.data?.message || t('settings.betaTestFailed'));
      }

      Taro.setStorageSync('plus_vip_status', 'true');
      Taro.setStorageSync('plus_vip_data', JSON.stringify({
        ...payload,
        vipExpiresAt: payload.vipEndsAt,
      }));
      Taro.setStorageSync('plus_vip_updated_at', Date.now().toString());
      setIsVip(true);
      trackEvent({ feature: 'member', eventName: 'internal_test_participate_success' });
      Taro.showToast({ title: t('settings.betaTestSuccess'), icon: 'success' });
    } catch (error: any) {
      trackEvent({ feature: 'member', eventName: 'internal_test_participate_failed', metadata: { message: error.message || 'unknown_error' } });
      Taro.showToast({ title: error.message || t('settings.betaTestFailed'), icon: 'none' });
    } finally {
      setRedeemingInternalTestCode(false);
    }
  };

  const handleDeleteMemberAccount = () => {
    const plusToken = Taro.getStorageSync('plus_token');
    if (!plusToken) {
      Taro.showToast({ title: t('settings.loginFirst'), icon: 'none' });
      return;
    }

    Taro.showModal({
      title: t('settings.deleteMemberAccount'),
      content: t('settings.deleteMemberConfirm'),
      success: async (res) => {
        if (res.confirm) {
          try {
            const result = await plusDeleteMe();
            if (result.data?.code !== 200 || !result.data?.data?.ok) {
              throw new Error(result.data?.message || t('settings.deleteMemberFailed'));
            }
            Taro.removeStorageSync('plus_token');
            Taro.removeStorageSync('plus_user_id');
            Taro.removeStorageSync('plus_vip_status');
            setIsVip(false);
            Taro.showToast({ title: t('settings.deleteMemberSuccess'), icon: 'success' });
          } catch (error: any) {
            Taro.showToast({ title: error.message || t('settings.deleteMemberFailed'), icon: 'none' });
          }
        }
      }
    });
  };

  const renderSettingRow = (
    label: string,
    description: string,
    value: boolean,
    onValueChange: (val: boolean) => void
  ) => (
    <View className='setting-row'>
      <View className='setting-info'>
        <Text className='setting-label'>{label}</Text>
        <Text className='setting-description'>{description}</Text>
      </View>
      <Switch checked={value} onChange={(e) => onValueChange(e.detail.value)} color='#000000' />
    </View>
  );

  const renderActionRow = (
    label: string,
    description: string,
    onPress: () => void,
    valueText?: string
  ) => (
    <View className='setting-row' onClick={onPress}>
      <View className='setting-info'>
        <Text className='setting-label'>{label}</Text>
        <Text className='setting-description'>{description}</Text>
      </View>
      <View className='setting-action'>
        {valueText ? <Text className='setting-value'>{valueText}</Text> : null}
        <Text style={{ color: '#999', fontSize: '32rpx', marginLeft: '12rpx' }}>&gt;</Text>
      </View>
    </View>
  );

  return (
    <View className='settings-container'>
      <View className='header'>
        <View className='back-btn' onClick={() => Taro.navigateBack()}>
          <Text className='back-icon icon icon-back' />
        </View>
        <Text className='header-title'>{t('settings.title')}</Text>
        <View style={{ width: '80rpx' }} />
      </View>

      <ScrollView scrollY className='content'>
        <View className='section'>
          <Text className='section-title'>{t('settings.server')}</Text>
          {user?.is_admin && renderActionRow(
            t('settings.admin'),
            t('settings.adminDescription'),
            () => Taro.navigateTo({ url: '/pages/admin/index' })
          )}
          {renderActionRow(
            t('settings.sourceManage'),
            t('settings.sourceManageDescription'),
            () => Taro.navigateTo({ url: '/pages/source-manage/index' })
          )}
          {user?.is_admin && renderActionRow(
            t('settings.webdavSources'),
            t('settings.sourceManagementDescription'),
            () => Taro.navigateTo({ url: '/pages/webdav-sources/index' })
          )}
          {user?.is_admin && renderActionRow(
            t('settings.llmConfig'),
            t('settings.llmConfigDescription'),
            () => Taro.navigateTo({ url: '/pages/llm-config/index' })
          )}
          {user?.is_admin && renderActionRow(
            t('settings.ttsConfig'),
            t('settings.ttsConfigDescription'),
            () => Taro.navigateTo({ url: '/pages/tts-config/index' })
          )}
          {user?.is_admin && renderActionRow(
            t('settings.pluginCenter'),
            t('settings.pluginCenterDescription'),
            () => Taro.navigateTo({ url: '/pages/plugin-center/index' })
          )}
        </View>

        <View className='section'>
          <Text className='section-title'>{t('settings.general')}</Text>
          {renderActionRow(
            t('settings.language', '语言'),
            t('settings.languageDescription', '选择应用显示语言'),
            () => Taro.navigateTo({ url: '/pages/settings/language/index' })
          )}
          {renderActionRow(
            t('settings.externalPlaybackQuality'),
            t('settings.externalPlaybackQualityDescription'),
            () => Taro.navigateTo({ url: '/pages/settings/playback-quality/index' }),
            getPlaybackQualityLabel(externalPlaybackQuality)
          )}
          {renderSettingRow(t('settings.autoTheme'), t('settings.autoThemeDescription'), autoTheme, (val) => updateSetting('autoTheme', val))}
          <View style={{ opacity: autoTheme ? 0.5 : 1, pointerEvents: autoTheme ? 'none' : 'auto' }}>
            {renderSettingRow(t('settings.darkMode'), t('settings.darkModeDescription'), theme === 'dark', autoTheme ? () => {} : toggleTheme)}
          </View>
          {renderSettingRow(t('settings.autoOrientation'), t('settings.autoOrientationDescription'), autoOrientation, (val) => updateSetting('autoOrientation', val))}
          {renderSettingRow(t('settings.voiceAssistant'), t('settings.voiceAssistantDescription'), voiceAssistantEnabled, handleToggleVoiceAssistant)}
          {renderSettingRow(t('settings.activityNotify'), t('settings.activityNotifyDescription'), activityNotifyEnabled, (val) => updateSetting('activityNotifyEnabled', val))}

          <View className='setting-row slider-row'>
            <View className='setting-info' style={{ width: '100%', marginRight: 0 }}>
              <Text className='setting-label'>{t('settings.recommendationPreference')}</Text>
              <Text className='setting-description'>{t('settings.like')} {recommendationLikeRatio}% · {t('settings.fresh')} {100 - recommendationLikeRatio}%</Text>
              <Slider
                min={0}
                max={100}
                step={5}
                value={recommendationLikeRatio}
                onChange={(e) => updateSetting('recommendationLikeRatio', e.detail.value)}
                activeColor='#000000'
                backgroundColor='#eee'
                blockSize={16}
              />
            </View>
          </View>

          {renderSettingRow(t('settings.audiobookMode'), t('settings.audiobookModeDescription'), mode === 'AUDIOBOOK', (val) => setMode(val ? 'AUDIOBOOK' : 'MUSIC'))}
          {renderSettingRow(t('settings.relayPlay'), t('settings.relayPlayDescription'), acceptRelay, (val) => updateSetting('acceptRelay', val))}
          {renderSettingRow(t('settings.syncControl'), t('settings.syncControlDescription'), acceptSync, (val) => updateSetting('acceptSync', val))}
          {renderSettingRow(t('settings.cacheWhilePlaying'), t('settings.cacheWhilePlayingDescription'), cacheEnabled, (val) => updateSetting('cacheEnabled', val))}
        </View>

        <View className='section'>
          <Text className='section-title'>{t('settings.about')}</Text>
          {renderActionRow(t('settings.productUpdates'), t('settings.productUpdatesDescription'), () => Taro.showToast({ title: t('settings.productUpdatesNoUpdates'), icon: 'none' }))}
          {renderActionRow(t('settings.joinBetaTest'), isVip ? t('settings.betaTestAlreadyHas') : redeemingInternalTestCode ? t('settings.betaTestApplying') : t('settings.betaTestDescription'), handleRedeemInternalTestCode)}
          {renderSettingRow(t('settings.experienceProgram'), t('settings.experienceProgramDescription'), experienceProgramEnabled, (val) => updateSetting('experienceProgramEnabled', val))}
          {renderActionRow(
            t('settings.userAgreement'),
            t('settings.userAgreement'),
            () => {
              trackEvent({ feature: 'settings', eventName: 'user_agreement_open' });
              Taro.setClipboardData({
                data: 'https://www.audiodock.cn/docs/user-agreement/',
                success: () => Taro.showToast({ title: t('settings.linkCopied'), icon: 'none' })
              });
            }
          )}
          {renderActionRow(
            t('settings.privacyPolicy'),
            t('settings.privacyPolicy'),
            () => {
              trackEvent({ feature: 'settings', eventName: 'privacy_policy_open' });
              Taro.setClipboardData({
                data: 'https://www.audiodock.cn/docs/privacy-policy/',
                success: () => Taro.showToast({ title: t('settings.linkCopied'), icon: 'none' })
              });
            }
          )}
        </View>

        <View className='section'>
          <View className='logout-btn' onClick={handleLogout}>
            <Text className='logout-text'>{t('settings.logout')}</Text>
          </View>
          <View className='delete-member-btn' onClick={handleDeleteMemberAccount}>
            <Text className='delete-member-text'>{t('settings.deleteMemberAccount')}</Text>
          </View>
        </View>

        <View className='footer'>
          <Text className='version-text'>{t('settings.version', 'AudioDock Mini v1.0.0')}</Text>
        </View>
      </ScrollView>

      {/* Screen Inset Modal */}
      {showScreenInsetModal && (
        <View className='modal-mask' onClick={() => setShowScreenInsetModal(false)}>
          <View className='modal-content' onClick={(e) => e.stopPropagation()}>
            <View className='modal-title-row'>
              <Text className='modal-title'>{t('settings.screenInset')}</Text>
            </View>
            <View className='modal-description-row'>
              <Text className='modal-description'>{t('settings.screenInsetDescription')}</Text>
            </View>
            <View className='slider-panel'>
              <View className='slider-header'>
                <Text className='slider-label'>{t('settings.bottomInset')}</Text>
                <Text className='slider-number'>{Math.round(screenBottomInset)}</Text>
              </View>
              <Slider
                className='inset-slider'
                min={0}
                max={160}
                step={1}
                value={screenBottomInset}
                onChange={(e) => updateSetting('screenBottomInset', e.detail.value)}
                activeColor='#000000'
                backgroundColor='#eee'
                blockSize={16}
              />
              <View className='slider-hint-row'>
                <Text className='slider-hint'>{t('settings.closerToBottom')}</Text>
                <Text className='slider-hint'>{t('settings.pageUp')}</Text>
              </View>
            </View>
            <View className='modal-actions'>
              <View className='modal-btn modal-cancel-btn' onClick={() => { updateSetting('screenBottomInset', 0); setShowScreenInsetModal(false); }}>
                <Text className='modal-cancel-text'>{t('common.reset')}</Text>
              </View>
              <View className='modal-btn modal-confirm-btn' onClick={() => setShowScreenInsetModal(false)}>
                <Text className='modal-confirm-text'>{t('common.done')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
