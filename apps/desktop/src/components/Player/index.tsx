import Icon, {
  AimOutlined,
  BackwardOutlined,
  DeliveredProcedureOutlined,
  DownOutlined,
  FontColorsOutlined,
  ForwardOutlined,
  HeartFilled,
  HeartOutlined,
  OrderedListOutlined,
  PauseCircleFilled,
  PlayCircleFilled,
  SoundOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import {
  addToHistory,
  addTrackToPlaylist,
  deleteTrack,
  getDeletionImpact,
  getLatestHistory,
  getPlaylists,
  type Playlist,
} from "@soundx/services";
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
import { useNavigate } from "react-router-dom";
import ClockOutlined from "../../assets/clock.svg?react";
import LoopOutlined from "../../assets/loop.svg?react";
import MusiclistOutlined from "../../assets/musiclist.svg?react";
import RandomOutlined from "../../assets/random.svg?react";
import SinglecycleOutlined from "../../assets/singlecycle.svg?react";
import { useMessage } from "../../context/MessageContext";
import { useMediaSession } from "../../hooks/useMediaSession";
import { getBaseURL } from "../../https";
import { type Album, type Device, type Track, TrackType } from "../../models";
import { socketService } from "../../services/socket";
import {
  resolveArtworkUri,
  resolveTrackUri,
} from "../../services/trackResolver";
import { useAuthStore } from "../../store/auth";
import { usePlayerStore } from "../../store/player";
import { useSettingsStore } from "../../store/settings";
import { useSyncStore } from "../../store/sync";
import { formatDuration } from "../../utils/formatDuration";
import { usePlayMode } from "../../utils/playMode";
import PlayingIndicator from "../PlayingIndicator";
import UserSelectModal from "../UserSelectModal";
import styles from "./index.module.less";
import Lyrics from "./Lyrics";
import { QueueList, type QueueListRef } from "./QueueList";

const { Text, Title } = Typography;

const Player: React.FC = () => {
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
  const { user } = useAuthStore();
  const { updateDesktopLyric } = useSettingsStore();
  const desktopLyricEnable = useSettingsStore(
    (state) => state.desktopLyric.enable,
  );

  // Sync store active mode with app mode
  useEffect(() => {
    syncActiveMode(appMode);
  }, [appMode, syncActiveMode]);

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

  const navigator = useNavigate();

  const [modalApi, modalContextHolder] = Modal.useModal();
  const [notificationApi, notificationContextHolder] =
    notification.useNotification();

  const queueListRef = useRef<QueueListRef>(null);
  const fullQueueListRef = useRef<QueueListRef>(null);

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

    // 1. Determine initial URI synchronously to avoid playing previous song
    let initialUri = "";
    if (currentTrack.path) {
      initialUri = currentTrack.path.startsWith("http")
        ? currentTrack.path
        : `${getBaseURL()}${currentTrack.path}`;

      if (!initialUri.startsWith("http")) {
        initialUri = `${window.location.origin}${initialUri}`;
      }
    } else if ((currentTrack as any).localPath) {
      initialUri = `media://audio/${(currentTrack as any).localPath}`;
    }

    setResolvedUri(initialUri || undefined);

    // 2. Resolve for cache (will upgrade to media:// if cached)
    resolveTrackUri(currentTrack, { cacheEnabled }).then((uri) => {
      // Only update if we still have the same track
      const state = usePlayerStore.getState();
      if (uri && state.currentTrack?.id === currentTrack.id) {
        setResolvedUri(uri);
      }
    });
  }, [currentTrack?.id, cacheEnabled]);
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
        const deviceName =
          (await window.ipcRenderer?.getName()) || window.navigator.userAgent;
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
              message: "发现其他设备播放记录",
              description: (
                <div>
                  <p>
                    上次使用设备 <b>{history.deviceName}</b> 播放了
                  </p>
                  {history.track && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 12,
                        padding: 8,
                        background: "rgba(255,255,255,0.05)",
                        borderRadius: 4,
                      }}
                    >
                      {history.track.cover && (
                        <img
                          src={`${getCoverUrl(history.track)}`}
                          alt="cover"
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 4,
                            objectFit: "cover",
                          }}
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
                  <p>从 {formatDuration(history.progress)} 继续播放吗？</p>
                </div>
              ),
              key,
              btn: (
                <Space style={{ marginTop: 8 }}>
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => {
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
                    继续播放
                  </Button>
                  <Button
                    size="small"
                    onClick={() => notificationApi.destroy(key)}
                  >
                    忽略
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
      message.info("对方已结束同步播放");
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
        `${payload.username} (${payload.deviceName}) 离开了同步播放`,
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
      title: "结束同步播放",
      content: "确定要断开连接吗？对方将收到断开提示。",
      okText: "确定",
      cancelText: "取消",
      onOk: () => {
        if (sessionId) {
          socketService.emit("player_left", { sessionId });
          setSynced(false, null);
          setParticipants([]);
          message.success("已结束同步播放");
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
        if (appMode === TrackType.AUDIOBOOK && skipStart > 0 && targetTime < skipStart) {
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
    localStorage.setItem("playOrder", playMode);
  }, [playMode]);

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

  const device: Device = JSON.parse(localStorage.getItem("device") || "{}");

  useEffect(() => {
    if (currentTrack) {
      (async () => {
        const deviceName =
          (await window.ipcRenderer?.getName()) || window.navigator.userAgent;
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
        const deviceName =
          (await window.ipcRenderer?.getName()) || window.navigator.userAgent;
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
      if (
        (window as any).ipcRenderer &&
        now - lastTimeUpdateRef.current > 250
      ) {
        (window as any).ipcRenderer.send("player:update", {
          currentTime: time,
          duration: duration || audioRef.current.duration,
          isPlaying: !audioRef.current.paused,
        });
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
      if (appMode === TrackType.AUDIOBOOK && skipStart > 0 && startTime < skipStart) {
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
          message.success("定时关闭已触发");
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
      message.success("播放已结束 (定时关闭)");
      return;
    }

    if (sleepTimerMode === "count") {
      if (sleepTimerCount <= 1) {
        pause();
        setSleepTimerMode("off");
        setSleepTimerCount(0);
        message.success("定时关闭已触发");
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
    if (window.ipcRenderer) {
      window.ipcRenderer.send("player:update", {
        track: currentTrack
          ? {
              id: currentTrack.id,
              name: currentTrack.name,
              artist: currentTrack.artist,
              album: currentTrack.album,
              cover: currentTrack.cover,
            }
          : null,
        isPlaying,
      });
    }
    // Update main process for desktop lyrics
    if (window.ipcRenderer) {
      window.ipcRenderer.send("player:update", {
        isPlaying,
        track: currentTrack
          ? {
              id: currentTrack.id,
              name: currentTrack.name,
              artist: currentTrack.artist,
              album: currentTrack.album,
              cover: currentTrack.cover,
            }
          : null,
      });
    }
  }, [currentTrack, isPlaying]);

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
      if (window.ipcRenderer) {
        window.ipcRenderer.send("lyric:update", { currentLyric: "" });
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
    if (parsedLyrics.length === 0 || !window.ipcRenderer) return;

    let index = parsedLyrics.findIndex((line) => line.time > currentTime) - 1;
    if (index === -2) index = -1;
    else if (index === -1) index = parsedLyrics.length - 1;

    const currentLineText = index >= 0 ? parsedLyrics[index].text : "";

    // Optimize: Only send if needed (though main process handles diffs usually, better to be chatty or let throttling handle it?
    // Main process throttling might be better, but let's send for now.
    // Ideally we would check if it changed, but we don't store previous sent lyric here easily without ref.
    // Given the frequency of currentTime updates (throttle in main loop?), this runs every time time updates.
    // Actually handleTimeUpdate updates currentTime state.

    window.ipcRenderer.send("lyric:update", {
      currentLyric: currentLineText,
    });
  }, [currentTime, parsedLyrics]);

  // // Create refs for control functions to use in IPC handlers
  // const togglePlayRef = useRef<(() => void) | undefined>(undefined);
  // const nextRef = useRef<(() => void) | undefined>(undefined);
  // const prevRef = useRef<(() => void) | undefined>(undefined);

  // // Update refs when functions change
  // useEffect(() => {
  //   togglePlayRef.current = () => {
  //     const state = usePlayerStore.getState();
  //     if (state.isPlaying) {
  //       state.pause();
  //     } else {
  //       state.play();
  //     }
  //   };
  //   nextRef.current = () => usePlayerStore.getState().next();
  //   prevRef.current = () => usePlayerStore.getState().prev();
  // }, []);

  // Listen for playback control commands from main process
  useEffect(() => {
    if (!window.ipcRenderer) return;

    const handleToggle = () => {
      const state = usePlayerStore.getState();
      if (state.isPlaying) {
        state.pause();
      } else {
        state.play();
      }
    };
    const handleNext = () => usePlayerStore.getState().next();
    const handlePrev = () => usePlayerStore.getState().prev();

    window.ipcRenderer.on("player:toggle", handleToggle);
    window.ipcRenderer.on("player:next", handleNext);
    window.ipcRenderer.on("player:prev", handlePrev);

    return () => {
      window.ipcRenderer.off("player:toggle", handleToggle);
      window.ipcRenderer.off("player:next", handleNext);
      window.ipcRenderer.off("player:prev", handlePrev);
    };
  }, []); // 空依赖数组，只在组件挂载时注册一次

  const togglePlay = () => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  const getCoverUrl = (item?: Track | Album | null) => {
    if (!item) return `https://picsum.photos/seed/0/300/300`;
    return (
      resolveArtworkUri(item) || `https://picsum.photos/seed/${item.id}/300/300`
    );
  };

  // Skip forward 15 seconds
  const skipForward = () => {
    if (audioRef.current) {
      const newTime = Math.min(audioRef.current.currentTime + 15, duration);
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  // Skip backward 15 seconds
  const skipBackward = () => {
    if (audioRef.current) {
      const newTime = Math.max(audioRef.current.currentTime - 15, 0);
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  // Set sleep timer
  const setSleepTimer = () => {
    // ... exist logic
  };

  const handleDesktopLyricToggle = () => {
    const { enable } = useSettingsStore.getState().desktopLyric;
    updateDesktopLyric("enable", !enable);
  };

  useEffect(() => {
    // Initial sync of desktop lyric window on mount
    const { enable } = useSettingsStore.getState().desktopLyric;
    if (enable && appMode === TrackType.MUSIC && window.ipcRenderer) {
      window.ipcRenderer.send("lyric:open");
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
      message.error("获取播放列表失败");
    }
  };

  const handleAddToPlaylist = async (playlistId: number | string) => {
    if (!selectedTrack) return;
    try {
      const res = await addTrackToPlaylist(playlistId, selectedTrack.id);
      if (res.code === 200) {
        message.success("添加成功");
        setIsAddToPlaylistModalOpen(false);
      } else {
        message.error("添加失败");
      }
    } catch (error) {
      message.error("添加失败");
    }
  };

  const handleDeleteSubTrack = async (track: Track) => {
    try {
      const { data: impact } = await getDeletionImpact(track.id);

      modalApi.confirm({
        title: "确定删除该音频文件吗?",
        content: impact?.isLastTrackInAlbum
          ? `这是专辑《${impact.albumName}》的最后一个音频，删除后该专辑也将被同步删除。`
          : "删除后将无法恢复，且会同步删除本地原文件。",
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        onOk: async () => {
          try {
            const res = await deleteTrack(track.id, impact?.isLastTrackInAlbum);
            if (res.code === 200) {
              message.success("删除成功");
              removeTrack(track.id);
            } else {
              message.error("删除失败");
            }
          } catch (error) {
            message.error("删除失败");
          }
        },
      });
    } catch (error) {
      message.error("获取删除影响失败");
    }
  };

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
                顺序播放
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
                随机播放
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
                列表循环
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
                单曲循环
              </Flex>
            </div>
          </div>
        }
        getPopupContainer={(triggerNode) => triggerNode.parentElement!}
        trigger="click"
        placement="top"
      >
        <Tooltip title="播放顺序">
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
      <Tooltip title="播放列表">
        <OrderedListOutlined
          onClick={() => setIsPlaylistOpen(true)}
          className={className}
        />
      </Tooltip>
    );
  };

  if (!currentTrack?.id) {
    return <></>;
  }

  return (
    <div
      className={styles.player}
      style={{ color: token.colorText, borderRightColor: token.colorBorder }}
    >
      <audio
        ref={audioRef}
        src={resolvedUri}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => setIsLoading(false)}
        onCanPlay={() => setIsLoading(false)}
      />

      <div
        className={styles.songInfo}
        onClick={() => setIsFullPlayerVisible(true)}
      >
        <div className={styles.coverWrapper}>
          {currentTrack && (
            <img
              src={getCoverUrl(currentTrack)}
              alt="cover"
              className={styles.coverImage}
              onError={(e) =>
                console.error(
                  `[Player] Mini Cover Load Error: ${currentTrack?.cover}`,
                  e,
                )
              }
            />
          )}
        </div>
        <div className={styles.songDetails}>
          <Text strong ellipsis style={{ maxWidth: 250 }}>
            {currentTrack?.name || "No Track"}
          </Text>
          <Text type="secondary" style={{ fontSize: "12px" }}>
            {currentTrack?.artist || "Unknown Artist"}
          </Text>
        </div>
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.controlButtons}>
          <Popover
            content={
              <List
                size="small"
                header={<Text strong>正在同步播放</Text>}
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
                            ? "(你)"
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
          <Slider
            value={currentTime}
            max={duration || 100}
            onChange={handleSeek}
            tooltip={{ open: false }}
            className={isLoading ? styles.loadingSlider : ""}
            style={{ flex: 1, margin: 0 }}
            trackStyle={{ backgroundColor: token.colorText }}
            railStyle={{ backgroundColor: token.colorBorder }}
            handleStyle={{ display: isLoading ? "block" : "none" }}
          />
          <Text type="secondary" style={{ fontSize: "10px" }}>
            {formatDuration(duration)}
          </Text>
        </div>
      </div>
      {/* Volume & Settings */}
      <div className={styles.settings}>
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
                    <Text>定时关闭</Text>
                    {sleepTimerMode === "time" && (
                      <Text>
                        剩余
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
                        取消定时
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
                      } else {
                        setSleepTimerMode("off");
                      }
                    }}
                    tooltip={{ formatter: (val) => `${val} 分钟` }}
                  />
                </Flex>

                {/* <Flex align="center" justify="space-between">
                  <Flex align="center">
                    <Icon
                      component={MusiclistOutlined}
                      style={{ fontSize: "24px", fontWeight: "bold" }}
                    />
                    <Text style={{ marginLeft: 8 }}>集数定时</Text>
                    {sleepTimerMode === "count" && <Text>定时中</Text>}
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
                    tooltip={{ formatter: (val) => `${val} 集` }}
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
                      message.success("将在当前播放结束后停止");
                    }
                  }}
                >
                  {sleepTimerMode === "current"
                    ? "取消播放完当前"
                    : "播放完当前"}
                </Button> */}
              </Flex>
            }
            trigger="click"
            placement="top"
          >
            <Tooltip title="定时关闭">
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
            <Tooltip title="播放速度">
              <div className={styles.playbackRateIcon}>{playbackRate}倍</div>
            </Tooltip>
          </Popover>
        )}

        {appMode === TrackType.MUSIC && (
          <Tooltip title="桌面歌词">
            <FontColorsOutlined
              className={`${styles.settingIcon} ${
                desktopLyricEnable ? styles.activeIcon : ""
              }`}
              onClick={handleDesktopLyricToggle}
            />
          </Tooltip>
        )}

        {/* Volume */}
        <Popover
          content={
            <Flex vertical justify="center">
              <Text style={{ fontSize: "12px" }}>音量: {volume}%</Text>
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
          <Tooltip title="音量">
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
                    <span>跳过片头：{skipStart}s</span>
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
                    <span>跳过片尾：{skipEnd}s</span>
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
            <Tooltip title="跳过片头/片尾">
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

      {/* Full Screen Player */}
      <Drawer
        placement="bottom"
        height="100%"
        open={isFullPlayerVisible}
        onClose={() => setIsFullPlayerVisible(false)}
        classNames={{ body: styles.fullPlayerBody }}
        styles={{
          header: { display: "none" },
        }}
        closeIcon={null}
      >
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
            <img
              src={getCoverUrl(currentTrack)}
              alt="Current Cover"
              className={styles.fullPlayerCover}
              onError={(e) =>
                console.error(
                  `[Player] Full Cover Load Error: ${currentTrack?.cover}`,
                  e,
                )
              }
            />

            <Flex
              justify="space-between"
              align="center"
              style={{ width: "250px" }}
            >
              <Text type="secondary" style={{ fontSize: "10px" }}>
                {formatDuration(currentTime)}
              </Text>
              <Slider
                value={currentTime}
                max={duration || 100}
                style={{ width: "150px" }}
                onChange={handleSeek}
                className={isLoading ? styles.loadingSlider : ""}
                tooltip={{ open: false }}
                handleStyle={{ display: isLoading ? "block" : "none" }}
              />
              <Text type="secondary" style={{ fontSize: "10px" }}>
                {formatDuration(duration)}
              </Text>
            </Flex>

            <Flex justify="center" style={{ fontSize: 50 }} gap={30}>
              {!isRadioMode &&
                appMode === TrackType.MUSIC &&
                renderPlayOrderButton()}

              {/* Skip Backward 15s */}
              <Tooltip title="后退 15 秒">
                <BackwardOutlined
                  className={styles.controlIcon}
                  onClick={skipBackward}
                />
              </Tooltip>

              <StepBackwardOutlined
                className={styles.controlIcon}
                onClick={prev}
              />
              <div onClick={togglePlay} style={{ cursor: "pointer" }}>
                {isPlaying ? (
                  <PauseCircleFilled className={styles.playIcon} />
                ) : (
                  <PlayCircleFilled className={styles.playIcon} />
                )}
              </div>
              <StepForwardOutlined
                className={styles.controlIcon}
                onClick={next}
              />

              {/* Skip Forward 15s */}
              <Tooltip title="前进 15 秒">
                <ForwardOutlined
                  className={styles.controlIcon}
                  onClick={skipForward}
                />
              </Tooltip>

              {!isRadioMode &&
                appMode === TrackType.MUSIC &&
                renderPlaylistButton(styles.controlIcon)}
            </Flex>
          </Flex>
        </div>

        {/* Right Side - Info & Playlist/Lyrics (2/3) */}
        <div
          className={styles.fullPlayerRight}
          style={{ textAlign: appMode !== TrackType.MUSIC ? "left" : "center" }}
        >
          {/* Top: Title */}
          <div style={{ marginBottom: "24px" }}>
            <Title level={3} style={{ margin: "0 0 10px 0" }}>
              {currentTrack?.name || "No Track"}
            </Title>
            <Text type="secondary">
              <Flex
                justify={appMode !== TrackType.MUSIC ? "start" : "center"}
                gap={16}
              >
                <Flex
                  align="center"
                  justify={appMode !== TrackType.MUSIC ? "start" : "center"}
                  gap={8}
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    setIsFullPlayerVisible(false);
                    navigator(`/artist/${currentTrack?.artistEntity?.id}`);
                  }}
                >
                  <img
                    src={getCoverUrl({
                      cover: currentTrack?.artistEntity?.avatar,
                      id: currentTrack?.id,
                      name: currentTrack?.artist,
                    } as any)}
                    alt="Current Cover"
                    style={{
                      width: "15px",
                      height: "15px",
                      borderRadius: "50%",
                    }}
                  />
                  <Text ellipsis>
                    {currentTrack?.artist || "Unknown Artist"}
                  </Text>
                </Flex>
                <Flex
                  align="center"
                  justify={appMode !== TrackType.MUSIC ? "start" : "center"}
                  gap={8}
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    setIsFullPlayerVisible(false);
                    navigator(`/detail?id=${currentTrack?.albumEntity?.id}`);
                  }}
                >
                  <img
                    src={getCoverUrl({
                      cover: currentTrack?.albumEntity?.cover,
                      id: currentTrack?.id,
                      name: currentTrack?.album,
                    } as any)}
                    alt="Current Cover"
                    style={{
                      width: "15px",
                      height: "15px",
                      borderRadius: "1px",
                    }}
                  />
                  <Text ellipsis>{currentTrack?.album || "Unknown Album"}</Text>
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
                      title="定位到当前播放歌曲"
                    />
                  ) : undefined
                }
                items={[
                  { key: "lyrics", label: "歌词" },
                  { key: "playlist", label: `播放列表 (${playlist.length})` },
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
              <div style={{ flex: 1, overflowY: "auto", paddingRight: "10px" }}>
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
                  onToggleLike={(_, track, type) => toggleLike(track.id, type)}
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
      </Drawer>

      {modalContextHolder}
      {notificationContextHolder}

      <Drawer
        title={`播放列表 (${playlist.length})`}
        placement="right"
        open={isPlaylistOpen}
        width={"50%"}
        onClose={() => setIsPlaylistOpen(false)}
        extra={
          <Button
            type="text"
            icon={<AimOutlined />}
            onClick={handleLocateTrack}
            title="定位到当前播放歌曲"
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
        title="定时关闭"
        open={isTimerModalOpen}
        onCancel={() => setIsTimerModalOpen(false)}
        onOk={setSleepTimer}
        okText="确定"
        cancelText="取消"
      >
        <Flex vertical gap={16} style={{ padding: "20px 0" }}>
          <Text>设置多少分钟后自动暂停播放：</Text>
          <InputNumber
            min={1}
            max={180}
            value={timerMinutes}
            onChange={(value: number | null) => setTimerMinutes(value || 30)}
            addonAfter="分钟"
            style={{ width: "100%" }}
          />
        </Flex>
      </Modal>

      <Modal
        title="添加到播放列表"
        open={isAddToPlaylistModalOpen}
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
              <Text type="secondary">{item._count?.tracks || 0} 首</Text>
            </List.Item>
          )}
        />
      </Modal>
    </div>
  );
};

export default Player;
