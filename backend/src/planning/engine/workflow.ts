import { WorkCalendar } from './calendar';
import { Explained, ScenarioInputs, StageInput, StageResult } from './types';

const EPS = 1e-9;
export const r2 = (n: number) => Math.round(n * 100) / 100;
const ceil = (n: number) => Math.ceil(n - EPS);

/** Stages in dependency order (stable: keeps the entered order where possible). */
export function topoOrder(stages: StageInput[]): StageInput[] {
  const done = new Set<string>();
  const out: StageInput[] = [];
  while (out.length < stages.length) {
    const next = stages.find(
      (s) => !done.has(s.key) && s.dependsOn.every((d) => done.has(d)),
    );
    if (!next) throw new Error('Workflow has a dependency loop');
    done.add(next.key);
    out.push(next);
  }
  return out;
}

interface StagePlan {
  s: StageInput;
  level: number;
  successors: string[];
  requiredOutput: number;
  inputQty: number;
  reworkQty: number;
  processedQty: number;
  laborMin: number;
  util: number;
  factor: number;
  crew: number;
  setupClock: number;
  processClock: number;
  duration: number;
  laborHours: number;
  capacityPerDay: number;
  capacityFinal: number;
  explain: Explained[];
}

export interface WorkflowPlan {
  order: StagePlan[];
  byKey: Map<string, StagePlan>;
  bottleneck: StagePlan;
  lineThroughputPerDay: number;
  receivedUnits: number; // units entering the first stage(s)
}

/**
 * Quantities and capacities per stage.
 *
 * Quantities flow backwards from the delivered quantity: a stage must output
 * what its successors need (the largest successor input), and must take in
 * output ÷ yield. Rework adds one extra pass for rework% of the input.
 * Every unit passes every stage, so the line can go no faster than its
 * slowest stage — capacities are never added together.
 */
