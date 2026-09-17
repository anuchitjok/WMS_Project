import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { ON_HAND_UNCOMMITTED } from '../common/stock-state';
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

  // Approve adjustment and apply quantity change to linked stock item.
  // The change applies only if the stock still holds `quantityBefore` and is on
  // hand; otherwise the stock moved since the request and the approval is refused.
  async approve(id: string, userId: string) {
    const adj = await this.prisma.stockAdjustment.findUnique({ where: { id } });
    if (!adj) throw new NotFoundException('Adjustment not found');
    if (adj.status !== 'PENDING_APPROVAL') throw new BadRequestException('Adjustment is not pending approval');

    // Atomic: apply quantity change + mark completed + audit in one transaction
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stockAdjustment.updateMany({
        where: { id, status: 'PENDING_APPROVAL' },
        data: { status: 'COMPLETED', approvedById: userId, approvedAt: new Date() },
      });
      if (claimed.count === 0) throw new ConflictException('Adjustment has already been decided');

      if (adj.stockItemId) {
        const applied = await tx.stockItem.updateMany({
          where: { id: adj.stockItemId, quantity: adj.quantityBefore, status: { in: ON_HAND_UNCOMMITTED } },
          data: { quantity: adj.quantityAfter },
        });
        if (applied.count === 0) {
          const stock = await tx.stockItem.findUnique({ where: { id: adj.stockItemId }, select: { quantity: true, status: true } });
          if (!stock) throw new NotFoundException('Stock item not found');
          throw new ConflictException(
            `Stock changed since the adjustment was requested (now ${stock.quantity}, ${stock.status}; expected ${adj.quantityBefore}) — submit a new adjustment`,
          );
        }
      }
      await tx.auditLog.create({
        data: {
          userId,
          action: 'ADJUSTMENT_APPROVED',
          entityType: 'StockAdjustment',
          entityId: id,
          detail: `${adj.quantityBefore} → ${adj.quantityAfter}`,
        },
      });
      return tx.stockAdjustment.findUniqueOrThrow({ where: { id } });
    });
    return updated;
  }

  async reject(id: string, userId: string) {
    const adj = await this.prisma.stockAdjustment.findUnique({ where: { id } });
    if (!adj) throw new NotFoundException('Adjustment not found');
    if (adj.status !== 'PENDING_APPROVAL') throw new BadRequestException('Adjustment is not pending approval');
    const claimed = await this.prisma.stockAdjustment.updateMany({
      where: { id, status: 'PENDING_APPROVAL' },
      data: { status: 'REJECTED', approvedById: userId },
    });
    if (claimed.count === 0) throw new ConflictException('Adjustment has already been decided');
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'ADJUSTMENT_REJECTED',
        entityType: 'StockAdjustment',
        entityId: id,
        detail: `${adj.refNumber} · ${adj.quantityBefore} → ${adj.quantityAfter}`,
      },
    });
    return this.prisma.stockAdjustment.findUniqueOrThrow({ where: { id } });
  }
}
