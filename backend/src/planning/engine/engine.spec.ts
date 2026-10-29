import { calculatePlan } from './engine';
import { WorkCalendar } from './calendar';
import { DataSnapshot, ProductSnapshot, ProjectHeader } from './types';

/*
 * Every expected number below is worked out by hand in the comment above it.
 * Calendar for most tests: Mon–Fri, 1 shift × 8 h, no break → 8 clock h/day.
 * 2026-11-02 is a Monday. asOf = 2026-10-28 (Wednesday).
 */

const header = (o: Partial<ProjectHeader> = {}): ProjectHeader => ({
  code: 'PRJ-T',
  name: 'Test',
  quantity: 0,
  plannedStart: '2026-11-02',
  targetEnd: '2026-11-13',
  currency: 'THB',
  warehouseId: 'wh1',
  demandType: 'PLANNED',
  ...o,
});

const product = (o: Partial<ProductSnapshot> = {}): ProductSnapshot => ({
  productId: 'p1',
  code: 'P1',
  name: 'Part 1',
  unit: 'pcs',
  standardUnitCost: 0,
  minimumStock: 0,
  isActive: true,
  available: 0,
  reserved: 0,
  inInspection: 0,
  blocked: 0,
  pendingRequestDemand: 0,
  otherPlanDemand: 0,
  otherPlanRefs: [],
  ...o,
});

const data = (o: Partial<DataSnapshot> = {}): DataSnapshot => ({
  asOf: '2026-10-28',
  products: [product()],
  layout: {
    warehouseId: 'wh1',
    warehouseCode: 'WH1',
    palletSlotCount: 0,
    palletSlotFreeCapacity: 0,
    otherSlotCount: 0,
    hasLayout: false,
    layoutUnit: null,
    receivingAreaM2: null,
    dispatchAreaM2: null,
    stagingAreaM2: null,
    workAreaM2: null,
  },
  ...o,
});

const stage = (key: string, o: Record<string, unknown> = {}) => ({
  key,
  name: key,
  dependsOn: [],
  timeBasis: 'MINUTES_PER_UNIT',
  stdMinutesPerUnit: 10,
  productivitySource: 'VALIDATED_STANDARD',
  workstations: 1,
  operatorsPerStation: 1,
  yieldPct: 100,
  reworkPct: 0,
  bufferPct: 0,
  setupMinutes: 0,
  changeovers: 0,
  skill: 'Tech',
  benchAreaM2: 2,
  isQualityGate: false,
  completionCriteria: 'Done',
  ...o,
});

const inputs = (o: Record<string, unknown> = {}) => ({
  quantity: 100,
  calendar: {
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
    shiftsPerDay: 1,
    hoursPerShift: 8,
    breakMinutesPerShift: 0,
  },
  labor: {
    availableHeadcount: 10,
    absencePct: 0,
    utilizationPct: 100,
    laborRatePerHour: 200,
  },
  stages: [stage('S1', { stdMinutesPerUnit: 12, isQualityGate: true })],
  materials: [],
  space: {
    unitsPerCarton: 5,
    cartonsPerPallet: 4,
    palletLengthM: 1.2,
    palletWidthM: 1.0,
    stackLevels: 2,
    receivingDwellDays: 1,
    dispatchDwellDays: 1,
    capacityRiskPct: 85,
    overrideStoragePalletPositions: 100,
    overrideReceivingAreaM2: 100,
    overrideDispatchAreaM2: 100,
    overrideWorkAreaM2: 100,
  },
  costs: { masterCostCurrency: 'THB' },
  ...o,
});

describe('WorkCalendar', () => {
  it('skips weekends and holidays when converting clock hours to dates', () => {
    const cal = new WorkCalendar(
      {
        workingDays: [1, 2, 3, 4, 5],
        holidays: ['2026-11-03'],
        shiftsPerDay: 2,
        hoursPerShift: 8,
        breakMinutesPerShift: 30,
      },
      '2026-11-02',
    );
    expect(cal.netShiftHours).toBe(7.5);
    expect(cal.clockHoursPerDay).toBe(15);
    // 40 h → day index ⌈40/15⌉−1 = 2 → Mon 2, (Tue 3 holiday), Wed 4, Thu 5
    expect(cal.dateAt(40, 'end')).toBe('2026-11-05');
    // 100 h → index 6 → 2,4,5,6,9,10,11
    expect(cal.dateAt(100, 'end')).toBe('2026-11-11');
    // exact day boundary: 15 h ends on the first day, starts the second
    expect(cal.dateAt(15, 'end')).toBe('2026-11-02');
    expect(cal.dateAt(15, 'start')).toBe('2026-11-04');
    expect(cal.workingDaysBetween('2026-11-02', '2026-11-13')).toBe(9);
    expect(cal.hourAtDate('2026-11-05')).toBe(30); // Nov 2 + Nov 4 before it
  });
});

