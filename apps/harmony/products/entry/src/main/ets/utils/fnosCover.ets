import fs from '@ohos.file.fs';
import { Logger } from 'audiodock_common';
import { fileCache } from 'features_storage';
import { fetchFnosMediaBytes } from 'features_network';

/**
 * 飞牛音乐封面缓存。
 *
 * 飞牛的 `/static/cover` 只认 `Cookie: music-token=...` / `Authorization`，
 * 而 ArkUI 的 Image 组件拿到的就是一个 URL 字符串，加不了请求头。
 * 所以端侧必须自己带鉴权把图拉下来落盘，再把本地文件路径交给 Image。
 *
 * 缓存键用 URL（fileCache.coverPath 内部按 djb2 摘要），
 * 不同 size 的同一张封面会各存一份 —— 与后端 /image/optimize 的档位缓存同思路。
 */

const inflight: Map<string, Promise<string>> = new Map<string, Promise<string>>();

function toLocalUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

/**
 * 确保目标文件的父目录存在。
 *
 * ⚠️ 真机踩坑（JUY-AL80 / HarmonyOS 7）：`fs.openSync(..., CREATE)` **不创建父目录**，
 * 目录缺失时直接 ENOENT（`No such file or directory. Open failed`），
 * 表现为「飞牛源的封面全部空白，日志里满屏封面缓存失败」。
 * fileCache.init 虽然会建目录，但清理缓存/首启时序都可能让目录消失，这里兜底重建。
 */
async function ensureParentDir(filePath: string): Promise<void> {
  const idx: number = filePath.lastIndexOf('/');
  if (idx <= 0) return;
  const dir: string = filePath.substring(0, idx);
  try {
    if (await fs.access(dir)) return;
  } catch (e) {
    // 目录不存在，往下创建
  }
  try {
    await fs.mkdir(dir, true);
  } catch (e) {
    // 并发时可能已被别的任务创建，忽略；真失败由后面的 openSync 报错暴露
    Logger.w('FnosCover', `创建封面目录失败 ${dir}: ${String(e)}`);
  }
}

async function writeBytes(path: string, data: ArrayBuffer): Promise<void> {
  await ensureParentDir(path);
  const fd = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
  try {
    fs.writeSync(fd.fd, data);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 把飞牛封面 URL 解析成本地 `file://` 地址。
 * 同 URL 并发请求会复用同一个 Promise（列表里同一张专辑封面很常见）。
 */
export function resolveFnosCover(url: string): Promise<string> {
  const existing: Promise<string> | undefined = inflight.get(url);
  if (existing !== undefined) return existing;

  const task: Promise<string> = (async (): Promise<string> => {
    const dest: string = await fileCache.coverPath(url, 'jpg');
    try {
      const exists: boolean = await fs.access(dest);
      if (exists) return toLocalUri(dest);
    } catch (e) {
      // access 失败说明还没有缓存，继续下载
    }
    const bytes: ArrayBuffer = await fetchFnosMediaBytes(url);
    await writeBytes(dest, bytes);
    return toLocalUri(dest);
  })();

  // 无论成功失败都要把 in-flight 摘掉，失败时下次滑动会重试
  task.then((): void => {
    inflight.delete(url);
  }).catch((e: Error): void => {
    inflight.delete(url);
    Logger.w('FnosCover', `封面缓存失败 ${url}: ${e.message}`);
  });

  inflight.set(url, task);
  return task;
}
