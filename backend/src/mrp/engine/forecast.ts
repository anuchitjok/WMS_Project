import { linearFit, round } from './usage';

/**
 * Statistical forecast methods. Every method works on completed-period usage
 * (oldest first) and returns a per-period forecast for `horizon` periods plus
 * the calculation basis, assumptions and data-sufficiency warnings.
 *
 *  SMA     simple moving average of the last N periods:  F = Σ y[t-i] / N, i = 1..N
 *  FMA     "fast" moving average — the same formula with a shorter, separately
 *          configured window, so it reacts sooner to recent change. It is not a
 *          distinct statistical algorithm; the only difference is N.
 *  WMA     weighted moving average: F = Σ w[i]·y[t-i] / Σ w[i]; w[1] applies to
 *          the most recent period. Weights must be ≥ 0 with a positive sum and
 *          are normalised.
 *  LINEAR  ordinary least-squares line over the last N periods, extrapolated:
 *          F[h] = a + b·(N - 1 + h), h = 1..horizon; negative values floored at 0.
 * Average methods give a flat forecast across the horizon.
 */
export type ForecastMethod = 'SMA' | 'FMA' | 'WMA' | 'LINEAR';
export const FORECAST_METHODS: ForecastMethod[] = ['SMA', 'FMA', 'WMA', 'LINEAR'];

export interface ForecastSpec {
  method: ForecastMethod;
  window: number;
  /** WMA only: most-recent-first, length = window. */
  weights?: number[];
}

export interface ForecastResult {
  method: ForecastMethod;
  window: number;
  horizon: number;
  observationsUsed: number;
  perPeriod: number[];
  total: number;
  sufficient: boolean;
  basis: string;
  assumptions: string[];
  warnings: string[];
  slope?: number;
  intercept?: number;
  weightsUsed?: number[];
}

/** Minimum observations for a linear trend. */
export const LINEAR_MIN_OBSERVATIONS = 3;

export function validateSpec(spec: ForecastSpec): string[] {
  const errors: string[] = [];
  if (!FORECAST_METHODS.includes(spec.method)) errors.push(`Unknown method ${spec.method}`);
  if (!Number.isInteger(spec.window) || spec.window < 1 || spec.window > 60) errors.push('Window must be a whole number of periods between 1 and 60');
  if (spec.method === 'LINEAR' && spec.window < LINEAR_MIN_OBSERVATIONS) errors.push(`Linear trend needs a window of at least ${LINEAR_MIN_OBSERVATIONS} periods`);
  if (spec.method === 'WMA') {
    const w = spec.weights ?? [];
    if (w.length !== spec.window) errors.push(`WMA needs exactly ${spec.window} weights (one per period in the window)`);
    if (w.some((x) => !Number.isFinite(x) || x < 0)) errors.push('WMA weights must be numbers ≥ 0');
    if (w.reduce((a, b) => a + b, 0) <= 0) errors.push('WMA weights must have a positive sum');
  }
  return errors;
}

export function normaliseWeights(w: number[]): number[] {
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / s);
}

