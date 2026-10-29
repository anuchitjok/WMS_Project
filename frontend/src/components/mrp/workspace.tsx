'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Search } from 'lucide-react';
import { toast } from 'sonner';
import { mrpApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PlanDetail } from './plan-detail';
import { EXCEPTION_LABEL, MOVEMENT_LABEL, PLANNING_STATUS, Pager, Pill, SELECT, StatusPill, TD, TH, THEAD, THEAD_ROW, fmtDate, fmtMoney, fmtQty, isForbidden } from './shared';

// Planning workspace: every line of one run, filterable/sortable/paged, with drill-down.

const COLUMNS: Array<{ key: string; label: string; sort?: string; right?: boolean; cost?: boolean }> = [
  { key: 'sku', label: 'SKU', sort: 'sku' },
  { key: 'status', label: 'Status', sort: 'urgency' },
  { key: 'available', label: 'Available', sort: 'available', right: true },
  { key: 'safetyStock', label: 'Safety', right: true },
  { key: 'openPoQty', label: 'Open PO', sort: 'openPoQty', right: true },
  { key: 'forecastQty', label: 'Forecast', sort: 'forecastQty', right: true },
  { key: 'netReq', label: 'Net req.', sort: 'netReq', right: true },
  { key: 'projectedShortage', label: 'Shortage', sort: 'projectedShortage', right: true },
  { key: 'suggestedQty', label: 'Suggested', sort: 'suggestedQty', right: true },
  { key: 'suggestedOrderDate', label: 'Order by', sort: 'suggestedOrderDate' },
  { key: 'estCost', label: 'Est. cost', sort: 'estCost', right: true, cost: true },
  { key: 'exceptions', label: 'Exceptions' },
];

