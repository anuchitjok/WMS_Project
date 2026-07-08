import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScrapStatus } from '@prisma/client';
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
    const scrap = await this.prisma.scrapCase.create({
      data: {
        refNumber: this.genRef(),
        stockItemId: data.stockItemId,
        reason: data.reason,
        description: data.description,
        disposalMethod: data.disposalMethod,
        quantity: data.quantity ?? 1,
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

    const updated = await this.prisma.scrapCase.update({ where: { id }, data: { status, ...extra } });
    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'SCRAP_STATUS_CHANGED',
        entityType: 'ScrapCase',
        entityId: id,
        detail: `${scrap.refNumber}: ${scrap.status} → ${status}`,
      },
    });
    return updated;
  }
}
