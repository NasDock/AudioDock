import { Logger } from 'audiodock_common';
import { audioBackend } from 'features_player';
import type { PlayerPayload, TimeUpdatePayload, StateChangePayload, BufferingPayload } from 'features_player';
import { playerStore } from '../context/PlayerStore';
import type { PlayerState } from '../context/PlayerStore';

// media.AVPlayerState -> PlayerStore.PlayerState
// completed/released are intentionally ignored: 'ended' event handles
// end-of-stream advance, released means teardown.
function mapState(s: string): PlayerState | null {
  switch (s) {
    case 'idle': return 'idle';
    case 'initialized': return 'preparing';
    case 'prepared': return 'ready';
    case 'playing': return 'playing';
    case 'paused': return 'paused';
    case 'stopped': return 'stopped';
    case 'error': return 'error';
    default: return null;
  }
}

export function installPlaybackService(): void {
  audioBackend.on('timeUpdate', (p: PlayerPayload) => {
    const v = p as TimeUpdatePayload;
    playerStore.onTimeUpdate(v.currentMs, v.durationMs);
  });
  audioBackend.on('durationUpdate', (p: PlayerPayload) => {
    const v = p as TimeUpdatePayload;
    if (v.durationMs > 0) playerStore.onTimeUpdate(v.currentMs, v.durationMs);
  });
  audioBackend.on('stateChange', (p: PlayerPayload) => {
    const v = p as StateChangePayload;
    const mapped = mapState(v.state);
    if (mapped) playerStore.onStateChange(mapped);
  });
  audioBackend.on('ended', () => playerStore.onEndOfStream());
  // 缓存进度（进度条三段式中间层）：AVPlayer bufferingUpdate 给 0~100 百分比
  audioBackend.on('bufferingUpdate', (p: PlayerPayload) => {
    const v = p as BufferingPayload;
    playerStore.onBufferingUpdate(v.value);
  });
  audioBackend.on('error', () => {
    Logger.e('Playback', 'player error');
    playerStore.onError();
  });
  Logger.i('Playback', 'service installed');
}
