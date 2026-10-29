'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { mrpApi, warehouseApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Note, Pager, Pill, SELECT, Section, TD, TH, THEAD, THEAD_ROW, fmtDate, fmtMoney, fmtQty, isForbidden, useWarehouses } from './shared';

// Planning parameters per material (versioned by effective date) and approved suppliers.

const NUM_FIELDS: Array<[string, string, string?]> = [
  ['leadTimeDays', 'Lead time (days)'], ['leadTimeVariabilityDays', 'Lead-time variability (days)', 'Shown for information; not used in the calculation'],
  ['moq', 'Minimum order qty'], ['orderMultiple', 'Order multiple'],
  ['safetyStock', 'Safety stock'], ['reorderPoint', 'Reorder point', 'Informational; the plan nets against safety stock'],
  ['minStock', 'Min stock'], ['maxStock', 'Max stock', 'Needed for Min/Max lot sizing'],
  ['targetDaysOfSupply', 'Target days of supply'],
];
const COST_FIELDS: Array<[string, string]> = [['unitCost', 'Unit cost (estimate)']];

const toForm = (p: any) => {
  const f: Record<string, any> = {
    planningEnabled: p?.planningEnabled ?? true, replenishmentMethod: p?.replenishmentMethod ?? 'PURCHASE', lotSizing: p?.lotSizing ?? 'LOT_FOR_LOT',
    criticality: p?.criticality ?? '', forecastMethod: p?.forecastMethod ?? '', currency: p?.currency ?? '', costBasis: p?.costBasis ?? '', notes: p?.notes ?? '',
    effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: p?.effectiveTo ? String(p.effectiveTo).slice(0, 10) : '',
  };
  for (const [k] of [...NUM_FIELDS, ...COST_FIELDS]) f[k] = p?.[k] ?? '';
  return f;
};

