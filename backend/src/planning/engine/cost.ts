import { r2 } from './workflow';
import { addDays } from './calendar';
import {
  CostLine,
  CostResult,
  ManpowerResult,
  MaterialResult,
  PricingInput,
  ProjectHeader,
  QuoteResult,
  ScenarioInputs,
  StageResult,
} from './types';

/**
 * Estimated project cost in the project currency. Only amounts with a known
 * basis are added; anything missing is listed and the estimate is marked
 * incomplete. These are planning estimates, never financial transactions.
 */
export function planCost(
  header: ProjectHeader,
  inp: ScenarioInputs,
  stages: StageResult[],
  manpower: ManpowerResult,
  materials: MaterialResult[],
  handledPallets: number | null,
  delayWorkingDays: number | null,
  asOf: string,
): CostResult {
  const cur = header.currency;
  const lines: CostLine[] = [];
  const missing: string[] = [];
  const rate = inp.labor.laborRatePerHour;

  // Materials
  const matMissing = materials.filter((m) => m.totalCost === null);
  const matTotal = materials.reduce((a, m) => a + (m.totalCost ?? 0), 0);
  if (materials.length) {
    lines.push({
      category: 'MATERIAL',
      label: 'Materials',
      amount: r2(matTotal),
      basis: `Σ total requirement × unit cost over ${materials.length - matMissing.length} of ${materials.length} materials`,
      status: matMissing.length ? 'MISSING' : 'ESTIMATED',
    });
    if (matMissing.length)
      missing.push(`Unit cost for ${matMissing.map((m) => m.code).join(', ')}`);
  }

  // Labour (regular hours; overtime priced separately below)
  const otHours =
    manpower.overtime?.authorized && manpower.capacityGapHours
      ? Math.min(manpower.capacityGapHours, manpower.overtime.hoursAvailable)
      : 0;
  if (rate === null) {
    lines.push({
      category: 'LABOR',
      label: 'Labour',
      amount: null,
      basis: 'No labour rate entered',
      status: 'MISSING',
    });
    missing.push('Labour rate per hour');
  } else {
    lines.push({
      category: 'LABOR',
      label: 'Labour',
      amount: r2((manpower.totalLaborHours - otHours) * rate),
      basis: `${r2(manpower.totalLaborHours - otHours)} h × ${rate} ${cur}/h`,
      status: 'ESTIMATED',
    });
    if (otHours > 0)
      lines.push({
        category: 'OVERTIME',
        label: 'Overtime',
        amount: r2(otHours * rate * (1 + inp.labor.overtimePremiumPct / 100)),
        basis: `${r2(otHours)} h × ${rate} × (1 + ${inp.labor.overtimePremiumPct}%)`,
        status: 'ESTIMATED',
      });
  }

  // Handling
  if (inp.costs.handlingCostPerPallet !== null) {
    if (handledPallets === null) {
      lines.push({
        category: 'HANDLING',
        label: 'Warehouse handling',
        amount: null,
        basis: 'Pallet count unknown (packaging data missing)',
        status: 'MISSING',
      });
      missing.push('Pallet count for handling cost');
    } else
      lines.push({
        category: 'HANDLING',
        label: 'Warehouse handling',
        amount: r2(handledPallets * inp.costs.handlingCostPerPallet),
        basis: `${handledPallets} pallets in + out × ${inp.costs.handlingCostPerPallet} ${cur}`,
        status: 'ESTIMATED',
      });
  }

  // Delay
  if (
    inp.costs.delayCostPerDay !== null &&
    delayWorkingDays !== null &&
    delayWorkingDays > 0
  )
    lines.push({
      category: 'DELAY',
      label: 'Delay beyond target',
      amount: r2(delayWorkingDays * inp.costs.delayCostPerDay),
      basis: `${delayWorkingDays} working days late × ${inp.costs.delayCostPerDay} ${cur}/day`,
      status: 'ESTIMATED',
    });

  for (const o of inp.costs.otherCosts)
    lines.push({
      category: 'OTHER',
      label: o.label,
      amount: r2(o.amount),
      basis: 'Entered manually',
      status: 'ESTIMATED',
    });

  const total = r2(lines.reduce((a, l) => a + (l.amount ?? 0), 0));
  const byStage = stages.map((s) => {
    const mats = materials.filter((m) => m.stages.includes(s.key));
    // A material consumed at several stages is attributed to the first one listed.
    const own = mats.filter((m) => m.stages[0] === s.key);
    const matCost = own.some((m) => m.totalCost === null)
      ? null
      : r2(own.reduce((a, m) => a + (m.totalCost ?? 0), 0));
    return {
      key: s.key,
      name: s.name,
      labor: rate === null ? null : r2(s.laborHours * rate),
      material: matCost,
    };
  });

  const complete = missing.length === 0;
  return {
    currency: cur,
    lines,
    total,
    costPerUnit: inp.quantity > 0 ? r2(total / inp.quantity) : null,
    complete,
    missing,
    byStage,
    note: `Estimate in ${cur} for planning only — not a confirmed price, purchase order or accounting entry.`,
    quote: planQuote(inp.costs.pricing, cur, total, complete, missing, inp.quantity, asOf),
  };
}

