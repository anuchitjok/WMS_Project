'use client';

// Warehouse setup wizard (PR4): 1 size → 2 Rack Type → 3 zones → 4 preview.
// Creating calls one backend endpoint that writes every rack and slot in a single
// transaction, so a failure never leaves half a warehouse behind.
import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { warehouseSpaceApi, type RackTypeMaster, type SetupRacksResult } from '@/lib/api-warehouse';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { autoPlace, rackSize } from '../warehouse-layout/scene-geometry';
import { floorAreaM2 } from '../warehouse-layout/floor-geometry';
import type { RackData } from '../warehouse-layout/occupancy';
import { Field, ModalWrap, optNum, selectClass } from './shared';
import { SizeWarnings } from './forms';
import { warehouseSizeWarnings } from './size-rules';

const ZONE_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const MAX_ZONES = 26, MAX_PER_ZONE = 99, MAX_RACKS = 500;
const cmToMStr = (v: number | null | undefined) => (v == null ? '' : String(Math.round(v) / 100));
const mToCm = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * 100 * 100) / 100);
const nextZoneName = (used: string[]) => {
  for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); if (!used.some((u) => u.toUpperCase() === c)) return c; }
  return '';
};

type Zone = { name: string; racks: string };

export function SetupWizard({ warehouse: initial, rackTypes, isAdmin, onClose, onDone }: {
  warehouse: any; rackTypes: RackTypeMaster[]; isAdmin: boolean; onClose: () => void; onDone: () => Promise<void> | void;
}) {
  const { m, t, fmt } = useT();
  const wz = m.warehouseMaster.wizard;
  const [warehouse, setWarehouse] = useState(initial);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  // 1) size (metres) — saved with the existing warehouse API (admin only)
  const [size, setSize] = useState({ l: cmToMStr(warehouse.lengthCm), w: cmToMStr(warehouse.widthCm), h: cmToMStr(warehouse.heightCm) });
  const L = optNum(size.l), W = optNum(size.w), H = optNum(size.h);
  const sizeOk = [L, W, H].every((v) => v === undefined || v > 0);
  const sizeChanged = mToCm(L) !== (warehouse.lengthCm ?? undefined) || mToCm(W) !== (warehouse.widthCm ?? undefined) || mToCm(H) !== (warehouse.heightCm ?? undefined);

  // 2) rack type
  const active = useMemo(() => rackTypes.filter((r) => r.isActive), [rackTypes]);
  const [typeId, setTypeId] = useState('');
  // First active type by default, also when the list arrives after opening.
  const type = active.find((r) => r.id === typeId) ?? active[0] ?? null;

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
  const body = () => ({ rackTypeId: type?.id ?? '', zones: zones.map((z) => ({ name: z.name.trim(), racks: Number(z.racks) })) });
  useEffect(() => { setPlan(null); }, [type?.id, zones]);

  async function next() {
    if (step === 1) {
      if (!sizeOk) return toast.error(m.warehouseMaster.form.positive);
      if (sizeChanged && isAdmin) {
        setBusy(true);
        try {
          await warehouseSpaceApi.updateWarehouse(warehouse.id, { lengthCm: mToCm(L) ?? null, widthCm: mToCm(W) ?? null, heightCm: mToCm(H) ?? null });
          toast.success(m.warehouseMaster.form.warehouseUpdated);
          setWarehouse({ ...warehouse, lengthCm: mToCm(L) ?? null, widthCm: mToCm(W) ?? null, heightCm: mToCm(H) ?? null });
        } catch (err: any) { toast.error(err.message); return; } finally { setBusy(false); }
      }
      return setStep(2);
    }
    if (step === 2) return type ? setStep(3) : undefined;
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
  const canNext = step === 1 ? sizeOk : step === 2 ? !!type : step === 3 ? zonesOk : false;

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
          <p className="text-sm text-slate-600">{wz.sizeHint}</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label={m.warehouseMaster.form.lengthM}><Input type="number" min={0} step="any" disabled={!isAdmin || !!warehouse.floorOutline} title={warehouse.floorOutline ? m.warehouseMaster.floorShape.shapeOwnsSize : undefined} value={size.l} onChange={(e) => setSize({ ...size, l: e.target.value })} /></Field>
            <Field label={m.warehouseMaster.form.widthM}><Input type="number" min={0} step="any" disabled={!isAdmin || !!warehouse.floorOutline} title={warehouse.floorOutline ? m.warehouseMaster.floorShape.shapeOwnsSize : undefined} value={size.w} onChange={(e) => setSize({ ...size, w: e.target.value })} /></Field>
            <Field label={m.warehouseMaster.form.heightM}><Input type="number" min={0} step="any" disabled={!isAdmin} value={size.h} onChange={(e) => setSize({ ...size, h: e.target.value })} /></Field>
          </div>
          <SizeWarnings warnings={warehouseSizeWarnings({ lengthCm: mToCm(L), widthCm: mToCm(W), heightCm: mToCm(H) })} />
          {!isAdmin && <p className="text-xs text-slate-500">{wz.sizeAdminOnly}</p>}
          {L && W ? <p className="text-sm text-slate-700">{t(wz.area, { area: fmt.number(warehouse.floorOutline ? floorAreaM2(warehouse) ?? L * W : L * W) })}</p> : <p className="text-xs text-amber-700">{wz.sizeSkip}</p>}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{wz.typeHint}</p>
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
              <div><dt className="text-xs text-slate-500">{m.warehouseMaster.category[type.category]}</dt><dd className="font-medium text-slate-800">{fmt.number(type.lengthCm)} × {fmt.number(type.widthCm)} × {fmt.number(type.heightCm)} cm</dd></div>
              <div><dt className="text-xs text-slate-500">{wz.grid}</dt><dd className="font-medium text-slate-800">{type.levels} × {type.columns}</dd></div>
              <div><dt className="text-xs text-slate-500">{wz.slotsPerRack}</dt><dd className="font-medium text-slate-800">{type.levels * type.columns}</dd></div>
              <div><dt className="text-xs text-slate-500">{wz.footprint}</dt><dd className="font-medium text-slate-800">{t(m.space.unit.m2, { value: fmt.number((type.lengthCm * type.widthCm) / 10000, 2) })}</dd></div>
            </dl>
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
            {t(wz.total, { racks: totalRacks, slots: fmt.number(totalRacks * (type ? type.levels * type.columns : 0)) })}
            {totalRacks > MAX_RACKS && ` · ${t(wz.tooMany, { max: MAX_RACKS })}`}
          </p>
        </div>
      )}

      {step === 4 && plan && (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">{t(wz.summary, { racks: plan.totalRacks, slots: fmt.number(plan.totalSlots), type: plan.rackType.code })}</p>
          <div className="flex flex-wrap gap-1">
            {plan.racks.slice(0, 40).map((r) => <span key={r.code} className="rounded border border-green-200 bg-green-50 px-1.5 py-px text-xs tabular-nums text-green-800">{r.code}</span>)}
            {plan.racks.length > 40 && <span className="text-xs text-slate-500 self-center">+{plan.racks.length - 40}</span>}
          </div>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-xs text-slate-500">{wz.newFloor}</dt><dd className="font-medium">{t(m.space.unit.m2, { value: fmt.number(plan.newFootprintM2) })}</dd></div>
            <div><dt className="text-xs text-slate-500">{wz.usedFloor}</dt><dd className="font-medium">{t(m.space.unit.m2, { value: fmt.number(plan.usedFootprintM2) })}</dd></div>
            <div><dt className="text-xs text-slate-500">{wz.usableFloor}</dt><dd className="font-medium">{plan.usableAreaM2 != null ? t(m.space.unit.m2, { value: fmt.number(plan.usableAreaM2) }) : '—'}</dd></div>
          </dl>
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
