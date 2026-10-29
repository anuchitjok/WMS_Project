'use client';

import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { warehouseApi, warrantyApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Note, Pill, ProductPicker, SELECT, Section, TD, TH, THEAD, THEAD_ROW, fmtDate, isForbidden } from '@/components/mrp/shared';

// Warranty is informational: it explains coverage and never blocks a transaction.

export const WARRANTY_STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'slate' | 'blue'; hint: string }> = {
  ACTIVE: { label: 'In warranty', tone: 'green', hint: 'Start date has passed and the expiry date has not' },
  NOT_STARTED: { label: 'Not started', tone: 'blue', hint: 'The warranty start date is after the check date' },
  EXPIRED: { label: 'Expired', tone: 'red', hint: 'The check date is after the expiry date' },
  NO_RULE: { label: 'No rule', tone: 'slate', hint: 'No active rule covers this unit' },
  START_DATE_UNKNOWN: { label: 'Start date unknown', tone: 'amber', hint: 'The rule starts from a date that is not recorded for this unit' },
  CONFLICT: { label: 'Rule conflict', tone: 'amber', hint: 'Two equally specific rules with the same priority apply' },
  NOT_FOUND: { label: 'Not found', tone: 'slate', hint: 'No unit with this serial in your warehouses' },
};

export function WarrantyPill({ status }: { status: string }) {
  const s = WARRANTY_STATUS[status] ?? { label: status, tone: 'slate' as const, hint: '' };
  return <Pill tone={s.tone} title={s.hint}>{s.label}</Pill>;
}

const SCOPE_LABEL: Record<string, string> = {
  SERIAL: 'Serial number', PRODUCT: 'Product (SKU)', PRODUCT_MODEL: 'Product model', CATEGORY: 'Category', BRAND: 'Brand', VENDOR: 'Vendor', PRODUCT_TYPE: 'Product type',
};
const BASIS_LABEL: Record<string, string> = {
  RECEIPT_DATE: 'Receipt date (WMS)', GOODS_ISSUE_DATE: 'Goods issue date (WMS)', INVOICE_DATE: 'Invoice date (recorded)', INSTALLATION_DATE: 'Installation date (recorded)', ACTIVATION_DATE: 'Activation date (recorded)',
};
const RULE_TONE: Record<string, 'green' | 'amber' | 'slate'> = { ACTIVE: 'green', DRAFT: 'amber', INACTIVE: 'slate', SUPERSEDED: 'slate' };

// ── Lookup ────────────────────────────────────────────────────────────────
export function WarrantyLookup() {
  const [serial, setSerial] = useState('');
  const [asOf, setAsOf] = useState('');
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!serial.trim()) return;
    setBusy(true);
    try { setRes(await warrantyApi.lookup({ serial: serial.trim(), asOf: asOf || undefined })); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Serial number" className="w-full sm:w-80">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input className={`${SELECT} w-full pl-8`} value={serial} onChange={(e) => setSerial(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} placeholder="Scan or type a serial" />
          </div>
        </Field>
        <Field label="Check as of" hint="Blank = today"><input type="date" className={SELECT} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={busy || !serial.trim()} onClick={go}>{busy ? 'Checking…' : 'Check warranty'}</Button>
      </div>
      {res && res.results.length === 0 && <Note>No unit with this serial number in the warehouses you can see. The check was logged as “not found”.</Note>}
      {res?.results.map((r: any) => <LookupResult key={r.checkId} r={r} />)}
    </div>
  );
}

/** "PRODUCT=<id>" → "Product (SKU) SMP-1"; id-based scopes show the unit's own value instead of the id. */
function scopeOf(scope: string, r: any) {
  const [type, ...rest] = String(scope).split('=');
  const value = type === 'PRODUCT' ? r.product.code : ['BRAND', 'VENDOR'].includes(type) ? '' : rest.join('=');
  return `${SCOPE_LABEL[type] ?? type}${value ? ` ${value}` : ''}`;
}

