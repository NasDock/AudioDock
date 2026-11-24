import { getPlaylistById, Track, type MiDevice, playMiDevicePlaylist, TrackingEvent as TE, TrackingFeature as TF } from "@soundx/services";
import { Image, ScrollView, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import MiDeviceSelector from "../../components/MiDeviceSelector";
import MiniPlayer from "../../components/MiniPlayer";
import XiaoAiIcon from "../../components/XiaoAiIcon";
import { usePlayer } from "../../context/PlayerContext";
import { getImageUrl as buildImageUrl } from '../../utils/image';
import { getBaseURL } from '../../utils/request';
import { trackEvent } from '../../utils/tracking';
import "./index.scss";
import BottomTabBar from '../../components/BottomTabBar';

export default function PlaylistDetail() {
  const { t } = useTranslation();
  const router = useRouter();
  const playlistId = useMemo(() => Number(router.params.id), [router.params.id]);
  const { playTrackList, currentTrack, isPlaying } = usePlayer();

  const [loading, setLoading] = useState(true);
  const [playlistName, setPlaylistName] = useState(t('nav.playlists'));
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isMiDeviceSelectorVisible, setIsMiDeviceSelectorVisible] = useState(false);
  const [isCastingToMi, setIsCastingToMi] = useState(false);
  const playlistOpenedRef = useRef(false);

  useEffect(() => {
    if (playlistOpenedRef.current) return;
    playlistOpenedRef.current = true;
    void trackEvent({
      feature: TF.CONTENT,
      eventName: TE.CONTENT_PLAYLIST_OPEN,
      metadata: { id: router.params.id },
    });
  }, []);

  useEffect(() => {
    if (!playlistId) return;
    loadData(playlistId);
  }, [playlistId]);

  const loadData = async (id: number) => {
    setLoading(true);
    try {
      const res = await getPlaylistById(id);
      if (res.code === 200 && res.data) {
        setPlaylistName(res.data.name || t('nav.playlists'));
        setTracks((res.data.tracks || []) as unknown as Track[]);
      }
    } catch (error) {
      console.error("Failed to load playlist:", error);
    } finally {
      setLoading(false);
    }
  };

  // 占位图各页不同，这里绑死；调用点传显示尺寸（rpx 值 ≈ 目标设备像素，见 utils/image.ts）
  const getImageUrl = (url: string | null, width = 300) =>
    buildImageUrl(url, "https://picsum.photos/200/200", width);

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "--:--";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const uniqueAlbums = useMemo(() => {
    return tracks
      .reduce((acc: any[], track) => {
        const albumKey = track.album || track.name;
        if (!acc.find((a) => (a.album || a.name) === albumKey)) {
          acc.push({
            cover: track.cover,
            id: track.id,
            album: track.album,
            name: track.name,
          });
        }
        return acc;
      }, [])
      .slice(0, 11);
  }, [tracks]);

  const handleCastPlaylistToMi = async (device: MiDevice) => {
    if (tracks.length === 0) {
      Taro.showToast({ title: t('playerPage.miCastNoTrack'), icon: 'none' });
      return;
    }
    setIsCastingToMi(true);
    try {
      const baseURL = getBaseURL().replace(/\/$/, '');
      const trackPayloads = tracks.map((track) => ({
        url: `${baseURL}/track/stream/${track.id}`,
        title: `${track.name} - ${track.artist ?? ''}`,
        duration: track.duration || 0,
      }));
      await playMiDevicePlaylist({
        device_id: device.device_id,
        tracks: trackPayloads,
        start_index: 0,
      });
      void trackEvent({
        feature: TF.CAST,
        eventName: TE.CAST_SUCCESS,
        metadata: { trackCount: trackPayloads.length },
      });
      Taro.showToast({
        title: t('playerPage.miCastPlaylistSuccess', { count: trackPayloads.length, device: device.name }),
        icon: 'success',
      });
      setIsMiDeviceSelectorVisible(false);
    } catch (e) {
      console.error('Failed to cast playlist to Mi device:', e);
      void trackEvent({ feature: TF.CAST, eventName: TE.CAST_FAILED });
      Taro.showToast({ title: t('playerPage.miCastPlaylistFailed'), icon: 'none' });
    } finally {
      setIsCastingToMi(false);
    }
  };

  if (loading) {
    return (
      <View className="playlist-page">
        <View className="center-msg"><Text>{t('common.loading')}</Text></View>
      </View>
    );
  }

  return (
    <View className="playlist-page">
      <ScrollView scrollY className="content">
        {/* Photo Wall - Staggered Grid */}
        <View className="photo-wall">
          {uniqueAlbums.map((album, index) => {
            const isSmall = [0, 3, 7, 10].includes(index);
            const itemStyle = {
              width: isSmall ? "16.66%" : "33.33%",
              aspectRatio: isSmall ? 0.5 : 1,
            };

            return (
              <View
                key={index}
                className="photo-wall-item"
                style={itemStyle}
              >
                <Image
                  src={getImageUrl(album.cover, 300)}
                  className="photo-wall-image"
                  mode="aspectFill" webp
                />
              </View>
            );
          })}
        </View>

        <View className="nav-bar">
          <Text className="title" numberOfLines={1}>{playlistName}</Text>
          <View className="spacer" />
        </View>

        <View className="actions">
          <View className="actions-row">
            <View
              className={`play-all ${tracks.length === 0 ? "disabled" : ""}`}
              onClick={() => tracks.length > 0 && playTrackList(tracks as any, 0)}
            >
              <Text>{t('playlist.playAll')}</Text>
            </View>
            {tracks.length > 0 && (
              <View
                className='playlist-cast-btn'
                onClick={() => setIsMiDeviceSelectorVisible(true)}
              >
                <XiaoAiIcon size={18} />
              </View>
            )}
          </View>
        </View>

        <View className="track-list">
          {tracks.length === 0 ? (
            <View className="center-msg"><Text>{t('playlist.noTracks')}</Text></View>
          ) : (
              tracks.map((item, index) => (
                <View
                  key={`${item.id}-${index}`}
                  className="track-item"
                  onClick={() => playTrackList(tracks as any, index)}
                >
                  <Image src={getImageUrl(item.cover || null, 84)} className="cover" mode="aspectFill" webp />
                  <View className="info">
                    <Text className={`name ${currentTrack?.id === item.id ? "active" : ""}`} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text className="sub" numberOfLines={1}>
                      {item.artist || t('common.unknownArtist')}
                    </Text>
                  </View>
                  <View className="right">
                    {currentTrack?.id === item.id && isPlaying ? <Text className="playing">{t('playlist.playing')}</Text> : null}
                    <Text className="duration">{formatDuration(item.duration || 0)}</Text>
                  </View>
                </View>
              ))
            )}
        </View>
        <View style={{ height: "180rpx" }} />
      </ScrollView>

      <MiDeviceSelector
        visible={isMiDeviceSelectorVisible}
        onClose={() => setIsMiDeviceSelectorVisible(false)}
        onSelectDevice={handleCastPlaylistToMi}
        loading={isCastingToMi}
      />
      <BottomTabBar />
      <MiniPlayer />
    </View>
  );
}
