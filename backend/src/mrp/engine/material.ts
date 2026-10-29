import { AccuracyResult, backtest, selectMethod } from './accuracy';
import { Classification, classify } from './classify';
import { MrpConfigShape, methodSpec } from './config';
import { FORECAST_METHODS, ForecastMethod, ForecastResult, applyOverrides, forecast } from './forecast';
import { PlanResult, bucketize, buildBuckets, forecastToBuckets, lotSize, plan } from './netting';
import { addDays, isoDate, periodStart, startOfDay } from './periods';
import { EvaluatedPoLine, InventoryPosition, PoLineInput, allocateWmsReceipts, evaluatePoLine, inventoryPosition } from './position';
import { UsageEvent, UsageStats, buildSeries, comparePeriods, round, usageStats } from './usage';

/**
 * Everything one material's plan depends on. Stored with each run line, so the
 * plan can be recalculated from the stored snapshot and compared (reproducibility).
 * Dates are ISO strings so the snapshot survives JSON storage unchanged.
 */
export interface MaterialSnapshot {
  asOf: string;
  productId: string;
  sku: string;
  description: string;
  category: string | null;
  unit: string;
  productStatus: string;
  productUnitCost: number | null;
  warehouseId: string | null;
  params: ResolvedParams | null;
  supplier: SupplierTerms | null;
  alternatives: SupplierTerms[];
  stock: Array<{ status: string; quantity: number }>;
  usage: Array<{ date: string; qty: number; kind: UsageEvent['kind']; ref?: string }>;
  /** First goods issue in scope when it falls inside the history window (history starts there); null when issued before the window or never. Absent on runs made before this field existed. */
  firstUsageDate?: string | null;
  demand: Array<{ date: string; qty: number; ref: string; status: string }>;
  poLines: Array<Omit<PoLineInput, 'expectedDate' | 'orderDate'> & { expectedDate: string | null; orderDate: string | null }>;
  wmsReceipts: Array<{ poNumber: string; productId: string; quantity: number; date: string }>;
  overrides: Array<{ id: string; periodStart: string; mode: 'REPLACE' | 'ADD'; quantity: number }>;
}

export interface ResolvedParams {
  id: string;
  planningEnabled: boolean;
  replenishmentMethod: 'PURCHASE' | 'TRANSFER' | 'NONE';
  lotSizing: 'LOT_FOR_LOT' | 'MIN_MAX';
  leadTimeDays: number | null;
  leadTimeVariabilityDays: number | null;
  moq: number | null;
  orderMultiple: number | null;
  minStock: number | null;
  maxStock: number | null;
  safetyStock: number | null;
  reorderPoint: number | null;
  targetDaysOfSupply: number | null;
  unitCost: number | null;
  currency: string | null;
  costBasis: string | null;
  criticality: string | null;
  forecastMethod: string | null;
  warehouseSpecific: boolean;
}

export interface SupplierTerms {
  vendorId: string;
  vendorName: string;
  supplierPartNumber: string | null;
  isPreferred: boolean;
  leadTimeDays: number | null;
  moq: number | null;
  orderMultiple: number | null;
  unitPrice: number | null;
  currency: string | null;
  priceSource: string | null;
  priceValidTo: string | null;
  priceValidFrom: string | null;
  purchaseUom: string | null;
  uomConversion: number | null;
}

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
export interface PlanningException {
  code: string;
  severity: Severity;
  message: string;
  recommendation: string;
  detail?: Record<string, unknown>;
}

export type PlanningStatus = 'ORDER_NOW' | 'PLANNED' | 'OK' | 'NOT_PLANNED';

