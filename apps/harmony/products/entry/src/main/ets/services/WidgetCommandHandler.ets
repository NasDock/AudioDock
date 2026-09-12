import { Logger } from 'audiodock_common';
import { userDataApi } from 'features_network';
import { trackApi } from 'features_network';
import { playlistApi } from 'features_network';
import type { TrackDto, TrackHistoryItem, PlaylistDetailResp } from 'features_network';
import { playerStore, type Track } from '../context/PlayerStore';
import { likesHistory } from './LikesHistoryService';
import { widgetBridge } from './WidgetBridge';
import { WidgetCommandAction } from '../models/WidgetData';

/**
 * 卡片按钮指令处理（对齐 mobile WidgetIntents.swift 的 WidgetCommandCenter）。
 *
 * - 入口：EntryFormAbility.onFormEvent + EntryAbility.onNewWant（被卡片点击拉起主 App）
 * - 执行：直接调 playerStore / likesHistory / widgetBridge
 * - 完成后由 widgetBridge 的 subscribe 自动推卡片刷新
 *
 * 指令全集（对齐 iOS）：
 *   play / pause / next / prev / mode / like / unlike
 *   play_playlist(id) / play_history(id) / play_latest(id) / refresh_latest
 */

const TAG = 'WidgetCommandHandler';

/** dto → PlayerStore.Track 的转换（字段名对齐后端 Prisma model Track:
 * id / name / artist / cover / duration / type；后端不返回 title / coverUrl / trackNumber） */
function toPlayerTrack(dto: TrackDto): Track {
  return {
    id: String(dto.id ?? ''),
    title: String(dto.name ?? ''),
    artist: dto.artist ? String(dto.artist) : undefined,
    album: dto.album ? String(dto.album) : undefined,
    duration: typeof dto.duration === 'number' ? dto.duration : undefined,
    url: dto.path ? String(dto.path) : '',
    ext: dto.ext ? String(dto.ext) : undefined,
    coverUrl: dto.cover ? String(dto.cover) : undefined,
    lyrics: dto.lyrics ? String(dto.lyrics) : undefined,
    contentType: dto.type ? String(dto.type) : undefined,
  };
}

class WidgetCommandHandlerImpl {
  /**
   * 处理单条指令。失败仅 Logger.w（卡片会因下一次 subscribe 自动回正）。
   */
  async handle(cmd: WidgetCommandAction): Promise<void> {
    Logger.i(TAG, `action=${cmd.action} payload=${JSON.stringify(cmd.payload ?? {})}`);
    try {
      switch (cmd.action) {
        case 'play':
          playerStore.togglePlay();
          break;
        case 'pause':
          if (playerStore.view().isPlaying) playerStore.togglePlay();
          break;
        case 'next':
          playerStore.playNext().catch((): void => undefined);
          break;
        case 'prev':
          playerStore.playPrevious().catch((): void => undefined);
          break;
        case 'mode':
          widgetBridge.cyclePlayMode();
          break;
        case 'like':
          await this.handleLike(true);
          break;
        case 'unlike':
          await this.handleLike(false);
          break;
        case 'play_playlist':
          await this.handlePlayPlaylist(String(cmd.payload?.['id'] ?? ''));
          break;
        case 'play_history':
          await this.handlePlayHistory(String(cmd.payload?.['id'] ?? ''));
          break;
        case 'play_latest':
          await this.handlePlayLatest(String(cmd.payload?.['id'] ?? ''));
          break;
        case 'refresh_latest':
          await widgetBridge.refreshLatestNow();
          break;
        default:
          Logger.w(TAG, `unknown action: ${cmd.action}`);
      }
    } catch (e) {
      Logger.w(TAG, `action ${cmd.action} failed: ${String(e)}`);
    }
  }

  /**
   * 当前曲目点赞/取消点赞：曲目 id 从 playerStore 取。
   */
  private async handleLike(liked: boolean): Promise<void> {
    const cur = playerStore.view().queue[playerStore.view().currentIndex];
    if (!cur?.id) return;
    if (liked) await likesHistory.likeTrack(cur.id);
    else await likesHistory.unlikeTrack(cur.id);
  }

  /**
   * 播放指定歌单：playlistApi.getById 返回 PlaylistDetailResp（含 tracks?: TrackDto[]）。
   */
  private async handlePlayPlaylist(id: string): Promise<void> {
    if (!id) return;
    const resp: PlaylistDetailResp = await playlistApi.getById(id);
    const tracks: TrackDto[] = resp.tracks ?? [];
    if (tracks.length === 0) return;
    const playerTracks: Track[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const t = toPlayerTrack(tracks[i]);
      if (t.id !== '') playerTracks.push(t);
    }
    await playerStore.playTrackList(playerTracks, 0);
  }

  /**
   * 播放历史中的指定曲目：userDataApi.trackHistory 返回 LoadMoreResp<TrackHistoryItem>，
   * 定位目标曲目索引，playTrackList(list, index) —— 这样 next/prev 能继续上下滚动历史，**对齐 mobile**。
   */
  private async handlePlayHistory(id: string): Promise<void> {
    if (!id) return;
    const resp = await userDataApi.trackHistory({ pageSize: 50, loadCount: 0, type: 'MUSIC' });
    const list: TrackHistoryItem[] = resp.list ?? [];
    const tracks: TrackDto[] = [];
    const targetIndex: number = list.findIndex((it): boolean => {
      const tid = String(it.track?.id ?? it.trackId ?? '');
      return tid === id;
    });
    for (let i = 0; i < list.length; i++) {
      const t = list[i].track;
      if (t) tracks.push(t);
    }
    if (tracks.length === 0 || targetIndex < 0) return;
    const playerTracks: Track[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const t = toPlayerTrack(tracks[i]);
      if (t.id !== '') playerTracks.push(t);
    }
    // targetIndex 是 list 中目标项的索引；如果某 list 项没有 track，索引会偏移
    const safeIndex = targetIndex < playerTracks.length ? targetIndex : 0;
    await playerStore.playTrackList(playerTracks, safeIndex);
  }

  /**
   * 播放上新单曲中的指定曲目：trackApi.latest 返回 TrackDto[]，
   * 定位目标曲目索引，playTrackList(list, index) —— 对齐 mobile _layout.tsx play_latest 分支。
   */
  private async handlePlayLatest(id: string): Promise<void> {
    if (!id) return;
    const list: TrackDto[] = await trackApi.latest({ type: 'MUSIC', pageSize: 50 });
    if (list.length === 0) return;
    const targetIndex: number = list.findIndex((t): boolean => String(t.id ?? '') === id);
    const playerTracks: Track[] = [];
    for (let i = 0; i < list.length; i++) {
      const t = toPlayerTrack(list[i]);
      if (t.id !== '') playerTracks.push(t);
    }
    if (playerTracks.length === 0) return;
    const safeIndex = targetIndex >= 0 ? targetIndex : 0;
    await playerStore.playTrackList(playerTracks, safeIndex);
  }
}

export const widgetCommandHandler = new WidgetCommandHandlerImpl();
