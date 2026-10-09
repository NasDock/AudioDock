import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileStatus, PrismaClient, Track, TrackType } from '@soundx/db';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_AUDIOBOOK_DIR,
  DEFAULT_CACHE_DIR,
  DEFAULT_MUSIC_DIR,
  DEFAULT_MV_DIR,
} from '../common/media-paths';
import { resolvePathList } from '../common/path-list';
import { getTrackHeartbeatScoreMap } from './heartbeat-score';
import { toSimplified } from '../common/zh-utils';

export type AlbumTrackSortBy =
  | 'id'
  | 'index'
  | 'episodeNumber'
  | 'fileName'
  | 'fileCreatedAt'
  | 'fileModifiedAt'
  | 'scanOrder';

export type TrackPlaybackQuality = 'lossless' | 'high' | 'standard';

export interface TrackPlaybackQualityOption {
  quality: TrackPlaybackQuality;
  label: string;
  codec: string;
  bitrate: string;
}

export interface TrackPlaybackProfile {
  defaultQuality: TrackPlaybackQuality;
  options: TrackPlaybackQualityOption[];
}

interface TrackProbeInfo {
  bitrate: number | null;
  isLossless: boolean;
  codecName: string | null;
}

@Injectable()
export class TrackService {
  private prisma: PrismaClient;
  private readonly transcodeTasks = new Map<string, Promise<string>>();
  private readonly naturalFileNameCollator = new Intl.Collator('zh-CN', {
    numeric: true,
    sensitivity: 'base',
  });

  constructor(
    private readonly configService: ConfigService,
  ) {
    this.prisma = new PrismaClient();
  }

  private getMusicDirs(): string[] {
    return resolvePathList(process.env.MUSIC_BASE_DIR, DEFAULT_MUSIC_DIR);
  }

  private getMvDirs(): string[] {
    return resolvePathList(process.env.MV_BASE_DIR, DEFAULT_MV_DIR);
  }

  private getAudiobookDirs(): string[] {
    return resolvePathList(process.env.AUDIO_BOOK_DIR, DEFAULT_AUDIOBOOK_DIR);
  }

  private getFileNameSortKey(track: Pick<Track, 'fileName' | 'name' | 'relativePath'>): string {
    const rawName = track.fileName || track.name || track.relativePath || '';
    const ext = path.extname(rawName);
    return ext ? rawName.slice(0, -ext.length) : rawName;
  }

  public async getFilePath(trackPath: string): Promise<string | null> {
    if (trackPath.startsWith('/music/')) {
      const dirs = [...this.getMusicDirs(), ...this.getMvDirs()];
      const relativePath = trackPath.replace('/music/', '');
      for (const dir of dirs) {
        const candidate = this.resolveCandidatePath(dir, relativePath);
        if (candidate) return candidate;
      }
      return path.join(dirs[0] || './music/music', relativePath);
    }
    if (trackPath.startsWith('/audio/')) {
      const dirs = this.getAudiobookDirs();
      const relativePath = trackPath.replace('/audio/', '');
      for (const dir of dirs) {
        const candidate = this.resolveCandidatePath(dir, relativePath);
        if (candidate) return candidate;
      }
      return path.join(dirs[0] || './music/audio', relativePath);
    }
    if (trackPath.startsWith('/covers/')) {
      const cacheDir = path.resolve(this.configService.get<string>('CACHE_DIR') || DEFAULT_CACHE_DIR);
      const relativePath = trackPath.replace('/covers/', '');
      const candidate = this.resolveCandidatePath(cacheDir, relativePath);
      return candidate || path.join(cacheDir, relativePath);
    }
    return null;
  }

