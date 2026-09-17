import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { FulfillmentStatus, Prisma } from '@prisma/client';
import { PickingService } from './services/picking.service';
import { PackingService } from './services/packing.service';
import { HandoverService } from './services/handover.service';
import { claimTaskStatus, CANCELLABLE_TASK_STATUSES } from './services/task-state';

const EXCEPTION_STATUSES: FulfillmentStatus[] = [
  FulfillmentStatus.SHORT_PICK,
  FulfillmentStatus.DAMAGED,
  FulfillmentStatus.HOLD,
  FulfillmentStatus.CANCELLED,
  FulfillmentStatus.RETURNED,
];

// FulfillmentService — orchestration layer.
// Handles board visibility, status pipeline, and exception management.
// Execution operations (pick/pack/dispatch/handover) are in sub-services.
@Injectable()
export class FulfillmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly picking: PickingService,
    private readonly packing: PackingService,
    private readonly handover: HandoverService,
  ) {}

  // Kanban board grouped into operational lanes
  async board(warehouseId?: string) {
    const tasks = await this.prisma.fulfillmentTask.findMany({
      where: {
        status: {
          notIn: [
            FulfillmentStatus.CLOSED,
            FulfillmentStatus.CANCELLED,
            FulfillmentStatus.RETURNED,
          ],
        },
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: {
        items: { include: { product: true } },
        packing: true,
        shipment: true,
      },
      orderBy: { updatedAt: 'asc' },
    });

    const inSet = (arr: FulfillmentStatus[], s: FulfillmentStatus) => arr.includes(s);
    return {
      allocated: tasks.filter((t) => t.status === FulfillmentStatus.ALLOCATED),
      picking:   tasks.filter((t) => inSet([FulfillmentStatus.PICKING, FulfillmentStatus.PICKED], t.status)),
      packing:   tasks.filter((t) => inSet([FulfillmentStatus.PACKING, FulfillmentStatus.PACKED], t.status)),
      shipping:  tasks.filter((t) => inSet([FulfillmentStatus.READY_TO_SHIP, FulfillmentStatus.SHIPPED, FulfillmentStatus.DELIVERED], t.status)),
      exceptions: tasks.filter((t) => inSet([FulfillmentStatus.SHORT_PICK, FulfillmentStatus.DAMAGED, FulfillmentStatus.HOLD], t.status)),
    };
  }

  // APPROVED requests with no active FulfillmentTask yet — the "ready to allocate"
  // queue. Drives the Fulfillment board's request picker (see AllocationService.allocate
  // for the matching duplicate-task guard this mirrors).
  async allocatableRequests() {
    const activeTasks = await this.prisma.fulfillmentTask.findMany({
      where: { status: { notIn: [FulfillmentStatus.CANCELLED, FulfillmentStatus.RETURNED] } },
      select: { requestId: true },
    });
    const allocatedIds = activeTasks.map((t) => t.requestId);

    return this.prisma.withdrawalRequest.findMany({
      where: { status: 'APPROVED', id: { notIn: allocatedIds } },
      include: {
        requester: { select: { id: true, fullName: true, department: true } },
        items: { include: { product: { select: { code: true, name: true } } } },
      },
      orderBy: { approvedAt: 'asc' },
    });
  }

  async findAll(status?: FulfillmentStatus, warehouseId?: string) {
    return this.prisma.fulfillmentTask.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: { items: { include: { product: true } }, packing: true, shipment: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const t = await this.prisma.fulfillmentTask.findUnique({
      where: { id },
      include: {
        items: { include: { product: { include: { brand: true } } } },
        packing: { include: { cartons: true } },
        shipment: { include: { timeline: { orderBy: { createdAt: 'asc' } } } },
        timeline: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!t) throw new NotFoundException('FulfillmentTask not found');
    return t;
  }

  // Advance a task one step through the status pipeline.
  // Each step runs through the service that owns it, so "Next" can never skip a
  // warehouse step: picking confirms the picks (stock → PICKED), packing opens and
  // completes the packing session, delivery requires a dispatched shipment, and the
  // goods issue itself is never skipped — PACKED / READY_TO_SHIP must use Ship.
  async advance(
    taskId: string,
    userId: string,
    data?: { notes?: string; barcode?: string; deviceId?: string },
  ) {
    const task = await this.findOne(taskId);
    const F = FulfillmentStatus;

    switch (task.status) {
      case F.ALLOCATED:
        await this.plainAdvance(task, F.PICKING, userId, data);
        break;
      case F.PICKING:
        await this.picking.confirmAllRemaining(taskId, userId, data?.barcode);
        break;
      case F.PICKED:
        await this.packing.startPacking(taskId, userId);
        break;
      case F.PACKING:
        await this.packing.completePacking(taskId, userId);
        break;
      case F.PACKED:
      case F.READY_TO_SHIP:
        throw new BadRequestException(
          'Goods issue cannot be skipped — create the shipment and confirm dispatch (Ship)',
        );
      case F.SHIPPED:
        if (!task.shipment) throw new BadRequestException('Task has no shipment to deliver');
        await this.handover.confirmDelivery(task.shipment.id, { notes: data?.notes }, userId);
        break;
      case F.DELIVERED:
        await this.plainAdvance(task, F.CLOSED, userId, data);
        break;
      default:
        if (task.status === F.CLOSED) throw new BadRequestException('Task already at final status');
        throw new BadRequestException(`Status ${task.status} is not in the advancement pipeline`);
    }

    const updated = await this.prisma.fulfillmentTask.findUniqueOrThrow({ where: { id: taskId } });
    this.realtime.emitRequestUpdate({ action: 'fulfillment_advance', taskId, status: updated.status });
    return updated;
  }

  /** A status step with no stock effect (ALLOCATED → PICKING, DELIVERED → CLOSED). */
  private async plainAdvance(
    task: { id: string; status: FulfillmentStatus; warehouseId: string | null },
    toStatus: FulfillmentStatus,
    userId: string,
    data?: { notes?: string; barcode?: string; deviceId?: string },
  ) {
    const fromStatus = task.status;
    await this.prisma.$transaction(async (tx) => {
      const extra: Prisma.FulfillmentTaskUncheckedUpdateManyInput = {};
      if (toStatus === FulfillmentStatus.PICKING) extra.pickedById = userId;
      await claimTaskStatus(tx, task.id, [fromStatus], toStatus, extra);
      await tx.fulfillmentTimeline.create({
        data: {
          taskId: task.id,
          fromStatus,
          toStatus,
          description: data?.notes ?? `Advanced by operator`,
          actorId: userId,
          barcode: data?.barcode ?? null,
          deviceId: data?.deviceId ?? null,
          warehouseId: task.warehouseId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'FULFILLMENT_ADVANCE',
          entityType: 'FulfillmentTask',
          entityId: task.id,
          detail: `${fromStatus} → ${toStatus}`,
        },
      });
    });
  }

  // Set exception status (SHORT_PICK / DAMAGED / HOLD / CANCELLED / RETURNED)
  async setException(
    taskId: string,
    status: FulfillmentStatus,
    userId: string,
    reason?: string,
  ) {
    if (!EXCEPTION_STATUSES.includes(status)) {
      throw new BadRequestException(`${status} is not a valid exception status`);
    }
    // Cancelling must release the reserved / picked stock, not just flip the status.
    if (status === FulfillmentStatus.CANCELLED) {
      return this.handover.releaseAndCancel(taskId, userId, reason);
    }
    const task = await this.findOne(taskId);
    // RETURNED describes goods that already left; the hold-type exceptions only
    // apply while the stock is still in the warehouse.
    const allowedFrom =
      status === FulfillmentStatus.RETURNED
        ? [FulfillmentStatus.SHIPPED, FulfillmentStatus.DELIVERED]
        : CANCELLABLE_TASK_STATUSES;
    if (status !== FulfillmentStatus.RETURNED && task.shipment?.shippedAt) {
      throw new BadRequestException('Goods already issued — use RETURNED instead');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await claimTaskStatus(tx, taskId, allowedFrom, status);
      await tx.fulfillmentTimeline.create({
        data: {
          taskId,
          fromStatus: task.status,
          toStatus: status,
          description: reason ?? status,
          actorId: userId,
          warehouseId: task.warehouseId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'FULFILLMENT_EXCEPTION',
          entityType: 'FulfillmentTask',
          entityId: taskId,
          detail: `${status}: ${reason ?? '—'}`,
        },
      });
      return tx.fulfillmentTask.findUniqueOrThrow({ where: { id: taskId } });
    });
    this.realtime.emitRequestUpdate({ action: 'fulfillment_exception', taskId, status });
    return updated;
  }
}
