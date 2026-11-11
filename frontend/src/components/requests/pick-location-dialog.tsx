'use client';

// PR6: approve a request and choose which rack / slot each item is picked from.
// Lines left on FIFO behave exactly as a normal approval. Chosen rows are reserved
// at approval and the pick list later uses exactly those rows (checked by the API).

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { requestsApi, localizeError, type PickChoice, type PickOptions, type PickOption } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';

type Line = PickOptions['lines'][number];
const EPS = 1e-9;
const num = (v: string | undefined) => {
  const n = Number((v ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const where = (o: PickOption) => [o.warehouseCode, o.rackCode, o.slotCode].filter(Boolean).join(' · ') || '—';

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
  // `${itemId}|${stockItemId}` → typed quantity
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setData(null); setError(null); setMode({}); setQty({}); setBusy(false);
    if (!requestId) return;
    let live = true;
    requestsApi.pickOptions(requestId)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(localizeError(e)); });
    return () => { live = false; };
  }, [requestId]);

  const key = (itemId: string, stockItemId: string) => `${itemId}|${stockItemId}`;
  const choosing = (l: Line) => mode[l.itemId] === 'choose';

  // Chosen rows per line, and the one warehouse they come from (Q2).
  const picks = useMemo(() => {
    const out: Array<PickChoice & { warehouseId: string | null }> = [];
    for (const l of data?.lines ?? []) {
      if (!choosing(l)) continue;
      for (const o of l.options) {
        const q = num(qty[key(l.itemId, o.stockItemId)]);
        if (q > 0) out.push({ itemId: l.itemId, stockItemId: o.stockItemId, qty: q, warehouseId: o.warehouseId });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mode, qty]);
  const lockedWh = picks.length ? picks[0].warehouseId : undefined;
  const whLabel = (id: string | null | undefined) => {
    for (const l of data?.lines ?? []) {
      const o = l.options.find((x) => x.warehouseId === id);
      if (o) return o.warehouseCode ?? o.warehouseName ?? '—';
    }
    return '—';
  };

  const lineState = (l: Line) => {
    const mine = picks.filter((p) => p.itemId === l.itemId);
    const sum = mine.reduce((s, p) => s + p.qty, 0);
    const rowErr = l.options.some((o) => {
      const q = num(qty[key(l.itemId, o.stockItemId)]);
      return q > o.quantity + EPS || (o.serialNumber && q > 0 && Math.abs(q - o.quantity) > EPS);
    });
    const fifo = fifoPlan(l);
    const notFifo = mine.length > 0 && (mine.length !== fifo.size || mine.some((p) => !fifo.has(p.stockItemId)));
    return { sum, ok: Math.abs(sum - l.quantity) <= EPS && !rowErr, rowErr, notFifo };
  };
  const allOk = (data?.lines ?? []).every((l) => !choosing(l) || lineState(l).ok);

  const fill = (l: Line, o: PickOption) => {
    const left = l.quantity - lineState(l).sum + num(qty[key(l.itemId, o.stockItemId)]);
    const take = o.serialNumber ? (left >= o.quantity - EPS ? o.quantity : 0) : Math.min(o.quantity, Math.max(0, left));
    setQty((q) => ({ ...q, [key(l.itemId, o.stockItemId)]: take ? String(Number(take.toFixed(6))) : '' }));
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

  return (
    <Dialog open={!!requestId} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-3xl p-0">
        <DialogHeader className="border-b border-slate-200 px-5 py-3">
          <DialogTitle>{t(P.title, { ref: refNumber ?? '' })}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[68vh] space-y-4 overflow-y-auto px-5 py-4">
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
                      <div className="border-t border-slate-100">
                        {l.options.length === 0 ? (
                          <p className="px-4 py-3 text-sm text-slate-500">{P.noOptions}</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead><tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                                <th className="px-4 py-2 font-medium">{P.col.location}</th>
                                <th className="px-3 py-2 font-medium">{P.col.lot}</th>
                                <th className="px-3 py-2 font-medium">{P.col.received}</th>
                                <th className="px-3 py-2 text-right font-medium">{P.col.available}</th>
                                <th className="px-4 py-2 text-right font-medium">{P.col.take}</th>
                              </tr></thead>
                              <tbody className="divide-y divide-slate-100">
                                {l.options.map((o) => {
                                  const k = key(l.itemId, o.stockItemId);
                                  const q = num(qty[k]);
                                  const otherWh = lockedWh !== undefined && o.warehouseId !== lockedWh && q === 0;
                                  const tooMuch = q > o.quantity + EPS;
                                  const serialBad = !!o.serialNumber && q > 0 && Math.abs(q - o.quantity) > EPS;
                                  return (
                                    <tr key={o.stockItemId} className={cn(q > 0 && 'bg-green-50/50', otherWh && 'opacity-50')}>
                                      <td className="px-4 py-2.5">
                                        <span className="font-medium text-slate-800">{where(o)}</span>
                                        {o.stockItemId === l.fifoStockItemId && (
                                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{P.fifoBadge}</span>
                                        )}
                                        {otherWh && <span className="block text-[11px] text-slate-500">{P.otherWarehouse}</span>}
                                      </td>
                                      <td className="px-3 py-2.5 text-xs text-slate-600">{o.serialNumber ?? o.batchNumber ?? '—'}</td>
                                      <td className="px-3 py-2.5 text-xs text-slate-600 whitespace-nowrap">{fmt.date(o.receivedDate)}</td>
                                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{fmt.number(o.quantity)}</td>
                                      <td className="px-4 py-2.5">
                                        <div className="flex items-center justify-end gap-1.5">
                                          <input type="number" min={0} step="any" inputMode="decimal" value={qty[k] ?? ''}
                                            disabled={busy || otherWh}
                                            aria-label={t(P.takeFrom, { where: where(o) })}
                                            aria-invalid={tooMuch || serialBad}
                                            onChange={(e) => setQty((x) => ({ ...x, [k]: e.target.value }))}
                                            className={cn('h-8 w-20 rounded-md border px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-1',
                                              tooMuch || serialBad ? 'border-red-400 focus:ring-red-400' : 'border-slate-300 focus:border-green-500 focus:ring-green-500')} />
                                          <button type="button" disabled={busy || otherWh} onClick={() => fill(l, o)}
                                            className="text-xs font-medium text-green-700 hover:underline disabled:text-slate-300 disabled:no-underline">{P.use}</button>
                                        </div>
                                        {(tooMuch || serialBad) && (
                                          <p className="mt-0.5 text-right text-[11px] text-red-700">{serialBad ? P.serialWhole : P.tooMuch}</p>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {l.more && <p className="px-4 py-2 text-xs text-slate-500">{t(P.more, { n: l.options.length })}</p>}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs">
                          <span className={cn('font-medium', st.ok ? 'text-green-700' : 'text-slate-700')}>
                            {t(P.chosen, { n: fmt.number(st.sum), qty: fmt.number(l.quantity) })}
                            {!st.ok && !st.rowErr && <span className="ml-2 font-normal text-slate-500">· {t(P.mustCover, { qty: fmt.number(l.quantity) })}</span>}
                          </span>
                          {st.notFifo && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-amber-800">
                              <AlertTriangle className="h-3.5 w-3.5" /> {P.notFifo}
                            </span>
                          )}
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
