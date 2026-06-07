'use client';

import { useEffect, useState, useCallback } from 'react';
import { requestsApi } from '@/lib/api';
import type { WithdrawalRequest, RequestStatus } from '@/types';
import type { PaginatedResponse } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { REQUEST_STATUS_COLORS, formatDate } from '@/lib/utils';
import { Plus } from 'lucide-react';

const STATUS_OPTIONS: { value: RequestStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'COMPLETED', label: 'Completed' },
];

export default function RequestsPage() {
  const [data, setData] = useState<PaginatedResponse<WithdrawalRequest> | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>('ALL');

  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await requestsApi.list({
        status: status !== 'ALL' ? status : undefined,
        page,
        limit: 20,
      });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Withdrawal Requests</h1>
          <p className="text-slate-500 text-sm mt-1">{data ? `${data.total} requests` : 'Loading…'}</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-2" />New Request
        </Button>
      </div>

      <div className="flex gap-3">
        <Select value={status} onValueChange={(v) => { setStatus(v ?? 'ALL'); setPage(1); }}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-4 py-3 font-medium text-slate-600">Ref #</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Requester</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Department</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Items</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>
              ))
            ) : data?.data.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No requests found</td></tr>
            ) : (
              data?.data.map((req) => (
                <tr key={req.id} className="hover:bg-slate-50 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-blue-700">{req.refNumber}</td>
                  <td className="px-4 py-3 text-slate-800">{req.requester.fullName}</td>
                  <td className="px-4 py-3 text-slate-600">{req.department}</td>
                  <td className="px-4 py-3">
                    <Badge className={REQUEST_STATUS_COLORS[req.status]} variant="outline">
                      {req.status.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{req.items?.length ?? 0}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{formatDate(req.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
            <p className="text-sm text-slate-500">Page {data.page} of {data.totalPages}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
