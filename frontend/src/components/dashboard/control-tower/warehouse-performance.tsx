'use client';

// Section E — Warehouse Performance. Period volumes per warehouse (grouped bars)
// and current stock on hand per warehouse (table). Raw counts only — no
// rankings or scores. Clicking a warehouse applies it as the dashboard filter.
import { Warehouse } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';
import type { DashboardOverview } from '@/lib/api';
import { FLOW_COLORS, GroupedBarChart, Legend } from './charts';
import { FLOW_KEYS } from './format';
import { EmptyNote, Panel } from './panel';

export function WarehousePerformance({
  data, loading, onSelectWarehouse,
}: {
  data: DashboardOverview | null;
  loading: boolean;
  onSelectWarehouse: (id: string) => void;
}) {
  const { m, fmt } = useT();
  const W = m.dashboard.ct.warehouse;
  const rows = data?.byWarehouse ?? [];
  const name = (r: (typeof rows)[number]) => r.code ?? m.dashboard.ct.unassigned;
  const series = FLOW_KEYS.map((k) => ({ key: k, label: m.dashboard.ct.flow[k], color: FLOW_COLORS[k] }));
  const maxStock = Math.max(1, ...rows.map((r) => r.stock.total));

  return (
    <Panel title={W.title} subtitle={W.subtitle} icon={Warehouse} className="h-full">
      {loading && !data ? (
        <Skeleton className="h-[260px] w-full" />
      ) : rows.length === 0 ? (
        <EmptyNote>{W.empty}</EmptyNote>
      ) : (
        <>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{W.volume}</p>
          <GroupedBarChart
            data={rows.map((r) => ({ key: r.id ?? 'unassigned', label: name(r), tooltipLabel: r.name ? `${r.code} · ${r.name}` : name(r), values: { ...r.volume } }))}
            series={series}
            height={190}
            labelEvery={1}
            formatValue={(n) => fmt.number(n)}
            onSelect={(d) => { if (d.key !== 'unassigned') onSelectWarehouse(d.key); }}
          />
          <Legend series={series} className="mt-1 justify-center" />

          <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{W.stock}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-1.5 pr-2 text-left font-semibold">{W.warehouse}</th>
                  <th className="px-2 py-1.5 text-right font-semibold">{W.availableUnits}</th>
                  <th className="px-2 py-1.5 text-right font-semibold">{W.totalUnits}</th>
                  <th className="w-[35%] py-1.5 pl-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr
                    key={r.id ?? 'unassigned'}
                    className={r.id ? 'cursor-pointer hover:bg-slate-50' : undefined}
                    onClick={r.id ? () => onSelectWarehouse(r.id!) : undefined}
                  >
                    <td className="max-w-[160px] py-2 pr-2">
                      <span className="block truncate font-medium text-slate-800" title={r.name ?? undefined}>{name(r)}</span>
                      {r.name && <span className="block truncate text-[11px] text-slate-400">{r.name}</span>}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-900">{fmt.number(r.stock.available)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-600">{fmt.number(r.stock.total)}</td>
                    <td className="py-2 pl-2">
                      {/* Available share of on-hand, on a common scale across warehouses. */}
                      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100" style={{ width: `${Math.max(4, (r.stock.total / maxStock) * 100)}%` }}>
                        <div className="h-full bg-[#1baf7a]" style={{ width: `${r.stock.total ? (r.stock.available / r.stock.total) * 100 : 0}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

