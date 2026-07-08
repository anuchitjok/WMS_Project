import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { nanoid } from 'nanoid';

@Injectable()
export class AdjustmentService {
  constructor(private prisma: PrismaService) {}

  findAll(status?: string) {
    return this.prisma.stockAdjustment.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    dto: { stockItemId?: string; productLabel: string; reason: string; quantityBefore: number; quantityAfter: number; notes?: string },
    userId: string,
  ) {
    const adj = await this.prisma.stockAdjustment.create({
      data: {
        refNumber: `ADJ-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`,
        stockItemId: dto.stockItemId,
        productLabel: dto.productLabel,
        reason: dto.reason,
        quantityBefore: dto.quantityBefore,
        quantityAfter: dto.quantityAfter,
        notes: dto.notes,
        requestedById: userId,
        status: 'PENDING_APPROVAL',
      },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'ADJUSTMENT_REQUESTED', entityType: 'StockAdjustment', entityId: adj.id, detail: adj.refNumber },
    });
    return adj;
  }

  // Approve adjustment and apply quantity change to linked stock item
  async approve(id: string, userId: string) {
    const adj = await this.prisma.stockAdjustment.findUnique({ where: { id } });
    if (!adj) throw new NotFoundException('Adjustment not found');
    if (adj.status !== 'PENDING_APPROVAL') throw new BadRequestException('Adjustment is not pending approval');

    // Atomic: apply quantity change + mark completed + audit in one transaction
    const updated = await this.prisma.$transaction(async (tx) => {
      if (adj.stockItemId) {
        await tx.stockItem.update({ where: { id: adj.stockItemId }, data: { quantity: adj.quantityAfter } });
      }
      const result = await tx.stockAdjustment.update({
        where: { id },
        data: { status: 'COMPLETED', approvedById: userId, approvedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'ADJUSTMENT_APPROVED',
          entityType: 'StockAdjustment',
          entityId: id,
          detail: `${adj.quantityBefore} → ${adj.quantityAfter}`,
        },
      });
      return result;
    });
    return updated;
  }

  async reject(id: string, userId: string) {
    const adj = await this.prisma.stockAdjustment.findUnique({ where: { id } });
    if (!adj) throw new NotFoundException('Adjustment not found');
    if (adj.status !== 'PENDING_APPROVAL') throw new BadRequestException('Adjustment is not pending approval');
    const updated = await this.prisma.stockAdjustment.update({ where: { id }, data: { status: 'REJECTED', approvedById: userId } });
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'ADJUSTMENT_REJECTED',
        entityType: 'StockAdjustment',
        entityId: id,
        detail: `${adj.refNumber} · ${adj.quantityBefore} → ${adj.quantityAfter}`,
      },
    });
    return updated;
  }
}
