import {
  Folder,
  FolderContents,
  getFolderContents,
  getFolderRoots,
  TrackType,
} from "@soundx/services";
import { Image, ScrollView, Text, View } from "@tarojs/components";
import Taro, { useDidShow, useRouter } from "@tarojs/taro";
import { useEffect, useMemo, useState } from "react";
import MiniPlayer from "../../components/MiniPlayer";
import { usePlayer } from "../../context/PlayerContext";
import { usePlayMode } from "../../utils/playMode";
import { getBaseURL } from "../../utils/request";
import "./index.scss";

type ViewMode = "roots" | "detail";

export default function FolderPage() {
  const router = useRouter();
  const folderId = router.params.id;
  const { mode } = usePlayMode();
  const { playTrackList, currentTrack, isPlaying } = usePlayer();
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("roots");
  const [roots, setRoots] = useState<Folder[]>([]);
  const [detail, setDetail] = useState<FolderContents | null>(null);

  const trackType = useMemo(
    () => (mode === "AUDIOBOOK" ? TrackType.AUDIOBOOK : TrackType.MUSIC),
    [mode],
  );

  const loadRoots = async () => {
    setLoading(true);
    try {
      const res = await getFolderRoots(trackType);
      if (res.code === 200) {
        setRoots((res.data || []) as Folder[]);
        setViewMode("roots");
      }
    } catch (error) {
      console.error("Failed to load folder roots:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: number | string) => {
    setLoading(true);
    try {
      const res = await getFolderContents(id);
      if (res.code === 200 && res.data) {
        setDetail(res.data as FolderContents);
        setViewMode("detail");
      }
    } catch (error) {
      console.error("Failed to load folder detail:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (folderId) {
      loadDetail(folderId);
    } else {
      loadRoots();
    }
  }, [folderId, trackType]);

  useDidShow(() => {
    if (!folderId) loadRoots();
  });

  const getImageUrl = (url: string | null) => {
    if (!url) return `https://picsum.photos/120/120`;
    if (url.startsWith("http")) return url;
    return `${getBaseURL()}${url}`;
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "--:--";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const renderRoots = () => {
    if (roots.length === 0) {
      return <View className="empty"><Text>暂无文件夹</Text></View>;
    }
    return roots.map((item) => (
      <View
        key={String(item.id)}
        className="folder-row"
        onClick={() => Taro.navigateTo({ url: `/pages/folder/index?id=${item.id}` })}
      >
        <Text className="folder-icon">📁</Text>
        <View className="folder-info">
          <Text className="folder-name" numberOfLines={1}>{item.name}</Text>
          <Text className="folder-path" numberOfLines={1}>{item.path || ""}</Text>
        </View>
      </View>
    ));
  };

  const renderDetail = () => {
    if (!detail) return null;
    const tracks = (detail.tracks || []) as any[];

    return (
      <>
        {(detail.children || []).map((item) => (
          <View
            key={`c-${String(item.id)}`}
            className="folder-row"
            onClick={() => Taro.navigateTo({ url: `/pages/folder/index?id=${item.id}` })}
          >
            <Text className="folder-icon">📁</Text>
            <View className="folder-info">
              <Text className="folder-name" numberOfLines={1}>{item.name}</Text>
              <Text className="folder-path" numberOfLines={1}>{item.path || ""}</Text>
            </View>
          </View>
        ))}

        {tracks.map((track, index) => (
          <View
            key={`t-${track.id}-${index}`}
            className="track-row"
            onClick={() => playTrackList(tracks as any, index)}
          >
            <Image src={getImageUrl(track.cover || null)} className="track-cover" mode="aspectFill" />
            <View className="track-info">
              <Text className={`track-name ${currentTrack?.id === track.id ? "active" : ""}`} numberOfLines={1}>
                {track.name}
              </Text>
              <Text className="track-sub" numberOfLines={1}>{track.artist || ""}</Text>
            </View>
            <View className="track-right">
              {currentTrack?.id === track.id && isPlaying ? <Text className="playing">播放中</Text> : null}
              <Text className="duration">{formatDuration(track.duration || 0)}</Text>
            </View>
          </View>
        ))}
      </>
    );
  };

  return (
    <View className="folder-page">
      <View className="nav">
        <View className="back-btn" onClick={() => Taro.navigateBack()}>
          <Text className="back-icon icon icon-back" />
        </View>
        <Text className="title" numberOfLines={1}>
          {viewMode === "detail" ? (detail?.name || "文件夹详情") : "文件夹"}
        </Text>
        <View className="spacer" />
      </View>

      <ScrollView scrollY className="content">
        {loading ? (
          <View className="empty"><Text>加载中...</Text></View>
        ) : (
          <>
            {viewMode === "roots" ? renderRoots() : renderDetail()}
            <View style={{ height: "180rpx" }} />
          </>
        )}
      </ScrollView>

      <MiniPlayer />
    </View>
  );
}
