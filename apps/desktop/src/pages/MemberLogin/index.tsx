import { plusLogin, plusSendCode } from "@soundx/services";
import { Button, Form, Input, Layout, Typography, message, theme } from "antd";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../../assets/logo.png";
import { useAuthStore } from "../../store/auth";
import styles from "./index.module.less";

const { Title, Text } = Typography;
const { Content } = Layout;

const MemberLogin: React.FC = () => {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const { setPlusToken } = useAuthStore();
  const [messageApi, contextHolder] = message.useMessage();

  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);

  // Countdown timer logic
  useEffect(() => {
    let timer: any;
    if (countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [countdown]);

  const handleSendCode = async () => {
    try {
      const values = await form.validateFields(["phone"]);

      const hide = messageApi.loading("正在发送验证码...");
      const res = await plusSendCode({ phone: values.phone });
      hide();

      if (res.data.code === 201 || res.data.code === 200) {
        messageApi.success("验证码已发送");
        setCountdown(60);
      } else {
        messageApi.error(res.data.message || "获取验证码失败");
      }
    } catch (e: any) {
      if (e.response?.data?.message) {
        messageApi.error(e.response.data.message);
      }
    }
  };

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const res = await plusLogin({ phone: values.phone, code: values.code });
      setLoading(false);

      if (res.data.code === 201 || res.data.code === 200) {
        const { token: plusToken, userId } = res.data.data;
        // 保存 Plus Token 用于后续 Plus 接口
        localStorage.setItem("plus_token", plusToken);
        localStorage.setItem("plus_user_id", JSON.stringify(userId));
        setPlusToken(plusToken);

        messageApi.success("会员登录成功");
        setTimeout(() => {
          navigate("/", { replace: true });
        }, 500);
      } else {
        messageApi.error(res.data.message || "登录失败");
      }
    } catch (e: any) {
      setLoading(false);
      messageApi.error(e.response?.data?.message || "登录失败，请检查验证码");
    }
  };

  return (
    <Layout style={{ minHeight: "100vh", background: token.colorBgLayout }}>
      <Content className={styles.container}>
        <div
          className={styles.card}
          style={{ background: token.colorBgContainer }}
        >
          <div className={styles.logoSection}>
            <img src={logo} alt="AudioDock" className={styles.logo} />
            <Title level={2} style={{ margin: "16px 0 8px" }}>
              用户登录
            </Title>
            <Text type="secondary">AudioDock 听见你的声音</Text>
          </div>
          {contextHolder}
          <Form
            form={form}
            name="member_login"
            onFinish={onFinish}
            layout="vertical"
            size="large"
            className={styles.form}
          >
            <Form.Item
              name="phone"
              label="手机号"
              style={{ marginBottom: 10 }}
              rules={[
                { required: true, message: "请输入手机号" },
                { pattern: /^1[3-9]\d{9}$/, message: "请输入有效的手机号" },
              ]}
            >
              <Input placeholder="请输入手机号" />
            </Form.Item>

            <Form.Item label="验证码" style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 0 }}>
                <Form.Item
                  name="code"
                  rules={[{ required: true, message: "请输入验证码" }]}
                  style={{ flex: 1 }}
                >
                  <Input
                    placeholder="验证码"
                    style={{
                      borderTopRightRadius: 0,
                      borderBottomRightRadius: 0,
                      borderRight: "none",
                    }}
                  />
                </Form.Item>
                <Button
                  onClick={handleSendCode}
                  type="primary"
                  disabled={countdown > 0}
                  style={{
                    width: 120,
                    fontSize: 12,
                    borderTopLeftRadius: 0,
                    borderBottomLeftRadius: 0,
                  }}
                >
                  {countdown > 0 ? `${countdown}s` : "获取验证码"}
                </Button>
              </div>
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit" block loading={loading}>
                登录
              </Button>
            </Form.Item>
          </Form>

          <div className={styles.footer}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              登录即代表同意
              <Button
                type="link"
                size="small"
                style={{ padding: "0 4px", fontSize: 12 }}
              >
                《用户协议》
              </Button>
            </Text>
          </div>
        </div>
      </Content>
    </Layout>
  );
};

export default MemberLogin;
