import { Injectable } from "@nestjs/common";
import { Album, PrismaClient, TrackType } from "@soundx/db";

@Injectable()
export class AudiobookCollectionService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async create(userId: number, data: { name?: string; cover?: string; albumId?: number }) {
    const { name, cover, albumId } = data;
    let album: Album | null = null;
    if (albumId) {
      album = await this.prisma.album.findUnique({ where: { id: albumId } });
      if (!album || album.type !== TrackType.AUDIOBOOK) {
        throw new Error("Album is not an audiobook");
      }
    }

    const finalName = name?.trim() || album?.name || "新合集";
    const finalCover = cover ?? album?.cover ?? null;

    return await this.prisma.$transaction(async (tx) => {
      const collection = await tx.audiobookCollection.create({
        data: {
          name: finalName,
          cover: finalCover,
          type: TrackType.AUDIOBOOK,
          userId,
        },
      });

      if (albumId) {
        await tx.audiobookCollectionAlbum.create({
          data: {
            collectionId: collection.id,
            albumId,
            order: 0,
          },
        });
      }

      return collection;
    });
  }

  async findAll(userId: number) {
    return await this.prisma.audiobookCollection.findMany({
      where: { userId, type: TrackType.AUDIOBOOK },
      include: {
        items: {
          take: 4,
          orderBy: { order: "asc" },
          include: { album: true },
        },
        _count: {
          select: { items: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async findOne(id: number, userId?: number) {
    return await this.prisma.audiobookCollection.findFirst({
      where: { id, ...(userId ? { userId } : {}) },
      include: {
        items: {
          orderBy: { order: "asc" },
          include: { album: true },
        },
      },
    });
  }

  async update(id: number, userId: number, data: { name?: string; cover?: string | null }) {
    return await this.prisma.audiobookCollection.update({
      where: { id, userId },
      data,
    });
  }

  async remove(id: number, userId: number) {
    return await this.prisma.audiobookCollection.delete({
      where: { id, userId },
    });
  }

  async addAlbum(collectionId: number, albumId: number, userId: number) {
    const album = await this.prisma.album.findUnique({ where: { id: albumId } });
    if (!album || album.type !== TrackType.AUDIOBOOK) {
      throw new Error("Album is not an audiobook");
    }

    const collection = await this.prisma.audiobookCollection.findFirst({
      where: { id: collectionId, userId },
    });
    if (!collection) throw new Error("Collection not found");

    const exists = await this.prisma.audiobookCollectionAlbum.findFirst({
      where: { collectionId, albumId },
    });
    if (exists) return exists;

    const last = await this.prisma.audiobookCollectionAlbum.findFirst({
      where: { collectionId },
      orderBy: { order: "desc" },
    });
    const nextOrder = (last?.order ?? -1) + 1;

    return await this.prisma.$transaction(async (tx) => {
      const item = await tx.audiobookCollectionAlbum.create({
        data: {
          collectionId,
          albumId,
          order: nextOrder,
        },
      });

      if ((!collection.cover || !collection.name) && album) {
        await tx.audiobookCollection.update({
          where: { id: collectionId },
          data: {
            cover: collection.cover ?? album.cover,
            name: collection.name || album.name,
          },
        });
      }

      return item;
    });
  }

  async removeAlbum(collectionId: number, albumId: number, userId: number) {
    const collection = await this.prisma.audiobookCollection.findFirst({
      where: { id: collectionId, userId },
    });
    if (!collection) throw new Error("Collection not found");

    const album = await this.prisma.album.findUnique({ where: { id: albumId } });

    await this.prisma.audiobookCollectionAlbum.deleteMany({
      where: { collectionId, albumId },
    });

    const remaining = await this.prisma.audiobookCollectionAlbum.findMany({
      where: { collectionId },
      orderBy: { order: "asc" },
      take: 1,
      include: { album: true },
    });

    if (remaining.length === 0) {
      await this.prisma.audiobookCollection.update({
        where: { id: collectionId },
        data: { cover: null },
      });
      return true;
    }

    const next = remaining[0].album;
    const updates: { cover?: string | null; name?: string } = {};
    if (album && collection.cover && album.cover && collection.cover === album.cover) {
      updates.cover = next.cover;
    }
    if (album && collection.name === album.name) {
      updates.name = next.name;
    }
    if (Object.keys(updates).length > 0) {
      await this.prisma.audiobookCollection.update({
        where: { id: collectionId },
        data: updates,
      });
    }
    return true;
  }

  async reorder(collectionId: number, userId: number, albumIds: number[]) {
    const collection = await this.prisma.audiobookCollection.findFirst({
      where: { id: collectionId, userId },
    });
    if (!collection) throw new Error("Collection not found");

    await this.prisma.$transaction(
      albumIds.map((albumId, index) =>
        this.prisma.audiobookCollectionAlbum.updateMany({
          where: { collectionId, albumId },
          data: { order: index },
        })
      )
    );

    return true;
  }

  async getMembership(userId: number, albumId: number) {
    const rows = await this.prisma.audiobookCollectionAlbum.findMany({
      where: {
        albumId,
        collection: { userId },
      },
      select: { collectionId: true },
    });
    return rows.map((row) => row.collectionId);
  }
}
