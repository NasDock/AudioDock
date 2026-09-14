import {
  CloseOutlined,
  HddOutlined,
  LeftOutlined,
  LockOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  useEmbyAdapter as activateEmbyAdapter,
  useNativeAdapter as activateNativeAdapter,
  useSubsonicAdapter as activateSubsonicAdapter,
  check,
  consumeScanLoginSession,
  createScanLoginSession,
  getScanLoginSession,
  login,
  register,
  reportScanLoginResult,
  reportScanLoginResultViaSocket,
  type ScanLoginSession,
  type ScanLoginSessionStatus,
  setServiceConfig,
  SOURCEMAP,
  SOURCETIPSMAP,
  subscribeScanLoginSession,
} from "@soundx/services";
import {
  AutoComplete,
  Button,
  Checkbox,
  Flex,
  Form,
  Input,
  message,
  QRCode,
  Typography,
} from "antd";
import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import emby from "../../assets/emby.png";
import logo from "../../assets/logo.png";
import subsonic from "../../assets/subsonic.png";
import { useTheme } from "../../context/ThemeContext";
import { useAuthStore } from "../../store/auth";
import { trackEvent } from "../../services/tracking";
import { isWeb, tauriGetDeviceName, getDevicePlatform, getOrCreateDeviceId } from "../../utils/platform";
import { applyDesktopScanLoginResult } from "../../utils/scanLogin";
import styles from "./index.module.less";

const { Title, Text } = Typography;
type ServerHistoryItem = { value: string };
type SavedSourceConfig = {
  id: string;
  internal: string;
  external: string;
  name: string;
};
type LoginFormValues = {
  internalAddress?: string;
  externalAddress?: string;
  username?: string;
  password?: string;
  confirmPassword?: string;
};

