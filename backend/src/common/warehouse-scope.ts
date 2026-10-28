import { ForbiddenException } from '@nestjs/common';

/**
 * Warehouse-level authorization, shared by every module.
 *
 * Follows the model already used by Inventory, Scan and Layout:
 *  - SUPER_ADMIN is unrestricted.
 *  - A user with assigned warehouses (UserWarehouse rows or warehouse-scoped
 *    role assignments, aggregated into req.user.warehouseIds) sees only those.
 *  - A user with no assigned warehouse is unrestricted (legacy convention —
 *    see docs/SYSTEM_CONTROL.md, "Warehouse scope").
 *  - No principal at all (internal call, cron, tests) = unrestricted.
 */
export interface ScopePrincipal {
  roleKey?: string | null;
  warehouseIds?: string[];
}

/** `null` = unrestricted; otherwise the warehouses the principal may touch. */
export function scopedWarehouseIds(
  p: ScopePrincipal | null | undefined,
): string[] | null {
  if (!p || p.roleKey === 'SUPER_ADMIN') return null;
  const ids = p.warehouseIds ?? [];
  return ids.length ? ids : null;
}

export function canAccessWarehouse(
  p: ScopePrincipal | null | undefined,
  warehouseId: string | null | undefined,
): boolean {
  const ids = scopedWarehouseIds(p);
  if (!ids) return true;
  return !!warehouseId && ids.includes(warehouseId);
}

export function assertWarehouseAccess(
  p: ScopePrincipal | null | undefined,
  warehouseId: string | null | undefined,
  what = 'this warehouse',
) {
  if (!canAccessWarehouse(p, warehouseId)) {
    throw new ForbiddenException(`You do not have access to ${what}`);
  }
}

/**
 * Prisma filter value for a `warehouseId` column. An explicit `requested`
 * warehouse outside the scope is refused rather than silently widened.
 * Returns `undefined` when no filter applies.
 */
export function warehouseFilter(
  p: ScopePrincipal | null | undefined,
  requested?: string | null,
): string | { in: string[] } | undefined {
  const ids = scopedWarehouseIds(p);
  if (requested) {
    if (ids && !ids.includes(requested))
      throw new ForbiddenException('You do not have access to this warehouse');
    return requested;
  }
  return ids ? { in: ids } : undefined;
}

type StockDb = {
  stockItem: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: { id: true; warehouseId: true };
    }) => Promise<{ id: string; warehouseId: string | null }[]>;
  };
};

/** stockItemId → warehouseId for the given rows (missing ids are absent from the map). */
export async function stockWarehouses(
  db: StockDb,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const rows = await db.stockItem.findMany({
    where: { id: { in: unique } },
    select: { id: true, warehouseId: true },
  });
  return new Map(rows.map((r) => [r.id, r.warehouseId]));
}

/** Refuses when the stock row is outside the principal's warehouses (unknown row → 404 is left to the caller). */
export async function assertStockInScope(
  db: StockDb,
  p: ScopePrincipal | null | undefined,
  stockItemId: string | null | undefined,
  what = 'this stock item',
) {
  if (!stockItemId || !scopedWarehouseIds(p)) return;
  const map = await stockWarehouses(db, [stockItemId]);
  if (map.has(stockItemId))
    assertWarehouseAccess(p, map.get(stockItemId), what);
}

/**
 * Keeps documents linked by `stockItemId` (no Prisma relation) whose stock is in
 * scope. For a scoped principal, documents with no stock link are hidden — their
 * warehouse cannot be established.
 */
export async function filterByStockScope<
  T extends { stockItemId: string | null },
>(db: StockDb, p: ScopePrincipal | null | undefined, rows: T[]): Promise<T[]> {
  const ids = scopedWarehouseIds(p);
  if (!ids) return rows;
  const map = await stockWarehouses(
    db,
    rows.map((r) => r.stockItemId),
  );
  return rows.filter(
    (r) => !!r.stockItemId && ids.includes(map.get(r.stockItemId) ?? ''),
  );
}
