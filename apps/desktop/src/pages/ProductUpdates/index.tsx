import { Spin, Typography, theme } from "antd";
import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import pkg from "../../../package.json";
import qrImg from "../../assets/wechat_qr.jpg";
import styles from "./index.module.less";

const { Title, Text } = Typography;

const GITHUB_USER = 'mmdctjj';
const GITHUB_REPO = 'AudioDock';

const ProductUpdates: React.FC = () => {
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(true);
  const [updateContent, setUpdateContent] = useState("");

  const fetchLatestRelease = async () => {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/latest`
      );
      const data = await response.json();
      if (data && data.body) {
        setUpdateContent(data.body);
      }
    } catch (error) {
      console.error("Failed to fetch product updates:", error);
      setUpdateContent("无法获取更新内容，请稍后再试。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLatestRelease();
  }, []);

  return (
    <div className={styles.productUpdatesPage} style={{ color: token.colorText }}>
      <header className={styles.header}>
        <Title level={2} className={styles.title}>产品动态</Title>
        <Text className={styles.version} type="secondary">
          当前版本: v{pkg.version}
        </Text>
      </header>

      <div className={styles.qrSection}>
        <img src={qrImg} alt="公众号二维码" className={styles.qrCode} />
        <Text className={styles.qrLabel} type="secondary">
          关注官方公众号：声仓
        </Text>
      </div>

      <div className={styles.contentCard}>
        
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <Spin size="large" tip="正在加载更新日志..." />
          </div>
        ) : (
          <div className={styles.markdown}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {updateContent}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductUpdates;
