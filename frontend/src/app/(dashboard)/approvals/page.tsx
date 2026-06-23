'use client';

// Global Approval Workspace.
// Canonical home for request approvals (moved from /approval, which now redirects here).
// Governance surface — decisions are recorded by the backend approval flow.

import { useEffect, useState, useCallback } from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { requestsApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { REQUEST_STATUS_COLORS } from '@/lib/utils';
import type { RequestStatus } from '@/types';

export default function ApprovalsWorkspacePage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [submitted, pending] = await Promise.all([
        requestsApi.list({ status: 'SUBMITTED', limit: 50 }),
        requestsApi.list({ status: 'PENDING_APPROVAL', limit: 50 }),
      ]);
      setRows([...submitted.data, ...pending.data]);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function decide(id: string, approved: boolean) {
    try {
      await requestsApi.approve(id, approved, approved ? undefined : 'Rejected by approver');
      toast.success(approved ? 'Request approved' : 'Request rejected');
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Approval Workspace" subtitle="Global request approval & validation queue" icon={ShieldCheck} />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Request</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Requester</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">RMA</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Validation</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No requests pending approval</td></tr>
              : rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-green-700">{r.refNumber}</td>
                  <td className="px-4 py-3 text-slate-700">{r.requester?.fullName}<br /><span className="text-xs text-slate-400">{r.department}</span></td>
                  <td className="px-4 py-3 text-slate-600">{r.rmaCaseNumber ?? '—'}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className="bg-green-100 text-green-700">Stock OK</Badge></td>
                  <td className="px-4 py-3"><Badge variant="outline" className={REQUEST_STATUS_COLORS[r.status as RequestStatus]}>{r.status.replace(/_/g, ' ')}</Badge></td>
                  <td className="px-4 py-3 space-x-1">
                    <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-white" onClick={() => decide(r.id, true)}>Approve</Button>
                    <Button size="sm" variant="outline" className="h-7 text-red-600 border-red-200" onClick={() => decide(r.id, false)}>Reject</Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
