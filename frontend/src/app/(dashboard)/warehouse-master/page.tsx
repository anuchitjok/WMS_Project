'use client';

// Warehouse Master — structure administration (Warehouse → Rack → Slot).
// Separate from the Operations Control Center. Backend enforces RBAC; the UI
// additionally hides/disables write actions and guards direct navigation.
// Uses /warehouse-master endpoints only. White + green enterprise theme.

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2, Layers, MapPin, RefreshCw, Plus, Pencil, Trash2, X, ChevronRight,
  Power, PowerOff, ShieldAlert, CheckCircle2, Boxes, Grid3x3, Warehouse as WhIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { warehouseMasterApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import type { UserRole } from '@/types';

const VIEW_ROLES: UserRole[] = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER', 'WAREHOUSE_SUPERVISOR', 'WAREHOUSE_STAFF'];
const WRITE_ROLES: UserRole[] = ['SYSTEM_ADMIN', 'WAREHOUSE_MANAGER'];

type Sel =
  | { type: 'warehouse'; data: any }
  | { type: 'rack'; data: any; warehouse: any }
  | { type: 'slot'; data: any; rack: any; warehouse: any }
  | null;

export default function WarehouseMasterPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canWrite = !!user && WRITE_ROLES.includes(user.role);

  const [tree, setTree] = useState<any[]>([]);
  const [summary, setSummary] = useState<{ totalWarehouses: number; activeWarehouses: number; totalRacks: number; totalSlots: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Sel>(null);
  const [openWh, setOpenWh] = useState<Set<string>>(new Set());
  const [openRack, setOpenRack] = useState<Set<string>>(new Set());

  type Modal =
    | { kind: 'wh'; mode: 'create' | 'edit'; data?: any }
    | { kind: 'rack'; mode: 'create' | 'edit'; warehouseId?: string; data?: any }
    | { kind: 'slot'; mode: 'create' | 'edit'; rackId?: string; data?: any }
    | { kind: 'delete'; entity: 'rack' | 'slot'; id: string; label: string }
    | null;
  const [modal, setModal] = useState<Modal>(null);

  // ── Route guard: prevent direct navigation by unauthorized roles ─────────────
  useEffect(() => {
    if (user && !VIEW_ROLES.includes(user.role)) router.replace('/dashboard');
  }, [user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([warehouseMasterApi.tree(), warehouseMasterApi.summary()]);
      setTree(t); setSummary(s);
    } catch { toast.error('Failed to load warehouse master'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // keep selection fresh after reloads
  useEffect(() => {
    if (!sel) return;
    if (sel.type === 'warehouse') { const w = tree.find((x) => x.id === sel.data.id); if (w) setSel({ type: 'warehouse', data: w }); }
  }, [tree]); // eslint-disable-line

  if (user && !VIEW_ROLES.includes(user.role)) return null;

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    set((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function doAction(fn: () => Promise<any>, ok: string) {
    try { await fn(); toast.success(ok); setModal(null); await load(); }
    catch (e: any) { toast.error(e.message); }
  }

  // Single source of truth for structural actions — shared by the detail panel's
  // contextual CTA and the Quick Actions menu so both trigger identical behavior.
  function handleAction(a: string) {
    if (!sel && a !== 'createWh') return;
    switch (a) {
      case 'createWh': setModal({ kind: 'wh', mode: 'create' }); break;
      case 'editWh': if (sel?.type === 'warehouse') setModal({ kind: 'wh', mode: 'edit', data: sel.data }); break;
      case 'activate': if (sel?.type === 'warehouse') doAction(() => warehouseMasterApi.activateWarehouse(sel.data.id), 'Warehouse activated'); break;
      case 'deactivate': if (sel?.type === 'warehouse') doAction(() => warehouseMasterApi.deactivateWarehouse(sel.data.id), 'Warehouse deactivated'); break;
      case 'createRack': if (sel?.type === 'warehouse') setModal({ kind: 'rack', mode: 'create', warehouseId: sel.data.id }); break;
      case 'editRack': if (sel?.type === 'rack') setModal({ kind: 'rack', mode: 'edit', data: sel.data }); break;
      case 'deleteRack': if (sel?.type === 'rack') setModal({ kind: 'delete', entity: 'rack', id: sel.data.id, label: sel.data.code }); break;
      case 'createSlot': if (sel?.type === 'rack') setModal({ kind: 'slot', mode: 'create', rackId: sel.data.id }); break;
      case 'editSlot': if (sel?.type === 'slot') setModal({ kind: 'slot', mode: 'edit', data: sel.data }); break;
      case 'deleteSlot': if (sel?.type === 'slot') setModal({ kind: 'delete', entity: 'slot', id: sel.data.id, label: sel.data.code }); break;
    }
  }

  return (
    <div className="p-4 sm:p-5 space-y-4 bg-slate-50 min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">Hightpoint Service Network</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-0.5">Warehouse Master</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage Warehouse · Rack · Slot structure {canWrite ? '' : '· read-only'}</p>
        </div>
        <div className="flex items-center gap-2">
          {canWrite && (
            <Button size="sm" className="h-9 gap-1.5 bg-green-600 hover:bg-green-700 text-white" onClick={() => setModal({ kind: 'wh', mode: 'create' })}>
              <Plus className="w-4 h-4" /> New Warehouse
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-white" onClick={load} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </div>

      {/* Row 1 — Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Warehouses', value: summary?.totalWarehouses, icon: WhIcon, tile: 'bg-green-50 text-green-600' },
          { label: 'Active Warehouses', value: summary?.activeWarehouses, icon: CheckCircle2, tile: 'bg-green-50 text-green-600' },
          { label: 'Total Racks', value: summary?.totalRacks, icon: Layers, tile: 'bg-slate-100 text-slate-600' },
          { label: 'Total Slots', value: summary?.totalSlots, icon: Grid3x3, tile: 'bg-slate-100 text-slate-600' },
        ].map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <span className={cn('h-10 w-10 rounded-xl grid place-items-center', c.tile)}><Icon className="h-5 w-5" /></span>
              {loading ? <Skeleton className="h-8 w-12 mt-3" /> : <p className="mt-3 text-2xl font-bold text-slate-900 tabular-nums leading-none">{c.value ?? 0}</p>}
              <p className="mt-1.5 text-[13px] font-medium text-slate-500">{c.label}</p>
            </div>
          );
        })}
      </div>

      {/* Row 2 — Tree | Detail | Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start">
        {/* Left — Tree */}
        <div className="lg:col-span-1 xl:col-span-1 bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide px-2 pt-1.5">Structure</h2>
          {/* Persistent orientation cue — the create flow is otherwise easy to miss */}
          <p className="px-2 pb-2 pt-0.5 text-[11px] leading-snug text-slate-400">
            Select a <span className="text-green-600 font-medium">Warehouse</span> to add Racks · a <span className="text-green-600 font-medium">Rack</span> to add Slots
          </p>
          {loading ? (
            <div className="space-y-1 mt-1">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : tree.length === 0 ? (
            <div className="mt-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
              <WhIcon className="h-8 w-8 mx-auto text-slate-300" />
              <p className="mt-2 text-sm font-medium text-slate-600">No warehouses yet</p>
              <p className="mt-1 text-xs text-slate-400">Start by creating a warehouse, then add racks and slots inside it.</p>
              {canWrite && (
                <Button size="sm" className="mt-3 gap-1.5 bg-green-600 hover:bg-green-700 text-white" onClick={() => setModal({ kind: 'wh', mode: 'create' })}>
                  <Plus className="w-4 h-4" /> Create your first warehouse
                </Button>
              )}
            </div>
          ) : (
            <div className="mt-1 space-y-0.5 max-h-[70vh] overflow-y-auto">
              {tree.map((w) => (
                <div key={w.id}>
                  <Node
                    icon={WhIcon} label={w.name} sub={w.code}
                    badge={w.isActive ? null : 'Inactive'} depth={0}
                    hasChildren={(w.racks?.length ?? 0) > 0}
                    open={openWh.has(w.id)} onToggle={() => toggle(setOpenWh, w.id)}
                    selected={sel?.type === 'warehouse' && sel.data.id === w.id}
                    onSelect={() => setSel({ type: 'warehouse', data: w })}
                  />
                  {openWh.has(w.id) && (w.racks ?? []).map((r: any) => (
                    <div key={r.id}>
                      <Node
                        icon={Layers} label={r.code} sub={r.name ?? r.rackType} depth={1}
                        hasChildren={(r.slots?.length ?? 0) > 0}
                        open={openRack.has(r.id)} onToggle={() => toggle(setOpenRack, r.id)}
                        selected={sel?.type === 'rack' && sel.data.id === r.id}
                        onSelect={() => setSel({ type: 'rack', data: r, warehouse: w })}
                      />
                      {openRack.has(r.id) && (r.slots ?? []).map((s: any) => (
                        <Node key={s.id} icon={MapPin} label={s.code} sub={`L${s.level}·C${s.column}`} depth={2}
                          selected={sel?.type === 'slot' && sel.data.id === s.id}
                          onSelect={() => setSel({ type: 'slot', data: s, rack: r, warehouse: w })}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Center — Detail */}
        <div className="lg:col-span-2 xl:col-span-2">
          <DetailPanel sel={sel} canWrite={canWrite} onAction={handleAction} />
        </div>

        {/* Right — Quick Actions */}
        <div className="lg:col-span-3 xl:col-span-1">
          <QuickActions sel={sel} canWrite={canWrite} onAction={handleAction} />
        </div>
      </div>

      {/* Modals */}
      {modal?.kind === 'wh' && <WarehouseModal mode={modal.mode} data={modal.data} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      {modal?.kind === 'rack' && <RackModal mode={modal.mode} warehouseId={modal.warehouseId} data={modal.data} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      {modal?.kind === 'slot' && <SlotModal mode={modal.mode} rackId={modal.rackId} data={modal.data} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      {modal?.kind === 'delete' && <DeleteDialog entity={modal.entity} id={modal.id} label={modal.label} onClose={() => setModal(null)} onDeleted={() => { setModal(null); setSel(null); load(); }} />}
    </div>
  );
}

// ─── Tree node ──────────────────────────────────────────────────────────────────
function Node({ icon: Icon, label, sub, badge, depth, hasChildren, open, onToggle, selected, onSelect }: any) {
  return (
    <div
      onClick={onSelect}
      className={cn('flex items-center gap-1.5 rounded-lg pr-2 py-1.5 cursor-pointer transition-colors',
        selected ? 'bg-green-50 ring-1 ring-green-200' : 'hover:bg-slate-50')}
      style={{ paddingLeft: 6 + depth * 16 }}
    >
      {hasChildren ? (
        <button onClick={(e) => { e.stopPropagation(); onToggle(); }} className="p-0.5 text-slate-400 hover:text-slate-600">
          <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-90')} />
        </button>
      ) : <span className="w-[18px]" />}
      <Icon className={cn('w-4 h-4 flex-shrink-0', selected ? 'text-green-600' : 'text-slate-400')} />
      <span className="text-sm font-medium text-slate-700 truncate flex-1">{label}</span>
      {sub && <span className="text-[10px] text-slate-400 truncate max-w-[80px]">{sub}</span>}
      {badge && <span className="text-[9px] font-bold uppercase rounded px-1 py-0.5 bg-slate-100 text-slate-500">{badge}</span>}
    </div>
  );
}

// ─── Detail panel ────────────────────────────────────────────────────────────────
function DetailPanel({ sel, canWrite, onAction }: { sel: Sel; canWrite: boolean; onAction: (a: string) => void }) {
  if (!sel) return (
    <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-sm text-center">
      <Building2 className="h-9 w-9 mx-auto text-slate-300" />
      <p className="mt-2 text-sm font-medium text-slate-600">Select a warehouse to begin</p>
      <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
        Click a node in the Structure tree to see its details. Selecting a Warehouse lets you add Racks; selecting a Rack lets you add Slots.
      </p>
    </div>
  );

  // Breadcrumb path so the operator always knows where the selected node sits.
  const crumbs: string[] =
    sel.type === 'warehouse' ? [sel.data.name]
    : sel.type === 'rack' ? [sel.warehouse.name, sel.data.code]
    : [sel.warehouse.name, sel.rack.code, sel.data.code];

  const rows: [string, React.ReactNode][] =
    sel.type === 'warehouse' ? [
      ['Type', 'Warehouse'], ['Code', sel.data.code], ['Name', sel.data.name], ['Location', sel.data.location ?? '—'],
      ['Status', sel.data.isActive ? <Pill key="a" tone="green">Active</Pill> : <Pill key="i" tone="slate">Inactive</Pill>],
      ['Racks', sel.data._count?.racks ?? sel.data.racks?.length ?? 0], ['Stock items', sel.data._count?.stockItems ?? 0],
    ] : sel.type === 'rack' ? [
      ['Type', 'Rack'], ['Warehouse', sel.warehouse.name], ['Code', sel.data.code], ['Name', sel.data.name ?? '—'],
      ['Zone', sel.data.zone ?? '—'], ['Rack Type', sel.data.rackType], ['Levels × Columns', `${sel.data.levels} × ${sel.data.columns}`],
      ['Slots', sel.data._count?.slots ?? sel.data.slots?.length ?? 0], ['Stock items', sel.data._count?.stockItems ?? 0],
    ] : [
      ['Type', 'Slot'], ['Warehouse', sel.warehouse.name], ['Rack', sel.rack.code], ['Code', sel.data.code],
      ['Level · Column', `L${sel.data.level} · C${sel.data.column}`], ['Slot Type', sel.data.slotType],
      ['Capacity', sel.data.capacity],
      ['Dimensions (L×W×H cm)', sel.data.lengthCm != null && sel.data.widthCm != null && sel.data.heightCm != null
        ? `${sel.data.lengthCm} × ${sel.data.widthCm} × ${sel.data.heightCm}` : '—'],
      ['Stock items', sel.data._count?.stockItems ?? 0],
    ];

  // The single most likely next step for this node, surfaced inline (not buried in the side menu).
  const nextStep =
    sel.type === 'warehouse' ? { action: 'createRack', label: 'Add Rack to this warehouse', icon: Layers }
    : sel.type === 'rack' ? { action: 'createSlot', label: 'Add Slot to this rack', icon: MapPin }
    : null;

  const typeLabel = sel.type.charAt(0).toUpperCase() + sel.type.slice(1);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      {/* Breadcrumb — orientation / system status */}
      <nav className="flex items-center flex-wrap gap-1 text-xs text-slate-400 mb-2">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="w-3 h-3" />}
            <span className={i === crumbs.length - 1 ? 'font-medium text-slate-600' : ''}>{c}</span>
          </span>
        ))}
      </nav>
      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-3">{typeLabel} Detail</h2>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 text-sm border-b border-slate-50 pb-2">
            <dt className="text-slate-500">{k}</dt><dd className="font-semibold text-slate-800 text-right">{v}</dd>
          </div>
        ))}
      </dl>

      {/* Contextual primary next-step — placed where the eye already is (Fitts's Law) */}
      {canWrite && nextStep && (
        <button
          onClick={() => onAction(nextStep.action)}
          className="mt-4 w-full flex items-center justify-center gap-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-2.5 transition-colors"
        >
          <Plus className="w-4 h-4" /> {nextStep.label}
        </button>
      )}
      {canWrite && sel.type === 'slot' && (
        <p className="mt-4 text-center text-xs text-slate-400">This slot is ready — it will appear as a putaway destination.</p>
      )}
    </div>
  );
}
function Pill({ tone, children }: { tone: 'green' | 'slate'; children: React.ReactNode }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', tone === 'green' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{children}</span>;
}

// ─── Quick actions ───────────────────────────────────────────────────────────────
function QuickActions({ sel, canWrite, onAction }: { sel: Sel; canWrite: boolean; onAction: (a: string) => void }) {
  // Manage-actions for the currently selected node. Creating children lives on the
  // node's own detail panel (a more discoverable place), so it's not duplicated here.
  const manage: { id: string; label: string; icon: any; show: boolean }[] = [
    { id: 'editWh', label: 'Edit warehouse', icon: Pencil, show: sel?.type === 'warehouse' },
    { id: 'activate', label: 'Activate warehouse', icon: Power, show: sel?.type === 'warehouse' && !sel.data.isActive },
    { id: 'deactivate', label: 'Deactivate warehouse', icon: PowerOff, show: sel?.type === 'warehouse' && sel.data.isActive },
    { id: 'editRack', label: 'Edit rack', icon: Pencil, show: sel?.type === 'rack' },
    { id: 'editSlot', label: 'Edit slot', icon: Pencil, show: sel?.type === 'slot' },
  ].filter((i) => i.show);

  const destructive: { id: string; label: string; icon: any; show: boolean }[] = [
    { id: 'deleteRack', label: 'Delete rack', icon: Trash2, show: sel?.type === 'rack' },
    { id: 'deleteSlot', label: 'Delete slot', icon: Trash2, show: sel?.type === 'slot' },
  ].filter((i) => i.show);

  const contextLabel = !sel ? null
    : sel.type === 'warehouse' ? `Warehouse · ${sel.data.code}`
    : sel.type === 'rack' ? `Rack · ${sel.data.code}`
    : `Slot · ${sel.data.code}`;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Manage</h2>
      {contextLabel && <p className="text-[11px] text-slate-400 mb-3 mt-0.5 truncate">{contextLabel}</p>}
      {!contextLabel && <div className="mb-3" />}
      {!canWrite ? (
        <div className="text-center py-6">
          <ShieldAlert className="h-7 w-7 mx-auto text-slate-300" />
          <p className="mt-2 text-xs text-slate-400">Read-only access.<br />Editing requires Manager role.</p>
        </div>
      ) : !sel ? (
        <p className="text-xs text-slate-400 text-center py-6 leading-relaxed">
          Select a warehouse, rack, or slot<br />from the tree to edit or manage it.
        </p>
      ) : (
        <div className="space-y-2">
          {manage.map((i) => {
            const Icon = i.icon;
            return (
              <button key={i.id} onClick={() => onAction(i.id)}
                className="w-full flex items-center gap-2.5 rounded-lg border border-slate-200 p-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-green-300 hover:bg-green-50 hover:text-green-700">
                <Icon className="w-4 h-4" /> {i.label}
              </button>
            );
          })}
          {destructive.length > 0 && (
            <div className="pt-2 mt-1 border-t border-slate-100 space-y-2">
              {destructive.map((i) => {
                const Icon = i.icon;
                return (
                  <button key={i.id} onClick={() => onAction(i.id)}
                    className="w-full flex items-center gap-2.5 rounded-lg border border-slate-200 p-2.5 text-sm font-medium text-slate-600 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600">
                    <Icon className="w-4 h-4" /> {i.label}
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

// ─── Modal shell ─────────────────────────────────────────────────────────────────
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

function WarehouseModal({ mode, data, onClose, onSaved }: { mode: 'create' | 'edit'; data?: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ code: data?.code ?? '', name: data?.name ?? '', location: data?.location ?? '' });
  const [busy, setBusy] = useState(false);
  const F = (k: keyof typeof form) => (e: any) => setForm({ ...form, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      if (mode === 'create') await warehouseMasterApi.createWarehouse({ code: form.code, name: form.name, location: form.location || undefined });
      else await warehouseMasterApi.updateWarehouse(data.id, { name: form.name, location: form.location || undefined });
      toast.success(mode === 'create' ? 'Warehouse created' : 'Warehouse updated');
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <ModalWrap title={mode === 'create' ? 'Create Warehouse' : `Edit Warehouse — ${data?.code}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {mode === 'create' && <Fld label="Code *"><Input autoFocus placeholder="TOWER-D1FL" value={form.code} onChange={F('code')} /><p className="mt-1 text-[11px] text-slate-400">Unique short ID · can’t be changed later</p></Fld>}
        <Fld label="Name *"><Input autoFocus={mode !== 'create'} placeholder="Tower D1FL" value={form.name} onChange={F('name')} /></Fld>
        <Fld label="Location"><Input placeholder="Tower D · Level 1" value={form.location} onChange={F('location')} /></Fld>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700 text-white" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </ModalWrap>
  );
}

function RackModal({ mode, warehouseId, data, onClose, onSaved }: { mode: 'create' | 'edit'; warehouseId?: string; data?: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ code: data?.code ?? '', name: data?.name ?? '', zone: data?.zone ?? '', rackType: data?.rackType ?? 'STANDARD', levels: data?.levels ?? 1, columns: data?.columns ?? 1 });
  const [busy, setBusy] = useState(false);
  const F = (k: keyof typeof form) => (e: any) => setForm({ ...form, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      if (mode === 'create') await warehouseMasterApi.createRack({ warehouseId, code: form.code, name: form.name || undefined, zone: form.zone || undefined, rackType: form.rackType, levels: +form.levels, columns: +form.columns });
      else await warehouseMasterApi.updateRack(data.id, { name: form.name || undefined, zone: form.zone || undefined, rackType: form.rackType, levels: +form.levels, columns: +form.columns });
      toast.success(mode === 'create' ? 'Rack created' : 'Rack updated'); onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <ModalWrap title={mode === 'create' ? 'Create Rack' : `Edit Rack — ${data?.code}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {mode === 'create' && <Fld label="Code *"><Input autoFocus placeholder="R-03" value={form.code} onChange={F('code')} /></Fld>}
          <Fld label="Name"><Input autoFocus={mode !== 'create'} value={form.name} onChange={F('name')} /></Fld>
          <Fld label="Zone"><Input value={form.zone} onChange={F('zone')} /></Fld>
          <Fld label="Type"><select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={form.rackType} onChange={F('rackType')}>
            {['STANDARD','DRIVE_IN','PUSH_BACK','CANTILEVER','FLOW','MEZZANINE','PALLET'].map((t) => <option key={t}>{t}</option>)}
          </select></Fld>
          <Fld label="Levels"><Input type="number" min={1} value={form.levels} onChange={F('levels')} /></Fld>
          <Fld label="Columns"><Input type="number" min={1} value={form.columns} onChange={F('columns')} /></Fld>
        </div>
        <p className="text-[11px] text-slate-400 -mt-1">Levels &amp; Columns describe the rack’s size. You’ll add the actual slots one by one after saving.</p>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700 text-white" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </ModalWrap>
  );
}

function SlotModal({ mode, rackId, data, onClose, onSaved }: { mode: 'create' | 'edit'; rackId?: string; data?: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    code: data?.code ?? '', name: data?.name ?? '', slotType: data?.slotType ?? 'STANDARD',
    capacity: data?.capacity ?? 1, level: data?.level ?? 1, column: data?.column ?? 1,
    lengthCm: data?.lengthCm ?? '', widthCm: data?.widthCm ?? '', heightCm: data?.heightCm ?? '',
  });
  const [busy, setBusy] = useState(false);
  const F = (k: keyof typeof form) => (e: any) => setForm({ ...form, [k]: e.target.value });
  // Dimensions are optional — only send a field if the user actually typed a value,
  // so leaving them blank keeps the slot exactly as before (no fit-check possible).
  const dim = (v: string) => (v === '' ? undefined : +v);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      if (mode === 'create') await warehouseMasterApi.createSlot({ rackId, code: form.code, name: form.name || undefined, slotType: form.slotType, capacity: +form.capacity, level: +form.level, column: +form.column, lengthCm: dim(form.lengthCm), widthCm: dim(form.widthCm), heightCm: dim(form.heightCm) });
      else await warehouseMasterApi.updateSlot(data.id, { name: form.name || undefined, slotType: form.slotType, capacity: +form.capacity, lengthCm: dim(form.lengthCm), widthCm: dim(form.widthCm), heightCm: dim(form.heightCm) });
      toast.success(mode === 'create' ? 'Slot created' : 'Slot updated'); onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <ModalWrap title={mode === 'create' ? 'Create Slot' : `Edit Slot — ${data?.code}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {mode === 'create' && <Fld label="Code *"><Input autoFocus placeholder="R-03-01" value={form.code} onChange={F('code')} /></Fld>}
          <Fld label="Name"><Input autoFocus={mode !== 'create'} value={form.name} onChange={F('name')} /></Fld>
          <Fld label="Slot Type"><select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={form.slotType} onChange={F('slotType')}>
            {['STANDARD','PALLET','BULK','COLD','HAZMAT','OVERSIZE'].map((t) => <option key={t}>{t}</option>)}
          </select></Fld>
          <Fld label="Capacity"><Input type="number" min={1} value={form.capacity} onChange={F('capacity')} /><p className="mt-1 text-[11px] text-slate-400">Units this slot holds</p></Fld>
          {mode === 'create' && <Fld label="Level"><Input type="number" min={1} value={form.level} onChange={F('level')} /></Fld>}
          {mode === 'create' && <Fld label="Column"><Input type="number" min={1} value={form.column} onChange={F('column')} /></Fld>}
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Physical Size (cm) — optional, enables box-fit check at Putaway</p>
          <div className="grid grid-cols-3 gap-3">
            <Fld label="Length"><Input type="number" min={0} placeholder="—" value={form.lengthCm} onChange={F('lengthCm')} /></Fld>
            <Fld label="Width"><Input type="number" min={0} placeholder="—" value={form.widthCm} onChange={F('widthCm')} /></Fld>
            <Fld label="Height"><Input type="number" min={0} placeholder="—" value={form.heightCm} onChange={F('heightCm')} /></Fld>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700 text-white" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </ModalWrap>
  );
}

function DeleteDialog({ entity, id, label, onClose, onDeleted }: { entity: 'rack' | 'slot'; id: string; label: string; onClose: () => void; onDeleted: () => void }) {
  const [impact, setImpact] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { warehouseMasterApi.impact(entity, id).then(setImpact).catch(() => setImpact({ error: true })); }, [entity, id]);
  const canDelete = impact && impact.canDelete;
  async function confirm() {
    setBusy(true);
    try { await (entity === 'rack' ? warehouseMasterApi.deleteRack(id) : warehouseMasterApi.deleteSlot(id)); toast.success(`${entity} deleted`); onDeleted(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <ModalWrap title={`Delete ${entity} — ${label}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg bg-red-50 border border-red-200 p-3">
          <ShieldAlert className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">Soft delete — the record is retained for history (no physical deletion). Historical references stay valid.</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Dependency / Impact Check</p>
          {!impact ? <Skeleton className="h-12" /> : impact.error ? <p className="text-sm text-red-600">Could not load impact</p> : (
            <div className="space-y-1.5 text-sm">
              {entity === 'rack' && <>
                <Row label="Slots in rack" value={impact.slots} bad={impact.slots > 0} />
                <Row label="Stock items" value={impact.stock} bad={impact.stock > 0} />
              </>}
              {entity === 'slot' && <Row label="Stock items in slot" value={impact.stock} bad={impact.stock > 0} />}
            </div>
          )}
        </div>
        {impact && !impact.error && !canDelete && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">Cannot delete while dependencies exist. Remove them first.</p>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!canDelete || busy} onClick={confirm}
            className="flex-1 bg-destructive text-white hover:bg-red-700 disabled:opacity-50">{busy ? 'Deleting…' : 'Confirm Delete'}</Button>
        </div>
      </div>
    </ModalWrap>
  );
}
function Row({ label, value, bad }: { label: string; value: number; bad: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={cn('font-bold tabular-nums', bad ? 'text-red-600' : 'text-emerald-600')}>{value}</span>
    </div>
  );
}
