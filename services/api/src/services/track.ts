import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, Track, TrackType } from '@soundx/db';
import * as fs from 'fs';
import * as path from 'path';

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
  ): Promise<Track[]> {
    const where: any = {
      album: albumName,
      artist: artist,
      status: 'ACTIVE',
    };

    if (keyword) {
      where.name = { contains: keyword };
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
  ): Promise<number> {
    const where: any = {
      album: albumName,
      artist: artist,
      status: 'ACTIVE',
    };

    if (keyword) {
      where.name = { contains: keyword };
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

  async loadMoreTrack(pageSize: number, loadCount: number, type?: TrackType): Promise<Track[]> {
    const where: any = { status: 'ACTIVE' };
    if (type) {
      where.type = type;
    }
    return await this.prisma.track.findMany({
      where,
      skip: loadCount * pageSize,
      take: pageSize,
      include: {
        artistEntity: true,
        albumEntity: true,
        likedByUsers: true,
      },
    });
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
    const candidates = await this.prisma.track.findMany({
      where: {
        AND: [
          type ? { type } : {},
          { status: 'ACTIVE' },
          {
            OR: [
              { name: { contains: keyword } },
              { artist: { contains: keyword } },
              { album: { contains: keyword } },
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

  async getTracksByArtist(artist: string): Promise<Track[]> {
    const tracks = await this.prisma.track.findMany({
      where: { artist, status: 'ACTIVE' },
      orderBy: { id: 'desc' },
      include: {
        artistEntity: true,
        albumEntity: true,
        likedByUsers: true,
      },
    });
    return await this.attachProgressToTracks(tracks, 1);
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
}
