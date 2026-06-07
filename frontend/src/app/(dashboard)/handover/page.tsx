'use client';

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { fulfillmentApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { REQUEST_STATUS_COLORS } from '@/lib/utils';
import type { RequestStatus } from '@/types';

export default function HandoverPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await fulfillmentApi.handoverQueue()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handover(r: any) {
    try {
      await fulfillmentApi.issueToRma(r.id, { receiver: r.requester?.fullName ?? 'Receiver' });
      toast.success('Handover confirmed — issued to RMA');
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Handover Confirmation" subtitle="Receiver confirmation and issue to RMA" icon={CheckCircle2} />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Request</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Receiver</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Items</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">No items awaiting handover</td></tr>
              : rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-blue-700">{r.refNumber}</td>
                  <td className="px-4 py-3 text-slate-700">{r.requester?.fullName}</td>
                  <td className="px-4 py-3 text-slate-600">{r.items?.length ?? 0}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={REQUEST_STATUS_COLORS[r.status as RequestStatus]}>{r.status.replace(/_/g, ' ')}</Badge></td>
                  <td className="px-4 py-3"><Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" onClick={() => handover(r)}>Confirm Handover</Button></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
