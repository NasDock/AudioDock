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
import styles from "./index.module.less";
import SectionOrderModal from "./SectionOrderModal";

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
  const navigate = useNavigate();
  const [sections, setSections] = useState<RecommendedSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);

  // Get current auth state
  const { user } = useAuthStore();
  const { play, setPlaylist } = usePlayerStore();
  const recommendationLikeRatio = useSettingsStore(
    (state) => state.general.recommendationLikeRatio,
  );

  const { token: themeToken } = theme.useToken();

  // Get current play mode from localStorage
  const { mode: playMode } = usePlayMode();

  // Load initial data whenever playMode changes
  useEffect(() => {
    loadSections();
  }, [playMode, recommendationLikeRatio]);

  // Debounce resize to re-fetch data based on new width
  const { run: debouncedRefresh } = useDebounceFn(
    () => {
      loadSections(true); // Bypass cache on resize to get correct count
    },
    { wait: 500 },
  );

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

  const getPageSize = (type: "album" | "artist" | "track") => {
    const width = window.innerWidth;
    // Sidebar 200 + Padding 60 (30*2)
    const availableWidth = width - 200 - 60;

    if (type === "track") {
      // Track cards: 250px width + 12px gap
      const itemWidth = 240 + 12;
      const itemsPerRow = Math.floor(availableWidth / itemWidth);
      // 2 rows, so multiply by 2
      return Math.max(6, itemsPerRow * 2);
    }

    // Album: 170 + 24 (gap) = 194
    // Artist: 110 + 24 (gap) = 134
    const itemWidth = type === "artist" ? 134 : 194;
    return Math.max(4, Math.floor(availableWidth / itemWidth));
  };

  const loadSections = async (forceRefresh = false) => {
    try {
      setLoading(true);

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
              title: "为你推荐",
              items: recommendedAlbums,
              type: "album",
            },
            {
              id: "recent",
              title: "最近上新",
              items: recentAlbums,
              type: "album",
            },
            {
              id: "artists",
              title: "艺术家",
              items: latestArtists,
              type: "artist",
            },
          ];

          if (playMode === "MUSIC") {
            newSections.push({
              id: "tracks",
              title: "上新单曲",
              items: latestTracks,
              type: "track",
            });
          }

          if (playMode === "AUDIOBOOK" && historyAlbums.length > 0) {
            newSections.push({
              id: "history",
              title: "继续收听",
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
      const albumSize = getPageSize("album");
      const artistSize = getPageSize("artist");
      const trackSize = getPageSize("track");

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
          title: "为你推荐",
          items: recommendedAlbums,
          type: "album",
        },
        { id: "recent", title: "最近上新", items: recentAlbums, type: "album" },
        {
          id: "artists",
          title: "艺术家",
          items: latestArtists,
          type: "artist",
        },
      ];

      if (playMode === "MUSIC") {
        newSections.push({
          id: "tracks",
          title: "上新单曲",
          items: latestTracks,
          type: "track",
        });
      }

      if (playMode === "AUDIOBOOK" && historyAlbums.length > 0) {
        newSections.push({
          id: "history",
          title: "继续收听",
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

  const refreshSection = async (sectionId: string) => {
    try {
      setRefreshing(sectionId);

      const type = playMode;
      const albumSize = getPageSize("album");
      const artistSize = getPageSize("artist");
      const trackSize = getPageSize("track");

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

  // Show skeleton loading on initial load
  if (loading) {
    return (
      <Flex gap={16} vertical className={styles.container}>
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
    );
  }

  return (
    <div className={styles.container}>
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
                  播放
                  <CaretRightOutlined />
                </Button>
              )}
              <Button
                type="text"
                className={styles.refreshButton}
                onClick={() => refreshSection(section.id)}
                loading={refreshing === section.id}
              >
                换一批 <SyncOutlined spin={refreshing === section.id} />
              </Button>
            </div>
          </div>

          {section.type === "track" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Split tracks into 2 rows */}
              {[0, 1].map((rowIndex) => (
                <div
                  key={rowIndex}
                  style={{ display: "flex", gap: 16, flexWrap: "wrap" }}
                >
                  {section.items
                    .filter((_, index) => index % 2 === rowIndex)
                    .map((item: any) => (
                      <div
                        key={item.id}
                        style={{
                          width: 240,
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: 10,
                          backgroundColor: "rgba(255,255,255,0.05)",
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
                            "rgba(255,255,255,0.1)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor =
                            "rgba(255,255,255,0.05)";
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
          ) : (
            <Row gutter={[24, 24]}>
              {section.items.map((item: any) => (
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
                        size={120}
                        style={{
                          boxShadow: "0 8px 20px rgba(0, 0, 0, 0.3)",
                        }}
                        icon={!item.avatar && item.name[0]}
                      />
                      <Typography.Text>{item.name}</Typography.Text>
                    </Flex>
                  ) : (
                    <Cover item={item} isHistory={section.id === "history"} />
                  )}
                </Col>
              ))}
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
          调整版块顺序
        </Button>
      </div>

      <SectionOrderModal
        visible={isOrderModalOpen}
        onClose={() => setIsOrderModalOpen(false)}
        sections={sections.map((s) => ({ id: s.id, title: s.title }))}
        onSave={handleSaveOrder}
      />
    </div>
  );
};

export default Recommended;
