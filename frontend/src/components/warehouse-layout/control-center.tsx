'use client';

// Warehouse Operations — Racks & slots tab.
// Occupancy comes from actual stock placement (slot._count.stockItems, stock
// still in the location). The page shell owns the warehouse selector and KPIs.
// Same production APIs as before: /warehouse tree, slot detail, slot update,
// rack create.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, ChevronRight, Layers, Package, MapPin, Search,
  Pencil, ArrowRightLeft, Ban, ScanLine, History, Printer, RotateCcw, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { warehouseApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn, formatDate } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import type { UserRole } from '@/types';
import {
  type SlotData, type RackData, type WarehouseData,
  slotItems, isOccupied, isBlocked, slotUtil, rackMetrics,
} from './occupancy';

// ─── Slot presentation (one green ramp + red for blocked) ───────────────────────

type SlotState = 'empty' | 'inUse' | 'full' | 'blocked';
const slotState = (s: SlotData): SlotState =>
  isBlocked(s) ? 'blocked' : !isOccupied(s) ? 'empty' : slotUtil(s) >= 90 ? 'full' : 'inUse';

const STATE_CFG: Record<SlotState, { label: string; cell: string; pill: string }> = {
  empty:   { label: 'Empty',   cell: 'bg-white border-slate-200 text-slate-500 hover:border-slate-300', pill: 'bg-slate-100 text-slate-600' },
  inUse:   { label: 'In use',  cell: 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:border-emerald-400', pill: 'bg-emerald-50 text-emerald-700' },
  full:    { label: 'Full',    cell: 'bg-emerald-600 border-emerald-700 text-white hover:bg-emerald-700', pill: 'bg-emerald-600 text-white' },
  blocked: { label: 'Blocked', cell: 'bg-red-50 border-red-300 text-red-700 hover:border-red-400', pill: 'bg-red-50 text-red-700' },
};

type StateFilter = 'all' | 'inUse' | 'empty' | 'blocked';
const FILTERS: { key: StateFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'inUse', label: 'In use' },
  { key: 'empty', label: 'Empty' },
  { key: 'blocked', label: 'Blocked' },
];
const matchesFilter = (s: SlotData, f: StateFilter) => {
  const st = slotState(s);
  return f === 'all' || (f === 'inUse' ? st === 'inUse' || st === 'full' : st === f);
};

/** The last part of a slot code is enough inside its rack ("R01-A03" → "A03"). */
const shortCode = (rack: RackData, slot: SlotData) =>
  slot.code.startsWith(`${rack.code}-`) ? slot.code.slice(rack.code.length + 1) : slot.code;

// ─── Rack row with its slot grid ────────────────────────────────────────────────

