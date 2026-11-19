'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One control for "search a list, then choose from it".
 *
 * A separate filter box above a <select> is two controls for one decision: you
 * type, then you still have to open the list and pick. This is the usual
 * combobox instead - type and the list under the box narrows, click or press
 * Enter to choose, Escape to leave it as it was.
 *
 * Filtering is done here on `label` and `hint` unless `onQuery` is given, in
 * which case the caller is searching somewhere else (the server, for a
 * catalogue too big to send) and the items arrive already filtered.
 */

export interface PickItem {
  id: string;
  /** What the chosen row reads as, and the first thing matched against. */
  label: string;
  /** A second line in the list - also matched, unless the caller searches. */
  hint?: string;
  /** Shown at the right of the row: a count, a status, anything short. */
  trailing?: string;
  disabled?: boolean;
}

export function PickList({
  id,
  items,
  value,
  onChange,
  onQuery,
  placeholder,
  empty,
  loading,
  disabled,
  className,
  clearLabel,
}: {
  id?: string;
  items: PickItem[];
  value: string;
  onChange: (id: string) => void;
  /** Set when the search runs elsewhere; called with the text as it is typed. */
  onQuery?: (q: string) => void;
  placeholder: string;
  empty: string;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  clearLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const chosen = items.find((i) => i.id === value) ?? null;
  const shown = useMemo(() => {
    if (onQuery) return items; // already filtered by whoever is searching
    const text = q.trim().toLowerCase();
    if (!text) return items;
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(text) ||
        (i.hint ?? '').toLowerCase().includes(text),
    );
  }, [items, q, onQuery]);

  // Clicking anywhere else leaves the choice as it was.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false);
        setQ('');
      }
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [q, items]);

  function pick(item: PickItem) {
    if (item.disabled) return;
    onChange(item.id);
    setOpen(false);
    setQ('');
    input.current?.blur();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => {
        const n = shown.length;
        if (!n) return 0;
        let next = (i + step + n) % n;
        // step over the rows that cannot be chosen
        for (let k = 0; k < n && shown[next]?.disabled; k += 1)
          next = (next + step + n) % n;
        return next;
      });
    } else if (e.key === 'Enter') {
      if (open && shown[active]) {
        e.preventDefault();
        pick(shown[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setQ('');
      }
    }
  }

  // Closed, the box reads as the chosen row; open, it is the search.
  const text = open ? q : (chosen?.label ?? '');

  return (
    <div ref={box} className={cn('relative', className)}>
      <div className="relative">
        <input
          id={id}
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          value={text}
          placeholder={chosen && !open ? chosen.label : placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            onQuery?.(e.target.value);
          }}
          onKeyDown={onKey}
          className={cn(
            'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-sm outline-none',
            'focus:border-green-500 focus:ring-2 focus:ring-green-500/20',
            'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
          )}
        />
        <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 text-slate-400">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {chosen && !disabled && (
            <button
              type="button"
              aria-label={clearLabel}
              title={clearLabel}
              className="pointer-events-auto rounded p-0.5 hover:bg-slate-100 hover:text-slate-600"
              onClick={() => {
                onChange('');
                setQ('');
                onQuery?.('');
                input.current?.focus();
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown className="h-4 w-4" />
        </div>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {shown.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-500">
              {loading ? '…' : empty}
            </li>
          ) : (
            shown.slice(0, 300).map((i, n) => (
              <li
                key={i.id}
                role="option"
                aria-selected={i.id === value}
                aria-disabled={i.disabled}
                onMouseEnter={() => setActive(n)}
                onMouseDown={(e) => e.preventDefault()} // keep the focus, so blur does not close first
                onClick={() => pick(i)}
                className={cn(
                  'flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm',
                  n === active && !i.disabled && 'bg-green-50',
                  i.disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <Check
                  className={cn(
                    'mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600',
                    i.id === value ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{i.label}</span>
                  {i.hint && (
                    <span className="block truncate text-xs text-slate-500">
                      {i.hint}
                    </span>
                  )}
                </span>
                {i.trailing && (
                  <span className="shrink-0 whitespace-nowrap text-xs text-slate-500">
                    {i.trailing}
                  </span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
