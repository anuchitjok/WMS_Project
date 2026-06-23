'use client';

// Warehouse Operations Control Center.
// Occupancy / utilization / status / heatmaps are computed CLIENT-SIDE from actual
// stock placement (slot._count.stockItems via StockItem.slotId) — never slot.status.
// Reuses existing production APIs only (warehouseApi). No backend/schema/logic changes.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, ChevronRight, Warehouse, Layers, RefreshCw, MapPin, X, Package,
  Pencil, ArrowRightLeft, Ban, Move, ScanLine, History, Printer, Boxes,
  CheckCircle2, AlertTriangle, Activity, Grid3x3,
} from 'lucide-react';
import { toast } from 'sonner';
import { warehouseApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatDate } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type SlotStatus = 'EMPTY' | 'OCCUPIED' | 'RESERVED' | 'QUARANTINE' | 'RTV' | 'BLOCKED';

interface SlotData {
  id: string; code: string; name?: string; level: number; column: number;
  status: SlotStatus; slotType: string; capacity: number;
  _count?: { stockItems: number }; updatedAt?: string;
}
interface RackData {
  id: string; code: string; name?: string; zone?: string; rackType: string;
  levels: number; columns: number; isActive: boolean; updatedAt?: string;
  slots: SlotData[];
  _count?: { slots: number; stockItems: number };
}
interface WarehouseData {
  id: string; code: string; name: string; location?: string;
  racks: RackData[];
  _count?: { racks: number; stockItems: number };
}

// ─── Placement-based derivations (source of truth = stock items in slot) ────────

const slotItems = (s: SlotData) => s._count?.stockItems ?? 0;
const isOccupied = (s: SlotData) => slotItems(s) > 0;
const isBlocked = (s: SlotData) => s.status === 'BLOCKED';
const slotUtil = (s: SlotData) => (s.capacity > 0 ? Math.min(100, Math.round((slotItems(s) / s.capacity) * 100)) : (isOccupied(s) ? 100 : 0));

interface Metrics { total: number; occupied: number; available: number; blocked: number; items: number; utilPct: number; }
function rackMetrics(r: RackData): Metrics {
  const slots = r.slots ?? [];
  const total = slots.length;
  const occupied = slots.filter(isOccupied).length;
  const blocked = slots.filter(isBlocked).length;
  const items = r._count?.stockItems ?? slots.reduce((a, s) => a + slotItems(s), 0);
  return { total, occupied, blocked, available: Math.max(0, total - occupied - blocked), items, utilPct: total ? Math.round((occupied / total) * 100) : 0 };
}
function whMetrics(w: WarehouseData): Metrics {
  return (w.racks ?? []).reduce((acc, r) => {
    const m = rackMetrics(r);
    return { total: acc.total + m.total, occupied: acc.occupied + m.occupied, blocked: acc.blocked + m.blocked,
      available: acc.available + m.available, items: acc.items + m.items, utilPct: 0 };
  }, { total: 0, occupied: 0, blocked: 0, available: 0, items: 0, utilPct: 0 } as Metrics);
}
const withRate = (m: Metrics): Metrics => ({ ...m, utilPct: m.total ? Math.round((m.occupied / m.total) * 100) : 0 });

