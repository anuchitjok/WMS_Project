import { RTV_CLOSED } from '../rtv/rtv.service';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockStatus, RequestStatus, FulfillmentStatus } from '@prisma/client';
import { getLowStockProducts } from '../common/inventory-metrics';
import { SystemSettingsService } from '../settings/system-settings.service';

/** Prisma filter for StockItem/FulfillmentTask.warehouseId; undefined = all warehouses. */
export type WarehouseFilter = string | { in: string[] } | undefined;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService, private settings: SystemSettingsService) {}

  private async rtvOverdue(warehouse: WarehouseFilter): Promise<number | null> {
    const days = await this.settings.rtvAgingSlaDays();
    if (days === null) return null;
    return this.prisma.rTVCase.count({
      where: {
        status: { notIn: RTV_CLOSED },
        createdAt: { lt: new Date(Date.now() - days * 86_400_000) },
        ...(warehouse ? { stockItem: { warehouseId: warehouse } } : {}),
      },
    });
  }

  private async lowStock(warehouse: WarehouseFilter) {
    return getLowStockProducts(this.prisma, { warehouse, defaultThreshold: await this.settings.lowStockThreshold() });
  }

  async getStats(warehouse?: WarehouseFilter) {
    const wh = warehouse ? { warehouseId: warehouse } : {};
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
      this.prisma.stockItem.count({ where: wh }),
      this.prisma.stockItem.count({ where: { status: StockStatus.AVAILABLE, ...wh } }),
      this.prisma.withdrawalRequest.count({
        where: { status: { in: [RequestStatus.SUBMITTED, RequestStatus.PENDING_APPROVAL] } },
      }),
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.stockItem.groupBy({ by: ['status'], _count: { _all: true }, where: wh }),
      this.prisma.withdrawalRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.auditLog.findMany({
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      // Low-stock alerts via the single shared metric (available-based).
      this.lowStock(warehouse),
    ]);

    return {
      totals: { totalStock, availableStock, pendingRequests, totalProducts },
      stockByStatus,
      requestsByStatus,
      recentAuditLogs,
      lowStockAlerts: lowStockAlerts.slice(0, 5),
    };
  }

  // ── Dashboard V2 (additive — Section A: Executive KPIs) ─────────────────────
  async getKpis(warehouseId?: WarehouseFilter) {
    const since = startOfToday();
    const whStock = warehouseId ? { warehouseId } : {};
    const [
      todayReceiving,
      pendingPutaway,
      pendingApproval,
      activeFulfillment,
      shipmentToday,
      openReturnRequests,
      openRtv,
      lowStock,
    ] = await Promise.all([
      this.prisma.goodsReceiving.count({ where: { createdAt: { gte: since } } }),
      this.prisma.stockItem.count({ where: { status: StockStatus.PENDING_INSPECTION, ...whStock } }),
      this.prisma.withdrawalRequest.count({ where: { status: { in: [RequestStatus.SUBMITTED, RequestStatus.PENDING_APPROVAL] } } }),
      this.prisma.fulfillmentTask.count({ where: { status: { notIn: [FulfillmentStatus.CLOSED, FulfillmentStatus.CANCELLED, FulfillmentStatus.RETURNED] }, ...(warehouseId ? { warehouseId } : {}) } }),
      this.prisma.shipment.count({ where: { shippedAt: { gte: since } } }),
      this.prisma.withdrawalRequest.count({ where: { status: { not: RequestStatus.COMPLETED }, items: { some: { usageStatus: { in: ['UNUSED', 'WRONG_ITEM'] } } } } }),
      this.prisma.rTVCase.count({ where: { status: { notIn: ['COMPLETED', 'CANCELLED'] as any }, ...(warehouseId ? { stockItem: { warehouseId } } : {}) } }),
      this.lowStock(warehouseId),
    ]);

    return {
      todayReceiving,
      pendingPutaway,
      pendingApproval,
      activeFulfillment,
      shipmentToday,
      openReturns: openReturnRequests + openRtv,
      // Open RTV cases past the `rtv.agingSla` setting (null when no SLA is in force).
      rtvOverdue: await this.rtvOverdue(warehouseId),
      lowStockAlerts: lowStock.length,
      // Inventory Accuracy intentionally NOT implemented (no validated cycle-count
      // source yet). Returned as null so the UI shows "N/A" rather than a fake number.
      inventoryAccuracy: null as number | null,
    };
  }

  // ── Operational Activity (Receiving/Putaway/Approval/Shipment/RMA) ──────────
  // Server-side filtered to real operational events; excludes generic
  // notifications/logins so the dashboard shows meaningful warehouse activity.
  async getActivity(limit = 15) {
    const OPERATIONAL_ACTIONS = [
      // Receiving
      'GOODS_RECEIVED', 'RECEIVING_VERIFIED',
      // Putaway
      'PUTAWAY_CONFIRMED',
      // Approval
      'REQUEST_SUBMITTED', 'REQUEST_APPROVED', 'REQUEST_REJECTED', 'REQUEST_CANCELLED',
      'APPROVAL_COMPLETED', 'APPROVAL_REJECTED',
      // Fulfillment (pick/pack)
      'FULFILLMENT_ALLOCATED', 'FULFILLMENT_ADVANCE', 'FULFILLMENT_EXCEPTION', 'STOCK_PICKED', 'PACKING_COMPLETED',
      // Shipment / Goods Issue
      'SHIPMENT_CREATED', 'SHIPMENT_DISPATCHED', 'SHIPMENT_GOODS_ISSUED', 'GOODS_ISSUED',
      // RMA / Returns
      'RMA_USAGE_CONFIRMED', 'HANDOVER_CONFIRMED', 'UNUSED_RETURNED_TO_STOCK', 'UNUSED_MARKED_DOA',
    ];
    return this.prisma.auditLog.findMany({
      where: { action: { in: OPERATIONAL_ACTIONS } },
      include: { user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
    });
  }

  // ── Dashboard V2 (additive — Section B: Inventory Health) ───────────────────
  async getInventoryHealth(warehouseId?: WarehouseFilter) {
    const where = warehouseId ? { warehouseId } : {};
    const grouped = await this.prisma.stockItem.groupBy({
      by: ['status'],
      _count: { _all: true },
      where,
    });
    const by = (s: StockStatus) => grouped.find((g) => g.status === s)?._count._all ?? 0;
    return {
      available: by(StockStatus.AVAILABLE),
      reserved: by(StockStatus.RESERVED),
      picked: by(StockStatus.PICKED),
      qcHold: by(StockStatus.QUARANTINE) + by(StockStatus.PENDING_INSPECTION),
      rtvPending: by(StockStatus.RTV_PENDING),
    };
  }
}
