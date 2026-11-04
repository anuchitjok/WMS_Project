import { Injectable } from '@nestjs/common';
import { FulfillmentStatus, Prisma, RequestStatus, StockStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RTV_CLOSED } from '../rtv/rtv.service';
import { getLowStockProducts } from '../common/inventory-metrics';
import { SystemSettingsService } from '../settings/system-settings.service';
import { DashboardService, type WarehouseFilter } from './dashboard.service';

/**
 * Operations Control Tower — one read-only payload for the dashboard.
 *
 * Snapshot figures (KPIs, inventory health, low stock) come from the existing
 * DashboardService methods and the shared low-stock metric, so they reconcile
 * with the rest of the WMS. Flow figures (trend, period totals, per-warehouse
 * volumes) are counted from existing transaction records:
 *   receiving   = GoodsReceiving documents by createdAt
 *   putaway     = PUTAWAY_CONFIRMED audit events by createdAt (one per stock row)
 *   fulfillment = FulfillmentTask rows by createdAt (tasks allocated)
 *   shipment    = Shipment rows by shippedAt (goods issued)
 * Nothing is written and no business rule is changed.
 */

export type DashboardRange = '7d' | '30d' | '90d' | '12m';
export type DashboardGranularity = 'day' | 'week' | 'month';
export const DASHBOARD_RANGES: DashboardRange[] = ['7d', '30d', '90d', '12m'];
export const DASHBOARD_GRANULARITIES: DashboardGranularity[] = ['day', 'week', 'month'];

const RANGE_INTERVAL: Record<DashboardRange, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', '12m': '12 months' };
const FLOWS = ['receiving', 'putaway', 'fulfillment', 'shipment'] as const;
type Flow = (typeof FLOWS)[number];
type FlowCounts = Record<Flow, number>;

// Same thresholds the SLA job uses (sla.service.ts) for overdue approvals / picking.
const APPROVAL_SLA_HOURS = 4;
const PICKING_SLA_HOURS = 8;
const FULFILLMENT_EXCEPTION: FulfillmentStatus[] = [FulfillmentStatus.SHORT_PICK, FulfillmentStatus.DAMAGED, FulfillmentStatus.HOLD];
const UNASSIGNED = '__unassigned__';
const zero = (): FlowCounts => ({ receiving: 0, putaway: 0, fulfillment: 0, shipment: 0 });

type Row = { wh: string | null; b: string; n: bigint | number };

@Injectable()
export class ControlTowerService {
  constructor(
    private prisma: PrismaService,
    private dashboard: DashboardService,
    private settings: SystemSettingsService,
  ) {}

