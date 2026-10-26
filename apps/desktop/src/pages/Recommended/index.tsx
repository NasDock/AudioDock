import {
  CaretRightOutlined,
  EnterOutlined,
  HeartOutlined,
  SettingOutlined,
  SyncOutlined
} from "@ant-design/icons";
import {
  getAlbumHistory,
  getLatestArtists,
  getLatestTracks,
  getRecentAlbums,
  getRecommendedAlbums,
  toggleTrackLike,
  toggleTrackUnLike,
} from "@soundx/services";
import { useDebounceFn } from "ahooks";
import {
  Avatar,
  Button,
  Col,
  Flex,
  Row,
  Skeleton,
  theme,
  Typography,
} from "antd";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Cover from "../../components/Cover/index";
import { getBaseURL } from "../../https";
import type { Album, Artist, Track } from "../../models";
import { useAuthStore } from "../../store/auth";
import { usePlayerStore } from "../../store/player";
import { useSettingsStore } from "../../store/settings";
import { cacheUtils } from "../../utils/cache";
import { usePlayMode } from "../../utils/playMode";
import { onHomeRefresh } from "../../utils/refreshHome";
import styles from "./index.module.less";
import SectionOrderModal from "./SectionOrderModal";
import { useTranslation } from "react-i18next";


const { Title, Text } = Typography;

const CACHE_KEY_RECOMMENDED = "recommended_albums";
const CACHE_KEY_RECENT = "recent_albums";
const CACHE_KEY_ARTISTS = "latest_artists";
const CACHE_KEY_TRACKS = "latest_tracks";
const CACHE_KEY_HISTORY = "history_albums";
const STORAGE_KEY_ORDER = "recommended_section_order";

interface RecommendedSection {
  id: string;
  title: string;
  items: (Album | Artist | Track)[];
  type: "album" | "artist" | "track";
}

