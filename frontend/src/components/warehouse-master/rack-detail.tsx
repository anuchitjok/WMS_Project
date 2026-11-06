'use client';

// Right panel for a rack: template, size, slot size, slot generation, slot grid
// with inline single and bulk editing (plan P1 1.4).
import { useEffect, useMemo, useState } from 'react';
import { Grid3x3, Pencil, Trash2, Wand2, CheckSquare, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { warehouseMasterApi } from '@/lib/api';
import { warehouseSpaceApi, type GenerateSlotsResult, type SlotChanges } from '@/lib/api-warehouse';
import { labelOf, useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { PrintLocationLabelsButton } from '@/components/documents/print-location-labels-button';
import { Fact, Field, Pill, SLOT_STATUSES, SLOT_STATUS_STYLE, SLOT_TYPES, isPos, optNum, rackCategoryOf, selectClass } from './shared';

export function RackDetail({ rack, warehouse, canEditLayout, onEdit, onDelete, onChanged }: {
  rack: any; warehouse: any; canEditLayout: boolean; onEdit: () => void; onDelete: () => void; onChanged: () => Promise<void> | void;
}) {
  const { m, t, fmt } = useT();
  const wm = m.warehouseMaster;
  const cat = rackCategoryOf(rack);
  const size = rack.effectiveSize ?? { lengthCm: rack.lengthCm, widthCm: rack.widthCm, heightCm: rack.heightCm };
  const fromTemplate = rack.rackTypeMaster && (rack.lengthCm == null || rack.widthCm == null || rack.heightCm == null);
  const ss = rack.slotSize;
  const slots: any[] = rack.slots ?? [];
  const [selected, setSelected] = useState<string[]>([]);
  const [multi, setMulti] = useState(false);

  // Drop selections that no longer exist after a reload / rack change.
  useEffect(() => { setSelected([]); setMulti(false); }, [rack.id]);
  useEffect(() => { setSelected((cur) => cur.filter((id) => slots.some((s) => s.id === id))); }, [slots]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(id: string, additive: boolean) {
    if (!canEditLayout && !additive) { setSelected([id]); return; }
    if (multi || additive) setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    else setSelected((cur) => (cur.length === 1 && cur[0] === id ? [] : [id]));
  }
  const selSlots = slots.filter((s) => selected.includes(s.id));

  return (
    <div className="space-y-4">
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <nav className="text-xs text-slate-500 mb-1">{warehouse.code} · {warehouse.name}</nav>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-slate-900">{rack.code}</h2>
              <Pill tone="green">{wm.category[cat]}</Pill>
            </div>
            {(rack.name || rack.zone) && <p className="text-sm text-slate-600">{[rack.name, rack.zone && `${wm.detail.zone} ${rack.zone}`].filter(Boolean).join(' · ')}</p>}
          </div>
          {canEditLayout && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={onEdit}><Pencil className="w-4 h-4" /> {wm.actions.editRack}</Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-red-600 hover:text-red-700" onClick={onDelete}><Trash2 className="w-4 h-4" /> {wm.actions.deleteRack}</Button>
            </div>
          )}
        </div>
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Fact label={wm.rack.template}>{rack.rackTypeMaster ? `${rack.rackTypeMaster.code} · ${rack.rackTypeMaster.name}` : <span className="text-slate-500 font-normal">{wm.rack.noTemplate}</span>}</Fact>
          <Fact label={wm.rack.size}>
            {size.lengthCm != null && size.widthCm != null
              ? <>{fmt.number(size.lengthCm)} × {fmt.number(size.widthCm)} × {size.heightCm != null ? fmt.number(size.heightCm) : '—'} cm{fromTemplate && <span className="block text-xs text-slate-500 font-normal">{wm.rack.sizeFromTemplate}</span>}</>
              : <span className="text-slate-500 font-normal">{wm.warehouse.sizeUnknown}</span>}
          </Fact>
          <Fact label={wm.rack.grid}>{rack.levels} × {rack.columns} = {rack.levels * rack.columns}</Fact>
          <Fact label={wm.rack.slotSize}>
            {ss?.lengthCm != null && ss?.widthCm != null
              ? <>{fmt.number(ss.lengthCm)} × {fmt.number(ss.widthCm)} × {ss.heightCm != null ? fmt.number(ss.heightCm) : '—'} cm
                  <span className="block text-xs text-slate-500 font-normal">{t(m.space.unit.m2, { value: fmt.number(ss.areaM2, 3) })}{ss.volumeM3 != null ? ` · ${t(m.space.unit.m3, { value: fmt.number(ss.volumeM3, 3) })}` : ''}</span></>
              : <span className="text-slate-500 font-normal text-xs">{wm.rack.slotSizeUnknown}</span>}
          </Fact>
        </dl>
      </section>

      {canEditLayout && <GeneratePanel rack={rack} onDone={onChanged} />}

      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Grid3x3 className="w-4 h-4 text-slate-400" /> {wm.rack.slotsTitle} <span className="text-slate-500 font-normal">({slots.length})</span></h3>
          {canEditLayout && slots.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant={multi ? 'default' : 'outline'} className={cn('gap-1.5', multi && 'bg-green-600 hover:bg-green-700 text-white')} onClick={() => setMulti((v) => !v)}>
                {multi ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />} {wm.rack.multiSelect}
              </Button>
              {selected.length > 1 && <span className="text-sm text-slate-600">{t(wm.rack.selectedCount, { count: selected.length })}</span>}
              <Button size="sm" variant="outline" onClick={() => { setMulti(true); setSelected(slots.map((s) => s.id)); }}>{wm.rack.selectAll}</Button>
              {selected.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected([])}>{wm.rack.clearSelection}</Button>}
            </div>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">{slots.length ? wm.rack.slotsHint : wm.rack.noSlots}</p>
        {slots.length > 0 && (
          <>
            <SlotGrid rack={rack} slots={slots} selected={selected} onPick={pick} />
            <Legend />
            {/* Location labels (plan P5 5.4): whole rack, or the selected slots */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PrintLocationLabelsButton target={{ rackIds: [rack.id] }} fileName={`labels-${warehouse.code}-${rack.code}.pdf`} />
              {selected.length > 0 && (
                <PrintLocationLabelsButton target={{ slotIds: selected }} fileName={`labels-${warehouse.code}-${rack.code}-selected.pdf`}
                  label={selected.length === 1 ? m.documents.labels.printSlot : t(m.documents.labels.printSelected, { count: selected.length })} />
              )}
            </div>
          </>
        )}

        {selSlots.length === 1 && <SlotEditor key={selSlots[0].id} slot={selSlots[0]} canEdit={canEditLayout} onSaved={onChanged} onDeleted={async () => { setSelected([]); await onChanged(); }} />}
        {selSlots.length > 1 && canEditLayout && <BulkEditor key={selected.join(',')} ids={selected} onSaved={onChanged} />}

        {slots.length > 0 && <AllSlotsList slots={slots} selected={selected} onPick={pick} />}
      </section>
    </div>
  );
}

// ─── Generate slots ───────────────────────────────────────────────────────────
function GeneratePanel({ rack, onDone }: { rack: any; onDone: () => Promise<void> | void }) {
  const { m, t } = useT();
  const g = m.warehouseMaster.generate;
  const [levels, setLevels] = useState(String(rack.levels ?? 1));
  const [columns, setColumns] = useState(String(rack.columns ?? 1));
  const [preview, setPreview] = useState<GenerateSlotsResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setLevels(String(rack.levels ?? 1)); setColumns(String(rack.columns ?? 1)); setPreview(null); }, [rack.id, rack.levels, rack.columns]);

  const lv = Number(levels), cl = Number(columns);
  const valid = [lv, cl].every((n) => Number.isInteger(n) && n >= 1 && n <= 99);

  async function run(isPreview: boolean) {
    if (!valid) return toast.error(m.warehouseMaster.form.gridRange);
    setBusy(true);
    try {
      const r = await warehouseSpaceApi.generateSlots(rack.id, lv, cl, isPreview);
      if (isPreview) setPreview(r);
      else { toast.success(t(g.created, { count: r.created })); setPreview(null); await onDone(); }
    } catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
  }

  const shown = preview?.slots.slice(0, 60) ?? [];
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Wand2 className="w-4 h-4 text-slate-400" /> {g.title}</h3>
      <p className="mt-1 text-sm text-slate-500">{t(g.hint, { example: `${rack.code}-01-08` })}</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label={g.levels}><Input type="number" min={1} max={99} value={levels} onChange={(e) => { setLevels(e.target.value); setPreview(null); }} className="w-24" /></Field>
        <Field label={g.columns}><Input type="number" min={1} max={99} value={columns} onChange={(e) => { setColumns(e.target.value); setPreview(null); }} className="w-24" /></Field>
        <Button variant="outline" onClick={() => run(true)} disabled={busy || !valid}>{g.preview}</Button>
        {preview && preview.toCreate > 0 && (
          <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => run(false)} disabled={busy}>{t(g.create, { count: preview.toCreate })}</Button>
        )}
      </div>
      {preview && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <p className="text-sm text-slate-700">{t(g.summary, { total: preview.total, toCreate: preview.toCreate, existing: preview.existing })}</p>
          {preview.toCreate === 0 && <p className="text-sm text-slate-500 mt-1">{g.nothingToCreate}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {shown.map((s) => (
              <span key={s.code} className={cn('rounded-md border px-1.5 py-0.5 text-xs tabular-nums', s.exists ? 'border-slate-200 bg-white text-slate-400 line-through' : 'border-green-200 bg-green-50 text-green-800')}
                title={s.exists ? g.exists : g.new}>{s.code}</span>
            ))}
            {preview.slots.length > shown.length && <span className="text-xs text-slate-500 self-center">{t(g.moreCodes, { count: preview.slots.length - shown.length })}</span>}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Grid ─────────────────────────────────────────────────────────────────────
function SlotGrid({ rack, slots, selected, onPick }: { rack: any; slots: any[]; selected: string[]; onPick: (id: string, additive: boolean) => void }) {
  const { m, t } = useT();
  const wm = m.warehouseMaster;
  const maxLevel = Math.min(99, Math.max(rack.levels ?? 1, ...slots.map((s) => s.level ?? 1)));
  const maxCol = Math.min(99, Math.max(rack.columns ?? 1, ...slots.map((s) => s.column ?? 1)));
  const byCell = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const s of slots) {
      const k = `${s.level}-${s.column}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return map;
  }, [slots]);
  const levels = Array.from({ length: maxLevel }, (_, i) => maxLevel - i);
  const cols = Array.from({ length: maxCol }, (_, i) => i + 1);
  const short = (code: string) => (code.startsWith(`${rack.code}-`) ? code.slice(rack.code.length + 1) : code);

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="border-separate border-spacing-1">
        <thead>
          <tr>
            <th />
            {cols.map((c) => <th key={c} className="text-xs font-medium text-slate-500 px-1">{t(wm.rack.column, { n: c })}</th>)}
          </tr>
        </thead>
        <tbody>
          {levels.map((lv) => (
            <tr key={lv}>
              <th className="text-xs font-medium text-slate-500 pr-2 text-right whitespace-nowrap">{t(wm.rack.level, { n: String(lv).padStart(2, '0') })}</th>
              {cols.map((c) => {
                const cell = byCell.get(`${lv}-${c}`) ?? [];
                const s = cell[0];
                if (!s) return <td key={c}><div className="h-12 min-w-[64px] rounded-md border border-dashed border-slate-200" /></td>;
                const isSel = cell.some((x) => selected.includes(x.id));
                return (
                  <td key={c}>
                    <button type="button"
                      onClick={(e) => onPick(s.id, e.ctrlKey || e.metaKey || e.shiftKey)}
                      title={`${s.code} · ${labelOf(wm.slotStatus, s.status)}`}
                      className={cn('h-12 min-w-[64px] w-full rounded-md border px-1.5 text-left transition-shadow',
                        SLOT_STATUS_STYLE[s.status] ?? SLOT_STATUS_STYLE.EMPTY,
                        isSel && 'ring-2 ring-green-600 ring-offset-1')}>
                      <span className="block text-xs font-medium tabular-nums truncate">{short(s.code)}</span>
                      <span className="block text-xs opacity-80 truncate">
                        {(s._count?.stockItems ?? 0) > 0 ? `${s._count.stockItems}` : labelOf(wm.slotStatus, s.status)}
                        {cell.length > 1 && ` ${t(wm.rack.extraInCell, { count: cell.length - 1 })}`}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Legend() {
  const { m } = useT();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
      <span>{m.warehouseMaster.rack.legend}:</span>
      {SLOT_STATUSES.map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className={cn('inline-block h-3 w-3 rounded-sm border', SLOT_STATUS_STYLE[s])} /> {m.warehouseMaster.slotStatus[s]}
        </span>
      ))}
    </div>
  );
}

// ─── All slots (reaches slots whose level/column overlap in the grid) ────────
function AllSlotsList({ slots, selected, onPick }: { slots: any[]; selected: string[]; onPick: (id: string, additive: boolean) => void }) {
  const { m, t } = useT();
  const wm = m.warehouseMaster;
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm text-slate-600 hover:text-slate-800">{wm.rack.allSlots}</summary>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="text-left font-medium px-3 py-2">{wm.detail.code}</th>
              <th className="text-left font-medium px-3 py-2">{wm.slot.position}</th>
              <th className="text-left font-medium px-3 py-2">{wm.slot.type}</th>
              <th className="text-left font-medium px-3 py-2">{wm.slot.status}</th>
              <th className="text-right font-medium px-3 py-2">{wm.slot.capacity}</th>
              <th className="text-right font-medium px-3 py-2">{wm.slot.stock}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {slots.map((s) => (
              <tr key={s.id} onClick={(e) => onPick(s.id, e.ctrlKey || e.metaKey || e.shiftKey)}
                className={cn('cursor-pointer', selected.includes(s.id) ? 'bg-green-50' : 'hover:bg-slate-50')}>
                <td className="px-3 py-1.5 font-medium text-slate-800">{s.code}</td>
                <td className="px-3 py-1.5 text-slate-600">{t(wm.slot.positionValue, { level: s.level, column: s.column })}</td>
                <td className="px-3 py-1.5 text-slate-600">{labelOf(wm.slotType, s.slotType)}</td>
                <td className="px-3 py-1.5 text-slate-600">{labelOf(wm.slotStatus, s.status)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{s.capacity}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{s._count?.stockItems ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ─── Single slot editor (inline, no popup) ────────────────────────────────────
const s2 = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

function SlotEditor({ slot, canEdit, onSaved, onDeleted }: { slot: any; canEdit: boolean; onSaved: () => Promise<void> | void; onDeleted: () => Promise<void> | void }) {
  const { m, t } = useT();
  const sl = m.warehouseMaster.slot;
  const [form, setForm] = useState({
    name: slot.name ?? '', slotType: slot.slotType ?? 'STANDARD', capacity: s2(slot.capacity), maxWeight: s2(slot.maxWeight),
    lengthCm: s2(slot.lengthCm), widthCm: s2(slot.widthCm), heightCm: s2(slot.heightCm),
  });
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const stock = slot._count?.stockItems ?? 0;
  const F = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const L = optNum(form.lengthCm), W = optNum(form.widthCm), H = optNum(form.heightCm);
    if (![L, W, H].every(isPos)) return toast.error(m.warehouseMaster.form.positive);
    const cap = Number(form.capacity || 0);
    const mw = optNum(form.maxWeight);
    setBusy(true);
    try {
      await warehouseSpaceApi.updateSlot(slot.id, {
        name: form.name.trim() || null, slotType: form.slotType, capacity: Number.isFinite(cap) && cap >= 0 ? Math.floor(cap) : 0,
        maxWeight: mw ?? null, lengthCm: L ?? null, widthCm: W ?? null, heightCm: H ?? null,
      });
      toast.success(sl.saved);
      await onSaved();
    } catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
  }

  async function del() {
    setBusy(true);
    try {
      const impact = await warehouseMasterApi.impact('slot', slot.id);
      if (!impact?.canDelete) { toast.error(sl.deleteBlocked); return; }
      await warehouseMasterApi.deleteSlot(slot.id);
      toast.success(sl.deleted);
      await onDeleted();
    } catch (err: any) { toast.error(err.message); } finally { setBusy(false); setConfirmDel(false); }
  }

  return (
    <form onSubmit={save} className="mt-4 rounded-lg border border-green-200 bg-green-50/30 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">{t(sl.editTitle, { code: slot.code })}</h4>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t(sl.positionValue, { level: slot.level, column: slot.column })}</span>
          <Pill>{labelOf(m.warehouseMaster.slotStatus, slot.status)}</Pill>
          <span>{sl.stock}: {stock}</span>
        </div>
      </div>
      <fieldset disabled={!canEdit} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label={sl.name} className="col-span-2"><Input value={form.name} onChange={F('name')} /></Field>
        <Field label={sl.type}>
          <select className={selectClass} value={form.slotType} onChange={F('slotType')}>
            {SLOT_TYPES.map((x) => <option key={x} value={x}>{m.warehouseMaster.slotType[x]}</option>)}
          </select>
        </Field>
        <Field label={sl.capacity}><Input type="number" min={0} value={form.capacity} onChange={F('capacity')} /></Field>
        <Field label={sl.length}><Input type="number" min={0} step="any" value={form.lengthCm} onChange={F('lengthCm')} /></Field>
        <Field label={sl.width}><Input type="number" min={0} step="any" value={form.widthCm} onChange={F('widthCm')} /></Field>
        <Field label={sl.height}><Input type="number" min={0} step="any" value={form.heightCm} onChange={F('heightCm')} /></Field>
        <Field label={sl.maxWeight}><Input type="number" min={0} step="any" value={form.maxWeight} onChange={F('maxWeight')} /></Field>
      </fieldset>
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {!confirmDel ? (
              <Button type="button" size="sm" variant="ghost" className="gap-1.5 text-red-600 hover:text-red-700" disabled={busy || stock > 0} onClick={() => setConfirmDel(true)}>
                <Trash2 className="w-4 h-4" /> {sl.delete}
              </Button>
            ) : (
              <>
                <span className="text-sm text-slate-600">{t(sl.deleteConfirm, { code: slot.code })}</span>
                <Button type="button" size="sm" className="bg-red-600 hover:bg-red-700 text-white" disabled={busy} onClick={del}>{m.common.actions.delete}</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setConfirmDel(false)}>{m.common.actions.cancel}</Button>
              </>
            )}
            {stock > 0 && <span className="text-xs text-slate-500">{sl.deleteBlocked}</span>}
          </div>
          <Button type="submit" size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={busy}>{busy ? m.common.actions.saving : m.common.actions.save}</Button>
        </div>
      )}
    </form>
  );
}

// ─── Bulk editor ──────────────────────────────────────────────────────────────
function BulkEditor({ ids, onSaved }: { ids: string[]; onSaved: () => Promise<void> | void }) {
  const { m, t } = useT();
  const sl = m.warehouseMaster.slot;
  const [form, setForm] = useState({ slotType: '', capacity: '', maxWeight: '', lengthCm: '', widthCm: '', heightCm: '' });
  const [busy, setBusy] = useState(false);
  const F = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const changes: SlotChanges = {};
    if (form.slotType) changes.slotType = form.slotType;
    const cap = optNum(form.capacity);
    if (cap !== undefined) { if (!(Number.isInteger(cap) && cap >= 0)) return toast.error(m.warehouseMaster.form.positive); changes.capacity = cap; }
    const mw = optNum(form.maxWeight);
    if (mw !== undefined) { if (!(mw >= 0)) return toast.error(m.warehouseMaster.form.positive); changes.maxWeight = mw; }
    for (const k of ['lengthCm', 'widthCm', 'heightCm'] as const) {
      const v = optNum(form[k]);
      if (v !== undefined) { if (!isPos(v)) return toast.error(m.warehouseMaster.form.positive); changes[k] = v; }
    }
    if (!Object.keys(changes).length) return;
    setBusy(true);
    try {
      const r = await warehouseSpaceApi.bulkUpdateSlots(ids, changes);
      toast.success(t(sl.bulkSaved, { count: r.updated }));
      setForm({ slotType: '', capacity: '', maxWeight: '', lengthCm: '', widthCm: '', heightCm: '' });
      await onSaved();
    } catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="mt-4 rounded-lg border border-green-200 bg-green-50/30 p-4 space-y-3">
      <h4 className="text-sm font-semibold text-slate-900">{t(sl.bulkTitle, { count: ids.length })}</h4>
      <p className="text-sm text-slate-500">{sl.bulkHint}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label={sl.type}>
          <select className={selectClass} value={form.slotType} onChange={F('slotType')}>
            <option value="">{sl.keep}</option>
            {SLOT_TYPES.map((x) => <option key={x} value={x}>{m.warehouseMaster.slotType[x]}</option>)}
          </select>
        </Field>
        <Field label={sl.capacity}><Input type="number" min={0} placeholder={sl.keep} value={form.capacity} onChange={F('capacity')} /></Field>
        <Field label={sl.maxWeight}><Input type="number" min={0} step="any" placeholder={sl.keep} value={form.maxWeight} onChange={F('maxWeight')} /></Field>
        <Field label={sl.length}><Input type="number" min={0} step="any" placeholder={sl.keep} value={form.lengthCm} onChange={F('lengthCm')} /></Field>
        <Field label={sl.width}><Input type="number" min={0} step="any" placeholder={sl.keep} value={form.widthCm} onChange={F('widthCm')} /></Field>
        <Field label={sl.height}><Input type="number" min={0} step="any" placeholder={sl.keep} value={form.heightCm} onChange={F('heightCm')} /></Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={busy}>{busy ? m.common.actions.saving : m.common.actions.save}</Button>
      </div>
    </form>
  );
}
