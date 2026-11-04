import { INTL_LOCALE, interpolate, type Locale, type Messages } from '@/i18n';
import type { DashboardGranularity, FlowKey } from '@/lib/api';

export const FLOW_KEYS: FlowKey[] = ['receiving', 'putaway', 'fulfillment', 'shipment'];

/** Existing module each flow / metric opens. */
export const FLOW_HREF: Record<FlowKey, string> = {
  receiving: '/receiving',
  putaway: '/putaway',
  fulfillment: '/outbound/fulfillment',
  shipment: '/outbound/fulfillment',
};

/** Stock balance report, optionally filtered (Reports reads ?warehouse= and ?q=). */
export function balanceHref(p: { warehouseId?: string | null; q?: string } = {}) {
  const q = new URLSearchParams({ tab: 'balance' });
  if (p.warehouseId) q.set('warehouse', p.warehouseId);
  if (p.q) q.set('q', p.q);
  return `/reports?${q}`;
}

/** 'YYYY-MM-DD' bucket key (already in the viewer's time zone) → local Date. */
function keyDate(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Axis label + tooltip label for a trend bucket. */
export function bucketLabels(key: string, g: DashboardGranularity, locale: Locale, m: Messages) {
  const d = keyDate(key);
  const L = INTL_LOCALE[locale];
  if (g === 'month') {
    return {
      label: new Intl.DateTimeFormat(L, { month: 'short', year: '2-digit' }).format(d),
      tooltip: new Intl.DateTimeFormat(L, { month: 'long', year: 'numeric' }).format(d),
    };
  }
  const short = new Intl.DateTimeFormat(L, { day: 'numeric', month: 'short' }).format(d);
  const long = new Intl.DateTimeFormat(L, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  if (g === 'week') return { label: short, tooltip: interpolate(m.dashboard.ct.trend.weekOf, { date: long }) };
  return { label: short, tooltip: new Intl.DateTimeFormat(L, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d) };
}

/**
 * Period-over-period change. A percentage is only shown when the previous
 * period had activity — otherwise the change is not meaningful.
 */
export type Delta =
  | { kind: 'pct'; pct: number }
  | { kind: 'new' }
  | { kind: 'flat' }
  | { kind: 'none' };
export function delta(current: number, previous: number): Delta {
  if (previous > 0) return current === previous ? { kind: 'flat' } : { kind: 'pct', pct: (current - previous) / previous };
  return current > 0 ? { kind: 'new' } : { kind: 'none' };
}