const Recommended: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [sections, setSections] = useState<RecommendedSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  // 容器实测宽度（clientWidth 不含纵向滚动条），由 ResizeObserver 持续同步；
  // 不能用 ref 在渲染期读——loading 切换会卸载/重挂容器，渲染时 ref 可能还是 null
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Get current auth state
  const { user } = useAuthStore();
  const { play, setPlaylist } = usePlayerStore();
  const recommendationLikeRatio = useSettingsStore(
    (state) => state.general.recommendationLikeRatio,
  );

  const { token: themeToken } = theme.useToken();

  // Get current play mode from localStorage
  const { mode: playMode } = usePlayMode();

  // 车机模式：内容区会被封面/歌词媒体栏压缩，需要把车机栏宽从可用宽度里扣除
  const carModeEnabled = useSettingsStore((s) => s.carMode?.enabled ?? false);
  const carModeMerge = useSettingsStore(
    (s) => s.carMode?.mergeCoverLyrics ?? false,
  );
  const carModeColumnWidths = useSettingsStore(
    (s) => s.carMode?.columnWidths ?? {},
  );

  // 记录上次拉取数据时使用的数量；resize 后只有「期望数量 > 已拉取数量」
  // （宽度明显增加、现有数据不够展示）才重拉；
  // 期望数量变小时直接从已有数据取前 N 个展示，仅期望数量不变时由 containerWidth
  // 驱动封面缩放（放大均分剩余宽度 / 缩小保证最小展示数量）
  const fetchedSizeRef = React.useRef<{
    album: number;
    artist: number;
    track: number;
  } | null>(null);

  const shouldReloadForLayout = () => {
    const prev = fetchedSizeRef.current;
    if (!prev) return true;
    return (
      getDesiredCount("album") > prev.album ||
      getDesiredCount("artist") > prev.artist ||
      getDesiredCount("track") > prev.track
    );
  };

  // Debounce resize to re-fetch data based on new width
  const { run: debouncedRefresh } = useDebounceFn(
    () => {
      if (!shouldReloadForLayout()) return; // 仅封面缩放，不重拉数据
      loadSections(true); // Bypass cache on resize to get correct count
    },
    { wait: 500 },
  );

  // 车机模式下拖动栏宽不会触发 window resize，需要监听变化后重新拉取合适的数量
  const { run: debouncedRefreshForCarMode } = useDebounceFn(
    () => {
      if (!shouldReloadForLayout()) return;
      loadSections(true);
    },
    { wait: 500 },
  );
  useEffect(() => {
    if (carModeEnabled) debouncedRefreshForCarMode();
  }, [carModeEnabled, carModeMerge, carModeColumnWidths]);

  // Load initial data whenever playMode changes
  useEffect(() => {
    loadSections();
  }, [playMode, recommendationLikeRatio]);

  useEffect(() => {
    window.addEventListener("resize", debouncedRefresh);
    return () => window.removeEventListener("resize", debouncedRefresh);
  }, [debouncedRefresh]);

  const getCacheKey = (base: string) =>
    `${base}_${playMode}_${recommendationLikeRatio}`;

  const sortSections = (
    sectionsToSort: RecommendedSection[],
  ): RecommendedSection[] => {
    try {
      const savedOrder = localStorage.getItem(STORAGE_KEY_ORDER);
      if (savedOrder) {
        const orderIds = JSON.parse(savedOrder) as string[];
        return [...sectionsToSort].sort((a, b) => {
          const indexA = orderIds.indexOf(a.id);
          const indexB = orderIds.indexOf(b.id);
          // If both are in the saved order, sort by index
          if (indexA !== -1 && indexB !== -1) return indexA - indexB;
          // If only A is in order, it comes first
          if (indexA !== -1) return -1;
          // If only B is in order, it comes first
          if (indexB !== -1) return 1;
          // If neither, keep original order
          return 0;
        });
      }
    } catch (e) {
      console.error("Failed to parse section order:", e);
    }
    return sectionsToSort;
  };

  // 封面自然尺寸与最小展示数量：空间不足时封面等比缩小，保证至少展示 N 个
  const ALBUM_COVER_SIZE = 170;
  const ARTIST_AVATAR_SIZE = 120;
  const GRID_GAP = 24;
  const MIN_ALBUM_COUNT = 4;
  const MIN_ARTIST_COUNT = 5;
  // 缩放过小的下界，极端窄窗口（如车机模式）避免封面缩到不可用
  const MIN_COVER_SIZE = 60;
  // 上新单曲卡片：自然宽 240、间距 16（与渲染一致），每行至少 3 个，不够时等比缩小
  const TRACK_CARD_WIDTH = 240;
  const TRACK_GRID_GAP = 16;
  const MIN_TRACK_COUNT = 3;
  const MIN_TRACK_CARD_WIDTH = 160;
  // 均分放大（宽度增加但数量不变时封面填满整行）的上限：自然尺寸的 1.5 倍，
  // 避免数据量过少的库在超宽窗口下封面被拉得过大
  const MAX_COVER_SCALE = 1.5;
  const MAX_TRACK_CARD_WIDTH = TRACK_CARD_WIDTH * MAX_COVER_SCALE;

  const getAvailableWidth = () => {
    // 实测时（containerWidth > 0）容器本身已被车机媒体栏压缩（contentColumn flex 自适应），
    // 无需再手动扣媒体栏；仅窗口估算 fallback 才需要手动扣
    const measured = containerWidth > 0;
    let availableWidth: number;
    if (measured) {
      // clientWidth 含 padding、不含纵向滚动条；扣掉 padding 30*2 即内容区宽度
      availableWidth = containerWidth - 60;
    } else {
      // 首次渲染尚未测量，退回估算：窗口宽 - Sidebar 200 - Padding 60
      availableWidth = window.innerWidth - 200 - 60;
    }

    // 车机模式：扣除封面/歌词媒体栏 + 分隔把手宽度（与 CarMode 组件布局保持一致）
    if (carModeEnabled && !measured) {
      const MEDIA_PADDING = 40; // .mediaColumn padding 20*2
      const HANDLE = 3; // .resizeHandle
      if (carModeMerge) {
        // 合并模式：封面+歌词合一栏，两侧各一个把手
        availableWidth -=
          (carModeColumnWidths.cover ?? 360) + MEDIA_PADDING + HANDLE * 2;
      } else {
        // 分列模式：封面栏 + 歌词栏 + 两个把手
        availableWidth -=
          (carModeColumnWidths.cover ?? 360) +
          MEDIA_PADDING +
          HANDLE +
          (carModeColumnWidths.lyrics ?? 360) +
          MEDIA_PADDING +
          HANDLE;
      }
    }
    return availableWidth;
  };

  // 期望展示数量（拉取数据 / 判断是否重拉用）：
  // 能自然放下 >= minCount 个按实际放下个数；放不下则固定 minCount（封面缩小兜底）
  const getDesiredCount = (type: "album" | "artist" | "track") => {
    const availableWidth = getAvailableWidth();
    if (type === "track") {
      const fitPerRow = Math.floor(
        availableWidth / (TRACK_CARD_WIDTH + TRACK_GRID_GAP),
      );
      // 2 rows, so multiply by 2
      return Math.max(MIN_TRACK_COUNT, fitPerRow) * 2;
    }
    const naturalCover =
      type === "artist" ? ARTIST_AVATAR_SIZE : ALBUM_COVER_SIZE;
    const minCount = type === "artist" ? MIN_ARTIST_COUNT : MIN_ALBUM_COUNT;
    const fitCount = Math.floor(availableWidth / (naturalCover + GRID_GAP));
    return Math.max(minCount, fitCount);
  };

  // 某 section 的实际展示数量与封面尺寸（渲染用）：
  // - 数量 = min(期望数量, 已有数据量)：宽度变小时直接取已有数据的前 N 个，不重拉
  // - 封面按展示数量均分剩余宽度：宽度增加但数量不变时封面放大填满整行；
  //   宽度不足最小数量时等比缩小。上限自然尺寸 1.5 倍，下限 MIN_COVER_SIZE
  const getSectionLayout = (type: "album" | "artist", itemCount: number) => {
    const availableWidth = getAvailableWidth();
    const naturalCover =
      type === "artist" ? ARTIST_AVATAR_SIZE : ALBUM_COVER_SIZE;
    const count = Math.min(getDesiredCount(type), itemCount);
    if (count <= 0) return { count: 0, coverSize: naturalCover };
    // 减 1px 容差，避免亚像素渲染时刚好卡边界换行
    const filled =
      Math.floor((availableWidth - GRID_GAP * (count - 1)) / count) - 1;
    return {
      count,
      coverSize: Math.max(
        MIN_COVER_SIZE,
        Math.min(filled, naturalCover * MAX_COVER_SCALE),
      ),
    };
  };

  // 上新单曲：与封面同一套逻辑——数量取 min(期望, 已有)，卡片宽度按每行数量均分
  const getTrackLayout = (itemCount: number) => {
    const availableWidth = getAvailableWidth();
    const count = Math.min(getDesiredCount("track"), itemCount);
    if (count <= 0) return { count: 0, cardWidth: TRACK_CARD_WIDTH };
    const perRow = Math.max(1, Math.ceil(count / 2));
    // 减 1px 容差，避免亚像素渲染时刚好卡边界换行
    const filled =
      Math.floor((availableWidth - TRACK_GRID_GAP * (perRow - 1)) / perRow) - 1;
    return {
      count,
      cardWidth: Math.max(
        MIN_TRACK_CARD_WIDTH,
        Math.min(filled, MAX_TRACK_CARD_WIDTH),
      ),
    };
  };

  const getPageSize = (type: "album" | "artist" | "track") =>
    getDesiredCount(type);

  const loadSections = async (forceRefresh = false) => {
    try {
      setLoading(true);

      // 本次拉取使用的数量，供 resize 后判断数量是否变化、是否需要重拉
      const albumSize = getPageSize("album");
      const artistSize = getPageSize("artist");
      const trackSize = getPageSize("track");
      fetchedSizeRef.current = {
        album: albumSize,
        artist: artistSize,
        track: trackSize,
      };

      let recommendedAlbums: Album[] = [];
      let recentAlbums: Album[] = [];
      let latestArtists: Artist[] = [];
      let latestTracks: Track[] = [];
      let historyAlbums: Album[] = [];

      // Try to get from cache first
      if (!forceRefresh) {
        const cachedRecommended = cacheUtils.get<Album[]>(
          getCacheKey(CACHE_KEY_RECOMMENDED),
        );
        const cachedRecent = cacheUtils.get<Album[]>(
          getCacheKey(CACHE_KEY_RECENT),
        );
        const cachedArtists = cacheUtils.get<Artist[]>(
          getCacheKey(CACHE_KEY_ARTISTS),
        );
        const cachedTracks = cacheUtils.get<Track[]>(
          getCacheKey(CACHE_KEY_TRACKS),
        );

        if (cachedRecommended && cachedRecent && cachedArtists) {
          recommendedAlbums = cachedRecommended;
          recentAlbums = cachedRecent;
          latestArtists = cachedArtists;
          if (playMode === "MUSIC" && cachedTracks) {
            latestTracks = cachedTracks;
          }
          const cachedHistory = cacheUtils.get<Album[]>(
            getCacheKey(CACHE_KEY_HISTORY),
          );
          if (playMode === "AUDIOBOOK" && cachedHistory) {
            historyAlbums = cachedHistory;
          }

          const newSections: RecommendedSection[] = [
            {
              id: "recommended",
              title: t("recommended.recommendedForYou"),
              items: recommendedAlbums,
              type: "album",
            },
            {
              id: "recent",
              title: t("recommended.recentlyAdded"),
              items: recentAlbums,
              type: "album",
            },
            {
              id: "artists",
              title: t("common.artists"),
              items: latestArtists,
              type: "artist",
            },
          ];

          if (playMode === "MUSIC") {
            newSections.push({
              id: "tracks",
              title: t("recommended.newTracks"),
              items: latestTracks,
              type: "track",
            });
          }

          if (playMode === "AUDIOBOOK" && historyAlbums.length > 0) {
            newSections.push({
              id: "history",
              title: t("recommended.continueListening"),
              items: historyAlbums,
              type: "album",
            });
          }

          setSections(sortSections(newSections));
          setLoading(false);
          return;
        }
      }

      // Fetch from API with playMode as type parameter
      const type = playMode;

      const promises: Promise<any>[] = [
        getRecommendedAlbums(type, true, albumSize, recommendationLikeRatio),
        getRecentAlbums(type, true, albumSize),
        getLatestArtists(type, true, artistSize),
      ];

      if (playMode === "MUSIC") {
        promises.push(getLatestTracks("MUSIC", true, trackSize));
      }

      if (playMode === "AUDIOBOOK" && user) {
        promises.push(getAlbumHistory(user.id, 0, albumSize, "AUDIOBOOK"));
      }

      const results = await Promise.all(promises);
      const recommendedRes = results[0];
      const recentRes = results[1];
      const artistsRes = results[2];
      const tracksRes = playMode === "MUSIC" ? results[3] : null;
      const historyRes = playMode === "AUDIOBOOK" && user ? results[3] : null;

      recommendedAlbums = recommendedRes.data || [];
      recentAlbums = recentRes.data || [];
      latestArtists = artistsRes.data || [];
      latestTracks = tracksRes?.data || [];
      historyAlbums =
        historyRes?.data?.list?.map((item: any) => ({
          ...item.album,
          resumeTrackId: item.trackId,
          resumeProgress: item.progress,
        })) || [];

      const newSections: RecommendedSection[] = [
        {
          id: "recommended",
          title: t("recommended.recommendedForYou"),
          items: recommendedAlbums,
          type: "album",
        },
        { id: "recent", title: t("recommended.recentlyAdded"), items: recentAlbums, type: "album" },
        {
          id: "artists",
          title: t("common.artists"),
          items: latestArtists,
          type: "artist",
        },
      ];

      if (playMode === "MUSIC") {
        newSections.push({
          id: "tracks",
          title: t("recommended.newTracks"),
          items: latestTracks,
          type: "track",
        });
      }

      if (playMode === "AUDIOBOOK" && historyAlbums.length > 0) {
        newSections.push({
          id: "history",
          title: t("recommended.continueListening"),
          items: historyAlbums,
          type: "album",
        });
      }

      setSections(sortSections(newSections));

      // Save to cache with type-specific keys
      cacheUtils.set(getCacheKey(CACHE_KEY_RECOMMENDED), recommendedAlbums);
      cacheUtils.set(getCacheKey(CACHE_KEY_RECENT), recentAlbums);
      cacheUtils.set(getCacheKey(CACHE_KEY_ARTISTS), latestArtists);
      if (playMode === "MUSIC") {
        cacheUtils.set(getCacheKey(CACHE_KEY_TRACKS), latestTracks);
      }
      if (playMode === "AUDIOBOOK") {
        cacheUtils.set(getCacheKey(CACHE_KEY_HISTORY), historyAlbums);
      }
    } catch (error) {
      console.error("Failed to load recommended sections:", error);
    } finally {
      setLoading(false);
    }
  };

  // Header 刷新按钮：重新请求首页所有板块内容（绕过缓存）。
  // 用 ref 持有最新 loadSections，避免其每次渲染变更导致反复重订阅
  const loadSectionsRef = React.useRef(loadSections);
  loadSectionsRef.current = loadSections;
  useEffect(() => {
    return onHomeRefresh(() => loadSectionsRef.current(true));
  }, []);

  const refreshSection = async (sectionId: string) => {
    try {
      setRefreshing(sectionId);

      const type = playMode;
      const albumSize = getPageSize("album");
      const artistSize = getPageSize("artist");
      const trackSize = getPageSize("track");
      fetchedSizeRef.current = {
        album: albumSize,
        artist: artistSize,
        track: trackSize,
      };

      if (sectionId === "recommended") {
        const res = await getRecommendedAlbums(
          type,
          true,
          albumSize,
          recommendationLikeRatio,
        );
        const data = res.data || [];
        updateSection(sectionId, data);
        cacheUtils.set(getCacheKey(CACHE_KEY_RECOMMENDED), data);
      } else if (sectionId === "recent") {
        const res = await getRecentAlbums(type, true, albumSize);
        const data = res.data || [];
        updateSection(sectionId, data);
        cacheUtils.set(getCacheKey(CACHE_KEY_RECENT), data);
      } else if (sectionId === "artists") {
        const res = await getLatestArtists(type, true, artistSize);
        const data = res.data || [];
        updateSection(sectionId, data);
        cacheUtils.set(getCacheKey(CACHE_KEY_ARTISTS), data);
      } else if (sectionId === "tracks") {
        const res = await getLatestTracks("MUSIC", true, trackSize);
        const data = res.data || [];
        updateSection(sectionId, data);
        cacheUtils.set(getCacheKey(CACHE_KEY_TRACKS), data);
      } else if (sectionId === "history" && user) {
        const res = await getAlbumHistory(user.id, 0, albumSize, "AUDIOBOOK");
        const data = res.data?.list?.map((item: any) => ({
          ...item.album,
          resumeTrackId: item.trackId,
          resumeProgress: item.progress,
        })) || [];
        updateSection(sectionId, data);
        cacheUtils.set(getCacheKey(CACHE_KEY_HISTORY), data);
      }
    } catch (error) {
      console.error(`Failed to refresh ${sectionId} section:`, error);
    } finally {
      setRefreshing(null);
    }
  };

  const updateSection = (sectionId: string, items: any[]) => {
    setSections((prev) =>
      prev.map((section) =>
        section.id === sectionId ? { ...section, items } : section,
      ),
    );
  };

  const handleArtistClick = (artistId: number) => {
    navigate(`/artist/${artistId}`);
  };

  const handleSaveOrder = (newOrder: string[]) => {
    localStorage.setItem(STORAGE_KEY_ORDER, JSON.stringify(newOrder));
    setSections((prev) => {
      const sorted = [...prev].sort((a, b) => {
        const indexA = newOrder.indexOf(a.id);
        const indexB = newOrder.indexOf(b.id);
        return indexA - indexB;
      });
      return sorted;
    });
  };

  const handlePlaySection = (sectionId: string) => {
    const section = sections.find((s) => s.id === sectionId);
    if (!section || section.items.length === 0) return;

    if (section.type === "track") {
      const tracks = section.items as Track[];
      setPlaylist(tracks, {
        type: "tracks",
        pageSize: 50,
        currentPage: 0,
        hasMore: true,
      });
      play(tracks[0]);
    }
  };

  return (
    <div className={styles.container} ref={containerRef}>
      {loading ? (
        // 骨架屏渲染在常驻容器内，避免卸载容器导致宽度测量失效
        <Flex gap={16} vertical>
          {[1, 2].map((sectionIndex) => (
            <Flex key={sectionIndex} gap={16} vertical>
              <Flex justify="space-between" align="center">
                <Skeleton.Input />
                <Skeleton.Input size="small" />
              </Flex>
              <Flex gap={16}>
                {Array.from({ length: 4 }).map((_, index) => (
                  <Cover.Skeleton key={`skeleton-${sectionIndex}-${index}`} />
                ))}
              </Flex>
            </Flex>
          ))}
        </Flex>
      ) : (
        <>
          {sections.map((section) => (
        <div key={section.id} className={styles.section}>
          <div className={styles.sectionHeader}>
            <Title level={3} className={styles.sectionTitle}>
              {section.title}
            </Title>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {section.id === "tracks" && section.items.length > 0 && (
                <Button
                  type="text"
                  className={styles.refreshButton}
                  style={{ color: themeToken.colorTextBase }}
                  size="small"
                  onClick={() => handlePlaySection(section.id)}
                >
                  {t("player.play")}
                  <CaretRightOutlined />
                </Button>
              )}
              <Button
                type="text"
                className={styles.refreshButton}
                onClick={() => refreshSection(section.id)}
                loading={refreshing === section.id}
              >
                {t("recommended.refreshMore")} <SyncOutlined spin={refreshing === section.id} />
              </Button>
            </div>
          </div>

          {section.type === "track" ? (
            (() => {
              // 数量取 min(期望, 已有)：宽度变小时直接取前 N 个展示，不重拉
              const { count: trackCount, cardWidth } = getTrackLayout(
                section.items.length,
              );
              const displayItems = section.items.slice(0, trackCount);
              return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Split tracks into 2 rows：nowrap 禁止换行，宽度由 getTrackLayout 均分好 */}
              {[0, 1].map((rowIndex) => (
                <div
                  key={rowIndex}
                  style={{ display: "flex", gap: 16, flexWrap: "nowrap" }}
                >
                  {displayItems
                    .filter((_, index) => index % 2 === rowIndex)
                    .map((item: any) => (
                      <div
                        key={item.id}
                        style={{
                          width: cardWidth,
                          // 关键：ant 没有全局 border-box reset，默认 content-box 会让
                          // 实际宽度 = cardWidth + padding*2，整行溢出导致换行
                          boxSizing: "border-box",
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: 10,
                          backgroundColor: "var(--ad-home-card-bg, rgba(255,255,255,0.05))",
                          borderRadius: 8,
                          cursor: "pointer",
                          transition: "all 0.2s",
                        }}
                        onClick={() => {
                          const sectionTracks = section.items as Track[];
                          setPlaylist(sectionTracks, {
                            type: "tracks",
                            pageSize: 50,
                            currentPage: 0,
                            hasMore: true,
                          });
                          play(item);
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor =
                            "var(--ad-home-card-hover-bg, rgba(255,255,255,0.1))";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor =
                            "var(--ad-home-card-bg, rgba(255,255,255,0.05))";
                        }}
                      >
                        <img
                          src={
                            item.cover
                              ? item.cover.startsWith("http")
                                ? item.cover
                                : `${getBaseURL()}${item.cover}`
                              : `https://picsum.photos/seed/${item.id}/100/100`
                          }
                          alt={item.name}
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 4,
                            objectFit: "cover",
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text
                            strong
                            ellipsis
                            style={{ display: "block", fontSize: 14 }}
                          >
                            {item.name}
                          </Text>
                          <Text
                            type="secondary"
                            ellipsis
                            style={{ display: "block", fontSize: 12 }}
                          >
                            {item.artist}
                          </Text>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <HeartOutlined
                            style={{
                              fontSize: 16,
                              color: item.likedByUsers?.some(
                                (like: any) => like.userId === user?.id,
                              )
                                ? "#ff4d4f"
                                : themeToken.colorTextSecondary,
                              cursor: "pointer",
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              const isLiked = item.likedByUsers?.some(
                                (like: any) => like.userId === user?.id,
                              );
                              if (user) {
                                if (isLiked) {
                                  toggleTrackUnLike(item.id, user.id).then(
                                    () => {
                                      // Update local state
                                      setSections((prev) =>
                                        prev.map((s) =>
                                          s.id === section.id
                                            ? {
                                                ...s,
                                                items: s.items.map((t: any) =>
                                                  t.id === item.id
                                                    ? {
                                                        ...t,
                                                        likedByUsers:
                                                          t.likedByUsers?.filter(
                                                            (l: any) =>
                                                              l.userId !==
                                                              user.id,
                                                          ),
                                                      }
                                                    : t,
                                                ),
                                              }
                                            : s,
                                        ),
                                      );
                                    },
                                  );
                                } else {
                                  toggleTrackLike(item.id, user.id).then(() => {
                                    // Update local state
                                    setSections((prev) =>
                                      prev.map((s) =>
                                        s.id === section.id
                                          ? {
                                              ...s,
                                              items: s.items.map((t: any) =>
                                                t.id === item.id
                                                  ? {
                                                      ...t,
                                                      likedByUsers: [
                                                        ...(t.likedByUsers ||
                                                          []),
                                                        {
                                                          id: 0,
                                                          trackId: item.id,
                                                          userId: user.id,
                                                          createdAt: new Date(),
                                                        },
                                                      ],
                                                    }
                                                  : t,
                                              ),
                                            }
                                          : s,
                                      ),
                                    );
                                  });
                                }
                              }
                            }}
                          />
                          <EnterOutlined
                            style={{
                              fontSize: 16,
                              cursor: "pointer",
                              color: themeToken.colorTextSecondary,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              // Add to playlist next - insert after currently playing track
                              const currentPlaylist = [
                                ...(usePlayerStore.getState().playlist || []),
                              ];
                              const currentTrack =
                                usePlayerStore.getState().currentTrack;

                              if (currentTrack) {
                                const currentIndex = currentPlaylist.findIndex(
                                  (t) => t.id === currentTrack.id,
                                );

                                // Remove the track if it already exists in the playlist
                                const existingIndex = currentPlaylist.findIndex(
                                  (t) => t.id === item.id,
                                );
                                if (existingIndex !== -1) {
                                  currentPlaylist.splice(existingIndex, 1);
                                  // Adjust currentIndex if needed
                                  if (existingIndex <= currentIndex) {
                                    currentPlaylist.splice(
                                      currentIndex,
                                      0,
                                      item,
                                    );
                                  } else {
                                    currentPlaylist.splice(
                                      currentIndex + 1,
                                      0,
                                      item,
                                    );
                                  }
                                } else {
                                  // Insert after current track
                                  currentPlaylist.splice(
                                    currentIndex + 1,
                                    0,
                                    item,
                                  );
                                }
                              } else {
                                // No current track, add to beginning
                                currentPlaylist.unshift(item);
                              }

                              setPlaylist(currentPlaylist);
                            }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              ))}
            </div>
              );
            })()
          ) : (
            <Row gutter={[24, 24]}>
              {(() => {
                // 数量取 min(期望, 已有)：宽度变小时直接取前 N 个展示，不重拉；
                // 封面尺寸按展示数量均分剩余宽度（数量不变时放大填满整行，
                // 空间不足时缩小保证最小展示数量）
                const { count, coverSize } = getSectionLayout(
                  section.type === "artist" ? "artist" : "album",
                  section.items.length,
                );
                return section.items.slice(0, count).map((item: any) => (
                  <Col key={item.id}>
                    {section.type === "artist" ? (
                      <Flex
                        vertical
                        align="center"
                        gap={8}
                        className={styles.artistCard}
                        onClick={() => handleArtistClick(item.id)}
                        style={{ cursor: "pointer", textAlign: "center" }}
                      >
                        <Avatar
                          src={
                            item.avatar
                              ? item.avatar.startsWith("http")
                                ? item.avatar
                                : `${getBaseURL()}${item.avatar}`
                              : `https://picsum.photos/seed/${item.id}/300/300`
                          }
                          size={coverSize}
                          style={{
                            boxShadow: "0 8px 20px rgba(0, 0, 0, 0.3)",
                          }}
                          icon={!item.avatar && item.name[0]}
                        />
                        <Typography.Text
                          style={{ maxWidth: coverSize }}
                          ellipsis
                        >
                          {item.name}
                        </Typography.Text>
                      </Flex>
                    ) : (
                      <Cover
                        item={item}
                        size={coverSize}
                        isHistory={section.id === "history"}
                      />
                    )}
                  </Col>
                ));
              })()}
            </Row>
          )}
        </div>
      ))}

      <div style={{ textAlign: "center", marginTop: 40, marginBottom: 20 }}>
        <Button
          type="dashed"
          icon={<SettingOutlined />}
          onClick={() => setIsOrderModalOpen(true)}
        >
          {t("recommended.adjustSectionOrder")}
        </Button>
      </div>

      <SectionOrderModal
        visible={isOrderModalOpen}
        onClose={() => setIsOrderModalOpen(false)}
        sections={sections.map((s) => ({ id: s.id, title: s.title }))}
        onSave={handleSaveOrder}
      />
        </>
      )}
    </div>
  );
};

export default Recommended;
