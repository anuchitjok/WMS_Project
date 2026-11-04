'use client';

// Find one stock unit by typing (serial, batch, product code or name) or by
// scanning its barcode (a scanner types the code and presses Enter). Used by
// DOA declaration and Scrap so nobody has to copy a raw stock id by hand.
import { useEffect, useRef, useState } from 'react';
import { Search, ScanLine, X } from 'lucide-react';
import { inventoryApi } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getT, labelOf, useT } from '@/i18n';

export interface PickedStock {
  id: string;
  serialNumber?: string | null;
  batchNumber?: string | null;
  status: string;
  quantity: number;
  product?: { code?: string; name?: string } | null;
  warehouse?: { code?: string; name?: string } | null;
}

export function StockPicker({
  value, onChange, allowedStatuses, label: labelProp, placeholder: placeholderProp,
}: {
  value: PickedStock | null;
  onChange: (s: PickedStock | null) => void;
  allowedStatuses?: string[];
  label?: string;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PickedStock[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const seq = useRef(0);
  const { m, t } = useT();
  const S = m.shared.stockPicker;
  const label = labelProp ?? S.label;
  const placeholder = placeholderProp ?? S.placeholder;
  const statusLabel = (s: string) => labelOf(m.status.stock, s);

  const allowed = (s: PickedStock) => !allowedStatuses || allowedStatuses.includes(s.status);

  useEffect(() => {
    const term = q.trim();
    if (value || term.length < 2) { setResults([]); setMessage(''); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await inventoryApi.list({ search: term, limit: 20 });
        if (mine !== seq.current) return;
        const rows = (res.data ?? []) as unknown as PickedStock[];
        setResults(rows);
        setMessage(rows.length === 0 ? getT().m.shared.stockPicker.noStock : '');
      } catch (e: any) {
        if (mine === seq.current) { setResults([]); setMessage(e.message || getT().m.shared.stockPicker.searchFailed); }
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, value]);

  // Enter = exact barcode lookup (what a handheld scanner sends).
  async function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = q.trim();
    if (!code) return;
    try {
      const item = (await inventoryApi.barcode(code)) as unknown as PickedStock;
      if (!allowed(item)) { setMessage(t(S.cantUse, { name: item.serialNumber ?? code, status: statusLabel(item.status) })); return; }
      onChange(item);
      setQ('');
    } catch {
      setMessage(results.length ? S.noExact : t(S.noStockFor, { code }));
    }
  }

  if (value) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-slate-600">{label}</p>
        <div className="flex items-start justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
          <div className="min-w-0 text-sm">
            <p className="font-mono font-semibold text-slate-900 truncate">{value.serialNumber ?? value.batchNumber ?? value.id.slice(-8)}</p>
            <p className="text-xs text-slate-600 truncate">{value.product?.code} · {value.product?.name}</p>
            <p className="text-xs text-slate-500">{statusLabel(value.status)} · {t(S.qty, { qty: value.quantity })} · {value.warehouse?.code ?? '—'}</p>
          </div>
          <button type="button" onClick={() => onChange(null)} aria-label={S.change} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-600 block">{label}</label>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} className="pl-8 pr-8" aria-label={label} autoComplete="off" />
        <ScanLine className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden />
      </div>
      {(searching || message) && <p className="text-xs text-slate-500">{searching ? S.searching : message}</p>}
      {results.length > 0 && (
        <ul className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
          {results.map((r) => {
            const ok = allowed(r);
            return (
              <li key={r.id}>
                <button type="button" disabled={!ok} onClick={() => { onChange(r); setQ(''); }}
                  className={cn('w-full text-left px-3 py-2 text-sm', ok ? 'hover:bg-slate-50' : 'opacity-50 cursor-not-allowed')}>
                  <span className="font-mono font-medium text-slate-800">{r.serialNumber ?? r.batchNumber ?? r.id.slice(-8)}</span>
                  <span className="text-slate-500"> · {r.product?.code} · {r.product?.name}</span>
                  <span className="block text-xs text-slate-400">{statusLabel(r.status)} · {t(S.qty, { qty: r.quantity })} · {r.warehouse?.code ?? '—'}{!ok && S.notAllowed}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
