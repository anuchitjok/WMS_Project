import { DAYS_PER_PERIOD, Granularity, addPeriods, isoDate, periodStart } from './periods';

/**
 * Historical material usage.
 *
 * Sources (see docs/WARRANTY_MRP.md, section 3):
 *  - ISSUE    goods issue at shipment dispatch (FulfillmentTaskItem.qtyPicked, Shipment.shippedAt)
 *  - RETURN   unused goods returned to stock (WithdrawalRequestItem usageStatus UNUSED)
 *  - CONSUMED usage confirmed as USED by the requester / RMA team
 * Receipts, transfers, adjustments and PO quantities are never usage.
 */
export type UsageKind = 'ISSUE' | 'RETURN' | 'CONSUMED';
export type UsageBasis = 'NET_ISSUES' | 'CONFIRMED_USAGE';

export interface UsageEvent {
  date: Date;
  qty: number;
  kind: UsageKind;
  productId?: string;
  warehouseId?: string | null;
  ref?: string;
}

export interface SeriesPoint {
  start: string; // ISO date of period start
  qty: number;
}

export interface UsageSeries {
  granularity: Granularity;
  basis: UsageBasis;
  points: SeriesPoint[]; // completed periods only, oldest first
  periodToDate: number; // the current, incomplete period (not used for forecasting)
  /** Periods where returns exceeded issues and the net was floored at 0. */
  flooredPeriods: number;
  /** First recorded usage when it falls inside the window (history starts there); null = used before the window, or never. */
  historyStart: string | null;
  /** Periods of the window dropped because they are before the first recorded usage. */
  trimmedPeriods: number;
}

function signedQty(e: UsageEvent, basis: UsageBasis): number {
  if (basis === 'CONFIRMED_USAGE') return e.kind === 'CONSUMED' ? e.qty : 0;
  if (e.kind === 'ISSUE') return e.qty;
  if (e.kind === 'RETURN') return -e.qty;
  return 0;
}

/**
 * Usage per completed period: the `periods` periods before the one containing `asOf`.
 * Net-issue periods that come out negative (a return of goods issued earlier) are
 * floored at 0 and counted in `flooredPeriods`.
 *
 * `firstUsage` is the material's first recorded usage, when that falls inside the
 * window. Periods before the one containing it are left out: the material had no history then, which is not the
 * same as zero demand. Without it (or when it is before the window) the whole
 * window is used.
 */
export function buildSeries(
  events: UsageEvent[],
  asOf: Date,
  periods: number,
  g: Granularity,
  basis: UsageBasis,
  firstUsage: Date | null = null,
): UsageSeries {
  const current = periodStart(asOf, g);
  const first = addPeriods(current, -periods, g);
  const buckets = new Map<number, number>();
  const starts: Date[] = [];
  for (let i = 0; i < periods; i++) {
    const s = addPeriods(first, i, g);
    starts.push(s);
    buckets.set(s.getTime(), 0);
  }
  let periodToDate = 0;
  for (const e of events) {
    if (e.date.getTime() > asOf.getTime()) continue;
    const q = signedQty(e, basis);
    if (!q) continue;
    const ps = periodStart(e.date, g).getTime();
    if (ps === current.getTime()) periodToDate += q;
    else if (buckets.has(ps)) buckets.set(ps, buckets.get(ps)! + q);
  }
  let flooredPeriods = 0;
  const historyFrom = firstUsage ? periodStart(firstUsage, g).getTime() : null;
  const kept = historyFrom === null ? starts : starts.filter((s) => s.getTime() >= historyFrom);
  const points = kept.map((s) => {
    let qty = buckets.get(s.getTime())!;
    if (qty < 0) {
      flooredPeriods += 1;
      qty = 0;
    }
    return { start: isoDate(s)!, qty: round(qty) };
  });
  return {
    granularity: g, basis, points, periodToDate: Math.max(0, round(periodToDate)), flooredPeriods,
    historyStart: firstUsage ? isoDate(firstUsage) : null, trimmedPeriods: starts.length - kept.length,
  };
}

export type DemandPattern = 'NO_DEMAND' | 'INSUFFICIENT' | 'SMOOTH' | 'INTERMITTENT' | 'ERRATIC' | 'LUMPY';
export type TrendDirection = 'INCREASING' | 'DECREASING' | 'STABLE' | 'IRREGULAR' | 'INSUFFICIENT';

export interface PatternThresholds {
  /** Average demand interval cut-off (Syntetos–Boylan classification uses 1.32). */
  adiCutoff: number;
  /** Squared coefficient of variation of non-zero demand sizes (Syntetos–Boylan uses 0.49). */
  cv2Cutoff: number;
  /** |slope| / mean per period below this share is STABLE (e.g. 0.05 = 5 % per period). */
  trendThreshold: number;
  /** Minimum completed periods before a trend is reported. */
  minTrendPeriods: number;
}

