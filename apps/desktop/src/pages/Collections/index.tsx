import { getCollections, TrackType } from "@soundx/services";
import { usePlayMode } from "../../utils/playMode";
import { useAuthStore } from "../../store/auth";
import { useMessage } from "../../context/MessageContext";
import React, { useEffect, useRef, useState } from "react";
import { Col, Row, Typography, theme } from "antd";
import { useNavigate } from "react-router-dom";
import styles from "./index.module.less";
import { resolveArtworkUri } from "../../services/trackResolver";

const Collections: React.FC = () => {
  const { mode } = usePlayMode();
  const { user } = useAuthStore();
  const message = useMessage();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { token } = theme.useToken();
  const [collections, setCollections] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mode !== TrackType.AUDIOBOOK || !user?.id) return;
    loadCollections();
  }, [mode, user?.id]);

  const loadCollections = async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const res = await getCollections(user.id);
      if (res.code === 200) {
        setCollections(res.data || []);
      } else {
        message.error(res.message || "加载合集失败");
      }
    } catch (error) {
      message.error("加载合集失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container} ref={scrollRef}>
      <div className={styles.pageHeader}>
        <Typography.Title level={2} className={styles.title}>
          合集
        </Typography.Title>
      </div>

      <div className={styles.grid}>
        <Row gutter={[24, 24]}>
          {collections.map((item) => {
            const cover =
              item.cover || item.items?.[0]?.album?.cover || undefined;
            const count = item._count?.items ?? item.items?.length ?? 0;
            return (
              <Col key={item.id}>
                <div
                  className={styles.card}
                  onClick={() => navigate(`/collection/${item.id}`)}
                >
                  <div className={styles.coverWrap}>
                    <img
                      className={styles.cover}
                      src={resolveArtworkUri(cover)}
                      alt={item.name}
                    />
                  </div>
                  <div className={styles.name}>{item.name}</div>
                  <div className={styles.count} style={{ color: token.colorTextSecondary }}>
                    {count} 张专辑
                  </div>
                </div>
              </Col>
            );
          })}
          {!loading && collections.length === 0 && (
            <div className={styles.noMore} style={{ color: token.colorTextSecondary }}>
              暂无合集
            </div>
          )}
        </Row>
      </div>
    </div>
  );
};

export default Collections;
