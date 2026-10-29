import { FORECAST_METHODS } from './forecast';

/** Planning-parameter input as entered by a planner. */
export interface ParamInput {
  planningEnabled?: boolean;
  replenishmentMethod?: string;
  lotSizing?: string;
  leadTimeDays?: number | null;
  leadTimeVariabilityDays?: number | null;
  moq?: number | null;
  orderMultiple?: number | null;
  minStock?: number | null;
  maxStock?: number | null;
  safetyStock?: number | null;
  reorderPoint?: number | null;
  targetDaysOfSupply?: number | null;
  unitCost?: number | null;
  currency?: string | null;
  costBasis?: string | null;
  criticality?: string | null;
  forecastMethod?: string | null;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
}

const present = (v: unknown) => v !== null && v !== undefined;

/** Hard errors block saving; warnings are shown but allowed. */
export function validateParams(p: ParamInput): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nonNeg = ['moq', 'minStock', 'maxStock', 'safetyStock', 'reorderPoint', 'unitCost'] as const;
  for (const k of nonNeg) if (present(p[k]) && (!Number.isFinite(p[k]) || (p[k] as number) < 0)) errors.push(`${k} must be ≥ 0`);
  for (const k of ['leadTimeDays', 'leadTimeVariabilityDays', 'targetDaysOfSupply'] as const) {
    if (present(p[k]) && (!Number.isInteger(p[k]) || (p[k] as number) < 0)) errors.push(`${k} must be a whole number of days ≥ 0`);
  }
  if (present(p.orderMultiple) && (!Number.isFinite(p.orderMultiple) || (p.orderMultiple as number) <= 0)) errors.push('orderMultiple must be > 0');
  if (p.replenishmentMethod && !['PURCHASE', 'TRANSFER', 'NONE'].includes(p.replenishmentMethod)) errors.push('replenishmentMethod must be PURCHASE, TRANSFER or NONE');
  if (p.lotSizing && !['LOT_FOR_LOT', 'MIN_MAX'].includes(p.lotSizing)) errors.push('lotSizing must be LOT_FOR_LOT or MIN_MAX');
  if (p.criticality && !['CRITICAL', 'HIGH', 'NORMAL', 'LOW'].includes(p.criticality)) errors.push('criticality must be CRITICAL, HIGH, NORMAL or LOW');
  if (p.forecastMethod && !(FORECAST_METHODS as string[]).includes(p.forecastMethod)) errors.push(`forecastMethod must be one of ${FORECAST_METHODS.join(', ')}`);
  if (present(p.currency) && !/^[A-Z]{3}$/.test(String(p.currency))) errors.push('currency must be a 3-letter ISO code (e.g. THB, USD)');
  if (present(p.unitCost) && !present(p.currency)) errors.push('A unit cost needs its currency — currencies are never assumed');
  if (p.effectiveFrom && p.effectiveTo && p.effectiveTo.getTime() <= p.effectiveFrom.getTime()) errors.push('effectiveTo must be after effectiveFrom');
  if (present(p.minStock) && present(p.maxStock) && p.minStock! > p.maxStock!) errors.push('minStock cannot exceed maxStock');
  if (present(p.safetyStock) && present(p.maxStock) && p.safetyStock! > p.maxStock!) errors.push('safetyStock cannot exceed maxStock');
  if (p.lotSizing === 'MIN_MAX' && !present(p.maxStock)) errors.push('MIN_MAX lot sizing needs maxStock');
  if (present(p.reorderPoint) && present(p.safetyStock) && p.reorderPoint! < p.safetyStock!) warnings.push('reorderPoint is below safetyStock');
  if (present(p.moq) && present(p.maxStock) && p.moq! > p.maxStock!) warnings.push('MOQ is above maxStock — every order will overshoot the maximum');
  if (present(p.moq) && present(p.orderMultiple) && p.moq! % p.orderMultiple! !== 0) warnings.push('MOQ is not a multiple of the order multiple — orders are rounded up to the next multiple');
  if (p.replenishmentMethod !== 'NONE' && p.planningEnabled !== false && !present(p.leadTimeDays)) warnings.push('No lead time: the supplier lead time is used, or order dates cannot be calculated');
  return { errors, warnings };
}