const Login: React.FC = () => {
  const { t } = useTranslation();
  const { mode } = useTheme();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const location = useLocation();
  const { login: setLogin, user, device } = useAuthStore();

  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [scanSession, setScanSession] = useState<ScanLoginSession | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanLoginSessionStatus | null>(null);
  const [loginForm] = Form.useForm();

  const queryParams = new URLSearchParams(location.search);
  const paramSourceType = queryParams.get("type");
  const stateSourceType = location.state?.type;

  const [sourceType] = useState<string>(
    paramSourceType ||
      stateSourceType ||
      localStorage.getItem("selectedSourceType") ||
      "AudioDock",
  );

  const [serverHistory, setServerHistory] = useState<ServerHistoryItem[]>([]);
  const [rememberMe, setRememberMe] = useState(false);

  const normalizeLoginUser = (payload: Record<string, unknown> | null | undefined) => {
    if (payload?.user && typeof payload.user === "object" && "id" in payload.user) {
      return payload.user;
    }
    const rest = { ...(payload || {}) };
    delete rest.token;
    delete rest.device;
    return rest;
  };

  // Server response shape: { code, message, data }. Treat any non-200 code as failure
  // so the outer catch handler can surface the message to the user via messageApi.error.
  // Declared as a function (not a const arrow) so the `asserts` signature is recognized
  // at call sites - arrow consts with asserts trip TS2775 in .tsx builds.
  function ensureSuccess<T extends { code?: number; message?: string }>(
    res: T,
  ): asserts res is T & { code: 200; message: string } {
    if (res?.code !== 200) {
      throw new Error(res?.message || t("common.operationFailed"));
    }
  }

  const getSourceHistoryKey = (type: string) => `serverHistory_${type}`;
  const getSourceAddressKey = (type: string) => `serverAddress_${type}`;

  const getLogo = (key: string) => {
    switch (key) {
      case "Emby":
        return emby;
      case "Subsonic":
        return subsonic;
      default:
        return logo;
    }
  };

  const refreshScanStatus = async (session: ScanLoginSession) => {
    const res = await getScanLoginSession(session.sessionId, session.secret);
    setScanStatus(res.data);
    return res.data;
  };

  const createTargetSession = async () => {
    try {
      trackEvent({
        feature: "scan_login",
        eventName: "scan_login_qr_refresh",
        userId: user?.id ? String(user.id) : undefined,
        deviceId: device?.id ? String(device.id) : undefined,
      });
      const res = await createScanLoginSession({
        role: "target",
        deviceKind: "desktop",
      });
      setScanSession(res.data);
      setScanStatus({
        sessionId: res.data.sessionId,
        role: res.data.role,
        deviceKind: res.data.deviceKind,
        expiresAt: res.data.expiresAt,
        status: "waiting_scan",
        sourceBundles: [],
        hasNativeAuth: false,
        hasPlusAuth: false,
      });
    } catch (error) {
      console.error(error);
      messageApi.error(t("login.scanSessionCreateFailed"));
    }
  };

  useEffect(() => {
    createTargetSession();
  }, []);

  useEffect(() => {
    if (!scanSession) return;

    refreshScanStatus(scanSession).catch((error) => console.error(error));
    const unsubscribe = subscribeScanLoginSession(
      scanSession.sessionId,
      scanSession.secret,
      (status) => setScanStatus(status),
    );

    return () => {
      unsubscribe();
    };
  }, [scanSession]);

  useEffect(() => {
    if (!scanSession || scanStatus?.status !== "confirmed") return;

    const consumeConfirmedScan = async () => {
      try {
        const res = await consumeScanLoginSession(scanSession.sessionId, {
          secret: scanSession.secret,
        });

        try {
          await applyDesktopScanLoginResult(res.data);
        } catch (applyErr: any) {
          await reportScanLoginResult(scanSession.sessionId, {
            secret: scanSession.secret,
            success: false,
            error: applyErr.message,
          }).catch((reportErr) => console.error("Failed to report scan login result", reportErr));
          reportScanLoginResultViaSocket(scanSession.sessionId, scanSession.secret, false, applyErr.message);
          throw applyErr;
        }

        await reportScanLoginResult(scanSession.sessionId, {
          secret: scanSession.secret,
          success: true,
        }).catch((reportErr) => console.error("Failed to report scan login result", reportErr));
        reportScanLoginResultViaSocket(scanSession.sessionId, scanSession.secret, true);
        trackEvent({
          feature: "scan_login",
          eventName: "scan_login_result_success",
          userId: user?.id ? String(user.id) : undefined,
          deviceId: device?.id ? String(device.id) : undefined,
        });
        messageApi.success(t("login.scanLoginSuccess"));
        navigate("/");
      } catch (error) {
        console.error(error);
        trackEvent({
          feature: "scan_login",
          eventName: "scan_login_result_failed",
          userId: user?.id ? String(user.id) : undefined,
          deviceId: device?.id ? String(device.id) : undefined,
          metadata: {
            message: error instanceof Error ? error.message : "unknown_error",
          },
        });
        messageApi.error(error instanceof Error ? error.message : t("login.scanLoginFailed"));
        createTargetSession();
      }
    };

    consumeConfirmedScan();
  }, [scanSession?.sessionId, scanStatus?.status]);

  useEffect(() => {
    if (!sourceType) {
      navigate("/source-manage");
      return;
    }

    const historyKey = getSourceHistoryKey(sourceType);
    const history = localStorage.getItem(historyKey);
    setServerHistory(history ? JSON.parse(history) : []);

    const savedActiveAddress = localStorage.getItem(getSourceAddressKey(sourceType));
    const configKey = `sourceConfig_${sourceType}`;
    const savedConfigStr = localStorage.getItem(configKey);
    let configs: SavedSourceConfig[] = [];
    try {
      if (savedConfigStr) configs = JSON.parse(savedConfigStr);
      if (!Array.isArray(configs)) configs = [];
    } catch {
      configs = [];
    }

    let matchedConfig = null;
    if (savedActiveAddress) {
      matchedConfig = configs.find(
        (c) =>
          c.internal === savedActiveAddress ||
          c.external === savedActiveAddress,
      );
    }

    if (matchedConfig) {
      loginForm.setFieldsValue({
        internalAddress: matchedConfig.internal || "",
        externalAddress: matchedConfig.external || "",
      });
      restoreCredentials(savedActiveAddress || "", sourceType);
    } else if (savedActiveAddress) {
      const isLocal =
        savedActiveAddress.includes("192.") ||
        savedActiveAddress.includes("127.") ||
        savedActiveAddress.includes("localhost") ||
        savedActiveAddress.includes(".local");
      if (isLocal) loginForm.setFieldsValue({ internalAddress: savedActiveAddress });
      else loginForm.setFieldsValue({ externalAddress: savedActiveAddress });

      restoreCredentials(savedActiveAddress, sourceType);
    }
  }, [sourceType, loginForm, navigate]);

  const handleRemoveHistory = (e: React.MouseEvent, value: string) => {
    e.stopPropagation();
    const historyKey = getSourceHistoryKey(sourceType);
    const history = localStorage.getItem(historyKey);
    if (history) {
      const list = (JSON.parse(history) as ServerHistoryItem[]).filter((item) => item.value !== value);
      localStorage.setItem(historyKey, JSON.stringify(list));
      setServerHistory(list);
    }
  };

  const restoreCredentials = (address: string, type: string) => {
    if (!address) return;
    const credsKey = `creds_${type}_${address}`;
    const savedCreds = localStorage.getItem(credsKey);
    if (savedCreds) {
      const { username, password } = JSON.parse(savedCreds);
      loginForm.setFieldsValue({ username, password });
      setRememberMe(true);
    } else {
      loginForm.setFieldsValue({ username: "", password: "" });
      setRememberMe(false);
    }
  };

  const saveConfig = (internal: string, external: string, type: string) => {
    const configKey = `sourceConfig_${type}`;
    const existingStr = localStorage.getItem(configKey);
    let existingConfigs: SavedSourceConfig[] = [];
    try {
      if (existingStr) {
        const parsed = JSON.parse(existingStr);
        if (Array.isArray(parsed)) existingConfigs = parsed;
      }
    } catch {
      existingConfigs = [];
    }

    const existingIndex = existingConfigs.findIndex(
      (c) =>
        (internal && c.internal === internal) ||
        (external && c.external === external),
    );

    if (existingIndex !== -1) {
      existingConfigs[existingIndex] = {
        ...existingConfigs[existingIndex],
        internal: internal || existingConfigs[existingIndex].internal,
        external: external || existingConfigs[existingIndex].external,
      };
    } else {
      existingConfigs.push({
        id: Date.now().toString(),
        internal: internal || "",
        external: external || "",
        name: t("login.server", { index: existingConfigs.length + 1 }),
      });
    }
    localStorage.setItem(configKey, JSON.stringify(existingConfigs));

    const historyKey = getSourceHistoryKey(type);
    const history = localStorage.getItem(historyKey);
    const list = history ? JSON.parse(history) : [];

    [internal, external].forEach((addr) => {
      if (addr && !list.find((i: ServerHistoryItem) => i.value === addr)) {
        list.push({ value: addr });
      }
    });
    localStorage.setItem(historyKey, JSON.stringify(list));
    setServerHistory(list);
  };

  const configureAdapter = (
    type: string,
    address: string,
    username?: string,
    password?: string,
  ) => {
    const mappedType = SOURCEMAP[type as keyof typeof SOURCEMAP] || "audiodock";
    localStorage.setItem("serverAddress", address);
    setServiceConfig({
      username,
      password,
      clientName: "SoundX Desktop",
      baseUrl: address,
    });
    if (mappedType === "subsonic") activateSubsonicAdapter();
    else if (mappedType === "emby") activateEmbyAdapter();
    else activateNativeAdapter();
  };

  const checkConnectivity = async (
    internal: string,
    external: string,
    username?: string,
    password?: string,
  ) => {
    const type = sourceType;

    const tryAddress = async (addr: string) => {
      if (!addr) return false;
      if (!addr.startsWith("http") && !(isWeb() && addr.startsWith("/"))) {
        return false;
      }

      configureAdapter(type, addr, username, password);
      try {
        const response = await check();
        if (response) return true;
        if (SOURCEMAP[type as keyof typeof SOURCEMAP] === "subsonic") {
          return true;
        }
        return false;
      } catch {
        return false;
      }
    };

    if (internal && (await tryAddress(internal))) {
      configureAdapter(type, internal, username, password);
      return internal;
    }
    if (external && (await tryAddress(external))) {
      configureAdapter(type, external, username, password);
      return external;
    }

    throw new Error(t("login.connectionFailed"));
  };

  const handleFinish = async (values: LoginFormValues) => {
    setLoading(true);
    trackEvent({
      feature: "scan_login",
      eventName: isLogin ? "source_login_submit" : "source_register_submit",
      userId: user?.id ? String(user.id) : undefined,
      deviceId: device?.id ? String(device.id) : undefined,
      metadata: {
        sourceType,
      },
    });
    const type = sourceType;
    let internalAddress = values.internalAddress || "";
    const externalAddress = values.externalAddress || "";
    const username = values.username || "";
    const password = values.password || "";

    if (isWeb() && type === "AudioDock" && !internalAddress && !externalAddress) {
      internalAddress = "/api";
    }

    if (!internalAddress && !externalAddress) {
      messageApi.error(t("login.enterAddress"));
      setLoading(false);
      return;
    }

    try {
      const activeAddress = await checkConnectivity(
        internalAddress,
        externalAddress,
        username,
        password,
      );

      localStorage.setItem(`serverAddress_${type}`, activeAddress);
      localStorage.setItem("selectedSourceType", type);
      saveConfig(internalAddress, externalAddress, type);

      const tokenKey = `token_${activeAddress}`;
      const userKey = `user_${activeAddress}`;
      const deviceKey = `device_${activeAddress}`;

      const saveCreds = (addr: string) => {
        if (rememberMe) {
          localStorage.setItem(
            `creds_${type}_${addr}`,
            JSON.stringify({ username, password }),
          );
        }
      };
      if (internalAddress) saveCreds(internalAddress);
      if (externalAddress) saveCreds(externalAddress);

      if (isLogin) {
        const deviceName = await tauriGetDeviceName();
        const res = await login({
          username,
          password,
          deviceName,
          deviceId: getOrCreateDeviceId(),
          platform: getDevicePlatform(),
        });
        ensureSuccess(res);
        if (res.data) {
          const { token: newToken, device } = res.data;
          const userData = normalizeLoginUser(res.data);
          localStorage.setItem(tokenKey, newToken);
          localStorage.setItem(userKey, JSON.stringify(userData));
          if (device) localStorage.setItem(deviceKey, JSON.stringify(device));
          setLogin(newToken, userData as never, device);
          trackEvent({
            feature: "scan_login",
            eventName: "source_login_success",
            userId: userData?.id ? String(userData.id) : undefined,
            deviceId: device?.id ? String(device.id) : undefined,
            metadata: {
              sourceType,
            },
          });
          messageApi.success(t("login.loginSuccess"));
          navigate("/");
        }
      } else {
        const deviceName = await tauriGetDeviceName();
        const res = await register({
          username,
          password,
          deviceName,
          deviceId: getOrCreateDeviceId(),
          platform: getDevicePlatform(),
        });
        ensureSuccess(res);
        if (res.data) {
          const { token: newToken, device } = res.data;
          const userData = normalizeLoginUser(res.data);
          localStorage.setItem(tokenKey, newToken);
          localStorage.setItem(userKey, JSON.stringify(userData));
          if (device) localStorage.setItem(deviceKey, JSON.stringify(device));
          setLogin(newToken, userData as never, device);
          trackEvent({
            feature: "scan_login",
            eventName: "source_register_success",
            userId: userData?.id ? String(userData.id) : undefined,
            deviceId: device?.id ? String(device.id) : undefined,
            metadata: {
              sourceType,
            },
          });
          messageApi.success(t("login.registerSuccess"));
          navigate("/");
        }
      }
    } catch (error) {
      console.error(error);
      trackEvent({
        feature: "scan_login",
        eventName: isLogin ? "source_login_failed" : "source_register_failed",
        userId: user?.id ? String(user.id) : undefined,
        deviceId: device?.id ? String(device.id) : undefined,
        metadata: {
          sourceType,
          message: error instanceof Error ? error.message : "unknown_error",
        },
      });
      messageApi.error(error instanceof Error ? error.message : t("login.operationFailed"));
    } finally {
      setLoading(false);
    }
  };

  const qrValue = scanSession
    ? JSON.stringify({
        kind: "soundx-scan-login",
        version: 1,
        sessionId: scanSession.sessionId,
        secret: scanSession.secret,
        role: "target",
        deviceKind: "desktop",
      })
    : "";

  return (
    <div className={styles.container}>
      <Button
        icon={<LeftOutlined />}
        type="text"
        className={styles.backButton}
        onClick={() => navigate("/source-manage")}
      >
        {t("login.backToSelect")}
      </Button>
      {contextHolder}

      <div
        className={styles.card}
        style={
          mode === "dark"
            ? { background: "transparent", border: "none", boxShadow: "none" }
            : {}
        }
      >
        <div className={styles.contentGrid}>
          <div className={styles.scanSection}>
            {scanStatus?.status === "waiting_confirm" ? (
              <div
                className={styles.confirmPanel}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 200,
                }}
              >
                <Title level={5} style={{ marginBottom: 16 }}>
                  {t("login.waitingConfirm")}
                </Title>
                <Text type="secondary" style={{ textAlign: "center" }}>
                  {t("login.scanInstructions")}
                </Text>
              </div>
            ) : (
              <div className={styles.qrPanel}>
                {qrValue ? <QRCode value={qrValue} size={180} bordered={false} /> : null}
                <Button onClick={createTargetSession}>{t("login.refreshQR")}</Button>
              </div>
            )}
          </div>

          <div className={styles.formSection}>
          <div className={styles.header} style={{ marginBottom: isWeb() ? 20 : 0 }}>
            <img src={getLogo(sourceType)} alt={sourceType} className={styles.logo} />
            <Title style={{ margin: 0 }} level={4}>
              {sourceType} {isLogin ? t("login.login") : t("login.register")}
            </Title>
            <Text type="secondary">
              {SOURCETIPSMAP[sourceType as keyof typeof SOURCETIPSMAP]}
            </Text>
          </div>

          <Form
            form={loginForm}
            layout="vertical"
            size="large"
            className={styles.form}
            onFinish={handleFinish}
          >
            <Form.Item label={t("login.internalAddress")} name="internalAddress">
              <AutoComplete
                options={serverHistory.map((item) => ({
                  value: item.value,
                  label: (
                    <Flex justify="space-between" align="center">
                      <Text>{item.value}</Text>
                      <Button
                        type="text"
                        size="small"
                        icon={<CloseOutlined style={{ fontSize: 10 }} />}
                        onClick={(e) => handleRemoveHistory(e, item.value)}
                      />
                    </Flex>
                  ),
                }))}
                onSelect={(val) => restoreCredentials(val, sourceType)}
              >
                <Input
                  prefix={<HddOutlined />}
                  placeholder={isWeb() ? "/api" : "http://192.168.x.x"}
                  autoCapitalize="off"
                />
              </AutoComplete>
            </Form.Item>

            <Form.Item label={t("login.externalAddress")} name="externalAddress">
              <AutoComplete
                options={serverHistory.map((item) => ({
                  value: item.value,
                  label: (
                    <Flex justify="space-between" align="center">
                      <Text>{item.value}</Text>
                      <Button
                        type="text"
                        size="small"
                        icon={<CloseOutlined style={{ fontSize: 10 }} />}
                        onClick={(e) => handleRemoveHistory(e, item.value)}
                      />
                    </Flex>
                  ),
                }))}
                onSelect={(val) => restoreCredentials(val, sourceType)}
              >
                <Input prefix={<HddOutlined />} placeholder="http://example.com..." autoCapitalize="off" />
              </AutoComplete>
            </Form.Item>

            <Form.Item name="username" rules={[{ required: true }]}>
              <Input prefix={<UserOutlined />} placeholder={t("login.username")} />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true }]}>
              <Input.Password prefix={<LockOutlined />} placeholder={t("login.password")} />
            </Form.Item>

            {!isLogin && (
              <Form.Item
                name="confirmPassword"
                rules={[
                  { required: true, message: t("login.confirmPasswordRequired") },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("password") === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error(t("login.passwordMismatch")));
                    },
                  }),
                ]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder={t("login.confirmPassword")} />
              </Form.Item>
            )}

            {isLogin ? (
              <>
                <Form.Item>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <Checkbox
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                    >
                      {t("login.rememberMe")}
                    </Checkbox>
                    {sourceType === "AudioDock" && (
                      <Button
                        type="link"
                        size="small"
                        onClick={() => navigate("/forgot-password")}
                        style={{ padding: 0 }}
                      >
                        {t("login.forgotPassword")}
                      </Button>
                    )}
                  </div>
                </Form.Item>
                <Button htmlType="submit" block loading={loading}>
                  {t("login.login")}
                </Button>
              </>
            ) : (
              <Button htmlType="submit" type="primary" block loading={loading}>
                {t("login.register")}
              </Button>
            )}

            <Button
              type="link"
              block
              onClick={() => setIsLogin((prev) => !prev)}
              style={{ marginTop: 12 }}
            >
              {isLogin ? t("login.noAccount") : t("login.hasAccount")}
            </Button>
          </Form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
