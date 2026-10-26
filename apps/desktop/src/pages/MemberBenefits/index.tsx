import {
  AlipayCircleFilled,
  ArrowLeftOutlined,
  CheckOutlined,
  CloseOutlined,
  LogoutOutlined,
  QuestionCircleOutlined,
  WechatFilled,
} from "@ant-design/icons";
import {
  plusCreatePayment,
  plusGetMe,
  plusGetMyCoupons,
  plusGetVipCurrentLowestPrice,
  type MyCouponItem,
  type VipCurrentLowestPriceData,
  type VipCurrentLowestPricePlan,
} from "@soundx/services";
import {
  Alert,
  Button,
  Card,
  Divider,
  Flex,
  Layout,
  Modal,
  QRCode,
  Select,
  Table,
  Tooltip,
  Typography,
  theme,
} from "antd";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useMessage } from "../../context/MessageContext";
import { useAuthStore } from "../../store/auth";
import styles from "./index.module.less";

const { Title, Text } = Typography;
const { Content } = Layout;

const MemberBenefits: React.FC = () => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const message = useMessage();
  const { setPlusToken: setMemberToken } = useAuthStore();
  const [modal, contextHolder] = Modal.useModal();
  const [selectedPlan, setSelectedPlan] = useState<"annual" | "lifetime">(
    "lifetime",
  );
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState<VipCurrentLowestPriceData | null>(
    null,
  );
  const [memberPhone, setMemberPhone] = useState("");
  const [coupons, setCoupons] = useState<MyCouponItem[]>([]);
  const [selectedCouponCode, setSelectedCouponCode] = useState<string | undefined>();
  const selectedCoupon = coupons.find((c) => c.code === selectedCouponCode);
  const [wechatQrModalOpen, setWechatQrModalOpen] = useState(false);
  const [wechatQrCode, setWechatQrCode] = useState("");
  const isElectronRuntime =
    typeof window !== "undefined" && !!(window as any).ipcRenderer;
  const paymentWindowRef = useRef<Window | null>(null);
  const stopPollingRef = useRef(false);

  const maskPhone = (value?: string | null) => {
    const normalized = String(value || "").replace(/\D/g, "");
    if (normalized.length < 7) return "";
    return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
  };

  const formatPrice = (price: number | null | undefined) => {
    if (typeof price !== "number" || Number.isNaN(price)) return "--";
    return Number.isInteger(price) ? String(price) : price.toFixed(2);
  };

  const formatActivityDateRange = (
    startsAt: string | null | undefined,
    endsAt: string | null | undefined,
  ) => {
    if (!startsAt || !endsAt) return "";
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
    const pad = (value: number) => String(value).padStart(2, "0");
    const format = (value: Date) =>
      `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    return t("memberBenefits.dateRange", {
      start: format(start),
      end: format(end),
    });
  };

  const hasDiscount = (plan: VipCurrentLowestPricePlan | null | undefined) =>
    !!plan &&
    plan.discountPercent > 0 &&
    plan.originalPrice > plan.currentPrice;

  const selectedPlanPrice = pricing?.[selectedPlan]?.currentPrice ?? null;
  const activityDateRange = formatActivityDateRange(
    pricing?.startsAt,
    pricing?.endsAt,
  );

  useEffect(() => {
    return () => {
      stopPollingRef.current = true;
      try {
        paymentWindowRef.current?.close();
      } catch {}
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadPricing = async () => {
      try {
        const res = await plusGetVipCurrentLowestPrice();
        if (!mounted) return;
        if (res.data.code === 200) {
          setPricing(res.data.data ?? null);
        } else {
          setPricing(null);
        }
      } catch (error) {
        console.warn("Failed to fetch VIP pricing", error);
        if (mounted) {
          setPricing(null);
        }
      }
    };

    void loadPricing();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadCoupons = async () => {
      try {
        const res = await plusGetMyCoupons();
        if (!mounted) return;
        if (res.data.code === 200) {
          const activeCoupons = (res.data.data?.data || []).filter((item) => !!item?.code);
          setCoupons(activeCoupons);
        }
      } catch (error) {
        console.warn("Failed to fetch coupons", error);
      }
    };

    void loadCoupons();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadMemberPhone = async () => {
      try {
        const plusUserId = localStorage.getItem("plus_user_id");
        if (!plusUserId) return;
        let id: any = plusUserId;
        try {
          id = JSON.parse(plusUserId);
        } catch {}
        const res = await plusGetMe(id);
        console.log("Fetched member profile", res);
        const phone = res.data?.data?.phone || res.data?.data?.mobile || "";
        if (mounted) {
          setMemberPhone(maskPhone(phone));
        }
      } catch (error) {
        console.warn("Failed to fetch member phone", error);
      }
    };

    void loadMemberPhone();

    return () => {
      mounted = false;
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

      setMemberToken(plusToken);
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
      localStorage.setItem(
        "plus_vip_data",
        JSON.stringify(res.data.data || {}),
      );
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
      paymentWindowRef.current = window.open(
        url,
        "_blank",
        "noopener,noreferrer",
      );
      return paymentWindowRef.current;
    }

    const width = 960;
    const height = 720;
    const left = Math.max(
      0,
      Math.round(window.screenX + (window.outerWidth - width) / 2),
    );
    const top = Math.max(
      0,
      Math.round(window.screenY + (window.outerHeight - height) / 2),
    );
    const features = [
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
      "resizable=yes",
      "scrollbars=yes",
    ].join(",");

    const popup =
      window.open(url, "audiodock_payment_cashier", features) ||
      window.open(url, "_blank", "noopener,noreferrer");
    paymentWindowRef.current = popup;
    return popup;
  };

  const closeWechatQrModal = () => {
    stopPollingRef.current = true;
    setWechatQrModalOpen(false);
    setWechatQrCode("");
  };

  const handlePaymentActivated = () => {
    stopPollingRef.current = true;
    setWechatQrModalOpen(false);
    setWechatQrCode("");
    try {
      paymentWindowRef.current?.close();
    } catch {}
    paymentWindowRef.current = null;
    message.success(t("memberBenefits.paymentSuccess"));
    navigate("/member-detail", { replace: true });
  };

  const openCashierAndWaitForPayment = async (paymentUrl: string) => {
    stopPollingRef.current = false;
    const popup = openCashierWindow(paymentUrl);
    if (!popup) {
      message.warning(t('memberBenefits.paymentWindowBlocked'));
      return;
    }

    const activated = await waitForVipActivation();
    if (activated) {
      handlePaymentActivated();
      return;
    }

    const paidAfterClose = await refreshVipStatus();
    if (paidAfterClose) {
      handlePaymentActivated();
      return;
    }

    if (stopPollingRef.current) {
      return;
    }

    if (paymentWindowRef.current?.closed) {
      message.info(t("memberBenefits.cashierClosed"));
      return;
    }

    message.info(t("memberBenefits.cashierProcessing"));
  };

  const openWechatQrCodeAndWaitForPayment = async (qrCodeValue: string) => {
    stopPollingRef.current = false;
    setWechatQrCode(qrCodeValue);
    setWechatQrModalOpen(true);
    message.info(t("memberBenefits.wechatQrInstruction"));

    const activated = await waitForVipActivation();
    if (activated) {
      handlePaymentActivated();
      return;
    }

    const paidAfterClose = await refreshVipStatus();
    if (paidAfterClose) {
      handlePaymentActivated();
      return;
    }

    if (stopPollingRef.current) {
      message.info(t("memberBenefits.wechatQrClosed"));
      return;
    }

    message.info(t("memberBenefits.paymentStatusTimeout"));
  };

  const clearMemberSession = () => {
    setMemberToken(null);
    localStorage.removeItem("plus_vip_status");
    localStorage.removeItem("plus_vip_data");
    localStorage.removeItem("plus_vip_updated_at");
  };

  const handleChangeMember = () => {
    modal.confirm({
      title: t("memberBenefits.switchConfirm"),
      content: t("memberBenefits.switchConfirmDesc"),
      okText: t("memberBenefits.confirm"),
      cancelText: t("common.cancel"),
      onOk: () => {
        clearMemberSession();
        message.success(t("memberBenefits.logoutSuccess"));
        navigate("/member-login", { replace: true });
      },
    });
  };

  const handlePayment = async (method: "WECHAT" | "ALIPAY") => {
    if (selectedPlanPrice == null) {
      message.warning(t("memberBenefits.priceUnavailable"));
      return;
    }

    const userIdStr = localStorage.getItem("plus_user_id");
    if (!userIdStr) {
      message.error(t("common.loginFirst"));
      navigate("/member-login");
      return;
    }

    let userId = userIdStr;
    try {
      userId = JSON.parse(userIdStr);
    } catch (e) {}

    setLoading(true);
    const hideLoading = message.loading(
      method === "WECHAT"
        ? t("memberBenefits.createWechatPayment")
        : t("memberBenefits.createAlipayPayment"),
      0,
    );

    try {
      const res = await plusCreatePayment({
        userId,
        amount: selectedPlanPrice,
        couponCode: selectedCouponCode,
        currency: "CNY",
        method,
        clientType: isElectronRuntime ? "desktop" : "web",
        forVip: true,
        vipTier: selectedPlan === "lifetime" ? "LIFETIME" : "BASIC",
        forPoints: false,
        pointsAmount: 0,
      });

      hideLoading();
      if (res.data.code === 201 || res.data.code === 200) {
        const { paymentUrl, qrCode, alipayPay } = res.data.data || {};

        if (method === "WECHAT") {
          const wechatQrValue = qrCode || paymentUrl;
          if (wechatQrValue) {
            message.success(t("memberBenefits.wechatQrReady"));
            void openWechatQrCodeAndWaitForPayment(wechatQrValue);
          } else {
            message.error(t("memberBenefits.wechatQrFailed"));
          }
          return;
        }

        if (paymentUrl) {
          void openCashierAndWaitForPayment(paymentUrl);
          if (!alipayPay?.orderString) {
            message.success(t("memberBenefits.alipayCashierOpened"));
          } else {
            message.success(t("memberBenefits.paymentOrderCreated"));
          }
        } else {
          message.info(t("memberBenefits.orderCreated"));
        }
      } else {
        message.error(res.data.message || t("memberBenefits.paymentFailed"));
      }
    } catch (e: any) {
      hideLoading();
      message.error(e.response?.data?.message || t("memberBenefits.networkError"));
    } finally {
      setLoading(false);
    }
  };

  const comparisonData = [
    { key: "1", feature: t("memberBenefits.basicFeatures"), nonMember: true, member: true },
    { key: "2", feature: t("memberBenefits.deviceRelay"), nonMember: true, member: true },
    { key: "3", feature: t("memberBenefits.syncControl"), nonMember: false, member: true },
    { key: "4", feature: t("memberBenefits.ttsGeneration"), nonMember: false, member: true },
    { key: "5", feature: t("memberBenefits.tvVersion"), nonMember: false, member: true },
    { key: "6", feature: t("memberBenefits.carMode"), nonMember: false, member: true },
    { key: "7", feature: t("memberBenefits.scanLogin"), nonMember: false, member: true },
    { key: "8", feature: t("memberBenefits.voiceAssistant"), nonMember: false, member: true },
    { key: "9", feature: t("memberBenefits.uiStyleSwitch"), nonMember: false, member: true },
  ];

  const columns = [
    {
      title: t("memberBenefits.benefits"),
      dataIndex: "feature",
      key: "feature",
      width: "40%",
    },
    {
      title: t("memberBenefits.nonMember"),
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
      title: t("memberBenefits.member"),
      dataIndex: "member",
      key: "member",
      align: "center" as const,
      render: (val: boolean) =>
        val ? (
          <CheckOutlined style={{ color: "#FFD700", fontSize: 18 }} />
        ) : (
          <CloseOutlined />
        ),
    },
  ];

  return (
    <Layout
      style={{
        height: "calc(100vh - var(--titlebar-height, 0px))",
        overflow: "hidden",
        background: token.colorBgLayout,
      }}
    >
      <Content className={styles.container} style={{ overflowY: "auto" }}>
        <div
          className={styles.card}
          style={{ background: token.colorBgContainer }}
        >
          {contextHolder}
          <Modal
            title={t("memberBenefits.wechatQrTitle")}
            open={wechatQrModalOpen}
            onCancel={closeWechatQrModal}
            footer={null}
            centered
            destroyOnHidden
          >
            <Flex vertical align="center" gap={12}>
              {wechatQrCode ? (
                <QRCode value={wechatQrCode} size={220} bordered={false} />
              ) : null}
              <Text style={{ fontWeight: 500 }}>
                {t("memberBenefits.wechatQrInstruction")}
              </Text>
              <Text
                type="secondary"
                style={{ textAlign: "center", display: "block" }}
              >
                {t("memberBenefits.wechatQrDesc")}
              </Text>
            </Flex>
          </Modal>
          {/* Header */}
          <div className={styles.pageHeader}>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate(-1)}
              className={styles.backBtn}
            />
            <Title level={4} style={{ margin: 0 }}>
              {t("memberBenefits.title")}
            </Title>
            <Text
              type="secondary"
              style={{ fontSize: 12, minWidth: 72, textAlign: "right" }}
            >
              {memberPhone || ""}
            </Text>
          </div>

          <Divider style={{ margin: "12px 0" }} />

          {pricing?.name ? (
            <Alert
              type="info"
              showIcon
              message={`${t("memberBenefits.activity", { name: pricing.name })}${activityDateRange ? ` · ${activityDateRange}` : ""}`}
              style={{ marginBottom: 16 }}
            />
          ) : null}

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
            <Text style={{ textAlign: "center" }}>{t("memberBenefits.memberPlan")}</Text>
            <Flex gap={20} justify="space-between" style={{ marginTop: 24 }}>
              <Card
                className={`${styles.priceCard} ${selectedPlan === "annual" ? styles.selectedCard : ""}`}
                hoverable
                onClick={() => setSelectedPlan("annual")}
                style={{
                  borderColor:
                    selectedPlan === "annual" ? token.colorPrimary : undefined,
                  borderWidth: selectedPlan === "annual" ? 2 : 1,
                }}
              >
                <Title level={5}>{t("memberBenefits.annual")}</Title>
                <div className={styles.price}>
                  <span className={styles.currency}>¥</span>
                  <span className={styles.amount}>
                    {formatPrice(pricing?.annual?.currentPrice)}
                  </span>
                  <span className={styles.unit}>{t("memberBenefits.perYear")}</span>
                  {pricing?.name ? (
                    <Tooltip
                      title={
                        pricing.description || t("memberBenefits.activityDescFallback")
                      }
                    >
                      <QuestionCircleOutlined className={styles.unitIcon} />
                    </Tooltip>
                  ) : null}
                </div>
                {hasDiscount(pricing?.annual) ? (
                  <div className={styles.priceMeta}>
                    <Text delete type="secondary">
                      {t("memberBenefits.originalPrice", {
                        price: formatPrice(pricing?.annual?.originalPrice),
                      })}
                    </Text>
                    <Text type="secondary">
                      {t("memberBenefits.save", {
                        price: formatPrice(
                          (pricing?.annual?.originalPrice ?? 0) -
                            (pricing?.annual?.currentPrice ?? 0),
                        ),
                      })}
                    </Text>
                  </div>
                ) : null}
              </Card>
              <Card
                className={`${styles.priceCard} ${selectedPlan === "lifetime" ? styles.selectedCard : ""}`}
                style={{
                  borderColor:
                    selectedPlan === "lifetime" ? "#FFD700" : undefined,
                  borderWidth: selectedPlan === "lifetime" ? 2 : 1,
                }}
                hoverable
                onClick={() => setSelectedPlan("lifetime")}
              >
                <div className={styles.proBadge}>{t("memberBenefits.recommended")}</div>
                <Title level={5}>{t("memberBenefits.lifetime")}</Title>
                <div className={styles.price}>
                  <span className={styles.currency}>¥</span>
                  <span className={styles.amount}>
                    {formatPrice(pricing?.lifetime?.currentPrice)}
                  </span>
                  <span className={styles.unit}>{t("memberBenefits.permanent")}</span>
                  {pricing?.name ? (
                    <Tooltip
                      title={
                        pricing.description || t("memberBenefits.activityDescFallback")
                      }
                    >
                      <QuestionCircleOutlined className={styles.unitIcon} />
                    </Tooltip>
                  ) : null}
                </div>
                {hasDiscount(pricing?.lifetime) ? (
                  <div className={styles.priceMeta}>
                    <Text delete type="secondary">
                      {t("memberBenefits.originalPrice", {
                        price: formatPrice(pricing?.lifetime?.originalPrice),
                      })}
                    </Text>
                    <Text type="secondary">
                      {t("memberBenefits.save", {
                        price: formatPrice(
                          (pricing?.lifetime?.originalPrice ?? 0) -
                            (pricing?.lifetime?.currentPrice ?? 0),
                        ),
                      })}
                    </Text>
                  </div>
                ) : null}
              </Card>
            </Flex>
          </div>

          <div style={{ marginBottom: 12 }}>
            <Text>{t("memberBenefits.couponLabel", "选择优惠券")}</Text>
            <Select
              allowClear
              style={{ width: "100%", marginTop: 8 }}
              placeholder={t("memberBenefits.couponPlaceholder", "不使用优惠券") as string}
              value={selectedCouponCode}
              onChange={(value) => setSelectedCouponCode(value)}
              options={coupons.map((item) => {
                const zhe = (100 - item.discountPercent) / 10;
                const zheLabel = Number.isInteger(zhe) ? `${zhe}折` : `${zhe.toFixed(1)}折`;
                return {
                  value: item.code,
                  label: `${item.code} · ${zheLabel}`,
                };
              })}
            />
            {selectedCoupon && selectedPlanPrice != null ? (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {t("memberBenefits.couponFinalPrice", "优惠后价格")}：
                  <Text style={{ color: token.colorPrimary, fontWeight: 600, fontSize: 16 }}>
                    ¥{formatPrice(selectedPlanPrice * (100 - selectedCoupon.discountPercent) / 100)}
                  </Text>
                  <Text delete type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                    ¥{formatPrice(selectedPlanPrice)}
                  </Text>
                </Text>
              </div>
            ) : null}
          </div>

          <div style={{ marginTop: 8, marginBottom: 8 }}>
            <Text>{t("memberBenefits.paymentMethod")}</Text>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("memberBenefits.refundNote")}
              </Text>
            </div>
          </div>
          <Flex
            justify="space-between"
            gap={20}
            className={styles.paymentMethods}
          >
            <Flex
              align="center"
              gap={8}
              className={styles.paymentItem}
              onClick={() =>
                !loading && selectedPlanPrice != null && handlePayment("WECHAT")
              }
              style={{
                opacity: loading || selectedPlanPrice == null ? 0.6 : 1,
                cursor:
                  loading || selectedPlanPrice == null
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              <WechatFilled style={{ fontSize: 24, color: "#1AAD19" }} />
              <Text style={{ fontWeight: 500 }}>{t("memberBenefits.wechatPay")}</Text>
            </Flex>
            <Flex
              align="center"
              gap={8}
              className={styles.paymentItem}
              onClick={() =>
                !loading && selectedPlanPrice != null && handlePayment("ALIPAY")
              }
              style={{
                opacity: loading || selectedPlanPrice == null ? 0.6 : 1,
                cursor:
                  loading || selectedPlanPrice == null
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              <AlipayCircleFilled style={{ fontSize: 24, color: "#02A9F1" }} />
              <Text style={{ fontWeight: 500 }}>{t("memberBenefits.alipay")}</Text>
            </Flex>
          </Flex>

          <Divider style={{ margin: "28px 0 16px" }} />

          <Flex vertical gap={12} className={styles.accountActions}>
            <Button
              danger
              size="large"
              icon={<LogoutOutlined />}
              className={styles.logoutButton}
              onClick={handleChangeMember}
            >
              {t("memberBenefits.logoutSwitch")}
            </Button>
          </Flex>
        </div>
      </Content>
    </Layout>
  );
};

export default MemberBenefits;
