import { MrpConfigShape } from './config';
import { daysBetween } from './periods';
import { UsageStats, round } from './usage';

/**
 * Material classification. Every threshold comes from configuration; a
 * threshold left empty switches that classification off (reported as
 * NOT_CONFIGURED), so nothing is labelled by an unapproved built-in number.
 *
 *  NON_MOVING   stock on hand and no usage for more than nonMovingDays
 *  FAST         average monthly usage ≥ fastMinMonthlyUsage
 *  SLOW         0 < average monthly usage ≤ slowMaxMonthlyUsage
 *  NORMAL       between the two
 *  NO_ACTIVITY  no usage and nothing on hand
 *  high variability  coefficient of variation ≥ highVariabilityCv
 *  excess       usable + open supply − (avg monthly usage × excessMonthsOfSupply + safety stock)
 *  high value   on-hand × unit cost ≥ highValueThreshold (in the material's cost currency)
 */
export type MovementClass = 'FAST' | 'NORMAL' | 'SLOW' | 'NON_MOVING' | 'NO_ACTIVITY' | 'NOT_CONFIGURED';

export interface Classification {
  movement: MovementClass;
  highVariability: boolean | null;
  highValue: boolean | null;
  stockValue: number | null;
  critical: boolean;
  daysSinceLastUsage: number | null;
  monthsOfSupply: number | null;
  excessQty: number | null;
  potentialObsolete: boolean;
  basis: string[];
}

export function classify(input: {
  stats: UsageStats;
  lastUsageDate: Date | null;
  asOf: Date;
  onHand: number;
  usable: number;
  openSupply: number;
  safetyStock: number;
  unitCost: number | null;
  criticality: string | null;
  cfg: MrpConfigShape;
}): Classification {
  const c = input.cfg.classification;
  const basis: string[] = [];
  const avgM = input.stats.avgMonthly;
  const daysSince = input.lastUsageDate ? Math.floor(daysBetween(input.lastUsageDate, input.asOf)) : null;

  let movement: MovementClass = 'NOT_CONFIGURED';
  if (input.stats.total === 0 && input.onHand <= 0) {
    movement = 'NO_ACTIVITY';
  } else if (c.nonMovingDays !== null && input.onHand > 0 && (daysSince === null || daysSince > c.nonMovingDays)) {
    movement = 'NON_MOVING';
    basis.push(`No usage for ${daysSince === null ? 'the whole history window' : `${daysSince} days`} (> ${c.nonMovingDays}) with ${input.onHand} on hand.`);
  } else if (c.fastMinMonthlyUsage !== null && avgM >= c.fastMinMonthlyUsage) {
    movement = 'FAST';
    basis.push(`Average monthly usage ${avgM} ≥ ${c.fastMinMonthlyUsage}.`);
  } else if (c.slowMaxMonthlyUsage !== null && avgM > 0 && avgM <= c.slowMaxMonthlyUsage) {
    movement = 'SLOW';
    basis.push(`Average monthly usage ${avgM} ≤ ${c.slowMaxMonthlyUsage}.`);
  } else if (c.fastMinMonthlyUsage !== null || c.slowMaxMonthlyUsage !== null) {
    movement = 'NORMAL';
  }

  const highVariability = c.highVariabilityCv === null || input.stats.cv === null ? null : input.stats.cv >= c.highVariabilityCv;
  if (highVariability) basis.push(`Coefficient of variation ${input.stats.cv} ≥ ${c.highVariabilityCv}.`);

  const stockValue = input.unitCost !== null ? round(input.onHand * input.unitCost, 2) : null;
  const highValue = c.highValueThreshold === null || stockValue === null ? null : stockValue >= c.highValueThreshold;

  const monthsOfSupply = avgM > 0 ? round(input.usable / avgM, 2) : null;
  let excessQty: number | null = null;
  if (c.excessMonthsOfSupply !== null) {
    const need = avgM * c.excessMonthsOfSupply + input.safetyStock;
    excessQty = round(Math.max(0, input.usable + input.openSupply - need));
    if (excessQty > 0) basis.push(`Usable ${input.usable} + open supply ${input.openSupply} exceeds ${c.excessMonthsOfSupply} month(s) of usage (${round(avgM * c.excessMonthsOfSupply)}) + safety stock ${input.safetyStock} by ${excessQty}.`);
  }

  return {
    movement,
    highVariability,
    highValue,
    stockValue,
    critical: input.criticality === 'CRITICAL' || input.criticality === 'HIGH',
    daysSinceLastUsage: daysSince,
    monthsOfSupply,
    excessQty,
    potentialObsolete: movement === 'NON_MOVING',
    basis,
  };
}
