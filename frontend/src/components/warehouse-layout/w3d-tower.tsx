'use client';

// PR8 Phase 1 — 3D control-tower header bar + KPI row.
//
//   [warehouse name · code · area]  [system status · updated hh:mm ⟳]  [view mode]
//   [Stock Ready][Slots Used][Empty Slots][Pending Putaway][Active Picking][Pending Shipment]
//
// Every figure is live (see use-tower-data.ts); a card with no data says so
// (loading / couldn't load / no access) and never shows a made-up number.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertTriangle, ArrowDownToLine, Boxes, LayoutGrid, PackageCheck, RefreshCw, ScanLine, Truck, Warehouse as WarehouseIcon } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { Metrics, WarehouseData } from './occupancy';
import type { EnvMode } from './scene-geometry';
import { ENV_MODES, warehouseArea } from './w3d-panels';
import type { Source, StockFigures, SystemStatus, TaskFigures } from './use-tower-data';

const pct1 = (n: number, total: number) => (total ? ((n / total) * 100).toFixed(1) : '0.0');

// ─── Header bar ───────────────────────────────────────────────────────────────

const SYS_TONE: Record<Exclude<SystemStatus, null>, { dot: string; text: string }> = {
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  degraded: { dot: 'bg-amber-500', text: 'text-amber-700' },
  down: { dot: 'bg-red-500', text: 'text-red-700' },
};

export function TowerHeader({ wh, system, updatedAt, refreshing, failed, onRefresh, mode, onMode }: {
  wh: WarehouseData;
  system: SystemStatus;
  updatedAt: Date | null;
  refreshing: boolean;
  failed: boolean;
  onRefresh: () => void;
  mode: EnvMode;
  onMode: (m: EnvMode) => void;
}) {
  const { m, t, fmt } = useT();
  const T = m.layout3d.w3d.tower, K = m.layout3d.w3d.kpi, V = m.layout3d.w3d.viewMode;
  const a = warehouseArea(wh);
  const tone = system ? SYS_TONE[system] : null;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
      {/* Warehouse */}
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><WarehouseIcon className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{wh.name}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{wh.code}</span>
          </p>
          <p className="truncate text-xs text-slate-500">
            {a ? (
              <>
                {t(K.areaValue, { value: fmt.number(a.areaM2, 0) })} · {t(K.areaUsable, { value: fmt.number(a.usableM2, 0), pct: fmt.number(a.pct, 0) })}
              </>
            ) : (
              <>
                {K.areaNotSet} · <Link href="/warehouse-master" className="text-emerald-700 underline-offset-2 hover:underline">{K.areaSetLink}</Link>
              </>
            )}
          </p>
        </div>
      </div>

      {/* System status + last refresh */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:ml-auto">
        <span className={cn('inline-flex items-center gap-1.5 font-medium', tone?.text ?? 'text-slate-400')} title={T.sysTitle} role="status">
          <span className={cn('h-2 w-2 rounded-full', tone?.dot ?? 'bg-slate-300')} />
          {system ? T.sys[system] : T.sys.checking}
        </span>
        <span className="h-3.5 w-px bg-slate-200" aria-hidden />
        {failed ? (
          <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> {T.refreshFailed}</span>
        ) : null}
        <span className="tabular-nums text-slate-500" title={T.autoRefresh}>
          {updatedAt ? t(T.updated, { time: fmt.time(updatedAt) }) : T.never}
        </span>
        <button type="button" onClick={onRefresh} disabled={refreshing} title={T.refresh} aria-label={T.refresh}
          className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-60">
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </button>
      </div>

      {/* View mode */}
      <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="radiogroup" aria-label={V.aria}>
        {ENV_MODES.map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={mode === x.id} onClick={() => onMode(x.id)}
            className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs transition-colors',
              mode === x.id ? 'bg-white font-semibold text-emerald-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900')}>
            <x.icon className={cn('h-3.5 w-3.5', mode === x.id ? 'text-emerald-600' : 'text-slate-400')} /> {V[x.id]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── KPI row ──────────────────────────────────────────────────────────────────

function Kpi({ icon, label, state, value, sub, subText }: {
  icon: ReactNode; label: string;
  /** Full sub-line as plain text for the hover title (the line truncates on narrow cards). */
  subText?: string;
  /** Data state of this card's source ('ok' for figures the page already has). */
  state: Source<unknown>['state'];
  value: string; sub: ReactNode;
}) {
  const { m } = useT();
  const T = m.layout3d.w3d.tower;
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
      <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-slate-500">{label}</p>
        {state === 'loading' ? (
          <><Skeleton className="my-1 h-6 w-16" /><Skeleton className="h-3 w-24" /></>
        ) : state === 'ok' ? (
          <>
            <p className="text-xl font-semibold leading-tight tabular-nums text-slate-900">{value}</p>
            <p className="truncate text-xs text-slate-400" title={typeof sub === 'string' ? sub : subText}>{sub}</p>
          </>
        ) : (
          <>
            <p className="text-xl font-semibold leading-tight text-slate-300">—</p>
            <p className="truncate text-xs text-slate-400">{state === 'denied' ? T.noAccess : T.loadError}</p>
          </>
        )}
      </div>
    </div>
  );
}

export function TowerKpis({ metrics, stock, tasks }: {
  metrics: Metrics;
  stock: Source<StockFigures>;
  tasks: Source<TaskFigures>;
}) {
  const { m, t, fmt } = useT();
  const K = m.layout3d.w3d.tower.kpi, OLD = m.layout3d.w3d.kpi;
  const s = stock.data, k = tasks.data, mt = metrics;
  const usedSub = t(K.slotsUsedSub, { pct: pct1(mt.occupied, mt.total), total: fmt.number(mt.total) });
  const blockedSub = t(OLD.blockedN, { n: mt.blocked });
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi icon={<PackageCheck className="h-5 w-5" />} label={K.stockReady} state={stock.state}
        value={fmt.number(s?.available ?? 0)} sub={t(K.stockReadySub, { reserved: fmt.number(s?.reserved ?? 0) })} />
      <Kpi icon={<Boxes className="h-5 w-5" />} label={K.slotsUsed} state="ok"
        value={fmt.number(mt.occupied)}
        sub={mt.blocked > 0 ? <><span>{usedSub}</span> · <span className="text-red-600">{blockedSub}</span></> : usedSub}
        subText={mt.blocked > 0 ? `${usedSub} · ${blockedSub}` : usedSub} />
      <Kpi icon={<LayoutGrid className="h-5 w-5" />} label={K.emptySlots} state="ok"
        value={fmt.number(mt.available)} sub={t(OLD.pctOfSlots, { pct: pct1(mt.available, mt.total) })} />
      <Kpi icon={<ArrowDownToLine className="h-5 w-5" />} label={K.putaway} state={stock.state}
        value={fmt.number(s?.pendingPutaway ?? 0)} sub={K.putawaySub} />
      <Kpi icon={<ScanLine className="h-5 w-5" />} label={K.picking} state={tasks.state}
        value={fmt.number(k?.picking ?? 0)} sub={t(K.pickingSub, { n: fmt.number(k?.allocated ?? 0) })} />
      <Kpi icon={<Truck className="h-5 w-5" />} label={K.shipment} state={tasks.state}
        value={fmt.number(k?.awaitingShipment ?? 0)} sub={K.shipmentSub} />
    </div>
  );
}
