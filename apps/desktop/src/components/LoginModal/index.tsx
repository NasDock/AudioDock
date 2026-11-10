import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  HddOutlined,
  LoadingOutlined,
  LockOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  check,
  login,
  register,
  setServiceConfig,
  useEmbyAdapter,
  useFnosAdapter,
  useNativeAdapter,
  useSubsonicAdapter,
} from "@soundx/services";
import {
  AutoComplete,
  Button,
  Checkbox,
  Flex,
  Form,
  Input,
  Modal,
  Segmented,
  theme,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import emby from "../../assets/emby.png";
import logo from "../../assets/logo.png";
import { FNOS_LOGO, SOURCE_LABELS, SOURCEMAP, SOURCETIPSMAP } from "../../constants/sources";
import subsonic from "../../assets/subsonic.png";
import { useMessage } from "../../context/MessageContext";
import { useAuthStore } from "../../store/auth";
import { enforceSourcePlayMode } from "../../utils/playMode";
import styles from "./index.module.less";

const { Title, Text } = Typography;

const LoginModal: React.FC = () => {
  const { t } = useTranslation();
  const message = useMessage();
  const { token, login: setLogin } = useAuthStore();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [sourceType, setSourceType] = useState<string>(
    () => localStorage.getItem("selectedSourceType") || "AudioDock",
  );
  const [serverHistory, setServerHistory] = useState<{ value: string }[]>([]);
  const [rememberMe, setRememberMe] = useState(false);
  const [loginForm] = Form.useForm();
  const { token: themeToken } = theme.useToken();

  const [serverStatus, setServerStatus] = useState<
    "success" | "error" | "validating" | null
  >(null);

  const normalizeLoginUser = (payload: any) => {
    if (payload?.user?.id) return payload.user;
    const { token, device, ...rest } = payload || {};
    return rest;
  };

  const getSourceHistoryKey = (type: string) => `serverHistory_${type}`;
  const getSourceAddressKey = (type: string) => `serverAddress_${type}`;

  // Load saved history and credentials when sourceType changes or on mount
  useEffect(() => {
    const historyKey = getSourceHistoryKey(sourceType);
    const history = localStorage.getItem(historyKey);
    if (history) {
      setServerHistory(JSON.parse(history));
    } else {
      setServerHistory(
        sourceType === "AudioDock" ? [{ value: "http://localhost:3000" }] : [],
      );
    }

    const addressKey = getSourceAddressKey(sourceType);
    const savedAddress = localStorage.getItem(addressKey);
    if (savedAddress) {
      loginForm.setFieldsValue({ serverAddress: savedAddress });
      // checkServerConnectivity(savedAddress, sourceType);
      restoreCredentials(savedAddress, sourceType);
    } else {
      loginForm.setFieldsValue({
        serverAddress: "",
        username: "",
        password: "",
      });
      setServerStatus(null);
    }
  }, [sourceType, loginForm]);

  const restoreCredentials = (address: string, type: string) => {
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

  const saveToHistory = (address: string, type: string) => {
    if (!address) return;
    const historyKey = getSourceHistoryKey(type);
    const history = localStorage.getItem(historyKey);
    let list = history ? JSON.parse(history) : [];
    if (!list.find((i: any) => i.value === address)) {
      list.push({ value: address });
      localStorage.setItem(historyKey, JSON.stringify(list));
      setServerHistory(list);
    }
  };

  const checkServerConnectivity = async (
    address: string,
    type: string,
    username?: string,
    password?: string,
  ) => {
    if (!address) return;
    if (!address.startsWith("http://") && !address.startsWith("https://"))
      return;

    setServerStatus("validating");

    // Configure adapter temporarily for check
    configureAdapter(type, address, username, password);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

      // Use the generic check service call which now routes to the active adapter
      const response = await check();
      clearTimeout(timeoutId);

      if (response) {
        setServerStatus("success");
        message.success(t('loginModal.serverConnected', { type }));
        return;
      }
      // Special handling for Subsonic: if we get a response but code isn't 200, it might be auth error
      // which still means the server is reachable and is a Subsonic server.
      if (SOURCEMAP[type as keyof typeof SOURCEMAP] === "subsonic") {
        setServerStatus("success");
        return;
      }

      throw new Error("Invalid response");
    } catch (error) {
      console.error("Connectivity check failed:", error);
      setServerStatus("error");
      message.error(t('loginModal.serverConnectionFailed', { type }));
    }
  };

  const configureAdapter = (
    type: string,
    address: string,
    username?: string,
    password?: string,
  ) => {
    const mappedType = SOURCEMAP[type as keyof typeof SOURCEMAP] || "audiodock";

    // Set global base URL in request module (if available/exposed)
    // In desktop project, request instance is updated via setBaseURL equivalent
    localStorage.setItem("serverAddress", address); // This affects getBaseURL() in https/index.ts

    // Set credentials in global service config
    setServiceConfig({
      username,
      password,
      clientName: "SoundX Desktop",
    });

    if (mappedType === "subsonic") {
      useSubsonicAdapter();
    } else if (mappedType === "emby") {
      useEmbyAdapter();
    } else if (mappedType === "fnos") {
      useFnosAdapter({ baseUrl: address, username, password });
    } else {
      useNativeAdapter();
    }
  };

  const handleFinish = async (values: any) => {
    setLoading(true);
    const type = sourceType;
    const addressKey = getSourceAddressKey(type);

    localStorage.setItem(addressKey, values.serverAddress);
    localStorage.setItem("selectedSourceType", type);
    // 飞牛只有音乐，残留的有声书模式会让列表变空
    enforceSourcePlayMode(type);
    saveToHistory(values.serverAddress, type);

    const baseURL = values.serverAddress;
    const tokenKey = `token_${baseURL}`;
    const userKey = `user_${baseURL}`;
    const deviceKey = `device_${baseURL}`;
    const credsKey = `creds_${type}_${baseURL}`;

    // Final adapter configuration with full credentials
    configureAdapter(
      type,
      values.serverAddress,
      values.username,
      values.password,
    );

    try {
      checkServerConnectivity(
        values.serverAddress,
        type,
        values.username,
        values.password,
      );

      if (isLogin) {
        const res = await login({
          username: values.username,
          password: values.password,
        });
        if (res.data) {
          const { token: newToken, device } = res.data;
          const userData = normalizeLoginUser(res.data);

          localStorage.setItem(tokenKey, newToken);
          localStorage.setItem(userKey, JSON.stringify(userData));
          if (device) localStorage.setItem(deviceKey, JSON.stringify(device));

          if (rememberMe) {
            localStorage.setItem(
              credsKey,
              JSON.stringify({
                username: values.username,
                password: values.password,
              }),
            );
          } else {
            localStorage.removeItem(credsKey);
          }

          setLogin(newToken, userData as any, device);
          message.success(t('loginModal.loginSuccess'));
        }
      } else {
        const res = await register({
          username: values.username,
          password: values.password,
        });
        if (res.data) {
          const { token: newToken, device } = res.data;
          const userData = normalizeLoginUser(res.data);

          localStorage.setItem(tokenKey, newToken);
          localStorage.setItem(userKey, JSON.stringify(userData));
          if (device) localStorage.setItem(deviceKey, JSON.stringify(device));

          setLogin(newToken, userData as any, device);
          message.success(t('loginModal.registerSuccess'));
        }
      }
    } catch (error: any) {
      console.error(error);
      message.error(error.message || t('loginModal.loginFailed'));
    } finally {
      setLoading(false);
      // Reload is used here to ensure all services pickup the new state correctly
      window.location.reload();
    }
  };

  const renderSourceIcon = (key: string) => {
    if (key === "Emby") return <img style={{ width: 24 }} src={emby} />;
    if (key === "Subsonic") return <img style={{ width: 24 }} src={subsonic} />;
    if (key === "Feiniu") return <img style={{ width: 24 }} src={FNOS_LOGO} />;
    return <img style={{ width: 24 }} src={logo} />;
  };

  const sourceOptions = Object.keys(SOURCEMAP).map((key) => ({
    label: (
      <Flex gap={8} align="center">
        {renderSourceIcon(key)}
        <span>{SOURCE_LABELS[key] || key}</span>
      </Flex>
    ),
    value: key,
    disabled: key === "Emby",
  }));

  return (
    <Modal
      open={!token}
      footer={null}
      closable={false}
      maskClosable={false}
      mask={false}
      centered
      width={420}
      className={styles.loginModal}
    >
      <div className={styles.header}>
        <Title
          level={2}
          className={styles.title}
          style={{ color: themeToken.colorText }}
        >
          {isLogin ? "Login" : "Sign Up"}
        </Title>
        <Text
          className={styles.subtitle}
          style={{ color: themeToken.colorTextSecondary }}
        >
          {isLogin ? t('loginModal.welcomeBack') : t('loginModal.createAccountNew')}
        </Text>
      </div>

      <div style={{ marginBottom: 24 }}>
        <Segmented
          options={sourceOptions}
          value={sourceType}
          onChange={(val) => {
            setSourceType(val as string);
            localStorage.setItem("selectedSourceType", val as string);
            enforceSourcePlayMode(val as string);
          }}
        />
      </div>

      <div
        className={styles.switchText}
        style={{ color: themeToken.colorTextSecondary, textAlign: 'left', fontSize: 12 }}
      >
        {SOURCETIPSMAP[sourceType as keyof typeof SOURCETIPSMAP]}
      </div>

      <Form
        form={loginForm}
        layout="vertical"
        size="large"
        className={styles.form}
      >
        <Form.Item
          name="serverAddress"
          validateStatus={
            serverStatus === "error"
              ? "error"
              : serverStatus === "success"
                ? "success"
                : serverStatus === "validating"
                  ? "validating"
                  : ""
          }
          // hasFeedback
          rules={[
            { required: true, message: t('loginModal.enterServerAddress') },
            {
              validator: (_, value) => {
                if (!value) return Promise.resolve();
                if (
                  value.startsWith("http://") ||
                  value.startsWith("https://")
                ) {
                  return Promise.resolve();
                }
                return Promise.reject(
                  new Error(t('loginModal.addressMustStartWithHttp')),
                );
              },
            },
          ]}
        >
          <AutoComplete
            options={serverHistory}
            onSelect={(val) => {
              // checkServerConnectivity(val, sourceType);
              restoreCredentials(val, sourceType);
            }}
            onChange={(val) => {
              if (val.startsWith("http")) {
                restoreCredentials(val, sourceType);
              }
            }}
          >
            <Input
              prefix={<HddOutlined />}
              placeholder={t('loginModal.enterServerAddress')}
              autoCapitalize="off"
              // onBlur={(e) => checkServerConnectivity(e.target.value, sourceType)}
              suffix={
                serverStatus === "error" ? (
                  <CloseCircleOutlined />
                ) : serverStatus === "success" ? (
                  <CheckCircleOutlined />
                ) : serverStatus === "validating" ? (
                  <LoadingOutlined />
                ) : null
              }
            />
          </AutoComplete>
        </Form.Item>
        {isLogin ? (
          <>
            <Form.Item
              name="username"
              rules={[{ required: true, message: t('loginModal.enterUsername') }]}
            >
              <Input prefix={<UserOutlined />} placeholder={t('loginModal.enterUsername')} />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[{ required: true, message: t('loginModal.enterPassword') }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder={t('loginModal.enterPassword')}
              />
            </Form.Item>
            <Form.Item style={{ marginBottom: 16 }}>
              <Checkbox
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ color: themeToken.colorTextSecondary }}
              >
                {t('loginModal.rememberMe')}
              </Checkbox>
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary"
                onClick={async () => {
                  const values = await loginForm.validateFields();
                  handleFinish(values);
                }}
                block
                loading={loading}
                className={styles.submitButton}
              >
                {t('loginModal.login')}
              </Button>
            </Form.Item>
          </>
        ) : (
          <>
            <Form.Item
              name="username"
              rules={[{ required: true, message: t('loginModal.enterUsername') }]}
            >
              <Input prefix={<UserOutlined />} placeholder={t('loginModal.username')} />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[{ required: true, message: t('loginModal.enterPassword') }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder={t('loginModal.password')}
              />
            </Form.Item>
            <Form.Item
              name="confirm"
              dependencies={["password"]}
              rules={[
                { required: true, message: t('loginModal.confirmPassword') },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue("password") === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error(t('loginModal.passwordMismatch')));
                  },
                }),
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder={t('loginModal.confirmPassword')}
              />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary"
                onClick={async () => {
                  const values = await loginForm.validateFields();
                  handleFinish(values);
                }}
                block
                loading={loading}
                className={styles.submitButton}
              >
                {t('loginModal.registerAndLogin')}
              </Button>
            </Form.Item>
          </>
        )}
      </Form>

      {sourceType === "AudioDock" ? (
        <div
          className={styles.switchText}
          style={{ color: themeToken.colorTextSecondary }}
        >
          {isLogin ? (
            <>
              {t('loginModal.noAccount')}
              <span
                className={styles.switchLink}
                onClick={() => setIsLogin(false)}
                style={{ color: themeToken.colorPrimary }}
              >
                {t('loginModal.register')}
              </span>
            </>
          ) : (
            <>
              {t('loginModal.hasAccount')}
              <span
                className={styles.switchLink}
                onClick={() => setIsLogin(true)}
                style={{ color: themeToken.colorPrimary }}
              >
                {t('loginModal.login')}
              </span>
            </>
          )}
        </div>
      ) : (
        <div
          className={styles.switchText}
          style={{ color: themeToken.colorTextSecondary }}
        >
          {t('loginModal.audioDockTagline')}
        </div>
      )}

      <div
        className={styles.footer}
        style={{ color: themeToken.colorTextTertiary }}
      >
        Created by AudioDock
      </div>
    </Modal>
  );
};

export default LoginModal;