type StatusLevel = 'normal' | 'warning' | 'critical';
function levelOf(util: number, blocked: number, total: number): StatusLevel {
  const blockShare = total ? blocked / total : 0;
  if (util >= 90 || blockShare >= 0.2) return 'critical';
  if (util >= 70 || blockShare >= 0.1) return 'warning';
  return 'normal';
}
const LEVEL_CFG: Record<StatusLevel, { label: string; pill: string; dot: string; bar: string }> = {
  normal:   { label: 'Normal',   pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  warning:  { label: 'Warning',  pill: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500',   bar: 'bg-amber-500' },
  critical: { label: 'Critical', pill: 'bg-red-100 text-red-700',         dot: 'bg-red-500',     bar: 'bg-red-500' },
};

// Heatmap color scale (Green=Available, Yellow=Medium, Orange=High, Red=Critical).
function heatCell(util: number, occupied: boolean) {
  if (!occupied) return 'bg-emerald-100 border-emerald-200 text-emerald-700';
  if (util >= 90) return 'bg-red-500 border-red-600 text-white';
  if (util >= 60) return 'bg-orange-500 border-orange-600 text-white';
  if (util >= 30) return 'bg-yellow-400 border-yellow-500 text-yellow-900';
  return 'bg-emerald-500 border-emerald-600 text-white';
}

const SLOT_CFG: Record<SlotStatus, { label: string; pill: string }> = {
  EMPTY:      { label: 'Available',  pill: 'bg-emerald-100 text-emerald-700' },
  OCCUPIED:   { label: 'Occupied',   pill: 'bg-amber-100 text-amber-700' },
  RESERVED:   { label: 'Reserved',   pill: 'bg-yellow-100 text-yellow-700' },
  QUARANTINE: { label: 'On Hold',    pill: 'bg-purple-100 text-purple-700' },
  RTV:        { label: 'RTV',        pill: 'bg-orange-100 text-orange-700' },
  BLOCKED:    { label: 'Blocked',    pill: 'bg-red-100 text-red-700' },
};

// ─── Capacity Dashboard (Row 1) ─────────────────────────────────────────────────

function CapacityDashboard({ kpis, loading }: { kpis: { warehouses: number; total: number; occupied: number; available: number; blocked: number; rate: number }; loading?: boolean }) {
  const cards = [
    { label: 'Total Warehouses', value: kpis.warehouses, icon: Warehouse, tile: 'bg-green-50 text-green-600' },
    { label: 'Total Locations',  value: kpis.total,      icon: Grid3x3,   tile: 'bg-slate-100 text-slate-600' },
    { label: 'Occupied',         value: kpis.occupied,   icon: Boxes,     tile: 'bg-amber-50 text-amber-600' },
    { label: 'Available',        value: kpis.available,  icon: CheckCircle2, tile: 'bg-emerald-50 text-emerald-600' },
    { label: 'Blocked',          value: kpis.blocked,    icon: Ban,       tile: 'bg-red-50 text-red-600' },
    { label: 'Occupancy Rate',   value: `${kpis.rate}%`, icon: Activity,  tile: 'bg-teal-50 text-teal-600' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <span className={cn('h-10 w-10 rounded-xl grid place-items-center', c.tile)}><Icon className="h-5 w-5" /></span>
            {loading ? <Skeleton className="h-8 w-14 mt-3" /> : (
              <p className="mt-3 text-2xl font-bold text-slate-900 tabular-nums leading-none">{typeof c.value === 'number' ? c.value.toLocaleString() : c.value}</p>
            )}
            <p className="mt-1.5 text-[13px] font-medium text-slate-500">{c.label}</p>
          </div>
        );
      })}
    </div>
  );
}

// ─── Storage Utilization by warehouse (Row 2) — also the warehouse selector ─────