  /** IANA zone from the browser; anything Postgres can't resolve falls back to UTC. */
  private async safeZone(tz?: string): Promise<string> {
    if (!tz || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return 'UTC';
    try {
      await this.prisma.$queryRaw`SELECT now() AT TIME ZONE ${tz}::text`;
      return tz;
    } catch {
      return 'UTC';
    }
  }

  async overview(opts: {
    filter: WarehouseFilter;
    scope: string[] | null;
    range: DashboardRange;
    granularity: DashboardGranularity;
    tz?: string;
  }) {
    const { filter, scope, range, granularity } = opts;
    const tz = await this.safeZone(opts.tz);
    const ids: string[] | null = !filter ? null : typeof filter === 'string' ? [filter] : filter.in;
    const interval = RANGE_INTERVAL[range];

    // Period boundaries (UTC, matching the timestamp columns) and the local bucket keys.
    const [bounds] = await this.prisma.$queryRaw<{ start: Date; prev: Date; now: Date }[]>`
      WITH l AS (SELECT (now() AT TIME ZONE ${tz}::text) AS lnow),
      s AS (
        SELECT CASE WHEN ${range}::text = '12m'
                    THEN date_trunc('month', lnow) - interval '11 months'
                    ELSE date_trunc('day', lnow) - (${interval}::interval - interval '1 day') END AS lstart,
               lnow
        FROM l
      )
      SELECT (lstart AT TIME ZONE ${tz}::text) AT TIME ZONE 'UTC' AS start,
             ((lstart - ${interval}::interval) AT TIME ZONE ${tz}::text) AT TIME ZONE 'UTC' AS prev,
             now() AT TIME ZONE 'UTC' AS now
      FROM s`;
    const buckets = await this.prisma.$queryRaw<{ b: string }[]>`
      SELECT to_char(g, 'YYYY-MM-DD') AS b FROM generate_series(
        date_trunc(${granularity}::text, (${bounds.start}::timestamp AT TIME ZONE 'UTC') AT TIME ZONE ${tz}::text),
        date_trunc(${granularity}::text, now() AT TIME ZONE ${tz}::text),
        ('1 ' || ${granularity}::text)::interval) AS g`;

    const bucket = (col: Prisma.Sql) =>
      Prisma.sql`CASE WHEN ${col} < ${bounds.start} THEN 'prev'
        ELSE to_char(date_trunc(${granularity}::text, (${col} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}::text), 'YYYY-MM-DD') END`;
    const whIn = (col: Prisma.Sql) => (ids ? Prisma.sql`AND ${col} = ANY(${ids}::text[])` : Prisma.empty);
    const since = bounds.prev;

    const [recvTotal, recvByWh, putaway, fulfil, ship, stockByWh, warehouses, kpisAndLow, health, overdue, exceptions] = await Promise.all([
      // Receiving documents — counted once each for totals…
      this.prisma.$queryRaw<Row[]>`
        SELECT NULL AS wh, ${bucket(Prisma.sql`gr."createdAt"`)} AS b, COUNT(*) AS n
        FROM "GoodsReceiving" gr
        WHERE gr."createdAt" >= ${since}
          ${ids ? Prisma.sql`AND EXISTS (SELECT 1 FROM "GoodsReceivingItem" i JOIN "StockItem" s ON s.id = i."stockItemId"
                                         WHERE i."receivingId" = gr.id AND s."warehouseId" = ANY(${ids}::text[]))` : Prisma.empty}
        GROUP BY 2`,
      // …and once per destination warehouse for the comparison.
      this.prisma.$queryRaw<Row[]>`
        SELECT s."warehouseId" AS wh, ${bucket(Prisma.sql`gr."createdAt"`)} AS b, COUNT(DISTINCT gr.id) AS n
        FROM "GoodsReceiving" gr
        JOIN "GoodsReceivingItem" i ON i."receivingId" = gr.id
        JOIN "StockItem" s ON s.id = i."stockItemId"
        WHERE gr."createdAt" >= ${since} ${whIn(Prisma.sql`s."warehouseId"`)}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<Row[]>`
        SELECT s."warehouseId" AS wh, ${bucket(Prisma.sql`a."createdAt"`)} AS b, COUNT(*) AS n
        FROM "AuditLog" a
        LEFT JOIN "StockItem" s ON s.id = a."entityId"
        WHERE a.action = 'PUTAWAY_CONFIRMED' AND a."createdAt" >= ${since} ${whIn(Prisma.sql`s."warehouseId"`)}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<Row[]>`
        SELECT t."warehouseId" AS wh, ${bucket(Prisma.sql`t."createdAt"`)} AS b, COUNT(*) AS n
        FROM "FulfillmentTask" t
        WHERE t."createdAt" >= ${since} ${whIn(Prisma.sql`t."warehouseId"`)}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<Row[]>`
        SELECT t."warehouseId" AS wh, ${bucket(Prisma.sql`sh."shippedAt"`)} AS b, COUNT(*) AS n
        FROM "Shipment" sh
        JOIN "FulfillmentTask" t ON t.id = sh."taskId"
        WHERE sh."shippedAt" IS NOT NULL AND sh."shippedAt" >= ${since} ${whIn(Prisma.sql`t."warehouseId"`)}
        GROUP BY 1, 2`,
      // Units on hand per warehouse and status (same summed-quantity rule as Inventory Health).
      this.prisma.stockItem.groupBy({
        by: ['warehouseId', 'status'],
        where: {
          status: { in: [StockStatus.AVAILABLE, StockStatus.RESERVED, StockStatus.PICKED, StockStatus.QUARANTINE, StockStatus.PENDING_INSPECTION, StockStatus.RTV_PENDING] },
          ...(filter ? { warehouseId: filter } : {}),
        },
        _sum: { quantity: true },
      }),
      // Warehouses the user may pick from (scope, not the current filter).
      this.prisma.warehouse.findMany({
        where: { isDeleted: false, ...(scope ? { id: { in: scope } } : {}) },
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      this.settings.lowStockThreshold().then(async (threshold) => {
        const low = await getLowStockProducts(this.prisma, { warehouse: filter, defaultThreshold: threshold });
        return { low, kpis: await this.dashboard.getKpis(filter, low) };
      }),
      this.dashboard.getInventoryHealth(filter),
      this.overdue(filter),
      this.exceptions(filter),
    ]);

    // ── Fold the flow rows into trend buckets, period totals and per-warehouse volumes ──
    const keys = buckets.map((r) => r.b);
    const trend = new Map(keys.map((k) => [k, zero()]));
    const current = zero();
    const previous = zero();
    const perWh = new Map<string, FlowCounts>();
    const add = (flow: Flow, rows: Row[], { totals, byWh }: { totals: boolean; byWh: boolean }) => {
      for (const r of rows) {
        const n = Number(r.n);
        if (totals) {
          if (r.b === 'prev') previous[flow] += n;
          else {
            current[flow] += n;
            const t = trend.get(r.b);
            if (t) t[flow] += n;
          }
        }
        if (byWh && r.b !== 'prev') {
          const k = r.wh ?? UNASSIGNED;
          if (!perWh.has(k)) perWh.set(k, zero());
          perWh.get(k)![flow] += n;
        }
      }
    };
    add('receiving', recvTotal, { totals: true, byWh: false });
    add('receiving', recvByWh, { totals: false, byWh: true });
    add('putaway', putaway, { totals: true, byWh: true });
    add('fulfillment', fulfil, { totals: true, byWh: true });
    add('shipment', ship, { totals: true, byWh: true });

    // ── Warehouse comparison: stock on hand + period volumes ──
    const stock = new Map<string, { available: number; reserved: number; picked: number; qcHold: number; rtvPending: number }>();
    for (const g of stockByWh) {
      const k = g.warehouseId ?? UNASSIGNED;
      if (!stock.has(k)) stock.set(k, { available: 0, reserved: 0, picked: 0, qcHold: 0, rtvPending: 0 });
      const s = stock.get(k)!;
      const q = g._sum.quantity ?? 0;
      if (g.status === StockStatus.AVAILABLE) s.available += q;
      else if (g.status === StockStatus.RESERVED) s.reserved += q;
      else if (g.status === StockStatus.PICKED) s.picked += q;
      else if (g.status === StockStatus.RTV_PENDING) s.rtvPending += q;
      else s.qcHold += q; // QUARANTINE + PENDING_INSPECTION, as in Inventory Health
    }
    const shown = ids ? warehouses.filter((w) => ids.includes(w.id)) : warehouses;
    const rowFor = (id: string, code: string | null, name: string | null) => {
      const s = stock.get(id) ?? { available: 0, reserved: 0, picked: 0, qcHold: 0, rtvPending: 0 };
      return { id: id === UNASSIGNED ? null : id, code, name, stock: { ...s, total: s.available + s.reserved + s.picked + s.qcHold + s.rtvPending }, volume: perWh.get(id) ?? zero() };
    };
    const byWarehouse = shown.map((w) => rowFor(w.id, w.code, w.name));
    // Stock/activity not yet tied to a warehouse (e.g. received, awaiting putaway).
    const un = rowFor(UNASSIGNED, null, null);
    if (un.stock.total > 0 || FLOWS.some((f) => un.volume[f] > 0)) byWarehouse.push(un);

    // ── Top low-stock items with where their available units sit ──
    const { low, kpis } = kpisAndLow;
    const top = [...low]
      .sort((a, b) => (b.minStock - b.available) - (a.minStock - a.available) || a.available - b.available)
      .slice(0, 8);
    const held = top.length
      ? await this.prisma.stockItem.groupBy({
          by: ['productId', 'warehouseId'],
          where: { productId: { in: top.map((p) => p.id) }, status: StockStatus.AVAILABLE, ...(filter ? { warehouseId: filter } : {}) },
          _sum: { quantity: true },
        })
      : [];
    const whCode = new Map(warehouses.map((w) => [w.id, w.code]));
    const lowStockTop = top.map((p) => ({
      ...p,
      shortage: p.minStock - p.available,
      severity: (p.available <= p.minStock * 0.25 ? 'critical' : 'warning'),
      warehouses: held
        .filter((h) => h.productId === p.id && (h._sum.quantity ?? 0) > 0)
        .map((h) => ({ id: h.warehouseId, code: h.warehouseId ? (whCode.get(h.warehouseId) ?? null) : null, available: h._sum.quantity ?? 0 })),
    }));

    return {
      generatedAt: bounds.now,
      timeZone: tz,
      period: { range, granularity, start: bounds.start, previousStart: bounds.prev },
      kpis,
      inventory: health,
      flows: { current, previous },
      trend: keys.map((k) => ({ bucket: k, ...trend.get(k)! })),
      control: { ...overdue, ...exceptions },
      warehouses,
      byWarehouse,
      lowStock: { count: low.length, top: lowStockTop },
    };
  }

  /** Overdue work, using the SLA job's own rules (approval > 4h, approved & not picked > 8h). */
  private async overdue(filter: WarehouseFilter) {
    const h = (hours: number) => new Date(Date.now() - hours * 3_600_000);
    const [approval, picking, rtv] = await Promise.all([
      this.prisma.withdrawalRequest.count({
        where: { status: { in: [RequestStatus.SUBMITTED, RequestStatus.PENDING_APPROVAL] }, updatedAt: { lt: h(APPROVAL_SLA_HOURS) } },
      }),
      this.prisma.withdrawalRequest.count({ where: { status: RequestStatus.APPROVED, updatedAt: { lt: h(PICKING_SLA_HOURS) } } }),
      this.settings.rtvAgingSlaDays().then((days) =>
        days === null
          ? null
          : this.prisma.rTVCase.count({
              where: {
                status: { notIn: RTV_CLOSED as any },
                createdAt: { lt: new Date(Date.now() - days * 86_400_000) },
                ...(filter ? { stockItem: { warehouseId: filter } } : {}),
              },
            }),
      ),
    ]);
    return { overdueApprovals: approval, overduePicking: picking, overdueRtv: rtv };
  }

  /** Operational exceptions: fulfillment tasks stuck in an exception state, DOA units with no open RTV. */
  private async exceptions(filter: WarehouseFilter) {
    const wh = filter ? { warehouseId: filter } : {};
    const [fulfillmentExceptions, doaAwaitingRtv] = await Promise.all([
      this.prisma.fulfillmentTask.count({ where: { status: { in: FULFILLMENT_EXCEPTION }, ...wh } }),
      this.prisma.stockItem.count({
        where: { status: StockStatus.DOA, rtvCases: { none: { status: { notIn: RTV_CLOSED as any } } }, ...wh },
      }),
    ]);
    return { fulfillmentExceptions, doaAwaitingRtv };
  }
}