/**
 * Quoted price from the estimated cost. A margin or markup is applied only to
 * a complete cost estimate — a price built on missing costs would understate
 * the real cost, so it is withheld with the reason instead.
 */
/** 1234567.5 → "1,234,567.5" for readable explanations. */
export const fm = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function planQuote(
  pr: PricingInput,
  cur: string,
  costTotal: number,
  costComplete: boolean,
  costMissing: string[],
  quantity: number,
  asOf: string,
): QuoteResult | null {
  if (pr.method === 'NONE') return null;
  const contPct = pr.contingencyPct ?? 0;
  const contingencyAmount = r2((costTotal * contPct) / 100);
  const base = r2(costTotal + contingencyAmount);
  let price: number | null = null;
  let reason: string | null = null;
  let formula = '';
  const roundUp = (v: number) =>
    pr.roundTo ? r2(Math.ceil(v / pr.roundTo - 1e-9) * pr.roundTo) : r2(v);
  const rounding = pr.roundTo ? `, rounded up to a multiple of ${fm(pr.roundTo)}` : '';
  const contText = contPct ? ` (cost ${fm(costTotal)} + ${contPct}% contingency)` : '';

  if (pr.method === 'FIXED') {
    if (pr.fixedPrice === null) reason = 'Selling price not entered.';
    else {
      price = r2(pr.fixedPrice);
      formula = `Selling price entered: ${fm(price)} ${cur}, compared with cost ${fm(base)}${contText}`;
    }
  } else if (!costComplete) {
    reason = `Cost estimate incomplete (${costMissing.join('; ')}) — a price would understate the cost.`;
  } else if (pr.method === 'MARGIN') {
    if (pr.marginPct === null) reason = 'Margin % not entered.';
    else {
      price = roundUp(base / (1 - pr.marginPct / 100));
      formula = `${fm(base)}${contText} ÷ (1 − ${pr.marginPct}%)${rounding}`;
    }
  } else {
    if (pr.markupPct === null) reason = 'Markup % not entered.';
    else {
      price = roundUp(base * (1 + pr.markupPct / 100));
      formula = `${fm(base)}${contText} × (1 + ${pr.markupPct}%)${rounding}`;
    }
  }

  // Margin is only meaningful against a complete cost.
  const known = price !== null && costComplete;
  const marginAmount = known ? r2(price! - base) : null;
  const vat = price !== null && pr.vatPct !== null ? r2((price * pr.vatPct) / 100) : null;
  if (pr.method === 'FIXED' && price !== null && !costComplete)
    reason = `Cost estimate incomplete (${costMissing.join('; ')}) — the margin cannot be checked.`;
  return {
    method: pr.method,
    currency: cur,
    costBase: r2(costTotal),
    contingencyPct: contPct,
    contingencyAmount,
    costWithContingency: base,
    price,
    pricePerUnit: price !== null && quantity > 0 ? r2(price / quantity) : null,
    marginAmount,
    marginPct: known && price! > 0 ? r2((marginAmount! / price!) * 100) : null,
    markupPct: known && base > 0 ? r2((marginAmount! / base) * 100) : null,
    vatPct: pr.vatPct,
    vatAmount: vat,
    priceIncludingVat: vat !== null ? r2(price! + vat) : null,
    validUntil: pr.validityDays !== null ? addDays(asOf, pr.validityDays) : null,
    complete: known,
    belowCost: known && marginAmount! < 0,
    formula,
    reason,
  };
}
