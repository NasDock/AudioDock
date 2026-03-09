import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileStatus, PrismaClient, Track, TrackType } from '@soundx/db';
import * as fs from 'fs';
import * as path from 'path';
import { getTrackHeartbeatScoreMap } from './heartbeat-score';
import { toSimplified } from '../common/zh-utils';

@Injectable()
export class TrackService {
  private prisma: PrismaClient;

  constructor(private readonly configService: ConfigService) {
    this.prisma = new PrismaClient();
  }

  public getFilePath(trackPath: string): string | null {
    if (trackPath.startsWith('/music/')) {
      const musicBaseDir = this.configService.get<string>('MUSIC_BASE_DIR') || './';
      return path.join(path.resolve(musicBaseDir), trackPath.replace('/music/', ''));
    }
    if (trackPath.startsWith('/audio/')) {
      const audioBookDir = this.configService.get<string>('AUDIO_BOOK_DIR') || './';
      return path.join(path.resolve(audioBookDir), trackPath.replace('/audio/', ''));
    }
    return null;
  }

  private async deleteFileSafely(trackPath: string) {
    const absolutePath = this.getFilePath(trackPath);
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
    sortBy: 'id' | 'index' | 'episodeNumber' = 'episodeNumber',
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

    const tracks = await this.prisma.track.findMany({
      where,
      orderBy: [
        { [sortBy]: sort },
      ],
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

  async getTracksByArtist(artist: string): Promise<Track[]> {
    const tracks = await this.prisma.track.findMany({
      where: { 
        artist: { contains: artist },
        status: 'ACTIVE' 
      },
      orderBy: { id: 'desc' },
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

    return await this.attachProgressToTracks(filteredTracks, 1);
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