export function planWorkflow(
  inp: ScenarioInputs,
  cal: WorkCalendar,
): WorkflowPlan {
  const Q = inp.quantity;
  const order = topoOrder(inp.stages);
  const successors = new Map<string, string[]>(order.map((s) => [s.key, []]));
  order.forEach((s) =>
    s.dependsOn.forEach((d) => successors.get(d)!.push(s.key)),
  );
  const level = new Map<string, number>();
  order.forEach((s) =>
    level.set(
      s.key,
      s.dependsOn.length
        ? Math.max(...s.dependsOn.map((d) => level.get(d)!)) + 1
        : 0,
    ),
  );

  const netShiftMin = cal.netShiftHours * 60;
  const D = cal.clockHoursPerDay;
  const plans = new Map<string, StagePlan>();

  for (const s of [...order].reverse()) {
    const succ = successors.get(s.key)!;
    const requiredOutput = succ.length
      ? Math.max(...succ.map((k) => plans.get(k)!.inputQty))
      : Q;
    const inputQty = ceil(requiredOutput / (s.yieldPct / 100));
    const reworkQty = ceil((inputQty * s.reworkPct) / 100);
    const processedQty = inputQty + reworkQty;

    const minutesBasis = s.timeBasis === 'MINUTES_PER_UNIT';
    const laborMin = minutesBasis
      ? s.stdMinutesPerUnit!
      : netShiftMin / s.unitsPerPersonShift!;
    const util = minutesBasis ? inp.labor.utilizationPct / 100 : 1;
    const factor = util * (1 - s.bufferPct / 100);
    const crew = s.workstations * s.operatorsPerStation;

    const setupClock = (s.setupMinutes * s.changeovers) / 60;
    const processClock = (processedQty * laborMin) / (crew * 60 * factor);
    const duration = setupClock + processClock;
    const laborHours =
      (processedQty * laborMin) / 60 / util + setupClock * crew;
    const capacityPerDay = (crew * D * 60 * factor) / laborMin;
    const capacityFinal = (capacityPerDay * Q) / processedQty;

    const explain: Explained[] = [
      {
        value: inputQty,
        formula: succ.length
          ? 'input = ⌈ largest successor input ÷ yield ⌉'
          : 'input = ⌈ delivered quantity ÷ yield ⌉',
        detail: `⌈ ${requiredOutput} ÷ ${s.yieldPct}% ⌉ = ${inputQty}`,
      },
      {
        value: processedQty,
        formula: 'processed = input + ⌈ input × rework% ⌉',
        detail: `${inputQty} + ⌈ ${inputQty} × ${s.reworkPct}% ⌉ = ${processedQty}`,
      },
      {
        value: r2(laborMin),
        formula: minutesBasis
          ? 'labour minutes per unit = standard minutes'
          : 'labour minutes per unit = net shift minutes ÷ units per person per shift',
        detail: minutesBasis
          ? `${s.stdMinutesPerUnit} min (utilization ${inp.labor.utilizationPct}% applied)`
          : `${r2(netShiftMin)} ÷ ${s.unitsPerPersonShift} = ${r2(laborMin)} min (achieved rate — utilization not applied again)`,
      },
      {
        value: r2(capacityPerDay),
        formula:
          'capacity/day = stations × operators × clock hours/day × 60 × utilization × (1 − buffer) ÷ labour minutes',
        detail: `${s.workstations} × ${s.operatorsPerStation} × ${r2(D)} × 60 × ${r2(util * 100)}% × (1 − ${s.bufferPct}%) ÷ ${r2(laborMin)} = ${r2(capacityPerDay)} units/day`,
      },
      {
        value: r2(duration),
        formula:
          'duration (clock h) = setup minutes × changeovers ÷ 60 + processed × labour minutes ÷ (crew × 60 × utilization × (1 − buffer))',
        detail: `${s.setupMinutes} × ${s.changeovers} ÷ 60 + ${processedQty} × ${r2(laborMin)} ÷ (${crew} × 60 × ${r2(factor)}) = ${r2(duration)} h`,
      },
      {
        value: r2(laborHours),
        formula:
          'labour hours = processed × labour minutes ÷ 60 ÷ utilization + setup hours × crew',
        detail: `${processedQty} × ${r2(laborMin)} ÷ 60 ÷ ${r2(util)} + ${r2(setupClock)} × ${crew} = ${r2(laborHours)} h`,
      },
    ];

    plans.set(s.key, {
      s,
      level: level.get(s.key)!,
      successors: succ,
      requiredOutput,
      inputQty,
      reworkQty,
      processedQty,
      laborMin,
      util,
      factor,
      crew,
      setupClock,
      processClock,
      duration,
      laborHours,
      capacityPerDay,
      capacityFinal,
      explain,
    });
  }

  const ordered = order.map((s) => plans.get(s.key)!);
  const bottleneck = ordered.reduce((a, b) =>
    b.capacityFinal < a.capacityFinal - EPS ? b : a,
  );
  const receivedUnits = Math.max(
    ...ordered.filter((p) => !p.s.dependsOn.length).map((p) => p.inputQty),
  );
  return {
    order: ordered,
    byKey: plans,
    bottleneck,
    lineThroughputPerDay: bottleneck.capacityFinal,
    receivedUnits,
  };
}

export interface ScheduleOut {
  stages: StageResult[];
  finishHour: number;
  criticalPath: string[];
  transferBatch: number;
}

/**
 * Forward schedule in clock hours.
 *
 * A stage may start when (a) the project starts, (b) its materials are on
 * hand, and (c) every predecessor has delivered its first transfer batch.
 * It cannot finish before its own processing time has elapsed, nor before
 * it has processed the last batch from its slowest predecessor. With no
 * transfer batch (whole quantity) the stages run strictly one after another.
 */
