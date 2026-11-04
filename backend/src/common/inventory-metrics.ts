import { PrismaService } from '../prisma/prisma.service';
import { Prisma, StockStatus } from '@prisma/client';
import { NOT_COUNT_LOCKED } from './count-lock';

type RawDb = { $queryRaw: Prisma.TransactionClient['$queryRaw'] };

/**
 * Units a request can draw on right now, per product: the summed quantity of
 * AVAILABLE rows that are not held by an active cycle count. This is the same
 * pool approval and allocation reserve from (any warehouse, FIFO), so the
 * request form, the approver's stock check and the reservation agree.
 * A bulk row of 20 counts as 20, not as one row.
 */
export async function getAvailableUnitsByProduct(db: RawDb, productIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await db.$queryRaw<{ productId: string; units: number | string | null }[]>`
    SELECT s."productId", SUM(s."quantity") AS units FROM "StockItem" s
    WHERE s."productId" = ANY(${ids}::text[]) AND s."status" = 'AVAILABLE' AND s."quantity" > 0
      AND ${NOT_COUNT_LOCKED}
    GROUP BY s."productId"`;
  return new Map(rows.map((r) => [r.productId, Number(r.units ?? 0)]));
}

export interface LowStockProduct {
  id: string;
  code: string;
  name: string;
  available: number; // AVAILABLE units only (not historical/shipped/consumed)
  minStock: number; // threshold applied (product minStock, else the system default)
  thresholdSource: 'product' | 'system';
}

export interface LowStockOptions {
  /** Prisma filter for StockItem.warehouseId (see common/warehouse-scope.ts). */
  warehouse?: string | { in: string[] };
  /**
   * System-wide default (setting `stock.lowThreshold`) for products without
   * their own minStock. `null`/`undefined` = not configured or disabled: only
   * products with minStock > 0 are checked, exactly as before.
   */
  defaultThreshold?: number | null;
}

/**
 * Single shared low-stock metric used by dashboard, reports and alerts.
 * A product is "low" when its AVAILABLE units are below its threshold:
 * Product.minStock when set (> 0), otherwise the system default threshold.
 * Units are summed (a bulk row of 50 counts as 50, a serial unit as 1), within
 * the caller's warehouse scope when one is given.
 */
export async function getLowStockProducts(prisma: PrismaService, opts: LowStockOptions = {}): Promise<LowStockProduct[]> {
  const fallback = opts.defaultThreshold && opts.defaultThreshold > 0 ? opts.defaultThreshold : null;
  const products = await prisma.product.findMany({
    where: { isActive: true, ...(fallback ? {} : { minStock: { gt: 0 } }) },
    select: { id: true, code: true, name: true, minStock: true },
    orderBy: { minStock: 'desc' },
  });
  if (products.length === 0) return [];
  const sums = await prisma.stockItem.groupBy({
    by: ['productId'],
    where: {
      productId: { in: products.map((p) => p.id) },
      status: StockStatus.AVAILABLE,
      ...(opts.warehouse ? { warehouseId: opts.warehouse } : {}),
    },
    _sum: { quantity: true },
  });
  const units = new Map(sums.map((s) => [s.productId, s._sum.quantity ?? 0]));
  return products
    .map((p) => {
      const own = p.minStock > 0;
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        available: units.get(p.id) ?? 0,
        minStock: own ? p.minStock : (fallback ?? 0),
        thresholdSource: (own ? 'product' : 'system') as 'product' | 'system',
      };
    })
    .filter((p) => p.minStock > 0 && p.available < p.minStock);
}
