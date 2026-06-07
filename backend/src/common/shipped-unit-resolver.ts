import { PrismaService } from '../prisma/prisma.service';

type RequestItemLike = {
  id: string;
  productId: string;
  stockItemId?: string | null;
  shippedStockItemId?: string | null;
};

/**
 * Resolves the *actual* StockItem that was picked/shipped for each request line (C2).
 *
 * Priority per line:
 *   1. `shippedStockItemId` — denormalized at dispatch (authoritative).
 *   2. The matching FulfillmentTaskItem.stockItemId — the unit reservation/picking
 *      chose (covers the handover path that never goes through dispatch).
 *   3. Legacy `stockItemId` on the request line (approval-time link, pre-unified mode).
 *
 * Returns a Map of requestItemId -> stockItemId | null.
 */
export async function resolveShippedUnits(
  prisma: PrismaService,
  requestId: string,
  requestItems: RequestItemLike[],
): Promise<Map<string, string | null>> {
  const task = await prisma.fulfillmentTask.findFirst({
    where: { requestId },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });

  // FIFO queue of task stock-item ids per product, to handle duplicate lines.
  const byProduct = new Map<string, string[]>();
  for (const ti of task?.items ?? []) {
    if (!ti.stockItemId) continue;
    if (!byProduct.has(ti.productId)) byProduct.set(ti.productId, []);
    byProduct.get(ti.productId)!.push(ti.stockItemId);
  }

  const result = new Map<string, string | null>();
  for (const ri of requestItems) {
    let resolved: string | null = ri.shippedStockItemId ?? null;
    if (!resolved) {
      const q = byProduct.get(ri.productId);
      if (q && q.length) resolved = q.shift() ?? null;
    }
    if (!resolved) resolved = ri.stockItemId ?? null;
    result.set(ri.id, resolved);
  }
  return result;
}
