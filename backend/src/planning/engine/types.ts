/**
 * Project Planning engine — input and output contracts.
 *
 * The engine is a pure function: (inputs, data snapshot, asOf) → result.
 * It never reads the database, so a stored run can be recalculated from its
 * own snapshot and must give the same numbers.
 *
 * Units used throughout:
 *  - dates: 'YYYY-MM-DD' (UTC calendar days)
 *  - "clock hours": net working hours on the project calendar, counted from
 *    the first working hour of the planned start date. One working day has
 *    shiftsPerDay × (hoursPerShift − break) clock hours.
 *  - money: the project currency (`ProjectHeader.currency`).
 */

export const ENGINE_VERSION = 'planning-engine/1.0.0';

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface ProjectHeader {
  code: string;
  name: string;
  quantity: number; // good units the project must deliver
  plannedStart: string;
  targetEnd: string;
  currency: string; // ISO 4217
  warehouseId: string;
  /** PLANNED = forecast demand; PLAN_APPROVED = confirmed planning demand. */
  demandType: 'PLANNED' | 'PLAN_APPROVED';
}

export interface CalendarInput {
  /** ISO weekdays that are worked: 1 = Monday … 7 = Sunday. */
  workingDays: number[];
  holidays: string[];
  shiftsPerDay: number;
  hoursPerShift: number;
  breakMinutesPerShift: number;
}

export interface LaborInput {
  /** People available to this project (all shifts together). null = unknown. */
  availableHeadcount: number | null;
  /** Expected absence (leave, sickness) as % of headcount. */
  absencePct: number;
  /** Share of net shift time spent on productive work, %. */
  utilizationPct: number;
  /** Labour cost per paid hour in project currency. null = unknown. */
  laborRatePerHour: number | null;
  overtimeAuthorized: boolean;
  maxOvertimeHoursPerPersonPerDay: number;
  overtimePremiumPct: number;
}

export type TimeBasis = 'MINUTES_PER_UNIT' | 'UNITS_PER_PERSON_SHIFT';
export type ProductivitySource = 'VALIDATED_STANDARD' | 'ESTIMATE';

export interface StageInput {
  key: string;
  name: string;
  dependsOn: string[];
  /**
   * MINUTES_PER_UNIT: `stdMinutesPerUnit` is person-minutes of hands-on work
   * per unit at 100% productive time (utilization is applied on top).
   * UNITS_PER_PERSON_SHIFT: `unitsPerPersonShift` is an achieved rate that
   * already includes normal losses, so utilization is NOT applied again.
   */
  timeBasis: TimeBasis;
  stdMinutesPerUnit: number | null;
  unitsPerPersonShift: number | null;
  productivitySource: ProductivitySource;
  setupMinutes: number; // per changeover
  changeovers: number; // number of setups/changeovers over the project
  workstations: number;
  operatorsPerStation: number;
  yieldPct: number; // % of processed units that pass; the rest are scrapped
  reworkPct: number; // % of units that need one extra pass at this stage
  bufferPct: number; // capacity held back as a buffer, %
  skill: string;
  benchAreaM2: number | null; // floor area per workstation (WIP / work area)
  isQualityGate: boolean;
  completionCriteria: string;
}

export interface MaterialInput {
  productId: string;
  stageKey: string; // stage that consumes it (sets the required-by date)
  qtyPerUnit: number; // per unit entering the stage
  scrapPct: number; // extra allowance, % of gross
  /** Where the quantity per unit comes from. No BOM exists in this WMS yet. */
  source: 'MANUAL';
  leadTimeDays: number | null; // supplier lead time, calendar days
  packMultiple: number | null; // order multiple / MOQ rounding
  unitCostOverride: number | null; // project currency, manual estimate
  unitsPerPallet: number | null;
  notes?: string;
}

/** Supply the user knows about that is not yet in the WMS (e.g. an open supplier PO). */
export interface ManualInboundInput {
  productId: string;
  quantity: number;
  expectedDate: string;
  reference: string;
}

export interface SpaceInput {
  unitsPerCarton: number | null;
  cartonsPerPallet: number | null;
  palletLengthM: number | null;
  palletWidthM: number | null;
  stackLevels: number; // pallets per floor position in staging areas
  /** ALL_AT_START: every unit is on site from day one. FLOW: units arrive as they are processed. */
  receiptPattern: 'ALL_AT_START' | 'FLOW';
  storageDwellDays: number; // FLOW only
  receivingDwellDays: number;
  dispatchDwellDays: number;
  capacityRiskPct: number; // utilization above this is flagged as a risk
  /** Manual overrides of what the WMS layout reports (null = use WMS data). */
  overrideStoragePalletPositions: number | null;
  overrideReceivingAreaM2: number | null;
  overrideDispatchAreaM2: number | null;
  overrideWorkAreaM2: number | null;
}

