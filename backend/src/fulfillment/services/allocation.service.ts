import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { InventoryOrchestrationService } from '../../inventory/inventory-orchestration.service';
import { FulfillmentStatus, StockStatus } from '@prisma/client';
import { nanoid } from 'nanoid';
import { isUnifiedReservationEnabled } from '../../common/feature-flags';

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
    const req = await this.prisma.withdrawalRequest.findUnique({
      where: { id: requestId },
      include: { items: { include: { product: true } }, requester: true },
    });
    if (!req) throw new NotFoundException('Request not found');
    if (!['APPROVED', 'PICKING'].includes(req.status)) {
      throw new BadRequestException(
        `Request must be APPROVED to allocate (current: ${req.status})`,
      );
    }

    // Prevent duplicate active task
    const existing = await this.prisma.fulfillmentTask.findFirst({
      where: {
        requestId,
        status: { notIn: [FulfillmentStatus.CANCELLED, FulfillmentStatus.RETURNED] },
      },
    });
    if (existing) {
      throw new ConflictException(
        `FulfillmentTask already exists for this request: ${existing.refNumber}`,
      );
    }

    const taskRef = `FT-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;

    // Under unified reservation, approval no longer reserves, so allocation must
    // pick from AVAILABLE only (never grab another task's RESERVED unit — C1).
    // In legacy mode we still accept RESERVED so allocation can consume the unit
    // reserved at approval time.
    const allocatableStatuses = isUnifiedReservationEnabled()
      ? [StockStatus.AVAILABLE]
      : [StockStatus.AVAILABLE, StockStatus.RESERVED];

    const task = await this.prisma.$transaction(async (tx) => {
      // Determine warehouse from first allocated stock item
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

      const reservationItems: Array<{ stockItemId: string; qty: number }> = [];

      for (const item of req.items) {
        // FIFO: oldest receivedDate first, only AVAILABLE or RESERVED
        const stock = await tx.stockItem.findFirst({
          where: {
            productId: item.productId,
            status: { in: allocatableStatuses },
            ...(warehouseId ? { warehouseId } : {}),
          },
          orderBy: { receivedDate: 'asc' },
          include: { warehouse: true, rack: true, slot: true },
        });

        await tx.fulfillmentTaskItem.create({
          data: {
            taskId: t.id,
            productId: item.productId,
            stockItemId: stock?.id ?? null,
            qtyRequested: item.quantityApproved ?? item.quantityRequested,
            qtyPicked: 0,
            binLocation: stock
              ? [stock.warehouse?.code, stock.rack?.code, stock.slot?.code]
                  .filter(Boolean)
                  .join('|')
              : null,
          },
        });

        if (stock) {
          reservationItems.push({
            stockItemId: stock.id,
            qty: item.quantityApproved ?? item.quantityRequested,
          });
        }
      }

      // Reserve all stock atomically
      if (reservationItems.length > 0) {
        await this.inventory.reserveForTask(tx, reservationItems, taskRef, userId);
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
