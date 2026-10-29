'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { mrpApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PlanDetail, Warnings } from './plan-detail';
import { BarChart, Field, Note, Pill, ProductPicker, SELECT, Section, TD, TH, THEAD, THEAD_ROW, fmtDate, fmtPct, fmtQty, isForbidden, useWarehouses } from './shared';

// One material: usage history, forecast methods side by side, manual overrides
// (with approval), and a live plan that is calculated but not stored.

type View = 'usage' | 'forecast' | 'plan';
const OVERRIDE_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = { APPROVED: 'green', PENDING: 'amber', REJECTED: 'red', CANCELLED: 'slate' };

export function MrpMaterial({ initial }: { initial?: { id: string; code: string; name: string } | null }) {
  const warehouses = useWarehouses();
  const [product, setProduct] = useState(initial ?? null);
  const [warehouseId, setWarehouseId] = useState('');
  const [view, setView] = useState<View>('usage');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Material" className="w-full sm:w-96"><ProductPicker value={product} onChange={setProduct} /></Field>
        <Field label="Warehouse">
          <select className={SELECT} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">All warehouses in my scope</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code ? `${w.code} — ` : ''}{w.name}</option>)}
          </select>
        </Field>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          {(['usage', 'forecast', 'plan'] as View[]).map((v) => (
            <button key={v} className={`px-3 py-1.5 text-sm rounded-md ${view === v ? 'bg-green-50 text-green-700 font-medium' : 'text-slate-600 hover:text-slate-900'}`} onClick={() => setView(v)}>
              {v === 'usage' ? 'Usage history' : v === 'forecast' ? 'Forecast & overrides' : 'Live plan'}
            </button>
          ))}
        </div>
      </div>
      {!product ? <p className="text-sm text-slate-500 py-10 text-center">Pick a material to analyse.</p>
        : view === 'usage' ? <UsageView productId={product.id} warehouseId={warehouseId} />
        : view === 'forecast' ? <ForecastView productId={product.id} warehouseId={warehouseId} />
        : <LivePlan productId={product.id} warehouseId={warehouseId} />}
    </div>
  );
}