export interface CostInput {
  /** Currency of Product Master "Standard Unit Cost". null = not declared. */
  masterCostCurrency: string | null;
  /** 1 unit of masterCostCurrency = this many project-currency units. */
  fxRateMasterToProject: number | null;
  handlingCostPerPallet: number | null;
  delayCostPerDay: number | null;
  otherCosts: { label: string; amount: number }[];
}

export interface ReadinessInput {
  workstationsConfirmed: boolean;
  equipmentConfirmed: boolean;
}

export interface ScenarioInputs {
  quantity: number;
  /** Planning may target another warehouse than the project default. */
  warehouseId: string | null;
  /** Units moved between stages together. null = whole quantity (no overlap). */
  transferBatchSize: number | null;
  calendar: CalendarInput;
  labor: LaborInput;
  stages: StageInput[];
  materials: MaterialInput[];
  manualInbound: ManualInboundInput[];
  space: SpaceInput;
  costs: CostInput;
  readiness: ReadinessInput;
  includePendingRequests: boolean;
}

// ── WMS data snapshot (read by the service, consumed by the engine) ─────────

export interface ProductSnapshot {
  productId: string;
  code: string;
  name: string;
  unit: string;
  standardUnitCost: number; // Product.unitCost (0 = not maintained)
  minimumStock: number; // Product.minStock — used as safety stock
  isActive: boolean;
  available: number; // AVAILABLE in the planning warehouse
  reserved: number; // RESERVED / PICKING / PICKED / PACKED / READY_FOR_PICKUP
  inInspection: number; // PENDING_RECEIVING / PENDING_INSPECTION (received, not usable yet)
  blocked: number; // QUARANTINE / DAMAGED / DOA
  /** Submitted / pending-approval withdrawal requests (not reserved yet, all warehouses). */
  pendingRequestDemand: number;
  /** Material totals of other PLAN_APPROVED projects in the same warehouse. */
  otherPlanDemand: number;
  otherPlanRefs: string[];
}

export interface LayoutSnapshot {
  warehouseId: string;
  warehouseCode: string | null;
  palletSlotCount: number; // active PALLET/BULK slots
  palletSlotFreeCapacity: number; // Σ max(0, capacity − stock rows in location)
  otherSlotCount: number;
  hasLayout: boolean;
  layoutUnit: string | null;
  receivingAreaM2: number | null;
  dispatchAreaM2: number | null;
  stagingAreaM2: number | null;
  workAreaM2: number | null;
}

export interface DataSnapshot {
  asOf: string;
  products: ProductSnapshot[];
  layout: LayoutSnapshot;
}

// ── Output ──────────────────────────────────────────────────────────────────

export type PlanFlag =
  | 'MANPOWER_SHORTAGE'
  | 'MATERIAL_SHORTAGE'
  | 'WAREHOUSE_CAPACITY_RISK'
  | 'SCHEDULE_AT_RISK'
  | 'COST_ESTIMATE_INCOMPLETE'
  | 'INSUFFICIENT_DATA';

export type OverallStatus =
  | 'READY_FOR_PLANNING_REVIEW'
  | 'NOT_READY'
  | 'INSUFFICIENT_DATA';

export interface Issue {
  area:
    | 'INPUT'
    | 'WORKFLOW'
    | 'MANPOWER'
    | 'MATERIAL'
    | 'SPACE'
    | 'SCHEDULE'
    | 'COST';
  path?: string;
  message: string;
}

/** A calculated number with the formula and the values that produced it. */
export interface Explained {
  value: number | null;
  formula: string;
  detail: string;
}

export interface StageResult {
  key: string;
  name: string;
  dependsOn: string[];
  level: number; // column in the flow diagram
  requiredOutput: number;
  inputQty: number;
  reworkQty: number;
  processedQty: number; // input + rework
  scrapQty: number;
  laborMinutesPerUnit: number;
  productiveFactor: number; // utilization × (1 − buffer)
  capacityPerDay: number; // processed units per working day
  capacityFinalUnitsPerDay: number; // in final good units per day
  setupClockHours: number;
  processClockHours: number;
  durationClockHours: number;
  laborHours: number;
  crewPerShift: number;
  startHour: number;
  finishHour: number;
  startDate: string;
  finishDate: string;
  durationWorkingDays: number;
  startBoundBy: string; // START | MATERIAL | PREDECESSOR:<key>
  finishBoundBy: string; // OWN_CAPACITY | LAST_BATCH_FROM:<key>
  isBottleneck: boolean;
  isCritical: boolean;
  queueEstimate: number; // peak units waiting in front of this stage (estimate)
  materialReadyDate: string | null;
  explain: Explained[];
}

