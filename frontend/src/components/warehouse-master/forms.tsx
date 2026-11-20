'use client';

// Create/edit forms for warehouses and racks, and the rack delete dialog.
import { useEffect, useState } from 'react';
import { Lock, ShieldAlert, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LengthInput, LengthUnitPicker, useLengthUnit } from '@/components/ui/length-input';
import { Skeleton } from '@/components/ui/skeleton';
import { warehouseMasterApi } from '@/lib/api';
import { warehouseSpaceApi, RACK_CATEGORIES, type RackCategory, type RackTypeMaster } from '@/lib/api-warehouse';
import { formatLength, lengthUnitLabel } from '@/lib/length';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { Field, ModalWrap, isPos, optNum, rackCategoryOf } from './shared';
import { type SizeCm, type SizeWarning, rackSizeWarnings, warehouseSizeWarnings, rackBiggerThanWarehouse } from './size-rules';
import { FloorShapeField, initialShapeState, shapeResult, shapeTemplate, type ShapeState } from './floor-shape-field';
import { outlineFromTemplate, validateOutline, normalizeOutline, polygonArea, type Pt } from '@/components/warehouse-layout/floor-geometry';

const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

/**
 * A size as the forms hold it: centimetres, exactly as stored (RQ1 / C1).
 * The unit the user types in lives in `<LengthInput>`, not here — this file no
 * longer converts anything. The private `mToCm` / `cmToMStr` pair that used to
 * sit at the top of this file is gone; `@/lib/length` is the only converter.
 */
type SizeState = { lengthCm?: number; widthCm?: number; heightCm?: number };
const sizeOf = (d: { lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null } | undefined): SizeState => ({
  lengthCm: d?.lengthCm ?? undefined, widthCm: d?.widthCm ?? undefined, heightCm: d?.heightCm ?? undefined,
});
/** cm → metres, for the floor-shape field and the area sums, which work in metres. */
const toM = (cm: number | undefined) => (cm === undefined ? undefined : cm / 100);

// ─── Suggested names (RQ2 warehouse, RQ6 rack type) ──────────────────────────
const NAME_MAX = 120;
/** Trim and collapse the spaces people leave while typing. */
const squash = (v: string) => v.trim().replace(/\s+/g, ' ');
/** Compare two parts ignoring case and the separators codes are written with. */
const nameKey = (v: string) => squash(v).toLowerCase().replace(/[\s_\-.]+/g, '');

/**
 * Join two parts into a suggested name, never repeating one inside the other.
 * Real data does repeat itself — warehouses exist whose Name and Location are
 * both `HSNT_WHCM` — so `HSNT_WHCM HSNT_WHCM` must never come out of this.
 *   one part empty → the other part alone
 *   same part twice (ignoring case, spaces, - _ .) → that part once
 *   one already contained in the other → the longer, fuller one
 *   otherwise → "first second"
 */
export function suggestName(first: string, second: string): string {
  const a = squash(first), b = squash(second);
  if (!a || !b) return (a || b).slice(0, NAME_MAX);
  const ka = nameKey(a), kb = nameKey(b);
  if (!ka || !kb || ka === kb) return (a.length >= b.length ? a : b).slice(0, NAME_MAX);
  // Short parts ("A", "B1") are left alone: they are too easy to find inside anything.
  if (ka.length >= 3 && kb.includes(ka)) return b.slice(0, NAME_MAX);
  if (kb.length >= 3 && ka.includes(kb)) return a.slice(0, NAME_MAX);
  return `${a} ${b}`.slice(0, NAME_MAX);
}

/**
 * A Name field that keeps itself in step with a suggestion until the user types
 * their own, and then offers the suggestion back. Never locks the field: the name
 * is on reports, labels and the 3D view, so a format can be a default, not a rule.
 */
