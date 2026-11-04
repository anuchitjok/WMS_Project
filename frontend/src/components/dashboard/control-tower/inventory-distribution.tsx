'use client';

// Section C — Inventory Intelligence. Units on hand by status (same summed-quantity
// rule as /dashboard/inventory-health), with quantity and share. Each status opens
// the records behind it.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, PieChart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { interpolate, useT } from '@/i18n';
import type { DashboardOverview, InventoryHealth } from '@/lib/api';
import { Donut, STOCK_COLORS } from './charts';
import { balanceHref } from './format';
import { EmptyNote, Panel } from './panel';

type StockKey = keyof InventoryHealth;
const ORDER: StockKey[] = ['available', 'reserved', 'picked', 'qcHold', 'rtvPending'];

export function InventoryDistribution({ data, loading, warehouseId }: { data: DashboardOverview | null; loading: boolean; warehouseId?: string }) {
  const { m, fmt } = useT();
  const I = m.dashboard.ct.inventory;
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);

  // Where each status is worked on in the existing WMS.
  const HREF: Record<StockKey, string> = {
    available: balanceHref({ warehouseId }),
    reserved: '/outbound/fulfillment',
    picked: '/outbound/fulfillment',
    qcHold: '/putaway',
    rtvPending: '/rtv',
  };

  const inv = data?.inventory;
  const total = inv ? ORDER.reduce((s, k) => s + inv[k], 0) : 0;
  const slices = ORDER.map((k) => ({ key: k, label: m.dashboard.metrics[k], value: inv?.[k] ?? 0, color: STOCK_COLORS[k] }));
  const low = data?.lowStock;
  const shortage = low?.top.reduce((s, p) => s + p.shortage, 0) ?? 0;

  return (
    <Panel title={I.title} subtitle={I.subtitle} icon={PieChart} className="h-full">
      {loading && !data ? (
        <div className="flex items-center gap-5"><Skeleton className="h-40 w-40 rounded-full" /><div className="flex-1 space-y-2">{ORDER.map((k) => <Skeleton key={k} className="h-6" />)}</div></div>
      ) : total === 0 ? (
        <EmptyNote>{I.empty}</EmptyNote>
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col xl:flex-row">
          <Donut
            slices={slices}
            active={hover}
            onHover={setHover}
            onSelect={(k) => router.push(HREF[k as StockKey])}
            center={
              <div>
                <p className="text-2xl font-bold leading-none tabular-nums text-slate-900">{fmt.number(total)}</p>
                <p className="mt-1 text-[11px] text-slate-500">{I.totalUnits}</p>
              </div>
            }
          />
          <ul className="w-full min-w-0 flex-1 space-y-0.5">
            {slices.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => router.push(HREF[s.key as StockKey])}
                  onMouseEnter={() => setHover(s.key)}
                  onMouseLeave={() => setHover(null)}
                  title={I.openDetail}
                  className={cn('group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-slate-50', hover === s.key && 'bg-slate-50')}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1 truncate text-slate-700">{s.label}</span>
                  <span className="w-12 text-right text-xs tabular-nums text-slate-500">{fmt.percent(total ? s.value / total : 0, 1)}</span>
                  <span className="w-12 text-right font-semibold tabular-nums text-slate-900">{fmt.number(s.value)}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-500" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Low stock overview */}
      {data && (
        <a href="#low-stock" className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5 text-xs hover:border-slate-200">
          <span className="font-semibold uppercase tracking-wide text-slate-500">{I.lowStockOverview}</span>
          {low && low.count > 0 ? (
            <span className="text-right text-slate-700">
              <span className="font-semibold text-red-600">{interpolate(I.productsBelowMin, { count: fmt.number(low.count) })}</span>
              {low.count <= low.top.length && <span className="text-slate-500"> · {interpolate(I.totalShortage, { count: fmt.number(shortage) })}</span>}
            </span>
          ) : (
            <span className="text-emerald-600">{I.healthy}</span>
          )}
        </a>
      )}
    </Panel>
  );
}
