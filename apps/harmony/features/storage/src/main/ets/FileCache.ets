import fs from '@ohos.file.fs';
import common from '@ohos.app.ability.common';
import http from '@ohos.net.http';
import { Logger, urlToFilename, formatSize } from 'audiodock_common';

const AUDIO_DIR = 'audio_cache';
const COVER_DIR = 'cover_cache';
const LYRICS_DIR = 'lyrics_cache';

interface DownloadProgress { loaded: number; total: number }

interface SizeByCategory {
  covers: number;
  music: number;
  audiobooks:  number;
  apks: number;
}

interface DirMap {
  covers: string;
  music: string;
  audiobooks: string;
}

export class FileCache {
  private rootDir: string = '';
  private inflight = new Map<string, Promise<string>>();

  async init(context: common.UIAbilityContext): Promise<void> {
    this.rootDir = `${context.filesDir}/cache`;
    await fs.mkdir(`${this.rootDir}/${AUDIO_DIR}`).catch(() => undefined);
    await fs.mkdir(`${this.rootDir}/${COVER_DIR}`).catch(() => undefined);
    await fs.mkdir(`${this.rootDir}/${LYRICS_DIR}`).catch(() => undefined);
    Logger.i('FileCache', `Cache root: ${this.rootDir}`);
  }

  async audioPath(trackId: string, ext: string): Promise<string> {
    return `${this.rootDir}/${AUDIO_DIR}/${trackId}.${ext.replace(/^\./, '')}`;
  }

  async coverPath(url: string, ext: string = 'jpg'): Promise<string> {
    return `${this.rootDir}/${COVER_DIR}/${urlToFilename(url, ext)}`;
  }

  async lyricsPath(trackId: string): Promise<string> {
    return `${this.rootDir}/${LYRICS_DIR}/${trackId}.json`;
  }

  async hasAudio(trackId: string, ext: string): Promise<boolean> {
    // 注意：API 11+ 的 fs.access 不再抛异常，而是 resolve 出 boolean，
    // 之前 .then(() => true) 的写法会把 false 也吞掉，导致永远返回 true。
    try {
      return await fs.access(await this.audioPath(trackId, ext));
    } catch (_e) {
      return false;
    }
  }

  async downloadAudio(
    trackId: string, ext: string, sourceUri: string,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<string> {
    const dest = await this.audioPath(trackId, ext);
    const key = `${trackId}:${ext}`;
    if (this.inflight.has(key)) return this.inflight.get(key)!;
    const tmp = `${dest}.tmp`;
    const task = (async () => {
      const fd = fs.openSync(sourceUri).fd;
      await fs.copyFile(fd, tmp);
      await fs.rename(tmp, dest);
      this.inflight.delete(key);
      onProgress?.({ loaded: 100, total: 100 });
      return dest;
    })().catch((err: Error) => {
      this.inflight.delete(key);
      Logger.e('FileCache', `audio download failed: ${err.message}`);
      throw err;
    });
    this.inflight.set(key, task);
    return task;
  }

  async removeAudio(trackId: string, ext: string): Promise<void> {
    const p = await this.audioPath(trackId, ext);
    await fs.unlink(p).catch(() => undefined);
  }

  /**
   * 秒播优化：边播边缓存。从 HTTP URL 直接下载到 audio_cache 目录，
   * 不写离线下载元数据（不出现在「已下载」列表），纯粹作为播放缓存。
   *
   * 与 downloadAudio 的区别：downloadAudio 接受本地文件路径（fs.copyFile），
   * 本方法接受 HTTP URL，内部用 @ohos.net.http 拉流写文件。
   *
   * 调用方负责：
   * - 先判断 hasAudio 避免重复下载
   * - 只在 cacheEnabled 开关开启时调用
   *
   * 失败静默（只打日志），不影响播放。
   */
  async downloadAudioFromUrl(trackId: string, ext: string, url: string): Promise<string> {
    const dest = await this.audioPath(trackId, ext);
    const key = `${trackId}:${ext}`;
    if (this.inflight.has(key)) return this.inflight.get(key)!;
    const tmp = `${dest}.tmp`;
    const task = (async () => {
      const httpReq = http.createHttp();
      try {
        const resp = await httpReq.request(url, {
          method: http.RequestMethod.GET,
          readTimeout: 60000,
          connectTimeout: 15000,
        });
        if (resp.responseCode !== 200 && resp.responseCode !== 206) {
          throw new Error(`HTTP ${resp.responseCode}`);
        }
        const data = resp.result;
        if (typeof data !== 'string' && !(data instanceof ArrayBuffer)) {
          throw new Error('unexpected response type');
        }
        const fd = fs.openSync(tmp, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE);
        if (data instanceof ArrayBuffer) {
          fs.writeSync(fd.fd, data);
        } else {
          fs.writeSync(fd.fd, data as string);
        }
        fs.closeSync(fd);
        await fs.rename(tmp, dest);
        this.inflight.delete(key);
        Logger.i('FileCache', `cache-while-playing saved: ${trackId}.${ext}`);
        return dest;
      } finally {
        httpReq.destroy();
      }
    })().catch((err: Error) => {
      this.inflight.delete(key);
      fs.unlink(tmp).catch(() => undefined);
      Logger.w('FileCache', `cache-while-playing failed for ${trackId}: ${err.message}`);
      throw err;
    });
    this.inflight.set(key, task);
    return task;
  }

  async sizeByCategory(): Promise<Record<string, number>> {
    const out: SizeByCategory = { covers: 0, music: 0, audiobooks: 0, apks: 0 };
    for (const dir of [AUDIO_DIR, COVER_DIR, LYRICS_DIR]) {
      const files = await fs.listFile(`${this.rootDir}/${dir}`).catch(() => [] as string[]);
      for (const f of files) {
        const stat = await fs.stat(`${this.rootDir}/${dir}/${f}`).catch(() => null);
        if (stat) {
          if (dir === AUDIO_DIR) {
            out.music += Number(stat.size);
          } else if (dir === COVER_DIR) {
            out.covers += Number(stat.size);
          } else {
            out.audiobooks += Number(stat.size);
          }
        }
      }
    }
    const result = new Map<string, number>();
    result.set('covers', out.covers);
    result.set('music', out.music);
    result.set('audiobooks', out.audiobooks);
    result.set('apks', out.apks);
    const record: Record<string, number> = {};
    const keys = Array.from(result.keys());
    for (let i = 0; i < keys.length; i++) {
      record[keys[i]] = result.get(keys[i])!;
    }
    return record;
  }

  async clearCategory(category: 'covers' | 'music' | 'audiobooks' | 'apks'): Promise<void> {
    const dirMap: DirMap = { covers: COVER_DIR, music: AUDIO_DIR, audiobooks: LYRICS_DIR };
    let d: string | undefined;
    if (category === 'covers') {
      d = dirMap.covers;
    } else if (category === 'music') {
      d = dirMap.music;
    } else if (category === 'audiobooks') {
      d = dirMap.audiobooks;
    } else {
      d = undefined;
    }
    if (!d) return;
    const files = await fs.listFile(`${this.rootDir}/${d}`).catch(() => [] as string[]);
    for (const f of files) await fs.unlink(`${this.rootDir}/${d}/${f}`).catch(() => undefined);
  }

  formatSize(bytes: number): string { return formatSize(bytes); }
}

export const fileCache = new FileCache();
