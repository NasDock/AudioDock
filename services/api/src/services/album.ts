import { Injectable } from '@nestjs/common';
import { Album, PrismaClient, TrackType } from '@soundx/db';

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

  async loadMoreAlbum(pageSize: number, loadCount: number, type: TrackType, userId: number): Promise<Album[]> {
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

  // 随机推荐：用户未听过的专辑
  async getRandomUnlistenedAlbums(userId: number, limit = 8, type?: TrackType): Promise<Album[]> {
    // 1. 获取用户已听过的专辑 ID
    const listened = await this.prisma.userAlbumHistory.findMany({
      where: { userId },
      select: { albumId: true },
    });
    const listenedIds = listened.map((r) => r.albumId);
    const listenedSet = new Set(listenedIds);

    // 2. 获取所有符合条件的专辑 ID (按类型和状态过滤)
    const allMatchingAlbums = await this.prisma.album.findMany({
      where: { status: 'ACTIVE', ...(type ? { type } : {}) },
      select: { id: true },
    });
    const allIds = allMatchingAlbums.map(a => a.id);

    // 3. 区分已听和未听的 ID
    const unlistenedIds = allIds.filter(id => !listenedSet.has(id));
    const matchedListenedIds = allIds.filter(id => listenedSet.has(id));

    // 4. 随机选取未听过的 ID
    const pickedUnlistenedIds = unlistenedIds
      .sort(() => Math.random() - 0.5)
      .slice(0, limit);

    // 5. 获取未听过专辑的详情
    let result = await this.prisma.album.findMany({
      where: { id: { in: pickedUnlistenedIds } },
    });

    // 6. 如果未听过的不足，从已听过的里面补充
    if (result.length < limit) {
      const needed = limit - result.length;
      const pickedListenedIds = matchedListenedIds
        .sort(() => Math.random() - 0.5)
        .slice(0, needed);
      
      const fallbackResult = await this.prisma.album.findMany({
        where: { id: { in: pickedListenedIds } },
      });
      result = [...result, ...fallbackResult];
    }

    // 7. 最后随机打乱一次
    result = result.sort(() => Math.random() - 0.5);

    if (type === 'AUDIOBOOK') {
      return await this.attachProgressToAlbums(result, userId);
    }

    return result;
  }

  // 搜索专辑
  async searchAlbums(keyword: string, type: any, limit: number = 10, userId: number): Promise<Album[]> {
    const where: any = {
      OR: [
        { name: { contains: keyword } },
        { artist: { contains: keyword } },
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
