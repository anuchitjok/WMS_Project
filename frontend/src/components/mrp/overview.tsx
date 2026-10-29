'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, ClipboardList, PackageX, Play, ShieldAlert, TrendingDown, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { mrpApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EXCEPTION_LABEL, BarChart, Field, MOVEMENT_LABEL, Note, SELECT, Section, StatusPill, TD, TH, THEAD, THEAD_ROW, fmtDate, fmtMoney, fmtPct, fmtQty, isForbidden, useWarehouses } from './shared';

export function MrpOverview({ onOpenRun }: { onOpenRun: (runId: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [runOpen, setRunOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await mrpApi.dashboard()); } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;
  const run = data?.run;
  const s = run?.summary;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {run ? <>Latest run <span className="font-mono">{run.runNumber}</span> · as of {fmtDate(run.asOf)} · {run.lineCount} material line(s){run.warehouseId ? ' · one warehouse' : ' · all warehouses in scope'}</> : 'No planning run yet.'}
        </p>
        <div className="flex gap-2">
          {run && <Button variant="outline" onClick={() => onOpenRun(run.id)}><ClipboardList className="h-4 w-4 mr-1" />Open plan</Button>}
          <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setRunOpen(true)}><Play className="h-4 w-4 mr-1" />Run planning</Button>
        </div>
      </div>

      {!run ? (
        <Note>
          A planning run reads current stock, usage history, open requests, imported PO lines and the planning parameters, then stores a reproducible plan.
          Nothing is ordered — results are suggestions for a buyer to review.
        </Note>
      ) : (
        <>
          {!s.thresholdsApproved && (
            <Note tone="amber">Fast/slow/excess classification thresholds are not approved yet; materials show as “Not classified” until they are set in Settings.</Note>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Order now" value={s.orderNow} icon={ShieldAlert} tone={s.orderNow ? 'red' : 'slate'} />
            <StatTile label="Projected shortage" value={s.projectedShortage} icon={TrendingDown} tone={s.projectedShortage ? 'amber' : 'slate'} />
            <StatTile label="Below safety stock" value={s.belowSafetyStock} icon={AlertTriangle} tone={s.belowSafetyStock ? 'amber' : 'slate'} />
            <StatTile label="Late orders" value={s.lateOrders} icon={CalendarClock} tone={s.lateOrders ? 'red' : 'slate'} />
            <StatTile label="Planned later" value={s.plannedLater} icon={ClipboardList} />
            <StatTile label="Overdue PO lines" value={s.overduePoLines} icon={Truck} tone={s.overduePoLines ? 'amber' : 'slate'} />
            <StatTile label="Missing parameters" value={s.missingParameters} icon={PackageX} tone={s.missingParameters ? 'amber' : 'slate'} />
            <StatTile label="Forecast WAPE" value={fmtPct(s.accuracy?.wape)} icon={TrendingDown} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Usage vs forecast" subtitle={`All planned materials, per ${String(s.granularity).toLowerCase()}. Green = usage history, outline = forecast.`}>
              <BarChart
                points={[...s.usageTrend.slice(-12).map((p: any) => ({ label: p.start.slice(2, 7), value: p.qty })), ...s.forecastTrend.map((p: any) => ({ label: p.start.slice(2, 7), value: 0 }))]}
                compare={[...s.usageTrend.slice(-12).map(() => null), ...s.forecastTrend.map((p: any) => p.qty)]}
                compareLabel="forecast"
              />
              <p className="px-4 pb-3 text-[11px] text-slate-400">WAPE pooled over {s.accuracy?.materials ?? 0} material(s) with enough back-test history.</p>
            </Section>
            <Section title="Estimated replenishment cost" subtitle="Per currency — currencies are never added together. Estimates only.">
              {!data.canSeeCost ? <p className="px-4 py-6 text-sm text-slate-400">Cost is hidden for your role.</p> : Object.keys(s.costByCurrency ?? {}).length === 0 ? (
                <p className="px-4 py-6 text-sm text-slate-400">No suggested orders with a known cost.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>Currency</th><th className={`${TH} text-right`}>Next orders</th><th className={`${TH} text-right`}>Whole horizon</th><th className={`${TH} text-right`}>Lines</th></tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {Object.entries(s.costByCurrency).map(([c, v]: [string, any]) => (
                      <tr key={c}><td className={TD}>{c === 'UNSPECIFIED' ? 'Not specified' : c}</td><td className={`${TD} text-right`}>{fmtMoney(v.first)}</td><td className={`${TD} text-right`}>{fmtMoney(v.horizon)}</td><td className={`${TD} text-right`}>{v.lines}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {data.canSeeCost && s.linesWithoutCost > 0 && <p className="px-4 py-2 text-xs text-amber-700 border-t border-slate-100">{s.linesWithoutCost} suggested order(s) have no cost and are not included.</p>}
            </Section>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Exceptions" subtitle="Materials flagged in the latest run">
              <ul className="divide-y divide-slate-50 text-sm">
                {Object.entries(s.byException ?? {}).sort((a: any, b: any) => b[1] - a[1]).map(([code, n]: [string, any]) => (
                  <li key={code} className="flex justify-between px-4 py-2"><span className="text-slate-700">{EXCEPTION_LABEL[code] ?? code}</span><span className="text-slate-500">{n}</span></li>
                ))}
                {Object.keys(s.byException ?? {}).length === 0 && <li className="px-4 py-6 text-slate-400 text-center">None</li>}
              </ul>
            </Section>
            <Section title="Movement classes">
              <ul className="divide-y divide-slate-50 text-sm">
                {Object.entries(s.byMovement ?? {}).map(([k, n]: [string, any]) => (
                  <li key={k} className="flex justify-between px-4 py-2"><span className="text-slate-700">{MOVEMENT_LABEL[k] ?? k}</span><span className="text-slate-500">{n}</span></li>
                ))}
                <li className="flex justify-between px-4 py-2"><span className="text-slate-700">Excess stock</span><span className="text-slate-500">{s.excessMaterials}</span></li>
                <li className="flex justify-between px-4 py-2"><span className="text-slate-700">Potentially obsolete</span><span className="text-slate-500">{s.potentialObsolete}</span></li>
              </ul>
            </Section>
          </div>

          <Section title="Order now" subtitle="Top 10 by urgency">
            <table className="w-full text-sm">
              <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>SKU</th><th className={TH}>Description</th><th className={`${TH} text-right`}>Available</th><th className={`${TH} text-right`}>Suggested</th><th className={TH}>Order by</th><th className={TH}>Status</th></tr></thead>
              <tbody className="divide-y divide-slate-50">
                {data.urgent.length === 0 ? <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Nothing to order now</td></tr> : data.urgent.map((l: any) => (
                  <tr key={l.id}><td className={`${TD} font-mono`}>{l.sku}</td><td className={TD}>{l.description}</td><td className={`${TD} text-right`}>{fmtQty(l.available)}</td><td className={`${TD} text-right font-semibold`}>{fmtQty(l.suggestedQty)}</td><td className={TD}>{fmtDate(l.suggestedOrderDate)}</td><td className={TD}><StatusPill status={l.planningStatus} /></td></tr>
                ))}
              </tbody>
            </table>
          </Section>
        </>
      )}

      <Section title="Overdue PO lines" subtitle="Imported purchase order lines past their expected date and not fully received">
        <table className="w-full text-sm">
          <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>PO / line</th><th className={TH}>SKU</th><th className={TH}>Supplier</th><th className={TH}>Expected</th><th className={`${TH} text-right`}>Outstanding</th></tr></thead>
          <tbody className="divide-y divide-slate-50">
            {data?.overduePo?.length ? data.overduePo.map((o: any) => (
              <tr key={o.id}><td className={`${TD} font-mono`}>{o.poNumber} / {o.lineNumber}</td><td className={`${TD} font-mono`}>{o.sku}</td><td className={TD}>{o.vendorName ?? '—'}</td><td className={TD}>{fmtDate(o.expectedDate)}</td><td className={`${TD} text-right`}>{fmtQty(o.outstanding)}</td></tr>
            )) : <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No overdue PO lines</td></tr>}
          </tbody>
        </table>
      </Section>

      <RunDialog open={runOpen} onClose={() => setRunOpen(false)} onDone={(id) => { setRunOpen(false); load(); onOpenRun(id); }} />
    </div>
  );
}

export function RunDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (runId: string) => void }) {
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const r = await mrpApi.run({ warehouseId: warehouseId || undefined, note: note || undefined });
      toast.success(`Planning run ${r.runNumber} finished (${r.lineCount} lines)`);
      onDone(r.id);
    } catch (e: any) { toast.error(isForbidden(e) ? 'You do not have permission to run planning' : e.message); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Run material planning</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Warehouse" hint="All warehouses plans the network; open requests are only included in a network run because they are not tied to a warehouse.">
            <select className={`${SELECT} w-full`} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">All warehouses in my scope</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code ? `${w.code} — ` : ''}{w.name}</option>)}
            </select>
          </Field>
          <Field label="Note (optional)">
            <input className={`${SELECT} w-full`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <p className="text-xs text-slate-500">The run is read-only: it stores suggestions and never creates or changes purchase orders.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={busy} onClick={go}>{busy ? 'Running…' : 'Run'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
