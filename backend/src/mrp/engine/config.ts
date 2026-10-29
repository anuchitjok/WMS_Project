import { FORECAST_METHODS, ForecastMethod, ForecastSpec, validateSpec } from './forecast';
import { UsageBasis } from './usage';

/**
 * MRP configuration. Stored in MrpConfig (key "default"); every run keeps a copy.
 *
 * Classification thresholds default to null = NOT CONFIGURED: the system does not
 * classify materials as fast/slow/non-moving/excess/high-value until the business
 * sets them. Pattern cut-offs default to the published Syntetos–Boylan values;
 * all other defaults are planning assumptions shown in the UI with
 * `thresholdsApproved: false` until someone with mrp.config confirms them.
 */
export interface MrpConfigShape {
  granularity: 'WEEK' | 'MONTH';
  horizonPeriods: number;
  historyPeriods: number;
  usageBasis: UsageBasis;
  defaultMethod: ForecastMethod;
  methods: Record<ForecastMethod, { window: number; weights?: number[] }>;
  autoSelectMethod: boolean;
  accuracy: { evalPeriods: number; minPoints: number };
  demandCombination: 'MAX' | 'SUM';
  includeUnapprovedRequests: boolean;
  pastDueSupply: 'FIRST_BUCKET' | 'EXCLUDE';
  countInspectionAsUsable: boolean;
  overrideRequiresApproval: boolean;
  pattern: { adiCutoff: number; cv2Cutoff: number; trendThreshold: number; minTrendPeriods: number };
  classification: {
    fastMinMonthlyUsage: number | null;
    slowMaxMonthlyUsage: number | null;
    nonMovingDays: number | null;
    highVariabilityCv: number | null;
    excessMonthsOfSupply: number | null;
    highValueThreshold: number | null;
    moqExcessShare: number | null;
    urgentWithinDays: number;
  };
  thresholdsApproved: boolean;
}

export const DEFAULT_MRP_CONFIG: MrpConfigShape = {
  granularity: 'MONTH',
  horizonPeriods: 6,
  historyPeriods: 24,
  usageBasis: 'NET_ISSUES',
  defaultMethod: 'SMA',
  methods: {
    SMA: { window: 6 },
    FMA: { window: 3 },
    WMA: { window: 3, weights: [0.5, 0.3, 0.2] },
    LINEAR: { window: 12 },
  },
  autoSelectMethod: false,
  accuracy: { evalPeriods: 6, minPoints: 3 },
  demandCombination: 'MAX',
  includeUnapprovedRequests: true,
  pastDueSupply: 'FIRST_BUCKET',
  countInspectionAsUsable: false,
  overrideRequiresApproval: true,
  pattern: { adiCutoff: 1.32, cv2Cutoff: 0.49, trendThreshold: 0.05, minTrendPeriods: 6 },
  classification: {
    fastMinMonthlyUsage: null,
    slowMaxMonthlyUsage: null,
    nonMovingDays: null,
    highVariabilityCv: null,
    excessMonthsOfSupply: null,
    highValueThreshold: null,
    moqExcessShare: null,
    urgentWithinDays: 0,
  },
  thresholdsApproved: false,
};

export function methodSpec(cfg: MrpConfigShape, m: ForecastMethod): ForecastSpec {
  return { method: m, window: cfg.methods[m].window, weights: cfg.methods[m].weights };
}

/** Deep-merges a partial config over the defaults (unknown keys are dropped). */
export function mergeConfig(stored: unknown): MrpConfigShape {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<MrpConfigShape>;
  const d = DEFAULT_MRP_CONFIG;
  return {
    ...d,
    ...pick(s, Object.keys(d) as (keyof MrpConfigShape)[]),
    methods: {
      SMA: { ...d.methods.SMA, ...(s.methods?.SMA ?? {}) },
      FMA: { ...d.methods.FMA, ...(s.methods?.FMA ?? {}) },
      WMA: { ...d.methods.WMA, ...(s.methods?.WMA ?? {}) },
      LINEAR: { ...d.methods.LINEAR, ...(s.methods?.LINEAR ?? {}) },
    },
    accuracy: { ...d.accuracy, ...(s.accuracy ?? {}) },
    pattern: { ...d.pattern, ...(s.pattern ?? {}) },
    classification: { ...d.classification, ...(s.classification ?? {}) },
  };
}

function pick<T extends object>(o: Partial<T>, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

export function validateConfig(c: MrpConfigShape): string[] {
  const e: string[] = [];
  if (!['WEEK', 'MONTH'].includes(c.granularity)) e.push('granularity must be WEEK or MONTH');
  if (!Number.isInteger(c.horizonPeriods) || c.horizonPeriods < 1 || c.horizonPeriods > 104) e.push('horizonPeriods must be 1–104');
  if (!Number.isInteger(c.historyPeriods) || c.historyPeriods < 3 || c.historyPeriods > 156) e.push('historyPeriods must be 3–156');
  if (!['NET_ISSUES', 'CONFIRMED_USAGE'].includes(c.usageBasis)) e.push('usageBasis must be NET_ISSUES or CONFIRMED_USAGE');
  if (!FORECAST_METHODS.includes(c.defaultMethod)) e.push('defaultMethod is not a known method');
  for (const m of FORECAST_METHODS) {
    for (const err of validateSpec(methodSpec(c, m))) e.push(`${m}: ${err}`);
    if (c.methods[m].window > c.historyPeriods) e.push(`${m}: window is longer than historyPeriods`);
  }
  if (c.methods.FMA.window >= c.methods.SMA.window) e.push('FMA window must be shorter than the SMA window (that is what makes it "fast")');
  if (!Number.isInteger(c.accuracy.evalPeriods) || c.accuracy.evalPeriods < 1) e.push('accuracy.evalPeriods must be ≥ 1');
  if (!Number.isInteger(c.accuracy.minPoints) || c.accuracy.minPoints < 1 || c.accuracy.minPoints > c.accuracy.evalPeriods) e.push('accuracy.minPoints must be 1..evalPeriods');
  if (!['MAX', 'SUM'].includes(c.demandCombination)) e.push('demandCombination must be MAX or SUM');
  if (!['FIRST_BUCKET', 'EXCLUDE'].includes(c.pastDueSupply)) e.push('pastDueSupply must be FIRST_BUCKET or EXCLUDE');
  for (const k of ['adiCutoff', 'cv2Cutoff', 'trendThreshold'] as const) if (!isNum(c.pattern[k]) || c.pattern[k] <= 0) e.push(`pattern.${k} must be > 0`);
  if (!Number.isInteger(c.pattern.minTrendPeriods) || c.pattern.minTrendPeriods < 3) e.push('pattern.minTrendPeriods must be ≥ 3');
  const cl = c.classification;
  for (const k of ['fastMinMonthlyUsage', 'slowMaxMonthlyUsage', 'nonMovingDays', 'highVariabilityCv', 'excessMonthsOfSupply', 'highValueThreshold', 'moqExcessShare'] as const) {
    if (cl[k] !== null && (!isNum(cl[k]) || (cl[k] as number) < 0)) e.push(`classification.${k} must be empty or a number ≥ 0`);
  }
  if (cl.fastMinMonthlyUsage !== null && cl.slowMaxMonthlyUsage !== null && cl.slowMaxMonthlyUsage >= cl.fastMinMonthlyUsage) {
    e.push('Slow-moving maximum must be below the fast-moving minimum');
  }
  if (!Number.isInteger(cl.urgentWithinDays) || cl.urgentWithinDays < 0) e.push('classification.urgentWithinDays must be a whole number ≥ 0');
  return e;
}
