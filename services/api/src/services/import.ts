import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Album, FileStatus, MetadataSource, PrismaClient, TrackSource, TrackType } from '@soundx/db';

// Merge plugin-supplied tags into an existing JSON-string tag field.
// Returns the new JSON string, or undefined if nothing to write.
function mergeTagJson(existing: string | null | undefined, incoming: string[] | undefined): string | undefined {
  if (!incoming || incoming.length === 0) return undefined;
  const seen = new Set<string>();
  const result: string[] = [];
  const push = (v: string) => {
    const trimmed = (v ?? '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  };
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (Array.isArray(parsed)) for (const t of parsed) if (typeof t === 'string') push(t);
    } catch {
      // ignore malformed JSON
    }
  }
  for (const t of incoming) push(t);
  return result.length > 0 ? JSON.stringify(result) : undefined;
}
import { LocalMusicScanner, readLyricsFile, ScanResult, WebDAVScanner } from '@soundx/utils';
import { spawn } from 'child_process';
import * as chokidar from 'chokidar';
import * as crypto from 'crypto';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { LogMethod } from '../common/log-method.decorator';
import { resolvePathList } from '../common/path-list';
import { AlbumService } from './album';
import { ArtistService } from './artist';
import { ImageOptimizeService } from './image-optimize.service';
import { MetadataPluginService } from './metadata-plugin.service';
import { TrackService } from './track';
import { WebDavConfigService, WebDavPathKind, WebDavSource } from './webdav-config.service';

export enum TaskStatus {
  INITIALIZING = 'INITIALIZING',
  PREPARING = 'PREPARING',
  PARSING = 'PARSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export type ImportTaskType = 'full' | 'incremental' | 'compact' | 'webdav-sync';

export interface ImportTask {
  id: string;
  status: TaskStatus;
  message?: string;
  total?: number;
  current?: number;
  localTotal?: number;
  localCurrent?: number;
  webdavTotal?: number;
  webdavCurrent?: number;
  mvTotal?: number;
  mvCurrent?: number;
  currentFileName?: string;
  // 本次扫描中因 mtime 未变化而跳过的文件数（未走解析/指纹/写库）
  skipped?: number;
  mode?: 'incremental' | 'full' | 'compact';
  // Distinguishes the task's origin for the Task Center. `mode` alone can't tell a
  // WebDAV sync apart from a normal incremental scan (both use mode:'incremental').
  type?: ImportTaskType;
  // ISO timestamp of when the task was created, used for sorting in the Task Center.
  createdAt?: string;
}

interface TrackSortFields {
  fileName?: string | null;
  relativePath?: string | null;
  fileCreatedAt?: Date | null;
  scanOrder?: number | null;
}

interface ParsedMvFileName {
  title?: string;
  artist?: string;
  album?: string;
}

interface MvStorageTarget {
  sourcePath: string;
  publicUrl: string;
}

@Injectable()
export class ImportService implements OnModuleInit {
  private readonly logger = new Logger(ImportService.name);
  private tasks: Map<string, ImportTask> = new Map();
  private prisma: PrismaClient;
  private folderCache = new Map<string, number>();
  private watcher: chokidar.FSWatcher | null = null;
  private scanner: LocalMusicScanner | null = null;
  // 扫描期间受影响、需要重算状态的专辑集合（延后批量刷新，避免每首歌都刷一次父级状态）
  private dirtyAlbumIds = new Set<number>();

  constructor(
    private readonly trackService: TrackService,
    private readonly albumService: AlbumService,
    private readonly artistService: ArtistService,
    private readonly webDavConfig: WebDavConfigService,
    private readonly metadataPluginService: MetadataPluginService,
    private readonly imageOptimizeService: ImageOptimizeService,
  ) {
    this.prisma = new PrismaClient();
  }

  /**
   * 扫描/上传过程中把刚写入磁盘的封面 URL 投递给 ImageOptimizeService，
   * 让其后台预生成 300/600/1200 三档 webp 缩略图到磁盘缓存。
   * - fire-and-forget：不阻塞 import 主流程，单张图失败不影响其它
   * - 仅对 /covers/ 前缀的本地封面生效（远程 URL 会由 service 内部静默忽略）
   */
  private preGenerateCover(coverUrl: string | null | undefined): void {
    if (!coverUrl || typeof coverUrl !== 'string') return;
    if (!coverUrl.startsWith('/covers/')) return;
    // 不 await，让 sharp 后台跑；import 流程不会因为缩略图慢而卡
    this.imageOptimizeService.preGenerate(coverUrl).catch(() => {
      // 静默吞错；缩略图失败不影响扫描结果
    });
  }

  async onModuleInit() {
    // Run content hash generation, index recalibration, and Check WebDAV in background
    setTimeout(() => {
      this.recalibrateAllIndices().catch(err => {
        this.logger.error("Failed to recalibrate indices", err);
      });

      this.generateMissingHashes().catch(err => {
        this.logger.error("Failed to generate missing hashes", err);
      });

      // Auto-scan WebDAV on startup if library is empty
      this.checkInitialWebDAVScan().catch(err => {
        this.logger.error("Initial WebDAV scan failed", err);
      });

      // One-time backfill of the `source` field for tracks imported before this feature existed
      this.backfillTrackSource().catch(err => {
        this.logger.error("Failed to backfill track source", err);
      });

      // One-time cleanup: trash ACTIVE artists that have no ACTIVE albums.
      // Stale artists can accumulate when their last album was trashed but
      // updateParentStatus('artist') wasn't reached (e.g. pre-existing data).
      this.cleanupStaleArtists().catch(err => {
        this.logger.error("Failed to cleanup stale artists", err);
      });
    }, 5000);
  }

  /**
   * One-time migration: existing tracks were all defaulted to FILE by the DB migration.
   * Mark tracks whose stored `path` points at a configured WebDAV source as WEBDAV.
   * Guarded by a SystemSetting flag so it only runs once.
   */
  private async backfillTrackSource() {
    const FLAG_KEY = 'track_source_backfilled';
    const done = await this.prisma.systemSetting.findUnique({ where: { key: FLAG_KEY } });
    if (done?.value === 'true') return;

    const sources = await this.webDavConfig.list();
    // WebDAV download links are built from the (decoded, trailing-slash-stripped) source url,
    // so a prefix match on track.path reliably identifies WebDAV-imported tracks.
    const prefixes = sources
      .map((s) => {
        try {
          return decodeURI((s.url || '').trim()).replace(/\/+$/, '');
        } catch {
          return (s.url || '').trim().replace(/\/+$/, '');
        }
      })
      .filter((p) => p.length > 0);

    let updated = 0;
    for (const prefix of prefixes) {
      const res = await this.prisma.track.updateMany({
        where: { source: TrackSource.FILE, path: { startsWith: prefix } },
        data: { source: TrackSource.WEBDAV },
      });
      updated += res.count;
    }
    this.logger.log(`Track source backfill complete: ${updated} track(s) marked as WEBDAV across ${prefixes.length} source(s).`);

    // Only mark as done once the backfill fully succeeds, so transient failures retry next boot.
    await this.prisma.systemSetting.upsert({
      where: { key: FLAG_KEY },
      update: { value: 'true' },
      create: { key: FLAG_KEY, value: 'true' },
    });
  }

  private async recalibrateAllIndices() {
    const tracks = await this.prisma.track.findMany({
      where: { status: FileStatus.ACTIVE },
      select: { id: true, name: true, episodeNumber: true }
    });

    this.logger.log(`Starting index recalibration for ${tracks.length} tracks...`);
    let updateCount = 0;

    for (const track of tracks) {
      const newIndex = extractEpisodeNumber(track.name);
      if (newIndex !== track.episodeNumber) {
        await this.prisma.track.update({
          where: { id: track.id },
          data: { episodeNumber: newIndex }
        });
        updateCount++;
      }
    }

    if (updateCount > 0) {
      this.logger.log(`Recalibrated ${updateCount} track indices.`);
    } else {
      this.logger.log('All indices are already correct.');
    }
  }

  private async checkInitialWebDAVScan() {
    const count = await this.prisma.track.count();
    if (count === 0) {
      const cachePath = process.env.CACHE_DIR || './music/cover';
      const sources = await this.webDavConfig.list();
      if (sources.length > 0) {
        this.logger.log(`Library is empty. Triggering initial WebDAV scan across ${sources.length} source(s)...`);
        const targets = await this.webDavConfig.listScanTargets();
        this.runWebDavTargets(targets, { cachePath, reason: 'initial' }).catch(e =>
          this.logger.error('Initial WebDAV scan failed', e),
        );
      }
    }
  }

  private async startWebDAVImport(cachePath: string, type: TrackType, taskId?: string, isMvDir = false) {
    // Legacy wrapper used by the local-path import flow. Map the desired content kind to one
    // of the WebDAV path kinds and then scan every matching target.
    const kind: WebDavPathKind = isMvDir ? 'MV' : type === TrackType.AUDIOBOOK ? 'AUDIOBOOK' : 'MUSIC';
    const all = await this.webDavConfig.listScanTargets();
    const matched = all.filter((target) => target.kind === kind);
    if (matched.length === 0) return;

    const task = taskId ? this.tasks.get(taskId) : null;

    for (const target of matched) {
      await this.runSingleWebDavTarget(target, cachePath, task);
    }
  }

  private async runSingleWebDavTarget(
    target: { source: WebDavSource; kind: WebDavPathKind; path: string },
    cachePath: string,
    task?: ImportTask | null,
  ) {
    const isMv = target.kind === 'MV';
    const type: TrackType = isMv ? TrackType.MUSIC : target.kind === 'AUDIOBOOK' ? TrackType.AUDIOBOOK : TrackType.MUSIC;

    const scanner = new WebDAVScanner(
      target.source.url,
      target.source.username,
      target.source.password,
      cachePath,
    );

    this.logger.log(
      `Starting WebDAV scan: ${target.source.name} [${target.kind}] ${target.path} → ${target.source.url}`,
    );
    await scanner.scan(target.path, async (item) => {
      if (task) {
        task.currentFileName = item.title || path.basename(item.path);
      }

      const isMvFile = /\.(mp4|mkv|avi|webm)$/i.test(item.path);

      // Skip video files found in music/audiobook WebDAV folders — only MV folders should contain videos
      if (isMvFile && !isMv) {
        this.logger.log(`Skipping video file in non-MV WebDAV folder: ${item.path}`);
        return;
      }

      // Folder ID is null for WebDAV for now as it doesn't map to local folder tree easily
      const nextScanOrder = task ? (task.current || 0) + 1 : undefined;
      const sortFields = this.getTrackSortFields(item.originalPath || item.path, '', nextScanOrder);
      await this.processTrackData(item, type, '', cachePath, item.path, null, '', sortFields, TrackSource.WEBDAV);

      if (task) {
        if (isMv) {
          task.mvCurrent = (task.mvCurrent || 0) + 1;
        } else {
          task.webdavCurrent = (task.webdavCurrent || 0) + 1;
        }
        task.current = (task.current || 0) + 1;
      }
    });
    // processTrackData 只标记不刷新，这里统一 flush（该入口也会被独立 WebDAV 同步触发）
    await this.flushDirtyAlbums();
    this.logger.log(
      `WebDAV scan completed for source: ${target.source.name} [${target.kind}]`,
    );
  }

  /**
   * Run every enabled WebDAV target (one per configured sub-path).
   * Used by both the initial scan on startup and the standalone "Save and Sync" flow.
   */
  private async runWebDavTargets(
    targets: Array<{ source: WebDavSource; kind: WebDavPathKind; path: string }>,
    options: { cachePath: string; task?: ImportTask; reason?: string },
  ): Promise<void> {
    if (targets.length === 0) return;

    for (const target of targets) {
      try {
        await this.runSingleWebDavTarget(target, options.cachePath, options.task ?? null);
      } catch (e) {
        this.logger.error(
          `WebDAV scan failed for source ${target.source.name} [${target.kind}] (${target.source.url}): ${(e as Error).message}`,
        );
      }
    }
  }

