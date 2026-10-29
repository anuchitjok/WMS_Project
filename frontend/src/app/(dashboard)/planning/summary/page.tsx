'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CheckCircle2, ImageOff, Printer, ShieldCheck } from 'lucide-react';
import { companyApi, planningApi } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { PROJECT_TYPES, fmt } from '@/components/planning/shared';

const DAY = 86_400_000;
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
const longDate = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const money = (n: number, cur: string) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
/** Makes a value safe inside a CSS string (used for the printed page footer). */
const cssText = (s: string) => s.replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ');

/**
 * Customer proposal — what the project is, what the customer receives, when it
 * is delivered and what it costs. The API builds it from a whitelist, so no
 * cost, rate, margin, stock or warehouse figure can appear here. The provider
 * identity comes only from Company Profile; nothing is filled in when it is empty.
 * "Save as PDF" uses the browser's print dialog, so preview and PDF are the same page.
 */
function Summary() {
  const q = useSearchParams();
  const id = q.get('id') ?? '';
  const runId = q.get('run') ?? '';
  const [s, setS] = useState<any>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showTeam, setShowTeam] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const [showPrice, setShowPrice] = useState(true);

  useEffect(() => {
    if (!id || !runId) { setError('No calculation selected.'); return; }
    planningApi.customerSummary(id, runId).then(setS).catch((e) => setError(e.message));
  }, [id, runId]);

  useEffect(() => {
    if (!s?.company?.hasLogo) { setLogo(null); return; }
    // A missing logo never blocks the document; it just prints without one.
    companyApi.logo().then((r) => setLogo(r.dataUrl)).catch(() => setLogo(null));
  }, [s?.company?.hasLogo]);

  if (error) return (
    <div className="p-6 space-y-3">
      <p className="text-sm text-red-700">{error}</p>
      <Link href={id ? `/planning/project?id=${id}` : '/planning'} className="text-sm text-green-700 hover:underline">Back to the project</Link>
    </div>
  );
  if (!s) return <div className="p-6"><Skeleton className="h-[600px] max-w-[210mm] mx-auto" /></div>;

  const start = toTime(s.plannedStart);
  const end = Math.max(toTime(s.estimatedFinish), toTime(s.targetEnd), ...s.stages.map((x: any) => toTime(x.finishDate)));
  const span = Math.max(1, (end - start) / DAY + 1);
  const pos = (d: string) => ((toTime(d) - start) / DAY / span) * 100;
  const daysLate = s.targetEnd ? Math.round((toTime(s.estimatedFinish) - toTime(s.targetEnd)) / DAY) : 0;

  const co = s.company;
  const isSales = s.purpose === 'SALES';
  const status = isSales
    ? { label: 'Quotation — planning simulation', tone: 'border-sky-200 bg-sky-50 text-sky-800' }
    : s.planApproved
      ? { label: 'Approved plan', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' }
      : { label: 'Draft plan — estimate', tone: 'border-amber-200 bg-amber-50 text-amber-800' };
  const reference = `${s.project.code}-R${s.runNumber}`;
  const quote = s.quote && showPrice ? s.quote : null;
  const footerLeft = [co?.name, showCode ? reference : null].filter(Boolean).join(' · ');

  const printCss = `@media print {
  @page { size: A4; margin: 14mm 12mm 16mm;
    @bottom-left { content: "${cssText(footerLeft)}"; font: 8pt system-ui, sans-serif; color: #64748b; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt system-ui, sans-serif; color: #64748b; } }
  html, body { background: #fff !important; }
  .summary-sheet { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .keep { break-inside: avoid; page-break-inside: avoid; }
  .summary-sheet h2 { break-after: avoid; page-break-after: avoid; }
}`;

  return (
    <div className="p-6 print:p-0">
      <style>{printCss}</style>

      {/* Screen-only toolbar */}
      <div className="max-w-[210mm] mx-auto mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/planning/project?id=${id}`} className="inline-flex items-center gap-1 text-sm text-green-700 hover:underline"><ArrowLeft className="h-4 w-4" />Back to the project</Link>
        <div className="flex-1" />
        <label className="inline-flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={showTeam} onChange={(e) => setShowTeam(e.target.checked)} />Show team size</label>
        <label className="inline-flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={showCode} onChange={(e) => setShowCode(e.target.checked)} />Show reference</label>
        {s.quote && <label className="inline-flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />Show price</label>}
        <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1.5" />Print / Save as PDF</Button>
      </div>
      <div className="max-w-[210mm] mx-auto mb-4 space-y-2 print:hidden">
        <p className="text-xs text-slate-500">Customer view: costs, labour rates, margins, stock levels and warehouse figures are never included. To save a PDF, choose &quot;Save as PDF&quot; as the printer. Longer proposals continue on further A4 pages.</p>
        {!co && <p className="text-xs rounded-md border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">Your company name and logo are not set up, so this document has no provider identity. An administrator can add them in <Link href="/company-profile" className="underline">Company Profile</Link>.</p>}
        {!s.quote && <p className="text-xs text-slate-500">No price on this proposal. To add one, choose a pricing method under Space &amp; cost → Selling price, then recalculate.</p>}
        {s.quote && !s.quote.complete && <p className="text-xs rounded-md border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">The price was entered directly, but the cost estimate is incomplete, so the margin has not been checked.</p>}
        {s.stale && <p className="text-xs rounded-md border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">The scenario changed after this calculation. Recalculate before sending this proposal to a customer.</p>}
        {!s.deliverables.length && !s.assumptions.length && !s.exclusions.length && <p className="text-xs text-slate-500">Deliverables, assumptions and exclusions can be added on the project page (Project tab → Customer proposal wording). Empty sections are left out.</p>}
      </div>

      {/* The document */}
      <article className="summary-sheet max-w-[210mm] mx-auto bg-white border border-slate-200 rounded-xl shadow-sm p-5 sm:p-10 text-slate-800 print:max-w-none print:border-0 print:rounded-none print:shadow-none print:p-0">
        {/* Provider identity */}
        <header className="flex items-start justify-between gap-6 border-b-2 border-emerald-600 pb-4">
          <div className="flex items-center gap-3 min-w-0">
            {logo
              ? <img src={logo} alt={co?.name ? `${co.name} logo` : 'Company logo'} className="h-14 w-auto max-w-[200px] object-contain" />
              : <span className="print:hidden flex h-14 w-24 items-center justify-center rounded-md border border-dashed border-slate-300 text-slate-400" title="No official logo uploaded — the PDF prints without one"><ImageOff className="h-5 w-5" /></span>}
            {co && (
              <div className="min-w-0">
                <p className="text-lg font-bold text-slate-900 leading-tight">{co.name}</p>
                {co.legalName !== co.name && <p className="text-xs text-slate-500">{co.legalName}</p>}
              </div>
            )}
          </div>
          {co && (
            <div className="text-right text-[11px] leading-relaxed text-slate-500 max-w-[50%]">
              {co.address && <p className="whitespace-pre-line">{co.address}</p>}
              {(co.phone || co.email) && <p>{[co.phone, co.email].filter(Boolean).join(' · ')}</p>}
              {co.website && <p>{co.website}</p>}
              {co.taxId && <p>Tax ID {co.taxId}</p>}
            </div>
          )}
        </header>

        {/* Title */}
        <section className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">{isSales ? 'Project proposal' : 'Project plan summary'}</p>
            <h1 className="text-2xl font-bold text-slate-900 mt-1 break-words">{s.project.name}</h1>
            <p className="text-sm text-slate-600 mt-1">
              {s.project.customer ? <>Prepared for <span className="font-semibold text-slate-800">{s.project.customer}</span></> : 'Prepared for the customer'}
              {s.project.product && <> · {s.project.product}</>}
            </p>
          </div>
          <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span>
        </section>

        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-x-4 gap-y-2 rounded-lg bg-slate-50 px-4 py-3 text-xs">
          {showCode && <Meta label="Reference" value={s.project.code} mono />}
          {showCode && <Meta label="Revision" value={`R${s.runNumber}`} mono />}
          <Meta label="Date" value={longDate(s.generatedAt.slice(0, 10))} />
          {quote?.validUntil ? <Meta label="Valid until" value={longDate(quote.validUntil)} /> : s.preparedBy ? <Meta label="Prepared by" value={s.preparedBy} /> : null}
        </dl>

        {/* Key figures */}
        <section className="keep mt-5 grid grid-cols-2 sm:grid-cols-5 print:grid-cols-5 gap-3">
          <Figure label="Quantity" value={`${fmt(s.quantity, 0)}`} unit="units" sub={PROJECT_TYPES[s.project.projectType] ?? s.project.projectType} />
          {showTeam && s.teamSize ? <Figure label="Team" value={`${s.teamSize}`} unit="people" sub={s.shiftsPerDay ? `${s.shiftsPerDay} shift${s.shiftsPerDay > 1 ? 's' : ''} per day` : undefined} /> : null}
          <Figure label="Duration" value={s.durationWorkingDays === null ? '—' : `${s.durationWorkingDays}`} unit="working days" sub={`From ${longDate(s.plannedStart)}`} />
          <Figure label="Est. completion" value={longDate(s.estimatedFinish)} tone={s.meetsTarget ? 'good' : 'warn'} />
          <Figure label="Daily capacity" value={s.outputPerDay === null ? '—' : fmt(s.outputPerDay, 1)} unit="units/day" />
        </section>

        {/* Commercial summary */}
        {quote && (
          <section className="keep mt-5 rounded-lg border border-emerald-200 overflow-hidden">
            <h2 className="bg-emerald-600 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white">Commercial summary</h2>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-emerald-100">
                  <td className="px-4 py-2 text-slate-600">Project price{quote.vatPct ? ' (excluding VAT)' : ''}<span className="block text-xs text-slate-400">{fmt(s.quantity, 0)} units × {money(quote.pricePerUnit, quote.currency)}</span></td>
                  <td className="px-4 py-2 text-right font-semibold whitespace-nowrap">{money(quote.price, quote.currency)}</td>
                </tr>
                {quote.vatPct ? (
                  <>
                    <tr className="border-b border-emerald-100">
                      <td className="px-4 py-2 text-slate-600">VAT {quote.vatPct}%</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{money(quote.vatAmount, quote.currency)}</td>
                    </tr>
                    <tr className="bg-emerald-50">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">Total including VAT</td>
                      <td className="px-4 py-2.5 text-right text-lg font-bold text-emerald-800 whitespace-nowrap">{money(quote.priceIncludingVat, quote.currency)}</td>
                    </tr>
                  </>
                ) : null}
              </tbody>
            </table>
            {quote.validUntil && <p className="px-4 py-2 text-xs text-slate-500 border-t border-emerald-100">Price valid until {longDate(quote.validUntil)}.</p>}
          </section>
        )}

        {/* Delivery */}
        <section className={`keep mt-5 rounded-lg border px-4 py-3 text-sm ${s.meetsTarget ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="grid grid-cols-2 gap-4">
            <div><p className="text-[11px] uppercase tracking-wide text-slate-500">Requested delivery</p><p className="font-semibold text-slate-900">{longDate(s.targetEnd)}</p></div>
            <div><p className="text-[11px] uppercase tracking-wide text-slate-500">Estimated completion</p><p className={`font-semibold ${s.meetsTarget ? 'text-emerald-800' : 'text-amber-800'}`}>{longDate(s.estimatedFinish)}</p></div>
          </div>
          <p className={`mt-2 flex items-start gap-1.5 text-xs ${s.meetsTarget ? 'text-emerald-800' : 'text-amber-800'}`}>
            {s.meetsTarget
              ? <><CheckCircle2 className="h-3.5 w-3.5 mt-px shrink-0" />Expected to complete on or before the requested date.</>
              : <><AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />Expected {daysLate > 0 ? `${daysLate} calendar day${daysLate > 1 ? 's' : ''} ` : ''}after the requested date. We will agree a revised date or a faster plan before confirming.</>}
          </p>
        </section>

        {/* Scope of work */}
        {(s.project.scope || s.deliverables.length > 0) && (
          <section className="mt-6">
            <SectionTitle>Scope of work</SectionTitle>
            {s.project.scope && <p className="text-sm text-slate-700 mt-2 whitespace-pre-line">{s.project.scope}</p>}
            {s.deliverables.length > 0 && (
              <div className="keep mt-3">
                <p className="text-xs font-semibold text-slate-700">Deliverables</p>
                <List items={s.deliverables} icon />
              </div>
            )}
          </section>
        )}

        {/* Work plan */}
        <section className="mt-6">
          <SectionTitle>Work plan</SectionTitle>
          <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full text-sm mt-2 border-collapse">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="py-2 px-2 font-medium w-8">#</th>
                <th className="py-2 pr-3 font-medium">Step</th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">Start</th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">Finish</th>
                <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Days</th>
                <th className="hidden sm:table-cell print:table-cell py-2 pr-2 font-medium w-[30%]">Timeline</th>
              </tr>
            </thead>
            <tbody>
              {s.stages.map((x: any, i: number) => (
                <tr key={i} className="keep border-b border-slate-100 align-top">
                  <td className="py-2 px-2 text-slate-400">{i + 1}</td>
                  <td className="py-2 pr-3">
                    <span className="font-medium text-slate-900">{x.name}</span>
                    {x.isQualityGate && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-emerald-700"><ShieldCheck className="h-3 w-3" />Quality check</span>}
                    {x.completionCriteria && <span className="block text-xs text-slate-500">Done when: {x.completionCriteria}</span>}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">{longDate(x.startDate)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">{longDate(x.finishDate)}</td>
                  <td className="py-2 pr-3 text-right">{fmt(x.workingDays, 1)}</td>
                  <td className="hidden sm:table-cell print:table-cell py-2.5 pr-2">
                    <div className="relative h-3 rounded bg-slate-100">
                      {s.targetEnd && <div className="absolute inset-y-[-3px] w-px bg-slate-400" style={{ left: `${Math.min(100, pos(s.targetEnd) + 100 / span)}%` }} title="Requested date" />}
                      <div className="absolute inset-y-0 rounded bg-emerald-500" style={{ left: `${pos(x.startDate)}%`, width: `${Math.max(1.5, pos(x.finishDate) + 100 / span - pos(x.startDate))}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="hidden sm:block print:block mt-1.5 text-[11px] text-slate-400">The thin line on the timeline marks the requested delivery date.</p>
        </section>

        {/* Assumptions / exclusions — only when written for this project */}
        {(s.assumptions.length > 0 || s.exclusions.length > 0) && (
          <section className="mt-6 grid sm:grid-cols-2 print:grid-cols-2 gap-5">
            {s.assumptions.length > 0 && <div className="keep"><SectionTitle>Assumptions</SectionTitle><List items={s.assumptions} /></div>}
            {s.exclusions.length > 0 && <div className="keep"><SectionTitle>Exclusions</SectionTitle><List items={s.exclusions} /></div>}
          </section>
        )}

        {s.terms.length > 0 && (
          <section className="keep mt-6">
            <SectionTitle>Terms</SectionTitle>
            <List items={s.terms} />
          </section>
        )}

        <section className="keep mt-6">
          <SectionTitle>Planning notes</SectionTitle>
          <List items={s.notes} small />
        </section>

        {s.contact && (
          <section className="keep mt-6 rounded-lg border border-slate-200 px-4 py-3 text-sm">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Contact for this proposal</p>
            <p className="font-semibold text-slate-900 mt-0.5">{s.contact.name}{co ? <span className="font-normal text-slate-500"> · {co.name}</span> : null}</p>
            {(s.contact.email || s.contact.phone) && <p className="text-xs text-slate-600">{[s.contact.phone, s.contact.email].filter(Boolean).join(' · ')}</p>}
          </section>
        )}

        <footer className="mt-8 pt-3 border-t border-slate-200 text-[11px] text-slate-400 flex flex-wrap justify-between gap-x-4 gap-y-1">
          <span>{s.planApproved && !isSales ? 'Approved operational plan — dates remain estimates until the order and start date are confirmed.' : 'Planning estimate — not a contract or an order confirmation.'}</span>
          <span>{showCode ? `${reference} · ` : ''}Calculated {longDate(s.asOf)}</span>
        </footer>
      </article>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><span className="h-3.5 w-1 rounded-full bg-emerald-600" />{children}</h2>;
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`font-medium text-slate-800 truncate ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function List({ items, icon, small }: { items: string[]; icon?: boolean; small?: boolean }) {
  return (
    <ul className={`mt-1.5 space-y-1 ${small ? 'text-xs text-slate-600' : 'text-sm text-slate-700'}`}>
      {items.map((t, i) => (
        <li key={i} className="keep flex items-start gap-2">
          {icon
            ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600" />
            : <span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-emerald-600" />}
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function Figure({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub?: string; tone?: 'good' | 'warn' }) {
  return (
    <div className="rounded-lg border border-slate-200 border-t-2 border-t-emerald-500 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-base font-bold mt-0.5 leading-tight ${tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900'}`}>
        {value}{unit && <span className="ml-1 text-xs font-normal text-slate-500">{unit}</span>}
      </p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function CustomerSummaryPage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-[600px] max-w-[210mm] mx-auto" /></div>}>
      <Summary />
    </Suspense>
  );
}
