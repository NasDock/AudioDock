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

interface ReleaseItem {
  id: number;
  tag_name: string;
  body: string;
  published_at: string;
}

const ProductUpdates: React.FC = () => {
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(true);
  const [releases, setReleases] = useState<ReleaseItem[]>([]);

  const fetchReleases = async () => {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/releases`
      );
      const data = await response.json();
      if (Array.isArray(data)) {
        const normalized = data
          .filter((item) => !item.draft)
          .map((item) => ({
            id: item.id,
            tag_name: item.tag_name || "",
            body: item.body || "暂无更新说明",
            published_at: item.published_at || item.created_at || "",
          }))
          .sort(
            (a, b) =>
              new Date(b.published_at).getTime() -
              new Date(a.published_at).getTime(),
          );
        setReleases(normalized);
      }
    } catch (error) {
      console.error("Failed to fetch product updates:", error);
      setReleases([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReleases();
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
        ) : releases.length === 0 ? (
          <div className={styles.emptyText}>无法获取更新内容，请稍后再试。</div>
        ) : (
          <div className={styles.releaseList}>
            {releases.map((release) => (
              <section key={release.id} className={styles.releaseItem}>
                <div className={styles.releaseHeader}>
                  <Title level={4} className={styles.releaseTitle}>
                    {release.tag_name}
                  </Title>
                  <Text type="secondary" className={styles.releaseDate}>
                    {release.published_at
                      ? new Date(release.published_at).toLocaleDateString()
                      : ""}
                  </Text>
                </div>
                <div className={styles.markdown}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {release.body}
                  </ReactMarkdown>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductUpdates;
