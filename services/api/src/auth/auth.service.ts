// auth/auth.service.ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@soundx/db';
import { UserService } from 'src/services/user';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) { }

  // 验证用户：检查用户名和密码是否正确
  async validateUser(username: string, pass: string): Promise<User | null> {
    const user = await this.userService.getUser(username);
    // 简单示例：直接明文比较。生产环境中应使用 bcrypt 等散列验证&#8203;:contentReference[oaicite:3]{index=3}。
    if (user && user.password === pass) {
      return user; // 验证通过，返回用户信息（去除密码）
    }
    return null;
  }

  // 登录：接受用户信息，签发 JWT 令牌
  login(user: User) {
    const payload = { username: user.username, sub: user.id };
    const token = this.jwtService.sign(payload);
    return `${token}`;
  }

  verifyToken(token: string) {
    return this.jwtService.verify(token);
  }

  // 注册新用户
  async register(username: string, password: string): Promise<User> {
    return await this.userService.createUser({
      username,
      password,
      avatar: null,
      is_admin: false,
      createdAt: new Date(),
      expiresAt: null,
    });
  }

  // 根据用户名查找用户
  async findUserByUsername(username: string): Promise<User | null> {
    return await this.userService.getUser(username);
  }
}
