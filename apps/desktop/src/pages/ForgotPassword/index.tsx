import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { resetPassword, verifyDevice } from "@soundx/services";
import { Button, Form, Input, message, Steps, Typography } from "antd";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const { Title, Text } = Typography;

const ForgotPassword: React.FC = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [username, setUsername] = useState("");
  const [messageApi, contextHolder] = message.useMessage();

  const [deviceName, setDeviceName] = useState("");

  useEffect(() => {
    getDeviceName().then((res) => {
      console.log(res);
      setDeviceName(res);
    });
  }, []);

  // Constant device name matching Login logic
  const getDeviceName = async () => {
    return (await window.ipcRenderer?.getName()) || window.navigator.userAgent;
  };

  const handleVerify = async () => {
    try {
      const values = await form.validateFields(["username"]);
      setLoading(true);
      const user = values.username;
      setUsername(user);

      const res = await verifyDevice(user, deviceName);
      setLoading(false);
      if (res.code === 200) {
        messageApi.success("设备验证通过");
        setCurrentStep(1);
      } else {
        messageApi.error(res.message || "验证失败，请确保在常用设备上操作");
      }
    } catch (e) {
      setLoading(false);
      // Validation error
    }
  };

  const handleReset = async () => {
    try {
      const values = await form.validateFields(["password", "confirm"]);
      setLoading(true);

      const res = await resetPassword(username, deviceName, values.password);
      setLoading(false);

      if (res.code === 200) {
        messageApi.success("密码重置成功");
        // The response contains token and user data.
        // We should log the user in.
        // We can redirect to login or home.
        // The user request says: "submit success return token enter home page".
        // So I need to setToken and navigate home.
        // I need to import useAuthStore or setLogin globally?
        // The Login page imports useAuthStore.
        // I'll grab it here too.
        const { token, device, ...userData } = res.data;
        const activeAddress = localStorage.getItem("serverAddress") || ""; // We assume we are connected to the right server if we made the request
        const baseURL = activeAddress;
        if (baseURL) {
          const tokenKey = `token_${baseURL}`;
          const userKey = `user_${baseURL}`;
          const deviceKey = `device_${baseURL}`;
          localStorage.setItem(tokenKey, token);
          localStorage.setItem(userKey, JSON.stringify(userData));
          if (device) localStorage.setItem(deviceKey, JSON.stringify(device));
        }

        // Navigate home and reload to init auth store?
        // Or update store.
        // I'll assume just navigate to "/" and maybe reload.
        navigate("/");
        window.location.reload();
      } else {
        messageApi.error(res.message || "重置失败");
      }
    } catch (e) {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 400,
          padding: 40,
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        }}
      >
        {contextHolder}
        <div style={{ marginBottom: 24, textAlign: "center" }}>
          <Title level={4}>重置密码</Title>
          <Text type="secondary">当前设备: {deviceName}</Text>
        </div>

        <Steps current={currentStep} style={{ marginBottom: 24 }}>
          <Steps.Step title="验证设备" />
          <Steps.Step title="重置密码" />
        </Steps>

        <Form form={form} layout="vertical">
          {currentStep === 0 && (
            <>
              <Form.Item
                name="username"
                rules={[{ required: true, message: "请输入用户名" }]}
              >
                <Input
                  prefix={<UserOutlined />}
                  placeholder="请输入用户名"
                  size="large"
                />
              </Form.Item>
              <Button
                type="primary"
                block
                size="large"
                onClick={handleVerify}
                loading={loading}
              >
                下一步
              </Button>
            </>
          )}

          {currentStep === 1 && (
            <>
              <Form.Item
                name="password"
                rules={[{ required: true, message: "请输入新密码" }]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="新密码"
                  size="large"
                />
              </Form.Item>
              <Form.Item
                name="confirm"
                dependencies={["password"]}
                rules={[
                  { required: true, message: "请确认密码" },
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
                  placeholder="确认新密码"
                  size="large"
                />
              </Form.Item>
              <Button
                type="primary"
                block
                size="large"
                onClick={handleReset}
                loading={loading}
              >
                提交更改
              </Button>
            </>
          )}
        </Form>
        <Button
          type="link"
          onClick={() => navigate("/login")}
          style={{ marginTop: 16, padding: 0 }}
        >
          返回登录
        </Button>
      </div>
    </div>
  );
};

export default ForgotPassword;
