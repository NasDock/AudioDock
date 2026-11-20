import { Input, ScrollView, Switch, Text, View } from '@tarojs/components';
import Taro, { useLoad } from '@tarojs/taro';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import {
  createAccessToken,
  deleteAccessToken,
  getAccessTokens,
  updateAccessToken,
  type AccessToken,
} from '@soundx/services';
import './index.scss';

const formatTime = (value?: string | Date | null) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function AccessTokensPage() {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const [tokens, setTokens] = useState<AccessToken[]>([]);
  const [loaded, setLoaded] = useState(false);
  // 名称输入弹窗复用：create 创建 / rename 重命名
  const [nameModal, setNameModal] = useState<{
    mode: 'create' | 'rename';
    target?: AccessToken;
  } | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /** 创建成功后展示的完整令牌（仅此一次可见） */
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  useLoad(() => {
    Taro.setNavigationBarTitle({ title: t('accessTokenManagement.title') });
    Taro.setNavigationBarColor({
      frontColor: colors.text === '#11181C' ? '#000000' : '#ffffff',
      backgroundColor: colors.background,
    });
    fetchData();
  });

  const fetchData = async () => {
    try {
      const res = await getAccessTokens();
      if (res.code === 200) {
        setTokens(res.data ?? []);
      } else {
        Taro.showToast({ title: res.message || t('accessTokenManagement.fetchFailed'), icon: 'none' });
      }
    } catch (error) {
      console.warn('Failed to load access tokens', error);
      Taro.showToast({ title: t('accessTokenManagement.fetchFailed'), icon: 'none' });
    } finally {
      setLoaded(true);
    }
  };

  const openCreate = () => {
    setNameInput('');
    setNameModal({ mode: 'create' });
  };

  const openRename = (token: AccessToken) => {
    setNameInput(token.name);
    setNameModal({ mode: 'rename', target: token });
  };

  const handleSubmitName = async () => {
    const name = nameInput.trim();
    if (!name || !nameModal || submitting) return;
    setSubmitting(true);
    try {
      if (nameModal.mode === 'create') {
        const res = await createAccessToken(name);
        if (res.code === 200) {
          setNameModal(null);
          setCreatedToken(res.data.token);
          fetchData();
        } else {
          Taro.showToast({ title: res.message || t('common.error'), icon: 'none' });
        }
      } else if (nameModal.target) {
        const res = await updateAccessToken(nameModal.target.id, { name });
        if (res.code === 200) {
          setNameModal(null);
          Taro.showToast({ title: t('accessTokenManagement.renameSuccess'), icon: 'none' });
          fetchData();
        } else {
          Taro.showToast({ title: res.message || t('common.error'), icon: 'none' });
        }
      }
    } catch (error) {
      console.warn('Submit access token name failed', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!createdToken) return;
    try {
      await Taro.setClipboardData({ data: createdToken });
    } catch {
      Taro.showToast({ title: t('accessTokenManagement.copyFailed'), icon: 'none' });
    }
  };

  const handleToggle = async (token: AccessToken, enabled: boolean) => {
    try {
      const res = await updateAccessToken(token.id, { enabled });
      if (res.code === 200) {
        Taro.showToast({
          title: enabled
            ? t('accessTokenManagement.enableSuccess')
            : t('accessTokenManagement.disableSuccess'),
          icon: 'none',
        });
        fetchData();
      } else {
        Taro.showToast({ title: res.message || t('common.error'), icon: 'none' });
      }
    } catch (error) {
      console.warn('Toggle access token failed', error);
    }
  };

  const handleDelete = (token: AccessToken) => {
    Taro.showModal({
      title: t('accessTokenManagement.deleteConfirmTitle'),
      content: t('accessTokenManagement.deleteConfirmContent', { name: token.name }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const delRes = await deleteAccessToken(token.id);
          if (delRes.code === 200) {
            Taro.showToast({ title: t('accessTokenManagement.deleteSuccess'), icon: 'none' });
            fetchData();
          } else {
            Taro.showToast({ title: delRes.message || t('common.error'), icon: 'none' });
          }
        } catch (error) {
          console.warn('Delete access token failed', error);
        }
      },
    });
  };

  return (
    <View className='access-tokens'>
      <ScrollView scrollY className='list'>
        <Text className='description'>{t('accessTokenManagement.description')}</Text>

        {loaded && tokens.length === 0 ? (
          <View className='empty'>
            <Text>{t('common.noData')}</Text>
          </View>
        ) : (
          tokens.map((token) => (
            <View key={token.id} className='token-card'>
              <View className='token-row'>
                <View className='token-info'>
                  <Text className='token-name'>{token.name}</Text>
                  <Text className='token-prefix'>{token.tokenPrefix}…</Text>
                </View>
                <Switch
                  checked={token.enabled}
                  onChange={(e) => handleToggle(token, e.detail.value as unknown as boolean)}
                  color='#000000'
                />
              </View>
              <Text className='token-meta'>
                {t('accessTokenManagement.lastUsedAt')}:{' '}
                {token.lastUsedAt ? formatTime(token.lastUsedAt) : t('accessTokenManagement.neverUsed')}
              </Text>
              <Text className='token-meta'>
                {t('accessTokenManagement.createdAt')}: {formatTime(token.createdAt) || '-'}
              </Text>
              <View className='token-actions'>
                <View className='btn btn-secondary btn-mini' onClick={() => openRename(token)}>
                  <Text>{t('accessTokenManagement.rename')}</Text>
                </View>
                <View className='btn btn-danger btn-mini' onClick={() => handleDelete(token)}>
                  <Text>{t('common.delete')}</Text>
                </View>
              </View>
            </View>
          ))
        )}

        <View className='add-btn' onClick={openCreate}>
          <Text className='add-btn-text'>+ {t('accessTokenManagement.create')}</Text>
        </View>
      </ScrollView>

      {/* 创建 / 重命名 名称输入弹窗 */}
      {nameModal && (
        <View className='editor-mask' onClick={() => setNameModal(null)}>
          <View className='editor-card' onClick={(e) => e.stopPropagation()}>
            <Text className='editor-title'>
              {nameModal.mode === 'create'
                ? t('accessTokenManagement.createTitle')
                : t('accessTokenManagement.renameTitle')}
            </Text>
            <Input
              className='editor-input'
              value={nameInput}
              placeholder={t('accessTokenManagement.namePlaceholder')}
              onInput={(e) => setNameInput(e.detail.value)}
              focus
            />
            <View className='editor-footer'>
              <View className='btn btn-secondary' onClick={() => setNameModal(null)}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`btn btn-primary ${submitting || !nameInput.trim() ? 'btn-disabled' : ''}`}
                onClick={handleSubmitName}
              >
                <Text>{t('common.confirm')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* 创建成功：完整令牌仅此一次展示 */}
      {createdToken && (
        <View className='editor-mask'>
          <View className='editor-card'>
            <Text className='editor-title'>{t('accessTokenManagement.createdTitle')}</Text>
            <Text className='created-hint'>{t('accessTokenManagement.createdHint')}</Text>
            <View className='token-box'>
              <Text className='token-box-text' userSelect>
                {createdToken}
              </Text>
            </View>
            <View className='btn btn-secondary copy-btn' onClick={handleCopy}>
              <Text>{t('accessTokenManagement.copy')}</Text>
            </View>
            <View className='btn btn-primary' onClick={() => setCreatedToken(null)}>
              <Text>{t('accessTokenManagement.createdDone')}</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
