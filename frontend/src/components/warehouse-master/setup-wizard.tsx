'use client';

// Warehouse setup wizard (PR4): 1 size → 2 Rack Type or size → 3 zones → 4 preview.
// Creating calls one backend endpoint that writes every rack and slot in a single
// transaction, so a failure never leaves half a warehouse behind.
//
// Step 2 offers two ways in (RQ25 / decision C3): pick a Rack Type that exists, or
// type a size and let the server find the matching Rack Type or make one. They are
// mutually exclusive here, because the API refuses a request that carries both.
// Step 4 shows what will be created before anything is written (RQ26): one row per
// rack with its size and floor area, the total, the code pattern the codes follow
// (C4), and — when the run would add a Rack Type — a plain warning that it will.
import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LengthInput, LengthUnitPicker, useLengthUnit } from '@/components/ui/length-input';
import { warehouseSpaceApi, RACK_CATEGORIES, type RackCategory, type SetupRacksBody, type RackTypeMaster, type SetupRacksResult } from '@/lib/api-warehouse';
import { formatLength } from '@/lib/length';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { autoPlace, rackSize } from '../warehouse-layout/scene-geometry';
import { floorAreaM2 } from '../warehouse-layout/floor-geometry';
import type { RackData } from '../warehouse-layout/occupancy';
import { Field, ModalWrap, selectClass } from './shared';
import { SizeWarnings } from './forms';
import { rackSizeWarnings, warehouseSizeWarnings } from './size-rules';

const ZONE_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const MAX_ZONES = 26, MAX_PER_ZONE = 99, MAX_RACKS = 500;
/** Rows the preview table draws in full before it summarises the rest (RQ26). */
const MAX_PREVIEW_ROWS = 20;
const nextZoneName = (used: string[]) => {
  for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); if (!used.some((u) => u.toUpperCase() === c)) return c; }
  return '';
};

type Zone = { name: string; racks: string };
/** Step 2: take the size from a Rack Type, or type it. Never both (the API refuses). */
type RackSource = 'TYPE' | 'SIZE';
const intIn = (v: string, min: number, max: number) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max; };

