'use client';

// Bottom bar: status legend (click a status to show/hide it), editable status
// colours, and a short reminder of the mouse controls.

import { useEffect, useRef, useState } from 'react';
import { Palette, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { rackMatches, statusCounts } from '../filter-search';
import { useStatusColors } from '../status-colors';
import { useSmartStore } from '../store';
import { SLOT_STATUSES, type SmartWarehouseData } from '../types';

export function StatusLegend({ data, stats }: { data: SmartWarehouseData | null; stats?: string }) {
  const { m, t } = useT();
  const L = m.layout3d.smart.legend;
  const S = m.layout3d.smart.status;
  const { colors, setColor, reset } = useStatusColors();
  const filters = useSmartStore((s) => s.filters);
  const toggleStatus = useSmartStore((s) => s.toggleStatus);
  const [editing, setEditing] = useState(false);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    const close = (e: PointerEvent) => { if (!pop.current?.contains(e.target as Node)) setEditing(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [editing]);

  // Counts inside the zone / aisle / rack filter (status filter is what this bar toggles).
  const counts = statusCounts(data ? data.slots.filter((s) => rackMatches({ id: s.rackId, zoneId: s.zoneId, aisleId: s.aisleId, warehouseId: s.warehouseId }, filters)) : []);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200 bg-white px-3 py-2" data-testid="smart3d-legend">
      <span className="text-xs font-medium text-slate-500">{L.title}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {SLOT_STATUSES.map((s) => {
          const on = filters.statuses.includes(s);
          return (
            <button key={s} type="button" aria-pressed={on} title={t(L.toggle, { status: S[s] })} onClick={() => toggleStatus(s)}
              data-testid={`smart3d-legend-${s}`}
              className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                on ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50' : 'border-dashed border-slate-200 bg-slate-50 text-slate-400')}>
              <span className={cn('h-2.5 w-2.5 rounded-sm', !on && 'opacity-30')} style={{ background: colors[s] }} />
              {S[s]}
              <span className="tabular-nums text-slate-400">{counts[s].toLocaleString()}</span>
            </button>
          );
        })}
        <div className="relative" ref={pop}>
          <button type="button" onClick={() => setEditing((v) => !v)} aria-expanded={editing}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700">
            <Palette className="h-3.5 w-3.5" /> {L.editColors}
          </button>
          {editing && (
            <div className="absolute bottom-9 left-0 z-50 w-56 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
              <p className="mb-2 text-xs font-medium text-slate-700">{L.editTitle}</p>
              <ul className="space-y-1.5">
                {SLOT_STATUSES.map((s) => (
                  <li key={s} className="flex items-center justify-between gap-2 text-xs text-slate-600">
                    <label htmlFor={`sw3d-color-${s}`}>{S[s]}</label>
                    <input id={`sw3d-color-${s}`} type="color" value={colors[s]} aria-label={t(L.colorFor, { status: S[s] })}
                      onChange={(e) => setColor(s, e.target.value)}
                      className="h-6 w-10 cursor-pointer rounded border border-slate-200 bg-white p-0.5" />
                  </li>
                ))}
              </ul>
              <button type="button" onClick={reset}
                className="mt-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
                <RotateCcw className="h-3 w-3" /> {L.resetColors}
              </button>
            </div>
          )}
        </div>
      </div>
      <span className="ml-auto hidden text-[11px] text-slate-400 md:inline">{L.hints}</span>
      {stats && <span className="text-[11px] tabular-nums text-slate-400">{stats}</span>}
    </div>
  );
}
