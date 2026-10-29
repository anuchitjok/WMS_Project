/**
 * Warranty evaluation (pure — no database access).
 *
 * 1. Candidate rules: ACTIVE rules whose scope matches the unit.
 * 2. Each candidate needs the unit's date for its start basis. A rule is only
 *    in effect if that start date falls inside its effective window
 *    (effectiveFrom ≤ start < effectiveTo). A candidate whose start date is
 *    unknown cannot be ruled out and stays in.
 * 3. Most specific scope wins: SERIAL > PRODUCT > PRODUCT_MODEL > CATEGORY >
 *    BRAND > VENDOR > PRODUCT_TYPE; between equally specific rules the higher
 *    priority wins. Two or more rules still tied = CONFLICT: no decision is made.
 * 4. The winning rule's start date missing = START_DATE_UNKNOWN (the system never
 *    falls back to a less specific rule or another date).
 * 5. Expiry = start + duration − 1 day (the last covered day, inclusive).
 *    Months are calendar months; a day that does not exist in the target month
 *    is clamped to its last day (31 Jan + 1 month = 28/29 Feb).
 *    Status: NOT_STARTED before the start date, ACTIVE through the last covered
 *    day, EXPIRED after it.
 */
export type WarrantyScope = 'SERIAL' | 'PRODUCT' | 'PRODUCT_MODEL' | 'CATEGORY' | 'BRAND' | 'VENDOR' | 'PRODUCT_TYPE';
export type StartBasis = 'RECEIPT_DATE' | 'GOODS_ISSUE_DATE' | 'INVOICE_DATE' | 'INSTALLATION_DATE' | 'ACTIVATION_DATE';
export type DurationUnit = 'DAYS' | 'MONTHS' | 'YEARS';
export type WarrantyStatus = 'NOT_STARTED' | 'ACTIVE' | 'EXPIRED' | 'NO_RULE' | 'START_DATE_UNKNOWN' | 'CONFLICT';

export const SPECIFICITY: Record<WarrantyScope, number> = {
  SERIAL: 1, PRODUCT: 2, PRODUCT_MODEL: 3, CATEGORY: 4, BRAND: 5, VENDOR: 6, PRODUCT_TYPE: 7,
};

export const START_BASIS_LABEL: Record<StartBasis, string> = {
  RECEIPT_DATE: 'Receipt date (WMS)',
  GOODS_ISSUE_DATE: 'Goods issue date (WMS)',
  INVOICE_DATE: 'Invoice date (recorded)',
  INSTALLATION_DATE: 'Installation date (recorded)',
  ACTIVATION_DATE: 'Activation date (recorded)',
};

export interface RuleLike {
  id: string;
  ruleCode: string;
  version: number;
  name: string;
  warrantyType: string;
  scopeType: WarrantyScope;
  scopeValue: string;
  startBasis: StartBasis;
  durationValue: number;
  durationUnit: DurationUnit;
  priority: number;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface UnitFacts {
  serialNumber: string | null;
  productId: string | null;
  model: string | null;
  category: string | null;
  brandId: string | null;
  productType: string | null;
  vendorIds: string[];
  dates: Partial<Record<StartBasis, Date | null>>;
}

export interface CandidateTrace {
  ruleId: string;
  ruleCode: string;
  version: number;
  scope: string;
  specificity: number;
  priority: number;
  startBasis: StartBasis;
  startDate: string | null;
  inEffect: boolean | null; // null = start date unknown, cannot tell
  note: string;
}

export interface WarrantyDecision {
  status: WarrantyStatus;
  rule: RuleLike | null;
  startBasis: StartBasis | null;
  startDate: Date | null;
  expiryDate: Date | null;
  daysRemaining: number | null;
  reason: string;
  candidates: CandidateTrace[];
  conflictingRules: Array<{ ruleCode: string; version: number }>;
}

const DAY = 86_400_000;
const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const eq = (a: string | null | undefined, b: string) => !!a && a.trim().toLowerCase() === b.trim().toLowerCase();

export function addDuration(start: Date, value: number, unit: DurationUnit): Date {
  const s = dayOf(start);
  if (unit === 'DAYS') return new Date(s.getTime() + value * DAY);
  const months = unit === 'YEARS' ? value * 12 : value;
  const y = s.getUTCFullYear();
  const m = s.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(s.getUTCDate(), lastDay)));
}

/** Last covered day (inclusive). */
export function expiryDate(start: Date, value: number, unit: DurationUnit): Date {
  return new Date(addDuration(start, value, unit).getTime() - DAY);
}

export function ruleMatches(r: RuleLike, u: UnitFacts): boolean {
  switch (r.scopeType) {
    case 'SERIAL': return eq(u.serialNumber, r.scopeValue);
    case 'PRODUCT': return u.productId === r.scopeValue;
    case 'PRODUCT_MODEL': return eq(u.model, r.scopeValue);
    case 'CATEGORY': return eq(u.category, r.scopeValue);
    case 'BRAND': return u.brandId === r.scopeValue;
    case 'VENDOR': return u.vendorIds.includes(r.scopeValue);
    case 'PRODUCT_TYPE': return u.productType === r.scopeValue;
  }
}

