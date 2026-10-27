import { Col, Empty, Row, Spin, theme, Typography } from "antd";
import React, { useEffect, useRef, useState } from "react";
import { getMvList } from "@soundx/services";
import type { Mv } from "@soundx/services";
import Cover from "../../components/Cover";
import { useAdaptiveCoverSize } from "../../hooks/useAdaptiveCoverSize";
import styles from "./index.module.less";
import { useTranslation } from "react-i18next";
import { useMvPlaylistStore } from "../../store/mvPlaylist";
import { useNavigate } from "react-router-dom";

const { Title } = Typography;

const Mvs: React.FC = () => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const { setPlaylist } = useMvPlaylistStore();
  const [items, setItems] = useState<Mv[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const PAGE_SIZE = 50;

  // 与专辑列表（Category）一致的封面自适应；MV 为 16:9，自然宽取 195，
  // pitch 215 ≈ 专辑 pitch(170+24=194) 的 n/(n-1)，使每行个数刚好比专辑列表少一个。
  const coverSize = useAdaptiveCoverSize(scrollRef, {
    naturalSize: 195,
    gap: 20,
    minCount: 2,
    padding: 80, // container 左右各 40
  });

  const loadData = async (pageNum: number) => {
    if (loading || !hasMore) return;
    setLoading(true);

    try {
      const skip = (pageNum - 1) * PAGE_SIZE;
      const res = await getMvList(PAGE_SIZE, skip);
      
      if (res && res.list) {
        if (pageNum === 1) {
          setItems(res.list);
        } else {
          setItems((prev) => [...prev, ...res.list]);
        }
        setHasMore(res.list.length >= PAGE_SIZE);
      }
    } catch (error) {
      console.error("Failed to load mvs", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    setItems([]);
    setHasMore(true);
    loadData(1);
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 100) {
      if (!loading && hasMore) {
        const nextPage = page + 1;
        setPage(nextPage);
        loadData(nextPage);
      }
    }
  };

  return (
    <div
      className={`${styles.container} scrollbar-visible`}
      onScroll={handleScroll}
      ref={scrollRef}
    >
      <div className={styles.header}>
        <Title level={2} style={{ color: token.colorText, margin: 0 }}>
          MV
        </Title>
      </div>

      {items.length > 0 ? (
        <Row gutter={[20, 20]}>
          {items.map((mv, index) => (
            <Col key={mv.id}>
              <Cover
                item={mv as any}
                type="mv"
                size={coverSize}
                aspectRatio={16 / 9}
                onClick={() => {
                  setPlaylist(items, index);
                  navigate(`/mv/${mv.id}`);
                }}
              />
            </Col>
          ))}
        </Row>
      ) : (
        !loading && (
          <Empty
            description={t("common.noData")}
            style={{ marginTop: "100px" }}
          />
        )
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "20px" }}>
          <Spin />
        </div>
      )}
    </div>
  );
};

export default Mvs;
