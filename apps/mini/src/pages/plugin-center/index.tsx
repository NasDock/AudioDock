import { TrackingEvent as TE, TrackingFeature as TF } from '@soundx/services';
import { Radio, RadioGroup, Switch, Text, Textarea, View } from '@tarojs/components';
import Taro, { useLoad } from '@tarojs/taro';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../context/ThemeContext';
import {
  getMetadataPluginPriority,
  getMetadataPlugins,
  reloadMetadataPlugins,
  saveMetadataPlugins,
  setMetadataPluginPriority,
  type MetadataPluginConfig,
  type MetadataPluginTrackType,
  type MetadataPluginType,
  type MetadataPriority,
} from '../../services/metadata-plugins';
import { trackEvent } from '../../utils/tracking';
import './index.scss';

const TYPE_OPTIONS: MetadataPluginType[] = ['http'];
const TRACK_TYPE_OPTIONS: MetadataPluginTrackType[] = [
  'music',
  'audiobook',
  'mv',
];

const newPlugin = (): MetadataPluginConfig => ({
  id: `plugin_${Date.now().toString(36)}`,
  name: '',
  enabled: true,
  priority: 0,
  type: 'http',
  endpoint: '',
  timeout: 30000,
  retry: 0,
  filter: { types: [] },
});

const cleanPlugin = (p: MetadataPluginConfig): MetadataPluginConfig => {
  const cleaned: MetadataPluginConfig = {
    id: p.id,
    name: p.name?.trim() || p.id,
    enabled: p.enabled !== false,
    priority: p.priority ?? 0,
    type: p.type,
  };
  if (p.type === 'http') {
    cleaned.endpoint = p.endpoint?.trim() || undefined;
  } else if (p.type === 'executable') {
    cleaned.command = p.command?.trim() || undefined;
  }
  if (p.timeout !== undefined && p.timeout !== 30000) cleaned.timeout = p.timeout;
  if (p.retry !== undefined && p.retry !== 0) cleaned.retry = p.retry;
  const types = (p.filter?.types || []).filter(Boolean);
  if (types.length > 0) {
    cleaned.filter = { types };
  }
  return cleaned;
};

