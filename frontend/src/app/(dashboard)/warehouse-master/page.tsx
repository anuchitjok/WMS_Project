'use client';

// Warehouse Master — one page to manage Warehouse → Rack → Slot (plan P1 1.1–1.7).
//   Structure tab: tree on the left, details on the right (warehouse space +
//   capacity planner, or rack template + slot grid with inline editing).
//   Rack Types tab: Rack Type Master (two categories).
//   Space Simulator tab (?tab=simulator): what-if space calculation, nothing saved.
// The backend enforces RBAC; the UI hides actions the role cannot use.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Building2, CheckCircle2, Grid3x3, Layers, Plus, RefreshCw, Warehouse as WhIcon } from 'lucide-react';
import { toast } from 'sonner';
import { warehouseMasterApi } from '@/lib/api';
import { warehouseSpaceApi, type RackTypeMaster, type WarehouseSpaceSummary } from '@/lib/api-warehouse';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getT, useT } from '@/i18n';
import { useWarehouseMasterPerms } from '@/components/warehouse-master/shared';
import { StructureTree, type Selection } from '@/components/warehouse-master/structure-tree';
import { WarehouseDetail } from '@/components/warehouse-master/warehouse-detail';
import { RackDetail } from '@/components/warehouse-master/rack-detail';
import { RackTypesTab } from '@/components/warehouse-master/rack-types-tab';
import { SpaceSimulator } from '@/components/warehouse-master/space-simulator';
import { DeleteRackDialog, RackForm, WarehouseForm } from '@/components/warehouse-master/forms';

type Tab = 'structure' | 'rack-types' | 'simulator';
const TABS: Tab[] = ['structure', 'rack-types', 'simulator'];

type Modal =
  | { kind: 'wh'; mode: 'create' | 'edit'; data?: any }
  | { kind: 'rack'; mode: 'create' | 'edit'; warehouseId?: string; data?: any; templateId?: string }
  | { kind: 'deleteRack'; id: string; code: string }
  | null;

export default function WarehouseMasterPage() {
  return (
    <Suspense fallback={<div className="p-5"><Skeleton className="h-[600px]" /></div>}>
      <WarehouseMasterInner />
    </Suspense>
  );
}

function WarehouseMasterInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { m } = useT();
  const wm = m.warehouseMaster;
  const { user, canView, isAdmin, canEditLayout } = useWarehouseMasterPerms();

  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'structure';
  const setTab = (next: Tab) => router.replace(next === 'structure' ? '/warehouse-master' : `/warehouse-master?tab=${next}`, { scroll: false });

  const [tree, setTree] = useState<any[]>([]);
  const [summary, setSummary] = useState<{ totalWarehouses: number; activeWarehouses: number; totalRacks: number; totalSlots: number } | null>(null);
  const [space, setSpace] = useState<WarehouseSpaceSummary[]>([]);
  const [rackTypes, setRackTypes] = useState<RackTypeMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Selection>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<Modal>(null);

  // Route guard: prevent direct navigation by roles without access.
  useEffect(() => { if (user && !canView) router.replace('/dashboard'); }, [user, canView, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tr, s, sp, rt] = await Promise.all([
        warehouseMasterApi.tree(),
        warehouseMasterApi.summary(),
        warehouseSpaceApi.spaceSummary().catch(() => null),
        warehouseSpaceApi.rackTypes(true).catch(() => [] as RackTypeMaster[]),
      ]);
      setTree(tr); setSummary(s); setSpace(sp?.warehouses ?? []); setRackTypes(rt);
    } catch { toast.error(getT().m.warehouseMaster.loadFailed); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const spaceById = useMemo(() => new Map(space.map((s) => [s.warehouseId, s])), [space]);
  const selWarehouse = selection ? tree.find((w) => w.id === (selection.type === 'warehouse' ? selection.id : selection.warehouseId)) : undefined;
  const selRack = selection?.type === 'rack' ? selWarehouse?.racks?.find((r: any) => r.id === selection.id) : undefined;

  if (user && !canView) return null;

  const toggle = (id: string) => setOpen((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const afterSave = () => { setModal(null); load(); };

  async function toggleActive(w: any) {
    const f = getT().m.warehouseMaster.form;
    try {
      if (w.isActive) { await warehouseMasterApi.deactivateWarehouse(w.id); toast.success(f.warehouseDeactivated); }
      else { await warehouseMasterApi.activateWarehouse(w.id); toast.success(f.warehouseActivated); }
      await load();
    } catch (err: any) { toast.error(err.message); }
  }

  const kpis = [
    { label: wm.kpi.warehouses, value: summary?.totalWarehouses, icon: WhIcon },
    { label: wm.kpi.activeWarehouses, value: summary?.activeWarehouses, icon: CheckCircle2 },
    { label: wm.kpi.racks, value: summary?.totalRacks, icon: Layers },
    { label: wm.kpi.slots, value: summary?.totalSlots, icon: Grid3x3 },
  ];
  const tabLabel: Record<Tab, string> = { structure: wm.tabs.structure, 'rack-types': wm.tabs.rackTypes, simulator: wm.tabs.simulator };

  return (
    <div className="p-4 sm:p-5 space-y-4 bg-slate-50 min-h-full">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-green-700">{wm.eyebrow}</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-0.5">{wm.title}</h1>
          <p className="text-slate-500 text-sm mt-0.5">{wm.subtitle}{!canEditLayout && ` · ${wm.readOnly}`}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && tab === 'structure' && (
            <Button size="sm" className="h-9 gap-1.5 bg-green-600 hover:bg-green-700 text-white" onClick={() => setModal({ kind: 'wh', mode: 'create' })}>
              <Plus className="w-4 h-4" /> {wm.actions.newWarehouse}
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-white" onClick={load} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> {m.common.actions.refresh}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-1 overflow-x-auto">
        {TABS.map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={cn('px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors',
              tab === k ? 'border-green-600 text-green-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800')}>
            {tabLabel[k]}
          </button>
        ))}
      </div>

      {tab === 'structure' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {kpis.map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center gap-3">
                  <span className="h-10 w-10 rounded-lg grid place-items-center bg-green-50 text-green-600 flex-shrink-0"><Icon className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    {loading ? <Skeleton className="h-7 w-12" /> : <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{c.value ?? 0}</p>}
                    <p className="mt-1 text-sm text-slate-500 truncate">{c.label}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-1">
              <StructureTree
                tree={tree} space={spaceById} loading={loading} selection={selection} open={open}
                onToggle={toggle}
                onSelect={(s) => { setSelection(s); if (s?.type === 'warehouse') setOpen((cur) => new Set(cur).add(s.id)); }}
                canCreate={isAdmin} onCreateWarehouse={() => setModal({ kind: 'wh', mode: 'create' })}
              />
            </div>
            <div className="lg:col-span-2 min-w-0">
              {selRack && selWarehouse ? (
                <RackDetail
                  rack={selRack} warehouse={selWarehouse} canEditLayout={canEditLayout}
                  onEdit={() => setModal({ kind: 'rack', mode: 'edit', data: selRack })}
                  onDelete={() => setModal({ kind: 'deleteRack', id: selRack.id, code: selRack.code })}
                  onChanged={load}
                />
              ) : selWarehouse ? (
                <WarehouseDetail
                  warehouse={selWarehouse} space={spaceById.get(selWarehouse.id)} rackTypes={rackTypes}
                  isAdmin={isAdmin} canEditLayout={canEditLayout}
                  onEdit={() => setModal({ kind: 'wh', mode: 'edit', data: selWarehouse })}
                  onToggleActive={() => toggleActive(selWarehouse)}
                  onAddRack={(templateId) => setModal({ kind: 'rack', mode: 'create', warehouseId: selWarehouse.id, templateId })}
                  onSelectRack={(id) => setSelection({ type: 'rack', id, warehouseId: selWarehouse.id })}
                />
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-sm text-center">
                  <Building2 className="h-9 w-9 mx-auto text-slate-300" />
                  <p className="mt-2 text-sm font-medium text-slate-600">{wm.detail.nothingSelected}</p>
                  <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">{wm.detail.nothingSelectedHint}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'rack-types' && <RackTypesTab rackTypes={rackTypes} loading={loading} isAdmin={isAdmin} onChanged={load} />}
      {tab === 'simulator' && <SpaceSimulator warehouses={space} />}

      {/* Modals */}
      {modal?.kind === 'wh' && <WarehouseForm mode={modal.mode} data={modal.data} onClose={() => setModal(null)} onSaved={afterSave} />}
      {modal?.kind === 'rack' && (
        <RackForm mode={modal.mode} warehouseId={modal.warehouseId} data={modal.data} rackTypes={rackTypes} prefillTemplateId={modal.templateId}
          warehouse={tree.find((w) => w.id === (modal.warehouseId ?? modal.data?.warehouseId)) ?? null}
          onClose={() => setModal(null)} onSaved={afterSave} />
      )}
      {modal?.kind === 'deleteRack' && (
        <DeleteRackDialog id={modal.id} code={modal.code} onClose={() => setModal(null)}
          onDeleted={() => { setModal(null); setSelection((s) => (s?.type === 'rack' ? { type: 'warehouse', id: s.warehouseId } : s)); load(); }} />
      )}
    </div>
  );
}
