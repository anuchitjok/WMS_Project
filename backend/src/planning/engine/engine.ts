import { WorkCalendar, addDays, daysBetween } from './calendar';
import { fm, planCost } from './cost';
import { planMaterials } from './materials';
import { planSpace } from './space';
import {
  DataSnapshot,
  ENGINE_VERSION,
  Issue,
  ManpowerResult,
  PlanFlag,
  PlanResult,
  ProjectHeader,
  ReadinessItem,
  ScenarioInputs,
  StageResult,
  WhatIf,
} from './types';
import { normalizeInputs, validateInputs } from './validate';
import { planWorkflow, r2, schedule } from './workflow';

const EPS = 1e-9;
const ceil = (n: number) => Math.ceil(n - EPS);

/** Peak simultaneous crew (people per shift) over the schedule, optionally for one skill. */
function peakCrew(
  stages: StageResult[],
  skillOf: Map<string, string>,
  skill?: string,
): number {
  const pts = new Set<number>();
  const active = stages.filter((s) => !skill || skillOf.get(s.key) === skill);
  active.forEach((s) => pts.add(s.startHour));
  let peak = 0;
  for (const t of pts) {
    const sum = active
      .filter((s) => s.startHour <= t + EPS && s.finishHour > t + EPS)
      .reduce((a, s) => a + s.crewPerShift, 0);
    peak = Math.max(peak, sum);
  }
  return peak;
}

function planManpower(
  inp: ScenarioInputs,
  cal: WorkCalendar,
  header: ProjectHeader,
  stages: StageResult[],
): ManpowerResult {
  const l = inp.labor;
  const shifts = inp.calendar.shiftsPerDay;
  const presence = 1 - l.absencePct / 100;
  const W = cal.workingDaysBetween(header.plannedStart, header.targetEnd);
  const net = cal.netShiftHours;
  const total = stages.reduce((a, s) => a + s.laborHours, 0);
  const skillOf = new Map(inp.stages.map((s) => [s.key, s.skill]));

  const fte = W > 0 ? total / (W * net) : null;
  const byHours = W > 0 ? ceil(total / (W * net * presence)) : null;
  const peak = peakCrew(stages, skillOf);
  const bySchedule = ceil((peak * shifts) / presence);
  const required = Math.max(bySchedule, byHours ?? 0);
  const available = l.availableHeadcount;
  const effective = available === null ? null : r2(available * presence);
  const personHoursInWindow = effective === null ? null : effective * net * W;
  const gapHours =
    personHoursInWindow === null
      ? null
      : r2(Math.max(0, total - personHoursInWindow));

  const skills = [...new Set(inp.stages.map((s) => s.skill))];
  const bySkill = skills.map((sk) => {
    const hrs = stages
      .filter((s) => skillOf.get(s.key) === sk)
      .reduce((a, s) => a + s.laborHours, 0);
    const pk = peakCrew(stages, skillOf, sk);
    return {
      skill: sk,
      laborHours: r2(hrs),
      peakCrewPerShift: pk,
      headcount: ceil((pk * shifts) / presence),
    };
  });

  let overtime: ManpowerResult['overtime'] = null;
  if (l.overtimeAuthorized && effective !== null) {
    const hoursAvailable = r2(
      effective * l.maxOvertimeHoursPerPersonPerDay * W,
    );
    const need = gapHours ?? 0;
    overtime = {
      authorized: true,
      hoursNeeded: need,
      hoursAvailable,
      coversHourGap: need <= hoursAvailable + EPS,
      note:
        bySchedule > (available ?? 0)
          ? 'Overtime adds hours but not people at the same time — it does not fix a shortage of people needed simultaneously.'
          : 'Overtime is only used to cover the hour gap to the target date.',
    };
  }

  return {
    totalLaborHours: r2(total),
    personNetHoursPerDay: r2(net),
    windowWorkingDays: W,
    requiredFte: {
      value: fte === null ? null : r2(fte),
      formula:
        'FTE = total labour hours ÷ (working days to target × net hours per person per day)',
      detail: `${r2(total)} ÷ (${W} × ${r2(net)}) = ${fte === null ? 'n/a' : r2(fte)}`,
    },
    headcountByHours: {
      value: byHours,
      formula:
        'people (hours) = ⌈ total labour hours ÷ (working days × net hours per person × (1 − absence)) ⌉',
      detail: `⌈ ${r2(total)} ÷ (${W} × ${r2(net)} × ${r2(presence)}) ⌉ = ${byHours ?? 'n/a'}`,
    },
    peakCrewPerShift: {
      value: peak,
      formula:
        'peak crew = largest sum of (workstations × operators) over stages running at the same time',
      detail: `${peak} people per shift at the busiest point of the schedule. A person works one stage at a time, so stages that run in sequence share people; stages that overlap add up.`,
    },
    headcountBySchedule: {
      value: bySchedule,
      formula: 'people (schedule) = ⌈ peak crew × shifts ÷ (1 − absence) ⌉',
      detail: `⌈ ${peak} × ${shifts} ÷ ${r2(presence)} ⌉ = ${bySchedule}`,
    },
    requiredHeadcount: required,
    dedicatedCrewHeadcount: stages.reduce(
      (a, s) => a + ceil((s.crewPerShift * shifts) / presence),
      0,
    ),
    availableHeadcount: available,
    effectiveAvailable: effective,
    additionalWorkersNeeded:
      available === null ? null : Math.max(0, required - available),
    capacityGapHours: gapHours,
    workforceUtilizationPct: personHoursInWindow
      ? r2((total / personHoursInWindow) * 100)
      : null,
    byStage: stages.map((s) => ({
      key: s.key,
      name: s.name,
      skill: skillOf.get(s.key)!,
      laborHours: s.laborHours,
      sharePct: total > 0 ? r2((s.laborHours / total) * 100) : 0,
      crewPerShift: s.crewPerShift,
      dedicatedHeadcount: ceil((s.crewPerShift * shifts) / presence),
    })),
    bySkill,
    byShift: Array.from({ length: shifts }, (_, i) => ({
      shift: i + 1,
      peakCrew: peak,
    })),
    overtime,
    staffingLimitedFinishDate: null,
    staffingLimitedNote: null,
  };
}

