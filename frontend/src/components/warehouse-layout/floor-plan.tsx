'use client';

// Warehouse Operations — Floor Plan tab (Sprint 4, read-only).
// Renders the physical layout for the selected warehouse and lets an operator
// inspect an object. Creating and editing objects is Sprint 5; showing live
// inventory for a linked bin is Sprint 6.

import { useCallback, useEffect, useState } from 'react';
import { Map, AlertTriangle, RefreshCw, Link2Off, Info } from 'lucide-react';
import { layoutApi, type LayoutResponse, type LayoutObject } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { LayoutCanvas } from './layout-canvas';
import { OBJECT_STYLES } from './layout-object';

const TYPE_LABEL = (t: string) => t.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-semibold text-slate-800 text-right tabular-nums">{v}</dd>
    </div>
  );
}

function ObjectInspector({ obj, unitLabel }: { obj: LayoutObject | null; unitLabel: string }) {
  if (!obj) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm text-center">
        <Map className="h-8 w-8 mx-auto text-slate-300" />
        <p className="mt-2 text-sm font-medium text-slate-600">Object Details</p>
        <p className="text-xs text-slate-400">Select an object on the floor plan to inspect it</p>
      </div>
    );
  }

  const style = OBJECT_STYLES[obj.objectType];
  const linked = obj.slotId ?? obj.rackId;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="h-3.5 w-3.5 rounded-sm border" style={{ background: obj.color ?? style.fill, borderColor: style.stroke }} />
        <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Object Details</h2>
      </div>
      <dl className="space-y-2">
        <Row k="Name" v={obj.name} />
        <Row k="Code" v={obj.code || '—'} />
        <Row k="Type" v={TYPE_LABEL(obj.objectType)} />
        <Row k="Status" v={obj.status === 'ACTIVE' ? 'Active' : TYPE_LABEL(obj.status)} />
        <Row k="Position" v={`${obj.x}, ${obj.y} ${unitLabel}`} />
        <Row k="Size" v={`${obj.width} × ${obj.height} ${unitLabel}`} />
        {obj.rotation > 0 && <Row k="Rotation" v={`${obj.rotation}°`} />}
        {obj.capacity != null && <Row k="Capacity" v={obj.capacity} />}
      </dl>

      <div className="mt-4 pt-3 border-t border-slate-100">
        {linked ? (
          <p className="text-xs text-slate-500">
            Linked to a WMS location. Live inventory for this bin arrives in a later sprint.
          </p>
        ) : (
          <p className="flex items-start gap-2 text-xs text-slate-400">
            <Link2Off className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            Not linked to a WMS location. Physical-only objects — areas, aisles, shelves — never link.
          </p>
        )}
      </div>
    </div>
  );
}

function Legend() {
  const groups: [string, string[]][] = [
    ['Storage', ['STORAGE_AREA', 'RACK', 'SHELF', 'BIN']],
    ['Inbound', ['RECEIVING_AREA']],
    ['Outbound', ['SHIPPING_AREA']],
    ['Handling', ['STAGING_AREA', 'WORK_AREA']],
    ['Quality', ['QC_AREA']],
    ['Structure', ['ZONE', 'AISLE', 'CUSTOM_AREA']],
  ];
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-3">Legend</h2>
      <div className="space-y-2">
        {groups.map(([label, types]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="flex gap-1">
              {types.map((t) => {
                const s = OBJECT_STYLES[t as keyof typeof OBJECT_STYLES];
                return (
                  <span key={t} title={TYPE_LABEL(t)}
                    className="h-3 w-3 rounded-sm border"
                    style={{ background: s.fill === 'transparent' ? '#fff' : s.fill, borderColor: s.stroke,
                             borderStyle: s.dashed ? 'dashed' : 'solid' }} />
                );
              })}
            </span>
            <span className="text-xs text-slate-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FloorPlan({ warehouseId }: { warehouseId: string }) {
  const [data, setData] = useState<LayoutResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LayoutObject | null>(null);

  const load = useCallback(async () => {
    if (!warehouseId) return;
    setLoading(true); setError(null);
    try {
      setData(await layoutApi.get(warehouseId));
    } catch (e: any) {
      setData(null);
      setError(e?.message ?? 'Failed to load the floor plan');
    } finally {
      setLoading(false);
    }
  }, [warehouseId]);

  useEffect(() => { setSelected(null); load(); }, [load]);

  // Keep the inspector in sync if the underlying object list is replaced.
  useEffect(() => {
    if (!selected) return;
    const fresh = data?.objects.find((o) => o.id === selected.id) ?? null;
    if (fresh !== selected) setSelected(fresh);
  }, [data]); // eslint-disable-line

  if (loading) {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <Skeleton className="xl:col-span-2 h-[600px] rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center shadow-sm">
        <AlertTriangle className="h-10 w-10 mx-auto text-amber-400" />
        <p className="mt-2 text-sm font-medium text-slate-700">Floor plan unavailable</p>
        <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">{error}</p>
        <Button variant="outline" size="sm" className="mt-4 gap-1.5 bg-white" onClick={load}>
          <RefreshCw className="w-4 h-4" /> Try again
        </Button>
      </div>
    );
  }

  if (!data?.layout) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center shadow-sm">
        <Map className="h-10 w-10 mx-auto text-slate-300" />
        <p className="mt-2 text-sm font-medium text-slate-600">No floor plan for this warehouse yet</p>
        <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
          The physical layout is separate from the Warehouse → Rack → Slot structure. Drawing tools arrive in the next sprint.
        </p>
      </div>
    );
  }

  const { layout, objects } = data;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
      <div className="xl:col-span-2 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
            {data.warehouse.name} · Floor Plan
          </h2>
          <div className="flex items-center gap-2">
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold',
              'bg-slate-100 text-slate-500')}>Read-only</span>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-white text-xs" onClick={load}>
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          </div>
        </div>

        {objects.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center shadow-sm">
            <Map className="h-10 w-10 mx-auto text-slate-300" />
            <p className="mt-2 text-sm font-medium text-slate-600">This floor plan is empty</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {layout.widthUnits} × {layout.heightUnits} {layout.unitLabel} canvas · no objects drawn yet
            </p>
          </div>
        ) : (
          <LayoutCanvas layout={layout} objects={objects} selectedId={selected?.id ?? null} onSelect={setSelected} />
        )}
      </div>

      <div className="space-y-4 xl:sticky xl:top-4">
        <ObjectInspector obj={selected} unitLabel={layout.unitLabel} />
        <Legend />
        <p className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-slate-400">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          The floor plan shows where things physically sit. Stock quantities always come from the WMS location on the Control Center tab.
        </p>
      </div>
    </div>
  );
}
