import { isValidDay, daysBetween } from './calendar';
import {
  CalendarInput,
  CostInput,
  DataSnapshot,
  Issue,
  LaborInput,
  ManualInboundInput,
  MaterialInput,
  ProjectHeader,
  ScenarioInputs,
  SpaceInput,
  StageInput,
} from './types';

/* Structural defaults only. Business values (productivity, rates, dimensions,
 * headcount, costs) are never defaulted — they stay null and are reported as
 * missing. Every default that IS applied is listed in `assumptions`. */

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v.trim() : fallback;
const bool = (v: unknown): boolean => v === true || v === 'true';
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface Normalized {
  inputs: ScenarioInputs;
  assumptions: string[];
}

export function normalizeInputs(raw: unknown): Normalized {
  const r = obj(raw);
  const assumptions: string[] = [];
  const dflt = <T>(value: T | null, fallback: T, note: string): T => {
    if (value === null) {
      assumptions.push(note);
      return fallback;
    }
    return value;
  };

  const c = obj(r.calendar);
  const calendar: CalendarInput = {
    workingDays: arr(c.workingDays)
      .map((d) => num(d))
      .filter((d): d is number => d !== null),
    holidays: arr(c.holidays).filter((d): d is string => typeof d === 'string'),
    shiftsPerDay: num(c.shiftsPerDay) ?? NaN,
    hoursPerShift: num(c.hoursPerShift) ?? NaN,
    breakMinutesPerShift: dflt(
      num(c.breakMinutesPerShift),
      0,
      'No break time entered — whole shift counted as working time.',
    ),
  };

  const l = obj(r.labor);
  const labor: LaborInput = {
    availableHeadcount: num(l.availableHeadcount),
    absencePct: dflt(
      num(l.absencePct),
      0,
      'No absence allowance entered — 0% absence assumed.',
    ),
    utilizationPct: num(l.utilizationPct) ?? NaN,
    laborRatePerHour: num(l.laborRatePerHour),
    overtimeAuthorized: bool(l.overtimeAuthorized),
    maxOvertimeHoursPerPersonPerDay:
      num(l.maxOvertimeHoursPerPersonPerDay) ?? 0,
    overtimePremiumPct: num(l.overtimePremiumPct) ?? 0,
  };

  const stages: StageInput[] = arr(r.stages).map((s0, i) => {
    const s = obj(s0);
    return {
      key: str(s.key) || `S${i + 1}`,
      name: str(s.name) || `Stage ${i + 1}`,
      dependsOn: arr(s.dependsOn).filter(
        (d): d is string => typeof d === 'string',
      ),
      timeBasis:
        s.timeBasis === 'UNITS_PER_PERSON_SHIFT'
          ? 'UNITS_PER_PERSON_SHIFT'
          : 'MINUTES_PER_UNIT',
      stdMinutesPerUnit: num(s.stdMinutesPerUnit),
      unitsPerPersonShift: num(s.unitsPerPersonShift),
      productivitySource:
        s.productivitySource === 'VALIDATED_STANDARD'
          ? 'VALIDATED_STANDARD'
          : 'ESTIMATE',
      setupMinutes: num(s.setupMinutes) ?? 0,
      changeovers: num(s.changeovers) ?? 0,
      workstations: num(s.workstations) ?? NaN,
      operatorsPerStation: num(s.operatorsPerStation) ?? 1,
      yieldPct: num(s.yieldPct) ?? 100,
      reworkPct: num(s.reworkPct) ?? 0,
      bufferPct: num(s.bufferPct) ?? 0,
      skill: str(s.skill) || 'General',
      benchAreaM2: num(s.benchAreaM2),
      isQualityGate: bool(s.isQualityGate),
      completionCriteria: str(s.completionCriteria),
    };
  });

  const materials: MaterialInput[] = arr(r.materials).map((m0) => {
    const m = obj(m0);
    return {
      productId: str(m.productId),
      stageKey: str(m.stageKey),
      qtyPerUnit: num(m.qtyPerUnit) ?? NaN,
      scrapPct: num(m.scrapPct) ?? 0,
      source: 'MANUAL',
      leadTimeDays: num(m.leadTimeDays),
      packMultiple: num(m.packMultiple),
      unitCostOverride: num(m.unitCostOverride),
      unitsPerPallet: num(m.unitsPerPallet),
      notes: str(m.notes) || undefined,
    };
  });

  const manualInbound: ManualInboundInput[] = arr(r.manualInbound).map((x0) => {
    const x = obj(x0);
    return {
      productId: str(x.productId),
      quantity: num(x.quantity) ?? NaN,
      expectedDate: str(x.expectedDate),
      reference: str(x.reference) || 'Manual entry',
    };
  });

  const sp = obj(r.space);
  const space: SpaceInput = {
    unitsPerCarton: num(sp.unitsPerCarton),
    cartonsPerPallet: num(sp.cartonsPerPallet),
    palletLengthM: num(sp.palletLengthM),
    palletWidthM: num(sp.palletWidthM),
    stackLevels: dflt(
      num(sp.stackLevels),
      1,
      'Pallet stack height not entered — 1 pallet per floor position assumed in staging.',
    ),
    receiptPattern: sp.receiptPattern === 'FLOW' ? 'FLOW' : 'ALL_AT_START',
    storageDwellDays: num(sp.storageDwellDays) ?? 0,
    receivingDwellDays: dflt(
      num(sp.receivingDwellDays),
      1,
      'Receiving dwell time not entered — 1 day in receiving staging assumed.',
    ),
    dispatchDwellDays: dflt(
      num(sp.dispatchDwellDays),
      1,
      'Dispatch dwell time not entered — 1 day in dispatch staging assumed.',
    ),
    capacityRiskPct: dflt(
      num(sp.capacityRiskPct),
      85,
      'Capacity risk threshold not entered — utilization above 85% is flagged.',
    ),
    overrideStoragePalletPositions: num(sp.overrideStoragePalletPositions),
    overrideReceivingAreaM2: num(sp.overrideReceivingAreaM2),
    overrideDispatchAreaM2: num(sp.overrideDispatchAreaM2),
    overrideWorkAreaM2: num(sp.overrideWorkAreaM2),
  };

  const co = obj(r.costs);
  const costs: CostInput = {
    masterCostCurrency: str(co.masterCostCurrency).toUpperCase() || null,
    fxRateMasterToProject: num(co.fxRateMasterToProject),
    handlingCostPerPallet: num(co.handlingCostPerPallet),
    delayCostPerDay: num(co.delayCostPerDay),
    otherCosts: arr(co.otherCosts).map((o0) => {
      const o = obj(o0);
      return {
        label: str(o.label) || 'Other cost',
        amount: num(o.amount) ?? NaN,
      };
    }),
  };

  const rd = obj(r.readiness);

  const transfer = num(r.transferBatchSize);
  if (transfer === null)
    assumptions.push(
      'No transfer batch size entered — each stage finishes the whole quantity before the next stage starts (no overlap).',
    );

  return {
    assumptions,
    inputs: {
      quantity: num(r.quantity) ?? NaN,
      warehouseId: str(r.warehouseId) || null,
      transferBatchSize: transfer,
      calendar,
      labor,
      stages,
      materials,
      manualInbound,
      space,
      costs,
      readiness: {
        workstationsConfirmed: bool(rd.workstationsConfirmed),
        equipmentConfirmed: bool(rd.equipmentConfirmed),
      },
      includePendingRequests:
        r.includePendingRequests === undefined
          ? true
          : bool(r.includePendingRequests),
    },
  };
}

