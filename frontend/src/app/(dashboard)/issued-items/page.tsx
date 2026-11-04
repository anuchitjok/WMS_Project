'use client';

// My Issued Items — post-issue workflow.
// Canonical home for confirming what happened to issued goods (moved from /rma-usage,
// which now redirects here). Requesters confirm Used / DOA / Unused after goods are issued —
// for the whole request, or per unit when part was used and part is coming back.

import { useEffect, useState, useCallback } from 'react';
import { PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { rmaApi, type IssuedUnitRow } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { REQUEST_STATUS_COLORS } from '@/lib/utils';
import type { RequestStatus } from '@/types';
import { labelOf, useT } from '@/i18n';

// Values sent to the API — never translated; only their labels are.
const USAGE_VALUES = ['USED', 'UNUSED', 'WRONG_ITEM', 'DOA', 'DEFECTIVE'] as const;

export default function IssuedItemsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [split, setSplit] = useState<{ req: any; units: IssuedUnitRow[] } | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const { m, t } = useT();
  const RT = m.returns;
  const I = RT.issued;
  const usageLabel = (u: string | null) => (u ? labelOf(RT.usage, u) : '');

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await rmaApi.pendingUsage()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setUsage(id: string, usage: string) {
    setBusyId(id);
    try { await rmaApi.confirmUsage(id, usage); toast.success(t(I.toastConfirmed, { usage: usageLabel(usage) })); load(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusyId(null); }
  }

  async function openSplit(req: any) {
    try {
      const res = await rmaApi.units(req.id);
      setChoice({});
      setSplit({ req, units: res.units });
    } catch (e: any) { toast.error(e.message); }
  }

  async function saveSplit() {
    if (!split) return;
    const units = Object.entries(choice).filter(([, u]) => u).map(([stockItemId, usage]) => ({ stockItemId, usage }));
    if (!units.length) return;
    setBusyId(split.req.id);
    try {
      await rmaApi.confirmUnits(split.req.id, units);
      toast.success(t(I.toastRecorded, { count: units.length }));
      setSplit(null); load();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusyId(null); }
  }

  const open = split?.units.filter((u) => !u.usage) ?? [];
  const chosen = Object.values(choice).filter(Boolean).length;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title={I.title} subtitle={I.subtitle} icon={PackageCheck} />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">{RT.col.request}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{RT.col.rma}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{RT.col.items}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{RT.col.status}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{RT.col.usageAction}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">{I.empty}</td></tr>
              : rows.map((r) => {
                const recorded = r.unitUsages?.length ?? 0;
                const legacyDone = !recorded && r.items?.some((it: any) => it.usageStatus);
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-green-700">{r.refNumber}</td>
                    <td className="px-4 py-3 text-slate-600">{r.rmaCaseNumber ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{r.items?.map((it: any) => it.product?.code).join(', ')}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={REQUEST_STATUS_COLORS[r.status as RequestStatus]}>{labelOf(m.status.request, r.status)}</Badge>
                      {recorded > 0 && <p className="mt-1 text-xs text-slate-500">{t(I.unitsRecorded, { count: recorded })}</p>}
                    </td>
                    <td className="px-4 py-3 space-x-1 whitespace-nowrap">
                      {legacyDone ? <span className="text-xs text-slate-500">{I.usageConfirmed}</span> : (
                        <>
                          {recorded === 0 && (
                            <>
                              <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" disabled={busyId === r.id} onClick={() => setUsage(r.id, 'USED')}>{I.used}</Button>
                              <Button size="sm" className="h-7 bg-red-600 hover:bg-red-700 text-white" disabled={busyId === r.id} onClick={() => setUsage(r.id, 'DOA')}>{I.doa}</Button>
                              <Button size="sm" variant="outline" className="h-7" disabled={busyId === r.id} onClick={() => setUsage(r.id, 'UNUSED')}>{I.unused}</Button>
                            </>
                          )}
                          <Button size="sm" variant="outline" className="h-7" disabled={busyId === r.id} onClick={() => openSplit(r)}>{I.perUnit}</Button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!split} onOpenChange={(o) => { if (!o) setSplit(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{t(I.splitTitle, { ref: split?.req.refNumber ?? '' })}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            {I.splitHint}
          </p>
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-3 py-2 font-medium text-slate-600">{RT.col.product}</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">{RT.col.serialBatch}</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">{RT.col.qty}</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">{RT.col.whatHappened}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {split?.units.map((u) => (
                  <tr key={u.stockItemId}>
                    <td className="px-3 py-2 text-slate-700">{u.productCode}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{u.serialNumber ?? u.batchNumber ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{u.quantity} {u.unit ?? ''}</td>
                    <td className="px-3 py-2">
                      {u.usage ? <span className="text-xs text-slate-500">{usageLabel(u.usage)}{u.returnStatus ? t(I.returnState, { status: u.returnStatus.toLowerCase() }) : ''}</span> : (
                        <select aria-label={t(I.usageFor, { name: u.serialNumber ?? u.productCode })} className="w-full border border-slate-200 rounded-md px-2 py-1 text-sm bg-white"
                          value={choice[u.stockItemId] ?? ''} onChange={(e) => setChoice({ ...choice, [u.stockItemId]: e.target.value })}>
                          <option value="">{I.notYet}</option>
                          {USAGE_VALUES.map((v) => <option key={v} value={v}>{RT.usage[v]}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">{t(I.selected, { chosen, open: open.length })}</p>
          <DialogFooter>
            <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={!chosen || busyId === split?.req.id} onClick={saveSplit}>{t(I.record, { count: chosen || '' })}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
