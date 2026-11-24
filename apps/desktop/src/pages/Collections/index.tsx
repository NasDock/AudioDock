import { getCollections, TrackType } from "@soundx/services";
import { usePlayMode } from "../../utils/playMode";
import { useAuthStore } from "../../store/auth";
import { useMessage } from "../../context/MessageContext";
import React, { useEffect, useRef, useState } from "react";
import { Col, Row, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import styles from "./index.module.less";
import { resolveArtworkUri } from "../../services/trackResolver";
import { onHomeRefresh } from "../../utils/refreshHome";

const Collections: React.FC = () => {
  const { t } = useTranslation();
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
        message.error(res.message || t('collections.loadFailed', { defaultValue: '加载合集失败' }));
      }
    } catch (error) {
      message.error(t('collections.loadFailed', { defaultValue: '加载合集失败' }));
    } finally {
      setLoading(false);
    }
  };

  // Header 刷新按钮：重新拉取合集列表。保持与初始加载一致的 AUDIOBOOK 模式守卫。
  // 用 ref 持有最新回调，避免每次渲染重新订阅。
  const refreshRef = useRef<() => void>(() => {});
  refreshRef.current = () => {
    if (mode !== TrackType.AUDIOBOOK) return;
    loadCollections();
  };
  useEffect(() => {
    return onHomeRefresh(() => refreshRef.current());
  }, []);

  return (
    <div className={styles.container} ref={scrollRef}>
      <div className={styles.pageHeader}>
        <Typography.Title level={2} className={styles.title}>
          {t('collections.title')}
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
                      src={resolveArtworkUri(cover, { width: 300 })}
                      alt={item.name}
                    />
                  </div>
                  <div className={styles.name}>{item.name}</div>
                  <div className={styles.count} style={{ color: token.colorTextSecondary }}>
                    {count} {t('collections.albumCount', { count }).replace(/\d+/, '')}
                  </div>
                </div>
              </Col>
            );
          })}
          {!loading && collections.length === 0 && (
            <div className={styles.noMore} style={{ color: token.colorTextSecondary }}>
              {t('collections.noData')}
            </div>
          )}
        </Row>
      </div>
    </div>
  );
};

export default Collections;