export interface UsageStats {
  periods: number;
  total: number;
  nonZeroPeriods: number;
  meanPerPeriod: number;
  avgDaily: number;
  avgMonthly: number;
  stdDev: number;
  cv: number | null;
  adi: number | null;
  cv2NonZero: number | null;
  pattern: DemandPattern;
  trend: { direction: TrendDirection; slopePerPeriod: number | null; relativeSlope: number | null };
}

export function linearFit(ys: number[]): { slope: number; intercept: number } | null {
  const n = ys.length;
  if (n < 2) return null;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - mx) * (ys[i] - my);
    sxx += (i - mx) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

export function usageStats(series: UsageSeries, t: PatternThresholds): UsageStats {
  const ys = series.points.map((p) => p.qty);
  const n = ys.length;
  const total = ys.reduce((a, b) => a + b, 0);
  const mean = n ? total / n : 0;
  const variance = n ? ys.reduce((a, y) => a + (y - mean) ** 2, 0) / n : 0;
  const sd = Math.sqrt(variance);
  const nz = ys.filter((y) => y > 0);
  const nzMean = nz.length ? nz.reduce((a, b) => a + b, 0) / nz.length : 0;
  const nzVar = nz.length ? nz.reduce((a, y) => a + (y - nzMean) ** 2, 0) / nz.length : 0;
  const cv2NonZero = nz.length && nzMean > 0 ? nzVar / nzMean ** 2 : null;
  const adi = nz.length ? n / nz.length : null;

  let pattern: DemandPattern;
  if (nz.length === 0) pattern = 'NO_DEMAND';
  else if (nz.length < 2) pattern = 'INSUFFICIENT';
  else {
    const intermittent = (adi ?? 0) > t.adiCutoff;
    const variable = (cv2NonZero ?? 0) > t.cv2Cutoff;
    pattern = intermittent ? (variable ? 'LUMPY' : 'INTERMITTENT') : variable ? 'ERRATIC' : 'SMOOTH';
  }

  let direction: TrendDirection = 'INSUFFICIENT';
  let slope: number | null = null;
  let rel: number | null = null;
  if (n >= t.minTrendPeriods && nz.length >= 2) {
    const fit = linearFit(ys)!;
    slope = round(fit.slope, 4);
    rel = mean > 0 ? round(fit.slope / mean, 4) : null;
    if (pattern === 'INTERMITTENT' || pattern === 'LUMPY') direction = 'IRREGULAR';
    else if (rel === null || Math.abs(rel) < t.trendThreshold) direction = 'STABLE';
    else direction = rel > 0 ? 'INCREASING' : 'DECREASING';
  }

  const days = n * DAYS_PER_PERIOD[series.granularity];
  const avgDaily = days ? total / days : 0;
  return {
    periods: n,
    total: round(total),
    nonZeroPeriods: nz.length,
    meanPerPeriod: round(mean, 4),
    avgDaily: round(avgDaily, 4),
    avgMonthly: round(avgDaily * DAYS_PER_PERIOD.MONTH, 4),
    stdDev: round(sd, 4),
    cv: mean > 0 ? round(sd / mean, 4) : null,
    adi: adi === null ? null : round(adi, 4),
    cv2NonZero: cv2NonZero === null ? null : round(cv2NonZero, 4),
    pattern,
    trend: { direction, slopePerPeriod: slope, relativeSlope: rel },
  };
}

export interface PeriodComparison {
  label: string;
  current: number;
  previous: number;
  change: number;
  changePct: number | null; // null when the base period is 0
}

/**
 * Last completed period vs the one before (period-over-period), and vs the same
 * period a year earlier (only when the series covers it).
 */
export function comparePeriods(series: UsageSeries): { pop: PeriodComparison | null; yoy: PeriodComparison | null } {
  const p = series.points;
  const n = p.length;
  const mk = (label: string, cur: number, prev: number): PeriodComparison => ({
    label,
    current: cur,
    previous: prev,
    change: round(cur - prev),
    changePct: prev > 0 ? round(((cur - prev) / prev) * 100, 2) : null,
  });
  const pop = n >= 2 ? mk(series.granularity === 'MONTH' ? 'Month over month' : 'Period over period', p[n - 1].qty, p[n - 2].qty) : null;
  const perYear = series.granularity === 'MONTH' ? 12 : series.granularity === 'WEEK' ? 52 : 365;
  const yoy = n > perYear ? mk('Year over year', p[n - 1].qty, p[n - 1 - perYear].qty) : null;
  return { pop, yoy };
}

export function round(v: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
