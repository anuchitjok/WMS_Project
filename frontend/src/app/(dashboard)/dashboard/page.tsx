'use client';

// Dashboard with two views (plan P6 6.3), chosen by ?view= so it can be linked:
//  - Operations Control Tower (default; numbers and behaviour unchanged)
//  - Warehouse Space (?view=space) — components/dashboard/space
//
// WMS Operations Control Tower (dashboard).
// Data: GET /dashboard/overview (KPIs, inventory, trend, warehouse comparison,
// low stock, control counts — warehouse-scoped on the server) and
// GET /dashboard/activity (latest operational events). Read-only: every action
// links to the existing module where the work is done.
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarRange, LandPlot, LayoutDashboard, RefreshCw, TriangleAlert, Warehouse, type LucideIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import {
  dashboardApi,
  type ActivityEvent, type DashboardGranularity, type DashboardOverview, type DashboardRange,
} from '@/lib/api';
import { KpiStrip } from '@/components/dashboard/control-tower/kpi-strip';
import { ALLOWED_GRANULARITY, OperationsTrend } from '@/components/dashboard/control-tower/operations-trend';
import { InventoryDistribution } from '@/components/dashboard/control-tower/inventory-distribution';
import { ControlCenter } from '@/components/dashboard/control-tower/control-center';
import { WarehousePerformance } from '@/components/dashboard/control-tower/warehouse-performance';
import { LowStockItems } from '@/components/dashboard/control-tower/low-stock-items';
import { ActivityTable } from '@/components/dashboard/control-tower/activity-table';
import { WarehouseSpaceView } from '@/components/dashboard/space/warehouse-space-view';

const RANGES: DashboardRange[] = ['7d', '30d', '90d', '12m'];
const PREFS_KEY = 'wms_dashboard_prefs';

interface Prefs { range: DashboardRange; granularity: DashboardGranularity; warehouseId: string }
const DEFAULT_PREFS: Prefs = { range: '30d', granularity: 'day', warehouseId: '' };

// Per-viewer convenience only; the page works without it.
function readPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    const range = RANGES.includes(p.range as DashboardRange) ? (p.range as DashboardRange) : DEFAULT_PREFS.range;
    const granularity = ALLOWED_GRANULARITY[range].includes(p.granularity as DashboardGranularity) ? (p.granularity as DashboardGranularity) : ALLOWED_GRANULARITY[range][0];
    return { range, granularity, warehouseId: typeof p.warehouseId === 'string' ? p.warehouseId : '' };
  } catch {
    return DEFAULT_PREFS;
  }
}

const browserZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
};

type View = 'operations' | 'space';

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-full bg-slate-50 p-3 sm:p-5"><Skeleton className="h-[600px] rounded-xl" /></div>}>
      <DashboardShell />
    </Suspense>
  );
}

