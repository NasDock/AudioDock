import { loadMoreArtist } from "@soundx/services";
import { useInfiniteScroll } from "ahooks";
import { HeartFilled, HeartOutlined } from "@ant-design/icons";
import {
  Avatar,
  Button,
  Col,
  Empty,
  Flex,
  Row,
  Skeleton,
  theme,
  Typography,
} from "antd";
import React, { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAdaptiveCoverSize } from "../../hooks/useAdaptiveCoverSize";
import { type Artist } from "../../models";
import { useArtistListCache } from "../../store/artist";
import { useLibraryStore } from "../../store/library";
import { getCoverUrl } from "../../utils";
import { usePlayMode } from "../../utils/playMode";
import styles from "./index.module.less";

const { Text } = Typography;
const CACHE_KEY = "artist_list";
interface Result {
  list: Artist[];
  hasMore: boolean;
  total: number;
  loadCount: number;
}

const ArtistList: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { mode } = usePlayMode();
  const { heartbeatModeActive, toggleHeartbeatMode } = useLibraryStore();
  const { token } = theme.useToken();

  const { listMap, loadCountMap, scrollMap, setList, setLoadCount, setScroll } =
    useArtistListCache();
  const key = `${CACHE_KEY}_${mode}_${heartbeatModeActive ? "heartbeat" : "default"}`;

  // 与首页一致的封面自适应：空间够时自然尺寸 120；放不下 5 个/行时等比缩小，保证每行至少 5 个
  const coverSize = useAdaptiveCoverSize(scrollRef, {
    naturalSize: 120,
    gap: 24,
    minCount: 5,
  });

  const loadMoreArtists = async (d: Result | undefined): Promise<Result> => {
    const current = d?.loadCount || d?.loadCount === 0 ? d?.loadCount + 1 : 0;
    const pageSize = 50;

    try {
      const res = await loadMoreArtist({
        pageSize,
        loadCount: current,
        type: mode,
        sortBy: mode === "MUSIC" && heartbeatModeActive ? "heartbeat" : undefined,
      });

      if (res.code === 200 && res.data) {
        const { list, total } = res.data;
        const newList = d?.list ? [...d.list, ...list] : list;
        setList(key, newList);
        setLoadCount(key, res?.data?.loadCount);
        return {
          list,
          hasMore: (d?.list?.length || 0) < Number(total),
          total,
          loadCount: res?.data?.loadCount,
        };
      }
    } catch (error) {
      console.error("Failed to fetch artists:", error);
    }

    return (
      d || {
        list: [],
        hasMore: false,
        total: 0,
        loadCount: current,
      }
    );
  };

  const { data, loading, loadingMore, reload, mutate } = useInfiniteScroll(
    loadMoreArtists,
    {
      target: scrollRef,
      isNoMore: (d) => !d?.hasMore,
      reloadDeps: [mode, heartbeatModeActive],
      manual: true,
    }
  );

  // Restore cache or reload
  useLayoutEffect(() => {
    const cachedList = listMap[key];
    const cachedLoadCount = loadCountMap[key];

    if (cachedList && cachedList.length > 0) {
      mutate({
        list: cachedList,
        hasMore: true, // Optimistically assume true or check logic
        total: 9999, // Hack: we might not have total in cache unless we added it. But it's fine.
        loadCount: cachedLoadCount || 0,
      });
      // Restore scroll
      if (scrollMap[key] && scrollRef.current) {
        // Need a slight delay for render
        setTimeout(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = scrollMap[key];
        }, 0);
      }
    } else {
      reload();
    }
  }, [key]); // Re-run when mode/sort mode changes

  // Save scroll on unmount or key change
  useEffect(() => {
    return () => {
      const el = scrollRef.current;
      if (!el) return;
      if (scrollRef.current) {
        setScroll(key, scrollRef.current.scrollTop);
      }
    };
  }, [key]);

  useEffect(() => {
    const cb = () => {
      const el = scrollRef.current;
      if (!el || !el.scrollTop) return;
      setScroll(key, scrollRef?.current?.scrollTop || 0);
    };
    scrollRef?.current?.addEventListener("scroll", cb);
    return () => scrollRef?.current?.removeEventListener("scroll", cb);
  }, []);

  return (
    <div ref={scrollRef} className={styles.container}>
      <div className={styles.pageHeader}>
        <Typography.Title level={2} className={styles.title}>
          {t("artistList.title")}
        </Typography.Title>
        {mode === "MUSIC" && (
          <Button
            type={heartbeatModeActive ? "primary" : "default"}
            icon={heartbeatModeActive ? <HeartFilled /> : <HeartOutlined />}
            onClick={toggleHeartbeatMode}
          >
            {t("artistList.heartbeatMode")}
          </Button>
        )}
      </div>
      <div className={styles.content}>
        <Row gutter={[24, 24]}>
          {data?.list.map((artist) => (
            <Col key={artist.id}>
              <Flex
                vertical
                align="center"
                style={{ cursor: "pointer" }}
                onClick={() => navigate(`/artist/${artist.id}`)}
              >
                <div className={styles.coverContainer}>
                  <Avatar
                    src={getCoverUrl(artist.avatar, artist.id, 300)}
                    size={coverSize}
                    shape="circle"
                    className={styles.avatar}
                    icon={!artist.avatar && artist.name[0]}
                  />
                </div>
                <Flex
                  vertical
                  style={{
                    width: coverSize,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textAlign: "center",
                  }}
                >
                  <Text>{artist.name}</Text>
                </Flex>
              </Flex>
            </Col>
          ))}
          {loadingMore &&
            Array.from({ length: 6 }).map((_, index) => (
              <Col key={`skeleton-${index}`}>
                <Flex
                  vertical
                  align="center"
                  className={styles.skeletonCard}
                  style={{ width: coverSize }}
                >
                  <div className={styles.coverContainer}>
                    <Skeleton.Avatar active size={coverSize} shape="circle" />
                  </div>
                  <div
                    className={styles.skeletonName}
                    style={{ width: coverSize }}
                  >
                    <Skeleton.Input active size="small" style={{ width: "100%" }} />
                  </div>
                </Flex>
              </Col>
            ))}
        </Row>

        <div
          className={styles.noMore}
          style={{ color: token.colorTextSecondary }}
        >
          {data && data.list.length > 0
            ? data.hasMore
              ? `${t("artistList.totalArtists", { count: data.total > 0 ? data.total : data.list.length })}, ${t("artistList.loadedArtists", { count: data.list.length })}`
              : `${t("artistList.totalArtists", { count: data.total > 0 ? data.total : data.list.length })}, ${t("artistList.noMore")}`
            : t("artistList.noData")}
        </div>

        {!loading && !loadingMore && (!data || data.list.length === 0) && (
          <Empty description={t("artistList.noData")} />
        )}
      </div>
    </div>
  );
};

export default ArtistList;