export function validateRule(r: Pick<RuleLike, 'durationValue' | 'durationUnit' | 'effectiveFrom' | 'effectiveTo' | 'scopeValue'>): string[] {
  const e: string[] = [];
  if (!Number.isInteger(r.durationValue) || r.durationValue < 1) e.push('Duration must be a whole number ≥ 1');
  if (!['DAYS', 'MONTHS', 'YEARS'].includes(r.durationUnit)) e.push('Duration unit must be DAYS, MONTHS or YEARS');
  if (!r.scopeValue || !r.scopeValue.trim()) e.push('Scope value is required');
  if (r.effectiveTo && r.effectiveTo.getTime() <= r.effectiveFrom.getTime()) e.push('Effective-to must be after effective-from');
  return e;
}

export function evaluateWarranty(rules: RuleLike[], unit: UnitFacts, asOf: Date): WarrantyDecision {
  const today = dayOf(asOf);
  const matching = rules.filter((r) => r.status === 'ACTIVE' && ruleMatches(r, unit));
  const traces: CandidateTrace[] = matching.map((r) => {
    const start = unit.dates[r.startBasis] ?? null;
    let inEffect: boolean | null = null;
    let note = `${START_BASIS_LABEL[r.startBasis]} not available`;
    if (start) {
      const s = dayOf(start).getTime();
      inEffect = dayOf(r.effectiveFrom).getTime() <= s && (!r.effectiveTo || s < dayOf(r.effectiveTo).getTime());
      note = inEffect ? 'In effect on the start date' : `Not in effect on the start date ${iso(start)}`;
    }
    return {
      ruleId: r.id, ruleCode: r.ruleCode, version: r.version, scope: `${r.scopeType}=${r.scopeValue}`,
      specificity: SPECIFICITY[r.scopeType], priority: r.priority, startBasis: r.startBasis,
      startDate: iso(start), inEffect, note,
    };
  });
  const empty = { rule: null, startBasis: null, startDate: null, expiryDate: null, daysRemaining: null, candidates: traces, conflictingRules: [] };
  if (!matching.length) {
    return { ...empty, status: 'NO_RULE', reason: 'No active warranty rule matches this unit.' };
  }
  const live = matching.filter((_, i) => traces[i].inEffect !== false);
  if (!live.length) {
    return { ...empty, status: 'NO_RULE', reason: 'Matching rules exist, but none was in effect on the unit\'s start date.' };
  }
  live.sort((a, b) => SPECIFICITY[a.scopeType] - SPECIFICITY[b.scopeType] || b.priority - a.priority);
  const best = live[0];
  const tied = live.filter((r) => SPECIFICITY[r.scopeType] === SPECIFICITY[best.scopeType] && r.priority === best.priority);
  if (tied.length > 1) {
    return {
      ...empty,
      status: 'CONFLICT',
      reason: `${tied.length} rules are equally specific (${best.scopeType}) with the same priority (${best.priority}); set different priorities to resolve.`,
      conflictingRules: tied.map((r) => ({ ruleCode: r.ruleCode, version: r.version })),
    };
  }
  const start = unit.dates[best.startBasis] ?? null;
  if (!start) {
    return {
      ...empty,
      rule: best,
      startBasis: best.startBasis,
      status: 'START_DATE_UNKNOWN',
      reason: `Rule ${best.ruleCode} v${best.version} starts from the ${START_BASIS_LABEL[best.startBasis].toLowerCase()}, which is not recorded for this unit.`,
    };
  }
  const s = dayOf(start);
  const exp = expiryDate(s, best.durationValue, best.durationUnit);
  const status: WarrantyStatus = today.getTime() < s.getTime() ? 'NOT_STARTED' : today.getTime() <= exp.getTime() ? 'ACTIVE' : 'EXPIRED';
  const daysRemaining = status === 'EXPIRED' ? 0 : Math.round((exp.getTime() - Math.max(today.getTime(), s.getTime())) / DAY) + 1;
  const others = live.length - 1;
  return {
    status,
    rule: best,
    startBasis: best.startBasis,
    startDate: s,
    expiryDate: exp,
    daysRemaining,
    reason:
      `Rule ${best.ruleCode} v${best.version} (${best.scopeType}${others ? `, most specific of ${live.length} matching rules` : ''}): ` +
      `${best.durationValue} ${best.durationUnit.toLowerCase()} from ${START_BASIS_LABEL[best.startBasis].toLowerCase()} ${iso(s)} → covered through ${iso(exp)}.`,
    candidates: traces,
    conflictingRules: [],
  };
}
