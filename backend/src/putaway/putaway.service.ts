import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StockStatus } from '@prisma/client';
import { boxFitsSlot } from './putaway-fit.util';

@Injectable()
export class PutawayService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  // Box-vs-slot fit check — read-only, no side effects. Called by the frontend
  // before confirm() so staff see a fits/doesn't-fit verdict without committing.
  async checkFit(slotId: string, box: { length: number; width: number; height: number }) {
    const slot = await this.prisma.slot.findUnique({
      where: { id: slotId },
      include: { _count: { select: { stockItems: true } } },
    });
    if (!slot) throw new NotFoundException('Slot not found');

    const hasSlotDimensions = slot.lengthCm != null && slot.widthCm != null && slot.heightCm != null;
    const fits = hasSlotDimensions
      ? boxFitsSlot(
          [box.length, box.width, box.height],
          [slot.lengthCm as number, slot.widthCm as number, slot.heightCm as number],
        )
      : null; // null = no verdict possible, not "doesn't fit"

    return {
      hasSlotDimensions,
      fits,
      box,
      slot: { id: slot.id, code: slot.code, lengthCm: slot.lengthCm, widthCm: slot.widthCm, heightCm: slot.heightCm },
      occupied: slot._count.stockItems,
      capacity: slot.capacity,
    };
  }

  // Items awaiting putaway = PENDING_INSPECTION
  pending() {
    return this.prisma.stockItem.findMany({
      where: { status: StockStatus.PENDING_INSPECTION },
      include: { product: { include: { brand: true } }, warehouse: true, rack: true, slot: true },
      orderBy: { receivedDate: 'asc' },
    });
  }

  // Confirm putaway: assign location and set AVAILABLE
  async confirm(
    stockItemId: string,
    location: { warehouseId?: string; rackId?: string; slotId?: string },
    userId: string,
  ) {
    const item = await this.prisma.stockItem.findUnique({ where: { id: stockItemId } });
    if (!item) throw new NotFoundException('Stock item not found');

    const updated = await this.prisma.stockItem.update({
      where: { id: stockItemId },
      data: { ...location, status: StockStatus.AVAILABLE },
      include: { product: true, warehouse: true, rack: true, slot: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'PUTAWAY_CONFIRMED',
        entityType: 'StockItem',
        entityId: stockItemId,
        detail: `Stored & made available`,
      },
    });
    this.realtime.emitInventoryUpdate({ action: 'putaway', item: updated });
    return updated;
  }
}
