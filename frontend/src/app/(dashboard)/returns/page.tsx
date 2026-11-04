'use client';

// Pending Returns — requester-facing read view.
// Shows the requester's items flagged for return that are awaiting warehouse
// inbound verification. Read-only: the warehouse performs verification on
// /warehouse/returns. This page gives requesters visibility into return status.

import { useEffect, useState, useCallback } from 'react';
import { Undo2 } from 'lucide-react';
import { unusedApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n';

export default function PendingReturnsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { m } = useT();
  const RT = m.returns;

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await unusedApi.pending()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5">
      <PageHeader title={RT.pending.title} subtitle={RT.pending.subtitle} icon={Undo2} />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">{RT.col.request}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{RT.col.rma}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{RT.col.items}</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">{RT.col.returnStatus}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(4)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-400">{RT.pending.empty}</td></tr>
              : rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-green-700">{r.refNumber}</td>
                  <td className="px-4 py-3 text-slate-600">{r.rmaCaseNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{r.items?.map((it: any) => it.product?.code).join(', ')}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-300">{RT.pending.awaiting}</Badge>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
