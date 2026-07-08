import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { FulfillmentStatus } from '@prisma/client';

const STATUS_ORDER: FulfillmentStatus[] = [
  FulfillmentStatus.ALLOCATED,
  FulfillmentStatus.PICKING,
  FulfillmentStatus.PICKED,
  FulfillmentStatus.PACKING,
  FulfillmentStatus.PACKED,
  FulfillmentStatus.READY_TO_SHIP,
  FulfillmentStatus.SHIPPED,
  FulfillmentStatus.DELIVERED,
  FulfillmentStatus.CLOSED,
];

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

  // Advance a task one step through the status pipeline
  async advance(
    taskId: string,
    userId: string,
    data?: { notes?: string; barcode?: string; deviceId?: string },
  ) {
    const task = await this.findOne(taskId);
    const idx = STATUS_ORDER.indexOf(task.status);
    if (idx < 0) throw new BadRequestException(`Status ${task.status} is not in the advancement pipeline`);
    if (idx >= STATUS_ORDER.length - 1) throw new BadRequestException('Task already at final status');

    const fromStatus = task.status;
    const toStatus = STATUS_ORDER[idx + 1];

    const updated = await this.prisma.$transaction(async (tx) => {
      const updates: any = { status: toStatus, version: { increment: 1 } };
      if (toStatus === FulfillmentStatus.PICKING) updates.pickedById = userId;
      if (toStatus === FulfillmentStatus.PICKED)  updates.pickedAt = new Date();
      if (toStatus === FulfillmentStatus.PACKING) updates.packedById = userId;
      if (toStatus === FulfillmentStatus.PACKED)  updates.packedAt = new Date();

      const t = await tx.fulfillmentTask.update({ where: { id: taskId }, data: updates });
      await tx.fulfillmentTimeline.create({
        data: {
          taskId,
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
          entityId: taskId,
          detail: `${fromStatus} → ${toStatus}`,
        },
      });
      return t;
    });

    this.realtime.emitRequestUpdate({ action: 'fulfillment_advance', taskId, status: toStatus });
    return updated;
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
    const task = await this.findOne(taskId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.fulfillmentTask.update({
        where: { id: taskId },
        data: { status, version: { increment: 1 } },
      });
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
      return t;
    });
    this.realtime.emitRequestUpdate({ action: 'fulfillment_exception', taskId, status });
    return updated;
  }
}
