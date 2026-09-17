import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { InventoryOrchestrationService } from '../../inventory/inventory-orchestration.service';
import { FulfillmentStatus, Prisma, RequestStatus } from '@prisma/client';
import { claimTaskStatus, CANCELLABLE_TASK_STATUSES } from './task-state';
import { DispatchService } from './dispatch.service';

@Injectable()
export class HandoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly inventory: InventoryOrchestrationService,
    private readonly dispatch: DispatchService,
  ) {}

  // Handover queue: tasks ready for physical handover to requester / RMA
  getHandoverQueue(warehouseId?: string) {
    return this.prisma.fulfillmentTask.findMany({
      where: {
        status: { in: [FulfillmentStatus.READY_TO_SHIP, FulfillmentStatus.SHIPPED] },
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: {
        items: { include: { product: true } },
        shipment: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Confirm delivery after shipment
  async confirmDelivery(
    shipmentId: string,
    dto: { receiverName?: string; podReference?: string; notes?: string },
    userId: string,
  ) {
    const sh = await this.prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!sh) throw new NotFoundException('Shipment not found');
    if (!sh.shippedAt) throw new BadRequestException('Shipment must be dispatched before delivery confirmation');

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.shipment.updateMany({
        where: { id: shipmentId, deliveredAt: null },
        data: {
          deliveredAt: new Date(),
          receiverName: dto.receiverName ?? sh.receiverName,
          podReference: dto.podReference ?? null,
          notes: dto.notes ?? sh.notes,
        },
      });
      if (claimed.count === 0) throw new ConflictException('Delivery already confirmed');
      await claimTaskStatus(tx, sh.taskId, [FulfillmentStatus.SHIPPED], FulfillmentStatus.DELIVERED);
      await tx.shipmentTimeline.create({
        data: {
          shipmentId,
          status: 'DELIVERED',
          description: dto.notes ?? 'Delivery confirmed',
          actorId: userId,
        },
      });
      await tx.fulfillmentTimeline.create({
        data: {
          taskId: sh.taskId,
          fromStatus: FulfillmentStatus.SHIPPED,
          toStatus: FulfillmentStatus.DELIVERED,
          description: `Delivered — ${dto.receiverName ?? 'receiver confirmed'}`,
          actorId: userId,
        },
      });
      return tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    });
  }

  // Issue to RMA: preserves V1 handover behavior — confirms physical handover.
  // Goods cannot leave without a goods issue: a task that is still READY_TO_SHIP is
  // dispatched in the same transaction before it is closed.
  async issueToRma(
    taskId: string,
    dto: { receiver: string; rmaId?: string },
    userId: string,
  ) {
    const task = await this.prisma.fulfillmentTask.findUnique({ where: { id: taskId }, include: { shipment: true } });
    if (!task) throw new NotFoundException('Task not found');

    const readyStatuses: FulfillmentStatus[] = [
      FulfillmentStatus.READY_TO_SHIP,
      FulfillmentStatus.SHIPPED,
      FulfillmentStatus.DELIVERED,
    ];
    if (!readyStatuses.includes(task.status)) {
      throw new BadRequestException(
        `Task must be READY_TO_SHIP, SHIPPED, or DELIVERED for RMA handover (current: ${task.status})`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (task.status === FulfillmentStatus.READY_TO_SHIP) {
        const shipment = task.shipment ?? (await this.dispatch.createShipmentInTx(tx, task, { receiverName: dto.receiver }, userId));
        await this.dispatch.dispatchInTx(tx, shipment.id, userId);
      }
      await claimTaskStatus(
        tx,
        taskId,
        [FulfillmentStatus.SHIPPED, FulfillmentStatus.DELIVERED],
        FulfillmentStatus.CLOSED,
      );
      await tx.fulfillmentTimeline.create({
        data: {
          taskId,
          fromStatus: task.status,
          toStatus: FulfillmentStatus.CLOSED,
          description: `Issued to RMA — receiver: ${dto.receiver}`,
          actorId: userId,
        },
      });
      // Sync WithdrawalRequest to ISSUED_TO_RMA for backward compat (never revive a cancelled/closed request)
      await tx.withdrawalRequest.updateMany({
        where: { id: task.requestId, status: { notIn: [RequestStatus.CANCELLED, RequestStatus.COMPLETED] } },
        data: { status: 'ISSUED_TO_RMA' },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'HANDOVER_CONFIRMED',
          entityType: 'FulfillmentTask',
          entityId: taskId,
          detail: `Issued to RMA — receiver: ${dto.receiver}`,
        },
      });
      return tx.fulfillmentTask.findUniqueOrThrow({ where: { id: taskId } });
    });
    this.realtime.emitRequestUpdate({ action: 'handover', taskId });
    return result;
  }

  // Release reservation for cancelled / exception tasks
  async releaseAndCancel(taskId: string, userId: string, reason?: string) {
    const result = await this.prisma.$transaction((tx) => this.cancelInTx(tx, taskId, userId, reason));
    this.realtime.emitRequestUpdate({ action: 'fulfillment_cancelled', taskId });
    return result;
  }

  /** Cancels a task that has not issued goods and releases every unit it holds. */
  async cancelInTx(tx: Prisma.TransactionClient, taskId: string, userId: string, reason?: string) {
    const task = await tx.fulfillmentTask.findUnique({
      where: { id: taskId },
      include: { items: true, shipment: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.shipment?.shippedAt) throw new ConflictException('Goods already issued — the task cannot be cancelled');

    await claimTaskStatus(tx, taskId, CANCELLABLE_TASK_STATUSES, FulfillmentStatus.CANCELLED);

    const reservedItems = task.items.filter((i) => i.stockItemId !== null);
    if (reservedItems.length > 0) {
      await this.inventory.releaseReservation(
        tx,
        reservedItems.map((i) => ({ stockItemId: i.stockItemId! })),
        `task ${task.refNumber}`,
        userId,
      );
    }

    await tx.fulfillmentTimeline.create({
      data: {
        taskId,
        fromStatus: task.status,
        toStatus: FulfillmentStatus.CANCELLED,
        description: reason ?? 'Cancelled',
        actorId: userId,
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: 'FULFILLMENT_CANCELLED',
        entityType: 'FulfillmentTask',
        entityId: taskId,
        detail: `${task.refNumber}: ${reason ?? 'Cancelled'}`,
      },
    });
    return tx.fulfillmentTask.findUniqueOrThrow({ where: { id: taskId } });
  }
}
