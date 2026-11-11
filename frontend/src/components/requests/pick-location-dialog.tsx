'use client';

// PR6: approve a request and choose which location each item is picked from.
// Lines left on FIFO behave exactly as a normal approval. For a chosen line the
// approver taps location cards built from the live stock rows (GET pick-options);
// the quantity fills itself in. Inside one location the oldest rows are taken first,
// unless the approver opens the lot / serial list and picks rows directly.
// The API payload is unchanged: one { itemId, stockItemId, qty } per stock row.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Circle, Info, Loader2, Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { requestsApi, localizeError, type PickChoice, type PickOptions, type PickOption } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';

type Line = PickOptions['lines'][number];
const EPS = 1e-9;
const round = (n: number) => Number(n.toFixed(6));

/** One physical location of a line: every stock row in the same warehouse / rack / slot. */
interface Spot {
  key: string;
  warehouseId: string | null;
  warehouseCode: string;
  place: string | null; // "rack · slot", or null when the stock has no rack / slot
  rows: PickOption[];   // oldest first (the API sends rows in FIFO order)
  total: number;
  oldest: string;
  fifo: boolean;        // FIFO would start here
  serials: number;
  lots: number;
}

function spotsOf(l: Line): Spot[] {
  const map = new Map<string, Spot>();
  for (const o of l.options) {
    const key = `${o.warehouseId ?? ''}|${o.rackCode ?? ''}|${o.slotCode ?? ''}`;
    let s = map.get(key);
    if (!s) {
      const place = [o.rackCode, o.slotCode].filter(Boolean).join(' · ') || null;
      s = { key, warehouseId: o.warehouseId, warehouseCode: o.warehouseCode ?? o.warehouseName ?? '—', place,
        rows: [], total: 0, oldest: o.receivedDate, fifo: false, serials: 0, lots: 0 };
      map.set(key, s);
    }
    s.rows.push(o);
    s.total = round(s.total + o.quantity);
    if (o.stockItemId === l.fifoStockItemId) s.fifo = true;
    if (o.serialNumber) s.serials++;
  }
  for (const s of map.values()) s.lots = new Set(s.rows.filter((r) => !r.serialNumber).map((r) => r.batchNumber ?? '')).size;
  return [...map.values()];
}

/** Rows FIFO would take for a line, among the listed options. */
function fifoPlan(line: Line): Set<string> {
  const out = new Set<string>();
  let left = line.quantity;
  for (const o of line.options) {
    if (left <= EPS) break;
    out.add(o.stockItemId);
    left -= o.quantity;
  }
  return out;
}

/** Spread `q` over a location's rows, oldest first. A serial row is taken whole or not at all. */
function spread(rows: PickOption[], q: number): Record<string, number> {
  const out: Record<string, number> = {};
  let left = q;
  for (const o of rows) {
    let take = 0;
    if (left > EPS) take = o.serialNumber ? (left >= o.quantity - EPS ? o.quantity : 0) : Math.min(o.quantity, left);
    out[o.stockItemId] = round(take);
    left -= take;
  }
  return out;
}