export function AutoNameField({ label, value, suggestion, auto, hint, onType, onUseSuggestion }: {
  label: string; value: string; suggestion: string; auto: boolean; hint: string;
  onType: (v: string) => void; onUseSuggestion: () => void;
}) {
  const { m, t } = useT();
  const w = m.warehouseMaster.form;
  const canRestore = !auto && !!suggestion && squash(value) !== suggestion;
  return (
    <Field label={label}>
      <Input value={value} onChange={(e) => onType(e.target.value)} />
      {auto && !!value && <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Sparkles className="h-3 w-3 text-green-600" aria-hidden />{hint}</p>}
      {canRestore && (
        <button type="button" onClick={onUseSuggestion} className="mt-1 text-xs text-green-700 underline underline-offset-2 hover:text-green-800">
          {t(w.nameUseSuggestion, { name: suggestion })}
        </button>
      )}
    </Field>
  );
}

/** Yellow notes under the size fields. Warn only: the form still saves (decision G4). */
export function SizeWarnings({ warnings, bigger }: { warnings: SizeWarning[]; bigger?: { l: number; w: number } | null }) {
  const { m, t, fmt } = useT();
  const W = m.warehouseMaster.form.warn;
  if (!warnings.length && !bigger) return null;
  return (
    <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
      <ul className="list-disc space-y-0.5 pl-4">
        {warnings.map((x) => <li key={x.key}>{t(W[x.key as Exclude<SizeWarning['key'], 'rackBiggerThanWarehouse' | 'slotTooSmall'>], { limit: x.limit })}</li>)}
        {bigger && <li>{t(W.rackBiggerThanWarehouse, { l: fmt.number(bigger.l, 1), w: fmt.number(bigger.w, 1) })}</li>}
      </ul>
      <p className="mt-1 text-amber-800/80">{W.canSave}</p>
    </div>
  );
}

