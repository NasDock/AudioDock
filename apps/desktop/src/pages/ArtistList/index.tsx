import { getArtistList } from "@soundx/services";
import { useInfiniteScroll } from "ahooks";
import {
  Avatar,
  Col,
  Empty,
  Flex,
  Row,
  Skeleton,
  theme,
  Typography,
} from "antd";
import React, { useEffect, useLayoutEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getBaseURL } from "../../https";
import { type Artist } from "../../models";
import { useArtistListCache } from "../../store/artist";
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
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { mode } = usePlayMode();
  const { token } = theme.useToken();

  const { listMap, loadCountMap, scrollMap, setList, setLoadCount, setScroll } =
    useArtistListCache();
  const key = `${CACHE_KEY}_${mode}`;

  const loadMoreArtists = async (d: Result | undefined): Promise<Result> => {
    const current = d?.loadCount || d?.loadCount === 0 ? d?.loadCount + 1 : 0; // 当前已经加载的页数
    const pageSize = 20;

    try {
      // TODO: Update getArtistList to support pagination and type filtering
      // For now, we might need to fetch all or use existing API
      // Assuming we will update the service to support these params
      const res = await getArtistList(pageSize, current, mode);
      const { list } = res.data;
      const newList = d?.list ? [...d.list, ...list] : list;
      setList(key, newList);
      setLoadCount(key, res?.data?.loadCount);

      if (res.code === 200 && res.data) {
        const { list, total } = res.data;
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
      reloadDeps: [mode],
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
  }, [mode]); // Re-run when mode changes (key changes)

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
                    src={
                      artist.avatar
                        ? artist.avatar.startsWith("http")
                          ? artist.avatar
                          : `${getBaseURL()}${artist.avatar}`
                        : `https://picsum.photos/seed/${artist.id}/300/300`
                    }
                    size={120}
                    shape="circle"
                    className={styles.avatar}
                    icon={!artist.avatar && artist.name[0]}
                  />
                </div>
                <Flex
                  vertical
                  style={{
                    width: "100px",
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
                <Flex vertical align="center" className={styles.skeletonCard}>
                  <div className={styles.coverContainer}>
                    <Skeleton.Avatar active size={120} shape="circle" />
                  </div>
                  <div className={styles.skeletonName}>
                    <Skeleton.Input active size="small" style={{ width: "100%" }} />
                  </div>
                </Flex>
              </Col>
            ))}
        </Row>

        {data && !data.hasMore && data.list.length > 0 && (
          <div
            className={styles.noMore}
            style={{ color: token.colorTextSecondary }}
          >
            没有更多了
          </div>
        )}

        {!loading && !loadingMore && (!data || data.list.length === 0) && (
          <Empty description="暂无艺术家" />
        )}
      </div>
    </div>
  );
};

export default ArtistList;