describe('single stage — manpower and labour hours', () => {
  // 100 units × 12 min ÷ 60 = 20 h on 1 station at 100% → 2.5 days → finishes Wed 4 Nov.
  // capacity/day = 1 × 8 × 60 ÷ 12 = 40.
  const r = calculatePlan(header(), inputs(), data());
  it('calculates duration, capacity and labour', () => {
    expect(r.errors).toEqual([]);
    const s = r.stages[0];
    expect(s.capacityPerDay).toBe(40);
    expect(s.durationClockHours).toBe(20);
    expect(s.laborHours).toBe(20);
    expect(s.finishDate).toBe('2026-11-04');
    expect(r.summary.estimatedFinish).toBe('2026-11-04');
    // Target Fri 13 Nov: Thu 5 … Fri 13 = 7 spare working days.
    expect(r.summary.scheduleVarianceWorkingDays).toBe(-7);
  });
  it('FTE and headcount', () => {
    const m = r.manpower!;
    expect(m.windowWorkingDays).toBe(10);
    expect(m.requiredFte.value).toBe(0.25); // 20 ÷ (10 × 8)
    expect(m.headcountByHours.value).toBe(1);
    expect(m.requiredHeadcount).toBe(1);
    expect(m.additionalWorkersNeeded).toBe(0);
  });
  it('is ready for planning review when every check passes', () => {
    expect(r.flags).toEqual([]);
    expect(r.overallStatus).toBe('READY_FOR_PLANNING_REVIEW');
  });
  it('is reproducible — the same inputs give the same result', () => {
    expect(calculatePlan(header(), inputs(), data())).toEqual(r);
  });
});

describe('sequential stages with yield, rework, utilization and a bottleneck', () => {
  /*
   * Q = 90, utilization 80%.
   *   C QA      10 min, 1 st: input 90, processed 90
   *   B Repair  30 min, 2 st, yield 90%, rework 10%: input ⌈90/0.9⌉ = 100, rework 10, processed 110, scrap 10
   *   A Inspect  6 min, 1 st: input 100, processed 100
   * capacity/day (×0.8): A 64, B 25.6, C 38.4; in final units: A 57.6, B 20.95, C 38.4 → B is the bottleneck.
   * durations: A 100×6/(60×0.8)=12.5 h, B 110×30/(2×60×0.8)=34.375 h, C 90×10/(60×0.8)=18.75 h
   * no transfer batch → A 0–12.5, B 12.5–46.875, C 46.875–65.625 → day ⌈65.625/8⌉−1 = 8 → Thu 12 Nov
   * labour h: A 12.5, B 68.75, C 18.75 = 100
   */
  const inp = inputs({
    quantity: 90,
    labor: {
      availableHeadcount: 1,
      absencePct: 0,
      utilizationPct: 80,
      laborRatePerHour: 200,
    },
    stages: [
      stage('A', { stdMinutesPerUnit: 6 }),
      stage('B', {
        stdMinutesPerUnit: 30,
        workstations: 2,
        yieldPct: 90,
        reworkPct: 10,
        dependsOn: ['A'],
      }),
      stage('C', {
        stdMinutesPerUnit: 10,
        dependsOn: ['B'],
        isQualityGate: true,
      }),
    ],
  });
  const r = calculatePlan(header(), inp, data());
  const by = (k: string) => r.stages.find((s) => s.key === k)!;

  it('flows quantities backwards through yield and rework', () => {
    expect([by('A').inputQty, by('B').inputQty, by('C').inputQty]).toEqual([
      100, 100, 90,
    ]);
    expect(by('B').reworkQty).toBe(10);
    expect(by('B').processedQty).toBe(110);
    expect(by('B').scrapQty).toBe(10);
  });
  it('finds the bottleneck from the slowest stage, not the sum of capacities', () => {
    expect(by('B').isBottleneck).toBe(true);
    expect(r.summary.lineThroughputPerDay).toBe(20.95);
    expect([
      by('A').capacityPerDay,
      by('B').capacityPerDay,
      by('C').capacityPerDay,
    ]).toEqual([64, 25.6, 38.4]);
  });
  it('schedules stages one after another', () => {
    expect([
      by('A').finishHour,
      by('B').startHour,
      by('B').finishHour,
      by('C').finishHour,
    ]).toEqual([12.5, 12.5, 46.88, 65.63]);
    expect(r.summary.estimatedFinish).toBe('2026-11-12');
    expect(r.criticalPath).toEqual(['A', 'B', 'C']);
  });
  it('shares people between sequential stages and flags the shortage', () => {
    const m = r.manpower!;
    expect(m.totalLaborHours).toBe(100);
    expect(m.requiredFte.value).toBe(1.25); // 100 ÷ (10 × 8)
    expect(m.headcountByHours.value).toBe(2); // ⌈1.25⌉
    expect(m.peakCrewPerShift.value).toBe(2); // Repair's 2 stations — never 1+2+1
    expect(m.dedicatedCrewHeadcount).toBe(4);
    expect(m.requiredHeadcount).toBe(2);
    expect(m.additionalWorkersNeeded).toBe(1);
    expect(m.capacityGapHours).toBe(20); // 100 − 1 × 8 × 10
    expect(r.flags).toContain('MANPOWER_SHORTAGE');
    expect(r.flags).toContain('SCHEDULE_AT_RISK');
    expect(r.overallStatus).toBe('NOT_READY');
  });
  it('estimates a staffing-limited finish with the people available', () => {
    expect(r.manpower!.staffingLimitedFinishDate).not.toBeNull();
    expect(
      r.manpower!.staffingLimitedFinishDate! > r.summary.estimatedFinish!,
    ).toBe(true);
  });
  it('offers what-if alternatives without changing the scenario', () => {
    const shift = r.whatIfs.find((w) => w.key === 'add-shift')!;
    expect(shift.finishDate! < r.summary.estimatedFinish!).toBe(true);
    expect(r.whatIfs.map((w) => w.key)).toEqual([
      'add-shift',
      'bottleneck-station',
      'overlap',
    ]);
    expect((inp.calendar as { shiftsPerDay: number }).shiftsPerDay).toBe(1);
  });
});

