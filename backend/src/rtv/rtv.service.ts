import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RTVStatus } from '@prisma/client';
import { nanoid } from 'nanoid';

@Injectable()
export class RtvService {
  constructor(private prisma: PrismaService) {}

  private genRef() {
    return `RTV-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
  }

  findAll(filter: { status?: RTVStatus; page?: number; limit?: number }) {
    const { status, page = 1, limit = 20 } = filter;
    const skip = (page - 1) * limit;
    return this.prisma.rTVCase.findMany({
      where: status ? { status } : {},
      include: {
        stockItem: { include: { product: true } },
        vendor: true,
        rtvOfficer: { select: { fullName: true } },
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const c = await this.prisma.rTVCase.findUnique({
      where: { id },
      include: {
        stockItem: { include: { product: { include: { brand: true } } } },
        vendor: true,
        rtvOfficer: { select: { fullName: true } },
      },
    });
    if (!c) throw new NotFoundException('RTV case not found');
    return c;
  }

  create(data: { stockItemId: string; reason: string; description?: string; vendorId?: string }, officerId: string) {
    return this.prisma.rTVCase.create({
      data: {
        refNumber: this.genRef(),
        stockItemId: data.stockItemId,
        reason: data.reason,
        description: data.description,
        vendorId: data.vendorId,
        rtvOfficerId: officerId,
      },
    });
  }

  updateStatus(id: string, status: RTVStatus) {
    return this.prisma.rTVCase.update({ where: { id }, data: { status } });
  }
}
