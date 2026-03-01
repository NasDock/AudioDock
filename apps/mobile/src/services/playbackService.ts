import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from "react-native";
import TrackPlayer, { Event, State } from 'react-native-track-player';
import {
    startMediaControlBridge,
    subscribeMediaControlBridgeEvents,
    updateMediaControlBridgeMetadata,
    updateMediaControlBridgePlaybackState,
} from "./mediaControlBridge";

const PLAYBACK_MODE_KEY = 'playerPlaybackMode';
const LEGACY_PLAY_MODE_KEY = 'playMode';
const PLAYBACK_MODES = new Set(['SEQUENCE', 'LOOP_LIST', 'SHUFFLE', 'LOOP_SINGLE', 'SINGLE_ONCE']);

const getPlaybackMode = async (): Promise<string | null> => {
    const mode = await AsyncStorage.getItem(PLAYBACK_MODE_KEY);
    if (mode) return mode;
    const legacy = await AsyncStorage.getItem(LEGACY_PLAY_MODE_KEY);
    return legacy && PLAYBACK_MODES.has(legacy) ? legacy : null;
};

export const PlaybackService = async function () {
    console.log('[PlaybackService] Registered');
    let isSkippingOutro = false;
    const useNativeMediaBridge = Platform.OS === "android";
    const lastTransportEventAt = new Map<string, number>();

    const shouldHandleTransportEvent = (key: string, windowMs = 350) => {
        const now = Date.now();
        const last = lastTransportEventAt.get(key) || 0;
        if (now - last < windowMs) return false;
        lastTransportEventAt.set(key, now);
        return true;
    };

    const ensurePlaying = async () => {
        const state = await TrackPlayer.getPlaybackState();
        if (state.state !== State.Playing) {
            await TrackPlayer.play();
        }
    };

    const ensurePaused = async () => {
        const state = await TrackPlayer.getPlaybackState();
        if (state.state !== State.Paused) {
            await TrackPlayer.pause();
        }
    };

    const handleRemoteNext = async () => {
        const queue = await TrackPlayer.getQueue();
        const index = await TrackPlayer.getActiveTrackIndex();
        if (index !== undefined && index < queue.length - 1) {
            await TrackPlayer.skipToNext();
        } else {
            const playMode = await getPlaybackMode();
            if (playMode === 'LOOP_LIST' || playMode === 'SHUFFLE') {
                await TrackPlayer.skip(0);
            }
        }
    };

    const handleRemotePrevious = async () => {
        const index = await TrackPlayer.getActiveTrackIndex();
        if (index !== undefined && index > 0) {
            await TrackPlayer.skipToPrevious();
        } else {
            const queue = await TrackPlayer.getQueue();
            if (queue.length > 0) {
                await TrackPlayer.skip(queue.length - 1);
            }
        }
    };

    const syncBridgeStateFromService = async () => {
        if (!useNativeMediaBridge) return;
        try {
            const playback = await TrackPlayer.getPlaybackState();
            const queue = await TrackPlayer.getQueue();
            const activeIndex = await TrackPlayer.getActiveTrackIndex();
            const hasTrack = activeIndex !== undefined || queue.length > 0;

            let state: "playing" | "paused" | "buffering" | "loading" | "stopped" | "none" = "paused";
            if (playback.state === State.Playing) state = "playing";
            else if (playback.state === State.Buffering) state = "buffering";
            else if (playback.state === State.Loading) state = "loading";
            else if (playback.state === State.Stopped) state = "stopped";

            await updateMediaControlBridgePlaybackState({
                state,
                position: 0,
                speed: state === "playing" ? 1 : 0,
                canSkipNext: hasTrack,
                canSkipPrevious: hasTrack,
            });

            if (activeIndex !== undefined) {
                const activeTrack: any = await TrackPlayer.getTrack(activeIndex);
                if (activeTrack) {
                    await updateMediaControlBridgeMetadata({
                        title: activeTrack.title,
                        artist: activeTrack.artist,
                        album: activeTrack.album,
                        duration: activeTrack.duration || 0,
                    });
                }
            }
        } catch (e) {
            console.warn("[PlaybackService] syncBridgeStateFromService failed:", e);
        }
    };

    if (useNativeMediaBridge) {
        await startMediaControlBridge();
        subscribeMediaControlBridgeEvents(async (event) => {
            try {
                console.log('[PlaybackService] MediaBridgeEvent:', event.action);
                switch (event.action) {
                    case "play":
                        await ensurePlaying();
                        break;
                    case "pause":
                        await ensurePaused();
                        break;
                    case "toggle": {
                        const state = await TrackPlayer.getPlaybackState();
                        if (state.state === State.Playing) {
                            await ensurePaused();
                        } else {
                            await ensurePlaying();
                        }
                        break;
                    }
                    case "next":
                        if (shouldHandleTransportEvent("next")) {
                            await handleRemoteNext();
                        }
                        break;
                    case "previous":
                        if (shouldHandleTransportEvent("previous")) {
                            await handleRemotePrevious();
                        }
                        break;
                    case "seek":
                        if (typeof event.position === "number") {
                            await TrackPlayer.seekTo(event.position);
                        }
                        break;
                    case "jumpForward":
                        if (shouldHandleTransportEvent("jumpForward", 200)) {
                            await TrackPlayer.seekBy(event.interval || 15);
                        }
                        break;
                    case "jumpBackward":
                        if (shouldHandleTransportEvent("jumpBackward", 200)) {
                            await TrackPlayer.seekBy(-(event.interval || 15));
                        }
                        break;
                    default:
                        break;
                }
            } catch (e) {
                console.warn("[PlaybackService] Media bridge action failed:", event, e);
            }
        });
    }

    // Android 开启原生桥接后，通知栏事件在不同 ROM 上可能仍走 RNTP RemotePlay/RemotePause。
    // 这里保留兜底监听，避免“通知栏状态变了但应用状态不更新”。
    TrackPlayer.addEventListener(Event.RemotePlay, async () => {
        console.log('[PlaybackService] Event.RemotePlay');
        await ensurePlaying();
    });

    TrackPlayer.addEventListener(Event.RemotePause, async () => {
        console.log('[PlaybackService] Event.RemotePause');
        await ensurePaused();
    });

    TrackPlayer.addEventListener(Event.RemoteNext, async () => {
        if (!shouldHandleTransportEvent("next")) return;
        console.log('[PlaybackService] Event.RemoteNext');
        await handleRemoteNext();
    });

    TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
        if (!shouldHandleTransportEvent("previous")) return;
        console.log('[PlaybackService] Event.RemotePrevious');
        await handleRemotePrevious();
    });

    TrackPlayer.addEventListener(Event.RemoteJumpForward, async (event) => {
        if (!shouldHandleTransportEvent("jumpForward", 200)) return;
        console.log('[PlaybackService] Event.RemoteJumpForward', event);
        await TrackPlayer.seekBy(event.interval || 15);
    });

    TrackPlayer.addEventListener(Event.RemoteJumpBackward, async (event) => {
        if (!shouldHandleTransportEvent("jumpBackward", 200)) return;
        console.log('[PlaybackService] Event.RemoteJumpBackward', event);
        await TrackPlayer.seekBy(-(event.interval || 15));
    });

    TrackPlayer.addEventListener(Event.RemoteSeek, async (event) => {
        console.log('[PlaybackService] Event.RemoteSeek:', event.position);
        await TrackPlayer.seekTo(event.position);
    });

    TrackPlayer.addEventListener(Event.PlaybackState, async () => {
        await syncBridgeStateFromService();
    });

    // ✨ 新增：背景切歌逻辑（解决熄屏不跳转/不跳片头问题）
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async (event) => {
        console.log('[PlaybackService] Active track changed:', event.index);
        
        // 切歌时重置跳过锁
        isSkippingOutro = false;

        if (event.index === undefined) return;
        
        const track = await TrackPlayer.getTrack(event.index);
        if (!track) return;

        // 1. 处理自动跳过片头
        const intro = await AsyncStorage.getItem('skipIntroDuration');
        const skipIntro = intro ? parseInt(intro, 10) : 0;

        // @ts-ignore - track.type is custom
        if (track.type === 'AUDIOBOOK' && skipIntro > 0 && event.lastIndex !== undefined) {
            console.log(`[PlaybackService] Auto-skipping intro: ${skipIntro}s`);
            setTimeout(() => {
                TrackPlayer.seekTo(skipIntro).catch(e => console.error('Background seekTo failed', e));
                TrackPlayer.play().catch(() => {});
            }, 500);
        }

        await syncBridgeStateFromService();
    });

    // ✨ 新增：背景进度监听（解决熄屏不跳片尾问题）
    TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, async (event) => {
        // 每秒触发一次
        const outroStr = await AsyncStorage.getItem('skipOutroDuration');
        const skipOutro = outroStr ? parseInt(outroStr, 10) : 0;
        
        if (skipOutro <= 0) return;

        const remaining = event.duration - event.position;
        const activeIndex = await TrackPlayer.getActiveTrackIndex();
        if (activeIndex === undefined) return;

        const track = await TrackPlayer.getTrack(activeIndex);
        
        // @ts-ignore
        if (track?.type === 'AUDIOBOOK' && remaining <= skipOutro && remaining > 1 && !isSkippingOutro) {
            console.log(`[PlaybackService] Outro detected in background, skipping to next...`);
            isSkippingOutro = true;
            
            const queue = await TrackPlayer.getQueue();
            
            if (activeIndex < queue.length - 1) {
                await TrackPlayer.skipToNext();
                await TrackPlayer.play();
            } else {
                const playMode = await getPlaybackMode();
                if (playMode === 'LOOP_LIST') {
                    await TrackPlayer.skip(0);
                    await TrackPlayer.play();
                } else {
                    // SEQUENCE 模式下播放到底了，停止
                    await TrackPlayer.pause();
                }
            }
        }
    });

    TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async () => {
        console.log('[PlaybackService] Queue ended');
        const playMode = await getPlaybackMode();
        // 仅处理原生队列的循环列表；其他续播交给前台业务层 playNext() 兜底。
        if (playMode !== 'LOOP_LIST') return;
        await TrackPlayer.skip(0);
        await TrackPlayer.play();
    });
};
