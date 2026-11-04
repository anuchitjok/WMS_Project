import { RTV_CLOSED } from '../rtv/rtv.service';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockStatus, RequestStatus, FulfillmentStatus } from '@prisma/client';
import { getLowStockProducts, type LowStockProduct } from '../common/inventory-metrics';
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
      // Units (summed quantity), not stock rows — a bulk row of 20 is 20 available.
      this.prisma.stockItem
        .aggregate({ where: { status: StockStatus.AVAILABLE, ...wh }, _sum: { quantity: true } })
        .then((r) => r._sum.quantity ?? 0),
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
  // `lowStockList` lets a caller that already computed the shared low-stock
  // metric for the same scope pass it in instead of querying it twice.
  async getKpis(warehouseId?: WarehouseFilter, lowStockList?: LowStockProduct[]) {
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
      lowStockList ?? this.lowStock(warehouseId),
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
      // RTV (returns to vendor)
      'RTV_CREATED', 'RTV_CASE_CREATED', 'RTV_STATUS_CHANGED', 'RTV_REPLACEMENT_RECEIVED',
    ];
    const logs = await this.prisma.auditLog.findMany({
      where: { action: { in: OPERATIONAL_ACTIONS } },
      include: { user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
    });
    const refs = await this.activityRefs(logs);
    return logs.map((l) => ({ ...l, ref: (l.entityId && refs.get(`${l.entityType}:${l.entityId}`)) || null }));
  }

  /** Document numbers for activity rows (entityId is an internal id). Read-only lookups, batched per type. */
  private async activityRefs(logs: { entityType: string | null; entityId: string | null }[]) {
    const idsOf = (type: string) => [...new Set(logs.filter((l) => l.entityType === type && l.entityId).map((l) => l.entityId!))];
    const [gr, req, task, ship, stock, rtv] = await Promise.all([
      this.prisma.goodsReceiving.findMany({ where: { id: { in: idsOf('GoodsReceiving') } }, select: { id: true, refNumber: true } }),
      this.prisma.withdrawalRequest.findMany({ where: { id: { in: idsOf('WithdrawalRequest') } }, select: { id: true, refNumber: true } }),
      this.prisma.fulfillmentTask.findMany({ where: { id: { in: idsOf('FulfillmentTask') } }, select: { id: true, refNumber: true } }),
      // SHIPMENT_GOODS_ISSUED logs the shipment ref as entityId; others log the id.
      this.prisma.shipment.findMany({
        where: { OR: [{ id: { in: idsOf('Shipment') } }, { refNumber: { in: idsOf('Shipment') } }] },
        select: { id: true, refNumber: true },
      }),
      this.prisma.stockItem.findMany({ where: { id: { in: idsOf('StockItem') } }, select: { id: true, serialNumber: true, product: { select: { code: true } } } }),
      this.prisma.rTVCase.findMany({ where: { id: { in: idsOf('RTVCase') } }, select: { id: true, refNumber: true } }),
    ]);
    const map = new Map<string, string>();
    gr.forEach((r) => map.set(`GoodsReceiving:${r.id}`, r.refNumber));
    req.forEach((r) => map.set(`WithdrawalRequest:${r.id}`, r.refNumber));
    task.forEach((r) => map.set(`FulfillmentTask:${r.id}`, r.refNumber));
    ship.forEach((r) => { map.set(`Shipment:${r.id}`, r.refNumber); map.set(`Shipment:${r.refNumber}`, r.refNumber); });
    stock.forEach((r) => map.set(`StockItem:${r.id}`, r.serialNumber ? `${r.product.code} · ${r.serialNumber}` : r.product.code));
    rtv.forEach((r) => map.set(`RTVCase:${r.id}`, r.refNumber));
    return map;
  }

  // ── Dashboard V2 (additive — Section B: Inventory Health) ───────────────────
  async getInventoryHealth(warehouseId?: WarehouseFilter) {
    const where = warehouseId ? { warehouseId } : {};
    // Units per status (summed quantity), so the dashboard agrees with Inventory.
    const grouped = await this.prisma.stockItem.groupBy({
      by: ['status'],
      _sum: { quantity: true },
      where,
    });
    const by = (s: StockStatus) => grouped.find((g) => g.status === s)?._sum.quantity ?? 0;
    return {
      available: by(StockStatus.AVAILABLE),
      reserved: by(StockStatus.RESERVED),
      picked: by(StockStatus.PICKED),
      qcHold: by(StockStatus.QUARANTINE) + by(StockStatus.PENDING_INSPECTION),
      rtvPending: by(StockStatus.RTV_PENDING),
    };
  }
}
