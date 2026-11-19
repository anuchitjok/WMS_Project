'use client';

// RQ17 / RQ18 — Boxes.
//
// A box is a place that moves: it stands in a slot and holds stock, and moving
// it takes the stock with it. This screen is the floor's view of that — make a
// box, pack it, move it, split it, print its sticker.
//
// Everything that changes stock happens through the API, which writes the box
// and the stock in one transaction; nothing here works out a location itself.
// Anything that moves stock between boxes (take out, split, merge) asks first
// and names the rows it will touch, so nobody loses a pallet to a stray click.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Box, Plus, RefreshCw, Printer, Lock, LockOpen, Trash2, Split, Merge, MoveRight, Search, PackagePlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { inventoryApi, warehouseApi, localizeError } from '@/lib/api';
import { containersApi, type ContainerDetail, type ContainerRow, type ContainerStatus, type ContainerType } from '@/lib/api-containers';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

const SELECT_CLS = 'h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm disabled:bg-slate-50 disabled:text-slate-400';
const TYPES: ContainerType[] = ['BOX', 'CARTON', 'CRATE', 'TOTE', 'PALLET'];
/** Stock that has left the building cannot be packed — the API refuses it too. */
const GONE = ['SHIPPED', 'CLOSED', 'CANCELLED', 'CONSUMED'];

const placeOf = (c: { warehouse?: { code: string } | null; rack?: { code: string } | null; slot?: { code: string } | null }) =>
  [c.warehouse?.code, c.rack?.code, c.slot?.code].filter(Boolean).join(' › ');

/** A stock row as the floor reads it: what it is, how much, and which lot. */
function StockLine({ s, labels }: { s: any; labels: { lot: string; serial: string } }) {
  return (
    <>
      <span className="font-mono font-medium text-slate-800">{s.product?.code}</span>
      <span className="min-w-0 flex-1 truncate text-slate-500">{s.product?.name}</span>
      <span className="whitespace-nowrap tabular-nums text-slate-700">
        {s.quantity} {s.product?.unit ?? ''}
      </span>
      {s.batchNumber && <span className="whitespace-nowrap text-slate-400">{labels.lot} {s.batchNumber}</span>}
      {s.serialNumber && <span className="whitespace-nowrap font-mono text-slate-400">{labels.serial} {s.serialNumber}</span>}
    </>
  );
}

