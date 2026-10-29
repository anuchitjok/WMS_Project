'use client';

import { useMemo } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Check, Field, NumInput, Section, SelectInput, TextInput } from './shared';

export type Inputs = Record<string, any>;
type Set = (fn: (i: Inputs) => Inputs) => void;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const patch = (set: Set, key: string) => (k: string, v: unknown) => set((i) => ({ ...i, [key]: { ...(i[key] ?? {}), [k]: v } }));

// ── Calendar & labour ────────────────────────────────────────────────────────
export function SetupEditor({ inputs, set, warehouses, defaultWarehouseId, readOnly, canCost, currency, sales }: {
  inputs: Inputs; set: Set; warehouses: any[]; defaultWarehouseId: string | null; readOnly: boolean; canCost: boolean; currency: string; sales?: boolean;
}) {
  const cal = inputs.calendar ?? {};
  const lab = inputs.labor ?? {};
  const setCal = patch(set, 'calendar');
  const setLab = patch(set, 'labor');
  const days: number[] = cal.workingDays ?? [];
  const net = cal.hoursPerShift ? cal.hoursPerShift - (cal.breakMinutesPerShift ?? 0) / 60 : null;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Section title="Quantity and warehouse" hint="Quantity is the number of good units the project must deliver.">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Planned quantity"><NumInput value={inputs.quantity} disabled={readOnly} step="1" onChange={(v) => set((i) => ({ ...i, quantity: v }))} /></Field>
          <Field label="Plan in warehouse" hint={sales ? 'Optional. A warehouse is used only for its space figures — stock is never read in a sales simulation.' : 'Choose another warehouse to test an alternative'}>
            <SelectInput value={inputs.warehouseId ?? ''} disabled={readOnly} onChange={(e) => set((i) => ({ ...i, warehouseId: e.target.value || null }))}>
              <option value="">{defaultWarehouseId ? `Project warehouse (${warehouses.find((w) => w.id === defaultWarehouseId)?.code ?? '—'})` : 'No warehouse — space not checked'}</option>
              {warehouses.filter((w) => w.id !== defaultWarehouseId).map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </SelectInput>
          </Field>
          <Field label="Transfer batch size" hint="Units moved to the next stage together. Empty = the whole quantity (stages do not overlap).">
            <NumInput value={inputs.transferBatchSize} disabled={readOnly} step="1" onChange={(v) => set((i) => ({ ...i, transferBatchSize: v }))} />
          </Field>
          {!sales && (
            <div className="flex items-end pb-2">
              <Check label="Count submitted withdrawal requests as demand" checked={inputs.includePendingRequests !== false} disabled={readOnly} onChange={(v) => set((i) => ({ ...i, includePendingRequests: v }))} />
            </div>
          )}
        </div>
      </Section>

      <Section title="Working calendar" hint={net !== null ? `${net} net hours per shift × ${cal.shiftsPerDay ?? '?'} shift(s) = ${net * (cal.shiftsPerDay ?? 0)} working hours per day` : 'Enter shift hours'}>
        <div className="space-y-3">
          <div>
            <span className="block text-xs font-medium text-slate-600 mb-1">Working days</span>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d, idx) => {
                const n = idx + 1;
                const on = days.includes(n);
                return (
                  <button key={d} type="button" disabled={readOnly}
                    onClick={() => setCal('workingDays', on ? days.filter((x) => x !== n) : [...days, n].sort())}
                    className={`h-8 w-11 rounded-md border text-xs font-medium ${on ? 'bg-green-50 border-green-300 text-green-800' : 'bg-white border-slate-200 text-slate-400'}`}>{d}</button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Shifts per day">
              <SelectInput value={cal.shiftsPerDay ?? ''} disabled={readOnly} onChange={(e) => setCal('shiftsPerDay', Number(e.target.value))}>
                {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </SelectInput>
            </Field>
            <Field label="Hours per shift"><NumInput value={cal.hoursPerShift} disabled={readOnly} onChange={(v) => setCal('hoursPerShift', v)} /></Field>
            <Field label="Break min / shift"><NumInput value={cal.breakMinutesPerShift} disabled={readOnly} onChange={(v) => setCal('breakMinutesPerShift', v)} /></Field>
          </div>
          <Field label="Holidays" hint="One date per line (YYYY-MM-DD)">
            <textarea
              aria-label="Holidays"
              className="w-full min-h-[64px] rounded-md border border-slate-200 px-2.5 py-1.5 text-sm font-mono"
              disabled={readOnly}
              value={(cal.holidays ?? []).join('\n')}
              onChange={(e) => setCal('holidays', e.target.value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean))}
            />
          </Field>
        </div>
      </Section>

      <Section title="Manpower" hint="Available people for this project across all shifts. Each person works one shift a day.">
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Available headcount"><NumInput value={lab.availableHeadcount} disabled={readOnly} step="1" onChange={(v) => setLab('availableHeadcount', v)} /></Field>
          <Field label="Absence allowance %" hint="Leave, sickness"><NumInput value={lab.absencePct} disabled={readOnly} onChange={(v) => setLab('absencePct', v)} /></Field>
          <Field label="Utilization %" hint="Productive share of net shift time"><NumInput value={lab.utilizationPct} disabled={readOnly} onChange={(v) => setLab('utilizationPct', v)} /></Field>
        </div>
        <div className="mt-4 space-y-3">
          <Check label="Overtime is authorized for planning" checked={!!lab.overtimeAuthorized} disabled={readOnly} onChange={(v) => setLab('overtimeAuthorized', v)} />
          {lab.overtimeAuthorized && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Max overtime h / person / day"><NumInput value={lab.maxOvertimeHoursPerPersonPerDay} disabled={readOnly} onChange={(v) => setLab('maxOvertimeHoursPerPersonPerDay', v)} /></Field>
              {canCost && <Field label="Overtime premium %"><NumInput value={lab.overtimePremiumPct} disabled={readOnly} onChange={(v) => setLab('overtimePremiumPct', v)} /></Field>}
            </div>
          )}
        </div>
      </Section>

      <Section title="Readiness confirmations" hint="Confirmed by the planner — the calculation cannot see equipment.">
        <div className="space-y-2">
          <Check label="Workstations are available for the planned period" checked={!!inputs.readiness?.workstationsConfirmed} disabled={readOnly} onChange={(v) => patch(set, 'readiness')('workstationsConfirmed', v)} />
          <Check label="Equipment and tools are available" checked={!!inputs.readiness?.equipmentConfirmed} disabled={readOnly} onChange={(v) => patch(set, 'readiness')('equipmentConfirmed', v)} />
        </div>
        {canCost && (
          <div className="mt-4">
            <Field label={`Labour cost per hour (${currency})`} hint="Leave empty if unknown — the cost estimate will be marked incomplete"><NumInput value={lab.laborRatePerHour} disabled={readOnly} onChange={(v) => setLab('laborRatePerHour', v)} /></Field>
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Workflow ─────────────────────────────────────────────────────────────────
const blankStage = (n: number) => ({
  key: `S${n}`, name: `Stage ${n}`, dependsOn: [], timeBasis: 'MINUTES_PER_UNIT', stdMinutesPerUnit: null, unitsPerPersonShift: null,
  productivitySource: 'ESTIMATE', setupMinutes: 0, changeovers: 0, workstations: null, operatorsPerStation: 1, yieldPct: 100, reworkPct: 0,
  bufferPct: 0, skill: 'General', benchAreaM2: null, isQualityGate: false, completionCriteria: '',
});

export function WorkflowEditor({ inputs, set, readOnly, templates }: { inputs: Inputs; set: Set; readOnly: boolean; templates: any[] }) {
  const stages: any[] = inputs.stages ?? [];
  const upd = (idx: number, k: string, v: unknown) => set((i) => ({ ...i, stages: i.stages.map((s: any, j: number) => (j === idx ? { ...s, [k]: v } : s)) }));
  const move = (idx: number, dir: -1 | 1) => set((i) => {
    const arr = [...i.stages];
    const t = idx + dir;
    if (t < 0 || t >= arr.length) return i;
    [arr[idx], arr[t]] = [arr[t], arr[idx]];
    return { ...i, stages: arr };
  });
  const remove = (idx: number) => set((i) => {
    const key = i.stages[idx].key;
    return { ...i, stages: i.stages.filter((_: any, j: number) => j !== idx).map((s: any) => ({ ...s, dependsOn: s.dependsOn.filter((d: string) => d !== key) })) };
  });
  const add = () => set((i) => {
    let n = (i.stages?.length ?? 0) + 1;
    while ((i.stages ?? []).some((s: any) => s.key === `S${n}`)) n++;
    const prev = i.stages?.[i.stages.length - 1];
    return { ...i, stages: [...(i.stages ?? []), { ...blankStage(n), dependsOn: prev ? [prev.key] : [] }] };
  });
  const applyTemplate = (key: string) => {
    const t = templates.find((x) => x.key === key);
    if (!t) return;
    if (stages.length && !confirm('Replace the current stages with this template? Entered times will be lost.')) return;
    set((i) => ({ ...i, stages: t.stages.map((s: any, n: number) => ({ ...blankStage(n + 1), ...s })) }));
  };

  return (
    <Section
      title="Workflow stages"
      hint="Every unit passes every stage. Stages that depend on the same stage run in parallel. Enter validated standards where they exist — estimates are flagged."
      action={!readOnly && (
        <div className="flex gap-2">
          <SelectInput aria-label="Apply template" className="w-44 h-8 text-xs" value="" onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">Apply template…</option>
            {templates.filter((t) => t.stages.length).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </SelectInput>
          <Button size="sm" variant="outline" className="h-8" onClick={add}><Plus className="h-3.5 w-3.5 mr-1" />Stage</Button>
        </div>
      )}
    >
      {!stages.length ? <p className="text-sm text-slate-400 py-6 text-center">No stages yet.</p> : (
        <div className="space-y-3">
          {stages.map((s, idx) => (
            <div key={idx} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Key" className="w-20"><TextInput value={s.key} disabled={readOnly} onChange={(e) => {
                  const old = s.key; const nk = e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
                  set((i) => ({ ...i, stages: i.stages.map((x: any, j: number) => (j === idx ? { ...x, key: nk } : { ...x, dependsOn: x.dependsOn.map((d: string) => (d === old ? nk : d)) })) }));
                }} /></Field>
                <Field label="Stage name" className="flex-1 min-w-[140px]"><TextInput value={s.name} disabled={readOnly} onChange={(e) => upd(idx, 'name', e.target.value)} /></Field>
                <Field label="Skill" className="w-32"><TextInput value={s.skill} disabled={readOnly} onChange={(e) => upd(idx, 'skill', e.target.value)} /></Field>
                <Field label="After stage(s)" className="min-w-[160px]">
                  <div className="flex flex-wrap gap-1 min-h-9 items-center">
                    {stages.filter((o) => o.key !== s.key).map((o) => {
                      const on = s.dependsOn.includes(o.key);
                      return (
                        <button key={o.key} type="button" disabled={readOnly}
                          onClick={() => upd(idx, 'dependsOn', on ? s.dependsOn.filter((d: string) => d !== o.key) : [...s.dependsOn, o.key])}
                          className={`px-2 h-7 rounded-md border text-xs ${on ? 'bg-green-50 border-green-300 text-green-800' : 'border-slate-200 text-slate-400'}`}>{o.key}</button>
                      );
                    })}
                  </div>
                </Field>
                {!readOnly && (
                  <div className="flex gap-1 pb-0.5">
                    <Button size="icon-sm" variant="ghost" aria-label="Move up" onClick={() => move(idx, -1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Move down" onClick={() => move(idx, 1)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Remove stage" onClick={() => remove(idx)}><Trash2 className="h-4 w-4 text-slate-400" /></Button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mt-3">
                <Field label="Time basis" className="col-span-2">
                  <SelectInput value={s.timeBasis} disabled={readOnly} onChange={(e) => upd(idx, 'timeBasis', e.target.value)}>
                    <option value="MINUTES_PER_UNIT">Minutes per unit</option>
                    <option value="UNITS_PER_PERSON_SHIFT">Units per person per shift</option>
                  </SelectInput>
                </Field>
                {s.timeBasis === 'UNITS_PER_PERSON_SHIFT'
                  ? <Field label="Units / person / shift"><NumInput value={s.unitsPerPersonShift} disabled={readOnly} onChange={(v) => upd(idx, 'unitsPerPersonShift', v)} /></Field>
                  : <Field label="Std min / unit"><NumInput value={s.stdMinutesPerUnit} disabled={readOnly} onChange={(v) => upd(idx, 'stdMinutesPerUnit', v)} /></Field>}
                <Field label="Source">
                  <SelectInput value={s.productivitySource} disabled={readOnly} onChange={(e) => upd(idx, 'productivitySource', e.target.value)}>
                    <option value="VALIDATED_STANDARD">Validated</option>
                    <option value="ESTIMATE">Estimate</option>
                  </SelectInput>
                </Field>
                <Field label="Workstations"><NumInput value={s.workstations} step="1" disabled={readOnly} onChange={(v) => upd(idx, 'workstations', v)} /></Field>
                <Field label="Operators / station"><NumInput value={s.operatorsPerStation} step="1" disabled={readOnly} onChange={(v) => upd(idx, 'operatorsPerStation', v)} /></Field>
                <Field label="Setup min"><NumInput value={s.setupMinutes} disabled={readOnly} onChange={(v) => upd(idx, 'setupMinutes', v ?? 0)} /></Field>
                <Field label="Changeovers"><NumInput value={s.changeovers} step="1" disabled={readOnly} onChange={(v) => upd(idx, 'changeovers', v ?? 0)} /></Field>
                <Field label="Yield %"><NumInput value={s.yieldPct} disabled={readOnly} onChange={(v) => upd(idx, 'yieldPct', v)} /></Field>
                <Field label="Rework %"><NumInput value={s.reworkPct} disabled={readOnly} onChange={(v) => upd(idx, 'reworkPct', v ?? 0)} /></Field>
                <Field label="Capacity buffer %"><NumInput value={s.bufferPct} disabled={readOnly} onChange={(v) => upd(idx, 'bufferPct', v ?? 0)} /></Field>
                <Field label="Bench m² / station"><NumInput value={s.benchAreaM2} disabled={readOnly} onChange={(v) => upd(idx, 'benchAreaM2', v)} /></Field>
                <Field label="Completion criteria" className="col-span-2 lg:col-span-3"><TextInput value={s.completionCriteria} disabled={readOnly} onChange={(e) => upd(idx, 'completionCriteria', e.target.value)} /></Field>
                <div className="flex items-end pb-2"><Check label="Quality gate" checked={s.isQualityGate} disabled={readOnly} onChange={(v) => upd(idx, 'isQualityGate', v)} /></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── Materials ────────────────────────────────────────────────────────────────
export function MaterialsEditor({ inputs, set, readOnly, products, canCost, currency, sales }: { inputs: Inputs; set: Set; readOnly: boolean; products: any[]; canCost: boolean; currency: string; sales?: boolean }) {
  const mats: any[] = inputs.materials ?? [];
  const inbound: any[] = inputs.manualInbound ?? [];
  const stages: any[] = inputs.stages ?? [];
  const pmap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const updM = (idx: number, k: string, v: unknown) => set((i) => ({ ...i, materials: i.materials.map((m: any, j: number) => (j === idx ? { ...m, [k]: v } : m)) }));
  const updI = (idx: number, k: string, v: unknown) => set((i) => ({ ...i, manualInbound: i.manualInbound.map((m: any, j: number) => (j === idx ? { ...m, [k]: v } : m)) }));
  const productSelect = (value: string, onChange: (v: string) => void, allowFree = false) => (
    <SelectInput value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowFree ? 'Free-text item (not in Product Master)' : 'Choose product…'}</option>
      {value && !pmap.has(value) && <option value={value}>{value} (not in list)</option>}
      {products.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
    </SelectInput>
  );

  return (
    <div className="space-y-4">
      {sales ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
          <b>Sales simulation:</b> stock is never read. Every material is treated as <b>to be procured</b>, so the quote does not depend on today&apos;s stock.
          Pick a Product Master item, or choose &quot;Free-text item&quot; and type the name for anything that is not in the system.
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          This WMS has no bill of materials, MRP run or purchase-order module yet. Materials below are a <b>manually defined</b> project list,
          and expected supply is entered by hand. Stock, reservations, items awaiting inspection and submitted requests are read live from the WMS when you calculate.
        </div>
      )}
      <Section title="Material requirements (manually defined)" hint="Quantity per unit entering the consuming stage. Product Master minimum stock is kept back as safety stock."
        action={!readOnly && <Button size="sm" variant="outline" className="h-8" onClick={() => set((i) => ({ ...i, materials: [...(i.materials ?? []), { productId: '', stageKey: stages[0]?.key ?? '', qtyPerUnit: null, scrapPct: 0, leadTimeDays: null, packMultiple: null, unitCostOverride: null, unitsPerPallet: null, source: 'MANUAL' }] }))}><Plus className="h-3.5 w-3.5 mr-1" />Material</Button>}>
        {!mats.length ? <p className="text-sm text-slate-400 py-4 text-center">No materials — the plan will not check material availability.</p> : (
          <div className="space-y-2">
            {mats.map((m, idx) => (
              <div key={idx} className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-2 items-end rounded-lg border border-slate-100 p-2">
                <Field label="Product" className="col-span-2 lg:col-span-2">{productSelect(m.productId, (v) => updM(idx, 'productId', v), sales)}</Field>
                {sales && !m.productId && (
                  <>
                    <Field label="Item name" className="col-span-2 lg:col-span-2"><TextInput value={m.itemName ?? ''} maxLength={120} disabled={readOnly} placeholder="e.g. Thermal pad" onChange={(e) => updM(idx, 'itemName', e.target.value)} /></Field>
                    <Field label="Unit"><TextInput value={m.unit ?? ''} maxLength={20} disabled={readOnly} placeholder="pcs" onChange={(e) => updM(idx, 'unit', e.target.value)} /></Field>
                  </>
                )}
                <Field label="Used at stage">
                  <SelectInput value={m.stageKey} disabled={readOnly} onChange={(e) => updM(idx, 'stageKey', e.target.value)}>
                    {stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                  </SelectInput>
                </Field>
                <Field label="Qty / unit"><NumInput value={m.qtyPerUnit} disabled={readOnly} onChange={(v) => updM(idx, 'qtyPerUnit', v)} /></Field>
                <Field label="Scrap %"><NumInput value={m.scrapPct} disabled={readOnly} onChange={(v) => updM(idx, 'scrapPct', v ?? 0)} /></Field>
                <Field label="Lead time (days)"><NumInput value={m.leadTimeDays} step="1" disabled={readOnly} onChange={(v) => updM(idx, 'leadTimeDays', v)} /></Field>
                <Field label="Order multiple"><NumInput value={m.packMultiple} disabled={readOnly} onChange={(v) => updM(idx, 'packMultiple', v)} /></Field>
                <Field label="Units / pallet"><NumInput value={m.unitsPerPallet} disabled={readOnly} onChange={(v) => updM(idx, 'unitsPerPallet', v)} /></Field>
                <div className="flex items-end gap-1">
                  {canCost && <Field label={`Unit cost (${currency})`} hint="Manual estimate"><NumInput value={m.unitCostOverride} disabled={readOnly} onChange={(v) => updM(idx, 'unitCostOverride', v)} /></Field>}
                  {!readOnly && <Button size="icon-sm" variant="ghost" aria-label="Remove material" className="mb-1" onClick={() => set((i) => ({ ...i, materials: i.materials.filter((_: any, j: number) => j !== idx) }))}><Trash2 className="h-4 w-4 text-slate-400" /></Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {!sales && <Section title="Expected supply (manual)" hint="Open supplier orders or transfers known outside the WMS. Only quantities arriving by the required-by date reduce the shortage."
        action={!readOnly && <Button size="sm" variant="outline" className="h-8" onClick={() => set((i) => ({ ...i, manualInbound: [...(i.manualInbound ?? []), { productId: '', quantity: null, expectedDate: '', reference: '' }] }))}><Plus className="h-3.5 w-3.5 mr-1" />Expected supply</Button>}>
        {!inbound.length ? <p className="text-sm text-slate-400 py-4 text-center">None entered.</p> : (
          <div className="space-y-2">
            {inbound.map((x, idx) => (
              <div key={idx} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                <Field label="Product" className="col-span-2">{productSelect(x.productId, (v) => updI(idx, 'productId', v))}</Field>
                <Field label="Quantity"><NumInput value={x.quantity} disabled={readOnly} onChange={(v) => updI(idx, 'quantity', v)} /></Field>
                <Field label="Expected date"><TextInput type="date" value={x.expectedDate} disabled={readOnly} onChange={(e) => updI(idx, 'expectedDate', e.target.value)} /></Field>
                <div className="flex items-end gap-1">
                  <Field label="Reference" className="flex-1"><TextInput value={x.reference} disabled={readOnly} onChange={(e) => updI(idx, 'reference', e.target.value)} /></Field>
                  {!readOnly && <Button size="icon-sm" variant="ghost" aria-label="Remove expected supply" className="mb-1" onClick={() => set((i) => ({ ...i, manualInbound: i.manualInbound.filter((_: any, j: number) => j !== idx) }))}><Trash2 className="h-4 w-4 text-slate-400" /></Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>}
    </div>
  );
}

// ── Space & cost ─────────────────────────────────────────────────────────────
export function SpaceCostEditor({ inputs, set, readOnly, canCost, currency }: { inputs: Inputs; set: Set; readOnly: boolean; canCost: boolean; currency: string }) {
  const sp = inputs.space ?? {};
  const co = inputs.costs ?? {};
  const setSp = patch(set, 'space');
  const setCo = patch(set, 'costs');
  const others: any[] = co.otherCosts ?? [];
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Section title="Packaging and pallets" hint="Product Master has no dimensions, so these are entered for the project. Missing values make the space check incomplete — nothing is guessed.">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="Units per carton"><NumInput value={sp.unitsPerCarton} disabled={readOnly} onChange={(v) => setSp('unitsPerCarton', v)} /></Field>
          <Field label="Cartons per pallet"><NumInput value={sp.cartonsPerPallet} disabled={readOnly} onChange={(v) => setSp('cartonsPerPallet', v)} /></Field>
          <Field label="Stack levels (staging)"><NumInput value={sp.stackLevels} step="1" disabled={readOnly} onChange={(v) => setSp('stackLevels', v)} /></Field>
          <Field label="Pallet length (m)"><NumInput value={sp.palletLengthM} disabled={readOnly} onChange={(v) => setSp('palletLengthM', v)} /></Field>
          <Field label="Pallet width (m)"><NumInput value={sp.palletWidthM} disabled={readOnly} onChange={(v) => setSp('palletWidthM', v)} /></Field>
          <Field label="Receipt pattern">
            <SelectInput value={sp.receiptPattern ?? 'ALL_AT_START'} disabled={readOnly} onChange={(e) => setSp('receiptPattern', e.target.value)}>
              <option value="ALL_AT_START">All units at start</option>
              <option value="FLOW">Arrive as processed</option>
            </SelectInput>
          </Field>
          {sp.receiptPattern === 'FLOW' && <Field label="Storage dwell (days)"><NumInput value={sp.storageDwellDays} disabled={readOnly} onChange={(v) => setSp('storageDwellDays', v)} /></Field>}
          <Field label="Receiving dwell (days)"><NumInput value={sp.receivingDwellDays} disabled={readOnly} onChange={(v) => setSp('receivingDwellDays', v)} /></Field>
          <Field label="Dispatch dwell (days)"><NumInput value={sp.dispatchDwellDays} disabled={readOnly} onChange={(v) => setSp('dispatchDwellDays', v)} /></Field>
          <Field label="Flag utilization above %"><NumInput value={sp.capacityRiskPct} disabled={readOnly} onChange={(v) => setSp('capacityRiskPct', v)} /></Field>
        </div>
      </Section>

      <Section title="Available space overrides" hint="Leave empty to use the WMS: PALLET/BULK slot capacity, and Floor Plan areas drawn in metres.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Storage pallet positions"><NumInput value={sp.overrideStoragePalletPositions} disabled={readOnly} onChange={(v) => setSp('overrideStoragePalletPositions', v)} /></Field>
          <Field label="Receiving area m²"><NumInput value={sp.overrideReceivingAreaM2} disabled={readOnly} onChange={(v) => setSp('overrideReceivingAreaM2', v)} /></Field>
          <Field label="Dispatch area m²"><NumInput value={sp.overrideDispatchAreaM2} disabled={readOnly} onChange={(v) => setSp('overrideDispatchAreaM2', v)} /></Field>
          <Field label="Work area m²"><NumInput value={sp.overrideWorkAreaM2} disabled={readOnly} onChange={(v) => setSp('overrideWorkAreaM2', v)} /></Field>
        </div>
      </Section>

      {canCost && (
        <Section title={`Cost assumptions (${currency})`} hint="Currencies are never mixed: Product Master costs are used only if their currency is declared, and converted only with a rate you enter." className="lg:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Product Master cost currency" hint="Currency of Standard Unit Cost"><TextInput value={co.masterCostCurrency ?? ''} maxLength={3} disabled={readOnly} onChange={(e) => setCo('masterCostCurrency', e.target.value.toUpperCase() || null)} /></Field>
            <Field label={`Rate to ${currency}`} hint="Only if the currency differs"><NumInput value={co.fxRateMasterToProject} disabled={readOnly} onChange={(v) => setCo('fxRateMasterToProject', v)} /></Field>
            <Field label="Handling cost / pallet"><NumInput value={co.handlingCostPerPallet} disabled={readOnly} onChange={(v) => setCo('handlingCostPerPallet', v)} /></Field>
            <Field label="Delay cost / working day"><NumInput value={co.delayCostPerDay} disabled={readOnly} onChange={(v) => setCo('delayCostPerDay', v)} /></Field>
          </div>
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-slate-600">Other project costs</p>
            {others.map((o, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <TextInput aria-label="Cost label" className="flex-1" value={o.label} disabled={readOnly} onChange={(e) => setCo('otherCosts', others.map((x, j) => (j === idx ? { ...x, label: e.target.value } : x)))} />
                <NumInput ariaLabel="Cost amount" className="w-40" value={o.amount} disabled={readOnly} onChange={(v) => setCo('otherCosts', others.map((x, j) => (j === idx ? { ...x, amount: v } : x)))} />
                {!readOnly && <Button size="icon-sm" variant="ghost" aria-label="Remove cost" onClick={() => setCo('otherCosts', others.filter((_, j) => j !== idx))}><Trash2 className="h-4 w-4 text-slate-400" /></Button>}
              </div>
            ))}
            {!readOnly && <Button size="sm" variant="outline" className="h-8" onClick={() => setCo('otherCosts', [...others, { label: '', amount: null }])}><Plus className="h-3.5 w-3.5 mr-1" />Cost line</Button>}
          </div>
        </Section>
      )}

      {canCost && <PricingEditor pricing={co.pricing ?? {}} set={(v) => setCo('pricing', v)} readOnly={readOnly} currency={currency} />}
    </div>
  );
}

/** Selling price from cost. Only users who can see costs get here — a margin reveals the cost. */
function PricingEditor({ pricing: pr, set, readOnly, currency }: { pricing: any; set: (v: any) => void; readOnly: boolean; currency: string }) {
  const method = pr.method ?? 'NONE';
  const up = (k: string, v: any) => set({ ...pr, [k]: v });
  return (
    <Section title="Selling price (quote)" className="lg:col-span-2"
      hint="The price is worked out from the cost estimate above when you calculate. A margin or markup is applied only when the cost estimate is complete. The customer summary shows the price, never the cost or margin.">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Pricing method">
          <SelectInput value={method} disabled={readOnly} onChange={(e) => up('method', e.target.value)}>
            <option value="NONE">No price</option>
            <option value="MARGIN">Margin % of price</option>
            <option value="MARKUP">Markup % on cost</option>
            <option value="FIXED">Fixed selling price</option>
          </SelectInput>
        </Field>
        {method === 'MARGIN' && <Field label="Margin %" hint="Price = cost ÷ (1 − margin)"><NumInput value={pr.marginPct} disabled={readOnly} onChange={(v) => up('marginPct', v)} /></Field>}
        {method === 'MARKUP' && <Field label="Markup %" hint="Price = cost × (1 + markup)"><NumInput value={pr.markupPct} disabled={readOnly} onChange={(v) => up('markupPct', v)} /></Field>}
        {method === 'FIXED' && <Field label={`Selling price (${currency})`} hint="Excluding VAT"><NumInput value={pr.fixedPrice} disabled={readOnly} onChange={(v) => up('fixedPrice', v)} /></Field>}
        {method !== 'NONE' && (
          <>
            <Field label="Contingency %" hint={method === 'FIXED' ? 'Added to cost before the margin check' : 'Added to cost first'}><NumInput value={pr.contingencyPct} disabled={readOnly} onChange={(v) => up('contingencyPct', v)} /></Field>
            {method !== 'FIXED' && <Field label="Round price up to" hint={`e.g. 100 ${currency}`}><NumInput value={pr.roundTo} disabled={readOnly} onChange={(v) => up('roundTo', v)} /></Field>}
            <Field label="VAT %" hint="Leave empty to hide VAT"><NumInput value={pr.vatPct} disabled={readOnly} onChange={(v) => up('vatPct', v)} /></Field>
            <Field label="Price valid for (days)" hint="From the calculation date"><NumInput value={pr.validityDays} step="1" disabled={readOnly} onChange={(v) => up('validityDays', v)} /></Field>
          </>
        )}
      </div>
    </Section>
  );
}
