import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SystemSettingsService } from '../settings/system-settings.service';

/**
 * Audit retention: moves old *operational* audit entries from AuditLog into
 * AuditLogArchive. It never runs on a schedule and never discards data:
 *
 *  - Off unless `audit.retention` is configured (missing / disabled → refused).
 *  - Security and governance entries are never archived (logins, users, roles,
 *    permissions, settings, approvals, master data, tokens, archive runs).
 *  - Each batch copies rows (INSERT … ON CONFLICT DO NOTHING) and deletes the
 *    originals in the same transaction, so a crash leaves every row in exactly
 *    one table and a re-run simply continues — the job is idempotent.
 *  - `preview` reports what would move without changing anything.
 *  - Each run writes its own AUDIT_ARCHIVED entry (itself protected).
 */
export const PROTECTED_ACTION_PATTERNS = [
  'LOGIN%',
  'LOGOUT%',
  'PASSWORD_%',
  'FORCE_PASSWORD%',
  'USER_%',
  'ROLE%',
  'PERMISSION%',
  'SETTING_%',
  'APPROVAL_%',
  'AUDIT_%',
  'TOKEN%',
  'REASON_CODE_%',
  'DEPARTMENT_%',
  'UOM_%',
  'NOTIFICATION_TEMPLATE_%',
  'REQUEST_APPROVED',
  'REQUEST_REJECTED',
  'ADJUSTMENT_%',
  'STOCK_RESERVATION_RELEASED',
];

const BATCH = 500;
const MAX_BATCHES_PER_RUN = 200; // ≤ 100k rows per call; run again to continue

@Injectable()
export class AuditRetentionService {
  constructor(
    private prisma: PrismaService,
    private settings: SystemSettingsService,
  ) {}

  private async cutoff(now = new Date()) {
    const days = await this.settings.auditRetentionDays();
    if (days === null)
      throw new BadRequestException(
        'Audit retention is not configured (setting audit.retention is missing or disabled) — nothing will be archived',
      );
    return { days, cutoff: new Date(now.getTime() - days * 86_400_000) };
  }

  private eligible(cutoff: Date) {
    return Prisma.sql`"createdAt" < ${cutoff} AND NOT ("action" LIKE ANY(${PROTECTED_ACTION_PATTERNS}::text[]))`;
  }

  async preview(now = new Date()) {
    const { days, cutoff } = await this.cutoff(now);
    const [row] = await this.prisma.$queryRaw<
      { n: bigint; oldest: Date | null; newest: Date | null }[]
    >`
      SELECT COUNT(*)::bigint AS n, MIN("createdAt") AS oldest, MAX("createdAt") AS newest FROM "AuditLog" WHERE ${this.eligible(cutoff)}`;
    const [kept] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM "AuditLog" WHERE "createdAt" < ${cutoff} AND "action" LIKE ANY(${PROTECTED_ACTION_PATTERNS}::text[])`;
    const [archived] = await this.prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT COUNT(*)::bigint AS n FROM "AuditLogArchive"`;
    return {
      retentionDays: days,
      cutoff,
      eligible: Number(row.n),
      oldestEligible: row.oldest,
      newestEligible: row.newest,
      protectedOlderThanCutoff: Number(kept.n),
      alreadyArchived: Number(archived.n),
      protectedPatterns: PROTECTED_ACTION_PATTERNS,
    };
  }

  async archive(
    userId: string,
    opts: { confirm?: boolean } = {},
    now = new Date(),
  ) {
    if (opts.confirm !== true)
      throw new BadRequestException(
        'Archiving moves audit entries out of the live log — call preview first, then send { "confirm": true }',
      );
    const { days, cutoff } = await this.cutoff(now);
    let moved = 0;
    let more = true;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const n = await this.prisma.$transaction(async (tx) => {
        const ids = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "AuditLog" WHERE ${this.eligible(cutoff)}
          ORDER BY "createdAt" ASC LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`;
        if (!ids.length) return 0;
        const list = ids.map((r) => r.id);
        await tx.$executeRaw`
          INSERT INTO "AuditLogArchive" ("id", "userId", "action", "entityType", "entityId", "detail", "correlationId", "ipAddress", "createdAt", "archivedById")
          SELECT "id", "userId", "action", "entityType", "entityId", "detail", "correlationId", "ipAddress", "createdAt", ${userId}
          FROM "AuditLog" WHERE "id" = ANY(${list}::text[])
          ON CONFLICT ("id") DO NOTHING`;
        // Only rows now present in the archive are removed from the live log.
        await tx.$executeRaw`
          DELETE FROM "AuditLog" a USING "AuditLogArchive" z
          WHERE a."id" = z."id" AND a."id" = ANY(${list}::text[])`;
        return list.length;
      });
      moved += n;
      if (n < BATCH) {
        more = false;
        break;
      }
    }
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'AUDIT_ARCHIVED',
        entityType: 'AuditLog',
        detail: `${moved} entries older than ${days} days (before ${cutoff.toISOString()}) moved to archive${more ? '; more remain — run again' : ''}`,
      },
    });
    return { retentionDays: days, cutoff, moved, moreRemaining: more };
  }
}