const CURRENCY_RE = /^[A-Z]{3}$/;

export interface Validation {
  errors: Issue[];
  warnings: Issue[];
}

/** Errors stop the calculation; warnings are reported with the result. */
export function validateInputs(
  header: ProjectHeader,
  inp: ScenarioInputs,
  data: DataSnapshot,
): Validation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (area: Issue['area'], path: string, message: string) =>
    errors.push({ area, path, message });
  const warn = (area: Issue['area'], path: string, message: string) =>
    warnings.push({ area, path, message });
  const isInt = (n: number) => Number.isInteger(n);

  // Project
  if (!isInt(inp.quantity) || inp.quantity < 1)
    err(
      'INPUT',
      'quantity',
      'Planned quantity must be a whole number of at least 1',
    );
  if (inp.quantity > 10_000_000)
    err(
      'INPUT',
      'quantity',
      'Planned quantity is above 10,000,000 — check the value',
    );
  if (!isValidDay(header.plannedStart))
    err('INPUT', 'plannedStart', 'Planned start date is missing or invalid');
  if (!isValidDay(header.targetEnd))
    err('INPUT', 'targetEnd', 'Target completion date is missing or invalid');
  if (
    isValidDay(header.plannedStart) &&
    isValidDay(header.targetEnd) &&
    daysBetween(header.plannedStart, header.targetEnd) < 0
  )
    err(
      'INPUT',
      'targetEnd',
      'Target completion date is before the planned start date',
    );
  if (!CURRENCY_RE.test(header.currency))
    err(
      'COST',
      'currency',
      'Project currency must be a 3-letter ISO code (e.g. THB)',
    );
  if (
    inp.transferBatchSize !== null &&
    (!isInt(inp.transferBatchSize) || inp.transferBatchSize < 1)
  )
    err(
      'WORKFLOW',
      'transferBatchSize',
      'Transfer batch size must be a whole number of at least 1',
    );

  // Calendar
  const c = inp.calendar;
  if (
    !c.workingDays.length ||
    c.workingDays.some((d) => !isInt(d) || d < 1 || d > 7)
  )
    err('INPUT', 'calendar.workingDays', 'Choose at least one working weekday');
  if (!isInt(c.shiftsPerDay) || c.shiftsPerDay < 1 || c.shiftsPerDay > 3)
    err('INPUT', 'calendar.shiftsPerDay', 'Shifts per day must be 1, 2 or 3');
  if (!(c.hoursPerShift > 0) || c.hoursPerShift > 12)
    err(
      'INPUT',
      'calendar.hoursPerShift',
      'Hours per shift must be more than 0 and at most 12',
    );
  if (
    c.breakMinutesPerShift < 0 ||
    c.breakMinutesPerShift >= c.hoursPerShift * 60
  )
    err(
      'INPUT',
      'calendar.breakMinutesPerShift',
      'Break time must be at least 0 and shorter than the shift',
    );
  if (c.shiftsPerDay * c.hoursPerShift > 24)
    err('INPUT', 'calendar', 'Shifts × hours per shift exceeds 24 hours a day');
  c.holidays.forEach((h, i) => {
    if (!isValidDay(h))
      err(
        'INPUT',
        `calendar.holidays[${i}]`,
        `Holiday '${h}' is not a valid date`,
      );
  });

  // Labour
  const l = inp.labor;
  if (!(l.utilizationPct > 0) || l.utilizationPct > 100)
    err(
      'MANPOWER',
      'labor.utilizationPct',
      'Utilization must be more than 0% and at most 100%',
    );
  else if (l.utilizationPct > 95)
    warn(
      'MANPOWER',
      'labor.utilizationPct',
      `Utilization of ${l.utilizationPct}% leaves almost no time for breaks between tasks, handovers or delays — usually unrealistic`,
    );
  else if (l.utilizationPct < 40)
    warn(
      'MANPOWER',
      'labor.utilizationPct',
      `Utilization of ${l.utilizationPct}% is very low — check the assumption`,
    );
  if (l.absencePct < 0 || l.absencePct >= 90)
    err(
      'MANPOWER',
      'labor.absencePct',
      'Absence allowance must be between 0% and 90%',
    );
  if (
    l.availableHeadcount !== null &&
    (!isInt(l.availableHeadcount) || l.availableHeadcount < 0)
  )
    err(
      'MANPOWER',
      'labor.availableHeadcount',
      'Available headcount must be a whole number',
    );
  if (l.laborRatePerHour !== null && l.laborRatePerHour < 0)
    err('COST', 'labor.laborRatePerHour', 'Labour rate cannot be negative');
  if (l.overtimeAuthorized) {
    if (!(l.maxOvertimeHoursPerPersonPerDay > 0))
      err(
        'MANPOWER',
        'labor.maxOvertimeHoursPerPersonPerDay',
        'Enter the overtime hours per person per day that may be planned',
      );
    else if (l.maxOvertimeHoursPerPersonPerDay > 4)
      warn(
        'MANPOWER',
        'labor.maxOvertimeHoursPerPersonPerDay',
        'More than 4 overtime hours per person per day — check labour rules',
      );
    if (l.overtimePremiumPct < 0)
      err(
        'COST',
        'labor.overtimePremiumPct',
        'Overtime premium cannot be negative',
      );
  }

  // Workflow
  if (!inp.stages.length)
    err('WORKFLOW', 'stages', 'Add at least one workflow stage');
  const keys = new Set<string>();
  inp.stages.forEach((s, i) => {
    const p = `stages[${i}]`;
    if (keys.has(s.key))
      err('WORKFLOW', `${p}.key`, `Stage key '${s.key}' is used twice`);
    keys.add(s.key);
    if (s.timeBasis === 'MINUTES_PER_UNIT') {
      if (s.stdMinutesPerUnit === null)
        err(
          'WORKFLOW',
          `${p}.stdMinutesPerUnit`,
          `${s.name}: enter the standard minutes per unit (no productivity standard exists in the WMS)`,
        );
      else if (!(s.stdMinutesPerUnit > 0))
        err(
          'WORKFLOW',
          `${p}.stdMinutesPerUnit`,
          `${s.name}: standard minutes per unit must be more than 0`,
        );
    } else if (s.unitsPerPersonShift === null)
      err(
        'WORKFLOW',
        `${p}.unitsPerPersonShift`,
        `${s.name}: enter units per person per shift`,
      );
    else if (!(s.unitsPerPersonShift > 0))
      err(
        'WORKFLOW',
        `${p}.unitsPerPersonShift`,
        `${s.name}: units per person per shift must be more than 0`,
      );
    if (s.productivitySource === 'ESTIMATE')
      warn(
        'WORKFLOW',
        `${p}.productivitySource`,
        `${s.name}: productivity is an estimate, not a validated standard`,
      );
    if (!isInt(s.workstations) || s.workstations < 1)
      err(
        'WORKFLOW',
        `${p}.workstations`,
        `${s.name}: workstations must be a whole number of at least 1`,
      );
    if (!isInt(s.operatorsPerStation) || s.operatorsPerStation < 1)
      err(
        'WORKFLOW',
        `${p}.operatorsPerStation`,
        `${s.name}: operators per station must be a whole number of at least 1`,
      );
    if (!(s.yieldPct > 0) || s.yieldPct > 100)
      err(
        'WORKFLOW',
        `${p}.yieldPct`,
        `${s.name}: yield must be more than 0% and at most 100%`,
      );
    else if (s.yieldPct < 70)
      warn(
        'WORKFLOW',
        `${p}.yieldPct`,
        `${s.name}: yield of ${s.yieldPct}% means ${Math.round((100 / s.yieldPct) * 100) / 100}× the input — confirm`,
      );
    if (s.reworkPct < 0 || s.reworkPct >= 100)
      err(
        'WORKFLOW',
        `${p}.reworkPct`,
        `${s.name}: rework must be between 0% and 99%`,
      );
    if (s.bufferPct < 0 || s.bufferPct > 90)
      err(
        'WORKFLOW',
        `${p}.bufferPct`,
        `${s.name}: capacity buffer must be between 0% and 90%`,
      );
    if (s.setupMinutes < 0 || s.changeovers < 0 || !isInt(s.changeovers))
      err(
        'WORKFLOW',
        `${p}.setupMinutes`,
        `${s.name}: setup minutes and changeovers cannot be negative`,
      );
    if (s.benchAreaM2 !== null && s.benchAreaM2 < 0)
      err(
        'SPACE',
        `${p}.benchAreaM2`,
        `${s.name}: bench area cannot be negative`,
      );
  });
  inp.stages.forEach((s, i) =>
    s.dependsOn.forEach((d) => {
      if (!keys.has(d))
        err(
          'WORKFLOW',
          `stages[${i}].dependsOn`,
          `${s.name} depends on unknown stage '${d}'`,
        );
      if (d === s.key)
        err(
          'WORKFLOW',
          `stages[${i}].dependsOn`,
          `${s.name} cannot depend on itself`,
        );
    }),
  );
  if (!errors.some((e) => e.area === 'WORKFLOW') && hasCycle(inp.stages))
    err(
      'WORKFLOW',
      'stages',
      'The workflow has a loop — a stage cannot (indirectly) depend on itself',
    );
  if (inp.stages.length && !inp.stages.some((s) => s.isQualityGate))
    warn(
      'WORKFLOW',
      'stages',
      'No stage is marked as a quality gate (QA / test)',
    );

  // Materials
  const products = new Map(data.products.map((p) => [p.productId, p]));
  inp.materials.forEach((m, i) => {
    const p = `materials[${i}]`;
    const prod = products.get(m.productId);
    if (!m.productId || !prod)
      err(
        'MATERIAL',
        `${p}.productId`,
        `Material line ${i + 1}: choose a product from Product Master`,
      );
    else if (!prod.isActive)
      warn(
        'MATERIAL',
        `${p}.productId`,
        `${prod.code} is inactive or discontinued in Product Master`,
      );
    if (!keys.has(m.stageKey))
      err(
        'MATERIAL',
        `${p}.stageKey`,
        `Material line ${i + 1}: choose the stage that consumes it`,
      );
    if (!(m.qtyPerUnit > 0))
      err(
        'MATERIAL',
        `${p}.qtyPerUnit`,
        `Material line ${i + 1}: quantity per unit must be more than 0`,
      );
    if (m.scrapPct < 0 || m.scrapPct >= 100)
      err(
        'MATERIAL',
        `${p}.scrapPct`,
        `Material line ${i + 1}: scrap allowance must be between 0% and 99%`,
      );
    if (
      m.leadTimeDays !== null &&
      (m.leadTimeDays < 0 || !isInt(m.leadTimeDays))
    )
      err(
        'MATERIAL',
        `${p}.leadTimeDays`,
        `Material line ${i + 1}: lead time must be whole days`,
      );
    if (m.packMultiple !== null && !(m.packMultiple > 0))
      err(
        'MATERIAL',
        `${p}.packMultiple`,
        `Material line ${i + 1}: order multiple must be more than 0`,
      );
    if (m.unitCostOverride !== null && m.unitCostOverride < 0)
      err(
        'COST',
        `${p}.unitCostOverride`,
        `Material line ${i + 1}: unit cost cannot be negative`,
      );
    if (m.unitsPerPallet !== null && !(m.unitsPerPallet > 0))
      err(
        'SPACE',
        `${p}.unitsPerPallet`,
        `Material line ${i + 1}: units per pallet must be more than 0`,
      );
  });
  inp.manualInbound.forEach((x, i) => {
    const p = `manualInbound[${i}]`;
    if (!products.has(x.productId))
      err(
        'MATERIAL',
        `${p}.productId`,
        `Expected supply line ${i + 1}: choose a product`,
      );
    if (!(x.quantity > 0))
      err(
        'MATERIAL',
        `${p}.quantity`,
        `Expected supply line ${i + 1}: quantity must be more than 0`,
      );
    if (!isValidDay(x.expectedDate))
      err(
        'MATERIAL',
        `${p}.expectedDate`,
        `Expected supply line ${i + 1}: expected date is invalid`,
      );
  });

  // Space
  const s = inp.space;
  for (const [k, v] of Object.entries({
    unitsPerCarton: s.unitsPerCarton,
    cartonsPerPallet: s.cartonsPerPallet,
    palletLengthM: s.palletLengthM,
    palletWidthM: s.palletWidthM,
  }))
    if (v !== null && !(v > 0))
      err('SPACE', `space.${k}`, `${k} must be more than 0`);
  if (!isInt(s.stackLevels) || s.stackLevels < 1)
    err(
      'SPACE',
      'space.stackLevels',
      'Stack levels must be a whole number of at least 1',
    );
  if (
    s.receivingDwellDays < 0 ||
    s.dispatchDwellDays < 0 ||
    s.storageDwellDays < 0
  )
    err('SPACE', 'space', 'Dwell days cannot be negative');
  if (!(s.capacityRiskPct > 0) || s.capacityRiskPct > 100)
    err(
      'SPACE',
      'space.capacityRiskPct',
      'Capacity risk threshold must be between 1% and 100%',
    );

  // Cost
  const co = inp.costs;
  if (
    co.masterCostCurrency !== null &&
    !CURRENCY_RE.test(co.masterCostCurrency)
  )
    err(
      'COST',
      'costs.masterCostCurrency',
      'Product cost currency must be a 3-letter ISO code',
    );
  if (co.fxRateMasterToProject !== null && !(co.fxRateMasterToProject > 0))
    err(
      'COST',
      'costs.fxRateMasterToProject',
      'Exchange rate must be more than 0',
    );
  co.otherCosts.forEach((o, i) => {
    if (!Number.isFinite(o.amount) || o.amount < 0)
      err(
        'COST',
        `costs.otherCosts[${i}]`,
        `Other cost '${o.label}' must be an amount of 0 or more`,
      );
  });
  for (const [k, v] of Object.entries({
    handlingCostPerPallet: co.handlingCostPerPallet,
    delayCostPerDay: co.delayCostPerDay,
  }))
    if (v !== null && v < 0)
      err('COST', `costs.${k}`, `${k} cannot be negative`);

  return { errors, warnings };
}

export function hasCycle(stages: StageInput[]): boolean {
  const deps = new Map(stages.map((s) => [s.key, s.dependsOn]));
  const state = new Map<string, 1 | 2>();
  const visit = (k: string): boolean => {
    if (state.get(k) === 1) return true;
    if (state.get(k) === 2) return false;
    state.set(k, 1);
    for (const d of deps.get(k) ?? []) if (visit(d)) return true;
    state.set(k, 2);
    return false;
  };
  return stages.some((s) => visit(s.key));
}
