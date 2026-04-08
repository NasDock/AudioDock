import {
  CloseOutlined,
  HddOutlined,
  LeftOutlined,
  LockOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  useEmbyAdapter as activateEmbyAdapter,
  useNativeAdapter as activateNativeAdapter,
  useSubsonicAdapter as activateSubsonicAdapter,
  check,
  claimScanLoginSession,
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
import { isWeb } from "../../utils/platform";
import { applyDesktopScanLoginResult, collectDesktopScanLoginPayload } from "../../utils/scanLogin";
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
  const { mode } = useTheme();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const location = useLocation();
  const { login: setLogin } = useAuthStore();

  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [scanSession, setScanSession] = useState<ScanLoginSession | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanLoginSessionStatus | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
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
      messageApi.error("创建扫码会话失败");
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
        setScanBusy(true);
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
        messageApi.success("扫码登录成功");
        navigate("/");
      } catch (error) {
        console.error(error);
        messageApi.error(error instanceof Error ? error.message : "扫码登录失败");
        createTargetSession();
      } finally {
        setScanBusy(false);
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
        name: `服务器 ${existingConfigs.length + 1}`,
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

    throw new Error("无法连接到服务器，请检查地址");
  };

  const handleFinish = async (values: LoginFormValues) => {
    setLoading(true);
    const type = sourceType;
    let internalAddress = values.internalAddress || "";
    const externalAddress = values.externalAddress || "";
    const username = values.username || "";
    const password = values.password || "";

    if (isWeb() && type === "AudioDock" && !internalAddress && !externalAddress) {
      internalAddress = "/api";
    }

    if (!internalAddress && !externalAddress) {
      messageApi.error("请至少输入一个地址");
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
        const res = await login({ username, password });
        if (res.data) {
          const { token: newToken, device } = res.data;
          const userData = normalizeLoginUser(res.data);
          localStorage.setItem(tokenKey, newToken);
          localStorage.setItem(userKey, JSON.stringify(userData));
          if (device) localStorage.setItem(deviceKey, JSON.stringify(device));
          setLogin(newToken, userData as never, device);
          messageApi.success("登录成功");
          navigate("/");
        }
      } else {
        const res = await register({ username, password });
        if (res.data) {
          const { token: newToken, device } = res.data;
          const userData = normalizeLoginUser(res.data);
          localStorage.setItem(tokenKey, newToken);
          localStorage.setItem(userKey, JSON.stringify(userData));
          if (device) localStorage.setItem(deviceKey, JSON.stringify(device));
          setLogin(newToken, userData as never, device);
          messageApi.success("注册成功");
          navigate("/");
        }
      }
    } catch (error) {
      console.error(error);
      messageApi.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setLoading(false);
    }
  };

  const handleDesktopScan = async () => {
    try {
      setScanBusy(true);
      const payload = await collectDesktopScanLoginPayload();
      if (!payload.nativeAuth && !payload.plusAuth) {
        messageApi.error("当前设备还没有可供迁移的登录态，请先在本机登录");
        return;
      }

      const sessionId = window.prompt("请输入被扫码设备上的会话二维码内容");
      if (!sessionId) return;

      const parsed = JSON.parse(sessionId);
      if (parsed?.kind !== "soundx-scan-login") {
        throw new Error("不是有效的扫码登录二维码");
      }

      await claimScanLoginSession(parsed.sessionId, {
        secret: parsed.secret,
        payload,
      });
      messageApi.success("扫码成功，请在被扫码设备确认导入");
    } catch (error) {
      console.error(error);
      messageApi.error(error instanceof Error ? error.message : "扫码登录失败");
    } finally {
      setScanBusy(false);
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
        返回选择
      </Button>
      {contextHolder}

      <div className={styles.content}>
        <div 
          className={styles.scanPanel}
          style={mode === 'dark' ? { background: 'transparent', border: 'none', boxShadow: 'none' } : {}}
        >
          {scanStatus?.status === "waiting_confirm" ? (
            <div className={styles.confirmPanel} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
              <Title level={5} style={{ marginBottom: 16 }}>
                等待手机端确认
              </Title>
              <Text type="secondary" style={{ textAlign: "center" }}>
                手机已扫码。请在手机屏幕上勾选要导入的数据源，并在手机上点击确认发送...
              </Text>
            </div>
          ) : (
            <div className={styles.qrPanel}>
              {qrValue ? <QRCode value={qrValue} size={180} bordered={false} /> : null}
              <Button onClick={createTargetSession}>刷新二维码</Button>
            </div>
          )}
        </div>

        <div 
          className={styles.formPanel}
          style={mode === 'dark' ? { background: 'transparent', border: 'none', boxShadow: 'none' } : {}}
        >
          <div className={styles.header} style={{ marginBottom: isWeb() ? 20 : 0 }}>
            <img src={getLogo(sourceType)} alt={sourceType} className={styles.logo} />
            <Title style={{ margin: 0 }} level={4}>
              {sourceType} {isLogin ? "登录" : "注册"}
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
            <Form.Item label="内网地址" name="internalAddress">
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
                />
              </AutoComplete>
            </Form.Item>

            <Form.Item label="外网地址" name="externalAddress">
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
                <Input prefix={<HddOutlined />} placeholder="http://example.com..." />
              </AutoComplete>
            </Form.Item>

            <Form.Item name="username" rules={[{ required: true }]}>
              <Input prefix={<UserOutlined />} placeholder="用户名" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="密码" />
            </Form.Item>

            {!isLogin && (
              <Form.Item
                name="confirmPassword"
                rules={[
                  { required: true, message: "请确认密码" },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("password") === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error("两次输入的密码不一致"));
                    },
                  }),
                ]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder="确认密码" />
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
                      记住我
                    </Checkbox>
                    {sourceType === "AudioDock" && (
                      <Button
                        type="link"
                        size="small"
                        onClick={() => navigate("/forgot-password")}
                        style={{ padding: 0 }}
                      >
                        忘记密码?
                      </Button>
                    )}
                  </div>
                </Form.Item>
                <Button htmlType="submit" block loading={loading}>
                  登录
                </Button>
              </>
            ) : (
              <Button htmlType="submit" type="primary" block loading={loading}>
                注册
              </Button>
            )}

            <Button
              type="link"
              block
              onClick={() => setIsLogin((prev) => !prev)}
              style={{ marginTop: 12 }}
            >
              {isLogin ? "没有账号？去注册" : "已有账号？去登录"}
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
};

export default Login;
