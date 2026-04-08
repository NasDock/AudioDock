import {
  ArrowLeftOutlined,
  CheckOutlined,
  CloseOutlined,
  CrownFilled,
  LogoutOutlined,
} from "@ant-design/icons";
import { plusGetMe } from "@soundx/services";
import { Button, Card, Flex, Skeleton, Table, Typography, theme } from "antd";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMessage } from "../../context/MessageContext";
import { useAuthStore } from "../../store/auth";
import styles from "./index.module.less";

const { Title, Text } = Typography;

const MemberDetail: React.FC = () => {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const message = useMessage();
  const plusToken = useAuthStore((state) => state.plusToken);
  const setPlusToken = useAuthStore((state) => state.setPlusToken);
  const [loading, setLoading] = useState(true);
  const [vipData, setVipData] = useState<any>(null);

  useEffect(() => {
    const fetchVipStatus = async () => {
      try {
        const plusUserId = localStorage.getItem("plus_user_id");
        const storedPlusToken = localStorage.getItem("plus_token");
        if (!plusUserId || !storedPlusToken) {
          setLoading(false);
          return;
        }

        let id: any = plusUserId;
        try {
          id = JSON.parse(plusUserId);
        } catch {}

        const res = await plusGetMe(id);
        if (res.data.code === 200 && res.data.data) {
          setVipData(res.data.data);
          localStorage.setItem("plus_vip_data", JSON.stringify(res.data.data));
          localStorage.setItem(
            "plus_vip_status",
            String(!!(res.data.data.vipTier && res.data.data.vipTier !== "NONE"))
          );
          localStorage.setItem("plus_vip_updated_at", Date.now().toString());
        }
      } catch (error) {
        console.error("Failed to fetch plus profile", error);
        message.error("获取会员信息失败，请稍后重试");
      } finally {
        setLoading(false);
      }
    };

    fetchVipStatus();
  }, [message]);

  const isVip = !!vipData?.vipTier && vipData.vipTier !== "NONE";
  const tierName = vipData?.vipTier === "LIFETIME" ? "永久会员" : "年度会员";
  const expiryDate = vipData?.vipTier === "LIFETIME"
    ? "永久有效"
    : vipData?.vipExpiresAt
      ? new Date(vipData.vipExpiresAt).toLocaleDateString()
      : "未知";

  const comparisonData = useMemo(
    () => [
      { key: "1", feature: "基础功能", nonMember: true, member: true },
      { key: "2", feature: "设备接力", nonMember: true, member: true },
      { key: "3", feature: "同步控制", nonMember: false, member: true },
      { key: "4", feature: "TTS生成有声书", nonMember: false, member: true },
      { key: "5", feature: "桌面小部件", nonMember: false, member: true },
      { key: "6", feature: "TV版 (待上线)", nonMember: false, member: true },
      { key: "7", feature: "车机模式", nonMember: false, member: true },
      { key: "8", feature: "扫码登录", nonMember: false, member: true },
      { key: "9", feature: "语音助手", nonMember: false, member: true },
    ],
    []
  );

  const columns = [
    {
      title: "权益功能",
      dataIndex: "feature",
      key: "feature",
      width: "42%",
    },
    {
      title: "非会员",
      dataIndex: "nonMember",
      key: "nonMember",
      align: "center" as const,
      render: (val: boolean) =>
        val ? (
          <CheckOutlined style={{ color: token.colorSuccess }} />
        ) : (
          <CloseOutlined style={{ color: token.colorTextTertiary }} />
        ),
    },
    {
      title: "会员",
      dataIndex: "member",
      key: "member",
      align: "center" as const,
      render: () => <CheckOutlined style={{ color: "#FFD700", fontSize: 18 }} />,
    },
  ];

  const handleLogout = () => {
    setPlusToken(null);
    localStorage.removeItem("plus_vip_status");
    localStorage.removeItem("plus_vip_data");
    localStorage.removeItem("plus_vip_updated_at");
    message.success("会员账号已退出/切换");
    navigate("/member-login", { replace: true });
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.content}>
          <Card className={styles.sectionCard}>
            <Skeleton active paragraph={{ rows: 6 }} />
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <Card
          className={styles.sectionCard}
          style={{ background: token.colorBgContainer }}
          styles={{ body: { padding: 28 } }}
        >
          <div className={styles.pageHeader}>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate(-1)}
              className={styles.backButton}
            />
            <Title level={4} style={{ margin: 0 }}>
              会员详情
            </Title>
          </div>

          <div className={styles.statusBlock}>
            <CrownFilled
              style={{
                fontSize: 64,
                color: isVip ? "#FFD700" : token.colorTextTertiary,
              }}
            />
            <Text className={styles.statusTitle} style={{ color: token.colorText }}>
              {isVip ? "您的会员状态：已激活" : "您的会员状态：未激活"}
            </Text>
            <Text className={styles.statusSubtitle} type="secondary">
              {plusToken ? "当前已登录会员账号" : "当前未登录会员账号"}
            </Text>
          </div>

          <div className={styles.detailList}>
            <div className={styles.detailRow}>
              <Text className={styles.detailLabel} type="secondary">
                会员等级
              </Text>
              <Text className={styles.detailValue} style={{ color: isVip ? "#FFD700" : token.colorText }}>
                {isVip ? tierName : "未开通"}
              </Text>
            </div>
            <div className={styles.detailRow}>
              <Text className={styles.detailLabel} type="secondary">
                到期时间
              </Text>
              <Text className={styles.detailValue} style={{ color: token.colorText }}>
                {isVip ? expiryDate : "-"}
              </Text>
            </div>
          </div>
        </Card>

        <Card
          className={styles.sectionCard}
          style={{ background: token.colorBgContainer }}
          styles={{ body: { padding: 24 } }}
        >
          <Title level={5} style={{ marginTop: 0 }}>
            会员权益
          </Title>
          <Table
            dataSource={comparisonData}
            columns={columns}
            pagination={false}
            bordered
            className={styles.benefitTable}
            rowClassName={() => ""}
          />
        </Card>

        <Card
          className={styles.sectionCard}
          style={{ background: token.colorBgContainer }}
          styles={{ body: { padding: 24 } }}
        >
          <Flex vertical gap={12} className={styles.actionArea}>
            {!isVip && (
              <Button type="primary" size="large" onClick={() => navigate("/member-benefits")}>
                了解会员权益
              </Button>
            )}
            <Button
              danger
              type="primary"
              icon={<LogoutOutlined />}
              className={styles.logoutButton}
              onClick={handleLogout}
            >
              退出/切换会员账号
            </Button>
          </Flex>
        </Card>
      </div>
    </div>
  );
};

export default MemberDetail;