/** Runs the whole calculation. Never throws for bad inputs — they come back as errors. */
export function calculatePlan(
  header: ProjectHeader,
  rawInputs: unknown,
  data: DataSnapshot,
  opts: { whatIfs?: boolean } = {},
): PlanResult {
  const { inputs: inp, assumptions } = normalizeInputs(rawInputs);
  const { errors, warnings } = validateInputs(header, inp, data);
  const warehouseId = inp.warehouseId ?? header.warehouseId;
  const base: PlanResult = {
    engineVersion: ENGINE_VERSION,
    asOf: data.asOf,
    overallStatus: 'INSUFFICIENT_DATA',
    flags: ['INSUFFICIENT_DATA'],
    errors,
    warnings,
    missingData: [],
    assumptions,
    summary: {
      quantity: Number.isFinite(inp.quantity) ? inp.quantity : 0,
      warehouseId,
      plannedStart: header.plannedStart,
      targetEnd: header.targetEnd,
      estimatedFinish: null,
      scheduleVarianceWorkingDays: null,
      totalLaborHours: null,
      requiredHeadcount: null,
      availableHeadcount: inp.labor.availableHeadcount,
      bottleneckStage: null,
      lineThroughputPerDay: null,
      materialLines: 0,
      materialShortageLines: 0,
      spaceStatus: 'INCOMPLETE',
      estimatedCost: null,
      costComplete: false,
      currency: header.currency,
    },
    calendar: {
      clockHoursPerDay: 0,
      netShiftHours: 0,
      windowWorkingDays: 0,
      transferBatchSize: 0,
    },
    stages: [],
    criticalPath: [],
    manpower: null,
    materials: [],
    space: [],
    cost: null,
    milestones: [],
    risks: [],
    whatIfs: [],
    readiness: [],
  };
  if (errors.length) return base;

  try {
    return calculateValid(header, inp, data, base, opts.whatIfs !== false);
  } catch (e) {
    base.errors.push({
      area: 'INPUT',
      message: e instanceof Error ? e.message : String(e),
    });
    return base;
  }
}

