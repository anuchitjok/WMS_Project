'use client';

// Section B — Operations Performance. Receiving / Putaway / Fulfillment / Shipment
// transactions per bucket, from /dashboard/overview. Chart ⇄ table toggle; clicking
// a bar opens that flow's module.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, Table2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { interpolate, useT } from '@/i18n';
import type { DashboardGranularity, DashboardOverview, DashboardRange, FlowKey } from '@/lib/api';
import { FLOW_COLORS, GroupedBarChart, Legend } from './charts';
import { bucketLabels, FLOW_HREF, FLOW_KEYS } from './format';
import { EmptyNote, Panel, Segmented } from './panel';

/** Granularities that make sense for each period (too few or too many bars otherwise). */
export const ALLOWED_GRANULARITY: Record<DashboardRange, DashboardGranularity[]> = {
  '7d': ['day'],
  '30d': ['day', 'week'],
  '90d': ['day', 'week', 'month'],
  '12m': ['week', 'month'],
};

export function OperationsTrend({
  data, loading, range, granularity, onGranularity,
}: {
  data: DashboardOverview | null;
  loading: boolean;
  range: DashboardRange;
  granularity: DashboardGranularity;
  onGranularity: (g: DashboardGranularity) => void;
}) {
  const { m, fmt, locale } = useT();
  const T = m.dashboard.ct.trend;
  const router = useRouter();
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const series = FLOW_KEYS.map((k) => ({ key: k, label: m.dashboard.ct.flow[k], color: FLOW_COLORS[k] }));
  // Labels follow the granularity of the data actually shown (avoids a flash of wrong labels while reloading).
  const shownG = data?.period.granularity ?? granularity;
  const rows = useMemo(
    () =>
      (data?.trend ?? []).map((b) => {
        const l = bucketLabels(b.bucket, shownG, locale, m);
        return { key: b.bucket, label: l.label, tooltipLabel: l.tooltip, values: { receiving: b.receiving, putaway: b.putaway, fulfillment: b.fulfillment, shipment: b.shipment } };
      }),
    [data, shownG, locale, m],
  );
  const totals = data?.flows.current;
  const empty = !!data && FLOW_KEYS.every((k) => (totals?.[k] ?? 0) === 0);
  const allowed = ALLOWED_GRANULARITY[range];

  return (
    <Panel
      title={T.title}
      subtitle={interpolate(T.subtitle, { unit: T.unit[shownG] })}
      icon={BarChart3}
      className="h-full"
      actions={
        <>
          <Segmented
            ariaLabel={T.title}
            value={granularity}
            onChange={onGranularity}
            options={(['day', 'week', 'month'] as DashboardGranularity[]).map((g) => ({ value: g, label: m.dashboard.ct.granularity[g], disabled: !allowed.includes(g) }))}
          />
          <button
            type="button"
            onClick={() => setView(view === 'chart' ? 'table' : 'chart')}
            className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            title={view === 'chart' ? T.showTable : T.showChart}
            aria-label={view === 'chart' ? T.showTable : T.showChart}
          >
            {view === 'chart' ? <Table2 className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}
          </button>
        </>
      }
    >
      {/* Period totals double as the legend (identity is never colour-only). */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {series.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => router.push(FLOW_HREF[s.key as FlowKey])}
            title={m.dashboard.ct.flowDef[s.key as FlowKey]}
            className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5 text-left hover:border-slate-200 hover:bg-slate-50"
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{s.label}</span>
            {loading && !data ? <Skeleton className="h-4 w-6" /> : (
              <span className="text-sm font-semibold tabular-nums text-slate-900">{fmt.number(totals?.[s.key as FlowKey] ?? 0)}</span>
            )}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <Skeleton className="h-[260px] w-full" />
      ) : empty ? (
        <EmptyNote className="min-h-[260px]">{T.empty}</EmptyNote>
      ) : view === 'chart' ? (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <GroupedBarChart
            data={rows}
            series={series}
            height={270}
            formatValue={(n) => fmt.number(n)}
            onSelect={(_, key) => router.push(FLOW_HREF[key as FlowKey])}
          />
          <Legend series={series} className="mt-2 justify-center" />
        </div>
      ) : (
        <div className="max-h-[300px] overflow-auto rounded-lg border border-slate-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">{T.period}</th>
                {series.map((s) => <th key={s.key} className="px-3 py-2 text-right font-semibold">{s.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.tooltipLabel}</td>
                  {series.map((s) => <td key={s.key} className="px-3 py-2 text-right tabular-nums text-slate-900">{fmt.number(r.values[s.key as FlowKey])}</td>)}
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-3 py-2 text-slate-700">{T.total}</td>
                {series.map((s) => <td key={s.key} className="px-3 py-2 text-right tabular-nums text-slate-900">{fmt.number(totals?.[s.key as FlowKey] ?? 0)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