  /**
   * Public entry point for the standalone "Sync WebDAV now" action — kicks off a task that scans
   * every enabled source and reports progress through the dedicated task map. Returns the task id
   * so the frontend can poll.
   */
  @LogMethod()
  triggerWebDavSync(): { id: string } {
    const id = randomUUID();
    const task: ImportTask = {
      id,
      status: TaskStatus.INITIALIZING,
      mode: 'incremental',
      type: 'webdav-sync',
      createdAt: new Date().toISOString(),
      message: '正在准备 WebDAV 扫描...',
      total: 0,
      current: 0,
      webdavTotal: 0,
      webdavCurrent: 0,
      mvTotal: 0,
      mvCurrent: 0,
      localTotal: 0,
      localCurrent: 0,
    };
    this.tasks.set(id, task);

    const cachePath = process.env.CACHE_DIR || './music/cover';

    (async () => {
      try {
        const targets = await this.webDavConfig.listScanTargets();
        if (targets.length === 0) {
          task.status = TaskStatus.SUCCESS;
          task.message = '没有启用的 WebDAV 路径';
          return;
        }

        task.status = TaskStatus.PARSING;
        task.message = `正在扫描 ${targets.length} 个 WebDAV 路径...`;

        await this.runWebDavTargets(targets, { cachePath, task: task ?? undefined, reason: 'manual' });

        task.status = TaskStatus.SUCCESS;
        task.message = 'WebDAV 同步完成';
      } catch (e) {
        this.logger.error('Manual WebDAV sync failed', e);
        task.status = TaskStatus.FAILED;
        task.message = e instanceof Error ? e.message : String(e);
      }
    })().catch((e) => {
      this.logger.error('Unhandled WebDAV sync error', e);
    });

    return { id };
  }

  /**
   * Strip embedded credentials from a URL: http://user:pass@host/x -> http://host/x.
   * WebDAV download links (getFileDownloadLink) embed the source's username/password
   * in the URL, while the configured source url does not — so we compare both without them.
   */
  private stripUrlCredentials(url: string): string {
    return (url || '').replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1');
  }

  /** Credential-free, trailing-slash-free prefix used to match a source against track.path. */
  private webdavMatchPrefix(sourceUrl: string): string {
    return this.stripUrlCredentials((sourceUrl || '').trim()).replace(/\/+$/, '');
  }

  /**
   * Find WebDAV tracks belonging to a source. track.path embeds credentials, so we
   * strip them from both sides and prefix-match. Optionally restrict by status.
   */
  private async findWebDavTracksForSource(
    sourceUrl: string,
    statuses?: FileStatus[],
  ): Promise<{ id: number; albumId: number | null }[]> {
    const prefix = this.webdavMatchPrefix(sourceUrl);
    if (!prefix) return [];
    const where: any = { source: TrackSource.WEBDAV };
    if (statuses && statuses.length > 0) where.status = { in: statuses };
    const tracks = await this.prisma.track.findMany({
      where,
      select: { id: true, path: true, albumId: true },
    });
    return tracks
      .filter((t) => this.stripUrlCredentials(t.path).startsWith(prefix))
      .map((t) => ({ id: t.id, albumId: t.albumId }));
  }

  /**
   * React to WebDAV source list changes (called after sources are saved):
   * - source removed  → hard-delete its tracks (FK-safe), then clean orphan albums/artists.
   * - source disabled → soft-trash its tracks (TRASHED, hidden from ACTIVE queries).
   * - source re-enabled → restore its TRASHED tracks to ACTIVE.
   *
   * Aligns with the existing scan's orphan-cleanup behaviour: a disabled source
   * is effectively "no longer part of the scan", so its tracks end up in the
   * same TRASHED state as files that disappeared from the library.
   */
  @LogMethod()
  async applyWebDavSourceChanges(
    oldSources: { id: string; url: string; enabled: boolean }[],
    newSources: { id: string; url: string; enabled: boolean }[],
  ): Promise<void> {
    // Defensive one-time normalization: any leftover DISABLED rows from the
    // previous FileStatus enum are equivalent to TRASHED for query purposes,
    // and can't be resurrected by toggling source.enabled once DISABLED is
    // gone from the enum. Normalize so the toggle logic can see them as TRASHED.
    await this.normalizeLegacyDisabledTracks();

    const newById = new Map(newSources.map((s) => [s.id, s]));

    for (const oldSrc of oldSources) {
      if (!this.webdavMatchPrefix(oldSrc.url)) continue;
      const newSrc = newById.get(oldSrc.id);

      if (!newSrc) {
        // Source removed → hard delete its tracks (any status), FK-safe, then
        // clean up albums/artists that no longer have any tracks.
        const tracks = await this.findWebDavTracksForSource(oldSrc.url);
        const ids = tracks.map((t) => t.id);
        const CHUNK = 300;
        for (let i = 0; i < ids.length; i += CHUNK) {
          const chunk = ids.slice(i, i + CHUNK);
          await this.prisma.userTrackLike.deleteMany({ where: { trackId: { in: chunk } } });
          await this.prisma.userTrackHistory.deleteMany({ where: { trackId: { in: chunk } } });
          await this.prisma.userAudiobookLike.deleteMany({ where: { trackId: { in: chunk } } });
          await this.prisma.userAudiobookHistory.deleteMany({ where: { trackId: { in: chunk } } });
          await this.prisma.track.deleteMany({ where: { id: { in: chunk } } });
        }
        if (ids.length > 0) {
          await this.cleanupOrphanAlbumsHardDelete();
          await this.cleanupOrphanArtistsHardDelete();
        }
        this.logger.log(`Removed WebDAV source ${oldSrc.id}: hard-deleted ${ids.length} track(s).`);
      } else if (oldSrc.enabled && !newSrc.enabled) {
        await this.setWebDavTracksStatus(oldSrc.url, FileStatus.ACTIVE, FileStatus.TRASHED);
      } else if (!oldSrc.enabled && newSrc.enabled) {
        await this.setWebDavTracksStatus(oldSrc.url, FileStatus.TRASHED, FileStatus.ACTIVE);
      }
    }
  }

  /**
   * Flip status of a source's WebDAV tracks, then refresh the visibility of their
   * parent albums/artists (empty albums auto-hide via the ACTIVE-track-count
   * derivation in updateParentStatus).
   */
  private async setWebDavTracksStatus(sourceUrl: string, from: FileStatus, to: FileStatus): Promise<void> {
    const tracks = await this.findWebDavTracksForSource(sourceUrl, [from]);
    if (tracks.length === 0) return;

    const ids = tracks.map((t) => t.id);
    const CHUNK = 300;
    for (let i = 0; i < ids.length; i += CHUNK) {
      await this.prisma.track.updateMany({
        where: { id: { in: ids.slice(i, i + CHUNK) } },
        data: { status: to, trashedAt: to === FileStatus.TRASHED ? new Date() : null },
      });
    }

    const albumIds = new Set(
      tracks.map((t) => t.albumId).filter((x): x is number => x != null),
    );
    for (const albumId of albumIds) {
      await this.updateParentStatus(albumId, 'album');
    }
    this.logger.log(`WebDAV tracks ${from} -> ${to}: ${ids.length} track(s) across ${albumIds.size} album(s).`);
  }

  /**
   * One-time cleanup of stale ACTIVE artists: any artist whose every album is
   * TRASHED (or absent) is itself TRASHED. Triggered once on module init via a
   * SystemSetting flag, idempotent on subsequent startups.
   */
  private async cleanupStaleArtists(): Promise<void> {
    const FLAG_KEY = 'stale_artists_cleaned';
    const done = await this.prisma.systemSetting.findUnique({ where: { key: FLAG_KEY } });
    if (done?.value === 'true') return;

    // Build the set of (artist, type) pairs that have at least one ACTIVE album.
    const activePairs = await this.prisma.album.groupBy({
      by: ['artist', 'type'],
      where: { status: FileStatus.ACTIVE },
    });
    const activeKeys = new Set(activePairs.map((p) => `${p.artist}::${p.type}`));

    const activeArtists = await this.prisma.artist.findMany({
      where: { status: FileStatus.ACTIVE },
      select: { id: true, name: true, type: true },
    });

    const staleIds = activeArtists
      .filter((a) => !activeKeys.has(`${a.name}::${a.type}`))
      .map((a) => a.id);

    if (staleIds.length > 0) {
      await this.prisma.artist.updateMany({
        where: { id: { in: staleIds } },
        data: { status: FileStatus.TRASHED, trashedAt: new Date() },
      });
      this.logger.log(`Cleaned up ${staleIds.length} stale ACTIVE artist(s).`);
    } else {
      this.logger.log('No stale ACTIVE artists found.');
    }

    await this.prisma.systemSetting.upsert({
      where: { key: FLAG_KEY },
      update: { value: 'true' },
      create: { key: FLAG_KEY, value: 'true' },
    });
  }

  /**
   * One-time cleanup: legacy rows with status='DISABLED' (from the old enum)
   * become 'TRASHED' so they participate in the same resurrection path on
   * re-enable. Safe to call repeatedly — UPDATE matches by string and is a
   * no-op when no rows match.
   */
  private async normalizeLegacyDisabledTracks(): Promise<void> {
    try {
      const result = await this.prisma.track.updateMany({
        where: { status: 'DISABLED' as any },
        data: { status: FileStatus.TRASHED, trashedAt: new Date() },
      });
      if (result.count > 0) {
        this.logger.log(`Normalized ${result.count} legacy DISABLED track(s) -> TRASHED.`);
      }
    } catch (err) {
      // Don't block the apply flow if the legacy column doesn't exist or the
      // string match is rejected by a future Prisma upgrade.
      this.logger.warn(`normalizeLegacyDisabledTracks skipped: ${(err as Error).message}`);
    }
  }

  private async generateMissingHashes() {
    const tracks = await this.prisma.track.findMany({
      where: {
        OR: [
          { fileHash: null },
          { fileHash: '' }
        ],
        status: FileStatus.ACTIVE
      },
      select: { id: true, path: true, name: true }
    });

    if (tracks.length === 0) return;

    this.logger.log(`Found ${tracks.length} tracks without hash. Starting generation...`);

    for (const track of tracks) {
      try {
        // Resolve absolute path using TrackService
        // track.path is URL like /music/Artist/Album/Song.mp3
        const absolutePath = await this.trackService.getFilePath(track.path);

        if (absolutePath && fs.existsSync(absolutePath)) {
          const hash = await this.calculateFingerprint(absolutePath);
          if (hash) {
            await this.prisma.track.update({
              where: { id: track.id },
              data: { fileHash: hash }
            });
            // this.logger.verbose(`Generated hash for track ${track.id}: ${hash}`);
          }
        } else {
          this.logger.warn(`File not found for track ${track.id} (${track.name}): ${absolutePath || track.path}`);
        }
      } catch (e) {
        this.logger.error(`Error generating hash for track ${track.id}`, e);
      }
    }

    this.logger.log(`Finished generating missing hashes.`);
  }

  @LogMethod()
  createTask(
    musicPaths: string[] | string,
    audiobookPaths: string[] | string,
    mvPaths: string[] | string,
    cachePath: string,
    mode: 'incremental' | 'full' | 'compact' = 'incremental'
  ): string {
    const id = randomUUID();
    this.tasks.set(id, {
      id,
      status: TaskStatus.INITIALIZING,
      mode,
      type: mode,
      createdAt: new Date().toISOString(),
    });

    const normalizedMusicPaths = this.normalizePathInput(musicPaths);
    const normalizedAudiobookPaths = this.normalizePathInput(audiobookPaths);
    const normalizedMvPaths = this.normalizePathInput(mvPaths);

    this.startImport(id, normalizedMusicPaths, normalizedAudiobookPaths, normalizedMvPaths, cachePath, mode).catch(err => {
      console.error("Unhandled import error", err);
    });

    return id;
  }

  @LogMethod()
  getTask(id: string): ImportTask | undefined {
    return this.tasks.get(id);
  }

