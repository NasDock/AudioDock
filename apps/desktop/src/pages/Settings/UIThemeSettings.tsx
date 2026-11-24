import {
  Alert,
  Button,
  Empty,
  Popconfirm,
  Space,
  Tag,
  Typography,
  Upload,
  message as antdMessage,
} from "antd";
import { CloudUploadOutlined, DownloadOutlined } from "@ant-design/icons";
import {
  plusGetMe,
  TrackingEvent as TE,
  TrackingFeature as TF,
} from "@soundx/services";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { trackEvent } from "../../services/tracking";
import { useUiThemeStore } from "../../store/uiTheme";

const { Paragraph, Text } = Typography;

// 内置示例主题 —— 用于「下载示例」按钮；内容跟 docs/ui-theme.example.json 一致。
const SAMPLE_THEME = {
  meta: {
    name: "Midnight Glass (Sample)",
    author: "AudioDock",
    version: "1.0.0",
    schemaVersion: 1,
    description: "半透明深色玻璃风示例，演示如何覆盖 Header / Player / Home。",
  },
  dark: {
    global: {
      colorPrimary: "#7c5cff",
      colorBgBase: "#0d0d12",
      colorText: "#e6e6eb",
      colorTextSecondary: "#9a9aa5",
      colorBorder: "rgba(255,255,255,0.12)",
      borderRadius: 10,
    },
    components: {
      header: {
        background: "rgba(20,20,28,0.55)",
        blur: 24,
        textColor: "#e6e6eb",
        activeColor: "#7c5cff",
        border: "rgba(255,255,255,0.10)",
      },
      player: {
        background: "rgba(20,20,28,0.55)",
        blur: 24,
        textColor: "#e6e6eb",
        progressColor: "#7c5cff",
        controlColor: "rgba(255,255,255,0.12)",
      },
      home: {
        background: "rgba(20,20,28,0.45)",
        cardBackground: "rgba(255,255,255,0.05)",
        cardHoverBackground: "rgba(255,255,255,0.10)",
        titleColor: "#e6e6eb",
      },
      pages: {
        background: "rgba(20,20,28,0.45)",
      },
    },
  },
  light: {
    global: {
      colorPrimary: "#7c5cff",
      colorBgBase: "#f6f6fb",
      colorText: "#1a1a22",
      colorTextSecondary: "#5a5a66",
      colorBorder: "rgba(0,0,0,0.10)",
      borderRadius: 10,
    },
    components: {
      header: {
        background: "rgba(255,255,255,0.7)",
        blur: 24,
        textColor: "#1a1a22",
        activeColor: "#7c5cff",
        border: "rgba(0,0,0,0.08)",
      },
      player: {
        background: "rgba(255,255,255,0.7)",
        blur: 24,
        textColor: "#1a1a22",
        progressColor: "#7c5cff",
        controlColor: "rgba(0,0,0,0.08)",
      },
      home: {
        background: "rgba(255,255,255,0.55)",
        cardBackground: "rgba(0,0,0,0.04)",
        cardHoverBackground: "rgba(0,0,0,0.08)",
        titleColor: "#1a1a22",
      },
      pages: {
        background: "rgba(255,255,255,0.55)",
      },
    },
  },
};

