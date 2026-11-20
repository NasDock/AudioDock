import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Device, User } from '@soundx/db';
import { IAuthFaildResponse, IErrorResponse, IForbiddenResponse, INotFoundResponse, IParamsErrorResponse, ISuccessResponse } from 'src/common/const';
import { Public } from '../common/public.decorator';
import { AuthService } from './auth.service';

import { UserService } from '../services/user';
import { AccessTokenService } from '../services/access-token.service';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly accessTokenService: AccessTokenService,
  ) { }

  @Public()
  @Post('/auth/login')
  async login(
    @Body() body: User & { deviceName?: string; deviceId?: string; platform?: string },
  ): Promise<ISuccessResponse<User & { token: string; device?: Device }> | IErrorResponse> {
    const userInfo = await this.authService.validateUser(
      body.username,
      body.password,
    );
    let device: Device | undefined;
    if (userInfo) {
      // 如果提供了设备名称，保存设备信息
      if (body.deviceName) {
        device = await this.userService.saveDevice(userInfo.id, body.deviceName, body.deviceId, body.platform);
      }

      // 生成token
      const token = this.authService.login(userInfo);
      return {
        code: 200,
        message: 'success',
        data: { ...userInfo, token, device },
      };
    } else {
      return {
        code: 500,
        message: '用户名或密码错误',
      };
    }
  }

  @Public()
  @Post('/auth/register')
  async register(
    @Body() user: { username: string; password: string; deviceName?: string; deviceId?: string; platform?: string },
  ): Promise<ISuccessResponse<User & { token: string; device?: Device }> | IErrorResponse | IParamsErrorResponse | IForbiddenResponse> {
    try {
      // Check if user already exists
      const existingUser = await this.authService.findUserByUsername(user.username);
      if (existingUser) {
        return {
          code: 400,
          message: '用户名已存在',
        };
      }

      // Check if registration is allowed
      const isAllowed = await this.userService.isRegistrationAllowed();
      // First user is always allowed (will be admin)
      const userCount = await this.userService.userCount();
      if (!isAllowed && userCount > 0) {
        return {
          code: 403,
          message: '注册功能已关闭',
        };
      }

      // Create new user
      const newUser = await this.authService.register(user.username, user.password);

      let device: Device | undefined;
      if (user.deviceName) {
        device = await this.userService.saveDevice(newUser.id, user.deviceName, user.deviceId, user.platform);
      }

      // Generate token
      const token = this.authService.login(newUser);

      return {
        code: 200,
        message: 'success',
        data: { ...newUser, token, device },
      };
    } catch (error) {
      return {
        code: 500,
        message: error.message || '注册失败',
      };
    }
  }

  /**
   * 连通性 + 凭证有效性探针。
   * - 未带任何凭证：纯连通性探测（登录页验证服务器地址可达），直接放行；
   * - 带了凭证：顺带校验有效性，失效返回 code 401
   *   （desktop Header / mobile tab 页据此自动登出）。
   */
  @Public()
  @Get('/auth/check')
  async check(@Req() req: Request): Promise<ISuccessResponse<boolean> | IAuthFaildResponse> {
    const authHeader = req.headers.authorization;
    const accessToken = req.headers['x-access-token'];

    if (!authHeader && !accessToken) {
      return {
        code: 200,
        message: 'success',
        data: true,
      };
    }

    if (typeof accessToken === 'string' && accessToken) {
      const user = await this.accessTokenService.resolve(accessToken);
      if (user) {
        return { code: 200, message: 'success', data: true };
      }
      return { code: 401, message: '访问令牌无效或已停用' };
    }

    const token = (authHeader as string).replace(/^Bearer\s+/i, '');
    try {
      this.authService.verifyToken(token);
      return {
        code: 200,
        message: 'success',
        data: true,
      };
    } catch {
      return { code: 401, message: '登录已过期，请重新登录' };
    }
  }

  @Get('/auth/me')
  async me(@Req() req: Request): Promise<ISuccessResponse<User> | IAuthFaildResponse | INotFoundResponse | IErrorResponse> {
    try {
      const userId = Number((req.user as any)?.userId);
      if (!userId) {
        return {
          code: 401,
          message: '未登录',
        };
      }

      const user = await this.userService.getUserById(userId);
      if (!user) {
        return {
          code: 404,
          message: '用户不存在',
        };
      }

      return {
        code: 200,
        message: 'success',
        data: user,
      };
    } catch (error) {
      return {
        code: 500,
        message: error.message || '获取当前用户失败',
      };
    }
  }

  @Public()
  @Post('/auth/verify-device')
  async verifyDevice(
    @Body() body: { username: string; deviceName: string },
  ): Promise<ISuccessResponse<boolean> | IErrorResponse> {
    const user = await this.userService.getUser(body.username);
    if (!user) {
      return {
        code: 500,
        message: '用户不存在',
      };
    }

    const device = await this.userService.getDevice(user.id, body.deviceName);
    if (!device) {
      return {
        code: 500,
        message: '设备验证失败，请在常用设备上操作',
      };
    }

    return {
      code: 200,
      message: 'success',
      data: true,
    };
  }

  @Public()
  @Post('/auth/reset-password')
  async resetPassword(
    @Body() body: { username: string; deviceName: string; newPassword: string },
  ): Promise<ISuccessResponse<User & { token: string; device?: Device }> | IErrorResponse> {
    const user = await this.userService.getUser(body.username);
    if (!user) {
      return {
        code: 500,
        message: '用户不存在',
      };
    }

    const device = await this.userService.getDevice(user.id, body.deviceName);
    if (!device) {
      return {
        code: 500,
        message: '设备验证失败，无法重置密码',
      };
    }

    const updatedUser = await this.userService.updateUser(user.id, { password: body.newPassword });
    const token = this.authService.login(updatedUser);

    return {
      code: 200,
      message: 'success',
      data: { ...updatedUser, token, device },
    };
  }
}
