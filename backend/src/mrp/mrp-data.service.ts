import { Injectable } from '@nestjs/common';
import { RequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isUnifiedReservationEnabled } from '../common/feature-flags';
import { DEFAULT_MRP_CONFIG, MrpConfigShape, mergeConfig } from './engine/config';
import { MaterialSnapshot, ResolvedParams, SupplierTerms } from './engine/material';
import { addPeriods, periodStart } from './engine/periods';

export interface SnapshotScope {
  asOf: Date;
  /** Plan one warehouse; null = network plan over `scope`. */
  warehouseId: string | null;
  /** Warehouses the runner may see; null = unrestricted. */
  scope: string[] | null;
  productIds?: string[];
}

type Event = MaterialSnapshot['usage'][number] & { productId: string; warehouseId: string | null };

/**
 * Reads the authoritative WMS records and turns them into MaterialSnapshots.
 * Data sources (docs/WARRANTY_MRP.md, section 3):
 *   stock              StockItem (quantity by status)
 *   issues             FulfillmentTaskItem.qtyPicked on dispatched shipments (Shipment.shippedAt)
 *   unused returns     WithdrawalRequestItem usageStatus=UNUSED, dated by the UNUSED_RETURNED_TO_STOCK audit entry
 *   confirmed usage    WithdrawalRequestItem usageStatus=USED, dated by the RMA_USAGE_CONFIRMED audit entry
 *   open demand        WithdrawalRequest lines that do not hold stock yet
 *   inbound supply     InboundSupplyLine (imported PO lines) + GoodsReceiving booked against the PO number
 */
@Injectable()
export class MrpDataService {
  constructor(private prisma: PrismaService) {}

  async loadConfig(): Promise<{ config: MrpConfigShape; version: number; stored: boolean }> {
    const row = await this.prisma.mrpConfig.findUnique({ where: { key: 'default' } });
    if (!row) return { config: DEFAULT_MRP_CONFIG, version: 0, stored: false };
    return { config: mergeConfig(row.config), version: row.version, stored: true };
  }

  /** Warehouses the snapshot covers: one warehouse, the runner's scope, or everything (null). */
  private inScope(opts: SnapshotScope) {
    const allowed = opts.warehouseId ? [opts.warehouseId] : opts.scope;
    return (wh: string | null | undefined) => (allowed ? !!wh && allowed.includes(wh) : true);
  }

  /**
   * First goods issue of each product when it falls inside the history window
   * (`from`..asOf). Products already issued before `from` are left out: their history
   * covers the whole window. Products never issued are left out too.
   * Planning drops the window's periods before this date, because a part that did not
   * exist yet had no demand to measure (not zero demand).
   */
  async firstUsageInWindow(opts: SnapshotScope, from: Date, events: Event[]): Promise<Map<string, string>> {
    const first = new Map<string, string>();
    for (const e of events) {
      if (e.kind !== 'ISSUE') continue;
      const cur = first.get(e.productId);
      if (!cur || e.date < cur) first.set(e.productId, e.date);
    }
    if (!first.size) return first;
    const before = await this.issuedBefore(opts, from, [...first.keys()]);
    for (const id of before) first.delete(id);
    return first;
  }

  /** Products (of `productIds`) with an in-scope goods issue shipped before `from`. */
  private async issuedBefore(opts: SnapshotScope, from: Date, productIds: string[]): Promise<Set<string>> {
    const allowed = opts.warehouseId ? [opts.warehouseId] : opts.scope;
    const base = { qtyPicked: { gt: 0 }, productId: { in: productIds } };
    const shipped = { status: { not: 'CANCELLED' as const }, shipment: { is: { shippedAt: { lt: from } } } };
    const found = new Set<string>();
    if (!allowed) {
      const rows = await this.prisma.fulfillmentTaskItem.groupBy({ by: ['productId'], where: { ...base, task: shipped } });
      rows.forEach((r) => found.add(r.productId));
      return found;
    }
    // Same warehouse rule as usageEvents: the task's warehouse, else the picked stock item's.
    const direct = await this.prisma.fulfillmentTaskItem.groupBy({ by: ['productId'], where: { ...base, task: { ...shipped, warehouseId: { in: allowed } } } });
    direct.forEach((r) => found.add(r.productId));
    const loose = await this.prisma.fulfillmentTaskItem.findMany({
      where: { ...base, productId: { in: productIds.filter((id) => !found.has(id)) }, task: { ...shipped, warehouseId: null } },
      distinct: ['productId', 'stockItemId'], select: { productId: true, stockItemId: true },
    });
    const wh = await this.stockWarehouseMap(loose.map((i) => i.stockItemId));
    for (const i of loose) {
      const w = i.stockItemId ? wh.get(i.stockItemId) : undefined;
      if (w && allowed.includes(w)) found.add(i.productId);
    }
    return found;
  }