const downloadSample = () => {
  const blob = new Blob([JSON.stringify(SAMPLE_THEME, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "audiodock-ui-theme.sample.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const UIThemeSettings: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { themes, order, activeId, importTheme, removeTheme, setActive } = useUiThemeStore();
  const openReportedRef = useRef(false);

  // VIP 校验：参考 Header/index.tsx 里的同名 useEffect。
  // 本地有缓存先信任缓存以避免首屏抖动；之后再用 plusGetMe 校正一次。
  const [isPlusVip, setIsPlusVip] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("plus_vip_status") === "true";
  });
  useEffect(() => {
    if (!openReportedRef.current) {
      openReportedRef.current = true;
      trackEvent({
        feature: TF.THEME,
        eventName: TE.THEME_UI_PLUGIN_OPEN,
      });
    }
    let cancelled = false;
    const refresh = async () => {
      const plusToken = localStorage.getItem("plus_token");
      const plusUserId = localStorage.getItem("plus_user_id");
      if (!plusToken || !plusUserId) {
        if (!cancelled) setIsPlusVip(false);
        return;
      }
      try {
        let id: any = plusUserId;
        try {
          id = JSON.parse(plusUserId);
        } catch {}
        const res = await plusGetMe(id);
        if (cancelled) return;
        const vipTier = res?.data?.data?.vipTier;
        const vip = !!vipTier && vipTier !== "NONE";
        setIsPlusVip(vip);
        localStorage.setItem("plus_vip_status", String(vip));
        if (res?.data?.data) {
          localStorage.setItem("plus_vip_data", JSON.stringify(res.data.data));
          localStorage.setItem("plus_vip_updated_at", Date.now().toString());
        }
      } catch (err) {
        console.warn("Failed to refresh plus VIP status", err);
      }
    };
    void refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "plus_vip_status") setIsPlusVip(e.newValue === "true");
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const list = useMemo(
    () => order.map((id) => ({ id, theme: themes[id] })).filter((x) => x.theme),
    [order, themes],
  );

  const handleUpload = async (file: File) => {
    if (!isPlusVip) {
      antdMessage.warning(t("uiPlugin.vipOnly"));
      return false;
    }
    const text = await file.text();
    const result = importTheme(text, file.name.replace(/\.json$/i, ""));
    if (!result.ok) {
      antdMessage.error({
        content: t("uiPlugin.invalid", { reason: result.error }),
        duration: 4,
      });
      return false;
    }
    if (result.warnings.length > 0) {
      antdMessage.warning(
        t("uiPlugin.warnings", { count: result.warnings.length }),
      );
    }
    antdMessage.success(t("uiPlugin.imported", { name: result.plugin.meta.name }));
    return false; // 阻止 antd Upload 默认上传
  };

  return (
    <div>
      {!isPlusVip && (
        <Alert
          type="warning"
          showIcon
          message={t("uiPlugin.vipOnly")}
          action={
            <Button
              size="small"
              type="primary"
              onClick={() => navigate("/member-benefits")}
            >
              {t("uiPlugin.vipOnlyAction")}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("uiPlugin.description")}
      </Paragraph>

      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Upload.Dragger
          accept=".json,application/json"
          showUploadList={false}
          beforeUpload={handleUpload}
          maxCount={1}
          disabled={!isPlusVip}
          style={{ padding: 12 }}
        >
          <p className="ant-upload-drag-icon">
            <CloudUploadOutlined />
          </p>
          <p className="ant-upload-text">{t("uiPlugin.upload")}</p>
          <p className="ant-upload-hint">{t("uiPlugin.uploadHint")}</p>
        </Upload.Dragger>

        <Space>
          <Button icon={<DownloadOutlined />} onClick={downloadSample}>
            {t("uiPlugin.downloadSample")}
          </Button>
        </Space>

        {list.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("uiPlugin.empty")}
            style={{ margin: "24px 0" }}
          />
        ) : (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            {list.map(({ id, theme }) => {
              const isActive = id === activeId;
              return (
                <Alert
                  key={id}
                  type={isActive ? "success" : "info"}
                  showIcon
                  message={
                    <Space size={8} wrap>
                      <Text strong>{theme.meta.name}</Text>
                      <Tag color="blue">schema v{theme.meta.schemaVersion}</Tag>
                      {theme.meta.version && (
                        <Tag>{t("uiPlugin.version", { version: theme.meta.version })}</Tag>
                      )}
                      {theme.meta.author && (
                        <Text type="secondary">
                          {t("uiPlugin.by", { author: theme.meta.author })}
                        </Text>
                      )}
                      {isActive && <Tag color="green">{t("uiPlugin.activeNow")}</Tag>}
                    </Space>
                  }
                  description={
                    theme.meta.description ? (
                      <Text type="secondary">{theme.meta.description}</Text>
                    ) : undefined
                  }
                  action={
                    <Space>
                      {isActive ? (
                        <Button
                          onClick={() => {
                            trackEvent({
                              feature: TF.THEME,
                              eventName: TE.THEME_UI_PLUGIN_APPLY,
                              metadata: { themeId: null },
                            });
                            setActive(null);
                          }}
                          disabled={!isPlusVip}
                        >
                          {t("uiPlugin.deactivate")}
                        </Button>
                      ) : (
                        <Button
                          type="primary"
                          onClick={() => {
                            trackEvent({
                              feature: TF.THEME,
                              eventName: TE.THEME_UI_PLUGIN_APPLY,
                              metadata: { themeId: id },
                            });
                            setActive(id);
                          }}
                          disabled={!isPlusVip}
                        >
                          {t("uiPlugin.active")}
                        </Button>
                      )}
                      <Popconfirm
                        title={t("uiPlugin.deleteConfirm")}
                        onConfirm={() => {
                          removeTheme(id);
                          antdMessage.success(t("uiPlugin.delete"));
                        }}
                      >
                        <Button danger disabled={!isPlusVip}>
                          {t("uiPlugin.delete")}
                        </Button>
                      </Popconfirm>
                    </Space>
                  }
                />
              );
            })}
          </Space>
        )}
      </Space>
    </div>
  );
};

export default UIThemeSettings;