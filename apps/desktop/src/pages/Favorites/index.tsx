import {
  AppstoreOutlined,
  SyncOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { getFavoriteAlbums, getFavoriteTracks, type ILoadMoreData, toPagedResult } from "@soundx/services";
import { useTranslation } from "react-i18next";
import {
  Button,
  Col,
  Empty,
  Flex,
  Row,
  Segmented,
  Skeleton,
  Timeline,
  Typography,
  theme,
} from "antd";
import React, { useState } from "react";
import Cover from "../../components/Cover/index";
import TrackList from "../../components/TrackList";
import type { TimelineItem } from "../../models";
import { type Album, type Track } from "../../models";
import { useLoadMore } from "../../hooks/useLoadMore";
import { useAuthStore } from "../../store/auth";
import { usePlayerStore } from "../../store/player";
import { usePlayMode } from "../../utils/playMode";
import { formatTimeLabel } from "../../utils/timeFormat";
import { isFnosSource } from "../../utils";
import styles from "./index.module.less";

const { Title } = Typography;

const Favorites: React.FC = () => {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  // 飞牛音乐只支持单曲收藏（专辑收藏接口返回空），因此只保留单曲视图
  const fnosSource = isFnosSource();
  const [viewMode, setViewMode] = useState<"album" | "track">(
    fnosSource ? "track" : "album",
  );
  const effectiveViewMode: "album" | "track" = fnosSource ? "track" : viewMode;
  const { token } = theme.useToken();
  const { play, setPlaylist } = usePlayerStore();

  const { user } = useAuthStore();

  const { mode } = usePlayMode();
  const type = mode;

  const PAGE_SIZE = 100;

  const { list: timelineList, hasMore, loading, loadingMore, sentinelRef, reload, error } = useLoadMore<{
    id: string;
    time: number;
    items: (Album | Track)[];
  }>({
    fetcher: async ({ pageSize, skip }) => {
      const loadCount = Math.floor(skip / pageSize);
      if (effectiveViewMode === "album") {
        const res = await getFavoriteAlbums(user?.id || 0, loadCount, pageSize, type);
        return toPagedResult<any>(res.data as ILoadMoreData<any>, pageSize);
      } else {
        const res = await getFavoriteTracks(user?.id || 0, loadCount, pageSize, type);
        return toPagedResult<any>(res.data as ILoadMoreData<any>, pageSize);
      }
    },
    pageSize: PAGE_SIZE,
    deps: [effectiveViewMode, type, user?.id],
    uniqueKey: (item) => item.id,
  });

  // 后端返回的是平面 user-track-likes/user-album-likes 列表，按日期聚合成 Timeline
  // 注意：useLoadMore 内部已经做过去重，但跨页按日期合并仍是前端逻辑
  const aggregatedList = React.useMemo(() => {
    const merged = new Map<string, TimelineItem>();
    for (const raw of timelineList as any[]) {
      const createdAt = raw.createdAt ?? raw.listenedAt ?? new Date();
      const dateKey = new Date(createdAt).toDateString();
      const inner = (raw.album ?? raw.track) as Album | Track;
      if (!inner) continue;
      if (type === "MUSIC" && (inner as any).type && (inner as any).type !== type) continue;
      if (type === "AUDIOBOOK" && (inner as any).type && (inner as any).type !== type) continue;
      const tlKey = formatTimeLabel(new Date(dateKey).getTime());
      const existing = merged.get(tlKey);
      if (existing) {
        if (!existing.items.some((it: any) => it.id === inner.id)) {
          existing.items.push(inner);
        }
      } else {
        merged.set(tlKey, {
          id: tlKey,
          time: new Date(dateKey).getTime(),
          items: [inner],
        });
      }
    }
    return Array.from(merged.values()).sort((a, b) => b.time - a.time);
  }, [timelineList, type]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const timelineItems = aggregatedList.map((item) => ({
    children: (
      <div>
        <Title level={4} className={styles.timelineTitle}>
          {formatTimeLabel(item.time)}
        </Title>
        {effectiveViewMode === "album" ? (
          <Row gutter={16}>
            {item.items.map((album) => (
              <Col key={album.id}>
                <Cover item={album as Album} />
              </Col>
            ))}
          </Row>
        ) : (
          <TrackList
            tracks={item.items as Track[]}
            showIndex={false}
            showArtist={true}
            showAlbum={true}
            onPlay={(track, tracks) => {
              setPlaylist(tracks);
              play(track, -1);
            }}
            onRefresh={reload}
          />
        )}
      </div>
    ),
  }));

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <Title level={2} className={styles.title}>
          {t("favorites.title")}
        </Title>
        <Flex gap={8} align="center">
          {type === "MUSIC" && (
            <Segmented
              options={
                fnosSource
                  ? [
                      {
                        value: "track",
                        icon: <UnorderedListOutlined />,
                        label: t("favorites.songs"),
                      },
                    ]
                  : [
                      {
                        value: "album",
                        icon: <AppstoreOutlined />,
                        label: t("favorites.album"),
                      },
                      {
                        value: "track",
                        icon: <UnorderedListOutlined />,
                        label: t("favorites.songs"),
                      },
                    ]
              }
              value={effectiveViewMode}
              onChange={(value) => setViewMode(value as "album" | "track")}
            />
          )}
          <Button
            type="text"
            icon={<SyncOutlined spin={refreshing} />}
            onClick={handleRefresh}
            loading={refreshing}
            className={styles.refreshButton}
          >
            {t("favorites.refresh")}
          </Button>
        </Flex>
      </div>

      <Timeline mode="left" items={timelineItems} className={styles.timeline} />

      {(loading || loadingMore) && (
        <div className={styles.loadingContainer}>
          <Skeleton
            active
            title={{ width: "100px" }}
            paragraph={false}
            className={styles.skeletonTitle}
          />
          <Row gutter={[24, 24]}>
            {Array.from({ length: 4 }).map((_, index) => (
              <Col key={`skeleton-${index}`}>
                <Cover.Skeleton />
              </Col>
            ))}
          </Row>
        </div>
      )}

      {/* 滚动 sentinel：进入视口自动 loadMore */}
      {hasMore && !loading && (
        <div ref={sentinelRef} style={{ height: 1 }} aria-hidden="true" />
      )}

      {!hasMore && aggregatedList.length > 0 && (
        <div className={styles.noMore}>{t("favorites.noMore")}</div>
      )}

      {aggregatedList.length === 0 && !loading && !error && (
        <div
          className={styles.noData}
          style={{ color: token.colorTextSecondary }}
        >
          <Empty description={t("favorites.noFavorites")} />
        </div>
      )}
    </div>
  );
};

export default Favorites;
