import { Injectable } from '@nestjs/common';
import { Artist, PrismaClient, TrackType } from '@soundx/db';

const EXCLUDE_ARTIST_FILTER = [
  { name: { not: { contains: '&' } } },
  { name: { not: { contains: '、' } } },
  { name: { not: { contains: ' and ' } } }
];

@Injectable()
export class ArtistService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async getArtistList(): Promise<Artist[]> {
    return await this.prisma.artist.findMany({ where: { status: 'ACTIVE' } });
  }

  async findByName(name: string, type?: any, allStatus = false): Promise<Artist | null> {
    // Don't search if name is null
    if (name === null || name === undefined) {
      return null;
    }
    const where: any = { name };
    if (!allStatus) {
      where.status = 'ACTIVE';
    }
    if (type) {
      where.type = type;
    }
    return await this.prisma.artist.findFirst({ where });
  }

  async getArtistById(id: number): Promise<Artist | null> {
    return await this.prisma.artist.findUnique({ where: { id, status: 'ACTIVE' } });
  }

  async getArtistTableList(
    pageSize: number,
    current: number,
  ): Promise<Artist[]> {
    return await this.prisma.artist.findMany({
      where: { status: 'ACTIVE' },
      skip: (current - 1) * pageSize, // 计算要跳过多少条
      take: pageSize,
    });
  }

  async loadMoreArtist(
    pageSize: number,
    loadCount: number,
    type?: any,
  ): Promise<Artist[]> {
    const where: any = { 
        status: 'ACTIVE',
        AND: EXCLUDE_ARTIST_FILTER
    };
    if (type) {
      where.type = type;
    }
    return await this.prisma.artist.findMany({
      skip: loadCount * pageSize,
      take: pageSize,
      where,
    });
  }

  async artistCount(type?: TrackType): Promise<number> {
    const where: any = { 
        status: 'ACTIVE', 
        AND: EXCLUDE_ARTIST_FILTER
    };
    if (type) {
      where.type = type;
    }
    return await this.prisma.artist.count({ where });
  }

  async createArtist(artist: Omit<Artist, 'id'>): Promise<Artist> {
    return await this.prisma.artist.create({
      data: artist,
    });
  }

  async updateArtist(id: number, artist: Partial<Artist>): Promise<Artist> {
    return await this.prisma.artist.update({
      where: { id },
      data: artist,
    });
  }

  async deleteArtist(id: number): Promise<boolean> {
    await this.prisma.artist.delete({
      where: { id },
    });
    return true;
  }

  // 批量新增
  async createArtists(artists: Omit<Artist, 'id'>[]): Promise<boolean> {
    const artistList = await this.prisma.artist.createMany({
      data: artists,
    });
    if (artistList.count !== artists.length) {
      throw new Error('批量新增失败');
    }
    return artistList.count === artists.length;
  }

  // 批量删除
  async deleteArtists(ids: number[]): Promise<boolean> {
    await this.prisma.artist.deleteMany({
      where: { id: { in: ids } },
    });
    return true;
  }

  // 搜索艺术家
  async searchArtists(
    keyword: string,
    type?: TrackType,
    limit: number = 10
  ): Promise<Artist[]> {
    const candidates = await this.prisma.artist.findMany({
      where: {
        AND: [
          type ? { type } : {},
          { status: 'ACTIVE' },
          ...EXCLUDE_ARTIST_FILTER,
          {
            OR: [
              { name: { contains: keyword } },
            ],
          },
        ],
      },
      take: 100,
    });

    const normalizedKeyword = keyword.toLowerCase();

    return candidates
      .sort((a, b) => {
        const nameA = a.name.toLowerCase();
        const nameB = b.name.toLowerCase();

        const getScore = (name: string) => {
          if (name === normalizedKeyword) return 100;
          if (name.startsWith(normalizedKeyword)) return 80;
          return 60;
        };

        const scoreA = getScore(nameA);
        const scoreB = getScore(nameB);

        if (scoreA !== scoreB) return scoreB - scoreA;
        return a.name.length - b.name.length;
      })
      .slice(0, limit);
  }

  // 获取最近的艺术家
  async getLatestArtists(limit: number = 8, type: TrackType): Promise<Artist[]> {
    return await this.prisma.artist.findMany({
      take: limit,
      where: {
        type,
        status: 'ACTIVE',
        AND: EXCLUDE_ARTIST_FILTER
      },
      orderBy: { id: 'desc' }, // Assuming higher ID means newer, or use createdAt if available
    });
  }

  // 获取随机艺术家
  async getRandomArtists(limit: number = 8, type: TrackType): Promise<Artist[]> {
    const where: any = {
        type, 
        status: 'ACTIVE',
        AND: EXCLUDE_ARTIST_FILTER
    };
    
    const count = await this.prisma.artist.count({ where });
    const skip = Math.max(0, Math.floor(Math.random() * (count - limit)));
    const artists = await this.prisma.artist.findMany({
      where,
      skip,
      take: limit,
    });
    return artists.sort(() => Math.random() - 0.5);
  }
}
