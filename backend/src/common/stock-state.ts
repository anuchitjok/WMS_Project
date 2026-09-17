import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, StockStatus } from '@prisma/client';

type Db = Prisma.TransactionClient;
const S = StockStatus;

/** Committed to an outbound task — only fulfillment may move these. */
export const OUTBOUND_STATUSES: StockStatus[] = [S.RESERVED, S.PICKING, S.PICKED, S.PACKED, S.READY_FOR_PICKUP];
/** Physically left the warehouse. */
export const ISSUED_STATUSES: StockStatus[] = [S.SHIPPED, S.ISSUED_TO_RMA];
/** Final — the unit is gone for good. */
export const FINAL_STATUSES: StockStatus[] = [S.CONSUMED, S.CLOSED, S.CANCELLED, S.RTV_SHIPPED];
/** Statuses an operator may set by hand (inventory status toggle). */
export const MANUAL_STATUSES: StockStatus[] = [S.AVAILABLE, S.QUARANTINE, S.DAMAGED, S.DOA];
/** Stock physically in the warehouse and not committed to an outbound task. */
export const ON_HAND_UNCOMMITTED: StockStatus[] = [S.AVAILABLE, S.QUARANTINE, S.DAMAGED, S.DOA, S.RTV_PENDING, S.RETURNED_UNUSED];

/**
 * Atomically moves a stock item to `to` only if it is currently in one of `from`.
 * Concurrent writers cannot both succeed: the second one matches zero rows and
 * gets a 409 describing the status it actually found.
 */
export async function transitionStock(
  db: Db,
  stockItemId: string,
  from: StockStatus[],
  to: StockStatus,
  extra: Prisma.StockItemUncheckedUpdateManyInput = {},
): Promise<void> {
  const res = await db.stockItem.updateMany({
    where: { id: stockItemId, status: { in: from } },
    data: { ...extra, status: to },
  });
  if (res.count === 1) return;
  const current = await db.stockItem.findUnique({ where: { id: stockItemId }, select: { status: true } });
  if (!current) throw new NotFoundException(`Stock item ${stockItemId} not found`);
  throw new ConflictException(
    `Stock item ${stockItemId} is ${current.status}; expected ${from.join(' or ')}`,
  );
}

/**
 * Quantity-aware split. When a row holds more than `qty`, the row keeps exactly
 * `qty` (and its id, receiving link and history) and the remainder moves to a new
 * row with `remainderStatus`. Rows carrying a serial number are never split — a
 * serial belongs to one physical unit. Returns the remainder row id, or null.
 */
export async function splitStockRow(
  db: Db,
  stockItemId: string,
  qty: number,
  remainderStatus: StockStatus,
): Promise<string | null> {
  const row = await db.stockItem.findUnique({ where: { id: stockItemId } });
  if (!row) throw new NotFoundException(`Stock item ${stockItemId} not found`);
  if (qty <= 0 || row.quantity <= qty || row.serialNumber) return null;

  const shrunk = await db.stockItem.updateMany({
    where: { id: stockItemId, quantity: row.quantity },
    data: { quantity: qty },
  });
  if (shrunk.count !== 1) throw new ConflictException(`Stock item ${stockItemId} changed concurrently`);

  const remainder = await db.stockItem.create({
    data: {
      productId: row.productId,
      batchNumber: row.batchNumber,
      quantity: row.quantity - qty,
      status: remainderStatus,
      ownershipType: row.ownershipType,
      warehouseId: row.warehouseId,
      rackId: row.rackId,
      slotId: row.slotId,
      receivedDate: row.receivedDate,
      expiryDate: row.expiryDate,
      notes: `Split from ${row.id}`,
      createdById: row.createdById,
    },
  });
  return remainder.id;
}

export interface LocationInput {
  warehouseId?: string | null;
  rackId?: string | null;
  slotId?: string | null;
}

/**
 * Validates a location triple against the Warehouse → Rack → Slot hierarchy and
 * returns only the keys the caller supplied (null clears a level). A slot must
 * belong to the given rack, a rack to the given warehouse, and none of them may
 * be deleted or inactive.
 */
export async function resolveLocation(db: Db, loc: LocationInput): Promise<LocationInput> {
  const out: LocationInput = {};
  if (loc.warehouseId !== undefined) out.warehouseId = loc.warehouseId;
  if (loc.rackId !== undefined) out.rackId = loc.rackId;
  if (loc.slotId !== undefined) out.slotId = loc.slotId;

  if (out.slotId) {
    const slot = await db.slot.findFirst({ where: { id: out.slotId, isDeleted: false, isActive: true } });
    if (!slot) throw new BadRequestException('Slot not found or inactive');
    if (out.rackId && out.rackId !== slot.rackId) throw new BadRequestException('Slot does not belong to the selected rack');
    out.rackId = slot.rackId;
  }
  if (out.rackId) {
    const rack = await db.rack.findFirst({ where: { id: out.rackId, isDeleted: false, isActive: true } });
    if (!rack) throw new BadRequestException('Rack not found or inactive');
    if (out.warehouseId && out.warehouseId !== rack.warehouseId) {
      throw new BadRequestException('Rack does not belong to the selected warehouse');
    }
    out.warehouseId = rack.warehouseId;
  }
  if (out.warehouseId) {
    const wh = await db.warehouse.findFirst({ where: { id: out.warehouseId, isDeleted: false, isActive: true } });
    if (!wh) throw new BadRequestException('Warehouse not found or inactive');
  }
  return out;
}
