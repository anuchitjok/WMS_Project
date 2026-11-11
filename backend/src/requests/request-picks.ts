import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, StockStatus } from '@prisma/client';
import { NOT_COUNT_LOCKED } from '../common/count-lock';
import { ScopePrincipal, canAccessWarehouse } from '../common/warehouse-scope';

/**
 * PR6 — pick locations chosen by the approver.
 *
 * In APPROVAL mode the approver may name the stock rows (rack / slot) a request
 * line is taken from. Without picks nothing here runs and approval stays FIFO.
 * Error messages are fixed texts (the frontend translates them by exact match);
 * the ids involved travel in the response body.
 */

export interface PickInput {
  itemId: string;
  stockItemId: string;
  qty: number;
}

/** Stock row as read for checking a pick (no lock). */
export interface PickRow {
  id: string;
  productId: string;
  status: StockStatus | string;
  quantity: number;
  warehouseId: string | null;
  serialNumber: string | null;
  countLocked: boolean;
}

export interface PickLine {
  id: string;
  productId: string;
  quantityRequested: number;
}

export const PICK_ERR = {
  modeOnly: 'Pick locations can only be chosen when stock is reserved at approval',
  finalStepOnly: 'Pick locations can only be chosen at the final approval step',
  approveOnly: 'Pick locations can only be sent with an approval',
  unknownLine: 'A picked request line is not part of this request',
  duplicateRow: 'The same stock row is picked twice',
  badQty: 'Picked quantity must be more than zero',
  fullQty: 'Each picked line must cover the full approved quantity',
  rowUnavailable: 'A picked stock row is not available for this request',
  oneWarehouse: 'Picked stock must all come from one warehouse',
  scope: 'You do not have access to the warehouse of a picked stock row',
  rowTaken: 'A picked stock row was just taken — reload and choose again',
  notHonoured: 'A stock row chosen at approval is no longer reserved — check the request before allocating',
} as const;

/** Rounding slack for fractional quantities (same unit maths as allocation). */
const EPS = 1e-9;

/**
 * Checks a pick plan against the request lines and the rows as read now.
 * Pure: the caller re-checks every row under a lock inside the transaction.
 * Returns the picks grouped by line and the one warehouse they come from.
 */
export function checkPickPlan(
  lines: PickLine[],
  picks: PickInput[],
  rows: Map<string, PickRow>,
  principal: ScopePrincipal | null | undefined,
): { byLine: Map<string, PickInput[]>; warehouseId: string | null } {
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const byLine = new Map<string, PickInput[]>();
  const seen = new Set<string>();
  let warehouseId: string | null | undefined;

  for (const p of picks) {
    const line = lineById.get(p.itemId);
    if (!line) throw new BadRequestException({ message: PICK_ERR.unknownLine, itemId: p.itemId });
    if (seen.has(p.stockItemId)) throw new BadRequestException({ message: PICK_ERR.duplicateRow, stockItemId: p.stockItemId });
    seen.add(p.stockItemId);
    if (!(Number.isFinite(p.qty) && p.qty > 0)) throw new BadRequestException({ message: PICK_ERR.badQty, stockItemId: p.stockItemId });

    const row = rows.get(p.stockItemId);
    if (!row) throw new BadRequestException({ message: PICK_ERR.rowUnavailable, stockItemId: p.stockItemId, reason: 'NOT_FOUND' });
    // Scope before anything that would tell a caller about a row they cannot see.
    if (!canAccessWarehouse(principal, row.warehouseId)) {
      throw new ForbiddenException({ message: PICK_ERR.scope, stockItemId: p.stockItemId });
    }
    const reason = rowProblem(row, line.productId, p.qty);
    if (reason) throw new BadRequestException({ message: PICK_ERR.rowUnavailable, stockItemId: p.stockItemId, reason });

    if (warehouseId === undefined) warehouseId = row.warehouseId;
    else if (warehouseId !== row.warehouseId) {
      throw new BadRequestException({ message: PICK_ERR.oneWarehouse, stockItemId: p.stockItemId });
    }
    const list = byLine.get(line.id) ?? [];
    list.push(p);
    byLine.set(line.id, list);
  }

  // Q3: a line with picks must be fully covered by them (no silent FIFO top-up).
  for (const [lineId, list] of byLine) {
    const need = lineById.get(lineId)!.quantityRequested;
    const sum = list.reduce((s, p) => s + p.qty, 0);
    if (Math.abs(sum - need) > EPS) {
      throw new BadRequestException({ message: PICK_ERR.fullQty, itemId: lineId, picked: sum, approved: need });
    }
  }
  return { byLine, warehouseId: warehouseId ?? null };
}

/** Why a row cannot serve this pick, or null when it can. */
export function rowProblem(row: PickRow, productId: string, qty: number): string | null {
  if (row.productId !== productId) return 'WRONG_PRODUCT';
  if (row.status !== StockStatus.AVAILABLE) return 'NOT_AVAILABLE';
  if (row.countLocked) return 'COUNT_LOCKED';
  if (qty > row.quantity + EPS) return 'NOT_ENOUGH';
  // A serial row is one unit and cannot be split.
  if (row.serialNumber && Math.abs(qty - row.quantity) > EPS) return 'SERIAL_WHOLE';
  return null;
}

type Tx = Prisma.TransactionClient;

/** Reads the picked rows (no lock) with their count-lock flag. */
export async function readPickRows(db: Tx | { $queryRaw: Tx['$queryRaw'] }, ids: string[]): Promise<Map<string, PickRow>> {
  if (!ids.length) return new Map();
  const rows = await (db as Tx).$queryRaw<PickRow[]>`
    SELECT s."id", s."productId", s."status"::text AS "status", s."quantity", s."warehouseId", s."serialNumber",
           NOT (${NOT_COUNT_LOCKED}) AS "countLocked"
    FROM "StockItem" s WHERE s."id" = ANY(${ids}::text[])`;
  return new Map(rows.map((r) => [r.id, { ...r, quantity: Number(r.quantity) }]));
}

/**
 * Locks one picked row for the approval transaction. NOWAIT: the approver chose
 * this exact row, so a row held by someone else is a conflict, never a reason to
 * take a different row (no silent FIFO fallback).
 */
export async function lockPickRow(tx: Tx, stockItemId: string): Promise<PickRow | null> {
  try {
    const rows = await tx.$queryRaw<PickRow[]>`
      SELECT s."id", s."productId", s."status"::text AS "status", s."quantity", s."warehouseId", s."serialNumber",
             NOT (${NOT_COUNT_LOCKED}) AS "countLocked"
      FROM "StockItem" s WHERE s."id" = ${stockItemId}
      FOR UPDATE OF s NOWAIT`;
    return rows[0] ? { ...rows[0], quantity: Number(rows[0].quantity) } : null;
  } catch (e) {
    if (isLockNotAvailable(e)) throw new ConflictException({ message: PICK_ERR.rowTaken, stockItemId });
    throw e;
  }
}

/** Postgres 55P03 lock_not_available, as surfaced through Prisma raw queries. */
export function isLockNotAvailable(e: unknown): boolean {
  const any = e as { code?: string; meta?: { code?: string }; message?: string };
  return any?.meta?.code === '55P03' || any?.code === '55P03' || /55P03|could not obtain lock/i.test(any?.message ?? '');
}
