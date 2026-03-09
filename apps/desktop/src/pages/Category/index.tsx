import { loadMoreAlbum } from "@soundx/services";
import { useInfiniteScroll } from "ahooks";
import { HeartFilled, HeartOutlined } from "@ant-design/icons";
import { Button, Col, Row, Typography, theme } from "antd";
import React, { useEffect, useLayoutEffect, useRef } from "react";
import Cover from "../../components/Cover/index";
import type { Album } from "../../models";
import { useAlbumListCache } from "../../store/category";
import { useLibraryStore } from "../../store/library";
import { usePlayMode } from "../../utils/playMode";
import styles from "./index.module.less";

interface Result {
  list: Album[];
  hasMore: boolean;
  total: number;
  loadCount: number;
}

const CACHE_KEY = "category_albums";

const Category: React.FC = () => {
  // const [activeTab, setActiveTab] = useState<string>("1");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { mode } = usePlayMode();
  const { heartbeatModeActive, toggleHeartbeatMode } = useLibraryStore();
  const { token } = theme.useToken();
  const { setList, listMap, loadCountMap, scrollMap, setLoadCount, setScroll } = useAlbumListCache();
  const key = `${CACHE_KEY}_${mode}_${heartbeatModeActive ? "heartbeat" : "default"}`;

  const loadMoreAlbums = async (d: Result | undefined): Promise<Result> => {
    const pageSize = 12;
    const loadCount = d?.loadCount || d?.loadCount === 0 ? d?.loadCount + 1 : 0; // 当前已经加载的页数
    setLoadCount(key, loadCount);
    try {
      const res = await loadMoreAlbum({
        pageSize,
        loadCount: loadCount, // 使用 nextPage，不用试图从已有数据推算
        type: mode,
        sortBy:
          mode === "MUSIC" && heartbeatModeActive ? "heartbeat" : undefined,
      });

      if (res.code === 200 && res.data) {
        const { list, total } = res.data;
        const newList = d?.list ? [...d.list, ...list] : list;
        setList(key, newList);
        setLoadCount(key, res?.data?.loadCount);
        return {
          list: list, // ahooks automatically appends if we return list, wait.
          hasMore: (d?.list?.length || 0) + list.length < Number(total), // Fixed logic: existing + new < total
          total,
          loadCount: res?.data?.loadCount,
        };
      }
    } catch (err) {}

    return { list: [], hasMore: false, total: 0, loadCount: 0 };
  };

  const { data, loading, loadingMore, reload, mutate } = useInfiniteScroll(
    loadMoreAlbums,
    {
      target: scrollRef,
      isNoMore: (d) => !d?.hasMore,
      reloadDeps: [mode, heartbeatModeActive],
      direction: "bottom",
      threshold: 100,
      manual: true,
    }
  );

  console.log("data", data);

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
      if (scrollRef.current) {
        console.log(scrollMap[key])
         // Need a slight delay for render
         setTimeout(() => {
            if(scrollRef.current) scrollRef.current.scrollTop = scrollMap[key];
         }, 0);
      }
    } else {
      reload();
    }
  }, [key]); // Re-run when mode/sort mode changes

  // Save scroll on unmount or key change
  useEffect(() => {
    return () => {
      if (scrollRef.current) {
        setScroll(key, scrollRef.current.scrollTop);
      }
    };
  }, [key]);

  useEffect(() => {
    const cb = () => {
      const el = scrollRef.current;
      if (!el || !el.scrollTop) return;
      setScroll(key, scrollRef?.current?.scrollTop || 0)
    }
    scrollRef?.current?.addEventListener("scroll", cb);
    return () => scrollRef?.current?.removeEventListener("scroll", cb)
  },[])

  // const tabItems = categoryTabs.map((tab) => ({
  //   key: String(tab.value),
  //   label: tab.label,
  // }));

  return (
    <div className={styles.container} ref={scrollRef}>
      <div className={styles.pageHeader}>
        <Typography.Title level={2} className={styles.title}>
          专辑
        </Typography.Title>
        {mode === "MUSIC" && (
          <Button
            type={heartbeatModeActive ? "primary" : "default"}
            icon={heartbeatModeActive ? <HeartFilled /> : <HeartOutlined />}
            onClick={toggleHeartbeatMode}
          >
            心动模式
          </Button>
        )}
      </div>

      {/* Cover Grid with Infinite Scroll */}
      <div className={styles.grid}>
        <Row gutter={[24, 24]}>
          {data?.list?.map((item) => (
            <Col key={item.id}>
              <Cover item={item} />
            </Col>
          ))}
          {(loading || loadingMore) && (
            <>
              {Array.from({ length: 8 }).map((_, index) => (
                <Col key={`skeleton-${index}`}>
                  <Cover.Skeleton />
                </Col>
              ))}
            </>
          )}
        </Row>
        {data && !data.hasMore && data.list.length > 0 && (
          <div
            className={styles.noMore}
            style={{ color: token.colorTextSecondary }}
          >
            没有更多了
          </div>
        )}
      </div>
    </div>
  );
};

export default Category;
