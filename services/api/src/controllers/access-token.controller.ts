import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import {
  IAuthFaildResponse,
  IErrorResponse,
  INotFoundResponse,
  IParamsErrorResponse,
  ISuccessResponse,
} from '../common/const';
import {
  AccessTokenService,
  SafeAccessToken,
} from '../services/access-token.service';

/**
 * API 访问令牌管理（增删改查）。
 * 令牌用于第三方/远程脚本调用接口（如修改元数据）：
 * 请求携带 `X-Access-Token: <token>` 即可访问除用户/账号相关接口外的所有接口。
 * 本组接口本身必须用登录 JWT 访问，访问令牌不能管理令牌。
 */
@Controller('access-tokens')
export class AccessTokenController {
  constructor(private readonly accessTokenService: AccessTokenService) {}

  @Get()
  async list(
    @Req() req: Request,
  ): Promise<ISuccessResponse<SafeAccessToken[]> | IAuthFaildResponse> {
    const userId = Number((req.user as any)?.userId);
    if (!userId) {
      return { code: 401, message: '未登录' };
    }
    const data = await this.accessTokenService.listByUser(userId);
    return { code: 200, message: 'success', data };
  }

  @Post()
  async create(
    @Req() req: Request,
    @Body() body: { name?: string },
  ): Promise<
    | ISuccessResponse<SafeAccessToken & { token: string }>
    | IAuthFaildResponse
    | IParamsErrorResponse
    | IErrorResponse
  > {
    try {
      const userId = Number((req.user as any)?.userId);
      if (!userId) {
        return { code: 401, message: '未登录' };
      }
      const name = body.name?.trim();
      if (!name) {
        return { code: 400, message: '令牌名称不能为空' };
      }
      const { record, token } = await this.accessTokenService.create(
        userId,
        name,
      );
      // 完整令牌仅此一次返回，请立即保存
      return { code: 200, message: 'success', data: { ...record, token } };
    } catch (error) {
      return { code: 500, message: (error as Error).message };
    }
  }

  @Put('/:id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { name?: string; enabled?: boolean },
  ): Promise<
    | ISuccessResponse<SafeAccessToken>
    | IAuthFaildResponse
    | INotFoundResponse
    | IErrorResponse
  > {
    try {
      const userId = Number((req.user as any)?.userId);
      if (!userId) {
        return { code: 401, message: '未登录' };
      }
      const updated = await this.accessTokenService.update(
        userId,
        parseInt(id),
        body,
      );
      if (!updated) {
        return { code: 404, message: '令牌不存在' };
      }
      return { code: 200, message: 'success', data: updated };
    } catch (error) {
      return { code: 500, message: (error as Error).message };
    }
  }

  @Delete('/:id')
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<
    | ISuccessResponse<boolean>
    | IAuthFaildResponse
    | INotFoundResponse
    | IErrorResponse
  > {
    try {
      const userId = Number((req.user as any)?.userId);
      if (!userId) {
        return { code: 401, message: '未登录' };
      }
      const ok = await this.accessTokenService.remove(userId, parseInt(id));
      if (!ok) {
        return { code: 404, message: '令牌不存在' };
      }
      return { code: 200, message: 'success', data: true };
    } catch (error) {
      return { code: 500, message: (error as Error).message };
    }
  }
}
