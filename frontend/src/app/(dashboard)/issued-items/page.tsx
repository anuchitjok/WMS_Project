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

const USAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'USED', label: 'Used' },
  { value: 'UNUSED', label: 'Unused — returning' },
  { value: 'WRONG_ITEM', label: 'Wrong item — returning' },
  { value: 'DOA', label: 'DOA' },
  { value: 'DEFECTIVE', label: 'Defective' },
];
const usageLabel = (u: string | null) => USAGE_OPTIONS.find((o) => o.value === u)?.label ?? u ?? '';

export default function IssuedItemsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [split, setSplit] = useState<{ req: any; units: IssuedUnitRow[] } | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await rmaApi.pendingUsage()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setUsage(id: string, usage: string) {
    setBusyId(id);
    try { await rmaApi.confirmUsage(id, usage); toast.success(`Usage confirmed: ${usageLabel(usage)}`); load(); }
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
      toast.success(`Recorded ${units.length} unit(s)`);
      setSplit(null); load();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusyId(null); }
  }

  const open = split?.units.filter((u) => !u.usage) ?? [];
  const chosen = Object.values(choice).filter(Boolean).length;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="My Issued Items" subtitle="Confirm usage of issued goods — Used, DOA, or Unused return. Use “Per unit” when only part was used." icon={PackageCheck} />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Request</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">RMA</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Items</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Usage Action</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">No issued items awaiting usage confirmation</td></tr>
              : rows.map((r) => {
                const recorded = r.unitUsages?.length ?? 0;
                const legacyDone = !recorded && r.items?.some((it: any) => it.usageStatus);
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-green-700">{r.refNumber}</td>
                    <td className="px-4 py-3 text-slate-600">{r.rmaCaseNumber ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{r.items?.map((it: any) => it.product?.code).join(', ')}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={REQUEST_STATUS_COLORS[r.status as RequestStatus]}>{r.status.replace(/_/g, ' ')}</Badge>
                      {recorded > 0 && <p className="mt-1 text-xs text-slate-500">{recorded} unit(s) recorded</p>}
                    </td>
                    <td className="px-4 py-3 space-x-1 whitespace-nowrap">
                      {legacyDone ? <span className="text-xs text-slate-500">Usage confirmed</span> : (
                        <>
                          {recorded === 0 && (
                            <>
                              <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" disabled={busyId === r.id} onClick={() => setUsage(r.id, 'USED')}>Used</Button>
                              <Button size="sm" className="h-7 bg-red-600 hover:bg-red-700 text-white" disabled={busyId === r.id} onClick={() => setUsage(r.id, 'DOA')}>DOA</Button>
                              <Button size="sm" variant="outline" className="h-7" disabled={busyId === r.id} onClick={() => setUsage(r.id, 'UNUSED')}>Unused</Button>
                            </>
                          )}
                          <Button size="sm" variant="outline" className="h-7" disabled={busyId === r.id} onClick={() => openSplit(r)}>Per unit…</Button>
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
          <DialogHeader><DialogTitle>Usage per unit · {split?.req.refNumber}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            Pick what happened to each unit. Returned units count as stock again only after the warehouse receives and puts them away.
          </p>
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-3 py-2 font-medium text-slate-600">Product</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Serial / batch</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Qty</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">What happened</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {split?.units.map((u) => (
                  <tr key={u.stockItemId}>
                    <td className="px-3 py-2 text-slate-700">{u.productCode}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{u.serialNumber ?? u.batchNumber ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{u.quantity} {u.unit ?? ''}</td>
                    <td className="px-3 py-2">
                      {u.usage ? <span className="text-xs text-slate-500">{usageLabel(u.usage)}{u.returnStatus ? ` · return ${u.returnStatus.toLowerCase()}` : ''}</span> : (
                        <select aria-label={`Usage for ${u.serialNumber ?? u.productCode}`} className="w-full border border-slate-200 rounded-md px-2 py-1 text-sm bg-white"
                          value={choice[u.stockItemId] ?? ''} onChange={(e) => setChoice({ ...choice, [u.stockItemId]: e.target.value })}>
                          <option value="">Not yet</option>
                          {USAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">{chosen} of {open.length} open unit(s) selected. Units left as “Not yet” can be recorded later.</p>
          <DialogFooter>
            <Button className="bg-green-600 hover:bg-green-700 text-white" disabled={!chosen || busyId === split?.req.id} onClick={saveSplit}>Record {chosen || ''} unit(s)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
