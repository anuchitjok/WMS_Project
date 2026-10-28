import { ConflictException } from '@nestjs/common';
import { Prisma, StockStatus } from '@prisma/client';

/**
 * Serial-number uniqueness for active stock (requirement 7.1; setting
 * `serial.duplicate` is locked to "strict").
 *
 * Stock that has left for good may share a serial with a new unit (e.g. a
 * repaired unit coming back), so only these statuses free a serial.
 */
export const SERIAL_RELEASED_STATUSES: StockStatus[] = [
  StockStatus.CONSUMED,
  StockStatus.SHIPPED,
  StockStatus.CLOSED,
  StockStatus.CANCELLED,
];

const isRealSerial = (s: string | null | undefined): s is string =>
  !!s && s.trim() !== '' && s.trim().toUpperCase() !== 'N/A';

/**
 * Must run inside the transaction that writes the serials. Takes a
 * transaction-scoped advisory lock per serial (sorted, so two writers never
 * deadlock), then checks active stock. A concurrent writer of the same serial
 * waits for the first transaction to commit and then sees its row — the
 * check-then-insert race is closed without a partial unique index.
 */
export async function assertSerialsFree(
  tx: Prisma.TransactionClient,
  serials: Array<string | null | undefined>,
  excludeStockIds: string[] = [],
): Promise<void> {
  const list = [
    ...new Set(serials.filter(isRealSerial).map((s) => s.trim())),
  ].sort();
  if (!list.length) return;
  const dupInBatch = serials
    .filter(isRealSerial)
    .map((s) => s.trim())
    .find((s, i, all) => all.indexOf(s) !== i);
  if (dupInBatch)
    throw new ConflictException(
      `Duplicate serial number in request: ${dupInBatch}`,
    );
  for (const s of list) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'serial:' + s}))`;
  }
  const existing = await tx.stockItem.findFirst({
    where: {
      serialNumber: { in: list },
      status: { notIn: SERIAL_RELEASED_STATUSES },
      ...(excludeStockIds.length ? { id: { notIn: excludeStockIds } } : {}),
    },
    select: { serialNumber: true },
  });
  if (existing)
    throw new ConflictException(
      `Serial number already exists in active stock: ${existing.serialNumber}`,
    );
}
