import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { InventoryOrchestrationService, LockedRow } from '../../inventory/inventory-orchestration.service';
import { FulfillmentStatus, StockStatus } from '@prisma/client';
import { nanoid } from 'nanoid';
import { isUnifiedReservationEnabled } from '../../common/feature-flags';
import { splitStockRow } from '../../common/stock-state';

@Injectable()
export class AllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly inventory: InventoryOrchestrationService,
  ) {}

  // FIFO allocation: creates FulfillmentTask from an approved WithdrawalRequest.
  // Reserves stock atomically. Prevents duplicate tasks per request.
  async allocate(requestId: string, userId: string) {
    const taskRef = `FT-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
    const unified = isUnifiedReservationEnabled();

    const task = await this.prisma.$transaction(async (tx) => {
      // Serialize allocations of the same request: the second caller waits here,
      // then sees the first caller's task and is rejected below.
      await tx.$queryRaw`SELECT "id" FROM "WithdrawalRequest" WHERE "id" = ${requestId} FOR UPDATE`;

      const req = await tx.withdrawalRequest.findUnique({
        where: { id: requestId },
        include: { items: true },
      });
      if (!req) throw new NotFoundException('Request not found');
      if (!['APPROVED', 'PICKING'].includes(req.status)) {
        throw new BadRequestException(
          `Request must be APPROVED to allocate (current: ${req.status})`,
        );
      }

      // Prevent duplicate task. Only a CANCELLED task frees the request again — a
      // RETURNED task already issued its goods, so re-allocating would issue twice.
      const existing = await tx.fulfillmentTask.findFirst({
        where: { requestId, status: { not: FulfillmentStatus.CANCELLED } },
      });
      if (existing) {
        throw new ConflictException(
          `FulfillmentTask already exists for this request: ${existing.refNumber}`,
        );
      }

      // Determine warehouse from the first line's approval-time unit (legacy behaviour).
      const firstItem = req.items[0];
      let warehouseId: string | undefined;
      if (firstItem?.stockItemId) {
        const si = await tx.stockItem.findUnique({
          where: { id: firstItem.stockItemId },
          select: { warehouseId: true },
        });
        warehouseId = si?.warehouseId ?? undefined;
      }

      const t = await tx.fulfillmentTask.create({
        data: {
          refNumber: taskRef,
          requestId,
          requestRef: req.refNumber,
          status: FulfillmentStatus.ALLOCATED,
          allocatedById: userId,
          warehouseId,
        },
      });

      for (const item of req.items) {
        const need = item.quantityApproved ?? item.quantityRequested;

        // Legacy approval reserved ceil(need) rows for this line (linking the first).
        // Those rows are consumed here — never a unit reserved for another request.
        const owned =
          !unified && req.status === 'APPROVED' && item.stockItemId ? Math.ceil(item.quantityRequested) : 0;
        const pool = await this.inventory.lockApprovalPool(tx, {
          productId: item.productId,
          requestId,
          preferId: item.stockItemId,
          warehouseId: warehouseId ?? null,
          limit: owned,
        });

        const chosen: Array<{ row: LockedRow; take: number; reserved: boolean }> = [];
        const surplus: LockedRow[] = [];
        let covered = 0;
        for (const row of pool) {
          if (covered < need && row.quantity > 0) {
            const take = Math.min(row.quantity, need - covered);
            chosen.push({ row, take, reserved: true });
            covered += take;
          } else {
            surplus.push(row);
          }
        }
        // Top up from AVAILABLE stock (FIFO), one locked row at a time.
        const taken = [...pool.map((r) => r.id)];
        while (covered < need) {
          const row = await this.inventory.lockAvailableRow(tx, item.productId, warehouseId ?? null, taken);
          if (!row) break;
          taken.push(row.id);
          const take = Math.min(row.quantity, need - covered);
          chosen.push({ row, take, reserved: false });
          covered += take;
        }

        for (const c of chosen) {
          // Bulk rows: keep exactly `take` on this row; the rest goes back to AVAILABLE.
          await splitStockRow(tx, c.row.id, c.take, StockStatus.AVAILABLE);
          if (!c.reserved) await this.inventory.reserveRow(tx, c.row.id, taskRef, userId);

          const stock = await tx.stockItem.findUnique({
            where: { id: c.row.id },
            include: { warehouse: true, rack: true, slot: true },
          });
          await tx.fulfillmentTaskItem.create({
            data: {
              taskId: t.id,
              productId: item.productId,
              stockItemId: c.row.id,
              qtyRequested: c.take,
              qtyPicked: 0,
              binLocation: [stock?.warehouse?.code, stock?.rack?.code, stock?.slot?.code]
                .filter(Boolean)
                .join('|'),
            },
          });
        }

        // Shortfall keeps the previous behaviour: an unallocated line for the remainder.
        if (covered < need) {
          await tx.fulfillmentTaskItem.create({
            data: {
              taskId: t.id,
              productId: item.productId,
              stockItemId: null,
              qtyRequested: need - covered,
              qtyPicked: 0,
              binLocation: null,
            },
          });
        }

        // Units approval over-reserved for this line are released, not leaked.
        if (surplus.length) {
          await this.inventory.releaseReservation(
            tx,
            surplus.map((r) => ({ stockItemId: r.id })),
            `approval surplus of ${req.refNumber} (allocated as ${taskRef})`,
            userId,
          );
        }
      }

      // Advance request status (version bump for optimistic locking — C3)
      await tx.withdrawalRequest.update({
        where: { id: requestId },
        data: { status: 'PICKING', version: { increment: 1 } },
      });

      await tx.fulfillmentTimeline.create({
        data: {
          taskId: t.id,
          fromStatus: null,
          toStatus: FulfillmentStatus.ALLOCATED,
          description: `Task allocated from request ${req.refNumber}`,
          actorId: userId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'FULFILLMENT_ALLOCATED',
          entityType: 'FulfillmentTask',
          entityId: t.id,
          detail: `${taskRef} ← ${req.refNumber}`,
        },
      });
      return t;
    });

    this.realtime.emitRequestUpdate({
      action: 'fulfillment_allocated',
      requestId,
      taskId: task.id,
    });
    return task;
  }
}