export interface MaterialPlan {
  planningStatus: PlanningStatus;
  urgency: number;
  forecastMethod: ForecastMethod;
  methodSelection: string;
  forecast: ForecastResult;
  forecastFinal: number[];
  overridesApplied: ReturnType<typeof applyOverrides>['applied'];
  accuracy: AccuracyResult[];
  usage: { series: ReturnType<typeof buildSeries>; stats: UsageStats; comparisons: ReturnType<typeof comparePeriods>; lastUsageDate: string | null };
  position: InventoryPosition;
  supply: { lines: EvaluatedPoLine[]; openQty: number; overdueQty: number; nextInboundDate: string | null; pastDueIncluded: boolean; beyondHorizon: number };
  demand: { openQty: number; pastDue: number; beyondHorizon: number };
  safetyStock: number;
  leadTimeDays: number | null;
  moq: number | null;
  orderMultiple: number | null;
  plan: PlanResult;
  suggested: { qty: number; orderDate: string | null; requiredDate: string | null; late: boolean; totalPlannedInHorizon: number };
  cost: { unitCost: number | null; currency: string | null; source: string | null; label: string; estimatedCost: number | null; horizonCost: number | null };
  alternatives: Array<{ vendorId: string; vendorName: string; qty: number; unitPrice: number | null; currency: string | null; cost: number | null; leadTimeDays: number | null; orderDate: string | null; late: boolean | null }>;
  classification: Classification;
  exceptions: PlanningException[];
}

const SEVERITY_WEIGHT: Record<Severity, number> = { HIGH: 100, MEDIUM: 10, LOW: 1 };

