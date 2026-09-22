import fs from '@ohos.file.fs';
import request from '@ohos.request';
import type { common } from '@kit.AbilityKit';
import { Logger } from 'audiodock_common';
import { httpClient, trackApi } from 'features_network';
import type { TrackDto } from 'features_network';
import { fileCache, kvStore } from 'features_storage';
import { getSourceKey } from '../utils/device';

/**
 * 下载服务，对齐 mobile apps/mobile/src/services/downloadManager.ts：
 * - downloadTrack(context, track): 下载单曲，落到 FileCache（file:// → FileCache.copyFile）
 * - downloadTracks(context, tracks, onProgress): 批量下载（顺序执行）
 * - isTrackDownloaded(trackId): 判断单曲是否已下载（FileCache.hasAudio 探测常见后缀）
 * - removeDownloadedTrack(trackId): 删除已下载（FileCache + KV 列表）
 *
 * 实现要点：
 * - 用 @ohos.request.downloadFile 直接把网络文件落到 context.cacheDir/dl_*.{ext}，避免 fetch 不存在
 *   + fs.openSync/writeSync 动态 import 后类型消失的问题。
 * - 然后用 FileCache.downloadAudio(trackId, ext, 'file://...') 把缓存文件复制到正式位置。
 * - TrackDto 字段是 name/cover/path（不是 title/coverUrl/url），跟后端 Prisma 对齐。
 * - 多数据源隔离：FileCache 文件名与 KV 元数据都带 sourceKey，不同源同 track_id 互不命中。
 */

const TAG = 'downloadService';
const OFFLINE_TRACKS_KEY = 'offline_tracks';

export interface DownloadedMeta {
  trackId: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  coverUrl?: string;
  /** 内容类型 MUSIC | AUDIOBOOK，来自 TrackDto.type，用于「我的-下载」按模式过滤。 */
  type?: string;
  ext: string;
  size: number;
  downloadedAt: number;
  /** 数据源标识（多源隔离）。旧记录无此字段，视为「通用」兼容。 */
  sourceKey?: string;
}

/**
 * 从 KV `offline_tracks` 读已下载列表（KV 用字符串，整体存数组 JSON）。
 */
async function readOfflineList(): Promise<DownloadedMeta[]> {
  try {
    const raw = await kvStore.get(OFFLINE_TRACKS_KEY);
    if (raw !== null && raw.length > 0) {
      try { return JSON.parse(raw) as DownloadedMeta[]; } catch { return []; }
    }
  } catch (e) {
    Logger.w(TAG, `read offline_tracks failed: ${String(e)}`);
  }
  return [];
}

/**
 * 写已下载列表到 KV（持久层）。
 */
async function writeOfflineList(list: DownloadedMeta[]): Promise<void> {
  const json = JSON.stringify(list);
  await kvStore.set(OFFLINE_TRACKS_KEY, json).catch((e: Error): void => {
    Logger.w(TAG, `write offline_tracks to kvStore failed: ${String(e)}`);
  });
}

/**
 * 从 TrackDto 的 path 推断下载 URL（对齐 mobile downloadManager.ts L7-9）：
 *   path 以 http 开头 → 直接用；否则拼接 baseURL。
 */
function buildDownloadUrl(path: string | undefined, fallbackId: string): string {
  if (path !== undefined && path.length > 0) {
    return path.startsWith('http') ? path : `${httpClient.getBaseURL()}${path.startsWith('/') ? '' : '/'}${path}`;
  }
  // 兜底：拼 /track/stream/{id}（对齐后端 track.controller.ts 的 @Get('/track/stream/:id') 路由）
  return `${httpClient.getBaseURL()}/track/stream/${encodeURIComponent(fallbackId)}`;
}

/**
 * 抽扩展名（带或不带 ?query）。
 */
function extractExt(path: string): string {
  const qIdx: number = path.indexOf('?');
  const clean: string = qIdx >= 0 ? path.slice(0, qIdx) : path;
  const dotIdx: number = clean.lastIndexOf('.');
  if (dotIdx < 0) return 'm4a';
  const e: string = clean.slice(dotIdx + 1).toLowerCase();
  if (e.length === 0 || e.length > 5) return 'm4a';
  return e;
}

/**
 * 判断 trackId 是否已下载（用 FileCache.hasAudio 探测常见后缀）。
 * 仅判断当前源（sourceKey 随 serverAddress 变化）。
 */
export async function isTrackDownloaded(trackId: string): Promise<boolean> {
  const src = await getSourceKey();
  for (const ext of ['mp3', 'm4a', 'aac', 'flac', 'ogg']) {
    if (await fileCache.hasAudio(trackId, ext, src)) return true;
  }
  return false;
}

/**
 * 删除已下载单曲（FileCache + KV 列表）。仅删当前源的记录。
 */
export async function removeDownloadedTrack(trackId: string): Promise<void> {
  const src = await getSourceKey();
  for (const ext of ['mp3', 'm4a', 'aac', 'flac', 'ogg']) {
    await fileCache.removeAudio(trackId, ext, src).catch(() => undefined);
  }
  const list: DownloadedMeta[] = await readOfflineList();
  const next: DownloadedMeta[] = list.filter(
    (m: DownloadedMeta): boolean => !(m.trackId === trackId && (m.sourceKey ?? '') === src)
  );
  await writeOfflineList(next);
}

