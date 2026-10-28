import { StockStatus } from '@prisma/client';

/**
 * Stock rows that no longer physically occupy a location, even though their
 * slotId / rackId still points at it (no write path clears those links).
 * Shared by the Control Center (/warehouse) and the Floor Plan
 * (/warehouse-layout) so both count a bin identically.
 */
export const NOT_IN_LOCATION: StockStatus[] = [
  StockStatus.SHIPPED, StockStatus.CLOSED, StockStatus.CANCELLED, StockStatus.CONSUMED,
];

/** Prisma `_count` filter: stock rows still in the location. */
export const IN_LOCATION_COUNT = { where: { status: { notIn: NOT_IN_LOCATION } } } as const;
