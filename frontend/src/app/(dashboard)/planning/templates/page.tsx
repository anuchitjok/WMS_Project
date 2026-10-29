'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookCheck, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { planningApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, PROJECT_TYPES, Pill, SelectInput, TextInput, fmt } from '@/components/planning/shared';

const STATUS: Record<string, [string, string]> = {
  DRAFT: ['Draft — not confirmed', 'bg-slate-50 text-slate-600 border-slate-200'],
  CONFIRMED: ['Confirmed', 'bg-green-50 text-green-700 border-green-200'],
  RETIRED: ['Retired', 'bg-slate-50 text-slate-400 border-slate-200'],
};
const StatusPill = ({ s }: { s: string }) => <Pill className={STATUS[s]?.[1]}>{STATUS[s]?.[0] ?? s}</Pill>;
const day = (d?: string | null) => (d ? d.slice(0, 10) : '—');
const WEEKDAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Company templates: the standard times a company has confirmed for jobs it
 * sells often. Saved from a calculated project scenario, confirmed by a second
 * person, then offered when a new project is created. Never holds costs.
 */
export default function CompanyTemplatesPage() {
  const [data, setData] = useState<{ rows: any[]; userId: string; canManage: boolean; canApprove: boolean } | null>(null);
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await planningApi.companyTemplates(status || undefined)); } catch (e: any) { toast.error(e.message); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5">
      <Link href="/planning" className="inline-flex items-center gap-1 text-sm text-green-700 hover:underline"><ArrowLeft className="h-4 w-4" />Project Planning</Link>
      <PageHeader
        title="Company templates"
        subtitle="Confirmed standard times for jobs sold often. A new project started from one only needs quantity, dates, people and costs."
        icon={BookCheck}
      />

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 space-y-1">
        <p><b>How a template is made:</b> calculate a project scenario with real standard values → <i>Save as template</i> on the project page → a second person with approval rights checks the numbers and confirms them, stating where they come from.</p>
        <p>Templates hold stage times, workstations, yields, calendar, labour factors, packaging and per-unit materials. They never hold costs, labour rates, prices, headcount or holidays. Nothing here is pre-filled by the system.</p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <SelectInput aria-label="Template status" className="w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Drafts and confirmed</option>
          <option value="CONFIRMED">Confirmed only</option>
          <option value="DRAFT">Drafts awaiting confirmation</option>
          <option value="RETIRED">Retired</option>
        </SelectInput>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        {!data ? <div className="p-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          : !data.rows.length ? (
            <p className="p-8 text-center text-sm text-slate-500">No templates{status ? ' with this status' : ' yet'}. Open a calculated project and choose <b>Save as template</b>.</p>
          ) : (
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-4 py-2.5 font-medium">Template</th><th className="px-4 py-2.5 font-medium">Type</th><th className="px-4 py-2.5 font-medium">Stages</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 font-medium">Confirmed</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(t.id)}>
                    <td className="px-4 py-3"><p className="font-medium text-slate-900">{t.name}</p><p className="text-xs text-slate-500 font-mono">{t.code}</p></td>
                    <td className="px-4 py-3 text-slate-600">{PROJECT_TYPES[t.projectType] ?? t.projectType}</td>
                    <td className="px-4 py-3 text-slate-600"><span className="line-clamp-1">{t.stageNames.join(' → ')}</span></td>
                    <td className="px-4 py-3"><StatusPill s={t.status} /></td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{t.confirmedAt ? `${day(t.confirmedAt)} · ${t.confirmedBy ?? '—'}` : `Saved by ${t.createdBy ?? '—'}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {openId && data && <TemplateDialog id={openId} perms={data} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function TemplateDialog({ id, perms, onClose, onChanged }: { id: string; perms: { userId: string; canManage: boolean; canApprove: boolean }; onClose: () => void; onChanged: () => void }) {
  const [t, setT] = useState<any>(null);
  const [basis, setBasis] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { planningApi.companyTemplate(id).then((x) => { setT(x); setBasis(x.basis ?? ''); }).catch((e) => toast.error(e.message)); }, [id]);

  async function act(fn: () => Promise<any>, msg: string, close = false) {
    setBusy(true);
    try { const r = await fn(); toast.success(msg); onChanged(); if (close) onClose(); else setT(r); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  const own = t?.createdById === perms.userId;
  const c = t?.content;
  const product = (pid: string) => t?.products.find((x: any) => x.id === pid);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        {!t ? <Skeleton className="h-64" /> : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">{t.name} <StatusPill s={t.status} /></DialogTitle>
              <DialogDescription>
                <span className="font-mono">{t.code}</span> · {PROJECT_TYPES[t.projectType] ?? t.projectType} · saved by {t.createdBy ?? '—'} on {day(t.createdAt)}
                {t.confirmedAt && <> · confirmed by {t.confirmedBy ?? '—'} on {day(t.confirmedAt)}</>}
                {t.retiredAt && <> · retired {day(t.retiredAt)}</>}
              </DialogDescription>
            </DialogHeader>

            {t.description && <p className="text-sm text-slate-700">{t.description}</p>}
            <p className="text-sm"><span className="text-slate-500">Basis of the values: </span>{t.basis ?? <span className="text-amber-700">not stated yet</span>}</p>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr><th className="px-3 py-2 font-medium">Stage</th><th className="px-3 py-2 font-medium text-right">Standard</th><th className="px-3 py-2 font-medium text-right">Stations × people</th><th className="px-3 py-2 font-medium text-right">Yield / rework / buffer</th><th className="px-3 py-2 font-medium text-right">Setup</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {c.stages.map((s: any) => (
                    <tr key={s.key}>
                      <td className="px-3 py-2"><p className="text-slate-900">{s.name}{s.isQualityGate && <span className="ml-1.5 text-[11px] text-green-700">quality check</span>}</p><p className="text-[11px] text-slate-500">{s.completionCriteria}</p></td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{s.timeBasis === 'UNITS_PER_PERSON_SHIFT' ? `${fmt(s.unitsPerPersonShift)} units / person-shift` : `${fmt(s.stdMinutesPerUnit)} min / unit`}</td>
                      <td className="px-3 py-2 text-right">{s.workstations ?? '—'} × {s.operatorsPerStation ?? 1}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{s.yieldPct ?? 100}% / {s.reworkPct ?? 0}% / {s.bufferPct ?? 0}%</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{s.setupMinutes ? `${s.setupMinutes} min × ${s.changeovers ?? 0}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid sm:grid-cols-3 gap-3 text-xs">
              <Info title="Calendar" rows={[
                ['Working days', (c.calendar.workingDays ?? []).map((d: number) => WEEKDAY[d]).join(', ') || '—'],
                ['Shifts / day', c.calendar.shiftsPerDay ?? '—'],
                ['Hours / shift', c.calendar.hoursPerShift ?? '—'],
                ['Break / shift', c.calendar.breakMinutesPerShift != null ? `${c.calendar.breakMinutesPerShift} min` : '—'],
              ]} />
              <Info title="Labour factors" rows={[
                ['Absence', c.labor.absencePct != null ? `${c.labor.absencePct}%` : '—'],
                ['Utilisation', c.labor.utilizationPct != null ? `${c.labor.utilizationPct}%` : '—'],
                ['Transfer batch', c.transferBatchSize ?? 'whole quantity'],
              ]} />
              <Info title="Packaging" rows={[
                ['Units / carton', c.space.unitsPerCarton ?? '—'],
                ['Cartons / pallet', c.space.cartonsPerPallet ?? '—'],
                ['Pallet', c.space.palletLengthM ? `${c.space.palletLengthM} × ${c.space.palletWidthM} m` : '—'],
              ]} />
            </div>

            {!!c.materials.length && (
              <div className="text-xs">
                <p className="font-medium text-slate-700 mb-1">Materials per unit</p>
                <ul className="space-y-0.5 text-slate-600">
                  {c.materials.map((m: any, i: number) => {
                    const pr = m.productId ? product(m.productId) : null;
                    return <li key={i}>{pr ? `${pr.code} ${pr.name}` : m.productId ? m.productId : `${m.itemName} (free text — sales simulations only)`}: {m.qtyPerUnit} {m.unit ?? ''} per unit at {m.stageKey}{m.scrapPct ? `, scrap ${m.scrapPct}%` : ''}{m.leadTimeDays != null ? `, lead time ${m.leadTimeDays} days` : ''}</li>;
                  })}
                </ul>
              </div>
            )}

            {t.status === 'DRAFT' && perms.canApprove && (
              own ? (
                <p className="text-xs rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">You saved this template, so someone else with approval rights must confirm it.</p>
              ) : (
                <div className="rounded-lg border border-green-200 bg-green-50/50 p-3 space-y-2">
                  <p className="text-sm font-medium text-slate-900">Confirm these numbers as the company standard</p>
                  <Field label="Basis of the values" hint="Required — e.g. time study, completed project, supplier agreement">
                    <TextInput value={basis} maxLength={1000} onChange={(e) => setBasis(e.target.value)} />
                  </Field>
                  <Field label="Note (optional)"><TextInput value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
                </div>
              )
            )}

            <DialogFooter className="gap-2">
              {t.status === 'DRAFT' && perms.canManage && (own || perms.canApprove) && (
                <Button variant="outline" disabled={busy} onClick={() => act(() => planningApi.deleteTemplate(t.id), 'Draft deleted', true)}>Delete draft</Button>
              )}
              {t.status === 'CONFIRMED' && perms.canApprove && (
                <Button variant="outline" disabled={busy} onClick={() => act(() => planningApi.retireTemplate(t.id, { version: t.version }), 'Template retired')}>Retire</Button>
              )}
              {t.status === 'DRAFT' && perms.canApprove && !own && (
                <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={busy || !basis.trim()}
                  onClick={() => act(() => planningApi.confirmTemplate(t.id, { basis: basis.trim(), note: note.trim() || undefined, version: t.version }), 'Template confirmed')}>
                  <ShieldCheck className="h-4 w-4 mr-1" />Confirm template
                </Button>
              )}
              <Button variant="outline" onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Info({ title, rows }: { title: string; rows: [string, React.ReactNode][] }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="font-medium text-slate-700 mb-1">{title}</p>
      <dl className="space-y-0.5">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-slate-500">{k}</dt><dd className="text-slate-800 text-right">{v}</dd></div>)}</dl>
    </div>
  );
}
