import { ConflictException } from '@nestjs/common';
import { Prisma, StockStatus } from '@prisma/client';

/**
 * Cycle-count stock lock (count-line level).
 *
 * While a count session is OPEN, IN_PROGRESS or REVIEW, every stock row it
 * counts (non-excluded lines) is locked: reservation/allocation skip it and
 * movements (status change, relocation, transfer, adjustment, scrap) refuse
 * it with 409. The lock needs no extra column — it is derived from the session
 * status, so approving or cancelling the session releases it atomically, and a
 * failed approval leaves it in place until the count is finished or cancelled.
 *
 * Movements that slipped in just before the lock (or bypass it) are caught at
 * approval: every counted row is re-checked, and changed rows are reported as
 * conflicts for recount instead of being skipped silently.
 */
export const ACTIVE_COUNT_STATUSES = ['OPEN', 'IN_PROGRESS', 'REVIEW'] as const;

type Db =
  | Prisma.TransactionClient
  | { $queryRaw: Prisma.TransactionClient['$queryRaw'] };

/** SQL predicate for a StockItem aliased `s`: true when the row is not held by an active count. */
export const NOT_COUNT_LOCKED = Prisma.sql`NOT EXISTS (
  SELECT 1 FROM "CycleCountLine" ccl JOIN "CycleCountSession" ccs ON ccs."id" = ccl."sessionId"
  WHERE ccl."stockItemId" = s."id" AND ccl."excludedAt" IS NULL
    AND ccs."status"::text IN ('OPEN', 'IN_PROGRESS', 'REVIEW'))`;

/** Active count holding each of these stock rows (stockItemId → session ref). */
export async function countLocks(
  db: Db,
  stockItemIds: string[],
): Promise<Map<string, string>> {
  const ids = stockItemIds.filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await db.$queryRaw<{ stockItemId: string; refNumber: string }[]>`
    SELECT ccl."stockItemId", ccs."refNumber" FROM "CycleCountLine" ccl
    JOIN "CycleCountSession" ccs ON ccs."id" = ccl."sessionId"
    WHERE ccl."stockItemId" = ANY(${ids}::text[]) AND ccl."excludedAt" IS NULL
      AND ccs."status"::text IN ('OPEN', 'IN_PROGRESS', 'REVIEW')`;
  return new Map(rows.map((r) => [r.stockItemId, r.refNumber]));
}

export async function assertNotCountLocked(
  db: Db,
  stockItemIds: string[],
): Promise<void> {
  const locks = await countLocks(db, stockItemIds);
  if (locks.size) {
    const [id, ref] = [...locks.entries()][0];
    throw new ConflictException(
      `Stock item ${id} is being counted in ${ref} — finish (approve) or cancel the count first`,
    );
  }
}

/** Only AVAILABLE rows are ever counted, so only moves out of AVAILABLE need the check. */
export function leavesAvailable(from: StockStatus[]): boolean {
  return from.includes(StockStatus.AVAILABLE);
}
