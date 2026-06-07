import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockStatus, RequestStatus, RTVStatus } from '@prisma/client';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const [
      totalRequests,
      completedRequests,
      doaCount,
      totalStockItems,
      openRtv,
      lowStock,
      stockByOwnership,
      stockByWarehouse,
    ] = await Promise.all([
      this.prisma.withdrawalRequest.count(),
      this.prisma.withdrawalRequest.count({ where: { status: RequestStatus.COMPLETED } }),
      this.prisma.stockItem.count({ where: { status: { in: [StockStatus.DOA, StockStatus.DAMAGED] } } }),
      this.prisma.stockItem.count(),
      this.prisma.rTVCase.count({ where: { status: { not: RTVStatus.COMPLETED } } }),
      this.prisma.product.findMany({
        where: { minStock: { gt: 0 } },
        include: { _count: { select: { stockItems: true } } },
      }),
      this.prisma.stockItem.groupBy({ by: ['ownershipType'], _count: { _all: true }, _sum: { quantity: true } }),
      this.prisma.stockItem.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const slaRate = totalRequests > 0 ? Math.round((completedRequests / totalRequests) * 100) : 0;
    const doaRate = totalStockItems > 0 ? ((doaCount / totalStockItems) * 100).toFixed(1) : '0.0';
    const lowStockItems = lowStock.filter((p) => p._count.stockItems <= p.minStock);

    return {
      kpis: {
        slaRate,
        doaRate,
        openRtv,
        lowStockCount: lowStockItems.length,
        totalRequests,
        completedRequests,
        totalStockItems,
      },
      stockByOwnership,
      stockByWarehouse,
      lowStockItems: lowStockItems.map((p) => ({ code: p.code, name: p.name, onHand: p._count.stockItems, minStock: p.minStock })),
    };
  }
}
