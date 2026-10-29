import { round } from './usage';
import { startOfDay } from './periods';

/**
 * Inventory position from StockItem rows. Each status belongs to exactly one
 * group, so no quantity is counted twice:
 *
 *   available   AVAILABLE                                       usable, unreserved
 *   allocated   RESERVED, PICKING, PICKED, PACKED, READY_FOR_PICKUP
 *               already committed to an approved request — the demand it covers
 *               is NOT counted again as open demand
 *   blocked     QUARANTINE, DAMAGED, DOA, RTV_PENDING           not usable
 *   inspection  PENDING_RECEIVING, PENDING_INSPECTION, RETURNED_UNUSED
 *               physically here, not yet released for use
 *   (excluded)  SHIPPED, ISSUED_TO_RMA, CONSUMED, RTV_SHIPPED, CLOSED, CANCELLED — gone
 *
 *   onHand (physical) = available + allocated + blocked + inspection
 *   usable for planning = available (+ inspection when the configuration allows it)
 */
export const POSITION_GROUPS = {
  available: ['AVAILABLE'],
  allocated: ['RESERVED', 'PICKING', 'PICKED', 'PACKED', 'READY_FOR_PICKUP'],
  blocked: ['QUARANTINE', 'DAMAGED', 'DOA', 'RTV_PENDING'],
  inspection: ['PENDING_RECEIVING', 'PENDING_INSPECTION', 'RETURNED_UNUSED'],
} as const;

export interface InventoryPosition {
  onHand: number;
  available: number;
  allocated: number;
  blocked: number;
  inspection: number;
  usable: number;
}

export function inventoryPosition(rows: Array<{ status: string; quantity: number }>, countInspectionAsUsable: boolean): InventoryPosition {
  const sum = (statuses: readonly string[]) => rows.filter((r) => statuses.includes(r.status)).reduce((a, r) => a + Number(r.quantity), 0);
  const available = sum(POSITION_GROUPS.available);
  const allocated = sum(POSITION_GROUPS.allocated);
  const blocked = sum(POSITION_GROUPS.blocked);
  const inspection = sum(POSITION_GROUPS.inspection);
  return {
    onHand: round(available + allocated + blocked + inspection),
    available: round(available),
    allocated: round(allocated),
    blocked: round(blocked),
    inspection: round(inspection),
    usable: round(available + (countInspectionAsUsable ? inspection : 0)),
  };
}

// ── Inbound supply (imported PO lines) ─────────────────────────────────────

export interface PoLineInput {
  id: string;
  poNumber: string;
  lineNumber: string;
  productId: string;
  status: 'OPEN' | 'PARTIAL' | 'CLOSED' | 'CANCELLED';
  orderedQty: number;
  receivedQty: number; // reported by the purchasing system
  cancelledQty: number;
  expectedDate: Date | null;
  orderDate?: Date | null;
  isConfirmed?: boolean;
  uom?: string | null;
  vendorId?: string | null;
  unitCost?: number | null;
  currency?: string | null;
}

export interface WmsReceipt {
  poNumber: string;
  productId: string;
  quantity: number;
  date: Date;
}

export interface EvaluatedPoLine {
  id: string;
  poNumber: string;
  lineNumber: string;
  orderedQty: number;
  reportedReceived: number;
  wmsReceived: number;
  receivedUsed: number;
  cancelledQty: number;
  outstanding: number;
  convertedOutstanding: number; // in the product's base unit
  expectedDate: string | null;
  eligible: boolean;
  overdue: boolean;
  reason: string | null;
  isConfirmed: boolean;
}

/**
 * WMS receipts booked against the same PO number and product are assigned to
 * that PO's lines in line-number order (each line absorbs up to its ordered
 * quantity), so two lines for one product never claim the same receipt.
 */
export function allocateWmsReceipts(lines: PoLineInput[], receipts: WmsReceipt[]): Map<string, number> {
  const out = new Map<string, number>();
  const pool = new Map<string, number>();
  for (const r of receipts) {
    const k = `${r.poNumber}|${r.productId}`;
    pool.set(k, (pool.get(k) ?? 0) + r.quantity);
  }
  const sorted = [...lines].sort((a, b) => a.poNumber.localeCompare(b.poNumber) || a.lineNumber.localeCompare(b.lineNumber, undefined, { numeric: true }));
  for (const l of sorted) {
    const k = `${l.poNumber}|${l.productId}`;
    const left = pool.get(k) ?? 0;
    const take = Math.min(left, Math.max(0, l.orderedQty - l.cancelledQty));
    out.set(l.id, take);
    pool.set(k, left - take);
  }
  return out;
}

/**
 * Open quantity of a PO line, in the product's base unit:
 *   outstanding = ordered − cancelled − max(reported received, WMS received)
 * `max` (not a sum) because both describe the same deliveries.
 * Not eligible: CANCELLED / CLOSED lines, nothing outstanding, unknown expected
 * date, or a unit of measure that differs from the product's with no conversion.
 */
export function evaluatePoLine(
  l: PoLineInput,
  wmsReceived: number,
  asOf: Date,
  baseUom: string,
  conversion: number | null,
): EvaluatedPoLine {
  const receivedUsed = Math.max(l.receivedQty, wmsReceived);
  const outstanding = Math.max(0, round(l.orderedQty - l.cancelledQty - receivedUsed));
  let reason: string | null = null;
  let factor = 1;
  if (l.status === 'CANCELLED') reason = 'PO line cancelled';
  else if (l.status === 'CLOSED') reason = 'PO line closed';
  else if (outstanding <= 0) reason = 'Fully received or cancelled';
  else if (!l.expectedDate) reason = 'No expected delivery date — cannot be time-phased';
  else if (l.uom && l.uom.toLowerCase() !== baseUom.toLowerCase()) {
    if (conversion && conversion > 0) factor = conversion;
    else reason = `Unit ${l.uom} differs from the product unit ${baseUom} and no conversion is set`;
  }
  const eligible = reason === null;
  return {
    id: l.id,
    poNumber: l.poNumber,
    lineNumber: l.lineNumber,
    orderedQty: l.orderedQty,
    reportedReceived: l.receivedQty,
    wmsReceived: round(wmsReceived),
    receivedUsed: round(receivedUsed),
    cancelledQty: l.cancelledQty,
    outstanding,
    convertedOutstanding: eligible ? round(outstanding * factor) : 0,
    expectedDate: l.expectedDate ? l.expectedDate.toISOString().slice(0, 10) : null,
    eligible,
    overdue: eligible && !!l.expectedDate && l.expectedDate.getTime() < startOfDay(asOf).getTime(),
    reason,
    isConfirmed: !!l.isConfirmed,
  };
}
