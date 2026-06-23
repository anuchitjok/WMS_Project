'use client';

// My Issued Items — post-issue workflow.
// Canonical home for confirming what happened to issued goods (moved from /rma-usage,
// which now redirects here). Requesters confirm Used / DOA / Unused after goods are issued.

import { useEffect, useState, useCallback } from 'react';
import { PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { rmaApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { REQUEST_STATUS_COLORS } from '@/lib/utils';
import type { RequestStatus } from '@/types';

export default function IssuedItemsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await rmaApi.pendingUsage()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setUsage(id: string, usage: string) {
    try { await rmaApi.confirmUsage(id, usage); toast.success(`Usage confirmed: ${usage}`); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="My Issued Items" subtitle="Confirm usage of issued goods — Used, DOA, or Unused return" icon={PackageCheck} />
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
              : rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-green-700">{r.refNumber}</td>
                  <td className="px-4 py-3 text-slate-600">{r.rmaCaseNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{r.items?.map((it: any) => it.product?.code).join(', ')}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={REQUEST_STATUS_COLORS[r.status as RequestStatus]}>{r.status.replace(/_/g, ' ')}</Badge></td>
                  <td className="px-4 py-3 space-x-1">
                    <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" onClick={() => setUsage(r.id, 'USED')}>Used</Button>
                    <Button size="sm" className="h-7 bg-red-600 hover:bg-red-700 text-white" onClick={() => setUsage(r.id, 'DOA')}>DOA</Button>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => setUsage(r.id, 'UNUSED')}>Unused</Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
