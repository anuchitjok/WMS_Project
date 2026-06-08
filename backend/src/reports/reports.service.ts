import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockStatus, RequestStatus, RTVStatus } from '@prisma/client';
import { getLowStockProducts } from '../common/inventory-metrics';

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
      lowStockItems,
      stockByOwnership,
      stockByWarehouse,
    ] = await Promise.all([
      this.prisma.withdrawalRequest.count(),
      this.prisma.withdrawalRequest.count({ where: { status: RequestStatus.COMPLETED } }),
      this.prisma.stockItem.count({ where: { status: { in: [StockStatus.DOA, StockStatus.DAMAGED] } } }),
      this.prisma.stockItem.count(),
      this.prisma.rTVCase.count({ where: { status: { not: RTVStatus.COMPLETED } } }),
      // Single shared low-stock metric (available-based) — consistent with dashboard.
      getLowStockProducts(this.prisma),
      this.prisma.stockItem.groupBy({ by: ['ownershipType'], _count: { _all: true }, _sum: { quantity: true } }),
      this.prisma.stockItem.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const slaRate = totalRequests > 0 ? Math.round((completedRequests / totalRequests) * 100) : 0;
    const doaRate = totalStockItems > 0 ? ((doaCount / totalStockItems) * 100).toFixed(1) : '0.0';

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
      lowStockItems: lowStockItems.map((p) => ({ code: p.code, name: p.name, onHand: p.available, minStock: p.minStock })),
    };
  }
}