export function SetupWizard({ warehouse: initial, rackTypes, isAdmin, onClose, onDone }: {
  warehouse: any; rackTypes: RackTypeMaster[]; isAdmin: boolean; onClose: () => void; onDone: () => Promise<void> | void;
}) {
  const { m, t, fmt } = useT();
  const unit = useLengthUnit();
  const wz = m.warehouseMaster.wizard;
  const wf = m.warehouseMaster.form;
  const [warehouse, setWarehouse] = useState(initial);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  // 1) warehouse size — centimetres, as stored; the unit on screen is the user's
  // own choice (RQ1). Saved with the existing warehouse API (admin only).
  const [size, setSize] = useState<{ lengthCm?: number; widthCm?: number; heightCm?: number }>({
    lengthCm: warehouse.lengthCm ?? undefined, widthCm: warehouse.widthCm ?? undefined, heightCm: warehouse.heightCm ?? undefined,
  });
  const sizeOk = [size.lengthCm, size.widthCm, size.heightCm].every((v) => v === undefined || v > 0);
  const sizeChanged = size.lengthCm !== (warehouse.lengthCm ?? undefined)
    || size.widthCm !== (warehouse.widthCm ?? undefined)
    || size.heightCm !== (warehouse.heightCm ?? undefined);
  // Metres, for the area line (the floor outline is stored in metres).
  const L = size.lengthCm === undefined ? undefined : size.lengthCm / 100;
  const W = size.widthCm === undefined ? undefined : size.widthCm / 100;

  // 2) rack type, or a size to make one from (C3)
  const active = useMemo(() => rackTypes.filter((r) => r.isActive), [rackTypes]);
  const [typeId, setTypeId] = useState('');
  // First active type by default, also when the list arrives after opening.
  const type = active.find((r) => r.id === typeId) ?? active[0] ?? null;
  // No rack types at all: typing a size is the only way, so start there.
  const [sourcePick, setSourcePick] = useState<RackSource | null>(null);
  const source: RackSource = sourcePick ?? (active.length ? 'TYPE' : 'SIZE');
  const [rackSizeCm, setRackSizeCm] = useState<{ lengthCm?: number; widthCm?: number; heightCm?: number }>({});
  const [grid, setGrid] = useState({ category: 'STANDARD_RACK' as RackCategory, levels: '1', columns: '1', slotCapacity: '1' });
  const palletOnFloor = grid.category === 'PALLET_ON_FLOOR';
  const gridLevels = palletOnFloor ? 1 : Number(grid.levels);
  const rackSizeOk = [rackSizeCm.lengthCm, rackSizeCm.widthCm, rackSizeCm.heightCm].every((v) => v !== undefined && v > 0)
    && (palletOnFloor || intIn(grid.levels, 1, 99)) && intIn(grid.columns, 1, 99) && intIn(grid.slotCapacity, 1, 9999);
  const slotsPerRack = source === 'TYPE' ? (type ? type.levels * type.columns : 0) : gridLevels * Number(grid.columns);

  // 3) zones
  const [zones, setZones] = useState<Zone[]>([{ name: 'A', racks: '4' }]);
  const zoneErrors = zones.map((z, i) => {
    const n = Number(z.racks);
    if (!ZONE_RE.test(z.name.trim()) || z.name.trim().length > 20) return wz.zoneNameBad;
    if (zones.some((o, j) => j < i && o.name.trim().toUpperCase() === z.name.trim().toUpperCase())) return wz.zoneDup;
    if (!Number.isInteger(n) || n < 1 || n > MAX_PER_ZONE) return t(wz.racksRange, { max: MAX_PER_ZONE });
    return null;
  });
  const totalRacks = zones.reduce((a, z) => a + (Number(z.racks) || 0), 0);
  const zonesOk = zones.length > 0 && zoneErrors.every((e) => !e) && totalRacks <= MAX_RACKS;

  // 4) preview from the server (codes, counts, warnings)
  const [plan, setPlan] = useState<SetupRacksResult | null>(null);
  /**
   * Exactly one of the two forms, decided by `source`. The API rejects a request
   * that carries a size beside a `rackTypeId`, so the shape is built from scratch
   * for whichever one the user is on — there is no way to send both from here.
   */
  const body = (): SetupRacksBody => {
    const z = zones.map((x) => ({ name: x.name.trim(), racks: Number(x.racks) }));
    if (source === 'TYPE') return { rackTypeId: type?.id ?? '', zones: z };
    return {
      lengthCm: rackSizeCm.lengthCm!, widthCm: rackSizeCm.widthCm!, heightCm: rackSizeCm.heightCm!,
      category: grid.category, levels: gridLevels, columns: Number(grid.columns), slotCapacity: Number(grid.slotCapacity),
      zones: z,
    };
  };
  useEffect(() => { setPlan(null); }, [source, type?.id, zones, rackSizeCm, grid]);

  async function next() {
    if (step === 1) {
      if (!sizeOk) return toast.error(m.warehouseMaster.form.positive);
      if (sizeChanged && isAdmin) {
        const patch = { lengthCm: size.lengthCm ?? null, widthCm: size.widthCm ?? null, heightCm: size.heightCm ?? null };
        setBusy(true);
        try {
          await warehouseSpaceApi.updateWarehouse(warehouse.id, patch);
          toast.success(m.warehouseMaster.form.warehouseUpdated);
          setWarehouse({ ...warehouse, ...patch });
        } catch (err: any) { toast.error(err.message); return; } finally { setBusy(false); }
      }
      return setStep(2);
    }
    if (step === 2) return (source === 'TYPE' ? !!type : rackSizeOk) ? setStep(3) : undefined;
    if (step === 3) {
      if (!zonesOk) return;
      setBusy(true);
      try { setPlan(await warehouseSpaceApi.setupRacks(warehouse.id, { ...body(), preview: true })); setStep(4); }
      catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
    }
  }

  async function create() {
    setBusy(true);
    try {
      const r = await warehouseSpaceApi.setupRacks(warehouse.id, body());
      toast.success(t(wz.created, { racks: r.created, slots: fmt.number(r.totalSlots) }));
      await onDone();
    } catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
  }

  const steps = [wz.step1, wz.step2, wz.step3, wz.step4];
  const canNext = step === 1 ? sizeOk : step === 2 ? (source === 'TYPE' ? !!type : rackSizeOk) : step === 3 ? zonesOk : false;

  return (
    <ModalWrap title={t(wz.title, { code: warehouse.code })} onClose={onClose} widthClass="max-w-3xl">
      <ol className="mb-5 grid grid-cols-4 gap-2" aria-label={wz.stepsLabel}>
        {steps.map((s, i) => (
          <li key={s} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs',
            step === i + 1 ? 'border-green-600 bg-green-50 text-green-800 font-medium' : step > i + 1 ? 'border-slate-200 text-slate-600' : 'border-slate-200 text-slate-400')}
            aria-current={step === i + 1 ? 'step' : undefined}>
            <span className={cn('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px]',
              step > i + 1 ? 'bg-green-600 text-white' : step === i + 1 ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-500')}>
              {step > i + 1 ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className="truncate">{s}</span>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="max-w-xl text-sm text-slate-600">{wz.sizeHint}</p>
            <LengthUnitPicker />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={wf.length}>
              <LengthInput value={size.lengthCm} onChange={(cm) => setSize((s) => ({ ...s, lengthCm: cm }))}
                disabled={!isAdmin || !!warehouse.floorOutline} title={warehouse.floorOutline ? m.warehouseMaster.floorShape.shapeOwnsSize : undefined} />
            </Field>
            <Field label={wf.width}>
              <LengthInput value={size.widthCm} onChange={(cm) => setSize((s) => ({ ...s, widthCm: cm }))}
                disabled={!isAdmin || !!warehouse.floorOutline} title={warehouse.floorOutline ? m.warehouseMaster.floorShape.shapeOwnsSize : undefined} />
            </Field>
            <Field label={wf.height}>
              <LengthInput value={size.heightCm} onChange={(cm) => setSize((s) => ({ ...s, heightCm: cm }))} disabled={!isAdmin} />
            </Field>
          </div>
          <SizeWarnings warnings={warehouseSizeWarnings(size)} />
          {!isAdmin && <p className="text-xs text-slate-500">{wz.sizeAdminOnly}</p>}
          {L && W ? <p className="text-sm text-slate-700">{t(wz.area, { area: fmt.number(warehouse.floorOutline ? floorAreaM2(warehouse) ?? L * W : L * W) })}</p> : <p className="text-xs text-amber-700">{wz.sizeSkip}</p>}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{wz.typeHint}</p>
          {/* One or the other (C3). Switching here is what keeps the request valid:
              the API refuses a size sent beside a rack type. */}
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={wz.step2}>
            {([
              { key: 'TYPE' as const, label: wz.modeType, hint: wz.modeTypeHint, off: active.length === 0 },
              { key: 'SIZE' as const, label: wz.modeSize, hint: wz.modeSizeHint, off: false },
            ]).map((o) => (
              <button key={o.key} type="button" role="radio" aria-checked={source === o.key} disabled={o.off}
                onClick={() => setSourcePick(o.key)}
                className={cn('rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  source === o.key ? 'border-green-500 bg-green-50 ring-1 ring-green-500' : 'border-slate-200 hover:border-slate-300')}>
                <span className="block text-sm font-medium text-slate-800">{o.label}</span>
                <span className="block text-xs text-slate-500">{o.hint}</span>
              </button>
            ))}
          </div>

          {source === 'TYPE' ? (
            <>
              {active.length === 0 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{wz.noTypes}</p>
              ) : (
                <Field label={wz.type}>
                  <select className={selectClass} value={type?.id ?? ''} onChange={(e) => setTypeId(e.target.value)}>
                    {active.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
                  </select>
                </Field>
              )}
              {type && (
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                  <div><dt className="text-xs text-slate-500">{m.warehouseMaster.category[type.category]}</dt><dd className="font-medium text-slate-800">
                    {formatLength(type.lengthCm, unit, { withUnit: false, format: fmt.number })} × {formatLength(type.widthCm, unit, { withUnit: false, format: fmt.number })} × {formatLength(type.heightCm, unit, { format: fmt.number })}
                  </dd></div>
                  <div><dt className="text-xs text-slate-500">{wz.grid}</dt><dd className="font-medium text-slate-800">{type.levels} × {type.columns}</dd></div>
                  <div><dt className="text-xs text-slate-500">{wz.slotsPerRack}</dt><dd className="font-medium text-slate-800">{type.levels * type.columns}</dd></div>
                  <div><dt className="text-xs text-slate-500">{wz.footprint}</dt><dd className="font-medium text-slate-800">{t(m.space.unit.m2, { value: fmt.number((type.lengthCm * type.widthCm) / 10000, 2) })}</dd></div>
                </dl>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <Field label={wf.category}>
                <div className="grid grid-cols-2 gap-2">
                  {RACK_CATEGORIES.map((c) => (
                    <button key={c} type="button" onClick={() => setGrid((g) => ({ ...g, category: c }))}
                      className={cn('rounded-lg border px-3 py-2 text-left transition-colors',
                        grid.category === c ? 'border-green-500 bg-green-50 ring-1 ring-green-500' : 'border-slate-200 hover:border-slate-300')}>
                      <span className="block text-sm font-medium text-slate-800">{m.warehouseMaster.category[c]}</span>
                      <span className="block text-xs text-slate-500">{m.warehouseMaster.categoryHint[c]}</span>
                    </button>
                  ))}
                </div>
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{wf.sizeSection}</p>
                <LengthUnitPicker />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label={`${wf.length} *`}><LengthInput value={rackSizeCm.lengthCm} onChange={(cm) => setRackSizeCm((s) => ({ ...s, lengthCm: cm }))} /></Field>
                <Field label={`${wf.width} *`}><LengthInput value={rackSizeCm.widthCm} onChange={(cm) => setRackSizeCm((s) => ({ ...s, widthCm: cm }))} /></Field>
                <Field label={`${wf.height} *`}><LengthInput value={rackSizeCm.heightCm} onChange={(cm) => setRackSizeCm((s) => ({ ...s, heightCm: cm }))} /></Field>
              </div>
              <SizeWarnings warnings={rackSizeWarnings(rackSizeCm)} />
              <div className="grid grid-cols-3 gap-3">
                <Field label={wf.levels}><Input type="number" min={1} max={99} value={palletOnFloor ? '1' : grid.levels} disabled={palletOnFloor} onChange={(e) => setGrid((g) => ({ ...g, levels: e.target.value }))} /></Field>
                <Field label={wf.columns}><Input type="number" min={1} max={99} value={grid.columns} onChange={(e) => setGrid((g) => ({ ...g, columns: e.target.value }))} /></Field>
                <Field label={m.warehouseMaster.rackTypes.slotCapacity}><Input type="number" min={1} value={grid.slotCapacity} onChange={(e) => setGrid((g) => ({ ...g, slotCapacity: e.target.value }))} /></Field>
              </div>
              <p className="text-xs text-slate-500">{wz.sizeMakesType}</p>
              {!rackSizeOk && <p className="text-xs text-amber-700">{wz.sizeNeeded}</p>}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{t(wz.zonesHint, { example: `${zones[0]?.name.trim() || 'A'}-R01` })}</p>
          <div className="space-y-2">
            {zones.map((z, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <Field label={i === 0 ? wz.zone : ''} className="w-32">
                  <Input value={z.name} maxLength={20} aria-label={wz.zone} onChange={(e) => setZones(zones.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                </Field>
                <Field label={i === 0 ? wz.racks : ''} className="w-28">
                  <Input type="number" min={1} max={MAX_PER_ZONE} aria-label={wz.racks} value={z.racks} onChange={(e) => setZones(zones.map((x, j) => (j === i ? { ...x, racks: e.target.value } : x)))} />
                </Field>
                <div className={cn('flex items-center gap-2', i === 0 && 'mt-5')}>
                  <span className="text-xs text-slate-500 tabular-nums">{ZONE_RE.test(z.name.trim()) && Number(z.racks) >= 1 ? `${z.name.trim()}-R01 …` : ''}</span>
                  {zones.length > 1 && (
                    <Button type="button" size="sm" variant="ghost" className="text-slate-500" aria-label={wz.removeZone} onClick={() => setZones(zones.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  )}
                </div>
                {zoneErrors[i] && <p className="basis-full text-xs text-red-600">{zoneErrors[i]}</p>}
              </div>
            ))}
          </div>
          {zones.length < MAX_ZONES && (
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setZones([...zones, { name: nextZoneName(zones.map((z) => z.name.trim())), racks: '4' }])}>
              <Plus className="h-4 w-4" /> {wz.addZone}
            </Button>
          )}
          <p className={cn('text-sm', totalRacks > MAX_RACKS ? 'text-red-600' : 'text-slate-700')}>
            {t(wz.total, { racks: totalRacks, slots: fmt.number(totalRacks * slotsPerRack) })}
            {totalRacks > MAX_RACKS && ` · ${t(wz.tooMany, { max: MAX_RACKS })}`}
          </p>
        </div>
      )}

      {step === 4 && plan && (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">{t(wz.summary, { racks: plan.totalRacks, slots: fmt.number(plan.totalSlots), type: plan.rackType.code })}</p>

          {/* C3 — a run that adds a Rack Type says so before the user commits,
              rather than leaving them to find a new type afterwards. */}
          {plan.rackType.willBeCreated ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
              <p className="flex items-start gap-1.5 font-medium">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                {t(wz.willCreateType, { code: plan.rackType.code, name: plan.rackType.name })}
              </p>
              <p className="mt-0.5 text-xs text-amber-800/80">{wz.willCreateTypeHint}</p>
            </div>
          ) : plan.rackType.autoCreated ? (
            <p className="text-xs text-slate-500">{t(wz.reusesAutoType, { code: plan.rackType.code })}</p>
          ) : null}

          <RackPlanTable plan={plan} />

          {/* C4 — the codes these racks will get. The pattern itself is a system
              setting and is not edited here. */}
          <p className="text-xs text-slate-500">
            {t(plan.rackCodePattern === 'rack-001' ? wz.patternFlat : wz.patternZone, { example: plan.racks[0]?.code ?? '' })}
            {' '}{wz.patternNote}
          </p>

          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-xs text-slate-500">{wz.newFloor}</dt><dd className="font-medium">{t(m.space.unit.m2, { value: fmt.number(plan.newFootprintM2) })}</dd></div>
            <div><dt className="text-xs text-slate-500">{wz.usedFloor}</dt><dd className="font-medium">{t(m.space.unit.m2, { value: fmt.number(plan.usedFootprintM2) })}</dd></div>
            <div><dt className="text-xs text-slate-500">{wz.usableFloor}</dt><dd className="font-medium">{plan.usableAreaM2 != null ? t(m.space.unit.m2, { value: fmt.number(plan.usableAreaM2) }) : '—'}</dd></div>
          </dl>
          {/* The point users get wrong: this is the racks' own footprint. */}
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{wz.footprintOnly}</p>
          {plan.warnings.length > 0 && (
            <ul className="list-disc rounded-lg bg-amber-50 py-2 pl-7 pr-3 text-xs text-amber-900" role="status">
              {plan.warnings.map((w) => <li key={w}>{w === 'OVER_AREA' ? wz.warnOverArea : wz.warnNoSize}</li>)}
            </ul>
          )}
          <LayoutPreview warehouse={warehouse} plan={plan} />
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variant="outline" disabled={busy} onClick={() => (step === 1 ? onClose() : setStep(step - 1))}>
          {step === 1 ? m.common.actions.cancel : wz.back}
        </Button>
        {step < 4 ? (
          <Button type="button" className="bg-green-600 hover:bg-green-700 text-white" disabled={busy || !canNext} onClick={next}>{wz.next}</Button>
        ) : (
          <Button type="button" className="bg-green-600 hover:bg-green-700 text-white" disabled={busy || !plan} onClick={create}>
            {t(wz.create, { racks: plan?.totalRacks ?? 0 })}
          </Button>
        )}
      </div>
    </ModalWrap>
  );
}

/**
 * RQ26 — what will be created, rack by rack: code, length, width and the floor
 * area of each one, with a Total row that matches the server's `newFootprintM2`.
 *
 * Every rack in one run is the same size, so a 500-rack run does not draw 500
 * identical rows: the first {MAX_PREVIEW_ROWS} are listed, the rest are summed
 * into one line that says how many they are, and the Total still covers them all.
 */
function RackPlanTable({ plan }: { plan: SetupRacksResult }) {
  const { m, t, fmt } = useT();
  const unit = useLengthUnit();
  const wz = m.warehouseMaster.wizard;
  const wf = m.warehouseMaster.form;
  const m2 = (v: number | null) => (v == null ? '—' : t(m.space.unit.m2, { value: fmt.number(v, 2) }));
  const len = (v: number | null | undefined) => formatLength(v, unit, { format: fmt.number });
  const shown = plan.racks.slice(0, MAX_PREVIEW_ROWS);
  const rest = plan.racks.length - shown.length;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <caption className="sr-only">{wz.tableCaption}</caption>
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">{wz.tableCode}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{wf.length}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{wf.width}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{wz.tableArea}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {shown.map((r) => (
            <tr key={r.code}>
              <td className="px-3 py-1.5 font-medium text-slate-800 tabular-nums">{r.code}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{len(r.lengthCm)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{len(r.widthCm)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{m2(r.footprintM2)}</td>
            </tr>
          ))}
          {rest > 0 && (
            <tr className="bg-slate-50/60 text-slate-500">
              <td className="px-3 py-1.5" colSpan={3}>{t(wz.tableMore, { count: rest })}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                {plan.rackFootprintM2 == null ? '—' : m2(Math.round(rest * plan.rackFootprintM2 * 100) / 100)}
              </td>
            </tr>
          )}
        </tbody>
        <tfoot className="border-t border-slate-200 bg-slate-50 font-medium text-slate-800">
          <tr>
            <td className="px-3 py-2">{t(wz.tableTotal, { count: plan.totalRacks })}</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right tabular-nums">{m2(plan.newFootprintM2)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Top view of the warehouse with the existing racks (grey) and the planned ones
 * (green), arranged by the same automatic layout the 3D view uses. A sketch to
 * check the fit; nothing here is saved.
 */
function LayoutPreview({ warehouse, plan }: { warehouse: any; plan: SetupRacksResult }) {
  const { m, t } = useT();
  const wz = m.warehouseMaster.wizard;
  const { placed, unplaced, outline } = useMemo(() => {
    const t = plan.rackType;
    const planned: RackData[] = plan.racks.map((r) => ({
      id: `new:${r.code}`, code: r.code, zone: r.zone, rackType: t.category === 'PALLET_ON_FLOOR' ? 'PALLET' : 'STANDARD',
      levels: t.levels, columns: t.columns, isActive: true, slots: [],
      rackTypeMaster: { category: t.category, lengthCm: t.lengthCm, widthCm: t.widthCm, heightCm: t.heightCm },
    }));
    const existing: RackData[] = (warehouse.racks ?? []).filter((r: any) => r.isActive !== false).map((r: any) => ({ ...r, slots: [] }));
    const res = autoPlace([...existing, ...planned], warehouse);
    return {
      placed: res.placed.map((p) => ({ ...p, size: rackSize(p.rack), isNew: p.rack.id.startsWith('new:') })),
      unplaced: res.unplaced, outline: res.outline,
    };
  }, [warehouse, plan]);
  if (!placed.length) return null;

  const realW = warehouse.lengthCm ? warehouse.lengthCm / 100 : 0, realD = warehouse.widthCm ? warehouse.widthCm / 100 : 0;
  const maxX = Math.max(realW, ...placed.map((p) => p.center[0] + p.size.length / 2));
  const maxZ = Math.max(realD, ...placed.map((p) => p.center[1] + p.size.depth / 2));
  const pad = 1;
  return (
    <figure className="rounded-lg border border-slate-200 bg-slate-50 p-2">
      <svg viewBox={`${-pad} ${-pad} ${maxX + pad * 2} ${maxZ + pad * 2}`} className="h-64 w-full" role="img" aria-label={wz.previewLabel}>
        {outline
          ? <polygon points={outline.map(([x, z]) => `${x},${z}`).join(' ')} fill="#fff" stroke="#94a3b8" strokeWidth={Math.max(maxX, maxZ) / 300} />
          : realW > 0 && realD > 0 && <rect x={0} y={0} width={realW} height={realD} fill="#fff" stroke="#94a3b8" strokeWidth={Math.max(maxX, maxZ) / 300} />}
        {placed.map((p) => (
          <rect key={p.rack.id} x={p.center[0] - p.size.length / 2} y={p.center[1] - p.size.depth / 2} width={p.size.length} height={p.size.depth}
            fill={p.isNew ? '#16a34a' : '#cbd5e1'} opacity={p.isNew ? 0.85 : 1}>
            <title>{p.rack.code}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-600" /> {wz.legendNew}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-300" /> {wz.legendExisting}</span>
        <span>{wz.previewNote}</span>
        {unplaced.length > 0 && <span className="font-medium text-red-700">{t(wz.previewUnplaced, { n: unplaced.length, codes: unplaced.slice(0, 6).map((r) => r.code).join(', ') })}</span>}
      </figcaption>
    </figure>
  );
}
