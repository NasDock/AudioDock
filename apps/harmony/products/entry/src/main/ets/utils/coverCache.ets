/**
 * 封面磁盘缓存（hm）。
 *
 * ArkUI 的 `Image(网络URL)` 与 `@ohos.net.http` 下载的字节**不共享缓存**；
 * 此前只有飞牛源（ArkUI Image 加不了请求头）走 fnosCover.ets 落盘。
 * 这里把落盘能力泛化到所有数据源，目的：mini 态闲时把全屏用的大封面拉下来，
 * 进 PlayerPage 时同步拿到 `file://`，不再从头下载、也不再闪封面。
 *
 * 设计：
 *  - 落盘路径沿用 `fileCache.coverPath(url, 'jpg')`（djb2(url)），
 *    与 fnosCover.resolveFnosCover 是同一个文件，两条链路天然互相命中；
 *  - 飞牛源直接委托 resolveFnosCover，复用它的 inflight，避免与 CoverImage
 *    并发时两个任务同时 TRUNC 写同一个文件；
 *  - 内存 Map 只记「URL → 本地 URI」，供 build() 同步读取；
 *  - hydrateCachedCoverUri 只查磁盘不下载，用于进程重启后立刻恢复这份索引。
 */
import fs from '@ohos.file.fs';
import http from '@ohos.net.http';
import { Logger } from 'audiodock_common';
import { fileCache } from 'features_storage';
import { isFnosMediaUrl } from 'features_network';
import { resolveFnosCover } from './fnosCover';

const TAG: string = 'CoverCache';
const COVER_EXT: string = 'jpg';
const TIMEOUT_MS: number = 10000;

const localUriByUrl: Map<string, string> = new Map<string, string>();
const inflight: Map<string, Promise<string>> = new Map<string, Promise<string>>();

function toLocalUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function remember(url: string, dest: string): string {
  const uri: string = toLocalUri(dest);
  localUriByUrl.set(url, uri);
  return uri;
}

/** 同步读已落盘的封面；未命中返回空串（build() 里可直接判断） */
export function getCachedCoverUri(url: string): string {
  const uri: string | undefined = localUriByUrl.get(url);
  return uri === undefined ? '' : uri;
}

/** build() 里用：已落盘用 file://，否则退回原 URL */
export function coverDisplayUri(url: string): string {
  const local: string = getCachedCoverUri(url);
  return local.length > 0 ? local : url;
}

async function ensureParentDir(filePath: string): Promise<void> {
  const idx: number = filePath.lastIndexOf('/');
  if (idx <= 0) return;
  const dir: string = filePath.substring(0, idx);
  try {
    if (await fs.access(dir)) return;
  } catch (_e) {
    // 目录不存在，往下创建
  }
  try {
    await fs.mkdir(dir, true);
  } catch (e) {
    // 并发时可能已被别的任务创建，忽略
    Logger.w(TAG, `创建封面目录失败 ${dir}: ${String(e)}`);
  }
}

async function writeBytes(path: string, data: ArrayBuffer): Promise<void> {
  await ensureParentDir(path);
  try {
    const fd = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
    try {
      fs.writeSync(fd.fd, data);
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    Logger.w(TAG, `写封面缓存失败 ${path}: ${String(e)}`);
    // ArkTS 不允许 throw 任意类型（arkts-limited-throw），catch 参数要包成 Error
    throw new Error(`写封面缓存失败: ${String(e)}`);
  }
}

/** 飞牛源已在 prefetchCoverToDisk 里委托 resolveFnosCover，这里只处理普通 http(s) 封面 */
async function downloadBytes(url: string): Promise<ArrayBuffer> {
  const req = http.createHttp();
  try {
    const resp = await req.request(url, {
      method: http.RequestMethod.GET,
      expectDataType: http.HttpDataType.ARRAY_BUFFER,
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
    });
    if (resp.responseCode < 200 || resp.responseCode >= 300) {
      throw new Error(`HTTP ${resp.responseCode}`);
    }
    return resp.result as ArrayBuffer;
  } catch (e) {
    Logger.w(TAG, `封面下载失败 ${url}: ${String(e)}`);
    throw new Error(`封面下载失败: ${String(e)}`);
  } finally {
    req.destroy();
  }
}

/**
 * 只查磁盘、不下载：把上次进程已落盘的封面补进内存索引。
 * 冷启动恢复播放状态时调用，让全屏首帧立刻能用 file://，零网络请求。
 */
export async function hydrateCachedCoverUri(url: string): Promise<string> {
  if (url.length === 0) return '';
  const cached: string = getCachedCoverUri(url);
  if (cached.length > 0) return cached;
  try {
    const dest: string = await fileCache.coverPath(url, COVER_EXT);
    const exists: boolean = await fs.access(dest);
    if (exists) return remember(url, dest);
  } catch (_e) {
    // 没有缓存文件，等闲时预下载
  }
  return '';
}

/**
 * 预下载封面并落盘；同 URL 并发去重，磁盘已存在时零网络请求。
 * 返回 file:// 地址（调用方一般只用得到的内存索引，可忽略返回值）。
 */
export function prefetchCoverToDisk(url: string): Promise<string> {
  if (url.length === 0) return Promise.resolve<string>('');
  const cached: string = getCachedCoverUri(url);
  if (cached.length > 0) return Promise.resolve<string>(cached);
  const pending: Promise<string> | undefined = inflight.get(url);
  if (pending !== undefined) return pending;

  const task: Promise<string> = (async (): Promise<string> => {
    // 飞牛源复用 fnosCover 的 inflight 与落盘路径，避免与 CoverImage 并发重复写同一文件
    if (isFnosMediaUrl(url)) {
      const uri: string = await resolveFnosCover(url);
      localUriByUrl.set(url, uri);
      return uri;
    }
    const dest: string = await fileCache.coverPath(url, COVER_EXT);
    try {
      const exists: boolean = await fs.access(dest);
      if (exists) return remember(url, dest);
    } catch (_e) {
      // 继续下载
    }
    const bytes: ArrayBuffer = await downloadBytes(url);
    await writeBytes(dest, bytes);
    return remember(url, dest);
  })();

  task.then((): void => {
    inflight.delete(url);
  }).catch((e: Error): void => {
    inflight.delete(url);
    Logger.w(TAG, `封面预下载失败 ${url}: ${e.message}`);
  });
  inflight.set(url, task);
  return task;
}