// ─── Warehouse ────────────────────────────────────────────────────────────────
export function WarehouseForm({ mode, data, onClose, onSaved }: { mode: 'create' | 'edit'; data?: any; onClose: () => void; onSaved: () => void }) {
  const { m, t, fmt } = useT();
  const w = m.warehouseMaster.form;
  const [form, setForm] = useState({
    name: data?.name ?? '', location: data?.location ?? '',
    usableAreaPct: data ? str(data.usableAreaPct ?? 100) : '100',
  });
  // Centimetres, as stored. The unit on screen is the user's own choice (RQ1).
  const [size, setSize] = useState<SizeState>(() => sizeOf(data));
  const [busy, setBusy] = useState(false);
  const F = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  // The API owns the warehouse code (WH-<NAME SLUG>-<RUNNING NUMBER>): the user
  // types the name, this is only a preview of what the code would be. RQ2's
  // name-from-code suggestion does not apply here any more — it would run the
  // other way round — but Rack Types still use it (RQ6).
  const [codePreview, setCodePreview] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== 'create') return;
    const name = form.name.trim();
    if (!name) { setCodePreview(null); return; }
    let dropped = false;
    const id = setTimeout(() => {
      warehouseSpaceApi.previewWarehouseCode(name)
        .then((r) => { if (!dropped) setCodePreview(r.preview); })
        .catch(() => { if (!dropped) setCodePreview(null); });
    }, 300);
    return () => { dropped = true; clearTimeout(id); };
  }, [form.name, mode]);
  // F2 floor shape. A saved shape not made by this form (CUSTOM) is kept as is.
  const [shape, setShape] = useState<ShapeState>(() => initialShapeState(data?.floorOutline));
  const savedPoints: Pt[] | null = data?.floorOutline && validateOutline(data.floorOutline.points).length === 0
    ? normalizeOutline(data.floorOutline.points) : null;

  // The floor shape and the area sums below work in metres; sizes are stored in cm.
  const L = toM(size.lengthCm), W = toM(size.widthCm), H = toM(size.heightCm), P = optNum(form.usableAreaPct) ?? 100;
  const shaped = shape.shape === 'CUSTOM'
    ? { area: savedPoints ? polygonArea(savedPoints) : null, errors: [] }
    : shapeResult(shape, L, W);
  const area = shaped.area;
  const computed = area != null
    ? t(w.computed, { area: fmt.number(area), usable: fmt.number((area * Math.min(100, Math.max(0, P))) / 100), volume: H && H > 0 ? fmt.number(area * H) : '—' })
    : w.computedNone;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error(w.required);
    if (![size.lengthCm, size.widthCm, size.heightCm].every(isPos)) return toast.error(w.positive);
    const pctRaw = optNum(form.usableAreaPct);
    if (pctRaw !== undefined && !(pctRaw > 0 && pctRaw <= 100)) return toast.error(w.pctRange);
    // Blank sizes: omitted on create, cleared (null) on edit.
    const blank = mode === 'create' ? undefined : null;
    const sizes: Record<string, unknown> = { lengthCm: size.lengthCm ?? blank, widthCm: size.widthCm ?? blank, heightCm: size.heightCm ?? blank, usableAreaPct: pctRaw ?? 100 };
    // Floor shape: L/U/T → send the outline (the API sets length × width from it);
    // Rectangle → clear a saved shape; CUSTOM → leave the saved shape and its size alone.
    const tpl = shapeTemplate(shape, L, W);
    if (tpl) {
      if (shaped.errors.length) return toast.error(m.warehouseMaster.floorShape.fixShape);
      sizes.floorOutline = outlineFromTemplate(tpl);
    } else if (shape.shape === 'RECT' && mode === 'edit' && data?.floorOutline) sizes.floorOutline = null;
    else if (shape.shape === 'CUSTOM') { delete sizes.lengthCm; delete sizes.widthCm; }
    setBusy(true);
    try {
      if (mode === 'create') await warehouseSpaceApi.createWarehouse({ name: form.name.trim(), location: form.location.trim() || undefined, ...sizes });
      else await warehouseSpaceApi.updateWarehouse(data.id, { name: form.name.trim(), location: form.location.trim() || null, ...sizes });
      toast.success(mode === 'create' ? w.warehouseCreated : w.warehouseUpdated);
      onSaved();
    } catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
  }

  return (
    <ModalWrap title={mode === 'create' ? w.createWarehouse : t(w.editWarehouse, { code: data?.code })} onClose={onClose} widthClass="max-w-lg">
      <form onSubmit={submit} className="space-y-3">
        <Field label={`${w.name} *`}><Input autoFocus value={form.name} onChange={F('name')} /></Field>
        <Field label={w.code} hint={mode === 'create' ? w.codeAutoHint : w.codeFixedHint}>
          <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 font-mono text-sm text-slate-700" aria-readonly="true">
            {mode === 'create'
              ? (codePreview ?? <span className="font-sans text-slate-400">{w.codePreviewEmpty}</span>)
              : data?.code}
          </div>
        </Field>
        <Field label={w.location}><Input value={form.location} onChange={F('location')} /></Field>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{w.sizeSection}</p>
            <LengthUnitPicker />
          </div>
          <p className="mb-2 text-xs text-slate-400">{w.sizeSectionHint}</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label={w.length}>
              <LengthInput value={size.lengthCm} onChange={(cm) => setSize((s) => ({ ...s, lengthCm: cm }))} placeholderCm={4000}
                disabled={shape.shape === 'CUSTOM'} title={shape.shape === 'CUSTOM' ? m.warehouseMaster.floorShape.shapeOwnsSize : undefined} />
            </Field>
            <Field label={w.width}>
              <LengthInput value={size.widthCm} onChange={(cm) => setSize((s) => ({ ...s, widthCm: cm }))} placeholderCm={2500}
                disabled={shape.shape === 'CUSTOM'} title={shape.shape === 'CUSTOM' ? m.warehouseMaster.floorShape.shapeOwnsSize : undefined} />
            </Field>
            <Field label={w.height}>
              <LengthInput value={size.heightCm} onChange={(cm) => setSize((s) => ({ ...s, heightCm: cm }))} placeholderCm={800} />
            </Field>
          </div>
          <SizeWarnings warnings={warehouseSizeWarnings(size)} />
        </div>
        <FloorShapeField value={shape} onChange={setShape} length={L} width={W} customPoints={savedPoints} />
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
export function RackForm({ mode, warehouseId, data, rackTypes, prefillTemplateId, warehouse, onClose, onSaved }: {
  mode: 'create' | 'edit'; warehouseId?: string; data?: any; rackTypes: RackTypeMaster[]; prefillTemplateId?: string;
  /** The rack's warehouse size, to warn when the rack would not fit. */
  warehouse?: SizeCm | null;
  onClose: () => void; onSaved: () => void;
}) {
  const { m, t, fmt } = useT();
  const unit = useLengthUnit();
  const w = m.warehouseMaster.form;
  const prefill = prefillTemplateId ? rackTypes.find((r) => r.id === prefillTemplateId) : undefined;
  const [form, setForm] = useState(() => ({
    code: data?.code ?? '', name: data?.name ?? '', zone: data?.zone ?? '', description: data?.description ?? '',
    rackTypeId: (data?.rackTypeId ?? prefill?.id ?? '') as string,
    category: (prefill?.category ?? (data ? rackCategoryOf(data) : 'STANDARD_RACK')) as RackCategory,
    levels: str(data?.levels ?? prefill?.levels ?? 1), columns: str(data?.columns ?? prefill?.columns ?? 1),
  }));
  // Centimetres, as stored (RQ1): the unit on screen belongs to <LengthInput>.
  const [size, setSize] = useState<SizeState>(() => sizeOf({
    lengthCm: data?.lengthCm ?? prefill?.lengthCm, widthCm: data?.widthCm ?? prefill?.widthCm, heightCm: data?.heightCm ?? prefill?.heightCm,
  }));
  // Only send the category when the user changes it, so editing other fields
  // never rewrites an older rack's stored type.
  const [typeTouched, setTypeTouched] = useState(mode === 'create');
  const [busy, setBusy] = useState(false);
  const F = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const preview = rackPreview({ ...size, levels: form.levels, columns: form.columns }, form.category === 'PALLET_ON_FLOOR');
  const template = rackTypes.find((r) => r.id === form.rackTypeId);
  /**
   * RQ7 — while a rack has a rack type, its size / levels / columns are read
   * from that type and the API refuses them here. The type is not chosen on
   * this form: it arrives from the capacity planner or the setup wizard, or
   * the rack already had one.
   */
  const sizeFromType = !!template;
  const sizeNow: SizeCm = size;
  const bigger = warehouse && rackBiggerThanWarehouse(sizeNow, warehouse) && warehouse.lengthCm && warehouse.widthCm
    ? { l: warehouse.lengthCm / 100, w: warehouse.widthCm / 100 } : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'create' && !form.code.trim()) return toast.error(w.required);
    const { lengthCm: L, widthCm: W, heightCm: H } = size;
    const blank = mode === 'create' ? undefined : null;
    const payload: Record<string, unknown> = {
      name: form.name.trim() || blank, zone: form.zone.trim() || blank, description: form.description.trim() || blank,
    };
    // RQ7 (decision C3): with a rack type, the size and the grid belong to the
    // type — the API rejects them here (RACK_SIZE_FROM_TYPE). A rack with no
    // rack type keeps its own size, as before.
    if (!sizeFromType) {
      if (![L, W, H].every(isPos)) return toast.error(w.positive);
      const levels = Number(form.levels), columns = Number(form.columns);
      if (![levels, columns].every((n) => Number.isInteger(n) && n >= 1 && n <= 99)) return toast.error(w.gridRange);
      Object.assign(payload, { levels, columns, lengthCm: L ?? blank, widthCm: W ?? blank, heightCm: H ?? blank });
    }
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
        <Field label={w.category}>
          <div className="grid grid-cols-2 gap-2">
            {RACK_CATEGORIES.map((c) => (
              <button key={c} type="button"
                onClick={() => {
                  setTypeTouched(true);
                  // A rack keeps its rack type only while the chosen category still
                  // matches it. Picking the other one unlinks the rack, and the
                  // type's numbers stay behind as the rack's own starting point so
                  // the size fields are never handed back empty.
                  const unlink = !!template && template.category !== c;
                  if (unlink) {
                    setSize((z) => ({
                      lengthCm: z.lengthCm ?? template!.lengthCm,
                      widthCm: z.widthCm ?? template!.widthCm,
                      heightCm: z.heightCm ?? template!.heightCm,
                    }));
                  }
                  setForm({
                    ...form,
                    category: c,
                    rackTypeId: unlink ? '' : form.rackTypeId,
                    levels: c === 'PALLET_ON_FLOOR' ? '1' : unlink ? String(template!.levels) : form.levels,
                    columns: unlink ? String(template!.columns) : form.columns,
                  });
                }}
                className={cn('rounded-lg border px-3 py-2 text-left transition-colors',
                  form.category === c ? 'border-green-500 bg-green-50 ring-1 ring-green-500' : 'border-slate-200 hover:border-slate-300')}>
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
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{w.sizeSection}</p>
            <LengthUnitPicker />
          </div>
          {sizeFromType ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                {t(w.rackSizeFromType, { code: `${template!.code} · ${template!.name}` })}
              </p>
              <dl className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-5">
                <Derived label={w.length} value={formatLength(template!.lengthCm, unit, { format: fmt.number })} />
                <Derived label={w.width} value={formatLength(template!.widthCm, unit, { format: fmt.number })} />
                <Derived label={w.height} value={formatLength(template!.heightCm, unit, { format: fmt.number })} />
                <Derived label={w.levels} value={String(template!.levels)} />
                <Derived label={w.columns} value={String(template!.columns)} />
              </dl>
              <p className="mt-2 text-xs text-slate-500">{w.rackSizeFromTypeHow}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Field label={w.length}><LengthInput value={size.lengthCm} onChange={(cm) => setSize((s) => ({ ...s, lengthCm: cm }))} /></Field>
                <Field label={w.width}><LengthInput value={size.widthCm} onChange={(cm) => setSize((s) => ({ ...s, widthCm: cm }))} /></Field>
                <Field label={w.height}><LengthInput value={size.heightCm} onChange={(cm) => setSize((s) => ({ ...s, heightCm: cm }))} /></Field>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label={w.levels}><Input type="number" min={1} max={99} value={form.levels} onChange={F('levels')} /></Field>
                <Field label={w.columns}><Input type="number" min={1} max={99} value={form.columns} onChange={F('columns')} /></Field>
              </div>
              <p className="mt-2 text-xs text-slate-500">{w.rackSizeOwn}</p>
            </>
          )}
          <SizeWarnings warnings={rackSizeWarnings(sizeNow)} bigger={bigger} />
        </div>
        {preview ? (
          <div className={cn('rounded-lg px-3 py-2 text-sm', preview.tooSmall ? 'bg-amber-50 text-amber-900' : 'bg-green-50 text-green-800')}>
            <p>{t(preview.floor ? w.rackPreviewFloor : w.rackPreview, {
              area: fmt.number(preview.areaM2, 2), n: preview.slots, unit: lengthUnitLabel(unit),
              w: formatLength(preview.slotW, unit, { withUnit: false, format: fmt.number }),
              d: formatLength(preview.slotD, unit, { withUnit: false, format: fmt.number }),
              h: formatLength(preview.slotH, unit, { withUnit: false, format: fmt.number }),
            })}</p>
            {preview.tooSmall && <p className="mt-0.5 text-xs">{w.slotTooSmall}</p>}
          </div>
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">{w.rackPreviewNone}</p>
        )}
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>{m.common.actions.cancel}</Button>
          <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700 text-white" disabled={busy}>{busy ? m.common.actions.saving : m.common.actions.save}</Button>
        </div>
      </form>
    </ModalWrap>
  );
}

/** One value the rack form reads from the rack type: shown, not typed in. */
function Derived({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500 truncate">{label}</dt>
      <dd className="text-sm font-medium text-slate-700 tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * What the rack form will create: footprint (m²), slot count and the size of
 * one slot in cm. Shelf racks: each level × column is a bay cell. Pallet on
 * floor: "levels" are rows across the depth (nothing stacked).
 * `tooSmall` = a slot side under 25 cm, usually a size typed in the wrong unit
 * or far too many levels/columns. null until length, width, height and grid are set.
 */
export function rackPreview(f: { lengthCm?: number; widthCm?: number; heightCm?: number; levels: string; columns: string }, floor: boolean) {
  const L = f.lengthCm, W = f.widthCm, H = f.heightCm;
  const lv = Number(f.levels), cl = Number(f.columns);
  if (!(L && W && H && L > 0 && W > 0 && H > 0 && lv >= 1 && cl >= 1)) return null;
  const slotW = L / cl, slotD = floor ? W / lv : W, slotH = floor ? H : H / lv;
  const minSide = Math.min(slotW, slotD, floor ? Infinity : slotH);
  return { floor, areaM2: (L * W) / 10_000, slots: lv * cl, slotW, slotD, slotH, tooSmall: minSide < 25 };
}

// ─── Rack delete (keeps the dependency / impact check) ───────────────────────
export function DeleteRackDialog({ id, code, onClose, onDeleted }: { id: string; code: string; onClose: () => void; onDeleted: () => void }) {
  const { m, t } = useT();
  const d = m.warehouseMaster.del;
  const [impact, setImpact] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { warehouseMasterApi.impact('rack', id).then(setImpact).catch(() => setImpact({ error: true })); }, [id]);
  // The server decides: stock now, stock history and open relocation lines block a
  // delete; slots do not — they go with the rack. In a warehouse that has been in
  // use most racks cannot be deleted, so deactivating is the usual answer here.
  const canDelete = impact && impact.canDelete;
  const slots: number = impact && !impact.error ? (impact.slots ?? 0) : 0;
  const blockers: { kind: string; count: number; message: string }[] = impact?.blockers ?? [];
  /** A 409 the delete itself hit (stock put away since the check). */
  const [conflict, setConflict] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setConflict(null);
    try {
      const r = await warehouseSpaceApi.deleteRack(id);
      // The structure tree reads what is deleted from the server, so nothing has
      // to be remembered here for the rack to be restorable.
      toast.success(r?.slotsDeleted ? t(d.deletedWithSlots, { count: r.slotsDeleted }) : d.deleted);
      onDeleted();
    }
    catch (err: any) { if (err?.status === 409) setConflict(err.message); toast.error(err.message); }
    finally { setBusy(false); }
  }

  /** The way out when a delete is blocked: the rack stays, switched off. */
  async function deactivate() {
    setBusy(true);
    try {
      await warehouseSpaceApi.deactivateRack(id);
      toast.success(m.warehouseMaster.form.rackDeactivated);
      onDeleted(); // closes this dialog and reloads the structure
    } catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
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
              {/* Slots are not a blocker: they are deleted with the rack and restored with it. */}
              <ImpactRow label={d.slots} value={impact.slots ?? 0} bad={false} />
              <ImpactRow label={d.stock} value={impact.stock ?? 0} bad={(impact.stock ?? 0) > 0} />
              <ImpactRow label={d.history} value={impact.history ?? 0} bad={(impact.history ?? 0) > 0} />
              <ImpactRow label={d.openRelocations} value={impact.openRelocations ?? 0} bad={(impact.openRelocations ?? 0) > 0} />
            </div>
          )}
        </div>
        {impact && !impact.error && canDelete && !conflict && (
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 space-y-1">
            <p>{slots > 0 ? t(d.willDelete, { code, count: slots }) : t(d.willDeleteNoSlots, { code })}</p>
            <p className="text-xs text-slate-500">{d.restorable}</p>
          </div>
        )}
        {impact && !impact.error && (!canDelete || conflict) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 space-y-1.5">
            <p className="font-medium">{d.blocked}</p>
            {/* The reasons are the server's own words, not ours. */}
            {conflict ? <p>{conflict}</p> : blockers.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-4">{blockers.map((b) => <li key={b.kind}>{b.message}</li>)}</ul>
            ) : null}
            <p>{d.blockedUseDeactivate}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>{m.common.actions.cancel}</Button>
          {impact && !impact.error && (!canDelete || conflict) ? (
            <Button type="button" disabled={busy} onClick={deactivate} className="flex-1 bg-green-600 text-white hover:bg-green-700">
              {m.warehouseMaster.actions.deactivateRack}
            </Button>
          ) : (
            <Button type="button" disabled={!canDelete || busy} onClick={confirm} className="flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
              {busy ? d.deleting : d.confirm}
            </Button>
          )}
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

