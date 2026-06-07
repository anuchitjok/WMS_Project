import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StockStatus, RTVStatus } from '@prisma/client';
import { nanoid } from 'nanoid';

@Injectable()
export class DoaService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  // DOA / defective / quarantine stock items
  list() {
    return this.prisma.stockItem.findMany({
      where: { status: { in: [StockStatus.DOA, StockStatus.DAMAGED, StockStatus.QUARANTINE, StockStatus.RTV_PENDING] } },
      include: { product: { include: { brand: true } }, warehouse: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  // Mark a stock item DOA (e.g. discovered during inspection)
  async declare(stockItemId: string, reason: string, userId: string) {
    const item = await this.prisma.stockItem.findUnique({ where: { id: stockItemId } });
    if (!item) throw new NotFoundException('Stock item not found');
    const updated = await this.prisma.stockItem.update({
      where: { id: stockItemId },
      data: { status: StockStatus.DOA, notes: reason },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'DOA_DECLARED', entityType: 'StockItem', entityId: stockItemId, detail: reason },
    });
    this.realtime.emitInventoryUpdate({ action: 'doa', stockItemId });
    return updated;
  }

  // Create RTV case from a DOA/defective stock item
  async createRtv(stockItemId: string, vendorId: string | undefined, userId: string) {
    const item = await this.prisma.stockItem.findUnique({ where: { id: stockItemId }, include: { product: true } });
    if (!item) throw new NotFoundException('Stock item not found');

    const rtv = await this.prisma.rTVCase.create({
      data: {
        refNumber: `RTV-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`,
        stockItemId,
        reason: item.status === StockStatus.DOA ? 'doa' : 'defective',
        description: `Created from DOA management for ${item.product.code}`,
        status: RTVStatus.RTV_REQUIRED,
        vendorId,
        rtvOfficerId: userId,
      },
    });
    await this.prisma.stockItem.update({ where: { id: stockItemId }, data: { status: StockStatus.RTV_PENDING } });
    await this.prisma.auditLog.create({
      data: { userId, action: 'RTV_CREATED', entityType: 'RTVCase', entityId: rtv.id, detail: rtv.refNumber },
    });
    this.realtime.emitInventoryUpdate({ action: 'rtv_created', refNumber: rtv.refNumber });
    return rtv;
  }
}