  async usageEvents(opts: SnapshotScope, from: Date): Promise<Event[]> {
    const ok = this.inScope(opts);
    const productFilter = opts.productIds ? { in: opts.productIds } : undefined;
    const events: Event[] = [];

    // 1. Goods issue (the only place stock leaves the warehouse).
    const issued = await this.prisma.fulfillmentTaskItem.findMany({
      where: {
        qtyPicked: { gt: 0 },
        productId: productFilter,
        task: { status: { not: 'CANCELLED' }, shipment: { is: { shippedAt: { gte: from, lte: opts.asOf } } } },
      },
      select: {
        productId: true, qtyPicked: true, stockItemId: true,
        task: { select: { warehouseId: true, requestRef: true, shipment: { select: { shippedAt: true, refNumber: true } } } },
      },
    });
    const whOfStock = await this.stockWarehouseMap(issued.filter((i) => !i.task.warehouseId).map((i) => i.stockItemId));
    for (const i of issued) {
      const wh = i.task.warehouseId ?? (i.stockItemId ? whOfStock.get(i.stockItemId) ?? null : null);
      if (!ok(wh)) continue;
      events.push({
        productId: i.productId, warehouseId: wh, kind: 'ISSUE', qty: i.qtyPicked,
        date: i.task.shipment!.shippedAt!.toISOString(), ref: `${i.task.shipment!.refNumber} / ${i.task.requestRef}`,
      });
    }

    // 2. Unused returns and 3. confirmed usage — dated by their audit entries.
    const audits = await this.prisma.auditLog.findMany({
      where: { action: { in: ['UNUSED_RETURNED_TO_STOCK', 'RMA_USAGE_CONFIRMED'] }, createdAt: { gte: from, lte: opts.asOf } },
      select: { action: true, entityId: true, detail: true, createdAt: true },
    });
    const returned = new Map<string, Date>();
    const used = new Map<string, Date>();
    for (const a of audits) {
      if (!a.entityId) continue;
      if (a.action === 'UNUSED_RETURNED_TO_STOCK') returned.set(a.entityId, a.createdAt);
      else if (a.detail === 'Usage: USED') used.set(a.entityId, a.createdAt);
    }
    const reqIds = [...new Set([...returned.keys(), ...used.keys()])];
    if (reqIds.length) {
      const items = await this.prisma.withdrawalRequestItem.findMany({
        where: { requestId: { in: reqIds }, usageStatus: { in: ['UNUSED', 'USED'] }, productId: productFilter },
        select: {
          requestId: true, productId: true, usageStatus: true, quantityIssued: true, quantityApproved: true, quantityRequested: true,
          shippedStockItemId: true, stockItemId: true, request: { select: { refNumber: true } },
        },
      });
      const wh = await this.stockWarehouseMap(items.map((i) => i.shippedStockItemId ?? i.stockItemId));
      for (const i of items) {
        const qty = i.quantityIssued > 0 ? i.quantityIssued : i.quantityApproved ?? i.quantityRequested;
        const sid = i.shippedStockItemId ?? i.stockItemId;
        const w = sid ? wh.get(sid) ?? null : null;
        if (!ok(w)) continue;
        if (i.usageStatus === 'UNUSED' && returned.has(i.requestId)) {
          events.push({ productId: i.productId, warehouseId: w, kind: 'RETURN', qty, date: returned.get(i.requestId)!.toISOString(), ref: i.request.refNumber });
        }
        if (i.usageStatus === 'USED' && used.has(i.requestId)) {
          events.push({ productId: i.productId, warehouseId: w, kind: 'CONSUMED', qty, date: used.get(i.requestId)!.toISOString(), ref: i.request.refNumber });
        }
      }
    }
    return events;
  }