export default function PluginCenter() {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const [plugins, setPlugins] = useState<MetadataPluginConfig[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [priority, setPriority] = useState<MetadataPriority>('plugin');
  const [prioritySaving, setPrioritySaving] = useState(false);
  const pluginCenterOpenedRef = useRef(false);

  useLoad(() => {
    if (!pluginCenterOpenedRef.current) {
      pluginCenterOpenedRef.current = true;
      void trackEvent({ feature: TF.PLUGIN, eventName: TE.PLUGIN_CENTER_OPEN });
    }
    Taro.setNavigationBarTitle({ title: t('settings.pluginCenter') });
    Taro.setNavigationBarColor({
      frontColor: colors.text === '#11181C' ? '#000000' : '#ffffff',
      backgroundColor: colors.background,
    });
    void fetchData();
  });

  const fetchData = async () => {
    try {
      const res = await getMetadataPlugins();
      if (res.code === 200) {
        setPlugins(res.data ?? []);
      } else {
        Taro.showToast({ title: res.message || t('common.error'), icon: 'none' });
      }
    } catch (error: any) {
      Taro.showToast({ title: error?.message || t('common.error'), icon: 'none' });
    } finally {
      setLoaded(true);
    }
    // Load the global metadata-priority policy in parallel (best-effort).
    try {
      const pr = await getMetadataPluginPriority();
      if (pr.code === 200 && pr.data) setPriority(pr.data);
    } catch {
      /* non-fatal */
    }
  };

  const handlePriorityChange = async (next: MetadataPriority) => {
    setPriority(next);
    setPrioritySaving(true);
    try {
      const res = await setMetadataPluginPriority(next);
      if (res.code === 200) {
        Taro.showToast({ title: t('settings.metadataPrioritySaved'), icon: 'success' });
      } else {
        Taro.showToast({
          title: res.message || t('settings.metadataPrioritySaveFailed'),
          icon: 'none',
        });
        const prev = await getMetadataPluginPriority();
        if (prev.code === 200 && prev.data) setPriority(prev.data);
      }
    } catch (error: any) {
      Taro.showToast({
        title: error?.message || t('settings.metadataPrioritySaveFailed'),
        icon: 'none',
      });
      const prev = await getMetadataPluginPriority();
      if (prev.code === 200 && prev.data) setPriority(prev.data);
    } finally {
      setPrioritySaving(false);
    }
  };

  const updatePlugin = (id: string, patch: Partial<MetadataPluginConfig>) => {
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  };

  const handleAdd = () => {
    setPlugins((prev) => [...prev, newPlugin()]);
  };

  const handleRemove = (id: string) => {
    Taro.showModal({
      title: t('settings.pluginRemoveConfirm'),
      success: (res) => {
        if (res.confirm) {
          setPlugins((prev) => prev.filter((p) => p.id !== id));
        }
      },
    });
  };

  const handleToggleType = (
    id: string,
    tp: MetadataPluginTrackType,
    on: boolean,
  ) => {
    setPlugins((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const current = p.filter?.types || [];
        const next = on
          ? Array.from(new Set([...current, tp]))
          : current.filter((x) => x !== tp);
        return { ...p, filter: { ...(p.filter || {}), types: next } };
      }),
    );
  };

  const validate = (p: MetadataPluginConfig): string | null => {
    if (!p.id?.trim()) return t('settings.pluginIdRequired');
    if (!/^[A-Za-z0-9_-]+$/.test(p.id)) return t('settings.pluginIdInvalid');
    if (!TYPE_OPTIONS.includes(p.type)) return t('settings.pluginTypeInvalid');
    if (p.type === 'http' && !p.endpoint?.trim())
      return t('settings.pluginEndpointRequired');
    if (p.type === 'executable' && !p.command?.trim())
      return t('settings.pluginCommandRequired');
    return null;
  };

  const handleSave = async () => {
    if (plugins.length === 0) {
      Taro.showToast({ title: t('settings.pluginEmpty'), icon: 'none' });
      return;
    }
    const sanitized: MetadataPluginConfig[] = [];
    for (const p of plugins) {
      const err = validate(p);
      if (err) {
        Taro.showToast({ title: err, icon: 'none' });
        return;
      }
      sanitized.push(cleanPlugin(p));
    }

    setSaving(true);
    try {
      const res = await saveMetadataPlugins(sanitized);
      if (res.code === 200) {
        setPlugins(res.data ?? []);
        Taro.showToast({ title: t('settings.pluginSaveSuccess'), icon: 'success' });
      } else {
        Taro.showToast({ title: res.message || t('settings.pluginSaveFailed'), icon: 'none' });
      }
    } catch (error: any) {
      Taro.showToast({
        title: error?.message || t('settings.pluginSaveFailed'),
        icon: 'none',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReload = async () => {
    Taro.showLoading({ title: t('common.loading') });
    try {
      const res = await reloadMetadataPlugins();
      Taro.hideLoading();
      if (res.code === 200) {
        setPlugins(res.data ?? []);
        Taro.showToast({ title: t('settings.pluginReloadSuccess'), icon: 'success' });
      } else {
        Taro.showToast({ title: res.message || t('settings.pluginReloadFailed'), icon: 'none' });
      }
    } catch (error: any) {
      Taro.hideLoading();
      Taro.showToast({
        title: error?.message || t('settings.pluginReloadFailed'),
        icon: 'none',
      });
    }
  };

  return (
    <View className='plugin-center' style={{ backgroundColor: colors.background }}>
      <View className='header'>
        <View className='back-btn' onClick={() => Taro.navigateBack()}>
          <Text className='back-icon icon icon-back' style={{ color: colors.text }} />
        </View>
        <Text className='header-title' style={{ color: colors.text }}>
          {t('settings.pluginCenter')}
        </Text>
        <View style={{ width: '80rpx' }} />
      </View>

      <Text className='description' style={{ color: colors.secondary }}>
        {t('settings.pluginCenterDescription')}
      </Text>
      <Text className='hint' style={{ color: colors.secondary }}>
        {t('settings.pluginCenterHint')}
      </Text>

      <View
        className='card'
        style={{
          borderColor: colors.border,
          backgroundColor: colors.card,
          marginBottom: '24rpx',
        }}
      >
        <Text
          className='card-title'
          style={{ color: colors.text, display: 'block', marginBottom: '12rpx' }}
        >
          {t('settings.metadataPriorityTitle')}
        </Text>
        <RadioGroup
          onChange={(e) => handlePriorityChange(e.detail.value as MetadataPriority)}
        >
          <View style={{ marginBottom: '16rpx' }}>
            <Radio
              value='plugin'
              checked={priority === 'plugin'}
              color={colors.primary}
              disabled={prioritySaving}
            >
              <Text style={{ color: colors.text }}>
                {t('settings.metadataPriorityPlugin')}
              </Text>
            </Radio>
            <Text
              style={{
                color: colors.secondary,
                fontSize: '24rpx',
                display: 'block',
                marginLeft: '52rpx',
              }}
            >
              {t('settings.metadataPriorityPluginDesc')}
            </Text>
          </View>
          <View>
            <Radio
              value='embedded'
              checked={priority === 'embedded'}
              color={colors.primary}
              disabled={prioritySaving}
            >
              <Text style={{ color: colors.text }}>
                {t('settings.metadataPriorityEmbedded')}
              </Text>
            </Radio>
            <Text
              style={{
                color: colors.secondary,
                fontSize: '24rpx',
                display: 'block',
                marginLeft: '52rpx',
              }}
            >
              {t('settings.metadataPriorityEmbeddedDesc')}
            </Text>
          </View>
        </RadioGroup>
      </View>

      <View className='list'>
        {!loaded ? null : plugins.length === 0 ? (
          <Text className='empty' style={{ color: colors.secondary }}>
            {t('settings.pluginEmpty')}
          </Text>
        ) : (
          plugins.map((plugin, index) => (
            <View
              key={plugin.id}
              className='card'
              style={{ borderColor: colors.border, backgroundColor: colors.card }}
            >
              <View className='card-header'>
                <Text className='card-title' style={{ color: colors.text }}>
                  {t('settings.pluginIndex', { index: index + 1 })}
                </Text>
                <View className='card-header-right'>
                  <Switch
                    checked={plugin.enabled}
                    onChange={(e) =>
                      updatePlugin(plugin.id, { enabled: e.detail.value })
                    }
                    color={colors.primary}
                  />
                  <Text
                    style={{ color: colors.secondary, marginLeft: '16rpx' }}
                    onClick={() => handleRemove(plugin.id)}
                  >
                    {t('settings.pluginRemove')}
                  </Text>
                </View>
              </View>

              <View className='field'>
                <Text className='field-label' style={{ color: colors.text }}>
                  {t('settings.pluginType')}
                </Text>
                <View
                  className='field-pick'
                  style={{ backgroundColor: colors.card, borderColor: colors.border, color: colors.text }}
                >
                  <Text style={{ color: colors.text }}>{plugin.type}</Text>
                </View>
                <Text className='field-hint' style={{ color: colors.secondary }}>
                  {t('settings.pluginTypeFixedHint')}
                </Text>
              </View>

              {plugin.type === 'http' && (
                <View className='field'>
                  <Text className='field-label' style={{ color: colors.text }}>
                    {t('settings.pluginEndpoint')}
                  </Text>
                  <Textarea
                    className='field-input'
                    style={{ backgroundColor: colors.card, color: colors.text, borderColor: colors.border }}
                    value={plugin.endpoint || ''}
                    onInput={(e) => updatePlugin(plugin.id, { endpoint: e.detail.value })}
                    placeholder='http://localhost:18081/scrape'
                    placeholderStyle={colors.secondary}
                    autoHeight
                  />
                </View>
              )}

              {plugin.type === 'executable' && (
                <View className='field'>
                  <Text className='field-label' style={{ color: colors.text }}>
                    {t('settings.pluginCommand')}
                  </Text>
                  <Textarea
                    className='field-input'
                    style={{ backgroundColor: colors.card, color: colors.text, borderColor: colors.border }}
                    value={plugin.command || ''}
                    onInput={(e) => updatePlugin(plugin.id, { command: e.detail.value })}
                    placeholder='node plugins/my-plugin.js'
                    placeholderStyle={colors.secondary}
                    autoHeight
                  />
                </View>
              )}

              <View className='field-row'>
                <View className='field'>
                  <Text className='field-label' style={{ color: colors.text }}>
                    {t('settings.pluginPriority')}
                  </Text>
                  <Textarea
                    className='field-input'
                    style={{ backgroundColor: colors.card, color: colors.text, borderColor: colors.border }}
                    value={String(plugin.priority ?? 0)}
                    onInput={(e) => updatePlugin(plugin.id, { priority: Number(e.detail.value) || 0 })}
                                      />
                </View>
                <View className='field'>
                  <Text className='field-label' style={{ color: colors.text }}>
                    {t('settings.pluginTimeout')} (ms)
                  </Text>
                  <Textarea
                    className='field-input'
                    style={{ backgroundColor: colors.card, color: colors.text, borderColor: colors.border }}
                    value={String(plugin.timeout ?? 30000)}
                    onInput={(e) =>
                      updatePlugin(plugin.id, {
                        timeout: Math.max(1000, Number(e.detail.value) || 30000),
                      })
                    }
                                      />
                </View>
                <View className='field'>
                  <Text className='field-label' style={{ color: colors.text }}>
                    {t('settings.pluginRetry')}
                  </Text>
                  <Textarea
                    className='field-input'
                    style={{ backgroundColor: colors.card, color: colors.text, borderColor: colors.border }}
                    value={String(plugin.retry ?? 0)}
                    onInput={(e) =>
                      updatePlugin(plugin.id, {
                        retry: Math.max(0, Number(e.detail.value) || 0),
                      })
                    }
                                      />
                </View>
              </View>

              <View className='field'>
                <Text className='field-label' style={{ color: colors.text }}>
                  {t('settings.pluginFilterTypes')}
                </Text>
                <View className='type-row'>
                  {TRACK_TYPE_OPTIONS.map((tp) => {
                    const active = (plugin.filter?.types || []).includes(tp);
                    return (
                      <View
                        key={tp}
                        className='type-chip'
                        style={{
                          borderColor: active ? colors.primary : colors.border,
                          color: active ? colors.primary : colors.text,
                        }}
                        onClick={() => handleToggleType(plugin.id, tp, !active)}
                      >
                        <Text
                          style={{
                            color: active ? colors.primary : colors.text,
                            fontWeight: '600',
                          }}
                        >
                          {tp}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>

            </View>
          ))
        )}
      </View>

      <View className='action-row'>
        <View
          className='save-btn'
          style={{ backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }}
          onClick={handleSave}
        >
          <Text className='save-btn-text'>
            {saving ? t('common.loading') : t('common.save')}
          </Text>
        </View>
        <View
          className='secondary-btn'
          style={{ borderColor: colors.border }}
          onClick={handleReload}
        >
          <Text className='secondary-btn-text' style={{ color: colors.text }}>
            {t('settings.pluginReload')}
          </Text>
        </View>
      </View>

      <View
        className='add-btn'
        style={{ borderColor: colors.border }}
        onClick={handleAdd}
      >
        <Text className='add-btn-text' style={{ color: colors.primary }}>
          + {t('settings.pluginAdd')}
        </Text>
      </View>
    </View>
  );
}
