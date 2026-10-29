import { ForecastSpec, LINEAR_MIN_OBSERVATIONS, forecast } from './forecast';
import { round } from './usage';

/**
 * Forecast accuracy by rolling-origin, one-step-ahead back-testing: for each of
 * the last `evalPeriods` completed periods t, forecast t from the periods before
 * it only, then compare with the actual usage of t.
 *
 *   bias = Σ(F − A) / n          (positive = over-forecast)
 *   MAE  = Σ|F − A| / n
 *   WAPE = Σ|F − A| / Σ A        (undefined when Σ A = 0 — reported as null)
 *
 * A period is evaluated only when the method has its full window of history
 * before it. Fewer than `minPoints` evaluated periods = insufficient.
 */
export interface AccuracyResult {
  method: string;
  window: number;
  points: Array<{ index: number; forecast: number; actual: number }>;
  n: number;
  bias: number | null;
  mae: number | null;
  wape: number | null;
  sufficient: boolean;
  note: string | null;
}

export function backtest(history: number[], spec: ForecastSpec, evalPeriods: number, minPoints: number): AccuracyResult {
  const need = spec.method === 'LINEAR' ? Math.max(spec.window, LINEAR_MIN_OBSERVATIONS) : spec.window;
  const points: AccuracyResult['points'] = [];
  for (let t = Math.max(need, history.length - evalPeriods); t < history.length; t++) {
    const f = forecast(history.slice(0, t), spec, 1).perPeriod[0];
    points.push({ index: t, forecast: round(f, 4), actual: history[t] });
  }
  const n = points.length;
  const base = { method: spec.method, window: spec.window, points, n };
  if (n < minPoints) {
    return { ...base, bias: null, mae: null, wape: null, sufficient: false, note: `Only ${n} period(s) could be back-tested (need ${minPoints}).` };
  }
  const err = points.map((p) => p.forecast - p.actual);
  const absSum = err.reduce((a, e) => a + Math.abs(e), 0);
  const actSum = points.reduce((a, p) => a + p.actual, 0);
  return {
    ...base,
    bias: round(err.reduce((a, b) => a + b, 0) / n, 4),
    mae: round(absSum / n, 4),
    wape: actSum > 0 ? round(absSum / actSum, 4) : null,
    sufficient: true,
    note: actSum > 0 ? null : 'All actuals in the test window are 0: WAPE is undefined.',
  };
}

/**
 * Optional automatic method choice: lowest WAPE among methods with a sufficient
 * back-test (ties → lower MAE → the order given). Returns null when no method
 * qualifies; the configured default method is then used.
 */
export function selectMethod(results: AccuracyResult[]): AccuracyResult | null {
  const ok = results.filter((r) => r.sufficient && r.wape !== null);
  if (!ok.length) return null;
  return ok.reduce((best, r) => (r.wape! < best.wape! || (r.wape === best.wape && (r.mae ?? 0) < (best.mae ?? 0)) ? r : best));
}
