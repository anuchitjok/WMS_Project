'use client';

// Warehouse Returns — Inbound Verification.
// Canonical home for processing returned goods (moved from /unused, which now redirects here).
// Warehouse receives returned units back (→ putaway queue; Available only after
// putaway), or routes defective ones to RTV. Units can be processed one at a time
// when only part of a request has come back.

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { unusedApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function WarehouseReturnsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Return being marked DOA (drives the confirmation modal for this destructive action).
  const [doaTarget, setDoaTarget] = useState<any | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Optional subset of units for the action (partial return); empty = all units awaiting return.
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const unitsFor = (id: string) => picked[id]?.length ? picked[id] : undefined;
  const toggle = (reqId: string, unitId: string) => setPicked((p) => {
    const cur = p[reqId] ?? [];
    return { ...p, [reqId]: cur.includes(unitId) ? cur.filter((x) => x !== unitId) : [...cur, unitId] };
  });

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await unusedApi.pending()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function ret(id: string) {
    setBusyId(id);
    try { await unusedApi.returnToStock(id, unitsFor(id)); toast.success('Received back — now waiting in the Putaway queue'); setPicked((p) => ({ ...p, [id]: [] })); load(); }
    catch (e: any) { toast.error(e.message); } finally { setBusyId(null); }
  }
  async function confirmDoa() {
    if (!doaTarget) return;
    setBusyId(doaTarget.id);
    try { await unusedApi.markDoa(doaTarget.id, unitsFor(doaTarget.id)); toast.success('Marked DOA — routed to RTV'); setPicked((p) => ({ ...p, [doaTarget.id]: [] })); setDoaTarget(null); load(); }
    catch (e: any) { toast.error(e.message); } finally { setBusyId(null); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Returns — Inbound Verification" subtitle="Receive returned goods (they go to Putaway before they are available) or route defective ones to RTV" icon={RefreshCw} />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Request</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">RMA</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Items</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Warehouse Action</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(4)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-400">No returns awaiting verification</td></tr>
              : rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-green-700">{r.refNumber}</td>
                  <td className="px-4 py-3 text-slate-600">{r.rmaCaseNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-xs">
                    {r.pendingUnits?.length ? (
                      <div className="space-y-1">
                        {r.pendingUnits.map((u: any) => (
                          <label key={u.stockItemId} className="flex items-center gap-2 text-xs">
                            <input type="checkbox" checked={picked[r.id]?.includes(u.stockItemId) ?? false} onChange={() => toggle(r.id, u.stockItemId)} />
                            <span>{u.stock?.product?.code ?? '—'}</span>
                            <span className="font-mono text-slate-500">{u.stock?.serialNumber ?? `qty ${u.quantity}`}</span>
                            <span className="text-slate-400">{u.usage === 'WRONG_ITEM' ? 'wrong item' : 'unused'}</span>
                          </label>
                        ))}
                        <p className="text-[11px] text-slate-400">{picked[r.id]?.length ? `${picked[r.id].length} selected` : 'None selected = all units listed'}</p>
                      </div>
                    ) : <span className="truncate" title={r.items?.map((it: any) => it.product?.code).join(', ')}>{r.items?.map((it: any) => it.product?.code).join(', ')}</span>}
                  </td>
                  <td className="px-4 py-3 space-x-1 whitespace-nowrap">
                    <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" disabled={busyId === r.id} onClick={() => ret(r.id)}>Receive back → Putaway</Button>
                    <Button size="sm" variant="outline" className="h-7 text-red-600 border-red-200" disabled={busyId === r.id} onClick={() => setDoaTarget(r)}>Mark DOA</Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Confirmation modal — Mark DOA routes goods to RTV and cannot be undone */}
      {doaTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setDoaTarget(null)}>
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500" /> Mark DOA · {doaTarget.refNumber}</h3>
              <button className="text-slate-400 hover:text-slate-700" onClick={() => setDoaTarget(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-slate-600">
                This routes {picked[doaTarget.id]?.length ? `the ${picked[doaTarget.id].length} selected unit(s)` : 'the returned goods'} to RTV as defective and cannot be undone.
                Continue only if the items are genuinely damaged / dead-on-arrival.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <Button variant="outline" size="sm" onClick={() => setDoaTarget(null)}>Cancel</Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" disabled={busyId === doaTarget.id} onClick={confirmDoa}>Confirm Mark DOA</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
