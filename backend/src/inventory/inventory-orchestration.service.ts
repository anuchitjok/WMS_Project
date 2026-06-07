import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, StockStatus } from '@prisma/client';

// InventoryOrchestrationService — single source of truth for all stock movements.
// No other service may update StockItem.status or write inventory transactions directly.
@Injectable()
export class InventoryOrchestrationService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Reserve stock when a FulfillmentTask is allocated ─────────────────────
  // Changes StockItem.status from AVAILABLE → RESERVED.
  // Must be called inside a Prisma transaction.
  async reserveForTask(
    tx: Prisma.TransactionClient,
    items: Array<{ stockItemId: string; qty: number }>,
    taskRef: string,
    userId: string,
  ): Promise<void> {
    for (const { stockItemId } of items) {
      const stock = await tx.stockItem.findUnique({
        where: { id: stockItemId },
        select: { id: true, status: true, productId: true },
      });
      if (!stock) continue;
      if (!([StockStatus.AVAILABLE, StockStatus.RESERVED] as string[]).includes(stock.status)) {
        throw new ConflictException(
          `StockItem ${stockItemId} is not available for reservation (status: ${stock.status})`,
        );
      }
      await tx.stockItem.update({
        where: { id: stockItemId },
        data: { status: StockStatus.RESERVED },
      });
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
  }

  // ── Release reservation (on cancellation / exception) ─────────────────────
  // Reverts StockItem.status RESERVED → AVAILABLE.
  async releaseReservation(
    tx: Prisma.TransactionClient,
    items: Array<{ stockItemId: string }>,
    taskRef: string,
    userId: string,
  ): Promise<void> {
    for (const { stockItemId } of items) {
      const stock = await tx.stockItem.findUnique({
        where: { id: stockItemId },
        select: { status: true },
      });
      if (!stock) continue;
      // Only release if still in a pre-pick state
      if (([StockStatus.RESERVED, StockStatus.PICKING] as string[]).includes(stock.status)) {
        await tx.stockItem.update({
          where: { id: stockItemId },
          data: { status: StockStatus.AVAILABLE },
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: 'STOCK_RESERVATION_RELEASED',
            entityType: 'StockItem',
            entityId: stockItemId,
            detail: `Released from task ${taskRef}`,
          },
        });
      }
    }
  }

  // ── Record pick transaction ────────────────────────────────────────────────
  // Updates StockItem.status RESERVED → PICKED.
  // Called per item when picker confirms scan.
  async recordPickTransaction(
    tx: Prisma.TransactionClient,
    params: {
      stockItemId: string;
      qtyPicked: number;
      taskRef: string;
      userId: string;
      barcode?: string;
    },
  ): Promise<void> {
    await tx.stockItem.update({
      where: { id: params.stockItemId },
      data: { status: StockStatus.PICKED },
    });
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
        }),
      },
    });
  }

  // ── Goods Issue — deduct stock when shipment is dispatched ─────────────────
  // Updates StockItem.status PICKED → SHIPPED.
  // This is the SAP EWM equivalent of Goods Issue (GI) posting.
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
        select: { status: true },
      });
      if (!stock) continue;

      await tx.stockItem.update({
        where: { id: stockItemId },
        data: { status: StockStatus.SHIPPED },
      });

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