function LookupResult({ r }: { r: any }) {
  const ex = r.explanation;
  return (
    <Section title={`${r.stockItem.serialNumber} · ${r.product.code} — ${r.product.name}`} subtitle={`Unit status ${String(r.stockItem.status).toLowerCase()} · received ${fmtDate(r.stockItem.receivedDate)}`} action={<WarrantyPill status={r.status} />}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 py-3">
        <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
          <dt className="text-slate-500">Rule applied</dt><dd>{r.rule ? <><span className="font-mono">{r.rule.ruleCode}</span> v{r.rule.version}</> : '—'}</dd>
          <dt className="text-slate-500">Warranty type</dt><dd>{r.rule?.warrantyType ?? '—'}</dd>
          <dt className="text-slate-500">Coverage</dt><dd>{r.rule ? `${r.rule.durationValue} ${String(r.rule.durationUnit).toLowerCase()}` : '—'}</dd>
          <dt className="text-slate-500">Starts from</dt><dd>{r.startBasis ? BASIS_LABEL[r.startBasis] ?? r.startBasis : '—'}</dd>
          <dt className="text-slate-500">Start date</dt><dd>{fmtDate(r.startDate)}</dd>
          <dt className="text-slate-500">Expiry date</dt><dd>{fmtDate(r.expiryDate)} <span className="text-xs text-slate-400">(last covered day)</span></dd>
          <dt className="text-slate-500">Days remaining</dt><dd>{r.daysRemaining ?? '—'}</dd>
        </dl>
        <div className="text-sm space-y-2">
          <p className="text-slate-700">{ex.reason}</p>
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">Dates known for this unit</p>
            <ul className="text-xs text-slate-600 space-y-0.5">
              {Object.entries(ex.datesKnown).map(([k, v]: [string, any]) => <li key={k}>{BASIS_LABEL[k] ?? k}: {v ?? <span className="text-slate-400">not recorded</span>}</li>)}
            </ul>
          </div>
          {ex.candidates?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">Rules considered (most specific first: {ex.precedence.map((p: string) => SCOPE_LABEL[p] ?? p).join(' › ')})</p>
              <ul className="text-xs text-slate-600 space-y-0.5">
                {ex.candidates.map((c: any, i: number) => <li key={i}><span className="font-mono">{c.ruleCode}</span> v{c.version} · {scopeOf(c.scope, r)} · priority {c.priority}{c.note ? <span className="text-slate-400"> — {c.note}</span> : ''}</li>)}
              </ul>
            </div>
          )}
          {ex.conflictingRules?.length > 0 && <p className="text-xs text-amber-700">Conflicting rules: {ex.conflictingRules.map((c: any) => `${c.ruleCode} v${c.version}`).join(', ')} — change a priority to resolve.</p>}
        </div>
      </div>
    </Section>
  );
}

// ── Rules ─────────────────────────────────────────────────────────────────
const EMPTY_RULE = { ruleCode: '', name: '', warrantyType: '', scopeType: 'PRODUCT', scopeValue: '', startBasis: 'RECEIPT_DATE', durationValue: '', durationUnit: 'MONTHS', terms: '', priority: '0', effectiveFrom: '', effectiveTo: '', changeNote: '' };

