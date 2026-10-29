import { backtest, selectMethod } from './accuracy';
import { classify } from './classify';
import { DEFAULT_MRP_CONFIG, MrpConfigShape, mergeConfig, validateConfig } from './config';
import { applyOverrides, forecast, validateSpec } from './forecast';
import { MaterialSnapshot, planMaterial } from './material';
import { bucketize, buildBuckets, lotSize, plan } from './netting';
import { periodStart, periodStarts } from './periods';
import { allocateWmsReceipts, evaluatePoLine, inventoryPosition } from './position';
import { buildSeries, comparePeriods, usageStats } from './usage';

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const PATTERN = DEFAULT_MRP_CONFIG.pattern;

describe('periods', () => {
  it('week starts on Monday, month on the 1st (UTC)', () => {
    expect(periodStart(D('2026-07-15'), 'WEEK').toISOString().slice(0, 10)).toBe('2026-07-13');
    expect(periodStart(D('2026-07-13'), 'WEEK').toISOString().slice(0, 10)).toBe('2026-07-13');
    expect(periodStart(D('2026-07-19'), 'WEEK').toISOString().slice(0, 10)).toBe('2026-07-13');
    expect(periodStart(D('2026-07-15'), 'MONTH').toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(periodStarts(D('2026-01-20'), D('2026-03-02'), 'MONTH').length).toBe(3);
  });
});

describe('usage aggregation', () => {
  const asOf = D('2026-07-15');
  const ev = [
    { date: D('2026-01-05'), qty: 10, kind: 'ISSUE' as const },
    { date: D('2026-02-03'), qty: 5, kind: 'ISSUE' as const },
    { date: D('2026-02-20'), qty: 2, kind: 'RETURN' as const },
    { date: D('2026-04-10'), qty: 4, kind: 'RETURN' as const }, // more returned than issued in April
    { date: D('2026-05-01'), qty: 8, kind: 'ISSUE' as const },
    { date: D('2026-06-30'), qty: 6, kind: 'ISSUE' as const },
    { date: D('2026-06-30'), qty: 6, kind: 'CONSUMED' as const },
    { date: D('2026-07-02'), qty: 3, kind: 'ISSUE' as const }, // current month = period to date
    { date: D('2026-08-01'), qty: 99, kind: 'ISSUE' as const }, // after as-of: ignored
  ];

  it('net issues per completed month, returns subtracted, negatives floored', () => {
    const s = buildSeries(ev, asOf, 6, 'MONTH', 'NET_ISSUES');
    expect(s.points.map((p) => p.start)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01']);
    expect(s.points.map((p) => p.qty)).toEqual([10, 3, 0, 0, 8, 6]);
    expect(s.flooredPeriods).toBe(1);
    expect(s.periodToDate).toBe(3);
  });

  it('confirmed-usage basis counts only CONSUMED events', () => {
    const s = buildSeries(ev, asOf, 6, 'MONTH', 'CONFIRMED_USAGE');
    expect(s.points.map((p) => p.qty)).toEqual([0, 0, 0, 0, 0, 6]);
  });

  it('history starts at the period of the first recorded usage', () => {
    const s = buildSeries(ev, asOf, 6, 'MONTH', 'NET_ISSUES', D('2026-03-20'));
    expect(s.points.map((p) => p.start)).toEqual(['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01']);
    expect(s.trimmedPeriods).toBe(2);
    expect(s.historyStart).toBe('2026-03-20');
  });

  it('first usage before the window or unknown keeps the whole window', () => {
    expect(buildSeries(ev, asOf, 6, 'MONTH', 'NET_ISSUES', D('2025-06-01')).points).toHaveLength(6);
    const none = buildSeries(ev, asOf, 6, 'MONTH', 'NET_ISSUES', null);
    expect(none.points).toHaveLength(6);
    expect(none.trimmedPeriods).toBe(0);
  });

  it('weekly buckets', () => {
    const s = buildSeries([{ date: D('2026-07-07'), qty: 4, kind: 'ISSUE' }], D('2026-07-15'), 2, 'WEEK', 'NET_ISSUES');
    expect(s.points).toEqual([{ start: '2026-06-29', qty: 0 }, { start: '2026-07-06', qty: 4 }]);
  });

  it('stats: smooth increasing series', () => {
    const st = usageStats({ granularity: 'MONTH', basis: 'NET_ISSUES', points: [2, 4, 6, 8, 10, 12].map((q, i) => ({ start: `${i}`, qty: q })), periodToDate: 0, flooredPeriods: 0, historyStart: null, trimmedPeriods: 0 }, PATTERN);
    expect(st.total).toBe(42);
    expect(st.meanPerPeriod).toBe(7);
    expect(st.avgMonthly).toBe(7);
    expect(st.avgDaily).toBeCloseTo(42 / (6 * (365.25 / 12)), 4);
    expect(st.trend.slopePerPeriod).toBe(2);
    expect(st.trend.direction).toBe('INCREASING');
    expect(st.pattern).toBe('SMOOTH');
  });

  it('stats: intermittent demand and zero demand', () => {
    const mk = (q: number[]) => ({ granularity: 'MONTH' as const, basis: 'NET_ISSUES' as const, points: q.map((x, i) => ({ start: `${i}`, qty: x })), periodToDate: 0, flooredPeriods: 0, historyStart: null, trimmedPeriods: 0 });
    const st = usageStats(mk([10, 0, 10, 0, 10, 0]), PATTERN);
    expect(st.adi).toBe(2);
    expect(st.cv2NonZero).toBe(0);
    expect(st.pattern).toBe('INTERMITTENT');
    expect(st.trend.direction).toBe('IRREGULAR');
    const z = usageStats(mk([0, 0, 0]), PATTERN);
    expect(z.pattern).toBe('NO_DEMAND');
    expect(z.cv).toBeNull();
    expect(z.trend.direction).toBe('INSUFFICIENT');
  });

  it('period comparisons; YoY only with 13+ months', () => {
    const mk = (q: number[]) => ({ granularity: 'MONTH' as const, basis: 'NET_ISSUES' as const, points: q.map((x, i) => ({ start: `${i}`, qty: x })), periodToDate: 0, flooredPeriods: 0, historyStart: null, trimmedPeriods: 0 });
    const c = comparePeriods(mk([4, 5]));
    expect(c.pop).toMatchObject({ current: 5, previous: 4, change: 1, changePct: 25 });
    expect(c.yoy).toBeNull();
    const y = comparePeriods(mk([10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 15]));
    expect(y.yoy).toMatchObject({ current: 15, previous: 10, changePct: 50 });
    expect(comparePeriods(mk([0, 3])).pop!.changePct).toBeNull(); // base 0
  });
});

describe('forecast methods', () => {
  const h = [1, 2, 3, 4, 5, 6];
  it('simple moving average', () => {
    const r = forecast(h, { method: 'SMA', window: 3 }, 2);
    expect(r.perPeriod).toEqual([5, 5]);
    expect(r.total).toBe(10);
    expect(r.sufficient).toBe(true);
  });
  it('fast moving average = shorter window', () => {
    expect(forecast(h, { method: 'FMA', window: 2 }, 1).perPeriod).toEqual([5.5]);
  });
  it('weighted moving average normalises weights, newest first', () => {
    const r = forecast(h, { method: 'WMA', window: 3, weights: [3, 2, 1] }, 1);
    expect(r.perPeriod[0]).toBeCloseTo(6 * 0.5 + 5 * (1 / 3) + 4 * (1 / 6), 4);
    expect(r.weightsUsed).toEqual([0.5, 0.3333, 0.1667]);
  });
  it('linear trend extrapolates the least-squares line', () => {
    const r = forecast([2, 4, 6, 8, 10, 12], { method: 'LINEAR', window: 6 }, 2);
    expect(r.slope).toBe(2);
    expect(r.intercept).toBe(2);
    expect(r.perPeriod).toEqual([14, 16]);
  });
  it('linear trend floors negative forecasts at 0 and warns', () => {
    const r = forecast([10, 8, 6, 4, 2, 0], { method: 'LINEAR', window: 6 }, 2);
    expect(r.perPeriod).toEqual([0, 0]);
    expect(r.warnings.join(' ')).toMatch(/below zero/);
  });
  it('insufficient history is flagged, not hidden', () => {
    const r = forecast([4, 6], { method: 'SMA', window: 6 }, 1);
    expect(r.perPeriod).toEqual([5]);
    expect(r.sufficient).toBe(false);
    expect(r.warnings[0]).toMatch(/Only 2 of 6/);
    const l = forecast([4, 6], { method: 'LINEAR', window: 6 }, 1);
    expect(l.perPeriod).toEqual([5]);
    expect(l.warnings.join(' ')).toMatch(/fell back/);
  });
  it('empty and all-zero history give 0 with a warning', () => {
    expect(forecast([], { method: 'SMA', window: 3 }, 2)).toMatchObject({ perPeriod: [0, 0], sufficient: false });
    const z = forecast([0, 0, 0], { method: 'WMA', window: 3, weights: [1, 1, 1] }, 1);
    expect(z.perPeriod).toEqual([0]);
    expect(z.warnings.join(' ')).toMatch(/No usage/);
  });
  it('rejects invalid specs', () => {
    expect(validateSpec({ method: 'WMA', window: 3, weights: [1, 1] })).not.toEqual([]);
    expect(validateSpec({ method: 'WMA', window: 2, weights: [0, 0] })).not.toEqual([]);
    expect(validateSpec({ method: 'WMA', window: 2, weights: [-1, 2] })).not.toEqual([]);
    expect(validateSpec({ method: 'LINEAR', window: 2 })).not.toEqual([]);
    expect(() => forecast(h, { method: 'SMA', window: 0 }, 1)).toThrow();
  });
  it('overrides keep the statistical forecast alongside', () => {
    const o = applyOverrides([5, 5, 5], [{ periodIndex: 2, mode: 'ADD', quantity: 2 }, { periodIndex: 1, mode: 'REPLACE', quantity: 8 }]);
    expect(o.statistical).toEqual([5, 5, 5]);
    expect(o.final).toEqual([5, 8, 7]);
    expect(o.applied).toHaveLength(2);
    expect(applyOverrides([5], [{ periodIndex: 0, mode: 'ADD', quantity: -9 }]).final).toEqual([0]);
  });
});

describe('forecast accuracy', () => {
  it('one-step-ahead back-test: bias, MAE, WAPE', () => {
    const r = backtest([2, 4, 6, 8], { method: 'SMA', window: 2 }, 2, 2);
    expect(r.points).toEqual([{ index: 2, forecast: 3, actual: 6 }, { index: 3, forecast: 5, actual: 8 }]);
    expect(r.bias).toBe(-3);
    expect(r.mae).toBe(3);
    expect(r.wape).toBeCloseTo(6 / 14, 4);
  });
  it('WAPE is undefined when all actuals are zero', () => {
    const r = backtest([0, 0, 0, 0], { method: 'SMA', window: 2 }, 2, 2);
    expect(r.wape).toBeNull();
    expect(r.mae).toBe(0);
    expect(r.note).toMatch(/WAPE is undefined/);
  });
  it('too few evaluable periods = insufficient', () => {
    const r = backtest([1, 2, 3], { method: 'SMA', window: 3 }, 6, 3);
    expect(r.sufficient).toBe(false);
    expect(r.wape).toBeNull();
  });
  it('selects the lowest WAPE among sufficient methods', () => {
    const h = [2, 4, 6, 8, 10, 12, 14, 16];
    const res = [backtest(h, { method: 'SMA', window: 3 }, 4, 3), backtest(h, { method: 'LINEAR', window: 3 }, 4, 3)];
    expect(selectMethod(res)!.method).toBe('LINEAR'); // a perfect line is forecast exactly
    expect(res[1].wape).toBe(0);
    expect(selectMethod([backtest([1, 2], { method: 'SMA', window: 3 }, 4, 3)])).toBeNull();
  });
});

describe('inventory position', () => {
  it('groups statuses without double counting', () => {
    const p = inventoryPosition(
      [
        { status: 'AVAILABLE', quantity: 10 },
        { status: 'RESERVED', quantity: 3 },
        { status: 'PICKED', quantity: 1 },
        { status: 'QUARANTINE', quantity: 2 },
        { status: 'PENDING_INSPECTION', quantity: 4 },
        { status: 'SHIPPED', quantity: 50 },
        { status: 'CONSUMED', quantity: 50 },
      ],
      false,
    );
    expect(p).toEqual({ onHand: 20, available: 10, allocated: 4, blocked: 2, inspection: 4, usable: 10 });
    expect(inventoryPosition([{ status: 'PENDING_INSPECTION', quantity: 4 }], true).usable).toBe(4);
  });
});

describe('inbound supply (PO lines)', () => {
  const asOf = D('2026-07-01');
  const base = { productId: 'p', orderedQty: 10, receivedQty: 0, cancelledQty: 0, status: 'OPEN' as const, expectedDate: D('2026-07-20') };
  it('WMS receipts fill PO lines in line order', () => {
    const m = allocateWmsReceipts(
      [{ ...base, id: 'b', poNumber: 'PO1', lineNumber: '2', orderedQty: 5 }, { ...base, id: 'a', poNumber: 'PO1', lineNumber: '1' }],
      [{ poNumber: 'PO1', productId: 'p', quantity: 12, date: asOf }],
    );
    expect(m.get('a')).toBe(10);
    expect(m.get('b')).toBe(2);
  });
  it('partial receipt: reported and WMS receipts are not added together', () => {
    const l = evaluatePoLine({ ...base, id: 'x', poNumber: 'P', lineNumber: '1', receivedQty: 3 }, 5, asOf, 'unit', null);
    expect(l.outstanding).toBe(5);
    expect(l.eligible).toBe(true);
    expect(l.overdue).toBe(false);
  });
  it('excludes cancelled, fully received, undated and unit-mismatched lines', () => {
    expect(evaluatePoLine({ ...base, id: '1', poNumber: 'P', lineNumber: '1', status: 'CANCELLED' }, 0, asOf, 'unit', null).eligible).toBe(false);
    expect(evaluatePoLine({ ...base, id: '2', poNumber: 'P', lineNumber: '2', cancelledQty: 4 }, 6, asOf, 'unit', null).outstanding).toBe(0);
    expect(evaluatePoLine({ ...base, id: '3', poNumber: 'P', lineNumber: '3', expectedDate: null }, 0, asOf, 'unit', null).reason).toMatch(/expected/);
    expect(evaluatePoLine({ ...base, id: '4', poNumber: 'P', lineNumber: '4', uom: 'box' }, 0, asOf, 'unit', null).eligible).toBe(false);
    const conv = evaluatePoLine({ ...base, id: '5', poNumber: 'P', lineNumber: '5', uom: 'box', orderedQty: 2 }, 0, asOf, 'unit', 12);
    expect(conv.convertedOutstanding).toBe(24);
  });
  it('flags overdue supply', () => {
    expect(evaluatePoLine({ ...base, id: 'o', poNumber: 'P', lineNumber: '9', expectedDate: D('2026-06-25') }, 0, asOf, 'unit', null).overdue).toBe(true);
  });
});

describe('net requirements', () => {
  it('builds a partial first bucket', () => {
    const b = buildBuckets(D('2026-07-15'), 2, 'MONTH');
    expect(b[0].start.toISOString().slice(0, 10)).toBe('2026-07-15');
    expect(b[0].fraction).toBeCloseTo(17 / 31, 5);
    expect(b[1].fraction).toBe(1);
  });
  it('bucketize: past due to bucket 0 or excluded; beyond horizon dropped', () => {
    const b = buildBuckets(D('2026-07-01'), 2, 'MONTH');
    const items = [{ date: D('2026-06-20'), qty: 3 }, { date: D('2026-08-05'), qty: 4 }, { date: D('2026-12-01'), qty: 9 }];
    expect(bucketize(items, b)).toEqual({ perBucket: [3, 4], pastDue: 3, beyondHorizon: 9 });
    expect(bucketize(items, b, 'EXCLUDE').perBucket).toEqual([0, 4]);
  });
  it('MOQ and order multiples', () => {
    expect(lotSize(7, 10, null)).toBe(10);
    expect(lotSize(12, 10, 5)).toBe(15);
    expect(lotSize(20, null, 6)).toBe(24);
    expect(lotSize(18, null, 6)).toBe(18);
    expect(lotSize(0, 10, 5)).toBe(0);
  });

  const asOf = D('2026-07-01');
  const buckets = buildBuckets(asOf, 4, 'MONTH');
  const base = {
    asOf, buckets, usableStock: 20, safetyStock: 5,
    forecast: [10, 10, 10, 10], confirmed: [12, 0, 0, 0], receipts: [0, 15, 0, 0],
    demandCombination: 'MAX' as const, lotSizing: 'LOT_FOR_LOT' as const,
    reorderPoint: null, maxStock: null, moq: 10, orderMultiple: 5, leadTimeDays: 45,
  };

  it('time-phased plan with safety stock, receipts, MOQ, multiples and lead time', () => {
    const r = plan(base);
    expect(r.buckets.map((b) => b.gross)).toEqual([12, 10, 10, 10]);
    expect(r.buckets.map((b) => b.beforeOrder)).toEqual([8, 13, 3, 3]);
    expect(r.buckets.map((b) => b.net)).toEqual([0, 0, 2, 2]);
    expect(r.buckets.map((b) => b.planned)).toEqual([0, 0, 10, 10]);
    expect(r.buckets.map((b) => b.projected)).toEqual([8, 13, 13, 13]);
    expect(r.buckets.map((b) => b.projectedWithoutOrders)).toEqual([8, 13, 3, -7]);
    expect(r.plannedOrders.map((o) => [o.receiptDate, o.releaseDate, o.late, o.lotSizeExcess])).toEqual([
      ['2026-09-01', '2026-07-18', false, 8],
      ['2026-10-01', '2026-08-17', false, 8],
    ]);
    expect(r.firstShortage).toEqual({ bucket: 3, date: '2026-10-01', qty: 7 });
    expect(r.firstBelowSafety).toEqual({ bucket: 2, date: '2026-09-01' });
    expect(r.totals).toMatchObject({ gross: 42, receipts: 15, net: 4, planned: 20 });
  });
  it('SUM combination adds confirmed demand; order inside lead time is late', () => {
    const r = plan({ ...base, demandCombination: 'SUM' });
    expect(r.buckets[0].gross).toBe(22);
    expect(r.buckets[0].net).toBe(7);
    expect(r.plannedOrders[0]).toMatchObject({ qty: 10, receiptDate: '2026-07-01', releaseDate: '2026-05-17', late: true });
  });
  it('MIN_MAX orders up to max when below the reorder point', () => {
    const r = plan({ ...base, lotSizing: 'MIN_MAX', maxStock: 30, reorderPoint: 10 });
    expect(r.buckets[0].beforeOrder).toBe(8);
    expect(r.buckets[0].planned).toBe(25); // 30 − 8 = 22 → MOQ 10 → multiple 5 → 25
    expect(r.buckets[0].projected).toBe(33);
    const w = plan({ ...base, lotSizing: 'MIN_MAX', maxStock: null });
    expect(w.warnings[0]).toMatch(/lot-for-lot/);
  });
  it('does not duplicate a recommendation for demand already covered by open supply', () => {
    const one = buildBuckets(asOf, 1, 'MONTH');
    const covered = plan({ ...base, buckets: one, usableStock: 0, safetyStock: 0, forecast: [10], confirmed: [0], receipts: [10], moq: null, orderMultiple: null });
    expect(covered.plannedOrders).toEqual([]);
    const uncovered = plan({ ...base, buckets: one, usableStock: 0, safetyStock: 0, forecast: [10], confirmed: [0], receipts: [0], moq: null, orderMultiple: null });
    expect(uncovered.plannedOrders[0].qty).toBe(10);
  });
  it('unknown lead time: quantity suggested, order date unknown', () => {
    const r = plan({ ...base, leadTimeDays: null });
    expect(r.plannedOrders[0].releaseDate).toBeNull();
    expect(r.plannedOrders[0].late).toBe(false);
  });
});

describe('configuration', () => {
  it('defaults are valid; classification thresholds start unset', () => {
    expect(validateConfig(DEFAULT_MRP_CONFIG)).toEqual([]);
    expect(DEFAULT_MRP_CONFIG.classification.fastMinMonthlyUsage).toBeNull();
    expect(DEFAULT_MRP_CONFIG.thresholdsApproved).toBe(false);
  });
  it('merges partial stored config and rejects bad values', () => {
    const c = mergeConfig({ horizonPeriods: 3, methods: { SMA: { window: 4 } } });
    expect(c.horizonPeriods).toBe(3);
    expect(c.methods.SMA.window).toBe(4);
    expect(c.methods.WMA.weights).toEqual([0.5, 0.3, 0.2]);
    expect(validateConfig(mergeConfig({ methods: { FMA: { window: 9 } } }))).toContain('FMA window must be shorter than the SMA window (that is what makes it "fast")');
    expect(validateConfig(mergeConfig({ classification: { fastMinMonthlyUsage: 5, slowMaxMonthlyUsage: 6 } })).length).toBe(1);
  });
});

describe('classification', () => {
  const stats = usageStats({ granularity: 'MONTH', basis: 'NET_ISSUES', points: [10, 10, 10].map((q, i) => ({ start: `${i}`, qty: q })), periodToDate: 0, flooredPeriods: 0, historyStart: null, trimmedPeriods: 0 }, PATTERN);
  const base = { stats, lastUsageDate: D('2026-06-10'), asOf: D('2026-07-01'), onHand: 40, usable: 40, openSupply: 10, safetyStock: 5, unitCost: 2, criticality: null };
  it('reports NOT_CONFIGURED while thresholds are empty', () => {
    const c = classify({ ...base, cfg: DEFAULT_MRP_CONFIG });
    expect(c.movement).toBe('NOT_CONFIGURED');
    expect(c.excessQty).toBeNull();
    expect(c.highValue).toBeNull();
  });
  it('applies configured thresholds', () => {
    const cfg: MrpConfigShape = mergeConfig({ classification: { fastMinMonthlyUsage: 8, slowMaxMonthlyUsage: 2, nonMovingDays: 90, excessMonthsOfSupply: 3, highValueThreshold: 50, highVariabilityCv: 0.5 } });
    const c = classify({ ...base, cfg });
    expect(c.movement).toBe('FAST');
    expect(c.excessQty).toBe(15); // 40 + 10 − (10 × 3 + 5)
    expect(c.monthsOfSupply).toBe(4);
    expect(c.highValue).toBe(true); // 40 × 2 = 80 ≥ 50
    expect(c.highVariability).toBe(false);
    const idle = classify({ ...base, lastUsageDate: D('2026-01-01'), cfg });
    expect(idle.movement).toBe('NON_MOVING');
    expect(idle.potentialObsolete).toBe(true);
  });
});

describe('planMaterial (end to end, pure)', () => {
  const cfg = mergeConfig({ horizonPeriods: 3, historyPeriods: 6, methods: { SMA: { window: 3 }, FMA: { window: 2 }, WMA: { window: 3, weights: [0.5, 0.3, 0.2] }, LINEAR: { window: 6 } } });
  const snapshot: MaterialSnapshot = {
    asOf: '2026-07-01T00:00:00.000Z',
    productId: 'p1', sku: 'SKU-1', description: 'Fan', category: 'Spare', unit: 'unit', productStatus: 'ACTIVE', productUnitCost: 0,
    warehouseId: null,
    params: {
      id: 'mp1', planningEnabled: true, replenishmentMethod: 'PURCHASE', lotSizing: 'LOT_FOR_LOT', leadTimeDays: 30, leadTimeVariabilityDays: null,
      moq: 10, orderMultiple: 5, minStock: null, maxStock: null, safetyStock: 5, reorderPoint: null, targetDaysOfSupply: null,
      unitCost: null, currency: null, costBasis: null, criticality: 'HIGH', forecastMethod: null, warehouseSpecific: false,
    },
    supplier: { vendorId: 'v1', vendorName: 'Vendor 1', supplierPartNumber: 'V-1', isPreferred: true, leadTimeDays: 20, moq: null, orderMultiple: null, unitPrice: 2.5, currency: 'USD', priceSource: 'QUOTE', priceValidFrom: null, priceValidTo: null, purchaseUom: null, uomConversion: null },
    alternatives: [{ vendorId: 'v2', vendorName: 'Vendor 2', supplierPartNumber: null, isPreferred: false, leadTimeDays: 10, moq: 20, orderMultiple: null, unitPrice: 2, currency: 'USD', priceSource: 'QUOTE', priceValidFrom: null, priceValidTo: null, purchaseUom: null, uomConversion: null }],
    stock: [{ status: 'AVAILABLE', quantity: 10 }, { status: 'RESERVED', quantity: 4 }, { status: 'QUARANTINE', quantity: 2 }],
    usage: [
      { date: '2026-04-10T00:00:00.000Z', qty: 9, kind: 'ISSUE', ref: 'SH-1' },
      { date: '2026-05-10T00:00:00.000Z', qty: 12, kind: 'ISSUE', ref: 'SH-2' },
      { date: '2026-06-10T00:00:00.000Z', qty: 15, kind: 'ISSUE', ref: 'SH-3' },
    ],
    demand: [{ date: '2026-06-20T00:00:00.000Z', qty: 5, ref: 'WR-1', status: 'SUBMITTED' }],
    poLines: [
      { id: 'po1', poNumber: 'PO-1', lineNumber: '1', productId: 'p1', status: 'OPEN', orderedQty: 20, receivedQty: 0, cancelledQty: 0, expectedDate: '2026-06-25T00:00:00.000Z', orderDate: '2026-05-01T00:00:00.000Z', vendorId: 'v1', currency: 'USD', unitCost: 2.4 },
      { id: 'po2', poNumber: 'PO-2', lineNumber: '1', productId: 'p1', status: 'CANCELLED', orderedQty: 50, receivedQty: 0, cancelledQty: 50, expectedDate: '2026-07-10T00:00:00.000Z', orderDate: null },
    ],
    wmsReceipts: [{ poNumber: 'PO-1', productId: 'p1', quantity: 8, date: '2026-06-28T00:00:00.000Z' }],
    overrides: [],
  };

  it('produces the hand-calculated plan', () => {
    const r = planMaterial(snapshot, cfg);
    expect(r.usage.series.points.map((p) => p.qty)).toEqual([0, 0, 0, 9, 12, 15]);
    expect(r.forecast.perPeriod).toEqual([12, 12, 12]);
    expect(r.position).toMatchObject({ onHand: 16, available: 10, allocated: 4, blocked: 2, usable: 10 });
    expect(r.supply.openQty).toBe(12); // 20 ordered − 8 received in the WMS
    expect(r.supply.overdueQty).toBe(12);
    expect(r.leadTimeDays).toBe(30); // material parameter beats the supplier's 20
    expect(r.plan.buckets.map((b) => [b.gross, b.receipts, b.beforeOrder, b.planned, b.projected])).toEqual([
      [12, 12, 10, 0, 10],
      [12, 0, -2, 10, 8],
      [12, 0, -4, 10, 6],
    ]);
    expect(r.suggested).toEqual({ qty: 10, orderDate: '2026-07-02', requiredDate: '2026-08-01', late: false, totalPlannedInHorizon: 20 });
    expect(r.planningStatus).toBe('PLANNED');
    expect(r.cost).toMatchObject({ unitCost: 2.5, currency: 'USD', source: 'SUPPLIER_QUOTE', estimatedCost: 25, horizonCost: 50 });
    expect(r.alternatives[0]).toMatchObject({ vendorId: 'v2', qty: 20, cost: 40, orderDate: '2026-07-22', late: false });
    const codes = r.exceptions.map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(['OVERDUE_PO', 'PROJECTED_SHORTAGE']));
    expect(codes).not.toContain('MISSING_SUPPLIER');
    expect(codes).not.toContain('STOCKOUT_IMMINENT');
    expect(r.accuracy.find((a) => a.method === 'SMA')!.points.map((p) => p.forecast)).toEqual([0, 3, 7]);
  });

  it('starts history at the first recorded usage', () => {
    const r = planMaterial({ ...snapshot, firstUsageDate: '2026-04-10T00:00:00.000Z' }, cfg);
    expect(r.usage.series.points.map((p) => p.qty)).toEqual([9, 12, 15]);
    expect(r.usage.series.trimmedPeriods).toBe(3);
    expect(r.usage.stats.meanPerPeriod).toBe(12); // not 6, as when the empty months counted as zero demand
    expect(r.forecast.perPeriod).toEqual([12, 12, 12]); // SMA(3) uses the same three months
  });

  it('is reproducible from its stored (JSON) snapshot', () => {
    const a = planMaterial(snapshot, cfg);
    const b = planMaterial(JSON.parse(JSON.stringify(snapshot)), JSON.parse(JSON.stringify(cfg)));
    expect(b).toEqual(a);
  });

  it('applies an approved override on the statistical forecast', () => {
    const r = planMaterial({ ...snapshot, overrides: [{ id: 'o1', periodStart: '2026-08-01T00:00:00.000Z', mode: 'REPLACE', quantity: 40 }] }, cfg);
    expect(r.forecast.perPeriod).toEqual([12, 12, 12]);
    expect(r.forecastFinal).toEqual([12, 40, 12]);
    expect(r.plan.buckets[1].gross).toBe(40);
  });

  it('missing parameters and planning switched off', () => {
    const r = planMaterial({ ...snapshot, params: null, supplier: null, alternatives: [] }, cfg);
    expect(r.exceptions.map((e) => e.code)).toEqual(expect.arrayContaining(['MISSING_PARAMETERS', 'MISSING_LEAD_TIME', 'MISSING_SUPPLIER', 'MISSING_COST']));
    expect(r.planningStatus).toBe('ORDER_NOW'); // order date unknown → needs attention now
    const off = planMaterial({ ...snapshot, params: { ...snapshot.params!, planningEnabled: false } }, cfg);
    expect(off.planningStatus).toBe('NOT_PLANNED');
    expect(off.suggested.qty).toBe(0);
  });

  it('inside the lead time: imminent stockout and late order', () => {
    const r = planMaterial({ ...snapshot, poLines: [], wmsReceipts: [] }, cfg);
    // b0: 10 − 12 = −2 → order 10 due 2026-07-01, release 2026-06-01 → late
    expect(r.suggested).toMatchObject({ qty: 10, requiredDate: '2026-07-01', orderDate: '2026-06-01', late: true });
    expect(r.planningStatus).toBe('ORDER_NOW');
    expect(r.exceptions.map((e) => e.code)).toEqual(expect.arrayContaining(['STOCKOUT_IMMINENT', 'LEAD_TIME_INSUFFICIENT']));
  });

  it('never adds costs in different currencies', () => {
    const r = planMaterial({ ...snapshot, poLines: [{ ...snapshot.poLines[0], currency: 'THB' }] }, cfg);
    expect(r.exceptions.map((e) => e.code)).toContain('MIXED_CURRENCY');
  });
});

describe('planning parameter validation', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { validateParams } = require('./params') as typeof import('./params');
  it('rejects conflicting or incomplete values', () => {
    expect(validateParams({ minStock: 9, maxStock: 5 }).errors).toContain('minStock cannot exceed maxStock');
    expect(validateParams({ unitCost: 3 }).errors.join(' ')).toMatch(/currency/);
    expect(validateParams({ unitCost: 3, currency: 'usd' }).errors.join(' ')).toMatch(/3-letter/);
    expect(validateParams({ lotSizing: 'MIN_MAX' }).errors).toContain('MIN_MAX lot sizing needs maxStock');
    expect(validateParams({ orderMultiple: 0 }).errors).toContain('orderMultiple must be > 0');
    expect(validateParams({ leadTimeDays: 2.5 }).errors.length).toBe(1);
    expect(validateParams({ forecastMethod: 'ARIMA' }).errors.length).toBe(1);
  });
  it('warns on questionable but allowed values', () => {
    const r = validateParams({ moq: 12, orderMultiple: 5, reorderPoint: 2, safetyStock: 5, leadTimeDays: 10 });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(expect.arrayContaining(['reorderPoint is below safetyStock', 'MOQ is not a multiple of the order multiple — orders are rounded up to the next multiple']));
  });
});