/**
 * 用 @ohos.request.downloadFile 把 url 落到 filePath。返回写入字节数，失败抛错。
 */
function downloadToFile(context: common.UIAbilityContext, url: string, filePath: string): Promise<number> {
  const headers: Record<string, string> = {};
  const token = httpClient.getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return new Promise<number>((resolve, reject): void => {
    request.downloadFile(context, {
      url: url,
      header: headers,
      filePath: filePath,
      enableMetered: true,
      enableRoaming: true,
    }).then((task: request.DownloadTask): void => {
      task.on('complete', (): void => { resolve(0); });
      task.on('fail', (err: number): void => { reject(new Error(`downloadFile fail code=${err}`)); });
      task.on('remove', (): void => { reject(new Error('downloadFile removed')); });
    }).catch((e: Error): void => { reject(e); });
  });
}

/**
 * 下载单曲。返回下载成功后的本地路径，失败抛错。
 * 对齐 mobile downloadManager.ts downloadTrack：内部走 cache.downloadTrack（hm 端用 fileCache.downloadAudio）。
 */
export async function downloadTrack(context: common.UIAbilityContext, track: TrackDto): Promise<string> {
  // 取实际播放 URL（先用 trackApi.getById 拿最全字段，含 path）
  let fullTrack: TrackDto = track;
  try {
    fullTrack = await trackApi.getById(track.id);
  } catch (e) {
    Logger.w(TAG, `trackApi.getById(${track.id}) failed, fall back to original: ${String(e)}`);
  }

  // 多数据源隔离：sourceKey 随当前 serverAddress 变化
  const src: string = await getSourceKey();

  // 推断 ext：从 path 上截（.m4a / .mp3）；默认 m4a（与鸿蒙 AVRecorder 一致）
  const pathStr: string = fullTrack.path ?? '';
  const ext: string = extractExt(pathStr);

  // 临时文件落到 cacheDir
  const cacheDir: string = context.cacheDir;
  const tmpFile: string = `${cacheDir}/dl_${track.id}_${Date.now()}.${ext}`;
  const url: string = buildDownloadUrl(pathStr, track.id);

  try {
    await downloadToFile(context, url, tmpFile);

    // 用 FileCache.downloadAudio 复制到目标位置（带源前缀）
    const dest: string = await fileCache.downloadAudio(track.id, ext, `file://${tmpFile}`, undefined, src);

    // 写元数据（TrackDto 字段：name / cover；不是 title / coverUrl）
    const stat = fs.statSync(tmpFile);
    const meta: DownloadedMeta = {
      trackId: track.id,
      title: fullTrack.name ?? track.name ?? '',
      artist: fullTrack.artist ?? track.artist,
      album: fullTrack.album ?? track.album,
      duration: fullTrack.duration ?? track.duration,
      coverUrl: fullTrack.cover ?? track.cover,
      type: fullTrack.type ?? track.type,
      ext: ext,
      size: stat.size,
      downloadedAt: Date.now(),
      sourceKey: src,
    };
    const list: DownloadedMeta[] = await readOfflineList();
    // 仅替换同 trackId + 同 sourceKey 的记录，其它源的同名 id 保留
    const filtered: DownloadedMeta[] = list.filter(
      (m: DownloadedMeta): boolean => !(m.trackId === track.id && (m.sourceKey ?? '') === src)
    );
    filtered.push(meta);
    await writeOfflineList(filtered);

    return dest;
  } catch (e) {
    Logger.e(TAG, `downloadTrack(${track.id}) failed: ${String(e)}`);
    throw new Error(String(e));
  } finally {
    // 清理临时文件
    try {
      if (fs.accessSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch (_e) { /* ignore */ }
  }
}

/**
 * 批量下载（顺序执行，避免并发下载 OOM）。
 * 对齐 mobile downloadManager.ts downloadTracks：每首完调 onProgress(completed, total)。
 */
export async function downloadTracks(
  context: common.UIAbilityContext,
  tracks: TrackDto[],
  onProgress?: (completed: number, total: number) => void,
): Promise<void> {
  const total: number = tracks.length;
  let completed: number = 0;
  for (const t of tracks) {
    try {
      await downloadTrack(context, t);
    } catch (e) {
      Logger.w(TAG, `downloadTracks: track ${t.id} failed: ${String(e)}`);
      // 单曲失败不中断批量，继续下一首
    }
    completed++;
    if (onProgress) onProgress(completed, total);
  }
}

/**
 * 获取已下载列表（KV 中的元数据）。仅当前源；旧记录（无 sourceKey）仍列出以保证兼容。
 */
export async function getDownloadedTracks(): Promise<DownloadedMeta[]> {
  const src = await getSourceKey();
  const list = await readOfflineList();
  return list.filter((m: DownloadedMeta): boolean => !m.sourceKey || m.sourceKey === src);
}
