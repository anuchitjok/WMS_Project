'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { mrpApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Note, Pager, Pill, SELECT, Section, TD, TH, THEAD, THEAD_ROW, fmtDate, fmtMoney, fmtQty, isForbidden } from './shared';

// Inbound supply = purchase-order lines imported from the purchasing system.
// Visibility and planning only: this screen never creates or changes a PO in purchasing.

const STATUS_TONE: Record<string, 'green' | 'amber' | 'slate' | 'blue'> = { OPEN: 'blue', PARTIAL: 'amber', CLOSED: 'green', CANCELLED: 'slate' };

export function MrpSupply() {
  const [filters, setFilters] = useState({ search: '', status: '', overdue: false });
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<any>(null);
  const [perf, setPerf] = useState<any[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    try { setRes(await mrpApi.supply({ search: filters.search || undefined, status: filters.status || undefined, overdue: filters.overdue || undefined, page, pageSize: 25 })); }
    catch (e: any) { toast.error(e.message); }
  }, [filters, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { mrpApi.supplyPerformance().then(setPerf).catch(() => setPerf([])); }, []);

  return (
    <div className="space-y-5">
      <Note>
        PO lines come from the purchasing system by file import. Received quantity uses the larger of what purchasing reports and what WMS Goods Receiving booked against the same PO number.
        Lines that are closed or cancelled are not counted as supply.
      </Note>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input className={`${SELECT} pl-8 w-56`} placeholder="PO number or supplier" value={filters.search} onChange={(e) => { setFilters({ ...filters, search: e.target.value }); setPage(1); }} />
        </div>
        <select className={SELECT} value={filters.status} onChange={(e) => { setFilters({ ...filters, status: e.target.value }); setPage(1); }}>
          <option value="">All statuses</option><option value="OPEN">Open</option><option value="PARTIAL">Partial</option><option value="CLOSED">Closed</option><option value="CANCELLED">Cancelled</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={filters.overdue} onChange={(e) => { setFilters({ ...filters, overdue: e.target.checked }); setPage(1); }} /> Overdue only</label>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => mrpApi.supplyTemplate().catch((e) => toast.error(e.message))}><Download className="h-4 w-4 mr-1" />Template</Button>
          <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 mr-1" />Import PO lines</Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>PO / line</th><th className={TH}>SKU</th><th className={TH}>Supplier</th><th className={`${TH} text-right`}>Ordered</th><th className={`${TH} text-right`}>Received (PO / WMS)</th><th className={`${TH} text-right`}>Outstanding</th><th className={TH}>Expected</th><th className={TH}>Status</th>{res?.canSeeCost && <th className={`${TH} text-right`}>Unit cost</th>}</tr></thead>
            <tbody className="divide-y divide-slate-50">
              {!res ? [...Array(4)].map((_, i) => <tr key={i}><td colSpan={9} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>)
                : res.data.length === 0 ? <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">No PO lines imported</td></tr>
                : res.data.map((l: any) => (
                  <tr key={l.id}>
                    <td className={TD}><span className="font-mono">{l.poNumber}</span> / {l.lineNumber}{!l.isConfirmed && <div className="text-xs text-slate-400">unconfirmed</div>}</td>
                    <td className={TD}><span className="font-mono">{l.product?.code ?? '—'}</span></td>
                    <td className={TD}>{l.vendorName ?? '—'}</td>
                    <td className={`${TD} text-right`}>{fmtQty(l.orderedQty)} {l.uom ?? ''}</td>
                    <td className={`${TD} text-right`}>{fmtQty(l.receivedQty)} / {fmtQty(l.wmsReceivedQty)}</td>
                    <td className={`${TD} text-right font-medium`}>{fmtQty(l.outstandingQty)}</td>
                    <td className={TD}>{fmtDate(l.expectedDate)} {l.overdue && <Pill tone="red">Overdue</Pill>}</td>
                    <td className={TD}><Pill tone={STATUS_TONE[l.status] ?? 'slate'}>{String(l.status).toLowerCase()}</Pill></td>
                    {res.canSeeCost && <td className={`${TD} text-right`}>{fmtMoney(l.unitCost, l.currency)}</td>}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {res && <Pager page={res.page} pageSize={res.pageSize} total={res.total} onPage={setPage} />}
      </div>

      <Section title="Supplier delivery performance" subtitle="From imported PO lines with an expected date and their WMS receipts. Actual lead time needs an order date.">
        <table className="w-full text-sm">
          <thead className={THEAD}><tr className={THEAD_ROW}><th className={TH}>Supplier</th><th className={`${TH} text-right`}>PO lines</th><th className={`${TH} text-right`}>Received</th><th className={`${TH} text-right`}>On time</th><th className={`${TH} text-right`}>Avg / max delay (days)</th><th className={`${TH} text-right`}>Avg actual lead time</th><th className={TH} /></tr></thead>
          <tbody className="divide-y divide-slate-50">
            {!perf ? <tr><td colSpan={7} className="px-4 py-3"><Skeleton className="h-6" /></td></tr> : perf.length === 0 ? <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No data yet</td></tr> : perf.map((p) => (
              <tr key={p.vendor}>
                <td className={TD}>{p.vendor}</td><td className={`${TD} text-right`}>{p.poLines}</td><td className={`${TD} text-right`}>{p.receivedLines}</td>
                <td className={`${TD} text-right`}>{p.onTimePct == null ? '—' : `${p.onTimePct}%`}</td>
                <td className={`${TD} text-right`}>{p.avgDelayDays ?? '—'} / {p.maxDelayDays ?? '—'}</td>
                <td className={`${TD} text-right`}>{p.avgActualLeadTimeDays ?? '—'}{p.leadTimeSamples ? <span className="text-xs text-slate-400"> (n={p.leadTimeSamples})</span> : null}</td>
                <td className={`${TD} text-xs text-amber-700`}>{p.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load(); }} />
    </div>
  );
}

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => { setFile(null); setPreview(null); if (ref.current) ref.current.value = ''; };

  async function check(f: File) {
    setFile(f); setBusy(true);
    try { setPreview(await mrpApi.supplyPreview(f)); } catch (e: any) { toast.error(isForbidden(e) ? 'You do not have permission to import supply' : e.message); setPreview(null); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!file) return;
    setBusy(true);
    try {
      const r = await mrpApi.supplyCommit(file);
      toast.success(`Imported: ${r.created} new, ${r.updated} updated, ${r.skipped} skipped`);
      reset(); onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Import PO lines</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Upload the CSV or Excel export from purchasing. Rows are matched on PO number + line number: existing lines are updated, new ones added. Rows with errors are skipped.</p>
          <input ref={ref} type="file" accept=".csv,.xlsx,.xls" className="text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) check(f); }} />
          {busy && !preview && <Skeleton className="h-24" />}
          {preview && (
            <>
              <p className="text-sm"><span className="text-green-700 font-medium">{preview.valid} valid</span> · <span className={preview.invalid ? 'text-red-600 font-medium' : 'text-slate-500'}>{preview.invalid} with errors</span> · {preview.total} total</p>
              <div className="max-h-80 overflow-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className={`${THEAD} sticky top-0`}><tr className={THEAD_ROW}><th className="px-3 py-2">Row</th><th className="px-3 py-2">PO / line</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2 text-right">Ordered</th><th className="px-3 py-2">Expected</th><th className="px-3 py-2">Result</th></tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {preview.rows.map((r: any, i: number) => (
                      <tr key={i} className={r.errors.length ? 'bg-red-50/50' : ''}>
                        <td className="px-3 py-2">{r.row ?? i + 2}</td>
                        <td className="px-3 py-2 font-mono">{r.poNumber} / {r.lineNumber}</td>
                        <td className="px-3 py-2 font-mono">{r.sku}</td>
                        <td className="px-3 py-2 text-right">{r.data?.orderedQty ?? '—'}</td>
                        <td className="px-3 py-2">{fmtDate(r.data?.expectedDate)}</td>
                        <td className="px-3 py-2">{r.errors.length ? <span className="text-red-600">{r.errors.join('; ')}</span> : <span className="text-green-700">OK</span>}{r.warnings?.length ? <div className="text-amber-700">{r.warnings.join('; ')}</div> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={!preview?.valid || busy} onClick={commit}>{busy ? 'Importing…' : `Import ${preview?.valid ?? 0} row(s)`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
