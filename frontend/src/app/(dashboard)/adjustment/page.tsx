'use client';

import { useEffect, useState, useCallback } from 'react';
import { Calculator } from 'lucide-react';
import { adjustmentApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { RetiredNotice } from '@/components/layout/retired-notice';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/utils';

// Phase 2: Stock Adjustment is retired (create / approve / reject answer 410).
// Completed adjustments such as ADJ-2026-DWYA-H stay visible here unchanged.
export default function AdjustmentPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await adjustmentApi.list()); } catch { setRows([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const pending = rows.filter((a) => a.status === 'PENDING_APPROVAL').length;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Stock Adjustment (history)" subtitle="Past quantity adjustments" icon={Calculator} />
      <RetiredNotice feature="Stock Adjustment"
        extra={pending > 0 ? <p className="text-amber-700">{pending} adjustment(s) were still waiting for approval when the feature was retired. They will not be applied.</p> : undefined} />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Adjustment No.</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Item</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Reason</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Before → After</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Created</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No adjustment history</td></tr>
              : rows.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-green-700">{a.refNumber}</td>
                  <td className="px-4 py-3 text-slate-700">{a.productLabel}</td>
                  <td className="px-4 py-3 text-slate-600">{a.reason}{a.reasonCode && <span className="ml-1.5 text-[11px] text-slate-400">{a.reasonCode}</span>}</td>
                  <td className="px-4 py-3 font-medium">{a.quantityBefore} → {a.quantityAfter}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={a.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : a.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}>{a.status.replace(/_/g, ' ')}</Badge></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{a.createdAt ? formatDate(a.createdAt) : '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