  private async stockWarehouseMap(ids: Array<string | null | undefined>) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string | null>();
    const rows = await this.prisma.stockItem.findMany({ where: { id: { in: unique } }, select: { id: true, warehouseId: true } });
    return new Map(rows.map((r) => [r.id, r.warehouseId]));
  }

  async buildSnapshots(opts: SnapshotScope, cfg: MrpConfigShape): Promise<{ snapshots: MaterialSnapshot[]; warnings: string[] }> {
    const warnings: string[] = [];
    const g = cfg.granularity;
    const from = addPeriods(periodStart(opts.asOf, g), -cfg.historyPeriods, g);
    const ok = this.inScope(opts);
    const productFilter = opts.productIds ? { in: opts.productIds } : undefined;
    const unrestricted = !opts.warehouseId && !opts.scope;

    // Stock by product and status (warehouse-filtered in memory to keep null-warehouse rows for unrestricted runs).
    const stockRows = await this.prisma.stockItem.groupBy({
      by: ['productId', 'status', 'warehouseId'],
      where: { productId: productFilter },
      _sum: { quantity: true },
    });
    const stock = new Map<string, Array<{ status: string; quantity: number }>>();
    for (const r of stockRows) {
      if (!ok(r.warehouseId)) continue;
      const list = stock.get(r.productId) ?? [];
      const ex = list.find((x) => x.status === r.status);
      if (ex) ex.quantity += r._sum.quantity ?? 0;
      else list.push({ status: r.status, quantity: r._sum.quantity ?? 0 });
      stock.set(r.productId, list);
    }

    const events = await this.usageEvents(opts, from);
    const firstUsage = await this.firstUsageInWindow(opts, from, events);

    // Open demand: request lines that hold no stock yet. Requests are not tied to a
    // warehouse (approval reserves from any warehouse), so they are only planned at
    // network level for an unrestricted planner.
    const demand = new Map<string, MaterialSnapshot['demand']>();
    if (unrestricted) {
      const statuses: RequestStatus[] = [];
      if (cfg.includeUnapprovedRequests) statuses.push(RequestStatus.SUBMITTED, RequestStatus.PENDING_APPROVAL);
      if (isUnifiedReservationEnabled()) statuses.push(RequestStatus.APPROVED);
      if (statuses.length) {
        const reqs = await this.prisma.withdrawalRequest.findMany({
          where: { status: { in: statuses } },
          select: { id: true, refNumber: true, status: true, requiredDate: true, createdAt: true, items: { select: { productId: true, quantityRequested: true, quantityApproved: true } } },
        });
        const withTask = new Set(
          (await this.prisma.fulfillmentTask.findMany({
            where: { requestId: { in: reqs.filter((r) => r.status === RequestStatus.APPROVED).map((r) => r.id) }, status: { notIn: ['CANCELLED', 'RETURNED'] } },
            select: { requestId: true },
          })).map((t) => t.requestId),
        );
        for (const r of reqs) {
          if (withTask.has(r.id)) continue; // allocated — the stock is already counted as allocated
          for (const it of r.items) {
            if (opts.productIds && !opts.productIds.includes(it.productId)) continue;
            const list = demand.get(it.productId) ?? [];
            list.push({ date: (r.requiredDate ?? r.createdAt).toISOString(), qty: it.quantityApproved ?? it.quantityRequested, ref: r.refNumber, status: r.status });
            demand.set(it.productId, list);
          }
        }
      }
    } else {
      warnings.push('Open withdrawal requests are not included: requests are not tied to a warehouse, so they are planned only in an all-warehouse run by a planner without warehouse restrictions.');
    }

    // Inbound supply (imported PO lines) in scope.
    const po = await this.prisma.inboundSupplyLine.findMany({ where: { status: { in: ['OPEN', 'PARTIAL'] }, productId: productFilter } });
    const poInScope = po.filter((l) => (l.warehouseId ? ok(l.warehouseId) : unrestricted));
    const unassigned = po.filter((l) => !l.warehouseId).length;
    if (!unrestricted && unassigned) warnings.push(`${unassigned} open PO line(s) have no warehouse and are left out of this restricted plan.`);
    const poNumbers = [...new Set(poInScope.map((l) => l.poNumber))];
    const receipts = poNumbers.length
      ? await this.prisma.goodsReceivingItem.findMany({
          where: {
            receiving: { poNumber: { in: poNumbers }, OR: [{ statusEnum: null }, { statusEnum: { notIn: ['CANCELLED', 'REJECTED'] } }] },
          },
          select: { productId: true, quantity: true, receiving: { select: { poNumber: true, receivedDate: true } } },
        })
      : [];

    const productIds = new Set<string>([...stock.keys(), ...events.map((e) => e.productId), ...demand.keys(), ...poInScope.map((l) => l.productId)]);
    const params = await this.prisma.materialPlanningParam.findMany({
      where: { productId: productFilter, effectiveFrom: { lte: opts.asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: opts.asOf } }] },
      orderBy: { effectiveFrom: 'desc' },
    });
    for (const p of params) if (!p.warehouseId || p.warehouseId === opts.warehouseId) productIds.add(p.productId);
    if (opts.productIds) for (const id of opts.productIds) productIds.add(id);

    const ids = [...productIds];
    const [products, suppliers, overrides] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: ids } } }),
      this.prisma.materialSupplier.findMany({ where: { productId: { in: ids }, isActive: true, isApproved: true } }),
      this.prisma.forecastOverride.findMany({
        where: {
          productId: { in: ids },
          status: { in: cfg.overrideRequiresApproval ? ['APPROVED'] : ['APPROVED', 'PENDING'] },
          periodType: g,
          periodStart: { gte: periodStart(opts.asOf, g) },
          warehouseId: opts.warehouseId ?? null,
        },
      }),
    ]);
    const vendors = await this.prisma.vendor.findMany({ where: { id: { in: [...new Set(suppliers.map((s) => s.vendorId))] } }, select: { id: true, name: true } });
    const vendorName = new Map(vendors.map((v) => [v.id, v.name]));

    const snapshots: MaterialSnapshot[] = [];
    for (const prod of products.sort((a, b) => a.code.localeCompare(b.code))) {
      const pRows = params.filter((p) => p.productId === prod.id);
      const p = pRows.find((x) => opts.warehouseId && x.warehouseId === opts.warehouseId) ?? pRows.find((x) => !x.warehouseId) ?? null;
      const sup = suppliers.filter((s) => s.productId === prod.id).map<SupplierTerms>((s) => ({
        vendorId: s.vendorId, vendorName: vendorName.get(s.vendorId) ?? s.vendorId, supplierPartNumber: s.supplierPartNumber,
        isPreferred: s.isPreferred, leadTimeDays: s.leadTimeDays, moq: s.moq, orderMultiple: s.orderMultiple,
        unitPrice: s.unitPrice, currency: s.currency, priceSource: s.priceSource,
        priceValidFrom: s.priceValidFrom?.toISOString() ?? null, priceValidTo: s.priceValidTo?.toISOString() ?? null,
        purchaseUom: s.purchaseUom, uomConversion: s.uomConversion,
      }));
      const preferred = sup.find((s) => s.isPreferred) ?? null;
      snapshots.push({
        asOf: opts.asOf.toISOString(),
        productId: prod.id,
        sku: prod.code,
        description: prod.name,
        category: prod.category,
        unit: prod.unit,
        productStatus: prod.productStatus,
        productUnitCost: prod.unitCost,
        warehouseId: opts.warehouseId,
        params: p ? toResolved(p) : null,
        supplier: preferred,
        alternatives: sup.filter((s) => s !== preferred),
        stock: stock.get(prod.id) ?? [],
        usage: events.filter((e) => e.productId === prod.id).map(({ date, qty, kind, ref }) => ({ date, qty, kind, ref })).sort((a, b) => a.date.localeCompare(b.date)),
        firstUsageDate: firstUsage.get(prod.id) ?? null,
        demand: (demand.get(prod.id) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
        poLines: poInScope.filter((l) => l.productId === prod.id).map((l) => ({
          id: l.id, poNumber: l.poNumber, lineNumber: l.lineNumber, productId: l.productId, status: l.status,
          orderedQty: l.orderedQty, receivedQty: l.receivedQty, cancelledQty: l.cancelledQty,
          expectedDate: l.expectedDate?.toISOString() ?? null, orderDate: l.orderDate?.toISOString() ?? null,
          isConfirmed: l.isConfirmed, uom: l.uom, vendorId: l.vendorId, unitCost: l.unitCost, currency: l.currency,
        })),
        wmsReceipts: receipts.filter((r) => r.productId === prod.id).map((r) => ({ poNumber: r.receiving.poNumber!, productId: r.productId, quantity: r.quantity, date: r.receiving.receivedDate.toISOString() })),
        overrides: overrides.filter((o) => o.productId === prod.id).map((o) => ({ id: o.id, periodStart: o.periodStart.toISOString(), mode: o.mode as 'REPLACE' | 'ADD', quantity: o.quantity })),
      });
    }
    return { snapshots, warnings };
  }
}