export function planMaterial(s: MaterialSnapshot, cfg: MrpConfigShape): MaterialPlan {
  const asOf = new Date(s.asOf);
  const today = startOfDay(asOf);
  const g = cfg.granularity;
  const p = s.params;
  const exceptions: PlanningException[] = [];
  const ex = (code: string, severity: Severity, message: string, recommendation: string, detail?: Record<string, unknown>) =>
    exceptions.push({ code, severity, message, recommendation, detail });

  // ── Usage history ────────────────────────────────────────────────────────
  const events: UsageEvent[] = s.usage.map((u) => ({ ...u, date: new Date(u.date) }));
  const series = buildSeries(events, asOf, cfg.historyPeriods, g, cfg.usageBasis, s.firstUsageDate ? new Date(s.firstUsageDate) : null);
  const stats = usageStats(series, cfg.pattern);
  const relevant = events.filter((e) => (cfg.usageBasis === 'CONFIRMED_USAGE' ? e.kind === 'CONSUMED' : e.kind === 'ISSUE'));
  const lastUsage = relevant.length ? new Date(Math.max(...relevant.map((e) => e.date.getTime()))) : null;
  const history = series.points.map((x) => x.qty);

  // ── Forecast ─────────────────────────────────────────────────────────────
  const accuracy = FORECAST_METHODS.map((m) => backtest(history, methodSpec(cfg, m), cfg.accuracy.evalPeriods, cfg.accuracy.minPoints));
  let method: ForecastMethod = cfg.defaultMethod;
  let methodSelection = 'Configured default method';
  if (p?.forecastMethod && FORECAST_METHODS.includes(p.forecastMethod as ForecastMethod)) {
    method = p.forecastMethod as ForecastMethod;
    methodSelection = 'Set on the material planning parameters';
  } else if (cfg.autoSelectMethod) {
    const best = selectMethod(accuracy);
    if (best) {
      method = best.method as ForecastMethod;
      methodSelection = `Lowest back-tested WAPE (${best.wape}) over ${best.n} period(s)`;
    } else methodSelection = 'Automatic selection found no method with enough back-test data; configured default used';
  }
  const fc = forecast(history, methodSpec(cfg, method), cfg.horizonPeriods);
  const buckets = buildBuckets(asOf, cfg.horizonPeriods, g);
  const firstPeriod = periodStart(today, g).getTime();
  const ovInputs = s.overrides
    .map((o) => ({ id: o.id, mode: o.mode, quantity: o.quantity, periodIndex: buckets.findIndex((b, i) => (i === 0 ? firstPeriod : b.start.getTime()) === new Date(o.periodStart).getTime()) }))
    .filter((o) => o.periodIndex >= 0);
  const ov = applyOverrides(fc.perPeriod, ovInputs);
  const forecastBuckets = forecastToBuckets(ov.final, buckets);

  // ── Inventory position ───────────────────────────────────────────────────
  const position = inventoryPosition(s.stock, cfg.countInspectionAsUsable);

  // ── Inbound supply ───────────────────────────────────────────────────────
  const poInputs: PoLineInput[] = s.poLines.map((l) => ({ ...l, expectedDate: l.expectedDate ? new Date(l.expectedDate) : null, orderDate: l.orderDate ? new Date(l.orderDate) : null }));
  const received = allocateWmsReceipts(poInputs, s.wmsReceipts.map((r) => ({ ...r, date: new Date(r.date) })));
  const allSuppliers = [s.supplier, ...s.alternatives].filter((x): x is SupplierTerms => !!x);
  const evaluated = poInputs.map((l) => {
    const sup = allSuppliers.find((x) => x.vendorId === l.vendorId && x.purchaseUom && l.uom && x.purchaseUom.toLowerCase() === l.uom.toLowerCase());
    return evaluatePoLine(l, received.get(l.id) ?? 0, asOf, s.unit, sup?.uomConversion ?? null);
  });
  const eligible = evaluated.filter((l) => l.eligible);
  const supplyBuckets = bucketize(eligible.map((l) => ({ date: new Date(l.expectedDate!), qty: l.convertedOutstanding })), buckets, cfg.pastDueSupply);
  const overdue = eligible.filter((l) => l.overdue);
  const openQty = round(eligible.reduce((a, l) => a + l.convertedOutstanding, 0));
  const future = eligible.filter((l) => !l.overdue).map((l) => l.expectedDate!).sort();
  const nextInbound = overdue.length ? overdue.map((l) => l.expectedDate!).sort()[0] : future[0] ?? null;

  // ── Open demand (requests not yet holding stock) ────────────────────────
  const demandBuckets = bucketize(s.demand.map((d) => ({ date: new Date(d.date), qty: d.qty })), buckets, 'FIRST_BUCKET');
  const openDemand = round(s.demand.reduce((a, d) => a + d.qty, 0));

  // ── Parameters (material overrides supplier defaults) ───────────────────
  const safetyStock = p?.safetyStock ?? 0;
  const leadTimeDays = p?.leadTimeDays ?? s.supplier?.leadTimeDays ?? null;
  const moq = p?.moq ?? s.supplier?.moq ?? null;
  const orderMultiple = p?.orderMultiple ?? s.supplier?.orderMultiple ?? null;
  const notPlannedReason = !p
    ? null
    : !p.planningEnabled
      ? 'Planning is switched off for this material'
      : p.replenishmentMethod === 'NONE'
        ? 'Replenishment method is NONE'
        : null;
  const discontinued = s.productStatus === 'DISCONTINUED';
  const planned = !discontinued && !notPlannedReason;

  const result = plan({
    asOf,
    buckets,
    usableStock: position.usable,
    safetyStock,
    forecast: forecastBuckets,
    confirmed: demandBuckets.perBucket,
    receipts: supplyBuckets.perBucket,
    demandCombination: cfg.demandCombination,
    lotSizing: p?.lotSizing ?? 'LOT_FOR_LOT',
    reorderPoint: p?.reorderPoint ?? null,
    maxStock: p?.maxStock ?? null,
    moq,
    orderMultiple,
    leadTimeDays,
  });
  if (!planned) {
    // Projection is still shown; no orders are suggested.
    for (const b of result.buckets) {
      b.planned = 0;
      b.releaseDate = null;
      b.late = false;
      b.projected = b.projectedWithoutOrders;
    }
    result.plannedOrders = [];
    result.totals.planned = 0;
  }

  const first = result.plannedOrders[0];
  const suggested = {
    qty: first?.qty ?? 0,
    orderDate: first?.releaseDate ?? null,
    requiredDate: first?.receiptDate ?? null,
    late: first?.late ?? false,
    totalPlannedInHorizon: result.totals.planned,
  };

  // ── Cost (always an estimate; currency never mixed or converted) ────────
  const supPriceValid = (x: SupplierTerms | null) =>
    !!x && x.unitPrice !== null && (!x.priceValidTo || new Date(x.priceValidTo).getTime() >= today.getTime()) && (!x.priceValidFrom || new Date(x.priceValidFrom).getTime() <= asOf.getTime());
  let unitCost: number | null = null;
  let currency: string | null = null;
  let source: string | null = null;
  if (supPriceValid(s.supplier)) {
    unitCost = s.supplier!.unitPrice;
    currency = s.supplier!.currency;
    source = `SUPPLIER_${(s.supplier!.priceSource ?? 'PRICE').toUpperCase()}`;
  } else if (p?.unitCost != null) {
    unitCost = p.unitCost;
    currency = p.currency;
    source = `PLANNING_${(p.costBasis ?? 'COST').toUpperCase()}`;
  } else if (s.productUnitCost && s.productUnitCost > 0) {
    unitCost = s.productUnitCost;
    currency = null;
    source = 'PRODUCT_MASTER';
  }
  const cost = {
    unitCost,
    currency,
    source,
    label: unitCost === null ? 'No cost data' : currency ? 'Estimated' : 'Estimated — currency not recorded',
    estimatedCost: unitCost !== null ? round(suggested.qty * unitCost, 2) : null,
    horizonCost: unitCost !== null ? round(suggested.totalPlannedInHorizon * unitCost, 2) : null,
  };

  // Alternative-supplier scenario for the first planned order.
  const alternatives = first
    ? s.alternatives.map((a) => {
        const qty = lotSize(Math.max(first.net, 0) || first.qty, a.moq ?? p?.moq ?? null, a.orderMultiple ?? p?.orderMultiple ?? null);
        const lt = a.leadTimeDays ?? p?.leadTimeDays ?? null;
        const rel = lt === null ? null : addDays(new Date(first.receiptDate), -lt);
        const price = supPriceValid(a) ? a.unitPrice : null;
        return {
          vendorId: a.vendorId, vendorName: a.vendorName, qty, unitPrice: price, currency: price === null ? null : a.currency,
          cost: price === null ? null : round(qty * price, 2), leadTimeDays: lt,
          orderDate: isoDate(rel), late: rel === null ? null : rel.getTime() < today.getTime(),
        };
      })
    : [];

  const classification = classify({
    stats, lastUsageDate: lastUsage, asOf, onHand: position.onHand, usable: position.usable, openSupply: openQty,
    safetyStock, unitCost, criticality: p?.criticality ?? null, cfg,
  });

  // ── Exceptions ───────────────────────────────────────────────────────────
  if (!p) ex('MISSING_PARAMETERS', 'MEDIUM', 'No planning parameters for this material.', 'Set lead time, safety stock, MOQ and supplier on the Planning Parameters page.');
  if (discontinued && (openDemand > 0 || result.totals.forecast > 0)) ex('DISCONTINUED_WITH_DEMAND', 'LOW', 'Discontinued product still has demand.', 'Confirm a replacement part or phase-out plan; no orders are suggested.');
  if (planned) {
    if (p && p.safetyStock === null) ex('MISSING_SAFETY_STOCK', 'LOW', 'Safety stock not set — planned with 0.', 'Set a safety stock if a buffer is required.');
    if (leadTimeDays === null) ex('MISSING_LEAD_TIME', 'MEDIUM', 'No lead time on the material or its supplier — order dates cannot be calculated.', 'Enter the supplier lead time.');
    if ((p?.replenishmentMethod ?? 'PURCHASE') === 'PURCHASE' && !s.supplier) ex('MISSING_SUPPLIER', 'MEDIUM', 'No preferred supplier.', 'Add an approved supplier and mark one preferred.');
    if (unitCost === null) ex('MISSING_COST', 'LOW', 'No unit cost — replenishment cost cannot be estimated.', 'Add a supplier price or a planning unit cost.');
  }
  if (stats.nonZeroPeriods === 0) ex('NO_USAGE_HISTORY', 'LOW', `No usage in the last ${series.points.length} ${g.toLowerCase()}(s).`, 'Forecast is 0; use a manual forecast if demand is expected.');
  else if (!fc.sufficient) ex('INSUFFICIENT_HISTORY', 'LOW', fc.warnings[0] ?? 'Not enough history for the chosen method.', 'Treat the forecast as indicative; consider a manual forecast.');
  const chosenAcc = accuracy.find((a) => a.method === method);
  if (chosenAcc && !chosenAcc.sufficient && stats.nonZeroPeriods > 0) ex('FORECAST_NOT_VALIDATED', 'LOW', `Forecast accuracy could not be measured: ${chosenAcc.note}`, 'Accuracy will be measured once more history exists.');
  if (series.flooredPeriods > 0) ex('RETURNS_EXCEED_ISSUES', 'LOW', `${series.flooredPeriods} period(s) had more unused returns than issues; counted as 0.`, 'Check the returns against the original issues.');
  if (planned && result.firstShortage) {
    const ltEnd = addDays(today, leadTimeDays ?? 0).getTime();
    const imminent = new Date(result.firstShortage.date).getTime() <= ltEnd || result.firstShortage.bucket === 0;
    ex(imminent ? 'STOCKOUT_IMMINENT' : 'PROJECTED_SHORTAGE', imminent ? 'HIGH' : 'MEDIUM',
      `Projected shortage of ${round(result.firstShortage.qty, 2)} from ${result.firstShortage.date} if nothing new is ordered.`,
      imminent ? 'Expedite open supply or order now; the shortage falls inside the lead time.' : 'Release the planned order on its order date.',
      { firstShortage: result.firstShortage, maxShortage: result.maxShortage });
  }
  if (planned && position.usable < safetyStock) ex('BELOW_SAFETY_STOCK', 'MEDIUM', `Usable stock ${position.usable} is below safety stock ${safetyStock}.`, 'Review open supply and the planned order.');
  const late = result.plannedOrders.filter((o) => o.late);
  if (late.length) ex('LEAD_TIME_INSUFFICIENT', 'HIGH', `${late.length} planned order(s) should already have been placed (lead time ${leadTimeDays} days).`, 'Order now and expedite, or use an alternative supplier with a shorter lead time.', { orders: late });
  const share = cfg.classification.moqExcessShare;
  if (share !== null) {
    const big = result.plannedOrders.filter((o) => o.qty > 0 && o.lotSizeExcess / o.qty > share);
    if (big.length) ex('MOQ_EXCESS', 'LOW', `MOQ / order multiple adds ${big[0].lotSizeExcess} above the net requirement of ${big[0].net}.`, 'Check whether the MOQ or pack size can be negotiated.', { orders: big });
  }
  if (overdue.length) ex('OVERDUE_PO', 'MEDIUM', `${overdue.length} PO line(s) past their expected date, ${round(overdue.reduce((a, l) => a + l.convertedOutstanding, 0))} outstanding.`, cfg.pastDueSupply === 'FIRST_BUCKET' ? 'Counted as arriving now — confirm the new date with the supplier.' : 'Excluded from supply — confirm the new date with the supplier.', { lines: overdue.map((l) => `${l.poNumber}/${l.lineNumber}`) });
  const excluded = evaluated.filter((l) => !l.eligible && l.reason && !['PO line cancelled', 'PO line closed', 'Fully received or cancelled'].includes(l.reason));
  if (excluded.length) ex('PO_EXCLUDED', 'MEDIUM', `${excluded.length} open PO line(s) could not be used: ${excluded[0].reason}.`, 'Fix the PO line (expected date / unit) in the next import.', { lines: excluded.map((l) => ({ po: `${l.poNumber}/${l.lineNumber}`, reason: l.reason })) });
  if (classification.excessQty && classification.excessQty > 0) ex('EXCESS_STOCK', 'LOW', `${classification.excessQty} above ${cfg.classification.excessMonthsOfSupply} month(s) of usage plus safety stock.`, 'Review open POs for this material and consider redeploying stock.');
  if (p?.maxStock != null && position.usable > p.maxStock) ex('ABOVE_MAX_STOCK', 'LOW', `Usable stock ${position.usable} is above the maximum ${p.maxStock}.`, 'Hold further orders; check open POs.');
  const conflicts: string[] = [];
  if (p) {
    if (p.minStock !== null && p.maxStock !== null && p.minStock > p.maxStock) conflicts.push('min stock > max stock');
    if (p.safetyStock !== null && p.maxStock !== null && p.safetyStock > p.maxStock) conflicts.push('safety stock > max stock');
    if (p.reorderPoint !== null && p.safetyStock !== null && p.reorderPoint < p.safetyStock) conflicts.push('reorder point < safety stock');
    if (p.moq !== null && p.maxStock !== null && p.moq > p.maxStock) conflicts.push('MOQ > max stock');
    if (p.lotSizing === 'MIN_MAX' && p.maxStock === null) conflicts.push('MIN_MAX lot sizing without a max stock');
  }
  if (conflicts.length) ex('PARAMETER_CONFLICT', 'MEDIUM', `Conflicting parameters: ${conflicts.join('; ')}.`, 'Correct the planning parameters.', { conflicts });
  const currencies = new Set([currency, ...s.poLines.map((l) => l.currency)].filter(Boolean));
  if (currencies.size > 1) ex('MIXED_CURRENCY', 'LOW', `Costs for this material are in several currencies (${[...currencies].join(', ')}); they are not converted or added together.`, 'Agree a currency conversion policy before comparing these costs.');

  let planningStatus: PlanningStatus = 'OK';
  if (!planned) planningStatus = 'NOT_PLANNED';
  else if (first) {
    const urgentBy = addDays(today, cfg.classification.urgentWithinDays).getTime();
    planningStatus = first.late || first.releaseDate === null || new Date(first.releaseDate).getTime() <= urgentBy ? 'ORDER_NOW' : 'PLANNED';
  }
  const urgency = exceptions.reduce((a, e) => a + SEVERITY_WEIGHT[e.severity], 0) + (planningStatus === 'ORDER_NOW' ? 50 : 0);
  if (notPlannedReason || discontinued) result.warnings.push(discontinued ? 'Product is DISCONTINUED: no orders suggested.' : notPlannedReason!);

  return {
    planningStatus,
    urgency,
    forecastMethod: method,
    methodSelection,
    forecast: fc,
    forecastFinal: ov.final,
    overridesApplied: ov.applied,
    accuracy,
    usage: { series, stats, comparisons: comparePeriods(series), lastUsageDate: isoDate(lastUsage) },
    position,
    supply: { lines: evaluated, openQty, overdueQty: round(overdue.reduce((a, l) => a + l.convertedOutstanding, 0)), nextInboundDate: nextInbound, pastDueIncluded: cfg.pastDueSupply === 'FIRST_BUCKET', beyondHorizon: supplyBuckets.beyondHorizon },
    demand: { openQty: openDemand, pastDue: demandBuckets.pastDue, beyondHorizon: demandBuckets.beyondHorizon },
    safetyStock,
    leadTimeDays,
    moq,
    orderMultiple,
    plan: result,
    suggested,
    cost,
    alternatives,
    classification,
    exceptions,
  };
}
