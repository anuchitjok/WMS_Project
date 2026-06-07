import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { InventoryOrchestrationService } from '../../inventory/inventory-orchestration.service';
import { FulfillmentStatus } from '@prisma/client';
import { nanoid } from 'nanoid';

@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly inventory: InventoryOrchestrationService,
  ) {}

  async createShipment(
    taskId: string,
    dto: { carrier?: string; trackingNumber?: string; receiverName?: string; notes?: string },
    userId: string,
  ) {
    const task = await this.prisma.fulfillmentTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    if (!([FulfillmentStatus.PACKED, FulfillmentStatus.READY_TO_SHIP] as string[]).includes(task.status)) {
      throw new BadRequestException('Task must be PACKED to create shipment');
    }
    const existing = await this.prisma.shipment.findUnique({ where: { taskId } });
    if (existing) throw new ConflictException('Shipment already exists for this task');

    const ref = `SHP-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;

    const shipment = await this.prisma.$transaction(async (tx) => {
      const s = await tx.shipment.create({
        data: {
          refNumber: ref,
          taskId,
          carrier: dto.carrier,
          trackingNumber: dto.trackingNumber,
          receiverName: dto.receiverName,
          notes: dto.notes,
          handoverById: userId,
        },
      });
      await tx.shipmentTimeline.create({
        data: { shipmentId: s.id, status: 'READY_TO_SHIP', description: 'Shipment created', actorId: userId },
      });
      await tx.fulfillmentTask.update({
        where: { id: taskId },
        data: { status: FulfillmentStatus.READY_TO_SHIP, version: { increment: 1 } },
      });
      await tx.fulfillmentTimeline.create({
        data: {
          taskId,
          fromStatus: task.status,
          toStatus: FulfillmentStatus.READY_TO_SHIP,
          description: `Shipment ${ref} created`,
          actorId: userId,
          warehouseId: task.warehouseId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'SHIPMENT_CREATED',
          entityType: 'Shipment',
          entityId: s.id,
          detail: ref,
        },
      });
      return s;
    });

    this.realtime.emitRequestUpdate({ action: 'shipment_created', taskId, shipmentRef: ref });
    return shipment;
  }

  // Confirm dispatch = Goods Issue (GI).
  // This is the only place where stock is physically deducted from inventory.
  // Equivalent to SAP EWM Goods Issue posting.
  async confirmDispatch(shipmentId: string, userId: string) {
    const sh = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { task: { include: { items: true } } },
    });
    if (!sh) throw new NotFoundException('Shipment not found');
    if (sh.shippedAt) throw new ConflictException('Shipment already dispatched');

    return this.prisma.$transaction(async (tx) => {
      // Goods Issue — deduct stock via orchestration service
      const issueItems = sh.task.items
        .filter((i) => i.stockItemId !== null)
        .map((i) => ({ stockItemId: i.stockItemId!, qtyIssued: i.qtyPicked }));

      if (issueItems.length > 0) {
        await this.inventory.issueStockForShipment(tx, {
          taskId: sh.taskId,
          shipmentRef: sh.refNumber,
          requestId: sh.task.requestId,
          issuedByUserId: userId,
          items: issueItems,
        });
      }

      // Phase 3 (C2): denormalize the actually-shipped unit + issued qty onto the
      // request lines, so post-issue flows (RMA/return) target the real unit.
      const reqItems = await tx.withdrawalRequestItem.findMany({ where: { requestId: sh.task.requestId } });
      const usedReqItemIds = new Set<string>();
      for (const ti of sh.task.items) {
        if (!ti.stockItemId) continue;
        const match = reqItems.find(
          (ri) => ri.productId === ti.productId && !ri.shippedStockItemId && !usedReqItemIds.has(ri.id),
        );
        if (match) {
          usedReqItemIds.add(match.id);
          await tx.withdrawalRequestItem.update({
            where: { id: match.id },
            data: { shippedStockItemId: ti.stockItemId, quantityIssued: ti.qtyPicked },
          });
        }
      }

      const s = await tx.shipment.update({
        where: { id: shipmentId },
        data: { shippedAt: new Date(), dispatchedById: userId },
      });
      await tx.shipmentTimeline.create({
        data: {
          shipmentId,
          status: 'SHIPPED',
          description: 'Goods issued & dispatched',
          actorId: userId,
        },
      });
      await tx.fulfillmentTask.update({
        where: { id: sh.taskId },
        data: { status: FulfillmentStatus.SHIPPED, version: { increment: 1 } },
      });
      await tx.fulfillmentTimeline.create({
        data: {
          taskId: sh.taskId,
          fromStatus: FulfillmentStatus.READY_TO_SHIP,
          toStatus: FulfillmentStatus.SHIPPED,
          description: 'Goods issued. Shipment dispatched.',
          actorId: userId,
          warehouseId: sh.task.warehouseId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'SHIPMENT_DISPATCHED',
          entityType: 'Shipment',
          entityId: shipmentId,
          detail: sh.refNumber,
        },
      });
      return s;
    });
  }
}
