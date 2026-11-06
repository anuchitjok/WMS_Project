'use client';

// Rack Type Master (plan P1 1.2): size templates in two categories only.
// Everyone can read; only SYSTEM_ADMIN can create / edit / (de)activate.
import { useState } from 'react';
import { Pencil, Plus, Power, PowerOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { warehouseSpaceApi, RACK_CATEGORIES, type RackCategory, type RackTypeMaster } from '@/lib/api-warehouse';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { Field, ModalWrap, Pill, isPos, optNum } from './shared';

export function RackTypesTab({ rackTypes, loading, isAdmin, onChanged }: { rackTypes: RackTypeMaster[]; loading: boolean; isAdmin: boolean; onChanged: () => void }) {
  const { m, fmt } = useT();
  const rt = m.warehouseMaster.rackTypes;
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; data?: RackTypeMaster } | null>(null);
  const rows = rackTypes.filter((r) => showInactive || r.isActive);

  async function toggle(r: RackTypeMaster) {
    try { await warehouseSpaceApi.updateRackType(r.id, { isActive: !r.isActive }); toast.success(rt.updated); onChanged(); }
    catch (err: any) { toast.error(err.message); }
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="p-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{rt.title}</h2>
          <p className="text-sm text-slate-500 max-w-2xl">{rt.subtitle}</p>
          {!isAdmin && <p className="mt-1 text-xs text-slate-500">{rt.adminOnly}</p>}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" className="accent-green-600" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> {rt.showInactive}
          </label>
          {isAdmin && (
            <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700 text-white" onClick={() => setModal({ mode: 'create' })}><Plus className="w-4 h-4" /> {rt.create}</Button>
          )}
        </div>
      </div>
      {loading ? <div className="p-5"><Skeleton className="h-32" /></div> : rows.length === 0 ? <p className="px-5 pb-6 text-sm text-slate-500">{rt.empty}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="text-left font-medium px-5 py-2">{rt.code}</th>
                <th className="text-left font-medium px-3 py-2">{rt.category}</th>
                <th className="text-left font-medium px-3 py-2">{rt.size}</th>
                <th className="text-left font-medium px-3 py-2">{rt.grid}</th>
                <th className="text-right font-medium px-3 py-2">{rt.slotCapacity}</th>
                <th className="text-right font-medium px-3 py-2">{rt.racksUsing}</th>
                <th className="text-left font-medium px-3 py-2">{rt.status}</th>
                {isAdmin && <th className="px-5 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className={cn(!r.isActive && 'text-slate-400')}>
                  <td className="px-5 py-2.5"><p className="font-medium text-slate-800">{r.code}</p><p className="text-xs text-slate-500">{r.name}</p></td>
                  <td className="px-3 py-2.5 text-slate-600">{m.warehouseMaster.category[r.category] ?? r.category}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{fmt.number(r.lengthCm)} × {fmt.number(r.widthCm)} × {fmt.number(r.heightCm)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{r.levels} × {r.columns}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.slotCapacity}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r._count?.racks ?? 0}</td>
                  <td className="px-3 py-2.5">{r.isActive ? <Pill tone="green">{rt.active}</Pill> : <Pill>{rt.inactive}</Pill>}</td>
                  {isAdmin && (
                    <td className="px-5 py-2.5 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" className="gap-1" onClick={() => setModal({ mode: 'edit', data: r })}><Pencil className="w-4 h-4" /> {m.common.actions.edit}</Button>
                      <Button size="sm" variant="ghost" className="gap-1" onClick={() => toggle(r)}>
                        {r.isActive ? <><PowerOff className="w-4 h-4" /> {rt.deactivate}</> : <><Power className="w-4 h-4" /> {rt.activate}</>}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <RackTypeForm mode={modal.mode} data={modal.data} onClose={() => setModal(null)} onSaved={() => { setModal(null); onChanged(); }} />}
    </section>
  );
}

const s = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

function RackTypeForm({ mode, data, onClose, onSaved }: { mode: 'create' | 'edit'; data?: RackTypeMaster; onClose: () => void; onSaved: () => void }) {
  const { m, t } = useT();
  const rt = m.warehouseMaster.rackTypes;
  const f = m.warehouseMaster.form;
  const [form, setForm] = useState({
    code: data?.code ?? '', name: data?.name ?? '', category: (data?.category ?? 'STANDARD_RACK') as RackCategory,
    lengthCm: s(data?.lengthCm), widthCm: s(data?.widthCm), heightCm: s(data?.heightCm),
    levels: s(data?.levels ?? 1), columns: s(data?.columns ?? 1), slotCapacity: s(data?.slotCapacity ?? 1),
    maxStackHeightCm: s(data?.maxStackHeightCm), description: data?.description ?? '',
  });
  const [busy, setBusy] = useState(false);
  const F = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const pallet = form.category === 'PALLET_ON_FLOOR';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if ((mode === 'create' && !form.code.trim()) || !form.name.trim()) return toast.error(f.required);
    const L = optNum(form.lengthCm), W = optNum(form.widthCm), H = optNum(form.heightCm), MS = optNum(form.maxStackHeightCm);
    if (L === undefined || W === undefined || H === undefined || ![L, W, H, MS].every(isPos)) return toast.error(f.positive);
    const levels = pallet ? 1 : Number(form.levels), columns = Number(form.columns), slotCapacity = Number(form.slotCapacity || 1);
    if (![levels, columns].every((n) => Number.isInteger(n) && n >= 1 && n <= 99)) return toast.error(f.gridRange);
    if (!(Number.isInteger(slotCapacity) && slotCapacity >= 1)) return toast.error(f.positive);
    const body = {
      name: form.name.trim(), category: form.category, lengthCm: L, widthCm: W, heightCm: H, levels, columns, slotCapacity,
      maxStackHeightCm: MS ?? null, description: form.description.trim() || null,
    };
    setBusy(true);
    try {
      if (mode === 'create') await warehouseSpaceApi.createRackType({ code: form.code.trim(), ...body });
      else await warehouseSpaceApi.updateRackType(data!.id, body);
      toast.success(mode === 'create' ? rt.created : rt.updated);
      onSaved();
    } catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
  }

  return (
    <ModalWrap title={mode === 'create' ? rt.create : t(rt.edit, { code: data?.code })} onClose={onClose} widthClass="max-w-xl">
      <form onSubmit={submit} className="space-y-4">
        <Field label={rt.category}>
          <div className="grid grid-cols-2 gap-2">
            {RACK_CATEGORIES.map((c) => (
              <button key={c} type="button" onClick={() => setForm({ ...form, category: c, levels: c === 'PALLET_ON_FLOOR' ? '1' : form.levels })}
                className={cn('rounded-lg border px-3 py-2 text-left', form.category === c ? 'border-green-500 bg-green-50 ring-1 ring-green-500' : 'border-slate-200 hover:border-slate-300')}>
                <span className="block text-sm font-medium text-slate-800">{m.warehouseMaster.category[c]}</span>
                <span className="block text-xs text-slate-500">{m.warehouseMaster.categoryHint[c]}</span>
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {mode === 'create' && <Field label={`${rt.code} *`}><Input autoFocus placeholder="STD-250" value={form.code} onChange={F('code')} /></Field>}
          <Field label={`${rt.name} *`} className={mode === 'create' ? '' : 'col-span-2'}><Input value={form.name} onChange={F('name')} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={`${f.length} *`}><Input type="number" min={0} step="any" value={form.lengthCm} onChange={F('lengthCm')} /></Field>
          <Field label={`${f.width} *`}><Input type="number" min={0} step="any" value={form.widthCm} onChange={F('widthCm')} /></Field>
          <Field label={`${f.height} *`}><Input type="number" min={0} step="any" value={form.heightCm} onChange={F('heightCm')} /></Field>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label={f.levels}><Input type="number" min={1} max={99} value={pallet ? '1' : form.levels} disabled={pallet} onChange={F('levels')} /></Field>
          <Field label={f.columns}><Input type="number" min={1} max={99} value={form.columns} onChange={F('columns')} /></Field>
          <Field label={rt.slotCapacity}><Input type="number" min={1} value={form.slotCapacity} onChange={F('slotCapacity')} /></Field>
          <Field label={rt.maxStack}><Input type="number" min={0} step="any" value={form.maxStackHeightCm} onChange={F('maxStackHeightCm')} /></Field>
        </div>
        {pallet && <p className="text-xs text-slate-500 -mt-2">{rt.palletNote}</p>}
        <Field label={rt.description}><Input value={form.description} onChange={F('description')} /></Field>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>{m.common.actions.cancel}</Button>
          <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700 text-white" disabled={busy}>{busy ? m.common.actions.saving : m.common.actions.save}</Button>
        </div>
      </form>
    </ModalWrap>
  );
}
