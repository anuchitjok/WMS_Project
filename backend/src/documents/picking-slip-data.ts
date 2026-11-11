// Pure data shaping for the picking slip PDF and the request QR page (plan P5 5.1–5.3).
// No Prisma / Nest imports so it can be unit-tested directly.

export type DeliveryMethod = 'COLLECT' | 'SHIP';

/** WithdrawalRequest.deliveryMethod: null / unknown = COLLECT (migration 32). */
export function deliveryMethodOf(raw: string | null | undefined): DeliveryMethod {
  return raw === 'SHIP' ? 'SHIP' : 'COLLECT';
}

export const DELIVERY_METHOD_LABEL: Record<DeliveryMethod, string> = { COLLECT: 'Collect', SHIP: 'Ship' };

export interface StockLike {
  id?: string;
  serialNumber?: string | null;
  batchNumber?: string | null;
  warehouse?: { code?: string | null; name?: string | null } | null;
  rack?: { code?: string | null } | null;
  slot?: { code?: string | null } | null;
  /** GoodsReceivingItem rows of the unit — itemCondition is NEW | REFURBISH (migration 31). */
  goodsReceivingItems?: { itemCondition?: string | null }[] | null;
}

export interface ProductLike {
  code?: string | null;
  partNumber?: string | null;
  name?: string | null;
  brand?: { name?: string | null } | null;
  unit?: string | null;
}

export interface SlipLocation {
  /** Line 1: warehouse code. */
  warehouse: string;
  /** Line 2: rack / slot code, e.g. A01-01-08. */
  bin: string;
}

export interface SlipRow {
  no: number;
  sku: string;
  partNumber: string | null;
  description: string;
  brand: string;
  serial: string;
  qty: number;
  unit: string | null;
  condition: string;
  location: SlipLocation;
  /** PR6: the approver chose this stock row (Manual Pick). False for FIFO lines. */
  selectedByApprover: boolean;
}

/**
 * Bin code shown to people. New slot codes already contain the rack code
 * (A01-01-08 in rack A01); older slots are short ("01") and need the rack prefix.
 */
export function binCode(rackCode?: string | null, slotCode?: string | null): string {
  const r = (rackCode ?? '').trim();
  const s = (slotCode ?? '').trim();
  if (!r && !s) return '';
  if (!s) return r;
  if (!r || s.startsWith(`${r}-`) || s === r) return s;
  return `${r}-${s}`;
}

/** WH + BIN merged into one "Location" value (two lines). Missing parts are "—". */
export function slipLocation(stock: StockLike | null | undefined): SlipLocation {
  const wh = stock?.warehouse?.code?.trim() || '—';
  const bin = binCode(stock?.rack?.code, stock?.slot?.code) || '—';
  return { warehouse: wh, bin };
}

/** NEW / REFURBISH chosen at receipt; units received before migration 31 show NEW. */
export function conditionOf(stock: StockLike | null | undefined): string {
  const c = stock?.goodsReceivingItems?.find((g) => g?.itemCondition)?.itemCondition;
  return c === 'REFURBISH' ? 'REFURBISH' : 'NEW';
}

export interface RequestItemLike {
  product?: ProductLike | null;
  quantityRequested?: number | null;
  quantityApproved?: number | null;
  stockItem?: StockLike | null;
}

export interface TaskItemLike {
  product?: ProductLike | null;
  qtyRequested?: number | null;
  stockItem?: StockLike | null;
}

/**
 * Rows for the slip / pick list. When a fulfillment task exists its lines are the
 * authoritative reservation (what the warehouse must actually pick), otherwise the
 * request lines and their approval-time stock link are used.
 */
export function buildSlipRows(
  requestItems: RequestItemLike[],
  taskItems?: TaskItemLike[] | null,
  approverRows?: ReadonlySet<string> | null,
): SlipRow[] {
  const useTask = !!taskItems && taskItems.length > 0;
  const src = useTask
    ? taskItems!.map((t) => ({ product: t.product, qty: t.qtyRequested ?? 1, stock: t.stockItem }))
    : requestItems.map((r) => ({ product: r.product, qty: r.quantityApproved ?? r.quantityRequested ?? 1, stock: r.stockItem }));
  return src.map((s, i) => ({
    no: i + 1,
    sku: s.product?.code || '—',
    partNumber: s.product?.partNumber || null,
    description: s.product?.name || '—',
    brand: s.product?.brand?.name || '—',
    serial: s.stock?.serialNumber || s.stock?.batchNumber || '—',
    qty: Number(s.qty) || 0,
    unit: s.product?.unit ?? null,
    condition: conditionOf(s.stock),
    location: slipLocation(s.stock),
    selectedByApprover: !!s.stock?.id && !!approverRows?.has(s.stock.id),
  }));
}

/** Columns of the slip table, in print order (Status was removed in plan 5.1). */
export const SLIP_COLUMNS = ['#', 'SKU / Part#', 'Description', 'Brand', 'Serial / Batch', 'Location', 'QTY', 'Condition'] as const;

export interface SignatureBlock {
  role: 'WAREHOUSE' | 'REQUESTER';
  title: string;
  /** Name printed above the signature line; '' leaves it blank to write in. */
  name: string;
}

/**
 * Two signature blocks (plan 5.1/5.2): left = warehouse picker, right = requester.
 * Names are pre-filled; the signature and date stay blank for handwriting.
 */
export function signatureBlocks(pickerName?: string | null, requesterName?: string | null): [SignatureBlock, SignatureBlock] {
  return [
    { role: 'WAREHOUSE', title: 'WH — Picked by', name: (pickerName ?? '').trim() },
    { role: 'REQUESTER', title: 'Requester — Received by', name: (requesterName ?? '').trim() },
  ];
}

// ─── QR URL ───────────────────────────────────────────────────────────────────

/**
 * Base URL of the web app that the request QR opens. QR_BASE_URL wins; otherwise
 * the first FRONTEND_URL entry (the same list CORS uses); otherwise localhost.
 */
export function frontendBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const pick = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).find(Boolean);
  const base = pick(env.QR_BASE_URL) || pick(env.FRONTEND_URL) || 'http://localhost:3000';
  return base.replace(/\/+$/, '');
}

/**
 * URL encoded in the request QR. The web app is a static export, so the ref goes
 * in the query string (/r?ref=...) rather than a dynamic path segment.
 */
export function requestQrUrl(refNumber: string, env?: Record<string, string | undefined>): string {
  return `${frontendBaseUrl(env)}/r?ref=${encodeURIComponent(refNumber)}`;
}

/** Ref number from a scanned request QR URL (any host), or null if it is not one. */
export function refFromQrUrl(raw: string): string | null {
  const v = (raw ?? '').trim();
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    const u = new URL(v);
    if (!/\/r\/?$/.test(u.pathname)) return null;
    const ref = u.searchParams.get('ref');
    return ref && ref.trim() ? ref.trim() : null;
  } catch {
    return null;
  }
}