  private resolveCandidatePath(baseDir: string, relativePath: string): string | null {
    const normalizedBaseDir = path.resolve(baseDir);
    const normalizedRelativePath = relativePath.replace(/^[/\\]+/, '');
    const baseName = path.basename(normalizedBaseDir);
    const tried = new Set<string>();

    const tryCandidate = (candidatePath: string): string | null => {
      const resolvedCandidate = path.resolve(candidatePath);
      if (tried.has(resolvedCandidate)) {
        return null;
      }
      tried.add(resolvedCandidate);
      return fs.existsSync(resolvedCandidate) ? resolvedCandidate : null;
    };

    const directCandidate = tryCandidate(path.join(normalizedBaseDir, normalizedRelativePath));
    if (directCandidate) {
      return directCandidate;
    }

    let trimmedPath = normalizedRelativePath;
    while (trimmedPath === baseName || trimmedPath.startsWith(`${baseName}${path.sep}`)) {
      trimmedPath = trimmedPath === baseName
        ? ''
        : trimmedPath.slice(baseName.length + 1);
      const trimmedCandidate = tryCandidate(path.join(normalizedBaseDir, trimmedPath));
      if (trimmedCandidate) {
        return trimmedCandidate;
      }
    }

    const parentCandidate = tryCandidate(path.join(path.dirname(normalizedBaseDir), normalizedRelativePath));
    if (parentCandidate) {
      return parentCandidate;
    }

    return null;
  }

  private getTranscodeCacheDir(): string {
    const configured = this.configService.get<string>('TRANSCODE_CACHE_DIR');
    const cacheDir = configured
      ? path.resolve(configured)
      : path.resolve(process.cwd(), 'music', 'transcoded-audio');

    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    return cacheDir;
  }