describe('parallel stages', () => {
  /*
   * Q = 48, 100% utilization. R(20 min) → L(5 min) and T(10 min) in parallel → P(5 min).
   * capacity/day: R 24, L 96, T 48, P 96 → throughput 24/day (R), not 24+96+48+96.
   * R 0–16 h; L 16–20; T 16–24; P waits for both → 24–28 → day ⌈28/8⌉−1 = 3 → Thu 5 Nov.
   */
  const r = calculatePlan(
    header(),
    inputs({
      quantity: 48,
      stages: [
        stage('R', { stdMinutesPerUnit: 20 }),
        stage('L', { stdMinutesPerUnit: 5, dependsOn: ['R'] }),
        stage('T', {
          stdMinutesPerUnit: 10,
          dependsOn: ['R'],
          isQualityGate: true,
        }),
        stage('P', { stdMinutesPerUnit: 5, dependsOn: ['L', 'T'] }),
      ],
    }),
    data(),
  );
  const by = (k: string) => r.stages.find((s) => s.key === k)!;
  it('runs parallel stages at the same time and joins on the slowest', () => {
    expect(r.summary.lineThroughputPerDay).toBe(24);
    expect([by('L').startHour, by('T').startHour]).toEqual([16, 16]);
    expect(by('P').startHour).toBe(24);
    expect(by('P').startBoundBy).toBe('PREDECESSOR:T');
    expect(r.summary.estimatedFinish).toBe('2026-11-05');
    expect(r.criticalPath).toEqual(['R', 'T', 'P']);
    expect(by('L').level).toBe(1);
    expect(by('P').level).toBe(2);
  });
  it('adds up people only for stages that overlap', () => {
    expect(r.manpower!.peakCrewPerShift.value).toBe(2); // L + T together
  });
});

describe('transfer batches (overlapping stages)', () => {
  it('lets the next stage start after the first batch', () => {
    // A 10 min, B 20 min, Q 24, batch 4: A 0–4 h; first batch ready at 4×10/60 = 0.667 h;
    // B finishes at max(0.667 + 8, 4 + 4×20/60) = 8.667 h → Tue 3 Nov (sequential would be 12 h).
    const r = calculatePlan(
      header(),
      inputs({
        quantity: 24,
        transferBatchSize: 4,
        stages: [
          stage('A'),
          stage('B', { stdMinutesPerUnit: 20, dependsOn: ['A'] }),
        ],
      }),
      data(),
    );
    const b = r.stages[1];
    expect(b.startHour).toBe(0.67);
    expect(b.finishHour).toBe(8.67);
    expect(b.finishBoundBy).toBe('OWN_CAPACITY');
    expect(r.summary.estimatedFinish).toBe('2026-11-03');
  });
  it('a faster downstream stage waits for the last batch', () => {
    // A 20 min (8 h), B 10 min (4 h), batch 4: B finishes at max(1.333 + 4, 8 + 4×10/60) = 8.667
    const r = calculatePlan(
      header(),
      inputs({
        quantity: 24,
        transferBatchSize: 4,
        stages: [
          stage('A', { stdMinutesPerUnit: 20 }),
          stage('B', { dependsOn: ['A'] }),
        ],
      }),
      data(),
    );
    expect(r.stages[1].finishHour).toBe(8.67);
    expect(r.stages[1].finishBoundBy).toBe('LAST_BATCH_FROM:A');
    expect(r.criticalPath).toEqual(['A', 'B']);
  });
});

