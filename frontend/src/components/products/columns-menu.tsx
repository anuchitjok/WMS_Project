'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Columns3, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { COLUMN_GROUPS, type ColumnGroup } from './use-column-prefs';

export interface MenuColumn { id: string; group: ColumnGroup; label: string }

/** Show/hide + reorder (within group) menu for the Product Master table. */
export function ColumnsMenu({ columns, order, hidden, onToggle, onShift, onReset }: {
  columns: MenuColumn[];
  order: string[];
  hidden: string[];
  onToggle: (id: string) => void;
  onShift: (id: string, dir: -1 | 1) => void;
  onReset: () => void;
}) {
  const { m } = useT();
  const P = m.products;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const byId = new Map(columns.map((c) => [c.id, c]));

  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Columns3 className="w-3.5 h-3.5" /> {P.toolbar.columns}
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-[min(20rem,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <p className="text-xs text-slate-500 mb-2">{P.columnsMenu.hint}</p>
          {COLUMN_GROUPS.map((g) => {
            const ids = order.filter((id) => byId.get(id)?.group === g);
            return (
              <div key={g} className="mb-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 py-1">{P.groups[g]}</p>
                {ids.map((id, i) => (
                  <div key={id} className="flex items-center gap-2 py-0.5">
                    <label className="flex flex-1 items-center gap-2 text-sm text-slate-700 cursor-pointer min-w-0">
                      <input type="checkbox" className="accent-green-600" checked={!hidden.includes(id)} onChange={() => onToggle(id)} />
                      <span className="truncate">{byId.get(id)?.label}</span>
                    </label>
                    <button type="button" className="p-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={i === 0}
                      onClick={() => onShift(id, -1)} title={P.columnsMenu.moveUp} aria-label={P.columnsMenu.moveUp}>
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" className="p-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={i === ids.length - 1}
                      onClick={() => onShift(id, 1)} title={P.columnsMenu.moveDown} aria-label={P.columnsMenu.moveDown}>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
          <Button variant="outline" size="sm" className="w-full h-8 gap-1 text-xs" onClick={onReset}>
            <RotateCcw className="w-3.5 h-3.5" /> {P.columnsMenu.reset}
          </Button>
        </div>
      )}
    </div>
  );
}
