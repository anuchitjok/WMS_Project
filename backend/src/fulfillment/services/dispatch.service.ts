import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { InventoryOrchestrationService } from '../../inventory/inventory-orchestration.service';
import { FulfillmentStatus, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import { claimTaskStatus } from './task-state';
import { PickingService } from './picking.service';

@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly inventory: InventoryOrchestrationService,
    private readonly picking: PickingService,
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
    if (existing?.shippedAt) throw new ConflictException('Shipment already exists for this task');
    if (existing) {
      // A shipment created by an earlier attempt whose dispatch failed: reuse it so
      // the operator can retry dispatch instead of being stuck at READY_TO_SHIP.
      return this.prisma.shipment.update({
        where: { id: existing.id },
        data: {
          carrier: dto.carrier ?? existing.carrier,
          trackingNumber: dto.trackingNumber ?? existing.trackingNumber,
          receiverName: dto.receiverName ?? existing.receiverName,
          notes: dto.notes ?? existing.notes,
        },
      });
    }

    const shipment = await this.prisma.$transaction((tx) => this.createShipmentInTx(tx, task, dto, userId));

    this.realtime.emitRequestUpdate({ action: 'shipment_created', taskId, shipmentRef: shipment.refNumber });
    return shipment;
  }

  /** Creates the shipment and moves the task to READY_TO_SHIP inside the caller's transaction. */
  async createShipmentInTx(
    tx: Prisma.TransactionClient,
    task: { id: string; status: FulfillmentStatus; warehouseId: string | null },
    dto: { carrier?: string; trackingNumber?: string; receiverName?: string; notes?: string },
    userId: string,
  ) {
    const ref = `SHP-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
    await claimTaskStatus(
      tx,
      task.id,
      [FulfillmentStatus.PACKED, FulfillmentStatus.READY_TO_SHIP],
      FulfillmentStatus.READY_TO_SHIP,
    );
    const s = await tx.shipment.create({
      data: {
        refNumber: ref,
        taskId: task.id,
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
    await tx.fulfillmentTimeline.create({
      data: {
        taskId: task.id,
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
  }

  // Confirm dispatch = Goods Issue (GI).
  // This is the only place where stock is physically deducted from inventory.
  // Equivalent to SAP EWM Goods Issue posting.
  async confirmDispatch(shipmentId: string, userId: string) {
    const result = await this.prisma.$transaction((tx) => this.dispatchInTx(tx, shipmentId, userId));
    this.realtime.emitInventoryUpdate({ action: 'goods_issued', shipmentId });
    return result;
  }

  /** Goods issue inside the caller's transaction (used by dispatch, RMA handover and scan SHIP). */
  async dispatchInTx(tx: Prisma.TransactionClient, shipmentId: string, userId: string) {
    // Claim the shipment first: a second concurrent dispatch matches zero rows.
    const claimed = await tx.shipment.updateMany({
      where: { id: shipmentId, shippedAt: null },
      data: { shippedAt: new Date(), dispatchedById: userId },
    });
    if (claimed.count === 0) {
      const exists = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { id: true } });
      if (!exists) throw new NotFoundException('Shipment not found');
      throw new ConflictException('Shipment already dispatched');
    }
    const sh = await tx.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      include: { task: { include: { items: true } } },
    });
    // Goods can only leave from a packed, ready task (not cancelled / on hold).
    await claimTaskStatus(tx, sh.taskId, [FulfillmentStatus.READY_TO_SHIP], FulfillmentStatus.SHIPPED);

    const issueItems: Array<{ stockItemId: string; qtyIssued: number }> = [];
    const pickedQty = new Map<string, number>();
    for (const ti of sh.task.items) {
      if (!ti.stockItemId) continue;
      let qty = ti.qtyPicked;
      if (!ti.pickedAt) {
        // Task advanced before pick tracking: the goods are going out now.
        await this.picking.pickInTx(tx, sh.taskId, ti.id, ti.qtyRequested, userId, {
          note: 'Pick confirmed at dispatch (task advanced without item picks)',
          allowStatuses: [FulfillmentStatus.SHIPPED],
        });
        qty = ti.qtyRequested;
      }
      pickedQty.set(ti.id, qty);
      if (qty > 0) {
        issueItems.push({ stockItemId: ti.stockItemId, qtyIssued: qty });
      } else {
        // Nothing was picked for this line — its reservation must not leak.
        await this.inventory.releaseReservation(
          tx,
          [{ stockItemId: ti.stockItemId }],
          `short pick on ${sh.refNumber}`,
          userId,
        );
      }
    }

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
    // request lines, so post-issue flows (RMA/return) target the real unit. A line
    // can be fulfilled by several task items (one per unit/row), so task items are
    // assigned to lines of the same product until each line's quantity is covered.
    const reqItems = await tx.withdrawalRequestItem.findMany({
      where: { requestId: sh.task.requestId },
      orderBy: { id: 'asc' },
    });
    const lineState = new Map<string, { unitId: string | null; issued: number; capacity: number }>();
    for (const ri of reqItems) {
      if (ri.shippedStockItemId) continue;
      lineState.set(ri.id, { unitId: null, issued: 0, capacity: ri.quantityApproved ?? ri.quantityRequested });
    }
    for (const ti of sh.task.items) {
      if (!ti.stockItemId) continue;
      const qty = pickedQty.get(ti.id) ?? 0;
      if (qty <= 0) continue;
      const line = reqItems.find((ri) => {
        const st = lineState.get(ri.id);
        return ri.productId === ti.productId && st && st.issued < st.capacity;
      });
      if (!line) continue;
      const st = lineState.get(line.id)!;
      st.unitId = st.unitId ?? ti.stockItemId;
      st.issued += qty;
    }
    for (const [lineId, st] of lineState) {
      if (!st.unitId) continue;
      await tx.withdrawalRequestItem.update({
        where: { id: lineId },
        data: { shippedStockItemId: st.unitId, quantityIssued: st.issued },
      });
    }

    await tx.shipmentTimeline.create({
      data: {
        shipmentId,
        status: 'SHIPPED',
        description: 'Goods issued & dispatched',
        actorId: userId,
      },
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
    return tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  }
}
