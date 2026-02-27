import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from "react-native";
import TrackPlayer, { Event, State } from 'react-native-track-player';
import {
    startMediaControlBridge,
    subscribeMediaControlBridgeEvents,
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

    if (useNativeMediaBridge) {
        await startMediaControlBridge();
        subscribeMediaControlBridgeEvents(async (event) => {
            try {
                switch (event.action) {
                    case "play":
                        await TrackPlayer.play();
                        break;
                    case "pause":
                        await TrackPlayer.pause();
                        break;
                    case "toggle": {
                        const state = await TrackPlayer.getPlaybackState();
                        if (state.state === State.Playing) {
                            await TrackPlayer.pause();
                        } else {
                            await TrackPlayer.play();
                        }
                        break;
                    }
                    case "next":
                        await handleRemoteNext();
                        break;
                    case "previous":
                        await handleRemotePrevious();
                        break;
                    case "seek":
                        if (typeof event.position === "number") {
                            await TrackPlayer.seekTo(event.position);
                        }
                        break;
                    case "jumpForward":
                        await TrackPlayer.seekBy(event.interval || 15);
                        break;
                    case "jumpBackward":
                        await TrackPlayer.seekBy(-(event.interval || 15));
                        break;
                    default:
                        break;
                }
            } catch (e) {
                console.warn("[PlaybackService] Media bridge action failed:", event, e);
            }
        });
    }

    if (!useNativeMediaBridge) {
        TrackPlayer.addEventListener(Event.RemotePlay, () => {
            console.log('[PlaybackService] Event.RemotePlay');
            TrackPlayer.play();
        });

        TrackPlayer.addEventListener(Event.RemotePause, () => {
            console.log('[PlaybackService] Event.RemotePause');
            TrackPlayer.pause();
        });

        TrackPlayer.addEventListener(Event.RemoteNext, async () => {
            console.log('[PlaybackService] Event.RemoteNext');
            await handleRemoteNext();
        });

        TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
            console.log('[PlaybackService] Event.RemotePrevious');
            await handleRemotePrevious();
        });

        TrackPlayer.addEventListener(Event.RemoteJumpForward, (event) => {
            console.log('[PlaybackService] Event.RemoteJumpForward', event);
            TrackPlayer.seekBy(event.interval || 15);
        });

        TrackPlayer.addEventListener(Event.RemoteJumpBackward, (event) => {
            console.log('[PlaybackService] Event.RemoteJumpBackward', event);
            TrackPlayer.seekBy(-(event.interval || 15));
        });

        TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
            console.log('[PlaybackService] Event.RemoteSeek:', event.position);
            TrackPlayer.seekTo(event.position);
        });
    }

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
        if (playMode === 'LOOP_LIST') {
            await TrackPlayer.skip(0);
            await TrackPlayer.play();
        }
    });
};
