'use client';

import { useEffect, useState, useCallback } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { transferApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { RetiredNotice } from '@/components/layout/retired-notice';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/utils';

// Phase 2: Stock Transfer is retired (the API answers 410 for new or completed
// transfers). Existing transfer records stay visible here as history.
export default function TransferPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await transferApi.list()); } catch { setRows([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Stock Transfer (history)" subtitle="Past transfers between locations" icon={ArrowLeftRight} />
      <RetiredNotice feature="Stock Transfer" />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">Transfer No.</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Item</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">From → To</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Qty</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Created</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No transfer history</td></tr>
              : rows.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-green-700">{t.refNumber}</td>
                  <td className="px-4 py-3 text-slate-700">{t.productLabel}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{t.fromLocation} → {t.toLocation}</td>
                  <td className="px-4 py-3 font-medium">{t.quantity}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className={t.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'}>{t.status}</Badge></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{t.createdAt ? formatDate(t.createdAt) : '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
