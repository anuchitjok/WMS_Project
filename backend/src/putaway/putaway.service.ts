import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StockStatus } from '@prisma/client';

@Injectable()
export class PutawayService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

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
