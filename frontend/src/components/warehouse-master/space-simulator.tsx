'use client';

// Space Simulator (plan P1 1.6) — "what if" only; nothing is saved.
// The maths runs on the backend (POST /warehouse-master/space-simulate).
import { useEffect, useRef, useState } from 'react';
import { Calculator, Download, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { productsApi } from '@/lib/api';
import { warehouseSpaceApi, type SimulateInput, type SimulationResult, type WarehouseSpaceSummary } from '@/lib/api-warehouse';
import { getT, useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { Field, Pill, optNum } from './shared';

interface Line {
  key: number;
  productId: string | null;
  productLabel: string;
  productHasSize: boolean;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  quantity: string;
  stackLayers: string;
}
let nextKey = 1;
const newLine = (): Line => ({ key: nextKey++, productId: null, productLabel: '', productHasSize: false, lengthCm: '', widthCm: '', heightCm: '', quantity: '', stackLayers: '1' });

export function SpaceSimulator({ warehouses }: { warehouses: WarehouseSpaceSummary[] }) {
  const { m } = useT();
  const s = m.space.sim;
  const active = warehouses.filter((w) => w.isActive);
  const [mode, setMode] = useState<'SIMPLE' | 'ITEMS'>('SIMPLE');
  const [simpleKind, setSimpleKind] = useState<'AREA' | 'SLOTS'>('AREA');
  const [areaM2, setAreaM2] = useState('');
  const [slots, setSlots] = useState('');
  const [whIds, setWhIds] = useState<string[]>([]);
  const [palletL, setPalletL] = useState('120');
  const [palletW, setPalletW] = useState('100');
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [busy, setBusy] = useState(false);

  const setLine = (key: number, patch: Partial<Line>) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function run() {
    const input: SimulateInput = { mode: mode === 'ITEMS' ? 'ITEMS' : simpleKind, warehouseIds: whIds.length ? whIds : undefined };
    if (input.mode === 'AREA') {
      const v = Number(areaM2); if (!(v > 0)) return toast.error(s.validation); input.areaM2 = v;
    } else if (input.mode === 'SLOTS') {
      const v = Number(slots); if (!(Number.isInteger(v) && v > 0)) return toast.error(s.validation); input.slots = v;
    } else {
      const pl = optNum(palletL), pw = optNum(palletW);
      if (pl !== undefined) { if (!(pl > 0)) return toast.error(s.validation); input.palletLengthCm = pl; }
      if (pw !== undefined) { if (!(pw > 0)) return toast.error(s.validation); input.palletWidthCm = pw; }
      const valid = lines.filter((l) => Number(l.quantity) > 0);
      if (!valid.length) return toast.error(s.validationLines);
      input.lines = valid.map((l) => {
        const dim = (v: string) => { const n = optNum(v); return n !== undefined && n > 0 ? n : undefined; };
        return {
          productId: l.productId ?? undefined,
          label: l.productLabel || undefined,
          lengthCm: dim(l.lengthCm), widthCm: dim(l.widthCm), heightCm: dim(l.heightCm),
          quantity: Number(l.quantity),
          stackLayers: Math.max(1, Math.floor(Number(l.stackLayers) || 1)),
        };
      });
    }
    setBusy(true);
    try { setResult(await warehouseSpaceApi.simulate(input)); }
    catch (err: any) { toast.error(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{s.title}</h2>
          <p className="text-sm text-slate-500">{s.subtitle}</p>
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
          {(['SIMPLE', 'ITEMS'] as const).map((k) => (
            <button key={k} type="button" onClick={() => { setMode(k); setResult(null); }}
              className={cn('px-3 py-1.5 text-sm rounded-md', mode === k ? 'bg-white shadow-sm text-green-700 font-medium' : 'text-slate-600 hover:text-slate-800')}>
              {k === 'SIMPLE' ? s.modeArea : s.modeItems}
            </button>
          ))}
        </div>

        {mode === 'SIMPLE' ? (
          <div className="flex flex-wrap items-end gap-4">
            <Field label={s.requestType}>
              <div className="flex gap-3 h-9 items-center text-sm">
                {(['AREA', 'SLOTS'] as const).map((k) => (
                  <label key={k} className="flex items-center gap-1.5 text-slate-700">
                    <input type="radio" className="accent-green-600" checked={simpleKind === k} onChange={() => { setSimpleKind(k); setResult(null); }} />
                    {k === 'AREA' ? s.byArea : s.bySlots}
                  </label>
                ))}
              </div>
            </Field>
            {simpleKind === 'AREA'
              ? <Field label={s.areaValue}><Input type="number" min={0} step="any" value={areaM2} onChange={(e) => setAreaM2(e.target.value)} className="w-40" /></Field>
              : <Field label={s.slotsValue}><Input type="number" min={1} value={slots} onChange={(e) => setSlots(e.target.value)} className="w-40" /></Field>}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label={s.palletLength}><Input type="number" min={1} step="any" value={palletL} onChange={(e) => setPalletL(e.target.value)} className="w-28" /></Field>
              <Field label={s.palletWidth}><Input type="number" min={1} step="any" value={palletW} onChange={(e) => setPalletW(e.target.value)} className="w-28" /></Field>
              <span className="text-xs text-slate-500 pb-2">{s.pallet}</span>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{s.lines}</p>
              <div className="space-y-2">
                {lines.map((l) => (
                  <LineRow key={l.key} line={l} onChange={(p) => setLine(l.key, p)} onRemove={lines.length > 1 ? () => setLines((cur) => cur.filter((x) => x.key !== l.key)) : undefined} />
                ))}
              </div>
              <Button type="button" size="sm" variant="outline" className="mt-2 gap-1.5" onClick={() => setLines((cur) => [...cur, newLine()])}><Plus className="w-4 h-4" /> {s.addLine}</Button>
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-slate-600 mb-1">{s.warehouses}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setWhIds([])}
              className={cn('rounded-full border px-3 py-1 text-sm', whIds.length === 0 ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
              {s.allWarehouses}
            </button>
            {active.map((w) => {
              const on = whIds.includes(w.warehouseId);
              return (
                <button key={w.warehouseId} type="button"
                  onClick={() => setWhIds((cur) => (on ? cur.filter((x) => x !== w.warehouseId) : [...cur, w.warehouseId]))}
                  className={cn('rounded-full border px-3 py-1 text-sm', on ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
                  {w.code}
                </button>
              );
            })}
          </div>
        </div>

        <Button className="gap-1.5 bg-green-600 hover:bg-green-700 text-white" onClick={run} disabled={busy}>
          <Calculator className="w-4 h-4" /> {busy ? s.running : s.run}
        </Button>
      </section>

      {result && <SimulationResultView result={result} />}
    </div>
  );
}

// ─── One item line ────────────────────────────────────────────────────────────
function LineRow({ line, onChange, onRemove }: { line: Line; onChange: (p: Partial<Line>) => void; onRemove?: () => void }) {
  const { m } = useT();
  const s = m.space.sim;
  const [manual, setManual] = useState(!line.productId);
  return (
    <div className="rounded-lg border border-slate-200 p-3 grid grid-cols-2 md:grid-cols-12 gap-3 items-end">
      <div className="col-span-2 md:col-span-4">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-slate-600">{manual ? s.manual : s.product}</label>
          <button type="button" className="text-xs text-green-700 hover:underline" onClick={() => { setManual(!manual); onChange({ productId: null, productLabel: '', productHasSize: false }); }}>
            {manual ? s.product : s.manual}
          </button>
        </div>
        {manual
          ? <Input placeholder={s.lineCol} value={line.productLabel} onChange={(e) => onChange({ productLabel: e.target.value })} />
          : <ProductPicker line={line} onPick={(p) => onChange({
              productId: p.id, productLabel: `${p.code} · ${p.name}`, productHasSize: p.lengthCm != null && p.widthCm != null,
              lengthCm: p.lengthCm != null ? String(p.lengthCm) : line.lengthCm, widthCm: p.widthCm != null ? String(p.widthCm) : line.widthCm, heightCm: p.heightCm != null ? String(p.heightCm) : line.heightCm,
            })} />}
        {!manual && line.productId && !line.productHasSize && <p className="mt-1 text-xs text-amber-700">{s.noProductSize}</p>}
      </div>
      <div className="col-span-2 md:col-span-4">
        <label className="text-xs font-medium text-slate-600 block mb-1">{s.boxSize}</label>
        <div className="grid grid-cols-3 gap-1.5">
          <Input type="number" min={0} step="any" aria-label={m.warehouseMaster.form.length} value={line.lengthCm} onChange={(e) => onChange({ lengthCm: e.target.value })} />
          <Input type="number" min={0} step="any" aria-label={m.warehouseMaster.form.width} value={line.widthCm} onChange={(e) => onChange({ widthCm: e.target.value })} />
          <Input type="number" min={0} step="any" aria-label={m.warehouseMaster.form.height} value={line.heightCm} onChange={(e) => onChange({ heightCm: e.target.value })} />
        </div>
      </div>
      <Field label={s.quantity} className="md:col-span-2"><Input type="number" min={0} value={line.quantity} onChange={(e) => onChange({ quantity: e.target.value })} /></Field>
      <div className="md:col-span-2 flex items-end gap-1.5">
        <Field label={s.stackLayers} className="flex-1"><Input type="number" min={1} value={line.stackLayers} onChange={(e) => onChange({ stackLayers: e.target.value })} /></Field>
        {onRemove && <Button type="button" size="sm" variant="ghost" className="h-9 text-slate-500" onClick={onRemove} aria-label={s.removeLine}><Trash2 className="w-4 h-4" /></Button>}
      </div>
    </div>
  );
}

function ProductPicker({ line, onPick }: { line: Line; onPick: (p: any) => void }) {
  const { m } = useT();
  const [q, setQ] = useState(line.productLabel);
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setQ(line.productLabel); }, [line.productLabel]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function search(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 2) { setItems([]); return; }
    timer.current = setTimeout(() => {
      productsApi.list(v.trim()).then((r) => { setItems((r ?? []).slice(0, 10)); setOpen(true); }).catch(() => setItems([]));
    }, 250);
  }

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
      <Input className="pl-8" placeholder={m.space.sim.productSearch} value={q} onChange={(e) => search(e.target.value)} onFocus={() => items.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && items.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {items.map((p) => (
            <li key={p.id}>
              <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-green-50" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(p); setOpen(false); }}>
                <span className="font-medium text-slate-800">{p.code}</span> <span className="text-slate-600">{p.name}</span>
                {p.lengthCm != null && p.widthCm != null && <span className="block text-xs text-slate-500">{p.lengthCm} × {p.widthCm} × {p.heightCm ?? '—'} cm</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Result ───────────────────────────────────────────────────────────────────
function SimulationResultView({ result }: { result: SimulationResult }) {
  const { m, t, fmt } = useT();
  const s = m.space.sim;
  const m2 = (v: number | null) => (v == null ? '—' : t(m.space.unit.m2, { value: fmt.number(v, 2) }));
  const showArea = result.mode !== 'SLOTS';
  const showSlots = result.mode !== 'AREA';

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="p-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{s.result}</h3>
          <p className="text-xs text-slate-500">{t(s.printedAt, { date: fmt.dateTime(new Date()) })}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => exportCsv(result)}><Download className="w-4 h-4" /> {s.exportCsv}</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => printResult(result)}><Printer className="w-4 h-4" /> {s.print}</Button>
        </div>
      </div>

      <div className="px-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {showArea && <Kpi label={s.requiredArea} value={m2(result.requiredAreaM2)} />}
        {showSlots && <Kpi label={s.requiredSlots} value={fmt.number(result.requiredSlots)} />}
        {result.mode === 'ITEMS' && <Kpi label={s.requiredPallets} value={fmt.number(result.pallets)} />}
      </div>

      {result.mode === 'ITEMS' && result.lines.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="text-left font-medium px-5 py-2">{s.lineCol}</th>
                <th className="text-right font-medium px-3 py-2">{s.quantity}</th>
                <th className="text-right font-medium px-3 py-2">{s.perPallet}</th>
                <th className="text-right font-medium px-3 py-2">{s.requiredPallets}</th>
                <th className="text-right font-medium px-3 py-2">{s.requiredSlots}</th>
                <th className="text-right font-medium px-5 py-2">{s.requiredArea}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.lines.map((l, i) => (
                <tr key={i}>
                  <td className="px-5 py-2">
                    <p className="font-medium text-slate-800">{l.label}</p>
                    {l.error === 'MISSING_SIZE' && <p className="text-xs text-amber-700">{s.missingSize}</p>}
                    {l.oversize && <p className="text-xs text-slate-500">{s.oversize}</p>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt.number(l.quantity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.boxesPerPallet ? fmt.number(l.boxesPerPallet) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt.number(l.pallets)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt.number(l.slots)}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{m2(l.areaM2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        {result.warehouses.length === 0 ? <p className="px-5 pb-5 text-sm text-slate-500">{s.noWarehouses}</p> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="text-left font-medium px-5 py-2">{s.whCol}</th>
                {showArea && <><th className="text-right font-medium px-3 py-2">{s.freeArea}</th><th className="text-right font-medium px-3 py-2">{s.freeAfter}</th></>}
                {showSlots && <><th className="text-right font-medium px-3 py-2">{s.emptySlots}</th><th className="text-right font-medium px-3 py-2">{s.emptyAfter}</th></>}
                <th className="text-left font-medium px-5 py-2">{m.common.fields.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.warehouses.map((w) => {
                const fits = (!showArea || w.fitsArea === true) && (!showSlots || w.fitsSlots);
                const unknown = showArea && w.fitsArea === null;
                return (
                  <tr key={w.warehouseId}>
                    <td className="px-5 py-2"><p className="font-medium text-slate-800">{w.code}</p><p className="text-xs text-slate-500">{w.name}</p></td>
                    {showArea && <>
                      <td className="px-3 py-2 text-right tabular-nums">{m2(w.freeAreaM2)}</td>
                      <td className={cn('px-3 py-2 text-right tabular-nums', (w.freeAreaAfterM2 ?? 0) < 0 && 'text-red-600')}>{m2(w.freeAreaAfterM2)}</td>
                    </>}
                    {showSlots && <>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt.number(w.emptySlots)}</td>
                      <td className={cn('px-3 py-2 text-right tabular-nums', w.emptySlotsAfter < 0 && 'text-red-600')}>{fmt.number(w.emptySlotsAfter)}</td>
                    </>}
                    <td className="px-5 py-2">{unknown ? <Pill>{s.unknownSize}</Pill> : fits ? <Pill tone="green">{s.fits}</Pill> : <Pill tone="amber">{s.doesNotFit}</Pill>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="h-3" />
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
    </div>
  );
}

// ─── Export / print ───────────────────────────────────────────────────────────
// CSV headers stay in English (export columns are never translated).
function csvCell(v: unknown) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(r: SimulationResult) {
  const rows: unknown[][] = [
    ['Mode', r.mode], ['Required area m2', r.requiredAreaM2], ['Required slots', r.requiredSlots], ['Pallets', r.pallets],
    ['Pallet L x W cm', `${r.pallet.lengthCm} x ${r.pallet.widthCm}`], [],
  ];
  if (r.lines.length) {
    rows.push(['Item', 'L cm', 'W cm', 'H cm', 'Quantity', 'Stack layers', 'Boxes per pallet', 'Pallets', 'Slots', 'Area m2', 'Note']);
    for (const l of r.lines) rows.push([l.label, l.lengthCm, l.widthCm, l.heightCm, l.quantity, l.stackLayers, l.boxesPerPallet, l.pallets, l.slots, l.areaM2, l.error ?? (l.oversize ? 'OVERSIZE' : '')]);
    rows.push([]);
  }
  rows.push(['Warehouse', 'Name', 'Free area m2', 'Free after m2', 'Fits area', 'Empty slots', 'Empty after', 'Fits slots']);
  for (const w of r.warehouses) rows.push([w.code, w.name, w.freeAreaM2, w.freeAreaAfterM2, w.fitsArea === null ? 'UNKNOWN' : w.fitsArea ? 'YES' : 'NO', w.emptySlots, w.emptySlotsAfter, w.fitsSlots ? 'YES' : 'NO']);
  const csv = '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `space-simulation-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printResult(r: SimulationResult) {
  const { m, t, fmt } = getT();
  const s = m.space.sim;
  const esc = (v: unknown) => String(v ?? '—').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const m2 = (v: number | null) => (v == null ? '—' : t(m.space.unit.m2, { value: fmt.number(v, 2) }));
  const lines = r.lines.length ? `
    <h2>${esc(s.lines)}</h2>
    <table><tr><th>${esc(s.lineCol)}</th><th>${esc(s.quantity)}</th><th>${esc(s.perPallet)}</th><th>${esc(s.requiredPallets)}</th><th>${esc(s.requiredSlots)}</th><th>${esc(s.requiredArea)}</th></tr>
    ${r.lines.map((l) => `<tr><td>${esc(l.label)}${l.error ? ` — ${esc(s.missingSize)}` : ''}</td><td>${esc(fmt.number(l.quantity))}</td><td>${esc(l.boxesPerPallet || '—')}</td><td>${esc(l.pallets)}</td><td>${esc(l.slots)}</td><td>${esc(m2(l.areaM2))}</td></tr>`).join('')}
    </table>` : '';
  const whs = r.warehouses.map((w) => {
    const fit = w.fitsArea === null && r.mode !== 'SLOTS' ? s.unknownSize : ((r.mode === 'SLOTS' || w.fitsArea) && (r.mode === 'AREA' || w.fitsSlots)) ? s.fits : s.doesNotFit;
    return `<tr><td>${esc(w.code)} · ${esc(w.name)}</td><td>${esc(m2(w.freeAreaM2))}</td><td>${esc(m2(w.freeAreaAfterM2))}</td><td>${esc(w.emptySlots)}</td><td>${esc(w.emptySlotsAfter)}</td><td>${esc(fit)}</td></tr>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.title)}</title>
    <style>body{font-family:system-ui,sans-serif;color:#0f172a;padding:24px}h1{font-size:20px;margin:0}h2{font-size:15px;margin-top:20px}
    p{color:#475569;font-size:13px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left}
    th{background:#f8fafc;color:#64748b;font-weight:600}</style></head><body>
    <h1>${esc(s.title)}</h1><p>${esc(t(s.printedAt, { date: fmt.dateTime(new Date()) }))}</p>
    <table><tr><th>${esc(s.requiredArea)}</th><th>${esc(s.requiredSlots)}</th><th>${esc(s.requiredPallets)}</th></tr>
    <tr><td>${esc(m2(r.requiredAreaM2))}</td><td>${esc(r.requiredSlots)}</td><td>${esc(r.pallets)}</td></tr></table>
    ${lines}
    <h2>${esc(s.warehouses)}</h2>
    <table><tr><th>${esc(s.whCol)}</th><th>${esc(s.freeArea)}</th><th>${esc(s.freeAfter)}</th><th>${esc(s.emptySlots)}</th><th>${esc(s.emptyAfter)}</th><th>${esc(m.common.fields.status)}</th></tr>${whs}</table>
    <script>window.onload=function(){window.print()}</script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
