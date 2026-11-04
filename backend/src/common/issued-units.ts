import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveShippedUnits } from './shipped-unit-resolver';

type Db = PrismaService | Prisma.TransactionClient;

type Line = {
  id: string;
  productId: string;
  quantityIssued?: number | null;
  stockItemId?: string | null;
  shippedStockItemId?: string | null;
};

export interface IssuedUnit {
  stockItemId: string;
  productId: string;
  /** Quantity that left the warehouse on this unit (a bulk unit may carry several). */
  quantity: number;
  /** The request line the unit was issued against. */
  requestItemId: string | null;
}

/**
 * Phase 5 — every unit issued on a request, with its quantity and request line,
 * so usage and returns can be recorded per unit (part used, part returned).
 * Source: the picked lines of the request's latest non-cancelled task; requests
 * issued without a task (legacy) fall back to the line → unit link.
 */
export async function issuedUnitsOf(
  db: Db,
  requestId: string,
  lines: Line[],
): Promise<IssuedUnit[]> {
  const task = await db.fulfillmentTask.findFirst({
    where: { requestId, status: { not: 'CANCELLED' } },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });
  const picked = (task?.items ?? []).filter(
    (ti) => ti.stockItemId && ti.qtyPicked > 0,
  );

  if (picked.length) {
    // Assign each picked unit to a line of the same product, filling lines in order.
    const room = new Map(
      lines.map((l) => [
        l.id,
        l.quantityIssued && l.quantityIssued > 0 ? l.quantityIssued : Infinity,
      ]),
    );
    const byUnit = new Map<string, IssuedUnit>();
    for (const ti of picked) {
      const line =
        lines.find(
          (l) => l.productId === ti.productId && (room.get(l.id) ?? 0) > 0,
        ) ?? lines.find((l) => l.productId === ti.productId);
      if (line) room.set(line.id, (room.get(line.id) ?? 0) - ti.qtyPicked);
      const prev = byUnit.get(ti.stockItemId!);
      if (prev) prev.quantity += ti.qtyPicked;
      else
        byUnit.set(ti.stockItemId!, {
          stockItemId: ti.stockItemId!,
          productId: ti.productId,
          quantity: ti.qtyPicked,
          requestItemId: line?.id ?? null,
        });
    }
    return [...byUnit.values()];
  }

  const legacy = await resolveShippedUnits(
    db as PrismaService,
    requestId,
    lines,
  );
  const units: IssuedUnit[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const sid = legacy.get(l.id);
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    const stock = await db.stockItem.findUnique({
      where: { id: sid },
      select: { quantity: true },
    });
    units.push({
      stockItemId: sid,
      productId: l.productId,
      quantity:
        l.quantityIssued && l.quantityIssued > 0
          ? l.quantityIssued
          : (stock?.quantity ?? 1),
      requestItemId: l.id,
    });
  }
  return units;
}

export const RETURNABLE_USAGES = ['UNUSED', 'WRONG_ITEM'];
