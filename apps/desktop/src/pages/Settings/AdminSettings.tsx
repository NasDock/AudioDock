
import { getRegistrationSetting, toggleRegistrationSetting } from "@soundx/services";
import { useTranslation } from "react-i18next";
import { Button, message, Space, Switch } from "antd";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const AdminSettings: React.FC = () => {
  const { t } = useTranslation();
    const navigate = useNavigate();
    const [registrationAllowed, setRegistrationAllowed] = useState(true);
    const [settingLoading, setSettingLoading] = useState(false);

    const fetchSettings = async () => {
        setSettingLoading(true);
        try {
            const res = await getRegistrationSetting();
            if (res.code === 200) {
                setRegistrationAllowed(res.data);
            }
        } catch (error) {
           // ignore
        } finally {
            setSettingLoading(false);
        }
    };

    useEffect(() => {
        fetchSettings();
    }, []);

    const toggleRegistration = async (val: boolean) => {
        const res = await toggleRegistrationSetting(val);
        if (res.code === 200) {
            setRegistrationAllowed(val);
            message.success(
              val
                ? t("settings.registrationEnabled")
                : t("settings.registrationDisabled"),
            );
        } else {
            message.error(res.message);
        }
    };

    return (
        <div>
           <Space style={{ marginBottom: 16 }}>
               <span>{t("settings.allowNewUserRegistration")}:</span>
               <Switch checked={registrationAllowed} onChange={toggleRegistration} loading={settingLoading} />
               <Button onClick={() => navigate("/admin/users")}>{t("adminUserManagement.title")}</Button>
               <Button onClick={() => navigate("/admin/access-tokens")}>{t("accessTokenManagement.title")}</Button>
           </Space>
        </div>
    );
};

export default AdminSettings;
