import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { Request } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { createCoverUploadOptions, toCoverUrl } from "../common/cover-upload";
import { AudiobookCollectionService } from "../services/audiobook-collection";

@Controller("collections")
export class AudiobookCollectionController {
  constructor(private readonly collectionService: AudiobookCollectionService) {}

  private resolveUserId(req: Request, fallback?: string) {
    const userId = (req.user as any)?.userId ?? (req.user as any)?.id ?? fallback;
    return userId ? Number(userId) : undefined;
  }

  @Post()
  async create(@Req() req: Request, @Body() body: any) {
    try {
      const userId = this.resolveUserId(req, body?.userId);
      if (!userId) return { code: 500, message: "Missing userId" };
      const data = await this.collectionService.create(userId, {
        name: body?.name,
        cover: body?.cover,
        albumId: body?.albumId ? Number(body.albumId) : undefined,
      });
      return { code: 200, message: "success", data };
    } catch (error) {
      return { code: 500, message: error };
    }
  }

  @Get()
  async findAll(@Req() req: Request) {
    try {
      const userId = this.resolveUserId(req, (req.query?.userId as string) || undefined);
      if (!userId) return { code: 500, message: "Missing userId" };
      const data = await this.collectionService.findAll(userId);
      return { code: 200, message: "success", data };
    } catch (error) {
      return { code: 500, message: error };
    }
  }

  @Get("membership")
  async membership(@Req() req: Request, @Query("albumId") albumId?: string) {
    try {
      const userId = this.resolveUserId(req, (req.query?.userId as string) || undefined);
      if (!userId) return { code: 500, message: "Missing userId" };
      if (!albumId) return { code: 500, message: "Missing albumId" };
      const data = await this.collectionService.getMembership(userId, Number(albumId));
      return { code: 200, message: "success", data };
    } catch (error) {
      return { code: 500, message: error };
    }
  }

  @Get(":id")
  async findOne(@Req() req: Request, @Param("id") id: string) {
    try {
      const userId = this.resolveUserId(req);
      const data = await this.collectionService.findOne(+id, userId);
      return { code: 200, message: "success", data };
    } catch (error) {
      return { code: 500, message: error };
    }
  }

  @Put(":id")
  async update(@Req() req: Request, @Param("id") id: string, @Body() body: any) {
    try {
      const userId = this.resolveUserId(req, body?.userId);
      if (!userId) return { code: 500, message: "Missing userId" };
      const data = await this.collectionService.update(+id, userId, {
        name: body?.name,
        cover: body?.cover,
      });
      return { code: 200, message: "success", data };
    } catch (error) {
      return { code: 500, message: error };
    }
  }

  @Post(":id/cover")
  @UseInterceptors(FileInterceptor("file", createCoverUploadOptions("collection")))
  async uploadCover(
    @Req() req: Request,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    try {
      const userId = this.resolveUserId(req);
      if (!userId) return { code: 500, message: "Missing userId" };
      if (!file) return { code: 400, message: "No file uploaded" };
      const coverUrl = toCoverUrl(file.filename);
      const data = await this.collectionService.update(+id, userId, {
        cover: coverUrl,
      });
      return { code: 200, message: "success", data };
    } catch (error) {
      return { code: 500, message: error };
    }
  }

  @Delete(":id")
  async remove(@Req() req: Request, @Param("id") id: string) {
    try {
      const userId = this.resolveUserId(req, (req.query?.userId as string) || undefined);
      if (!userId) return { code: 500, message: "Missing userId" };
      const data = await this.collectionService.remove(+id, userId);
      return { code: 200, message: "success", data };
    } catch (error) {
      return { code: 500, message: error };
    }
  }

  @Post(":id/albums")
  async addAlbum(@Req() req: Request, @Param("id") id: string, @Body("albumId") albumId: number) {
    try {
      const userId = this.resolveUserId(req, (req.body?.userId as string) || undefined);
      if (!userId) return { code: 500, message: "Missing userId" };
      const data = await this.collectionService.addAlbum(+id, Number(albumId), userId);
      return { code: 200, message: "success", data };
    } catch (error) {
      return { code: 500, message: error };
    }
  }

  @Delete(":id/albums/:albumId")
  async removeAlbum(@Req() req: Request, @Param("id") id: string, @Param("albumId") albumId: string) {
    try {
      const userId = this.resolveUserId(req, (req.query?.userId as string) || undefined);
      if (!userId) return { code: 500, message: "Missing userId" };
      const data = await this.collectionService.removeAlbum(+id, +albumId, userId);
      return { code: 200, message: "success", data };
    } catch (error) {
      return { code: 500, message: error };
    }
  }

  @Put(":id/order")
  async reorder(@Req() req: Request, @Param("id") id: string, @Body("albumIds") albumIds: number[]) {
    try {
      const userId = this.resolveUserId(req, (req.body?.userId as string) || undefined);
      if (!userId) return { code: 500, message: "Missing userId" };
      const data = await this.collectionService.reorder(+id, userId, (albumIds || []).map(Number));
      return { code: 200, message: "success", data };
    } catch (error) {
      return { code: 500, message: error };
    }
  }
}
