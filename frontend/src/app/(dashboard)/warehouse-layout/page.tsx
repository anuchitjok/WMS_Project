'use client';

// Warehouse Operations — the shell for both warehouse views.
// Warehouse selector, KPI strip and tabs sit at the top because they apply to
// both tabs: Racks & slots (logical Rack → Slot occupancy) and the Floor Plan
// (physical layout). Occupancy is derived from actual stock placement.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Warehouse, RefreshCw, Grid3x3, Map, AlertTriangle, Box } from 'lucide-react';
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
import { Warehouse3D } from '@/components/warehouse-layout/warehouse-3d';

// ─── Warehouse selector (chips) ─────────────────────────────────────────────────

function WarehouseChips({ warehouses, selectedId, onSelect }: {
  warehouses: WarehouseData[]; selectedId: string; onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Warehouse">
      {warehouses.map((w) => {
        const m = withRate(whMetrics(w));
        const lvl = levelOf(m.utilPct, m.blocked, m.total);
        const active = selectedId === w.id;
        return (
          <button
            key={w.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(w.id)}
            title={`${w.name}: ${m.occupied}/${m.total} slots in use · ${m.items} stock rows`}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
              active
                ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
            )}
          >
            {/* Only warning / critical get a colour; normal stays quiet. */}
            {lvl !== 'normal' && <span className={cn('h-2 w-2 rounded-full', LEVEL_CFG[lvl].dot)} aria-label={LEVEL_CFG[lvl].label} />}
            <span className="font-medium">{w.code}</span>
            <span className="hidden sm:inline text-slate-500">{w.name}</span>
            <span className={cn('tabular-nums text-xs', active ? 'text-emerald-700' : 'text-slate-400')}>{m.utilPct}%</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── KPI strip for the selected warehouse ───────────────────────────────────────

function KpiStrip({ wh, loading }: { wh: WarehouseData | null; loading: boolean }) {
  const m = wh ? withRate(whMetrics(wh)) : null;
  const cells: { label: string; value: string; tone?: 'danger' }[] = [
    { label: 'Locations', value: m ? m.total.toLocaleString() : '—' },
    { label: 'In use', value: m ? m.occupied.toLocaleString() : '—' },
    { label: 'Available', value: m ? m.available.toLocaleString() : '—' },
    { label: 'Blocked', value: m ? m.blocked.toLocaleString() : '—', tone: m && m.blocked > 0 ? 'danger' : undefined },
    { label: 'Occupancy', value: m ? `${m.utilPct}%` : '—' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 rounded-xl border border-slate-200 bg-white divide-x divide-y sm:divide-y-0 divide-slate-100 overflow-hidden">
      {cells.map((c) => (
        <div key={c.label} className="px-4 py-3">
          <p className="text-xs text-slate-500">{c.label}</p>
          {loading ? <Skeleton className="h-6 w-12 mt-1" /> : (
            <p className={cn('mt-0.5 text-xl font-semibold tabular-nums', c.tone === 'danger' ? 'text-red-600' : 'text-slate-900')}>{c.value}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function WarehouseOperationsPage() {
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWhId, setSelectedWhId] = useState('');
  const [tab, setTab] = useState('control');
  // "View Stock Detail" in the 3D tab hands a slot to the Racks & slots tab.
  const [focus, setFocus] = useState<{ slotId: string; n: number } | null>(null);
  const viewStock = useCallback((slotId: string) => {
    setFocus((f) => ({ slotId, n: (f?.n ?? 0) + 1 }));
    setTab('control');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const whs = await warehouseApi.list();
      setWarehouses(whs);
      setError(null);
      // Keep the current selection if it still exists (e.g. after a refresh).
      setSelectedWhId((cur) => (whs.some((w) => w.id === cur) ? cur : whs[0]?.id || ''));
    } catch (e: any) {
      setError(e?.message || 'Could not load warehouses');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const selectedWh = useMemo(() => warehouses.find((w) => w.id === selectedWhId) ?? null, [warehouses, selectedWhId]);

  return (
    <div className="p-4 sm:p-6 space-y-4 bg-slate-50 min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 grid place-items-center"><Warehouse className="h-5 w-5" /></span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Warehouse Operations</h1>
            <p className="text-slate-500 text-sm">Live occupancy from actual stock placement</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-white" onClick={load} disabled={loading}>
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> Refresh
        </Button>
      </div>

      {error && !loading ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {error}</span>
          <Button size="sm" variant="outline" className="h-8 bg-white" onClick={load}>Try again</Button>
        </div>
      ) : null}

      {/* Warehouse selector */}
      {loading && warehouses.length === 0 ? (
        <div className="flex gap-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-9 w-40 rounded-full" />)}</div>
      ) : warehouses.length === 0 && !error ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No warehouses are available to you. Ask an administrator to assign one.
        </div>
      ) : (
        <WarehouseChips warehouses={warehouses} selectedId={selectedWhId} onSelect={(id) => { setSelectedWhId(id); setFocus(null); }} />
      )}

      <KpiStrip wh={selectedWh} loading={loading && warehouses.length === 0} />

      {/* Working area, per tab */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList>
          <TabsTrigger value="control"><Grid3x3 className="h-4 w-4" /> Racks &amp; slots</TabsTrigger>
          <TabsTrigger value="floor"><Map className="h-4 w-4" /> Floor plan</TabsTrigger>
          <TabsTrigger value="3d"><Box className="h-4 w-4" /> 3D view</TabsTrigger>
        </TabsList>

        <TabsContent value="control" className="mt-4">
          {/* Remounting on warehouse change resets expanded rack / selected slot. */}
          <ControlCenter key={selectedWhId} wh={selectedWh} loading={loading && warehouses.length === 0} onReload={load} focus={focus} />
        </TabsContent>

        <TabsContent value="floor" className="mt-4">
          {tab === 'floor' && <FloorPlan warehouseId={selectedWhId} />}
        </TabsContent>

        <TabsContent value="3d" className="mt-4">
          {/* Mounted only while open: three.js loads on first visit to this tab. */}
          {tab === '3d' && (
            <Warehouse3D key={selectedWhId} wh={selectedWh} loading={loading && warehouses.length === 0}
              onReload={load} onViewStock={viewStock} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
