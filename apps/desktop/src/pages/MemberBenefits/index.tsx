import { AlipayCircleFilled, ArrowLeftOutlined, CheckOutlined, CloseOutlined, WechatFilled } from "@ant-design/icons";
import { Button, Card, Divider, Flex, Layout, Table, Typography, theme } from "antd";
import React, { useState } from "react";
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

  const comparisonData = [
    { key: '1', feature: '基础功能', nonMember: true, member: true },
    { key: '2', feature: '设备接力', nonMember: true, member: true },
    { key: '3', feature: '同步控制', nonMember: false, member: true },
    { key: '4', feature: 'TTS语言朗读', nonMember: false, member: true },
    { key: '5', feature: '数据源备份', nonMember: false, member: true },
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
            className={styles.benefitTable}
            rowClassName={styles.benefitRow}
          />

          <div style={{ marginTop: 40, marginBottom: 20 }}>
            <Title level={4} style={{ textAlign: 'center' }}>会员方案</Title>
            <Flex gap={20} justify="center" style={{ marginTop: 24 }}>
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

          <Divider>支付方式</Divider>
          <Flex justify="center" gap={20} className={styles.paymentMethods}>
             <Flex 
                align="center" 
                gap={8} 
                className={styles.paymentItem}
                onClick={() => {
                  const planName = selectedPlan === 'lifetime' ? '永久卡' : '年卡';
                  const amount = selectedPlan === 'lifetime' ? 60 : 20;
                  message.loading(`正在唤起微信支付 (${planName} ¥${amount})...`);
                  setTimeout(() => {
                    message.destroy();
                    message.info("支付功能开发中，感谢支持！");
                  }, 2000);
                }}
             >
                <WechatFilled style={{ fontSize: 24, color: '#1AAD19' }} />
                <Text style={{ fontWeight: 500 }}>微信</Text>
             </Flex>
             <Flex 
                align="center" 
                gap={8} 
                className={styles.paymentItem}
                onClick={() => {
                  const planName = selectedPlan === 'lifetime' ? '永久卡' : '年卡';
                  const amount = selectedPlan === 'lifetime' ? 60 : 20;
                  message.loading(`正在唤起支付宝支付 (${planName} ¥${amount})...`);
                  setTimeout(() => {
                    message.destroy();
                    message.info("支付功能开发中，感谢支持！");
                  }, 2000);
                }}
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
