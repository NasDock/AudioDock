import { RightOutlined } from "@ant-design/icons";
import { SOURCEMAP, SOURCETIPSMAP } from "@soundx/services";
import { Card, Flex, theme, Typography } from "antd";
import React from "react";
import { useNavigate } from "react-router-dom";
import emby from "../../assets/emby.png";
import logo from "../../assets/logo.png";
import subsonic from "../../assets/subsonic.png";
import styles from "./index.module.less";

const { Title, Text } = Typography;

const SourceManage: React.FC = () => {
  const navigate = useNavigate();
  const { token: themeToken } = theme.useToken();

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

  const handleSelect = (key: string) => {
    navigate(`/login?type=${key}`, { state: { type: key } });
  };

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.header}>
          <img src={logo} className={styles.appLogo} alt="Logo" />
          <Title style={{ margin: 0 }} level={4}>
            选择数据源类型
          </Title>
          <Text type="secondary">请选择您要连接的服务器类型</Text>
        </div>

        <div className={styles.grid}>
          {Object.keys(SOURCEMAP).map((key) => {
            const isDisabled = false;
            return (
              <Card
                key={key}
                hoverable={!isDisabled}
                className={`${styles.card} ${isDisabled ? styles.disabled : ""}`}
                onClick={() => !isDisabled && handleSelect(key)}
                bodyStyle={{ padding: 16 }}
              >
                <Flex align="center" justify="space-between">
                  <Flex align="center" gap={16}>
                    <img
                      src={getLogo(key)}
                      className={styles.cardIcon}
                      alt={key}
                    />
                    <Flex vertical align="flex-start">
                      <Text strong style={{ fontSize: 16 }}>
                        {key}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {SOURCETIPSMAP[key as keyof typeof SOURCETIPSMAP]}
                      </Text>
                    </Flex>
                  </Flex>
                  <RightOutlined
                    style={{ color: themeToken.colorTextQuaternary }}
                  />
                </Flex>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default SourceManage;