function RackRow({ rack, slots, expanded, onToggle, onSelectSlot, selectedSlotId, highlight }: {
  rack: RackData; slots: SlotData[]; expanded: boolean; onToggle: () => void;
  onSelectSlot: (s: SlotData) => void; selectedSlotId: string; highlight: string;
}) {
  const m = rackMetrics(rack);
  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
      >
        <ChevronRight className={cn('h-4 w-4 text-slate-400 flex-shrink-0 transition-transform', expanded && 'rotate-90')} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">
            {rack.code}
            {rack.name && <span className="ml-2 font-normal text-slate-500">{rack.name}</span>}
          </p>
          <p className="text-xs text-slate-500">
            {[rack.zone, rack.rackType.replace(/_/g, ' ').toLowerCase()].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-5 text-right flex-shrink-0 text-xs text-slate-500 tabular-nums">
          <span><b className="font-semibold text-slate-800">{m.occupied}/{m.total}</b> slots</span>
          <span><b className="font-semibold text-slate-800">{m.utilPct}%</b> used</span>
          {m.blocked > 0 && <span className="text-red-600">{m.blocked} blocked</span>}
        </div>
        <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden flex-shrink-0" aria-hidden>
          <div className="h-full bg-emerald-500" style={{ width: `${m.utilPct}%` }} />
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 bg-slate-50/60">
          {rack.slots.length === 0 ? (
            <p className="text-xs text-slate-500 py-3">
              This rack has no slots yet. Add them in Warehouse Master.
            </p>
          ) : slots.length === 0 ? (
            <p className="text-xs text-slate-500 py-3">No slots in this rack match the filter.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {slots.map((s) => {
                const st = slotState(s);
                const hit = !!highlight && s.code.toLowerCase().includes(highlight);
                return (
                  <button
                    key={s.id}
                    onClick={() => onSelectSlot(s)}
                    title={`${s.code} · ${STATE_CFG[st].label} · ${slotItems(s)}/${s.capacity}`}
                    aria-label={`Slot ${s.code}, ${STATE_CFG[st].label}, ${slotItems(s)} of ${s.capacity}`}
                    aria-pressed={selectedSlotId === s.id}
                    className={cn(
                      'h-11 min-w-[3.25rem] px-1.5 rounded-md border text-left flex flex-col justify-center transition-colors',
                      STATE_CFG[st].cell,
                      selectedSlotId === s.id && 'ring-2 ring-emerald-700 ring-offset-1',
                      hit && selectedSlotId !== s.id && 'ring-2 ring-amber-400 ring-offset-1',
                    )}
                  >
                    <span className="text-[11px] font-semibold leading-tight font-mono">{shortCode(rack, s)}</span>
                    <span className="text-[11px] leading-tight opacity-80 tabular-nums">
                      {st === 'blocked' ? <Ban className="h-3 w-3 inline" /> : `${slotItems(s)}/${s.capacity}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 border-t border-slate-100 text-xs text-slate-500">
      {(Object.keys(STATE_CFG) as SlotState[]).map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className={cn('h-3 w-3 rounded-sm border', STATE_CFG[k].cell)} />{STATE_CFG[k].label}
        </span>
      ))}
      <span className="ml-auto hidden md:inline">Numbers are stock rows / capacity</span>
    </div>
  );
}

// ─── Location panel (detail + actions) ──────────────────────────────────────────

function LocationPanel({ wh, rack, slot, detail, detailState, onRetry, onAction, canBlock }: {
  wh: WarehouseData | null; rack: RackData | null; slot: SlotData | null; detail: any;
  detailState: 'idle' | 'loading' | 'error'; onRetry: () => void; onAction: (a: string) => void; canBlock: boolean;
}) {
  if (!slot) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <MapPin className="h-7 w-7 mx-auto text-slate-300" />
        <p className="mt-2 text-sm font-medium text-slate-700">No location selected</p>
        <p className="text-xs text-slate-500">Open a rack and pick a slot to see its stock and actions.</p>
      </div>
    );
  }

  const items: any[] = detail?.stockItems ?? [];
  const qty = items.reduce((a, it) => a + (it.quantity ?? 0), 0);
  const st = slotState(slot);
  const lastMove = items[0]?.updatedAt ?? slot.updatedAt;
  const loadingDetail = detailState === 'loading';

  const rows: [string, React.ReactNode][] = [
    ['Warehouse', wh?.name ?? '—'],
    ['Rack', rack?.code ?? '—'],
    ['Type', slot.slotType.toLowerCase()],
    ['Stock rows', `${slotItems(slot)} of ${slot.capacity}`],
    ['Units', loadingDetail ? '…' : qty.toLocaleString()],
    ['Last movement', lastMove ? formatDate(lastMove) : '—'],
  ];

  const ACTIONS: { id: string; label: string; icon: React.ElementType; danger?: boolean; hidden?: boolean }[] = [
    { id: 'edit', label: 'Edit', icon: Pencil, hidden: !canBlock },
    { id: 'block', label: isBlocked(slot) ? 'Unblock' : 'Block', icon: isBlocked(slot) ? RotateCcw : Ban, danger: !isBlocked(slot), hidden: !canBlock },
    { id: 'print', label: 'Print label', icon: Printer },
    { id: 'transfer', label: 'Transfer stock', icon: ArrowRightLeft },
    { id: 'cycle', label: 'Cycle count', icon: ScanLine },
    { id: 'history', label: 'Audit trail', icon: History },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">Location</p>
          <p className="text-base font-semibold text-slate-900 font-mono truncate">{slot.code}</p>
        </div>
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', STATE_CFG[st].pill)}>{STATE_CFG[st].label}</span>
      </div>

      <dl className="px-4 py-3 space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 text-sm">
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-medium text-slate-800 text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="px-4 pb-3">
        <p className="text-xs font-medium text-slate-500 mb-1.5">Stock in location</p>
        {loadingDetail ? (
          <div className="space-y-1.5"><Skeleton className="h-5" /><Skeleton className="h-5" /></div>
        ) : detailState === 'error' ? (
          <div className="flex items-center justify-between gap-2 rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-700">
            <span className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Couldn&apos;t load stock for this location.</span>
            <button className="font-medium underline-offset-2 hover:underline" onClick={onRetry}>Retry</button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-slate-400">Empty</p>
        ) : (
          <ul className="space-y-1 max-h-44 overflow-y-auto">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-2 text-xs">
                <Package className="h-3.5 w-3.5 text-slate-300 flex-shrink-0" />
                <span className="font-mono font-medium text-slate-700">{it.product?.code}</span>
                <span className="text-slate-500 truncate flex-1">{it.product?.name}</span>
                <span className="tabular-nums text-slate-700">{it.quantity}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-4 py-3 border-t border-slate-100 grid grid-cols-2 gap-2">
        {ACTIONS.filter((a) => !a.hidden).map((a) => {
          const Icon = a.icon;
          return (
            <Button
              key={a.id}
              variant="outline"
              size="sm"
              onClick={() => onAction(a.id)}
              className={cn('h-8 justify-start gap-1.5 text-xs', a.danger && 'hover:border-red-300 hover:bg-red-50 hover:text-red-700')}
            >
              <Icon className="h-3.5 w-3.5" /> {a.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Dialogs (shared Dialog component) ──────────────────────────────────────────

const selectCls = 'h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/30';

function CreateRackDialog({ wh, open, onClose, onDone }: { wh: WarehouseData | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ code: '', name: '', zone: '', rackType: 'STANDARD', levels: '5', columns: '10' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!wh) return;
    if (!form.code.trim()) { setError('Enter a rack code'); return; }
    const levels = Number(form.levels);
    const columns = Number(form.columns);
    if (!Number.isInteger(levels) || levels < 1 || !Number.isInteger(columns) || columns < 1) { setError('Levels and columns must be whole numbers of 1 or more'); return; }
    setBusy(true);
    setError(null);
    try {
      await warehouseApi.createRack({ ...form, code: form.code.trim(), warehouseId: wh.id, levels, columns });
      toast.success(`Rack ${form.code.trim()} created`);
      setForm({ code: '', name: '', zone: '', rackType: 'STANDARD', levels: '5', columns: '10' });
      onDone();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New rack{wh ? ` in ${wh.name}` : ''}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Rack code</Label><Input placeholder="R-01" value={form.code} onChange={set('code')} autoFocus /></div>
            <div className="space-y-1"><Label>Name</Label><Input placeholder="Rack A1" value={form.name} onChange={set('name')} /></div>
            <div className="space-y-1"><Label>Zone</Label><Input placeholder="ZONE-A" value={form.zone} onChange={set('zone')} /></div>
            <div className="space-y-1"><Label>Type</Label>
              <select className={selectCls} value={form.rackType} onChange={set('rackType')}>
                {['STANDARD', 'DRIVE_IN', 'PUSH_BACK', 'CANTILEVER', 'FLOW', 'MEZZANINE', 'PALLET'].map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ').toLowerCase()}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label>Levels</Label><Input type="number" min={1} value={form.levels} onChange={set('levels')} /></div>
            <div className="space-y-1"><Label>Columns</Label><Input type="number" min={1} value={form.columns} onChange={set('columns')} /></div>
          </div>
          <p className="text-xs text-slate-500">Creates the rack only. Add its slots afterwards in Warehouse Master.</p>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={busy}>{busy ? 'Creating…' : 'Create rack'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditSlotDialog({ slot, onClose, onDone }: { slot: SlotData | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', slotType: 'STANDARD', capacity: '1', blocked: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (slot) {
      setForm({ name: slot.name ?? '', slotType: slot.slotType, capacity: String(slot.capacity), blocked: isBlocked(slot) });
      setError(null);
    }
  }, [slot]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!slot) return;
    const capacity = Number(form.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) { setError('Capacity must be a whole number of 1 or more'); return; }
    // Status only matters as blocked / not blocked; other values are not used
    // anywhere, so the original status is kept unless the blocked flag changed.
    const status = form.blocked === isBlocked(slot) ? undefined : form.blocked ? 'BLOCKED' : 'EMPTY';
    setBusy(true);
    setError(null);
    try {
      await warehouseApi.updateSlot(slot.id, { name: form.name, slotType: form.slotType, capacity, ...(status ? { status } : {}) });
      toast.success(`Location ${slot.code} updated`);
      onDone();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!slot} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit location {slot?.code}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1"><Label>Slot type</Label>
              <select className={selectCls} value={form.slotType} onChange={(e) => setForm({ ...form, slotType: e.target.value })}>
                {['STANDARD', 'PALLET', 'BULK', 'COLD', 'HAZMAT', 'OVERSIZE'].map((t) => <option key={t} value={t}>{t.toLowerCase()}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label>Capacity (stock rows)</Label><Input type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={form.blocked} onChange={(e) => setForm({ ...form, blocked: e.target.checked })} />
            <span>Blocked<span className="block text-xs text-slate-500">Marks the location as out of use on this page and the floor plan.</span></span>
          </label>
          <p className="text-xs text-slate-500">Whether a location is in use comes from the stock placed in it, so it isn&apos;t set here.</p>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Print label (client-side, no API) ──────────────────────────────────────────

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function printLabel(wh: WarehouseData | null, rack: RackData | null, slot: SlotData) {
  const w = window.open('', '_blank', 'width=420,height=300');
  if (!w) { toast.error('Pop-up blocked — allow pop-ups to print the label'); return; }
  // Every value is escaped: codes and names are user-entered.
  w.document.write(`<html><head><title>Label ${esc(slot.code)}</title><style>
    body{font-family:Segoe UI,sans-serif;margin:0;padding:24px}
    .lbl{border:2px solid #111;border-radius:10px;padding:18px;width:320px}
    .code{font-size:30px;font-weight:800;letter-spacing:1px}
    .row{font-size:13px;color:#333;margin-top:4px}
    .muted{color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1px}
  </style></head><body onload="window.print()">
    <div class="lbl">
      <div class="muted">Highpoint WMS · Location</div>
      <div class="code">${esc(slot.code)}</div>
      <div class="row">${esc(wh?.name)} · ${esc(rack?.code)}</div>
      <div class="row muted">${esc(slot.slotType)} · cap ${esc(slot.capacity)}</div>
    </div>
  </body></html>`);
  w.document.close();
}

// ─── Racks & slots tab ──────────────────────────────────────────────────────────
// Remounted via `key` when the warehouse changes, which resets expanded rack,
// selected slot and detail.

// Creating a rack is master data: the API allows SYSTEM_ADMIN and
// WAREHOUSE_MANAGER only, matching warehouse-master. Editing and blocking a slot
// stay open to the floor roles. The UI mirrors that so nobody is shown a button
// that would 403.
const STRUCTURE_ROLES: UserRole[] = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER'];
const OPS_ROLES: UserRole[] = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'WAREHOUSE_STAFF'];

export function ControlCenter({ wh, loading, onReload }: {
  wh: WarehouseData | null; loading: boolean; onReload: () => void | Promise<void>;
}) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canCreateStructure = !!user && STRUCTURE_ROLES.includes(user.role);
  const canEditSlots = !!user && OPS_ROLES.includes(user.role);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Only the id is kept: the slot itself is always read from the latest tree,
  // so the panel shows fresh values after an edit, block or refresh.
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StateFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [editSlot, setEditSlot] = useState<SlotData | null>(null);
  const detailReq = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const racks = useMemo(() => wh?.racks ?? [], [wh]);
  const slotIndex = useMemo(() => {
    const m = new Map<string, { slot: SlotData; rack: RackData }>();
    for (const r of racks) for (const s of r.slots) m.set(s.id, { slot: s, rack: r });
    return m;
  }, [racks]);
  const selected = selectedSlotId ? slotIndex.get(selectedSlotId) ?? null : null;

  const loadDetail = useCallback(async (slotId: string) => {
    const req = ++detailReq.current;
    setDetailState('loading');
    try {
      const d = await warehouseApi.getSlotDetail(slotId);
      if (req === detailReq.current) { setDetail(d); setDetailState('idle'); }
    } catch {
      if (req === detailReq.current) { setDetail(null); setDetailState('error'); }
    }
  }, []);

  function selectSlot(s: SlotData) {
    setSelectedSlotId(s.id);
    loadDetail(s.id);
    // On narrow screens the panel sits below the list — bring it into view.
    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
      setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  }

  async function refreshAfterChange(slotId: string) {
    await onReload();
    await loadDetail(slotId);
  }

  async function handleAction(a: string) {
    const s = selected?.slot;
    if (!s) return;
    switch (a) {
      case 'edit': setEditSlot(s); break;
      case 'transfer': router.push('/transfer'); break;
      case 'cycle': router.push('/cycle-count'); break;
      case 'history': router.push('/audit'); break;
      case 'print': printLabel(wh, selected?.rack ?? null, s); break;
      case 'block': {
        const next = isBlocked(s) ? 'EMPTY' : 'BLOCKED';
        try {
          await warehouseApi.updateSlot(s.id, { status: next });
          toast.success(`${s.code} ${next === 'BLOCKED' ? 'blocked' : 'unblocked'}`);
          await refreshAfterChange(s.id);
        } catch (e: any) { toast.error(e.message); }
        break;
      }
    }
  }

  // Search matches rack code / name or slot code; a slot-code match opens its rack.
  const q = search.trim().toLowerCase();
  const view = useMemo(() => racks.map((r) => {
    const rackHit = !q || r.code.toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q);
    const slotHits = q ? r.slots.filter((s) => s.code.toLowerCase().includes(q)) : [];
    const base = rackHit ? r.slots : slotHits;
    const slots = base.filter((s) => matchesFilter(s, filter));
    const visible = (rackHit || slotHits.length > 0) && (filter === 'all' || slots.length > 0);
    return { rack: r, slots, visible, autoOpen: !!q && slotHits.length > 0 };
  }).filter((x) => x.visible), [racks, q, filter]);

  const toggle = (id: string) => setExpanded((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        {/* Racks & slots */}
        <div className="xl:col-span-2 rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="h-4 w-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rack or slot code" className="h-9 pl-8 text-sm" aria-label="Search rack or slot code" />
            </div>
            <div className="flex rounded-md border border-slate-200 overflow-hidden" role="group" aria-label="Filter slots">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  aria-pressed={filter === f.key}
                  className={cn('px-3 h-9 text-xs border-r border-slate-200 last:border-r-0', filter === f.key ? 'bg-emerald-50 text-emerald-800 font-medium' : 'bg-white text-slate-600 hover:bg-slate-50')}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {canCreateStructure && (
              <Button size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" onClick={() => setCreateOpen(true)} disabled={!wh}>
                <Plus className="w-4 h-4" /> New rack
              </Button>
            )}
          </div>

          {loading ? (
            <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : !wh ? (
            <div className="p-10 text-center text-sm text-slate-500">Select a warehouse above.</div>
          ) : racks.length === 0 ? (
            <div className="p-10 text-center">
              <Layers className="h-8 w-8 mx-auto text-slate-300" />
              <p className="mt-2 text-sm font-medium text-slate-700">No racks in this warehouse yet</p>
              {canCreateStructure && <p className="text-xs text-slate-500 mt-0.5">Use “New rack”, then add its slots in Warehouse Master.</p>}
            </div>
          ) : view.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              Nothing matches{q ? ` “${search.trim()}”` : ''}{filter !== 'all' ? ` with filter “${FILTERS.find((f) => f.key === filter)?.label}”` : ''}.
              <button className="ml-1 text-emerald-700 hover:underline" onClick={() => { setSearch(''); setFilter('all'); }}>Clear</button>
            </div>
          ) : (
            <>
              <div>
                {view.map(({ rack, slots, autoOpen }) => (
                  <RackRow
                    key={rack.id}
                    rack={rack}
                    slots={slots}
                    expanded={expanded.has(rack.id) || autoOpen || (filter !== 'all' && slots.length > 0)}
                    onToggle={() => toggle(rack.id)}
                    onSelectSlot={selectSlot}
                    selectedSlotId={selectedSlotId}
                    highlight={q}
                  />
                ))}
              </div>
              <Legend />
            </>
          )}
        </div>

        {/* Location panel */}
        <div ref={panelRef} className="xl:sticky xl:top-4 scroll-mt-4">
          <LocationPanel
            wh={wh}
            rack={selected?.rack ?? null}
            slot={selected?.slot ?? null}
            detail={detail}
            detailState={detailState}
            onRetry={() => selectedSlotId && loadDetail(selectedSlotId)}
            onAction={handleAction}
            canBlock={canEditSlots}
          />
        </div>
      </div>

      <CreateRackDialog wh={wh} open={createOpen} onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); onReload(); }} />
      <EditSlotDialog
        slot={editSlot}
        onClose={() => setEditSlot(null)}
        onDone={() => { const id = editSlot?.id; setEditSlot(null); if (id) refreshAfterChange(id); }}
      />
    </>
  );
}
