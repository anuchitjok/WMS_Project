import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { FulfillmentStatus } from '@prisma/client';
import { claimTaskStatus } from './task-state';
import { PickingService } from './picking.service';

@Injectable()
export class PackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly picking: PickingService,
  ) {}

  async startPacking(taskId: string, userId: string) {
    const task = await this.prisma.fulfillmentTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    if (!([FulfillmentStatus.PICKED, FulfillmentStatus.PACKING] as string[]).includes(task.status)) {
      throw new BadRequestException('Task must be PICKED before packing');
    }

    const existing = await this.prisma.packingSession.findUnique({ where: { taskId } });
    if (existing) return existing; // idempotent

    const session = await this.prisma.$transaction(async (tx) => {
      if (task.status === FulfillmentStatus.PICKED) {
        await claimTaskStatus(tx, taskId, [FulfillmentStatus.PICKED], FulfillmentStatus.PACKING, {
          packedById: userId,
        });
      }
      const s = await tx.packingSession.create({
        data: { taskId, packedById: userId, cartonCount: 1 },
      });
      await tx.fulfillmentTimeline.create({
        data: {
          taskId,
          fromStatus: task.status,
          toStatus: FulfillmentStatus.PACKING,
          description: 'Packing started',
          actorId: userId,
          warehouseId: task.warehouseId,
        },
      });
      return s;
    });

    this.realtime.emitRequestUpdate({ action: 'packing_started', taskId });
    return session;
  }

  async updatePacking(
    taskId: string,
    dto: { cartonCount?: number; totalWeight?: number; notes?: string },
    userId: string,
  ) {
    const session = await this.prisma.packingSession.findUnique({ where: { taskId } });
    if (!session) throw new NotFoundException('Packing session not found');
    if (session.completedAt) throw new ConflictException('Packing is already completed');
    const { cartonCount, totalWeight, notes } = dto;
    return this.prisma.packingSession.update({ where: { taskId }, data: { cartonCount, totalWeight, notes } });
  }

  async completePacking(taskId: string, userId: string) {
    const session = await this.prisma.packingSession.findUnique({ where: { taskId } });
    if (!session) throw new NotFoundException('Packing session not found');

    const result = await this.prisma.$transaction(async (tx) => {
      // Tasks advanced before pick tracking reach PACKING with unpicked lines. The
      // goods are physically packed, so confirm those picks now (audited) rather
      // than leaving the reserved stock unaccounted for.
      const unpicked = await tx.fulfillmentTaskItem.findMany({ where: { taskId, pickedAt: null } });
      for (const it of unpicked) {
        await this.picking.pickInTx(tx, taskId, it.id, it.qtyRequested, userId, {
          note: 'Pick confirmed at packing (task advanced without item picks)',
          allowStatuses: [FulfillmentStatus.PACKING],
        });
      }

      await claimTaskStatus(tx, taskId, [FulfillmentStatus.PACKING], FulfillmentStatus.PACKED, {
        packedAt: new Date(),
      });
      const s = await tx.packingSession.update({
        where: { taskId },
        data: {
          completedAt: new Date(),
          labelPrinted: true,
          labelPrintedAt: new Date(),
        },
      });
      const t = await tx.fulfillmentTask.findUniqueOrThrow({ where: { id: taskId } });
      await tx.fulfillmentTimeline.create({
        data: {
          taskId,
          fromStatus: FulfillmentStatus.PACKING,
          toStatus: FulfillmentStatus.PACKED,
          description: `Packing completed — ${session.cartonCount} carton(s)`,
          actorId: userId,
          warehouseId: t.warehouseId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'PACKING_COMPLETED',
          entityType: 'FulfillmentTask',
          entityId: taskId,
          detail: `${session.cartonCount} cartons`,
        },
      });
      return { session: s, task: t };
    });

    this.realtime.emitRequestUpdate({ action: 'packing_completed', taskId });
    return result;
  }
}