describe('shifts, holidays and setup', () => {
  it('uses net shift hours, shifts and holidays', () => {
    // 2 shifts × (8 h − 30 min) = 15 h/day; 40 units × 60 min = 40 h → Thu 5 Nov (Tue 3 is a holiday)
    const r = calculatePlan(
      header(),
      inputs({
        quantity: 40,
        calendar: {
          workingDays: [1, 2, 3, 4, 5],
          holidays: ['2026-11-03'],
          shiftsPerDay: 2,
          hoursPerShift: 8,
          breakMinutesPerShift: 30,
        },
        stages: [stage('S', { stdMinutesPerUnit: 60, isQualityGate: true })],
      }),
      data(),
    );
    expect(r.calendar.clockHoursPerDay).toBe(15);
    expect(r.summary.estimatedFinish).toBe('2026-11-05');
    expect(r.manpower!.headcountBySchedule.value).toBe(2); // one person per shift
  });
  it('adds setup time to duration and labour', () => {
    // 100 × 12 min = 20 h + 3 changeovers × 40 min = 2 h → 22 h; labour 20 + 2 × 1 = 22
    const r = calculatePlan(
      header(),
      inputs({
        stages: [
          stage('S', {
            stdMinutesPerUnit: 12,
            setupMinutes: 40,
            changeovers: 3,
          }),
        ],
      }),
      data(),
    );
    expect(r.stages[0].durationClockHours).toBe(22);
    expect(r.stages[0].laborHours).toBe(22);
  });
  it('applies absence to headcount', () => {
    // peak crew 3 per shift, 1 shift, 25% absence → ⌈3 ÷ 0.75⌉ = 4
    const r = calculatePlan(
      header(),
      inputs({
        labor: {
          availableHeadcount: 10,
          absencePct: 25,
          utilizationPct: 100,
          laborRatePerHour: 200,
        },
        stages: [stage('S', { workstations: 3 })],
      }),
      data(),
    );
    expect(r.manpower!.headcountBySchedule.value).toBe(4);
  });
  it('converts units per person per shift without applying utilization twice', () => {
    // 8 h shift = 480 min ÷ 40 units = 12 min/unit; utilization 50% is NOT applied → 20 h for 100 units
    const r = calculatePlan(
      header(),
      inputs({
        labor: {
          availableHeadcount: 10,
          absencePct: 0,
          utilizationPct: 50,
          laborRatePerHour: 200,
        },
        stages: [
          stage('S', {
            timeBasis: 'UNITS_PER_PERSON_SHIFT',
            stdMinutesPerUnit: null,
            unitsPerPersonShift: 40,
          }),
        ],
      }),
      data(),
    );
    expect(r.stages[0].laborMinutesPerUnit).toBe(12);
    expect(r.stages[0].durationClockHours).toBe(20);
  });
});

describe('materials and stock availability', () => {
  /*
   * S1 input 100; 2 per unit + 5% scrap → gross 200, scrap 10, total 210.
   * net available = 150 − 20 safety − 10 pending requests − 30 other plans = 90 → net requirement 120.
   * inbound: 5 in inspection (today), 50 manual on 30 Oct (in time), 100 manual on 20 Nov (late) → eligible 55 → shortage 65.
   * coverage: 5 + 50 + 100 ≥ 120 on 20 Nov → after the 2 Nov need.
   * lead time 14 → order by 19 Oct (passed). Pack multiple 50 → suggest 100.
   */
  const d = data({
    products: [
      product({
        available: 150,
        minimumStock: 20,
        pendingRequestDemand: 10,
        otherPlanDemand: 30,
        inInspection: 5,
        reserved: 40,
        standardUnitCost: 10,
      }),
    ],
  });
  const mat = {
    productId: 'p1',
    stageKey: 'S1',
    qtyPerUnit: 2,
    scrapPct: 5,
    leadTimeDays: 14,
    packMultiple: 50,
    unitsPerPallet: 100,
  };
  const inbound = [
    {
      productId: 'p1',
      quantity: 50,
      expectedDate: '2026-10-30',
      reference: 'PO-1',
    },
    {
      productId: 'p1',
      quantity: 100,
      expectedDate: '2026-11-20',
      reference: 'PO-2',
    },
  ];
  const r = calculatePlan(
    header(),
    inputs({ materials: [mat], manualInbound: inbound }),
    d,
  );
  const m = r.materials[0];

  it('nets requirements against stock, safety stock and other demand', () => {
    expect([m.grossRequirement, m.scrapAllowance, m.totalRequirement]).toEqual([
      200, 10, 210,
    ]);
    expect(m.netAvailable).toBe(90);
    expect(m.netRequirement).toBe(120);
    expect(m.eligibleInbound).toBe(55);
    expect(m.shortage).toBe(65);
    expect(m.requiredByDate).toBe('2026-11-02');
    expect(m.coverageDate).toBe('2026-11-20');
    expect(m.arrivesInTime).toBe(false);
    expect(m.orderByDate).toBe('2026-10-19');
    expect(m.orderDatePassed).toBe(true);
    expect(m.suggestedReplenishment).toBe(100);
    expect(m.demandType).toBe('PLANNED');
  });
  it('does not subtract reserved stock a second time', () => {
    // reserved = 40 is already outside "available"; changing it changes nothing
    const r2 = calculatePlan(
      header(),
      inputs({ materials: [mat], manualInbound: inbound }),
      data({ products: [product({ ...d.products[0], reserved: 0 })] }),
    );
    expect(r2.materials[0].netRequirement).toBe(120);
  });
  it('can leave pending requests out of demand', () => {
    const r2 = calculatePlan(
      header(),
      inputs({
        materials: [mat],
        manualInbound: inbound,
        includePendingRequests: false,
      }),
      d,
    );
    expect(r2.materials[0].netAvailable).toBe(100);
    expect(r2.materials[0].netRequirement).toBe(110);
  });
  it('holds the consuming stage until the material is covered', () => {
    // 20 Nov = after 14 working days (2–6, 9–13, 16–19 Nov) → 112 h
    expect(r.stages[0].startBoundBy).toBe('MATERIAL');
    expect(r.stages[0].startHour).toBe(112);
    expect(r.stages[0].startDate).toBe('2026-11-20');
    expect(r.flags).toEqual(
      expect.arrayContaining(['MATERIAL_SHORTAGE', 'SCHEDULE_AT_RISK']),
    );
  });
  it('reports an unknown arrival date as missing data', () => {
    const r2 = calculatePlan(
      header(),
      inputs({ materials: [{ ...mat, leadTimeDays: null }] }),
      d,
    );
    expect(r2.materials[0].coverageDate).toBeNull();
    expect(r2.flags).toContain('INSUFFICIENT_DATA');
  });
});

