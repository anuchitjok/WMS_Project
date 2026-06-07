import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { InventoryOrchestrationService } from '../../inventory/inventory-orchestration.service';
import { FulfillmentStatus } from '@prisma/client';

@Injectable()
export class HandoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly inventory: InventoryOrchestrationService,
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
      const s = await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          deliveredAt: new Date(),
          receiverName: dto.receiverName ?? sh.receiverName,
          podReference: dto.podReference ?? null,
          notes: dto.notes ?? sh.notes,
        },
      });
      await tx.shipmentTimeline.create({
        data: {
          shipmentId,
          status: 'DELIVERED',
          description: dto.notes ?? 'Delivery confirmed',
          actorId: userId,
        },
      });
      await tx.fulfillmentTask.update({
        where: { id: sh.taskId },
        data: { status: FulfillmentStatus.DELIVERED, version: { increment: 1 } },
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
      return s;
    });
  }

  // Issue to RMA: preserves V1 handover behavior — confirms physical handover
  async issueToRma(
    taskId: string,
    dto: { receiver: string; rmaId?: string },
    userId: string,
  ) {
    const task = await this.prisma.fulfillmentTask.findUnique({ where: { id: taskId } });
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

    return this.prisma.$transaction(async (tx) => {
      const t = await tx.fulfillmentTask.update({
        where: { id: taskId },
        data: {
          status: FulfillmentStatus.CLOSED,
          version: { increment: 1 },
        },
      });
      await tx.fulfillmentTimeline.create({
        data: {
          taskId,
          fromStatus: task.status,
          toStatus: FulfillmentStatus.CLOSED,
          description: `Issued to RMA — receiver: ${dto.receiver}`,
          actorId: userId,
        },
      });
      // Sync WithdrawalRequest to ISSUED_TO_RMA for backward compat
      await tx.withdrawalRequest.update({
        where: { id: task.requestId },
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
      return t;
    });
  }

  // Release reservation for cancelled / exception tasks
  async releaseAndCancel(taskId: string, userId: string, reason?: string) {
    const task = await this.prisma.fulfillmentTask.findUnique({
      where: { id: taskId },
      include: { items: true },
    });
    if (!task) throw new NotFoundException('Task not found');

    return this.prisma.$transaction(async (tx) => {
      // Release inventory reservations
      const reservedItems = task.items.filter((i) => i.stockItemId !== null);
      if (reservedItems.length > 0) {
        await this.inventory.releaseReservation(
          tx,
          reservedItems.map((i) => ({ stockItemId: i.stockItemId! })),
          task.refNumber,
          userId,
        );
      }

      const t = await tx.fulfillmentTask.update({
        where: { id: taskId },
        data: { status: FulfillmentStatus.CANCELLED, version: { increment: 1 } },
      });
      await tx.fulfillmentTimeline.create({
        data: {
          taskId,
          fromStatus: task.status,
          toStatus: FulfillmentStatus.CANCELLED,
          description: reason ?? 'Cancelled',
          actorId: userId,
        },
      });
      return t;
    });
  }
}