function WarehouseUtilization({ warehouses, selectedId, onSelect, loading }: {
  warehouses: WarehouseData[]; selectedId: string; onSelect: (id: string) => void; loading?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-4">Storage Utilization by Warehouse</h2>
      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {warehouses.map((w) => {
            const m = withRate(whMetrics(w));
            const lvl = levelOf(m.utilPct, m.blocked, m.total);
            const cfg = LEVEL_CFG[lvl];
            const active = selectedId === w.id;
            return (
              <button key={w.id} onClick={() => onSelect(w.id)}
                className={cn('text-left rounded-xl border p-3.5 transition-all', active ? 'border-green-400 ring-1 ring-green-200 bg-green-50/30' : 'border-slate-200 hover:bg-slate-50')}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0', cfg.dot)} />
                    <span className="font-semibold text-slate-800 text-sm truncate">{w.name}</span>
                  </div>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold flex-shrink-0', cfg.pill)}>{cfg.label}</span>
                </div>
                <div className="mt-2.5 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div className={cn('h-full rounded-full', cfg.bar)} style={{ width: `${m.utilPct}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500 tabular-nums">
                  <span className="font-bold text-slate-700">{m.utilPct}%</span>
                  <span>{m.occupied}/{m.total} slots · {m.items} items</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Rack heatmap card + slot heatmap (Center) ──────────────────────────────────

function RackCard({ rack, expanded, onToggle, onSelectSlot, selectedSlotId }: {
  rack: RackData; expanded: boolean; onToggle: () => void;
  onSelectSlot: (s: SlotData) => void; selectedSlotId: string;
}) {
  const m = rackMetrics(rack);
  const lvl = levelOf(m.utilPct, m.blocked, m.total);
  const cfg = LEVEL_CFG[lvl];
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-3.5 hover:bg-slate-50 transition-colors text-left">
        <span className={cn('h-9 w-9 rounded-lg grid place-items-center flex-shrink-0', lvl === 'critical' ? 'bg-red-50 text-red-600' : lvl === 'warning' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600')}>
          <Layers className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-bold text-slate-800 text-sm truncate">{rack.code}</p>
            {rack.zone && <span className="text-[10px] text-slate-400 uppercase">{rack.zone}</span>}
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', cfg.pill)}>{cfg.label}</span>
          </div>
          <p className="text-xs text-slate-400">{rack.name ?? rack.rackType.replace(/_/g, ' ')}</p>
        </div>
        {/* Enhanced rack metrics */}
        <div className="hidden sm:flex items-center gap-4 text-center flex-shrink-0">
          <Metric value={m.items} label="Items" />
          <Metric value={`${m.utilPct}%`} label="Util" />
          <Metric value={`${m.occupied}/${m.total}`} label="Slots" />
          <div className="text-center">
            <p className="text-[11px] text-slate-400 leading-tight">Last move</p>
            <p className="text-[11px] font-medium text-slate-600">{rack.updatedAt ? formatDate(rack.updatedAt) : '—'}</p>
          </div>
        </div>
        <ChevronRight className={cn('h-4 w-4 text-slate-300 flex-shrink-0 transition-transform', expanded && 'rotate-90')} />
      </button>

      {expanded && (
        <div className="border-t border-slate-100 p-3.5 bg-slate-50/50">
          {rack.slots.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">No slots in this rack</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {rack.slots.map((s) => {
                  const blocked = isBlocked(s);
                  const occ = isOccupied(s);
                  const util = slotUtil(s);
                  return (
                    <button key={s.id} onClick={() => onSelectSlot(s)} title={`${s.code} · ${SLOT_CFG[s.status].label} · ${slotItems(s)} items`}
                      className={cn('h-9 min-w-9 px-1.5 rounded-md border text-[10px] font-bold grid place-items-center transition-all',
                        blocked ? 'bg-red-100 border-red-300 text-red-600' : heatCell(util, occ),
                        selectedSlotId === s.id && 'ring-2 ring-offset-1 ring-slate-900')}>
                      {blocked ? <Ban className="h-3.5 w-3.5" /> : slotItems(s) || ''}
                    </button>
                  );
                })}
              </div>
              <HeatLegend />
            </>
          )}
        </div>
      )}
    </div>
  );
}
function Metric({ value, label }: { value: React.ReactNode; label: string }) {
  return <div className="text-center"><p className="text-sm font-bold text-slate-800 tabular-nums leading-tight">{value}</p><p className="text-[11px] text-slate-400 leading-tight">{label}</p></div>;
}
function HeatLegend() {
  const items = [['bg-emerald-100 border-emerald-200', 'Available'], ['bg-emerald-500', 'Low'], ['bg-yellow-400', 'Medium'], ['bg-orange-500', 'High'], ['bg-red-500', 'Critical'], ['bg-red-100 border-red-300', 'Blocked']];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 pt-3 border-t border-slate-200">
      {items.map(([c, l]) => <span key={l} className="flex items-center gap-1 text-[10px] text-slate-500"><span className={cn('h-2.5 w-2.5 rounded-sm border', c)} />{l}</span>)}
    </div>
  );
}

// ─── Location Profile + Quick Actions (Right, fixed) ────────────────────────────

function LocationProfile({ wh, rack, slot, detail, loadingDetail }: {
  wh?: WarehouseData | null; rack?: RackData | null; slot?: SlotData | null; detail: any; loadingDetail: boolean;
}) {
  const items = detail?.stockItems ?? [];
  const qty = items.reduce((a: number, it: any) => a + (it.quantity ?? 0), 0);
  const skuCount = new Set(items.map((it: any) => it.product?.code)).size;
  const util = slot ? slotUtil(slot) : 0;
  const lastMove = items[0]?.updatedAt ?? slot?.updatedAt;

  if (!slot) return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm text-center">
      <MapPin className="h-8 w-8 mx-auto text-slate-300" />
      <p className="mt-2 text-sm font-medium text-slate-600">Location Profile</p>
      <p className="text-xs text-slate-400">Select a slot from the heatmap to inspect it</p>
    </div>
  );

  const rows: [string, React.ReactNode][] = [
    ['Warehouse', wh?.name ?? '—'],
    ['Rack', rack?.code ?? '—'],
    ['Slot', slot.code],
    ['Status', <span key="s" className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', SLOT_CFG[slot.status].pill)}>{SLOT_CFG[slot.status].label}</span>],
    ['Stock Quantity', loadingDetail ? '…' : qty.toLocaleString()],
    ['SKU Count', loadingDetail ? '…' : skuCount],
    ['Capacity Utilization', `${util}% (${slotItems(slot)}/${slot.capacity})`],
    ['Last Movement', lastMove ? formatDate(lastMove) : '—'],
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-3">Location Profile</h2>
      <dl className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 text-sm">
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-semibold text-slate-800 text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {!loadingDetail && items.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Stock in location</p>
          <ul className="space-y-1.5 max-h-40 overflow-y-auto">
            {items.map((it: any) => (
              <li key={it.id} className="flex items-center gap-2 text-xs">
                <Package className="h-3.5 w-3.5 text-slate-300 flex-shrink-0" />
                <span className="font-mono font-semibold text-slate-700">{it.product?.code}</span>
                <span className="text-slate-400 truncate flex-1">{it.product?.name}</span>
                <span className="tabular-nums text-slate-600">{it.quantity}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function QuickActions({ slot, onAction }: { slot: SlotData | null; onAction: (a: string) => void }) {
  const ACTIONS = [
    { id: 'edit',     label: 'Edit Location',  icon: Pencil,        needsSlot: true },
    { id: 'move',     label: 'Move Stock',     icon: Move,          needsSlot: false },
    { id: 'transfer', label: 'Transfer Stock', icon: ArrowRightLeft, needsSlot: false },
    { id: 'block',    label: slot?.status === 'BLOCKED' ? 'Unblock Location' : 'Block Location', icon: Ban, needsSlot: true },
    { id: 'cycle',    label: 'Cycle Count',    icon: ScanLine,      needsSlot: false },
    { id: 'history',  label: 'View History',   icon: History,       needsSlot: false },
    { id: 'print',    label: 'Print Label',    icon: Printer,       needsSlot: true },
    { id: 'create',   label: 'Create Location',icon: Plus,          needsSlot: false },
  ];
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-3">Quick Actions</h2>
      <div className="grid grid-cols-2 gap-2">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          const disabled = a.needsSlot && !slot;
          const danger = a.id === 'block' && slot?.status !== 'BLOCKED';
          return (
            <button key={a.id} disabled={disabled} onClick={() => onAction(a.id)}
              className={cn('flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors',
                disabled ? 'border-slate-100 text-slate-300 cursor-not-allowed'
                  : danger ? 'border-slate-200 text-slate-600 hover:border-red-300 hover:bg-red-50 hover:text-red-600'
                  : 'border-slate-200 text-slate-600 hover:border-green-300 hover:bg-green-50 hover:text-green-700')}>
              <Icon className="h-4 w-4" />
              <span className="text-[11px] font-medium leading-tight">{a.label}</span>
            </button>
          );
        })}
      </div>
      {!slot && <p className="mt-2 text-[10px] text-slate-400 text-center">Select a slot to enable location actions</p>}
    </div>
  );
}

// ─── Modals (reused) ────────────────────────────────────────────────────────────

function ModalWrap({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>{children}</div>;
}

function CreateRackModal({ whId, onClose, onDone }: { whId: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ code: '', name: '', zone: '', rackType: 'STANDARD', levels: 5, columns: 10 });
  const [busy, setBusy] = useState(false);
  const F = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code) { toast.error('Rack code required'); return; }
    setBusy(true);
    try { await warehouseApi.createRack({ ...form, warehouseId: whId, levels: +form.levels, columns: +form.columns }); toast.success(`Rack ${form.code} created`); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <ModalWrap title="Create Location (Rack)" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Fld label="Rack Code *"><Input placeholder="R-01" value={form.code} onChange={F('code')} /></Fld>
          <Fld label="Name"><Input placeholder="Rack A1" value={form.name} onChange={F('name')} /></Fld>
          <Fld label="Zone"><Input placeholder="ZONE-A" value={form.zone} onChange={F('zone')} /></Fld>
          <Fld label="Type"><select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={form.rackType} onChange={F('rackType')}>
            {['STANDARD','DRIVE_IN','PUSH_BACK','CANTILEVER','FLOW','MEZZANINE','PALLET'].map((t) => <option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}
          </select></Fld>
          <Fld label="Levels"><Input type="number" min={1} value={form.levels} onChange={F('levels')} /></Fld>
          <Fld label="Columns"><Input type="number" min={1} value={form.columns} onChange={F('columns')} /></Fld>
        </div>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700 text-white" disabled={busy}>{busy ? 'Creating…' : 'Create Rack'}</Button>
        </div>
      </form>
    </ModalWrap>
  );
}

function EditSlotModal({ slot, onClose, onDone }: { slot: SlotData; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: slot.name ?? '', slotType: slot.slotType, capacity: slot.capacity, status: slot.status });
  const [busy, setBusy] = useState(false);
  const F = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await warehouseApi.updateSlot(slot.id, { ...form, capacity: +form.capacity }); toast.success(`Slot ${slot.code} updated`); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <ModalWrap title={`Edit Location — ${slot.code}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Fld label="Name"><Input value={form.name} onChange={F('name')} /></Fld>
          <Fld label="Capacity"><Input type="number" min={1} value={form.capacity} onChange={F('capacity')} /></Fld>
          <Fld label="Slot Type"><select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={form.slotType} onChange={F('slotType')}>
            {['STANDARD','PALLET','BULK','COLD','HAZMAT','OVERSIZE'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select></Fld>
          <Fld label="Status"><select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={form.status} onChange={F('status')}>
            {(['EMPTY','OCCUPIED','RESERVED','QUARANTINE','RTV','BLOCKED'] as SlotStatus[]).map((t) => <option key={t} value={t}>{SLOT_CFG[t].label}</option>)}
          </select></Fld>
        </div>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700 text-white" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </ModalWrap>
  );
}

// ─── Print label (client-side, no API) ──────────────────────────────────────────

function printLabel(wh: WarehouseData | null, rack: RackData | null, slot: SlotData) {
  const w = window.open('', '_blank', 'width=420,height=300');
  if (!w) { toast.error('Pop-up blocked'); return; }
  w.document.write(`<html><head><title>Label ${slot.code}</title><style>
    body{font-family:Segoe UI,sans-serif;margin:0;padding:24px}
    .lbl{border:2px solid #111;border-radius:10px;padding:18px;width:320px}
    .code{font-size:30px;font-weight:800;letter-spacing:1px}
    .row{font-size:13px;color:#333;margin-top:4px}
    .muted{color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1px}
  </style></head><body onload="window.print()">
    <div class="lbl">
      <div class="muted">Hightpoint WMS · Location</div>
      <div class="code">${slot.code}</div>
      <div class="row">${wh?.name ?? ''} · ${rack?.code ?? ''}</div>
      <div class="row muted">${slot.slotType} · cap ${slot.capacity}</div>
    </div>
  </body></html>`);
  w.document.close();
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function WarehouseControlCenter() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWhId, setSelectedWhId] = useState('');
  const [expandedRackId, setExpandedRackId] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<SlotData | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState('');
  type ModalState = { type: 'createRack'; whId: string } | { type: 'editSlot'; slot: SlotData } | null;
  const [modal, setModal] = useState<ModalState>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const whs = await warehouseApi.list();
      setWarehouses(whs);
      setSelectedWhId((cur) => cur || whs[0]?.id || '');
    } catch { toast.error('Failed to load warehouses'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const selectedWh = warehouses.find((w) => w.id === selectedWhId) ?? null;
  const selectedRack = selectedWh?.racks.find((r) => r.id === expandedRackId) ?? null;
  const rackOfSelectedSlot = selectedWh?.racks.find((r) => r.slots.some((s) => s.id === selectedSlot?.id)) ?? selectedRack;

  // Global capacity KPIs (placement-based)
  const kpis = useMemo(() => {
    const agg = warehouses.reduce((acc, w) => {
      const m = whMetrics(w);
      return { total: acc.total + m.total, occupied: acc.occupied + m.occupied, available: acc.available + m.available, blocked: acc.blocked + m.blocked };
    }, { total: 0, occupied: 0, available: 0, blocked: 0 });
    return { warehouses: warehouses.length, ...agg, rate: agg.total ? Math.round((agg.occupied / agg.total) * 100) : 0 };
  }, [warehouses]);

  async function selectSlot(s: SlotData) {
    setSelectedSlot(s);
    setLoadingDetail(true);
    try { setDetail(await warehouseApi.getSlotDetail(s.id)); }
    catch { setDetail(null); }
    finally { setLoadingDetail(false); }
  }

  async function handleAction(a: string) {
    const slot = selectedSlot;
    switch (a) {
      case 'edit': if (slot) setModal({ type: 'editSlot', slot }); break;
      case 'create': setModal({ type: 'createRack', whId: selectedWhId }); break;
      case 'move':
      case 'transfer': router.push('/transfer'); break;
      case 'cycle': router.push('/cycle-count'); break;
      case 'history': router.push('/audit'); break;
      case 'print': if (slot) printLabel(selectedWh, rackOfSelectedSlot, slot); break;
      case 'block':
        if (!slot) break;
        try {
          const next = slot.status === 'BLOCKED' ? 'EMPTY' : 'BLOCKED';
          await warehouseApi.updateSlot(slot.id, { status: next });
          toast.success(`Slot ${slot.code} → ${SLOT_CFG[next as SlotStatus].label}`);
          await load(); await selectSlot({ ...slot, status: next as SlotStatus });
        } catch (e: any) { toast.error(e.message); }
        break;
    }
  }

  const filteredRacks = (selectedWh?.racks ?? []).filter((r) =>
    !search || r.code.toLowerCase().includes(search.toLowerCase()) || (r.name ?? '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-4 sm:p-5 space-y-4 bg-slate-50 min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">Hightpoint Service Network</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-0.5">Warehouse Operations Control Center</h1>
          <p className="text-slate-500 text-sm mt-0.5">Live occupancy from actual stock placement</p>
        </div>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-white" onClick={load} disabled={loading}>
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> Refresh
        </Button>
      </div>

      {/* Row 1 — Capacity Dashboard */}
      <CapacityDashboard kpis={kpis} loading={loading} />

      {/* Row 2 — Storage Utilization + warehouse selector */}
      <WarehouseUtilization warehouses={warehouses} selectedId={selectedWhId} onSelect={(id) => { setSelectedWhId(id); setExpandedRackId(''); setSelectedSlot(null); setDetail(null); }} loading={loading} />

      {/* Row 3 — Working area: heatmap (center) + profile & quick actions (right, fixed) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        {/* Center: racks + slot heatmap */}
        <div className="xl:col-span-2 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">{selectedWh ? `${selectedWh.name} · Racks & Slots` : 'Racks & Slots'}</h2>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rack…" className="h-8 w-40 text-xs" />
              </div>
              <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700 text-white gap-1.5 text-xs" onClick={() => setModal({ type: 'createRack', whId: selectedWhId })} disabled={!selectedWhId}>
                <Plus className="w-3.5 h-3.5" /> Create Location
              </Button>
            </div>
          </div>
          {loading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : filteredRacks.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center shadow-sm">
              <Layers className="h-10 w-10 mx-auto text-slate-300" />
              <p className="mt-2 text-sm font-medium text-slate-600">{selectedWh ? 'No racks in this warehouse yet' : 'Select a warehouse'}</p>
              {selectedWh && <p className="text-xs text-slate-400 mt-0.5">Use “Create Location” to add racks &amp; slots</p>}
            </div>
          ) : (
            filteredRacks.map((rack) => (
              <RackCard key={rack.id} rack={rack}
                expanded={expandedRackId === rack.id}
                onToggle={() => setExpandedRackId((cur) => cur === rack.id ? '' : rack.id)}
                onSelectSlot={selectSlot} selectedSlotId={selectedSlot?.id ?? ''} />
            ))
          )}
        </div>

        {/* Right: fixed quick actions + location profile */}
        <div className="space-y-4 xl:sticky xl:top-4">
          <QuickActions slot={selectedSlot} onAction={handleAction} />
          <LocationProfile wh={selectedWh} rack={rackOfSelectedSlot} slot={selectedSlot} detail={detail} loadingDetail={loadingDetail} />
        </div>
      </div>

      {/* Modals */}
      {modal?.type === 'createRack' && (
        <CreateRackModal whId={modal.whId} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />
      )}
      {modal?.type === 'editSlot' && (
        <EditSlotModal slot={modal.slot} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); selectSlot(modal.slot); }} />
      )}
    </div>
  );
}