describe('cost and currency', () => {
  const mat = {
    productId: 'p1',
    stageKey: 'S1',
    qtyPerUnit: 2,
    scrapPct: 5,
    unitsPerPallet: 100,
  };
  const d = data({
    products: [product({ available: 1000, standardUnitCost: 10 })],
  });
  it('totals material, labour and other costs in one currency', () => {
    // material 210 × 10 = 2,100; labour 20 h × 200 = 4,000; other 500 → 6,600; per unit 66
    const r = calculatePlan(
      header(),
      inputs({
        materials: [mat],
        costs: {
          masterCostCurrency: 'THB',
          otherCosts: [{ label: 'Tooling', amount: 500 }],
        },
      }),
      d,
    );
    expect(r.cost!.total).toBe(6600);
    expect(r.cost!.costPerUnit).toBe(66);
    expect(r.cost!.complete).toBe(true);
  });
  it('converts Product Master cost only with an explicit exchange rate', () => {
    const r = calculatePlan(
      header(),
      inputs({
        materials: [mat],
        costs: { masterCostCurrency: 'USD', fxRateMasterToProject: 35 },
      }),
      d,
    );
    expect(r.materials[0].unitCost).toBe(350);
    expect(r.materials[0].totalCost).toBe(73500);
  });
  it('never mixes currencies — no rate means the cost is incomplete', () => {
    const r = calculatePlan(
      header(),
      inputs({ materials: [mat], costs: { masterCostCurrency: 'USD' } }),
      d,
    );
    expect(r.materials[0].totalCost).toBeNull();
    expect(r.cost!.complete).toBe(false);
    expect(r.flags).toContain('COST_ESTIMATE_INCOMPLETE');
  });
  it('treats a missing labour rate as incomplete, not zero', () => {
    const r = calculatePlan(
      header(),
      inputs({
        labor: {
          availableHeadcount: 10,
          absencePct: 0,
          utilizationPct: 100,
          laborRatePerHour: null,
        },
      }),
      d,
    );
    expect(
      r.cost!.lines.find((l) => l.category === 'LABOR')!.amount,
    ).toBeNull();
    expect(r.cost!.complete).toBe(false);
  });
});

