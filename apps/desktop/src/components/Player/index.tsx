import Icon, {
  AimOutlined,
  DeliveredProcedureOutlined,
  DownOutlined,
  HeartFilled,
  HeartOutlined,
  OrderedListOutlined,
  PauseCircleFilled,
  PlayCircleFilled,
  SoundOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
  TeamOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  addToHistory,
  addTrackToPlaylist,
  deleteTrack,
  getDeletionImpact,
  getLatestHistory,
  getMiAuthStatus,
  getMiDevices,
  getMiQRCode,
  getMiQRCodeStatus,
  getMvByTrackId,
  getPlaylists,
  type MiDevice,
  type MiQRCodeResponse,
  type Playlist,
  playMiDeviceByUrl,
} from "@soundx/services";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import {
  Avatar,
  Button,
  Drawer,
  Flex,
  InputNumber,
  List,
  Modal,
  notification,
  Popover,
  Slider,
  Space,
  Tabs,
  theme,
  Tooltip,
  Typography,
} from "antd";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import ClockOutlined from "../../assets/clock.svg?react";
import LoopOutlined from "../../assets/loop.svg?react";
import MusiclistOutlined from "../../assets/musiclist.svg?react";
import RandomOutlined from "../../assets/random.svg?react";
import SinglecycleOutlined from "../../assets/singlecycle.svg?react";
import XiaoAiOutlined from "../../assets/xiaoai.svg?react";
import { useMessage } from "../../context/MessageContext";
import { useMediaSession } from "../../hooks/useMediaSession";
import { type Track, TrackType } from "../../models";
import { socketService } from "../../services/socket";
import { trackEvent } from "../../services/tracking";
import {
  type AudioQuality,
  type AudioQualityOption,
  buildTrackPlaybackUrl,
  getTrackAudioQualityProfile,
  resolveTrackAudioQuality,
} from "../../services/trackQuality";
import {
  resolveArtworkUri,
  resolveTrackUri,
} from "../../services/trackResolver";
import { useAuthStore } from "../../store/auth";
import { usePlayerStore } from "../../store/player";
import { useSettingsStore } from "../../store/settings";
import LazyImage from "../LazyImage";
import { useSyncStore } from "../../store/sync";
import { formatDuration } from "../../utils/formatDuration";
import { isTauri, tauriGetDeviceName } from "../../utils/platform";
import { getCurrentPlaybackQualityPreference } from "../../utils/playbackQuality";
import { usePlayMode } from "../../utils/playMode";
import PlayingIndicator from "../PlayingIndicator";
import UserSelectModal from "../UserSelectModal";
import styles from "./index.module.less";
import Lyrics from "./Lyrics";
import { QueueList, type QueueListRef } from "./QueueList";

const { Text, Title } = Typography;

interface PlayerProps {
  /** 车机模式下隐藏底部 mini 播放器条，但保留 <audio> 与全屏 Drawer */
  hideMiniPlayer?: boolean;
  /** 向车机模式暴露 seek 能力（audio 元素在 Player 内部） */
  seekBridge?: { current: ((value: number) => void) | null };
}