export function forecast(history: number[], spec: ForecastSpec, horizon: number): ForecastResult {
  const errors = validateSpec(spec);
  if (errors.length) throw new Error(errors.join('; '));
  const warnings: string[] = [];
  const assumptions: string[] = ['History = completed periods only; the current period is excluded.'];
  const recent = history.slice(-spec.window);
  const n = recent.length;
  const sufficient = n >= spec.window;
  if (n === 0) {
    return {
      method: spec.method, window: spec.window, horizon, observationsUsed: 0,
      perPeriod: Array(horizon).fill(0), total: 0, sufficient: false,
      basis: 'No usage history — forecast is 0.', assumptions, warnings: ['No usage history: the forecast is not reliable.'],
    };
  }
  if (!sufficient) warnings.push(`Only ${n} of ${spec.window} periods of history available: the forecast is not reliable.`);
  if (recent.every((y) => y === 0)) warnings.push('No usage in the window: forecast is 0.');

  let level = 0;
  let perPeriod: number[];
  let basis: string;
  const result: Partial<ForecastResult> = {};

  switch (spec.method) {
    case 'SMA':
    case 'FMA': {
      level = recent.reduce((a, b) => a + b, 0) / n;
      perPeriod = Array(horizon).fill(level);
      basis = `${spec.method === 'FMA' ? 'Fast' : 'Simple'} moving average of the last ${n} period(s): (${recent.join(' + ')}) / ${n} = ${round(level, 4)} per period.`;
      if (spec.method === 'FMA') assumptions.push('Fast moving average = simple average over a shorter window; reacts sooner, with more noise.');
      assumptions.push('Flat forecast: the same quantity in every future period.');
      break;
    }
    case 'WMA': {
      // Most-recent-first weights; when history is short, use the first n weights.
      const w = normaliseWeights((spec.weights ?? []).slice(0, n));
      const newestFirst = [...recent].reverse();
      level = newestFirst.reduce((a, y, i) => a + y * w[i], 0);
      perPeriod = Array(horizon).fill(level);
      result.weightsUsed = w.map((x) => round(x, 4));
      basis = `Weighted average, newest first: ${newestFirst.map((y, i) => `${round(w[i], 4)}×${y}`).join(' + ')} = ${round(level, 4)} per period.`;
      assumptions.push('Weights are normalised to sum to 1; the first weight applies to the most recent period.', 'Flat forecast across the horizon.');
      break;
    }
    case 'LINEAR': {
      if (n < LINEAR_MIN_OBSERVATIONS) {
        level = recent.reduce((a, b) => a + b, 0) / n;
        perPeriod = Array(horizon).fill(level);
        warnings.push(`Linear trend needs at least ${LINEAR_MIN_OBSERVATIONS} periods; fell back to the average of ${n} period(s).`);
        basis = `Fallback average of ${n} period(s) = ${round(level, 4)}.`;
        break;
      }
      const fit = linearFit(recent)!;
      result.slope = round(fit.slope, 4);
      result.intercept = round(fit.intercept, 4);
      let floored = false;
      perPeriod = Array.from({ length: horizon }, (_, h) => {
        const v = fit.intercept + fit.slope * (n - 1 + h + 1);
        if (v < 0) floored = true;
        return Math.max(0, v);
      });
      if (floored) warnings.push('The trend line falls below zero inside the horizon; those periods are set to 0.');
      basis = `Least-squares line over ${n} period(s): y = ${round(fit.intercept, 4)} + ${round(fit.slope, 4)}·x (x = 0 is the oldest period), extrapolated for x = ${n}..${n + horizon - 1}.`;
      assumptions.push('Assumes the recent linear trend continues for the whole horizon.');
      break;
    }
  }

  const pp = perPeriod!.map((v) => round(v, 4));
  return {
    method: spec.method, window: spec.window, horizon, observationsUsed: n,
    perPeriod: pp, total: round(pp.reduce((a, b) => a + b, 0), 4),
    sufficient, basis: basis!, assumptions, warnings, ...result,
  };
}

export interface OverrideInput {
  periodIndex: number; // 0-based planning bucket
  mode: 'REPLACE' | 'ADD';
  quantity: number;
  id?: string;
}

/**
 * Applies approved planner overrides on top of the statistical forecast. The
 * statistical values are returned unchanged next to the final values.
 */
export function applyOverrides(statistical: number[], overrides: OverrideInput[]) {
  const final = [...statistical];
  const applied: Array<OverrideInput & { statistical: number; result: number }> = [];
  for (const o of [...overrides].sort((a, b) => (a.mode === b.mode ? 0 : a.mode === 'REPLACE' ? -1 : 1))) {
    if (o.periodIndex < 0 || o.periodIndex >= final.length) continue;
    const before = final[o.periodIndex];
    final[o.periodIndex] = o.mode === 'REPLACE' ? o.quantity : Math.max(0, before + o.quantity);
    applied.push({ ...o, statistical: statistical[o.periodIndex], result: round(final[o.periodIndex], 4) });
  }
  return { statistical, final: final.map((v) => round(v, 4)), applied };
}
