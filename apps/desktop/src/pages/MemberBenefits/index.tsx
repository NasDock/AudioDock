import { AlipayCircleFilled, ArrowLeftOutlined, CheckOutlined, CloseOutlined, WechatFilled } from "@ant-design/icons";
import { plusCreatePayment, plusGetMe, setPlusToken } from "@soundx/services";
import { Button, Card, Divider, Flex, Layout, Table, Typography, theme } from "antd";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMessage } from "../../context/MessageContext";
import styles from "./index.module.less";

const { Title, Text } = Typography;
const { Content } = Layout;

const MemberBenefits: React.FC = () => {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const message = useMessage();
  const [selectedPlan, setSelectedPlan] = useState<'annual' | 'lifetime'>('lifetime');
  const [loading, setLoading] = useState(false);
  const isElectronRuntime = typeof window !== "undefined" && !!(window as any).ipcRenderer;
  const paymentWindowRef = useRef<Window | null>(null);
  const stopPollingRef = useRef(false);

  useEffect(() => {
    return () => {
      stopPollingRef.current = true;
      try {
        paymentWindowRef.current?.close();
      } catch {}
    };
  }, []);

  const sleep = (ms: number) =>
    new Promise((resolve) => window.setTimeout(resolve, ms));

  const refreshVipStatus = async (): Promise<boolean> => {
    try {
      const plusToken = localStorage.getItem("plus_token");
      const plusUserId = localStorage.getItem("plus_user_id");
      if (!plusToken || !plusUserId) {
        return false;
      }

      setPlusToken(plusToken);
      let id: any = plusUserId;
      try {
        id = JSON.parse(plusUserId);
      } catch {}

      const res = await plusGetMe(id);
      const vipTier = res?.data?.data?.vipTier;
      const isVip = !!vipTier && vipTier !== "NONE";
      if (!isVip) {
        return false;
      }

      localStorage.setItem("plus_vip_status", "true");
      localStorage.setItem("plus_vip_data", JSON.stringify(res.data.data || {}));
      localStorage.setItem("plus_vip_updated_at", Date.now().toString());
      return true;
    } catch (error) {
      console.warn("Failed to refresh vip status", error);
      return false;
    }
  };

  const waitForVipActivation = async () => {
    const startedAt = Date.now();
    const timeoutMs = 5 * 60 * 1000;

    while (Date.now() - startedAt < timeoutMs && !stopPollingRef.current) {
      const activated = await refreshVipStatus();
      if (activated) {
        return true;
      }
      if (paymentWindowRef.current?.closed) {
        return false;
      }
      await sleep(2000);
    }

    return false;
  };

  const openCashierWindow = (url: string) => {
    if (!isElectronRuntime) {
      paymentWindowRef.current = window.open(url, "_blank", "noopener,noreferrer");
      return paymentWindowRef.current;
    }

    const width = 960;
    const height = 720;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
    const features = [
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
      "resizable=yes",
      "scrollbars=yes",
    ].join(",");

    const popup = window.open(url, "audiodock_payment_cashier", features)
      || window.open(url, "_blank", "noopener,noreferrer");
    paymentWindowRef.current = popup;
    return popup;
  };

  const openCashierAndWaitForPayment = async (paymentUrl: string) => {
    stopPollingRef.current = false;
    const popup = openCashierWindow(paymentUrl);
    if (!popup) {
      message.warning("支付窗口被拦截，请允许弹窗后重试");
      return;
    }

    const activated = await waitForVipActivation();
    if (activated) {
      try {
        paymentWindowRef.current?.close();
      } catch {}
      paymentWindowRef.current = null;
      message.success("支付成功，会员权益已生效");
      navigate("/member-detail", { replace: true });
      return;
    }

    const paidAfterClose = await refreshVipStatus();
    if (paidAfterClose) {
      try {
        paymentWindowRef.current?.close();
      } catch {}
      paymentWindowRef.current = null;
      message.success("支付成功，会员权益已生效");
      navigate("/member-detail", { replace: true });
      return;
    }

    if (paymentWindowRef.current?.closed) {
      message.info("支付窗口已关闭。如已完成支付，可稍后进入会员详情查看状态。");
    } else {
      message.info("支付处理中，可在收银台完成支付后自动返回会员状态。");
    }
  };

  const handlePayment = async (method: 'WECHAT' | 'ALIPAY') => {
    const userIdStr = localStorage.getItem("plus_user_id");
    if (!userIdStr) {
      message.error("请先登录会员账号");
      navigate("/member-login");
      return;
    }

    let userId = userIdStr;
    try {
        userId = JSON.parse(userIdStr);
    } catch(e) {}

    setLoading(true);
    const hideLoading = message.loading(`正在发起${method === 'WECHAT' ? '微信' : '支付宝'}支付...`, 0);

    try {
      const res = await plusCreatePayment({
        userId,
        amount: 0.01,
        currency: "CNY",
        method,
        clientType: isElectronRuntime ? "desktop" : "web",
        forVip: true,
        vipTier: selectedPlan === 'lifetime' ? "LIFETIME" : "BASIC",
        forPoints: false,
        pointsAmount: 0
      });

      hideLoading();
      if (res.data.code === 201 || res.data.code === 200) {
        const { paymentUrl, alipayPay } = res.data.data;
        if (paymentUrl) {
            void openCashierAndWaitForPayment(paymentUrl);
            if (method === "ALIPAY" && !alipayPay?.orderString) {
              message.success("支付宝收银台已打开");
            } else {
              message.success("支付订单创建成功");
            }
        } else {
            message.info("订单已创建，请在手机端完成支付");
        }
      } else {
        message.error(res.data.message || "支付发起失败");
      }
    } catch (e: any) {
      hideLoading();
      message.error(e.response?.data?.message || "网络请求失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  const comparisonData = [
    { key: '1', feature: '基础功能', nonMember: true, member: true },
    { key: '2', feature: '设备接力', nonMember: true, member: true },
    { key: '3', feature: '同步控制', nonMember: false, member: true },
    { key: '4', feature: 'TTS生成有声书', nonMember: false, member: true },
    { key: '5', feature: 'TV版', nonMember: false, member: true },
    { key: '6', feature: '车机版', nonMember: false, member: true },
  ];

  const columns = [
    {
      title: '权益功能',
      dataIndex: 'feature',
      key: 'feature',
      width: '40%',
    },
    {
      title: '非会员',
      dataIndex: 'nonMember',
      key: 'nonMember',
      align: 'center' as const,
      render: (val: boolean) => val ? <CheckOutlined style={{ color: token.colorSuccess }} /> : <CloseOutlined style={{ color: token.colorTextTertiary }} />,
    },
    {
      title: '会员',
      dataIndex: 'member',
      key: 'member',
      align: 'center' as const,
      render: (val: boolean) => val ? <CheckOutlined style={{ color: '#FFD700', fontSize: 18 }} /> : <CloseOutlined />,
    },
  ];

  return (
    <Layout style={{ height: "100vh", overflow: "hidden", background: token.colorBgLayout }}>
      <Content className={styles.container} style={{ overflowY: "auto" }}>
        <div className={styles.card} style={{ background: token.colorBgContainer }}>
          {/* Header */}
          <div className={styles.pageHeader}>
            <Button 
                type="text" 
                icon={<ArrowLeftOutlined />} 
                onClick={() => navigate(-1)} 
                className={styles.backBtn}
            />
            <Title level={4} style={{ margin: 0 }}>会员权益</Title>
          </div>

          <Divider style={{margin: '12px 0'}} />

          {/* Comparison Table */}
          <Table 
            dataSource={comparisonData} 
            columns={columns} 
            pagination={false} 
            bordered
            className={styles.benefitTable}
            rowClassName={styles.benefitRow}
          />

          <div style={{ marginTop: 40, marginBottom: 20 }}>
            <Text style={{ textAlign: 'center' }}>会员方案</Text>
            <Flex gap={20} justify="space-between" style={{ marginTop: 24 }}>
                <Card 
                  className={`${styles.priceCard} ${selectedPlan === 'annual' ? styles.selectedCard : ''}`} 
                  hoverable 
                  onClick={() => setSelectedPlan('annual')}
                  style={{
                    borderColor: selectedPlan === 'annual' ? token.colorPrimary : undefined,
                    borderWidth: selectedPlan === 'annual' ? 2 : 1
                  }}
                >
                    <Title level={5}>年卡</Title>
                    <div className={styles.price}>
                        <span className={styles.currency}>¥</span>
                        <span className={styles.amount}>20</span>
                        <span className={styles.unit}>/年</span>
                    </div>
                </Card>
                <Card 
                  className={`${styles.priceCard} ${selectedPlan === 'lifetime' ? styles.selectedCard : ''}`}
                  style={{ 
                    borderColor: selectedPlan === 'lifetime' ? '#FFD700' : undefined,
                    borderWidth: selectedPlan === 'lifetime' ? 2 : 1
                  }} 
                  hoverable
                  onClick={() => setSelectedPlan('lifetime')}
                >
                    <div className={styles.proBadge}>推荐</div>
                    <Title level={5}>永久卡</Title>
                    <div className={styles.price}>
                        <span className={styles.currency}>¥</span>
                        <span className={styles.amount}>60</span>
                        <span className={styles.unit}>/永久</span>
                    </div>
                </Card>
            </Flex>
          </div>

          <Text>支付方式</Text>
          <Flex justify="space-between" gap={20} className={styles.paymentMethods}>
             <Flex 
                align="center" 
                gap={8} 
                className={styles.paymentItem}
                onClick={() => !loading && handlePayment('WECHAT')}
                style={{ opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
             >
                <WechatFilled style={{ fontSize: 24, color: '#1AAD19' }} />
                <Text style={{ fontWeight: 500 }}>微信</Text>
             </Flex>
             <Flex 
                align="center" 
                gap={8} 
                className={styles.paymentItem}
                onClick={() => !loading && handlePayment('ALIPAY')}
                style={{ opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
             >
                <AlipayCircleFilled style={{ fontSize: 24, color: '#02A9F1' }} />
                <Text style={{ fontWeight: 500 }}>支付宝</Text>
             </Flex>
          </Flex>
        </div>
      </Content>
    </Layout>
  );
};

export default MemberBenefits;
