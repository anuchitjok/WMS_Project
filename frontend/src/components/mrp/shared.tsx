'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { productsApi, warehouseApi } from '@/lib/api';
import { cn } from '@/lib/utils';

// Small building blocks shared by the MRP and warranty screens.

export const fmtQty = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });

export const fmtMoney = (n: number | null | undefined, currency?: string | null) =>
  n === null || n === undefined ? '—' : `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;

export const fmtDate = (d: string | Date | null | undefined) => (d ? String(typeof d === 'string' ? d : d.toISOString()).slice(0, 10) : '—');

export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${(n * 100).toFixed(1)}%`);

type Tone = 'green' | 'amber' | 'red' | 'slate' | 'blue';
const TONE: Record<Tone, string> = {
  green: 'bg-green-50 text-green-700 border-green-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  blue: 'bg-sky-50 text-sky-700 border-sky-200',
};

export function Pill({ tone = 'slate', children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONE[tone])}>
      {children}
    </span>
  );
}

export const PLANNING_STATUS: Record<string, { label: string; tone: Tone; hint: string }> = {
  ORDER_NOW: { label: 'Order now', tone: 'red', hint: 'Suggested order date is today or already passed' },
  PLANNED: { label: 'Planned', tone: 'amber', hint: 'An order will be needed later in the horizon' },
  OK: { label: 'OK', tone: 'green', hint: 'No order needed in the horizon' },
  NOT_PLANNED: { label: 'Not planned', tone: 'slate', hint: 'Planning is switched off, replenishment is set to none, or the product is discontinued' },
};

export function StatusPill({ status }: { status: string }) {
  const s = PLANNING_STATUS[status] ?? { label: status, tone: 'slate' as Tone, hint: '' };
  return <Pill tone={s.tone} title={s.hint}>{s.label}</Pill>;
}

export const EXCEPTION_LABEL: Record<string, string> = {
  MISSING_PARAMETERS: 'Missing parameters',
  DISCONTINUED_WITH_DEMAND: 'Discontinued with demand',
  MISSING_SAFETY_STOCK: 'No safety stock',
  MISSING_LEAD_TIME: 'No lead time',
  MISSING_SUPPLIER: 'No supplier',
  MISSING_COST: 'No cost',
  NO_USAGE_HISTORY: 'No usage history',
  INSUFFICIENT_HISTORY: 'Short history',
  FORECAST_NOT_VALIDATED: 'Forecast not validated',
  RETURNS_EXCEED_ISSUES: 'Returns exceed issues',
  STOCKOUT_IMMINENT: 'Stock-out imminent',
  PROJECTED_SHORTAGE: 'Projected shortage',
  BELOW_SAFETY_STOCK: 'Below safety stock',
  LEAD_TIME_INSUFFICIENT: 'Lead time too long',
  MOQ_EXCESS: 'MOQ creates excess',
  OVERDUE_PO: 'Overdue PO',
  PO_EXCLUDED: 'PO line excluded',
  EXCESS_STOCK: 'Excess stock',
  ABOVE_MAX_STOCK: 'Above max stock',
  PARAMETER_CONFLICT: 'Parameter conflict',
  MIXED_CURRENCY: 'Mixed currency',
};

export const MOVEMENT_LABEL: Record<string, string> = {
  FAST: 'Fast', NORMAL: 'Normal', SLOW: 'Slow', NON_MOVING: 'Non-moving', NO_ACTIVITY: 'No activity', NOT_CONFIGURED: 'Not classified',
};

export function Section({ title, subtitle, action, children, className }: { title?: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-white rounded-xl border border-slate-200 shadow-sm', className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
          <div>
            {title && <h3 className="text-sm font-semibold text-slate-800">{title}</h3>}
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Note({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'amber' }) {
  return (
    <div className={cn('text-xs rounded-lg border px-3 py-2.5', tone === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-600')}>
      {children}
    </div>
  );
}

export const TH = 'px-4 py-3 font-medium';
export const TD = 'px-4 py-3';
export const THEAD = 'bg-slate-50 border-b border-slate-100';
export const THEAD_ROW = 'text-left text-xs uppercase text-slate-500';
export const SELECT = 'h-9 rounded-md border border-slate-200 bg-white px-3 text-sm';

export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

/** Product search box: type at least 2 characters, pick one result. */
export function ProductPicker({ value, onChange, placeholder = 'Search SKU or name…' }: {
  value: { id: string; code: string; name: string } | null;
  onChange: (p: { id: string; code: string; name: string } | null) => void;
  placeholder?: string;
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (term.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      productsApi.list(term.trim()).then((r) => setResults((Array.isArray(r) ? r : []).slice(0, 15))).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [term]);

  if (value) {
    return (
      <div className="flex items-center gap-2 h-9 rounded-md border border-slate-200 bg-white px-3 text-sm">
        <span className="font-mono text-slate-800">{value.code}</span>
        <span className="text-slate-500 truncate">{value.name}</span>
        <button className="ml-auto text-xs text-slate-400 hover:text-slate-700" onClick={() => { onChange(null); setTerm(''); }}>Change</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
      <input
        className="h-9 w-full rounded-md border border-slate-200 bg-white pl-8 pr-3 text-sm"
        placeholder={placeholder}
        value={term}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {results.map((p) => (
            <button key={p.id} className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange({ id: p.id, code: p.code, name: p.name }); setOpen(false); }}>
              <span className="font-mono text-slate-800">{p.code}</span> <span className="text-slate-500">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Warehouses the current user can see (the API applies warehouse scope). */
export function useWarehouses() {
  const [rows, setRows] = useState<Array<{ id: string; code?: string; name: string }>>([]);
  useEffect(() => { warehouseApi.list().then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([])); }, []);
  return rows;
}

/**
 * Minimal bar chart: one series in green, an optional comparison series as a
 * slate outline. Values are labelled on hover via the title attribute.
 */
export function BarChart({ points, compare, height = 140, compareLabel }: {
  points: Array<{ label: string; value: number }>;
  compare?: Array<number | null>;
  height?: number;
  compareLabel?: string;
}) {
  if (!points.length) return <p className="text-xs text-slate-400 px-4 py-6 text-center">No data</p>;
  const max = Math.max(1, ...points.map((p) => p.value), ...(compare ?? []).map((v) => v ?? 0));
  return (
    <div className="px-4 py-3">
      <div className="flex items-end gap-1" style={{ height }}>
        {points.map((p, i) => {
          const c = compare?.[i];
          return (
            <div key={p.label + i} className="relative flex-1 h-full flex items-end" title={`${p.label}: ${fmtQty(p.value)}${c != null ? ` · ${compareLabel ?? 'compare'}: ${fmtQty(c)}` : ''}`}>
              <div className="w-full rounded-t bg-green-500/80" style={{ height: `${(p.value / max) * 100}%` }} />
              {c != null && <div className="absolute bottom-0 left-0 right-0 rounded-t border-2 border-slate-400/70 border-b-0" style={{ height: `${(c / max) * 100}%` }} />}
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 mt-1">
        {points.map((p, i) => (
          <div key={p.label + i} className="flex-1 text-center text-[10px] text-slate-400 truncate">
            {points.length <= 12 || i % Math.ceil(points.length / 12) === 0 ? p.label : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
      <span>{total.toLocaleString()} row(s)</span>
      <div className="flex items-center gap-2">
        <button className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-40" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

/** Pulls the HTTP status out of an API error, so screens can show "no permission" calmly. */
export const isForbidden = (e: unknown) => (e as { status?: number })?.status === 403;
