'use client';

// PR8 Phase 2 — right panel when one rack is in focus (no slot picked).
//
// Everything here comes from the warehouse tree the page already has (no new API):
// rack master fields, its slots and their stock-row counts. A missing value says
// "not set" instead of showing a default.

import { Fragment, type ReactNode } from 'react';
import { Columns3, LayoutGrid, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { labelOf, useT } from '@/i18n';
import { type RackData, type SlotData, slotItems } from './occupancy';
import { STATE_3D, STATE_ORDER, slotState3D, type SlotState3D } from './scene-geometry';
import { sizeOf } from './setup-health';

const m2 = (cm: number) => cm / 100;

export function RackPanel({ rack, onClose, onZoom, onShowAll, onPickSlot }: {
  rack: RackData;
  onClose: () => void;
  onZoom: () => void;
  onShowAll: () => void;
  onPickSlot: (slotId: string) => void;
}) {
  const { m, t, fmt } = useT();
  const R = m.layout3d.w3d.rackPanel, D = m.layout3d.w3d.details, W = m.layout3d.w3d;
  const slots = rack.slots ?? [];

  const counts: Record<SlotState3D, number> = { empty: 0, inUse: 0, full: 0, blocked: 0 };
  let rows = 0;
  for (const s of slots) { counts[slotState3D(s)]++; rows += slotItems(s); }
  const used = counts.inUse + counts.full;
  const usedPct = slots.length ? Math.round((used / slots.length) * 100) : 0;

  const size = sizeOf(rack);
  const sizeText = size.lengthCm && size.widthCm && size.heightCm
    ? t(R.sizeValue, { l: fmt.number(m2(size.lengthCm), 2), w: fmt.number(m2(size.widthCm), 2), h: fmt.number(m2(size.heightCm), 2) })
    : null;

  // Mini map of the rack face: top level first, column 1 on the left.
  const byPos = new Map<string, SlotData>();
  for (const s of slots) byPos.set(`${s.level}-${s.column}`, s);
  const levels = Math.max(rack.levels || 0, ...slots.map((s) => s.level), 0);
  const columns = Math.max(rack.columns || 0, ...slots.map((s) => s.column), 0);

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <span className="h-2.5 w-2.5 rounded-sm bg-cyan-400 ring-1 ring-cyan-600" aria-hidden />
          {R.title}
        </h2>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label={R.close}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="truncate px-4 font-mono text-lg font-semibold text-slate-900" title={rack.code}>{rack.code}</p>
      {rack.name && rack.name !== rack.code && <p className="truncate px-4 text-xs text-slate-500">{rack.name}</p>}

      <dl className="mt-2 space-y-1.5 border-t border-slate-100 px-4 py-3">
        <Row k={D.zone} v={rack.zone || '—'} />
        <Row k={R.type} v={labelOf(m.layout3d.rackType, rack.rackType)} />
        <Row k={R.size} v={sizeText ?? <span className="font-normal text-slate-400">{R.sizeNotSet}</span>} />
        <Row k={R.layout} v={t(R.layoutValue, { levels: rack.levels, columns: rack.columns })} />
        <Row k={R.slots} v={t(R.slotsValue, { total: fmt.number(slots.length), used: fmt.number(used), empty: fmt.number(counts.empty) })} />
        <Row k={R.stockRows} v={fmt.number(rows)} />
      </dl>

      <div className="mx-4 border-t border-slate-100 py-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-slate-500">{R.usage}</span>
          <span className="font-semibold tabular-nums text-slate-800">{usedPct}%</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200">
          <div className={cn('h-1.5 rounded-full', usedPct >= 90 ? 'bg-amber-500' : 'bg-emerald-600')} style={{ width: `${usedPct}%` }} />
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {STATE_ORDER.map((st) => (
            <li key={st} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 text-slate-600"><span className={cn('h-2 w-2 rounded-full', STATE_3D[st].dot)} />{W.status[st]}</span>
              <span className={cn('tabular-nums font-medium', st === 'blocked' && counts.blocked ? 'text-red-600' : 'text-slate-800')}>{fmt.number(counts[st])}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mx-4 border-t border-slate-100 py-3">
        <p className="mb-2 text-xs text-slate-500">{R.faceHint}</p>
        {slots.length === 0 ? (
          <p className="text-sm text-slate-500">{R.noSlots}</p>
        ) : (
          <div className="max-h-56 overflow-auto">
            <div className="inline-grid gap-1" style={{ gridTemplateColumns: `1.5rem repeat(${columns}, minmax(1.25rem, 1fr))` }}>
              {Array.from({ length: levels }, (_, i) => levels - i).map((lv) => (
                <Fragment key={lv}>
                  <span className="self-center text-right text-[10px] tabular-nums text-slate-400">L{lv}</span>
                  {Array.from({ length: columns }, (_, c) => c + 1).map((col) => {
                    const s = byPos.get(`${lv}-${col}`);
                    if (!s) return <span key={col} className="h-5 rounded-sm border border-dashed border-slate-200" />;
                    const st = slotState3D(s);
                    return (
                      <button key={col} type="button" onClick={() => onPickSlot(s.id)}
                        title={`${s.code} · ${W.status[st]}`} aria-label={`${s.code} · ${W.status[st]}`}
                        className={cn('h-5 rounded-sm border transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500', STATE_3D[st].swatch)} />
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 px-4 py-3">
        <Button variant="outline" className="h-9 gap-1.5 bg-white text-xs" onClick={onZoom}><Columns3 className="h-4 w-4" /> {R.zoom}</Button>
        <Button variant="outline" className="h-9 gap-1.5 bg-white text-xs" onClick={onShowAll}><LayoutGrid className="h-4 w-4" /> {R.showAll}</Button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
      <dt className="text-slate-500">{k}</dt>
      <dd className="min-w-0 break-words font-medium text-slate-800">{v}</dd>
    </div>
  );
}
