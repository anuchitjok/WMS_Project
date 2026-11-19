'use client';

// PR7 Location Relocation Request. Flow: PENDING_APPROVAL → APPROVED → COMPLETED.
// Stock moves only when someone confirms the goods were moved (complete). The API
// enforces permissions; the role lists here only decide which buttons to show.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowRight, ArrowRightLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { relocationApi, warehouseMasterApi, type RelocationDestination, type RelocationProduct } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuthStore } from '@/store/auth.store';
import { cn, formatDate } from '@/lib/utils';
import { labelOf, useT } from '@/i18n';

const STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED'] as const;
const OPEN = ['PENDING_APPROVAL', 'APPROVED'];
const OPERATORS = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'WAREHOUSE_STAFF'];
const SUPERVISORS = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR'];

const STATUS_COLOR: Record<string, string> = {
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-green-100 text-green-700',
  COMPLETED: 'bg-slate-100 text-slate-600',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-400',
};

const slotLabel = (s: any) => (s ? `${s.code}` : '—');
const fmtQty = (q: number) => Number(q).toLocaleString(undefined, { maximumFractionDigits: 3 });

export default function RelocationPage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-96 rounded-xl" /></div>}>
      <RelocationInner />
    </Suspense>
  );
}

function RelocationInner() {
  const { m, t } = useT();
  const R = m.relocation;
  const user = useAuthStore((s) => s.user);
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [openId, setOpenId] = useState<string | null>(null);
  const [create, setCreate] = useState<{ warehouseId?: string; slotId?: string } | null>(null);
  const canRequest = !!user && OPERATORS.includes(user.role);

  const load = useCallback(async () => {
    setState('loading');
    try { setRows((await relocationApi.list({ status: status || undefined, limit: 100 })).data); setState('ready'); }
    catch { setState('error'); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  // Opened from 3D Location Details: /relocation?new=1&warehouseId=…&slotId=…
  useEffect(() => {
    if (params.get('new') === '1' && canRequest) {
      setCreate({ warehouseId: params.get('warehouseId') ?? undefined, slotId: params.get('slotId') ?? undefined });
      router.replace('/relocation');
    }
  }, [params, canRequest, router]);

  return (
    <div className="p-6 space-y-5">
      <PageHeader title={R.title} subtitle={R.subtitle} icon={ArrowRightLeft}
        action={canRequest && (
          <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setCreate({})}>
            <Plus className="w-4 h-4 mr-1" /> {R.newRequest}
          </Button>
        )} />

      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 w-fit" role="tablist">
        {['', ...STATUSES].map((s) => (
          <button key={s || 'all'} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
            className={cn('rounded-md px-3 py-1.5 text-xs transition-colors',
              status === s ? 'bg-white font-semibold text-green-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            {s ? labelOf(m.status.relocation, s) : R.all}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">{R.col.ref}</th>
              <th className="px-4 py-3">{R.col.warehouse}</th>
              <th className="px-4 py-3">{R.col.items}</th>
              <th className="px-4 py-3">{R.col.route}</th>
              <th className="px-4 py-3">{R.col.status}</th>
              <th className="px-4 py-3">{R.col.requestedBy}</th>
              <th className="px-4 py-3">{R.col.created}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {state === 'loading' ? (
              <tr><td colSpan={7} className="p-4"><Skeleton className="h-24" /></td></tr>
            ) : state === 'error' ? (
              <tr><td colSpan={7} className="p-6 text-center text-sm text-red-600">
                {R.loadError} <Button size="sm" variant="outline" className="ml-2 h-7" onClick={load}>{R.retry}</Button>
              </td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-sm text-slate-500">{R.empty}</td></tr>
            ) : rows.map((r) => {
              const first = r.lines[0];
              return (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(r.id)}>
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-blue-700 whitespace-nowrap">{r.refNumber}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{r.warehouse?.code}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="font-mono text-xs">{first?.product?.code}</span> <span className="text-slate-600">× {fmtQty(first?.quantity ?? 0)}</span>
                    {r.lines.length > 1 && <span className="ml-1 text-xs text-slate-400">{t(R.moreLines, { n: r.lines.length - 1 })}</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                    {slotLabel(first?.fromSlot)} <ArrowRight className="inline h-3 w-3 text-slate-400" /> {slotLabel(first?.toSlot)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_COLOR[r.status])}>{labelOf(m.status.relocation, r.status)}</span>
                    <p className="mt-1 text-[11px] text-slate-400">{(R.stockNote as Record<string, string>)[r.status]}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.requestedBy?.fullName}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {create && <CreateDialog initial={create} onClose={() => setCreate(null)} onDone={() => { setCreate(null); load(); }} />}
      {openId && <DetailDialog id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

// ─── Create ──────────────────────────────────────────────────────────────────

type DraftLine = { row: any; fromSlot: any; toSlot: any; quantity: number };

function CreateDialog({ initial, onClose, onDone }: { initial: { warehouseId?: string; slotId?: string }; onClose: () => void; onDone: () => void }) {
  const { m, t } = useT();
  const F = m.relocation.form;
  const [tree, setTree] = useState<any[] | null>(null);
  const [whId, setWhId] = useState(initial.warehouseId ?? '');
  // Requirement 32 steps 1 and 2 start from the part number. The slot way in
  // stays for the 3D screen, which opens this dialog on a location it is
  // already showing, and for anyone who thinks in shelves rather than codes.
  const [by, setBy] = useState<'product' | 'slot'>(initial.slotId ? 'slot' : 'product');
  const [fromId, setFromId] = useState(initial.slotId ?? '');
  const [fromFilter, setFromFilter] = useState('');
  const [pnQuery, setPnQuery] = useState('');
  const [pnId, setPnId] = useState('');
  const [pns, setPns] = useState<{ state: 'loading' | 'ready' | 'error'; rows: RelocationProduct[] }>(
    { state: 'loading', rows: [] },
  );
  const [movable, setMovable] = useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; rows: any[] }>({ state: 'idle', rows: [] });
  const [rowId, setRowId] = useState('');
  const [qty, setQty] = useState('');
  const [toId, setToId] = useState('');
  const [toFilter, setToFilter] = useState('');
  // Requirement 32 — the destinations the server says can take the chosen row.
  const [dest, setDest] = useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; slots: RelocationDestination[]; hidden: number }>(
    { state: 'idle', slots: [], hidden: 0 },
  );
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { warehouseMasterApi.tree().then(setTree).catch((e) => { toast.error(e.message); setTree([]); }); }, []);

  // The search runs on the server, so a warehouse with thousands of codes still
  // answers; a short wait keeps it to one call per thought, not per keystroke.
  useEffect(() => {
    if (!whId || by !== 'product') return;
    let live = true;
    setPns((p) => ({ state: 'loading', rows: p.rows }));
    const id = setTimeout(() => {
      relocationApi.products(whId, pnQuery.trim() || undefined)
        .then((rows) => live && setPns({ state: 'ready', rows }))
        .catch((e) => { if (live) { setPns({ state: 'error', rows: [] }); toast.error(e.message); } });
    }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [whId, by, pnQuery]);

  const wh = tree?.find((w) => w.id === whId);
  const slots: any[] = useMemo(() => (wh?.racks ?? []).flatMap((r: any) => (r.slots ?? []).map((s: any) => ({ ...s, rackCode: r.code }))), [wh]);
  const slotById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);
  const match = (s: { code: string }, q: string) => !q || s.code.toLowerCase().includes(q.trim().toLowerCase());
  const fromSlots = slots.filter((s) => (s._count?.stockItems ?? 0) > 0 && (match(s, fromFilter) || s.id === fromId)).slice(0, 300);
  const row = movable.rows.find((r) => r.id === rowId);

  /**
   * Requirement 32 steps 3 and 4. The server's figures are what is on hand plus
   * what other open requests have promised; the lines already in THIS draft are
   * only here in the browser, so they are taken off here. `max` is the most this
   * row may send to that slot, and a slot with nothing left is not offered.
   */
  const roomOf = (s: RelocationDestination) => {
    const draft = lines.filter((l) => l.toSlot.id === s.slotId);
    const places = draft.length;
    const pieces = draft.reduce((a, l) => a + l.quantity, 0);
    const placesLeft = s.placesFree === null ? null : s.placesFree - places;
    const piecesLeft = s.piecesFree === null ? null : s.piecesFree - pieces;
    const rowQty = row?.quantity ?? 0;
    return {
      placesLeft,
      piecesLeft,
      // Out of PLACES only warns (the figure is not maintained — see the API's
      // slot-space.ts); out of PIECES is what takes a destination off the list.
      atLimit: placesLeft !== null && placesLeft <= 0,
      fits: piecesLeft === null || piecesLeft > 0,
      max: piecesLeft === null ? rowQty : Math.min(rowQty, piecesLeft),
    };
  };
  const options = useMemo(() => dest.slots
    .filter((s) => match(s, toFilter) || s.slotId === toId)
    .map((s) => ({ s, ...roomOf(s) }))
    // A serial row moves whole, so a slot that cannot take all of it is no use.
    .filter((o) => o.fits && o.max > 0 && (!row?.serialNumber || o.max >= row.quantity))
    .slice(0, 300),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dest.slots, toFilter, toId, lines, row]);
  const chosen = options.find((o) => o.s.slotId === toId);
  // Full after the draft lines, or filtered away — both are "not offered here".
  const hidden = dest.hidden + Math.max(0, dest.slots.length - options.length);

  const source = by === 'product' ? pnId : fromId;
  useEffect(() => {
    setRowId(''); setQty('');
    if (!whId || !source) { setMovable({ state: 'idle', rows: [] }); return; }
    let live = true;
    setMovable({ state: 'loading', rows: [] });
    relocationApi.movable(whId, by === 'product' ? { productId: source } : { slotId: source })
      .then((rows) => live && setMovable({ state: 'ready', rows }))
      .catch((e) => { if (live) { setMovable({ state: 'error', rows: [] }); toast.error(e.message); } });
    return () => { live = false; };
  }, [whId, by, source]);

  // The room a slot has depends on the row (its quantity), so this follows the row.
  useEffect(() => {
    setToId('');
    if (!whId || !rowId) { setDest({ state: 'idle', slots: [], hidden: 0 }); return; }
    let live = true;
    setDest({ state: 'loading', slots: [], hidden: 0 });
    relocationApi.destinations(whId, rowId)
      .then((d) => live && setDest({ state: 'ready', slots: d.slots, hidden: d.hidden }))
      .catch((e) => { if (live) { setDest({ state: 'error', slots: [], hidden: 0 }); toast.error(e.message); } });
    return () => { live = false; };
  }, [whId, rowId]);

  function changeWarehouse(id: string) {
    if (lines.length && id !== whId) toast.info(F.warehouseChange);
    setWhId(id); setFromId(''); setPnId(''); setToId(''); setLines([]); setDest({ state: 'idle', slots: [], hidden: 0 });
  }

  function addLine() {
    const q = Number(qty);
    if (!row || !chosen || !qty) { toast.error(F.pickAll); return; }
    if (!(q > 0) || q > row.quantity) { toast.error(t(F.qtyRange, { max: fmtQty(row.quantity) })); return; }
    if (row.serialNumber && q !== row.quantity) { toast.error(t(F.serialWhole, { max: fmtQty(row.quantity) })); return; }
    // Requirement 32 step 4 — never more than the destination can take.
    if (q > chosen.max) { toast.error(t(F.qtyOverDest, { max: fmtQty(chosen.max) })); return; }
    // In part-number mode the rows come from several slots, so the line takes
    // the one its own row is standing in, not the one picked at the top.
    const from = row.slot ?? slotById.get(fromId);
    if (chosen.s.slotId === from?.id) { toast.error(F.sameSlot); return; }
    if (lines.some((l) => l.row.id === row.id)) { toast.error(F.duplicate); return; }
    setLines([...lines, { row, fromSlot: from, toSlot: { id: chosen.s.slotId, code: chosen.s.code }, quantity: q }]);
    setRowId(''); setQty(''); setToId('');
  }

  async function submit() {
    if (!lines.length) { toast.error(F.pickAll); return; }
    setBusy(true);
    try {
      const r = await relocationApi.create({
        warehouseId: whId, reason: reason.trim() || undefined,
        lines: lines.map((l) => ({ stockItemId: l.row.id, toSlotId: l.toSlot.id, quantity: l.quantity })),
      });
      toast.success(t(m.relocation.toast.created, { ref: r.refNumber }));
      onDone();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  const sel = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white';
  const lbl = 'text-xs font-medium text-slate-600 block mb-1';

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-full sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="text-lg font-semibold">{F.title}</DialogTitle>
          <p className="text-xs text-slate-500">{F.intro}</p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className={lbl} htmlFor="rl-wh">{F.warehouse}</label>
            <select id="rl-wh" className={sel} value={whId} onChange={(e) => changeWarehouse(e.target.value)} disabled={!tree}>
              <option value="">{tree ? F.select : F.loadingRows}</option>
              {(tree ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>

          {wh && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                {/* Requirement 32 step 1: the part number comes first. */}
                <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
                  {(['product', 'slot'] as const).map((k) => (
                    <button key={k} type="button" role="tab" aria-selected={by === k}
                      onClick={() => { setBy(k); setRowId(''); setQty(''); setToId(''); }}
                      className={cn('flex-1 rounded-md px-2 py-1 text-xs transition-colors',
                        by === k ? 'bg-white font-semibold text-green-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                      {k === 'product' ? F.byProduct : F.bySlot}
                    </button>
                  ))}
                </div>

                {by === 'product' ? (
                  <>
                    <label className={lbl} htmlFor="rl-pn">{F.product}</label>
                    <Input id="rl-pn-q" placeholder={F.filterProducts} value={pnQuery}
                      onChange={(e) => setPnQuery(e.target.value)} aria-label={F.filterProducts} />
                    <select id="rl-pn" className={sel} value={pnId} onChange={(e) => setPnId(e.target.value)}>
                      <option value="">{pns.state === 'loading' ? F.loadingRows : F.select}</option>
                      {pns.rows.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.code} — {x.name} · {t(F.pnStock, { qty: fmtQty(x.quantity), unit: x.unit ?? '', slots: x.slots })}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-400">
                      {pns.state === 'ready' && pns.rows.length === 0 ? F.noProducts : F.productHint}
                    </p>
                  </>
                ) : (
                  <>
                    <label className={lbl} htmlFor="rl-from">{F.fromSlot}</label>
                    <Input placeholder={F.filterSlots} value={fromFilter} onChange={(e) => setFromFilter(e.target.value)} aria-label={F.filterSlots} />
                    <select id="rl-from" className={sel} value={fromId} onChange={(e) => setFromId(e.target.value)}>
                      <option value="">{F.select}</option>
                      {fromSlots.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
                    </select>
                    <p className="text-[11px] text-slate-400">{F.fromSlotHint}</p>
                  </>
                )}

                <p className={lbl}>{by === 'product' ? F.whereItIs : F.rows}</p>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {movable.state === 'idle' ? <p className="p-3 text-xs text-slate-400">{by === 'product' ? F.pickProductFirst : '—'}</p>
                    : movable.state === 'loading' ? <p className="flex items-center gap-2 p-3 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {F.loadingRows}</p>
                    : movable.rows.length === 0 ? <p className="p-3 text-xs text-slate-500">{F.noRows}</p>
                    : movable.rows.map((r) => {
                      const held = r.openRelocation || r.countRef || lines.some((l) => l.row.id === r.id);
                      return (
                        <label key={r.id} className={cn('flex items-start gap-2 px-3 py-2 text-xs', held ? 'opacity-60' : 'cursor-pointer hover:bg-slate-50', rowId === r.id && 'bg-green-50')}>
                          <input type="radio" name="rl-row" className="mt-0.5" disabled={!!held} checked={rowId === r.id}
                            onChange={() => { setRowId(r.id); setQty(String(r.quantity)); }} />
                          <span className="min-w-0 flex-1">
                            {by === 'product' && r.slot ? (
                              // Step 2 — where this stock is standing right now.
                              <span className="font-mono font-semibold">{r.slot.rack?.code ? `${r.slot.rack.code} · ` : ''}{r.slot.code}</span>
                            ) : (
                              <><span className="font-mono font-semibold">{r.product?.code}</span> <span className="text-slate-600">{r.product?.name}</span></>
                            )}
                            <span className="block text-slate-500">{fmtQty(r.quantity)} {r.product?.unit} · {labelOf(m.status.stock, r.status)}{r.batchNumber ? ` · ${r.batchNumber}` : ''}</span>
                            {r.serialNumber && <span className="block text-slate-400">{t(F.serial, { sn: r.serialNumber })}</span>}
                            {r.openRelocation && <span className="block text-amber-700">{t(F.heldBy, { ref: r.openRelocation })}</span>}
                            {r.countRef && <span className="block text-amber-700">{t(F.counted, { ref: r.countRef })}</span>}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>

              <div className="space-y-2">
                {/* Requirement 32: the destination is chosen first, because it decides
                    how much may go — and only places with room are offered. */}
                <label className={lbl} htmlFor="rl-to">{F.toSlot}</label>
                <Input placeholder={F.filterSlots} value={toFilter} onChange={(e) => setToFilter(e.target.value)} aria-label={F.filterSlots} />
                <select id="rl-to" className={sel} value={toId} disabled={dest.state !== 'ready' || options.length === 0}
                  onChange={(e) => {
                    setToId(e.target.value);
                    // Never leave a quantity standing that this place cannot take.
                    const o = options.find((x) => x.s.slotId === e.target.value);
                    if (o && Number(qty) > o.max) setQty(String(o.max));
                  }}>
                  <option value="">{F.select}</option>
                  {options.map((o) => (
                    <option key={o.s.slotId} value={o.s.slotId}>
                      {o.s.code} · {o.placesLeft === null ? F.slotPlacesOpen
                        : o.atLimit ? F.slotPlacesFull
                        : t(F.slotPlaces, { free: fmtQty(o.placesLeft), capacity: fmtQty(o.s.capacity) })}
                      {' · '}{o.piecesLeft === null ? F.slotPiecesOpen : t(F.slotPieces, { n: fmtQty(o.piecesLeft) })}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400">
                  {!row ? F.destPickRow
                    : dest.state === 'loading' ? F.destLoading
                    : dest.state === 'ready' && options.length === 0 ? F.destNone
                    : F.toSlotHint}
                  {dest.state === 'ready' && hidden > 0 && ` · ${t(F.destHidden, { n: hidden })}`}
                </p>

                <label className={lbl} htmlFor="rl-qty">{F.qty}</label>
                <Input id="rl-qty" type="number" min={0} max={chosen?.max} step="any" value={qty} disabled={!row || !!row?.serialNumber}
                  onChange={(e) => setQty(e.target.value)} />
                {chosen && (
                  <p className="text-[11px] font-medium text-slate-600">
                    {t(F.maxHere, { n: fmtQty(chosen.max) })} {row?.product?.unit ?? ''}
                  </p>
                )}
                {chosen?.atLimit && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {F.placeLimitNote}
                  </p>
                )}
                <Button type="button" variant="outline" className="w-full" onClick={addLine} disabled={!row || !chosen}>
                  <Plus className="mr-1 h-4 w-4" /> {F.addLine}
                </Button>
              </div>
            </div>
          )}

          <div>
            <p className={lbl}>{t(F.lines, { n: lines.length })}</p>
            {lines.length === 0 ? <p className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400">{F.noLines}</p> : (
              <ul className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                {lines.map((l, i) => (
                  <li key={l.row.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span className="min-w-0 flex-1">
                      <span className="font-mono font-semibold">{l.row.product?.code}</span> × {fmtQty(l.quantity)} {l.row.product?.unit}
                      <span className="block font-mono text-slate-500">{slotLabel(l.fromSlot)} <ArrowRight className="inline h-3 w-3" /> {slotLabel(l.toSlot)}</span>
                    </span>
                    <button type="button" aria-label={F.remove} title={F.remove} onClick={() => setLines(lines.filter((_, j) => j !== i))}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className={lbl} htmlFor="rl-reason">{F.reason}</label>
            <Input id="rl-reason" placeholder={F.reasonPlaceholder} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-3 shrink-0">
          <Button variant="outline" onClick={onClose}>{F.cancel}</Button>
          <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={submit} disabled={busy || !lines.length}>
            {busy ? F.submitting : F.submit}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Detail ──────────────────────────────────────────────────────────────────

function DetailDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { m, t } = useT();
  const R = m.relocation;
  const D = R.detail;
  const A = R.act;
  const user = useAuthStore((s) => s.user);
  const [r, setR] = useState<any | null>(null);
  const [mode, setMode] = useState<'view' | 'reject' | 'complete'>('view');
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => relocationApi.get(id).then(setR).catch((e) => { toast.error(e.message); onClose(); }), [id, onClose]);
  useEffect(() => { load(); }, [load]);

  const role = user?.role ?? '';
  const mine = r?.requestedById === user?.id;
  const isOpen = r && OPEN.includes(r.status);
  const canDecide = r?.status === 'PENDING_APPROVAL' && SUPERVISORS.includes(role) && !mine;
  const canComplete = r?.status === 'APPROVED' && OPERATORS.includes(role);
  const canCancel = isOpen && (mine || SUPERVISORS.includes(role));

  async function run(action: 'approve' | 'reject' | 'cancel' | 'complete') {
    setBusy(true);
    try {
      const out = action === 'reject' ? await relocationApi.reject(id, rejectReason.trim()) : await relocationApi[action](id);
      const key = ({ approve: 'approved', reject: 'rejected', cancel: 'cancelled', complete: 'completed' } as const)[action];
      toast.success(t(R.toast[key], { ref: out.refNumber }));
      setMode('view'); setRejectReason('');
      onChanged();
      await load();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  /** "2 places · 40 pcs", or just "No limit" where nobody entered a figure. */
  const room = (places: number | null, pieces: number | null) => {
    if (places === null && pieces === null) return D.noLimit;
    return [
      places === null ? null : t(D.placesShort, { n: fmtQty(places) }),
      pieces === null ? null : t(D.piecesShort, { n: fmtQty(pieces) }),
    ].filter(Boolean).join(' · ');
  };

  const warnText = (w: any) => w.kind === 'OVER_CAPACITY' ? t(R.warn.OVER_CAPACITY, { slot: w.slotCode, rows: w.rows, capacity: w.capacity })
    : w.kind === 'OVER_QUANTITY' ? t(R.warn.OVER_QUANTITY, { slot: w.slotCode, pieces: fmtQty(w.pieces), maxQuantity: fmtQty(w.maxQuantity) })
    : w.kind === 'SLOT_MARKED' ? t(R.warn.SLOT_MARKED, { slot: w.slotCode, status: labelOf(m.warehouseMaster.slotStatus, w.status) })
    : t(R.warn.COUNT_LOCKED, { ref: w.countRef });

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-full sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            <span className="font-mono">{r?.refNumber ?? '…'}</span>
            {r && <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_COLOR[r.status])}>{labelOf(m.status.relocation, r.status)}</span>}
          </DialogTitle>
          {r && <p className="text-xs text-slate-500">{r.warehouse?.code} · {(R.stockNote as Record<string, string>)[r.status]}</p>}
        </DialogHeader>

        {!r ? <div className="p-6"><Skeleton className="h-40" /></div> : (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-slate-500">{D.requestedBy}</dt><dd>{r.requestedBy?.fullName} · <span className="text-xs text-slate-500">{formatDate(r.createdAt)}</span></dd>
              {r.approvedBy && <><dt className="text-slate-500">{D.approvedBy}</dt><dd>{r.approvedBy.fullName} · <span className="text-xs text-slate-500">{formatDate(r.approvedAt)}</span></dd></>}
              {r.completedBy && <><dt className="text-slate-500">{D.completedBy}</dt><dd>{r.completedBy.fullName} · <span className="text-xs text-slate-500">{formatDate(r.completedAt)}</span></dd></>}
              {r.reason && <><dt className="text-slate-500">{D.reason}</dt><dd>{r.reason}</dd></>}
              {r.rejectReason && <><dt className="text-slate-500">{D.rejectReason}</dt><dd className="text-red-700">{r.rejectReason}</dd></>}
            </dl>

            {r.warnings?.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <p className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> {R.warn.title}</p>
                <ul className="list-disc space-y-0.5 pl-5">{r.warnings.map((w: any, i: number) => <li key={i}>{warnText(w)}</li>)}</ul>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-left uppercase text-slate-500">
                  <tr><th className="px-3 py-2">{D.product}</th><th className="px-3 py-2 text-right">{D.qty}</th><th className="px-3 py-2">{D.from}</th><th className="px-3 py-2">{D.to}</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {r.lines.map((l: any) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2"><span className="font-mono font-semibold">{l.product?.code}</span> <span className="text-slate-600">{l.product?.name}</span>
                        {l.stockItem?.serialNumber && <span className="block text-slate-400">SN {l.stockItem.serialNumber}</span>}
                        {OPEN.includes(r.status) && l.stockItem?.slotId !== l.fromSlotId && <span className="block text-red-600">{D.notInSource}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtQty(l.quantity)} {l.product?.unit}</td>
                      <td className="px-3 py-2 font-mono">{slotLabel(l.fromSlot)}</td>
                      <td className="px-3 py-2 font-mono">{slotLabel(l.toSlot)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Requirement 32 step 5 — the room each destination has, and what is
                left of it once this request is carried out. */}
            {r.destinations?.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-600">{D.destTitle}</p>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-left uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">{D.destSlot}</th>
                        <th className="px-3 py-2 text-right">{D.destAvailable}</th>
                        <th className="px-3 py-2 text-right">{D.destIncoming}</th>
                        <th className="px-3 py-2 text-right">{D.destRemaining}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {r.destinations.map((d: any) => {
                        const tight = (d.placesLeft !== null && d.placesLeft < 0) || (d.piecesLeft !== null && d.piecesLeft < 0);
                        return (
                          <tr key={d.slotId}>
                            <td className="px-3 py-2 font-mono">{d.slotCode}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{room(d.placesFree, d.piecesFree)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{room(d.incomingPlaces, d.incomingPieces)}</td>
                            <td className={cn('px-3 py-2 text-right tabular-nums', tight && 'font-semibold text-amber-700')}>
                              {room(d.placesLeft, d.piecesLeft)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {r.status === 'PENDING_APPROVAL' && mine && SUPERVISORS.includes(role) && <p className="text-xs text-slate-500">{A.ownRequest}</p>}

            {mode === 'reject' && (
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1" htmlFor="rl-rej">{A.rejectReason}</label>
                <Input id="rl-rej" autoFocus placeholder={A.rejectPlaceholder} value={rejectReason} maxLength={500} onChange={(e) => setRejectReason(e.target.value)} />
              </div>
            )}
            {mode === 'complete' && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-900">
                <p className="font-semibold">{A.confirmTitle}</p>
                <p className="mt-1">{t(A.confirmBody, { n: r.lines.length })}</p>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t px-6 py-3 shrink-0">
          {mode !== 'view' ? (
            <>
              <Button variant="outline" onClick={() => setMode('view')} disabled={busy}>{A.back}</Button>
              {mode === 'reject'
                ? <Button className="bg-red-600 hover:bg-red-700 text-white" disabled={busy || !rejectReason.trim()} onClick={() => run('reject')}>{busy ? A.working : A.reject}</Button>
                : <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={busy} onClick={() => run('complete')}>{busy ? A.working : A.complete}</Button>}
            </>
          ) : (
            <>
              {canCancel && <Button variant="outline" disabled={busy} onClick={() => run('cancel')}>{A.cancel}</Button>}
              {canDecide && <Button variant="outline" className="text-red-700" disabled={busy} onClick={() => setMode('reject')}>{A.reject}</Button>}
              {canDecide && <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={busy} onClick={() => run('approve')}>{busy ? A.working : A.approve}</Button>}
              {canComplete && <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={busy} onClick={() => setMode('complete')}>{A.complete}</Button>}
              <Button variant="outline" onClick={onClose}>{D.close}</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