describe('warehouse space', () => {
  /*
   * 20 units/pallet, pallet 1.2 m², stack 2. Q 100 all at start → 5 pallets.
   * storage: 5 of 10 free pallet slots = 50% OK
   * receiving: ⌈5/2⌉ = 3 positions × 1.2 = 3.6 m² of 4 m² = 90% → RISK (> 85%)
   * dispatch: 40/day × 1 day ÷ 20 = 2 pallets → 1 position = 1.2 m² of 10 → OK
   * work: 1 bench × 2 m² = 2 m² of 5 → OK
   */
  const lay = {
    ...data().layout,
    palletSlotCount: 4,
    palletSlotFreeCapacity: 10,
    receivingAreaM2: 4,
    dispatchAreaM2: 10,
    workAreaM2: 5,
    hasLayout: true,
    layoutUnit: 'm',
  };
  const sp = {
    unitsPerCarton: 5,
    cartonsPerPallet: 4,
    palletLengthM: 1.2,
    palletWidthM: 1.0,
    stackLevels: 2,
    receivingDwellDays: 1,
    dispatchDwellDays: 1,
  };
  const r = calculatePlan(
    header(),
    inputs({ space: sp }),
    data({ layout: lay }),
  );
  const line = (k: string) => r.space.find((s) => s.key === k)!;
  it('sizes storage, staging and work areas separately from WMS layout data', () => {
    expect([
      line('STORAGE').required,
      line('STORAGE').available,
      line('STORAGE').status,
    ]).toEqual([5, 10, 'OK']);
    expect([
      line('RECEIVING_STAGING').required,
      line('RECEIVING_STAGING').utilizationPct,
      line('RECEIVING_STAGING').status,
    ]).toEqual([3.6, 90, 'RISK']);
    expect([
      line('DISPATCH_STAGING').required,
      line('DISPATCH_STAGING').status,
    ]).toEqual([1.2, 'OK']);
    expect([line('WORK_AREA').required, line('WORK_AREA').status]).toEqual([
      2,
      'OK',
    ]);
    expect(line('STORAGE').availableSource).toBe('WMS');
    expect(r.flags).toContain('WAREHOUSE_CAPACITY_RISK');
  });
  it('marks space incomplete instead of inventing dimensions', () => {
    const r2 = calculatePlan(header(), inputs({ space: {} }), data());
    expect(r2.space.every((s) => s.status === 'INCOMPLETE')).toBe(true);
    expect(r2.flags).toContain('INSUFFICIENT_DATA');
  });
});

describe('input validation', () => {
  const run = (o: Record<string, unknown>, h: Partial<ProjectHeader> = {}) =>
    calculatePlan(header(h), inputs(o), data());
  it('refuses to calculate without a productivity standard', () => {
    const r = run({ stages: [stage('S', { stdMinutesPerUnit: null })] });
    expect(r.overallStatus).toBe('INSUFFICIENT_DATA');
    expect(r.errors.map((e) => e.path)).toContain(
      'stages[0].stdMinutesPerUnit',
    );
    expect(r.stages).toEqual([]);
  });
  it('rejects loops, unknown dependencies and duplicate keys', () => {
    expect(
      run({
        stages: [
          stage('A', { dependsOn: ['B'] }),
          stage('B', { dependsOn: ['A'] }),
        ],
      }).errors.some((e) => /loop/.test(e.message)),
    ).toBe(true);
    expect(
      run({ stages: [stage('A', { dependsOn: ['X'] })] }).errors.some((e) =>
        /unknown stage/.test(e.message),
      ),
    ).toBe(true);
    expect(
      run({ stages: [stage('A'), stage('A')] }).errors.some((e) =>
        /used twice/.test(e.message),
      ),
    ).toBe(true);
  });
  it('rejects impossible calendars and dates', () => {
    expect(
      run({}, { targetEnd: '2026-10-01' }).errors.some(
        (e) => e.path === 'targetEnd',
      ),
    ).toBe(true);
    expect(
      run({
        calendar: { workingDays: [1], shiftsPerDay: 3, hoursPerShift: 10 },
      }).errors.some((e) => /24 hours/.test(e.message)),
    ).toBe(true);
    expect(run({ quantity: 0 }).errors.some((e) => e.path === 'quantity')).toBe(
      true,
    );
    expect(
      run({}, { currency: 'baht' }).errors.some((e) => e.path === 'currency'),
    ).toBe(true);
  });
  it('warns about unrealistic productivity assumptions', () => {
    const r = run({
      labor: {
        availableHeadcount: 10,
        utilizationPct: 98,
        laborRatePerHour: 200,
      },
      stages: [stage('S', { productivitySource: 'ESTIMATE' })],
    });
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.path === 'labor.utilizationPct')).toBe(
      true,
    );
    expect(
      r.warnings.some((w) => w.path === 'stages[0].productivitySource'),
    ).toBe(true);
  });
  it('rejects materials that are not in Product Master', () => {
    const r = run({
      materials: [{ productId: 'nope', stageKey: 'S1', qtyPerUnit: 1 }],
    });
    expect(r.errors.some((e) => e.path === 'materials[0].productId')).toBe(
      true,
    );
  });
  it('lists every structural default it applied', () => {
    const r = run({ transferBatchSize: undefined });
    expect(r.assumptions.some((a) => /transfer batch/.test(a))).toBe(true);
  });
});

