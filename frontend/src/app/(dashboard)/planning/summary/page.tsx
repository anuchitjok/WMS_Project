'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Printer, ShieldCheck } from 'lucide-react';
import { planningApi } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { PROJECT_TYPES, fmt } from '@/components/planning/shared';

const DAY = 86_400_000;
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
const longDate = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const money = (n: number, cur: string) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

/**
 * Customer summary — one A4 page to show or hand to a customer.
 * The API builds it from a whitelist, so no cost, rate, margin, stock or
 * warehouse figure can appear here. "Save as PDF" uses the browser's print dialog.
 */
function Summary() {
  const q = useSearchParams();
  const id = q.get('id') ?? '';
  const runId = q.get('run') ?? '';
  const [s, setS] = useState<any>(null);
  const [error, setError] = useState('');
  const [showTeam, setShowTeam] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const [showPrice, setShowPrice] = useState(true);

  useEffect(() => {
    if (!id || !runId) { setError('No calculation selected.'); return; }
    planningApi.customerSummary(id, runId).then(setS).catch((e) => setError(e.message));
  }, [id, runId]);

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

  return (
    <div className="p-6 print:p-0">
      <style>{'@media print { @page { size: A4; margin: 12mm; } html, body { background: #fff !important; } .summary-sheet { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }'}</style>

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
        <p className="text-xs text-slate-500">Customer view: costs, labour rates, stock levels and warehouse figures are never included. To save a PDF, choose &quot;Save as PDF&quot; as the printer.</p>
        {!s.quote && <p className="text-xs text-slate-500">No price on this summary. To add one, choose a pricing method under Space &amp; cost → Selling price, then recalculate.</p>}
        {s.quote && !s.quote.complete && <p className="text-xs rounded-md border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">The price was entered directly, but the cost estimate is incomplete, so the margin has not been checked.</p>}
        {s.stale && <p className="text-xs rounded-md border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">The scenario changed after this calculation. Recalculate before sending this summary to a customer.</p>}
      </div>

      {/* The sheet */}
      <article className="summary-sheet max-w-[210mm] mx-auto bg-white border border-slate-200 rounded-xl shadow-sm p-10 text-slate-800 print:max-w-none print:border-0 print:rounded-none print:shadow-none print:p-0">
        <header className="flex items-start justify-between gap-6 border-b-2 border-green-600 pb-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Project plan summary</p>
            <h1 className="text-2xl font-bold text-slate-900 mt-1 break-words">{s.project.name}</h1>
            <p className="text-sm text-slate-600 mt-1">
              {s.project.customer ? <>Prepared for <span className="font-medium text-slate-800">{s.project.customer}</span></> : 'Prepared for the customer'}
              {s.project.product && <> · {s.project.product}</>}
            </p>
          </div>
          <dl className="text-xs text-right shrink-0 space-y-0.5">
            {showCode && <div><dt className="inline text-slate-500">Reference </dt><dd className="inline font-mono">{s.project.code}-R{s.runNumber}</dd></div>}
            <div><dt className="inline text-slate-500">Date </dt><dd className="inline">{longDate(s.generatedAt.slice(0, 10))}</dd></div>
            {s.preparedBy && <div><dt className="inline text-slate-500">Prepared by </dt><dd className="inline">{s.preparedBy}</dd></div>}
          </dl>
        </header>

        <section className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-3 mt-5">
          <Figure label="Quantity" value={`${fmt(s.quantity, 0)} units`} sub={PROJECT_TYPES[s.project.projectType] ?? s.project.projectType} />
          <Figure label="Estimated completion" value={longDate(s.estimatedFinish)} sub={s.meetsTarget ? `On or before ${longDate(s.targetEnd)}` : `Requested ${longDate(s.targetEnd)}`} tone={s.meetsTarget ? 'good' : 'warn'} />
          <Figure label="Duration" value={s.durationWorkingDays === null ? '—' : `${s.durationWorkingDays} working days`} sub={`Starting ${longDate(s.plannedStart)}`} />
          <Figure label="Output" value={s.outputPerDay === null ? '—' : `${fmt(s.outputPerDay, 1)} units/day`}
            sub={showTeam && s.teamSize ? `Team of ${s.teamSize}${s.shiftsPerDay ? `, ${s.shiftsPerDay} shift${s.shiftsPerDay > 1 ? 's' : ''}/day` : ''}` : 'At full line pace'} />
        </section>

        {s.quote && showPrice && <Quote q={s.quote} />}

        {s.project.scope && (
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-slate-900">Scope</h2>
            <p className="text-sm text-slate-700 mt-1 whitespace-pre-line">{s.project.scope}</p>
          </section>
        )}

        <section className="mt-6">
          <h2 className="text-sm font-semibold text-slate-900">Work plan</h2>
          <table className="w-full text-sm mt-2 border-collapse">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-3 font-medium w-8">#</th>
                <th className="py-2 pr-3 font-medium">Step</th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">Start</th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">Finish</th>
                <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Days</th>
                <th className="py-2 font-medium w-[34%]">Timeline</th>
              </tr>
            </thead>
            <tbody>
              {s.stages.map((x: any, i: number) => (
                <tr key={i} className="border-b border-slate-100 align-top break-inside-avoid">
                  <td className="py-2 pr-3 text-slate-400">{i + 1}</td>
                  <td className="py-2 pr-3">
                    <span className="font-medium text-slate-900">{x.name}</span>
                    {x.isQualityGate && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-green-700"><ShieldCheck className="h-3 w-3" />Quality check</span>}
                    {x.completionCriteria && <span className="block text-xs text-slate-500">{x.completionCriteria}</span>}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">{longDate(x.startDate)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">{longDate(x.finishDate)}</td>
                  <td className="py-2 pr-3 text-right">{fmt(x.workingDays, 1)}</td>
                  <td className="py-2.5">
                    <div className="relative h-3 rounded bg-slate-100">
                      <div className="absolute inset-y-0 rounded bg-green-500" style={{ left: `${pos(x.startDate)}%`, width: `${Math.max(1.5, pos(x.finishDate) + 100 / span - pos(x.startDate))}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            Completion {longDate(s.estimatedFinish)}{s.meetsTarget ? ` — within the requested date ${longDate(s.targetEnd)}.` : ` — after the requested date ${longDate(s.targetEnd)}; we will agree a revised date or a faster plan.`}
          </p>
        </section>

        <section className="mt-6">
          <h2 className="text-sm font-semibold text-slate-900">Notes</h2>
          <ul className="list-disc pl-5 text-xs text-slate-600 mt-1 space-y-0.5">
            {s.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}
          </ul>
        </section>

        <footer className="mt-8 pt-3 border-t border-slate-200 text-[11px] text-slate-400 flex justify-between gap-4">
          <span>Planning estimate — not a contract or an order confirmation.</span>
          <span>Calculated {longDate(s.asOf)}</span>
        </footer>
      </article>
    </div>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-base font-semibold mt-0.5 ${tone === 'good' ? 'text-green-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function Quote({ q }: { q: any }) {
  return (
    <section className="mt-6 rounded-lg border border-green-200 bg-green-50/60 px-4 py-3">
      <h2 className="text-sm font-semibold text-slate-900">Price</h2>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm">
        <span>Project price{q.vatPct ? ' (excluding VAT)' : ''}</span>
        <span className="text-xl font-bold text-green-800">{money(q.price, q.currency)}</span>
      </div>
      <div className="mt-1 grid gap-0.5 text-xs text-slate-600">
        <span>{money(q.pricePerUnit, q.currency)} per unit</span>
        {q.vatPct ? <span>VAT {q.vatPct}%: {money(q.vatAmount, q.currency)} · Total including VAT {money(q.priceIncludingVat, q.currency)}</span> : null}
        {q.validUntil && <span>Price valid until {longDate(q.validUntil)}</span>}
      </div>
    </section>
  );
}

export default function CustomerSummaryPage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-[600px]" /></div>}>
      <Summary />
    </Suspense>
  );
}