export default function ContainersPage() {
  const { m, t } = useT();
  const C = m.containers;

  const [rows, setRows] = useState<ContainerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [whFilter, setWhFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | ContainerType>('');
  const [statusFilter, setStatusFilter] = useState<'' | ContainerStatus>('');
  const [open, setOpen] = useState<ContainerDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await containersApi.list({ warehouseId: whFilter || undefined, search: search.trim() || undefined }));
    } catch (e: unknown) { toast.error(localizeError(e)); } finally { setLoading(false); }
  }, [whFilter, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { warehouseApi.list().then(setWarehouses).catch(() => setWarehouses([])); }, []);

  const reopen = useCallback(async (id: string) => {
    try { setOpen(await containersApi.get(id)); } catch (e: unknown) { toast.error(localizeError(e)); }
  }, []);

  // Scanning BOX|<code> lands here with ?box=<code>: open that box straight away.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const code = new URLSearchParams(window.location.search).get('box');
    if (!code) return;
    containersApi.byCode(code).then(setOpen).catch((e: unknown) => toast.error(localizeError(e)));
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // Kind and status narrow what is already on screen; the server does the rest.
  const shown = useMemo(
    () => rows.filter((r) => (!typeFilter || r.type === typeFilter) && (!statusFilter || r.status === statusFilter)),
    [rows, typeFilter, statusFilter],
  );

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
      await load();
    } catch (e: unknown) { toast.error(localizeError(e)); } finally { setBusy(false); }
  }

  function printLabel(id: string) {
    const token = typeof window === 'undefined' ? null : localStorage.getItem('wms_token');
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    fetch(`${base}/api/labels/container/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ids: [id] }),
    })
      .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.blob(); })
      .then((blob) => window.open(URL.createObjectURL(blob), '_blank'))
      .catch(() => toast.error(C.printFailed));
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 bg-slate-50 min-h-full">
      <PageHeader title={C.title} subtitle={C.subtitle} icon={Box} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="h-9 w-64 pl-8" placeholder={C.searchPh} value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select aria-label={C.warehouse} className={cn(SELECT_CLS, 'w-44')} value={whFilter} onChange={(e) => setWhFilter(e.target.value)}>
          <option value="">{C.allWarehouses}</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
        </select>
        <select aria-label={C.kind} className={cn(SELECT_CLS, 'w-44')} value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as '' | ContainerType)}>
          <option value="">{C.anyType}</option>
          {TYPES.map((v) => <option key={v} value={v}>{C.types[v]}</option>)}
        </select>
        <select aria-label={C.status} className={cn(SELECT_CLS, 'w-36')} value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as '' | ContainerStatus)}>
          <option value="">{C.anyStatus}</option>
          <option value="OPEN">{C.active}</option>
          <option value="CLOSED">{C.sealed}</option>
        </select>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-white" onClick={load} disabled={loading}>
          <RefreshCw className="h-4 w-4" /> {m.common.actions.refresh}
        </Button>
        <Button size="sm" className="ml-auto h-9 gap-1.5 bg-green-600 text-white hover:bg-green-700"
          onClick={() => setCreating(true)} disabled={busy}>
          <Plus className="h-4 w-4" /> {C.newBox}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">{C.code}</th>
              <th className="px-4 py-3 font-medium">{C.name}</th>
              <th className="px-4 py-3 font-medium">{C.kind}</th>
              <th className="px-4 py-3 font-medium">{C.place}</th>
              <th className="px-4 py-3 text-right font-medium">{C.contents}</th>
              <th className="px-4 py-3 font-medium">{C.status}</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => (
              <tr key={i}>{[...Array(7)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>
            )) : shown.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">{C.empty}</td></tr>
            ) : shown.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono font-medium text-slate-800">{r.code}</td>
                <td className="px-4 py-3 text-slate-700">{r.name || <span className="text-slate-400">—</span>}</td>
                <td className="px-4 py-3 text-slate-600">{C.types[r.type] ?? r.type}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{placeOf(r) || <span className="text-slate-400">{C.notPlaced}</span>}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r._count?.stockItems ?? 0}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className={r.status === 'CLOSED' ? 'bg-slate-100 text-slate-600' : 'bg-green-50 text-green-700'}>
                    {r.status === 'CLOSED' ? C.sealed : C.active}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" className="h-7 bg-white text-xs" onClick={() => reopen(r.id)}>{C.openBox}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreateDialog
          warehouses={warehouses}
          busy={busy}
          onClose={() => setCreating(false)}
          onCreate={async (dto) => {
            await run(async () => {
              const box = await containersApi.create(dto);
              toast.success(t(C.created, { code: box.code }));
              setCreating(false);
              setOpen(box);
            });
          }}
        />
      )}

      {open && (
        <BoxDialog
          key={open.id}
          box={open}
          boxes={rows}
          warehouses={warehouses}
          busy={busy}
          onClose={() => setOpen(null)}
          onPrint={() => printLabel(open.id)}
          onChanged={async (next) => { setOpen(next); await load(); }}
          onRemoved={async () => { setOpen(null); await load(); }}
          run={run}
        />
      )}
    </div>
  );
}

/**
 * Making a box: the code comes from the server, the name and kind are said up
 * front, and a place is optional — a box can be made at the desk and put
 * somewhere later. Nothing is created until this is submitted, so opening this
 * and changing your mind leaves no empty boxes behind.
 */
function CreateDialog({ warehouses, busy, onClose, onCreate }: {
  warehouses: any[];
  busy: boolean;
  onClose: () => void;
  onCreate: (dto: { name?: string; type: ContainerType; slotId?: string }) => Promise<void>;
}) {
  const { m } = useT();
  const C = m.containers;
  const [name, setName] = useState('');
  const [type, setType] = useState<ContainerType>('BOX');
  const [dest, setDest] = useState({ warehouseId: '', rackId: '', slotId: '' });

  const racks: any[] = useMemo(() => warehouses.find((w) => w.id === dest.warehouseId)?.racks ?? [], [warehouses, dest.warehouseId]);
  const slots: any[] = useMemo(() => racks.find((r: any) => r.id === dest.rackId)?.slots ?? [], [racks, dest.rackId]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-full sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{C.createTitle}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-500">{C.createHint}</p>

        <div className="mt-2 space-y-3">
          <div>
            <Label htmlFor="new-box-name" className="text-xs font-semibold text-slate-700">{C.name}</Label>
            <Input id="new-box-name" className="mt-1 h-9" value={name} disabled={busy}
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="new-box-kind" className="text-xs font-semibold text-slate-700">{C.kind}</Label>
            <select id="new-box-kind" className={cn(SELECT_CLS, 'mt-1')} value={type} disabled={busy}
              onChange={(e) => setType(e.target.value as ContainerType)}>
              {TYPES.map((v) => <option key={v} value={v}>{C.types[v]}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs font-semibold text-slate-700">{C.placeOptional}</Label>
            <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select aria-label={C.warehouse} className={SELECT_CLS} value={dest.warehouseId} disabled={busy}
                onChange={(e) => setDest({ warehouseId: e.target.value, rackId: '', slotId: '' })}>
                <option value="">{C.warehouse}</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
              </select>
              <select aria-label={C.rack} className={SELECT_CLS} value={dest.rackId} disabled={busy || !dest.warehouseId}
                onChange={(e) => setDest((d) => ({ ...d, rackId: e.target.value, slotId: '' }))}>
                <option value="">{C.rack}</option>
                {racks.map((r: any) => <option key={r.id} value={r.id}>{r.code}</option>)}
              </select>
              <select aria-label={C.slot} className={SELECT_CLS} value={dest.slotId} disabled={busy || !dest.rackId}
                onChange={(e) => setDest((d) => ({ ...d, slotId: e.target.value }))}>
                <option value="">{C.slot}</option>
                {slots.map((s: any) => <option key={s.id} value={s.id}>{s.code}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" className="h-9 bg-white" onClick={onClose} disabled={busy}>
            {m.common.actions.cancel}
          </Button>
          <Button size="sm" className="h-9 gap-1.5 bg-green-600 text-white hover:bg-green-700" disabled={busy}
            onClick={() => onCreate({ name: name.trim() || undefined, type, slotId: dest.slotId || undefined })}>
            <Plus className="h-4 w-4" /> {C.create}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Asks before anything moves, and says exactly which rows it will touch. */
function ConfirmMove({ title, hint, rows, labels, busy, extra, danger, onCancel, onConfirm }: {
  title: string;
  hint: string;
  rows: any[];
  labels: { affected: string; lot: string; serial: string; cancel: string; confirm: string };
  busy: boolean;
  /** An extra choice the asker needs, shown under the rows. */
  extra?: ReactNode;
  /** Red confirm button for an action that takes something away. */
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="w-full sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-500">{hint}</p>
        {rows.length > 0 && (
          <div className="mt-2 rounded-lg border border-slate-200 p-2">
            <Label className="text-xs font-semibold text-slate-700">{labels.affected}</Label>
            <ul className="mt-1 max-h-48 divide-y divide-slate-100 overflow-y-auto">
              {rows.map((s) => (
                <li key={s.id} className="flex items-center gap-2 py-1.5 text-xs">
                  <StockLine s={s} labels={labels} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {extra && <div className="mt-3">{extra}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" className="h-9 bg-white" onClick={onCancel} disabled={busy}>{labels.cancel}</Button>
          <Button size="sm" onClick={onConfirm} disabled={busy}
            className={cn('h-9 text-white', danger ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700')}>
            {labels.confirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BoxDialog({ box, boxes, warehouses, busy, onClose, onPrint, onChanged, onRemoved, run }: {
  box: ContainerDetail;
  boxes: ContainerRow[];
  warehouses: any[];
  busy: boolean;
  onClose: () => void;
  onPrint: () => void;
  onChanged: (next: ContainerDetail) => void | Promise<void>;
  onRemoved: () => void | Promise<void>;
  run: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const { m, t } = useT();
  const C = m.containers;
  const sealed = box.status === 'CLOSED';
  const labels = {
    affected: C.affected, lot: C.lot, serial: C.serial,
    cancel: m.common.actions.cancel, confirm: m.common.actions.confirm,
  };

  const [picked, setPicked] = useState<string[]>([]);
  const [dest, setDest] = useState({ warehouseId: box.warehouseId ?? '', rackId: box.rackId ?? '', slotId: box.slotId ?? '' });
  const [mergeFrom, setMergeFrom] = useState('');
  const [draft, setDraft] = useState<{ name: string; type: ContainerType }>({ name: box.name ?? '', type: box.type });
  const [nearby, setNearby] = useState<any[]>([]);
  const [packPick, setPackPick] = useState<string[]>([]);
  const [ask, setAsk] = useState<null | 'take' | 'split' | 'merge' | 'retire'>(null);
  // What is inside the box chosen for merging, so the question can name it
  // rather than ask the person to take the move on trust.
  const [mergeSource, setMergeSource] = useState<ContainerDetail | null>(null);
  const [retireMerged, setRetireMerged] = useState(true);

  const racks: any[] = useMemo(() => warehouses.find((w) => w.id === dest.warehouseId)?.racks ?? [], [warehouses, dest.warehouseId]);
  const slots: any[] = useMemo(() => racks.find((r: any) => r.id === dest.rackId)?.slots ?? [], [racks, dest.rackId]);

  // What else is standing in the same slot and not in a box yet — the stock a
  // person would actually pack into this box.
  useEffect(() => {
    if (!box.slotId) { setNearby([]); return; }
    inventoryApi.list({ warehouseId: box.warehouseId ?? undefined, limit: 200 })
      .then((r: any) => {
        const list = (r?.data ?? r ?? []) as any[];
        setNearby(list.filter((x) => x.slotId === box.slotId && !x.containerId && !GONE.includes(x.status)));
      })
      .catch(() => setNearby([]));
  }, [box.id, box.slotId, box.warehouseId]);

  // The list only carries counts, so read the chosen box to show its rows.
  useEffect(() => {
    if (!mergeFrom) { setMergeSource(null); return; }
    let live = true;
    containersApi.get(mergeFrom)
      .then((d) => { if (live) setMergeSource(d); })
      .catch(() => { if (live) setMergeSource(null); });
    return () => { live = false; };
  }, [mergeFrom]);

  const toggle = (id: string, list: string[], set: (v: string[]) => void) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const pickedRows = box.stockItems.filter((s) => picked.includes(s.id));
  const mergeBox = boxes.find((b) => b.id === mergeFrom);

  const doTake = () => run(async () => {
    onChanged(await containersApi.unpack(box.id, picked));
    setPicked([]); setAsk(null);
  }, C.tookOut);

  const doSplit = () => run(async () => {
    const r = await containersApi.split(box.id, { stockItemIds: picked });
    setPicked([]); setAsk(null);
    onChanged(r.source);
    toast.success(t(C.splitDone, { code: r.created.code }));
  });

  const doMerge = () => run(async () => {
    const from = mergeBox?.code ?? '';
    const r = await containersApi.merge(box.id, mergeFrom, retireMerged);
    setMergeFrom(''); setAsk(null);
    onChanged(r.target);
    toast.success(t(C.mergeDone, { stock: r.moved.stock, children: r.moved.children }));
    if (r.moved.retired) toast.success(t(C.mergeRetired, { code: from }));
  });

  const doRetire = () => run(async () => {
    await containersApi.remove(box.id);
    setAsk(null);
    await onRemoved();
  }, C.retired);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-full sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{box.code}</span>
            {box.name && <span className="text-sm font-normal text-slate-500">{box.name}</span>}
            <Badge variant="outline" className={sealed ? 'bg-slate-100 text-slate-600' : 'bg-green-50 text-green-700'}>
              {sealed ? C.sealed : C.active}
            </Badge>
            {box.splitFrom && (
              <span className="text-xs font-normal text-slate-500">{t(C.splitFrom, { code: box.splitFrom.code })}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 1. What this box is */}
          <section className="rounded-xl border border-slate-200 p-3">
            <Label className="text-xs font-semibold text-slate-700">{C.secInfo}</Label>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
              <div>
                <Label htmlFor="box-name" className="text-xs text-slate-500">{C.name}</Label>
                <Input id="box-name" className="mt-1 h-9" value={draft.name} disabled={busy}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="box-kind" className="text-xs text-slate-500">{C.kind}</Label>
                <select id="box-kind" className={cn(SELECT_CLS, 'mt-1')} value={draft.type} disabled={busy}
                  onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as ContainerType }))}>
                  {TYPES.map((v) => <option key={v} value={v}>{C.types[v]}</option>)}
                </select>
              </div>
              <Button size="sm" variant="outline" className="h-9 bg-white text-xs"
                disabled={busy || (draft.name === (box.name ?? '') && draft.type === box.type)}
                onClick={() => run(async () => onChanged(
                  await containersApi.update(box.id, { name: draft.name.trim() || undefined, type: draft.type }),
                ), C.savedName)}>
                {C.save}
              </Button>
            </div>
          </section>

          {/* 2. Where it stands, and moving it */}
          <section className="rounded-xl border border-slate-200 p-3">
            <Label className="text-xs font-semibold text-slate-700">{C.secPlace}</Label>
            <p className="mt-0.5 text-xs text-slate-500">{placeOf(box) || C.notPlaced} · {C.moveHint}</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
              <select aria-label={C.warehouse} className={SELECT_CLS} value={dest.warehouseId}
                onChange={(e) => setDest({ warehouseId: e.target.value, rackId: '', slotId: '' })}>
                <option value="">{C.warehouse}</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
              </select>
              <select aria-label={C.rack} className={SELECT_CLS} value={dest.rackId} disabled={!dest.warehouseId}
                onChange={(e) => setDest((d) => ({ ...d, rackId: e.target.value, slotId: '' }))}>
                <option value="">{C.rack}</option>
                {racks.map((r: any) => <option key={r.id} value={r.id}>{r.code}</option>)}
              </select>
              <select aria-label={C.slot} className={SELECT_CLS} value={dest.slotId} disabled={!dest.rackId}
                onChange={(e) => setDest((d) => ({ ...d, slotId: e.target.value }))}>
                <option value="">{C.slot}</option>
                {slots.map((s: any) => <option key={s.id} value={s.id}>{s.code}</option>)}
              </select>
              <Button size="sm" className="h-9 gap-1.5 bg-green-600 text-white hover:bg-green-700"
                disabled={busy || !dest.slotId || dest.slotId === box.slotId}
                onClick={() => run(async () => onChanged(await containersApi.move(box.id, dest.slotId)), C.moved)}>
                <MoveRight className="h-4 w-4" /> {C.move}
              </Button>
            </div>
          </section>

          {/* 3. What is in it, and what can be done with those rows */}
          <section className="rounded-xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-xs font-semibold text-slate-700">
                {C.secContents} · {t(C.contentsCount, { n: box.stockItems.length })}
              </Label>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 gap-1.5 bg-white text-xs"
                  disabled={busy || sealed || picked.length === 0}
                  onClick={() => setAsk('take')}>
                  {C.takeOut}
                </Button>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 bg-white text-xs"
                  disabled={busy || sealed || picked.length === 0 || picked.length === box.stockItems.length}
                  title={picked.length === box.stockItems.length ? C.splitAll : C.splitHint}
                  onClick={() => setAsk('split')}>
                  <Split className="h-3.5 w-3.5" /> {C.split}
                </Button>
              </div>
            </div>

            {box.stockItems.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">{C.nothingInside}</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {box.stockItems.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 py-1.5 text-xs">
                    <input type="checkbox" className="h-3.5 w-3.5" checked={picked.includes(s.id)}
                      onChange={() => toggle(s.id, picked, setPicked)} disabled={sealed} aria-label={s.product.code} />
                    <StockLine s={s} labels={labels} />
                    <span className="ml-auto whitespace-nowrap text-slate-400">{s.status}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Adding stock that is standing in the same slot */}
            <div className="mt-3 rounded-lg bg-slate-50 p-2.5">
              <Label className="text-xs font-semibold text-slate-700">{C.addStock}</Label>
              <p className="mt-0.5 text-xs text-slate-500">{box.slotId ? C.packHint : C.packNoPlace}</p>
              {nearby.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">{C.nothingNearby}</p>
              ) : (
                <>
                  <ul className="mt-2 max-h-40 divide-y divide-slate-100 overflow-y-auto">
                    {nearby.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 py-1.5 text-xs">
                        <input type="checkbox" className="h-3.5 w-3.5" checked={packPick.includes(s.id)}
                          onChange={() => toggle(s.id, packPick, setPackPick)} disabled={sealed} aria-label={s.product?.code} />
                        <StockLine s={s} labels={labels} />
                        <span className="ml-auto whitespace-nowrap text-slate-400">{s.status}</span>
                      </li>
                    ))}
                  </ul>
                  <Button size="sm" className="mt-2 h-7 gap-1.5 bg-green-600 text-xs text-white hover:bg-green-700"
                    disabled={busy || sealed || packPick.length === 0}
                    onClick={() => run(async () => { onChanged(await containersApi.pack(box.id, packPick)); setPackPick([]); }, C.packed)}>
                    <PackagePlus className="h-3.5 w-3.5" /> {t(C.packN, { n: packPick.length })}
                  </Button>
                </>
              )}
            </div>
          </section>

          {/* 4. What can be done with the box itself */}
          <section className="rounded-xl border border-slate-200 p-3">
            <Label className="text-xs font-semibold text-slate-700">{C.secActions}</Label>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-white text-xs" onClick={onPrint}>
                <Printer className="h-3.5 w-3.5" /> {C.printLabel}
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 bg-white text-xs" disabled={busy}
                onClick={() => run(async () => onChanged(await containersApi.update(box.id, { status: sealed ? 'OPEN' : 'CLOSED' })),
                  sealed ? C.opened : C.closed)}>
                {sealed ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                {sealed ? C.unseal : C.seal}
              </Button>
              <Button size="sm" variant="outline" className="ml-auto h-8 gap-1.5 bg-white text-xs text-red-600 hover:text-red-700"
                disabled={busy || box.stockItems.length > 0 || box.children.length > 0}
                title={box.stockItems.length ? C.emptyFirst : C.retire}
                onClick={() => setAsk('retire')}>
                <Trash2 className="h-3.5 w-3.5" /> {C.retire}
              </Button>
            </div>

            <div className="mt-3 border-t border-slate-100 pt-3">
              <Label className="text-xs text-slate-500">{C.mergeTitle}</Label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <select aria-label={C.mergeTitle} className={cn(SELECT_CLS, 'w-64')} value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)}>
                  <option value="">{C.mergePick}</option>
                  {boxes.filter((b) => b.id !== box.id).map((b) => (
                    <option key={b.id} value={b.id}>{b.code}{b._count?.stockItems ? ` (${b._count.stockItems})` : ''}</option>
                  ))}
                </select>
                <Button size="sm" variant="outline" className="h-9 gap-1.5 bg-white text-xs" disabled={busy || sealed || !mergeFrom}
                  onClick={() => setAsk('merge')}>
                  <Merge className="h-3.5 w-3.5" /> {C.merge}
                </Button>
              </div>
            </div>
          </section>
        </div>

        {ask === 'take' && (
          <ConfirmMove title={C.confirmTake} hint={C.confirmTakeHint} rows={pickedRows} labels={labels} busy={busy}
            onCancel={() => setAsk(null)} onConfirm={doTake} />
        )}
        {ask === 'split' && (
          <ConfirmMove title={C.confirmSplit} hint={C.confirmSplitHint} rows={pickedRows} labels={labels} busy={busy}
            onCancel={() => setAsk(null)} onConfirm={doSplit} />
        )}
        {ask === 'merge' && (
          <ConfirmMove
            title={t(C.confirmMerge, { code: mergeBox?.code ?? '' })}
            hint={mergeSource?.children.length
              ? t(C.confirmMergeHintBoxes, { n: mergeSource.children.length })
              : C.confirmMergeHint}
            rows={mergeSource?.stockItems ?? []}
            labels={labels}
            busy={busy}
            extra={(
              <label className="flex items-start gap-2 text-xs text-slate-600">
                <input type="checkbox" className="mt-0.5 h-3.5 w-3.5" checked={retireMerged}
                  onChange={(e) => setRetireMerged(e.target.checked)} />
                <span>{t(C.mergeRetireAsk, { code: mergeBox?.code ?? '' })}</span>
              </label>
            )}
            onCancel={() => setAsk(null)}
            onConfirm={doMerge}
          />
        )}
        {ask === 'retire' && (
          <ConfirmMove title={t(C.confirmRetire, { code: box.code })} hint={C.confirmRetireHint} rows={[]} labels={labels}
            busy={busy} danger onCancel={() => setAsk(null)} onConfirm={doRetire} />
        )}
      </DialogContent>
    </Dialog>
  );
}