function DashboardShell() {
  const router = useRouter();
  const params = useSearchParams();
  const { m } = useT();
  const T = m.dashboard.tabs;
  const view: View = params.get('view') === 'space' ? 'space' : 'operations';
  const setView = (v: View) => router.replace(v === 'space' ? '/dashboard?view=space' : '/dashboard', { scroll: false });

  const tabs: { value: View; label: string; desc: string; icon: LucideIcon }[] = [
    { value: 'operations', label: T.operations, desc: T.operationsDesc, icon: LayoutDashboard },
    { value: 'space', label: T.space, desc: T.spaceDesc, icon: LandPlot },
  ];

  return (
    <div className="min-h-full space-y-4 bg-slate-50 p-3 sm:p-5">
      <div role="tablist" aria-label={T.ariaLabel} className="grid grid-cols-2 gap-2 sm:max-w-3xl">
        {tabs.map((tab) => {
          const active = view === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              id={`dashboard-tab-${tab.value}`}
              aria-selected={active}
              aria-controls="dashboard-tabpanel"
              onClick={() => setView(tab.value)}
              className={cn(
                'flex min-w-0 items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
                active ? 'border-green-600 bg-white shadow-sm ring-1 ring-green-600' : 'border-slate-200 bg-white/60 hover:bg-white',
              )}
            >
              <tab.icon className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-green-600' : 'text-slate-400')} aria-hidden />
              <span className="min-w-0">
                <span className={cn('block text-sm font-semibold leading-tight', active ? 'text-slate-900' : 'text-slate-600')}>{tab.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-slate-500">{tab.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="dashboard-tabpanel" aria-labelledby={`dashboard-tab-${view}`}>
        {view === 'space' ? <WarehouseSpaceView /> : <OperationsControlTower />}
      </div>
    </div>
  );
}

function OperationsControlTower() {
  const { m, t, fmt } = useT();
  const C = m.dashboard.ct;
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const seq = useRef(0);

  useEffect(() => { setPrefs(readPrefs()); }, []);

  const update = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...(p ?? DEFAULT_PREFS), ...patch };
      if (!ALLOWED_GRANULARITY[next.range].includes(next.granularity)) next.granularity = ALLOWED_GRANULARITY[next.range][0];
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });

  const load = useCallback(async (p: Prefs) => {
    const id = ++seq.current; // ignore responses from superseded requests
    setLoading(true);
    const [ov, act] = await Promise.allSettled([
      dashboardApi.overview({ warehouseId: p.warehouseId || undefined, range: p.range, granularity: p.granularity, tz: browserZone() }),
      dashboardApi.activity(50),
    ]);
    if (id !== seq.current) return;
    if (ov.status === 'fulfilled') {
      setOverview(ov.value);
      // A remembered warehouse that is no longer in scope falls back to all.
      if (p.warehouseId && !ov.value.warehouses.some((w) => w.id === p.warehouseId)) update({ warehouseId: '' });
    }
    if (act.status === 'fulfilled') setActivity(act.value);
    setError(ov.status === 'rejected' || act.status === 'rejected');
    setLoading(false);
  }, []);

  useEffect(() => { if (prefs) load(prefs); }, [prefs, load]);

  const p = prefs ?? DEFAULT_PREFS;
  const warehouseId = p.warehouseId || undefined;
  const busy = loading || !prefs;

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden h-11 w-11 shrink-0 place-items-center rounded-xl bg-green-600 text-white shadow-sm sm:grid">
            <LayoutDashboard className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-green-700">{m.dashboard.company}</p>
            <h1 className="text-xl font-bold leading-tight text-slate-900 sm:text-2xl">{C.title}</h1>
            <p className="text-xs text-slate-500 sm:text-sm">{C.subtitle} · {fmt.dateLong(new Date())}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:flex-nowrap">
          <FilterSelect icon={Warehouse} label={C.filters.warehouse} value={p.warehouseId} onChange={(v) => update({ warehouseId: v })}>
            <option value="">{C.allWarehouses}</option>
            {(overview?.warehouses ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </FilterSelect>
          <FilterSelect icon={CalendarRange} label={C.filters.period} value={p.range} onChange={(v) => update({ range: v as DashboardRange })}>
            {RANGES.map((r) => <option key={r} value={r}>{C.range[r]}</option>)}
          </FilterSelect>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-white" onClick={() => prefs && load(prefs)} disabled={busy}>
            <RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} /> {m.common.actions.refresh}
          </Button>
          {overview && (
            <span className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-600">
              <span className={cn('h-2 w-2 rounded-full', error ? 'bg-amber-500' : 'bg-emerald-500')} />
              {t(C.updated, { time: fmt.time(overview.generatedAt) })}
            </span>
          )}
        </div>
      </div>

      {error && (
        overview ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <TriangleAlert className="h-4 w-4 shrink-0" /> {C.partialError}
            <button type="button" className="ml-auto font-medium underline" onClick={() => prefs && load(prefs)}>{C.retry}</button>
          </div>
        ) : !busy && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-white py-14 text-center">
            <TriangleAlert className="h-8 w-8 text-red-500" />
            <p className="text-sm text-slate-700">{C.loadError}</p>
            <Button size="sm" onClick={() => prefs && load(prefs)}>{C.retry}</Button>
          </div>
        )
      )}

      {(overview || busy) && (
        <>
          {/* A — Executive overview */}
          <KpiStrip data={overview} loading={busy && !overview} warehouseId={warehouseId} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            {/* B — Operations performance  ·  C — Inventory intelligence */}
            <div className="min-w-0 xl:col-span-7">
              <OperationsTrend
                data={overview}
                loading={busy}
                range={p.range}
                granularity={p.granularity}
                onGranularity={(g) => update({ granularity: g })}
              />
            </div>
            <div className="min-w-0 xl:col-span-5">
              <InventoryDistribution data={overview} loading={busy} warehouseId={warehouseId} />
            </div>

            {/* D — Operations control center  ·  E — Warehouse performance */}
            <div className="min-w-0 xl:col-span-7">
              <ControlCenter data={overview} loading={busy} />
            </div>
            <div className="min-w-0 xl:col-span-5">
              <WarehousePerformance data={overview} loading={busy} onSelectWarehouse={(id) => { update({ warehouseId: id }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
            </div>

            {/* F — Top low stock  ·  G — Recent activity */}
            <div id="low-stock" className="min-w-0 scroll-mt-4 xl:col-span-6">
              <LowStockItems data={overview} loading={busy} warehouseId={warehouseId} />
            </div>
            <div className="min-w-0 xl:col-span-6">
              <ActivityTable events={activity} loading={busy} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FilterSelect({
  icon: Icon, label, value, onChange, children,
}: {
  icon: typeof Warehouse;
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="relative flex h-9 min-w-0 items-center rounded-md border border-slate-200 bg-white pl-2.5 text-sm text-slate-700 shadow-xs focus-within:ring-2 focus-within:ring-green-600/30">
      <Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full max-w-[220px] cursor-pointer appearance-none truncate bg-transparent pl-2 pr-7 outline-none"
      >
        {children}
      </select>
      <svg className="pointer-events-none absolute right-2 h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
      </svg>
    </label>
  );
}
