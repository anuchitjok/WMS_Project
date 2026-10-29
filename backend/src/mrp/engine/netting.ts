import { DAYS_PER_PERIOD, Granularity, addDays, addPeriods, daysBetween, isoDate, periodStart, startOfDay } from './periods';
import { round } from './usage';

/**
 * Time-phased net requirements (one material, one planning level).
 *
 * Buckets: bucket 0 runs from the as-of day to the start of the next period;
 * buckets 1..H-1 are full periods. Bucket 0's forecast is pro-rated by the
 * share of the period that remains.
 *
 * Per bucket b:
 *   gross[b]      = MAX(forecast[b], confirmed[b])   (default: the forecast is
 *                   "consumed" by confirmed orders — the forecast is built from
 *                   past request issues, so adding both would double count) or
 *                   forecast[b] + confirmed[b] when demandCombination = SUM
 *   before[b]     = projected[b-1] + receipts[b] − gross[b]   (projected[-1] = usable stock)
 *   net[b]        = MAX(0, safetyStock − before[b])
 *   planned[b]    = lot size of the requirement (see below), received at the bucket start
 *   projected[b]  = before[b] + planned[b]
 *   release[b]    = bucket start − lead time; late when release is before the as-of day
 *
 * Lot sizing: LOT_FOR_LOT orders the net requirement; MIN_MAX orders up to
 * maxStock when before[b] falls below the reorder point (or safety stock when no
 * reorder point is set). Both are then raised to the MOQ and rounded up to the
 * order multiple. Existing open supply is netted before anything is planned, so
 * demand already covered by valid supply never produces a suggestion.
 */
export type DemandCombination = 'MAX' | 'SUM';
export type LotSizing = 'LOT_FOR_LOT' | 'MIN_MAX';

export interface BucketDef {
  index: number;
  start: Date;
  end: Date; // exclusive
  fraction: number; // share of a full period covered (bucket 0 may be partial)
}

export function buildBuckets(asOf: Date, horizon: number, g: Granularity): BucketDef[] {
  const day = startOfDay(asOf);
  const first = periodStart(day, g);
  const out: BucketDef[] = [];
  for (let i = 0; i < horizon; i++) {
    const pStart = addPeriods(first, i, g);
    const pEnd = addPeriods(first, i + 1, g);
    const start = i === 0 ? day : pStart;
    const full = daysBetween(pStart, pEnd);
    out.push({ index: i, start, end: pEnd, fraction: round(daysBetween(start, pEnd) / full, 6) });
  }
  return out;
}

/** Spreads dated quantities over buckets. Dates before the as-of day go to bucket 0 (flagged), after the horizon are dropped. */
export function bucketize(
  items: Array<{ date: Date; qty: number }>,
  buckets: BucketDef[],
  pastDue: 'FIRST_BUCKET' | 'EXCLUDE' = 'FIRST_BUCKET',
): { perBucket: number[]; pastDue: number; beyondHorizon: number } {
  const perBucket = buckets.map(() => 0);
  let pastDueQty = 0;
  let beyond = 0;
  const startT = buckets[0].start.getTime();
  const endT = buckets[buckets.length - 1].end.getTime();
  for (const it of items) {
    const t = it.date.getTime();
    if (t < startT) {
      pastDueQty += it.qty;
      if (pastDue === 'FIRST_BUCKET') perBucket[0] += it.qty;
      continue;
    }
    if (t >= endT) {
      beyond += it.qty;
      continue;
    }
    const b = buckets.find((x) => t >= x.start.getTime() && t < x.end.getTime())!;
    perBucket[b.index] += it.qty;
  }
  return { perBucket: perBucket.map((v) => round(v)), pastDue: round(pastDueQty), beyondHorizon: round(beyond) };
}

/** Raise to the MOQ, then round up to the order multiple. */
export function lotSize(required: number, moq: number | null, multiple: number | null): number {
  if (required <= 0) return 0;
  let q = Math.max(required, moq ?? 0);
  if (multiple && multiple > 0) q = Math.ceil(round(q / multiple, 9)) * multiple;
  return round(q);
}

export interface PlanInput {
  asOf: Date;
  buckets: BucketDef[];
  usableStock: number;
  safetyStock: number;
  forecast: number[]; // per bucket, already pro-rated and overridden
  confirmed: number[]; // per bucket
  receipts: number[]; // per bucket (eligible open supply)
  demandCombination: DemandCombination;
  lotSizing: LotSizing;
  reorderPoint: number | null;
  maxStock: number | null;
  moq: number | null;
  orderMultiple: number | null;
  leadTimeDays: number | null;
}