function toResolved(p: {
  id: string; warehouseId: string | null; planningEnabled: boolean; replenishmentMethod: string; lotSizing: string;
  leadTimeDays: number | null; leadTimeVariabilityDays: number | null; moq: number | null; orderMultiple: number | null;
  minStock: number | null; maxStock: number | null; safetyStock: number | null; reorderPoint: number | null;
  targetDaysOfSupply: number | null; unitCost: number | null; currency: string | null; costBasis: string | null;
  criticality: string | null; forecastMethod: string | null;
}): ResolvedParams {
  return {
    id: p.id, planningEnabled: p.planningEnabled, replenishmentMethod: p.replenishmentMethod as ResolvedParams['replenishmentMethod'],
    lotSizing: p.lotSizing as ResolvedParams['lotSizing'], leadTimeDays: p.leadTimeDays, leadTimeVariabilityDays: p.leadTimeVariabilityDays,
    moq: p.moq, orderMultiple: p.orderMultiple, minStock: p.minStock, maxStock: p.maxStock, safetyStock: p.safetyStock,
    reorderPoint: p.reorderPoint, targetDaysOfSupply: p.targetDaysOfSupply, unitCost: p.unitCost, currency: p.currency,
    costBasis: p.costBasis, criticality: p.criticality, forecastMethod: p.forecastMethod, warehouseSpecific: !!p.warehouseId,
  };
}