export function MrpParameters() {
  const [search, setSearch] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<any>(null);
  const [open, setOpen] = useState<any>(null); // product row being viewed

  const load = useCallback(async () => {
    try { setRes(await mrpApi.params({ search: search || undefined, missing: missingOnly || undefined, page, pageSize: 25 })); }
    catch (e: any) { toast.error(e.message); }
  }, [search, missingOnly, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div className="space-y-4">
      {res && (
        <p className="text-sm text-slate-600">{res.summary.withParameters} of {res.summary.products} materials have planning parameters · {res.summary.withIssues} need attention</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input className={`${SELECT} pl-8 w-64`} placeholder="SKU or name" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={missingOnly} onChange={(e) => { setMissingOnly(e.target.checked); setPage(1); }} /> Only missing or invalid</label>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>SKU</th><th className={TH}>Planning</th><th className={`${TH} text-right`}>Lead time</th><th className={`${TH} text-right`}>Safety</th><th className={`${TH} text-right`}>MOQ / multiple</th><th className={`${TH} text-right`}>Suppliers</th><th className={TH}>Needs attention</th><th className={TH} /></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {!res ? [...Array(5)].map((_, i) => <tr key={i}><td colSpan={8} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>)
                : res.data.length === 0 ? <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No materials</td></tr>
                : res.data.map((r: any) => (
                  <tr key={r.product.id}>
                    <td className={TD}><div className="font-mono text-slate-800">{r.product.code}</div><div className="text-xs text-slate-500 truncate max-w-[240px]">{r.product.name}</div></td>
                    <td className={TD}>{!r.current ? <Pill>Not set</Pill> : r.current.planningEnabled ? <Pill tone="green">On</Pill> : <Pill>Off</Pill>}{r.warehouseOverrides > 0 && <span className="text-xs text-slate-400 ml-1">+{r.warehouseOverrides} warehouse</span>}</td>
                    <td className={`${TD} text-right`}>{r.current?.leadTimeDays ?? '—'}</td>
                    <td className={`${TD} text-right`}>{fmtQty(r.current?.safetyStock)}</td>
                    <td className={`${TD} text-right`}>{fmtQty(r.current?.moq)} / {fmtQty(r.current?.orderMultiple)}</td>
                    <td className={`${TD} text-right`}>{r.suppliers}</td>
                    <td className={`${TD} text-xs`}>
                      {r.missing.map((m: string) => <span key={m} className="mr-1"><Pill tone="amber">{m}</Pill></span>)}
                      {r.issues.length > 0 && <div className="text-amber-700 mt-1">{r.issues.join(' · ')}</div>}
                    </td>
                    <td className={`${TD} text-right`}><Button size="sm" variant="outline" className="h-7" onClick={() => setOpen(r.product)}>Manage</Button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {res && <Pager page={res.page} pageSize={res.pageSize} total={res.total} onPage={setPage} />}
      </div>
      {open && <MaterialDialog product={open} onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}

function MaterialDialog({ product, onClose }: { product: any; onClose: () => void }) {
  const warehouses = useWarehouses();
  const [hist, setHist] = useState<any>(null);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [form, setForm] = useState<Record<string, any> | null>(null);
  const [formWarehouse, setFormWarehouse] = useState('');
  const [sup, setSup] = useState<Record<string, any> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([mrpApi.paramHistory(product.id), mrpApi.suppliers(product.id)]);
      setHist(h); setSuppliers(s);
    } catch (e: any) { toast.error(e.message); }
  }, [product.id]);
  useEffect(() => { load(); warehouseApi.vendors().then(setVendors).catch(() => setVendors([])); }, [load]);

  const current = (wh: string | null) => hist?.rows?.find((r: any) => (r.warehouseId ?? null) === wh && !r.effectiveTo) ?? hist?.rows?.find((r: any) => (r.warehouseId ?? null) === wh) ?? null;
  const whName = (id: string | null) => (id ? warehouses.find((w) => w.id === id)?.name ?? id : 'All warehouses');

  async function saveParams() {
    if (!form) return;
    const body: Record<string, any> = { productId: product.id, warehouseId: formWarehouse || null };
    for (const [k, v] of Object.entries(form)) {
      if ([...NUM_FIELDS, ...COST_FIELDS].some(([n]) => n === k)) body[k] = v === '' ? null : Number(v);
      else if (['criticality', 'forecastMethod', 'currency', 'costBasis', 'notes', 'effectiveTo'].includes(k)) body[k] = v === '' ? null : v;
      else body[k] = v;
    }
    if (!canSeeCost) { delete body.unitCost; delete body.currency; delete body.costBasis; }
    try {
      const r = await mrpApi.createParam(body);
      setErrors([]);
      toast.success(r?.warnings?.length ? `Saved with warnings: ${r.warnings.join('; ')}` : 'New parameter version saved');
      setForm(null); load();
    } catch (e: any) { setErrors(isForbidden(e) ? ['You do not have permission to change these parameters'] : e.message.split(', ')); }
  }

  async function saveSupplier() {
    if (!sup) return;
    const num = (v: any) => (v === '' || v == null ? null : Number(v));
    const body: Record<string, any> = {
      supplierPartNumber: sup.supplierPartNumber || null, isPreferred: !!sup.isPreferred, isApproved: !!sup.isApproved, isActive: sup.isActive !== false,
      leadTimeDays: num(sup.leadTimeDays), moq: num(sup.moq), orderMultiple: num(sup.orderMultiple), purchaseUom: sup.purchaseUom || null, uomConversion: num(sup.uomConversion), notes: sup.notes || null,
    };
    if (canSeeCost) Object.assign(body, { unitPrice: num(sup.unitPrice), currency: sup.currency || null, priceSource: sup.priceSource || null, priceValidFrom: sup.priceValidFrom || null, priceValidTo: sup.priceValidTo || null });
    try {
      if (sup.id) await mrpApi.updateSupplier(sup.id, body); else await mrpApi.createSupplier({ ...body, productId: product.id, vendorId: sup.vendorId });
      toast.success('Supplier saved'); setSup(null); setErrors([]); load();
    } catch (e: any) { setErrors(isForbidden(e) ? ['You do not have permission to change suppliers'] : e.message.split(', ')); }
  }

  // Cost fields are hidden for users without cost rights; the server keeps the existing cost for them.
  const canSeeCost = !!hist?.canSeeCost;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{product.code} — {product.name}</DialogTitle></DialogHeader>
        {!hist ? <Skeleton className="h-40" /> : form ? (
          <div className="space-y-4">
            <Note>Saving creates a new version from the effective date; the previous version is closed on that date and kept as history. Leave a field blank if the value is not known — do not guess.</Note>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Applies to">
                <select className={`${SELECT} w-full`} value={formWarehouse} onChange={(e) => { setFormWarehouse(e.target.value); setForm(toForm(current(e.target.value || null))); }}>
                  <option value="">All warehouses</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </Field>
              <Field label="Effective from"><input type="date" className={`${SELECT} w-full`} value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></Field>
              <Field label="Effective to (optional)"><input type="date" className={`${SELECT} w-full`} value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} /></Field>
              <Field label="Planning"><select className={`${SELECT} w-full`} value={String(form.planningEnabled)} onChange={(e) => setForm({ ...form, planningEnabled: e.target.value === 'true' })}><option value="true">On</option><option value="false">Off</option></select></Field>
              <Field label="Replenishment"><select className={`${SELECT} w-full`} value={form.replenishmentMethod} onChange={(e) => setForm({ ...form, replenishmentMethod: e.target.value })}><option value="PURCHASE">Purchase</option><option value="TRANSFER">Transfer</option><option value="NONE">None</option></select></Field>
              <Field label="Lot sizing"><select className={`${SELECT} w-full`} value={form.lotSizing} onChange={(e) => setForm({ ...form, lotSizing: e.target.value })}><option value="LOT_FOR_LOT">Lot-for-lot</option><option value="MIN_MAX">Min / Max</option></select></Field>
              <Field label="Forecast method"><select className={`${SELECT} w-full`} value={form.forecastMethod} onChange={(e) => setForm({ ...form, forecastMethod: e.target.value })}><option value="">Use default</option><option value="SMA">SMA</option><option value="FMA">FMA</option><option value="WMA">WMA</option><option value="LINEAR">Linear</option></select></Field>
              <Field label="Criticality"><select className={`${SELECT} w-full`} value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })}><option value="">—</option><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="NORMAL">Normal</option><option value="LOW">Low</option></select></Field>
              {NUM_FIELDS.map(([k, label, hint]) => (
                <Field key={k} label={label} hint={hint}><input className={`${SELECT} w-full`} inputMode="decimal" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>
              ))}
              {canSeeCost && (
                <>
                  <Field label="Unit cost (estimate)"><input className={`${SELECT} w-full`} inputMode="decimal" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} /></Field>
                  <Field label="Currency" hint="3 letters, e.g. THB"><input className={`${SELECT} w-full uppercase`} maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></Field>
                  <Field label="Cost basis"><input className={`${SELECT} w-full`} placeholder="e.g. last PO, quote" value={form.costBasis} onChange={(e) => setForm({ ...form, costBasis: e.target.value })} /></Field>
                </>
              )}
            </div>
            <Field label="Notes"><textarea className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <ErrorList errors={errors} />
            <DialogFooter>
              <Button variant="outline" onClick={() => { setForm(null); setErrors([]); }}>Back</Button>
              <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={saveParams}>Save new version</Button>
            </DialogFooter>
          </div>
        ) : sup ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Supplier" className="col-span-2">
                <select className={`${SELECT} w-full`} disabled={!!sup.id} value={sup.vendorId ?? ''} onChange={(e) => setSup({ ...sup, vendorId: e.target.value })}>
                  <option value="">Choose…</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} — ` : ''}{v.name}</option>)}
                </select>
              </Field>
              <Field label="Supplier part no."><input className={`${SELECT} w-full`} value={sup.supplierPartNumber ?? ''} onChange={(e) => setSup({ ...sup, supplierPartNumber: e.target.value })} /></Field>
              <Field label="Lead time (days)"><input className={`${SELECT} w-full`} inputMode="numeric" value={sup.leadTimeDays ?? ''} onChange={(e) => setSup({ ...sup, leadTimeDays: e.target.value })} /></Field>
              <Field label="MOQ"><input className={`${SELECT} w-full`} inputMode="decimal" value={sup.moq ?? ''} onChange={(e) => setSup({ ...sup, moq: e.target.value })} /></Field>
              <Field label="Order multiple"><input className={`${SELECT} w-full`} inputMode="decimal" value={sup.orderMultiple ?? ''} onChange={(e) => setSup({ ...sup, orderMultiple: e.target.value })} /></Field>
              <Field label="Purchase unit"><input className={`${SELECT} w-full`} value={sup.purchaseUom ?? ''} onChange={(e) => setSup({ ...sup, purchaseUom: e.target.value })} /></Field>
              <Field label="Base units per purchase unit"><input className={`${SELECT} w-full`} inputMode="decimal" value={sup.uomConversion ?? ''} onChange={(e) => setSup({ ...sup, uomConversion: e.target.value })} /></Field>
              {canSeeCost && (
                <>
                  <Field label="Unit price"><input className={`${SELECT} w-full`} inputMode="decimal" value={sup.unitPrice ?? ''} onChange={(e) => setSup({ ...sup, unitPrice: e.target.value })} /></Field>
                  <Field label="Currency"><input className={`${SELECT} w-full uppercase`} maxLength={3} value={sup.currency ?? ''} onChange={(e) => setSup({ ...sup, currency: e.target.value.toUpperCase() })} /></Field>
                  <Field label="Price source"><select className={`${SELECT} w-full`} value={sup.priceSource ?? ''} onChange={(e) => setSup({ ...sup, priceSource: e.target.value })}><option value="">—</option><option value="QUOTE">Quote</option><option value="CONTRACT">Contract</option><option value="PRICE_LIST">Price list</option></select></Field>
                  <Field label="Price valid to"><input type="date" className={`${SELECT} w-full`} value={sup.priceValidTo ? String(sup.priceValidTo).slice(0, 10) : ''} onChange={(e) => setSup({ ...sup, priceValidTo: e.target.value })} /></Field>
                </>
              )}
            </div>
            <div className="flex gap-4 text-sm text-slate-700">
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!sup.isApproved} onChange={(e) => setSup({ ...sup, isApproved: e.target.checked })} /> Approved supplier</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!sup.isPreferred} onChange={(e) => setSup({ ...sup, isPreferred: e.target.checked })} /> Preferred</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={sup.isActive !== false} onChange={(e) => setSup({ ...sup, isActive: e.target.checked })} /> Active</label>
            </div>
            <p className="text-xs text-slate-500">Only active, approved suppliers are used in planning. Prices are used only while valid and are never converted between currencies.</p>
            <ErrorList errors={errors} />
            <DialogFooter>
              <Button variant="outline" onClick={() => { setSup(null); setErrors([]); }}>Back</Button>
              <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={!sup.vendorId} onClick={saveSupplier}>Save supplier</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <Section title="Parameter versions" action={<Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-8" onClick={() => { setFormWarehouse(''); setForm(toForm(current(null))); }}>New version</Button>}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>Applies to</th><th className={TH}>Effective</th><th className={TH}>Planning</th><th className={`${TH} text-right`}>Lead time</th><th className={`${TH} text-right`}>Safety</th><th className={`${TH} text-right`}>MOQ / mult.</th><th className={`${TH} text-right`}>Min / max</th>{canSeeCost && <th className={`${TH} text-right`}>Cost</th>}</tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {hist.rows.length === 0 ? <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">No parameters yet</td></tr> : hist.rows.map((r: any) => (
                      <tr key={r.id} className={r.effectiveTo && new Date(r.effectiveTo) <= new Date() ? 'text-slate-400' : ''}>
                        <td className={TD}>{whName(r.warehouseId)}</td>
                        <td className={TD}>{fmtDate(r.effectiveFrom)} → {r.effectiveTo ? fmtDate(r.effectiveTo) : 'open'}</td>
                        <td className={TD}>{r.planningEnabled ? 'On' : 'Off'} · {r.lotSizing === 'MIN_MAX' ? 'Min/Max' : 'Lot-for-lot'}</td>
                        <td className={`${TD} text-right`}>{r.leadTimeDays ?? '—'}</td>
                        <td className={`${TD} text-right`}>{fmtQty(r.safetyStock)}</td>
                        <td className={`${TD} text-right`}>{fmtQty(r.moq)} / {fmtQty(r.orderMultiple)}</td>
                        <td className={`${TD} text-right`}>{fmtQty(r.minStock)} / {fmtQty(r.maxStock)}</td>
                        {canSeeCost && <td className={`${TD} text-right`}>{fmtMoney(r.unitCost, r.currency)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
            <Section title="Suppliers" action={<Button size="sm" variant="outline" className="h-8" onClick={() => setSup({ isApproved: false, isPreferred: false, isActive: true })}>Add supplier</Button>}>
              <table className="w-full text-sm">
                <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>Supplier</th><th className={TH}>Status</th><th className={`${TH} text-right`}>Lead time</th><th className={`${TH} text-right`}>MOQ / mult.</th>{canSeeCost && <th className={`${TH} text-right`}>Price</th>}<th className={TH} /></tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {suppliers.length === 0 ? <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No suppliers recorded for this material</td></tr> : suppliers.map((s) => (
                    <tr key={s.id}>
                      <td className={TD}>{s.vendor?.name ?? s.vendorId}{s.supplierPartNumber && <div className="text-xs text-slate-400">{s.supplierPartNumber}</div>}</td>
                      <td className={TD}><div className="flex gap-1">{s.isPreferred && <Pill tone="green">Preferred</Pill>}{s.isApproved ? <Pill>Approved</Pill> : <Pill tone="amber">Not approved</Pill>}{!s.isActive && <Pill>Inactive</Pill>}</div></td>
                      <td className={`${TD} text-right`}>{s.leadTimeDays ?? '—'}</td>
                      <td className={`${TD} text-right`}>{fmtQty(s.moq)} / {fmtQty(s.orderMultiple)}</td>
                      {canSeeCost && <td className={`${TD} text-right`}>{fmtMoney(s.unitPrice, s.currency)}{s.priceValidTo && <div className="text-xs text-slate-400">to {fmtDate(s.priceValidTo)}</div>}</td>}
                      <td className={`${TD} text-right`}><Button size="sm" variant="outline" className="h-7" onClick={() => setSup({ ...s })}>Edit</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ErrorList({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return <ul className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 list-disc list-inside space-y-0.5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>;
}