export interface PlanBucket {
  index: number;
  start: string;
  end: string;
  forecast: number;
  confirmed: number;
  gross: number;
  receipts: number;
  projectedWithoutOrders: number;
  beforeOrder: number;
  net: number;
  planned: number;
  releaseDate: string | null;
  late: boolean;
  projected: number;
}

export interface PlannedOrder {
  bucket: number;
  qty: number;
  net: number;
  lotSizeExcess: number;
  receiptDate: string;
  releaseDate: string | null;
  late: boolean;
}

export interface PlanResult {
  buckets: PlanBucket[];
  totals: { forecast: number; confirmed: number; gross: number; receipts: number; net: number; planned: number };
  plannedOrders: PlannedOrder[];
  firstShortage: { bucket: number; date: string; qty: number } | null;
  maxShortage: number; // deepest projected deficit below 0 if nothing new is ordered
  firstBelowSafety: { bucket: number; date: string } | null;
  warnings: string[];
}

export function plan(p: PlanInput): PlanResult {
  const warnings: string[] = [];
  const asOfDay = startOfDay(p.asOf);
  let lotSizing = p.lotSizing;
  if (lotSizing === 'MIN_MAX' && (p.maxStock === null || p.maxStock <= 0)) {
    warnings.push('MIN_MAX lot sizing needs a maximum stock; lot-for-lot was used instead.');
    lotSizing = 'LOT_FOR_LOT';
  }
  const trigger = lotSizing === 'MIN_MAX' ? (p.reorderPoint ?? p.safetyStock) : p.safetyStock;

  let proj = p.usableStock;
  let projNo = p.usableStock;
  const rows: PlanBucket[] = [];
  const orders: PlannedOrder[] = [];
  let firstShortage: PlanResult['firstShortage'] = null;
  let firstBelowSafety: PlanResult['firstBelowSafety'] = null;
  let maxShortage = 0;

  for (const b of p.buckets) {
    const i = b.index;
    const f = p.forecast[i] ?? 0;
    const c = p.confirmed[i] ?? 0;
    const gross = p.demandCombination === 'SUM' ? f + c : Math.max(f, c);
    const rec = p.receipts[i] ?? 0;
    projNo = projNo + rec - gross;
    const before = proj + rec - gross;
    const net = Math.max(0, p.safetyStock - before);
    let planned = 0;
    if (before < trigger - 1e-9) {
      const required = lotSizing === 'MIN_MAX' ? Math.max(net, (p.maxStock as number) - before) : net;
      planned = lotSize(required, p.moq, p.orderMultiple);
    }
    proj = before + planned;
    let release: Date | null = null;
    let late = false;
    if (planned > 0) {
      release = p.leadTimeDays === null ? null : addDays(b.start, -p.leadTimeDays);
      late = release !== null && release.getTime() < asOfDay.getTime();
      orders.push({
        bucket: i,
        qty: planned,
        net: round(net),
        lotSizeExcess: round(Math.max(0, planned - Math.max(net, 0))),
        receiptDate: isoDate(b.start)!,
        releaseDate: isoDate(release),
        late,
      });
    }
    if (projNo < -1e-9) {
      if (!firstShortage) firstShortage = { bucket: i, date: isoDate(b.start)!, qty: round(-projNo) };
      maxShortage = Math.max(maxShortage, -projNo);
    }
    if (!firstBelowSafety && projNo < p.safetyStock - 1e-9) firstBelowSafety = { bucket: i, date: isoDate(b.start)! };
    rows.push({
      index: i,
      start: isoDate(b.start)!,
      end: isoDate(b.end)!,
      forecast: round(f),
      confirmed: round(c),
      gross: round(gross),
      receipts: round(rec),
      projectedWithoutOrders: round(projNo),
      beforeOrder: round(before),
      net: round(net),
      planned,
      releaseDate: isoDate(release),
      late,
      projected: round(proj),
    });
  }
  const sum = (k: keyof PlanBucket) => round(rows.reduce((a, r) => a + (r[k] as number), 0));
  return {
    buckets: rows,
    totals: { forecast: sum('forecast'), confirmed: sum('confirmed'), gross: sum('gross'), receipts: sum('receipts'), net: sum('net'), planned: sum('planned') },
    plannedOrders: orders,
    firstShortage,
    maxShortage: round(maxShortage),
    firstBelowSafety,
    warnings,
  };
}

/** Pro-rates a per-full-period forecast onto the buckets (bucket 0 may be partial). */
export function forecastToBuckets(perPeriod: number[], buckets: BucketDef[]): number[] {
  return buckets.map((b) => round((perPeriod[b.index] ?? 0) * b.fraction));
}

export { DAYS_PER_PERIOD };
