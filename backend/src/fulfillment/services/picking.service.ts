import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { InventoryOrchestrationService } from '../../inventory/inventory-orchestration.service';
import { FulfillmentStatus } from '@prisma/client';

@Injectable()
export class PickingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly inventory: InventoryOrchestrationService,
  ) {}

  // Confirm pick for a single task item.
  // Prevents double-pick. Updates stock status and recalculates task progress.
  async confirmPick(
    taskId: string,
    itemId: string,
    qty: number,
    userId: string,
    barcode?: string,
  ) {
    const item = await this.prisma.fulfillmentTaskItem.findUnique({
      where: { id: itemId },
      include: { task: true },
    });
    if (!item || item.taskId !== taskId) throw new NotFoundException('Item not found in this task');
    if (item.pickedAt) throw new ConflictException('Item already picked (double-pick prevented)');

    const task = item.task;

    const updated = await this.prisma.$transaction(async (tx) => {
      const qtyPicked = Math.min(qty, item.qtyRequested);
      const isShort = qtyPicked < item.qtyRequested;

      const it = await tx.fulfillmentTaskItem.update({
        where: { id: itemId },
        data: {
          qtyPicked,
          pickedAt: new Date(),
          isShortPick: isShort,
          scanEventId: barcode ?? null,
        },
      });

      // Record pick transaction via orchestration service (stock → PICKED)
      if (item.stockItemId) {
        await this.inventory.recordPickTransaction(tx, {
          stockItemId: item.stockItemId,
          qtyPicked,
          taskRef: task.refNumber,
          userId,
          barcode,
        });
      }

      // Recalculate task progress
      const allItems = await tx.fulfillmentTaskItem.findMany({ where: { taskId } });
      const totalReq = allItems.reduce((s, i) => s + i.qtyRequested, 0);
      const totalPicked = allItems.reduce(
        (s, i) => s + (i.id === itemId ? qtyPicked : i.qtyPicked),
        0,
      );
      const pct = totalReq > 0 ? Math.round((totalPicked / totalReq) * 100) : 0;
      const allPicked = allItems.every((i) =>
        i.id === itemId ? true : i.pickedAt !== null,
      );
      const hasShortPick = allItems.some((i) =>
        i.id === itemId ? isShort : i.isShortPick,
      );

      const newStatus = allPicked ? FulfillmentStatus.PICKED : FulfillmentStatus.PICKING;
      const taskUpdate: any = {
        progressPct: pct,
        partialPick: hasShortPick,
        status: newStatus,
        version: { increment: 1 },
      };
      if (task.status === FulfillmentStatus.ALLOCATED || task.status === FulfillmentStatus.PICKING) {
        taskUpdate.pickedById = userId;
      }
      if (allPicked) taskUpdate.pickedAt = new Date();

      await tx.fulfillmentTask.update({ where: { id: taskId }, data: taskUpdate });

      if (allPicked) {
        await tx.fulfillmentTimeline.create({
          data: {
            taskId,
            fromStatus: FulfillmentStatus.PICKING,
            toStatus: FulfillmentStatus.PICKED,
            description: `All ${allItems.length} item(s) picked`,
            actorId: userId,
            barcode: barcode ?? null,
            warehouseId: task.warehouseId,
          },
        });
      }

      return it;
    });

    this.realtime.emitInventoryUpdate({ action: 'pick_confirmed', taskId, itemId });
    return updated;
  }
}
