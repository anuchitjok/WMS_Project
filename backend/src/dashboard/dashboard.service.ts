import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockStatus, RequestStatus } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const [
      totalStock,
      availableStock,
      pendingRequests,
      totalProducts,
      stockByStatus,
      requestsByStatus,
      recentAuditLogs,
      lowStockAlerts,
    ] = await Promise.all([
      this.prisma.stockItem.count(),
      this.prisma.stockItem.count({ where: { status: StockStatus.AVAILABLE } }),
      this.prisma.withdrawalRequest.count({
        where: { status: { in: [RequestStatus.SUBMITTED, RequestStatus.PENDING_APPROVAL] } },
      }),
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.stockItem.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.withdrawalRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.auditLog.findMany({
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      // Low-stock alerts: count ONLY available stock vs minStock (previously this
      // counted ALL stock items incl. shipped/consumed, which was inaccurate).
      this.prisma.product.findMany({
        where: { isActive: true, minStock: { gt: 0 } },
        include: { _count: { select: { stockItems: { where: { status: StockStatus.AVAILABLE } } } } },
        orderBy: { minStock: 'desc' },
        take: 5,
      }),
    ]);

    return {
      totals: { totalStock, availableStock, pendingRequests, totalProducts },
      stockByStatus,
      requestsByStatus,
      recentAuditLogs,
      lowStockAlerts,
    };
  }
}
