import {
  HddOutlined,
  LeftOutlined,
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
  useNativeAdapter,
  useSubsonicAdapter,
} from "@soundx/services";
import {
  AutoComplete,
  Button,
  Checkbox,
  Form,
  Input,
  message,
  Typography,
} from "antd";
import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import emby from "../../assets/emby.png";
import logo from "../../assets/logo.png";
import subsonic from "../../assets/subsonic.png";
import { useAuthStore } from "../../store/auth";
import { isWeb } from "../../utils/platform";
import styles from "./index.module.less";

const { Title, Text } = Typography;

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const location = useLocation();
  const { login: setLogin } = useAuthStore();

  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);

  const queryParams = new URLSearchParams(location.search);
  const paramSourceType = queryParams.get("type");
  const stateSourceType = location.state?.type;

  const [sourceType] = useState<string>(
    paramSourceType ||
      stateSourceType ||
      localStorage.getItem("selectedSourceType") ||
      "AudioDock",
  );

  const [serverHistory, setServerHistory] = useState<{ value: string }[]>([]);
  const [rememberMe, setRememberMe] = useState(false);
  const [loginForm] = Form.useForm();

  const getSourceHistoryKey = (type: string) => `serverHistory_${type}`;
  const getSourceAddressKey = (type: string) => `serverAddress_${type}`; // Active address (int or ext)

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

  useEffect(() => {
    if (!sourceType) {
      navigate("/source-manage");
      return;
    }

    const loadInitialValues = () => {
      // Load history
      const historyKey = getSourceHistoryKey(sourceType);
      const history = localStorage.getItem(historyKey);
      setServerHistory(history ? JSON.parse(history) : []);

      // Load credentials and config
      // Try to find the last used config logic
      const savedActiveAddress = localStorage.getItem(
        getSourceAddressKey(sourceType),
      );
      const configKey = `sourceConfig_${sourceType}`;
      const savedConfigStr = localStorage.getItem(configKey);
      let configs = [];
      try {
        if (savedConfigStr) configs = JSON.parse(savedConfigStr);
        if (!Array.isArray(configs)) configs = [];
      } catch (e) {
        configs = [];
      }

      // Find config matching last active address
      let matchedConfig = null;
      if (savedActiveAddress) {
        matchedConfig = configs.find(
          (c: any) =>
            c.internal === savedActiveAddress ||
            c.external === savedActiveAddress,
        );
      }

      // If no match by address, maybe use the last one? Or just blank.
      // If matched, prefill
      if (matchedConfig) {
        loginForm.setFieldsValue({
          internalAddress: matchedConfig.internal || "",
          externalAddress: matchedConfig.external || "",
        });
        // Also restore credentials for the ACTIVE address
        restoreCredentials(savedActiveAddress || "", sourceType);
      } else if (savedActiveAddress) {
        // Fallback: put saved address in internal if local, else external?
        // Or just put it in internal for simplicity as fallback
        const isLocal =
          savedActiveAddress.includes("192.") ||
          savedActiveAddress.includes("127.") ||
          savedActiveAddress.includes("localhost") ||
          savedActiveAddress.includes(".local");
        if (isLocal)
          loginForm.setFieldsValue({ internalAddress: savedActiveAddress });
        else loginForm.setFieldsValue({ externalAddress: savedActiveAddress });

        restoreCredentials(savedActiveAddress, sourceType);
      }
    };

    loadInitialValues();
  }, [sourceType, loginForm, navigate]);

  const restoreCredentials = (address: string, type: string) => {
    if (!address) return;
    const credsKey = `creds_${type}_${address}`;
    const savedCreds = localStorage.getItem(credsKey);
    if (savedCreds) {
      const { username, password } = JSON.parse(savedCreds);
      loginForm.setFieldsValue({ username, password });
      setRememberMe(true);
    } else {
      // Don't clear if user might have typed something?
      // Actually restore implies overwriting.
      // But maybe we only restore if fields are empty?
      // For now, simple restore.
      loginForm.setFieldsValue({ username: "", password: "" });
      setRememberMe(false);
    }
  };

  const saveConfig = (internal: string, external: string, type: string) => {
    const configKey = `sourceConfig_${type}`;
    const existingStr = localStorage.getItem(configKey);
    let existingConfigs: Array<{
      id: string;
      internal: string;
      external: string;
      name: string;
    }> = [];
    try {
      if (existingStr) {
        const parsed = JSON.parse(existingStr);
        if (Array.isArray(parsed)) existingConfigs = parsed;
      }
    } catch (e) {
      existingConfigs = [];
    }

    // Check if updating existing
    const existingIndex = existingConfigs.findIndex(
      (c) =>
        (internal && c.internal === internal) ||
        (external && c.external === external),
    );

    if (existingIndex !== -1) {
      // Update
      existingConfigs[existingIndex] = {
        ...existingConfigs[existingIndex],
        internal: internal || existingConfigs[existingIndex].internal,
        external: external || existingConfigs[existingIndex].external,
      };
    } else {
      // Add new
      existingConfigs.push({
        id: Date.now().toString(),
        internal: internal || "",
        external: external || "",
        name: `服务器 ${existingConfigs.length + 1}`,
      });
    }
    localStorage.setItem(configKey, JSON.stringify(existingConfigs));

    // Save history for both
    const historyKey = getSourceHistoryKey(type);
    const history = localStorage.getItem(historyKey);
    let list = history ? JSON.parse(history) : [];

    [internal, external].forEach((addr) => {
      if (addr && !list.find((i: any) => i.value === addr)) {
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
    if (mappedType === "subsonic") useSubsonicAdapter();
    else useNativeAdapter();
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
      // Web 端允许相对路径 (如 /api)
      if (!addr.startsWith("http") && !(isWeb() && addr.startsWith("/")))
        return false;

      configureAdapter(type, addr, username, password);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout
        const response = await check();
        clearTimeout(timeoutId);

        if (response) return true;
        // Special Subsonic handling
        if (SOURCEMAP[type as keyof typeof SOURCEMAP] === "subsonic")
          return true;
        return false;
      } catch {
        return false;
      }
    };

    // Try Internal First
    if (internal && (await tryAddress(internal))) {
      configureAdapter(type, internal, username, password); // Ensure it's set back to active
      return internal;
    }
    // Try External
    if (external && (await tryAddress(external))) {
      configureAdapter(type, external, username, password);
      return external;
    }

    throw new Error("无法连接到服务器，请检查地址");
  };

  const handleFinish = async (values: any) => {
    setLoading(true);
    const type = sourceType;
    let { internalAddress, externalAddress } = values;
    const { username, password } = values;

    // Web 端 AudioDock 默认地址处理
    const isWeb_ = isWeb();
    if (
      isWeb_ &&
      type === "AudioDock" &&
      !internalAddress &&
      !externalAddress
    ) {
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

      console.log(activeAddress);

      // Save Configurations
      localStorage.setItem(`serverAddress_${type}`, activeAddress); // Active
      localStorage.setItem("selectedSourceType", type);
      saveConfig(internalAddress, externalAddress, type);

      const baseURL = activeAddress;
      const tokenKey = `token_${baseURL}`;
      const userKey = `user_${baseURL}`;
      const deviceKey = `device_${baseURL}`;
      // Also save creds for the other address key if exists?
      // Logic: Creds are bound to the specific URL in current architecture.
      // If we switch to internal later, we need creds for internal URL.
      // So we should save creds for BOTH URLs if provided.

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
          const { token: newToken, device, ...userData } = res.data;
          localStorage.setItem(tokenKey, newToken);
          localStorage.setItem(userKey, JSON.stringify(userData));
          if (device) localStorage.setItem(deviceKey, JSON.stringify(device));

          setLogin(newToken, userData as any, device);
          messageApi.success("登录成功");
          // Navigate to home
          navigate("/");
          window.location.reload(); // Reload to ensure full app init state
        }
      } else {
        const res = await register({ username, password });
        if (res.data) {
          const { token: newToken, device, ...userData } = res.data;
          localStorage.setItem(tokenKey, newToken);
          localStorage.setItem(userKey, JSON.stringify(userData));
          if (device) localStorage.setItem(deviceKey, JSON.stringify(device));
          setLogin(newToken, userData as any, device);
          messageApi.success("注册成功");
          navigate("/");
          window.location.reload();
        }
      }
    } catch (error: any) {
      console.error(error);
      messageApi.error(error.message || "操作失败");
    } finally {
      setLoading(false);
    }
  };

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
          className={styles.header}
          style={{ marginBottom: isWeb() ? 20 : 0 }}
        >
          <img
            src={getLogo(sourceType)}
            alt={sourceType}
            className={styles.logo}
          />
          <Title style={{ margin: 0 }} level={4}>
            {isLogin ? "登录" : "注册"}
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
              options={serverHistory}
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
              options={serverHistory}
              onSelect={(val) => restoreCredentials(val, sourceType)}
            >
              <Input
                prefix={<HddOutlined />}
                placeholder="http://example.com..."
              />
            </AutoComplete>
          </Form.Item>
          {isLogin ? (
            <>
              <Form.Item name="username" rules={[{ required: true }]}>
                <Input prefix={<UserOutlined />} placeholder="用户名" />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="密码" />
              </Form.Item>
              <Form.Item>
                <div
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
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
            <>
              <Form.Item name="username" rules={[{ required: true }]}>
                <Input prefix={<UserOutlined />} placeholder="用户名" />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="密码" />
              </Form.Item>
              <Form.Item
                name="confirm"
                dependencies={["password"]}
                rules={[
                  { required: true },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("password") === value)
                        return Promise.resolve();
                      return Promise.reject(new Error("密码不一致"));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="确认密码"
                />
              </Form.Item>
              <Button htmlType="submit" block loading={loading}>
                注册并登录
              </Button>
            </>
          )}
        </Form>

        <div className={styles.footerLink}>
          {sourceType === "AudioDock" && (
            <Button type="link" onClick={() => setIsLogin(!isLogin)}>
              {isLogin ? "没有账号？去注册" : "已有账号？去登录"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