export function PickLocationDialog({ requestId, refNumber, onClose, onApproved }: {
  requestId: string | null;
  refNumber?: string;
  onClose: () => void;
  onApproved: () => void;
}) {
  const { m, t, fmt } = useT();
  const P = m.approvals.pick;
  const [data, setData] = useState<PickOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Record<string, 'fifo' | 'choose'>>({});
  // `${itemId}|${stockItemId}` → chosen quantity
  const [qty, setQty] = useState<Record<string, number>>({});
  // `${itemId}|${spot key}` → lot / serial list open
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setData(null); setError(null); setMode({}); setQty({}); setOpen({}); setBusy(false);
    if (!requestId) return;
    let live = true;
    requestsApi.pickOptions(requestId)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(localizeError(e)); });
    return () => { live = false; };
  }, [requestId]);

  const key = (itemId: string, stockItemId: string) => `${itemId}|${stockItemId}`;
  const choosing = (l: Line) => mode[l.itemId] === 'choose';
  const spots = useMemo(() => new Map((data?.lines ?? []).map((l) => [l.itemId, spotsOf(l)])), [data]);

  // Chosen rows per line, and the one warehouse they come from (Q2).
  const picks = useMemo(() => {
    const out: Array<PickChoice & { warehouseId: string | null }> = [];
    for (const l of data?.lines ?? []) {
      if (mode[l.itemId] !== 'choose') continue;
      for (const o of l.options) {
        const q = qty[key(l.itemId, o.stockItemId)] ?? 0;
        if (q > EPS) out.push({ itemId: l.itemId, stockItemId: o.stockItemId, qty: q, warehouseId: o.warehouseId });
      }
    }
    return out;
  }, [data, mode, qty]);
  const lockedWh = picks.length ? picks[0].warehouseId : undefined;
  const whLabel = (id: string | null | undefined) => {
    for (const l of data?.lines ?? []) {
      const o = l.options.find((x) => x.warehouseId === id);
      if (o) return o.warehouseCode ?? o.warehouseName ?? '—';
    }
    return '—';
  };

  const sumOf = (l: Line, rows: PickOption[] = l.options) =>
    round(rows.reduce((s, o) => s + (qty[key(l.itemId, o.stockItemId)] ?? 0), 0));
  const lineState = (l: Line) => {
    const mine = picks.filter((p) => p.itemId === l.itemId);
    const sum = sumOf(l);
    const fifo = fifoPlan(l);
    const notFifo = mine.length > 0 && (mine.length !== fifo.size || mine.some((p) => !fifo.has(p.stockItemId)));
    return { sum, left: round(Math.max(0, l.quantity - sum)), ok: Math.abs(sum - l.quantity) <= EPS, notFifo };
  };
  const allOk = (data?.lines ?? []).every((l) => !choosing(l) || lineState(l).ok);

  /** Set how much to take from one location (clamped to what it has and what is still needed). */
  const setSpot = (l: Line, s: Spot, want: number) => {
    const cur = sumOf(l, s.rows);
    const max = Math.min(s.total, round(cur + lineState(l).left));
    const q = Math.max(0, Math.min(max, round(want)));
    const next = spread(s.rows, q);
    setQty((x) => {
      const y = { ...x };
      for (const [id, v] of Object.entries(next)) y[key(l.itemId, id)] = v;
      return y;
    });
  };
  /** Set one stock row directly (from the lot / serial list). */
  const setRow = (l: Line, o: PickOption, want: number) => {
    const k = key(l.itemId, o.stockItemId);
    const cur = qty[k] ?? 0;
    const max = Math.min(o.quantity, round(cur + lineState(l).left));
    let q = Math.max(0, Math.min(max, round(want)));
    if (o.serialNumber) q = want > EPS && max >= o.quantity - EPS ? o.quantity : 0;
    setQty((x) => ({ ...x, [k]: q }));
  };

  const approve = async () => {
    if (!requestId) return;
    setBusy(true);
    try {
      await requestsApi.approve(requestId, true, undefined, picks.map(({ itemId, stockItemId, qty: q }) => ({ itemId, stockItemId, qty: q })));
      toast.success(picks.length ? P.approvedToast : m.approvals.toast.approved);
      onApproved();
    } catch (e) {
      toast.error(localizeError(e));
      setBusy(false);
    }
  };

  const stepBtn = 'inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <Dialog open={!!requestId} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-3xl p-0">
        <DialogHeader className="border-b border-slate-200 px-5 py-3">
          <DialogTitle>{t(P.title, { ref: refNumber ?? '' })}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[68vh] space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          {!data && !error && (
            <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> {m.common.states.loading}</p>
          )}
          {error && <p className="text-sm text-red-700">{P.loadFailed}: {error}</p>}

          {data && (
            <>
              <p className="text-sm text-slate-600">{P.intro}</p>
              {!data.canPick && (
                <p className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                  {data.blocked ? P.blocked[data.blocked] : null}
                </p>
              )}
              {lockedWh !== undefined && (
                <p className="text-xs text-slate-500">{t(P.oneWarehouse, { wh: whLabel(lockedWh) })}</p>
              )}

              {data.lines.map((l) => {
                const st = lineState(l);
                const on = choosing(l);
                const pct = l.quantity > 0 ? Math.min(100, Math.round((st.sum / l.quantity) * 100)) : 0;
                return (
                  <section key={l.itemId} className="rounded-xl border border-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{l.productName ?? l.productCode}</p>
                        <p className="text-xs text-slate-500">{[l.productCode, l.partNumber].filter(Boolean).join(' · ')} · {t(P.need, { qty: fmt.number(l.quantity) })}</p>
                      </div>
                      <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-slate-200" role="radiogroup" aria-label={l.productName ?? l.productCode ?? ''}>
                        {(['fifo', 'choose'] as const).map((v) => {
                          const active = (mode[l.itemId] ?? 'fifo') === v;
                          return (
                            <button key={v} type="button" role="radio" aria-checked={active}
                              disabled={busy || (v === 'choose' && (!data.canPick || !l.options.length))}
                              onClick={() => setMode((x) => ({ ...x, [l.itemId]: v }))}
                              className={cn('px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                                active ? 'bg-green-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>
                              {v === 'fifo' ? P.fifo : P.choose}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {on && (
                      <div className="space-y-2 border-t border-slate-100 px-3 py-3 sm:px-4">
                        {l.options.length === 0 ? (
                          <p className="text-sm text-slate-500">{P.noOptions}</p>
                        ) : (
                          <>
                            <p className="text-xs text-slate-500">{P.tapHint}</p>
                            {(spots.get(l.itemId) ?? []).map((s) => {
                              const taken = sumOf(l, s.rows);
                              const selected = taken > EPS;
                              const otherWh = lockedWh !== undefined && s.warehouseId !== lockedWh && !selected;
                              const full = !selected && st.left <= EPS;
                              // A serial row is taken whole: a location whose rows are all bigger than what is still needed cannot be used.
                              const tooBig = !selected && !full && !s.rows.some((o) => !o.serialNumber || o.quantity <= st.left + EPS);
                              const disabled = busy || otherWh || full || tooBig;
                              const openKey = `${l.itemId}|${s.key}`;
                              const listOpen = !!open[openKey];
                              const where = s.place ? `${s.warehouseCode} · ${s.place}` : `${s.warehouseCode} · ${P.noLocation}`;
                              const detail = [
                                t(P.available, { qty: fmt.number(s.total) }),
                                t(P.received, { date: fmt.date(s.oldest) }),
                                s.rows.length === 1 && s.rows[0].serialNumber ? t(P.serial, { sn: s.rows[0].serialNumber })
                                  : s.serials ? t(P.serials, { n: s.serials }) : s.lots > 1 ? t(P.lots, { n: s.lots })
                                  : s.rows[0].batchNumber ? t(P.lot, { lot: s.rows[0].batchNumber }) : null,
                              ].filter(Boolean).join(' · ');
                              return (
                                <div key={s.key} className={cn('rounded-lg border transition-colors',
                                  selected ? 'border-green-500 bg-green-50/60 ring-1 ring-green-500' : 'border-slate-200 bg-white',
                                  (otherWh || full || tooBig) && 'opacity-50')}>
                                  <button type="button" disabled={disabled} aria-pressed={selected}
                                    onClick={() => setSpot(l, s, selected ? 0 : s.total)}
                                    className={cn('flex w-full items-start gap-3 px-3 py-2.5 text-left', disabled ? 'cursor-not-allowed' : 'hover:bg-slate-50/60')}>
                                    {selected
                                      ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" aria-hidden />
                                      : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" aria-hidden />}
                                    <span className="min-w-0 flex-1">
                                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <span className={cn('break-all font-medium', s.place ? 'text-slate-900' : 'text-slate-600')}>{where}</span>
                                        {s.fifo && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{P.fifoBadge}</span>}
                                      </span>
                                      <span className="mt-0.5 block text-xs text-slate-500">{detail}</span>
                                      {otherWh && <span className="mt-0.5 block text-[11px] text-slate-500">{P.otherWarehouse}</span>}
                                      {tooBig && !otherWh && <span className="mt-0.5 block text-[11px] text-slate-500">{P.serialTooBig}</span>}
                                    </span>
                                  </button>

                                  {(selected || s.rows.length > 1) && (
                                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 px-3 py-2">
                                      {selected ? (
                                        <div className="flex items-center gap-1.5">
                                          <span className="mr-1 text-xs text-slate-600">{P.take}</span>
                                          <button type="button" className={stepBtn} disabled={busy} aria-label={P.less}
                                            onClick={() => setSpot(l, s, taken - 1)}><Minus className="h-3.5 w-3.5" /></button>
                                          <input type="number" min={0} step="any" inputMode="decimal" value={taken}
                                            disabled={busy} aria-label={t(P.takeFrom, { where })}
                                            onChange={(e) => setSpot(l, s, Number(e.target.value) || 0)}
                                            className="h-8 w-16 rounded-md border border-slate-300 px-2 text-center text-sm tabular-nums focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500" />
                                          <button type="button" className={stepBtn} disabled={busy || st.left <= EPS || taken >= s.total - EPS} aria-label={P.more1}
                                            onClick={() => setSpot(l, s, taken + 1)}><Plus className="h-3.5 w-3.5" /></button>
                                          <span className="ml-1 text-xs text-slate-500">/ {fmt.number(s.total)}</span>
                                        </div>
                                      ) : <span />}
                                      {s.rows.length > 1 && (
                                        <button type="button" disabled={disabled && !selected} aria-expanded={listOpen}
                                          onClick={() => setOpen((x) => ({ ...x, [openKey]: !listOpen }))}
                                          className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:underline disabled:text-slate-300 disabled:no-underline">
                                          {listOpen ? P.hideRows : (s.serials ? P.chooseSerial : P.chooseLot)}
                                          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', listOpen && 'rotate-180')} />
                                        </button>
                                      )}
                                    </div>
                                  )}

                                  {listOpen && (
                                    <ul className="divide-y divide-slate-100 border-t border-slate-200/70 bg-white/70">
                                      {s.rows.map((o) => {
                                        const q = qty[key(l.itemId, o.stockItemId)] ?? 0;
                                        const rowOff = busy || otherWh || (q <= EPS && st.left <= EPS);
                                        return (
                                          <li key={o.stockItemId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                                            <span className="min-w-0 text-slate-700">
                                              <span className="font-medium">{o.serialNumber ?? o.batchNumber ?? P.noLot}</span>
                                              <span className="text-slate-500"> · {t(P.received, { date: fmt.date(o.receivedDate) })} · {t(P.available, { qty: fmt.number(o.quantity) })}</span>
                                            </span>
                                            {o.serialNumber ? (
                                              <label className={cn('inline-flex items-center gap-1.5', rowOff ? 'text-slate-300' : 'text-slate-700')}>
                                                <input type="checkbox" checked={q > EPS} disabled={rowOff}
                                                  onChange={(e) => setRow(l, o, e.target.checked ? o.quantity : 0)}
                                                  className="h-4 w-4 accent-green-600" />
                                                {P.takeThis}
                                              </label>
                                            ) : (
                                              <span className="flex items-center gap-1">
                                                <button type="button" className={cn(stepBtn, 'h-7 w-7')} disabled={busy || q <= EPS} aria-label={P.less}
                                                  onClick={() => setRow(l, o, q - 1)}><Minus className="h-3 w-3" /></button>
                                                <span className="w-10 text-center tabular-nums text-slate-900">{fmt.number(q)}</span>
                                                <button type="button" className={cn(stepBtn, 'h-7 w-7')} disabled={rowOff || q >= o.quantity - EPS} aria-label={P.more1}
                                                  onClick={() => setRow(l, o, q + 1)}><Plus className="h-3 w-3" /></button>
                                              </span>
                                            )}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                </div>
                              );
                            })}
                          </>
                        )}
                        {l.more && <p className="text-xs text-slate-500">{t(P.more, { n: l.options.length })}</p>}

                        <div className="pt-1">
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div className={cn('h-full rounded-full transition-all', st.ok ? 'bg-green-600' : 'bg-amber-400')} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className={cn('font-medium', st.ok ? 'text-green-700' : 'text-slate-700')}>
                              {t(P.chosen, { n: fmt.number(st.sum), qty: fmt.number(l.quantity) })}
                              {st.ok
                                ? <span className="ml-2">· {P.complete}</span>
                                : <span className="ml-2 text-amber-700">· {t(P.stillNeeded, { n: fmt.number(st.left) })}</span>}
                            </span>
                            {st.notFifo && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-amber-800">
                                <AlertTriangle className="h-3.5 w-3.5" /> {P.notFifo}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>{m.common.actions.cancel}</Button>
          <Button size="sm" className="bg-green-600 text-white hover:bg-green-700" disabled={!data || busy || !allOk} onClick={() => void approve()}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {busy ? P.approving : P.approve}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