function calculateValid(
  header: ProjectHeader,
  inp: ScenarioInputs,
  data: DataSnapshot,
  base: PlanResult,
  withWhatIfs: boolean,
): PlanResult {
  const cal = new WorkCalendar(inp.calendar, header.plannedStart);
  const missing: Issue[] = [];
  const wf = planWorkflow(inp, cal);

  // Pass 1 — schedule without material constraints, to get required-by dates.
  const free = schedule(wf, inp, cal, new Map(), new Map());
  const stageInput = new Map(wf.order.map((p) => [p.s.key, p.inputQty]));
  const startDate = new Map(free.stages.map((s) => [s.key, s.startDate]));
  const mats = planMaterials(header, inp, data, stageInput, startDate);
  missing.push(...mats.missing);

  // Pass 2 — schedule again, holding stages until their materials are covered.
  const readyHour = new Map<string, number>();
  for (const [k, d] of mats.readyByStage)
    if (d) readyHour.set(k, cal.hourAtDate(d));
  const sch = schedule(wf, inp, cal, readyHour, mats.readyByStage);
  const finish = cal.dateAt(sch.finishHour, 'end');
  const late = daysBetween(header.targetEnd, finish) > 0;
  // Working days after the target (positive = late), or spare working days before it (negative).
  const variance = late
    ? cal.workingDaysBetween(addDays(header.targetEnd, 1), finish)
    : -cal.workingDaysBetween(addDays(finish, 1), header.targetEnd);

  const mp = planManpower(inp, cal, header, sch.stages);
  if (inp.labor.availableHeadcount === null)
    missing.push({
      area: 'MANPOWER',
      message:
        'Available headcount is not entered — the manpower gap cannot be checked',
    });

  const space = planSpace(
    inp,
    data,
    sch.stages,
    wf.receivedUnits,
    wf.lineThroughputPerDay,
    mats.lines,
    header.purpose === 'SALES' && !data.layout.warehouseId,
  );
  missing.push(...space.missing);
  const handled =
    space.inboundPallets === null || space.outboundPallets === null
      ? null
      : space.inboundPallets + space.outboundPallets;
  const cost = planCost(
    header,
    inp,
    sch.stages,
    mp,
    mats.lines,
    handled,
    late ? variance : 0,
    data.asOf,
  );

  // Staffing-limited alternative: stages run one after another with only the available people.
  if (mp.additionalWorkersNeeded && mp.availableHeadcount !== null) {
    const perShift = Math.floor(
      (mp.availableHeadcount * (1 - inp.labor.absencePct / 100)) /
        inp.calendar.shiftsPerDay,
    );
    const cannot = inp.stages.filter((s) => perShift < s.operatorsPerStation);
    if (cannot.length)
      mp.staffingLimitedNote = `With ${perShift} people per shift, ${cannot.map((s) => s.name).join(', ')} cannot be staffed at all.`;
    else {
      const alt: ScenarioInputs = {
        ...inp,
        transferBatchSize: null,
        stages: inp.stages.map((s) => ({
          ...s,
          workstations: Math.min(
            s.workstations,
            Math.floor(perShift / s.operatorsPerStation),
          ),
        })),
      };
      const altWf = planWorkflow(alt, cal);
      const altSch = schedule(altWf, alt, cal, readyHour, mats.readyByStage);
      mp.staffingLimitedFinishDate = cal.dateAt(altSch.finishHour, 'end');
      mp.staffingLimitedNote = `With the ${mp.availableHeadcount} people available (${perShift} per shift), running stages one after another with fewer workstations staffed, the estimated finish is ${mp.staffingLimitedFinishDate}.`;
    }
  }

  // ── Flags ────────────────────────────────────────────────────────────────
  const flags: PlanFlag[] = [];
  const matShort = mats.lines.filter((m) => m.shortage > 0 || !m.arrivesInTime);
  if ((mp.additionalWorkersNeeded ?? 0) > 0) flags.push('MANPOWER_SHORTAGE');
  if (matShort.length) flags.push('MATERIAL_SHORTAGE');
  if (space.lines.some((s) => s.status === 'RISK' || s.status === 'SHORTAGE'))
    flags.push('WAREHOUSE_CAPACITY_RISK');
  const materialDelay = sch.stages.some(
    (s) => s.startBoundBy === 'MATERIAL' && s.isCritical,
  );
  if (late || flags.includes('MANPOWER_SHORTAGE') || materialDelay)
    flags.push('SCHEDULE_AT_RISK');
  if (!cost.complete) flags.push('COST_ESTIMATE_INCOMPLETE');
  if (missing.length) flags.push('INSUFFICIENT_DATA');

  // ── Risks and recommended actions ────────────────────────────────────────
  const risks: PlanResult['risks'] = [];
  const bn = sch.stages.find((s) => s.isBottleneck)!;
  if (late)
    risks.push({
      level: 'HIGH',
      area: 'Schedule',
      message: `Estimated finish ${finish} is ${variance} working day(s) after the target ${header.targetEnd}.`,
      action: `Add capacity at the critical stages (${sch.criticalPath.join(' → ')}), overlap stages with transfer batches, or move the target date.`,
    });
  if (mp.additionalWorkersNeeded)
    risks.push({
      level: 'HIGH',
      area: 'Manpower',
      message: `${mp.requiredHeadcount} people needed, ${mp.availableHeadcount} available.`,
      action: `Add ${mp.additionalWorkersNeeded} worker(s)${mp.overtime?.authorized ? ', or use authorized overtime for the hour gap' : ''}, or reduce workstations running at the same time.`,
    });
  for (const m of matShort.filter((x) => x.supplyCheck === 'NOT_CHECKED'))
    risks.push({
      level: 'HIGH',
      area: 'Material',
      message: `${m.code}: ordered today with ${m.leadTimeDays} days lead time it arrives ${m.coverageDate}, after it is needed on ${m.requiredByDate}.`,
      action:
        'Agree a later start date, a shorter supplier lead time, or ask the customer to supply this item.',
    });
  for (const m of matShort.filter((x) => x.supplyCheck !== 'NOT_CHECKED'))
    risks.push({
      level: m.coverageDate === null || !m.arrivesInTime ? 'HIGH' : 'MEDIUM',
      area: 'Material',
      message: `${m.code}: shortage ${m.shortage}, needed by ${m.requiredByDate}${m.coverageDate ? `, covered ${m.coverageDate}` : ', cover date unknown'}.`,
      action:
        m.leadTimeDays === null
          ? 'Confirm supplier lead time and expected inbound.'
          : m.orderDatePassed
            ? 'Order date has passed — expedite or adjust the plan.'
            : `Raise replenishment of ${m.suggestedReplenishment} by ${m.orderByDate} through the normal purchasing process.`,
    });
  for (const s of space.lines.filter(
    (x) => x.status === 'SHORTAGE' || x.status === 'RISK',
  ))
    risks.push({
      level: s.status === 'SHORTAGE' ? 'HIGH' : 'MEDIUM',
      area: 'Warehouse',
      message: `${s.label}: needs ${s.required} ${s.unit}, ${s.available} available (${s.utilizationPct ?? '—'}%).`,
      action:
        s.key === 'STORAGE'
          ? 'Receive in waves (FLOW) instead of all at start, or plan an alternative warehouse.'
          : 'Shorten dwell time or free additional floor area.',
    });
  if (bn.queueEstimate > 0 && bn.dependsOn.length)
    risks.push({
      level: 'LOW',
      area: 'Workflow',
      message: `Bottleneck ${bn.name}: about ${bn.queueEstimate} units may queue in front of it.`,
      action: `Add workstations or people at ${bn.name} to balance the line.`,
    });
  if (cost.quote?.belowCost)
    risks.push({
      level: 'HIGH',
      area: 'Cost',
      message: `Selling price ${fm(cost.quote.price!)} ${cost.currency} is below the estimated cost of ${fm(cost.quote.costWithContingency)} ${cost.currency} (loss ${fm(-cost.quote.marginAmount!)}).`,
      action: 'Raise the price or reduce the cost before quoting.',
    });
  if (cost.quote && cost.quote.price === null)
    risks.push({
      level: 'MEDIUM',
      area: 'Cost',
      message: `No quoted price: ${cost.quote.reason}`,
      action: 'Complete the pricing inputs on the Space & cost tab.',
    });
  if (!cost.complete)
    risks.push({
      level: 'LOW',
      area: 'Cost',
      message: `Cost estimate incomplete: ${cost.missing.join('; ')}.`,
      action: 'Enter the missing cost data.',
    });
  for (const m of missing.filter((x) => x.area !== 'MATERIAL'))
    risks.push({
      level: 'MEDIUM',
      area: 'Data',
      message: m.message,
      action: 'Provide the missing data and recalculate.',
    });

  // ── Readiness checklist (approvals are added by the service) ─────────────
  const readiness: ReadinessItem[] = [
    {
      key: 'materials',
      label: 'Materials available or scheduled to arrive in time',
      status: mats.lines.some((m) => m.coverageDate === null)
        ? 'UNKNOWN'
        : matShort.length
          ? 'NOT_MET'
          : 'MET',
      detail: mats.lines.length
        ? `${mats.lines.length - matShort.length} of ${mats.lines.length} materials covered in time`
        : 'No materials defined for this project',
    },
    {
      key: 'manpower',
      label: 'Required manpower available',
      status:
        mp.additionalWorkersNeeded === null
          ? 'UNKNOWN'
          : mp.additionalWorkersNeeded > 0
            ? 'NOT_MET'
            : 'MET',
      detail: `${mp.requiredHeadcount} required, ${mp.availableHeadcount ?? 'unknown'} available`,
    },
    {
      key: 'workstations',
      label: 'Workstations and equipment available',
      status:
        inp.readiness.workstationsConfirmed && inp.readiness.equipmentConfirmed
          ? 'MET'
          : 'NOT_MET',
      detail:
        inp.readiness.workstationsConfirmed && inp.readiness.equipmentConfirmed
          ? 'Confirmed by the planner'
          : 'Not yet confirmed by the planner',
    },
    {
      key: 'capacity',
      label: 'Warehouse capacity sufficient',
      status: space.lines.some(
        (s) => s.status === 'INCOMPLETE' || s.status === 'NOT_CHECKED',
      )
        ? 'UNKNOWN'
        : flags.includes('WAREHOUSE_CAPACITY_RISK')
          ? 'NOT_MET'
          : 'MET',
      detail: space.lines.map((s) => `${s.label}: ${s.status}`).join('; '),
    },
    {
      key: 'workflow',
      label: 'Workflow and QA requirements defined',
      status:
        inp.stages.every((s) => s.completionCriteria) &&
        inp.stages.some((s) => s.isQualityGate)
          ? 'MET'
          : 'NOT_MET',
      detail: `${inp.stages.filter((s) => s.completionCriteria).length} of ${inp.stages.length} stages have completion criteria; ${inp.stages.filter((s) => s.isQualityGate).length} quality gate(s)`,
    },
    {
      key: 'schedule',
      label: 'Schedule achievable by target date',
      status:
        late || flags.includes('MANPOWER_SHORTAGE')
          ? 'NOT_MET'
          : mats.lines.some((m) => m.coverageDate === null)
            ? 'UNKNOWN'
            : 'MET',
      detail: `Estimated finish ${finish}, target ${header.targetEnd}`,
    },
  ];

  const milestones = [
    { label: 'Planned start', date: header.plannedStart },
    ...sch.stages.map((s) => ({
      label: `${s.name} complete`,
      date: s.finishDate,
    })),
    { label: 'Estimated completion', date: finish },
    { label: 'Target completion', date: header.targetEnd },
  ].sort((a, b) => a.date.localeCompare(b.date));

  const result: PlanResult = {
    ...base,
    overallStatus: flags.length ? 'NOT_READY' : 'READY_FOR_PLANNING_REVIEW',
    flags,
    missingData: missing,
    summary: {
      ...base.summary,
      estimatedFinish: finish,
      scheduleVarianceWorkingDays: variance,
      totalLaborHours: mp.totalLaborHours,
      requiredHeadcount: mp.requiredHeadcount,
      availableHeadcount: mp.availableHeadcount,
      bottleneckStage: bn.name,
      lineThroughputPerDay: r2(wf.lineThroughputPerDay),
      materialLines: mats.lines.length,
      materialShortageLines: matShort.length,
      spaceStatus: space.lines.some((s) => s.status === 'SHORTAGE')
        ? 'SHORTAGE'
        : space.lines.some((s) => s.status === 'RISK')
          ? 'RISK'
          : space.lines.some((s) => s.status === 'INCOMPLETE')
            ? 'INCOMPLETE'
            : space.lines.some((s) => s.status === 'NOT_CHECKED')
              ? 'NOT_CHECKED'
              : 'OK',
      estimatedCost: cost.total,
      costComplete: cost.complete,
    },
    calendar: {
      clockHoursPerDay: r2(cal.clockHoursPerDay),
      netShiftHours: r2(cal.netShiftHours),
      windowWorkingDays: mp.windowWorkingDays,
      transferBatchSize: sch.transferBatch,
    },
    stages: sch.stages,
    criticalPath: sch.criticalPath,
    manpower: mp,
    materials: mats.lines,
    space: space.lines,
    cost,
    milestones,
    risks,
    readiness,
  };
  if (withWhatIfs) result.whatIfs = whatIfs(header, inp, data, result);
  return result;
}

