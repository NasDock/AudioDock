import {
  Injectable,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/public.decorator';
import { AccessTokenService } from '../services/access-token.service';

/**
 * 访问令牌禁止访问的账号/用户相关接口前缀。
 * 令牌用于远程调用（如修改元数据），不允许操作用户、登录态与令牌自身。
 * 注意按「精确或带斜杠前缀」匹配，不会误伤 /user-track-likes 等个人数据接口。
 */
const ACCESS_TOKEN_BLOCKED_PREFIXES = [
  '/user',
  '/auth',
  '/admin',
  '/access-tokens',
  '/scan-login',
];

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    private readonly accessTokenService: AccessTokenService,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const accessToken = req.headers['x-access-token'];
    if (typeof accessToken === 'string' && accessToken) {
      return this.canActivateWithAccessToken(req, accessToken);
    }
    return super.canActivate(context);
  }

  /**
   * X-Access-Token 鉴权：令牌有效 → 校验接口白名单 → 以归属用户身份放行。
   */
  private async canActivateWithAccessToken(
    req: Request,
    token: string,
  ): Promise<boolean> {
    const user = await this.accessTokenService.resolve(token);
    if (!user) {
      throw new UnauthorizedException('访问令牌无效或已停用');
    }

    const path = req.path || '';
    const blocked = ACCESS_TOKEN_BLOCKED_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
    if (blocked) {
      throw new ForbiddenException('访问令牌无权访问用户相关接口');
    }

    (req as any).user = {
      userId: user.id,
      username: user.username,
      viaAccessToken: true,
    };
    return true;
  }
}
