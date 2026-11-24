import {
  Button,
  Collapse,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import {
  createMetadataPlugin,
  deleteMetadataPlugin,
  getMetadataPluginPriority,
  getMetadataPlugins,
  reloadMetadataPlugins,
  saveMetadataPlugins,
  setMetadataPluginPriority,
  updateMetadataPlugin,
  type MetadataPluginConfig,
  type MetadataPluginInput,
  type MetadataPluginTrackType,
  type MetadataPluginType,
  type MetadataPriority,
  TrackingEvent as TE,
  TrackingFeature as TF,
} from "@soundx/services";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMessage } from "../../context/MessageContext";
import { trackEvent } from "../../services/tracking";
import styles from "./index.module.less";

const { Text, Paragraph } = Typography;

const TYPE_OPTIONS: { value: MetadataPluginType; labelKey: string }[] = [
  { value: "http", labelKey: "settings.pluginTypeHttp" },
];

const TRACK_TYPE_OPTIONS: MetadataPluginTrackType[] = ["music", "audiobook", "mv"];

const newPlugin = (): MetadataPluginConfig => ({
  id: `plugin_${Date.now().toString(36)}`,
  name: "",
  enabled: true,
  priority: 0,
  type: "http",
  endpoint: "",
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
  if (p.type === "http") {
    cleaned.endpoint = p.endpoint?.trim() || undefined;
  } else if (p.type === "executable") {
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

const PluginCenterSettings: React.FC = () => {
  const { t } = useTranslation();
  const message = useMessage();
  const [plugins, setPlugins] = useState<MetadataPluginConfig[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [activeKey, setActiveKey] = useState<string[]>([]);
  const [priority, setPriority] = useState<MetadataPriority>("plugin");
  const [prioritySaving, setPrioritySaving] = useState(false);
  const openReportedRef = useRef(false);

  useEffect(() => {
    if (!openReportedRef.current) {
      openReportedRef.current = true;
      trackEvent({
        feature: TF.PLUGIN,
        eventName: TE.PLUGIN_CENTER_OPEN,
      });
    }
    void load();
    void loadPriority();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    try {
      const res = await getMetadataPlugins();
      if (res.code === 200) {
        setPlugins(res.data || []);
      } else {
        message.error(res.message || t("common.error"));
      }
    } catch (error) {
      console.error("Failed to load metadata plugins", error);
      message.error(t("common.error"));
    } finally {
      setLoaded(true);
    }
  };

  const loadPriority = async () => {
    try {
      const res = await getMetadataPluginPriority();
      if (res.code === 200 && res.data) {
        setPriority(res.data);
      }
    } catch (error) {
      console.error("Failed to load metadata priority", error);
    }
  };

  const handlePriorityChange = async (next: MetadataPriority) => {
    setPriority(next);
    setPrioritySaving(true);
    try {
      const res = await setMetadataPluginPriority(next);
      if (res.code === 200) {
        message.success(t("settings.metadataPrioritySaved"));
      } else {
        message.error(res.message || t("settings.metadataPrioritySaveFailed"));
        // restore previous on failure
        const prev = await getMetadataPluginPriority();
        if (prev.code === 200 && prev.data) setPriority(prev.data);
      }
    } catch (error) {
      console.error("Failed to save metadata priority", error);
      message.error(t("settings.metadataPrioritySaveFailed"));
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

  const updateFilter = (
    id: string,
    patch: Partial<NonNullable<MetadataPluginConfig["filter"]>>,
  ) => {
    setPlugins((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, filter: { ...(p.filter || {}), ...patch } }
          : p,
      ),
    );
  };

  const addPlugin = () => {
    const p = newPlugin();
    setPlugins((prev) => [...prev, p]);
    setActiveKey((prev) => (prev.includes(p.id) ? prev : [...prev, p.id]));
  };

  const removePlugin = async (id: string) => {
    const target = plugins.find((p) => p.id === id);
    if (!target) return;
    // Persist removal directly for items that already exist on the server.
    if (target.name || target.endpoint || target.command) {
      try {
        const res = await deleteMetadataPlugin(id);
        if (res.code !== 200) {
          message.error(res.message || t("settings.pluginDeleteFailed"));
          return;
        }
      } catch (error) {
        console.error("Failed to delete plugin", error);
        message.error(t("settings.pluginDeleteFailed"));
        return;
      }
    }
    setPlugins((prev) => prev.filter((p) => p.id !== id));
    setActiveKey((prev) => prev.filter((k) => k !== id));
    message.success(t("settings.pluginDeleteSuccess"));
  };

  const validate = (p: MetadataPluginConfig): string | null => {
    if (!p.id?.trim()) return t("settings.pluginIdRequired");
    if (!/^[A-Za-z0-9_-]+$/.test(p.id))
      return t("settings.pluginIdInvalid");
    if (!TYPE_OPTIONS.find((opt) => opt.value === p.type))
      return t("settings.pluginTypeInvalid");
    if (p.type === "http" && !p.endpoint?.trim())
      return t("settings.pluginEndpointRequired");
    if (p.type === "executable" && !p.command?.trim())
      return t("settings.pluginCommandRequired");
    return null;
  };

  const handleSave = async () => {
    if (plugins.length === 0) {
      message.warning(t("settings.pluginEmpty"));
      return;
    }
    const sanitized: MetadataPluginInput[] = [];
    for (const p of plugins) {
      const err = validate(p);
      if (err) {
        message.warning(err);
        return;
      }
      sanitized.push(cleanPlugin(p));
    }

    setSaving(true);
    try {
      const res = await saveMetadataPlugins(
        sanitized as MetadataPluginConfig[],
      );
      if (res.code === 200) {
        setPlugins(res.data || []);
        message.success(t("settings.pluginSaveSuccess"));
      } else {
        message.error(res.message || t("settings.pluginSaveFailed"));
      }
    } catch (error) {
      console.error("Save plugins failed", error);
      message.error(t("settings.pluginSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleReload = async () => {
    setReloading(true);
    try {
      const res = await reloadMetadataPlugins();
      if (res.code === 200) {
        setPlugins(res.data || []);
        message.success(t("settings.pluginReloadSuccess"));
      } else {
        message.error(res.message || t("settings.pluginReloadFailed"));
      }
    } catch (error) {
      console.error("Reload plugins failed", error);
      message.error(t("settings.pluginReloadFailed"));
    } finally {
      setReloading(false);
    }
  };

  // Kept for symmetry with other admin pages; createMetadataPlugin / updateMetadataPlugin
  // are exposed for the future "save per item" workflow but the bulk save above is the
  // primary path the page uses today.
  void createMetadataPlugin;
  void updateMetadataPlugin;

  return (
    <div className={styles.webdavWrapper}>
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("settings.pluginCenterDescription")}
      </Paragraph>
      <Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 12 }}>
        {t("settings.pluginCenterHint")}
      </Paragraph>

      <div
        style={{
          marginBottom: 16,
          padding: "12px 16px",
          border: "1px solid var(--ant-color-border, #d9d9d9)",
          borderRadius: 8,
        }}
      >
        <Text strong style={{ display: "block", marginBottom: 8 }}>
          {t("settings.metadataPriorityTitle")}
        </Text>
        <Radio.Group
          value={priority}
          disabled={prioritySaving}
          onChange={(e) => handlePriorityChange(e.target.value as MetadataPriority)}
        >
          <Space direction="vertical">
            <Radio value="plugin">
              <Text strong>{t("settings.metadataPriorityPlugin")}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("settings.metadataPriorityPluginDesc")}
              </Text>
            </Radio>
            <Radio value="embedded">
              <Text strong>{t("settings.metadataPriorityEmbedded")}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("settings.metadataPriorityEmbeddedDesc")}
              </Text>
            </Radio>
          </Space>
        </Radio.Group>
      </div>

      {loaded && plugins.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("settings.pluginEmpty")}
          style={{ margin: "32px 0" }}
        />
      ) : (
        <Collapse
          accordion={false}
          activeKey={activeKey}
          onChange={(keys) => setActiveKey(Array.isArray(keys) ? keys : [keys])}
          items={plugins.map((plugin, index) => {
            const types = plugin.filter?.types || [];
            return {
              key: plugin.id,
              label: (
                <Space size={4} wrap>
                  <Text strong>
                    {t("settings.pluginIndex", { index: index + 1 })}
                  </Text>
                  <Tag color="blue">{plugin.type}</Tag>
                  {types.map((tp) => (
                    <Tag key={tp} color="geekblue">
                      {tp}
                    </Tag>
                  ))}
                  {!plugin.enabled && (
                    <Tag color="default">
                      {t("settings.pluginEnabled")}: OFF
                    </Tag>
                  )}
                </Space>
              ),
              children: (
                <Form layout="vertical" size="middle">
                  <Form.Item label={t("settings.pluginType")}>
                    <Tag color="blue">{plugin.type}</Tag>
                    <Text type="secondary" style={{ marginLeft: 8 }}>
                      {t("settings.pluginTypeFixedHint")}
                    </Text>
                  </Form.Item>
                  {plugin.type === "http" && (
                    <Form.Item label={t("settings.pluginEndpoint")}>
                      <Input
                        value={plugin.endpoint || ""}
                        placeholder="http://localhost:18081/scrape"
                        onChange={(e) =>
                          updatePlugin(plugin.id, { endpoint: e.target.value })
                        }
                      />
                    </Form.Item>
                  )}
                  {plugin.type === "executable" && (
                    <Form.Item label={t("settings.pluginCommand")}>
                      <Input
                        value={plugin.command || ""}
                        placeholder="node plugins/my-plugin.js"
                        onChange={(e) =>
                          updatePlugin(plugin.id, { command: e.target.value })
                        }
                      />
                    </Form.Item>
                  )}
                  <Space size="large" wrap>
                    <Form.Item
                      label={t("settings.pluginPriority")}
                      style={{ marginBottom: 0 }}
                    >
                      <InputNumber
                        value={plugin.priority}
                        onChange={(val) =>
                          updatePlugin(plugin.id, {
                            priority: typeof val === "number" ? val : 0,
                          })
                        }
                      />
                    </Form.Item>
                    <Form.Item
                      label={`${t("settings.pluginTimeout")} (ms)`}
                      style={{ marginBottom: 0 }}
                    >
                      <InputNumber
                        min={1000}
                        step={1000}
                        value={plugin.timeout ?? 30000}
                        onChange={(val) =>
                          updatePlugin(plugin.id, {
                            timeout: typeof val === "number" ? val : 30000,
                          })
                        }
                      />
                    </Form.Item>
                    <Form.Item
                      label={t("settings.pluginRetry")}
                      style={{ marginBottom: 0 }}
                    >
                      <InputNumber
                        min={0}
                        max={5}
                        value={plugin.retry ?? 0}
                        onChange={(val) =>
                          updatePlugin(plugin.id, {
                            retry: typeof val === "number" ? val : 0,
                          })
                        }
                      />
                    </Form.Item>
                  </Space>
                  <Form.Item label={t("settings.pluginFilterTypes")}>
                    <Select
                      mode="multiple"
                      allowClear
                      value={types}
                      placeholder={t("settings.pluginFilterTypesPlaceholder")}
                      options={TRACK_TYPE_OPTIONS.map((tp) => ({
                        value: tp,
                        label: tp,
                      }))}
                      onChange={(val) =>
                        updateFilter(plugin.id, {
                          types: val as MetadataPluginTrackType[],
                        })
                      }
                      style={{ maxWidth: 360 }}
                    />
                  </Form.Item>
                  <Form.Item>
                    <Space wrap>
                      <Switch
                        checked={plugin.enabled}
                        onChange={(val) =>
                          updatePlugin(plugin.id, { enabled: val })
                        }
                      />
                      <Popconfirm
                        title={t("settings.pluginRemoveConfirm")}
                        onConfirm={() => removePlugin(plugin.id)}
                      >
                        <Button danger>{t("settings.pluginRemove")}</Button>
                      </Popconfirm>
                    </Space>
                  </Form.Item>
                </Form>
              ),
            };
          })}
        />
      )}

      <Space style={{ marginTop: 16 }} wrap>
        <Button onClick={addPlugin} type="dashed">
          + {t("settings.pluginAdd")}
        </Button>
        <Button
          type="primary"
          loading={saving}
          onClick={handleSave}
          disabled={plugins.length === 0}
        >
          {saving ? t("settings.pluginSaving") : t("settings.pluginSave")}
        </Button>
        <Button onClick={handleReload} loading={reloading}>
          {t("settings.pluginReload")}
        </Button>
      </Space>
    </div>
  );
};

export default PluginCenterSettings;
