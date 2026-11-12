'use client';

// Right panel for a warehouse: size, space used/free, rack list, capacity planner.
import { useEffect, useState } from 'react';
import { Calculator, Layers, Pencil, Plus, Power, PowerOff, Ruler, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { warehouseSpaceApi, type CapacityPlan, type RackTypeMaster, type WarehouseSpaceSummary } from '@/lib/api-warehouse';
import { getT, useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { Fact, Pill, rackCategoryOf, selectClass } from './shared';
import { PrintLocationLabelsButton } from '@/components/documents/print-location-labels-button';
import { SetupHealthCard } from '@/components/warehouse-layout/setup-health-card';

export function WarehouseDetail({ warehouse, space, rackTypes, isAdmin, canEditLayout, onEdit, onToggleActive, onAddRack, onSetup, onSelectRack }: {
  warehouse: any;
  space?: WarehouseSpaceSummary;
  rackTypes: RackTypeMaster[];
  isAdmin: boolean;
  canEditLayout: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onAddRack: (templateId?: string) => void;
  /** Open the setup wizard (many racks at once). */
  onSetup?: () => void;
  onSelectRack: (rackId: string) => void;
}) {
  const { m, t, fmt } = useT();
  const wm = m.warehouseMaster;
  const sp = m.space;
  const m2 = (v: number | null | undefined, dp = 1) => (v == null ? '—' : t(sp.unit.m2, { value: fmt.number(v, dp) }));
  const cmToM = (v: number | null | undefined) => (v == null ? '—' : fmt.number(v / 100, 2));
  const w = warehouse;
  const hasSize = w.lengthCm != null && w.widthCm != null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-slate-900">{w.code}</h2>
              {w.isActive ? <Pill tone="green">{wm.detail.active}</Pill> : <Pill>{wm.detail.inactive}</Pill>}
            </div>
            <p className="text-sm text-slate-600">{w.name}{w.location ? ` · ${w.location}` : ''}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <PrintLocationLabelsButton target={{ warehouseIds: [w.id] }} fileName={`labels-${w.code}.pdf`} />
            {isAdmin && (
              <>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={onEdit}><Pencil className="w-4 h-4" /> {wm.actions.editWarehouse}</Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={onToggleActive}>
                  {w.isActive ? <><PowerOff className="w-4 h-4" /> {wm.actions.deactivate}</> : <><Power className="w-4 h-4" /> {wm.actions.activate}</>}
                </Button>
              </>
            )}
            {canEditLayout && onSetup && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={onSetup}><Wand2 className="w-4 h-4" /> {wm.actions.setupWizard}</Button>
            )}
            {canEditLayout && (
              <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700 text-white" onClick={() => onAddRack()}><Plus className="w-4 h-4" /> {wm.actions.addRack}</Button>
            )}
          </div>
        </div>

        {/* Missing / wrong master data (same check as the 3D page); a code opens the rack */}
        <div className="mt-4 empty:hidden"><SetupHealthCard wh={w} onRack={onSelectRack} showMasterLink={false} /></div>

        {/* Size */}
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <Ruler className="w-4 h-4 text-slate-400 mt-0.5" />
          {hasSize ? (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
              <Fact label={wm.warehouse.dimensions}>{cmToM(w.lengthCm)} × {cmToM(w.widthCm)} × {cmToM(w.heightCm)} m</Fact>
              <Fact label={sp.summary.totalArea}>{m2(space?.totalAreaM2)}</Fact>
              <Fact label={sp.summary.usableArea}>{m2(space?.usableAreaM2)} <span className="text-xs text-slate-500">({t(sp.summary.usablePct, { pct: fmt.number(space?.dimensions.usableAreaPct ?? w.usableAreaPct ?? 100) })})</span></Fact>
              <Fact label={sp.summary.volume}>{space?.volumeM3 == null ? '—' : t(sp.unit.m3, { value: fmt.number(space.volumeM3, 1) })}</Fact>
            </dl>
          ) : (
            <div className="text-sm">
              <p className="font-medium text-slate-700">{wm.warehouse.noSize}</p>
              <p className="text-slate-500">{wm.warehouse.noSizeHint}</p>
            </div>
          )}
        </div>
      </section>

      {/* Space */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">{sp.summary.title}</h3>
        {!space ? <p className="text-sm text-slate-500">{sp.summary.notAvailable}</p> : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Tile label={sp.summary.footprint} value={m2(space.rackFootprintM2)}
                sub={t(sp.summary.footprintSplit, { standard: fmt.number(space.standardFootprintM2, 1), pallet: fmt.number(space.palletFootprintM2, 1) })} />
              <Tile label={sp.summary.free} value={m2(space.freeAreaM2)} accent
                sub={space.usedAreaPct != null ? t(sp.summary.usedPct, { pct: fmt.number(space.usedAreaPct, 1) }) : undefined}
                pct={space.usedAreaPct} />
              <Tile label={sp.summary.capacityUsed}
                value={space.capacityUsedPct == null ? '—' : t(sp.unit.pct, { value: fmt.number(space.capacityUsedPct, 1) })}
                sub={space.slots.capacity > 0 ? t(sp.summary.capacityDetail, { qty: fmt.number(space.stockQty), capacity: fmt.number(space.slots.capacity) }) : sp.summary.noCapacity}
                pct={space.capacityUsedPct} />
            </div>
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-medium text-slate-800">{sp.summary.slots}: {fmt.number(space.slots.total)}</span>
              {' · '}{t(sp.summary.slotsSplit, { empty: space.slots.empty, occupied: space.slots.occupied, reserved: space.slots.reserved, blocked: space.slots.blocked })}
            </p>
            {space.overAllocatedM2 > 0 && <p className="mt-2 text-sm text-amber-700">{t(sp.summary.over, { value: fmt.number(space.overAllocatedM2, 1) })}</p>}
            {space.racks.withoutSize > 0 && (
              <p className="mt-2 text-sm text-slate-500">{t(sp.summary.racksWithoutSize, { count: space.racks.withoutSize, codes: space.racks.withoutSizeCodes.slice(0, 8).join(', ') + (space.racks.withoutSizeCodes.length > 8 ? '…' : '') })}</p>
            )}
          </>
        )}
      </section>

      {/* Racks */}
      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <h3 className="text-sm font-semibold text-slate-900 px-5 pt-4 pb-3 flex items-center gap-2"><Layers className="w-4 h-4 text-slate-400" /> {wm.warehouse.racks}</h3>
        {(w.racks ?? []).length === 0 ? <p className="px-5 pb-5 text-sm text-slate-500">{wm.warehouse.noRacks}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left font-medium px-5 py-2">{wm.warehouse.rackCode}</th>
                  <th className="text-left font-medium px-3 py-2">{wm.warehouse.rackCategory}</th>
                  <th className="text-left font-medium px-3 py-2">{wm.warehouse.rackSize}</th>
                  <th className="text-right font-medium px-5 py-2">{wm.warehouse.rackSlots}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {w.racks.map((r: any) => {
                  const s = r.effectiveSize ?? r;
                  const known = s.lengthCm != null && s.widthCm != null;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => onSelectRack(r.id)}>
                      <td className="px-5 py-2 font-medium text-slate-800">{r.code}{r.name ? <span className="ml-1 text-slate-500 font-normal">· {r.name}</span> : null}</td>
                      <td className="px-3 py-2 text-slate-600">{wm.category[rackCategoryOf(r)]}</td>
                      <td className="px-3 py-2 text-slate-600 tabular-nums">{known ? `${fmt.number(s.lengthCm)} × ${fmt.number(s.widthCm)}${s.heightCm != null ? ` × ${fmt.number(s.heightCm)}` : ''}` : <span className="text-slate-400">{wm.warehouse.sizeUnknown}</span>}</td>
                      <td className="px-5 py-2 text-right tabular-nums text-slate-700">{r._count?.slots ?? r.slots?.length ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CapacityPlanner warehouseId={w.id} rackTypes={rackTypes} canCreate={canEditLayout} onCreate={(id) => onAddRack(id)} refreshKey={space?.rackFootprintM2 ?? 0} />
    </div>
  );
}

function Tile({ label, value, sub, pct, accent }: { label: string; value: string; sub?: string; pct?: number | null; accent?: boolean }) {
  return (
    <div className={cn('rounded-lg border p-3', accent ? 'border-green-200 bg-green-50/50' : 'border-slate-200')}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
      {pct != null && (
        <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full bg-green-600 rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        </div>
      )}
      {sub && <p className="mt-1.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

// ─── Capacity planner (plan 1.3) — numbers come from the backend ─────────────
function CapacityPlanner({ warehouseId, rackTypes, canCreate, onCreate, refreshKey }: {
  warehouseId: string; rackTypes: RackTypeMaster[]; canCreate: boolean; onCreate: (templateId: string) => void; refreshKey: number;
}) {
  const { m, t, fmt } = useT();
  const p = m.space.planner;
  const active = rackTypes.filter((r) => r.isActive);
  const [templateId, setTemplateId] = useState('');
  const [plan, setPlan] = useState<CapacityPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setPlan(null); setTemplateId(''); }, [warehouseId]);
  useEffect(() => {
    if (!templateId) { setPlan(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    warehouseSpaceApi.planner(warehouseId, templateId)
      .then((r) => { if (!cancelled) setPlan(r); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? getT().m.errors.unexpected); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [warehouseId, templateId, refreshKey]);

  const s = plan?.slotSize;
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Calculator className="w-4 h-4 text-slate-400" /> {p.title}</h3>
      <p className="mt-1 text-sm text-slate-500">{p.hint}</p>
      {active.length === 0 ? <p className="mt-3 text-sm text-slate-500">{p.noTemplates}</p> : (
        <div className="mt-3 max-w-md">
          <label className="text-xs font-medium text-slate-600 block mb-1">{p.template}</label>
          <select className={selectClass} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">{p.chooseTemplate}</option>
            {active.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name} ({m.warehouseMaster.category[r.category]})</option>)}
          </select>
        </div>
      )}
      {loading && <Skeleton className="h-24 mt-4" />}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {plan && !loading && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-green-200 bg-green-50/60 p-4">
            {plan.racksThatFit == null
              ? <p className="text-sm text-slate-600">{p.fitUnknown}</p>
              : <p className="text-lg font-semibold text-green-800">{t(p.fit, { count: fmt.number(plan.racksThatFit) })}</p>}
            <p className="mt-1 text-xs text-slate-500">{p.estimate}</p>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Fact label={p.footprint}>{plan.templateFootprintM2 == null ? '—' : t(m.space.unit.m2, { value: fmt.number(plan.templateFootprintM2, 2) })}</Fact>
            <Fact label={p.slotsPerRack}>{t(p.slotsPerRackValue, { levels: plan.template.levels, columns: plan.template.columns, count: plan.slotsPerRack })}</Fact>
            <Fact label={p.slotSize}>
              {s && s.lengthCm != null ? (
                <>
                  {fmt.number(s.lengthCm)} × {fmt.number(s.widthCm)} × {fmt.number(s.heightCm)} cm
                  <span className="block text-xs text-slate-500">{t(m.space.unit.m2, { value: fmt.number(s.areaM2, 3) })} · {t(m.space.unit.m3, { value: fmt.number(s.volumeM3, 3) })}</span>
                </>
              ) : '—'}
            </Fact>
            <Fact label={p.slotsThatFit}>{plan.slotsThatFit == null ? '—' : fmt.number(plan.slotsThatFit)}</Fact>
          </dl>
          {plan.racksWithoutSize > 0 && <p className="text-sm text-slate-500">{t(p.unknownRacks, { count: plan.racksWithoutSize })}</p>}
          {canCreate && (
            <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700 text-white" onClick={() => onCreate(templateId)}>
              <Plus className="w-4 h-4" /> {p.createLike}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
