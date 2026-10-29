'use client';

import { AlertTriangle, Info } from 'lucide-react';
import { EXCEPTION_LABEL, MOVEMENT_LABEL, Pill, Section, StatusPill, TD, TH, THEAD, THEAD_ROW, fmtDate, fmtMoney, fmtPct, fmtQty } from './shared';

// Drill-down for one material: why the plan says what it says.
// `plan` is the engine's MaterialPlan (from a stored run line or a live preview).

const SEVERITY_TONE: Record<string, 'red' | 'amber' | 'slate'> = { HIGH: 'red', MEDIUM: 'amber', LOW: 'slate' };

export function PlanDetail({ plan, snapshot }: { plan: any; snapshot?: any }) {
  if (!plan) return null;
  const pos = plan.position;
  const s = plan.usage?.stats;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={plan.planningStatus} />
        <Pill>{MOVEMENT_LABEL[plan.classification?.movement] ?? plan.classification?.movement}</Pill>
        {plan.classification?.critical && <Pill tone="amber">Critical</Pill>}
        <span className="text-xs text-slate-500">Forecast: {plan.forecastMethod} — {plan.methodSelection}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Suggested order" value={fmtQty(plan.suggested.qty)} hint={plan.suggested.orderDate ? `Order by ${fmtDate(plan.suggested.orderDate)}${plan.suggested.late ? ' (late)' : ''}` : 'Nothing to order'} />
        <Kpi label="Required arrival" value={fmtDate(plan.suggested.requiredDate)} hint={plan.leadTimeDays != null ? `Lead time ${plan.leadTimeDays} days` : 'No lead time'} />
        <Kpi label="Projected shortage" value={fmtQty(plan.plan.maxShortage)} hint={plan.plan.firstShortage ? `First on ${fmtDate(plan.plan.firstShortage.date)}` : 'None if nothing is ordered'} />
        <Kpi label="Estimated cost" value={fmtMoney(plan.cost.estimatedCost, plan.cost.currency)} hint={plan.cost.label} />
      </div>

      {plan.exceptions?.length > 0 && (
        <Section title="Exceptions and recommendations">
          <ul className="divide-y divide-slate-50">
            {plan.exceptions.map((e: any, i: number) => (
              <li key={i} className="px-4 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <Pill tone={SEVERITY_TONE[e.severity] ?? 'slate'}>{EXCEPTION_LABEL[e.code] ?? e.code}</Pill>
                  <span className="text-slate-700">{e.message}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1 pl-1">→ {e.recommendation}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Inventory position" subtitle="Base unit, at the as-of time">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-sm">
            <Dt k="On hand" v={fmtQty(pos.onHand)} />
            <Dt k="Available" v={fmtQty(pos.available)} />
            <Dt k="Allocated / reserved" v={fmtQty(pos.allocated)} />
            <Dt k="Blocked / quarantine" v={fmtQty(pos.blocked)} />
            <Dt k="In inspection" v={fmtQty(pos.inspection)} />
            <Dt k="Usable for planning" v={fmtQty(pos.usable)} />
            <Dt k="Safety stock" v={fmtQty(plan.safetyStock)} />
            <Dt k="Open supply (PO)" v={fmtQty(plan.supply.openQty)} />
            <Dt k="Open demand (requests)" v={fmtQty(plan.demand.openQty)} />
            <Dt k="Next inbound" v={fmtDate(plan.supply.nextInboundDate)} />
          </dl>
        </Section>
        <Section title="Usage" subtitle={`${plan.usage.series.basis === 'CONFIRMED_USAGE' ? 'Confirmed usage' : 'Net issues'} per ${plan.usage.series.granularity.toLowerCase()}`}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-sm">
            <Dt k="Avg per month" v={fmtQty(s.avgMonthly)} />
            <Dt k="Avg per day" v={fmtQty(s.avgDaily, 3)} />
            <Dt k="Periods with usage" v={`${s.nonZeroPeriods} of ${s.periods}`} />
            <Dt k="Variability (CV)" v={s.cv == null ? '—' : s.cv.toFixed(2)} />
            <Dt k="Demand pattern" v={String(s.pattern).toLowerCase()} />
            <Dt k="Trend" v={String(s.trend.direction).toLowerCase()} />
            <Dt k="Last usage" v={fmtDate(plan.usage.lastUsageDate)} />
            <Dt k="Months of supply" v={fmtQty(plan.classification.monthsOfSupply, 1)} />
          </dl>
          {plan.usage.series.trimmedPeriods > 0 && (
            <p className="px-4 pb-3 text-xs text-slate-500">History starts at the first recorded usage on {fmtDate(plan.usage.series.historyStart)}; earlier periods are left out, not counted as zero.</p>
          )}
        </Section>
      </div>

      <Section title="Time-phased plan" subtitle="Gross = forecast and confirmed demand combined; net = shortfall below safety stock after receipts">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={THEAD}>
              <tr className={THEAD_ROW}>
                <th className={TH}>Period</th><th className={`${TH} text-right`}>Forecast</th><th className={`${TH} text-right`}>Confirmed</th>
                <th className={`${TH} text-right`}>Gross</th><th className={`${TH} text-right`}>Receipts</th><th className={`${TH} text-right`}>Net</th>
                <th className={`${TH} text-right`}>Planned</th><th className={TH}>Release</th><th className={`${TH} text-right`}>Projected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {plan.plan.buckets.map((b: any) => (
                <tr key={b.index}>
                  <td className={TD}>{fmtDate(b.start)}</td>
                  <td className={`${TD} text-right`}>{fmtQty(b.forecast)}</td>
                  <td className={`${TD} text-right`}>{fmtQty(b.confirmed)}</td>
                  <td className={`${TD} text-right`}>{fmtQty(b.gross)}</td>
                  <td className={`${TD} text-right`}>{fmtQty(b.receipts)}</td>
                  <td className={`${TD} text-right ${b.net > 0 ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{fmtQty(b.net)}</td>
                  <td className={`${TD} text-right ${b.planned > 0 ? 'font-semibold text-green-700' : 'text-slate-500'}`}>{fmtQty(b.planned)}</td>
                  <td className={TD}>{b.releaseDate ? <span className={b.late ? 'text-red-600' : ''}>{fmtDate(b.releaseDate)}{b.late ? ' (late)' : ''}</span> : '—'}</td>
                  <td className={`${TD} text-right ${b.projected < plan.safetyStock ? 'text-amber-700' : ''}`}>{fmtQty(b.projected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {plan.plan.warnings?.length > 0 && <Warnings items={plan.plan.warnings} />}
      </Section>

      <Section title="Forecast accuracy (back-test)" subtitle="One-step-ahead forecasts on completed periods. WAPE is blank when actual usage was zero.">
        <table className="w-full text-sm">
          <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>Method</th><th className={`${TH} text-right`}>Points</th><th className={`${TH} text-right`}>Bias</th><th className={`${TH} text-right`}>MAE</th><th className={`${TH} text-right`}>WAPE</th><th className={TH}>Note</th></tr></thead>
          <tbody className="divide-y divide-slate-50">
            {plan.accuracy.map((a: any) => (
              <tr key={a.method} className={a.method === plan.forecastMethod ? 'bg-green-50/40' : ''}>
                <td className={TD}>{a.method}{a.method === plan.forecastMethod && <span className="text-xs text-green-700 ml-1">(used)</span>}</td>
                <td className={`${TD} text-right`}>{a.n}</td>
                <td className={`${TD} text-right`}>{fmtQty(a.bias)}</td>
                <td className={`${TD} text-right`}>{fmtQty(a.mae)}</td>
                <td className={`${TD} text-right`}>{fmtPct(a.wape)}</td>
                <td className={`${TD} text-xs text-slate-500`}>{a.note ?? (a.sufficient ? '' : 'Not enough history')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {plan.supply.lines.length > 0 && (
        <Section title="Inbound supply (PO lines)" subtitle="Outstanding = ordered − cancelled − received (the larger of reported and WMS receipts)">
          <table className="w-full text-sm">
            <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>PO / line</th><th className={`${TH} text-right`}>Ordered</th><th className={`${TH} text-right`}>Received</th><th className={`${TH} text-right`}>Outstanding</th><th className={TH}>Expected</th><th className={TH}>Used in plan</th></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {plan.supply.lines.map((l: any) => (
                <tr key={l.id}>
                  <td className={TD}><span className="font-mono">{l.poNumber}</span> / {l.lineNumber}{!l.isConfirmed && <span className="text-xs text-slate-400 ml-1">(unconfirmed)</span>}</td>
                  <td className={`${TD} text-right`}>{fmtQty(l.orderedQty)}</td>
                  <td className={`${TD} text-right`}>{fmtQty(l.receivedUsed)}</td>
                  <td className={`${TD} text-right`}>{fmtQty(l.convertedOutstanding)}</td>
                  <td className={TD}>{fmtDate(l.expectedDate)}{l.overdue && <Pill tone="red">Overdue</Pill>}</td>
                  <td className={`${TD} text-xs`}>{l.eligible ? 'Yes' : <span className="text-amber-700">No — {l.reason}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {plan.alternatives?.length > 0 && (
        <Section title="Alternative suppliers (scenario only)" subtitle="Same requirement with each alternative's own MOQ, multiple, lead time and price. Costs are not converted between currencies.">
          <table className="w-full text-sm">
            <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>Supplier</th><th className={`${TH} text-right`}>Qty</th><th className={`${TH} text-right`}>Lead time</th><th className={TH}>Order by</th><th className={`${TH} text-right`}>Cost</th></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {plan.alternatives.map((a: any) => (
                <tr key={a.vendorId}>
                  <td className={TD}>{a.vendorName}</td>
                  <td className={`${TD} text-right`}>{fmtQty(a.qty)}</td>
                  <td className={`${TD} text-right`}>{a.leadTimeDays ?? '—'}</td>
                  <td className={TD}>{fmtDate(a.orderDate)}{a.late && <span className="text-xs text-red-600 ml-1">(late)</span>}</td>
                  <td className={`${TD} text-right`}>{fmtMoney(a.cost, a.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="Classification basis">
        <ul className="px-4 py-3 text-xs text-slate-600 list-disc list-inside space-y-0.5">
          {plan.classification.basis.length === 0 && <li className="list-none text-slate-400">No class assigned — the classification thresholds are not set in Settings.</li>}
          {plan.classification.basis.map((b: string, i: number) => <li key={i}>{b}</li>)}
        </ul>
      </Section>

      {(plan.forecast?.assumptions?.length > 0 || plan.forecast?.warnings?.length > 0) && (
        <Section title="Forecast basis">
          <div className="px-4 py-3 text-xs text-slate-600 space-y-1">
            <p>{plan.forecast.basis}</p>
            {plan.forecast.assumptions.map((a: string, i: number) => <p key={i} className="flex gap-1"><Info className="h-3.5 w-3.5 text-slate-400 shrink-0" />{a}</p>)}
            {plan.forecast.warnings.map((w: string, i: number) => <p key={i} className="flex gap-1 text-amber-700"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}</p>)}
            {plan.overridesApplied?.length > 0 && <p className="text-slate-700">Manual overrides applied in {plan.overridesApplied.length} period(s); the statistical forecast is kept alongside.</p>}
          </div>
        </Section>
      )}

      {snapshot?.params?.effectiveFrom && (
        <p className="text-[11px] text-slate-400">Parameter version effective from {fmtDate(snapshot.params.effectiveFrom)}{snapshot.params.warehouseId ? ' (warehouse-specific)' : ' (all warehouses)'}.</p>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold text-slate-900">{value}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function Dt({ k, v }: { k: string; v: string }) {
  return (<><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium text-slate-800">{v}</dd></>);
}

export function Warnings({ items }: { items: string[] }) {
  return (
    <ul className="px-4 py-3 border-t border-slate-100 text-xs text-amber-800 space-y-1">
      {items.map((w, i) => <li key={i} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />{w}</li>)}
    </ul>
  );
}