/** Alternative scenarios computed by re-running the engine with one change. Never applied automatically. */
function whatIfs(
  header: ProjectHeader,
  inp: ScenarioInputs,
  data: DataSnapshot,
  cur: PlanResult,
): WhatIf[] {
  const out: WhatIf[] = [];
  const run = (
    key: string,
    label: string,
    change: string,
    tradeOff: string,
    mod: ScenarioInputs,
  ) => {
    const r = calculatePlan(header, mod, data, { whatIfs: false });
    out.push({
      key,
      label,
      change,
      finishDate: r.summary.estimatedFinish,
      requiredHeadcount: r.summary.requiredHeadcount,
      meetsTarget: r.summary.estimatedFinish
        ? r.summary.estimatedFinish <= header.targetEnd
        : null,
      tradeOff,
    });
  };
  const c = inp.calendar;
  const rate = inp.labor.laborRatePerHour;
  if (c.shiftsPerDay < 3 && (c.shiftsPerDay + 1) * c.hoursPerShift <= 24)
    run(
      'add-shift',
      `Run ${c.shiftsPerDay + 1} shifts`,
      `Shifts per day ${c.shiftsPerDay} → ${c.shiftsPerDay + 1}`,
      'More people needed per day; night/evening premiums are not included.',
      { ...inp, calendar: { ...c, shiftsPerDay: c.shiftsPerDay + 1 } },
    );
  const bn = inp.stages.find((s) => s.name === cur.summary.bottleneckStage);
  if (bn)
    run(
      'bottleneck-station',
      `One more workstation at ${bn.name}`,
      `${bn.name}: workstations ${bn.workstations} → ${bn.workstations + 1}`,
      `Needs equipment/bench space and ${bn.operatorsPerStation} more operator(s) per shift${rate !== null ? ` (about ${r2(bn.operatorsPerStation * c.shiftsPerDay * (c.hoursPerShift - c.breakMinutesPerShift / 60) * rate)} ${header.currency}/working day)` : ''}.`,
      {
        ...inp,
        stages: inp.stages.map((s) =>
          s.key === bn.key ? { ...s, workstations: s.workstations + 1 } : s,
        ),
      },
    );
  if (inp.transferBatchSize === null || inp.transferBatchSize >= inp.quantity) {
    const b = Math.max(1, Math.ceil(inp.quantity / 10));
    if (b < inp.quantity)
      run(
        'overlap',
        `Overlap stages in batches of ${b}`,
        `Transfer batch: whole quantity → ${b} units`,
        'Stages run at the same time, so more people are needed simultaneously and WIP must be tracked per batch.',
        { ...inp, transferBatchSize: b },
      );
  }
  return out;
}
