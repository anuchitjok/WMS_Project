import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScrapStatus, StockStatus } from '@prisma/client';
import { ON_HAND_UNCOMMITTED, transitionStock } from '../common/stock-state';
import { nanoid } from 'nanoid';

@Injectable()
export class ScrapService {
  constructor(private prisma: PrismaService) {}

  private genRef() {
    return `SCRAP-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
  }

  findAll(filter: { status?: ScrapStatus; page?: number; limit?: number }) {
    const { status, page = 1, limit = 20 } = filter;
    const skip = (page - 1) * limit;
    return this.prisma.scrapCase.findMany({
      where: status ? { status } : {},
      include: {
        stockItem: { include: { product: { include: { brand: true } } } },
        requestedBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const c = await this.prisma.scrapCase.findUnique({
      where: { id },
      include: {
        stockItem: { include: { product: { include: { brand: true } } } },
        requestedBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
      },
    });
    if (!c) throw new NotFoundException('Scrap case not found');
    return c;
  }

  async create(
    data: { stockItemId: string; reason: string; description?: string; disposalMethod?: string; quantity?: number },
    requestedById: string,
  ) {
    const stock = await this.prisma.stockItem.findUnique({ where: { id: data.stockItemId } });
    if (!stock) throw new NotFoundException('Stock item not found');
    if (!data.reason || typeof data.reason !== 'string') throw new BadRequestException('reason is required');
    const quantity = data.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > stock.quantity) {
      throw new BadRequestException(`quantity must be a whole number between 1 and ${stock.quantity}`);
    }
    if (!ON_HAND_UNCOMMITTED.includes(stock.status)) {
      throw new BadRequestException(`Stock in status ${stock.status} cannot be scrapped`);
    }
    const open = await this.prisma.scrapCase.findFirst({
      where: { stockItemId: data.stockItemId, status: { in: [ScrapStatus.PENDING_REVIEW, ScrapStatus.APPROVED] } },
      select: { refNumber: true },
    });
    if (open) throw new ConflictException(`Stock item already has an open scrap case: ${open.refNumber}`);

    const scrap = await this.prisma.scrapCase.create({
      data: {
        refNumber: this.genRef(),
        stockItemId: data.stockItemId,
        reason: data.reason,
        description: data.description,
        disposalMethod: data.disposalMethod,
        quantity,
        requestedById,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: requestedById,
        action: 'SCRAP_CASE_CREATED',
        entityType: 'ScrapCase',
        entityId: scrap.id,
        detail: `${scrap.refNumber} · ${data.reason}`,
      },
    });
    return scrap;
  }

  async updateStatus(id: string, status: ScrapStatus, actorId: string) {
    const scrap = await this.prisma.scrapCase.findUnique({ where: { id } });
    if (!scrap) throw new NotFoundException('Scrap case not found');

    const allowed: Record<string, ScrapStatus[]> = {
      PENDING_REVIEW: ['APPROVED', 'REJECTED', 'CANCELLED'],
      APPROVED: ['DISPOSED', 'CANCELLED'],
    };
    if (!allowed[scrap.status]?.includes(status)) {
      throw new BadRequestException(`Cannot transition from ${scrap.status} to ${status}`);
    }

    const extra: any = {};
    if (status === 'APPROVED') { extra.approvedById = actorId; extra.approvedAt = new Date(); }
    if (status === 'DISPOSED') extra.disposedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      // Claim the transition: a double click cannot dispose (and deduct) twice.
      const claimed = await tx.scrapCase.updateMany({ where: { id, status: scrap.status }, data: { status, ...extra } });
      if (claimed.count === 0) throw new ConflictException('Scrap case was changed by someone else — reload and retry');

      // Disposal removes the goods from inventory: the scrapped quantity leaves the
      // row, or the whole row is closed when nothing remains.
      if (status === 'DISPOSED') {
        const stock = await tx.stockItem.findUnique({ where: { id: scrap.stockItemId } });
        if (!stock) throw new NotFoundException('Stock item not found');
        if (stock.quantity > scrap.quantity && !stock.serialNumber) {
          const reduced = await tx.stockItem.updateMany({
            where: { id: stock.id, quantity: stock.quantity, status: { in: ON_HAND_UNCOMMITTED } },
            data: { quantity: stock.quantity - scrap.quantity },
          });
          if (reduced.count === 0) {
            throw new ConflictException(`Stock item is ${stock.status} and cannot be scrapped`);
          }
        } else {
          await transitionStock(tx, stock.id, ON_HAND_UNCOMMITTED, StockStatus.CLOSED);
        }
        await tx.auditLog.create({
          data: {
            userId: actorId,
            action: 'STOCK_SCRAPPED',
            entityType: 'StockItem',
            entityId: stock.id,
            detail: `${scrap.refNumber}: ${scrap.quantity} disposed`,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'SCRAP_STATUS_CHANGED',
          entityType: 'ScrapCase',
          entityId: id,
          detail: `${scrap.refNumber}: ${scrap.status} → ${status}`,
        },
      });
      return tx.scrapCase.findUniqueOrThrow({ where: { id } });
    });
  }
}
