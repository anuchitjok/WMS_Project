import { r2 } from './workflow';
import {
  CostLine,
  CostResult,
  ManpowerResult,
  MaterialResult,
  ProjectHeader,
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

  return {
    currency: cur,
    lines,
    total,
    costPerUnit: inp.quantity > 0 ? r2(total / inp.quantity) : null,
    complete: missing.length === 0,
    missing,
    byStage,
    note: `Estimate in ${cur} for planning only — not a confirmed price, purchase order or accounting entry.`,
  };
}
