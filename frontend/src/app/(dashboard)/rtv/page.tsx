'use client';

import { useEffect, useState, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { rtvApi } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const RTV_FLOW = [
  'RTV_REQUIRED', 'PENDING_REVIEW', 'APPROVED', 'PENDING_SHIPMENT',
  'SHIPPED_TO_VENDOR', 'VENDOR_RECEIVED', 'REPLACEMENT_PENDING', 'CREDIT_NOTE_PENDING', 'COMPLETED',
];

export default function RTVPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await rtvApi.list()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function advance(c: any) {
    const idx = RTV_FLOW.indexOf(c.status);
    const next = idx >= 0 && idx < RTV_FLOW.length - 1 ? RTV_FLOW[idx + 1] : 'COMPLETED';
    try { await rtvApi.updateStatus(c.id, next); toast.success(`RTV moved to ${next.replace(/_/g, ' ')}`); load(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="RTV Case Management" subtitle="Vendor return, shipment, replacement and credit note" icon={RotateCcw} />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left px-4 py-3 font-medium text-slate-600">RTV Case</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Reason</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Item</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Vendor</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No RTV cases</td></tr>
              : rows.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-purple-700">{c.refNumber}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className="bg-red-100 text-red-700">{c.reason}</Badge></td>
                  <td className="px-4 py-3 text-slate-700">{c.stockItem?.product?.name ?? '—'}<br /><span className="text-xs text-slate-400">{c.stockItem?.serialNumber ?? c.stockItem?.product?.code}</span></td>
                  <td className="px-4 py-3 text-slate-600">{c.vendor?.name ?? '—'}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className="bg-purple-100 text-purple-700">{c.status.replace(/_/g, ' ')}</Badge></td>
                  <td className="px-4 py-3">{c.status !== 'COMPLETED' && <Button size="sm" className="h-7 bg-purple-600 hover:bg-purple-700 text-white" onClick={() => advance(c)}>Next</Button>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