  @LogMethod()
  getAllTasks(): ImportTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => {
      const at = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
      return bt - at;
    });
  }

  @LogMethod()
  getRunningTask(): ImportTask | undefined {
    return Array.from(this.tasks.values()).find(
      task =>
        task.status === TaskStatus.INITIALIZING ||
        task.status === TaskStatus.PREPARING ||
        task.status === TaskStatus.PARSING
    );
  }

  private convertToHttpUrl(localPath: string, type: 'cover' | 'audio' | 'music', basePath: string): string {
    const relativePath = path.relative(basePath, localPath);
    if (type === 'cover') {
      // Map the on-disk cover path to its /covers/ URL: resolve relative to cacheDir and
      // normalize backslashes so the static server can locate the file.
      const normalizedRelativePath = relativePath.replace(/\\/g, '/');
      return `/covers/${normalizedRelativePath}`;
    } else {
      return `/${type}/${relativePath}`;
    }
  }

  /**
   * Resolve the cover to persist on a track update, honoring the global
   * metadata-priority policy from MetadataPluginService.
   * - 'plugin' mode: overwrite with the plugin cover only when a plugin ran and
   *   returned one; otherwise keep the stored cover (legacy behavior).
   * - 'embedded' mode: prefer the file's (gap-filled) cover, fall back to the
   *   stored cover - the plugin only filled it if the file had none.
   */
  private resolveCoverForUpdate(
    metadataSource: MetadataSource,
    coverUrl: string | null,
    existingCover: string | null,
  ): string | null {
    const pluginMode =
      this.metadataPluginService.getMetadataPriority() === 'plugin';
    if (pluginMode) {
      return metadataSource === MetadataSource.PLUGIN && coverUrl
        ? coverUrl
        : existingCover;
    }
    return coverUrl || existingCover;
  }

  private isMvFile(filePath: string): boolean {
    return /\.(mp4|mkv|avi|webm)$/i.test(filePath);
  }

  private needsMvTranscode(filePath: string, isWebDAV: boolean): boolean {
    return !isWebDAV && !filePath.toLowerCase().endsWith('.mp4');
  }

  // ---------- Audio Transcode ----------

  private needsAudioTranscode(filePath: string): boolean {
    return /\.(wma|ape|dsf|dff|wv|mpc)$/i.test(filePath);
  }

  private getAudioTranscodedDir(cachePath: string): string {
    return path.join(cachePath, 'transcoded-audio');
  }

  private getAudioTranscodedPublicUrl(outputPath: string, cachePath: string): string {
    // cacheDir is served under /covers/ prefix in main.ts
    // outputPath is like .../music/cover/transcoded-audio/xxx.mp3
    // We need to return /covers/transcoded-audio/xxx.mp3
    const transcodedDir = this.getAudioTranscodedDir(cachePath);
    const relativePath = path.relative(transcodedDir, outputPath);
    return `/covers/transcoded-audio/${relativePath}`;
  }

  private isTranscodedAudioPath(targetPath: string, cachePath: string): boolean {
    return targetPath.startsWith(this.getAudioTranscodedDir(cachePath));
  }

  private getAudioTranscodedFilePath(sourcePath: string, cachePath: string): string {
    const sourceKey = crypto
      .createHash('sha1')
      .update(path.resolve(sourcePath))
      .digest('hex');
    return path.join(this.getAudioTranscodedDir(cachePath), `${sourceKey}.mp3`);
  }

  private async ensureAudioAsMp3(
    sourcePath: string,
    cachePath: string,
  ): Promise<MvStorageTarget> {
    if (!this.needsAudioTranscode(sourcePath)) {
      return {
        sourcePath,
        publicUrl: '',
      };
    }

    const outputDir = this.getAudioTranscodedDir(cachePath);
    const outputPath = this.getAudioTranscodedFilePath(sourcePath, cachePath);

    fs.mkdirSync(outputDir, { recursive: true });

    const sourceStat = fs.statSync(sourcePath);
    if (fs.existsSync(outputPath)) {
      const outputStat = fs.statSync(outputPath);
      if (outputStat.mtimeMs >= sourceStat.mtimeMs) {
        return {
          sourcePath: outputPath,
          publicUrl: this.getAudioTranscodedPublicUrl(outputPath, cachePath),
        };
      }
    }

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-i', sourcePath,
        '-c:a', 'libmp3lame',
        '-b:a', '192k',
        '-ar', '44100',
        '-ac', '2',
        '-map_metadata', '0',
        '-id3v2_version', '3',
        '-write_xing', '0',
        outputPath,
      ]);

      let stderr = '';

      ffmpeg.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      ffmpeg.on('error', (error) => {
        reject(error);
      });

      ffmpeg.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          // Verify output file is valid (non-empty and has MP3 header)
          const outputStat = fs.statSync(outputPath);
          if (outputStat.size === 0) {
            reject(new Error('ffmpeg produced empty output file'));
            return;
          }

          // Check for MP3 frame sync bytes (0xFFE or 0xFFF at start)
          const fd = fs.openSync(outputPath, 'r');
          const header = Buffer.alloc(4);
          fs.readSync(fd, header, 0, 4, 0);
          fs.closeSync(fd);

          const isMp3 = (header[0] === 0xFF) && ((header[1] & 0xE0) === 0xE0);
          if (!isMp3) {
            this.logger.warn(`[Transcode] Output file does not have valid MP3 header. First bytes: ${header.toString('hex')}. stderr: ${stderr}`);
            // Don't reject - some formats may have ID3 tags before frames
          }

          if (stderr) {
            this.logger.log(`[Transcode] ffmpeg stderr for ${path.basename(sourcePath)}: ${stderr.substring(0, 500)}`);
          }

          this.logger.log(`[Transcode] Success: ${path.basename(sourcePath)} -> ${path.basename(outputPath)} (${outputStat.size} bytes)`);
          resolve();
          return;
        }

        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      });
    });

    return {
      sourcePath: outputPath,
      publicUrl: this.getAudioTranscodedPublicUrl(outputPath, cachePath),
    };
  }

  private getMvTranscodedDir(cachePath: string): string {
    return path.join(cachePath, 'transcoded-mv');
  }

  private isTranscodedMvPath(targetPath: string, cachePath: string): boolean {
    return targetPath.startsWith(this.getMvTranscodedDir(cachePath));
  }

  private getMvTranscodedFilePath(sourcePath: string, cachePath: string): string {
    const sourceKey = crypto
      .createHash('sha1')
      .update(path.resolve(sourcePath))
      .digest('hex');
    return path.join(this.getMvTranscodedDir(cachePath), `${sourceKey}.mp4`);
  }

  private async ensureMvAsMp4(
    sourcePath: string,
    cachePath: string,
    isWebDAV: boolean,
  ): Promise<MvStorageTarget> {
    if (!this.needsMvTranscode(sourcePath, isWebDAV)) {
      return {
        sourcePath,
        publicUrl: '',
      };
    }

    const outputDir = this.getMvTranscodedDir(cachePath);
    const outputPath = this.getMvTranscodedFilePath(sourcePath, cachePath);

    fs.mkdirSync(outputDir, { recursive: true });

    const sourceStat = fs.statSync(sourcePath);
    if (fs.existsSync(outputPath)) {
      const outputStat = fs.statSync(outputPath);
      if (outputStat.mtimeMs >= sourceStat.mtimeMs) {
        return {
          sourcePath: outputPath,
          publicUrl: this.convertToHttpUrl(outputPath, 'music', outputDir),
        };
      }
    }

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-i', sourcePath,
        '-map', '0:v:0',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        outputPath,
      ]);

      let stderr = '';

      ffmpeg.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      ffmpeg.on('error', (error) => {
        reject(error);
      });

      ffmpeg.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          resolve();
          return;
        }

        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      });
    });

    return {
      sourcePath: outputPath,
      publicUrl: this.convertToHttpUrl(outputPath, 'music', outputDir),
    };
  }

  private async clearLibraryData(task?: ImportTask) {
    this.logger.log('Starting full library soft-sync (marking as TRASHED)...');

    if (task) {
      task.status = TaskStatus.PREPARING;
      task.message = '正在准备环境...';
    }

    const tables = [
      { name: '曲目', model: this.prisma.track },
      { name: '专辑', model: this.prisma.album },
      { name: '艺人', model: this.prisma.artist }
    ];

    if (task) task.total = tables.length;

    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      if (task) {
        task.current = i + 1;
        task.message = `正在清理${table.name}数据...`;
      }
      // @ts-ignore
      await table.model.updateMany({
        data: { status: FileStatus.TRASHED, trashedAt: new Date() }
      });
    }

    this.logger.log('Soft-sync initialization completed.');
  }

  async calculateFingerprint(filePath: string): Promise<string> {
    try {
      if (!fs.existsSync(filePath)) return '';
      const stat = await fs.promises.stat(filePath);
      const size = stat.size;
      const fd = await fs.promises.open(filePath, 'r');

      const bufferSize = 16 * 1024;
      const startBuffer = Buffer.alloc(Math.min(bufferSize, size));
      await fd.read(startBuffer, 0, startBuffer.length, 0);

      const endBuffer = Buffer.alloc(Math.min(bufferSize, size));
      if (size > bufferSize) {
        await fd.read(endBuffer, 0, endBuffer.length, size - endBuffer.length);
      }
      await fd.close();

      const hash = crypto.createHash('md5');
      hash.update(String(size));
      hash.update(startBuffer);
      if (size > bufferSize) {
        hash.update(endBuffer);
      }
      return hash.digest('hex');
    } catch (e) {
      console.error(`Failed to calculate fingerprint for ${filePath}`, e);
      return '';
    }
  }

  @LogMethod()
  setupWatcher(musicPaths: string[], audiobookPaths: string[], mvPaths: string[], cachePath: string) {
    if (this.watcher) {
      this.watcher.close();
    }

    const paths = [...musicPaths, ...audiobookPaths, ...mvPaths].filter(p => fs.existsSync(p));
    this.logger.log(`Starting file watcher on: ${paths.join(', ')}`);

    this.watcher = chokidar.watch(paths, {
      persistent: true,
      usePolling: true,
      interval: 1000,
      binaryInterval: 3000,
      ignoreInitial: true,
      alwaysStat: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 500
      }
    });

    const findBasePath = (filePath: string, basePaths: string[]): string | null => {
      const matches = basePaths.filter((basePath) => filePath.startsWith(basePath));
      if (matches.length === 0) return null;
      return matches.sort((a, b) => b.length - a.length)[0];
    };

    const getBasePathAndType = (filePath: string): { basePath: string, type: TrackType } | null => {
      const musicBase = findBasePath(filePath, musicPaths);
      const audiobookBase = findBasePath(filePath, audiobookPaths);
      const mvBase = findBasePath(filePath, mvPaths);

      if (mvBase) return { basePath: mvBase, type: TrackType.MUSIC }; // Treating MV as MUSIC for now or add a new type if necessary

      if (musicBase && audiobookBase) {
        return musicBase.length >= audiobookBase.length
          ? { basePath: musicBase, type: TrackType.MUSIC }
          : { basePath: audiobookBase, type: TrackType.AUDIOBOOK };
      }
      if (musicBase) return { basePath: musicBase, type: TrackType.MUSIC };
      if (audiobookBase) return { basePath: audiobookBase, type: TrackType.AUDIOBOOK };
      return null;
    };

    const safeUnwatch = (targetPath?: string) => {
      if (!targetPath || !this.watcher) return;

      Promise.resolve(this.watcher.unwatch(targetPath)).catch((unwatchError) => {
        this.logger.warn(`Failed to stop watching inaccessible path ${targetPath}: ${String(unwatchError)}`);
      });
    };

    const isRecoverableWatchError = (error: unknown): error is NodeJS.ErrnoException => {
      if (!error || typeof error !== 'object') return false;

      const code = (error as NodeJS.ErrnoException).code;
      return code === 'ENOTCONN'
        || code === 'ESTALE'
        || code === 'ENOENT'
        || code === 'EACCES'
        || code === 'EPERM';
    };

    this.watcher
      .on('add', async (filePath) => {
        if (this.isTranscodedMvPath(filePath, cachePath)) {
          return;
        }
        const info = getBasePathAndType(filePath);
        if (info) {
          if (/\.(mp3|flac|ogg|wav|m4a|mp4|strm|mkv|avi|webm|aac|wma|opus|ape|aiff|aif|dsf|dff|wv|mpc|alac)$/i.test(filePath)) {
            this.logger.log(`[Watcher] File added: ${filePath}`);
            await this.handleFileAdd(filePath, info.basePath, info.type, cachePath);
          } else if (/\.(jpg|jpeg|png|webp)$/i.test(filePath)) {
            this.logger.log(`[Watcher] Image added: ${filePath}`);
            await this.handleImageChange(filePath, cachePath);
          } else if (/\.(lrc|txt)$/i.test(filePath)) {
            this.logger.log(`[Watcher] Lyric added: ${filePath}`);
            await this.handleLyricChange(filePath);
          }
        }
      })
      .on('change', async (filePath) => {
        if (this.isTranscodedMvPath(filePath, cachePath)) {
          return;
        }
        const info = getBasePathAndType(filePath);

        if (info) {
          if (/\.(mp3|flac|ogg|wav|m4a|mp4|strm|mkv|avi|webm|aac|wma|opus|ape|aiff|aif|dsf|dff|wv|mpc|alac)$/i.test(filePath)) {
            try {
              // 检查函数是否存在
              if (typeof this.handleFileChange !== 'function') {
                throw new Error(`handleFileChange is not a function! type of this.handleFileChange is: ${typeof this.handleFileChange}`);
              }

              await this.handleFileChange(filePath, info.basePath, info.type, cachePath);
            } catch (e) {
              // 这里会打印出导致无法进入函数的真正原因
              this.logger.error(`[Watcher] CRITICAL ERROR calling handleFileChange:`, e);
            }
          } else if (/\.(jpg|jpeg|png|webp)$/i.test(filePath)) {
            this.logger.log(`[Watcher] Image changed: ${filePath}`);
            await this.handleImageChange(filePath, cachePath);
          } else if (/\.(lrc|txt)$/i.test(filePath)) {
            this.logger.log(`[Watcher] Lyric changed: ${filePath}`);
            await this.handleLyricChange(filePath);
          }
        }
      })
      .on('unlink', async (filePath) => {
        if (this.isTranscodedMvPath(filePath, cachePath)) {
          return;
        }
        this.logger.log(`[Watcher] File unlinked: ${filePath}`);
        if (/\.(mp3|flac|ogg|wav|m4a|mp4|strm|mkv|avi|webm|aac|wma|opus|ape|aiff|aif|dsf|dff|wv|mpc|alac)$/i.test(filePath)) {
          await this.handleFileUnlink(filePath, musicPaths, audiobookPaths, mvPaths, cachePath);
        } else if (/\.(jpg|jpeg|png|webp)$/i.test(filePath)) {
          await this.handleImageUnlink(filePath, cachePath);
        } else if (/\.(lrc|txt)$/i.test(filePath)) {
          await this.handleLyricUnlink(filePath);
        }
      })
      .on('error', (error: unknown) => {
        const err = error as NodeJS.ErrnoException;
        const targetPath = typeof err?.path === 'string' ? err.path : undefined;

        if (isRecoverableWatchError(err)) {
          this.logger.warn(`Watcher hit a recoverable filesystem error${targetPath ? ` on ${targetPath}` : ''}: ${err.code}`);
          safeUnwatch(targetPath);
          return;
        }

        this.logger.error('Watcher encountered a fatal error', err);
      });
  }

  private normalizePathInput(input: string[] | string): string[] {
    if (Array.isArray(input)) {
      if (input.length === 1) {
        return resolvePathList(input[0], './');
      }
      return Array.from(new Set(input.map((value) => resolvePathList(value, './')).flat()));
    }
    return resolvePathList(input, './');
  }

  private isPathInsideAnyBase(targetPath: string, basePaths: string[]): boolean {
    if (!targetPath || targetPath.startsWith('http')) return false;

    const resolvedTarget = path.resolve(targetPath);
    return basePaths.some((basePath) => {
      const resolvedBase = path.resolve(basePath);
      const relative = path.relative(resolvedBase, resolvedTarget);
      return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    });
  }

  private getTrackSortFields(
    sourcePath: string,
    basePath: string,
    scanOrder?: number,
  ): TrackSortFields {
    const normalizedSourcePath = sourcePath || '';
    const decodedSourcePath = decodeURI(normalizedSourcePath);
    const fileName = path.basename(decodedSourcePath) || null;

    let relativePath: string | null = null;
    if (basePath && normalizedSourcePath && !normalizedSourcePath.startsWith('http')) {
      relativePath = path.relative(basePath, normalizedSourcePath);
    } else if (normalizedSourcePath.startsWith('http')) {
      try {
        relativePath = new URL(normalizedSourcePath).pathname || null;
      } catch {
        relativePath = normalizedSourcePath;
      }
    } else if (normalizedSourcePath) {
      relativePath = normalizedSourcePath;
    }

    let fileCreatedAt: Date | null = null;
    if (normalizedSourcePath && !normalizedSourcePath.startsWith('http') && fs.existsSync(normalizedSourcePath)) {
      try {
        const stat = fs.statSync(normalizedSourcePath);
        fileCreatedAt = stat.birthtime ?? null;
      } catch (error) {
        this.logger.warn(`Failed to read file birthtime for ${normalizedSourcePath}: ${String(error)}`);
      }
    }

    return {
      fileName,
      relativePath,
      fileCreatedAt,
      scanOrder: scanOrder ?? null,
    };
  }

  private async handleFileAdd(filePath: string, basePath: string, type: TrackType, cachePath: string) {
    const hash = await this.calculateFingerprint(filePath);
    if (!hash) return;

    if (this.isMvFile(filePath)) {
      if (!this.scanner) this.scanner = new LocalMusicScanner(cachePath);
      const metadata = await this.scanner.parseFile(filePath);
      if (metadata) {
        const mvTarget = await this.ensureMvAsMp4(filePath, cachePath, false);
        const mvUrl = mvTarget.publicUrl || this.convertToHttpUrl(filePath, 'music', basePath);
        await this.processMvData(metadata, basePath, cachePath, mvUrl, hash, false, mvTarget.sourcePath);
      }
      return;
    }

    const trashedTrack = await this.prisma.track.findFirst({
      where: { fileHash: hash, status: FileStatus.TRASHED }
    });

    if (trashedTrack) {
      this.logger.log(`[Watcher] Resurrecting moved track: ${trashedTrack.name} -> ${filePath}`);

      let audioUrl = '';
      if (filePath.toLowerCase().endsWith('.strm')) {
        if (!this.scanner) this.scanner = new LocalMusicScanner(cachePath);
        const metadata = await this.scanner.parseFile(filePath);
        audioUrl = metadata?.path || '';
      }

      if (!audioUrl) {
        audioUrl = filePath.startsWith('http') ? filePath : this.convertToHttpUrl(filePath, type === TrackType.AUDIOBOOK ? 'audio' : 'music', basePath);
      }

      // Audio transcode for incompatible formats on resurrection
      let finalAudioUrl = audioUrl;
      let transcodedPath: string | null = null;
      if (!audioUrl.startsWith('http') && this.needsAudioTranscode(filePath)) {
        const transcodeResult = await this.ensureAudioAsMp3(filePath, cachePath);
        if (transcodeResult.publicUrl) {
          finalAudioUrl = transcodeResult.publicUrl;
          transcodedPath = transcodeResult.sourcePath;
        }
      }

      const folderId = await this.getFolderId(filePath, basePath, type);
      const sortFields = this.getTrackSortFields(filePath, basePath);

      await this.prisma.track.update({
        where: { id: trashedTrack.id },
        data: {
          path: finalAudioUrl,
          folderId: folderId,
          status: FileStatus.ACTIVE,
          trashedAt: null,
          fileModifiedAt: fs.statSync(filePath).mtime,
          fileName: sortFields.fileName,
          relativePath: sortFields.relativePath,
          fileCreatedAt: sortFields.fileCreatedAt,
          transcodedPath: transcodedPath || trashedTrack.transcodedPath,
          source: TrackSource.FILE,
        }
      });

      if (trashedTrack.albumId) {
        await this.updateParentStatus(trashedTrack.albumId, 'album');
      }
    } else {
      if (!this.scanner) this.scanner = new LocalMusicScanner(cachePath);
      const metadata = await this.scanner.parseFile(filePath);
      if (metadata) {
        const audioUrl = metadata.path.startsWith('http') ? metadata.path : this.convertToHttpUrl(filePath, type === TrackType.AUDIOBOOK ? 'audio' : 'music', basePath);
        const folderId = await this.getFolderId(metadata.originalPath || filePath, basePath, type);
        const sortFields = this.getTrackSortFields(metadata.originalPath || filePath, basePath);
        await this.processTrackData(metadata, type, basePath, cachePath, audioUrl, folderId, hash, sortFields, TrackSource.FILE);
        // 单文件事件，立即 flush（processTrackData 只标记不刷新）
        await this.flushDirtyAlbums();
      }
    }
  }

  private async handleFileChange(filePath: string, basePath: string, type: TrackType, cachePath: string) {
    try {
      this.logger.log(`[Watcher] Processing file change: ${filePath}`);

      if (!this.scanner) this.scanner = new LocalMusicScanner(cachePath);
      const metadata = await this.scanner.parseFile(filePath);

      this.logger.log(`[Watcher] Metadata extracted: ${!!metadata}`);
      if (metadata) {
        this.logger.log(`[Watcher] Metadata details - title: ${metadata.title}, artist: ${metadata.artist}, album: ${metadata.album}, coverPath: ${metadata.coverPath}, lyrics: ${!!metadata.lyrics}`);

        if (this.isMvFile(filePath)) {
          const hash = await this.calculateFingerprint(filePath);
          const mvTarget = await this.ensureMvAsMp4(filePath, cachePath, false);
          const mvUrl = mvTarget.publicUrl || this.convertToHttpUrl(filePath, 'music', basePath);
          await this.processMvData(metadata, basePath, cachePath, mvUrl, hash, false, mvTarget.sourcePath);
          this.logger.log(`[Watcher] Successfully updated MV metadata: ${metadata.title || path.basename(filePath)}`);
          return;
        }

        // Enrich metadata via user-configured plugins
        const enriched = await this.metadataPluginService.enrich(metadata, type, { cachePath });
        const metadataSource = (enriched as any).__metadataSource || MetadataSource.EMBEDDED;
        const metadataProvider = (enriched as any).__metadataProvider || null;

        let audioUrl = enriched.path.startsWith('http') ? enriched.path : this.convertToHttpUrl(filePath, type === TrackType.AUDIOBOOK ? 'audio' : 'music', basePath);
        this.logger.log(`[Watcher] Audio URL: ${audioUrl}`);

        // Audio transcode for incompatible formats on change
        let finalAudioUrl = audioUrl;
        let transcodedPath: string | null = null;
        if (!audioUrl.startsWith('http') && this.needsAudioTranscode(filePath)) {
          const transcodeResult = await this.ensureAudioAsMp3(filePath, cachePath);
          if (transcodeResult.publicUrl) {
            finalAudioUrl = transcodeResult.publicUrl;
            transcodedPath = transcodeResult.sourcePath;
          }
        }

        const track = await this.trackService.findByPath(finalAudioUrl);
        if (!track) {
          // Fallback: try to find by original audioUrl
          const trackByOriginal = await this.trackService.findByPath(audioUrl);
          if (trackByOriginal) {
            this.logger.log(`[Watcher] Track found by original path: ${trackByOriginal.id}`);
          }
        }
        this.logger.log(`[Watcher] Track found in DB: ${!!track} (id: ${track?.id})`);

        const hash = await this.calculateFingerprint(filePath);

        const targetTrack = track || await this.trackService.findByPath(audioUrl);

        if (targetTrack) {
          const coverUrl = enriched.coverPath ? this.convertToHttpUrl(enriched.coverPath, 'cover', cachePath) : null;
          this.preGenerateCover(coverUrl);
          const sortFields = this.getTrackSortFields(enriched.originalPath || filePath, basePath);

          this.logger.log(`[Watcher] Updating track ${targetTrack.id} - cover: ${coverUrl}, lyrics: ${!!enriched.lyrics}`);

          await this.prisma.track.update({
            where: { id: targetTrack.id },
            data: {
              name: enriched.title || path.basename(filePath),
              duration: Math.round(enriched.duration || 0),
              fileHash: hash,
              fileModifiedAt: enriched?.mtime ? new Date(enriched.mtime) : fs.statSync(filePath).mtime,
              cover: this.resolveCoverForUpdate(metadataSource, coverUrl, targetTrack.cover),
              lyrics: enriched.lyrics || null,
              artist: enriched.artist || targetTrack.artist,
              album: enriched.album || targetTrack.album,
              fileName: sortFields.fileName,
              relativePath: sortFields.relativePath,
              fileCreatedAt: sortFields.fileCreatedAt,
              path: finalAudioUrl,
              transcodedPath: transcodedPath || targetTrack.transcodedPath,
              metadataSource,
              metadataProvider,
            }
          });

          this.logger.log(`[Watcher] Successfully updated track metadata: ${targetTrack.name}`);
        } else {
          this.logger.warn(`[Watcher] Track not found in database for path: ${finalAudioUrl}`);
        }
      } else {
        this.logger.error(`[Watcher] Failed to extract metadata from: ${filePath}`);
      }
    } catch (error) {
      this.logger.error(`[Watcher] Error in handleFileChange for ${filePath}:`, error);
    }
  }

  private async handleFileUnlink(filePath: string, musicPaths: string[], audiobookPaths: string[], mvPaths: string[], cachePath: string) {
    const findBasePath = (basePaths: string[]): string | null => {
      const matches = basePaths.filter((basePath) => filePath.startsWith(basePath));
      if (matches.length === 0) return null;
      return matches.sort((a, b) => b.length - a.length)[0];
    };

    let url = '';
    const musicBase = findBasePath(musicPaths);
    const audiobookBase = findBasePath(audiobookPaths);
    const mvBase = findBasePath(mvPaths);

    if (mvBase) {
      url = this.convertToHttpUrl(filePath, 'music', mvBase); // assuming mv is served under music or mv route
    } else if (musicBase && (!audiobookBase || musicBase.length >= audiobookBase.length)) {
      url = this.convertToHttpUrl(filePath, 'music', musicBase);
    } else if (audiobookBase) {
      url = this.convertToHttpUrl(filePath, 'audio', audiobookBase);
    }

    if (!url) return;

    // Check if it's an MV
    if (this.isMvFile(filePath)) {
      const transcodedPath = this.needsMvTranscode(filePath, false)
        ? this.getMvTranscodedFilePath(filePath, cachePath)
        : '';
      const transcodedUrl = this.needsMvTranscode(filePath, false)
        ? this.convertToHttpUrl(
          transcodedPath,
          'music',
          this.getMvTranscodedDir(cachePath),
        )
        : '';
      const mv = await this.prisma.mv.findFirst({
        where: {
          path: transcodedUrl ? { in: [url, transcodedUrl] } : url,
          status: FileStatus.ACTIVE
        }
      });
      if (mv) {
        this.logger.log(`[Watcher] Soft deleting MV ${mv.id} (${mv.name})`);
        await this.prisma.mv.update({
          where: { id: mv.id },
          data: { status: FileStatus.TRASHED, trashedAt: new Date() }
        });
      }

      if (transcodedPath && fs.existsSync(transcodedPath)) {
        fs.unlinkSync(transcodedPath);
      }
      return;
    }

    const track = await this.prisma.track.findFirst({
      where: {
        path: url,
        status: FileStatus.ACTIVE
      }
    });

    if (track) {
      this.logger.log(`[Watcher] Soft deleting track ${track.id} (${track.name})`);
      await this.prisma.track.update({
        where: { id: track.id },
        data: {
          status: FileStatus.TRASHED,
          trashedAt: new Date()
        }
      });

      // Clean up transcoded audio file if exists
      if (track.transcodedPath && fs.existsSync(track.transcodedPath)) {
        fs.unlinkSync(track.transcodedPath);
      }

      if (track.albumId) {
        await this.updateParentStatus(track.albumId, 'album');
      }
    }
  }

  private async handleImageChange(filePath: string, cachePath: string) {
    const dirPath = path.dirname(filePath);
    const folder = await this.prisma.folder.findFirst({
      where: { path: dirPath }
    });

    if (!folder) return;

    const tracks = await this.prisma.track.findMany({
      where: { folderId: folder.id, status: FileStatus.ACTIVE },
      select: { id: true, albumId: true }
    });

    if (tracks.length === 0) return;

    if (!this.scanner) this.scanner = new LocalMusicScanner(cachePath);
    const cachedCoverPath = await this.scanner.findCoverInDirectory(dirPath);
    const coverUrl = cachedCoverPath ? this.convertToHttpUrl(cachedCoverPath, 'cover', cachePath) : null;
    this.preGenerateCover(coverUrl);

    const albumIds = new Set<number>();
    for (const track of tracks) {
      await this.prisma.track.update({
        where: { id: track.id },
        data: { cover: coverUrl }
      });
      if (track.albumId) albumIds.add(track.albumId);
    }

    for (const albumId of albumIds) {
      await this.prisma.album.update({
        where: { id: albumId },
        data: { cover: coverUrl }
      });
    }
    this.logger.log(`[Watcher] Updated cover for ${tracks.length} tracks and ${albumIds.size} albums in ${dirPath} to ${coverUrl}`);
  }

  private async handleImageUnlink(filePath: string, cachePath: string) {
    await this.handleImageChange(filePath, cachePath);
  }

  private async handleLyricChange(filePath: string) {
    const dirPath = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));

    const folder = await this.prisma.folder.findFirst({
      where: { path: dirPath }
    });
    if (!folder) return;

    const tracks = await this.prisma.track.findMany({
      where: { folderId: folder.id, status: FileStatus.ACTIVE }
    });

    for (const track of tracks) {
      const absolutePath = await this.trackService.getFilePath(track.path);
      if (!absolutePath) continue;

      const trackBaseName = path.basename(absolutePath, path.extname(absolutePath));
      if (trackBaseName === baseName) {
        const lyrics = readLyricsFile(filePath);
        if (lyrics !== null) {
          await this.prisma.track.update({
            where: { id: track.id },
            data: { lyrics }
          });
          this.logger.log(`[Watcher] Updated lyrics for track ${track.id} (${track.name})`);
        }
        break;
      }
    }
  }

  private async handleLyricUnlink(filePath: string) {
    const dirPath = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));

    const folder = await this.prisma.folder.findFirst({
      where: { path: dirPath }
    });
    if (!folder) return;

    const tracks = await this.prisma.track.findMany({
      where: { folderId: folder.id, status: FileStatus.ACTIVE }
    });

    for (const track of tracks) {
      const absolutePath = await this.trackService.getFilePath(track.path);
      if (!absolutePath) continue;

      const trackBaseName = path.basename(absolutePath, path.extname(absolutePath));
      if (trackBaseName === baseName) {
        await this.prisma.track.update({
          where: { id: track.id },
          data: { lyrics: null }
        });
        this.logger.log(`[Watcher] Removed lyrics for track ${track.id} (${track.name})`);
        break;
      }
    }
  }

  private async updateParentStatus(id: number, type: 'album' | 'artist') {
    if (type === 'album') {
      const album = await this.prisma.album.findUnique({
        where: { id },
        include: { _count: { select: { tracks: { where: { status: FileStatus.ACTIVE } } } } }
      });

      if (!album) return;

      // @ts-ignore
      const activeTracksCount = album._count.tracks;

      if (activeTracksCount === 0 && album.status === FileStatus.ACTIVE) {
        await this.prisma.album.update({
          where: { id },
          data: { status: FileStatus.TRASHED, trashedAt: new Date() }
        });
        const albumWithArtist = await this.prisma.album.findUnique({ where: { id }, select: { artist: true, type: true } });
        if (albumWithArtist) {
          const artist = await this.prisma.artist.findFirst({ where: { name: albumWithArtist.artist, type: albumWithArtist.type } });
          if (artist) await this.updateParentStatus(artist.id, 'artist');
        }
      } else if (activeTracksCount > 0 && album.status === FileStatus.TRASHED) {
        await this.prisma.album.update({
          where: { id },
          data: { status: FileStatus.ACTIVE, trashedAt: null }
        });
        const albumWithArtist = await this.prisma.album.findUnique({ where: { id }, select: { artist: true, type: true } });
        if (albumWithArtist) {
          const artist = await this.prisma.artist.findFirst({ where: { name: albumWithArtist.artist, type: albumWithArtist.type } });
          if (artist) await this.updateParentStatus(artist.id, 'artist');
        }
      }
    } else if (type === 'artist') {
      const artist = await this.prisma.artist.findUnique({
        where: { id }
      });

      if (!artist) return;

      const activeAlbumsCount = await this.prisma.album.count({
        where: { artist: artist.name, type: artist.type, status: FileStatus.ACTIVE }
      });

      if (activeAlbumsCount === 0 && artist.status === FileStatus.ACTIVE) {
        await this.prisma.artist.update({
          where: { id },
          data: { status: FileStatus.TRASHED, trashedAt: new Date() }
        });
      } else if (activeAlbumsCount > 0 && artist.status === FileStatus.TRASHED) {
        await this.prisma.artist.update({
          where: { id },
          data: { status: FileStatus.ACTIVE, trashedAt: null }
        });
      }
    }
  }

  private markAlbumDirty(albumId: number | null | undefined) {
    if (albumId) this.dirtyAlbumIds.add(albumId);
  }

  private async flushDirtyAlbums() {
    if (this.dirtyAlbumIds.size === 0) return;
    const ids = Array.from(this.dirtyAlbumIds);
    this.dirtyAlbumIds.clear();
    for (const albumId of ids) {
      await this.updateParentStatus(albumId, 'album');
    }
  }

  /**
   * 预载本地（FILE 来源）ACTIVE 曲目的 path → {id, mtime} 索引，
   * 供扫描预检（mtime 短路）判断文件是否未变化。
   * 只索引 ACTIVE：TRASHED 记录不跳过，走正常处理以维持「文件仍在则复活」语义。
   */
  private async buildLocalTrackIndex(): Promise<Map<string, { id: number; mtimeMs: number | null }>> {
    const tracks = await this.prisma.track.findMany({
      where: { source: TrackSource.FILE, status: FileStatus.ACTIVE },
      select: { id: true, path: true, fileModifiedAt: true },
    });
    const map = new Map<string, { id: number; mtimeMs: number | null }>();
    for (const t of tracks) {
      map.set(t.path, { id: t.id, mtimeMs: t.fileModifiedAt ? t.fileModifiedAt.getTime() : null });
    }
    return map;
  }

  private async startImport(
    id: string,
    musicPaths: string[],
    audiobookPaths: string[],
    mvPaths: string[],
    cachePath: string,
    mode: 'incremental' | 'full' | 'compact'
  ) {
    const task = this.tasks.get(id);
    if (!task) return;

    console.log('Starting import for task', mode);

    try {
      if (mode === 'compact') {
        task.status = TaskStatus.PREPARING;
        task.message = '正在精简数据库...';
        await this.compactLibrary(task);
        task.status = TaskStatus.SUCCESS;
        task.message = '精简完成';
        return;
      }

      // 1. We no longer clear at the start to keep app data accessible during scan.
      // if (mode === 'full') {
      //   await this.clearLibraryData(task);
      // }
      const processedTrackIds = new Set<number>();

      this.scanner = new LocalMusicScanner(cachePath);

      // 预载本地曲目 mtime 索引：未变化的文件跳过 parseFile/指纹/写库（mtime 短路）。
      // 增量与全量共用；全量模式下「跳过」等同于「已见到该文件」，不影响清理语义。
      this.dirtyAlbumIds.clear();
      const localTrackIndex = await this.buildLocalTrackIndex();
      let skippedCount = 0;
      // 容忍 DB datetime 精度截断（如 MySQL DATETIME 秒级）造成的 mtime 抖动
      const MTIME_TOLERANCE_MS = 2000;
      const makeShouldSkip = (basePath: string, type: TrackType) => (filePath: string, stat: fs.Stats): boolean => {
        // STRM 文件的 track.path 是远端 URL，无法从本地路径推导，始终处理
        if (/\.strm$/i.test(filePath)) return false;
        const urlType = type === TrackType.AUDIOBOOK ? 'audio' : 'music';
        const candidates = [this.convertToHttpUrl(filePath, urlType, basePath)];
        if (this.needsAudioTranscode(filePath)) {
          const transcodedPath = this.getAudioTranscodedFilePath(filePath, cachePath);
          candidates.push(this.getAudioTranscodedPublicUrl(transcodedPath, cachePath));
        }
        for (const key of candidates) {
          const rec = localTrackIndex.get(key);
          if (!rec || rec.mtimeMs == null) continue;
          if (Math.abs(rec.mtimeMs - stat.mtimeMs) <= MTIME_TOLERANCE_MS) {
            processedTrackIds.add(rec.id);
            skippedCount++;
            task.current = (task.current || 0) + 1;
            task.localCurrent = (task.localCurrent || 0) + 1;
            return true;
          }
        }
        return false;
      };

      task.status = TaskStatus.PREPARING;
      task.message = '正在统计本地文件数量...';
      console.log('Counting local paths for music and musicPaths...', musicPaths);
      const musicCount = (await Promise.all(
        musicPaths.map((musicPath) => this.scanner!.countFiles(musicPath, { audioOnly: true }))
      )).reduce((sum, count) => sum + count, 0);
      const audiobookCount = (await Promise.all(
        audiobookPaths.map((audiobookPath) => this.scanner!.countFiles(audiobookPath, { audioOnly: true }))
      )).reduce((sum, count) => sum + count, 0);
      const mvCount = (await Promise.all(
        mvPaths.map((mvPath) => this.scanner!.countFiles(mvPath))
      )).reduce((sum, count) => sum + count, 0);

      let webdavMusicCount = 0;
      let webdavAudiobookCount = 0;
      let webdavMvCount = 0;

      const webdavTargets = await this.webDavConfig.listScanTargets();
      for (const target of webdavTargets) {
        task.message = `正在统计 WebDAV ${target.source.name} [${target.kind}]...`;
        const wdScanner = new WebDAVScanner(
          target.source.url,
          target.source.username,
          target.source.password,
        );
        const count = await wdScanner.count(target.path);
        if (target.kind === 'MUSIC') webdavMusicCount += count;
        else if (target.kind === 'AUDIOBOOK') webdavAudiobookCount += count;
        else if (target.kind === 'MV') webdavMvCount += count;
      }

      task.localTotal = musicCount + audiobookCount;
      task.webdavTotal = webdavMusicCount + webdavAudiobookCount;
      task.mvTotal = mvCount + webdavMvCount;
      task.total = (task.localTotal || 0) + (task.webdavTotal || 0) + (task.mvTotal || 0);

      task.localCurrent = 0;
      task.webdavCurrent = 0;
      task.mvCurrent = 0;
      task.current = 0;
      task.skipped = 0;
      task.status = TaskStatus.PARSING;
      task.message = '正在解析媒体文件...';

      const processItem = async (item: ScanResult, type: TrackType, audioBasePath: string, isWebDAV = false, isMvPath = false) => {
        // Only treat as MV when scanning MV paths, not from music/audiobook folders
        if (isMvPath && this.isMvFile(item.path)) {
          const mvTarget = item.path.startsWith('http')
            ? { sourcePath: item.path, publicUrl: item.path }
            : await this.ensureMvAsMp4(item.originalPath || item.path, cachePath, isWebDAV);
          const audioUrl = mvTarget.publicUrl || this.convertToHttpUrl(item.originalPath || item.path, 'music', audioBasePath);
          const hash = isWebDAV ? '' : await this.calculateFingerprint(item.originalPath || item.path);
          await this.processMvData(item, audioBasePath, cachePath, audioUrl, hash, isWebDAV, mvTarget.sourcePath);
          task.current = (task.current || 0) + 1;
          return null;
        }

        const audioUrl = item.path.startsWith('http') ? item.path : this.convertToHttpUrl(item.originalPath || item.path, type === TrackType.AUDIOBOOK ? 'audio' : 'music', audioBasePath);

        const folderId = isWebDAV ? null : await this.getFolderId(item.originalPath || item.path, audioBasePath, type);
        const hash = isWebDAV ? '' : await this.calculateFingerprint(item.originalPath || item.path);
        const nextScanOrder = (task.current || 0) + 1;
        const sortFields = this.getTrackSortFields(item.originalPath || item.path, audioBasePath, nextScanOrder);

        const trackId = await this.processTrackData(item, type, audioBasePath, cachePath, audioUrl, folderId, hash, sortFields, isWebDAV ? TrackSource.WEBDAV : TrackSource.FILE);
        if (trackId) processedTrackIds.add(trackId);

        if (isWebDAV) {
          task.webdavCurrent = (task.webdavCurrent || 0) + 1;
        } else {
          task.localCurrent = (task.localCurrent || 0) + 1;
        }
        task.current = (task.current || 0) + 1;
      };

      for (const musicPath of musicPaths) {
        await this.scanner.scanMusic(musicPath, async (item) => {
          if (this.isPathInsideAnyBase(item.originalPath || item.path, audiobookPaths)) {
            return;
          }
          task.currentFileName = item.title || path.basename(item.path);
          await processItem(item, TrackType.MUSIC, musicPath);
        }, { shouldSkip: makeShouldSkip(musicPath, TrackType.MUSIC) });
      }

      for (const audiobookPath of audiobookPaths) {
        await this.scanner.scanAudiobook(audiobookPath, async (item) => {
          task.currentFileName = item.title || path.basename(item.path);
          await processItem(item, TrackType.AUDIOBOOK, audiobookPath);
        }, { shouldSkip: makeShouldSkip(audiobookPath, TrackType.AUDIOBOOK) });
      }

      for (const mvPath of mvPaths) {
        await this.scanner.scanMv(mvPath, async (item) => {
          task.currentFileName = item.title || path.basename(item.path);
          // type is MUSIC since it belongs to music mode, isMvPath=true to only treat designated MV folder files as MVs
          await processItem(item, TrackType.MUSIC, mvPath, false, true);
          task.mvCurrent = (task.mvCurrent || 0) + 1;
        });
      }

      // Trigger WebDAV scans as part of the same task flow
      if (process.env.WEBDAV_MUSIC_URL) {
        await this.startWebDAVImport(cachePath, TrackType.MUSIC, id);
      }
      if (process.env.WEBDAV_AUDIOBOOK_URL) {
        await this.startWebDAVImport(cachePath, TrackType.AUDIOBOOK, id);
      }
      if (process.env.WEBDAV_MV_URL) {
        await this.startWebDAVImport(cachePath, TrackType.MUSIC, id, true);
      }

      // 统一刷新本次扫描受影响的专辑/艺人状态（扫描期仅标记，避免每首歌重复刷新）
      await this.flushDirtyAlbums();

      task.skipped = skippedCount;
      if (skippedCount > 0) {
        this.logger.log(`Scan skipped ${skippedCount} unchanged files (mtime match)`);
      }

      // Cleanup orphans if it's a full update
      if (mode === 'full') {
        task.message = '正在清理已失效数据...';
        await this.cleanupOrphans(processedTrackIds);
      }

      task.status = TaskStatus.SUCCESS;
      this.setupWatcher(musicPaths, audiobookPaths, mvPaths, cachePath);

    } catch (error) {
      console.error('Import failed:', error);
      // 失败也尽量把已处理文件的父级状态刷掉，避免状态滞留到下次扫描
      await this.flushDirtyAlbums().catch(() => { });
      task.status = TaskStatus.FAILED;
      task.message = error instanceof Error ? error.message : String(error);
    }
  }

  private async compactLibrary(task: ImportTask) {
    let current = 0;
    const totalSteps = 5;
    task.total = totalSteps;
    task.current = current;

    const tick = (message: string) => {
      current += 1;
      task.current = current;
      task.message = message;
    };

    tick('正在清理已标记为假死的数据...');
    await this.purgeTrashedEntities();

    tick('正在核对单曲文件路径...');
    const missingTrackIds = await this.findMissingLocalTrackIds();

    tick('正在删除失效单曲及其历史/收藏记录...');
    if (missingTrackIds.length > 0) {
      for (const id of missingTrackIds) {
        await this.trackService.deleteTrack(id);
      }
    }

    tick('正在清理空专辑...');
    await this.cleanupOrphanAlbumsHardDelete();

    tick('正在清理空艺术家...');
    await this.cleanupOrphanArtistsHardDelete();
  }

  private async purgeTrashedEntities() {
    const BATCH_SIZE = 300;

    // 1) Purge trashed tracks in chunks to avoid SQLite variable limits.
    while (true) {
      const rows = await this.prisma.track.findMany({
        where: { status: FileStatus.TRASHED },
        select: { id: true },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;
      const ids = rows.map((r) => r.id);

      await this.prisma.userTrackLike.deleteMany({ where: { trackId: { in: ids } } });
      await this.prisma.userTrackHistory.deleteMany({ where: { trackId: { in: ids } } });
      await this.prisma.userAudiobookLike.deleteMany({ where: { trackId: { in: ids } } });
      await this.prisma.userAudiobookHistory.deleteMany({ where: { trackId: { in: ids } } });
      await this.prisma.track.deleteMany({ where: { id: { in: ids } } });
    }

    // 2) Purge trashed albums. Clear track references first to avoid FK blocking.
    while (true) {
      const rows = await this.prisma.album.findMany({
        where: { status: FileStatus.TRASHED },
        select: { id: true },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;
      const ids = rows.map((r) => r.id);

      await this.prisma.track.updateMany({
        where: { albumId: { in: ids } },
        data: { albumId: null },
      });
      await this.prisma.mv.updateMany({
        where: { albumId: { in: ids } },
        data: { albumId: null },
      });
      await this.prisma.audiobookCollectionAlbum.deleteMany({ where: { albumId: { in: ids } } });
      await this.prisma.userAlbumLike.deleteMany({ where: { albumId: { in: ids } } });
      await this.prisma.userAlbumHistory.deleteMany({ where: { albumId: { in: ids } } });
      await this.prisma.album.deleteMany({ where: { id: { in: ids } } });
    }

    // 3) Purge trashed artists. Clear track references first to avoid FK blocking.
    while (true) {
      const rows = await this.prisma.artist.findMany({
        where: { status: FileStatus.TRASHED },
        select: { id: true },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;
      const ids = rows.map((r) => r.id);

      await this.prisma.track.updateMany({
        where: { artistId: { in: ids } },
        data: { artistId: null },
      });
      await this.prisma.artist.deleteMany({ where: { id: { in: ids } } });
    }
  }

  private async findMissingLocalTrackIds(): Promise<number[]> {
    const tracks = await this.prisma.track.findMany({
      where: { status: FileStatus.ACTIVE },
      select: { id: true, path: true }
    });

    const missingIds: number[] = [];
    for (const track of tracks) {
      const absolutePath = await this.trackService.getFilePath(track.path);
      if (!absolutePath) continue;
      if (!fs.existsSync(absolutePath)) {
        missingIds.push(track.id);
      }
    }
    return missingIds;
  }

  private async cleanupOrphanAlbumsHardDelete() {
    const albums = await this.prisma.album.findMany({
      where: { status: FileStatus.ACTIVE },
      select: { id: true }
    });

    for (const album of albums) {
      const activeTrackCount = await this.prisma.track.count({
        where: { albumId: album.id, status: FileStatus.ACTIVE }
      });
      if (activeTrackCount === 0) {
        // 清空所有指向该专辑的外键引用，避免删除时触发外键约束
        await this.prisma.track.updateMany({ where: { albumId: album.id }, data: { albumId: null } });
        await this.prisma.mv.updateMany({ where: { albumId: album.id }, data: { albumId: null } });
        await this.prisma.audiobookCollectionAlbum.deleteMany({ where: { albumId: album.id } });
        await this.prisma.userAlbumLike.deleteMany({ where: { albumId: album.id } });
        await this.prisma.userAlbumHistory.deleteMany({ where: { albumId: album.id } });
        await this.prisma.album.delete({ where: { id: album.id } });
      }
    }
  }

  private async cleanupOrphanArtistsHardDelete() {
    const artists = await this.prisma.artist.findMany({
      where: { status: FileStatus.ACTIVE },
      select: { id: true, name: true, type: true }
    });

    for (const artist of artists) {
      const sameNameArtists = await this.prisma.artist.findMany({
        where: {
          status: FileStatus.ACTIVE,
          name: artist.name,
          type: artist.type
        },
        select: { id: true }
      });

      const [activeLinkedTracks, activeAlbums] = await Promise.all([
        this.prisma.track.count({
          where: {
            status: FileStatus.ACTIVE,
            type: artist.type,
            artistId: artist.id
          }
        }),
        this.prisma.album.count({
          where: {
            status: FileStatus.ACTIVE,
            type: artist.type,
            artist: artist.name
          }
        })
      ]);

      // Legacy fallback: only when this is the only artist row with this name/type.
      const legacyTracksByName =
        sameNameArtists.length === 1
          ? await this.prisma.track.count({
            where: {
              status: FileStatus.ACTIVE,
              type: artist.type,
              artist: artist.name,
              artistId: null,
            },
          })
          : 0;

      const totalTracks = activeLinkedTracks + legacyTracksByName;

      // If duplicated same-name artists exist, keep only one canonical row when works exist.
      if (sameNameArtists.length > 1 && (totalTracks > 0 || activeAlbums > 0)) {
        const canonicalId = sameNameArtists
          .map((a) => a.id)
          .sort((a, b) => a - b)[0];
        if (artist.id !== canonicalId && activeLinkedTracks === 0) {
          await this.prisma.artist.delete({ where: { id: artist.id } });
        }
        continue;
      }

      if (totalTracks === 0 && activeAlbums === 0) {
        await this.prisma.artist.delete({ where: { id: artist.id } });
      }
    }
  }

  private async extractVideoThumbnail(videoPath: string, cachePath: string): Promise<string | null> {
    return new Promise((resolve) => {
      const fileName = `${randomUUID()}.jpg`;
      const outputPath = path.join(cachePath, fileName);

      const ffmpeg = spawn('ffmpeg', [
        '-i', videoPath,
        '-ss', '00:00:10.000', // Take frame at 10 seconds to avoid black frames and intros
        '-vframes', '1',
        '-q:v', '2', // High quality
        '-y', // Overwrite
        outputPath
      ]);

      ffmpeg.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          resolve(outputPath);
        } else {
          resolve(null);
        }
      });

      ffmpeg.on('error', () => {
        resolve(null);
      });
    });
  }

  private isUnknownMetadata(value?: string | null): boolean {
    if (!value) return true;
    const normalized = value.trim().toLowerCase();
    return !normalized || normalized === '未知' || normalized === 'unknown';
  }

  private parseMvFileName(filePath: string): ParsedMvFileName {
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext).replace(/\s+/g, ' ').trim();
    const parsed: ParsedMvFileName = {};
    const normalizeTitle = (value?: string) => value?.replace(/^\d+\s*[._\-、]\s*/, '').trim();

    const bracketMatch = baseName.match(/\[(.+?)\]/);
    if (bracketMatch) {
      const bracketContent = bracketMatch[1].trim();
      const parts = bracketContent.split('.-.').map(part => part.trim()).filter(Boolean);
      if (parts.length >= 3) {
        parsed.album = parts[0];
        parsed.title = normalizeTitle(parts.slice(2).join(' - '));
      } else if (parts.length === 2) {
        parsed.album = parts[0];
        parsed.title = normalizeTitle(parts[1]);
      } else if (parts.length === 1) {
        parsed.title = normalizeTitle(parts[0]);
      }
      const artistCandidate = baseName.split('.-.[')[0]?.trim();
      if (artistCandidate) {
        parsed.artist = artistCandidate;
      }
    }

    if (!parsed.title) {
      const compactMatch = baseName.match(/^\s*(.+?)\s*-\s*(.+?)\s*-\s*(.+?)\s*$/);
      if (compactMatch) {
        parsed.artist = compactMatch[1].trim();
        parsed.album = compactMatch[2].trim();
        parsed.title = normalizeTitle(compactMatch[3]);
      }
    }

    if (!parsed.title) {
      const simpleMatch = baseName.match(/^\s*(.+?)\s*-\s*(.+?)\s*$/);
      if (simpleMatch) {
        parsed.artist = simpleMatch[1].trim();
        parsed.title = normalizeTitle(simpleMatch[2]);
      }
    }

    return parsed;
  }

  private async processMvData(
    item: ScanResult,
    audioBasePath: string,
    cachePath: string,
    audioUrl: string,
    hash: string,
    isWebDAV: boolean = false,
    videoSourcePath?: string,
  ): Promise<number | null> {
    const parsedMv = this.parseMvFileName(item.originalPath || item.path);
    const parsedTitle = parsedMv.title?.trim();
    const parsedArtist = parsedMv.artist?.trim();
    const parsedAlbum = parsedMv.album?.trim();

    let resolvedTitle = item.title || path.basename(item.path);
    if (!resolvedTitle || resolvedTitle === path.basename(item.path, path.extname(item.path))) {
      resolvedTitle = parsedTitle || resolvedTitle;
    }

    let resolvedArtistName = this.isUnknownMetadata(item.artist) ? (parsedArtist || '未知') : (item.artist || '未知');
    let resolvedAlbumName = this.isUnknownMetadata(item.album) ? (parsedAlbum || '未知') : (item.album || '未知');
    let resolvedAlbumArtist = this.isUnknownMetadata(item.albumArtist) ? resolvedArtistName : item.albumArtist!;

    // 1. Meta data cover
    let finalCoverUrl = item.coverPath ? this.convertToHttpUrl(item.coverPath, 'cover', cachePath) : null;
    this.preGenerateCover(finalCoverUrl);

    // 2. Track cover / metadata (prefer matching by parsed MV title, then fallback to current metadata)
    let trackId: number | null = null;
    let matchedTrack = null as Awaited<ReturnType<typeof this.prisma.track.findFirst>>;

    if (parsedTitle) {
      matchedTrack = await this.prisma.track.findFirst({
        where: {
          name: parsedTitle,
          status: FileStatus.ACTIVE
        }
      });
    }

    if (!matchedTrack) {
      matchedTrack = await this.prisma.track.findFirst({
        where: {
          name: resolvedTitle,
          artist: resolvedArtistName,
          status: FileStatus.ACTIVE
        }
      });
    }

    if (matchedTrack) {
      trackId = matchedTrack.id;
      resolvedTitle = matchedTrack.name || resolvedTitle;
      resolvedArtistName = matchedTrack.artist || resolvedArtistName;
      resolvedAlbumName = matchedTrack.album || resolvedAlbumName;
      resolvedAlbumArtist = matchedTrack.artist || resolvedAlbumArtist;
      if (!finalCoverUrl && matchedTrack.cover) {
        finalCoverUrl = matchedTrack.cover;
      }
    }

    // 3. Ffmpeg Video Thumbnail
    if (!finalCoverUrl && !isWebDAV) {
      const thumbnailPath = await this.extractVideoThumbnail(videoSourcePath || item.originalPath || item.path, cachePath);
      if (thumbnailPath) {
        finalCoverUrl = this.convertToHttpUrl(thumbnailPath, 'cover', cachePath);
        this.preGenerateCover(finalCoverUrl);
      }
    }

    const artistDelimiters = /[&,、]|\s+and\s+/i;
    const individualArtists = resolvedArtistName.split(artistDelimiters).map(s => s.trim()).filter(s => s);
    let mvPrimaryArtist: any = null;

    if (individualArtists.length === 0) individualArtists.push(resolvedArtistName);

    for (const name of individualArtists) {
      let art = await this.artistService.findByName(name, TrackType.MUSIC, true);
      if (!art) {
        art = await this.artistService.createArtist({
          name: name,
          avatar: finalCoverUrl,
          type: TrackType.MUSIC,
          status: FileStatus.ACTIVE,
          trashedAt: null,
          metadataSource: MetadataSource.EMBEDDED,
          metadataProvider: null,
        } as any);
      } else if (art.status === FileStatus.TRASHED) {
        await this.artistService.updateArtist(art.id, { status: FileStatus.ACTIVE, trashedAt: null });
      }
      if (!mvPrimaryArtist) mvPrimaryArtist = art;
    }

    const artist = mvPrimaryArtist;

    // Resolve Album
    const albumGroupArtist = resolvedAlbumArtist || resolvedArtistName;
    let album = await this.albumService.findByName(resolvedAlbumName, albumGroupArtist, TrackType.MUSIC, true);
    if (!album) {
      album = await this.albumService.createAlbum({
        name: resolvedAlbumName,
        artist: albumGroupArtist,
        cover: finalCoverUrl,
        year: item.year ? String(item.year) : null,
        type: TrackType.MUSIC,
        status: FileStatus.ACTIVE,
        trashedAt: null,
        metadataSource: MetadataSource.EMBEDDED,
        metadataProvider: null,
      } as any);
    } else if (album.status === FileStatus.TRASHED) {
      await this.albumService.updateAlbum(album.id, { status: FileStatus.ACTIVE, trashedAt: null });
    }

    let existingMv = hash ? await this.prisma.mv.findFirst({ where: { fileHash: hash } }) : null;
    if (!existingMv) {
      existingMv = await this.prisma.mv.findFirst({ where: { path: audioUrl } });
    }

    if (existingMv) {
      await this.prisma.mv.update({
        where: { id: existingMv.id },
        data: {
          path: audioUrl,
          status: FileStatus.ACTIVE,
          trashedAt: null,
          fileHash: hash || existingMv.fileHash,
          fileModifiedAt: item?.mtime ? new Date(item.mtime) : new Date(),
          name: resolvedTitle,
          duration: Math.round(item.duration || 0),
          artistId: artist.id,
          artist: artist.name,
          albumId: album.id,
          album: album.name,
          cover: finalCoverUrl || existingMv.cover,
          trackId: trackId
        }
      });
      return existingMv.id;
    } else {
      const createdMv = await this.prisma.mv.create({
        data: {
          name: resolvedTitle,
          path: audioUrl,
          artist: artist.name,
          album: album.name,
          cover: finalCoverUrl,
          duration: Math.round(item.duration || 0),
          createdAt: new Date(),
          fileModifiedAt: item?.mtime ? new Date(item.mtime) : null,
          artistId: artist.id,
          albumId: album.id,
          fileHash: hash,
          status: FileStatus.ACTIVE,
          trashedAt: null,
          trackId: trackId
        }
      });
      return createdMv.id;
    }
  }

  private async processTrackData(item: ScanResult, type: TrackType, audioBasePath: string, cachePath: string, audioUrl: string, folderId: number | null, hash: string, sortFields: TrackSortFields = {}, source: TrackSource = TrackSource.FILE): Promise<number | null> {
    // If it's an MV, handle it differently and return early
    if (this.isMvFile(item.path)) {
      const isWebDAV = !hash && audioUrl.startsWith('http'); // Basic heuristic, or we can just pass it
      await this.processMvData(item, audioBasePath, cachePath, audioUrl, hash, isWebDAV, item.originalPath || item.path);
      return null;
    }

    // Enrich metadata via user-configured plugins
    item = await this.metadataPluginService.enrich(item, type, {
      cachePath,
      audioBasePath,
      audioUrl,
      folderId,
      hash,
    });

    // Determine metadata source for database records
    const metadataSource = (item as any).__metadataSource || MetadataSource.EMBEDDED;
    const metadataProvider = (item as any).__metadataProvider || null;

    // Audio transcode for incompatible formats
    let finalAudioUrl = audioUrl;
    let transcodedPath: string | null = null;
    const originalPath = item.originalPath || item.path;
    if (!audioUrl.startsWith('http') && originalPath && this.needsAudioTranscode(originalPath)) {
      const transcodeResult = await this.ensureAudioAsMp3(originalPath, cachePath);
      if (transcodeResult.publicUrl) {
        finalAudioUrl = transcodeResult.publicUrl;
        transcodedPath = transcodeResult.sourcePath;
      }
    }

    const artistName = item.artist || '未知';
    const albumName = item.album || '未知';
    const coverUrl = item.coverPath ? this.convertToHttpUrl(item.coverPath, 'cover', cachePath) : null;
    this.preGenerateCover(coverUrl);
    const albumGroupArtist = this.isUnknownMetadata(item.albumArtist) ? artistName : item.albumArtist!;

    // 1. Resolve Track Artist (Required for Track.artistId)
    // Support multi-artist parsing: "A & B", "A and B", "A、B"
    const artistDelimiters = /[&,、]|\s+and\s+/i;
    // Split and filter empty strings
    const individualArtists = artistName.split(artistDelimiters).map(s => s.trim()).filter(s => s);

    let trackPrimaryArtist: any = null;

    // Fallback if split results in empty (should not happen if artistName is valid)
    if (individualArtists.length === 0) individualArtists.push(artistName);

    // Pull plugin-driven artist meta once (applied to every artist in the split list)
    const pluginArtistDescription = (item as any).__artistDescription as string | undefined;
    const pluginArtistTags = (item as any).__artistTags as string[] | undefined;
    const pluginArtistTagsJson = pluginArtistTags && pluginArtistTags.length > 0
      ? JSON.stringify(pluginArtistTags)
      : undefined;

    for (const name of individualArtists) {
      let art = await this.artistService.findByName(name, type, true);
      if (!art) {
        art = await this.artistService.createArtist({
          name: name,
          avatar: coverUrl,
          type: type,
          status: FileStatus.ACTIVE,
          trashedAt: null,
          metadataSource,
          metadataProvider,
          ...(metadataSource === MetadataSource.PLUGIN
            ? { description: pluginArtistDescription, tags: pluginArtistTagsJson }
            : {}),
        } as any);
      } else if (art.status === FileStatus.TRASHED) {
        await this.artistService.updateArtist(art.id, { status: FileStatus.ACTIVE, trashedAt: null });
      }

      // For existing artists, only enrich from plugin and never overwrite existing fields
      if (art && metadataSource === MetadataSource.PLUGIN) {
        const artistUpdate: Record<string, any> = {};
        if (pluginArtistDescription && !art.description) {
          artistUpdate.description = pluginArtistDescription;
        }
        if (pluginArtistTagsJson) {
          const merged = mergeTagJson(art.tags, pluginArtistTags);
          if (merged) artistUpdate.tags = merged;
        }
        if (Object.keys(artistUpdate).length > 0) {
          art = await this.artistService.updateArtist(art.id, artistUpdate as any);
        }
      }

      if (!trackPrimaryArtist) trackPrimaryArtist = art;
    }

    const artist = trackPrimaryArtist; // Use the first artist for the relation

    // 2. Resolve Album Artist (for Album grouping AND Album Artist entity)
    // Also split album artist if it's a combination (e.g. "A & B" album)
    const individualAlbumArtists = albumGroupArtist.split(artistDelimiters).map(s => s.trim()).filter(s => s);
    if (individualAlbumArtists.length === 0) individualAlbumArtists.push(albumGroupArtist);

    if (albumGroupArtist !== artistName) {
      for (const name of individualAlbumArtists) {
        let albumArtistEntity = await this.artistService.findByName(name, type, true);
        if (!albumArtistEntity) {
          await this.artistService.createArtist({
            name: name,
            avatar: coverUrl,
            type: type,
            status: FileStatus.ACTIVE,
            trashedAt: null,
            metadataSource,
            metadataProvider,
          } as any);
        } else if (albumArtistEntity.status === FileStatus.TRASHED) {
          await this.artistService.updateArtist(albumArtistEntity.id, { status: FileStatus.ACTIVE, trashedAt: null });
        }
      }
    }

    // 3. Resolve Album
    let album: Album | null = null;
    let albumWasCreated = false;

    // Plugin-driven album enrichment values (used for both create and existing-album update)
    const pluginAlbumDescription = (item as any).__albumDescription as string | undefined;
    const pluginAlbumTags = (item as any).__albumTags as string[] | undefined;
    const pluginAlbumTagsJson = pluginAlbumTags && pluginAlbumTags.length > 0
      ? JSON.stringify(pluginAlbumTags)
      : undefined;

    // Heuristic: If no explicit Album Artist, try to merge with existing album in the same folder
    if (!item.albumArtist && folderId && albumName !== '未知') {
      const siblingTrack = await this.prisma.track.findFirst({
        where: {
          folderId: folderId,
          album: albumName,
          status: FileStatus.ACTIVE,
          albumId: { not: null }
        },
        select: { albumId: true }
      });

      if (siblingTrack && siblingTrack.albumId) {
        album = await this.prisma.album.findUnique({ where: { id: siblingTrack.albumId } });
      }
    }

    if (!album) {
      // Fallback: Resolve Album using Album Artist (or Track Artist if Album Artist is missing)
      album = await this.albumService.findByName(albumName, albumGroupArtist, type, true);
      if (!album) {
        album = await this.albumService.createAlbum({
          name: albumName,
          artist: albumGroupArtist,
          cover: coverUrl,
          year: item.year ? String(item.year) : null,
          type: type,
          status: FileStatus.ACTIVE,
          trashedAt: null,
          metadataSource,
          metadataProvider,
          ...(metadataSource === MetadataSource.PLUGIN
            ? { description: pluginAlbumDescription, tags: pluginAlbumTagsJson }
            : {}),
        } as any);
        albumWasCreated = true;
      }
    }

    // Enrich an already-existing album (found via the sibling heuristic or by name). Cover is
    // overwritten when the plugin supplied one so full re-scans actually refresh stale covers,
    // but the write is skipped when the URL is unchanged to avoid redundant updates on every
    // full scan. Description stays first-wins and tags are union-merged, matching Track behavior.
    if (album && !albumWasCreated) {
      const albumUpdate: Record<string, any> = {};
      if (album.status === FileStatus.TRASHED) {
        albumUpdate.status = FileStatus.ACTIVE;
        albumUpdate.trashedAt = null;
      }
      if (metadataSource === MetadataSource.PLUGIN) {
        if (coverUrl && album.cover !== coverUrl) {
          albumUpdate.cover = coverUrl;
          this.preGenerateCover(coverUrl);
        }
        if (pluginAlbumDescription && !album.description) {
          albumUpdate.description = pluginAlbumDescription;
        }
        if (pluginAlbumTagsJson) {
          const merged = mergeTagJson(album.tags, pluginAlbumTags);
          if (merged) albumUpdate.tags = merged;
        }
      }
      if (Object.keys(albumUpdate).length > 0) {
        album = await this.albumService.updateAlbum(album.id, albumUpdate as any);
      }
    }

    // 4. Find Existing Track
    let existingTrack = hash ? await this.prisma.track.findFirst({ where: { fileHash: hash } }) : null;
    if (!existingTrack) {
      existingTrack = await this.trackService.findByPath(audioUrl);
    }

    if (existingTrack) {
      // Resurrection / Update Logic
      this.logger.verbose(`Updating existing track ${existingTrack.id}: ${existingTrack.name}`);

      await this.prisma.track.update({
        where: { id: existingTrack.id },
        data: {
          path: finalAudioUrl,
          folderId: folderId,
          status: FileStatus.ACTIVE,
          trashedAt: null,
          fileHash: hash || existingTrack.fileHash,
          fileModifiedAt: item?.mtime ? new Date(item.mtime) : new Date(),
          // Sync metadata
          name: item.title || path.basename(item.path),
          duration: Math.round(item.duration || 0),
          index: item.track?.no || 0,
          type: type,
          artist: artistName,
          album: albumName,
          episodeNumber: extractEpisodeNumber(item.title || ""),
          lyrics: item.lyrics || null, // Ensure lyrics update too
          fileName: sortFields.fileName,
          relativePath: sortFields.relativePath,
          fileCreatedAt: sortFields.fileCreatedAt,
          scanOrder: sortFields.scanOrder,
          // Update relations
          artistId: artist.id,
          // artist: artistName, // Optional: Update denormalized artist name if needed, but schema says it's string
          albumId: album.id,
          // album: albumName,   // Optional: Update denormalized album name
          cover: this.resolveCoverForUpdate(metadataSource, coverUrl, existingTrack.cover),
          // 缩略图已在前面 coverUrl 计算时 preGenerate；这里无需再触发
          transcodedPath: transcodedPath || existingTrack.transcodedPath,
          metadataSource,
          metadataProvider,
          source,
          tags: metadataSource === MetadataSource.PLUGIN
            ? mergeTagJson(existingTrack.tags, (item as any).__trackTags) ?? existingTrack.tags
            : existingTrack.tags,
        }
      });

      if (existingTrack.albumId && existingTrack.albumId !== album.id) {
        this.markAlbumDirty(existingTrack.albumId);
      }
      this.markAlbumDirty(album.id);
      return existingTrack.id;
    } else {
      // Create new record
      const createdTrack = await this.trackService.createTrack({
        name: item.title || path.basename(item.path),
        artist: artistName,
        album: albumName,
        cover: coverUrl,
        path: finalAudioUrl,
        duration: Math.round(item.duration || 0),
        lyrics: item.lyrics || null,
        index: item.track?.no || 0,
        type: type,
        createdAt: new Date(),
        fileName: sortFields.fileName,
        relativePath: sortFields.relativePath,
        fileCreatedAt: sortFields.fileCreatedAt,
        fileModifiedAt: item?.mtime ? new Date(item.mtime) : null,
        scanOrder: sortFields.scanOrder,
        episodeNumber: extractEpisodeNumber(item.title || ""),
        artistId: artist.id,
        albumId: album.id,
        folderId: folderId,
        fileHash: hash,
        status: FileStatus.ACTIVE,
        trashedAt: null,
        transcodedPath: transcodedPath,
        metadataSource,
        metadataProvider,
        source,
        tags: metadataSource === MetadataSource.PLUGIN
          ? ((item as any).__trackTags && (item as any).__trackTags.length > 0
              ? JSON.stringify((item as any).__trackTags)
              : null)
          : null,
      } as any);
      return createdTrack.id;
    }
  }

  private async cleanupOrphans(processedTrackIds: Set<number>) {
    const allActiveTracks = await this.prisma.track.findMany({
      where: { status: FileStatus.ACTIVE },
      select: { id: true, albumId: true }
    });

    const orphanTrackIds = allActiveTracks
      .filter(t => !processedTrackIds.has(t.id))
      .map(t => t.id);

    if (orphanTrackIds.length > 0) {
      this.logger.log(`Cleaning up ${orphanTrackIds.length} orphan tracks...`);
      // Batch update to TRASHED
      const chunkSize = 500;
      for (let i = 0; i < orphanTrackIds.length; i += chunkSize) {
        const chunk = orphanTrackIds.slice(i, i + chunkSize);
        await this.prisma.track.updateMany({
          where: { id: { in: chunk } },
          data: { status: FileStatus.TRASHED, trashedAt: new Date() }
        });
      }
    }

    // Sync Album & Artist statuses
    const affectedAlbumIds = new Set(allActiveTracks.map(t => t.albumId).filter(id => id !== null));
    for (const albumId of affectedAlbumIds) {
      await this.updateParentStatus(albumId!, 'album');
    }
  }

  private async getFolderId(localPath: string, basePath: string, type: TrackType): Promise<number | null> {
    const dirPath = path.dirname(localPath);
    const cacheKey = `${dirPath}`;

    if (this.folderCache.has(cacheKey)) {
      return this.folderCache.get(cacheKey)!;
    }

    const folderId = await this.getOrCreateFolderHierarchically(dirPath, basePath, type);
    if (folderId) {
      this.folderCache.set(cacheKey, folderId);
    }
    return folderId;
  }

  private async getOrCreateFolderHierarchically(localPath: string, basePath: string, type: TrackType): Promise<number | null> {
    const relativePath = path.relative(basePath, localPath);
    if (relativePath === '' || relativePath === '.') return null;

    const parts = relativePath.split(path.sep);
    let parentId: number | null = null;
    let currentPath = basePath;

    for (const part of parts) {
      currentPath = path.join(currentPath, part);
      const folderRecord = await this.prisma.folder.upsert({
        where: { path: currentPath },
        update: {},
        create: {
          path: currentPath,
          name: part,
          parentId: parentId,
          type: type,
        },
      });
      parentId = folderRecord.id;
    }

    return parentId;
  }
}

function romanToNumber(roman: string): number {
  if (!roman) return 0;
  const upper = roman.toUpperCase();
  const map: Record<string, number> = {
    'Ⅰ': 1, 'Ⅱ': 2, 'Ⅲ': 3, 'Ⅳ': 4, 'Ⅴ': 5,
    'Ⅵ': 6, 'Ⅶ': 7, 'Ⅷ': 8, 'Ⅸ': 9, 'Ⅹ': 10,
    'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5,
    'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10
  };
  return map[upper] || 0;
}

function chineseToNumber(chinese: string): number {
  const map: Record<string, number> = {
    "零": 0, "〇": 0,
    "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
    "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
    "十": 10, "百": 100, "千": 1000, "万": 10000,
  };
  let num = 0;
  let unit = 1;
  let lastUnit = 1;
  for (let i = chinese.length - 1; i >= 0; i--) {
    const char = chinese[i];
    const value = map[char];
    if (value === undefined) continue;
    if (value >= 10) {
      if (value > lastUnit) {
        lastUnit = value;
        unit = value;
      } else {
        unit = unit * value;
      }
    } else {
      num += value * unit;
    }
  }
  return num || 0;
}

export function extractEpisodeNumber(title: string): number {
  let part = 0;
  let episode = 0;

  const romanPattern = /([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ])|[\s\b](I{1,3}|IV|V|VI{0,3}|IX|X)[\s\b]/i;
  const romanMatch = title.match(romanPattern);
  if (romanMatch) {
    part = romanToNumber(romanMatch[1] || romanMatch[2]);
  }

  const partPattern = /第\s*([0-9一二三四五六七八九十百]+)\s*(部|季|卷|册)/;
  const partMatch = title.match(partPattern);
  if (partMatch) {
    const p = partMatch[1];
    part = /^\d+$/.test(p) ? parseInt(p) : chineseToNumber(p);
  }

  let searchTitle = title;
  if (partMatch && /^\d+$/.test(partMatch[1])) {
    searchTitle = title.replace(partMatch[0], '');
  }

  const episodePattern = /第\s*([0-9一二三四五六七八九十百千万两]+)\s*(集|章|节|话|回)/;
  const epMatch = searchTitle.match(episodePattern);
  if (epMatch) {
    const val = epMatch[1];
    episode = /^\d+$/.test(val) ? parseInt(val) : chineseToNumber(val);
  } else {
    const arabMatch = searchTitle.match(/(\d{1,4})/);
    if (arabMatch) {
      episode = Number(arabMatch[1]);
    } else {
      const simpleChinMatch = searchTitle.match(/([一二三四五六七八九十百千万]+)/);
      if (simpleChinMatch) episode = chineseToNumber(simpleChinMatch[1]);
    }
  }

  return (part * 10000) + episode;
}