  private async probeTrack(filePath: string): Promise<TrackProbeInfo> {
    const ext = path.extname(filePath).toLowerCase();
    const extLossless = new Set(['.flac', '.wav', '.ape', '.aiff', '.alac']);

    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
      ]);

      let stdout = '';

      ffprobe.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      const fallback = () =>
        resolve({
          bitrate: null,
          isLossless: extLossless.has(ext),
          codecName: ext ? ext.slice(1) : null,
        });

      ffprobe.on('error', fallback);
      ffprobe.on('close', () => {
        try {
          const parsed = JSON.parse(stdout || '{}');
          const format = parsed?.format || {};
          const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
          const audioStream = streams.find((stream: any) => stream?.codec_type === 'audio') || {};
          const codecName = String(audioStream?.codec_name || format?.format_name || '').toLowerCase();
          const bitrateRaw = Number(audioStream?.bit_rate || format?.bit_rate || 0) || null;
          const isLossless =
            extLossless.has(ext) ||
            ['flac', 'alac', 'wavpack', 'ape', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le'].includes(codecName);

          resolve({
            bitrate: bitrateRaw,
            isLossless,
            codecName: codecName || (ext ? ext.slice(1) : null),
          });
        } catch {
          fallback();
        }
      });
    });
  }

  public async getTrackPlaybackProfile(track: Track): Promise<TrackPlaybackProfile> {
    if (track.path.startsWith('http')) {
      return {
        defaultQuality: 'lossless',
        options: [
          { quality: 'lossless', label: '无损', codec: '原始', bitrate: '原始' },
        ],
      };
    }

    const filePath = await this.getFilePath(track.path);
    if (!filePath || !fs.existsSync(filePath)) {
      return {
        defaultQuality: 'lossless',
        options: [
          { quality: 'lossless', label: '无损', codec: '原始', bitrate: '原始' },
        ],
      };
    }

    const probe = await this.probeTrack(filePath);
    const probeCodec = (probe.codecName || path.extname(filePath).slice(1)).toUpperCase();
    const probeBitrate = probe.bitrate ? `${Math.round(probe.bitrate / 1000)}kbps` : '原始';

    if (probe.isLossless) {
      return {
        defaultQuality: 'lossless',
        options: [
          { quality: 'lossless', label: '无损', codec: probeCodec, bitrate: '原始' },
          { quality: 'high', label: '高品质', codec: 'AAC', bitrate: '256kbps' },
          { quality: 'standard', label: '低品质', codec: 'AAC', bitrate: '128kbps' },
        ],
      };
    }

    // 有损源文件（MP3/AAC/OGG…）同样提供 lossless 档 = 直发源文件（原音质）。
    // 之前没有这一档：客户端选「无损」会被服务端回落到 defaultQuality，
    // 把 320k MP3 无谓地再转码成 AAC 256k（有损转有损，画质只会更差）。
    // defaultQuality 也定为 lossless：不带 quality 参数的旧客户端/缓存下载
    // 拿到的都是原始文件，不会触发任何转码。
    const rawOption: TrackPlaybackQualityOption = {
      quality: 'lossless',
      label: '原音质',
      codec: probeCodec,
      bitrate: probeBitrate,
    };

    if ((probe.bitrate || 0) >= 256_000) {
      return {
        defaultQuality: 'lossless',
        options: [
          rawOption,
          { quality: 'high', label: '高品质', codec: 'AAC', bitrate: '256kbps' },
          { quality: 'standard', label: '低品质', codec: 'AAC', bitrate: '128kbps' },
        ],
      };
    }

    return {
      defaultQuality: 'lossless',
      options: [
        rawOption,
        { quality: 'standard', label: '低品质', codec: 'AAC', bitrate: '128kbps' },
      ],
    };
  }

  private getTranscodeCachePath(track: Track, quality: Exclude<TrackPlaybackQuality, 'lossless'>): string {
    const cacheDir = this.getTranscodeCacheDir();
    const fingerprint = (track as any).fileHash || `${track.id}_${(track as any).fileModifiedAt || ''}`;
    return path.join(cacheDir, `${fingerprint}_${quality}.m4a`);
  }

  public async resolvePlaybackFile(track: Track, quality: TrackPlaybackQuality): Promise<{ filePath: string; contentType: string }> {
    if (track.path.startsWith('http')) {
      return {
        filePath: track.path,
        contentType: 'audio/mpeg',
      };
    }

    // If track has a pre-transcoded path (import-time transcode for incompatible formats),
    // use it directly regardless of quality setting
    if ((track as any).transcodedPath && fs.existsSync((track as any).transcodedPath)) {
      return {
        filePath: (track as any).transcodedPath,
        contentType: 'audio/mpeg',
      };
    }

    const sourcePath = await this.getFilePath(track.path);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error('File not found');
    }

    if (quality === 'lossless') {
      const ext = path.extname(sourcePath).toLowerCase();
      const contentTypeMap: Record<string, string> = {
        '.flac': 'audio/flac',
        '.wav': 'audio/wav',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',
        '.mp3': 'audio/mpeg',
        '.ogg': 'audio/ogg',
        '.oga': 'audio/ogg',
        '.opus': 'audio/ogg',
        '.wma': 'audio/x-ms-wma',
        '.aiff': 'audio/aiff',
        '.aif': 'audio/aiff',
        '.ape': 'audio/x-monkeys-audio',
        '.alac': 'audio/mp4',
      };

      return {
        filePath: sourcePath,
        contentType: contentTypeMap[ext] || 'audio/mpeg',
      };
    }

    const cachedPath = this.getTranscodeCachePath(track, quality);
    if (fs.existsSync(cachedPath)) {
      return {
        filePath: cachedPath,
        contentType: 'audio/mp4',
      };
    }

    const taskKey = `${track.id}:${quality}`;
    if (!this.transcodeTasks.has(taskKey)) {
      const bitrate = quality === 'high' ? '256k' : '128k';
      const task = new Promise<string>((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
          '-y',
          '-i', sourcePath,
          '-vn',
          '-c:a', 'aac',
          '-b:a', bitrate,
          '-movflags', '+faststart',
          cachedPath,
        ]);

        let stderr = '';

        ffmpeg.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });

        ffmpeg.on('error', (error) => {
          reject(error);
        });

        ffmpeg.on('close', (code) => {
          if (code === 0 && fs.existsSync(cachedPath)) {
            resolve(cachedPath);
            return;
          }

          reject(new Error(stderr || `ffmpeg exited with code ${code}`));
        });
      }).finally(() => {
        this.transcodeTasks.delete(taskKey);
      });

      this.transcodeTasks.set(taskKey, task);
    }

    const filePath = await this.transcodeTasks.get(taskKey)!;
    return {
      filePath,
      contentType: 'audio/mp4',
    };
  }

  private async deleteFileSafely(trackPath: string) {
    const absolutePath = await this.getFilePath(trackPath);
    if (absolutePath && fs.existsSync(absolutePath)) {
      try {
        await fs.promises.unlink(absolutePath);
        console.log(`Deleted file: ${absolutePath}`);
      } catch (error) {
        console.error(`Failed to delete file: ${absolutePath}`, error);
      }
    }
  }

  async getTrackList(): Promise<Track[]> {
    return await this.prisma.track.findMany({ where: { status: 'ACTIVE' } });
  }

  async findById(id: number): Promise<Track | null> {
    return await this.prisma.track.findUnique({
      where: { id },
      include: {
        artistEntity: true,
        albumEntity: true,
      },
    });
  }

  async findByPath(path: string): Promise<Track | null> {
    return await this.prisma.track.findFirst({
      where: { path, status: 'ACTIVE' },
      include: {
        artistEntity: true,
        albumEntity: true,
        likedByUsers: true,
      },
    });
  }

   async getTracksByAlbum(
    albumName: string,
    artist: string,
    pageSize: number,
    skip: number,
    sort: 'asc' | 'desc' = 'asc',
    keyword?: string,
    userId?: number,
    sortBy: AlbumTrackSortBy = 'episodeNumber',
    albumId?: number,
  ): Promise<Track[]> {
    const where: any = {
      status: 'ACTIVE',
    };

    if (albumId) {
      where.albumId = albumId;
    } else {
      where.album = albumName;
      where.artist = artist;
    }

    if (keyword) {
      const simplifiedKeyword = toSimplified(keyword);
      where.name = { contains: simplifiedKeyword };
    }

    if (sortBy === 'fileName') {
      const tracks = await this.prisma.track.findMany({
        where,
        include: {
          artistEntity: true,
          albumEntity: true,
          likedByUsers: true
        },
      });

      tracks.sort((a, b) => {
        const primary = this.naturalFileNameCollator.compare(
          this.getFileNameSortKey(a),
          this.getFileNameSortKey(b),
        );
        if (primary !== 0) {
          return sort === 'asc' ? primary : -primary;
        }

        const relativePathCompare = this.naturalFileNameCollator.compare(
          a.relativePath || '',
          b.relativePath || '',
        );
        if (relativePathCompare !== 0) {
          return sort === 'asc' ? relativePathCompare : -relativePathCompare;
        }

        return sort === 'asc' ? a.id - b.id : b.id - a.id;
      });

      return await this.attachProgressToTracks(
        tracks.slice(skip, skip + pageSize),
        userId || 1,
      );
    }

    const orderBy: any[] = [];
    switch (sortBy) {
      case 'id':
        orderBy.push({ id: sort });
        break;
      case 'index':
        orderBy.push({ index: sort }, { relativePath: sort }, { id: sort });
        break;
      case 'fileCreatedAt':
        orderBy.push({ fileCreatedAt: sort }, { relativePath: sort }, { id: sort });
        break;
      case 'fileModifiedAt':
        orderBy.push({ fileModifiedAt: sort }, { relativePath: sort }, { id: sort });
        break;
      case 'scanOrder':
        orderBy.push({ scanOrder: sort }, { id: sort });
        break;
      case 'episodeNumber':
      default:
        orderBy.push({ episodeNumber: sort }, { index: sort }, { relativePath: sort }, { id: sort });
        break;
    }

    const tracks = await this.prisma.track.findMany({
      where,
      orderBy,
      skip: skip,
      take: pageSize,
      include: {
        artistEntity: true,
        albumEntity: true,
        likedByUsers: true
      },
    });

    return await this.attachProgressToTracks(tracks, userId || 1);
  }

  async getTrackCountByAlbum(
    albumName: string,
    artist: string,
    keyword?: string,
    albumId?: number,
  ): Promise<number> {
    const where: any = {
      status: 'ACTIVE',
    };

    if (albumId) {
      where.albumId = albumId;
    } else {
      where.album = albumName;
      where.artist = artist;
    }

    if (keyword) {
      const simplifiedKeyword = toSimplified(keyword);
      where.name = { contains: simplifiedKeyword };
    }

    return await this.prisma.track.count({
      where,
    });
  }

  async getTrackTableList(pageSize: number, current: number): Promise<Track[]> {
    return await this.prisma.track.findMany({
      where: { status: 'ACTIVE' },
      skip: (current - 1) * pageSize,
      take: pageSize,
      include: {
        artistEntity: true,
        albumEntity: true,
        likedByUsers: true,
      },
    });
  }

  async loadMoreTrack(
    pageSize: number,
    loadCount: number,
    type?: TrackType,
    userId?: number,
    sortBy?: string,
  ): Promise<Track[]> {
    if (sortBy === 'heartbeat' && userId) {
      const where: any = { status: 'ACTIVE' };
      if (type) {
        where.type = type;
      }
      const list = await this.prisma.track.findMany({
        where,
        include: {
          artistEntity: true,
          albumEntity: true,
          likedByUsers: true,
        },
      });
      const scoreMap = await getTrackHeartbeatScoreMap(this.prisma, userId, type);
      const sorted = list.sort((a, b) => {
        const scoreDiff = (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        return a.name.localeCompare(b.name);
      });
      const start = loadCount * pageSize;
      const end = start + pageSize;
      return await this.attachProgressToTracks(sorted.slice(start, end), userId);
    }

    const where: any = { status: 'ACTIVE' };
    if (type) {
      where.type = type;
    }
    const list = await this.prisma.track.findMany({
      where,
      skip: loadCount * pageSize,
      take: pageSize,
      include: {
        artistEntity: true,
        albumEntity: true,
        likedByUsers: true,
      },
    });
    return await this.attachProgressToTracks(list, userId || 1);
  }

  async trackCount(type?: TrackType): Promise<number> {
    const where: any = { status: 'ACTIVE' };
    if (type) {
      where.type = type;
    }
    return await this.prisma.track.count({ where });
  }

  async createTrack(track: Omit<Track, 'id'>): Promise<Track> {
    return await this.prisma.track.create({
      data: track,
    });
  }

  async updateTrack(id: number, track: Partial<Track>): Promise<Track> {
    return await this.prisma.track.update({
      where: { id },
      data: track,
    });
  }

  async checkDeletionImpact(id: number): Promise<{ isLastTrackInAlbum: boolean; albumName: string | null }> {
    const track = await this.prisma.track.findUnique({ where: { id } });
    if (!track) return { isLastTrackInAlbum: false, albumName: null };

    let count = 0;
    if (track.albumId) {
      count = await this.prisma.track.count({ where: { albumId: track.albumId, status: 'ACTIVE' } });
    } else if (track.album) {
      count = await this.prisma.track.count({
        where: {
          album: track.album,
          artist: track.artist,
          status: 'ACTIVE'
        }
      });
    }

    return {
      isLastTrackInAlbum: count === 1,
      albumName: track.album || null
    };
  }

  async deleteTrack(id: number): Promise<boolean> {
    const track = await this.prisma.track.findUnique({ where: { id } });
    if (track) {
      await this.deleteFileSafely(track.path);
    }

    await this.prisma.userTrackLike.deleteMany({ where: { trackId: id } });
    await this.prisma.userTrackHistory.deleteMany({ where: { trackId: id } });
    await this.prisma.userAudiobookLike.deleteMany({ where: { trackId: id } });
    await this.prisma.userAudiobookHistory.deleteMany({ where: { trackId: id } });

    if (track) {
      const impact = await this.checkDeletionImpact(id);
      if (impact.isLastTrackInAlbum) {
        if (track.albumId) {
          await this.prisma.userAlbumLike.deleteMany({ where: { albumId: track.albumId } });
          await this.prisma.userAlbumHistory.deleteMany({ where: { albumId: track.albumId } });
          await this.prisma.album.delete({ where: { id: track.albumId } });
        } else if (track.album) {
          const album = await this.prisma.album.findFirst({
            where: { name: track.album, artist: track.artist, status: 'ACTIVE' }
          });
          if (album) {
            await this.prisma.userAlbumLike.deleteMany({ where: { albumId: album.id } });
            await this.prisma.userAlbumHistory.deleteMany({ where: { albumId: album.id } });
            await this.prisma.album.delete({ where: { id: album.id } });
          }
        }
      }
    }

    await this.prisma.track.delete({
      where: { id },
    });
    return true;
  }

  async createTracks(tracks: Omit<Track, 'id'>[]): Promise<boolean> {
    const trackList = await this.prisma.track.createMany({
      data: tracks,
    });
    if (trackList.count !== tracks.length) {
      throw new Error('批量新增失败');
    }
    return trackList.count === tracks.length;
  }

  async deleteTracks(ids: number[]): Promise<boolean> {
    const tracks = await this.prisma.track.findMany({
      where: { id: { in: ids } },
    });
    for (const track of tracks) {
      await this.deleteFileSafely(track.path);
    }

    await this.prisma.userTrackLike.deleteMany({ where: { trackId: { in: ids } } });
    await this.prisma.userTrackHistory.deleteMany({ where: { trackId: { in: ids } } });
    await this.prisma.userAudiobookLike.deleteMany({ where: { trackId: { in: ids } } });
    await this.prisma.userAudiobookHistory.deleteMany({ where: { trackId: { in: ids } } });

    await this.prisma.track.deleteMany({
      where: { id: { in: ids } },
    });
    return true;
  }

  async searchTracks(keyword: string, type?: TrackType, limit: number = 10): Promise<Track[]> {
    const simplifiedKeyword = toSimplified(keyword);
    const candidates = await this.prisma.track.findMany({
      where: {
        AND: [
          type ? { type } : {},
          { status: 'ACTIVE' },
          {
            OR: [
              { name: { contains: simplifiedKeyword } },
              { artist: { contains: simplifiedKeyword } },
              { album: { contains: simplifiedKeyword } },
            ],
          },
        ],
      },
      take: 100,
      include: {
        artistEntity: true,
        albumEntity: true,
        likedByUsers: true,
      },
    });

    const normalizedKeyword = keyword.toLowerCase();

    return candidates
      .sort((a, b) => {
        const getScore = (track: Track) => {
          const nName = track.name.toLowerCase();
          const nArtist = (track.artist || '').toLowerCase();
          const nAlbum = (track.album || '').toLowerCase();
          let score = 0;

          if (nName === normalizedKeyword) score = Math.max(score, 100);
          else if (nName.startsWith(normalizedKeyword)) score = Math.max(score, 95);
          else if (nName.includes(normalizedKeyword)) score = Math.max(score, 70);

          if (nArtist === normalizedKeyword || nAlbum === normalizedKeyword) score = Math.max(score, 80);
          else if (nArtist.startsWith(normalizedKeyword) || nAlbum.startsWith(normalizedKeyword)) score = Math.max(score, 60);
          else if (nArtist.includes(normalizedKeyword) || nAlbum.includes(normalizedKeyword)) score = Math.max(score, 50);

          return score;
        };

        const scoreA = getScore(a);
        const scoreB = getScore(b);

        if (scoreA !== scoreB) return scoreB - scoreA;
        return a.name.length - b.name.length;
      })
      .slice(0, limit);
  }

  async getLatestTracks(type?: TrackType, limit: number = 8): Promise<Track[]> {
    return await this.prisma.track.findMany({
      where: type ? { type, status: 'ACTIVE' } : { status: 'ACTIVE' },
      take: limit,
      orderBy: { id: 'desc' },
      include: {
        artistEntity: true,
        albumEntity: true,
        likedByUsers: true,
      },
    });
  }

  async getRandomTracks(type?: TrackType, limit: number = 8): Promise<Track[]> {
    const count = await this.prisma.track.count({
      where: type ? { type, status: 'ACTIVE' } : { status: 'ACTIVE' },
    });
    const skip = Math.max(0, Math.floor(Math.random() * (count - limit)));
    const tracks = await this.prisma.track.findMany({
      where: type ? { type, status: 'ACTIVE' } : { status: 'ACTIVE' },
      skip,
      take: limit,
      include: {
        artistEntity: true,
        albumEntity: true,
        likedByUsers: true,
      },
    });
    return tracks.sort(() => Math.random() - 0.5);
  }

  // 推荐算法：按“喜欢(已听过专辑/歌手)”与“新鲜(未听过曲目)”比例混合
  async getRecommendedTracks(
    userId: number | null,
    type?: TrackType,
    limit: number = 8,
    likeRatio = 50,
  ): Promise<Track[]> {
    if (!userId) {
      return this.getRandomTracks(type, limit);
    }

    const safeLikeRatio = this.clampRatio(likeRatio);
    const likeCountTarget = Math.round((limit * safeLikeRatio) / 100);
    const freshCountTarget = Math.max(0, limit - likeCountTarget);

    const where = type
      ? { type, status: FileStatus.ACTIVE }
      : { status: FileStatus.ACTIVE };
    const allTracks = await this.prisma.track.findMany({
      where,
      select: {
        id: true,
        album: true,
        artist: true,
      },
    });
    if (allTracks.length === 0) return [];

    const isAudiobook = type === TrackType.AUDIOBOOK;
    const [historyRows, likeRows] = await Promise.all([
      isAudiobook
        ? this.prisma.userAudiobookHistory.findMany({
            where: { userId },
            select: {
              trackId: true,
              track: { select: { album: true, artist: true } },
            },
          })
        : this.prisma.userTrackHistory.findMany({
            where: { userId },
            select: {
              trackId: true,
              track: { select: { album: true, artist: true } },
            },
          }),
      isAudiobook
        ? this.prisma.userAudiobookLike.findMany({
            where: { userId },
            select: {
              trackId: true,
              track: { select: { album: true, artist: true } },
            },
          })
        : this.prisma.userTrackLike.findMany({
            where: { userId },
            select: {
              trackId: true,
              track: { select: { album: true, artist: true } },
            },
          }),
    ]);

    const listenedTrackIds = new Set(historyRows.map((row) => row.trackId));
    const likedTrackIds = new Set(likeRows.map((row) => row.trackId));
    const preferredAlbums = new Set<string>();
    const preferredArtists = new Set<string>();

    for (const row of historyRows) {
      if (row.track?.album) preferredAlbums.add(row.track.album);
      if (row.track?.artist) preferredArtists.add(row.track.artist);
    }
    for (const row of likeRows) {
      if (row.track?.album) preferredAlbums.add(row.track.album);
      if (row.track?.artist) preferredArtists.add(row.track.artist);
    }

    const freshPoolIds = allTracks
      .filter((t) => !listenedTrackIds.has(t.id))
      .map((t) => t.id);
    const preferredPoolIds = allTracks
      .filter(
        (t) =>
          preferredAlbums.has(t.album) ||
          preferredArtists.has(t.artist) ||
          listenedTrackIds.has(t.id) ||
          likedTrackIds.has(t.id),
      )
      .map((t) => t.id);
    const allIds = allTracks.map((t) => t.id);

    const selectedIds: number[] = [];
    const used = new Set<number>();
    this.pickRandomIds(selectedIds, used, freshPoolIds, freshCountTarget);
    this.pickRandomIds(selectedIds, used, preferredPoolIds, likeCountTarget);
    if (selectedIds.length < limit) {
      this.pickRandomIds(selectedIds, used, allIds, limit - selectedIds.length);
    }

    const selectedTracks = await this.prisma.track.findMany({
      where: { id: { in: selectedIds } },
      include: {
        artistEntity: true,
        albumEntity: true,
        likedByUsers: true,
      },
    });
    const orderMap = new Map(selectedIds.map((id, index) => [id, index]));
    return selectedTracks.sort(
      (a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0),
    );
  }

  async getTracksByArtist(artist: string, skip?: number, pageSize?: number): Promise<{ list: Track[]; total: number; hasMore: boolean }> {
    const where = {
      artist: { contains: artist },
      status: 'ACTIVE' as const,
    };

    const safePageSize = Math.min(Math.max(1, Number.isFinite(pageSize as number) ? (pageSize as number) : 100), 500);
    const usePage = typeof skip === 'number' && Number.isFinite(skip);
    const safeSkip = usePage ? Math.max(0, skip as number) : 0;

    const tracks = await this.prisma.track.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: usePage ? safeSkip : undefined,
      take: usePage ? safePageSize : undefined,
      include: {
        artistEntity: true,
        albumEntity: true,
        likedByUsers: true,
      },
    });

    // Client-side rigorous filtering to avoid partial matches like "Michael" matching "Michael Jackson"
    // unless it is a split part like "Michael / Jackson"
    const artistDelimiters = /[&,、]|\s+and\s+/i;
    const filteredTracks = tracks.filter(t => {
       if (t.artist === artist) return true;
       const parts = t.artist.split(artistDelimiters).map(s => s.trim());
       return parts.includes(artist);
    });

    // total 需要在过滤后重新计算（contains 查询匹配范围比精确匹配更广）
    let total: number;
    if (usePage) {
      // 分页路径：只在第一页算 total，避免每页都全表扫描
      total = safeSkip === 0 ? filteredTracks.length : await this.prisma.track.count({ where });
    } else {
      total = filteredTracks.length;
    }
    const list = await this.attachProgressToTracks(filteredTracks, 1);

    return {
      list,
      total,
      hasMore: usePage ? safeSkip + list.length < total : false,
    };
  }

  private async attachProgressToTracks(tracks: Track[], userId: number): Promise<Track[]> {
    if (tracks.length === 0) return tracks;
    const audiobookTracks = tracks.filter(t => t.type === 'AUDIOBOOK');
    if (audiobookTracks.length === 0) return tracks;

    const trackIds = audiobookTracks.map(t => t.id);
    const history = await this.prisma.userAudiobookHistory.findMany({
      where: {
        userId,
        trackId: { in: trackIds },
      },
      select: {
        trackId: true,
        progress: true,
      },
    });

    const historyMap = new Map(history.map(h => [h.trackId, h.progress]));

    return tracks.map(t => {
      if (t.type === 'AUDIOBOOK' && historyMap.has(t.id)) {
        return { ...t, progress: historyMap.get(t.id) };
      }
      return t;
    });
  }

  private clampRatio(value?: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return 50;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private pickRandomIds(
    target: number[],
    used: Set<number>,
    pool: number[],
    count: number,
  ) {
    if (count <= 0 || pool.length === 0) return;
    const startLength = target.length;
    const limit = startLength + count;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    for (const id of shuffled) {
      if (target.length >= limit) break;
      if (used.has(id)) continue;
      used.add(id);
      target.push(id);
    }
  }
}