export function MrpWorkspace({ runId, onRunChange }: { runId: string | null; onRunChange: (id: string) => void }) {
  const [runs, setRuns] = useState<any[]>([]);
  const [filters, setFilters] = useState({ search: '', status: '', exception: '', movement: '', actionOnly: false });
  const [sort, setSort] = useState<{ key: string; order: 'asc' | 'desc' }>({ key: 'urgency', order: 'desc' });
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null);

  useEffect(() => {
    mrpApi.runs().then((r) => {
      setRuns(r);
      if (!runId && r.length) onRunChange(r[0].id);
    }).catch((e) => toast.error(e.message));
  }, [runId, onRunChange]);

  const load = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    try {
      setRes(await mrpApi.lines(runId, { ...filters, actionOnly: filters.actionOnly || undefined, sort: sort.key, order: sort.order, page, pageSize: 25 }));
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [runId, filters, sort, page]);
  useEffect(() => { load(); }, [load]);

  const run = runs.find((r) => r.id === runId);
  const exceptionCodes = Object.keys(run?.summary?.byException ?? {});
  const setFilter = (patch: Partial<typeof filters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const toggleSort = (key: string) => setSort((s) => (s.key === key ? { key, order: s.order === 'asc' ? 'desc' : 'asc' } : { key, order: key === 'sku' ? 'asc' : 'desc' }));

  async function openLine(l: any) {
    try { setDetail(await mrpApi.line(runId!, l.id)); } catch (e: any) { toast.error(e.message); }
  }
  async function exportCsv() {
    if (!run) return;
    try { await mrpApi.exportCsv(run.id, run.runNumber); } catch (e: any) { toast.error(isForbidden(e) || /403/.test(e.message) ? 'You do not have permission to export' : e.message); }
  }

  if (!runs.length) return <p className="text-sm text-slate-500 py-10 text-center">No planning runs yet — start one from the Overview tab.</p>;
  const cols = COLUMNS.filter((c) => !c.cost || res?.canSeeCost);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <select className={SELECT} value={runId ?? ''} onChange={(e) => { onRunChange(e.target.value); setPage(1); }}>
          {runs.map((r) => <option key={r.id} value={r.id}>{r.runNumber} · {fmtDate(r.asOf)}{r.warehouseId ? ' · 1 warehouse' : ''}</option>)}
        </select>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input className={`${SELECT} pl-8 w-56`} placeholder="SKU, description, supplier" value={filters.search} onChange={(e) => setFilter({ search: e.target.value })} />
        </div>
        <select className={SELECT} value={filters.status} onChange={(e) => setFilter({ status: e.target.value })}>
          <option value="">All statuses</option>
          {Object.entries(PLANNING_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className={SELECT} value={filters.exception} onChange={(e) => setFilter({ exception: e.target.value })}>
          <option value="">All exceptions</option>
          {exceptionCodes.map((c) => <option key={c} value={c}>{EXCEPTION_LABEL[c] ?? c}</option>)}
        </select>
        <select className={SELECT} value={filters.movement} onChange={(e) => setFilter({ movement: e.target.value })}>
          <option value="">All movement</option>
          {Object.entries(MOVEMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600 h-9">
          <input type="checkbox" checked={filters.actionOnly} onChange={(e) => setFilter({ actionOnly: e.target.checked })} /> Only with suggested orders
        </label>
        <Button variant="outline" className="ml-auto" onClick={exportCsv}><Download className="h-4 w-4 mr-1" />Export CSV</Button>
      </div>

      {run?.warnings?.length > 0 && (
        <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-0.5">
          {run.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
        </ul>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={THEAD}>
              <tr className={THEAD_ROW}>
                {cols.map((c) => (
                  <th key={c.key} className={`${TH} ${c.right ? 'text-right' : ''} whitespace-nowrap`}>
                    {c.sort ? (
                      <button className="inline-flex items-center gap-1 uppercase hover:text-slate-800" onClick={() => toggleSort(c.sort!)}>
                        {c.label}
                        {sort.key === c.sort && (sort.order === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </button>
                    ) : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading && !res ? [...Array(5)].map((_, i) => <tr key={i}><td colSpan={cols.length} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>)
                : res?.data?.length === 0 ? <tr><td colSpan={cols.length} className="px-4 py-10 text-center text-slate-400">No lines match these filters</td></tr>
                : res?.data?.map((l: any) => (
                  <tr key={l.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => openLine(l)}>
                    <td className={TD}><div className="font-mono text-slate-800">{l.sku}</div><div className="text-xs text-slate-500 truncate max-w-[220px]">{l.description}</div></td>
                    <td className={TD}><StatusPill status={l.planningStatus} /></td>
                    <td className={`${TD} text-right`}>{fmtQty(l.available)}</td>
                    <td className={`${TD} text-right text-slate-500`}>{fmtQty(l.safetyStock)}</td>
                    <td className={`${TD} text-right`}>{fmtQty(l.openPoQty)}</td>
                    <td className={`${TD} text-right`}>{fmtQty(l.forecastQty)}</td>
                    <td className={`${TD} text-right`}>{fmtQty(l.netReq)}</td>
                    <td className={`${TD} text-right ${l.projectedShortage > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{fmtQty(l.projectedShortage)}</td>
                    <td className={`${TD} text-right font-semibold`}>{l.suggestedQty > 0 ? fmtQty(l.suggestedQty) : <span className="text-slate-300">0</span>}</td>
                    <td className={TD}>{fmtDate(l.suggestedOrderDate)}</td>
                    {res.canSeeCost && <td className={`${TD} text-right`}>{fmtMoney(l.estCost, l.currency)}</td>}
                    <td className={TD}>
                      <div className="flex flex-wrap gap-1 max-w-[240px]">
                        {l.exceptionCodes.slice(0, 3).map((c: string) => <Pill key={c}>{EXCEPTION_LABEL[c] ?? c}</Pill>)}
                        {l.exceptionCodes.length > 3 && <span className="text-xs text-slate-400">+{l.exceptionCodes.length - 3}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {res && <Pager page={res.page} pageSize={res.pageSize} total={res.total} onPage={setPage} />}
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{detail?.sku} — {detail?.description}</DialogTitle></DialogHeader>
          {detail && <PlanDetail plan={detail.detail.plan} snapshot={detail.detail.snapshot} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
