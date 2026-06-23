'use client';

// Warehouse Returns — Inbound Verification.
// Canonical home for processing returned goods (moved from /unused, which now redirects here).
// Warehouse verifies returned units back to stock, or routes defective ones to RTV.

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { unusedApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function WarehouseReturnsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await unusedApi.pending()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function ret(id: string) {
    try { await unusedApi.returnToStock(id); toast.success('Returned to available stock'); load(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function doa(id: string) {
    try { await unusedApi.markDoa(id); toast.success('Marked DOA — routed to RTV'); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Returns — Inbound Verification" subtitle="Verify returned goods back to stock or route to RTV" icon={RefreshCw} />
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
                  <td className="px-4 py-3 text-slate-600">{r.items?.map((it: any) => it.product?.code).join(', ')}</td>
                  <td className="px-4 py-3 space-x-1">
                    <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" onClick={() => ret(r.id)}>Verify & Return</Button>
                    <Button size="sm" className="h-7 bg-red-600 hover:bg-red-700 text-white" onClick={() => doa(r.id)}>Mark DOA</Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
