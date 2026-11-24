import { LockOutlined, UserOutlined } from "@ant-design/icons";
import {
  resetPassword,
  verifyDevice,
  TrackingEvent as TE,
  TrackingFeature as TF,
} from "@soundx/services";
import { Button, Form, Input, message, Steps, Typography } from "antd";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { trackEvent } from "../../services/tracking";
import { tauriGetDeviceName } from "../../utils/platform";

import styles from "./index.module.less";

const { Title, Text } = Typography;

const ForgotPassword: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [username, setUsername] = useState("");
  const [messageApi, contextHolder] = message.useMessage();

  const [deviceName, setDeviceName] = useState("");
  const openReportedRef = useRef(false);

  useEffect(() => {
    if (!openReportedRef.current) {
      openReportedRef.current = true;
      trackEvent({
        feature: TF.LOGIN,
        eventName: TE.LOGIN_FORGOT_PASSWORD_OPEN,
      });
    }
    getDeviceName().then((res) => {
      console.log(res);
      setDeviceName(res);
    });
  }, []);

  // Constant device name matching Login logic
  const getDeviceName = async () => {
    return await tauriGetDeviceName();
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
        messageApi.success(t('forgotPassword.deviceVerified'));
        setCurrentStep(1);
      } else {
        messageApi.error(res.message || t('forgotPassword.verifyFailed'));
      }
    } catch (e: any) {
      setLoading(false);
      // Form validation errors have type 'object' but no .message; skip those
      if (e?.message && !e?.errorFields) {
        messageApi.error(e.message || t('forgotPassword.verifyFailed'));
      }
    }
  };

  const handleReset = async () => {
    try {
      const values = await form.validateFields(["password", "confirm"]);
      setLoading(true);

      const res = await resetPassword(username, deviceName, values.password);
      setLoading(false);

      if (res.code === 200) {
        messageApi.success(t('forgotPassword.passwordResetSuccess'));
        const { token, device, ...userData } = res.data;
        const activeAddress = localStorage.getItem("serverAddress") || "";
        const baseURL = activeAddress;
        if (baseURL) {
          const tokenKey = `token_${baseURL}`;
          const userKey = `user_${baseURL}`;
          const deviceKey = `device_${baseURL}`;
          localStorage.setItem(tokenKey, token);
          localStorage.setItem(userKey, JSON.stringify(userData));
          if (device) localStorage.setItem(deviceKey, JSON.stringify(device));
        }

        navigate("/");
        window.location.reload();
      } else {
        messageApi.error(res.message || t('forgotPassword.resetFailed'));
      }
    } catch (e: any) {
      setLoading(false);
      if (e?.message && !e?.errorFields) {
        messageApi.error(e.message || t('forgotPassword.resetFailed'));
      }
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        {contextHolder}
        <div style={{ marginBottom: 24, textAlign: "center" }}>
          <Title level={4}>{t('forgotPassword.title')}</Title>
          <Text type="secondary">{t('forgotPassword.currentDevice')}: {deviceName}</Text>
        </div>

        <Steps current={currentStep} style={{ marginBottom: 24 }}>
          <Steps.Step title={t('forgotPassword.stepVerifyDevice')} />
          <Steps.Step title={t('forgotPassword.stepResetPassword')} />
        </Steps>

        <Form form={form} layout="vertical">
          {currentStep === 0 && (
            <>
              <Form.Item
                name="username"
                rules={[{ required: true, message: t('forgotPassword.enterUsername') }]}
              >
                <Input
                  prefix={<UserOutlined />}
                  placeholder={t('forgotPassword.usernamePlaceholder')}
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
                {t('forgotPassword.nextStep')}
              </Button>
            </>
          )}

          {currentStep === 1 && (
            <>
              <Form.Item
                name="password"
                rules={[{ required: true, message: t('forgotPassword.enterNewPassword') }]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder={t('forgotPassword.newPasswordPlaceholder')}
                  size="large"
                />
              </Form.Item>
              <Form.Item
                name="confirm"
                dependencies={["password"]}
                rules={[
                  { required: true, message: t('forgotPassword.confirmPasswordRequired') },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("password") === value)
                        return Promise.resolve();
                      return Promise.reject(new Error(t('forgotPassword.passwordMismatch')));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder={t('forgotPassword.confirmPasswordPlaceholder')}
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
                {t('forgotPassword.submit')}
              </Button>
            </>
          )}
        </Form>
        <Button
          type="link"
          onClick={() => navigate("/login")}
          style={{ marginTop: 16, padding: 0 }}
        >
          {t('forgotPassword.backToLogin')}
        </Button>
      </div>
    </div>
  );
};

export default ForgotPassword;
