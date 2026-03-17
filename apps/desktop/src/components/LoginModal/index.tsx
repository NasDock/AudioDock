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
  SOURCEMAP,
  SOURCETIPSMAP,
  useEmbyAdapter,
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
import emby from "../../assets/emby.png";
import logo from "../../assets/logo.png";
import subsonic from "../../assets/subsonic.png";
import { useMessage } from "../../context/MessageContext";
import { useAuthStore } from "../../store/auth";
import styles from "./index.module.less";

const { Title, Text } = Typography;

const LoginModal: React.FC = () => {
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
        message.success(`${type} 服务已连接`);
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
      message.error(`${type} 服务连接失败，请检查地址是否正确`);
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
          message.success("登录成功");
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
          message.success("注册成功");
        }
      }
    } catch (error: any) {
      console.error(error);
      message.error(error.message || "登录失败");
    } finally {
      setLoading(false);
      // Reload is used here to ensure all services pickup the new state correctly
      window.location.reload();
    }
  };

  const sourceOptions = Object.keys(SOURCEMAP).map((key) => ({
    label: (
      <Flex gap={8} align="center">
        {key === "Emby" ? (
          <img style={{ width: 24 }} src={emby} />
        ) : key === "Subsonic" ? (
          <img style={{ width: 24 }} src={subsonic} />
        ) : (
          <img style={{ width: 24 }} src={logo} />
        )}
        <span>{key}</span>
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
          {isLogin ? "欢迎回来" : "创建一个新账户开始"}
        </Text>
      </div>

      <div style={{ marginBottom: 24 }}>
        <Segmented
          options={sourceOptions}
          value={sourceType}
          onChange={(val) => {
            setSourceType(val as string);
            localStorage.setItem("selectedSourceType", val as string);
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
            { required: true, message: "请输入服务端地址" },
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
                  new Error("服务端地址必须以 http:// 或 https:// 开头"),
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
              placeholder="请输入服务端地址"
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
              rules={[{ required: true, message: "请输入用户名!" }]}
            >
              <Input prefix={<UserOutlined />} placeholder="请输入用户名" />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[{ required: true, message: "请输入密码!" }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="请输入密码"
              />
            </Form.Item>
            <Form.Item style={{ marginBottom: 16 }}>
              <Checkbox
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ color: themeToken.colorTextSecondary }}
              >
                记住我
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
                登录
              </Button>
            </Form.Item>
          </>
        ) : (
          <>
            <Form.Item
              name="username"
              rules={[{ required: true, message: "请输入用户名!" }]}
            >
              <Input prefix={<UserOutlined />} placeholder="User Name" />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[{ required: true, message: "请输入密码!" }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="Password"
              />
            </Form.Item>
            <Form.Item
              name="confirm"
              dependencies={["password"]}
              rules={[
                { required: true, message: "请确认密码!" },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue("password") === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error("两次输入的密码不一致!"));
                  },
                }),
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="Confirm Password"
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
                注册并登录
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
              没有账号？
              <span
                className={styles.switchLink}
                onClick={() => setIsLogin(false)}
                style={{ color: themeToken.colorPrimary }}
              >
                注册
              </span>
            </>
          ) : (
            <>
              已有账号？
              <span
                className={styles.switchLink}
                onClick={() => setIsLogin(true)}
                style={{ color: themeToken.colorPrimary }}
              >
                登陆
              </span>
            </>
          )}
        </div>
      ) : (
        <div
          className={styles.switchText}
          style={{ color: themeToken.colorTextSecondary }}
        >
          AudioDock 听见你的声音
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
