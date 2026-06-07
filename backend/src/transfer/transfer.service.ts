import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { nanoid } from 'nanoid';

@Injectable()
export class TransferService {
  constructor(private prisma: PrismaService) {}

  findAll(status?: string) {
    return this.prisma.stockTransfer.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    dto: { stockItemId?: string; productLabel: string; quantity: number; fromLocation: string; toLocation: string; notes?: string },
    userId: string,
  ) {
    const trf = await this.prisma.stockTransfer.create({
      data: {
        refNumber: `TRF-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`,
        stockItemId: dto.stockItemId,
        productLabel: dto.productLabel,
        quantity: dto.quantity,
        fromLocation: dto.fromLocation,
        toLocation: dto.toLocation,
        notes: dto.notes,
        requestedById: userId,
        status: 'PENDING',
      },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'TRANSFER_REQUESTED', entityType: 'StockTransfer', entityId: trf.id, detail: trf.refNumber },
    });
    return trf;
  }

  // Complete transfer — apply destination location to linked stock item
  async complete(
    id: string,
    dest: { warehouseId?: string; rackId?: string; slotId?: string } | undefined,
    userId: string,
  ) {
    const trf = await this.prisma.stockTransfer.findUnique({ where: { id } });
    if (!trf) throw new NotFoundException('Transfer not found');

    if (trf.stockItemId && dest) {
      await this.prisma.stockItem.update({ where: { id: trf.stockItemId }, data: { ...dest } });
    }
    const updated = await this.prisma.stockTransfer.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'TRANSFER_COMPLETED',
        entityType: 'StockTransfer',
        entityId: id,
        detail: `${trf.fromLocation} → ${trf.toLocation}`,
      },
    });
    return updated;
  }
}