describe('sales simulation', () => {
  const sales = header({ purpose: 'SALES', warehouseId: null });
  const noWarehouse = (o: Partial<DataSnapshot> = {}) =>
    data({ layout: { ...data().layout, warehouseId: null, warehouseCode: null }, ...o });

  it('never nets stock — the whole requirement is to be procured', () => {
    // Stock in the snapshot is ignored on purpose: 500 available, 10 safety.
    // gross 100 × 2 = 200, scrap 5% = 10 → 210; rounded to multiples of 50 → 250.
    // Lead 3 days from 2026-10-28 = 2026-10-31, before the stage starts 2026-11-02.
    const r = calculatePlan(
      sales,
      inputs({
        materials: [
          {
            productId: 'p1',
            stageKey: 'S1',
            qtyPerUnit: 2,
            scrapPct: 5,
            leadTimeDays: 3,
            packMultiple: 50,
            unitCostOverride: 12,
          },
        ],
      }),
      noWarehouse({ products: [product({ available: 500, minimumStock: 10 })] }),
    );
    const m = r.materials[0];
    expect(m.supplyCheck).toBe('NOT_CHECKED');
    expect([m.totalRequirement, m.onHand, m.netAvailable, m.netRequirement]).toEqual([210, 0, 0, 210]);
    expect([m.shortage, m.suggestedReplenishment]).toEqual([0, 250]);
    expect([m.coverageDate, m.arrivesInTime]).toEqual(['2026-10-31', true]);
    expect(m.totalCost).toBe(2520); // 210 × 12
    expect(r.flags).not.toContain('MATERIAL_SHORTAGE');
  });

  it('accepts a free-text item and holds the stage until its lead time', () => {
    // Lead 10 days → 2026-11-07 (Saturday), so S1 starts Mon 2026-11-09.
    // 100 units ÷ (8 h × 60 ÷ 12 = 40/day) = 20 h → finishes Wed 2026-11-11.
    const r = calculatePlan(
      sales,
      inputs({
        materials: [
          {
            productId: '',
            itemName: 'Thermal paste',
            unit: 'g',
            stageKey: 'S1',
            qtyPerUnit: 1,
            leadTimeDays: 10,
            unitCostOverride: 3,
          },
        ],
      }),
      noWarehouse({ products: [] }),
    );
    expect(r.errors).toEqual([]);
    const m = r.materials[0];
    expect([m.code, m.unit, m.totalRequirement, m.totalCost]).toEqual(['Thermal paste', 'g', 100, 300]);
    expect(m.arrivesInTime).toBe(false);
    expect(r.stages[0].startBoundBy).toBe('MATERIAL');
    expect(r.summary.estimatedFinish).toBe('2026-11-11');
    expect(r.flags).toContain('MATERIAL_SHORTAGE');
    expect(r.risks.find((x) => x.area === 'Material')?.message).toContain('ordered today with 10 days lead time');
  });

  it('treats a missing lead time as not checked, not as a shortage', () => {
    const r = calculatePlan(
      sales,
      inputs({ materials: [{ productId: '', itemName: 'Label', stageKey: 'S1', qtyPerUnit: 1 }] }),
      noWarehouse({ products: [] }),
    );
    expect(r.materials[0].coverageDate).toBeNull();
    expect(r.materials[0].arrivesInTime).toBe(true);
    expect(r.flags).not.toContain('MATERIAL_SHORTAGE');
  });

  it('without a warehouse, capacity is not checked and not reported as missing data', () => {
    const { space } = inputs();
    const noOverrides = Object.fromEntries(
      Object.entries(space as Record<string, unknown>).filter(([k]) => !k.startsWith('override')),
    );
    const r = calculatePlan(sales, inputs({ space: noOverrides }), noWarehouse({ products: [] }));
    expect(r.space.map((s) => s.status)).toEqual(['NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED']);
    expect(r.space[0].required).toBe(5); // ⌈100 ÷ (5 × 4)⌉ pallets
    expect(r.summary.spaceStatus).toBe('NOT_CHECKED');
    expect(r.space.every((x) => x.detail.endsWith('not checked.') && !/Available|Floor Plan/.test(x.detail))).toBe(true);
    expect(r.flags).not.toContain('WAREHOUSE_CAPACITY_RISK');
    expect(r.flags).not.toContain('INSUFFICIENT_DATA');
    // A capacity the planner enters is still checked.
    const r2 = calculatePlan(
      sales,
      inputs({ space: { ...noOverrides, overrideStoragePalletPositions: 4 } }),
      noWarehouse({ products: [] }),
    );
    expect(r2.space[0].status).toBe('SHORTAGE');
  });

  it('free-text items are only for sales simulations, need a name and are not duplicated', () => {
    const free = { productId: '', itemName: 'Glue', stageKey: 'S1', qtyPerUnit: 1 };
    const op = calculatePlan(header(), inputs({ materials: [free] }), data());
    expect(op.errors.map((e) => e.path)).toContain('materials[0].productId');
    const unnamed = calculatePlan(sales, inputs({ materials: [{ ...free, itemName: ' ' }] }), noWarehouse());
    expect(unnamed.errors.map((e) => e.path)).toContain('materials[0].itemName');
    const twice = calculatePlan(sales, inputs({ materials: [free, { ...free, itemName: 'glue' }] }), noWarehouse());
    expect(twice.errors.map((e) => e.path)).toContain('materials[1].itemName');
  });
});

