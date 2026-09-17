import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { InventoryOrchestrationService } from '../../inventory/inventory-orchestration.service';
import { FulfillmentStatus, Prisma } from '@prisma/client';
import { BarcodeParserService } from '../../scan/barcode-parser.service';
import { claimTaskStatus } from './task-state';

const parser = new BarcodeParserService();
const PICKABLE: FulfillmentStatus[] = [FulfillmentStatus.ALLOCATED, FulfillmentStatus.PICKING];

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
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) {
      throw new BadRequestException('qty must be a number ≥ 0');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const item = await this.pickInTx(tx, taskId, itemId, qty, userId, { barcode });
      await this.syncTaskProgress(tx, taskId, userId, barcode);
      return item;
    });

    this.realtime.emitInventoryUpdate({ action: 'pick_confirmed', taskId, itemId });
    return updated;
  }

  /** Confirms the full requested quantity of every item not yet picked (board "Next" at PICKING). */
  async confirmAllRemaining(taskId: string, userId: string, barcode?: string) {
    await this.prisma.$transaction(async (tx) => {
      const items = await tx.fulfillmentTaskItem.findMany({ where: { taskId, pickedAt: null } });
      if (items.length === 0) throw new ConflictException('All items are already picked');
      for (const it of items) {
        await this.pickInTx(tx, taskId, it.id, it.qtyRequested, userId);
      }
      await this.syncTaskProgress(tx, taskId, userId, barcode);
    });
    this.realtime.emitInventoryUpdate({ action: 'pick_confirmed', taskId });
  }

  /** One item pick inside the caller's transaction. */
  async pickInTx(
    tx: Prisma.TransactionClient,
    taskId: string,
    itemId: string,
    qty: number,
    userId: string,
    opts: { barcode?: string; note?: string; allowStatuses?: FulfillmentStatus[] } = {},
  ) {
    const { barcode, note, allowStatuses = PICKABLE } = opts;
    const item = await tx.fulfillmentTaskItem.findUnique({
      where: { id: itemId },
      include: { task: true },
    });
    if (!item || item.taskId !== taskId) throw new NotFoundException('Item not found in this task');
    if (item.pickedAt) throw new ConflictException('Item already picked (double-pick prevented)');
    if (!allowStatuses.includes(item.task.status)) {
      throw new ConflictException(`Task is ${item.task.status}; picking is not allowed in this status`);
    }

    // A line with no reserved unit has nothing to pick.
    const qtyPicked = item.stockItemId ? Math.min(qty, item.qtyRequested) : 0;
    const isShort = qtyPicked < item.qtyRequested;

    if (barcode && item.stockItemId) await this.assertBarcodeMatchesUnit(tx, item.stockItemId, barcode);

    // Claim the line: a concurrent confirm of the same line matches zero rows.
    const claimed = await tx.fulfillmentTaskItem.updateMany({
      where: { id: itemId, pickedAt: null },
      data: { qtyPicked, pickedAt: new Date(), isShortPick: isShort, scanEventId: barcode ?? null },
    });
    if (claimed.count === 0) throw new ConflictException('Item already picked (double-pick prevented)');

    // Stock moves to PICKED only when something was actually picked; a zero pick
    // stays reserved until the task is dispatched or cancelled.
    if (item.stockItemId && qtyPicked > 0) {
      await this.inventory.recordPickTransaction(tx, {
        stockItemId: item.stockItemId,
        qtyPicked,
        taskRef: item.task.refNumber,
        userId,
        barcode,
        note,
      });
    }
    return tx.fulfillmentTaskItem.findUnique({ where: { id: itemId } });
  }

  /** Recalculates progress and moves the task to PICKING / PICKED (guarded). */
  private async syncTaskProgress(tx: Prisma.TransactionClient, taskId: string, userId: string, barcode?: string) {
    const task = await tx.fulfillmentTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('FulfillmentTask not found');
    const allItems = await tx.fulfillmentTaskItem.findMany({ where: { taskId } });
    const totalReq = allItems.reduce((s, i) => s + i.qtyRequested, 0);
    const totalPicked = allItems.reduce((s, i) => s + i.qtyPicked, 0);
    const pct = totalReq > 0 ? Math.round((totalPicked / totalReq) * 100) : 0;
    const allPicked = allItems.every((i) => i.pickedAt !== null);
    const hasShortPick = allItems.some((i) => i.isShortPick);

    const newStatus = allPicked ? FulfillmentStatus.PICKED : FulfillmentStatus.PICKING;
    const extra: Prisma.FulfillmentTaskUncheckedUpdateManyInput = {
      progressPct: pct,
      partialPick: hasShortPick,
    };
    if (task.status === FulfillmentStatus.ALLOCATED || task.status === FulfillmentStatus.PICKING) {
      extra.pickedById = userId;
    }
    if (allPicked) extra.pickedAt = new Date();
    await claimTaskStatus(tx, taskId, PICKABLE, newStatus, extra);

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
  }

  /** Rejects a scan that does not identify the reserved unit (wrong item / wrong serial). */
  private async assertBarcodeMatchesUnit(tx: Prisma.TransactionClient, stockItemId: string, barcode: string) {
    const unit = await tx.stockItem.findUnique({
      where: { id: stockItemId },
      include: { product: { select: { code: true } } },
    });
    if (!unit) throw new NotFoundException('Reserved stock item not found');
    const parsed = parser.parse(barcode);
    const v = parsed.value;
    let ok: boolean;
    switch (parsed.type) {
      case 'stockItem': ok = v === unit.id; break;
      case 'serial': ok = !!unit.serialNumber && v === unit.serialNumber; break;
      case 'product': ok = !unit.serialNumber && v === unit.product.code; break;
      default:
        ok = v === unit.id || (!!unit.serialNumber && v === unit.serialNumber)
          || (!!unit.batchNumber && v === unit.batchNumber)
          || (!unit.serialNumber && v === unit.product.code);
    }
    if (!ok) throw new BadRequestException(`Scanned barcode "${barcode}" does not match the reserved unit`);
  }
}
