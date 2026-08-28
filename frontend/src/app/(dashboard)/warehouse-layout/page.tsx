'use client';

// Warehouse Operations — the shell for both warehouse views.
// The header, KPI row and warehouse selector sit ABOVE the tabs because they
// apply to both: the Control Center (logical Rack → Slot occupancy, unchanged
// from before Sprint 4) and the Floor Plan (physical layout, read-only).

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Warehouse, RefreshCw, Boxes, CheckCircle2, Ban, Activity, Grid3x3, Map,
} from 'lucide-react';
import { toast } from 'sonner';
import { warehouseApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  type WarehouseData, whMetrics, withRate, levelOf, LEVEL_CFG,
} from '@/components/warehouse-layout/occupancy';
import { ControlCenter } from '@/components/warehouse-layout/control-center';
import { FloorPlan } from '@/components/warehouse-layout/floor-plan';

// ─── Capacity Dashboard (Row 1) ─────────────────────────────────────────────────

function CapacityDashboard({ kpis, loading }: { kpis: { warehouses: number; total: number; occupied: number; available: number; blocked: number; rate: number }; loading?: boolean }) {
  const cards = [
    { label: 'Total Warehouses', value: kpis.warehouses, icon: Warehouse, tile: 'bg-green-50 text-green-600' },
    { label: 'Total Locations',  value: kpis.total,      icon: Grid3x3,   tile: 'bg-slate-100 text-slate-600' },
    { label: 'Occupied',         value: kpis.occupied,   icon: Boxes,     tile: 'bg-amber-50 text-amber-600' },
    { label: 'Available',        value: kpis.available,  icon: CheckCircle2, tile: 'bg-emerald-50 text-emerald-600' },
    { label: 'Blocked',          value: kpis.blocked,    icon: Ban,       tile: 'bg-red-50 text-red-600' },
    { label: 'Occupancy Rate',   value: `${kpis.rate}%`, icon: Activity,  tile: 'bg-teal-50 text-teal-600' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <span className={cn('h-10 w-10 rounded-xl grid place-items-center', c.tile)}><Icon className="h-5 w-5" /></span>
            {loading ? <Skeleton className="h-8 w-14 mt-3" /> : (
              <p className="mt-3 text-2xl font-bold text-slate-900 tabular-nums leading-none">{typeof c.value === 'number' ? c.value.toLocaleString() : c.value}</p>
            )}
            <p className="mt-1.5 text-[13px] font-medium text-slate-500">{c.label}</p>
          </div>
        );
      })}
    </div>
  );
}

// ─── Storage Utilization by warehouse (Row 2) — also the warehouse selector ─────

function WarehouseUtilization({ warehouses, selectedId, onSelect, loading }: {
  warehouses: WarehouseData[]; selectedId: string; onSelect: (id: string) => void; loading?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-4">Storage Utilization by Warehouse</h2>
      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {warehouses.map((w) => {
            const m = withRate(whMetrics(w));
            const lvl = levelOf(m.utilPct, m.blocked, m.total);
            const cfg = LEVEL_CFG[lvl];
            const active = selectedId === w.id;
            return (
              <button key={w.id} onClick={() => onSelect(w.id)}
                className={cn('text-left rounded-xl border p-3.5 transition-all', active ? 'border-green-400 ring-1 ring-green-200 bg-green-50/30' : 'border-slate-200 hover:bg-slate-50')}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0', cfg.dot)} />
                    <span className="font-semibold text-slate-800 text-sm truncate">{w.name}</span>
                  </div>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold flex-shrink-0', cfg.pill)}>{cfg.label}</span>
                </div>
                <div className="mt-2.5 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div className={cn('h-full rounded-full', cfg.bar)} style={{ width: `${m.utilPct}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500 tabular-nums">
                  <span className="font-bold text-slate-700">{m.utilPct}%</span>
                  <span>{m.occupied}/{m.total} slots · {m.items} items</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function WarehouseOperationsPage() {
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWhId, setSelectedWhId] = useState('');
  const [tab, setTab] = useState('control');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const whs = await warehouseApi.list();
      setWarehouses(whs);
      setSelectedWhId((cur) => cur || whs[0]?.id || '');
    } catch { toast.error('Failed to load warehouses'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const selectedWh = warehouses.find((w) => w.id === selectedWhId) ?? null;

  // Global capacity KPIs (placement-based)
  const kpis = useMemo(() => {
    const agg = warehouses.reduce((acc, w) => {
      const m = whMetrics(w);
      return { total: acc.total + m.total, occupied: acc.occupied + m.occupied, available: acc.available + m.available, blocked: acc.blocked + m.blocked };
    }, { total: 0, occupied: 0, available: 0, blocked: 0 });
    return { warehouses: warehouses.length, ...agg, rate: agg.total ? Math.round((agg.occupied / agg.total) * 100) : 0 };
  }, [warehouses]);

  return (
    <div className="p-4 sm:p-5 space-y-4 bg-slate-50 min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">Hightpoint Service Network</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-0.5">Warehouse Operations Control Center</h1>
          <p className="text-slate-500 text-sm mt-0.5">Live occupancy from actual stock placement</p>
        </div>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-white" onClick={load} disabled={loading}>
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> Refresh
        </Button>
      </div>

      {/* Row 1 — Capacity Dashboard */}
      <CapacityDashboard kpis={kpis} loading={loading} />

      {/* Row 2 — Storage Utilization + warehouse selector */}
      <WarehouseUtilization warehouses={warehouses} selectedId={selectedWhId} onSelect={setSelectedWhId} loading={loading} />

      {/* Row 3 — Working area, per tab */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList>
          <TabsTrigger value="control"><Grid3x3 className="h-4 w-4" /> Control Center</TabsTrigger>
          <TabsTrigger value="floor"><Map className="h-4 w-4" /> Floor Plan</TabsTrigger>
        </TabsList>

        <TabsContent value="control" className="mt-4">
          {/* Remounting on warehouse change reproduces the previous reset of
              expanded rack / selected slot / slot detail. */}
          <ControlCenter key={selectedWhId} wh={selectedWh} loading={loading} onReload={load} />
        </TabsContent>

        <TabsContent value="floor" className="mt-4">
          {tab === 'floor' && <FloorPlan warehouseId={selectedWhId} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
