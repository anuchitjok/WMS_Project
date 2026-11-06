'use client';

// Search by SKU, product name, rack ID or slot ID. Arrow keys move through the
// results, Enter picks, Escape closes.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { search, type SearchHit, type SearchIndex } from '../filter-search';
import { useStatusColors } from '../status-colors';

export function SearchBox({ index, warehouseId, onPick }: {
  index: SearchIndex | null; warehouseId: string; onPick: (hit: SearchHit) => void;
}) {
  const { m, t } = useT();
  const T = m.layout3d.smart.toolbar;
  const S = m.layout3d.smart.status;
  const colors = useStatusColors((s) => s.colors);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  const res = useMemo(() => (index ? search(index, q, warehouseId) : { hits: [], total: 0 }), [index, q, warehouseId]);

  useEffect(() => {
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const pick = (h: SearchHit) => { onPick(h); setOpen(false); };
  const fieldLabel = { sku: T.matchSku, product: T.matchProduct, rackId: T.matchRack, slotId: T.matchSlot } as const;

  return (
    <div ref={box} className="relative w-full min-w-[220px] max-w-md">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search" value={q} placeholder={T.searchPlaceholder} aria-label={T.searchAria}
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        data-testid="smart3d-search"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, res.hits.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && res.hits[active]) { e.preventDefault(); pick(res.hits[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
        className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-8 text-sm text-slate-800 placeholder:text-slate-400 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {q && (
        <button type="button" aria-label={T.clearSearch} onClick={() => { setQ(''); setOpen(false); }}
          className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && q.trim() && (
        <div id={listId} role="listbox" className="absolute left-0 right-0 top-9 z-50 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {q.trim().length < 2 ? (
            <p className="px-3 py-2 text-xs text-slate-500">{T.typeMore}</p>
          ) : !res.hits.length ? (
            <p className="px-3 py-2 text-xs text-slate-500">{T.noResults}</p>
          ) : (
            <>
              {res.hits.map((h, i) => (
                <button key={`${h.kind}:${h.id}`} type="button" role="option" aria-selected={i === active}
                  onMouseEnter={() => setActive(i)} onClick={() => pick(h)}
                  className={cn('flex w-full items-start gap-2 px-3 py-1.5 text-left', i === active ? 'bg-slate-100' : 'hover:bg-slate-50')}>
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: h.status ? colors[h.status] : '#1d4ed8' }}
                    title={h.status ? S[h.status] : T.kindRack} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs font-medium text-slate-800">{h.title}</span>
                    {h.detail && <span className="block truncate text-xs text-slate-500">{h.detail}</span>}
                  </span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                    {h.kind === 'rack' ? T.kindRack : T.kindSlot} · {fieldLabel[h.field]}
                  </span>
                  {h.warehouseId !== warehouseId && <span className="shrink-0 text-[10px] font-medium text-slate-400">{h.warehouseId}</span>}
                </button>
              ))}
              {res.total > res.hits.length && (
                <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">{t(T.showing, { shown: res.hits.length, total: res.total })}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