describe('pricing and quote', () => {
  /*
   * Base inputs: 100 units × 12 min = 20 h × 200 THB/h = 4,000 THB, no other cost.
   */
  const d = data({ products: [] });
  const priced = (pricing: Record<string, unknown>, o: Record<string, unknown> = {}) =>
    calculatePlan(header(), inputs({ costs: { masterCostCurrency: 'THB', pricing }, ...o }), d);

  it('no pricing method → no quote', () => {
    const r = calculatePlan(header(), inputs(), d);
    expect(r.cost!.total).toBe(4000);
    expect(r.cost!.complete).toBe(true);
    expect(r.cost!.quote).toBeNull();
  });

  it('margin on price, with contingency, rounding, VAT and validity', () => {
    // 4,000 + 5% = 4,200 ÷ (1 − 20%) = 5,250 → rounded up to 100 = 5,300
    // margin 5,300 − 4,200 = 1,100 = 20.75% of price, 26.19% of cost
    // VAT 7% = 371 → 5,671; valid 30 days from 2026-10-28 = 2026-11-27
    const q = priced({ method: 'MARGIN', marginPct: 20, contingencyPct: 5, roundTo: 100, vatPct: 7, validityDays: 30 }).cost!.quote!;
    expect(q.costWithContingency).toBe(4200);
    expect(q.price).toBe(5300);
    expect(q.pricePerUnit).toBe(53);
    expect(q.marginAmount).toBe(1100);
    expect(q.marginPct).toBe(20.75);
    expect(q.markupPct).toBe(26.19);
    expect(q.vatAmount).toBe(371);
    expect(q.priceIncludingVat).toBe(5671);
    expect(q.validUntil).toBe('2026-11-27');
    expect(q.complete).toBe(true);
    expect(q.belowCost).toBe(false);
    expect(q.formula).toContain('÷ (1 − 20%)');
  });

  it('markup on cost', () => {
    // 4,000 × 1.25 = 5,000; margin 1,000 = 20% of price
    const q = priced({ method: 'MARKUP', markupPct: 25 }).cost!.quote!;
    expect(q.price).toBe(5000);
    expect(q.marginPct).toBe(20);
    expect(q.markupPct).toBe(25);
    expect(q.vatAmount).toBeNull();
    expect(q.validUntil).toBeNull();
  });

  it('a fixed price below cost is reported as a loss', () => {
    const r = priced({ method: 'FIXED', fixedPrice: 3500 });
    const q = r.cost!.quote!;
    expect(q.price).toBe(3500);
    expect(q.marginAmount).toBe(-500);
    expect(q.belowCost).toBe(true);
    expect(r.risks.find((x) => x.area === 'Cost' && x.level === 'HIGH')!.message).toContain('below the estimated cost');
    // Contingency also counts against a fixed price: 4,000 + 10% = 4,400 > 4,300.
    const c = priced({ method: 'FIXED', fixedPrice: 4300, contingencyPct: 10 });
    expect([c.cost!.quote!.costWithContingency, c.cost!.quote!.marginAmount, c.cost!.quote!.belowCost]).toEqual([4400, -100, true]);
    expect(c.risks.find((x) => x.level === 'HIGH')!.message).toBe(
      'Selling price 4,300 THB is below the estimated cost of 4,400 THB (loss 100).',
    );
  });

  it('never prices from an incomplete cost', () => {
    const noRate = { labor: { availableHeadcount: 10, absencePct: 0, utilizationPct: 100, laborRatePerHour: null } };
    const m = priced({ method: 'MARGIN', marginPct: 20 }, noRate);
    expect(m.cost!.quote!.price).toBeNull();
    expect(m.cost!.quote!.reason).toContain('Cost estimate incomplete');
    expect(m.risks.some((x) => x.message.startsWith('No quoted price'))).toBe(true);
    // A fixed price stays, but its margin cannot be checked.
    const f = priced({ method: 'FIXED', fixedPrice: 9000 }, noRate).cost!.quote!;
    expect(f.price).toBe(9000);
    expect(f.marginPct).toBeNull();
    expect(f.complete).toBe(false);
    // Method chosen but its value missing.
    expect(priced({ method: 'MARGIN' }).cost!.quote!.reason).toBe('Margin % not entered.');
  });

  it('rejects impossible pricing values', () => {
    const paths = (p: Record<string, unknown>) => priced(p).errors.map((e) => e.path);
    expect(paths({ method: 'MARGIN', marginPct: 100 })).toContain('costs.pricing.marginPct');
    expect(paths({ method: 'FIXED', fixedPrice: 0 })).toContain('costs.pricing.fixedPrice');
    expect(paths({ method: 'MARKUP', markupPct: 10, vatPct: 150 })).toContain('costs.pricing.vatPct');
    expect(paths({ method: 'MARKUP', markupPct: 10, validityDays: 2.5 })).toContain('costs.pricing.validityDays');
  });
});
