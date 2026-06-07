import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';

/**
 * DB-backed JWT blocklist for token revocation (logout, password change, suspicious activity).
 * Expired tokens are cleaned up every hour.
 */
@Injectable()
export class TokenBlocklistService {
  constructor(private prisma: PrismaService) {}

  async revoke(jti: string, userId: string, expiresAt: Date) {
    await this.prisma.tokenBlocklist.upsert({
      where: { jti },
      update: {},
      create: { jti, userId, expiresAt },
    });
  }

  async isRevoked(jti: string): Promise<boolean> {
    const entry = await this.prisma.tokenBlocklist.findUnique({ where: { jti }, select: { id: true, expiresAt: true } });
    if (!entry) return false;
    if (entry.expiresAt < new Date()) {
      // Already expired — clean up and return false (expired tokens are harmless)
      await this.prisma.tokenBlocklist.delete({ where: { jti } }).catch(() => {});
      return false;
    }
    return true;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanup() {
    const deleted = await this.prisma.tokenBlocklist.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if (deleted.count > 0) console.log(`[TokenBlocklist] Cleaned ${deleted.count} expired entries`);
  }
}
