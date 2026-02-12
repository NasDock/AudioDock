import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FileStatus, PrismaClient, TrackType } from '@soundx/db';
import { LocalMusicScanner, ScanResult, WebDAVScanner } from '@soundx/utils';
import * as chokidar from 'chokidar';
import * as crypto from 'crypto';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { LogMethod } from '../common/log-method.decorator';
import { AlbumService } from './album';
import { ArtistService } from './artist';
import { TrackService } from './track';

export enum TaskStatus {
  INITIALIZING = 'INITIALIZING',
  PREPARING = 'PREPARING',
  PARSING = 'PARSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

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
  currentFileName?: string;
  mode?: 'incremental' | 'full';
}

@Injectable()
export class ImportService implements OnModuleInit {
  private readonly logger = new Logger(ImportService.name);
  private tasks: Map<string, ImportTask> = new Map();
  private prisma: PrismaClient;
  private folderCache = new Map<string, number>();
  private watcher: chokidar.FSWatcher | null = null;
  private scanner: LocalMusicScanner | null = null;

  constructor(
    private readonly trackService: TrackService,
    private readonly albumService: AlbumService,
    private readonly artistService: ArtistService,
  ) {
    this.prisma = new PrismaClient();
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
    }, 5000);
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
      if (process.env.WEBDAV_MUSIC_URL) {
        this.logger.log('Library is empty. Triggering initial WebDAV Music scan...');
        this.startWebDAVImport(cachePath, TrackType.MUSIC).catch(e => this.logger.error('WebDAV Music initial scan failed', e));
      }
      if (process.env.WEBDAV_AUDIOBOOK_URL) {
        this.logger.log('Library is empty. Triggering initial WebDAV Audiobook scan...');
        this.startWebDAVImport(cachePath, TrackType.AUDIOBOOK).catch(e => this.logger.error('WebDAV Audiobook initial scan failed', e));
      }
    }
  }

  private async startWebDAVImport(cachePath: string, type: TrackType, taskId?: string) {
    const webdavUrl = type === TrackType.AUDIOBOOK ? process.env.WEBDAV_AUDIOBOOK_URL : process.env.WEBDAV_MUSIC_URL;
    if (!webdavUrl) return;

    const task = taskId ? this.tasks.get(taskId) : null;

    const scanner = new WebDAVScanner(
      webdavUrl,
      process.env.WEBDAV_USER,
      process.env.WEBDAV_PASSWORD,
      cachePath
    );

    this.logger.log(`Starting WebDAV ${type} scan: ${webdavUrl}`);
    await scanner.scan('/', async (item) => {
      if (task) {
        task.currentFileName = item.title || path.basename(item.path);
      }
      // Folder ID is null for WebDAV for now as it doesn't map to local folder tree easily
      await this.processTrackData(item, type, '', cachePath, item.path, null, '');

      if (task) {
        task.webdavCurrent = (task.webdavCurrent || 0) + 1;
        task.current = (task.current || 0) + 1;
      }
    });
    this.logger.log(`WebDAV ${type} scan completed.`);
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
        const absolutePath = this.trackService.getFilePath(track.path);

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
  createTask(musicPath: string, audiobookPath: string, cachePath: string, mode: 'incremental' | 'full' = 'incremental'): string {
    const id = randomUUID();
    this.tasks.set(id, { id, status: TaskStatus.INITIALIZING, mode });

    this.startImport(id, musicPath, audiobookPath, cachePath, mode).catch(err => {
      console.error("Unhandled import error", err);
    });

    return id;
  }

  @LogMethod()
  getTask(id: string): ImportTask | undefined {
    return this.tasks.get(id);
  }

  @LogMethod()
  getRunningTask(): ImportTask | undefined {
    return Array.from(this.tasks.values()).find(
      task => task.status === TaskStatus.INITIALIZING || task.status === TaskStatus.PARSING
    );
  }

  private convertToHttpUrl(localPath: string, type: 'cover' | 'audio' | 'music', basePath: string): string {
    const relativePath = path.relative(basePath, localPath);
    if (type === 'cover') {
      const filename = path.basename(localPath);
      return `/covers/${filename}`;
    } else {
      return `/${type}/${relativePath}`;
    }
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
  setupWatcher(musicPath: string, audiobookPath: string, cachePath: string) {
    if (this.watcher) {
      this.watcher.close();
    }

    const paths = [musicPath, audiobookPath].filter(p => fs.existsSync(p));
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

    const getBasePathAndType = (filePath: string): { basePath: string, type: TrackType } | null => {
      if (filePath.startsWith(musicPath)) return { basePath: musicPath, type: TrackType.MUSIC };
      if (filePath.startsWith(audiobookPath)) return { basePath: audiobookPath, type: TrackType.AUDIOBOOK };
      return null;
    };

    this.watcher
      .on('add', async (filePath) => {
        const info = getBasePathAndType(filePath);
        if (info) {
          if (/\.(mp3|flac|ogg|wav|m4a|mp4|strm)$/i.test(filePath)) {
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
        const info = getBasePathAndType(filePath);

        if (info) {
          if (/\.(mp3|flac|ogg|wav|m4a|mp4|strm)$/i.test(filePath)) {
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
        this.logger.log(`[Watcher] File unlinked: ${filePath}`);
        if (/\.(mp3|flac|ogg|wav|m4a|mp4|strm)$/i.test(filePath)) {
          await this.handleFileUnlink(filePath, musicPath, audiobookPath);
        } else if (/\.(jpg|jpeg|png|webp)$/i.test(filePath)) {
          await this.handleImageUnlink(filePath, cachePath);
        } else if (/\.(lrc|txt)$/i.test(filePath)) {
          await this.handleLyricUnlink(filePath);
        }
      });
  }

  private async handleFileAdd(filePath: string, basePath: string, type: TrackType, cachePath: string) {
    const hash = await this.calculateFingerprint(filePath);
    if (!hash) return;

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

      const folderId = await this.getFolderId(filePath, basePath, type);

      await this.prisma.track.update({
        where: { id: trashedTrack.id },
        data: {
          path: audioUrl,
          folderId: folderId,
          status: FileStatus.ACTIVE,
          trashedAt: null,
          fileModifiedAt: new Date()
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
        await this.processTrackData(metadata, type, basePath, cachePath, audioUrl, folderId, hash);
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

        const audioUrl = metadata.path.startsWith('http') ? metadata.path : this.convertToHttpUrl(filePath, type === TrackType.AUDIOBOOK ? 'audio' : 'music', basePath);
        this.logger.log(`[Watcher] Audio URL: ${audioUrl}`);

        const track = await this.trackService.findByPath(audioUrl);
        this.logger.log(`[Watcher] Track found in DB: ${!!track} (id: ${track?.id})`);

        const hash = await this.calculateFingerprint(filePath);

        if (track) {
          const coverUrl = metadata.coverPath ? this.convertToHttpUrl(metadata.coverPath, 'cover', cachePath) : null;

          this.logger.log(`[Watcher] Updating track ${track.id} - cover: ${coverUrl}, lyrics: ${!!metadata.lyrics}`);

          await this.prisma.track.update({
            where: { id: track.id },
            data: {
              name: metadata.title || path.basename(filePath),
              duration: Math.round(metadata.duration || 0),
              fileHash: hash,
              fileModifiedAt: new Date(),
              cover: coverUrl,
              lyrics: metadata.lyrics || null,
              artist: metadata.artist || track.artist,
              album: metadata.album || track.album,
            }
          });

          this.logger.log(`[Watcher] Successfully updated track metadata: ${track.name}`);
        } else {
          this.logger.warn(`[Watcher] Track not found in database for path: ${audioUrl}`);
        }
      } else {
        this.logger.error(`[Watcher] Failed to extract metadata from: ${filePath}`);
      }
    } catch (error) {
      this.logger.error(`[Watcher] Error in handleFileChange for ${filePath}:`, error);
    }
  }

  private async handleFileUnlink(filePath: string, musicPath: string, audiobookPath: string) {
    let url = '';
    if (filePath.startsWith(musicPath)) {
      url = this.convertToHttpUrl(filePath, 'music', musicPath);
    } else if (filePath.startsWith(audiobookPath)) {
      url = this.convertToHttpUrl(filePath, 'audio', audiobookPath);
    }

    if (!url) return;

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
      const absolutePath = this.trackService.getFilePath(track.path);
      if (!absolutePath) continue;

      const trackBaseName = path.basename(absolutePath, path.extname(absolutePath));
      if (trackBaseName === baseName) {
        const lyrics = fs.readFileSync(filePath, 'utf-8');
        await this.prisma.track.update({
          where: { id: track.id },
          data: { lyrics }
        });
        this.logger.log(`[Watcher] Updated lyrics for track ${track.id} (${track.name})`);
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
      const absolutePath = this.trackService.getFilePath(track.path);
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

  private async startImport(id: string, musicPath: string, audiobookPath: string, cachePath: string, mode: 'incremental' | 'full') {
    const task = this.tasks.get(id);
    if (!task) return;

    try {
      // 1. We no longer clear at the start to keep app data accessible during scan.
      // if (mode === 'full') {
      //   await this.clearLibraryData(task);
      // }
      const processedTrackIds = new Set<number>();

      this.scanner = new LocalMusicScanner(cachePath);

      task.status = TaskStatus.PREPARING;
      task.message = '正在统计本地文件数量...';
      const musicCount = await this.scanner.countFiles(musicPath);
      const audiobookCount = await this.scanner.countFiles(audiobookPath);

      let webdavMusicCount = 0;
      let webdavAudiobookCount = 0;

      if (process.env.WEBDAV_MUSIC_URL) {
        task.message = '正在统计 WebDAV 音乐文件...';
        const wdScanner = new WebDAVScanner(process.env.WEBDAV_MUSIC_URL, process.env.WEBDAV_USER, process.env.WEBDAV_PASSWORD);
        webdavMusicCount = await wdScanner.count('/');
      }
      if (process.env.WEBDAV_AUDIOBOOK_URL) {
        task.message = '正在统计 WebDAV 有声书文件...';
        const wdScanner = new WebDAVScanner(process.env.WEBDAV_AUDIOBOOK_URL, process.env.WEBDAV_USER, process.env.WEBDAV_PASSWORD);
        webdavAudiobookCount = await wdScanner.count('/');
      }

      task.localTotal = musicCount + audiobookCount;
      task.webdavTotal = webdavMusicCount + webdavAudiobookCount;
      task.total = task.localTotal + task.webdavTotal;

      task.localCurrent = 0;
      task.webdavCurrent = 0;
      task.current = 0;
      task.status = TaskStatus.PARSING;
      task.message = '正在解析媒体文件...';

      const processItem = async (item: ScanResult, type: TrackType, audioBasePath: string, isWebDAV = false) => {
        const audioUrl = item.path.startsWith('http') ? item.path : this.convertToHttpUrl(item.originalPath || item.path, type === TrackType.AUDIOBOOK ? 'audio' : 'music', audioBasePath);
        const folderId = isWebDAV ? null : await this.getFolderId(item.originalPath || item.path, audioBasePath, type);
        const hash = isWebDAV ? '' : await this.calculateFingerprint(item.originalPath || item.path);

        const trackId = await this.processTrackData(item, type, audioBasePath, cachePath, audioUrl, folderId, hash);
        if (trackId) processedTrackIds.add(trackId);

        if (isWebDAV) {
          task.webdavCurrent = (task.webdavCurrent || 0) + 1;
        } else {
          task.localCurrent = (task.localCurrent || 0) + 1;
        }
        task.current = (task.current || 0) + 1;
      };

      await this.scanner.scanMusic(musicPath, async (item) => {
        task.currentFileName = item.title || path.basename(item.path);
        await processItem(item, TrackType.MUSIC, musicPath);
      });

      await this.scanner.scanAudiobook(audiobookPath, async (item) => {
        task.currentFileName = item.title || path.basename(item.path);
        await processItem(item, TrackType.AUDIOBOOK, audiobookPath);
      });

      // Trigger WebDAV scans as part of the same task flow
      if (process.env.WEBDAV_MUSIC_URL) {
        await this.startWebDAVImport(cachePath, TrackType.MUSIC, id);
      }
      if (process.env.WEBDAV_AUDIOBOOK_URL) {
        await this.startWebDAVImport(cachePath, TrackType.AUDIOBOOK, id);
      }

      // Cleanup orphans if it's a full update
      if (mode === 'full') {
        task.message = '正在清理已失效数据...';
        await this.cleanupOrphans(processedTrackIds);
      }

      task.status = TaskStatus.SUCCESS;
      this.setupWatcher(musicPath, audiobookPath, cachePath);

    } catch (error) {
      console.error('Import failed:', error);
      task.status = TaskStatus.FAILED;
      task.message = error instanceof Error ? error.message : String(error);
    }
  }

  private async processTrackData(item: ScanResult, type: TrackType, audioBasePath: string, cachePath: string, audioUrl: string, folderId: number | null, hash: string): Promise<number | null> {
    const artistName = item.artist || '未知';
    const albumName = item.album || '未知';
    const coverUrl = item.coverPath ? this.convertToHttpUrl(item.coverPath, 'cover', cachePath) : null;

    // 1. Try to find by Hash (Highest Priority for persistence)
    let existingTrack = hash ? await this.prisma.track.findFirst({ where: { fileHash: hash } }) : null;

    // 2. Fallback to path if hash not found
    if (!existingTrack) {
      existingTrack = await this.trackService.findByPath(audioUrl);
    }

    if (existingTrack) {
      // Resurrection / Update Logic
      this.logger.verbose(`Updating existing track ${existingTrack.id}: ${existingTrack.name}`);

      await this.prisma.track.update({
        where: { id: existingTrack.id },
        data: {
          path: audioUrl, // Update path in case it moved
          folderId: folderId,
          status: FileStatus.ACTIVE,
          trashedAt: null,
          fileHash: hash || existingTrack.fileHash,
          fileModifiedAt: item?.mtime ? new Date(item.mtime) : new Date(),
          // Sync metadata if changed
          name: item.title || path.basename(item.path),
          duration: Math.round(item.duration || 0),
          index: item.track?.no || 0,
          episodeNumber: extractEpisodeNumber(item.title || ""),
        }
      });

      // Also ensure parent album/artist are active
      if (existingTrack.albumId) await this.updateParentStatus(existingTrack.albumId, 'album');
      return existingTrack.id;
    } else {
      // Create new record
      let artist = await this.artistService.findByName(artistName, type, true);
      if (!artist) {
        artist = await this.artistService.createArtist({
          name: artistName,
          avatar: coverUrl,
          type: type,
          status: FileStatus.ACTIVE,
          trashedAt: null
        });
      } else if (artist.status === FileStatus.TRASHED) {
        await this.artistService.updateArtist(artist.id, { status: FileStatus.ACTIVE, trashedAt: null });
      }

      let album = await this.albumService.findByName(albumName, artistName, type, true);
      if (!album) {
        album = await this.albumService.createAlbum({
          name: albumName,
          artist: artistName,
          cover: coverUrl,
          year: item.year ? String(item.year) : null,
          type: type,
          status: FileStatus.ACTIVE,
          trashedAt: null
        });
      } else if (album.status === FileStatus.TRASHED) {
        await this.albumService.updateAlbum(album.id, { status: FileStatus.ACTIVE, trashedAt: null });
      }

      const createdTrack = await this.trackService.createTrack({
        name: item.title || path.basename(item.path),
        artist: artistName,
        album: albumName,
        cover: coverUrl,
        path: audioUrl,
        duration: Math.round(item.duration || 0),
        lyrics: item.lyrics || null,
        index: item.track?.no || 0,
        type: type,
        createdAt: new Date(),
        fileModifiedAt: item?.mtime ? new Date(item.mtime) : null,
        episodeNumber: extractEpisodeNumber(item.title || ""),
        artistId: artist.id,
        albumId: album.id,
        folderId: folderId,
        fileHash: hash,
        status: FileStatus.ACTIVE,
        trashedAt: null
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