export function schedule(
  wf: WorkflowPlan,
  inp: ScenarioInputs,
  cal: WorkCalendar,
  materialReadyHour: Map<string, number>,
  materialReadyDate: Map<string, string | null>,
): ScheduleOut {
  const Q = inp.quantity;
  const b = Math.min(inp.transferBatchSize ?? Q, Q);
  const whole = b >= Q;
  const batchClock = (p: StagePlan, units: number) =>
    (ceil(units / p.s.workstations) * p.laborMin) /
    (p.s.operatorsPerStation * 60 * p.factor);
  const ES = new Map<string, number>();
  const EF = new Map<string, number>();
  const startBy = new Map<string, string>();
  const finishBy = new Map<string, string>();

  for (const p of wf.order) {
    const k = p.s.key;
    let es = 0;
    let by = 'START';
    const mat = materialReadyHour.get(k) ?? 0;
    if (mat > es + EPS) {
      es = mat;
      by = 'MATERIAL';
    }
    for (const d of p.s.dependsOn) {
      const pd = wf.byKey.get(d)!;
      const ready = whole
        ? EF.get(d)!
        : Math.min(EF.get(d)!, ES.get(d)! + pd.setupClock + batchClock(pd, b));
      if (ready >= es - EPS) {
        es = Math.max(es, ready);
        by = `PREDECESSOR:${d}`;
      }
    }
    let ef = es + p.duration;
    let fby = 'OWN_CAPACITY';
    if (!whole) {
      for (const d of p.s.dependsOn) {
        const cand = EF.get(d)! + batchClock(p, Math.min(b, p.processedQty));
        if (cand > ef + EPS) {
          ef = cand;
          fby = `LAST_BATCH_FROM:${d}`;
        }
      }
    }
    ES.set(k, es);
    EF.set(k, ef);
    startBy.set(k, by);
    finishBy.set(k, fby);
  }

  const finishHour = Math.max(...wf.order.map((p) => EF.get(p.s.key)!));
  // Critical path: walk back from the stage that finishes last.
  const critical: string[] = [];
  let cur: string | undefined = wf.order
    .filter((p) => !p.successors.length)
    .reduce((a, p) => (EF.get(p.s.key)! > EF.get(a.s.key)! + EPS ? p : a))
    .s.key;
  while (cur && !critical.includes(cur)) {
    critical.unshift(cur);
    const f = finishBy.get(cur)!;
    const st = startBy.get(cur)!;
    cur = f.startsWith('LAST_BATCH_FROM:')
      ? f.split(':')[1]
      : st.startsWith('PREDECESSOR:')
        ? st.split(':')[1]
        : undefined;
  }

  const stages: StageResult[] = wf.order.map((p) => {
    const k = p.s.key;
    const preds = p.s.dependsOn.map((d) => wf.byKey.get(d)!);
    let queue = 0;
    if (preds.length) {
      if (whole) queue = p.inputQty;
      else {
        const arrival = Math.min(...preds.map((x) => x.capacityFinal));
        queue =
          p.capacityFinal < arrival - EPS
            ? ceil(p.inputQty * (1 - p.capacityFinal / arrival))
            : Math.min(b, p.inputQty);
      }
    }
    return {
      key: k,
      name: p.s.name,
      dependsOn: p.s.dependsOn,
      level: p.level,
      requiredOutput: p.requiredOutput,
      inputQty: p.inputQty,
      reworkQty: p.reworkQty,
      processedQty: p.processedQty,
      scrapQty: p.inputQty - p.requiredOutput,
      laborMinutesPerUnit: r2(p.laborMin),
      productiveFactor: r2(p.factor),
      capacityPerDay: r2(p.capacityPerDay),
      capacityFinalUnitsPerDay: r2(p.capacityFinal),
      setupClockHours: r2(p.setupClock),
      processClockHours: r2(p.processClock),
      durationClockHours: r2(p.duration),
      laborHours: r2(p.laborHours),
      crewPerShift: p.crew,
      startHour: r2(ES.get(k)!),
      finishHour: r2(EF.get(k)!),
      startDate: cal.dateAt(ES.get(k)!, 'start'),
      finishDate: cal.dateAt(EF.get(k)!, 'end'),
      durationWorkingDays: cal.workingDaysFor(EF.get(k)! - ES.get(k)!),
      startBoundBy: startBy.get(k)!,
      finishBoundBy: finishBy.get(k)!,
      isBottleneck: p === wf.bottleneck,
      isCritical: critical.includes(k),
      queueEstimate: queue,
      materialReadyDate: materialReadyDate.has(k)
        ? materialReadyDate.get(k)!
        : null,
      explain: p.explain,
    };
  });
  return { stages, finishHour, criticalPath: critical, transferBatch: b };
}