export function WarrantyRules() {
  const user = useAuthStore((s) => s.user);
  const [rules, setRules] = useState<any[] | null>(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<any>(null);
  const [scopeProduct, setScopeProduct] = useState<any>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [versions, setVersions] = useState<any[] | null>(null);
  const [brands, setBrands] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);

  const load = useCallback(() => {
    warrantyApi.rules({ status: status || undefined, search: search || undefined }).then(setRules).catch((e) => toast.error(e.message));
  }, [status, search]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    warehouseApi.brands().then(setBrands).catch(() => setBrands([]));
    warehouseApi.vendors().then(setVendors).catch(() => setVendors([]));
  }, []);

  const scopeText = (r: any) => r.scopeLabel ?? r.scopeValue;

  function edit(r?: any) {
    setErrors([]);
    setScopeProduct(r?.scopeType === 'PRODUCT' ? { id: r.scopeValue, code: String(r.scopeLabel ?? r.scopeValue).split(' — ')[0], name: String(r.scopeLabel ?? '').split(' — ')[1] ?? '' } : null);
    setDraft(r ? { ...EMPTY_RULE, ...r, durationValue: String(r.durationValue), priority: String(r.priority), terms: r.terms ?? '', effectiveFrom: fmtDate(r.effectiveFrom), effectiveTo: r.effectiveTo ? fmtDate(r.effectiveTo) : '', changeNote: r.changeNote ?? '' } : { ...EMPTY_RULE });
  }

  async function save() {
    const body: any = {
      name: draft.name, warrantyType: draft.warrantyType, scopeType: draft.scopeType, scopeValue: draft.scopeType === 'PRODUCT' ? scopeProduct?.id ?? '' : draft.scopeValue,
      startBasis: draft.startBasis, durationValue: Number(draft.durationValue), durationUnit: draft.durationUnit, terms: draft.terms || undefined,
      priority: Number(draft.priority || 0), effectiveFrom: draft.effectiveFrom, effectiveTo: draft.effectiveTo || null, changeNote: draft.changeNote || undefined,
    };
    try {
      if (draft.id) await warrantyApi.update(draft.id, body);
      else await warrantyApi.create({ ...body, ruleCode: draft.ruleCode.trim().toUpperCase() });
      toast.success('Draft saved — another manager must activate it');
      setDraft(null); load();
    } catch (e: any) { setErrors(isForbidden(e) ? ['You do not have permission to manage warranty rules'] : e.message.split(', ')); }
  }

  async function act(fn: () => Promise<any>, ok: string) {
    try { await fn(); toast.success(ok); load(); if (versions) setVersions(null); }
    catch (e: any) { toast.error(isForbidden(e) ? 'Not allowed — a rule must be activated by someone other than its author, with warranty manage rights' : e.message); }
  }

  return (
    <div className="space-y-4">
      <Note>
        No warranty policy is preset. Each rule must come from an agreed policy or contract. Rules are created as drafts and must be activated by a different manager.
        When several rules match a unit, the most specific scope wins (serial › product › model › category › brand › vendor › product type), then the higher priority.
      </Note>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input className={`${SELECT} pl-8 w-56`} placeholder="Code or name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className={SELECT} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="DRAFT">Draft</option><option value="INACTIVE">Inactive</option><option value="SUPERSEDED">Superseded</option>
        </select>
        <Button className="ml-auto bg-green-600 hover:bg-green-700 text-white" onClick={() => edit()}>New rule</Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>Rule</th><th className={TH}>Scope</th><th className={TH}>Coverage</th><th className={TH}>Starts from</th><th className={TH}>Effective</th><th className={`${TH} text-right`}>Priority</th><th className={TH}>Status</th><th className={TH} /></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {!rules ? [...Array(3)].map((_, i) => <tr key={i}><td colSpan={8} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>)
                : rules.length === 0 ? <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No warranty rules yet</td></tr>
                : rules.map((r) => (
                  <tr key={r.id}>
                    <td className={TD}><span className="font-mono">{r.ruleCode}</span> <span className="text-xs text-slate-400">v{r.version}</span><div className="text-xs text-slate-500">{r.name} · {r.warrantyType}</div></td>
                    <td className={TD}>{SCOPE_LABEL[r.scopeType]}<div className="text-xs text-slate-500 font-mono truncate max-w-[180px]">{scopeText(r)}</div></td>
                    <td className={TD}>{r.durationValue} {String(r.durationUnit).toLowerCase()}</td>
                    <td className={`${TD} text-xs`}>{BASIS_LABEL[r.startBasis]}</td>
                    <td className={`${TD} text-xs`}>{fmtDate(r.effectiveFrom)} → {r.effectiveTo ? fmtDate(r.effectiveTo) : 'open'}</td>
                    <td className={`${TD} text-right`}>{r.priority}</td>
                    <td className={TD}><Pill tone={RULE_TONE[r.status] ?? 'slate'}>{String(r.status).toLowerCase()}</Pill></td>
                    <td className={`${TD} text-right whitespace-nowrap`}>
                      {r.status === 'DRAFT' && <Button size="sm" variant="outline" className="h-7 mr-1" onClick={() => edit(r)}>Edit</Button>}
                      {r.status === 'DRAFT' && r.createdById !== user?.id && <Button size="sm" variant="outline" className="h-7 mr-1" onClick={() => act(() => warrantyApi.activate(r.id), 'Rule activated')}>Activate</Button>}
                      {r.status === 'ACTIVE' && <Button size="sm" variant="outline" className="h-7 mr-1" onClick={() => act(() => warrantyApi.newVersion(r.id), 'Draft of the next version created')}>New version</Button>}
                      {r.status === 'ACTIVE' && <Button size="sm" variant="outline" className="h-7 mr-1" onClick={() => act(() => warrantyApi.deactivate(r.id), 'Rule deactivated')}>Deactivate</Button>}
                      <Button size="sm" variant="outline" className="h-7" onClick={() => warrantyApi.versions(r.ruleCode).then(setVersions).catch((e) => toast.error(e.message))}>History</Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{draft?.id ? `Edit draft ${draft.ruleCode} v${draft.version}` : 'New warranty rule'}</DialogTitle></DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Rule code"><input className={`${SELECT} w-full uppercase`} disabled={!!draft.id} value={draft.ruleCode} onChange={(e) => setDraft({ ...draft, ruleCode: e.target.value })} placeholder="e.g. MFR-STD" /></Field>
                <Field label="Name" className="sm:col-span-2"><input className={`${SELECT} w-full`} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
                <Field label="Warranty type" hint="As named in the policy, e.g. Manufacturer"><input className={`${SELECT} w-full`} value={draft.warrantyType} onChange={(e) => setDraft({ ...draft, warrantyType: e.target.value })} /></Field>
                <Field label="Applies to">
                  <select className={`${SELECT} w-full`} value={draft.scopeType} onChange={(e) => setDraft({ ...draft, scopeType: e.target.value, scopeValue: '' })}>
                    {Object.entries(SCOPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Value">
                  {draft.scopeType === 'PRODUCT' ? <ProductPicker value={scopeProduct} onChange={setScopeProduct} />
                    : draft.scopeType === 'BRAND' ? <select className={`${SELECT} w-full`} value={draft.scopeValue} onChange={(e) => setDraft({ ...draft, scopeValue: e.target.value })}><option value="">Choose…</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                    : draft.scopeType === 'VENDOR' ? <select className={`${SELECT} w-full`} value={draft.scopeValue} onChange={(e) => setDraft({ ...draft, scopeValue: e.target.value })}><option value="">Choose…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
                    : draft.scopeType === 'PRODUCT_TYPE' ? <select className={`${SELECT} w-full`} value={draft.scopeValue} onChange={(e) => setDraft({ ...draft, scopeValue: e.target.value })}><option value="">Choose…</option><option value="FINISHED_GOODS">Finished goods</option><option value="SPARE_PART">Spare part</option></select>
                    : <input className={`${SELECT} w-full`} value={draft.scopeValue} onChange={(e) => setDraft({ ...draft, scopeValue: e.target.value })} />}
                </Field>
                <Field label="Starts from"><select className={`${SELECT} w-full`} value={draft.startBasis} onChange={(e) => setDraft({ ...draft, startBasis: e.target.value })}>{Object.entries(BASIS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Duration"><input className={`${SELECT} w-full`} inputMode="numeric" value={draft.durationValue} onChange={(e) => setDraft({ ...draft, durationValue: e.target.value })} /></Field>
                <Field label="Unit"><select className={`${SELECT} w-full`} value={draft.durationUnit} onChange={(e) => setDraft({ ...draft, durationUnit: e.target.value })}><option value="DAYS">Days</option><option value="MONTHS">Months</option><option value="YEARS">Years</option></select></Field>
                <Field label="Priority" hint="Higher wins between equally specific rules"><input className={`${SELECT} w-full`} inputMode="numeric" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} /></Field>
                <Field label="Effective from"><input type="date" className={`${SELECT} w-full`} value={draft.effectiveFrom} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} /></Field>
                <Field label="Effective to (optional)"><input type="date" className={`${SELECT} w-full`} value={draft.effectiveTo} onChange={(e) => setDraft({ ...draft, effectiveTo: e.target.value })} /></Field>
              </div>
              <Field label="Terms and conditions"><textarea className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" rows={3} value={draft.terms} onChange={(e) => setDraft({ ...draft, terms: e.target.value })} /></Field>
              <Field label="Change note"><input className={`${SELECT} w-full`} value={draft.changeNote} onChange={(e) => setDraft({ ...draft, changeNote: e.target.value })} /></Field>
              <p className="text-xs text-slate-500">A rule applies to a unit only if its effective dates cover the unit’s warranty start date. Expiry is the last covered day (start + duration − 1 day).</p>
              {errors.length > 0 && <ul className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 list-disc list-inside">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={save}>Save draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!versions} onOpenChange={(o) => { if (!o) setVersions(null); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader><DialogTitle>Version history — {versions?.[0]?.ruleCode}</DialogTitle></DialogHeader>
          <table className="w-full text-sm">
            <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>Version</th><th className={TH}>Coverage</th><th className={TH}>Effective</th><th className={TH}>Status</th><th className={TH}>Activated</th><th className={TH}>Note</th></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {versions?.map((v) => (
                <tr key={v.id}><td className={TD}>v{v.version}</td><td className={TD}>{v.durationValue} {String(v.durationUnit).toLowerCase()}</td><td className={`${TD} text-xs`}>{fmtDate(v.effectiveFrom)} → {v.effectiveTo ? fmtDate(v.effectiveTo) : 'open'}</td><td className={TD}><Pill tone={RULE_TONE[v.status] ?? 'slate'}>{String(v.status).toLowerCase()}</Pill></td><td className={`${TD} text-xs`}>{v.activatedAt ? new Date(v.activatedAt).toLocaleString() : '—'}</td><td className={`${TD} text-xs`}>{v.changeNote ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── History and recorded dates ───────────────────────────────────────────
export function WarrantyHistory() {
  const [serial, setSerial] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [dates, setDates] = useState<any[]>([]);
  const [rec, setRec] = useState<any>(null);

  const load = useCallback(async () => {
    const s = serial.trim();
    if (!s) return;
    try {
      const [h, d] = await Promise.all([warrantyApi.history({ serial: s }), warrantyApi.dates(s)]);
      setRows(h); setDates(d);
    } catch (e: any) { toast.error(e.message); }
  }, [serial]);

  async function saveDate() {
    try {
      await warrantyApi.recordDate({ serialNumber: serial.trim(), dateType: rec.dateType, date: rec.date, reference: rec.reference || undefined, source: rec.source || undefined, notes: rec.notes || undefined });
      toast.success('Date recorded'); setRec(null); load();
    } catch (e: any) { toast.error(isForbidden(e) ? 'You do not have permission to record warranty dates' : e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Serial number" className="w-full sm:w-80"><input className={`${SELECT} w-full`} value={serial} onChange={(e) => setSerial(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} /></Field>
        <Button variant="outline" disabled={!serial.trim()} onClick={load}>Show</Button>
      </div>
      {rows && (
        <>
          <Section title="Recorded dates" subtitle="Invoice, installation and activation dates are not captured by the WMS; record them here when a rule starts from them"
            action={<Button size="sm" variant="outline" className="h-8" onClick={() => setRec({ dateType: 'INSTALLATION_DATE', date: '', reference: '', source: '', notes: '' })}>Record date</Button>}>
            <table className="w-full text-sm">
              <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>Type</th><th className={TH}>Date</th><th className={TH}>Reference</th><th className={TH}>Source</th><th className={TH}>Updated</th></tr></thead>
              <tbody className="divide-y divide-slate-50">
                {dates.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">None recorded</td></tr> : dates.map((d) => (
                  <tr key={d.id}><td className={TD}>{BASIS_LABEL[d.dateType] ?? d.dateType}</td><td className={TD}>{fmtDate(d.date)}</td><td className={TD}>{d.reference ?? '—'}</td><td className={TD}>{d.source ?? '—'}</td><td className={`${TD} text-xs`}>{new Date(d.updatedAt).toLocaleString()}</td></tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title="Warranty checks" subtitle="Every lookup is logged with the rule version used, so past answers can be explained later">
            <table className="w-full text-sm">
              <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>Checked</th><th className={TH}>As of</th><th className={TH}>Result</th><th className={TH}>Rule</th><th className={TH}>Start → expiry</th><th className={TH}>Context</th><th className={TH}>By</th></tr></thead>
              <tbody className="divide-y divide-slate-50">
                {rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No checks for this serial</td></tr> : rows.map((h) => (
                  <tr key={h.id}>
                    <td className={`${TD} text-xs`}>{new Date(h.createdAt).toLocaleString()}</td>
                    <td className={TD}>{fmtDate(h.asOf)}</td>
                    <td className={TD}><WarrantyPill status={h.status} /></td>
                    <td className={TD}>{h.ruleCode ? <><span className="font-mono">{h.ruleCode}</span> v{h.ruleVersion}</> : '—'}</td>
                    <td className={`${TD} text-xs`}>{fmtDate(h.startDate)} → {fmtDate(h.expiryDate)}</td>
                    <td className={`${TD} text-xs`}>{h.context}{h.contextRef ? ` · ${h.contextRef}` : ''}</td>
                    <td className={`${TD} text-xs`}>{h.checkedBy ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </>
      )}

      <Dialog open={!!rec} onOpenChange={(o) => { if (!o) setRec(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Record a warranty date for {serial.trim()}</DialogTitle></DialogHeader>
          {rec && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date type"><select className={`${SELECT} w-full`} value={rec.dateType} onChange={(e) => setRec({ ...rec, dateType: e.target.value })}><option value="INVOICE_DATE">Invoice date</option><option value="INSTALLATION_DATE">Installation date</option><option value="ACTIVATION_DATE">Activation date</option></select></Field>
              <Field label="Date"><input type="date" className={`${SELECT} w-full`} value={rec.date} onChange={(e) => setRec({ ...rec, date: e.target.value })} /></Field>
              <Field label="Reference" hint="e.g. invoice or job number"><input className={`${SELECT} w-full`} value={rec.reference} onChange={(e) => setRec({ ...rec, reference: e.target.value })} /></Field>
              <Field label="Source"><input className={`${SELECT} w-full`} value={rec.source} onChange={(e) => setRec({ ...rec, source: e.target.value })} /></Field>
              <Field label="Notes" className="col-span-2"><input className={`${SELECT} w-full`} value={rec.notes} onChange={(e) => setRec({ ...rec, notes: e.target.value })} /></Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRec(null)}>Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={!rec?.date} onClick={saveDate}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