const Player: React.FC<PlayerProps> = ({ hideMiniPlayer, seekBridge }) => {
  const { t } = useTranslation();
  const message = useMessage();
  const {
    currentTrack,
    isPlaying,
    playlist,
    playMode,
    volume,
    currentTime,
    duration,
    play,
    pause,
    next,
    prev,
    setMode,
    setVolume,
    setCurrentTime,
    setDuration,
    toggleLike,
    syncActiveMode,
    removeTrack,
    isRadioMode,
    playlistSource,
    isLoadingMore,
    loadMoreSourceTracks,
  } = usePlayerStore();
  const { mode: appMode } = usePlayMode();
  const [hasMv, setHasMv] = useState(false);
  const [currentAudioQuality, setCurrentAudioQuality] =
    useState<AudioQuality>("lossless");
  const [preferredAudioQuality, setPreferredAudioQuality] =
    useState<AudioQuality>("lossless");
  const [availableAudioQualities, setAvailableAudioQualities] = useState<
    AudioQualityOption[]
  >([]);
  const { user, device } = useAuthStore();
  const { general, updateDesktopLyric } = useSettingsStore();
  const desktopLyricEnable = useSettingsStore(
    (state) => state.desktopLyric.enable,
  );

  // Sync store active mode with app mode
  useEffect(() => {
    syncActiveMode(appMode);
  }, [appMode, syncActiveMode]);

  useEffect(() => {
    let cancelled = false;

    const checkMv = async () => {
      if (!currentTrack || currentTrack.type === TrackType.AUDIOBOOK) {
        if (!cancelled) setHasMv(false);
        return;
      }

      try {
        const mv = await getMvByTrackId(Number(currentTrack.id));
        if (!cancelled) {
          setHasMv(!!mv);
        }
      } catch (error) {
        if (!cancelled) {
          setHasMv(false);
        }
      }
    };

    checkMv();

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id, currentTrack?.type]);

  useEffect(() => {
    let cancelled = false;

    const syncTrackQuality = async () => {
      if (!currentTrack || currentTrack.type === TrackType.AUDIOBOOK) {
        if (!cancelled) {
          setAvailableAudioQualities([]);
          setCurrentAudioQuality("lossless");
        }
        return;
      }

      // Pick the user's preferred quality synchronously so the very first
      // URL build uses the right bitrate and we don't re-buffer after the
      // profile resolves in the background.
      const preferred = getCurrentPlaybackQualityPreference(general);
      if (!cancelled) {
        setCurrentAudioQuality((prev) =>
          prev === preferred ? prev : preferred,
        );
      }

      const profile = await getTrackAudioQualityProfile(currentTrack);
      if (cancelled) return;
      const resolved = resolveTrackAudioQuality(profile, preferred);
      // Only swap if it would actually change the audio src — avoids a
      // re-buffer when the user's preferred quality is already available.
      setAvailableAudioQualities(profile.options);
      setCurrentAudioQuality((prev) => (prev === resolved ? prev : resolved));
    };

    syncTrackQuality();

    return () => {
      cancelled = true;
    };
  }, [
    currentTrack?.id,
    currentTrack?.type,
    general.internalPlaybackQuality,
    general.externalPlaybackQuality,
  ]);

  const audioRef = useRef<HTMLAudioElement>(null);
  const ignoreTimeUpdate = useRef(false);

  // Determine if we need to ignore initial time updates (restoring state)
  useEffect(() => {
    if (currentTrack) {
      const state = usePlayerStore.getState();
      if (state.currentTime > 0.5) {
        // Use slight threshold to be safe
        ignoreTimeUpdate.current = true;
      }
    }
  }, [currentTrack?.id]);

  // Local state for UI interactions
  const [isPlaylistOpen, setIsPlaylistOpen] = useState(false);
  const [isFullPlayerVisible, setIsFullPlayerVisible] = useState(false);
  const [skipStart, setSkipStart] = useState(() => {
    const saved = localStorage.getItem("skipStart");
    return saved ? Number(saved) : 0;
  });
  const [skipEnd, setSkipEnd] = useState(() => {
    const saved = localStorage.getItem("skipEnd");
    return saved ? Number(saved) : 0;
  });
  const [activeTab, setActiveTab] = useState<"playlist" | "lyrics">("playlist");

  // 监听插件写入的 --ad-detail-cover-style（"square" | "vinyl"），决定封面渲染样式
  const [coverStyle, setCoverStyle] = useState<"square" | "vinyl">("square");
  // 监听 --ad-detail-tonearm（"none" | "basic"），决定唱针装饰
  const [tonearm, setTonearm] = useState<"none" | "basic">("none");
  useEffect(() => {
    const sync = () => {
      const root = getComputedStyle(document.documentElement);
      const coverV = root.getPropertyValue("--ad-detail-cover-style").trim();
      const armV = root.getPropertyValue("--ad-detail-tonearm").trim();
      setCoverStyle(coverV === "vinyl" ? "vinyl" : "square");
      setTonearm(armV === "basic" ? "basic" : "none");
    };
    sync();
    // 主题切换由 useUiTheme 触发 effect 重写 :root CSS var；这里用 MutationObserver 兜底
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => observer.disconnect();
  }, []);

  const navigator = useNavigate();

  const [modalApi, modalContextHolder] = Modal.useModal();
  const [notificationApi, notificationContextHolder] =
    notification.useNotification();

  const queueListRef = useRef<QueueListRef>(null);
  const fullQueueListRef = useRef<QueueListRef>(null);
  const preferredAudioQualityRef = useRef<AudioQuality>(
    getCurrentPlaybackQualityPreference(general),
  );

  useEffect(() => {
    preferredAudioQualityRef.current = preferredAudioQuality;
  }, [preferredAudioQuality]);

  useEffect(() => {
    const nextQuality = getCurrentPlaybackQualityPreference(general);
    setPreferredAudioQuality(nextQuality);
    preferredAudioQualityRef.current = nextQuality;
  }, [general.internalPlaybackQuality, general.externalPlaybackQuality]);

  const handleLocateTrack = () => {
    queueListRef.current?.scrollToActive();
  };

  const handleLocateFullTrack = () => {
    fullQueueListRef.current?.scrollToActive();
  };

  // Sleep Timer State
  const [sleepTimerMode, setSleepTimerMode] = useState<
    "off" | "time" | "count" | "current"
  >(() => {
    const saved = localStorage.getItem("sleepTimerMode");
    return (saved as "off" | "time" | "count" | "current") || "off";
  });
  const cacheEnabled = useSettingsStore((state) => state.download.cacheEnabled);
  const [resolvedUri, setResolvedUri] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!currentTrack) {
      setResolvedUri(undefined);
      return;
    }

    // 1. Determine initial URI synchronously so audio starts streaming on the
    //    very next render — never block playback on async cache or profile work.
    let initialUri = "";
    if (currentTrack.path) {
      initialUri = buildTrackPlaybackUrl(currentTrack, currentAudioQuality);
    } else if ((currentTrack as any).localPath) {
      // Offline audiobook track with no remote URL: resolveTrackUri() below will
      // serve the cached copy as a playable blob URL. Don't set a `media://`
      // URI here - AVPlayer cannot load custom schemes.
      initialUri = "";
    }

    setResolvedUri(initialUri || undefined);

    // 2. Resolve for cache (will upgrade to media:// if cached). This runs in
    //    the background and only swaps the URI when a local cached copy is
    //    available — playback has already started on the remote stream, so the
    //    user does not wait on this.
    if (cacheEnabled && isTauri()) {
      resolveTrackUri(currentTrack, { cacheEnabled }).then((uri) => {
        if (!uri || uri === initialUri) return;
        const state = usePlayerStore.getState();
        if (state.currentTrack?.id === currentTrack.id) {
          setResolvedUri(uri);
        }
      });
    }
  }, [currentTrack?.id, currentTrack?.type, currentAudioQuality, cacheEnabled]);

  const cycleAudioQuality = async () => {
    if (
      !currentTrack ||
      currentTrack.type === TrackType.AUDIOBOOK ||
      availableAudioQualities.length <= 1
    ) {
      return;
    }

    const currentIndex = availableAudioQualities.findIndex(
      (option) => option.quality === currentAudioQuality,
    );
    const nextOption =
      availableAudioQualities[
        (currentIndex + 1) % availableAudioQualities.length
      ] || availableAudioQualities[0];

    setPreferredAudioQuality(nextOption.quality);
    setCurrentAudioQuality(nextOption.quality);
  };
  const [sleepTimerEndTime, setSleepTimerEndTime] = useState<number | null>(
    () => {
      const saved = localStorage.getItem("sleepTimerEndTime");
      const time = saved ? Number(saved) : null;
      // If time passed while closed, user will see immediate trigger or we can handle in effect
      return time;
    },
  ); // Timestamp
  const [sleepTimerCount, setSleepTimerCount] = useState<number>(() => {
    const saved = localStorage.getItem("sleepTimerCount");
    return saved ? Number(saved) : 0;
  }); // Remaining episodes
  const [timerDuration, setTimerDuration] = useState<number>(() => {
    const savedEndTime = localStorage.getItem("sleepTimerEndTime");
    if (savedEndTime) {
      const remaining = Number(savedEndTime) - Date.now();
      if (remaining > 0) {
        return Math.floor(remaining / 60000);
      }
    }
    return 0;
  }); // Store the minutes set by slider for UI display

  const [isTimerModalOpen, setIsTimerModalOpen] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState(30);

  // Playlist Modal State
  const [isAddToPlaylistModalOpen, setIsAddToPlaylistModalOpen] =
    useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  // Upgrade: Invite User Modal
  const [isUserSelectModalOpen, setIsUserSelectModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Mi Speaker (XiaoAi) State
  const [miDevices, setMiDevices] = useState<MiDevice[]>([]);
  const [isMiDevicesLoading, setIsMiDevicesLoading] = useState(false);
  const [isMiDevicesPopoverOpen, setIsMiDevicesPopoverOpen] = useState(false);
  const [miAuthStatus, setMiAuthStatus] = useState<{
    logged_in: boolean;
  } | null>(null);
  const [miQRCode, setMiQRCode] = useState<MiQRCodeResponse | null>(null);
  const [isCastingToMi, setIsCastingToMi] = useState(false);
  const miPollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Playback Rate
  const [playbackRate, setPlaybackRate] = useState(() => {
    const saved = localStorage.getItem("playbackRate");
    return saved ? Number(saved) : 1;
  });

  // Sync Logic
  const { isSynced, sessionId, setSynced, setParticipants } = useSyncStore();
  const isProcessingSync = useRef(false);

  useEffect(() => {
    const checkResume = async () => {
      const { acceptRelay } = useSettingsStore.getState().general;
      if (!acceptRelay) return;

      const user = useAuthStore.getState().user;
      if (!user) return;

      try {
        // 获取设备
        const deviceName = await tauriGetDeviceName();
        const res = await getLatestHistory(user.id);
        if (res && res.code === 200 && res.data) {
          const history = res.data;
          // 最近 24 小时
          const diff =
            new Date().getTime() - new Date(history.listenedAt).getTime();
          const isRecent = diff < 24 * 60 * 60 * 1000;

          // 不同设备才有必要
          const isOtherDevice = history.deviceName !== deviceName;

          if (isRecent && isOtherDevice && history.track) {
            const key = `resume-${Date.now()}`;
            notificationApi.open({
              message: t("player.resumePromptTitle"),
              description: (
                <div>
                  <p>
                    {t("player.resumePromptDesc1")} <b>{history.deviceName}</b>
                  </p>
                  {history.track && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 12,
                        padding: 8,
                        background: "var(--ad-player-control, rgba(255,255,255,0.05))",
                        borderRadius: 4,
                      }}
                    >
                      {history.track.cover && (
                        <LazyImage
                          src={resolveArtworkUri(history.track, { width: 80, format: "webp" })}
                          alt="cover"
                          width={40}
                          height={40}
                          style={{ borderRadius: 4 }}
                        />
                      )}
                      <div style={{ overflow: "hidden" }}>
                        <div
                          style={{
                            fontWeight: "bold",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {history.track.name}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            opacity: 0.7,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {history.track.artist}
                        </div>
                      </div>
                    </div>
                  )}
                  <p>
                    {t("player.resumePromptResume", {
                      time: formatDuration(history.progress),
                    })}
                  </p>
                </div>
              ),
              key,
              btn: (
                <Space style={{ marginTop: 8 }}>
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => {
                      trackEvent({
                        feature: "relay",
                        eventName: "relay_play_accept",
                        userId: user?.id ? String(user.id) : undefined,
                        deviceId: device?.id ? String(device.id) : undefined,
                        metadata: {
                          fromDeviceName: history.deviceName,
                          trackId: history.track?.id,
                          trackType: history.track?.type,
                        },
                      });
                      // Resume Logic
                      play(history.track);
                      // Wait for track to set, then seek.
                      setTimeout(() => {
                        setCurrentTime(history.progress);
                        if (audioRef.current)
                          audioRef.current.currentTime = history.progress;
                      }, 500);
                      notificationApi.destroy(key);
                    }}
                  >
                    {t("common.resume")}
                  </Button>
                  <Button
                    size="small"
                    onClick={() => notificationApi.destroy(key)}
                  >
                    {t("common.ignore")}
                  </Button>
                </Space>
              ),
              showProgress: true,
              duration: 30,
              pauseOnHover: true,
              onClose: () => {
                notificationApi.destroy(key);
              },
            });
          }
        }
      } catch (e) {
        console.error("Failed to check resume", e);
      }
    };

    checkResume();
  }, []); // Run once on mount

  useEffect(() => {
    // Listen for sync session start
    const handleSessionStarted = (payload: any) => {
      setSynced(true, payload.sessionId);

      // Block broadcast temporarily to allow local state (like play) to settle
      // preventing the "Sender is paused -> Broadcast Pause -> Receiver Pauses" race condition.
      isProcessingSync.current = true;
      setTimeout(() => {
        isProcessingSync.current = false;
      }, 500);
    };

    const handleSessionEnded = (payload: any) => {
      console.log("handleSessionEnded", payload);
      message.info(t("player.syncEnded"));
      setSynced(false, null);
      // Optionally pause or continue? Usually continue is fine.
    };

    const handleSyncEvent = (payload: any) => {
      if (payload.senderId === useAuthStore.getState().user?.id) return;

      isProcessingSync.current = true;
      //  type: 'play' | 'pause' | 'seek' | 'track_change'
      switch (payload.type) {
        case "play":
          if (!usePlayerStore.getState().isPlaying) play();
          break;
        case "pause":
          if (usePlayerStore.getState().isPlaying) pause();
          break;
        case "seek":
          if (
            audioRef.current &&
            Math.abs(audioRef.current.currentTime - payload.data) > 1
          ) {
            audioRef.current.currentTime = payload.data;
            setCurrentTime(payload.data);
          }
          break;
        case "track_change":
          // This is complex. We need track object.
          // Simplified: payload.data should be track object
          if (currentTrack?.id !== payload.data.id) {
            play(payload.data);
          }
          break;
      }

      // Reset flag after a short delay
      setTimeout(() => {
        isProcessingSync.current = false;
      }, 300);
    };

    const handleRequestInitialState = (payload: any) => {
      // Only the host (or sender) should respond, but logic targets specific socket anyway.
      // If we receive this, we share our current state.
      console.log("handleRequestInitialState", payload);
      if (!sessionId) return;

      const state = usePlayerStore.getState();
      const commandType = state.isPlaying ? "play" : "pause";

      // Broadcast current state to the room (so the new joiner gets it)
      // We can just emit a sync_command.
      // Note: New joiner will receive it. Existing users will ignore if close.
      if (state.currentTrack) {
        socketService.emit("sync_command", {
          sessionId,
          type: "track_change",
          data: state.currentTrack,
        });
      }

      // Small delay to let track change settle if needed?
      setTimeout(() => {
        socketService.emit("sync_command", {
          sessionId,
          type: commandType,
          data: usePlayerStore?.getState()?.currentTime,
        });
      }, 100);
    };

    const handleParticipantsUpdate = (payload: { participants: any[] }) => {
      useSyncStore.getState().setParticipants(payload.participants);
    };

    const handlePlayerLeft = (payload: {
      userId: number;
      username: string;
      deviceName: string;
    }) => {
      message.info(
        `${payload.username} (${payload.deviceName}) ${t("player.userLeftSync")}`,
      );
      // We might want to remove them from list locally too, though update usually follows
    };

    socketService.on("sync_session_started", handleSessionStarted);
    socketService.on("session_ended", handleSessionEnded);
    socketService.on("sync_event", handleSyncEvent);
    socketService.on("request_initial_state", handleRequestInitialState);
    socketService.on("participants_update", handleParticipantsUpdate);
    socketService.on("player_left", handlePlayerLeft);

    return () => {
      socketService.off("sync_session_started", handleSessionStarted);
      socketService.off("session_ended", handleSessionEnded);
      socketService.off("sync_event", handleSyncEvent);
      socketService.off("request_initial_state", handleRequestInitialState);
      socketService.off("participants_update", handleParticipantsUpdate);
      socketService.off("player_left", handlePlayerLeft);
    };
  }, [play, pause, setCurrentTime, setSynced, currentTrack, sessionId]); // Added sessionId dependency

  const handleDisconnect = () => {
    modalApi.confirm({
      title: t("player.disconnectConfirm").split("？")[0],
      content: t("player.disconnectConfirm"),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      onOk: () => {
        if (sessionId) {
          socketService.emit("player_left", { sessionId });
          setSynced(false, null);
          setParticipants([]);
          message.success(t("player.syncDisconnected"));
        }
      },
    });
  };

  // Broadcast adjustments
  useEffect(() => {
    // Avoid broadcasting immediately after sync event reception or initial load
    if (isSynced && sessionId && !isProcessingSync.current) {
      // Also, ensuring we don't spam.
      const emit = () => {
        if (isPlaying) {
          socketService.emit("sync_command", {
            sessionId,
            type: "play",
            data: null,
          });
        } else {
          socketService.emit("sync_command", {
            sessionId,
            type: "pause",
            data: null,
          });
        }
      };
      emit();
    }
  }, [isPlaying, isSynced, sessionId]);

  useEffect(() => {
    if (isSynced && sessionId && !isProcessingSync.current && currentTrack) {
      socketService.emit("sync_command", {
        sessionId,
        type: "track_change",
        data: currentTrack,
      });
    }
  }, [currentTrack?.id, isSynced, sessionId]);

  // Sync volume with audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume]);

  // Handle play/pause and source changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !resolvedUri) return;

    const updateAndPlay = async () => {
      try {
        const isNewSource = !audio.src.includes(resolvedUri);

        if (isNewSource) {
          audio.pause();
          audio.src = resolvedUri;
          audio.load();
        }

        if (isPlaying && audio.paused) {
          await audio.play();
        } else if (!isPlaying && !audio.paused) {
          audio.pause();
        }

        // Apply progress if significantly different
        let targetTime = currentTime;
        // Prioritize skipStart if in audiobook mode and we are at the beginning
        if (
          appMode === TrackType.AUDIOBOOK &&
          skipStart > 0 &&
          targetTime < skipStart
        ) {
          targetTime = skipStart;
        }

        if (Math.abs(audio.currentTime - targetTime) > 2) {
          audio.currentTime = targetTime;
        }
      } catch (e: any) {
        // AbortError is normal when src changes while play() is pending
        if (e.name !== "AbortError") {
          console.error("[Player] Playback error:", e);
          pause();
        }
      }
    };

    updateAndPlay();
  }, [isPlaying, resolvedUri]);

  // Save settings
  useEffect(() => {
    localStorage.setItem("playerVolume", String(volume));
  }, [volume]);

  useEffect(() => {
    localStorage.setItem(
      isRadioMode ? "radioPlayOrder" : "playOrder",
      playMode,
    );
  }, [isRadioMode, playMode]);

  useEffect(() => {
    localStorage.setItem("skipStart", String(skipStart));
  }, [skipStart]);

  useEffect(() => {
    localStorage.setItem("skipEnd", String(skipEnd));
  }, [skipEnd]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
    localStorage.setItem("playbackRate", String(playbackRate));
  }, [playbackRate]);

  useEffect(() => {
    if (currentTrack) {
      (async () => {
        const deviceName = await tauriGetDeviceName();
        addToHistory(
          currentTrack.id,
          user?.id || 0,
          0,
          deviceName,
          device.id,
          isSynced,
        );
      })();
    }
  }, [currentTrack?.id]);

  // Record on Pause
  useEffect(() => {
    if (currentTrack) {
      (async () => {
        const deviceName = await tauriGetDeviceName();
        addToHistory(
          currentTrack.id,
          user?.id || 0,
          currentTime,
          deviceName,
          device.id,
          isSynced,
        );
      })();
    }
  }, [isPlaying]);

  const { token } = theme.useToken();

  const lastTimeUpdateRef = useRef(0);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      if (ignoreTimeUpdate.current) return;

      const time = audioRef.current.currentTime;
      setCurrentTime(time);

      // IPC Broadcast for Mini Player (throttled ~250ms)
      const now = Date.now();
      if (isTauri() && now - lastTimeUpdateRef.current > 250) {
        invoke("update_player_state", {
          state: {
            isPlaying: !audioRef.current.paused,
            trackName: currentTrack?.name ?? null,
            trackArtist: currentTrack?.artist ?? null,
          },
        }).catch(console.error);
        lastTimeUpdateRef.current = now;
      }

      // Handle skip end - ONLY in Audiobook mode
      if (
        appMode === TrackType.AUDIOBOOK &&
        skipEnd > 0 &&
        duration > 0 &&
        time >= duration - skipEnd
      ) {
        next();
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const audioDuration = audioRef.current.duration;

      // Prioritize database duration because streaming/transcoding often reports 0 or Infinity
      if (currentTrack?.duration && currentTrack.duration > 0) {
        setDuration(currentTrack.duration);
      } else if (isFinite(audioDuration)) {
        setDuration(audioDuration);
      }

      // Apply playback rate
      audioRef.current.playbackRate = playbackRate;

      // Critical for Sync: If store has a specific currentTime (set by play or sync), apply it now.
      // We prioritize valid currentTime > 0.
      let startTime = currentTime;
      if (
        appMode === TrackType.AUDIOBOOK &&
        skipStart > 0 &&
        startTime < skipStart
      ) {
        startTime = skipStart;
        audioRef.current.currentTime = skipStart;
      }

      if (startTime > 0) {
        audioRef.current.currentTime = startTime;
      }

      // Allow updates again after metadata loaded and potential seek performed
      ignoreTimeUpdate.current = false;
    }
  };

  // Timer Effect
  useEffect(() => {
    let interval: number;

    if (sleepTimerMode === "time" && sleepTimerEndTime) {
      interval = setInterval(() => {
        const now = Date.now();
        if (now >= sleepTimerEndTime) {
          pause();
          setSleepTimerMode("off");
          setSleepTimerEndTime(null);
          message.success(t("player.sleepTimerTriggered"));
          setDuration(0);
          localStorage.removeItem("sleepTimerEndTime");
          localStorage.setItem("sleepTimerMode", "off");
        } else {
          // Just update UI or check
          // setSleepTimerEndTime(sleepTimerEndTime - 1000); // Don't decrement timestamp, it's absolute
        }
      }, 1000);
    }

    return () => clearInterval(interval);
  }, [sleepTimerMode, sleepTimerEndTime, pause, message]);

  // Persist Sleep Timer State
  useEffect(() => {
    localStorage.setItem("sleepTimerMode", sleepTimerMode);
  }, [sleepTimerMode]);

  useEffect(() => {
    if (sleepTimerEndTime) {
      localStorage.setItem("sleepTimerEndTime", String(sleepTimerEndTime));
    } else {
      localStorage.removeItem("sleepTimerEndTime");
    }
  }, [sleepTimerEndTime]);

  useEffect(() => {
    localStorage.setItem("sleepTimerCount", String(sleepTimerCount));
  }, [sleepTimerCount]);

  const handleEnded = () => {
    // Sleep Timer Logic
    if (sleepTimerMode === "current") {
      pause();
      setSleepTimerMode("off");
      message.success(t("player.sleepTimerEndedCurrent"));
      return;
    }

    if (sleepTimerMode === "count") {
      if (sleepTimerCount <= 1) {
        pause();
        setSleepTimerMode("off");
        setSleepTimerCount(0);
        message.success(t("player.sleepTimerTriggered"));
        return;
      } else {
        setSleepTimerCount((prev) => prev - 1);
      }
    }

    if (playMode === "single") {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play();
        setCurrentTime(0);
      }
      return;
    }

    next();
  };

  // Handle play with resume
  const handlePlay = (track: Track) => {
    const shouldResume =
      appMode === TrackType.AUDIOBOOK && track.progress && track.progress > 0;
    play(track, undefined, shouldResume ? track.progress : 0);
  };

  const handleSeek = (value: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = value;
      setCurrentTime(value);
    }
  };

  // 向车机模式暴露 seek 能力
  useEffect(() => {
    if (seekBridge) {
      seekBridge.current = handleSeek;
      return () => {
        seekBridge.current = null;
      };
    }
  }, [seekBridge]);

  // Integrate System Media Controls
  useMediaSession({
    currentTrack,
    isPlaying,
    play,
    pause,
    next,
    prev,
    seekTo: handleSeek,
  });

  // Send track info to main process for tray display
  useEffect(() => {
    if (isTauri()) {
      invoke("update_player_state", {
        state: {
          isPlaying,
          trackName: currentTrack?.name ?? null,
          trackArtist: currentTrack?.artist ?? null,
        },
      }).catch(console.error);
    }
  }, [currentTrack?.id, currentTrack?.name, currentTrack?.artist, isPlaying]);

  // Global Lyric Sync Logic
  const [parsedLyrics, setParsedLyrics] = useState<
    { time: number; text: string }[]
  >([]);

  // Parse lyrics when track changes
  useEffect(() => {
    const rawLyrics = currentTrack?.lyrics;
    if (!rawLyrics) {
      setParsedLyrics([]);
      // Sync empty state immediately
      if (isTauri()) {
        invoke("update_lyric", { currentLyric: "" }).catch(console.error);
        const emptyPayload = { currentLyric: "" };
        emitTo("mini", "lyric:update", emptyPayload).catch(console.error);
        emitTo("lyric", "lyric:update", emptyPayload).catch(console.error);
      }
      return;
    }

    const lines = rawLyrics.split(/\r?\n/);
    const parsed: { time: number; text: string }[] = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;

    lines.forEach((line: string) => {
      const matches = [...line.matchAll(timeRegex)];
      if (matches.length > 0) {
        const text = line.replace(timeRegex, "").trim();
        if (text) {
          matches.forEach((match) => {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const milliseconds = parseInt(match[3], 10);
            const time = minutes * 60 + seconds + milliseconds / 1000;
            parsed.push({ time, text });
          });
        }
      }
    });

    parsed.sort((a, b) => a.time - b.time);
    setParsedLyrics(parsed);
  }, [currentTrack?.lyrics]);

  // Sync active lyric line
  useEffect(() => {
    if (parsedLyrics.length === 0 || !isTauri()) return;

    let index = parsedLyrics.findIndex((line) => line.time > currentTime) - 1;
    if (index === -2) index = -1;
    else if (index === -1) index = parsedLyrics.length - 1;

    const currentLineText = index >= 0 ? parsedLyrics[index].text : "";

    invoke("update_lyric", { currentLyric: currentLineText }).catch(
      console.error,
    );
    const lyricPayload = { currentLyric: currentLineText };
    emitTo("mini", "lyric:update", lyricPayload).catch(console.error);
    emitTo("lyric", "lyric:update", lyricPayload).catch(console.error);
  }, [currentTime, parsedLyrics]);

  // Listen for playback control commands from main process
  useEffect(() => {
    if (!isTauri()) return;

    let unlistenToggle: (() => void) | undefined;
    let unlistenNext: (() => void) | undefined;
    let unlistenPrev: (() => void) | undefined;

    listen("player:toggle", () => {
      const state = usePlayerStore.getState();
      if (state.isPlaying) {
        state.pause();
      } else {
        state.play();
      }
    }).then((fn) => {
      unlistenToggle = fn;
    });

    listen("player:next", () => usePlayerStore.getState().next()).then((fn) => {
      unlistenNext = fn;
    });
    listen("player:prev", () => usePlayerStore.getState().prev()).then((fn) => {
      unlistenPrev = fn;
    });

    return () => {
      if (unlistenToggle) unlistenToggle();
      if (unlistenNext) unlistenNext();
      if (unlistenPrev) unlistenPrev();
    };
  }, []); // 空依赖数组，只在组件挂载时注册一次

  // Mirror Electron's `player:update` IPC: push current track/playing state to
  // the system tray (via Rust command) and to mini/lyric windows (via emitTo).
  useEffect(() => {
    if (!isTauri()) return;
    const payload = {
      isPlaying,
      track: currentTrack
        ? {
            id: currentTrack.id,
            name: currentTrack.name,
            artist: currentTrack.artist,
            album: currentTrack.albumEntity?.name || currentTrack.album,
            cover: currentTrack.cover,
          }
        : null,
    };
    invoke("update_player_state", {
      state: {
        isPlaying,
        trackName: currentTrack?.name ?? null,
        trackArtist: currentTrack?.artist ?? null,
      },
    }).catch(console.error);
    emitTo("mini", "player:update", payload).catch(console.error);
    emitTo("lyric", "player:update", payload).catch(console.error);
  }, [isPlaying, currentTrack?.id, currentTrack?.name, currentTrack?.artist]);

  const togglePlay = () => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  const renderMiniPlayer = (expandable: boolean) => (
    <>
      <div
        className={styles.songInfo}
        onClick={() => expandable && setIsFullPlayerVisible(true)}
      >
        <div className={styles.coverWrapper}>
          {currentTrack && (
            <LazyImage
              src={resolveArtworkUri(currentTrack, { width: 240, format: "webp" })}
              alt="cover"
              width={"100%"}
              height={"100%"}
              className={styles.coverImage}
            />
          )}
        </div>
        <div className={styles.songDetails}>
          <Text strong ellipsis style={{ maxWidth: 250 }}>
            {currentTrack?.name || "No Track"}
          </Text>
          <div className={styles.trackMetaRow}>
            <Text
              type="secondary"
              className={styles.artistText}
              style={{ fontSize: "12px" }}
            >
              {currentTrack?.artist || "Unknown Artist"}
            </Text>
            {currentTrack?.type !== TrackType.AUDIOBOOK && (
              <button
                type="button"
                className={`${styles.qualityButton} ${
                  availableAudioQualities.length <= 1
                    ? styles.qualityButtonDisabled
                    : ""
                }`}
                style={{ color: token.colorTextSecondary }}
                onClick={(event) => {
                  event.stopPropagation();
                  void cycleAudioQuality();
                }}
                disabled={availableAudioQualities.length <= 1}
              >
                {availableAudioQualities.find(
                  (item) => item.quality === currentAudioQuality,
                )?.label || "无损"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.controlButtons}>
          <Popover
            content={
              <List
                size="small"
                header={<Text strong>{t("player.syncingUsers")}</Text>}
                dataSource={useSyncStore.getState().participants}
                renderItem={(item: any) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={
                        <Avatar
                          size={30}
                          style={{
                            backgroundColor: token.colorPrimary,
                          }}
                        >
                          {item.username[0]}
                        </Avatar>
                      }
                      title={
                        item.username +
                        `${
                          item.userId === useAuthStore.getState().user?.id
                            ? t("common.you")
                            : ""
                        }`
                      }
                      description={item.deviceName}
                    />
                  </List.Item>
                )}
                style={{ width: 250 }}
              />
            }
            trigger="hover"
            placement="top"
          >
            {isSynced ? (
              <div
                className={styles.controlIcon}
                onClick={() => {
                  if (isSynced) {
                    handleDisconnect();
                  }
                }}
              >
                <PlayingIndicator />
              </div>
            ) : (
              <TeamOutlined
                className={styles.controlIcon}
                onClick={() => {
                  if (isPlaying) pause();
                  setIsUserSelectModalOpen(true);
                }}
              />
            )}
          </Popover>
          <StepBackwardOutlined className={styles.controlIcon} onClick={prev} />
          <div onClick={togglePlay} style={{ cursor: "pointer" }}>
            {isPlaying ? (
              <PauseCircleFilled
                className={styles.playIcon}
                style={{ color: token.colorPrimary }}
              />
            ) : (
              <PlayCircleFilled
                className={styles.playIcon}
                style={{ color: token.colorPrimary }}
              />
            )}
          </div>
          <StepForwardOutlined className={styles.controlIcon} onClick={next} />
        </div>
        <div className={styles.progressWrapper}>
          <Text type="secondary" style={{ fontSize: "10px" }}>
            {formatDuration(currentTime)}
          </Text>
          <div className={styles.sliderContainer}>
            <Slider
              value={currentTime}
              max={duration || 100}
              onChange={handleSeek}
              tooltip={{ open: false }}
              style={{ flex: 1, margin: 0 }}
              trackStyle={{ backgroundColor: token.colorPrimary }}
              railStyle={{ backgroundColor: token.colorBorder }}
              handleStyle={{ display: "none" }}
            />
            {isLoading && (
              <div
                className={styles.loadingIndicator}
                style={{ color: token.colorPrimary }}
                aria-hidden
              />
            )}
          </div>
          <Text type="secondary" style={{ fontSize: "10px" }}>
            {formatDuration(duration)}
          </Text>
        </div>
      </div>
      {/* Volume & Settings */}
      <div className={styles.settings}>
        {appMode !== TrackType.AUDIOBOOK && currentTrack && hasMv && (
          <VideoCameraOutlined
            onClick={() => {
              if (isPlaying) pause();
              window.location.href = `#/mv?trackId=${currentTrack.id}`;
            }}
            className={styles.settingIcon}
            style={{ fontSize: "18px" }}
          />
        )}
        {appMode !== TrackType.AUDIOBOOK &&
          currentTrack &&
          (currentTrack.likedByUsers?.find(
            (n) => n.userId === (user?.id || 0),
          ) ? (
            <HeartFilled
              onClick={() => toggleLike(currentTrack.id, "unlike")}
              className={styles.settingIcon}
            />
          ) : (
            <HeartOutlined
              onClick={() => toggleLike(currentTrack.id, "like")}
              className={styles.settingIcon}
            />
          ))}
        {/* Play Order */}
        {renderPlayOrderButton()}

        {appMode === TrackType.AUDIOBOOK && (
          <Popover
            content={
              <Flex vertical justify="center" gap="16px">
                <Flex align="center" justify="space-between">
                  <Flex align="center" gap={8}>
                    <Icon
                      component={ClockOutlined}
                      style={{ fontSize: "24px", fontWeight: "bold" }}
                    />
                    <Text>{t("player.sleepTimer")}</Text>
                    {sleepTimerMode === "time" && (
                      <Text>
                        {t("common.remaining")}
                        {formatDuration(
                          (sleepTimerEndTime! - Date.now()) / 1000,
                        )}
                      </Text>
                    )}
                    {sleepTimerMode === "time" && (
                      <Button
                        onClick={() => {
                          setSleepTimerMode("off");
                          setTimerDuration(0);
                        }}
                        size="small"
                      >
                        {t("common.cancelTimer")}
                      </Button>
                    )}
                  </Flex>
                </Flex>
                <Flex>
                  <Slider
                    style={{ width: "300px" }}
                    min={0}
                    max={150}
                    step={1}
                    value={timerDuration}
                    onChange={(val) => setTimerDuration(val)}
                    onChangeComplete={(val) => {
                      if (val > 0) {
                        setSleepTimerMode("time");
                        setSleepTimerEndTime(Date.now() + val * 60 * 1000);
                        trackEvent({
                          feature: "player",
                          eventName: "sleep_timer_set",
                          userId: user?.id ? String(user.id) : undefined,
                          deviceId: device?.id ? String(device.id) : undefined,
                          value: val,
                        });
                      } else {
                        setSleepTimerMode("off");
                      }
                    }}
                    tooltip={{
                      formatter: (val) => `${val} ${t("player.minutes")}`,
                    }}
                  />
                </Flex>

                {/* <Flex align="center" justify="space-between">
                  <Flex align="center">
                    <Icon
                      component={MusiclistOutlined}
                      style={{ fontSize: "24px", fontWeight: "bold" }}
                    />
                    <Text style={{ marginLeft: 8 }}>{t("player.episodeTimer")}</Text>
                    {sleepTimerMode === "count" && <Text>{t("player.timerActive")}</Text>}
                  </Flex>
                </Flex>
                <Flex>
                  <Slider
                    style={{ width: "200px" }}
                    min={0}
                    max={10}
                    step={1}
                    value={sleepTimerCount}
                    onChangeComplete={(val) => {
                      console.log(val);
                        setSleepTimerMode("count");
                        setSleepTimerCount(val);
                    }}
                    tooltip={{ formatter: (val) => `${val} ${t("player.episodes")}` }}
                  />
                </Flex>
                <Button
                  block
                  type={sleepTimerMode === "current" ? "primary" : "default"}
                  onClick={() => {
                    if (sleepTimerMode === "current") {
                      setSleepTimerMode("off");
                    } else {
                      setSleepTimerMode("current");
                      message.success(t('player.willStopAfterCurrent'));
                    }
                  }}
                >
                  {sleepTimerMode === "current"
                    ? t('player.cancelAfterCurrent')
                    : t('player.afterCurrent')}
                </Button> */}
              </Flex>
            }
            trigger="click"
            placement="top"
          >
            <Tooltip title={t("player.sleepTimer")}>
              <Icon
                component={ClockOutlined}
                className={styles.settingIcon}
                style={{ fontSize: "24px", fontWeight: "bold" }}
              />
            </Tooltip>
          </Popover>
        )}

        {/* Speed Selector */}
        {appMode === TrackType.AUDIOBOOK && (
          <Popover
            content={
              <Flex vertical gap={4}>
                {[0.5, 1, 1.25, 1.5, 2, 3].map((rate) => (
                  <Button
                    key={rate}
                    type={playbackRate === rate ? "primary" : "text"}
                    onClick={() => setPlaybackRate(rate)}
                    size="small"
                  >
                    {rate}x
                  </Button>
                ))}
              </Flex>
            }
            trigger="click"
            placement="top"
          >
            <Tooltip title={t("player.playbackSpeed")}>
              <div className={styles.playbackRateIcon}>
                {playbackRate}
                {t("common.times")}
              </div>
            </Tooltip>
          </Popover>
        )}

        {appMode === TrackType.MUSIC && (
          <Tooltip title={t("player.desktopLyrics")}>
            <div
              className={`${styles.lyricButton} ${
                desktopLyricEnable ? styles.activeLyricButton : ""
              }`}
              style={{
                color: desktopLyricEnable ? token.colorPrimary : "inherit",
              }}
              onClick={handleDesktopLyricToggle}
            >
              词
            </div>
          </Tooltip>
        )}

        {/* Mi Speaker (XiaoAi) Devices */}
        <Popover
          content={
            <Flex
              vertical
              style={{ width: 280, maxHeight: 320, overflow: "auto" }}
            >
              <Text strong style={{ marginBottom: 8 }}>
                {t("player.miSpeakerTitle")}
              </Text>
              {isMiDevicesLoading ? (
                <Text type="secondary">{t("common.loading")}</Text>
              ) : miAuthStatus?.logged_in ? (
                // 已登录：展示设备列表
                miDevices.length === 0 ? (
                  <Text type="secondary">{t("player.noMiDevices")}</Text>
                ) : (
                  <>
                    <List
                      size="small"
                      dataSource={miDevices}
                      renderItem={(device) => (
                        <List.Item
                          style={{
                            cursor:
                              currentTrack && !isCastingToMi
                                ? "pointer"
                                : "not-allowed",
                          }}
                          onClick={() => {
                            if (!currentTrack || isCastingToMi) return;
                            handleCastToMi(device.device_id, device.name);
                          }}
                        >
                          <List.Item.Meta
                            avatar={
                              <Avatar
                                size={32}
                                style={{ backgroundColor: token.colorPrimary }}
                                icon={
                                  <XiaoAiOutlined
                                    style={{
                                      width: 20,
                                      height: 20,
                                      color: token.colorTextLightSolid,
                                    }}
                                  />
                                }
                              />
                            }
                            title={device.name}
                            description={device.model}
                          />
                        </List.Item>
                      )}
                    />
                  </>
                )
              ) : miQRCode?.qrcode_url ? (
                // 未登录：展示二维码
                <Flex vertical align="center" gap="12px">
                  <Text type="secondary">{t("player.miLoginRequired")}</Text>
                  <img
                    src={miQRCode.qrcode_url}
                    alt="小米扫码登录"
                    style={{ width: 180, height: 180, borderRadius: 8 }}
                  />
                  <Text type="secondary" style={{ fontSize: "12px" }}>
                    {t("player.miScanQRCode")}
                  </Text>
                </Flex>
              ) : (
                <Text type="secondary">{t("player.miLoginRequired")}</Text>
              )}
            </Flex>
          }
          trigger="click"
          placement="top"
          open={isMiDevicesPopoverOpen}
          onOpenChange={(open) => {
            setIsMiDevicesPopoverOpen(open);
            if (open) {
              handleLoadMiDevices();
            } else {
              // 关闭时停止轮询
              if (miPollingTimerRef.current) {
                clearInterval(miPollingTimerRef.current);
                miPollingTimerRef.current = null;
              }
            }
          }}
        >
          <Tooltip title={t("player.miSpeaker")}>
            <XiaoAiOutlined
              className={styles.settingIcon}
              style={{ width: 18, height: 18 }}
            />
          </Tooltip>
        </Popover>

        {/* Volume */}
        <Popover
          content={
            <Flex vertical justify="center">
              <Text style={{ fontSize: "12px" }}>
                {t("player.volume")}: {volume}%
              </Text>
              <Slider
                style={{ width: "100px" }}
                value={volume}
                max={100}
                onChange={setVolume}
              />
            </Flex>
          }
          trigger="click"
          placement="top"
        >
          <Tooltip title={t("player.volume")}>
            <SoundOutlined className={styles.settingIcon} />
          </Tooltip>
        </Popover>

        {/* Skip Intro - Only in Audiobook mode */}
        {appMode === TrackType.AUDIOBOOK && (
          <Popover
            content={
              <div style={{ width: "250px", padding: "10px" }}>
                <div style={{ marginBottom: "15px" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "5px",
                    }}
                  >
                    <span>
                      {t("player.skipIntro")}: {skipStart}s
                    </span>
                  </div>
                  <Slider
                    value={skipStart}
                    onChange={setSkipStart}
                    max={90}
                    tooltip={{ formatter: (value) => `${value}s` }}
                  />
                </div>
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "5px",
                    }}
                  >
                    <span>
                      {t("player.skipOutro")}: {skipEnd}s
                    </span>
                  </div>
                  <Slider
                    value={skipEnd}
                    onChange={setSkipEnd}
                    max={90}
                    tooltip={{ formatter: (value) => `${value}s` }}
                  />
                </div>
              </div>
            }
            trigger="click"
            placement="top"
          >
            <Tooltip title={t("player.skipIntroOutro")}>
              <DeliveredProcedureOutlined className={styles.settingIcon} />
            </Tooltip>
          </Popover>
        )}

        <UserSelectModal
          visible={isUserSelectModalOpen}
          onCancel={() => setIsUserSelectModalOpen(false)}
          onSessionStart={() => {
            setIsUserSelectModalOpen(false);
            play();
          }}
        />

        {/* Playlist Modal */}

        {/* Playlist */}
        {renderPlaylistButton(styles.settingIcon)}
      </div>
    </>
  );

  // Set sleep timer
  const setSleepTimer = () => {
    // ... exist logic
  };

  const handleDesktopLyricToggle = () => {
    const { enable } = useSettingsStore.getState().desktopLyric;
    updateDesktopLyric("enable", !enable);
  };

  useEffect(() => {
    if (isTauri()) {
      let unlisten: (() => void) | undefined;
      listen("lyric:toggle", () => handleDesktopLyricToggle()).then((fn) => {
        unlisten = fn;
      });
      return () => {
        if (unlisten) unlisten();
      };
    }
  }, []);

  useEffect(() => {
    // Initial sync of desktop lyric window on mount
    const { enable } = useSettingsStore.getState().desktopLyric;
    if (enable && appMode === TrackType.MUSIC && isTauri()) {
      invoke("create_lyric_window").catch(console.error);
    }
  }, []);

  const openAddToPlaylistModal = async (e: React.MouseEvent, track: Track) => {
    e.stopPropagation();
    setSelectedTrack(track);
    setIsAddToPlaylistModalOpen(true);
    try {
      const res = await getPlaylists(appMode, user?.id);
      if (res.code === 200) {
        setPlaylists(res.data);
      }
    } catch (error) {
      console.error(error);
      message.error(t("player.getPlaylistsFailed"));
    }
  };

  const handleAddToPlaylist = async (playlistId: number | string) => {
    if (!selectedTrack) return;
    try {
      const res = await addTrackToPlaylist(playlistId, selectedTrack.id);
      if (res.code === 200) {
        message.success(t("common.addedToPlaylist"));
        setIsAddToPlaylistModalOpen(false);
      } else {
        message.error(t("common.addToPlaylistFailed"));
      }
    } catch (error) {
      message.error(t("common.addToPlaylistFailed"));
    }
  };

  const handleDeleteSubTrack = async (track: Track) => {
    try {
      const { data: impact } = await getDeletionImpact(track.id);

      modalApi.confirm({
        title: t("player.confirmDelete"),
        content: impact?.isLastTrackInAlbum
          ? t("player.deleteLastTrackInAlbum", { albumName: impact.albumName })
          : t("player.deleteWarning"),
        okText: t("common.delete"),
        okType: "danger",
        cancelText: t("common.cancel"),
        onOk: async () => {
          try {
            const res = await deleteTrack(track.id, impact?.isLastTrackInAlbum);
            if (res.code === 200) {
              message.success(t("player.deleteSuccess"));
              removeTrack(track.id);
            } else {
              message.error(t("player.deleteFailed"));
            }
          } catch (error) {
            message.error(t("player.deleteFailed"));
          }
        },
      });
    } catch (error) {
      message.error(t("player.getDeletionImpactFailed"));
    }
  };

  const handleLoadMiDevices = async () => {
    setIsMiDevicesLoading(true);
    try {
      // 先检查登录状态
      const authRes = await getMiAuthStatus();
      setMiAuthStatus(authRes);

      if (authRes.logged_in) {
        const res = await getMiDevices();
        setMiDevices(res.devices || []);
      } else {
        // 未登录，获取二维码
        const qrRes = await getMiQRCode();
        setMiQRCode(qrRes);
        if (qrRes.already_logged_in) {
          // 已登录但状态不同步，重新加载设备
          const res = await getMiDevices();
          setMiDevices(res.devices || []);
        } else if (qrRes.status_url) {
          // 开始轮询扫码状态
          startMiQRPolling(qrRes.status_url);
        }
      }
    } catch (error) {
      console.error("Failed to load Mi devices:", error);
      message.error(t("player.loadMiDevicesFailed"));
      setMiDevices([]);
    } finally {
      setIsMiDevicesLoading(false);
    }
  };

  const handleCastToMi = async (deviceId: string, deviceName: string) => {
    if (!currentTrack) {
      message.warning(t("player.miCastNoTrack"));
      return;
    }
    setIsCastingToMi(true);
    try {
      const url = buildTrackPlaybackUrl(currentTrack, currentAudioQuality);
      const title = `${currentTrack.name} - ${currentTrack.artist}`;
      await playMiDeviceByUrl({ device_id: deviceId, url, title });
      if (isPlaying) {
        pause();
      }
      message.success(t("player.miCastSuccess", { device: deviceName }));
      setIsMiDevicesPopoverOpen(false);
    } catch (error) {
      console.error("Failed to cast to Mi device:", error);
      message.error(t("player.miCastFailed"));
    } finally {
      setIsCastingToMi(false);
    }
  };

  const startMiQRPolling = (lpUrl: string) => {
    // 清除之前的轮询
    if (miPollingTimerRef.current) {
      clearInterval(miPollingTimerRef.current);
      miPollingTimerRef.current = null;
    }

    // 每 3 秒轮询一次
    miPollingTimerRef.current = setInterval(async () => {
      try {
        const statusRes = await getMiQRCodeStatus(lpUrl);
        if (statusRes.status === "success") {
          // 扫码成功，停止轮询，重新加载设备
          if (miPollingTimerRef.current) {
            clearInterval(miPollingTimerRef.current);
            miPollingTimerRef.current = null;
          }
          message.success(t("player.miLoginSuccess"));
          setMiAuthStatus({ logged_in: true });
          const res = await getMiDevices();
          setMiDevices(res.devices || []);
        } else if (
          statusRes.status === "expired" ||
          statusRes.status === "error"
        ) {
          // 二维码过期或错误，停止轮询
          if (miPollingTimerRef.current) {
            clearInterval(miPollingTimerRef.current);
            miPollingTimerRef.current = null;
          }
          setMiQRCode(null);
        }
      } catch (error) {
        console.error("QR polling error:", error);
      }
    }, 3000);
  };

  // 清理轮询定时器
  useEffect(() => {
    return () => {
      if (miPollingTimerRef.current) {
        clearInterval(miPollingTimerRef.current);
      }
    };
  }, []);

  const renderPlayOrderButton = () => {
    if (isRadioMode) return null;
    return (
      <Popover
        content={
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "5px",
              padding: "0px",
            }}
          >
            <div
              onClick={() => setMode("sequence")}
              style={{
                cursor: "pointer",
                padding: "8px 12px",
                borderRadius: "4px",
                backgroundColor:
                  playMode === "sequence"
                    ? token.colorFillTertiary
                    : "transparent",
              }}
            >
              <Flex align="center">
                <Icon
                  component={MusiclistOutlined}
                  style={{ fontSize: "24px", fontWeight: "bold" }}
                />
                {t("player.sequencePlay")}
              </Flex>
            </div>
            <div
              onClick={() => setMode("shuffle")}
              style={{
                cursor: "pointer",
                padding: "8px 12px",
                borderRadius: "4px",
                backgroundColor:
                  playMode === "shuffle"
                    ? token.colorFillTertiary
                    : "transparent",
              }}
            >
              <Flex align="center">
                <Icon
                  component={RandomOutlined}
                  style={{ fontSize: "24px", fontWeight: "bold" }}
                />
                {t("player.shufflePlay")}
              </Flex>
            </div>
            <div
              onClick={() => setMode("loop")}
              style={{
                cursor: "pointer",
                padding: "8px 12px",
                borderRadius: "4px",
                backgroundColor:
                  playMode === "loop" ? token.colorFillTertiary : "transparent",
              }}
            >
              <Flex align="center">
                <Icon
                  component={LoopOutlined}
                  style={{ fontSize: "24px", fontWeight: "bold" }}
                />
                {t("player.loopList")}
              </Flex>
            </div>
            <div
              onClick={() => setMode("single")}
              style={{
                cursor: "pointer",
                padding: "8px 12px",
                borderRadius: "4px",
                backgroundColor:
                  playMode === "single"
                    ? token.colorFillTertiary
                    : "transparent",
              }}
            >
              <Flex align="center">
                <Icon
                  component={SinglecycleOutlined}
                  style={{ fontSize: "24px", fontWeight: "bold" }}
                />
                {t("player.singleLoop")}
              </Flex>
            </div>
          </div>
        }
        getPopupContainer={(triggerNode) => triggerNode.parentElement!}
        trigger="click"
        placement="top"
      >
        <Tooltip title={t("player.playOrder")}>
          {playMode === "sequence" ? (
            <Icon
              component={MusiclistOutlined}
              style={{ fontSize: "24px", fontWeight: "bold" }}
            />
          ) : playMode === "shuffle" ? (
            <Icon
              component={RandomOutlined}
              style={{ fontSize: "24px", fontWeight: "bold" }}
            />
          ) : playMode === "loop" ? (
            <Icon
              component={LoopOutlined}
              style={{ fontSize: "24px", fontWeight: "bold" }}
            />
          ) : playMode === "single" ? (
            <Icon
              component={SinglecycleOutlined}
              style={{ fontSize: "24px", fontWeight: "bold" }}
            />
          ) : null}
        </Tooltip>
      </Popover>
    );
  };

  const renderPlaylistButton = (className: string) => {
    if (isRadioMode) return null;
    return (
      <Tooltip title={t("player.playlist")}>
        <OrderedListOutlined
          onClick={() => setIsPlaylistOpen(true)}
          className={className}
        />
      </Tooltip>
    );
  };

  if (!currentTrack?.id) {
    // 车机模式下即使暂无播放也要保持 <audio> 挂载，避免退出播放后整个音频链路被卸载
    if (hideMiniPlayer) {
      return (
        <audio
          ref={audioRef}
          preload="auto"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
        />
      );
    }
    return <></>;
  }

  return (
    <div
      className={styles.player}
      style={{ color: token.colorText, borderRightColor: token.colorBorder }}
    >
      <audio
        ref={audioRef}
        // 注意：src 不通过 JSX 绑定，否则 React 重渲染可能触发 audio 重载并把 currentTime 重置为 0。
        // src 完全由下面的 useEffect（play/pause/src 同步）控制。
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => setIsLoading(false)}
        onCanPlay={() => setIsLoading(false)}
      />

      {!isFullPlayerVisible && !hideMiniPlayer && (
        <div className={styles.miniPlayer}>{renderMiniPlayer(true)}</div>
      )}
      <Drawer
        placement="bottom"
        height="100%"
        open={isFullPlayerVisible}
        onClose={() => setIsFullPlayerVisible(false)}
        zIndex={1100}
        classNames={{ body: styles.fullPlayerBody }}
        styles={{
          header: { display: "none" },
        }}
        closeIcon={null}
        destroyOnClose={false}
      >
        <div className={styles.fullPlayerContent}>
          {/* Close Button */}
          <div className={styles.fullPlayerClose}>
            <DownOutlined
              onClick={() => setIsFullPlayerVisible(false)}
              className={styles.fullPlayerCloseIcon}
            />
          </div>

          {/* Left Side - Cover (1/3) */}
          <div className={styles.fullPlayerLeft}>
            {/* Background Blur Effect */}
            {/* <div
                className={styles.fullPlayerBackground}
                style={{ backgroundImage: drawerBgImage }}
              /> */}

            <Flex vertical align="center" gap={20}>
              <div
                className={
                  coverStyle === "vinyl"
                    ? `${styles.fullPlayerCoverVinyl} ${
                        isPlaying ? styles.spinning : ""
                      }`
                    : styles.fullPlayerCoverSquare
                }
              >
                <LazyImage
                  src={resolveArtworkUri(currentTrack, { width: 600, format: "webp", quality: 80 })}
                  alt="Current Cover"
                  // 方形封面固定最大 220px；黑胶模式由 .fullPlayerCoverVinyl 容器(320px)控制尺寸，保持 100%
                  width={coverStyle === "vinyl" ? "100%" : 220}
                  height={coverStyle === "vinyl" ? "100%" : 220}
                  style={coverStyle === "vinyl" ? undefined : { maxWidth: "100%" }}
                  className={styles.fullPlayerCover}
                />
                {coverStyle === "vinyl" && tonearm === "basic" && (
                  <div
                    className={`${styles.tonearm} ${
                      isPlaying ? styles.tonearmPlaying : styles.tonearmPaused
                    }`}
                    aria-hidden
                  >
                    <div className={styles.tonearmPivot} />
                    <div className={styles.tonearmArm}>
                      <div className={styles.tonearmHead} />
                    </div>
                  </div>
                )}
              </div>
            </Flex>
          </div>

          {/* Right Side - Info & Playlist/Lyrics (2/3) */}
          <div
            className={styles.fullPlayerRight}
            style={{
              textAlign: appMode !== TrackType.MUSIC ? "left" : "center",
            }}
          >
            {/* Top: Title */}
            <div
              style={
                {
                  marginBottom: "24px",
                  textAlign: "var(--ad-detail-lyrics-align, inherit)",
                } as unknown as React.CSSProperties
              }
            >
              <Title level={3} style={{ margin: "0 0 10px 0" }}>
                {currentTrack?.name || "No Track"}
              </Title>
              <Text type="secondary">
                <Flex
                  justify={appMode !== TrackType.MUSIC ? "start" : "center"}
                  gap={16}
                  style={{
                    justifyContent:
                      "var(--ad-detail-lyrics-justify, " +
                      (appMode !== TrackType.MUSIC ? "flex-start" : "center") +
                      ")",
                  }}
                >
                  <Flex
                    align="center"
                    justify={appMode !== TrackType.MUSIC ? "start" : "center"}
                    gap={8}
                    style={{
                      cursor: "pointer",
                      justifyContent:
                        "var(--ad-detail-lyrics-justify, " +
                        (appMode !== TrackType.MUSIC ? "flex-start" : "center") +
                        ")",
                    }}
                    onClick={() => {
                      setIsFullPlayerVisible(false);
                      navigator(`/artist/${currentTrack?.artistEntity?.id}`);
                    }}
                  >
                    <LazyImage
                      src={resolveArtworkUri(
                        {
                          cover: currentTrack?.artistEntity?.avatar,
                          id: currentTrack?.id,
                          name: currentTrack?.artist,
                        } as any,
                        { width: 30, format: "webp" },
                      )}
                      alt="Current Cover"
                      width={15}
                      height={15}
                      style={{ borderRadius: "50%" }}
                    />
                    <Text ellipsis className={styles.artistText}>
                      {currentTrack?.artist || "Unknown Artist"}
                    </Text>
                    {currentTrack?.type !== TrackType.AUDIOBOOK && (
                      <button
                        type="button"
                        className={`${styles.qualityButton} ${
                          availableAudioQualities.length <= 1
                            ? styles.qualityButtonDisabled
                            : ""
                        }`}
                        style={{ color: token.colorTextSecondary }}
                        onClick={(event) => {
                          event.stopPropagation();
                          void cycleAudioQuality();
                        }}
                        disabled={availableAudioQualities.length <= 1}
                      >
                        {availableAudioQualities.find(
                          (item) => item.quality === currentAudioQuality,
                        )?.label || "无损"}
                      </button>
                    )}
                  </Flex>
                  <Flex
                    align="center"
                    justify={appMode !== TrackType.MUSIC ? "start" : "center"}
                    gap={8}
                    style={{
                      cursor: "pointer",
                      justifyContent:
                        "var(--ad-detail-lyrics-justify, " +
                        (appMode !== TrackType.MUSIC ? "flex-start" : "center") +
                        ")",
                    }}
                    onClick={() => {
                      setIsFullPlayerVisible(false);
                      navigator(`/detail?id=${currentTrack?.albumEntity?.id}`);
                    }}
                  >
                    <LazyImage
                      src={resolveArtworkUri(
                        {
                          cover: currentTrack?.albumEntity?.cover,
                          id: currentTrack?.id,
                          name: currentTrack?.album,
                        } as any,
                        { width: 30, format: "webp" },
                      )}
                      alt="Current Cover"
                      width={15}
                      height={15}
                      style={{ borderRadius: "1px" }}
                    />
                    <Text ellipsis>
                      {currentTrack?.album || "Unknown Album"}
                    </Text>
                  </Flex>
                </Flex>
              </Text>
            </div>

            {/* Tab Switcher - Only for non-MUSIC mode */}
            {appMode !== TrackType.MUSIC && (
              <div className={styles.tabHeader}>
                <Tabs
                  activeKey={activeTab}
                  onChange={(e) => setActiveTab(e as "playlist" | "lyrics")}
                  tabBarExtraContent={
                    activeTab === "playlist" ? (
                      <Button
                        type="text"
                        icon={<AimOutlined />}
                        onClick={handleLocateFullTrack}
                        title={t("player.locateCurrentTrack")}
                      />
                    ) : undefined
                  }
                  items={[
                    { key: "lyrics", label: t("player.lyrics") },
                    {
                      key: "playlist",
                      label: t("player.playlistCount", {
                        count: playlist.length,
                      }),
                    },
                  ].filter((item) => item.key !== "lyrics")}
                />
              </div>
            )}

            {/* Content */}
            <div
              style={{
                flex: 1,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {appMode === TrackType.MUSIC ? (
                <Lyrics
                  lyrics={currentTrack?.lyrics || null}
                  currentTime={currentTime}
                />
              ) : activeTab === "playlist" ? (
                <div
                  style={{ flex: 1, overflowY: "auto", paddingRight: "10px" }}
                >
                  <QueueList
                    ref={fullQueueListRef}
                    tracks={playlist}
                    currentTrack={currentTrack}
                    isPlaying={isPlaying}
                    hasMore={playlistSource?.hasMore}
                    isLoadingMore={isLoadingMore}
                    onLoadMore={loadMoreSourceTracks}
                    onPuse={pause}
                    onPlay={handlePlay}
                    onAddToPlaylist={openAddToPlaylistModal}
                    onToggleLike={(_, track, type) =>
                      toggleLike(track.id, type)
                    }
                    onDelete={handleDeleteSubTrack}
                  />
                </div>
              ) : (
                <Lyrics
                  lyrics={currentTrack?.lyrics || null}
                  currentTime={currentTime}
                />
              )}
            </div>
          </div>
        </div>
        <div className={styles.miniPlayer}>{renderMiniPlayer(false)}</div>
      </Drawer>

      {modalContextHolder}
      {notificationContextHolder}

      <Drawer
        title={t("player.playlistTitle")}
        placement="right"
        open={isPlaylistOpen}
        width={"50%"}
        zIndex={1200}
        onClose={() => setIsPlaylistOpen(false)}
        extra={
          <Button
            type="text"
            icon={<AimOutlined />}
            onClick={handleLocateTrack}
            title={t("player.locateCurrentTrack")}
          />
        }
      >
        <QueueList
          ref={queueListRef}
          tracks={playlist}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          hasMore={playlistSource?.hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadMoreSourceTracks}
          onPuse={pause}
          onPlay={handlePlay}
          onAddToPlaylist={openAddToPlaylistModal}
          onToggleLike={(_, track, type) => toggleLike(track.id, type)}
          onDelete={handleDeleteSubTrack}
        />
      </Drawer>

      {/* Timer Modal */}
      <Modal
        title={t("player.sleepTimer")}
        open={isTimerModalOpen}
        zIndex={1300}
        onCancel={() => setIsTimerModalOpen(false)}
        onOk={setSleepTimer}
        okText={t("common.confirm")}
        cancelText={t("common.cancel")}
      >
        <Flex vertical gap={16} style={{ padding: "20px 0" }}>
          <Text>{t("player.setTimerPrompt")}</Text>
          <InputNumber
            min={1}
            max={180}
            value={timerMinutes}
            onChange={(value: number | null) => setTimerMinutes(value || 30)}
            addonAfter={t("player.minutes")}
            style={{ width: "100%" }}
          />
        </Flex>
      </Modal>

      <Modal
        title={t("player.addToPlaylist")}
        open={isAddToPlaylistModalOpen}
        zIndex={1400}
        onCancel={() => setIsAddToPlaylistModalOpen(false)}
        footer={null}
      >
        <List
          dataSource={playlists}
          renderItem={(item) => (
            <List.Item
              onClick={() => handleAddToPlaylist(item.id)}
              style={{ cursor: "pointer" }}
              className={styles.playlistItem}
            >
              <Text>{item.name}</Text>
              <Text type="secondary">
                {t("player.trackCount", { count: item._count?.tracks || 0 })}
              </Text>
            </List.Item>
          )}
        />
      </Modal>
    </div>
  );
};

export default Player;
