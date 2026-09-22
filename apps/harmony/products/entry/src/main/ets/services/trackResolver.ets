import { fileCache } from 'features_storage';
import type { TrackDto } from 'features_network';
import { getInternalQuality, getExternalQuality, resolveTrackUrl } from './trackQuality';
import { getSourceKey } from '../utils/device';
import type { Track } from '../context/PlayerStore';
import { playerStore } from '../context/PlayerStore';

export async function resolveTrackToPlayer(track: TrackDto, isExternal: boolean): Promise<Track> {
  const ext = track.ext ?? 'mp3';
  // 多数据源隔离：sourceKey 随当前 serverAddress 变化，A/B 两源同 track_id 互不命中
  const sourceKey = await getSourceKey();
  if (await fileCache.hasAudio(track.id, ext, sourceKey)) {
    return toPlayerTrack(track, await fileCache.audioPath(track.id, ext, sourceKey));
  }
  const q = isExternal ? await getExternalQuality() : await getInternalQuality();
  const url = await resolveTrackUrl(track.id, q, track.path);
  return toPlayerTrack(track, url);
}

/**
 * 秒播优化第一步：只解析用户点击的那一首（磁盘 KV 检查），其余先不管。
 * 调用方拿到结果后立刻 playerStore.playTrackList 开播，实现「点击即出声」。
 */
export async function resolveFirstFast(queue: TrackDto[], startIndex: number, isExternal: boolean): Promise<Track> {
  const idx = Math.max(0, Math.min(startIndex, queue.length - 1));
  return resolveTrackToPlayer(queue[idx], isExternal);
}

/**
 * 秒播优化第二步：后台并行解析队列里其余曲目，保持与输入 queue 相同的顺序返回。
 * 调用方把结果交给 playerStore.replaceQueuePreservingCurrent 补齐完整队列，
 * 用户感知不到等待，但上一首/下一首、循环、随机播放都能正常工作。
 *
 * first 是已解析好的首曲（来自 resolveFirstFast），对应 originalQueue[firstIndex]，
 * 直接复用避免重复磁盘 IO。
 */
export async function resolveRestParallel(
  originalQueue: TrackDto[],
  first: Track,
  firstIndex: number,
  isExternal: boolean,
): Promise<Track[]> {
  const rest: Array<Promise<Track>> = originalQueue.map((item, i) => {
    if (i === firstIndex) return Promise.resolve(first);
    return resolveTrackToPlayer(item, isExternal);
  });
  return Promise.all(rest);
}

/**
 * 秒播优化统一入口：点击队列中第 startIndex 首时调用。
 * 流程：
 *  1. 只解析这首（磁盘 KV 检查），拿到后立即 playerStore.playTrackList([first], 0) 开播
 *  2. 后台并行解析队列其余曲目，完成后 replaceQueuePreservingCurrent 把队列从
 *     「单首占位」升级为「完整列表」，不打断当前播放
 *  3. 用户在后台解析期间又点了别的歌，则本次结果被丢弃（竞态安全）
 *
 * 替代旧的「整队列串行 for-await resolveTrackToPlayer + playTrackList」模式，
 * 用户感知延迟从「队列长度 × 单首 IO」降为「单首 IO」。
 */
export async function playQueueFast(
  queue: TrackDto[],
  startIndex: number,
  isExternal: boolean,
): Promise<void> {
  if (queue.length === 0) return;
  const idx = Math.max(0, Math.min(startIndex, queue.length - 1));
  const first = await resolveTrackToPlayer(queue[idx], isExternal);
  await playerStore.playTrackList([first], 0);
  // 后台补齐完整队列，不 await，不打断播放
  resolveRestParallel(queue, first, idx, isExternal)
    .then((full) => playerStore.replaceQueuePreservingCurrent(full, first.id))
    .catch(() => undefined);
}

function toPlayerTrack(t: TrackDto, url: string): Track {
  // PlayerStore.Track 是播放器内部模型，沿用 title/coverUrl；
  // 后端 TrackDto 的字段是 name/cover，在这里做一次映射。
  return {
    id: t.id, title: t.name, artist: t.artist, album: t.album,
    duration: t.duration, coverUrl: t.cover, ext: t.ext, url,
    lyrics: t.lyrics, contentType: t.type,
  };
}
