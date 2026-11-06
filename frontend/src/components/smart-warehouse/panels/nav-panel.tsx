'use client';

// Left panel: Warehouse → Zone → Aisle → Rack. Clicking a zone or aisle
// filters the scene to it (click again to clear); clicking a rack selects it
// and flies the camera there.

import { useState } from 'react';
import { ChevronDown, ChevronRight, Warehouse } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { utilPercent } from '../filter-search';
import type { DataIndex } from '../data-index';
import { useSmartStore } from '../store';
import type { SmartWarehouseData } from '../types';

function UsedBar({ pct }: { pct: number }) {
  return (
    <span className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-slate-200" aria-hidden>
      <span className="block h-full rounded-full bg-slate-500" style={{ width: `${pct}%` }} />
    </span>
  );
}

export function NavPanel({ data, index, onOpenRack }: { data: SmartWarehouseData; index: DataIndex; onOpenRack: (rackId: string) => void }) {
  const { m, t } = useT();
  const N = m.layout3d.smart.nav;
  const st = useSmartStore();
  const f = st.filters;
  const wh = index.warehouse.get(f.warehouseId);
  const zones = data.zones.filter((z) => z.warehouseId === f.warehouseId);
  // Zones start open; aisles start closed (except the filtered one).
  const [closedZones, setClosedZones] = useState<Set<string>>(new Set());
  const [openAisles, setOpenAisles] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  const selRackId = st.selection?.kind === 'rack' ? st.selection.id
    : st.selection?.kind === 'slot' ? index.slot.get(st.selection.id)?.rackId : undefined;
  const pctOf = (id: string) => { const c = index.counts.get(id); return c ? utilPercent(c) : 0; };

  return (
    <nav className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-white" aria-label={N.title} data-testid="smart3d-nav">
      <div className="border-b border-slate-100 px-3 py-2.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{N.title}</p>
        <button type="button" onClick={st.clearFilters}
          className={cn('mt-1 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm',
            !f.zoneId && !f.aisleId && !f.rackId ? 'bg-green-50 text-green-800' : 'text-slate-700 hover:bg-slate-50')}>
          <Warehouse className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-medium">{wh ? `${wh.code} · ${wh.name}` : '—'}</span>
          <span className="text-[11px] tabular-nums text-slate-400">{t(N.usedPct, { pct: pctOf(f.warehouseId) })}</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 text-sm">
        {zones.map((z) => {
          const zOpen = !closedZones.has(z.id);
          const aisles = data.aisles.filter((a) => a.zoneId === z.id);
          const zActive = f.zoneId === z.id && !f.aisleId && !f.rackId;
          return (
            <div key={z.id} className="mb-1">
              <div className="flex items-center">
                <button type="button" aria-label={zOpen ? N.collapse : N.expand} aria-expanded={zOpen}
                  onClick={() => setClosedZones((s) => toggle(s, z.id))}
                  className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100">
                  {zOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
                <button type="button" onClick={() => st.setZone(zActive ? null : z.id)} data-testid={`smart3d-nav-zone-${z.id}`}
                  className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left',
                    zActive ? 'bg-green-50 text-green-800' : f.zoneId === z.id ? 'text-green-800' : 'text-slate-700 hover:bg-slate-50')}>
                  <span className="min-w-0 flex-1 truncate"><span className="font-medium">{t(N.zoneN, { zone: z.code })}</span> <span className="text-slate-400">· {z.name}</span></span>
                  <UsedBar pct={pctOf(z.id)} />
                </button>
              </div>
              {zOpen && aisles.map((a) => {
                const racks = data.racks.filter((r) => r.aisleId === a.id);
                const aOpen = openAisles.has(a.id) || f.aisleId === a.id || racks.some((r) => r.id === selRackId);
                const aActive = f.aisleId === a.id && !f.rackId;
                return (
                  <div key={a.id} className="ml-5">
                    <div className="flex items-center">
                      <button type="button" aria-label={aOpen ? N.collapse : N.expand} aria-expanded={aOpen}
                        onClick={() => setOpenAisles((s) => toggle(s, a.id))}
                        className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100">
                        {aOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                      <button type="button" onClick={() => st.setAisle(aActive ? null : a.id, z.id)} data-testid={`smart3d-nav-aisle-${a.id}`}
                        className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-0.5 text-left',
                          aActive ? 'bg-green-50 text-green-800' : 'text-slate-600 hover:bg-slate-50')}>
                        <span className="min-w-0 flex-1 truncate">{t(N.aisleN, { aisle: a.code })}</span>
                        <span className="text-[11px] text-slate-400">{t(N.racksN, { n: racks.length })}</span>
                      </button>
                    </div>
                    {aOpen && (
                      <div className="ml-6 grid grid-cols-3 gap-1 py-1">
                        {racks.map((r) => (
                          <button key={r.id} type="button" title={r.id} data-testid={`smart3d-nav-rack-${r.id}`}
                            onClick={() => onOpenRack(r.id)}
                            className={cn('rounded border px-1 py-0.5 text-center font-mono text-[11px]',
                              selRackId === r.id ? 'border-green-600 bg-green-50 text-green-800' : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50')}>
                            {r.code}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
