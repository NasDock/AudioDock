import TrackPlayer, { Event } from 'react-native-track-player';

export const PlaybackService = async function () {
    console.log('[PlaybackService] Registered');

    TrackPlayer.addEventListener(Event.RemotePlay, () => {
        console.log('[PlaybackService] Event.RemotePlay');
        TrackPlayer.play();
    });

    TrackPlayer.addEventListener(Event.RemotePause, () => {
        console.log('[PlaybackService] Event.RemotePause');
        TrackPlayer.pause();
    });

    TrackPlayer.addEventListener(Event.RemoteNext, () => {
        console.log('[PlaybackService] Event.RemoteNext');
        TrackPlayer.skipToNext();
    });

    TrackPlayer.addEventListener(Event.RemotePrevious, () => {
        console.log('[PlaybackService] Event.RemotePrevious');
        TrackPlayer.skipToPrevious();
    });

    TrackPlayer.addEventListener(Event.RemoteJumpForward, (event) => {
        console.log('[PlaybackService] Event.RemoteJumpForward', event);
    });

    TrackPlayer.addEventListener(Event.RemoteJumpBackward, (event) => {
        console.log('[PlaybackService] Event.RemoteJumpBackward', event);
    });

    TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
        console.log('[PlaybackService] Event.RemoteSeek:', event.position);
        TrackPlayer.seekTo(event.position);
    });
};