export interface ManpowerResult {
  totalLaborHours: number;
  personNetHoursPerDay: number;
  windowWorkingDays: number;
  requiredFte: Explained;
  headcountByHours: Explained;
  peakCrewPerShift: Explained;
  headcountBySchedule: Explained;
  requiredHeadcount: number;
  dedicatedCrewHeadcount: number; // if every stage had its own people (for comparison)
  availableHeadcount: number | null;
  effectiveAvailable: number | null;
  additionalWorkersNeeded: number | null;
  capacityGapHours: number | null;
  workforceUtilizationPct: number | null;
  byStage: {
    key: string;
    name: string;
    skill: string;
    laborHours: number;
    sharePct: number;
    crewPerShift: number;
    dedicatedHeadcount: number;
  }[];
  bySkill: {
    skill: string;
    laborHours: number;
    peakCrewPerShift: number;
    headcount: number;
  }[];
  byShift: { shift: number; peakCrew: number }[];
  overtime: {
    authorized: boolean;
    hoursNeeded: number;
    hoursAvailable: number;
    coversHourGap: boolean;
    note: string;
  } | null;
  staffingLimitedFinishDate: string | null;
  staffingLimitedNote: string | null;
}

export interface InboundLine {
  source: 'WMS_IN_INSPECTION' | 'MANUAL';
  reference: string;
  quantity: number;
  expectedDate: string;
  arrivesInTime: boolean;
}

export interface MaterialResult {
  productId: string;
  code: string;
  name: string;
  unit: string;
  source: 'MANUAL';
  stages: string[];
  demandType: 'PLANNED' | 'PLAN_APPROVED';
  grossRequirement: number;
  scrapAllowance: number;
  totalRequirement: number;
  onHand: number;
  reserved: number;
  safetyStock: number;
  pendingRequestDemand: number;
  otherPlanDemand: number;
  netAvailable: number;
  netRequirement: number;
  inbound: InboundLine[];
  eligibleInbound: number;
  shortage: number;
  requiredByDate: string;
  coverageDate: string | null;
  arrivesInTime: boolean;
  leadTimeDays: number | null;
  orderByDate: string | null;
  orderDatePassed: boolean;
  suggestedReplenishment: number;
  unitCost: number | null;
  unitCostSource: 'MANUAL_ESTIMATE' | 'PRODUCT_MASTER' | 'MISSING';
  totalCost: number | null;
  explanation: string;
}

export interface SpaceLine {
  key: 'STORAGE' | 'RECEIVING_STAGING' | 'DISPATCH_STAGING' | 'WORK_AREA';
  label: string;
  unit: 'pallet positions' | 'm²';
  required: number | null;
  available: number | null;
  availableSource: 'WMS' | 'MANUAL_OVERRIDE' | 'MISSING';
  utilizationPct: number | null;
  shortfall: number | null;
  status: 'OK' | 'RISK' | 'SHORTAGE' | 'INCOMPLETE';
  formula: string;
  detail: string;
}

export interface CostLine {
  category: 'MATERIAL' | 'LABOR' | 'OVERTIME' | 'HANDLING' | 'DELAY' | 'OTHER';
  label: string;
  amount: number | null;
  basis: string;
  status: 'ESTIMATED' | 'MISSING';
}

export interface CostResult {
  currency: string;
  lines: CostLine[];
  total: number;
  costPerUnit: number | null;
  complete: boolean;
  missing: string[];
  byStage: {
    key: string;
    name: string;
    labor: number | null;
    material: number | null;
  }[];
  note: string;
}

export interface Milestone {
  label: string;
  date: string;
}

export interface WhatIf {
  key: string;
  label: string;
  change: string;
  finishDate: string | null;
  requiredHeadcount: number | null;
  meetsTarget: boolean | null;
  tradeOff: string;
}

export interface ReadinessItem {
  key: string;
  label: string;
  status: 'MET' | 'NOT_MET' | 'UNKNOWN';
  detail: string;
}

export interface PlanResult {
  engineVersion: string;
  asOf: string;
  overallStatus: OverallStatus;
  flags: PlanFlag[];
  errors: Issue[];
  warnings: Issue[];
  missingData: Issue[];
  assumptions: string[];
  summary: {
    quantity: number;
    warehouseId: string;
    plannedStart: string;
    targetEnd: string;
    estimatedFinish: string | null;
    scheduleVarianceWorkingDays: number | null;
    totalLaborHours: number | null;
    requiredHeadcount: number | null;
    availableHeadcount: number | null;
    bottleneckStage: string | null;
    lineThroughputPerDay: number | null;
    materialLines: number;
    materialShortageLines: number;
    spaceStatus: string;
    estimatedCost: number | null;
    costComplete: boolean;
    currency: string;
  };
  calendar: {
    clockHoursPerDay: number;
    netShiftHours: number;
    windowWorkingDays: number;
    transferBatchSize: number;
  };
  stages: StageResult[];
  criticalPath: string[];
  manpower: ManpowerResult | null;
  materials: MaterialResult[];
  space: SpaceLine[];
  cost: CostResult | null;
  milestones: Milestone[];
  risks: {
    level: 'HIGH' | 'MEDIUM' | 'LOW';
    area: string;
    message: string;
    action: string;
  }[];
  whatIfs: WhatIf[];
  readiness: ReadinessItem[];
}
