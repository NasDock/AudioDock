import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Form, Input, Layout, Typography, message, theme } from "antd";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./index.module.less";

import logo from "../../assets/logo.png";

const { Title, Text } = Typography;
const { Content } = Layout;

const MemberLogin: React.FC = () => {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  
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
      await form.validateFields(['phone']);
      
      message.loading("正在发送验证码...");
      setTimeout(() => {
        message.destroy();
        message.success("验证码已发送（模拟）");
        setCountdown(60);
      }, 1500);
    } catch (e) {
      // Validation failed
    }
  };

  const onFinish = (_values: any) => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      message.success("会员登录成功（模拟）");
      navigate(-1);
    }, 1500);
  };

  return (
    <Layout style={{ minHeight: "100vh", background: token.colorBgLayout }}>
      <Content className={styles.container}>
        <div className={styles.card} style={{ background: token.colorBgContainer }}>
          {/* Header */}
          <div className={styles.header}>
            <Button 
                type="text" 
                icon={<ArrowLeftOutlined />} 
                onClick={() => navigate(-1)} 
                className={styles.backBtn}
            />
          </div>

          <div className={styles.logoSection}>
            <img src={logo} alt="AudioDock" className={styles.logo} />
            <Title level={2} style={{ margin: "16px 0 8px" }}>成为会员</Title>
            <Text type="secondary">享受更多权益</Text>
          </div>

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
                <div style={{ display: 'flex', gap: 0 }}>
                    <Form.Item
                        name="code"
                        rules={[{ required: true, message: "请输入验证码" }]}
                        style={{ flex: 1 }}
                    >
                        <Input placeholder="验证码" style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none' }} />
                    </Form.Item>
                    <Button 
                        onClick={handleSendCode} 
                        disabled={countdown > 0}
                        style={{ width: 120, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
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
                <Button type="link" size="small" style={{ padding: '0 4px', fontSize: 12 }}>《用户协议》</Button>
                和 
                <Button type="link" size="small" style={{ padding: '0 4px', fontSize: 12 }} onClick={() => navigate('/member-benefits')}>《会员权益与服务协议》</Button>
            </Text>
          </div>
        </div>
      </Content>
    </Layout>
  );
};

export default MemberLogin;
