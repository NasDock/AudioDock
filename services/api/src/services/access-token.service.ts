import { Injectable } from '@nestjs/common';
import { AccessToken, PrismaClient, User } from '@soundx/db';
import { createHash, randomBytes } from 'crypto';

/** 列表/详情返回时剥离 tokenHash 的安全视图 */
export type SafeAccessToken = Omit<AccessToken, 'tokenHash'>;

@Injectable()
export class AccessTokenService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  /** 生成明文令牌：adk_ 前缀 + 24 字节随机 hex */
  private generatePlainToken(): string {
    return `adk_${randomBytes(24).toString('hex')}`;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toSafe(record: AccessToken): SafeAccessToken {
    const safe: Partial<AccessToken> = { ...record };
    delete safe.tokenHash;
    return safe as SafeAccessToken;
  }

  /**
   * 创建令牌。完整明文只在这一次返回，库里只存 SHA-256 哈希，
   * 之后无法再查看完整令牌（只能重新创建）。
   */
  async create(
    userId: number,
    name: string,
  ): Promise<{ record: SafeAccessToken; token: string }> {
    const token = this.generatePlainToken();
    const record = await this.prisma.accessToken.create({
      data: {
        userId,
        name,
        tokenHash: this.hashToken(token),
        tokenPrefix: token.slice(0, 10),
      },
    });
    return { record: this.toSafe(record), token };
  }

  async listByUser(userId: number): Promise<SafeAccessToken[]> {
    const list = await this.prisma.accessToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return list.map((item) => this.toSafe(item));
  }

  /** 仅允许操作自己的令牌；返回 null 表示不存在或不属于该用户 */
  async update(
    userId: number,
    id: number,
    data: { name?: string; enabled?: boolean },
  ): Promise<SafeAccessToken | null> {
    const existing = await this.prisma.accessToken.findFirst({
      where: { id, userId },
    });
    if (!existing) return null;
    const updated = await this.prisma.accessToken.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      },
    });
    return this.toSafe(updated);
  }

  async remove(userId: number, id: number): Promise<boolean> {
    const existing = await this.prisma.accessToken.findFirst({
      where: { id, userId },
    });
    if (!existing) return false;
    await this.prisma.accessToken.delete({ where: { id } });
    return true;
  }

  /**
   * 校验访问令牌。命中且启用时返回归属用户，并异步刷新 lastUsedAt
   * （不阻塞请求）；否则返回 null。
   */
  async resolve(token: string): Promise<User | null> {
    const record = await this.prisma.accessToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: true },
    });
    if (!record || !record.enabled) return null;
    this.prisma.accessToken
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return record.user;
  }
}
