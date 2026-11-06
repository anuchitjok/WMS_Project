'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';

export interface SearchableOption {
  value: string;
  label: string;
  sublabel?: string;
  /** Extra text matched by the search box but not shown (e.g. part number, model). */
  keywords?: string;
}

/**
 * Type-to-search dropdown. The list renders inline (absolute) below the trigger, so it
 * works inside dialogs. Keyboard: ↑/↓ to move, Enter to pick, Esc to close.
 */
export function SearchableSelect({
  value, options, onSelect, placeholder, searchPlaceholder, disabled, className, id, maxResults = 200,
}: {
  value: string;
  options: SearchableOption[];
  onSelect: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Caps rendered rows for very large lists; typing narrows further. */
  maxResults?: number;
}) {
  const { m } = useT();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = terms.length
      ? options.filter((o) => {
          const hay = `${o.label} ${o.sublabel ?? ''} ${o.keywords ?? ''}`.toLowerCase();
          return terms.every((t) => hay.includes(t));
        })
      : options;
    return list.slice(0, maxResults);
  }, [options, search, maxResults]);

  const selected = options.find((o) => o.value === value);

  function pick(v: string) {
    onSelect(v);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) pick(filtered[active].value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
  }

  return (
    <div ref={ref} className={cn('relative w-full min-w-0', className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen((v) => !v); setSearch(''); setActive(0); }}
        className="w-full flex items-center justify-between h-9 px-3 text-sm border border-input rounded-md bg-background hover:bg-accent/30 disabled:opacity-50 disabled:cursor-not-allowed text-left transition-colors"
      >
        <span className={cn('truncate', selected ? 'text-foreground' : 'text-muted-foreground')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                autoFocus
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20"
                placeholder={searchPlaceholder ?? m.common.search.placeholder}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setActive(0); }}
                onKeyDown={onKeyDown}
              />
            </div>
          </div>
          <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-slate-400 text-center">{m.common.states.noResults}</li>
            ) : (
              filtered.map((o, i) => (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o.value)}
                  className={cn(
                    'px-3 py-2 text-sm cursor-pointer',
                    o.value === value ? 'bg-green-50 text-green-700' : i === active ? 'bg-slate-50 text-slate-800' : 'text-slate-700',
                  )}
                >
                  <div className="font-medium truncate">{o.label}</div>
                  {o.sublabel && <div className="text-xs text-slate-500 truncate">{o.sublabel}</div>}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
