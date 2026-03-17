import { Injectable } from '@nestjs/common';
import { Album, FileStatus, PrismaClient, TrackType } from '@soundx/db';
import { getTrackHeartbeatScoreMap } from './heartbeat-score';
import { toSimplified } from '../common/zh-utils';

@Injectable()
export class AlbumService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async getAlbumList(): Promise<Album[]> {
    return await this.prisma.album.findMany({ where: { status: 'ACTIVE' } });
  }

  async findByName(name: string, artist?: string, type?: any, allStatus = false): Promise<Album | null> {
    // Build where clause dynamically to avoid null matching issues
    const where: any = {};

    if (name !== null && name !== undefined) {
      where.name = name;
    }
    if (artist !== null && artist !== undefined) {
      where.artist = artist;
    }
    if (type !== null && type !== undefined) {
      where.type = type;
    }
    
    if (!allStatus) {
      where.status = 'ACTIVE';
    }

    return await this.prisma.album.findFirst({ where });
  }

  async getAlbumsByArtist(artist: string, userId?: number): Promise<Album[]> {
    const list = await this.prisma.album.findMany({ where: { artist, status: 'ACTIVE' } });
    if (userId) {
      const audiobookAlbums = list.filter(a => a.type === 'AUDIOBOOK');
      const musicAlbums = list.filter(a => a.type !== 'AUDIOBOOK');
      if (audiobookAlbums.length > 0) {
        const enriched = await this.attachProgressToAlbums(audiobookAlbums, userId);
        return [...musicAlbums, ...enriched].sort((a, b) => b.id - a.id);
      }
    }
    return list;
  }

  async getCollaborativeAlbumsByArtist(artistName: string, userId?: number): Promise<Album[]> {
    // 1. Fetch albums where the artist field contains the artistName but is not an exact match
    const candidates = await this.prisma.album.findMany({
      where: {
        artist: {
          contains: artistName,
          not: artistName,
        },
        status: 'ACTIVE',
      },
      orderBy: { id: 'desc' },
    });

    // 2. Filter in memory to ensure it's a valid collaboration split by delimiters
    const delimiters = /[&/、, \s]+/; 
    const list = candidates.filter(album => {
      const artists = album.artist.split(delimiters).map(a => a.trim());
      // Check for exact match within the split artists
      return artists.includes(artistName);
    });

    if (userId) {
      const audiobookAlbums = list.filter(a => a.type === 'AUDIOBOOK');
      const musicAlbums = list.filter(a => a.type !== 'AUDIOBOOK');
      if (audiobookAlbums.length > 0) {
        const enriched = await this.attachProgressToAlbums(audiobookAlbums, userId);
        return [...musicAlbums, ...enriched].sort((a, b) => b.id - a.id);
      }
    }

    return list;
  }

  async getAlbumById(id: number, userId?: number): Promise<Album | null> {
    const album = await this.prisma.album.findUnique({ 
      where: { id, status: 'ACTIVE' }, 
      include: { likedByUsers: true, listenedByUsers: true } 
    });
    if (!album) return null;

    if (album.type === 'AUDIOBOOK' && userId) {
      const [enriched] = await this.attachProgressToAlbums([album], userId);
      return enriched;
    }
    return album;
  }

  async getAlbumTableList(pageSize: number, current: number): Promise<Album[]> {
    return await this.prisma.album.findMany({
      where: { status: 'ACTIVE' },
      skip: (current - 1) * pageSize,
      take: pageSize,
    });
  }

  async loadMoreAlbum(
    pageSize: number,
    loadCount: number,
    type: TrackType,
    userId: number,
    sortBy?: string,
  ): Promise<Album[]> {
    if (sortBy === 'heartbeat' && userId) {
      const scoreMap = await getTrackHeartbeatScoreMap(this.prisma, userId, type);
      const [allAlbums, tracks] = await Promise.all([
        this.prisma.album.findMany({
          where: { type, status: 'ACTIVE' },
        }),
        this.prisma.track.findMany({
          where: { type, status: 'ACTIVE' },
          select: { id: true, albumId: true, album: true, artist: true },
        }),
      ]);

      const albumIdScoreMap = new Map<number, number>();
      const albumNameArtistScoreMap = new Map<string, number>();
      for (const track of tracks) {
        const score = scoreMap.get(track.id) ?? 0;
        if (!score) continue;
        if (track.albumId) {
          albumIdScoreMap.set(
            track.albumId,
            (albumIdScoreMap.get(track.albumId) ?? 0) + score,
          );
          continue;
        }
        const key = `${track.album}__${track.artist}`;
        albumNameArtistScoreMap.set(
          key,
          (albumNameArtistScoreMap.get(key) ?? 0) + score,
        );
      }

      const sorted = allAlbums.sort((a, b) => {
        const scoreA =
          (albumIdScoreMap.get(a.id) ?? 0) +
          (albumNameArtistScoreMap.get(`${a.name}__${a.artist}`) ?? 0);
        const scoreB =
          (albumIdScoreMap.get(b.id) ?? 0) +
          (albumNameArtistScoreMap.get(`${b.name}__${b.artist}`) ?? 0);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return a.name.localeCompare(b.name);
      });

      const start = loadCount * pageSize;
      const end = start + pageSize;
      const page = sorted.slice(start, end);
      if (type === 'AUDIOBOOK') {
        return await this.attachProgressToAlbums(page, userId);
      }
      return page;
    }

    const result = await this.prisma.album.findMany({
      skip: loadCount * pageSize,
      take: pageSize,
      where: { type, status: 'ACTIVE' },
    });

    if (type === 'AUDIOBOOK') {
      return await this.attachProgressToAlbums(result, userId); // Default userId 1
    }

    return result;
  }

  async albumCount(type?: TrackType): Promise<number> {
    const where: any = { status: 'ACTIVE' };
    if (type) where.type = type;
    return await this.prisma.album.count({ where });
  }

  async createAlbum(album: Omit<Album, 'id'>): Promise<Album> {
    return await this.prisma.album.create({
      data: album,
    });
  }

  async updateAlbum(id: number, album: Partial<Album>): Promise<Album> {
    return await this.prisma.album.update({
      where: { id },
      data: album,
    });
  }

  async deleteAlbum(id: number): Promise<boolean> {
    await this.prisma.album.delete({
      where: { id },
    });
    return true;
  }

  // 批量新增
  async createAlbums(albums: Omit<Album, 'id'>[]): Promise<boolean> {
    const albumList = await this.prisma.album.createMany({
      data: albums,
    });
    if (albumList.count !== albums.length) {
      throw new Error('批量新增失败');
    }
    return albumList.count === albums.length;
  }

  // 批量删除
  async deleteAlbums(ids: number[]): Promise<boolean> {
    await this.prisma.album.deleteMany({
      where: { id: { in: ids } },
    });
    return true;
  }

  // 新增：最近专辑（按 id 倒序）
  async getLatestAlbums(limit = 8, type: TrackType, userId: number): Promise<Album[]> {
    const result = await this.prisma.album.findMany({
      where: type ? { type, status: 'ACTIVE' } : { status: 'ACTIVE' },
      orderBy: { id: 'desc' },
      take: limit,
    });

    if (type === 'AUDIOBOOK') {
      return await this.attachProgressToAlbums(result, userId); // Default userId 1
    }

    return result;
  }

  // 新增：获取随机专辑
  async getRandomAlbums(limit = 8, type: TrackType, userId: number): Promise<Album[]> {
    const count = await this.prisma.album.count({
      where: type ? { type, status: 'ACTIVE' } : { status: 'ACTIVE' },
    });
    const skip = Math.max(0, Math.floor(Math.random() * (count - limit)));
    const result = await this.prisma.album.findMany({
      where: type ? { type, status: 'ACTIVE' } : { status: 'ACTIVE' },
      skip,
      take: limit,
    });

    // Shuffle result to be even more random within the window
    const shuffled = result.sort(() => Math.random() - 0.5);

    if (type === 'AUDIOBOOK') {
      return await this.attachProgressToAlbums(shuffled, userId); // Default userId 1
    }

    return shuffled;
  }

  // 推荐算法：按“喜欢(已听过专辑/歌手)”与“新鲜(未听过专辑)”比例混合
  async getRandomUnlistenedAlbums(
    userId: number,
    limit = 8,
    type?: TrackType,
    likeRatio = 50,
  ): Promise<Album[]> {
    const safeLikeRatio = this.clampRatio(likeRatio);
    const likeCountTarget = Math.round((limit * safeLikeRatio) / 100);
    const freshCountTarget = Math.max(0, limit - likeCountTarget);

    const baseWhere = { status: FileStatus.ACTIVE, ...(type ? { type } : {}) };
    const allAlbums = await this.prisma.album.findMany({
      where: baseWhere,
    });
    if (allAlbums.length === 0) return [];

    const listenedAlbums = await this.prisma.userAlbumHistory.findMany({
      where: { userId },
      select: { albumId: true },
    });
    const listenedAlbumIdSet = new Set(listenedAlbums.map((a) => a.albumId));

    const [trackHistory, trackLikes, albumLikes] = await Promise.all([
      this.prisma.userTrackHistory.findMany({
        where: { userId },
        select: {
          track: { select: { album: true, artist: true } },
        },
      }),
      this.prisma.userTrackLike.findMany({
        where: { userId },
        select: {
          track: { select: { album: true, artist: true } },
        },
      }),
      this.prisma.userAlbumLike.findMany({
        where: { userId },
        select: {
          album: { select: { name: true, artist: true } },
        },
      }),
    ]);

    const preferredAlbumNames = new Set<string>();
    const preferredArtists = new Set<string>();

    for (const item of trackHistory) {
      if (item.track?.album) preferredAlbumNames.add(item.track.album);
      if (item.track?.artist) preferredArtists.add(item.track.artist);
    }
    for (const item of trackLikes) {
      if (item.track?.album) preferredAlbumNames.add(item.track.album);
      if (item.track?.artist) preferredArtists.add(item.track.artist);
    }
    for (const item of albumLikes) {
      if (item.album?.name) preferredAlbumNames.add(item.album.name);
      if (item.album?.artist) preferredArtists.add(item.album.artist);
    }

    const freshPool = allAlbums.filter((album) => !listenedAlbumIdSet.has(album.id));
    const preferredPool = allAlbums.filter(
      (album) =>
        preferredAlbumNames.has(album.name) || preferredArtists.has(album.artist),
    );

    const selected: Album[] = [];
    const used = new Set<number>();

    this.pickRandomFromPool(selected, used, freshPool, freshCountTarget);
    this.pickRandomFromPool(selected, used, preferredPool, likeCountTarget);

    if (selected.length < limit) {
      this.pickRandomFromPool(selected, used, allAlbums, limit - selected.length);
    }

    const shuffled = [...selected].sort(() => Math.random() - 0.5);
    if (type === 'AUDIOBOOK') {
      return await this.attachProgressToAlbums(shuffled, userId);
    }
    return shuffled;
  }

  // 搜索专辑
  async searchAlbums(keyword: string, type: any, limit: number = 10, userId: number): Promise<Album[]> {
    const simplifiedKeyword = toSimplified(keyword);
    const where: any = {
      OR: [
        { name: { contains: simplifiedKeyword } },
        { artist: { contains: simplifiedKeyword } },
      ],
    };

    if (type) {
      where.type = type;
    }
    where.status = 'ACTIVE';

    const candidates = await this.prisma.album.findMany({
      where,
      take: 100,
    });

    const normalizedKeyword = keyword.toLowerCase();

    const sortedAlbums = candidates
      .sort((a, b) => {
        const getScore = (name: string, artist: string) => {
          const nName = name.toLowerCase();
          const nArtist = (artist || '').toLowerCase();
          let score = 0;

          if (nName === normalizedKeyword) score = Math.max(score, 100);
          else if (nName.startsWith(normalizedKeyword)) score = Math.max(score, 90);
          else if (nName.includes(normalizedKeyword)) score = Math.max(score, 70);

          if (nArtist === normalizedKeyword) score = Math.max(score, 80);
          else if (nArtist.startsWith(normalizedKeyword)) score = Math.max(score, 60);
          else if (nArtist.includes(normalizedKeyword)) score = Math.max(score, 50);

          return score;
        };

        const scoreA = getScore(a.name, a.artist);
        const scoreB = getScore(b.name, b.artist);

        if (scoreA !== scoreB) return scoreB - scoreA;
        return a.name.length - b.name.length;
      })
      .slice(0, limit);

    if (type === 'AUDIOBOOK') {
      return await this.attachProgressToAlbums(sortedAlbums, userId);
    }
    return sortedAlbums;
  }

  // Helper: Attach progress to audiobook albums
  private clampRatio(value?: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return 50;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private pickRandomFromPool(
    target: Album[],
    used: Set<number>,
    pool: Album[],
    count: number,
  ) {
    if (count <= 0 || pool.length === 0) return;
    const startLength = target.length;
    const limit = startLength + count;
    const candidates = [...pool].sort(() => Math.random() - 0.5);
    for (const item of candidates) {
      if (target.length >= limit) break;
      if (used.has(item.id)) continue;
      used.add(item.id);
      target.push(item);
    }
  }

  private async attachProgressToAlbums(albums: Album[], userId: number): Promise<Album[]> {
    if (albums.length === 0) return albums;

    const albumNames = albums.map(a => a.name);
    const artists = albums.map(a => a.artist);

    // 1. Fetch all tracks for these albums to calculate total duration
    const tracks = await this.prisma.track.findMany({
      where: {
        album: { in: albumNames },
        artist: { in: artists },
        type: 'AUDIOBOOK',
        status: 'ACTIVE',
      },
      select: {
        id: true,
        album: true,
        artist: true,
        duration: true,
      },
    });

    // 2. Fetch user's listening history for these tracks
    const trackIds = tracks.map(t => t.id);
    const history = await this.prisma.userAudiobookHistory.findMany({
      where: {
        userId,
        trackId: { in: trackIds },
      },
      select: {
        trackId: true,
        progress: true,
        listenedAt: true,
      },
      orderBy: {
        listenedAt: 'desc',
      },
    });

    // Create a map for quick lookup of track progress
    const historyMap = new Map(history.map(h => [h.trackId, h.progress]));

    const listenedTrackIds = new Set(history.map(h => h.trackId));

    // 3. Calculate progress per album and find resume point
    return albums.map(album => {
      const albumTracks = tracks.filter(t => t.album === album.name && t.artist === album.artist);
      if (albumTracks.length === 0) return { ...album, progress: 0 };

      const totalDuration = albumTracks.reduce((sum, t) => sum + (t.duration || 0), 0);

      const listenedDuration = albumTracks.reduce((sum, t) => {
        const progress = historyMap.get(t.id) || 0;
        // Cap progress at track duration to avoid anomalies (e.g. if duration metadata is wrong or progress overshot)
        // But if duration is 0, progress might be valid.
        // Let's just trust progress, but maybe cap if duration exists and is > 0
        const trackDuration = t.duration || 0;
        const effectiveProgress = trackDuration > 0 ? Math.min(progress, trackDuration) : progress;
        return sum + effectiveProgress;
      }, 0);

      const progressPercent = totalDuration === 0 ? 0 : Math.min(100, Math.round((listenedDuration / totalDuration) * 100));

      // Find resume point (latest history entry for any track in this album)
      const albumTrackIds = new Set(albumTracks.map(t => t.id));
      const latestHistory = history.find(h => albumTrackIds.has(h.trackId)); // Since history is ordered by listenedAt desc

      return {
        ...album,
        progress: progressPercent,
        resumeTrackId: latestHistory ? latestHistory.trackId : null,
        resumeProgress: latestHistory ? latestHistory.progress : 0
      };
    });
  }
}