function UsageView({ productId, warehouseId }: { productId: string; warehouseId: string }) {
  const [granularity, setGranularity] = useState('MONTH');
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    setData(null);
    mrpApi.usage(productId, { warehouseId: warehouseId || undefined, granularity }).then(setData).catch((e) => toast.error(e.message));
  }, [productId, warehouseId, granularity]);
  if (!data) return <Skeleton className="h-64" />;
  const s = data.stats;
  const cmp = (c: any) => (c ? `${fmtQty(c.current)} vs ${fmtQty(c.previous)} (${c.changePct == null ? 'base was 0' : `${c.changePct > 0 ? '+' : ''}${c.changePct}%`})` : 'Not enough history');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select className={SELECT} value={granularity} onChange={(e) => setGranularity(e.target.value)}>
          <option value="DAY">Daily</option><option value="WEEK">Weekly</option><option value="MONTH">Monthly</option>
        </select>
        <span className="text-xs text-slate-500">Completed periods only · unit {data.product.unit} · basis {data.basis === 'CONFIRMED_USAGE' ? 'confirmed usage' : 'net issues'}</span>
      </div>
      <Section title={`${data.product.sku} — ${data.product.description}`} subtitle="Green = usage per period; outline = usage confirmed as used against RMA cases">
        <BarChart points={data.series.points.map((p: any) => ({ label: p.start.slice(granularity === 'MONTH' ? 2 : 5, granularity === 'MONTH' ? 7 : 10), value: p.qty }))}
          compare={data.confirmedSeries.points.map((p: any) => p.qty)} compareLabel="confirmed" />
        {data.series.trimmedPeriods > 0 && <p className="px-4 pb-1 text-xs text-slate-500">History starts at the first recorded usage on {fmtDate(data.series.historyStart)}; the {data.series.trimmedPeriods} earlier period(s) are left out, not counted as zero.</p>}
        {data.series.periodToDate > 0 && <p className="px-4 pb-3 text-xs text-slate-500">Current (incomplete) period so far: {fmtQty(data.series.periodToDate)} — not used for averages or forecasts.</p>}
      </Section>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section title="Statistics">
          <dl className="grid grid-cols-2 gap-y-1.5 px-4 py-3 text-sm">
            <dt className="text-slate-500">Total</dt><dd className="text-right">{fmtQty(s.total)}</dd>
            <dt className="text-slate-500">Avg per period</dt><dd className="text-right">{fmtQty(s.meanPerPeriod)}</dd>
            <dt className="text-slate-500">Avg per month</dt><dd className="text-right">{fmtQty(s.avgMonthly)}</dd>
            <dt className="text-slate-500">Avg per day</dt><dd className="text-right">{fmtQty(s.avgDaily, 3)}</dd>
            <dt className="text-slate-500">Std deviation</dt><dd className="text-right">{fmtQty(s.stdDev)}</dd>
            <dt className="text-slate-500">CV</dt><dd className="text-right">{s.cv == null ? '—' : s.cv.toFixed(2)}</dd>
            <dt className="text-slate-500">ADI / CV²</dt><dd className="text-right">{s.adi == null ? '—' : s.adi.toFixed(2)} / {s.cv2NonZero == null ? '—' : s.cv2NonZero.toFixed(2)}</dd>
            <dt className="text-slate-500">Pattern</dt><dd className="text-right capitalize">{String(s.pattern).toLowerCase()}</dd>
            <dt className="text-slate-500">Trend</dt><dd className="text-right capitalize">{String(s.trend.direction).toLowerCase()}</dd>
          </dl>
        </Section>
        <Section title="Comparisons">
          <dl className="px-4 py-3 text-sm space-y-2">
            <div><dt className="text-slate-500 text-xs">{data.comparisons.pop?.label ?? 'Period over period'}</dt><dd>{cmp(data.comparisons.pop)}</dd></div>
            <div><dt className="text-slate-500 text-xs">Year over year</dt><dd>{cmp(data.comparisons.yoy)}</dd></div>
          </dl>
        </Section>
        <Section title="Totals in the window">
          <dl className="grid grid-cols-2 gap-y-1.5 px-4 py-3 text-sm">
            <dt className="text-slate-500">Goods issued</dt><dd className="text-right">{fmtQty(data.totals.issues)}</dd>
            <dt className="text-slate-500">Unused returns</dt><dd className="text-right">{fmtQty(data.totals.unusedReturns)}</dd>
            <dt className="text-slate-500">Repair consumption</dt><dd className="text-right">{fmtQty(data.totals.repairRelated)}</dd>
          </dl>
        </Section>
      </div>
      <Section title="How usage is counted"><ul className="px-4 py-3 text-xs text-slate-600 list-disc list-inside space-y-0.5">{data.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></Section>
      <Section title="Source transactions" subtitle="Most recent 200">
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className={`${THEAD} sticky top-0`}><tr className={THEAD_ROW}><th className={TH}>Date</th><th className={TH}>Type</th><th className={`${TH} text-right`}>Qty</th><th className={TH}>Reference</th></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {data.sources.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">No usage transactions in this window</td></tr> : data.sources.map((e: any, i: number) => (
                <tr key={i}><td className={TD}>{fmtDate(e.date)}</td><td className={TD}>{e.kind === 'ISSUE' ? 'Goods issue' : e.kind === 'RETURN' ? 'Unused return' : 'Confirmed usage'}</td><td className={`${TD} text-right`}>{fmtQty(e.qty)}</td><td className={`${TD} font-mono text-xs`}>{e.ref ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function ForecastView({ productId, warehouseId }: { productId: string; warehouseId: string }) {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [decide, setDecide] = useState<{ o: any; approve: boolean; note: string } | null>(null);

  const load = useCallback(() => {
    mrpApi.forecast(productId, warehouseId || undefined).then(setData).catch((e) => toast.error(e.message));
  }, [productId, warehouseId]);
  useEffect(() => { setData(null); load(); }, [load]);

  async function saveOverride() {
    try {
      await mrpApi.createOverride({ productId, warehouseId: warehouseId || null, periodStart: draft.periodStart, mode: draft.mode, quantity: Number(draft.quantity), reason: draft.reason, category: draft.category || undefined });
      toast.success(data.overrideRequiresApproval ? 'Override submitted for approval' : 'Override saved');
      setDraft(null); load();
    } catch (e: any) { toast.error(isForbidden(e) ? 'You do not have permission to override forecasts' : e.message); }
  }
  async function submitDecision() {
    if (!decide) return;
    try { await mrpApi.decideOverride(decide.o.id, decide.approve, decide.note || undefined); toast.success(decide.approve ? 'Override approved' : 'Override rejected'); setDecide(null); load(); }
    catch (e: any) { toast.error(isForbidden(e) ? 'You cannot decide this override' : e.message); }
  }
  async function cancel(o: any) {
    try { await mrpApi.cancelOverride(o.id); toast.success('Override cancelled'); load(); } catch (e: any) { toast.error(e.message); }
  }

  if (!data) return <Skeleton className="h-64" />;
  const hist = data.history.points;
  return (
    <div className="space-y-4">
      <Note>
        Methods: SMA = simple moving average, FMA = fast moving average (same formula over a shorter window, so it reacts sooner), WMA = weighted moving average (newest weighted most), LINEAR = least-squares trend (never below zero).
        Windows and weights come from the planning settings. Accuracy is a one-step-ahead back-test on completed periods.
      </Note>
      <Section title="Methods compared" subtitle={`Chosen: ${data.chosenMethod} — ${data.methodSelection}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>Method</th><th className={`${TH} text-right`}>Window</th><th className={`${TH} text-right`}>Per period</th><th className={`${TH} text-right`}>Horizon total</th><th className={`${TH} text-right`}>Bias</th><th className={`${TH} text-right`}>MAE</th><th className={`${TH} text-right`}>WAPE</th><th className={TH}>Notes</th></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {data.methods.map((m: any) => (
                <tr key={m.method} className={m.chosen ? 'bg-green-50/40' : ''}>
                  <td className={TD}>{m.method}{m.chosen && <span className="text-xs text-green-700 ml-1">(used)</span>}</td>
                  <td className={`${TD} text-right`}>{m.window}</td>
                  <td className={`${TD} text-right`}>{fmtQty(m.perPeriod[0])}</td>
                  <td className={`${TD} text-right`}>{fmtQty(m.total)}</td>
                  <td className={`${TD} text-right`}>{fmtQty(m.accuracy.bias)}</td>
                  <td className={`${TD} text-right`}>{fmtQty(m.accuracy.mae)}</td>
                  <td className={`${TD} text-right`}>{fmtPct(m.accuracy.wape)}</td>
                  <td className={`${TD} text-xs text-slate-500`}>{[...(m.sufficient ? [] : ['Not enough history']), ...m.warnings, ...(m.accuracy.note ? [m.accuracy.note] : [])].join(' · ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Forecast by period" subtitle="Statistical forecast is kept; the final value includes approved overrides"
        action={<Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-8" onClick={() => setDraft({ periodStart: data.buckets[1]?.start?.slice(0, 10) ?? data.buckets[0].start.slice(0, 10), mode: 'REPLACE', quantity: '', reason: '', category: '' })}>Add override</Button>}>
        <BarChart points={[...hist.slice(-12).map((p: any) => ({ label: p.start.slice(2, 7), value: p.qty })), ...data.buckets.map((b: any) => ({ label: b.start.slice(2, 7), value: 0 }))]}
          compare={[...hist.slice(-12).map(() => null), ...data.buckets.map((b: any) => b.final)]} compareLabel="forecast" />
        <table className="w-full text-sm">
          <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>Period</th><th className={`${TH} text-right`}>Statistical</th><th className={`${TH} text-right`}>Final</th><th className={`${TH} text-right`}>In plan (pro-rated)</th></tr></thead>
          <tbody className="divide-y divide-slate-50">
            {data.buckets.map((b: any) => (
              <tr key={b.start}><td className={TD}>{fmtDate(b.start)}</td><td className={`${TD} text-right`}>{fmtQty(b.statistical)}</td><td className={`${TD} text-right ${b.final !== b.statistical ? 'font-semibold text-slate-900' : ''}`}>{fmtQty(b.final)}</td><td className={`${TD} text-right text-slate-500`}>{fmtQty(b.bucketForecast)}</td></tr>
            ))}
          </tbody>
        </table>
        {data.warnings?.length > 0 && <Warnings items={data.warnings} />}
      </Section>

      <Section title="Overrides" subtitle={data.overrideRequiresApproval ? 'Overrides apply after a different person approves them' : 'Overrides apply immediately (approval not required by settings)'}>
        <table className="w-full text-sm">
          <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>Period</th><th className={TH}>Mode</th><th className={`${TH} text-right`}>Qty</th><th className={`${TH} text-right`}>Statistical then</th><th className={TH}>Reason</th><th className={TH}>Status</th><th className={TH} /></tr></thead>
          <tbody className="divide-y divide-slate-50">
            {data.overrides.length === 0 ? <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No overrides</td></tr> : data.overrides.map((o: any) => (
              <tr key={o.id}>
                <td className={TD}>{fmtDate(o.periodStart)}</td>
                <td className={TD}>{o.mode === 'REPLACE' ? 'Replace' : 'Add'}</td>
                <td className={`${TD} text-right`}>{fmtQty(o.quantity)}</td>
                <td className={`${TD} text-right text-slate-500`}>{fmtQty(o.statisticalQty)}</td>
                <td className={`${TD} text-xs`}>{o.reason}{o.category && <span className="text-slate-400"> · {o.category}</span>}<div className="text-slate-400">{new Date(o.createdAt).toLocaleString()}</div></td>
                <td className={TD}><Pill tone={OVERRIDE_TONE[o.status] ?? 'slate'}>{String(o.status).toLowerCase()}</Pill>{o.decisionNote && <div className="text-xs text-slate-400">{o.decisionNote}</div>}</td>
                <td className={`${TD} text-right whitespace-nowrap`}>
                  {o.status === 'PENDING' && o.createdById !== user?.id && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 mr-1" onClick={() => setDecide({ o, approve: true, note: '' })}>Approve</Button>
                      <Button size="sm" variant="outline" className="h-7 mr-1" onClick={() => setDecide({ o, approve: false, note: '' })}>Reject</Button>
                    </>
                  )}
                  {['PENDING', 'APPROVED'].includes(o.status) && <Button size="sm" variant="outline" className="h-7" onClick={() => cancel(o)}>Cancel</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Dialog open={!!draft} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Forecast override</DialogTitle></DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Period">
                  <select className={`${SELECT} w-full`} value={draft.periodStart} onChange={(e) => setDraft({ ...draft, periodStart: e.target.value })}>
                    {data.buckets.map((b: any, i: number) => {
                      // The first bucket starts today when the period is part-way through; overrides key on the period's first day.
                      const v = i === 0 ? null : b.start.slice(0, 10);
                      return v ? <option key={v} value={v}>{v}</option> : null;
                    })}
                  </select>
                </Field>
                <Field label="Mode">
                  <select className={`${SELECT} w-full`} value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })}>
                    <option value="REPLACE">Replace statistical forecast</option><option value="ADD">Add to statistical forecast</option>
                  </select>
                </Field>
                <Field label="Quantity" hint={draft.mode === 'ADD' ? 'May be negative to reduce' : undefined}>
                  <input className={`${SELECT} w-full`} inputMode="decimal" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} />
                </Field>
                <Field label="Category">
                  <select className={`${SELECT} w-full`} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                    <option value="">—</option><option value="PROJECT">Project</option><option value="LAUNCH">Launch</option><option value="PHASE_OUT">Phase-out</option><option value="CAMPAIGN">Campaign</option><option value="OTHER">Other</option>
                  </select>
                </Field>
              </div>
              <Field label="Reason (required)"><textarea className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" rows={3} maxLength={500} value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></Field>
              <p className="text-xs text-slate-500">Overrides apply to future periods only. The current, part-finished period cannot be overridden.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={!draft?.reason?.trim() || draft?.quantity === ''} onClick={saveOverride}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!decide} onOpenChange={(o) => { if (!o) setDecide(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{decide?.approve ? 'Approve override' : 'Reject override'}</DialogTitle></DialogHeader>
          {decide && <Field label="Note (optional)"><textarea className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" rows={3} value={decide.note} onChange={(e) => setDecide({ ...decide, note: e.target.value })} /></Field>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecide(null)}>Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={submitDecision}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LivePlan({ productId, warehouseId }: { productId: string; warehouseId: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    setData(null);
    mrpApi.preview(productId, warehouseId || undefined).then(setData).catch((e) => toast.error(e.message));
  }, [productId, warehouseId]);
  if (!data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-3">
      <Note>Calculated now with the current data and settings (as of {new Date(data.asOf).toLocaleString()}). This preview is not stored; run planning to keep a record.</Note>
      {data.warnings?.length > 0 && <Section><Warnings items={data.warnings} /></Section>}
      <PlanDetail plan={data.plan} />
    </div>
  );
}
