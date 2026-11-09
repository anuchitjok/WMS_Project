'use client';

// Warehouse Space tab of the dashboard (plan P6 6.1 / 6.2).
// Data: GET /warehouse-master/space-summary (all warehouses in the viewer's
// scope; the server applies warehouse scoping). The warehouse selector filters
// on the client, so switching is instant and totals use the same rows.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, TriangleAlert, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { warehouseSpaceApi, type SpaceSummaryResponse } from '@/lib/api-warehouse';
import { useWarehouseMasterPerms } from '@/components/warehouse-master/shared';
import { aggregateSpace, clampThreshold, DEFAULT_NEAR_FULL_PCT, readThreshold, writeThreshold } from './space-math';
import { NearFullList, OfferableSpace, SpaceBreakdown, SpaceCaveats, SpaceKpis, WarehouseCards } from './space-parts';
import { SpaceDrillDown, SpaceLayers } from './space-layers';

export function WarehouseSpaceView() {
  const { m, t, fmt } = useT();
  const S = m.dashboard.space;
  // Size is edited on Warehouse Master by SYSTEM_ADMIN only; the simulator needs Warehouse Master view access.
  const { canView: canOpenWarehouseMaster, isAdmin: canEditSize } = useWarehouseMasterPerms();

  const [data, setData] = useState<SpaceSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [threshold, setThreshold] = useState(DEFAULT_NEAR_FULL_PCT);
  const seq = useRef(0);

  useEffect(() => { setThreshold(readThreshold()); }, []);
  const changeThreshold = (v: number) => { const c = clampThreshold(v); setThreshold(c); writeThreshold(c); };

  const load = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const res = await warehouseSpaceApi.spaceSummary();
      if (id !== seq.current) return;
      setData(res);
      setError(false);
    } catch {
      if (id !== seq.current) return;
      setError(true);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const all = useMemo(() => data?.warehouses ?? [], [data]);
  // A selected warehouse that is no longer returned falls back to all.
  const rows = useMemo(() => (warehouseId ? all.filter((w) => w.warehouseId === warehouseId) : all), [all, warehouseId]);
  useEffect(() => { if (warehouseId && data && !all.some((w) => w.warehouseId === warehouseId)) setWarehouseId(''); }, [all, data, warehouseId]);
  const agg = useMemo(() => (data ? aggregateSpace(rows) : null), [data, rows]);

  const busy = loading && !data;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight text-slate-900 sm:text-2xl">{S.title}</h1>
          <p className="text-xs text-slate-500 sm:text-sm">{S.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex h-9 min-w-0 items-center rounded-md border border-slate-200 bg-white pl-2.5 text-sm text-slate-700 shadow-xs focus-within:ring-2 focus-within:ring-green-600/30">
            <Warehouse className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <span className="sr-only">{S.warehouse}</span>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="h-full max-w-[220px] cursor-pointer appearance-none truncate bg-transparent pl-2 pr-7 outline-none"
            >
              <option value="">{S.allWarehouses}</option>
              {all.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.code} · {w.name}</option>)}
            </select>
            <svg className="pointer-events-none absolute right-2 h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </label>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-white" onClick={load} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> {m.common.actions.refresh}
          </Button>
          {data && (
            <span className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-600">
              <span className={cn('h-2 w-2 rounded-full', error ? 'bg-amber-500' : 'bg-emerald-500')} />
              {t(S.updated, { time: fmt.time(data.generatedAt) })}
            </span>
          )}
        </div>
      </div>

      {error && (data ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <TriangleAlert className="h-4 w-4 shrink-0" /> {S.partialError}
          <button type="button" className="ml-auto font-medium underline" onClick={load}>{S.retry}</button>
        </div>
      ) : !loading && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-white py-14 text-center">
          <TriangleAlert className="h-8 w-8 text-red-500" />
          <p className="text-sm text-slate-700">{S.loadError}</p>
          <Button size="sm" onClick={load}>{S.retry}</Button>
        </div>
      ))}

      {data && all.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white py-14 text-center text-sm text-slate-500">{S.empty}</div>
      )}

      {(busy || (data && all.length > 0)) && (
        <>
          <SpaceLayers rows={rows} loading={busy} />
          <SpaceDrillDown rows={rows} loading={busy} />

          <div className="pt-2">
            <h2 className="text-base font-semibold text-slate-900">{S.layers.planningTitle}</h2>
            <p className="text-xs text-slate-500">{S.layers.planningSub}</p>
          </div>
          <SpaceKpis agg={agg} loading={busy} threshold={threshold} />
          {agg && <SpaceCaveats agg={agg} />}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="min-w-0 xl:col-span-7">
              {busy ? <Skeleton className="h-56 rounded-xl" /> : <OfferableSpace rows={rows} canOpenSimulator={canOpenWarehouseMaster} />}
            </div>
            <div className="min-w-0 xl:col-span-5">
              {busy ? <Skeleton className="h-56 rounded-xl" /> : <NearFullList rows={all} threshold={threshold} onThreshold={changeThreshold} />}
            </div>
            <div className="min-w-0 xl:col-span-12">
              <SpaceBreakdown agg={agg} loading={busy} />
            </div>
            <div className="min-w-0 xl:col-span-12">
              {busy ? <Skeleton className="h-48 rounded-xl" /> : <WarehouseCards rows={rows} canEditSize={canEditSize} threshold={threshold} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
