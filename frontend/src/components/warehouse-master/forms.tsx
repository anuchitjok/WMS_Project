'use client';

// Create/edit forms for warehouses and racks, and the rack delete dialog.
import { useEffect, useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { warehouseMasterApi } from '@/lib/api';
import { warehouseSpaceApi, RACK_CATEGORIES, type RackCategory, type RackTypeMaster } from '@/lib/api-warehouse';
import { labelOf, useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { Field, ModalWrap, isPos, optNum, rackCategoryOf, selectClass } from './shared';

const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

// ─── Warehouse ────────────────────────────────────────────────────────────────
export function WarehouseForm({ mode, data, onClose, onSaved }: { mode: 'create' | 'edit'; data?: any; onClose: () => void; onSaved: () => void }) {
  const { m, t, fmt } = useT();
  const w = m.warehouseMaster.form;
  const [form, setForm] = useState({
    code: data?.code ?? '', name: data?.name ?? '', location: data?.location ?? '',
    lengthCm: str(data?.lengthCm), widthCm: str(data?.widthCm), heightCm: str(data?.heightCm),
    usableAreaPct: data ? str(data.usableAreaPct ?? 100) : '100',
  });
  const [busy, setBusy] = useState(false);
  const F = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const L = optNum(form.lengthCm), W = optNum(form.widthCm), H = optNum(form.heightCm), P = optNum(form.usableAreaPct) ?? 100;
  const area = L && W && L > 0 && W > 0 ? (L * W) / 10_000 : null;
  const computed = area != null
    ? t(w.computed, { area: fmt.number(area), usable: fmt.number((area * Math.min(100, Math.max(0, P))) / 100), volume: H && H > 0 ? fmt.number((area * H) / 100) : '—' })
    : w.computedNone;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if ((mode === 'create' && !form.code.trim()) || !form.name.trim()) return toast.error(w.required);
    if (![L, W, H].every(isPos)) return toast.error(w.positive);
    const pctRaw = optNum(form.usableAreaPct);
    if (pctRaw !== undefined && !(pctRaw > 0 && pctRaw <= 100)) return toast.error(w.pctRange);
    // Blank sizes: omitted on create, cleared (null) on edit.
    const blank = mode === 'create' ? undefined : null;
    const sizes = { lengthCm: L ?? blank, widthCm: W ?? blank, heightCm: H ?? blank, usableAreaPct: pctRaw ?? 100 };
    setBusy(true);
    try {
      if (mode === 'create') await warehouseSpaceApi.createWarehouse({ code: form.code.trim(), name: form.name.trim(), location: form.location.trim() || undefined, ...sizes });
      else await warehouseSpaceApi.updateWarehouse(data.id, { name: form.name.trim(), location: form.location.trim() || null, ...sizes });
      toast.success(mode === 'create' ? w.warehouseCreated : w.warehouseUpdated);
      onSaved();
    } catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
  }

  return (
    <ModalWrap title={mode === 'create' ? w.createWarehouse : t(w.editWarehouse, { code: data?.code })} onClose={onClose} widthClass="max-w-lg">
      <form onSubmit={submit} className="space-y-3">
        {mode === 'create' && <Field label={`${w.code} *`} hint={w.codeHint}><Input autoFocus placeholder="WH-A" value={form.code} onChange={F('code')} /></Field>}
        <Field label={`${w.name} *`}><Input autoFocus={mode !== 'create'} value={form.name} onChange={F('name')} /></Field>
        <Field label={w.location}><Input value={form.location} onChange={F('location')} /></Field>
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{w.sizeSection}</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label={w.length}><Input type="number" min={0} step="any" inputMode="decimal" value={form.lengthCm} onChange={F('lengthCm')} /></Field>
            <Field label={w.width}><Input type="number" min={0} step="any" inputMode="decimal" value={form.widthCm} onChange={F('widthCm')} /></Field>
            <Field label={w.height}><Input type="number" min={0} step="any" inputMode="decimal" value={form.heightCm} onChange={F('heightCm')} /></Field>
          </div>
        </div>
        <Field label={w.usablePct} hint={w.usablePctHint}>
          <Input type="number" min={1} max={100} step="any" inputMode="decimal" value={form.usableAreaPct} onChange={F('usableAreaPct')} className="max-w-[140px]" />
        </Field>
        <p className={cn('rounded-lg px-3 py-2 text-sm', area != null ? 'bg-green-50 text-green-800' : 'bg-slate-50 text-slate-500')}>{computed}</p>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>{m.common.actions.cancel}</Button>
          <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700 text-white" disabled={busy}>{busy ? m.common.actions.saving : m.common.actions.save}</Button>
        </div>
      </form>
    </ModalWrap>
  );
}

// ─── Rack ─────────────────────────────────────────────────────────────────────
export function RackForm({ mode, warehouseId, data, rackTypes, prefillTemplateId, onClose, onSaved }: {
  mode: 'create' | 'edit'; warehouseId?: string; data?: any; rackTypes: RackTypeMaster[]; prefillTemplateId?: string;
  onClose: () => void; onSaved: () => void;
}) {
  const { m, t } = useT();
  const w = m.warehouseMaster.form;
  const prefill = prefillTemplateId ? rackTypes.find((r) => r.id === prefillTemplateId) : undefined;
  const [form, setForm] = useState(() => ({
    code: data?.code ?? '', name: data?.name ?? '', zone: data?.zone ?? '', description: data?.description ?? '',
    rackTypeId: (data?.rackTypeId ?? prefill?.id ?? '') as string,
    category: (prefill?.category ?? (data ? rackCategoryOf(data) : 'STANDARD_RACK')) as RackCategory,
    lengthCm: str(data?.lengthCm ?? prefill?.lengthCm), widthCm: str(data?.widthCm ?? prefill?.widthCm), heightCm: str(data?.heightCm ?? prefill?.heightCm),
    levels: str(data?.levels ?? prefill?.levels ?? 1), columns: str(data?.columns ?? prefill?.columns ?? 1),
  }));
  // Only send the category when the user changes it, so editing other fields
  // never rewrites an older rack's stored type.
  const [typeTouched, setTypeTouched] = useState(mode === 'create');
  const [busy, setBusy] = useState(false);
  const F = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const options = useMemo(() => rackTypes.filter((r) => r.isActive || r.id === form.rackTypeId), [rackTypes, form.rackTypeId]);
  const template = rackTypes.find((r) => r.id === form.rackTypeId);

  function chooseTemplate(id: string) {
    setTypeTouched(true);
    const tpl = rackTypes.find((r) => r.id === id);
    if (!tpl) return setForm({ ...form, rackTypeId: '' });
    setForm({
      ...form, rackTypeId: tpl.id, category: tpl.category,
      lengthCm: String(tpl.lengthCm), widthCm: String(tpl.widthCm), heightCm: String(tpl.heightCm),
      levels: String(tpl.levels), columns: String(tpl.columns),
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'create' && !form.code.trim()) return toast.error(w.required);
    const L = optNum(form.lengthCm), W = optNum(form.widthCm), H = optNum(form.heightCm);
    if (![L, W, H].every(isPos)) return toast.error(w.positive);
    const levels = Number(form.levels), columns = Number(form.columns);
    if (![levels, columns].every((n) => Number.isInteger(n) && n >= 1 && n <= 99)) return toast.error(w.gridRange);
    const blank = mode === 'create' ? undefined : null;
    const payload: Record<string, unknown> = {
      name: form.name.trim() || blank, zone: form.zone.trim() || blank, description: form.description.trim() || blank,
      levels, columns, lengthCm: L ?? blank, widthCm: W ?? blank, heightCm: H ?? blank,
    };
    if (typeTouched) { payload.rackTypeId = form.rackTypeId || null; payload.category = form.category; }
    setBusy(true);
    try {
      if (mode === 'create') await warehouseSpaceApi.createRack({ warehouseId, code: form.code.trim(), ...payload });
      else await warehouseSpaceApi.updateRack(data.id, payload);
      toast.success(mode === 'create' ? w.rackCreated : w.rackUpdated);
      onSaved();
    } catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
  }

  return (
    <ModalWrap title={mode === 'create' ? w.createRack : t(w.editRack, { code: data?.code })} onClose={onClose} widthClass="max-w-xl">
      <form onSubmit={submit} className="space-y-4">
        <Field label={w.rackType} hint={w.rackTypeHint}>
          <select className={selectClass} value={form.rackTypeId} onChange={(e) => chooseTemplate(e.target.value)}>
            <option value="">{w.noRackType}</option>
            {options.map((r) => (
              <option key={r.id} value={r.id}>{r.code} · {r.name} ({labelOf(m.warehouseMaster.category, r.category)})</option>
            ))}
          </select>
        </Field>
        <Field label={w.category}>
          <div className="grid grid-cols-2 gap-2">
            {RACK_CATEGORIES.map((c) => (
              <button key={c} type="button" disabled={!!template}
                onClick={() => { setTypeTouched(true); setForm({ ...form, category: c, levels: c === 'PALLET_ON_FLOOR' ? '1' : form.levels }); }}
                className={cn('rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed',
                  form.category === c ? 'border-green-500 bg-green-50 ring-1 ring-green-500' : 'border-slate-200 hover:border-slate-300',
                  template && form.category !== c && 'opacity-50')}>
                <span className="block text-sm font-medium text-slate-800">{m.warehouseMaster.category[c]}</span>
                <span className="block text-xs text-slate-500">{m.warehouseMaster.categoryHint[c]}</span>
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {mode === 'create' && <Field label={`${w.code} *`}><Input autoFocus placeholder="A01" value={form.code} onChange={F('code')} /></Field>}
          <Field label={w.name}><Input value={form.name} onChange={F('name')} /></Field>
          <Field label={w.zone}><Input value={form.zone} onChange={F('zone')} /></Field>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{w.sizeSection}</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label={w.length}><Input type="number" min={0} step="any" value={form.lengthCm} onChange={F('lengthCm')} /></Field>
            <Field label={w.width}><Input type="number" min={0} step="any" value={form.widthCm} onChange={F('widthCm')} /></Field>
            <Field label={w.height}><Input type="number" min={0} step="any" value={form.heightCm} onChange={F('heightCm')} /></Field>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={w.levels}><Input type="number" min={1} max={99} value={form.levels} onChange={F('levels')} /></Field>
          <Field label={w.columns}><Input type="number" min={1} max={99} value={form.columns} onChange={F('columns')} /></Field>
        </div>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>{m.common.actions.cancel}</Button>
          <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700 text-white" disabled={busy}>{busy ? m.common.actions.saving : m.common.actions.save}</Button>
        </div>
      </form>
    </ModalWrap>
  );
}

// ─── Rack delete (keeps the dependency / impact check) ───────────────────────
export function DeleteRackDialog({ id, code, onClose, onDeleted }: { id: string; code: string; onClose: () => void; onDeleted: () => void }) {
  const { m, t } = useT();
  const d = m.warehouseMaster.del;
  const [impact, setImpact] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { warehouseMasterApi.impact('rack', id).then(setImpact).catch(() => setImpact({ error: true })); }, [id]);
  const canDelete = impact && impact.canDelete;
  async function confirm() {
    setBusy(true);
    try { await warehouseMasterApi.deleteRack(id); toast.success(d.deleted); onDeleted(); }
    catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
  }
  return (
    <ModalWrap title={t(d.title, { code })} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg bg-slate-50 border border-slate-200 p-3">
          <ShieldAlert className="h-5 w-5 text-slate-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-slate-600">{d.soft}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{d.impact}</p>
          {!impact ? <Skeleton className="h-12" /> : impact.error ? <p className="text-sm text-red-600">{d.loadFailed}</p> : (
            <div className="space-y-1.5 text-sm">
              <ImpactRow label={d.slots} value={impact.slots} bad={impact.slots > 0} />
              <ImpactRow label={d.stock} value={impact.stock} bad={impact.stock > 0} />
            </div>
          )}
        </div>
        {impact && !impact.error && !canDelete && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">{d.blocked}</p>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>{m.common.actions.cancel}</Button>
          <Button type="button" disabled={!canDelete || busy} onClick={confirm} className="flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
            {busy ? d.deleting : d.confirm}
          </Button>
        </div>
      </div>
    </ModalWrap>
  );
}

function ImpactRow({ label, value, bad }: { label: string; value: number; bad: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={cn('font-semibold tabular-nums', bad ? 'text-red-600' : 'text-green-700')}>{value}</span>
    </div>
  );
}

