import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, StockStatus } from '@prisma/client';
import { splitStockRow, transitionStock } from '../common/stock-state';

export interface LockedRow { id: string; quantity: number }

// InventoryOrchestrationService — single source of truth for all stock movements.
// No other service may update StockItem.status or write inventory transactions directly.
@Injectable()
export class InventoryOrchestrationService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Locked selection ───────────────────────────────────────────────────────
  // Every row returned is locked FOR UPDATE until the transaction ends; SKIP LOCKED
  // lets concurrent allocations take *different* rows instead of the same one.

  /** Oldest AVAILABLE row with quantity for a product (FIFO), locked. */
  async lockAvailableRow(
    tx: Prisma.TransactionClient,
    productId: string,
    warehouseId: string | null,
    excludeIds: string[],
  ): Promise<LockedRow | null> {
    const exclude = excludeIds.length ? excludeIds : [''];
    const rows = await tx.$queryRaw<LockedRow[]>`
      SELECT s."id", s."quantity" FROM "StockItem" s
      WHERE s."productId" = ${productId} AND s."status" = 'AVAILABLE' AND s."quantity" > 0
        AND (${warehouseId}::text IS NULL OR s."warehouseId" = ${warehouseId})
        AND s."id" <> ALL(${exclude}::text[])
      ORDER BY s."receivedDate" ASC
      LIMIT 1
      FOR UPDATE OF s SKIP LOCKED
    `;
    return rows[0] ?? null;
  }

  /**
   * Units reserved at (legacy) approval time that no active fulfillment task has
   * claimed yet, locked. Approval only links the first reserved unit to the request
   * line, so reserved units are treated as a per-product pool — but a unit linked
   * to a *different* approved request is never taken, and `preferId` (this line's
   * own linked unit) comes first.
   */
  async lockApprovalPool(
    tx: Prisma.TransactionClient,
    params: { productId: string; requestId: string; preferId: string | null; warehouseId: string | null; limit: number },
  ): Promise<LockedRow[]> {
    if (params.limit <= 0) return [];
    return tx.$queryRaw<LockedRow[]>`
      SELECT s."id", s."quantity" FROM "StockItem" s
      WHERE s."productId" = ${params.productId} AND s."status" = 'RESERVED'
        AND (${params.warehouseId}::text IS NULL OR s."warehouseId" = ${params.warehouseId})
        AND NOT EXISTS (
          SELECT 1 FROM "FulfillmentTaskItem" fti JOIN "FulfillmentTask" ft ON ft."id" = fti."taskId"
          WHERE fti."stockItemId" = s."id"
            AND ft."status" NOT IN ('CANCELLED', 'RETURNED', 'SHIPPED', 'DELIVERED', 'CLOSED'))
        AND NOT EXISTS (
          SELECT 1 FROM "WithdrawalRequestItem" wri JOIN "WithdrawalRequest" wr ON wr."id" = wri."requestId"
          WHERE wri."stockItemId" = s."id" AND wr."id" <> ${params.requestId} AND wr."status" = 'APPROVED')
      ORDER BY CASE WHEN s."id" = ${params.preferId} THEN 0 ELSE 1 END, s."receivedDate" ASC
      LIMIT ${params.limit}
      FOR UPDATE OF s SKIP LOCKED
    `;
  }

  // ── Reserve stock when a FulfillmentTask is allocated ─────────────────────
  // AVAILABLE → RESERVED. Must be called inside a Prisma transaction.
  async reserveRow(
    tx: Prisma.TransactionClient,
    stockItemId: string,
    taskRef: string,
    userId: string,
  ): Promise<void> {
    await transitionStock(tx, stockItemId, [StockStatus.AVAILABLE], StockStatus.RESERVED);
    await tx.auditLog.create({
      data: {
        userId,
        action: 'STOCK_RESERVED',
        entityType: 'StockItem',
        entityId: stockItemId,
        detail: `Reserved for task ${taskRef}`,
      },
    });
  }

  // ── Release reservation (on cancellation / exception) ─────────────────────
  // RESERVED / PICKING / PICKED → AVAILABLE. Units already issued are left alone.
  async releaseReservation(
    tx: Prisma.TransactionClient,
    items: Array<{ stockItemId: string }>,
    taskRef: string,
    userId: string,
  ): Promise<void> {
    for (const { stockItemId } of items) {
      const res = await tx.stockItem.updateMany({
        where: {
          id: stockItemId,
          status: { in: [StockStatus.RESERVED, StockStatus.PICKING, StockStatus.PICKED] },
        },
        data: { status: StockStatus.AVAILABLE },
      });
      if (res.count === 0) continue;
      await tx.auditLog.create({
        data: {
          userId,
          action: 'STOCK_RESERVATION_RELEASED',
          entityType: 'StockItem',
          entityId: stockItemId,
          detail: `Released from ${taskRef}`,
        },
      });
    }
  }

  // ── Record pick transaction ────────────────────────────────────────────────
  // RESERVED (or PICKING) → PICKED. Called per item when the picker confirms.
  async recordPickTransaction(
    tx: Prisma.TransactionClient,
    params: {
      stockItemId: string;
      qtyPicked: number;
      taskRef: string;
      userId: string;
      barcode?: string;
      note?: string;
    },
  ): Promise<void> {
    await transitionStock(
      tx,
      params.stockItemId,
      [StockStatus.RESERVED, StockStatus.PICKING],
      StockStatus.PICKED,
    );
    await tx.auditLog.create({
      data: {
        userId: params.userId,
        action: 'STOCK_PICKED',
        entityType: 'StockItem',
        entityId: params.stockItemId,
        detail: JSON.stringify({
          taskRef: params.taskRef,
          qtyPicked: params.qtyPicked,
          barcode: params.barcode ?? null,
          ...(params.note ? { note: params.note } : {}),
        }),
      },
    });
  }

  // ── Goods Issue — deduct stock when shipment is dispatched ─────────────────
  // PICKED → SHIPPED (RESERVED accepted for tasks picked before pick tracking).
  // Quantity-aware: when a bulk row holds more than was issued, the remainder is
  // split off and returned to AVAILABLE instead of being shipped with it.
  // MUST be called inside a transaction. This is the only place stock leaves inventory.
  async issueStockForShipment(
    tx: Prisma.TransactionClient,
    params: {
      taskId: string;
      shipmentRef: string;
      requestId: string;
      issuedByUserId: string;
      items: Array<{ stockItemId: string; qtyIssued: number }>;
    },
  ): Promise<void> {
    for (const { stockItemId, qtyIssued } of params.items) {
      const stock = await tx.stockItem.findUnique({
        where: { id: stockItemId },
        select: { status: true, quantity: true },
      });
      if (!stock) continue;

      const remainderId = await splitStockRow(tx, stockItemId, qtyIssued, StockStatus.AVAILABLE);
      await transitionStock(tx, stockItemId, [StockStatus.PICKED, StockStatus.RESERVED], StockStatus.SHIPPED);

      // Goods Issue audit record — immutable ledger entry
      await tx.auditLog.create({
        data: {
          userId: params.issuedByUserId,
          action: 'GOODS_ISSUED',
          entityType: 'StockItem',
          entityId: stockItemId,
          detail: JSON.stringify({
            shipmentRef: params.shipmentRef,
            taskId: params.taskId,
            requestId: params.requestId,
            qtyIssued,
            previousStatus: stock.status,
            ...(remainderId ? { remainderStockItemId: remainderId, remainderQty: stock.quantity - qtyIssued } : {}),
          }),
        },
      });
    }

    // Shipment-level goods issue audit
    await tx.auditLog.create({
      data: {
        userId: params.issuedByUserId,
        action: 'SHIPMENT_GOODS_ISSUED',
        entityType: 'Shipment',
        entityId: params.shipmentRef,
        detail: JSON.stringify({
          taskId: params.taskId,
          itemCount: params.items.length,
          requestId: params.requestId,
        }),
      },
    });
  }
}
